import * as THREE from 'three';
import { angleOf, clamp, dampAngle, len2 } from '../core/math';
import { Ease } from '../core/ease';
import { PLAYER_BASE, RESONANCE } from '../data/player';
import { AIM, VOID_BLADE, type MoveDef, type WeaponDef } from '../data/weapons';
import type { Input } from '../input/input';
import type { Actor } from './actor';
import type { Shape } from './combat';
import type { Enemy } from './enemy';
import { HeroAvatar } from './heroAvatar';
import { RANK_S_CLIPS } from '../anim/clips/hero';
import { baseStats, type HeroStats } from './heroStats';
import type { World } from './world';

export type HeroState = 'move' | 'attack' | 'charge' | 'charged' | 'dash' | 'cast' | 'dead' | 'fall' | 'victory' | 'frozen';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/**
 * Пилот: стейт-машина атаки (Tech §15.2), комбо из клипов-поз, рывок с зарядами, заряженный удар,
 * идеальное уклонение, автоприцел с магнетизмом; Раскол треснувших врагов финишером (GDD §4–§5).
 * Время героя — своё: в «Мгновении Пустоты» он замедлен меньше мира.
 */
export class Hero implements Actor {
  readonly id = 0;
  readonly faction = 'hero' as const;
  x = 0; z = 0; y = 0;
  vx = 0; vz = 0;
  radius: number = PLAYER_BASE.radius;
  mass = 1;
  facing = 0;
  hp: number = PLAYER_BASE.hp; maxHp: number = PLAYER_BASE.hp;
  armor = 0;
  dead = false;
  stun = null;
  kbX = 0; kbZ = 0;
  height = 2.1;

  stats: HeroStats = baseStats();
  weapon: WeaponDef = VOID_BLADE;
  readonly avatar = new HeroAvatar();

  clock = 0;
  state: HeroState = 'move';
  stateT = 0;
  // атака
  move: MoveDef | null = null;
  private lastMove: MoveDef | null = null;
  private lastMoveStart = -99;
  private hitActive = false;
  private hitList = new Set<number>();
  private lungeLeft = 0;
  private lungeDirX = 0; private lungeDirZ = 0;
  private chargedMul = 0; private chargedStun = 0; private chargedWide = 1;
  chargeLevel = 0;
  // рывок
  dashCharges = 2;
  private dashRecharge = 0;
  private dashDirX = 0; private dashDirZ = 1;
  private dashPrevE = 0;
  dashStart = -99;
  /** Где начался рывок: там остаётся силуэт для идеального уклонения. */
  dashFromX = 0; dashFromZ = 0;
  private lastDashEnd = -99;
  private coyote = 0;
  // защита
  invulnUntil = 0;
  blinkUntil = 0;
  shieldUntil = 0;
  // ресурсы
  resonance = 0;
  perfectReadyAt = 0;
  perfectBuff = false;
  /** До этого момента атака превращается в Контрудар (после идеального уклонения). */
  counterUntil = 0;
  /** До этого момента удержание атаки даёт мгновенный полный заряд (после идеального уклонения). */
  instantChargeUntil = 0;
  private instantCharge = false;
  secondWindUsed = false;
  eclipseUntil = 0;
  // падение в бездну
  safeX = 0; safeZ = 0;
  private safeTimer = 0;
  // для походки
  private lastX = 0; private lastZ = 0;
  private lastSpeed = 0;
  /** Каст способностей: колбэк на событие клипа release. */
  castRelease: (() => void) | null = null;
  castMinT = 0;
  /** Цель автоприцела (для UI и способностей). */
  target: Enemy | null = null;
  /** Внешний запрет управления (появление босса, кат-сцены). */
  locked = false;
  trailOn = false;
  /** Рывок-скольжение по трещине (план §6.2). */
  sliding = false;
  /** Отмены (план §6.4): удар попал и прошёл hitOff — можно в Q/E; каст отпустил способность — можно в удар. */
  private moveLanded = false;
  private hitOffSeen = false;
  private castReleased = false;
  private slideHits = new Set<number>();

  constructor(private world: World) {
    this.avatar.puppet.anim.onEvent = (n) => this.onClipEvent(n);
  }

  applyStats(s: HeroStats): void {
    this.stats = s;
    const frac = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.maxHp = s.maxHp;
    this.hp = Math.min(this.maxHp, Math.max(1, Math.round(this.maxHp * frac)));
    this.armor = s.armor;
    this.dashCharges = Math.min(this.dashCharges, s.dashCharges);
  }

  spawn(x: number, z: number, facing = Math.PI): void {
    this.x = x; this.z = z; this.lastX = x; this.lastZ = z; this.safeX = x; this.safeZ = z;
    this.facing = facing; this.vx = this.vz = 0;
    this.hp = this.maxHp; this.dead = false;
    this.state = 'move'; this.stateT = 0; this.move = null; this.lastMove = null;
    this.dashCharges = this.stats.dashCharges;
    this.resonance = this.stats.startResonance;
    this.secondWindUsed = false; this.eclipseUntil = 0; this.perfectBuff = false;
    this.avatar.puppet.skel.revive();
    this.avatar.puppet.anim.stop(0);
    this.avatar.puppet.dissolve = 0;
    this.avatar.resetCloth();
    this.avatar.update(0, x, 0, facing, 0, 0, 0, true);
  }

  get invulnerable(): boolean { return this.clock < this.invulnUntil || this.state === 'dead'; }
  get dashIframes(): boolean { return this.state === 'dash' && this.clock - this.dashStart <= PLAYER_BASE.dashIframes; }
  get eclipse(): boolean { return this.clock < this.eclipseUntil; }
  get alive(): boolean { return !this.dead; }

  addResonance(v: number): void {
    if (this.eclipse) return;
    const before = this.resonance;
    this.resonance = clamp(this.resonance + v * (v > 0 ? 1 + this.stats.resGain : 1), 0, RESONANCE.max);
    if (before < RESONANCE.max && this.resonance >= RESONANCE.max) this.world.bus.emit('resonanceFull', {});
  }

  // ------------------------------------------------------------------ обновление
  update(dt: number, input: Input): void {
    this.clock += dt;
    this.stateT += dt;
    const S = this.stats;
    if (this.dead) {
      // поражение (план §8.8): осколки Пилота разлетаются и растворяются в Пустоте
      this.avatar.puppet.skel.stepDebris(dt);
      if (this.stateT > 0.6) this.avatar.puppet.dissolve = Math.min(1, this.avatar.puppet.dissolve + dt * 0.7);
      this.animate(dt, 0, 0);
      return;
    }

    // перезарядка рывка: по одному заряду
    if (this.dashCharges < S.dashCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= S.dashRecharge) { this.dashRecharge = 0; this.dashCharges++; }
    } else this.dashRecharge = 0;

    const mvx = this.locked ? 0 : input.moveX, mvz = this.locked ? 0 : input.moveZ;
    const hasStick = len2(mvx, mvz) > 0.2;
    this.target = this.pickTarget(hasStick ? mvx : 0, hasStick ? mvz : 0, hasStick);

    if (!this.locked) this.handleInput(input, mvx, mvz, hasStick);

    switch (this.state) {
      case 'move': this.updateMove(dt, mvx, mvz, S.speed); break;
      case 'charge': {
        this.updateMove(dt, mvx, mvz, S.speed * 0.4, true);
        const held = input.now - input.attackHeldSince;
        const lvl = this.instantCharge || held >= this.weapon.charged.fullHold ? 2 : held >= this.weapon.charged.minHold ? 1 : 0;
        if (lvl > this.chargeLevel) { this.chargeLevel = lvl; this.world.bus.emit('chargeReady', { level: lvl }); }
        // ручное наведение: стик/мышь
        const ax = input.aimActive ? input.aimX : mvx, az = input.aimActive ? input.aimZ : mvz;
        if (len2(ax, az) > 0.2) this.facing = dampAngle(this.facing, angleOf(ax, az), 0.05, dt);
        else if (this.target) this.facing = dampAngle(this.facing, angleOf(this.target.x - this.x, this.target.z - this.z), 0.08, dt);
        if (!input.attackHeld) this.releaseCharge();
        break;
      }
      case 'attack': case 'charged':
        this.updateAttack(dt);
        break;
      case 'dash': this.updateDash(dt); break;
      case 'cast':
        this.updateMove(dt, mvx * 0.3, mvz * 0.3, S.speed, true);
        if (this.avatar.puppet.anim.done) this.toMove();
        break;
      case 'fall': this.updateFall(dt); break;
      case 'victory': case 'frozen':
        this.vx *= 0.8; this.vz *= 0.8;
        break;
    }

    // отбрасывание
    if (this.kbX || this.kbZ) {
      const o = { x: this.x, z: this.z };
      this.world.arena.move(this.x, this.z, this.kbX * dt, this.kbZ * dt, this.radius, o);
      this.x = o.x; this.z = o.z;
      const k = Math.exp(-dt * 10);
      this.kbX *= k; this.kbZ *= k;
      if (Math.abs(this.kbX) + Math.abs(this.kbZ) < 0.05) this.kbX = this.kbZ = 0;
    }

    this.checkGround(dt);
    if (this.hitActive) this.performHit();

    const dist = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
    const speed = dt > 0 ? dist / dt : 0;
    const accel = dt > 0 ? (speed - this.lastSpeed) / dt : 0;
    this.lastSpeed = speed;
    this.lastX = this.x; this.lastZ = this.z;
    this.animate(dt, this.state === 'move' || this.state === 'charge' ? dist : 0, this.state === 'move' ? speed : 0, accel);
  }

  private animate(dt: number, dist: number, speed: number, accel = 0): void {
    const a = this.avatar;
    a.ghostsOn = this.sceneGhosts || this.state === 'dash' || (this.state === 'charged' && this.stateT < 0.12) || (this.move?.id === 'lunge' && this.stateT < 0.12);
    a.stretch = this.state === 'dash' ? 1 + 0.35 * Math.sin(Math.min(1, this.stateT / PLAYER_BASE.dashTime) * Math.PI) : 1;
    a.bladeScale += ((this.eclipse ? 2 : this.bladeTarget) - a.bladeScale) * Math.min(1, dt * 12);
    a.glow = this.resonance / 100 * 1.2 + (this.eclipse ? 1.5 : 0) + (this.chargeLevel ? 0.6 * this.chargeLevel : 0) + this.glowBoost;
    a.lift = this.y;
    a.update(dt, this.x, this.z, this.facing, dist, speed, clamp(accel, -40, 40), this.state !== 'attack');
  }

  // ------------------------------------------------------------------ ввод
  private handleInput(input: Input, mvx: number, mvz: number, hasStick: boolean): void {
    const now = input.now, buf = input.buffer;
    const st = this.state;
    if (st === 'dead' || st === 'fall' || st === 'victory' || st === 'frozen') return;

    // рывок: из движения, заряда, после активных кадров удара или в первые 60 мс («спасительная отмена»)
    if (buf.peek('dash', now) && this.dashCharges >= 1) {
      const canCancel = st === 'move' || st === 'charge'
        || ((st === 'attack' || st === 'charged') && this.move && (this.stateT <= 0.06 || this.stateT >= this.move.dashCancelFrom / this.atkSpeed))
        || (st === 'cast' && this.stateT >= this.castMinT);
      if (canCancel) {
        const d = buf.consume('dash', now)!;
        let dx = d.dx, dz = d.dz;
        if (!dx && !dz) {
          if (hasStick) { dx = mvx; dz = mvz; }
          else if (input.aimActive && st !== 'move') { dx = input.aimX; dz = input.aimZ; }
          else { dx = Math.sin(this.facing); dz = Math.cos(this.facing); }
        }
        this.startDash(dx, dz);
        return;
      }
    }

    // способности
    for (const slot of ['q', 'e', 'r'] as const) {
      const cancel = st === 'attack' && this.move && (this.stateT >= this.move.dashCancelFrom / this.atkSpeed || (this.moveLanded && this.hitOffSeen));
      if ((st === 'move' || cancel) && buf.peek(slot, now)) {
        if (this.world.abilities.tryCast(slot, input)) { buf.consume(slot, now); return; }
      }
    }

    // атака
    if (buf.peek('attack', now)) {
      if (st === 'move') { buf.consume('attack', now); this.startAttack(input, mvx, mvz, hasStick); return; }
      // способность отпущена — каст отменяется в удар, клип плавно переходит в меч
      if (st === 'cast' && this.castReleased) { buf.consume('attack', now); this.startAttack(input, mvx, mvz, hasStick, 0.06); return; }
      if (st === 'attack' && this.move && this.stateT >= this.move.chain[0] / this.atkSpeed && !this.move.noChain) {
        buf.consume('attack', now); this.startAttack(input, mvx, mvz, hasStick); return;
      }
    }

    // удержание атаки → заряд
    if (input.attackHeld && now - input.attackHeldSince >= 0.22 && !buf.peek('attack', now)) {
      const after = st === 'move' || (st === 'attack' && this.move && this.stateT >= this.move.dashCancelFrom / this.atkSpeed);
      if (after) this.startCharge();
    }
    buf.consume('attackRelease', now);
  }

  private get atkSpeed(): number { return this.stats.atkSpeed * (this.eclipse ? 1.15 : 1); }

  // ------------------------------------------------------------------ движение
  private updateMove(dt: number, mvx: number, mvz: number, speed: number, keepFacing = false): void {
    const S = this.stats;
    const sp = speed * (this.eclipse ? 1.3 : 1);
    const tx = mvx * sp, tz = mvz * sp;
    const moving = len2(mvx, mvz) > 0.05;
    const tau = moving ? PLAYER_BASE.accelTime : PLAYER_BASE.stopTime;
    const k = 1 - Math.exp(-dt / (tau * 0.45));
    this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
    if (moving && !keepFacing) this.facing = dampAngle(this.facing, angleOf(mvx, mvz), PLAYER_BASE.turnTime * 0.5, dt);
    const o = { x: this.x, z: this.z };
    this.world.arena.move(this.x, this.z, this.vx * dt, this.vz * dt, this.radius, o);
    this.x = o.x; this.z = o.z;
    void S;
  }

  private toMove(): void {
    this.state = 'move'; this.stateT = 0;
    this.hitActive = false;
    this.chargeLevel = 0;
    if (this.trailOn) this.trailOn = false;
  }

  // ------------------------------------------------------------------ автоприцел (GDD §4.2)
  pickTarget(dx: number, dz: number, hasDir: boolean): Enemy | null {
    const aim = this.stats.autoAim;
    if (aim <= 0) return null;
    const R = (hasDir ? AIM.radius : AIM.radiusNoStick) * (0.7 + 0.3 * aim);
    const cosHalf = Math.cos(((AIM.cone * (0.75 + 0.25 * aim)) / 2) * (Math.PI / 180));
    let best: Enemy | null = null, bestScore = -Infinity;
    const l = Math.hypot(dx, dz) || 1;
    for (const e of this.world.enemies) {
      if (!e.targetable) continue;
      const ex = e.x - this.x, ez = e.z - this.z;
      const d = Math.hypot(ex, ez) - e.radius;
      if (d > R) continue;
      let align = 1;
      if (hasDir) {
        align = (ex * dx + ez * dz) / (Math.hypot(ex, ez) * l || 1);
        if (align < cosHalf && d > 1.2) continue;
      }
      const score = align * 2 - d / R - (e.hp / e.maxHp) * 0.3 + (e.elite.length || e.isBoss ? 0.4 : 0);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------------ атаки
  private startAttack(input: Input, mvx: number, mvz: number, hasStick: boolean, fade?: number): void {
    const W = this.weapon;
    let next: MoveDef;
    const since = this.clock - this.lastMoveStart;
    const prev = this.lastMove;
    // ветки комбо (GDD §5.2, расширено):
    //  удар×4 → «Нисходящий разлом»; рывок → Рассечение → Восходящий месяц → Звездопад;
    //  пауза после 2-го удара → Шквал → Крест; атака сразу после идеального уклонения → Контрудар
    if (this.clock < this.counterUntil && (this.state === 'move' || this.state === 'dash')) { next = W.counter; this.counterUntil = 0; }
    else if (this.clock - this.lastDashEnd <= 0.2 && this.state === 'move') next = W.lunge;
    else if (prev === W.combo[1] && since >= 0.4 && since <= 0.7 && this.state === 'move') next = W.flurry;
    else if (prev && since <= prev.chain[1] / this.atkSpeed && !prev.noChain) {
      if (prev === W.flurry) next = W.cross;
      else if (prev === W.lunge) next = W.rising;
      // воздушное комбо: подброшенная цель — Небесный разрез, затем Звездопад вбивает её в пол
      else if (prev === W.rising) next = this.target?.airborne ? W.skycut : W.skyfall;
      else if (prev === W.skycut) next = W.skyfall;
      else if (prev === W.counter) next = W.combo[2];
      else if (prev === W.combo[2]) next = W.combo[3];
      else next = W.combo[Math.min(3, W.combo.indexOf(prev) + 1)] ?? W.combo[0];
    } else next = W.combo[0];

    // направление: цель → стик → прицел мыши → взгляд
    let fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const t = this.target;
    if (t) { fx = t.x - this.x; fz = t.z - this.z; }
    else if (hasStick) { fx = mvx; fz = mvz; }
    else if (input.aimActive) { fx = input.aimX; fz = input.aimZ; }
    this.facing = angleOf(fx, fz);

    // Контрудар: мгновенно сквозь цель (за спину), разрез-вращение
    if (next.blink) {
      const tg = t ?? this.pickTarget(0, 0, false);
      if (tg) {
        const dx = tg.x - this.x, dz = tg.z - this.z, d = Math.hypot(dx, dz) || 1;
        const go = d + tg.radius + 0.9;
        const o = { x: this.x, z: this.z };
        this.world.bus.emit('dash', { x: this.x, z: this.z, dirX: dx / d, dirZ: dz / d });
        this.world.arena.move(this.x, this.z, (dx / d) * go, (dz / d) * go, this.radius, o);
        this.x = o.x; this.z = o.z;
        this.facing = angleOf(-dx, -dz);
        this.invulnUntil = Math.max(this.invulnUntil, this.clock + 0.3);
      }
      this.beginMove(next, 0, fade);
      return;
    }

    // магнетизм: подтягивание к цели на 0.6 м, если она в 2.5 м
    let lunge = next.lunge * 0.4;
    if (next.id === 'lunge' || next.id === 'skyfall') lunge = next.lunge;
    // Небесный разрез: прыжок к подброшенной цели
    else if (next.id === 'skycut' && t) lunge = clamp(Math.hypot(t.x - this.x, t.z - this.z) - t.radius - this.radius - 0.3, 0, next.lunge);
    else if (t) {
      const d = Math.hypot(t.x - this.x, t.z - this.z) - t.radius - this.radius - 0.35;
      if (d < AIM.magnetRange) lunge = clamp(d, 0, Math.max(AIM.magnetDist, next.lunge * 0.6));
      else lunge = next.lunge * 0.5;
    }
    this.beginMove(next, lunge, fade);
  }

  private beginMove(m: MoveDef, lunge: number, fade?: number): void {
    this.moveLanded = false; this.hitOffSeen = false;
    this.state = m === this.weapon.combo[3] || m.id === 'lunge' ? 'attack' : 'attack';
    this.stateT = 0;
    this.move = m;
    this.lastMove = m;
    this.lastMoveStart = this.clock;
    this.hitActive = false;
    this.hitList.clear();
    this.lungeLeft = lunge;
    this.lungeDirX = Math.sin(this.facing); this.lungeDirZ = Math.cos(this.facing);
    this.vx *= 0.2; this.vz *= 0.2;
    // ранг S: альтернативные финишеры (разворот, прыжок)
    const clip = this.world.rank.rankIdx >= 4 ? RANK_S_CLIPS[m.clip] ?? m.clip : m.clip;
    this.avatar.puppet.play(clip, this.atkSpeed, fade ?? (m.id === 'slash1' ? 0.04 : 0.03));
    this.world.bus.emit('swing', { kind: m.swing, hitAt: this.hitFrame(clip) / this.atkSpeed });
    // удар клинка отправляет украденные осколки в цель автоприцела
    this.world.fireStolen(this.target);
    this.world.bus.emit('moveStart', { id: m.id });
  }

  /** Кадр удара клипа: первое hitOn + полкадра быстрой фазы. */
  private hitFrame(clip: string): number {
    const c = this.avatar.puppet.clips.get(clip);
    return (c?.events.find((e) => e.name === 'hitOn')?.t ?? 0.05) + 0.025;
  }

  private updateAttack(dt: number): void {
    const m = this.move;
    if (!m) { this.toMove(); return; }
    // выпад: первые ~0.09 с удара
    if (this.lungeLeft > 0) {
      const step = Math.min(this.lungeLeft, (m.id === 'lunge' ? 30 : 9) * dt * (this.state === 'charged' ? 2.2 : 1));
      const o = { x: this.x, z: this.z };
      this.world.arena.move(this.x, this.z, this.lungeDirX * step, this.lungeDirZ * step, this.radius, o);
      this.x = o.x; this.z = o.z;
      this.lungeLeft -= step;
    }
    this.vx *= 0.7; this.vz *= 0.7;
    const dur = (m.dur / this.atkSpeed);
    if (this.stateT >= dur) {
      this.avatar.puppet.anim.stop(0.1);
      this.toMove();
      this.move = null;
    }
  }

  private onClipEvent(name: string): void {
    switch (name) {
      case 'hitOn':
        this.hitActive = true;
        if (this.move?.multi) this.hitList.clear();
        break;
      case 'hitOff': this.hitActive = false; this.hitOffSeen = true; break;
      case 'trailOn': this.trailOn = true; break;
      case 'trailOff': this.trailOn = false; break;
      case 'impact': {
        const m = this.move;
        // удар в землю: плащ взлетает и раскрывается
        this.avatar.cloakImpulse(3, 2.5);
        if (m?.wave) this.world.abilities.bladeWave(this.x, this.z, this.facing, m.wave.mult, m.wave.dist, m.wave.r);
        const r = m?.hitbox.shape === 'circle' ? m.hitbox.radius : 3;
        const off = 0.7;
        this.world.bus.emit('impact', { x: this.x + Math.sin(this.facing) * off, z: this.z + Math.cos(this.facing) * off, r, kind: 'rift' });
        // трещина на полу: Нисходящий разлом, Звездопад, полный заряд (план §6.2)
        if (m && (m.id === 'rift' || m.id === 'skyfall' || (this.state === 'charged' && m.wave))) {
          const len = m.hitbox.shape === 'line' ? m.hitbox.length : m.hitbox.shape === 'circle' ? m.hitbox.radius * 2 : 4.5;
          this.world.abilities.addFloorRift(this.x, this.z, this.facing, len);
          if (this.stats.tripleRift) for (const s of [-0.45, 0.45]) this.world.abilities.addFloorRift(this.x, this.z, this.facing + s, len * 0.8);
        }
        break;
      }
      case 'release': this.castRelease?.(); this.castRelease = null; this.castReleased = true; break;
      case 'stab': this.world.bus.emit('swing', { kind: 'stab' }); break;
      case 'swing2': this.world.bus.emit('swing', { kind: 'heavy' }); break;
    }
  }

  /** Хитбокс текущего удара в мире. */
  moveShape(m: MoveDef): Shape {
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const reach = this.eclipse ? 1.6 : 1;
    const h = m.hitbox;
    switch (h.shape) {
      case 'arc': return { k: 'arc', x: this.x, z: this.z, r: h.radius * reach, dir: this.facing, half: (h.angle * Math.PI) / 360 };
      case 'circle': return { k: 'circle', x: this.x + fx * (h.offset ?? 0), z: this.z + fz * (h.offset ?? 0), r: h.radius * (this.eclipse ? 1.35 : 1) };
      case 'line': return { k: 'line', x: this.x - fx * 0.3, z: this.z - fz * 0.3, dx: fx, dz: fz, len: h.length * reach, w: h.width * (this.state === 'charged' ? this.chargedWide : 1) };
    }
  }

  private performHit(): void {
    const m = this.move;
    if (!m) return;
    const shape = this.moveShape(m);
    const charged = this.state === 'charged';
    const mult = charged ? this.chargedMul : m.dmg;
    const stun = charged ? this.chargedStun : m.stun;
    const feel = charged ? (this.chargeLevel >= 2 ? 'heavy' : 'medium') : m.feel;
    const n = this.world.heroStrike(shape, this.hitList, {
      mult, stun, stunKind: charged ? 'charged' : m.stunKind, knockback: m.knockback * (charged ? 2 : 1), feel, finisher: !!m.finisher || charged,
      dirX: Math.sin(this.facing), dirZ: Math.cos(this.facing), pierce: true, source: 'blade', launch: m.launch,
      moveId: charged ? 'charged' : m.id,
    });
    if (n > 0) this.moveLanded = true;
    if (n > 0 && this.eclipse && !this.hitWaveDone) {
      this.hitWaveDone = true;
      this.world.abilities.eclipseWave(this.x, this.z, this.facing);
    }
  }
  private hitWaveDone = false;

  /** Списать «идеальный» бафф (крит ×1.3, оглушение ×2) — вызывается миром при первом попадании. */
  consumePerfectBuff(): boolean {
    if (!this.perfectBuff) return false;
    this.perfectBuff = false;
    return true;
  }

  // ------------------------------------------------------------------ заряд
  private startCharge(): void {
    if (this.state === 'charge') return;
    this.state = 'charge'; this.stateT = 0; this.chargeLevel = 0;
    this.hitActive = false;
    this.avatar.puppet.play('charge', 1, 0.12);
    // украденный момент: заряд сразу полный (план §6.3)
    this.instantCharge = this.clock < this.instantChargeUntil;
    if (this.instantCharge) {
      this.instantChargeUntil = 0;
      this.chargeLevel = 2;
      this.world.bus.emit('chargeReady', { level: 2 });
    }
  }

  private releaseCharge(): void {
    const C = this.weapon.charged;
    if (this.chargeLevel <= 0) { this.avatar.puppet.anim.stop(0.12); this.toMove(); return; }
    const full = this.chargeLevel >= 2;
    this.chargedMul = full ? C.dmg[1] : C.dmg[0];
    this.chargedStun = full ? C.stun[1] : C.stun[0];
    this.chargedWide = full ? 1.5 : 1;
    // нисходящий рассекающий удар из-за головы; полный заряд — ещё и волна Пустоты на 9 м
    const m: MoveDef = { id: 'charged', clip: 'cleave', dur: 0.5, chain: [0.4, 0.62], dashCancelFrom: 0.16, hitbox: { shape: 'line', length: C.length, width: C.width }, dmg: this.chargedMul, stun: this.chargedStun, stunKind: 'charged', knockback: 3, feel: full ? 'heavy' : 'medium', lunge: 1.4, finisher: true, swing: 'heavy', wave: full ? { mult: 2.2, dist: 9, r: 1.5 } : undefined };
    if (this.target) this.facing = angleOf(this.target.x - this.x, this.target.z - this.z);
    this.beginMove(m, 1.6);
    this.state = 'charged';
    this.lastMove = null;
    this.world.bus.emit('swing', { kind: 'charged', hitAt: this.hitFrame('cleave') });
  }

  // ------------------------------------------------------------------ рывок
  private startDash(dx: number, dz: number): void {
    const l = Math.hypot(dx, dz) || 1;
    this.dashDirX = dx / l; this.dashDirZ = dz / l;
    this.facing = angleOf(this.dashDirX, this.dashDirZ);
    this.dashCharges--;
    // скольжение по трещине: +50 % дальности, разрез по пути, заряд рывка не тратится
    this.sliding = this.world.abilities.riftUnder(this.x, this.z, this.dashDirX, this.dashDirZ);
    if (this.sliding) {
      this.dashCharges++;
      this.slideHits.clear();
      this.world.bus.emit('slide', { x: this.x, z: this.z, dirX: this.dashDirX, dirZ: this.dashDirZ });
    }
    this.state = 'dash'; this.stateT = 0;
    this.dashStart = this.clock;
    this.dashFromX = this.x; this.dashFromZ = this.z;
    this.avatar.markSilhouette();
    this.dashPrevE = 0;
    this.hitActive = false; this.move = null; this.chargeLevel = 0;
    this.trailOn = false;
    this.hitWaveDone = false;
    this.avatar.puppet.play('dash', 1, 0.03);
    this.world.bus.emit('dash', { x: this.x, z: this.z, dirX: this.dashDirX, dirZ: this.dashDirZ });
    this.world.abilities.onDash?.(this.x, this.z, this.dashDirX, this.dashDirZ);
  }

  private updateDash(_dt: number): void {
    const T = PLAYER_BASE.dashTime;
    const u = Math.min(1, this.stateT / T);
    const e = Ease.outQuad(u);
    const step = (e - this.dashPrevE) * PLAYER_BASE.dashDist * (this.eclipse ? 1.15 : 1) * (this.sliding ? 1.5 : 1);
    const px = this.x, pz = this.z;
    this.dashPrevE = e;
    const dx = this.dashDirX * step, dz = this.dashDirZ * step;
    if (this.world.arena.edge === 'abyss') {
      // над бездной рывок не упирается в край — можно перелететь пропасть
      this.x += dx; this.z += dz;
      const o = { x: this.x, z: this.z };
      for (const c of this.world.arena.covers) {
        const ddx = o.x - c.x, ddz = o.z - c.z, rr = c.r + this.radius, d2 = ddx * ddx + ddz * ddz;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3; o.x = c.x + ddx / d * rr; o.z = c.z + ddz / d * rr; }
      }
      this.x = o.x; this.z = o.z;
    } else {
      const o = { x: this.x, z: this.z };
      this.world.arena.move(this.x, this.z, dx, dz, this.radius, o);
      this.x = o.x; this.z = o.z;
    }
    this.vx = this.dashDirX * this.stats.speed * 0.6; this.vz = this.dashDirZ * this.stats.speed * 0.6;
    if (this.sliding) {
      const len = Math.hypot(this.x - px, this.z - pz);
      if (len > 1e-3) this.world.heroStrike({ k: 'line', x: px - this.dashDirX * 0.5, z: pz - this.dashDirZ * 0.5, dx: this.dashDirX, dz: this.dashDirZ, len: len + 1, w: 1.4 }, this.slideHits, {
        mult: 1.2, stun: 4, knockback: 2, feel: 'medium', dirX: this.dashDirX, dirZ: this.dashDirZ, source: 'blade', moveId: 'slide',
      });
    }
    if (u >= 1) {
      this.sliding = false;
      this.lastDashEnd = this.clock;
      this.avatar.puppet.anim.stop(0.08);
      this.toMove();
    }
  }

  /** Окно идеального уклонения: рывок начат не раньше perfectWindow назад и герой в неуязвимости рывка. */
  get inPerfectWindow(): boolean {
    return this.state === 'dash' && this.clock - this.dashStart <= this.stats.perfectWindow + 0.03 && this.dashIframes;
  }

  // ------------------------------------------------------------------ урон по герою (GDD §5.8)
  /** Возвращает 'hit' | 'perfect' | 'dodge' | 'immune'. */
  receiveAttack(dmg: number, dirX: number, dirZ: number, source: string, kb = 3, heavy = false): 'hit' | 'perfect' | 'dodge' | 'immune' {
    // на время Раскола герой неуязвим (план §5.6)
    if (this.dead || this.world.shatterSeq) return 'immune';
    if (this.state === 'dash' && this.dashIframes) {
      if (this.inPerfectWindow && this.clock >= this.perfectReadyAt) {
        this.perfectReadyAt = this.clock + PLAYER_BASE.perfectCooldown;
        this.perfectBuff = true;
        this.counterUntil = this.clock + 0.8;
        // окно после уклонения: удержание атаки — мгновенный полный заряд (Контрудар, затем заряд)
        this.instantChargeUntil = this.clock + 1.3;
        this.addResonance(RESONANCE.perPerfectDodge);
        this.world.bus.emit('perfectDodge', { x: this.x, z: this.z, heavy, sx: this.dashFromX, sz: this.dashFromZ });
        this.avatar.shatterSilhouette();
        return 'perfect';
      }
      this.world.bus.emit('dodge', { x: this.x, z: this.z });
      return 'dodge';
    }
    if (this.invulnerable) return 'immune';
    if (this.clock < this.shieldUntil) { this.shieldUntil = 0; return 'immune'; }
    const final = Math.max(1, Math.round(dmg * (1 - this.armor / (this.armor + 100)) * this.world.damageTakenMul));
    this.hp -= final;
    this.invulnUntil = this.clock + PLAYER_BASE.hurtInvuln;
    this.blinkUntil = this.clock + PLAYER_BASE.hurtInvuln;
    const stable = this.stats.comboStable && (this.state === 'attack' || this.state === 'charged');
    if (!stable) { this.kbX += dirX * kb; this.kbZ += dirZ * kb; }
    this.avatar.puppet.kickSpring(dirX, dirZ, stable ? 0.5 : 1.2);
    this.avatar.puppet.flash = 0.6;
    this.addResonance(-RESONANCE.lossOnHurt);
    if (this.stats.hurtShield) this.shieldUntil = this.clock + 1;
    if (this.state === 'charge') { this.avatar.puppet.anim.stop(0.1); this.toMove(); }
    if (this.hp <= 0) {
      if (this.stats.secondWind && !this.secondWindUsed) {
        this.secondWindUsed = true;
        this.hp = 1;
        this.invulnUntil = this.clock + 1.5;
        this.world.bus.emit('secondWind', { x: this.x, z: this.z });
      } else {
        this.hp = 0;
        this.die(dirX, dirZ);
      }
    }
    this.world.bus.emit('playerHurt', { dmg: final, hpLeft: this.hp, dirX, dirZ, source });
    return 'hit';
  }

  die(dirX = 0, dirZ = 1): void {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead'; this.stateT = 0;
    this.hitActive = false; this.trailOn = false;
    this.avatar.puppet.skel.shatter(dirX, dirZ, 3, this.world.fxRng);
    this.world.bus.emit('heroDeath', { x: this.x, z: this.z });
  }

  // ------------------------------------------------------------------ пропасть (coyote 0.1 с)
  private checkGround(dt: number): void {
    if (this.state === 'dash' || this.state === 'fall' || this.state === 'dead') return;
    const ground = this.world.arena.walkable(this.x, this.z);
    if (ground) {
      this.coyote = 0;
      this.safeTimer -= dt;
      if (this.safeTimer <= 0 && this.world.arena.walkable(this.x + 0.6, this.z) && this.world.arena.walkable(this.x - 0.6, this.z)
        && this.world.arena.walkable(this.x, this.z + 0.6) && this.world.arena.walkable(this.x, this.z - 0.6)) {
        this.safeTimer = 0.2; this.safeX = this.x; this.safeZ = this.z;
      }
      return;
    }
    this.coyote += dt;
    if (this.coyote > 0.1) {
      this.state = 'fall'; this.stateT = 0;
      this.hitActive = false; this.trailOn = false;
      this.avatar.puppet.anim.stop(0.1);
      this.world.bus.emit('fall', { x: this.x, z: this.z, hero: true });
    }
  }

  private updateFall(dt: number): void {
    this.y -= (4 + this.stateT * 20) * dt;
    if (this.stateT > 0.7) {
      this.y = 0;
      const o = { x: this.safeX, z: this.safeZ };
      this.world.arena.nearestWalkable(this.safeX, this.safeZ, o);
      this.x = o.x; this.z = o.z; this.lastX = o.x; this.lastZ = o.z;
      this.avatar.resetCloth();
      this.toMove();
      // падение = −15 % HP и возврат (GDD §10)
      const dmg = Math.round(this.maxHp * 0.15);
      this.invulnUntil = 0;
      this.receiveAttack(dmg, 0, 0, 'fall', 0);
      this.invulnUntil = this.clock + 1.0;
      this.blinkUntil = this.clock + 1.0;
    }
  }

  victory(): void {
    if (this.dead) return;
    this.state = 'victory'; this.stateT = 0;
    this.hitActive = false; this.trailOn = false;
    // послебоевая тишина (план §8.8): Пилот медленно опускает клинок
    this.avatar.puppet.play('lowerBlade', 1, 0.25);
  }

  /** Скриптовое движение (пробежка по древку): герой не расталкивается с врагами, позицию ведёт сценарий. */
  scripted = false;
  /** Размер клинка вне ульты: в прологе клинка ещё нет (≈0), он вырастает из обломка обшивки. */
  bladeTarget = 1;
  /** Подсветка визора и шрама поверх Резонанса (сцены: визор загорается после падения). */
  glowBoost = 0;
  /** Остаточные образы в сцене (рывок казни). */
  sceneGhosts = false;

  freeze(on: boolean): void {
    if (on) { this.state = 'frozen'; this.hitActive = false; this.trailOn = false; this.vx = this.vz = 0; this.avatar.puppet.anim.stop(0.15); }
    else if (this.state === 'frozen') this.toMove();
  }

  /** Начать каст (способности): клип + колбэк на событие release. */
  beginCast(clip: string, onRelease: () => void, minCancel = 0.18): void {
    this.state = 'cast'; this.stateT = 0;
    this.hitActive = false; this.move = null; this.chargeLevel = 0;
    this.castRelease = onRelease;
    this.castReleased = false;
    this.castMinT = minCancel;
    this.avatar.puppet.play(clip, 1, 0.04);
    this.world.bus.emit('castStart', { x: this.x, z: this.z });
  }

  /**
   * Подсказка ветки (план §6.4): какой приём выйдет следующим нажатием атаки — ветки, спрятанные в таймингах,
   * становятся видимыми. null — обычная серия.
   */
  get branchHint(): string | null {
    const W = this.weapon, c = this.clock, st = this.state;
    if (st !== 'move' && st !== 'attack' && st !== 'dash') return null;
    if (c < this.counterUntil) return 'Контрудар';
    const t = this.target;
    const heavy = !!t && t.stunned && (t.mass > 3 || t.elite.length > 0) && !t.isGuardian && !t.isBoss;
    const since = c - this.lastMoveStart;
    if (heavy && this.lastMove === W.lunge && since <= W.lunge.chain[1] / this.atkSpeed) return 'Вознесение';
    if (t?.airborne && this.lastMove === W.rising && since <= W.rising.chain[1] / this.atkSpeed) return 'Небесный разрез';
    if (t?.airborne && this.lastMove === W.skycut && since <= W.skycut.chain[1] / this.atkSpeed) return 'Звездопад';
    if (st === 'move' && c - this.lastDashEnd <= 0.2) return 'Рассечение';
    if (st === 'move' && this.lastMove === W.combo[1] && since >= 0.3 && since <= 0.7) return 'Шквал';
    if (heavy) return 'Рывок → Вознесение';
    return null;
  }

  /** Точки клинка для шлейфа. */
  bladePoints(base: THREE.Vector3, tip: THREE.Vector3): void { this.avatar.bladePoints(base, tip); }
  /** Тяжесть текущего взмаха для шлейфа: 0 — лёгкий/укол, 0.5 — вращение, 1 — тяжёлый и заряд. */
  get swingWeight(): number {
    if (this.state === 'charged') return 1;
    const sw = this.move?.swing;
    return sw === 'heavy' ? 0.85 : sw === 'spin' ? 0.5 : 0;
  }

  get blinking(): boolean { return this.clock < this.blinkUntil && Math.floor(this.clock * 20) % 2 === 0; }

  /** Позиция кисти — для эффектов способностей. */
  hand(): THREE.Vector3 { return this.avatar.handPos(_a); }
  chest(): THREE.Vector3 { return this.avatar.chestPos(_b); }
}
