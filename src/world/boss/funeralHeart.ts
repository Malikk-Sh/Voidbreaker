import { LINE_BACK, VOID_BLADE } from '../../data/weapons';
import { RESONANCE } from '../../data/player';
import { BRAZIERS, sectorAt } from '../candleRitual';
import { computeDamage, overlaps, type Shape } from '../combat';
import type { Enemy } from '../enemy';
import { createEnemy } from '../enemies/factory';
import type { Telegraph } from '../entities';
import type { GameEvents } from '../events';
import type { AimTarget, World } from '../world';

/**
 * Погребальное сердце. Один язык на весь бой: ядро открыто, только когда Сердце лежит на полу. Туда его отправляют
 * собственное падение мимо героя, отбитая сфера и огонь, возвращённый в чашу. В воздухе броня гасит клинок.
 *
 * hp — запас; armor — доля урона клинка по закрытой броне; stuck / knockdown / counterDown — сколько Сердце лежит
 * открытым после промаха падением, после отбитой сферы и после контратаки огнём (по фазам); getUp — за сколько
 * до подъёма появляется метка удара при подъёме; rage / dying — длительность ярости между фазами и гибели;
 * hover — высота над колодцем по фазам; dmg — доли HP героя за попадание; heatRadius — падение рядом с чашей
 * нагревает её; igniteHeat — с какого жара чашу зажигает любой удар клинком.
 */
export const FUNERAL_HEART = {
  hp: 1350, warning: 1.4, flameSeconds: 14, waxSeconds: 10,
  reflectionDamage: 34, counterDamage: 42, waxDamage: 30,
  maxCarriers: 3, carriersPerPhase: 9,
  armor: 0.12,
  stuck: [3.0, 2.7, 2.4], knockdown: [2.7, 2.4, 2.2], counterDown: [3.2, 2.9, 2.6], getUp: 1.25,
  rage: 2.4, dying: 2.6, burstAt: 1.9,
  hover: [3.8, 3.3, 2.9],
  dmg: { dive: 0.3, quake: 0.12, getUp: 0.12, orb: 0.15, pulse: 0.22, sweep: 0.14 },
  heatRadius: 4.5, igniteHeat: 0.6,
} as const;

/** Как Сердце ведёт себя по фазам: выслеживание перед падением, предупреждение, паузы, сферы, волна. */
const PHASE = [
  { track: 0.95, warn: 1.4, gap: 1.4, orbs: [0], orbSpeed: 4.8, volleys: 1, waveSpeed: 7.5 },
  { track: 0.75, warn: 1.3, gap: 1.0, orbs: [-0.32, 0, 0.32], orbSpeed: 5.4, volleys: 1, waveSpeed: 8.5 },
  { track: 0.5, warn: 1.2, gap: 0.7, orbs: [-0.32, 0, 0.32], orbSpeed: 5.8, volleys: 2, waveSpeed: 9.5 },
] as const;

export type HeartPose = 'hover' | 'track' | 'lock' | 'fall' | 'stuck' | 'knock' | 'rise' | 'rage' | 'dying';

export interface HeartShot {
  id: number; x: number; y: number; z: number; r: number;
  vx: number; vz: number; alive: boolean; reflected: boolean; life: number;
}
export interface HeartField {
  id: number; x: number; z: number; r: number; life: number; dur: number;
  kind: 'wax' | 'counter';
}
export interface HeartAttack {
  kind: 'dive' | 'dives' | 'pulse' | 'double' | 'sweep' | 'drain' | 'orbs';
  x: number; z: number; t: number; dur: number; shapes: Shape[]; targetIndex?: number;
}
export interface FuneralHeartView {
  readonly centerZ: number;
  readonly active: boolean; readonly dead: boolean;
  readonly braziers: readonly { x: number; z: number }[];
  readonly shots: readonly HeartShot[]; readonly fields: readonly HeartField[];
  readonly carriers: ReadonlyMap<number, Enemy>;
  readonly body: { x: number; y: number; z: number; r: number };
  readonly phase: 1 | 2 | 3; readonly hp: number; readonly maxHp: number;
  readonly exposed: number; readonly beat: number; readonly attack: HeartAttack | null;
  readonly lit: readonly boolean[]; readonly heat: readonly number[]; readonly flameLife: readonly number[];
  readonly hitFlash: number;
  readonly pose: HeartPose; readonly poseT: number;
  /** Куда падает Сердце: точка под ним при выслеживании, затем зафиксированная метка. */
  readonly target: { x: number; z: number };
  /** Раскрытие брони 0…1: лежит на полу — 1, за ~1.2 с до подъёма закрывается. */
  readonly open: number;
  /** Ярость между фазами 0…1 (0 — нет). */
  readonly rage: number;
  /** Гибель 0…1 (0 — жив); burst — ядро уже лопнуло. */
  readonly dying: number; readonly burst: boolean;
  readonly metrics: { counters: number; reflectedHits: number; bodyHits: number; spawnedTotal: number; dives: number; knockdowns: number; clanks: number };
}

interface Step { at: number; run: () => void; done: boolean }
interface Sequence { view: HeartAttack; steps: Step[]; telegraphs: Telegraph[] }

/** The heart is a separate encounter, never a fifth wave or a proximity ritual. */
export class FuneralHeart implements FuneralHeartView {
  active = false;
  dead = false;
  hp: number = FUNERAL_HEART.hp;
  readonly maxHp = FUNERAL_HEART.hp;
  phase: 1 | 2 | 3 = 1;
  exposed = 0;
  beat = 0;
  hitFlash = 0;
  attack: HeartAttack | null = null;
  pose: HeartPose = 'hover';
  poseT = 0;
  readonly target = { x: 0, z: 0 };
  open = 0;
  rage = 0;
  dying = 0;
  burst = false;
  readonly lit: [boolean, boolean, boolean] = [false, false, false];
  readonly heat: [number, number, number] = [0, 0, 0];
  readonly flameLife: [number, number, number] = [0, 0, 0];
  readonly braziers: { x: number; z: number }[];
  readonly shots: HeartShot[] = [];
  readonly fields: HeartField[] = [];
  readonly carriers = new Map<number, Enemy>();
  readonly body: { x: number; y: number; z: number; r: number };
  readonly metrics = { counters: 0, reflectedHits: 0, bodyHits: 0, spawnedTotal: 0, dives: 0, knockdowns: 0, clanks: 0 };
  onDefeated: (() => void) | null = null;
  private enabled = false;
  private started = false;
  private disposed = false;
  private clock = 0;
  private beatClock = 0;
  private nextAttack = 1.6;
  private nextSpawn = 2.6;
  private phaseSpawns = 0;
  private attackIndex = 0;
  private entityId = 0;
  private sequence: Sequence | null = null;
  private swingId = 0;
  private lastSlashAt = -99;
  private lastClank = -99;
  private slashKeys = new Set<string>();
  /** Подъём с пола: метка и удар при подъёме (только после собственного падения). */
  private getUp: { tele: Telegraph | null; armed: boolean } | null = null;
  private knock: { fx: number; fy: number; fz: number; tx: number; tz: number; t: number; dur: number; hold: number } | null = null;
  private fall: { fx: number; fy: number; fz: number; t: number; dur: number } | null = null;
  private deathT = 0;
  private readonly offs: (() => void)[];
  private readonly aimTarget: AimTarget;

  constructor(private readonly w: World, readonly centerZ: number) {
    this.braziers = BRAZIERS.map(b => ({ x: b.x, z: centerZ + b.z }));
    this.body = { x: 0, y: FUNERAL_HEART.hover[0], z: centerZ - 0.5, r: 2.5 };
    this.target.x = 0; this.target.z = centerZ - 0.5;
    const heart = this;
    this.aimTarget = {
      get x() { return heart.body.x; }, get z() { return heart.body.z; },
      get radius() { return heart.body.r; },
      get targetable() { return heart.active && heart.dying === 0 && heart.exposed > 0 && heart.w.arena.walkable(heart.body.x, heart.body.z); },
    };
    w.aimTargets.add(this.aimTarget);
    this.offs = [
      w.bus.on('swing', () => { this.swingId++; this.slashKeys.clear(); }),
      w.bus.on('slash', e => this.slash(e)),
      w.bus.on('ability', e => this.ability(e)),
      w.bus.on('perfectDodge', e => this.reflectNear(e.x, e.z, e.sx, e.sz)),
      w.bus.on('kill', e => this.carrierDied(e.target.id, e.x, e.z)),
      w.bus.on('heroDeath', () => { this.enabled = false; this.cancelAttack(); }),
    ];
  }

  get view(): FuneralHeartView { return this; }
  get counters(): number { return this.metrics.counters; }
  get reflectedHits(): number { return this.metrics.reflectedHits; }
  get bodyHits(): number { return this.metrics.bodyHits; }
  get spawnedTotal(): number { return this.metrics.spawnedTotal; }
  private get tune() { return PHASE[this.phase - 1]; }
  private get origin() { return { x: 0, z: this.centerZ - 0.5 }; }

  start(): boolean {
    if (this.started || this.disposed) return false;
    this.started = true; this.active = true; this.enabled = true;
    this.w.bus.emit('bossPhase', { phase: 1 });
    return true;
  }

  step(dt: number, enabled = true): void {
    // После гибели огонь продолжает возвращаться волной, даже когда бой уже закончен.
    if (this.dead) { if (Number.isFinite(dt) && dt > 0) this.deathT += Math.min(dt, 0.5); return; }
    this.enabled = this.active && enabled && !this.disposed && !this.w.hero.dead && !this.w.hero.scripted;
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return;
    // A long browser frame cannot skip an entire warning or throw an orb through the blade.
    let remaining = Math.min(dt, 0.5);
    while (remaining > 1e-8 && this.active) {
      const slice = Math.min(remaining, 1 / 60);
      this.advance(slice); remaining -= slice;
    }
  }

  visibilityAt(x: number, z: number): number {
    if (!this.started) return 1;
    // Гибель возвращает огонь волной от лопнувшего ядра.
    if (this.dead || this.burst) {
      if (this.dead && this.deathT >= FUNERAL_HEART.dying + 1.5) return 1;
      const r = Math.max(0, this.deathT - FUNERAL_HEART.burstAt) * 16;
      const d = Math.hypot(x - this.body.x, z - this.body.z);
      return Math.max(0, Math.min(1, (r - d) / 3));
    }
    if (this.lit[sectorAt(x, z, this.centerZ)]) return 1;
    const drain = Math.min(1, this.clock / 2.2);
    if (drain >= 1) return 0;
    const tau = Math.PI * 2, angle = Math.atan2(x, z - this.centerZ) + Math.PI;
    const turn = ((angle % tau) + tau) % tau / tau;
    const gone = Math.max(0, Math.min(1, (drain * 1.08 - turn) / 0.08));
    return 1 - gone;
  }

  private get canAct(): boolean { return this.active && this.enabled && !this.disposed && !this.w.hero.scripted && !this.w.hero.dead && this.dying === 0; }

  private setPose(pose: HeartPose): void { this.pose = pose; this.poseT = 0; }

  private advance(dt: number): void {
    this.clock += dt; this.poseT += dt;
    // «Тук-тук»: в выслеживании и ярости сердце бьётся чаще.
    const rate = this.pose === 'dying' ? 2.6 : this.pose === 'rage' || this.pose === 'track' || this.pose === 'lock' ? 1.9
      : this.pose === 'stuck' ? 1.6 : this.phase === 3 ? 1.35 : this.phase === 2 ? 1.1 : 0.85;
    this.beatClock += dt * rate; this.beat = this.beatClock % 1;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    for (let i = 0; i < 3; i++) {
      this.heat[i] = Math.max(0, this.heat[i] - dt * 0.055);
      this.flameLife[i] = Math.max(0, this.flameLife[i] - dt);
      this.lit[i] = this.flameLife[i] > 0;
    }
    if (this.pose === 'dying') { this.stepDying(dt); return; }
    this.stepPose(dt);
    this.stepShots(dt);
    if (!this.active || this.dying > 0) return;
    this.stepFields(dt);
    for (const [id, enemy] of this.carriers) if (enemy.dead) this.carriers.delete(id);
    if (this.pose !== 'rage') {
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0) { this.spawnCarriers(); this.nextSpawn = 8.5 - this.phase * 0.5; }
    }
    const sequence = this.sequence;
    if (sequence) {
      sequence.view.t += dt;
      for (const step of sequence.steps) {
        if (step.done || sequence.view.t + 1e-7 < step.at) continue;
        step.done = true; step.run();
        if (!this.active || this.sequence !== sequence) return;
      }
      if (sequence.view.t >= sequence.view.dur) {
        this.sequence = null; this.attack = null;
        if (this.pose === 'hover') this.nextAttack = this.tune.gap;
      }
    } else if (this.pose === 'hover') {
      this.nextAttack -= dt;
      if (this.nextAttack <= 0) this.beginNextAttack();
    }
  }

  // ------------------------------------------------------------------ тело и позы

  private stepPose(dt: number): void {
    const b = this.body, o = this.origin, h = this.w.hero;
    const ease = (k: number, to: { x: number; y: number; z: number }) => {
      const f = 1 - Math.exp(-dt * k);
      b.x += (to.x - b.x) * f; b.y += (to.y - b.y) * f; b.z += (to.z - b.z) * f;
    };
    const hoverY = FUNERAL_HEART.hover[this.phase - 1] + Math.sin(this.clock * 1.3) * 0.12;
    switch (this.pose) {
      case 'hover':
        this.open += (0 - this.open) * (1 - Math.exp(-dt * 5));
        ease(3, { x: o.x, y: hoverY, z: o.z }); break;
      case 'track': {
        // Тень Сердца следует за героем: оно поднимается и встаёт над ним.
        const p = { x: h.x, z: h.z }; this.w.arena.nearestWalkable(p.x, p.z, p);
        const f = 1 - Math.exp(-dt * 6);
        this.target.x += (p.x - this.target.x) * f; this.target.z += (p.z - this.target.z) * f;
        ease(4, { x: this.target.x, y: 5.6, z: this.target.z });
        this.open += (0 - this.open) * (1 - Math.exp(-dt * 8)); break;
      }
      case 'lock':
        // Зафиксировано: висит над меткой и дрожит перед падением.
        ease(7, { x: this.target.x + Math.sin(this.clock * 47) * 0.05, y: 5.9, z: this.target.z + Math.cos(this.clock * 41) * 0.05 }); break;
      case 'fall': {
        const f = this.fall!;
        f.t = Math.min(f.dur, f.t + dt);
        const k = f.t / f.dur, kk = k * k;
        b.x = f.fx + (this.target.x - f.fx) * k; b.z = f.fz + (this.target.z - f.fz) * k; b.y = f.fy + (1.05 - f.fy) * kk;
        break;
      }
      case 'stuck': {
        b.x = this.target.x; b.z = this.target.z; b.y = 1.05 + Math.max(0, 0.25 - this.poseT) * 0.8;
        this.exposed = Math.max(0, this.exposed - dt);
        const closing = this.getUp ? Math.max(0, Math.min(1, (FUNERAL_HEART.getUp - this.exposed) / FUNERAL_HEART.getUp)) : 0;
        this.open += (Math.max(0, 1 - closing) - this.open) * (1 - Math.exp(-dt * 10));
        // Метка удара при подъёме — та же система телеграфов, не меньше 1.2 с.
        if (this.getUp && !this.getUp.armed && this.exposed <= FUNERAL_HEART.getUp) {
          this.getUp.armed = true;
          this.getUp.tele = this.w.addTelegraph({ k: 'circle', x: b.x, z: b.z, r: 3.4 }, Math.max(FUNERAL_HEART.getUp, this.exposed));
          this.w.bus.emit('telegraph', { kind: 'hum', x: b.x, z: b.z, src: 'funeralHeart' });
        }
        if (this.exposed <= 0) this.liftOff();
        break;
      }
      case 'knock': {
        const k = this.knock!;
        k.t = Math.min(k.dur, k.t + dt);
        const u = k.t / k.dur;
        b.x = k.fx + (k.tx - k.fx) * u; b.z = k.fz + (k.tz - k.fz) * u;
        b.y = k.fy + (1.05 - k.fy) * u * u + Math.sin(u * Math.PI) * 1.4;
        this.open += (1 - this.open) * (1 - Math.exp(-dt * 6));
        if (k.t >= k.dur) {
          this.target.x = k.tx; this.target.z = k.tz; this.knock = null;
          this.w.bus.emit('heartSlam', { x: k.tx, z: k.tz, r: 2.2, big: false, open: true });
          this.w.bus.emit('impact', { x: k.tx, z: k.tz, r: 2.2, kind: 'slam' });
          this.setPose('stuck'); this.exposed = k.hold; this.getUp = null;
        }
        break;
      }
      case 'rise':
        this.open += (0 - this.open) * (1 - Math.exp(-dt * 8));
        ease(4.2, { x: o.x, y: hoverY, z: o.z });
        if (this.poseT >= 0.75) { this.setPose('hover'); this.nextAttack = Math.max(this.nextAttack, this.tune.gap * 0.6); }
        break;
      case 'rage': {
        this.rage = Math.min(1, this.poseT / FUNERAL_HEART.rage);
        ease(3.5, { x: o.x + Math.sin(this.clock * 31) * 0.08, y: 5.4, z: o.z });
        this.open += (0.35 - this.open) * (1 - Math.exp(-dt * 4));
        if (this.poseT >= FUNERAL_HEART.rage) {
          this.rage = 0; this.setPose('hover');
          this.nextAttack = 0.6; this.nextSpawn = Math.min(this.nextSpawn, 0.4);
        }
        break;
      }
    }
  }

  private liftOff(): void {
    const up = this.getUp;
    this.getUp = null; this.exposed = 0;
    if (up?.armed && this.canAct) {
      // Жадность наказывается: встающее Сердце отбрасывает тех, кто остался под ним.
      this.w.enemyStrike({ x: this.body.x, z: this.body.z, id: -941, kind: 'Погребальное Сердце' }, { k: 'circle', x: this.body.x, z: this.body.z, r: 3.4 },
        this.w.hero.maxHp * FUNERAL_HEART.dmg.getUp, 5);
      this.w.bus.emit('shockwave', { x: this.body.x, z: this.body.z, r: 4, color: 'hunger', strength: 0.6 });
    }
    this.setPose('rise');
  }

  /** Сбить на пол: отбитая сфера, огонь чаши или воск. Сердце падает на кольцо в сторону angle и лежит hold с. */
  private knockDown(angle: number, hold: number): void {
    if (this.dying > 0 || this.pose === 'rage') return;
    if (this.pose === 'stuck' || this.pose === 'knock') { this.exposed = Math.max(this.exposed, Math.min(hold, this.exposed + 1)); return; }
    this.cancelAttack();
    const p = { x: Math.sin(angle) * 7.6, z: this.centerZ - 0.5 + Math.cos(angle) * 7.6 };
    this.w.arena.nearestWalkable(p.x, p.z, p);
    this.knock = { fx: this.body.x, fy: this.body.y, fz: this.body.z, tx: p.x, tz: p.z, t: 0, dur: 0.5, hold };
    this.metrics.knockdowns++;
    this.setPose('knock'); this.exposed = hold + 0.5;
    this.w.bus.emit('heartStagger', { x: this.body.x, y: this.body.y, z: this.body.z });
  }

  // ------------------------------------------------------------------ приёмы

  private beginNextAttack(): void {
    const patterns: HeartAttack['kind'][] = this.phase === 3
      ? ['dives', 'orbs', 'sweep', 'dives', 'double', 'orbs', 'drain']
      : this.phase === 2 ? ['dive', 'orbs', 'sweep', 'dive', 'double', 'orbs', 'drain']
      : ['dive', 'orbs', 'dive', 'pulse', 'orbs', 'drain'];
    const kind = patterns[this.attackIndex % patterns.length];
    // Returning the orb has a readable interval of its own, without an overlapping wave.
    if (this.shots.some(s => s.alive && !s.reflected)) { this.nextAttack = 0.25; return; }
    this.attackIndex++;
    if (kind === 'drain' && !this.lit.some(Boolean)) { this.beginNextAttack(); return; }
    const steps: Step[] = [], telegraphs: Telegraph[] = [], o = this.origin, t = this.tune;
    const view: HeartAttack = { kind, x: this.w.hero.x, z: this.w.hero.z, t: 0, dur: 0, shapes: [] };
    const tele = (shape: Shape, dur: number, white = false) => {
      const tg = this.w.addTelegraph(shape, dur, white); telegraphs.push(tg); view.shapes.push(shape); return tg;
    };
    const at = (time: number, run: () => void) => steps.push({ at: time, run, done: false });
    let end = 0;
    if (kind === 'dive' || kind === 'dives') {
      const hops = kind === 'dives' ? 3 : 1;
      // Первое падение боя медленнее: игрок видит тень и успевает понять, что под ней.
      const track = this.metrics.dives === 0 ? 1.25 : t.track, warn = this.metrics.dives === 0 ? 1.65 : t.warn;
      let time = 0;
      for (let i = 0; i < hops; i++) {
        const last = i === hops - 1, lockAt = time + (i === 0 ? track : Math.min(track, 0.45)), hitAt = lockAt + warn;
        at(time, () => { this.setPose('track'); if (i === 0) { this.target.x = this.body.x; this.target.z = this.body.z; } });
        at(lockAt, () => {
          this.setPose('lock');
          const p = { x: this.target.x, z: this.target.z }; this.w.arena.nearestWalkable(p.x, p.z, p);
          this.target.x = p.x; this.target.z = p.z; view.x = p.x; view.z = p.z;
          tele({ k: 'circle', x: p.x, z: p.z, r: 2.6 }, warn);
          this.w.bus.emit('telegraph', { kind: 'roar', x: p.x, z: p.z, src: 'funeralHeart' });
        });
        at(hitAt - 0.26, () => { this.fall = { fx: this.body.x, fy: this.body.y, fz: this.body.z, t: 0, dur: 0.26 }; this.setPose('fall'); });
        at(hitAt, () => this.diveImpact(last));
        time = hitAt + 0.05;
      }
      end = time;
    } else if (kind === 'orbs') {
      tele({ k: 'circle', x: o.x, z: o.z, r: 1.4 }, 1.1);
      this.w.bus.emit('telegraph', { kind: 'chime', x: o.x, z: o.z, src: 'funeralHeart' });
      for (let v = 0; v < t.volleys; v++) at(1.1 + v * 0.9, () => this.launchOrbs(v));
      end = 1.1 + (t.volleys - 1) * 0.9 + 0.3;
    } else if (kind === 'pulse' || kind === 'double') {
      const waves = kind === 'double' ? 2 : 1, windup = this.phase === 1 ? 1.5 : 1.3;
      // Метка показывает, где пройдёт волна и где в ней будут проходы — у горящих чаш и воска.
      tele({ k: 'ring', x: o.x, z: o.z, r0: 5.4, r1: 6.4, gaps: this.waveGaps() }, windup);
      this.w.bus.emit('telegraph', { kind: 'bell', x: o.x, z: o.z, src: 'funeralHeart' });
      for (let i = 0; i < waves; i++) at(windup + i * 1.1, () => this.launchWave());
      end = windup + (waves - 1) * 1.1 + 0.3;
    } else if (kind === 'sweep') {
      // Маятник: лучи от Сердца ложатся по кругу один за другим; каждый предупреждён не меньше 1.2 с.
      const beams = this.phase === 3 ? 2 : 1, n = this.phase === 3 ? 8 : 7, arc = this.phase === 3 ? 1.7 : 1.5;
      const a0 = Math.atan2(this.w.hero.x - o.x, this.w.hero.z - o.z) - arc / 2, warn = Math.max(1.2, t.warn - 0.1), stepT = 0.2;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < beams; k++) {
          const a = a0 + arc * i / (n - 1) + k * Math.PI;
          const shape: Shape = { k: 'line', x: o.x + Math.sin(a) * 4.2, z: o.z + Math.cos(a) * 4.2, dx: Math.sin(a), dz: Math.cos(a), len: 17, w: 1.8 };
          at(i * stepT, () => { tele(shape, warn); });
          at(i * stepT + warn, () => {
            this.strike(shape, FUNERAL_HEART.dmg.sweep, 3);
            this.w.bus.emit('heartBeam', { x: shape.x, z: shape.z, dx: shape.dx, dz: shape.dz, len: shape.len, first: i === 0 && k === 0 });
          });
        }
      }
      this.w.bus.emit('telegraph', { kind: 'whistle', x: o.x, z: o.z, src: 'funeralHeart' });
      end = (n - 1) * stepT + warn + 0.25;
    } else {
      const index = this.flameLife.indexOf(Math.max(...this.flameLife)), b = this.braziers[index];
      view.targetIndex = index; view.x = b.x; view.z = b.z;
      tele({ k: 'circle', x: b.x, z: b.z, r: 2.6 }, 2.2, true);
      this.w.bus.emit('telegraph', { kind: 'bell', x: b.x, z: b.z, src: 'funeralHeart' });
      at(2.2, () => {
        this.flameLife[index] = 0; this.lit[index] = false; this.heat[index] = 0.5;
        this.w.bus.emit('shockwave', { x: b.x, z: b.z, r: 3, color: 'hunger', strength: 0.6 });
        this.strike({ k: 'circle', x: b.x, z: b.z, r: 2.6 }, FUNERAL_HEART.dmg.sweep, 3);
      });
      end = 2.5;
    }
    view.dur = end;
    this.sequence = { view, steps, telegraphs }; this.attack = view;
  }

  /** Удар по герою (и по носильщикам — Сердце не щадит своих). */
  private strike(shape: Shape, frac: number, kb: number): void {
    if (!this.canAct) return;
    this.w.enemyStrike({ x: this.body.x, z: this.body.z, id: -941, kind: 'Погребальное Сердце' }, shape, this.w.hero.maxHp * frac, kb);
  }

  private diveImpact(last: boolean): void {
    if (!this.canAct) return;
    const x = this.target.x, z = this.target.z, h = this.w.hero;
    this.body.x = x; this.body.z = z; this.body.y = 1.05; this.fall = null;
    this.metrics.dives++;
    this.w.enemyStrike({ x, z, id: -941, kind: 'Погребальное Сердце' }, { k: 'circle', x, z, r: 2.6 }, h.maxHp * FUNERAL_HEART.dmg.dive, 4);
    this.w.heroStrike({ k: 'circle', x, z, r: 2.6 }, new Set(), {
      mult: 2.5, stun: 12, knockback: 2, feel: 'heavy', dirX: 0, dirZ: 1, source: 'env', noResonance: true,
    });
    // Удар о пол рядом с чашей раскаляет её: золотое кольцо пульсирует, клинок её зажжёт.
    for (let i = 0; i < 3; i++) {
      const b = this.braziers[i];
      if (!this.lit[i] && Math.hypot(b.x - x, b.z - z) <= FUNERAL_HEART.heatRadius) this.heat[i] = 1;
    }
    this.w.bus.emit('heartSlam', { x, z, r: 2.6, big: last, open: last });
    this.w.bus.emit('impact', { x, z, r: 2.6, kind: 'slam' });
    if (!this.active) return;
    if (last && this.phase >= 2) this.w.addRingWave(x, z, 9, 1.2, 8.5, [], h.maxHp * FUNERAL_HEART.dmg.quake, -941);
    if (last) {
      this.setPose('stuck'); this.exposed = FUNERAL_HEART.stuck[this.phase - 1];
      this.getUp = { tele: null, armed: false };
    } else this.setPose('track');
  }

  private waveGaps(): { a: number; w: number }[] {
    const o = this.origin, gaps: { a: number; w: number; size: number }[] = [];
    for (let i = 0; i < 3; i++) if (this.lit[i]) {
      const b = this.braziers[i], d = Math.hypot(b.x - o.x, b.z - o.z);
      gaps.push({ a: Math.atan2(b.x - o.x, b.z - o.z), w: 2 * Math.atan(4.4 / d), size: 99 });
    }
    for (const f of this.fields) if (f.kind === 'wax' && f.life > 0) {
      const d = Math.max(3, Math.hypot(f.x - o.x, f.z - o.z));
      gaps.push({ a: Math.atan2(f.x - o.x, f.z - o.z), w: 2 * Math.atan(f.r / d), size: f.life });
    }
    // Шейдер рисует не больше четырёх проходов: огонь чаш важнее воска.
    return gaps.sort((p, q) => q.size - p.size).slice(0, 4).map(({ a, w }) => ({ a, w }));
  }

  private launchWave(): void {
    if (!this.canAct) return;
    const o = this.origin;
    this.w.addRingWave(o.x, o.z, this.tune.waveSpeed, 1.6, 22, this.waveGaps(), this.w.hero.maxHp * FUNERAL_HEART.dmg.pulse, -941);
    this.w.bus.emit('shockwave', { x: o.x, z: o.z, r: 6, color: 'hunger', strength: 0.9 });
    this.w.bus.emit('heartPulse', { x: o.x, y: this.body.y, z: o.z });
  }

  private launchOrbs(volley: number): void {
    if (!this.canAct) return;
    const angle = Math.atan2(this.w.hero.x - this.body.x, this.w.hero.z - this.body.z);
    const offsets = volley === 0 ? this.tune.orbs : [-0.16, 0.16];
    for (const offset of offsets) {
      const dx = Math.sin(angle + offset), dz = Math.cos(angle + offset), speed = this.tune.orbSpeed + volley * 0.4;
      this.shots.push({ id: ++this.entityId, x: this.body.x + dx * 2.6, z: this.body.z + dz * 2.6, y: 1.35, r: 0.82,
        vx: dx * speed, vz: dz * speed, alive: true, reflected: false, life: 6 });
    }
    this.w.bus.emit('enemyAttack', { kind: 'shot', x: this.body.x, z: this.body.z });
  }

  private stepShots(dt: number): void {
    const h = this.w.hero;
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) { s.alive = false; continue; }
      if (!s.reflected && h.inPerfectWindow && (Math.hypot(s.x - h.x, s.z - h.z) <= s.r + 1.6 ||
        segmentDistance(s.x, s.z, h.dashFromX, h.dashFromZ, h.x, h.z) <= s.r + 0.8)) {
        this.reflect(s);
        this.w.enemyStrike({ x: s.x, z: s.z, id: -941, kind: 'Погребальное Сердце' }, { k: 'circle', x: s.x, z: s.z, r: s.r + 1.2 }, 0, 0);
      }
      const oldX = s.x, oldZ = s.z;
      if (s.reflected) {
        const dx = this.body.x - s.x, dz = this.body.z - s.z, d = Math.hypot(dx, dz) || 1;
        s.vx = dx / d * 17; s.vz = dz / d * 17;
      }
      s.x += s.vx * dt; s.z += s.vz * dt;
      if (s.reflected) {
        for (let i = 0; i < 3; i++) if (!this.lit[i] && segmentDistance(this.braziers[i].x, this.braziers[i].z, oldX, oldZ, s.x, s.z) <= 1.8) this.ignite(i, false);
        if (!this.active) return;
        if (segmentDistance(this.body.x, this.body.z, oldX, oldZ, s.x, s.z) <= this.body.r + s.r) {
          s.alive = false; this.metrics.reflectedHits++;
          this.damage(FUNERAL_HEART.reflectionDamage, 'reflection');
          this.w.bus.emit('projectileHit', { x: s.x, z: s.z, kind: 'heartReturn' });
          if (this.active && this.dying === 0) this.knockDown(Math.atan2(h.x, h.z - this.centerZ + 0.5), FUNERAL_HEART.knockdown[this.phase - 1]);
        }
      } else if (segmentDistance(h.x, h.z, oldX, oldZ, s.x, s.z) <= h.radius + s.r) {
        const result = this.w.enemyStrike({ x: oldX - s.vx, z: oldZ - s.vz, id: -941, kind: 'Погребальное Сердце' }, { k: 'circle', x: s.x, z: s.z, r: s.r + 0.1 }, h.maxHp * FUNERAL_HEART.dmg.orb, 2);
        if (result === 'perfect') this.reflect(s);
        else if (result !== 'miss' && result !== 'immune') s.alive = false;
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) if (!this.shots[i].alive) this.shots.splice(i, 1);
  }

  private reflect(s: HeartShot): void {
    if (!s.alive || s.reflected || !this.canAct) return;
    s.reflected = true; s.life = 6;
    this.w.bus.emit('censer', { kind: 'deflect', x: s.x, z: s.z });
    this.w.bus.emit('shockwave', { x: s.x, z: s.z, r: 1.5, color: 'void', strength: 0.55 });
  }

  private reflectNear(x: number, z: number, sx: number, sz: number): void {
    if (!this.canAct) return;
    for (const shot of this.shots) if (segmentDistance(shot.x, shot.z, sx, sz, x, z) <= shot.r + 1.6) this.reflect(shot);
  }

  private slash(event: GameEvents['slash']): void {
    if (!this.canAct) return;
    const key = `${this.swingId}:${event.second ? 1 : 0}`;
    if (this.slashKeys.has(key) && this.w.time - this.lastSlashAt < 0.18) return;
    this.slashKeys.add(key); this.lastSlashAt = this.w.time;
    const shape = slashShape(event), charged = event.move === 'charged' || this.w.hero.state === 'charged';
    for (const shot of this.shots) if (overlaps(shape, shot.x, shot.z, shot.r + 0.25)) this.reflect(shot);
    // Раскалённую чашу зажигает любой удар клинком; заряженный возвращает огонь сильнее.
    for (let i = 0; i < 3; i++) if (!this.lit[i] && this.heat[i] >= FUNERAL_HEART.igniteHeat && overlaps(shape, this.braziers[i].x, this.braziers[i].z, 1.35)) this.ignite(i, charged);
    if (!this.active || this.dying > 0) return;
    if (charged) {
      for (const field of [...this.fields]) if (field.kind === 'wax' && field.life > 0 && overlaps(shape, field.x, field.z, field.r)) {
        // Воск жжёт Сердце, но не сбивает: сбивают только падение мимо героя, отбитая сфера и огонь чаши.
        field.life = 0; this.counterPulse(field.x, field.z, FUNERAL_HEART.waxDamage, false);
        if (!this.active || this.dying > 0) return;
      }
    }
    if (!overlaps(shape, this.body.x, this.body.z, this.body.r) || this.body.y > 4.2) return;
    const move = [...VOID_BLADE.combo, VOID_BLADE.flurry, VOID_BLADE.lunge, VOID_BLADE.rising, VOID_BLADE.skycut, VOID_BLADE.skyfall, VOID_BLADE.cross, VOID_BLADE.counter].find(m => m.id === event.move);
    const mult = charged ? (this.w.hero.chargeLevel >= 2 ? 4.5 : 3) : (move?.dmg ?? 1);
    const h = this.w.hero, perfect = h.consumePerfectBuff();
    const result = computeDamage({ ...h.stats, forceCrit: perfect }, mult, 0, false, () => this.w.rng.next(), perfect ? 1.3 : 1);
    this.metrics.bodyHits++;
    const open = this.exposed > 0;
    this.damage(result.dmg, 'body');
    h.addResonance(open ? (charged || move?.finisher ? RESONANCE.perFinisher : RESONANCE.perHit) : 0);
    this.w.rank.hit(charged || !!move?.finisher); this.w.rank.used('blade');
    if (open) this.w.bus.emit('strike', { n: 1, crit: result.crit, feel: charged ? 'heavy' : (move?.feel ?? 'light'), x: this.body.x, z: this.body.z,
      dirX: Math.sin(event.facing), dirZ: Math.cos(event.facing), source: 'blade', moveId: event.move, boss: true });
  }

  private ability(event: GameEvents['ability']): void {
    if (!this.canAct) return;
    const h = this.w.hero;
    const shape: Shape = event.id === 'crescent'
      ? { k: 'line', x: event.x, z: event.z, dx: Math.sin(h.facing), dz: Math.cos(h.facing), len: 8, w: 2.5 }
      : { k: 'circle', x: event.x, z: event.z, r: event.id === 'well' ? 4.5 : 3.5 };
    if (!overlaps(shape, this.body.x, this.body.z, this.body.r)) return;
    const perfect = h.consumePerfectBuff();
    const result = computeDamage({ ...h.stats, dmgBonus: h.stats.dmgBonus + h.stats.abilityDmg, forceCrit: perfect },
      event.id === 'well' ? 2.4 : 1.8, 0, false, () => this.w.rng.next(), perfect ? 1.3 : 1);
    this.metrics.bodyHits++; this.damage(result.dmg, 'body');
    h.addResonance(RESONANCE.perHit); this.w.rank.hit(false); this.w.rank.used(event.id);
  }

  private ignite(index: number, charged: boolean): void {
    if (!this.canAct || this.lit[index]) return;
    this.lit[index] = true; this.flameLife[index] = FUNERAL_HEART.flameSeconds; this.heat[index] = 0;
    const b = this.braziers[index];
    this.counterPulse(b.x, b.z, FUNERAL_HEART.counterDamage * (charged ? 1.4 : 1), true);
  }

  private counterPulse(x: number, z: number, damage: number, knock: boolean): void {
    if (!this.canAct) return;
    this.metrics.counters++;
    this.fields.push({ id: ++this.entityId, x, z, r: 4.5, life: 0.9, dur: 0.9, kind: 'counter' });
    this.w.bus.emit('shockwave', { x, z, r: 8, color: 'gold', strength: 1 });
    this.w.bus.emit('heartCounter', { x, z, tx: this.body.x, ty: this.body.y, tz: this.body.z });
    this.w.heroRing(x, z, 5, 12, 1.6, 28);
    this.damage(damage, 'counter');
    if (!this.active || this.dying > 0 || !knock) return;
    // Огонь чаши бьёт в Сердце и сбрасывает его на кольцо — в сторону огня.
    this.knockDown(Math.atan2(x, z - this.centerZ + 0.5), FUNERAL_HEART.counterDown[this.phase - 1]);
    this.nextAttack = Math.max(this.nextAttack, 1.2);
  }

  private damage(amount: number, source: 'body' | 'counter' | 'reflection'): void {
    if (!this.canAct || !Number.isFinite(amount) || amount <= 0) return;
    const b = this.body;
    // Ярость неуязвима, закрытая броня гасит клинок: искры и звон металла.
    if (this.pose === 'rage' || (source === 'body' && this.exposed <= 0)) {
      if (this.w.time - this.lastClank > 0.15) {
        this.lastClank = this.w.time; this.metrics.clanks++;
        this.w.bus.emit('heartClank', { x: b.x, y: b.y, z: b.z });
      }
      if (this.pose === 'rage') return;
    }
    const mul = source === 'body' ? (this.exposed > 0 ? 1 : FUNERAL_HEART.armor) : 1;
    const dealt = Math.max(1, Math.round(amount * mul));
    // Одна серия не перепрыгивает фазу: HP останавливается на пороге, затем ярость.
    const gate = this.phase === 1 ? this.maxHp * 2 / 3 : this.phase === 2 ? this.maxHp / 3 : 0;
    const before = this.hp;
    this.hp = Math.max(Math.round(gate), this.hp - dealt);
    this.w.run.dmgDealt += before - this.hp; this.hitFlash = 1;
    if (this.hp <= 0) { this.beginDying(); return; }
    if (this.hp <= gate && this.phase < 3) this.beginRage((this.phase + 1) as 2 | 3);
  }

  private beginRage(phase: 2 | 3): void {
    this.phase = phase; this.phaseSpawns = 0;
    this.cancelAttack(); this.getUp = null; this.knock = null; this.fall = null;
    this.exposed = 0; this.setPose('rage'); this.rage = 0;
    this.w.bus.emit('bossPhase', { phase });
    this.w.bus.emit('heartRage', { x: this.body.x, y: this.body.y, z: this.body.z, phase });
    this.w.bus.emit('shockwave', { x: this.body.x, z: this.body.z, r: 10, color: 'hunger', strength: 1 });
  }

  private spawnCarriers(): void {
    if (!this.canAct) return;
    const count = Math.min(this.carriers.size ? 1 : 2, FUNERAL_HEART.maxCarriers - this.carriers.size, FUNERAL_HEART.carriersPerPhase - this.phaseSpawns);
    for (let i = 0; i < count; i++) {
      // Носильщики выходят между чашами: чтобы их огонь вернулся в чашу, их надо туда привести.
      const index = this.metrics.spawnedTotal % 3, a = [0, 2.2, -2.2][index];
      const p = { x: Math.sin(a) * 10.5, z: this.centerZ - 0.5 + Math.cos(a) * 9 };
      this.w.arena.nearestWalkable(p.x, p.z, p);
      const reaper = this.phase > 1 && this.phaseSpawns % (this.phase === 3 ? 2 : 3) === 1;
      const enemy = createEnemy(reaper ? 'reaper' : 'husk', { zone: this.w.zone, stage: this.w.stage, mode: this.w.mode, hpMul: 0.85 });
      enemy.x = p.x; enemy.z = p.z;
      this.carriers.set(enemy.id, enemy); this.w.addEnemy(enemy);
      this.phaseSpawns++; this.metrics.spawnedTotal++;
    }
  }

  private carrierDied(id: number, x: number, z: number): void {
    if (!this.carriers.delete(id) || !this.canAct) return;
    this.fields.push({ id: ++this.entityId, x, z, r: 2.05, life: FUNERAL_HEART.waxSeconds, dur: FUNERAL_HEART.waxSeconds, kind: 'wax' });
    for (let i = 0; i < 3; i++) if (Math.hypot(x - this.braziers[i].x, z - this.braziers[i].z) <= 3) this.ignite(i, false);
  }

  private stepFields(dt: number): void {
    for (const field of this.fields) field.life -= dt;
    for (let i = this.fields.length - 1; i >= 0; i--) if (this.fields[i].life <= 0) this.fields.splice(i, 1);
  }

  private cancelAttack(): void {
    if (this.sequence) for (const t of this.sequence.telegraphs) t.alive = false;
    if (this.getUp?.tele) this.getUp.tele.alive = false;
    this.sequence = null; this.attack = null;
    // Сорванное падение: Сердце возвращается к колодцу, а не застывает в воздухе.
    if (this.pose === 'track' || this.pose === 'lock' || this.pose === 'fall') { this.fall = null; this.setPose('rise'); }
  }

  // ------------------------------------------------------------------ гибель

  private beginDying(): void {
    if (this.dying > 0 || this.dead) return;
    this.cancelAttack(); this.getUp = null; this.knock = null; this.fall = null;
    this.exposed = 0; this.open = 1; this.deathT = 0; this.dying = 0.0001;
    this.setPose('dying');
    // Disable the encounter first: cleanup kills cannot create fresh fire or counters.
    this.cleanup();
    this.w.bus.emit('heartDying', { x: this.body.x, y: this.body.y, z: this.body.z });
  }

  private stepDying(dt: number): void {
    this.deathT += dt;
    this.dying = Math.max(0.0001, Math.min(1, this.deathT / FUNERAL_HEART.dying));
    const b = this.body;
    // Ядро сжимается и дрожит, потом лопается — огонь возвращается волной.
    b.y += ((this.burst ? 1.4 : 2.4) - b.y) * (1 - Math.exp(-dt * 3));
    if (!this.burst && this.deathT >= FUNERAL_HEART.burstAt) {
      this.burst = true;
      this.w.bus.emit('heartBurst', { x: b.x, y: b.y, z: b.z });
      this.w.bus.emit('bossDeath', { x: b.x, z: b.z });
    }
    if (this.deathT >= FUNERAL_HEART.dying && !this.dead) this.defeat();
  }

  private defeat(): void {
    if (this.dead) return;
    this.dead = true; this.active = false; this.enabled = false; this.dying = 1;
    this.lit.fill(true); this.flameLife.fill(FUNERAL_HEART.flameSeconds);
    this.onDefeated?.();
  }

  private cleanup(): void {
    this.cancelAttack(); this.shots.length = 0; this.fields.length = 0;
    // Волны Сердца, ещё бегущие по залу, исчезают вместе с ним.
    for (const r of this.w.ringWaves) if (r.owner === -941) r.alive = false;
    this.w.ringWaves = this.w.ringWaves.filter(r => r.alive);
    for (const enemy of this.carriers.values()) if (!enemy.dead) this.w.killEnemy(enemy, 0, 0, 0);
    this.carriers.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.active = false; this.enabled = false;
    this.w.aimTargets.delete(this.aimTarget);
    this.cleanup(); for (const off of this.offs) off(); this.onDefeated = null;
  }
}

function slashShape(event: GameEvents['slash']): Shape {
  const h = event.hit, dx = Math.sin(event.facing), dz = Math.cos(event.facing);
  switch (h.shape) {
    case 'arc': return { k: 'arc', x: event.x, z: event.z, r: h.radius * event.reach, dir: event.facing, half: h.angle * Math.PI / 360 };
    case 'circle': return { k: 'circle', x: event.x + dx * (h.offset ?? 0), z: event.z + dz * (h.offset ?? 0), r: h.radius * event.reach };
    case 'line': return { k: 'line', x: event.x - dx * LINE_BACK, z: event.z - dz * LINE_BACK, dx, dz, len: h.length * event.reach, w: h.width };
  }
}

function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
