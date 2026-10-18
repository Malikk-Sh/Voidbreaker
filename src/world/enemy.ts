import { angleOf, clamp, dampAngle } from '../core/math';
import type { Affix, EnemyDef } from '../data/enemies';
import { ELITE, scaleDmg, scaleHp } from '../data/enemies';
import { Puppet } from '../anim/puppet';
import type { RigLayout } from '../anim/skeleton';
import type { ClipDef } from '../anim/clip';
import { makePosture, stepPosture, type Actor, type Posture, newId } from './actor';
import type { Shape } from './combat';
import type { Telegraph } from './entities';
import type { World } from './world';

export type EState = 'spawn' | 'idle' | 'chase' | 'orbit' | 'telegraph' | 'attack' | 'recover' | 'stagger' | 'broken' | 'dead' | 'special';

export interface SpawnOpts { zone: number; stage: number; elite?: Affix[]; mode?: number; hpMul?: number }

/**
 * Враг (Tech §16): иерархическая FSM Spawn → Approach → Position → Telegraph → Attack → Recover → (Broken) → Dead.
 * Мозг принимает решения 15–20 раз/с, движение — каждый шаг. Каждая атака всегда телеграфирована.
 */
export abstract class Enemy implements Actor {
  readonly id = newId();
  readonly faction = 'enemy' as const;
  x = 0; z = 0; y = 0;
  radius: number;
  mass: number;
  facing = 0;
  hp: number; maxHp: number;
  armor: number;
  dead = false;
  posture: Posture | null = null;
  kbX = 0; kbZ = 0;
  height: number;

  readonly kind: string;
  elite: Affix[];
  isBoss = false;
  isGuardian = false;
  readonly puppet: Puppet;
  state: EState = 'spawn';
  stateT = 0;
  dmg: number;
  speed: number;
  /** Множитель длительности телеграфов (Ускоренный −30 %, Неистовство…). */
  teleMul = 1;
  /** Щит Аколита: множитель входящего урона. */
  shieldMul = 1;
  /** Множитель урона по стойке (окна наказания: ×2). */
  postureMul = 1;
  shieldFrom: Enemy | null = null;
  stagger = 0;
  deathT = 0;
  token: 'melee' | 'ranged' | null = null;
  tele: Telegraph | null = null;
  attackDone = false;
  vx = 0; vz = 0;
  scale = 1;
  /** Подсветка ядра при телеграфе (0..1) — уходит в буст эмиссии. */
  coreGlow = 0;
  protected brainT = Math.random() * 0.06;
  protected time = 0;
  /** Поедание/подкрепления: элитный порог 50 % HP сработал. */
  halfTriggered = false;
  /** Задержка перед следующей атакой (кулдаун). */
  cooldown = 0.8 + Math.random() * 0.8;
  /** Полёт после подбрасывания (Восходящий месяц). */
  private airT = 0; private airDur = 0; private airH = 0;

  constructor(readonly def: EnemyDef, layout: RigLayout, clips: ClipDef[], o: SpawnOpts) {
    this.kind = def.id;
    this.elite = o.elite ?? [];
    const eliteK = this.elite.length > 0;
    this.maxHp = Math.round(scaleHp(def.hp, o.zone, o.stage, o.mode ?? 1) * (eliteK ? ELITE.hp : 1) * (o.hpMul ?? 1));
    this.hp = this.maxHp;
    this.dmg = scaleDmg(def.dmg, o.zone, o.stage, o.mode ?? 1) * (eliteK ? ELITE.dmg : 1);
    this.speed = def.speed;
    this.radius = def.radius * (eliteK ? ELITE.scale : 1);
    this.mass = def.mass * (eliteK ? 1.6 : 1);
    this.height = def.height * (eliteK ? ELITE.scale : 1);
    this.armor = def.armor ?? 0;
    this.scale = eliteK ? ELITE.scale : 1;
    if (def.posture) this.posture = makePosture(def.posture * (eliteK ? 1.5 : 1), def.breakDur ?? 1.8);
    else if (eliteK) this.posture = makePosture(ELITE.posture, 1.8);
    if (this.elite.includes('hasted')) { this.speed *= 1.4; this.teleMul = 0.7; }
    this.puppet = new Puppet(layout, clips);
    this.puppet.skel.size = this.scale;
    this.puppet.dissolve = 1;
  }

  get targetable(): boolean { return !this.dead && this.state !== 'spawn'; }
  /** Треснул (стойка сломана): финишер или заряженный удар вызовет Раскол. */
  get cracked(): boolean { return !this.dead && !!this.posture && this.posture.broken > 0 && this.canShatter; }
  /** Боссы запрещают Раскол в переходах фаз (переопределяется). */
  get canShatter(): boolean { return true; }
  get broken(): boolean { return !!this.posture && this.posture.broken > 0; }
  get spawned(): boolean { return this.state !== 'spawn'; }

  setState(s: EState): void { this.state = s; this.stateT = 0; }

  /** Общий шаг: спаун через портал, хитстан, стойка, отбрасывание; затем мозг. */
  step(w: World, dt: number): void {
    this.time += dt;
    this.stateT += dt;
    this.puppet.stepSpring(dt);
    this.coreGlow = Math.max(0, this.coreGlow - dt * 3);
    if (this.dead) {
      this.deathT += dt;
      this.puppet.skel.stepDebris(dt);
      this.puppet.skel.update();
      this.puppet.dissolve = clamp((this.deathT - 0.35) / 0.6, 0, 1);
      return;
    }
    if (this.state === 'spawn') {
      // портал 0.8 с: обратное растворение
      this.puppet.dissolve = clamp(1 - this.stateT / 0.8, 0, 1);
      if (this.stateT >= 0.8) { this.puppet.dissolve = 0; this.setState('idle'); }
      this.animate(dt, w);
      return;
    }
    if (this.posture) {
      const wasBroken = this.posture.broken > 0;
      stepPosture(this.posture, dt);
      this.puppet.crack = this.posture.broken > 0 ? 1 : Math.max(0, this.puppet.crack - dt * 2);
      if (wasBroken && this.posture.broken <= 0 && this.state === 'broken') this.setState('recover');
    }
    if (this.shieldFrom && (this.shieldFrom.dead || !this.shieldFrom.spawned)) { this.shieldFrom = null; this.shieldMul = 1; }
    if (this.airDur > 0) {
      this.airT += dt;
      const u = Math.min(1, this.airT / this.airDur);
      this.y = this.airH * Math.sin(u * Math.PI);
      if (u >= 1) { this.airDur = 0; this.y = 0; w.bus.emit('impact', { x: this.x, z: this.z, r: this.radius, kind: 'land' }); }
    }
    if (this.cooldown > 0) this.cooldown -= dt;

    // отбрасывание
    if (this.kbX || this.kbZ) {
      this.vx = this.kbX; this.vz = this.kbZ;
      const k = Math.exp(-dt * 9);
      this.kbX *= k; this.kbZ *= k;
      if (Math.abs(this.kbX) + Math.abs(this.kbZ) < 0.1) this.kbX = this.kbZ = 0;
    }

    if (this.state === 'broken') {
      this.vx *= 0.8; this.vz *= 0.8;
      if (!this.posture || this.posture.broken <= 0) this.setState('recover');
    } else if (this.state === 'stagger') {
      if (this.stateT >= this.stagger) this.setState('recover');
    } else {
      this.brainT -= dt;
      this.think(w, dt, this.brainT <= 0);
      if (this.brainT <= 0) this.brainT = 1 / 18;
    }
    this.animate(dt, w);
  }

  /** Решения ИИ: thinkTick — тик мозга (≈18 Гц), иначе — только движение/таймеры. */
  protected abstract think(w: World, dt: number, thinkTick: boolean): void;
  /** Поза: локомоция + клипы + телеграф в теле (ядро вспыхивает, корпус оттягивается). */
  protected abstract animate(dt: number, w: World): void;

  /** Задать желаемую скорость к точке. */
  steer(tx: number, tz: number, speed: number, dt: number, stopAt = 0): void {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    let sx = 0, sz = 0;
    if (d > stopAt + 0.05) { sx = (dx / d) * speed; sz = (dz / d) * speed; }
    const k = 1 - Math.exp(-dt / 0.12);
    this.vx += (sx - this.vx) * k; this.vz += (sz - this.vz) * k;
  }

  /** Кружить вокруг героя на дистанции R (держать дистанцию, без токена атаки). */
  orbit(w: World, R: number, speed: number, dt: number, dir: number): void {
    const h = w.hero;
    const dx = this.x - h.x, dz = this.z - h.z, d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;
    const radial = (R - d) * 1.5;
    const tx = nx * radial + -nz * dir * speed * 0.6, tz = nz * radial + nx * dir * speed * 0.6;
    const l = Math.hypot(tx, tz) || 1;
    const sp = Math.min(speed, l);
    const k = 1 - Math.exp(-dt / 0.2);
    this.vx += ((tx / l) * sp - this.vx) * k; this.vz += ((tz / l) * sp - this.vz) * k;
  }

  faceTo(x: number, z: number, tau: number, dt: number): void {
    this.facing = dampAngle(this.facing, angleOf(x - this.x, z - this.z), tau, dt);
  }

  distTo(a: { x: number; z: number }): number { return Math.hypot(a.x - this.x, a.z - this.z); }

  /** Начать телеграф атаки: метка на полу + ядро вспыхивает. */
  telegraph(w: World, shape: Shape, dur: number, white = false, sound: 'hum' | 'whistle' | 'chime' | 'bell' | 'roar' = 'hum'): Telegraph {
    this.tele = w.addTelegraph(shape, dur * this.teleMul, white);
    w.bus.emit('telegraph', { kind: sound, x: this.x, z: this.z });
    return this.tele;
  }

  cancelTelegraph(): void {
    if (this.tele) { this.tele.alive = false; this.tele = null; }
  }

  /** Подбросить (рядовые и элита полегче): оглушение на время полёта. */
  launch(h: number): void {
    if (this.isBoss || this.isGuardian || this.mass > 3 || this.dead || this.state === 'spawn') return;
    const k = this.elite.length ? 0.6 : 1;
    this.airDur = 0.55 + 0.1 * k; this.airT = 0; this.airH = h * k;
    this.cancelTelegraph();
    this.token = null;
    this.stagger = this.airDur + 0.15;
    this.setState('stagger');
  }

  /** Прерывание лёгким ударом (хитстан рядовых). */
  interrupt(dur: number): void {
    if (!this.def.staggerable || this.elite.length > 0 || this.state === 'spawn') return;
    this.cancelTelegraph();
    if (this.token) this.token = null;
    this.stagger = dur;
    this.setState('stagger');
  }

  /** Слом стойки: короткое оглушение (элита 1.8 с, стражи 2.4 с, босс 2.8 с), +25 % урона, Раскол финишером. */
  onBreak(): void {
    this.cancelTelegraph();
    this.token = null;
    this.setState('broken');
  }

  /** Смерть = распад: детали отрываются и разлетаются (GDD §15.2). */
  kill(w: World, dirX: number, dirZ: number, power: number): void {
    if (this.dead) return;
    this.dead = true;
    this.cancelTelegraph();
    this.token = null;
    this.state = 'dead';
    this.deathT = 0;
    this.puppet.skel.shatter(dirX, dirZ, power, w.fxRng);
  }

  /** Добавлен в мир. */
  onAdded(_w: World): void {}

  /** Неуязвим (переходы фаз босса, портал). */
  get invulnerable(): boolean { return false; }

  /** Урон получен (после вычитания HP): пороги фаз, элитные триггеры 50 %. */
  onDamaged(w: World, _dmg: number, _before: number): void {
    if (!this.halfTriggered && this.elite.length && this.hp > 0 && this.hp <= this.maxHp / 2) {
      this.halfTriggered = true;
      w.onEliteHalf?.(this);
    }
  }

  /** Смертельный урон: false — враг не умирает (босс ждёт перехода фазы). */
  onLethal(_w: World): boolean { return true; }

  /** Раскол применён: трещины взорваны, враг выходит из слома. */
  onShattered(_w: World): void {}

  /** Сколько кадров удалить после распада. */
  get removable(): boolean { return this.dead && this.deathT > 1.0; }
}
