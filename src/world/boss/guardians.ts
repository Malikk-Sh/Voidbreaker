import * as THREE from 'three';
import { angleOf } from '../../core/math';
import { BipedGait, bipedJoints, setJoint, type BipedJoints } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { bruteRig } from '../../gen/chars/enemies';
import type { SpawnOpts } from '../enemy';
import { resetStunHabit } from '../actor';
import type { StunKind } from '../../data/weapons';
import type { StrikeParams } from '../world';
import { registerEnemy } from '../enemies/factory';
import type { World } from '../world';
import { ScriptedEnemy, type PoseLib } from './scripted';
import type { Pattern, Step } from './timeline';

const _p = new THREE.Vector3();
const _b = { x: 0, y: 0, z: 0 };

/** Колокол Звонаря (план §7.4): полный заряд в спину (угол к взгляду > 100°) — кольцо героя и +30 оглушения. */
export const BELL_BACK_DEG = 100;
export const BELL_STUN = 30;
const BELL_RING_R = 7, BELL_RING_SPEED = 16, BELL_RING_MULT = 1.6;
/** Колокольный плен: кольцо цепей вокруг героя с двумя разрывами; цепь — стена на 4 с. */
export const CHAIN_R = 3.2;
export const CHAIN_DUR = 4;
const CHAIN_N = 9, CHAIN_HIT_R = 0.75, CHAIN_WALL_R = 0.5;
/** Страж Врат (план §7.5): после серии алебарда застревает в полу; рывок на древко — пробежка к шлему и +40. */
export const HALBERD_STUCK = 2.5;
export const SHAFT_STUN = 40;
const SHAFT_RUN = 0.3, SHAFT_LEAP = 0.18, SHAFT_FLIP = 0.42, SHAFT_TOUCH = 0.8;
const K_GATE = 1.65;
/** Похоронный такт: три удара с неравными интервалами; в ярости ритм другой. */
export const FUNERAL_BEATS: Record<1 | 2, number[]> = { 1: [0.9, 1.3, 2.2], 2: [0.9, 1.75, 2.05] };
/** Порог ярости: на 50 % HP страж ревёт и переходит во вторую фазу. */
const RAGE_AT = 0.5;

/** Общие позы тяжёлого двуногого стража (Эйлер, рад). */
const BRUTE_POSES: PoseLib = {
  idle: { shR: [-0.45, 0, -0.25], elbR: [-0.7, 0, 0], shL: [-0.3, 0, 0.3], elbL: [-0.5, 0, 0] },
  sweepWind: { chest: [0.1, -0.95, 0], spine: [0, -0.3, 0], shR: [-1.25, 0, -1.0], elbR: [-0.25, 0, 0], shL: [-0.6, 0, 0.6], hipL: [-0.3, 0, 0.1], kneeL: [0.5, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.4, 0, 0] },
  sweep: { chest: [0.15, 1.05, 0], spine: [0, 0.35, 0], shR: [-1.35, 0, 0.7], elbR: [-0.05, 0, 0], shL: [0.3, 0, 0.6], hipL: [0.1, 0, 0.1], kneeL: [0.3, 0, 0], hipR: [-0.4, 0, -0.1], kneeR: [0.6, 0, 0] },
  thrustWind: { chest: [0.2, -0.45, 0], shR: [0.4, 0, -0.35], elbR: [-1.5, 0, 0], shL: [-1.0, 0, 0.4], hipL: [-0.6, 0, 0.1], kneeL: [0.9, 0, 0], hipR: [0.4, 0, -0.1], kneeR: [0.5, 0, 0] },
  thrust: { chest: [0.45, 0.15, 0], spine: [0.2, 0, 0], shR: [-1.55, 0, 0.05], elbR: [0, 0, 0], shL: [0.5, 0, 0.5], hipL: [-1.0, 0, 0.1], kneeL: [0.6, 0, 0], hipR: [0.7, 0, -0.1], kneeR: [0.2, 0, 0] },
  raise: { chest: [-0.35, 0, 0], spine: [-0.15, 0, 0], shR: [-2.9, 0, -0.25], elbR: [-0.4, 0, 0], shL: [-2.9, 0, 0.25], elbL: [-0.4, 0, 0], head: [0.3, 0, 0] },
  slam: { chest: [0.75, 0, 0], spine: [0.3, 0, 0], shR: [-0.7, 0, -0.15], elbR: [0, 0, 0], shL: [-0.7, 0, 0.15], elbL: [0, 0, 0], hipL: [-0.7, 0, 0.15], kneeL: [1.1, 0, 0], hipR: [-0.6, 0, -0.15], kneeR: [1.0, 0, 0], head: [-0.3, 0, 0] },
  crouch: { chest: [0.5, 0, 0], shR: [0.6, 0, -0.5], shL: [0.6, 0, 0.5], hipL: [-1.1, 0, 0.15], kneeL: [1.6, 0, 0], hipR: [-1.0, 0, -0.15], kneeR: [1.5, 0, 0], footL: [-0.4, 0, 0], footR: [-0.4, 0, 0] },
  air: { chest: [-0.2, 0, 0], shR: [-2.6, 0, -0.4], shL: [-2.6, 0, 0.4], hipL: [-1.2, 0, 0.1], kneeL: [1.8, 0, 0], hipR: [-0.6, 0, -0.1], kneeR: [1.4, 0, 0] },
  ringWind: { chest: [-0.2, -0.6, 0], shR: [-2.7, 0, -0.5], elbR: [-0.3, 0, 0], shL: [-0.8, 0, 0.7] },
  ring: { chest: [0.6, 0.3, 0], spine: [0.25, 0, 0], shR: [-1.0, 0, 0.2], elbR: [0, 0, 0], shL: [0.2, 0, 0.6], hipL: [-0.5, 0, 0.1], kneeL: [0.8, 0, 0], hipR: [-0.3, 0, -0.1], kneeR: [0.6, 0, 0] },
  summon: { chest: [-0.3, 0, 0], head: [0.5, 0, 0], shL: [-2.4, 0, 0.9], shR: [-2.4, 0, -0.9], elbL: [-0.3, 0, 0], elbR: [-0.3, 0, 0] },
  roar: { chest: [-0.45, 0, 0], spine: [-0.2, 0, 0], head: [-0.6, 0, 0], shL: [-1.2, 0, 1.4], shR: [-1.2, 0, -1.4], elbL: [-0.9, 0, 0], elbR: [-0.9, 0, 0], hipL: [-0.2, 0, 0.25], kneeL: [0.4, 0, 0], hipR: [-0.2, 0, -0.25], kneeR: [0.4, 0, 0] },
  backWind: { chest: [0.1, 0.95, 0], spine: [0, 0.3, 0], shR: [-1.3, 0, 0.9], elbR: [-0.2, 0, 0], shL: [-0.4, 0, 0.3], hipL: [0.2, 0, 0.1], kneeL: [0.4, 0, 0], hipR: [-0.3, 0, -0.1], kneeR: [0.5, 0, 0] },
  backSweep: { chest: [0.15, -1.1, 0], spine: [0, -0.35, 0], shR: [-1.3, 0, -1.1], elbR: [-0.05, 0, 0], shL: [-0.7, 0, 0.7], hipL: [-0.4, 0, 0.1], kneeL: [0.6, 0, 0], hipR: [0.1, 0, -0.1], kneeR: [0.3, 0, 0] },
  charge: { chest: [0.7, 0, 0], spine: [0.3, 0, 0], head: [-0.5, 0, 0], shR: [-0.3, 0, -0.6], elbR: [-1.2, 0, 0], shL: [-0.3, 0, 0.6], elbL: [-1.2, 0, 0], hipL: [-1.0, 0, 0.1], kneeL: [0.9, 0, 0], hipR: [0.6, 0, -0.1], kneeR: [0.5, 0, 0] },
  // алебарда застряла в полу после серии: корпус наклонён, правая рука держит древко у лезвия
  stuck: { chest: [0.6, 0, 0], spine: [0.2, 0, 0], shR: [-0.55, 0, 0.1], elbR: [0.2, 0, 0], shL: [-0.5, 0, 0.3], elbL: [-0.6, 0, 0], hipL: [-0.5, 0, 0.1], kneeL: [0.7, 0, 0], hipR: [0.3, 0, -0.1], kneeR: [0.4, 0, 0], head: [-0.2, 0, 0] },
  broken: { chest: [0.7, 0, 0.15], spine: [0.3, 0, 0], shL: [0.35, 0, 0.5], shR: [0.35, 0, -0.5], hipL: [-1.45, 0, 0.2], kneeL: [1.55, 0, 0], hipR: [0.1, 0, -0.2], kneeR: [1.6, 0, 0], head: [-0.4, 0, 0] },
};

const RAGE: Pattern = {
  id: 'rage', weight: 0, cooldown: 0, phases: [], unstoppable: true,
  steps: [
    { t: 0, do: 'pose', id: 'crouch', blend: 0.12 },
    { t: 0.35, do: 'pose', id: 'roar', blend: 0.06 },
    { t: 0.35, do: 'sfx', id: 'boss_roar' },
    { t: 0.38, do: 'fx', id: 'shockwave', at: 'self', r: 10 },
    { t: 0.38, do: 'fx', id: 'impact', at: 'self', r: 3 },
    { t: 0.38, do: 'shake', trauma: 0.7 },
  ],
  dur: 1.7,
};

/** Таран: три отрезка линии вдоль пути, страж проносится насквозь и спотыкается (окно 1.6 с). */
function chargeSteps(e: ScriptedEnemy, len: number, w: number, dmg: number): Step[] {
  const h = e.w_.hero;
  const a = angleOf(h.x - e.x, h.z - e.z);
  const sx = Math.sin(a), sz = Math.cos(a);
  const start = { x: e.x, z: e.z }, end = { x: e.x + sx * len, z: e.z + sz * len };
  const steps: Step[] = [
    { t: 0, do: 'turn', to: end },
    { t: 0, do: 'pose', id: 'thrustWind', blend: 0.3 },
    { t: 0, do: 'telegraph', shape: { line: [len, w] }, at: start, dir: end, dur: 1.3 },
    { t: 0, do: 'telegraphSound', kind: 'roar' },
    { t: 0.55, do: 'pose', id: 'charge', blend: 0.25 },
    { t: 1.0, do: 'move', to: end, dur: 0.38, ease: 'outCubic' },
    { t: 1.0, do: 'sfx', id: 'swing_heavy' },
  ];
  const seg = len / 3;
  for (let i = 0; i < 3; i++) {
    const p = { x: start.x + sx * seg * i, z: start.z + sz * seg * i };
    steps.push({ t: 1.0 + i * 0.12, do: 'hitbox', shape: { line: [seg + 0.6, w] }, at: p, dir: end, dmg, kb: 9 });
    steps.push({ t: 1.0 + i * 0.12, do: 'fx', id: 'dust', at: p, r: 1.6 });
  }
  steps.push({ t: 1.4, do: 'fx', id: 'impact', at: 'self', r: 2.4 }, { t: 1.4, do: 'shake', trauma: 0.4 });
  steps.push({ t: 1.42, do: 'pose', id: 'crouch', blend: 0.12 }, { t: 1.45, do: 'vulnerable', dur: 1.6 });
  return steps;
}

abstract class BruteGuardian extends ScriptedEnemy {
  private gait: BipedGait;
  private J: BipedJoints;
  private lastStep = 0;

  constructor(kind: 'gateGuardian' | 'bellRinger', scale: number, o: SpawnOpts) {
    const layout = layoutOf(bruteRig(kind, scale));
    super(ENEMIES[kind], layout, o);
    this.J = bipedJoints(layout);
    this.gait = new BipedGait(2.8 * scale / 1.65, 2.2, true);
    this.approach = 2.6;
  }

  protected poses(): PoseLib { return BRUTE_POSES; }

  /** Замах стягивается к оружию в правой руке. */
  override windupPoint(out: { x: number; y: number; z: number }): void {
    const L = this.puppet.layout;
    this.puppet.skel.jointPoint(L.idx('handR'), 0, -0.6, 0, _p);
    out.x = _p.x; out.y = _p.y; out.z = _p.z;
  }

  override get invulnerable(): boolean { return this.cur?.id === 'rage'; }

  /** Ярость (50 % HP): рёв, ударная волна, ускорение шага, новые приёмы второй фазы. */
  override onDamaged(w: World, dmg: number, before: number): void {
    super.onDamaged(w, dmg, before);
    if (this.phase !== 1 || this.dead || this.hp > this.maxHp * RAGE_AT) return;
    this.phase = 2;
    if (this.stun) resetStunHabit(this.stun);
    this.speed *= 1.15;
    this.rageQueued = true;
  }

  private rageQueued = false;

  protected override think(w: World, dt: number, tick: boolean): void {
    // ярость ждёт конца оглушения — рёв не обрывает окно наказания (и заменяет рёв пробуждения)
    if (this.rageQueued && this.state !== 'stunned' && !this.move) {
      this.awakenQueued = false;
      this.rageQueued = false;
      this.startPattern(RAGE);
      w.bus.emit('guardianRage', { x: this.x, z: this.z, kind: this.kind });
    }
    super.think(w, dt, tick);
  }

  protected animate(dt: number, w: World): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot;
    const sp = Math.hypot(this.vx, this.vz);
    const walking = !this.cur && this.state !== 'stunned';
    this.gait.update(sp * dt, walking ? sp : 0, 0, dt);
    this.gait.write(out, L, this.J, false);
    const st = Math.floor(this.gait.phase * 2);
    if (st !== this.lastStep && walking && sp > 0.4) { this.lastStep = st; w.bus.emit('impact', { x: this.x, z: this.z, r: 1.6, kind: 'land' }); }
    const pose = this.blendPose(dt);
    for (const [j, e] of pose) setJoint(out, L, j, e[0], e[1], e[2]);
    s.x = this.x; s.z = this.z; s.facing = this.facing;
    s.y = this.y + this.gait.bob * 1.4 - (this.state === 'stunned' ? 0.7 : 0);
    s.tiltX = this.puppet.springZ * 0.06; s.tiltZ = -this.puppet.springX * 0.06;
    s.update();
    this.puppet.boost = this.coreGlow * 1.2 + (this.vulnerableT > 0 ? 0.5 : 0);
    this.coreGlow = Math.max(0, this.coreGlow - dt);
  }
}

/** Страж Врат (1-3): гигантский голем с алебардой (GDD §9.3). Вторая фаза — серия из трёх ударов и разломы. */
export class GateGuardian extends BruteGuardian {
  patterns: Pattern[] = [
    {
      id: 'sweep', weight: 3, cooldown: 2, range: [0, 6.5], phases: [1, 2],
      steps: [
        { t: 0, do: 'pose', id: 'sweepWind', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { arc: [5.4, 200] }, at: 'self', dur: 0.9 },
        { t: 0, do: 'telegraphSound', kind: 'whistle' },
        { t: 0.9, do: 'pose', id: 'sweep', blend: 0.04 },
        { t: 0.9, do: 'hitbox', shape: { arc: [5.4, 200] }, at: 'self', dmg: 0.2, kb: 6 },
        { t: 0.9, do: 'sfx', id: 'swing_heavy' },
        { t: 0.92, do: 'shake', trauma: 0.25 },
        { t: 1.0, do: 'vulnerable', dur: 1.0 },
      ],
    },
    {
      id: 'thrust', weight: 2, cooldown: 4, range: [2, 10], phases: [1, 2],
      steps: [
        { t: 0, do: 'turn', to: 'player' },
        { t: 0, do: 'pose', id: 'thrustWind', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { line: [9, 1.8] }, at: 'self', dur: 0.9 },
        { t: 0, do: 'telegraphSound', kind: 'whistle' },
        { t: 0.9, do: 'pose', id: 'thrust', blend: 0.04 },
        { t: 0.9, do: 'hitbox', shape: { line: [9, 1.8] }, at: 'self', dmg: 0.24, kb: 7 },
        { t: 0.9, do: 'sfx', id: 'slash_enemy' },
        { t: 0.95, do: 'shake', trauma: 0.2 },
        { t: 1.0, do: 'vulnerable', dur: 1.3 },
      ],
    },
    {
      id: 'slam', weight: 2, cooldown: 5, range: [0, 5], phases: [1, 2],
      steps: [
        { t: 0, do: 'pose', id: 'raise', blend: 0.45 },
        { t: 0, do: 'telegraph', shape: { circle: 3.9 }, at: 'self', dur: 1.1 },
        { t: 0, do: 'telegraphSound', kind: 'roar' },
        { t: 1.1, do: 'pose', id: 'slam', blend: 0.04 },
        { t: 1.1, do: 'hitbox', shape: { circle: 3.9 }, at: 'self', dmg: 0.3, kb: 8 },
        { t: 1.1, do: 'fx', id: 'impact', at: 'front', r: 3.9 },
        { t: 1.12, do: 'ringwave', at: 'self', speed: 7, width: 0.8, maxR: 15, gaps: 2, gapW: 0.9, dmg: 0.14 },
        { t: 1.12, do: 'shake', trauma: 0.5 },
        { t: 1.2, do: 'vulnerable', dur: 1.5 },
      ],
    },
    {
      id: 'leap', weight: 2, cooldown: 6, range: [5, 30], phases: [1, 2],
      steps: [
        { t: 0, do: 'pose', id: 'crouch', blend: 0.2 },
        { t: 0, do: 'telegraph', shape: { circle: 3.3 }, at: 'snapshot', dur: 1.05 },
        { t: 0, do: 'telegraphSound', kind: 'roar' },
        { t: 0.3, do: 'move', to: 'snapshot', dur: 0.75, arc: 4.5, ease: 'inOutQuad' },
        { t: 0.32, do: 'pose', id: 'air', blend: 0.1 },
        { t: 1.0, do: 'pose', id: 'slam', blend: 0.04 },
        { t: 1.05, do: 'hitbox', shape: { circle: 3.3 }, at: 'self', dmg: 0.28, kb: 8 },
        { t: 1.05, do: 'fx', id: 'impact', at: 'self', r: 3.3 },
        { t: 1.05, do: 'shake', trauma: 0.55 },
        { t: 1.1, do: 'vulnerable', dur: 1.6 },
      ],
    },
    // Таран: опускает алебарду и проносится сквозь арену
    { id: 'charge', weight: 2, cooldown: 7, range: [6, 30], phases: [1, 2], unstoppable: true, steps: [], build: () => chargeSteps(this, 13, 2.4, 0.26) },
    // Вторая фаза: размах — обратный размах — выпад, каждый доворачивает на героя
    {
      id: 'combo', weight: 3, cooldown: 5, range: [0, 7], phases: [2], unstoppable: true,
      steps: [
        { t: 0, do: 'pose', id: 'sweepWind', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { arc: [5.2, 170] }, at: 'self', dur: 0.85 },
        { t: 0, do: 'telegraphSound', kind: 'whistle' },
        { t: 0.85, do: 'pose', id: 'sweep', blend: 0.04 },
        { t: 0.85, do: 'hitbox', shape: { arc: [5.2, 170] }, at: 'self', dmg: 0.17, kb: 4 },
        { t: 0.85, do: 'sfx', id: 'swing_heavy' },
        { t: 0.9, do: 'resnap' },
        { t: 0.9, do: 'pose', id: 'backWind', blend: 0.2 },
        { t: 0.9, do: 'telegraph', shape: { arc: [5.2, 170] }, at: 'self', dur: 0.8 },
        { t: 1.7, do: 'pose', id: 'backSweep', blend: 0.04 },
        { t: 1.7, do: 'hitbox', shape: { arc: [5.2, 170] }, at: 'self', dmg: 0.17, kb: 4 },
        { t: 1.7, do: 'sfx', id: 'swing_heavy' },
        { t: 1.75, do: 'resnap' },
        { t: 1.75, do: 'pose', id: 'thrustWind', blend: 0.2 },
        { t: 1.75, do: 'telegraph', shape: { line: [10, 2] }, at: 'self', dur: 0.85 },
        { t: 1.75, do: 'telegraphSound', kind: 'roar' },
        { t: 2.6, do: 'pose', id: 'thrust', blend: 0.04 },
        { t: 2.6, do: 'hitbox', shape: { line: [10, 2] }, at: 'self', dmg: 0.26, kb: 8 },
        { t: 2.6, do: 'sfx', id: 'slash_enemy' },
        { t: 2.62, do: 'shake', trauma: 0.35 },
        // алебарда застревает в полу на 2.5 с: окно наказания и древко-мост к шлему
        { t: 2.62, do: 'pose', id: 'stuck', blend: 0.1 },
        { t: 2.66, do: 'call', fn: 'stick' },
        { t: 2.66, do: 'vulnerable', dur: HALBERD_STUCK },
        { t: 2.66 + HALBERD_STUCK, do: 'call', fn: 'unstick' },
        { t: 2.66 + HALBERD_STUCK, do: 'pose', id: 'idle', blend: 0.25 },
      ],
    },
    // Вторая фаза: алебарда в пол — три разлома веером к герою
    { id: 'quake', weight: 2, cooldown: 8, phases: [2], unstoppable: true, steps: [], build: () => this.quakeSteps() },
  ];
  constructor(o: SpawnOpts) { super('gateGuardian', 1.65, o); }

  /** Алебарда застряла в полу (с). */
  halberdT = 0;
  /** Идёт пробежка героя по древку. */
  running = false;
  private sparkT = 0;

  /** Древко: от острия у пола к руке (мировые координаты). */
  shaft(): { tx: number; tz: number; hx: number; hy: number; hz: number } {
    const L = this.puppet.layout, s = this.puppet.skel;
    const t = s.jointPoint(L.idx('handR'), 0, -0.25 * K_GATE, 1.9 * K_GATE, _p);
    const tx = t.x, tz = t.z;
    const h = s.jointPoint(L.idx('handR'), 0, -0.25 * K_GATE, 0, _p);
    return { tx, tz, hx: h.x, hy: h.y, hz: h.z };
  }

  protected override onCall(w: World, fn: string): void {
    if (fn === 'stick') {
      this.halberdT = HALBERD_STUCK;
      const sh = this.shaft();
      w.bus.emit('sfx', { id: 'nail', x: sh.tx, z: sh.tz, gain: 1 });
      w.bus.emit('hitReact', { x: sh.tx, y: 0.2, z: sh.tz, kind: 'stones' });
    } else if (fn === 'unstick') this.halberdT = 0;
  }

  protected override think(w: World, dt: number, tick: boolean): void {
    if (this.halberdT > 0) {
      this.halberdT = Math.max(0, this.halberdT - dt);
      // тянет алебарду: искры у острия
      const sh = this.shaft();
      if ((this.sparkT -= dt) <= 0) { this.sparkT = 0.18; w.bus.emit('scrape', { x: sh.tx, y: 0.1, z: sh.tz }); }
      if (!this.running && this.dashOnShaft(w, sh)) this.startShaftRun(w, sh);
    }
    super.think(w, dt, tick);
  }

  /** Рывок на древко: герой в рывке ближе 0.8 м к древку и летит в сторону Стража. */
  private dashOnShaft(w: World, sh: { tx: number; tz: number; hx: number; hz: number }): boolean {
    const h = w.hero;
    if (h.state !== 'dash' || h.dead) return false;
    const bx = sh.hx - sh.tx, bz = sh.hz - sh.tz, l2 = bx * bx + bz * bz || 1;
    const u = Math.max(0, Math.min(1, ((h.x - sh.tx) * bx + (h.z - sh.tz) * bz) / l2));
    const d = Math.hypot(sh.tx + bx * u - h.x, sh.tz + bz * u - h.z);
    const toward = Math.sin(h.facing) * (this.x - h.x) + Math.cos(h.facing) * (this.z - h.z) > 0;
    return d < SHAFT_TOUCH && toward;
  }

  /** Пробежка по древку: вверх к руке, прыжок к шлему, удар сверху (+40 оглушения), сальто назад. */
  private startShaftRun(w: World, sh: { tx: number; tz: number; hx: number; hy: number; hz: number }): void {
    const h = w.hero;
    this.running = true;
    h.freeze(true);
    h.scripted = true;
    h.invulnUntil = Math.max(h.invulnUntil, h.clock + SHAFT_RUN + SHAFT_LEAP + SHAFT_FLIP + 0.3);
    h.avatar.puppet.play('shaftRun', 1, 0.04);
    const L = this.puppet.layout;
    const hd = this.puppet.skel.jointPoint(L.idx('head'), 0, 0.35 * K_GATE, 0.1 * K_GATE, _p);
    const p0 = { x: h.x, z: h.z }, p1 = { x: sh.hx, y: sh.hy, z: sh.hz }, p2 = { x: hd.x, y: hd.y + 0.3, z: hd.z };
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const land = { x: this.x + fx * 4.6, z: this.z + fz * 4.6 };
    w.arena.nearestWalkable(land.x, land.z, land);
    w.bus.emit('shaftRun', { x: h.x, z: h.z });
    let t = 0, struck = false;
    const hook = (dt: number): void => {
      t += dt;
      if (t < SHAFT_RUN) {
        const u = t / SHAFT_RUN;
        h.x = p0.x + (p1.x - p0.x) * u; h.z = p0.z + (p1.z - p0.z) * u; h.y = p1.y * u;
      } else if (t < SHAFT_RUN + SHAFT_LEAP) {
        const u = (t - SHAFT_RUN) / SHAFT_LEAP;
        h.x = p1.x + (p2.x - p1.x) * u; h.z = p1.z + (p2.z - p1.z) * u; h.y = p1.y + (p2.y - p1.y) * u + Math.sin(u * Math.PI) * 0.6;
      } else {
        if (!struck) { struck = true; this.helmetHit(w, p2); }
        const u = Math.min(1, (t - SHAFT_RUN - SHAFT_LEAP) / SHAFT_FLIP);
        h.x = p2.x + (land.x - p2.x) * u; h.z = p2.z + (land.z - p2.z) * u; h.y = p2.y * (1 - u) + Math.sin(u * Math.PI) * 1.2;
      }
      if (t < SHAFT_RUN + SHAFT_LEAP) h.facing = angleOf(this.x - h.x, this.z - h.z);
      h.trailOn = t > SHAFT_RUN && t < SHAFT_RUN + SHAFT_LEAP + 0.08;
      if (t >= SHAFT_RUN + SHAFT_LEAP + SHAFT_FLIP) {
        h.y = 0; h.scripted = false; h.trailOn = false;
        h.freeze(false);
        this.running = false;
        const i = w.stepHooks.indexOf(hook); if (i >= 0) w.stepHooks.splice(i, 1);
      }
    };
    w.stepHooks.push(hook);
  }

  /** Удар в шлем сверху: тяжёлый урон и +40 к оглушению. */
  private helmetHit(w: World, at: { x: number; y: number; z: number }): void {
    const dx = this.x - w.hero.x, dz = this.z - w.hero.z, l = Math.hypot(dx, dz) || 1;
    w.beginStrike();
    w.damageEnemy(this, { mult: 2.5, stun: 0, stunKind: 'other', knockback: 0, feel: 'heavy', dirX: dx / l, dirZ: dz / l, source: 'blade', noStagger: true, moveId: 'shaftRun' });
    w.endStrike({ dirX: dx / l, dirZ: dz / l, source: 'blade', moveId: 'shaftRun' });
    w.addStunTo(this, SHAFT_STUN);
    w.bus.emit('helmetHit', { x: at.x, y: at.y, z: at.z });
  }

  override onStun(): void {
    super.onStun();
    this.halberdT = 0;
  }

  private quakeSteps(): Step[] {
    const h = this.w_.hero;
    const a = angleOf(h.x - this.x, h.z - this.z);
    const steps: Step[] = [
      { t: 0, do: 'turn', to: 'player' },
      { t: 0, do: 'pose', id: 'raise', blend: 0.35 },
      { t: 0, do: 'telegraphSound', kind: 'roar' },
      { t: 1.0, do: 'pose', id: 'slam', blend: 0.04 },
      { t: 1.0, do: 'fx', id: 'impact', at: 'front', r: 2.5 },
      { t: 1.0, do: 'shake', trauma: 0.45 },
    ];
    [-0.5, 0, 0.5].forEach((da, i) => {
      const d = a + da;
      const to = { x: this.x + Math.sin(d) * 20, z: this.z + Math.cos(d) * 20 };
      const t = 1.0 + i * 0.14;
      steps.push({ t: 0, do: 'telegraph', shape: { line: [13, 1.5] }, at: 'self', dir: to, dur: t });
      steps.push({ t, do: 'hitbox', shape: { line: [13, 1.5] }, at: 'self', dir: to, dmg: 0.22, kb: 6 });
      for (let k = 1; k <= 3; k++) steps.push({ t: t + k * 0.05, do: 'fx', id: 'dust', at: { x: this.x + Math.sin(d) * k * 3.6, z: this.z + Math.cos(d) * k * 3.6 }, r: 1.4 });
    });
    steps.push({ t: 1.5, do: 'vulnerable', dur: 1.5 });
    return steps;
  }
}

/** Звонарь (1-6): предвестник Иерофанта, бьёт в колокол, волны-кольца (GDD §9.3). Вторая фаза — какофония. */
export class BellRinger extends BruteGuardian {
  patterns: Pattern[] = [
    {
      id: 'toll', weight: 3, cooldown: 3, phases: [1, 2],
      steps: [
        { t: 0, do: 'pose', id: 'ringWind', blend: 0.3 },
        { t: 0, do: 'telegraph', shape: { circle: 2.6 }, at: 'front', dur: 0.9 },
        { t: 0, do: 'telegraphSound', kind: 'bell' },
        { t: 0.9, do: 'pose', id: 'ring', blend: 0.04 },
        { t: 0.9, do: 'hitbox', shape: { circle: 2.6 }, at: 'front', dmg: 0.2, kb: 6 },
        { t: 0.92, do: 'ringwave', at: 'front', speed: 6.5, width: 0.9, maxR: 17, gaps: 2, gapW: 1.0, dmg: 0.16 },
        { t: 0.92, do: 'sfx', id: 'boss_bell' },
        { t: 0.92, do: 'shake', trauma: 0.35 },
        { t: 1.7, do: 'ringwave', at: 'front', speed: 7.5, width: 0.9, maxR: 17, gaps: 2, gapW: 1.0, dmg: 0.16 },
        { t: 1.7, do: 'sfx', id: 'tele_bell' },
        { t: 1.9, do: 'vulnerable', dur: 1.0 },
      ],
    },
    {
      id: 'swing', weight: 3, cooldown: 2, range: [0, 5.5], phases: [1, 2],
      steps: [
        { t: 0, do: 'pose', id: 'sweepWind', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { arc: [4.6, 180] }, at: 'self', dur: 0.85 },
        { t: 0, do: 'telegraphSound', kind: 'whistle' },
        { t: 0.85, do: 'pose', id: 'sweep', blend: 0.04 },
        { t: 0.85, do: 'hitbox', shape: { arc: [4.6, 180] }, at: 'self', dmg: 0.22, kb: 6 },
        { t: 0.85, do: 'sfx', id: 'swing_heavy' },
        { t: 0.9, do: 'shake', trauma: 0.25 },
        { t: 0.95, do: 'vulnerable', dur: 1.0 },
      ],
    },
    // Резонанс: сначала бьёт кольцо вокруг (спасение — прижаться), затем центр (спасение — отскочить)
    {
      id: 'resonance', weight: 2, cooldown: 7, range: [0, 9], phases: [1, 2], unstoppable: true,
      steps: [
        { t: 0, do: 'call', fn: 'douse', arg: 1.0 },
        { t: 0, do: 'pose', id: 'ringWind', blend: 0.3 },
        { t: 0, do: 'telegraph', shape: { ring: [2.8, 7] }, at: 'self', dur: 1.0 },
        { t: 0, do: 'telegraphSound', kind: 'bell' },
        { t: 1.0, do: 'pose', id: 'ring', blend: 0.04 },
        { t: 1.0, do: 'hitbox', shape: { ring: [2.8, 7] }, at: 'self', dmg: 0.2, kb: 5 },
        { t: 1.0, do: 'sfx', id: 'boss_bell' },
        { t: 1.0, do: 'fx', id: 'shockwave', at: 'self', r: 7 },
        { t: 1.02, do: 'shake', trauma: 0.3 },
        { t: 1.05, do: 'pose', id: 'raise', blend: 0.2 },
        { t: 1.05, do: 'telegraph', shape: { circle: 3.0 }, at: 'self', dur: 0.85 },
        { t: 1.9, do: 'pose', id: 'slam', blend: 0.04 },
        { t: 1.9, do: 'hitbox', shape: { circle: 3.0 }, at: 'self', dmg: 0.24, kb: 8 },
        { t: 1.9, do: 'fx', id: 'impact', at: 'self', r: 3 },
        { t: 1.9, do: 'sfx', id: 'boss_bell' },
        { t: 1.92, do: 'shake', trauma: 0.45 },
        { t: 1.95, do: 'call', fn: 'relight' },
        { t: 2.0, do: 'vulnerable', dur: 1.3 },
      ],
    },
    {
      id: 'summon', weight: 1, cooldown: 14, phases: [1, 2],
      steps: [
        { t: 0, do: 'pose', id: 'summon', blend: 0.4 },
        { t: 0, do: 'telegraphSound', kind: 'roar' },
        { t: 0.6, do: 'summon', enemy: 'husk', count: 6, at: 'edges' },
        { t: 0.6, do: 'sfx', id: 'boss_roar' },
      ],
      dur: 1.8,
    },
    {
      id: 'leap', weight: 2, cooldown: 6, range: [5, 30], phases: [1, 2],
      steps: [
        { t: 0, do: 'pose', id: 'crouch', blend: 0.2 },
        { t: 0, do: 'telegraph', shape: { circle: 3.2 }, at: 'snapshot', dur: 1.05 },
        { t: 0, do: 'telegraphSound', kind: 'roar' },
        { t: 0.3, do: 'move', to: 'snapshot', dur: 0.75, arc: 4, ease: 'inOutQuad' },
        { t: 0.32, do: 'pose', id: 'air', blend: 0.1 },
        { t: 1.0, do: 'pose', id: 'slam', blend: 0.04 },
        { t: 1.05, do: 'hitbox', shape: { circle: 3.2 }, at: 'self', dmg: 0.26, kb: 8 },
        { t: 1.05, do: 'fx', id: 'impact', at: 'self', r: 3.2 },
        { t: 1.06, do: 'ringwave', at: 'self', speed: 6, width: 0.8, maxR: 12, gaps: 3, gapW: 1.1, dmg: 0.12 },
        { t: 1.05, do: 'shake', trauma: 0.5 },
        { t: 1.1, do: 'vulnerable', dur: 1.5 },
      ],
    },
    // Вторая фаза: какофония — три удара с ускоряющимися кольцами, сверху сыплются осколки колокола
    {
      id: 'cacophony', weight: 3, cooldown: 8, phases: [2], unstoppable: true,
      steps: [
        { t: 0, do: 'call', fn: 'douse', arg: 0.9 },
        { t: 0, do: 'pose', id: 'ringWind', blend: 0.3 },
        { t: 0, do: 'telegraph', shape: { circle: 2.6 }, at: 'front', dur: 0.9 },
        { t: 0, do: 'telegraphSound', kind: 'bell' },
        { t: 0.3, do: 'projectiles', pattern: 'rain', count: 5, speed: 0, dmg: 0.14 },
        { t: 0.9, do: 'pose', id: 'ring', blend: 0.04 },
        { t: 0.9, do: 'hitbox', shape: { circle: 2.6 }, at: 'front', dmg: 0.2, kb: 6 },
        { t: 0.92, do: 'ringwave', at: 'front', speed: 6, width: 0.9, maxR: 17, gaps: 2, gapW: 1.1, dmg: 0.15 },
        { t: 0.92, do: 'sfx', id: 'boss_bell' },
        { t: 0.92, do: 'shake', trauma: 0.3 },
        { t: 1.0, do: 'pose', id: 'ringWind', blend: 0.15 },
        { t: 1.5, do: 'pose', id: 'ring', blend: 0.04 },
        { t: 1.52, do: 'ringwave', at: 'front', speed: 7.2, width: 0.9, maxR: 17, gaps: 2, gapW: 1.05, dmg: 0.15 },
        { t: 1.52, do: 'sfx', id: 'boss_bell' },
        { t: 1.6, do: 'projectiles', pattern: 'rain', count: 4, speed: 0, dmg: 0.14 },
        { t: 1.6, do: 'pose', id: 'ringWind', blend: 0.15 },
        { t: 2.1, do: 'pose', id: 'ring', blend: 0.04 },
        { t: 2.12, do: 'ringwave', at: 'front', speed: 8.6, width: 1.0, maxR: 17, gaps: 1, gapW: 1.4, dmg: 0.18 },
        { t: 2.12, do: 'sfx', id: 'boss_bell' },
        { t: 2.14, do: 'shake', trauma: 0.4 },
        { t: 2.2, do: 'call', fn: 'relight' },
        { t: 2.3, do: 'vulnerable', dur: 1.3 },
      ],
    },
    // Колокольный плен: цепи падают кольцом вокруг героя и на 4 с становятся стенами
    { id: 'captivity', weight: 2, cooldown: 12, range: [0, 14], phases: [1, 2], steps: [], build: () => this.chainSteps() },
    // Похоронный такт: три удара с неравными интервалами — звук и пульсация колокола
    { id: 'funeral', weight: 2, cooldown: 9, phases: [1, 2], steps: [], build: () => this.funeralSteps() },
  ];
  /** Точки цепей текущего плена. */
  chainPts: { x: number; z: number }[] = [];
  /** Вспышка колокола (визуальный дубль звука). */
  bellFlash = 0;
  private douseT = 0; private douseDur = 0;

  constructor(o: SpawnOpts) { super('bellRinger', 1.45, o); }

  /** Центр колокола на спине. */
  bellPoint(out: { x: number; y: number; z: number }): void {
    const L = this.puppet.layout, s = 1.45;
    this.puppet.skel.jointPoint(L.idx('chest'), 0, 1.0 * s, -1.2 * s, _p);
    out.x = _p.x; out.y = _p.y; out.z = _p.z;
  }

  /** Герой сзади: угол между взглядом Звонаря и направлением на героя больше 100°. */
  heroBehind(w: World): boolean {
    const h = w.hero, dx = h.x - this.x, dz = h.z - this.z, l = Math.hypot(dx, dz) || 1;
    return (Math.sin(this.facing) * dx + Math.cos(this.facing) * dz) / l < Math.cos((BELL_BACK_DEG * Math.PI) / 180);
  }

  /** Колокол на спине — оружие героя: полный заряженный удар сзади. */
  override onBladeHit(w: World, p: StrikeParams, kind: StunKind): void {
    if (kind !== 'charged' || p.feel !== 'heavy' || !this.heroBehind(w)) return;
    this.bellPoint(_b);
    this.bellFlash = 1.5;
    w.bus.emit('bellStrike', { x: _b.x, y: _b.y, z: _b.z, r: BELL_RING_R });
    w.addStunTo(this, BELL_STUN);
    w.heroRing(this.x, this.z, BELL_RING_R, BELL_RING_SPEED, BELL_RING_MULT, 0);
  }

  private chainSteps(): Step[] {
    const w = this.w_, h = w.hero;
    const gapA = Math.floor(w.rng.next() * CHAIN_N), gapB = (gapA + 4 + Math.floor(w.rng.next() * 2)) % CHAIN_N;
    const a0 = w.rng.next() * Math.PI * 2;
    this.chainPts = [];
    for (let i = 0; i < CHAIN_N; i++) {
      if (i === gapA || i === gapB) continue;
      const a = a0 + (i / CHAIN_N) * Math.PI * 2;
      const x = h.x + Math.sin(a) * CHAIN_R, z = h.z + Math.cos(a) * CHAIN_R;
      if (!w.arena.walkable(x, z) || Math.hypot(x - this.x, z - this.z) < this.radius + 0.8) continue;
      this.chainPts.push({ x, z });
    }
    const steps: Step[] = [
      { t: 0, do: 'pose', id: 'summon', blend: 0.3 },
      { t: 0, do: 'telegraphSound', kind: 'bell' },
      { t: 0.8, do: 'call', fn: 'chains' },
      { t: 0.82, do: 'shake', trauma: 0.3 },
      { t: 1.1, do: 'pose', id: 'idle', blend: 0.3 },
      { t: 1.2, do: 'vulnerable', dur: 0.8 },
    ];
    for (const p of this.chainPts) {
      steps.push({ t: 0, do: 'telegraph', shape: { circle: CHAIN_HIT_R }, at: p, dur: 0.8 });
      steps.push({ t: 0.8, do: 'hitbox', shape: { circle: CHAIN_HIT_R }, at: p, dmg: 0.1, kb: 5 });
    }
    return steps;
  }

  private funeralSteps(): Step[] {
    const beats = FUNERAL_BEATS[this.phase === 2 ? 2 : 1];
    const steps: Step[] = [
      { t: 0, do: 'pose', id: 'ringWind', blend: 0.3 },
      { t: 0, do: 'telegraph', shape: { circle: 2.6 }, at: 'front', dur: beats[0] },
      { t: 0, do: 'telegraphSound', kind: 'bell' },
      { t: beats[0], do: 'hitbox', shape: { circle: 2.6 }, at: 'front', dmg: 0.18, kb: 6 },
    ];
    beats.forEach((t, i) => {
      if (i) steps.push({ t: t - 0.15, do: 'pose', id: 'ringWind', blend: 0.06 });
      steps.push({ t, do: 'pose', id: 'ring', blend: 0.04 });
      steps.push({ t, do: 'ringwave', at: 'front', speed: 6 + i * 0.7, width: 0.9, maxR: 17, gaps: 2, gapW: 1.05, dmg: 0.14 });
      steps.push({ t, do: 'sfx', id: 'boss_bell' });
      steps.push({ t, do: 'shake', trauma: 0.25 });
    });
    steps.push({ t: beats[2] + 0.25, do: 'vulnerable', dur: 1.2 });
    return steps;
  }

  /** Каждый удар колокола виден: пульсация колокола дублирует звук. */
  protected override exec(w: World, s: Step): void {
    super.exec(w, s);
    const big = s.do === 'sfx' && s.id === 'boss_bell';
    if (big || (s.do === 'sfx' && s.id === 'tele_bell') || (s.do === 'telegraphSound' && s.kind === 'bell')) {
      this.bellFlash = Math.max(this.bellFlash, big ? 1 : 0.6);
      this.bellPoint(_b);
      w.bus.emit('bellPulse', { x: _b.x, y: _b.y, z: _b.z, big });
    }
  }

  protected override onCall(w: World, fn: string, arg?: number): void {
    if (fn === 'chains') {
      for (const p of this.chainPts) w.addTempWall(p.x, p.z, CHAIN_WALL_R, CHAIN_DUR);
      w.bus.emit('chains', { x: w.hero.x, z: w.hero.z, n: this.chainPts.length });
    } else if (fn === 'douse') {
      // свечи гаснут по кругу, начиная со стороны Звонаря, — к удару погасли все
      const b = w.arena.bounds;
      w.candlesFrom = angleOf(this.x - (b.minX + b.maxX) / 2, this.z - (b.minZ + b.maxZ) / 2);
      this.douseT = 0; this.douseDur = arg ?? 1;
    } else if (fn === 'relight') this.douseDur = 0;
  }

  protected override think(w: World, dt: number, tick: boolean): void {
    if (this.douseDur > 0) {
      this.douseT += dt;
      w.candlesOut = Math.max(w.candlesOut, Math.min(1, this.douseT / this.douseDur));
    }
    super.think(w, dt, tick);
  }

  override onStun(): void {
    super.onStun();
    this.douseDur = 0;
  }

  protected override animate(dt: number, w: World): void {
    super.animate(dt, w);
    this.puppet.boost += this.bellFlash * 1.4;
    this.bellFlash = Math.max(0, this.bellFlash - dt * 3);
  }
}

registerEnemy('gateGuardian', GateGuardian);
registerEnemy('bellRinger', BellRinger);
