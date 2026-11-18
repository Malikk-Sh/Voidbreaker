import { DEVOURER_CLIPS } from '../../anim/clips/devourer';
import { layoutOf } from '../../anim/puppet';
import { clamp, dampAngle } from '../../core/math';
import { ENEMIES } from '../../data/enemies';
import { DEVOURER_RIG } from '../../gen/chars/devourer';
import { overlaps, type Shape } from '../combat';
import { QuarryEchoes } from './quarryEchoes';
import { Enemy, type SpawnOpts } from '../enemy';
import { registerEnemy } from '../enemies/factory';
import type { Telegraph } from '../entities';
import type { StrikeParams, World } from '../world';

import { BELL_STANDS } from '../../data/echoBells';
export const HUNT = {
  phase2: 0.68,
  phase3: 0.39,
  bellCooldown: 9,
  lureRecovery: 4.6,
  runUp: 4.2,
  exposed: [2.05, 1.85, 1.65],
  windup: [0.97, 0.87, 0.8],
  rush: [15.5, 17.5, 19],
  shellArmor: 410,
  throat: 2.15,
  crashFraction: 0.022,
  tailInner: 3.15,
  tailOuter: 6.4,
  jawHalf: 0.88,
  execute: 0.065,
};
type Motion = 'intro' | 'hunt' | 'aim' | 'active' | 'exposed' | 'recover' | 'shift' | 'dying';
type Attack = 'rush' | 'rake' | 'pounce' | 'howl' | 'sweep' | 'listen' | 'crosscall' | 'snap';
type Opening = 'bell' | 'shoulder' | 'silence' | 'return' | 'riposte';
interface AttackOptions {
  bell?: number;
  follow?: boolean;
  ambient?: boolean;
  mark?: { x: number; z: number };
}
export class Devourer extends Enemy {
  readonly bells = BELL_STANDS.map(({ x, z }) => ({
    x: Number(x),
    z: Number(z),
    cooldown: 0,
    pulse: 0,
    roll: 0,
    facing: 0,
  }));
  readonly stone = { x: -2.6, y: 4.1, z: -1.5, facing: 0 };
  loose = false;
  phase = 1;
  motion: Motion = 'intro';
  attack: Attack = 'rush';
  elapsed = 0;
  duration = 1;
  private startX = 0;
  private startZ = 0;
  targetX = 0;
  targetZ = 0;
  private bellTarget = -1;
  readonly echoes = new QuarryEchoes();
  lastBell = -1;
  opening: Opening | null = null;
  private pendingBell = -1;
  private soundLife = 0;
  private sampleIndex = 0;
  private heard = false;
  private lastNoise = -1;
  private readonly noiseAt = { x: 0, z: 0 };
  private tailCounter = false;
  private jaw: Telegraph | null = null;
  private exposedDamage = 0;
  private callDX = 0;
  private callDZ = 1;
  private callSide = 0;
  private returnHowl = false;
  private answered = false;
  private specialCount = 0;
  private echoPending = false;
  private lured = false;
  private rollSign = 1;
  private lureLock = 0;
  private passed = false;
  private guardHits = 0;
  private guardAge = 0;
  private guardCooldown = 0;
  private riposte = false;
  private readonly recoilAt = { x: 0, z: 0 };
  private second = false;
  private turn = 0;
  private lastAttack: Attack | null = null;
  private left = true;
  private wounds = 0;
  private woundT = 0;
  private readonly rootMotion = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  private sceneClip = 'listen';
  private sceneAge = 0;
  private damageReleased = false;
  constructor(opts: SpawnOpts) {
    super(ENEMIES.devourer, layoutOf(DEVOURER_RIG), DEVOURER_CLIPS, opts);
    this.isBoss = true;
    this.armor = HUNT.shellArmor;
  }
  override onAdded(w: World): void {
    const beast = this;
    for (const [i, bell] of this.bells.entries())
      w.aimTargets.add({
        get x() {
          return bell.x;
        },
        get z() {
          return bell.z;
        },
        radius: 0.86,
        get targetable() {
          return (
            !beast.dead &&
            !beast.invulnerable &&
            !beast.inWindow &&
            beast.bellReady(i) &&
            Math.hypot(w.hero.x - bell.x, w.hero.z - bell.z) < 3.1
          );
        },
      });
    w.bus.on('bladeSweep', ({ shape, hitList }) => {
      if (this.dead || this.invulnerable || w.hero.dead || w.hero.locked) return;
      for (let i = 0; i < this.bells.length; i++) {
        const b = this.bells[i],
          id = -10 - i;
        if (hitList.has(id) || !this.bellReady(i) || !overlaps(shape, b.x, b.z, 0.86)) continue;
        hitList.add(id);
        this.sound(w, i, true);
        break;
      }
    });
    const noise = () => {
      if (this.motion === 'aim' && this.attack === 'listen') this.lastNoise = this.elapsed;
    };
    w.bus.on('swing', noise);
    w.bus.on('dash', noise);
    w.bus.on('castStart', noise);
  }

  bellReady(i: number): boolean {
    if (this.invulnerable || this.inWindow || this.dead) return false;
    if (this.echoes.isCalling(i)) return true;
    if (this.motion === 'aim' && this.attack === 'crosscall') return false;
    return i !== this.lastBell && this.bells[i].cooldown <= 0 && this.lureLock <= 0;
  }

  private sound(w: World, i: number, blade: boolean): void {
    const b = this.bells[i];
    b.pulse = 1;
    w.bus.emit('bellPulse', { x: b.x, y: i === 2 && this.phase > 1 ? 0.78 : 1.45, z: b.z, big: blade });
    w.bus.emit('sfx', { id: blade ? 'boss_bell' : 'tele_bell', x: b.x, z: b.z, gain: blade ? 0.85 : 0.48 });
    if (blade) {
      b.cooldown = HUNT.bellCooldown;
      if (this.echoes.mute(i)) {
        this.answered = true;
        const dx = this.x - b.x, dz = this.z - b.z, len = Math.hypot(dx, dz);
        if (len > 0.1) w.bus.emit('quarryWave', { x: b.x, z: b.z, dx: dx / len, dz: dz / len, len });
        w.bus.emit('shockwave', { x: b.x, z: b.z, r: 2.4, color: 'gold', strength: 0.45 });
        return;
      }
      // A nearby bell cannot give a stationary beast a running start.
      if (Math.hypot(this.x - b.x, this.z - b.z) < HUNT.runUp) {
        if (this.motion === 'hunt' && !this.specialDue()) this.begin(w, 'sweep');
        return;
      }
      this.pendingBell = i;
      this.soundLife = 1.8;
      const aiming = this.motion === 'aim' && this.attack === 'rush' && this.bellTarget < 0 && this.elapsed < this.duration * 0.6;
      if ((this.motion === 'hunt' && !this.specialDue()) || aiming) this.begin(w, 'rush', { bell: i });
    } else this.echoPending = true;
  }
  private tickBells(w: World, dt: number): void {
    for (const b of this.bells) {
      b.cooldown = Math.max(0, b.cooldown - dt);
      b.pulse = Math.max(0, b.pulse - dt * 1.4);
    }
    this.lureLock = Math.max(0, this.lureLock - dt);
    this.soundLife -= dt;
    if (this.soundLife <= 0) this.pendingBell = -1;
    if (!this.loose || this.echoes.isCalling(2)) return;
    const b = this.bells[2];
    const v = (this.phase === 2 ? 1.9 : 2.5) * this.rollSign;
    b.x += v * dt;
    b.roll -= (v * dt) / 0.81;
    if (Math.abs(b.x) >= 5.6) {
      b.x = this.rollSign * 5.6;
      this.rollSign *= -1;
      this.sound(w, 2, false);
    }
  }
  override get invulnerable(): boolean {
    return this.motion === 'intro' || this.motion === 'shift' || this.motion === 'dying';
  }
  override get inWindow(): boolean {
    return this.motion === 'exposed';
  }
  private setMotion(motion: Motion, duration: number): void {
    this.motion = motion;
    if (motion !== 'exposed') this.opening = null;
    this.elapsed = 0;
    this.duration = duration;
    this.vx = this.vz = 0;
    this.armor = motion === 'exposed' || motion === 'recover' ? 0 : HUNT.shellArmor;
    this.shieldMul = motion === 'exposed' ? HUNT.throat : 1;
    this.setState(motion === 'aim' ? 'telegraph' : motion === 'active' ? 'attack' : 'idle');
  }
  stagePose(clip: string): void {
    this.sceneClip = clip;
    this.sceneAge = 0;
  }
  beginHunt(delay = 0.9): void {
    this.inScene = false;
    this.y = 0;
    this.woundT = 0;
    this.turn = 0;
    this.guardHits = 0;
    this.guardCooldown = 0;
    this.specialCount = 0;
    this.lureLock = 0;
    this.pendingBell = -1;
    this.echoPending = false;
    this.second = false;
    this.setMotion('hunt', delay);
  }
  private begin(w: World, attack: Attack, { bell = -1, follow = false, ambient = false, mark }: AttackOptions = {}): void {
    this.cancelTelegraph();
    if (this.jaw) { this.jaw.alive = false; this.jaw = null; }
    this.attack = attack;
    this.lastAttack = attack;
    this.bellTarget = bell;
    this.second = follow;
    this.lured = bell >= 0 && !ambient;
    if (bell >= 0) {
      this.pendingBell = -1;
      this.echoPending = false;
    }
    this.left = !this.left;
    const target = bell >= 0 ? this.bells[bell] : (mark ?? w.hero);
    let dx = target.x - this.x,
      dz = target.z - this.z;
    if (!mark && bell < 0 && ((follow && attack === 'rush') || (attack === 'pounce' && this.phase >= 2))) {
      // Commit to the projected footfall once. The complete lane stays fixed during the wind-up.
      const h = w.hero, speed = Math.hypot(h.vx, h.vz);
      const lead = Math.min(follow ? 0.46 : 0.3, 2.25 / Math.max(1, speed));
      dx += h.vx * lead;
      dz += h.vz * lead;
    }
    const dist = Math.hypot(dx, dz);
    if (dist > 0.01) {
      dx /= dist;
      dz /= dist;
    } else {
      dx = Math.sin(this.facing);
      dz = Math.cos(this.facing);
    }
    this.facing = Math.atan2(dx, dz);
    this.startX = this.x;
    this.startZ = this.z;
    if (attack === 'snap') {
      this.braceSnap(w, dx, dz, dist);
      return;
    }
    if (attack === 'listen' || attack === 'crosscall') {
      this.startSoundHunt(w, attack);
      return;
    }
    let len = attack === 'rush' && bell < 0 ? Math.max(4.3, dist + 1.5) : dist;
    // Keep the whole body on walkable tiles, including when the target is on the rim.
    if (!w.arena.walkable(this.x + dx * len, this.z + dz * len)) {
      let lo = 0,
        hi = len;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (w.arena.walkable(this.x + dx * mid, this.z + dz * mid)) lo = mid;
        else hi = mid;
      }
      len = lo;
    }
    const end = { x: this.x + dx * len, z: this.z + dz * len };
    this.targetX = end.x;
    this.targetZ = end.z;
    dx = end.x - this.x;
    dz = end.z - this.z;
    len = Math.hypot(dx, dz);
    if (len > 0.02 && attack === 'rush') this.facing = Math.atan2(dx, dz);
    const wind = (attack === 'rake' && follow ? 0.69 : HUNT.windup[this.phase - 1])
      + (attack === 'howl' ? 0.23 : attack === 'pounce' || attack === 'sweep' ? 0.14 : 0);
    this.setMotion('aim', wind);
    this.passed = false;
    const shape: Shape =
      attack === 'rush'
        ? {
            k: 'line',
            x: this.x,
            z: this.z,
            dx: Math.sin(this.facing),
            dz: Math.cos(this.facing),
            len: Math.max(0.3, len),
            w: 2.25,
          }
        : attack === 'sweep'
          ? { k: 'ring', x: this.x, z: this.z, r0: HUNT.tailInner, r1: HUNT.tailOuter }
        : attack === 'pounce'
          ? { k: 'circle', x: end.x, z: end.z, r: 2.85 }
          : attack === 'rake'
            ? { k: 'arc', x: this.x, z: this.z, r: 3.9, dir: this.facing, half: 1.4 }
            : { k: 'circle', x: this.x, z: this.z, r: 2.1 };
    // The leap lands after the flight. Keep its marker until contact.
    this.tele = w.addTelegraph(shape, wind + (attack === 'pounce' ? 0.58 : 0));
    if (attack === 'sweep') this.jaw = w.addTelegraph({ k: 'arc', x: this.x, z: this.z,
      r: HUNT.tailInner, dir: this.facing, half: HUNT.jawHalf }, wind);
    this.lastTeleDur = wind;
    w.bus.emit('telegraph', {
      kind: attack === 'rake' ? 'whistle' : attack === 'rush' ? 'hum' : 'roar',
      x: this.x,
      z: this.z,
    });
  }
  private braceSnap(w: World, dx: number, dz: number, dist: number): void {
    this.guardHits = 0;
    this.guardCooldown = 4.3;
    this.riposte = false;
    this.passed = false;
    w.arena.move(this.x, this.z, -dx * 1.65, -dz * 1.65, this.radius, this.recoilAt);
    const end = { x: this.x, z: this.z };
    const reach = clamp(dist + 1.4, 3.65, 6.4);
    w.arena.move(this.x, this.z, dx * reach, dz * reach, this.radius, end);
    this.targetX = end.x;
    this.targetZ = end.z;
    const lx = end.x - this.recoilAt.x, lz = end.z - this.recoilAt.z;
    const length = Math.hypot(lx, lz) || 0.1;
    this.facing = Math.atan2(lx, lz);
    this.setMotion('aim', 0.79);
    this.lastTeleDur = this.duration;
    this.tele = w.addTelegraph({
      k: 'line', x: this.recoilAt.x, z: this.recoilAt.z, dx: lx / length, dz: lz / length, len: length + 0.65, w: 2.75,
    }, this.duration);
    w.bus.emit('telegraph', { kind: 'roar', x: this.x, z: this.z });
  }

  private startSoundHunt(w: World, attack: 'listen' | 'crosscall'): void {
    this.sampleIndex = 0;
    this.heard = false;
    this.lastNoise = -1;
    this.answered = false;
    this.setMotion('aim', attack === 'listen' ? 2.13 : 2.45);
    this.lastTeleDur = this.duration;
    if (attack === 'crosscall') {
      let nearest = Infinity;
      for (const [i, bell] of this.bells.entries()) {
        const distance = Math.hypot(w.hero.x - bell.x, w.hero.z - bell.z);
        if (distance < nearest) {
          nearest = distance;
          this.callSide = i;
        }
      }
      this.callBell(w, this.callSide);
    } else {
      w.bus.emit('sfx', { id: 'echo_pebble', x: this.x, z: this.z, gain: 0.8 });
      w.bus.emit('shockwave', { x: this.x, z: this.z, r: 4.5, color: 'gold', strength: 0.35 });
    }
  }

  private specialDue(): boolean {
    return this.phase >= 2 && this.turn % (this.phase === 2 ? 4 : 3) === 0;
  }
  private choose(w: World): void {
    if (this.specialDue()) {
      this.turn++;
      const cross = this.phase === 3 && this.specialCount % 2 === 0;
      this.specialCount++;
      this.begin(w, cross ? 'crosscall' : 'listen');
      return;
    }
    if (this.pendingBell >= 0 && this.lureLock <= 0) {
      this.begin(w, 'rush', { bell: this.pendingBell });
      return;
    }
    const d = Math.hypot(w.hero.x - this.x, w.hero.z - this.z);
    this.turn++;
    if (this.echoPending && this.turn % 4 === 0 && Math.hypot(this.x - this.bells[2].x, this.z - this.bells[2].z) >= HUNT.runUp) {
      // The loose bell keeps moving. The beast commits to where it heard the bounce.
      this.echoPending = false;
      this.begin(w, 'rush', { bell: 2, ambient: true });
      return;
    }
    const options: Attack[] = d < 4.6 ? ['rake', 'sweep', 'rush'] : d < 7.3 ? ['sweep', 'pounce', 'rush'] : ['pounce', 'rush'];
    if (this.phase >= 2) options.push('howl');
    const choices = options.filter((a) => a !== this.lastAttack);
    this.begin(w, this.turn === 1 ? 'rush' : w.rng.pick(choices));
  }
  private hit(w: World, shape: Shape, mult: number, kb = 4): boolean {
    return w.enemyStrike(this, shape, this.dmg * mult, kb) !== 'miss';
  }
  private impact(w: World, r: number): void {
    w.bus.emit('impact', { kind: 'slam', x: this.x, z: this.z, r });
    w.bus.emit('shake', { trauma: 0.25 });
  }
  private finishRush(w: World): void {
    const i = this.bellTarget;
    if (i >= 0 && Math.hypot(this.x - this.bells[i].x, this.z - this.bells[i].z) < 1.75) {
      this.bells[i].pulse = 1;
      this.impact(w, 2.8);
      w.bus.emit('sfx', { id: 'shatter_stone', x: this.x, z: this.z });
      if (!this.lured) {
        this.setMotion('recover', 0.85);
        return;
      }
      this.lastBell = i;
      this.expose(w, 'bell', HUNT.exposed[this.phase - 1]);
      this.second = false;
      const before = this.hp;
      this.hp = Math.max(1, this.hp - Math.round(this.maxHp * HUNT.crashFraction));
      this.checkThreshold();
      if (before !== this.hp) w.bus.emit('shockwave', { x: this.x, z: this.z, r: 3.1, color: 'gold', strength: 0.65 });
      return;
    }
    if (this.phase === 3 && !this.second) {
      this.begin(w, 'rush', { follow: true });
      return;
    }
    this.setMotion('recover', 0.9);
  }
  private expose(w: World, reason: Opening, duration: number): void {
    this.cancelTelegraph();
    this.setMotion('exposed', duration);
    this.opening = reason;
    this.exposedDamage = 0;
    this.guardHits = 0;
    this.pendingBell = -1;
    this.lureLock = HUNT.lureRecovery + duration;
    w.bus.emit('shockwave', { x: this.x, y: 1.6, z: this.z, r: 1.8, color: 'gold', strength: 0.34 });
  }

  private callBell(w: World, i: number): void {
    const b = this.bells[i];
    b.pulse = 1;
    const ray = this.echoes.call(w, i, b.x, b.z);
    this.callDX = ray.dx;
    this.callDZ = ray.dz;
  }

  private secondBell(w: World): number {
    let second = (this.callSide + 1) % this.bells.length, best = -1;
    for (const [i, b] of this.bells.entries()) {
      if (i === this.callSide) continue;
      const dx = w.hero.x - b.x, dz = w.hero.z - b.z;
      const cross = Math.abs(this.callDX * dz - this.callDZ * dx) / (Math.hypot(dx, dz) || 1);
      if (cross > best) { second = i; best = cross; }
    }
    return second;
  }

  private listenStep(w: World): void {
    // Three audible beats after the ear plates lift. Walking, weapon swings and casts leave a mark.
    if (this.sampleIndex >= 3 || this.elapsed < 0.65 + this.sampleIndex * 0.5) return;
    const h = w.hero;
    this.sampleIndex++;
    if (Math.hypot(h.vx, h.vz) > 1.3 || h.state === 'dash' || this.elapsed - this.lastNoise < 0.42) {
      this.heard = true;
      this.noiseAt.x = h.x;
      this.noiseAt.z = h.z;
      this.echoes.footprint(w, h.x, h.z, this.sampleIndex === 3);
    } else {
      w.bus.emit('sfx', { id: 'echo_pebble', x: this.x, z: this.z, gain: 0.30 });
      w.bus.emit('shockwave', { x: this.x, y: 1.1, z: this.z, r: 1.4, color: 'gold', strength: 0.16 });
    }
  }

  private release(w: World): void {
    const a = this.attack;
    if (a === 'listen') {
      if (this.heard) this.begin(w, 'pounce', { mark: this.noiseAt });
      else this.expose(w, 'silence', 1.65);
      return;
    }
    if (a === 'crosscall') {
      if (this.answered) this.expose(w, 'return', 1.9);
      else this.begin(w, 'howl');
      return;
    }
    if (a === 'snap') {
      this.startX = this.x; this.startZ = this.z;
      this.setMotion('active', 0.34);
      w.bus.emit('sfx', { id: 'bite', x: this.x, z: this.z, gain: 0.95 });
      return;
    }
    this.setMotion(
      'active',
      a === 'rush'
        ? Math.max(0.18, Math.hypot(this.targetX - this.x, this.targetZ - this.z) / HUNT.rush[this.phase - 1])
        : a === 'pounce'
          ? 0.58
          : a === 'howl' && this.phase === 3 ? 1.16 : 0.32
    );
    if (a === 'sweep') {
      let result = w.enemyStrike(this, { k: 'ring', x: this.x, z: this.z, r0: HUNT.tailInner, r1: HUNT.tailOuter }, this.dmg * 1.02, 5);
      w.bus.emit('enemyAttack', { kind: 'slash', x: this.x, z: this.z, dir: this.facing + Math.PI, r: HUNT.tailOuter });
      const d = Math.hypot(w.hero.x - this.x, w.hero.z - this.z);
      if (result === 'miss' && this.jaw) result = w.enemyStrike(this, this.jaw.shape, this.dmg * 1.08, 5);
      this.tailCounter = d < HUNT.tailInner - w.hero.radius && (result === 'miss' || result === 'perfect');
      this.jaw = null;
      return;
    }
    if (a === 'rake') {
      this.hit(w, { k: 'arc', x: this.x, z: this.z, r: 3.9, dir: this.facing, half: 1.4 }, 0.74);
      w.bus.emit('enemyAttack', { kind: 'slash', x: this.x, z: this.z, dir: this.facing, r: 3.9 });
    }
    if (a === 'howl') {
      this.hit(w, { k: 'circle', x: this.x, z: this.z, r: 2.1 }, 0.54);
      this.howlWave(w, false);
      this.returnHowl = this.phase === 3;
      if (this.returnHowl) {
        const gaps = this.howlGaps(true);
        this.tele = w.addTelegraph({ k: 'ring', x: this.x, z: this.z, r0: 1.65, r1: 2.25, gaps }, 0.94);
      }
      w.bus.emit('sfx', { id: 'boss_roar', x: this.x, z: this.z, gain: 0.65 });
    }
  }
  private howlGaps(returning: boolean): { a: number; w: number }[] {
    const gap = this.facing + (returning ? 0 : Math.PI / 2);
    return [{ a: gap, w: 1.35 }, { a: gap + Math.PI, w: 1.35 }];
  }

  private howlWave(w: World, returning: boolean): void {
    w.addRingWave(this.x, this.z, returning ? 7.1 : 5.8, 0.67, 17,
      this.howlGaps(returning), this.dmg * (returning ? 0.78 : 0.64), this.id);
  }

  protected think(w: World, dt: number): void {
    this.vx = this.vz = 0;
    if (this.invulnerable || w.hero.dead) return;
    this.tickBells(w, dt);
    this.echoes.step(w, this, dt);
    this.guardCooldown -= dt;
    this.guardAge += dt;
    if (this.guardAge > 2.1) this.guardHits = 0;
    if ((this.motion === 'hunt' || this.motion === 'recover') && this.guardHits >= 3 &&
      !this.specialDue() && Math.hypot(w.hero.x - this.x, w.hero.z - this.z) < 4.9) {
      this.begin(w, 'snap');
    }
    this.elapsed += dt;
    const u = Math.min(1, this.elapsed / this.duration);
    switch (this.motion) {
      case 'hunt': {
        const dx = w.hero.x - this.x,
          dz = w.hero.z - this.z,
          d = Math.hypot(dx, dz);
        if (d > 0.01) this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 0.17, dt);
        if (d > 3.4) {
          this.vx = Math.sin(this.facing) * this.speed;
          this.vz = Math.cos(this.facing) * this.speed;
        }
        if (u >= 1) this.choose(w);
        break;
      }
      case 'aim':
        if (this.attack === 'snap') {
          const retreat = Math.min(1, u * 1.8);
          this.x = this.startX + (this.recoilAt.x - this.startX) * retreat;
          this.z = this.startZ + (this.recoilAt.z - this.startZ) * retreat;
        }
        if (this.attack === 'listen') this.listenStep(w);
        if (this.attack === 'crosscall' && this.elapsed >= 0.88 && this.sampleIndex === 0) {
          this.sampleIndex++;
          this.callBell(w, this.secondBell(w));
        }
        if (u >= 1) this.release(w);
        break;
      case 'active': {
        if (this.attack === 'howl' && this.returnHowl && this.elapsed >= 0.94) {
          this.returnHowl = false;
          this.howlWave(w, true);
          w.bus.emit('sfx', { id: 'boss_roar', x: this.x, z: this.z, gain: 0.56 });
        }
        if (this.attack === 'rush' || this.attack === 'pounce' || this.attack === 'snap') {
          const prevX = this.x,
            prevZ = this.z;
          this.x = this.startX + (this.targetX - this.startX) * u;
          this.z = this.startZ + (this.targetZ - this.startZ) * u;
          if (this.attack !== 'pounce') {
            const snap = this.attack === 'snap';
            const dx = this.x - prevX, dz = this.z - prevZ, l = Math.hypot(dx, dz);
            if (!this.passed && l > 0) {
              const result = w.enemyStrike(this, { k: 'line', x: prevX, z: prevZ, dx: dx / l, dz: dz / l,
                len: l + (snap ? 0.65 : 0.35), w: snap ? 2.75 : 2.25 }, this.dmg * (snap ? 1.35 : 0.9), snap ? 8 : 6);
              this.passed = result !== 'miss';
              if (snap && result === 'perfect') this.riposte = true;
            }
            if (u >= 1) {
              if (!snap) this.finishRush(w);
              else if (this.riposte) this.expose(w, 'riposte', 1.52);
              else this.setMotion('recover', 0.54);
            }
          } else {
            this.y = Math.sin(Math.PI * u) * 2.3;
            if (u >= 1) {
              this.y = 0;
              this.hit(w, { k: 'circle', x: this.x, z: this.z, r: 2.85 }, 1.12, 6);
              this.impact(w, 2.85);
              this.setMotion('recover', 1.15);
            }
          }
        } else if (u >= 1) {
          if (this.attack === 'sweep' && this.tailCounter) this.expose(w, 'shoulder', 1.24);
          else if (this.attack === 'rake' && this.phase >= 2 && !this.second) this.begin(w, 'rake', { follow: true });
          else this.setMotion('recover', this.attack === 'howl' ? 0.84 : 0.57);
        }
        break;
      }
      case 'exposed':
        if (u >= 1 || this.exposedDamage >= this.maxHp * (this.opening === 'bell' || this.opening === 'return' ? 0.135 : 0.085)) {
          if (Math.hypot(w.hero.x - this.x, w.hero.z - this.z) < 5.2) this.begin(w, 'rake');
          else this.setMotion('recover', 0.43);
        }
        break;
      case 'recover':
        if (u >= 1) this.setMotion('hunt', w.rng.range(0.36, 0.72) - (this.phase - 1) * 0.065);
        break;
    }
  }
  private checkThreshold(): void {
    const threshold = this.phase === 1 ? HUNT.phase2 : this.phase === 2 ? HUNT.phase3 : 0;
    if (this.hp <= this.maxHp * threshold && threshold > 0) {
      this.hp = Math.ceil(this.maxHp * threshold);
      this.enterScene('shift');
    }
  }
  enterScene(motion: 'shift' | 'dying'): void {
    this.cancelTelegraph();
    this.echoes.clear();
    if (this.jaw) { this.jaw.alive = false; this.jaw = null; }
    this.y = 0;
    this.woundT = 0;
    this.inScene = true;
    this.setMotion(motion, 1);
    this.stagePose(motion === 'dying' ? 'fall' : 'roar');
  }
  override onBladeHit(w: World, p: StrikeParams): void {
    if (this.invulnerable || this.inWindow || this.guardCooldown > 0 || p.abilityId || Math.hypot(w.hero.x - this.x, w.hero.z - this.z) > 4.6) return;
    this.guardAge = 0;
    if (this.guardHits === 2 && this.armor === HUNT.shellArmor) {
      w.bus.emit('sfx', { id: 'hit_armor', x: this.x, z: this.z, gain: 0.8 });
    }
    this.guardHits = Math.min(3, this.guardHits + 1);
  }

  override preHit(_w: World, p: StrikeParams): boolean {
    // Plates cover the head and chest. The back stays reachable during a committed attack.
    const incoming = Math.hypot(p.dirX, p.dirZ);
    const rear = incoming > 0 && (Math.sin(this.facing) * p.dirX + Math.cos(this.facing) * p.dirZ) / incoming > 0.42;
    if (this.inWindow) this.armor = 0;
    else if (this.motion === 'recover') this.armor = rear ? 30 : 130;
    else this.armor = rear ? 105 : HUNT.shellArmor;
    return false;
  }

  override onDamaged(_w: World, dmg: number): void {
    if (this.inWindow) {
      this.exposedDamage += dmg;
      this.wounds++;
      this.woundT = 0.37;
    }
    this.checkThreshold();
  }
  override onLethal(): boolean {
    if (this.damageReleased) return true;
    if (!this.invulnerable) this.enterScene('dying');
    return false;
  }
  finish(w: World): void {
    this.damageReleased = true;
    w.killEnemy(this, 0, -1, 4.5);
  }
  protected animate(dt: number): void {
    const p = this.puppet,
      s = p.skel;
    this.sceneAge += dt;
    this.woundT = Math.max(0, this.woundT - dt);
    const u = clamp(this.elapsed / this.duration, 0, 1);
    let id = 'listen',
      sample = (this.time * 0.64) % 1;
    if (this.invulnerable) {
      id = this.sceneClip;
      sample = id === 'listen' ? (this.sceneAge * 0.7) % 1 : Math.min(1, this.sceneAge / (id === 'fall' ? 1.55 : 0.8));
    } else if (this.motion === 'exposed') {
      id = this.woundT > 0 ? (this.wounds % 2 ? 'woundL' : 'woundR') : 'crash';
      sample = this.woundT > 0 ? 1 - this.woundT / 0.37 : Math.min(1, this.elapsed / 0.64);
    } else if (this.motion === 'hunt' && Math.hypot(this.vx, this.vz) > 0.2) {
      id = 'stalk';
      sample = (this.time * 1.45) % 1;
    } else if (this.motion === 'recover') {
      id = 'rise';
      sample = this.elapsed < 0.65 && this.lureLock > HUNT.lureRecovery - 0.8 ? u : 1;
    } else if (this.motion === 'aim' || this.motion === 'active') {
      const aim = this.motion === 'aim';
      if (this.attack === 'snap') {
        id = 'snap';
        sample = aim ? u * 0.7 : 0.7 + u * 0.3;
      } else if (this.attack === 'listen') {
        id = 'soundHunt';
        sample = u;
      } else if (this.attack === 'crosscall') {
        id = 'groundCall';
        sample = u;
      } else if (this.attack === 'sweep') {
        id = 'tailSweep';
        sample = aim ? u * 0.77 : 0.77 + u * 0.23;
      } else if (this.attack === 'rake') {
        id = this.left ? 'rakeL' : 'rakeR';
        sample = aim ? u * 0.81 : 0.81 + u * 0.19;
      } else if (this.attack === 'howl') {
        id = 'roar';
        sample = aim ? u * 0.73 : 0.73 + u * 0.27;
      } else {
        id = aim ? 'brace' : this.attack === 'pounce' ? 'bound' : 'gallop';
        sample = !aim && id === 'gallop' ? (this.elapsed * 3.2) % 1 : u;
      }
    }
    s.resetPose();
    p.clips.get(id)!.sample(sample, s.rot, this.rootMotion);
    s.off[1] = this.rootMotion.y + 0.025 * Math.sin(this.time * 3.4);
    s.x = this.x;
    s.y = this.y;
    s.z = this.z;
    s.facing = this.facing;
    if (this.attack === 'sweep' && this.motion === 'active')
      s.facing += Math.PI * 2 * (u * u * (3 - 2 * u));
    p.boost = this.inWindow ? 0.65 + 0.22 * Math.sin(this.time * 8) : this.motion === 'aim' ? 0.27 * u : 0.07;
    s.update();
  }
}
registerEnemy('devourer', Devourer);
