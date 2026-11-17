import { DEVOURER_CLIPS } from '../../anim/clips/devourer';
import { layoutOf } from '../../anim/puppet';
import { clamp, dampAngle } from '../../core/math';
import { ENEMIES } from '../../data/enemies';
import { DEVOURER_RIG } from '../../gen/chars/devourer';
import { overlaps, type Shape } from '../combat';
import { Enemy, type SpawnOpts } from '../enemy';
import { registerEnemy } from '../enemies/factory';
import type { World } from '../world';

import { BELL_STANDS } from '../../data/echoBells';
export const HUNT = {
  phase2: 0.63,
  phase3: 0.29,
  bellCooldown: 10,
  lureRecovery: 6.2,
  exposed: [2.65, 2.4, 2.15],
  windup: [1.06, 0.92, 0.8],
  rush: [13.5, 15, 16.5],
  shellArmor: 39,
  throat: 2.35,
  crashFraction: 0.04,
  execute: 0.065,
};
type Motion = 'intro' | 'hunt' | 'aim' | 'active' | 'exposed' | 'recover' | 'shift' | 'dying';
type Attack = 'rush' | 'rake' | 'pounce' | 'howl';
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
  private pendingBell = -1;
  private echoPending = false;
  private lured = false;
  private rollSign = 1;
  private lureLock = 0;
  private passed = false;
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
    for (const bell of this.bells)
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
            bell.cooldown <= 0 &&
            Math.hypot(w.hero.x - bell.x, w.hero.z - bell.z) < 3.1
          );
        },
      });
    w.bus.on('bladeSweep', ({ shape, hitList }) => {
      if (this.dead || this.invulnerable || w.hero.dead || w.hero.locked) return;
      for (let i = 0; i < this.bells.length; i++) {
        const b = this.bells[i],
          id = -10 - i;
        if (hitList.has(id) || b.cooldown > 0 || !overlaps(shape, b.x, b.z, 0.86)) continue;
        hitList.add(id);
        this.sound(w, i, true);
        break;
      }
    });
  }
  private sound(w: World, i: number, blade: boolean): void {
    const b = this.bells[i];
    b.pulse = 1;
    w.bus.emit('bellPulse', { x: b.x, y: i === 2 && this.phase > 1 ? 0.78 : 1.45, z: b.z, big: blade });
    w.bus.emit('sfx', { id: blade ? 'boss_bell' : 'tele_bell', x: b.x, z: b.z, gain: blade ? 0.85 : 0.48 });
    if (blade) {
      b.cooldown = HUNT.bellCooldown;
      this.pendingBell = i;
      if (this.motion === 'hunt' && this.lureLock <= 0) this.begin(w, 'rush', i);
      else if (this.motion === 'aim' && this.attack === 'rush' && this.bellTarget < 0 && this.lureLock <= 0)
        this.begin(w, 'rush', i);
    } else this.echoPending = true;
  }
  private tickBells(w: World, dt: number): void {
    for (const b of this.bells) {
      b.cooldown = Math.max(0, b.cooldown - dt);
      b.pulse = Math.max(0, b.pulse - dt * 1.4);
    }
    this.lureLock = Math.max(0, this.lureLock - dt);
    if (!this.loose) return;
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
    this.pendingBell = -1;
    this.echoPending = false;
    this.second = false;
    this.setMotion('hunt', delay);
  }
  private begin(w: World, attack: Attack, bell = -1, follow = false, ambient = false): void {
    this.cancelTelegraph();
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
    const target = bell >= 0 ? this.bells[bell] : w.hero;
    let dx = target.x - this.x,
      dz = target.z - this.z;
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
    const wind = HUNT.windup[this.phase - 1] + (attack === 'howl' ? 0.23 : attack === 'pounce' ? 0.14 : 0);
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
        : attack === 'pounce'
          ? { k: 'circle', x: end.x, z: end.z, r: 2.65 }
          : attack === 'rake'
            ? { k: 'arc', x: this.x, z: this.z, r: 3.9, dir: this.facing, half: 1.4 }
            : { k: 'circle', x: this.x, z: this.z, r: 2.1 };
    // The leap lands after the flight. Keep its marker until contact.
    this.tele = w.addTelegraph(shape, wind + (attack === 'pounce' ? 0.58 : 0));
    this.lastTeleDur = wind;
    w.bus.emit('telegraph', {
      kind: attack === 'rake' ? 'whistle' : attack === 'rush' ? 'hum' : 'roar',
      x: this.x,
      z: this.z,
    });
  }
  private choose(w: World): void {
    if (this.pendingBell >= 0 && this.lureLock <= 0) {
      this.begin(w, 'rush', this.pendingBell);
      return;
    }
    const d = Math.hypot(w.hero.x - this.x, w.hero.z - this.z);
    this.turn++;
    if (this.echoPending && this.turn % 2 === 0) {
      // The loose bell keeps moving. The beast commits to where it heard the bounce.
      this.echoPending = false;
      this.begin(w, 'rush', 2, false, true);
      return;
    }
    const options: Attack[] = d < 4.6 ? ['rake', 'rush'] : ['pounce', 'rush'];
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
      this.setMotion('exposed', HUNT.exposed[this.phase - 1]);
      this.lureLock = HUNT.lureRecovery;
      this.lureLock += this.duration;
      this.second = false;
      const before = this.hp;
      this.hp = Math.max(1, this.hp - Math.round(this.maxHp * HUNT.crashFraction));
      this.checkThreshold();
      if (before !== this.hp) w.bus.emit('shockwave', { x: this.x, z: this.z, r: 3.1, color: 'gold', strength: 0.65 });
      return;
    }
    if (this.phase === 3 && !this.second) {
      this.begin(w, 'rush', -1, true);
      return;
    }
    this.setMotion('recover', 0.9);
  }
  private release(w: World): void {
    const a = this.attack;
    this.setMotion(
      'active',
      a === 'rush'
        ? Math.max(0.18, Math.hypot(this.targetX - this.x, this.targetZ - this.z) / HUNT.rush[this.phase - 1])
        : a === 'pounce'
          ? 0.58
          : 0.32
    );
    if (a === 'rake') {
      this.hit(w, { k: 'arc', x: this.x, z: this.z, r: 3.9, dir: this.facing, half: 1.4 }, 0.74);
      w.bus.emit('enemyAttack', { kind: 'slash', x: this.x, z: this.z, dir: this.facing, r: 3.9 });
    }
    if (a === 'howl') {
      this.hit(w, { k: 'circle', x: this.x, z: this.z, r: 2.1 }, 0.54);
      const gap = this.facing + Math.PI / 2;
      w.addRingWave(
        this.x,
        this.z,
        5.8,
        0.67,
        15,
        [
          { a: gap, w: 1.25 },
          { a: gap + Math.PI, w: 1.25 },
        ],
        this.dmg * 0.57,
        this.id
      );
      w.bus.emit('sfx', { id: 'boss_roar', x: this.x, z: this.z, gain: 0.65 });
    }
  }
  protected think(w: World, dt: number): void {
    this.vx = this.vz = 0;
    if (this.invulnerable || w.hero.dead) return;
    this.tickBells(w, dt);
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
        if (u >= 1) this.release(w);
        break;
      case 'active': {
        if (this.attack === 'rush' || this.attack === 'pounce') {
          const prevX = this.x,
            prevZ = this.z;
          this.x = this.startX + (this.targetX - this.startX) * u;
          this.z = this.startZ + (this.targetZ - this.startZ) * u;
          if (this.attack === 'rush') {
            const dx = this.x - prevX,
              dz = this.z - prevZ,
              l = Math.hypot(dx, dz);
            if (!this.passed && l > 0)
              this.passed = this.hit(
                w,
                { k: 'line', x: prevX, z: prevZ, dx: dx / l, dz: dz / l, len: l + 0.35, w: 2.25 },
                0.9,
                6
              );
            if (u >= 1) this.finishRush(w);
          } else {
            this.y = Math.sin(Math.PI * u) * 2.3;
            if (u >= 1) {
              this.y = 0;
              this.hit(w, { k: 'circle', x: this.x, z: this.z, r: 2.65 }, 1.02, 6);
              this.impact(w, 2.65);
              this.setMotion('recover', 1.15);
            }
          }
        } else if (u >= 1) this.setMotion('recover', this.attack === 'howl' ? 1.1 : 0.78);
        break;
      }
      case 'exposed':
        if (u >= 1) this.setMotion('recover', 0.62);
        break;
      case 'recover':
        if (u >= 1) this.setMotion('hunt', w.rng.range(0.62, 1.08) - (this.phase - 1) * 0.12);
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
    this.y = 0;
    this.woundT = 0;
    this.inScene = true;
    this.setMotion(motion, 1);
    this.stagePose(motion === 'dying' ? 'fall' : 'roar');
  }
  override onDamaged(): void {
    if (this.inWindow) {
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
      if (this.attack === 'rake') {
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
    p.boost = this.inWindow ? 0.65 + 0.22 * Math.sin(this.time * 8) : this.motion === 'aim' ? 0.27 * u : 0.07;
    s.update();
  }
}
registerEnemy('devourer', Devourer);
