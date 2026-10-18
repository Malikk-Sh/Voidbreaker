import * as THREE from 'three';
import { angleOf } from '../../core/math';
import { BipedGait, bipedJoints, setJoint, type BipedJoints } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { bruteRig } from '../../gen/chars/enemies';
import type { SpawnOpts } from '../enemy';
import { registerEnemy } from '../enemies/factory';
import type { World } from '../world';
import { ScriptedEnemy, type PoseLib } from './scripted';
import type { Pattern, Step } from './timeline';

const _p = new THREE.Vector3();
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

  /** Ярость (50 % HP): рёв, ударная волна, ускорение замахов и шага, новые приёмы второй фазы. */
  override onDamaged(w: World, dmg: number, before: number): void {
    super.onDamaged(w, dmg, before);
    if (this.phase !== 1 || this.dead || this.hp > this.maxHp * RAGE_AT) return;
    this.phase = 2;
    this.teleMul *= 0.9;
    this.speed *= 1.15;
    this.rageQueued = true;
  }

  private rageQueued = false;

  protected override think(w: World, dt: number, tick: boolean): void {
    // ярость ждёт конца слома стойки — рёв не обрывает окно наказания
    if (this.rageQueued && this.state !== 'broken' && !this.move) {
      this.rageQueued = false;
      this.startPattern(RAGE);
      w.bus.emit('guardianRage', { x: this.x, z: this.z, kind: this.kind });
    }
    super.think(w, dt, tick);
  }

  protected animate(dt: number, w: World): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot;
    const sp = Math.hypot(this.vx, this.vz);
    const walking = !this.cur && this.state !== 'broken';
    this.gait.update(sp * dt, walking ? sp : 0, 0, dt);
    this.gait.write(out, L, this.J, false);
    const st = Math.floor(this.gait.phase * 2);
    if (st !== this.lastStep && walking && sp > 0.4) { this.lastStep = st; w.bus.emit('impact', { x: this.x, z: this.z, r: 1.6, kind: 'land' }); }
    const pose = this.blendPose(dt);
    for (const [j, e] of pose) setJoint(out, L, j, e[0], e[1], e[2]);
    s.x = this.x; s.z = this.z; s.facing = this.facing;
    s.y = this.y + this.gait.bob * 1.4 - (this.state === 'broken' ? 0.7 : 0);
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
        { t: 2.7, do: 'vulnerable', dur: 1.5 },
      ],
    },
    // Вторая фаза: алебарда в пол — три разлома веером к герою
    { id: 'quake', weight: 2, cooldown: 8, phases: [2], unstoppable: true, steps: [], build: () => this.quakeSteps() },
  ];
  constructor(o: SpawnOpts) { super('gateGuardian', 1.65, o); }

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
        { t: 2.3, do: 'vulnerable', dur: 1.3 },
      ],
    },
  ];
  constructor(o: SpawnOpts) { super('bellRinger', 1.45, o); }
}

registerEnemy('gateGuardian', GateGuardian);
registerEnemy('bellRinger', BellRinger);
