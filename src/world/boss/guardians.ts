import * as THREE from 'three';
import { angleOf } from '../../core/math';
import { addJoint, BipedGait, bipedJoints, setJoint, type BipedJoints } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { BELL_CONTACT, bruteRig, ringerRig } from '../../gen/chars/enemies';
import type { SpawnOpts } from '../enemy';
import { resetStunHabit } from '../actor';
import type { StunKind } from '../../data/weapons';
import type { StrikeParams } from '../world';
import { registerEnemy } from '../enemies/factory';
import type { World } from '../world';
import { ScriptedEnemy, type PoseLib } from './scripted';
import type { Pattern, Step } from './timeline';
import { GUARDIAN_KILL_POSES } from './guardianStaging';
import { GreatBell, type BellOwner } from './greatBell';

const _p = new THREE.Vector3();
const _b = { x: 0, y: 0, z: 0 };

/** Колокол Звонаря (план §7.4): полный заряд в спину (угол к взгляду > 100°) — кольцо героя и +30 оглушения. */
export const BELL_BACK_DEG = 100;
export const BELL_STUN = 30;
const BELL_RING_R = 7, BELL_RING_SPEED = 16, BELL_RING_MULT = 1.6;
/** Страж Врат (план §7.5): после серии алебарда застревает в полу; рывок на древко — пробежка к шлему и +40. */
export const HALBERD_STUCK = 2.5;
export const SHAFT_STUN = 40;
const SHAFT_RUN = 0.3, SHAFT_LEAP = 0.18, SHAFT_FLIP = 0.42, SHAFT_TOUCH = 0.8;
const K_GATE = 1.65;
/** Порог ярости: на 50 % HP страж ревёт и переходит во вторую фазу. */
const RAGE_AT = 0.5;

/** Общие позы тяжёлого двуногого стража (Эйлер, рад). */
const BRUTE_POSES: PoseLib = {
  ...GUARDIAN_KILL_POSES,
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

/** Звонарь: позы езды на колоколе и раскрутки кистеня поверх общих поз стража. */
const RINGER_POSES: PoseLib = {
  ...BRUTE_POSES,
  // присел на маковке, левая рука держит корону колокола, правая с языком — на отлёте
  ride: { chest: [0.55, 0, 0], spine: [0.2, 0, 0], head: [-0.35, 0, 0], shL: [-0.4, 0, 0.9], elbL: [-1.3, 0, 0], shR: [-1.1, 0, -0.9], elbR: [-0.5, 0, 0], hipL: [-1.25, 0, 0.3], kneeL: [1.8, 0, 0], hipR: [-1.1, 0, -0.3], kneeR: [1.7, 0, 0], footL: [-0.5, 0, 0], footR: [-0.5, 0, 0] },
  // раскрутка: обе руки вперёд на верёвку, корпус откинут против колокола
  crank: { chest: [-0.3, 0, 0], spine: [-0.15, 0, 0], shL: [-1.5, 0, 0.25], elbL: [-0.3, 0, 0], shR: [-1.5, 0, -0.25], elbR: [-0.3, 0, 0], hipL: [-0.5, 0, 0.2], kneeL: [0.7, 0, 0], hipR: [0.3, 0, -0.2], kneeR: [0.5, 0, 0] },
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
    // Звонарь — сгорбленный акробат на своём риге: шаг длиннее и легче, чем у каменного Стража
    const ringer = kind === 'bellRinger';
    const layout = layoutOf(ringer ? ringerRig(scale) : bruteRig(kind, scale));
    super(ENEMIES[kind], layout, o);
    this.J = bipedJoints(layout);
    this.gait = new BipedGait((ringer ? 3.2 : 2.8) * scale / 1.65, 2.2, !ringer);
    this.approach = 2.6;
  }

  protected poses(): PoseLib { return BRUTE_POSES; }

  /** Замах стягивается к оружию в правой руке. */
  override windupPoint(out: { x: number; y: number; z: number }): void {
    const L = this.puppet.layout;
    this.puppet.skel.jointPoint(L.idx('handR'), 0, -0.6, 0, _p);
    out.x = _p.x; out.y = _p.y; out.z = _p.z;
  }

  override get invulnerable(): boolean { return this.killcam || this.cur?.id === 'rage'; }

  /**
   * Последний удар по оглушённому Стражу (план §8.4): он не умирает сразу — встаёт на колено, неуязвим,
   * бой показывает kill-cam, в конце сцены его добивают.
   */
  override onLethal(w: World): boolean {
    if (!this.lastHitStunned || this.killcamDone) return true;
    if (!this.killcam) {
      this.killcam = true;
      this.cur = null; this.move = null; this.y = 0;
      this.vulnerableT = 0;
      this.setKillcamStage(this.kind === 'gateGuardian' ? 'stagger' : 'kneel');
      w.bus.emit('killcam', { target: this, kind: this.kind, x: this.x, z: this.z });
    }
    return false;
  }

  /** Ярость (50 % HP): рёв, ударная волна, ускорение шага, новые приёмы второй фазы. */
  override onDamaged(w: World, dmg: number, before: number): void {
    super.onDamaged(w, dmg, before);
    if (this.phase !== 1 || this.dead || this.hp > this.maxHp * this.rageAt) return;
    this.phase = 2;
    if (this.stun) resetStunHabit(this.stun);
    this.speed *= 1.15;
    this.rageQueued = true;
  }

  protected rageQueued = false;
  /** Доля HP, на которой страж впадает в ярость (Звонарь меняет фазы по верёвкам колокола — у него её нет). */
  protected rageAt = RAGE_AT;

  setKillcamStage(stage: 'stagger' | 'kneel' | 'hit'): void {
    this.puppet.springX = this.puppet.springZ = this.puppet.springVX = this.puppet.springVZ = 0;
    this.setPose(stage === 'stagger' ? 'killcamStagger' : stage === 'kneel' ? 'killcamKneel' : 'killcamHit', stage === 'stagger' ? 0.18 : 0.28);
  }

  override step(w: World, dt: number): void {
    if (this.killcam && !this.dead) { this.vx = this.vz = 0; this.puppet.flash = Math.max(0, this.puppet.flash - dt * 9); this.animate(dt, w); return; }
    super.step(w, dt);
  }

  protected override think(w: World, dt: number, tick: boolean): void {
    if (this.killcam) { this.vx = this.vz = 0; return; }
    // ярость ждёт конца оглушения — рёв не обрывает окно наказания (и заменяет рёв пробуждения)
    if (this.rageQueued && this.state !== 'stunned' && !this.move) {
      this.awakenQueued = false;
      this.rageQueued = false;
      this.startPattern(RAGE);
      w.bus.emit('guardianRage', { x: this.x, z: this.z, kind: this.kind });
    }
    super.think(w, dt, tick);
  }

  /** Поправка позы поверх походки и ключевой позы (до расчёта скелета). */
  protected shapePose(_out: Float32Array, _dt: number): void {}
  /** Поправка после расчёта скелета (опора стоп). */
  protected groundPose(_dt: number): void {}

  protected animate(dt: number, w: World): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot;
    const sp = Math.hypot(this.vx, this.vz);
    const walking = !this.killcam && !this.cur && this.state !== 'stunned';
    this.gait.update(sp * dt, walking ? sp : 0, 0, dt);
    if (this.killcam) out.set(L.restRot); else this.gait.write(out, L, this.J, false);
    const st = Math.floor(this.gait.phase * 2);
    if (st !== this.lastStep && walking && sp > 0.4) { this.lastStep = st; w.bus.emit('impact', { x: this.x, z: this.z, r: 1.6, kind: 'land' }); }
    const pose = this.blendPose(dt);
    for (const [j, e] of pose) setJoint(out, L, j, e[0], e[1], e[2]);
    this.shapePose(out, dt);
    s.x = this.x; s.z = this.z; s.facing = this.facing;
    s.y = this.y + (this.killcam ? 0 : this.gait.bob * 1.4) - (this.state === 'stunned' || this.killcam ? 0.7 : 0);
    s.tiltX = this.puppet.springZ * 0.06; s.tiltZ = -this.puppet.springX * 0.06;
    s.update();
    this.groundPose(dt);
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

/**
 * Звонарь (1-6), «Маятник: срежь опоры» (GDD §9.3, переделка): сгорбленный акробат, сросшийся с языком колокола.
 * Великий колокол висит над залом на четырёх верёвках (GreatBell). Фазы — по целым верёвкам: 4–3 — маятник
 * (Звонарь едет на колоколе, спрыгивает ударить и вскакивает обратно), 2–1 — круг (Звонарь в центре раскручивает
 * колокол, как кистень), 0 — колокол рухнул: Звонарь вырывает язык и бьёт им как молотом.
 *
 * cut — доля HP за перерубленную верёвку; floors — ниже каких долей HP клинок не опустит, пока целы 3–4 / 1–2
 * верёвки; ride — сколько проходов колокола Звонарь едет, прежде чем спрыгнуть (от и до); drop — прыжок с
 * колокола на героя (метка, радиус, урон, окно наказания, с какого расстояния до героя, время полёта);
 * floorAttacks — сколько атак на полу до прыжка обратно (от и до); mount — присед и полёт на колокол (от и до,
 * по расстоянию); thrown — сброшен рывком верёвки (дальность, время); hub — прыжок в центр во II фазе (метка,
 * радиус, полёт); hubTell — во II фазе атака начинается не позже этой секунды остановки колокола: удар успевает
 * до новой раскрутки; away — на сколько метров от центра Звонарь отскакивает, когда колокол срывается; guard — на
 * паузе маятника герой ближе near к тумбе натянутой верёвки: с вероятностью chance Звонарь прыгает на него сразу;
 * rest3 — передышка между атаками в III фазе (с): с языком-молотом Звонарь бьёт чаще.
 */
export const RINGER = {
  cut: 0.1, floors: [0.6, 0.3] as const,
  ride: [1, 2] as const,
  drop: { tele: 1.2, r: 3.2, dmg: 0.26, open: 1.6, reach: 14, hop: 0.85 },
  floorAttacks: [1, 2] as const,
  mount: { crouch: 0.3, hop: [0.6, 1.0] as const },
  thrown: { dist: 4.2, dur: 0.6 },
  hub: { tele: 1.1, r: 2.6, hop: 0.8 },
  hubTell: 0.9,
  away: 6,
  guard: { chance: 0.55, near: 4.5 },
  rest3: [0.35, 0.8] as [number, number],
};

/** Доля HP, ниже которой Звонаря не опустить, пока целы верёвки (см. RINGER.floors). */
export function ringerFloor(intact: number): number {
  return intact > 2 ? RINGER.floors[0] : intact > 0 ? RINGER.floors[1] : 0;
}

type Hop = { fx: number; fz: number; fy: number; tx: number; tz: number; ty: number; t: number; dur: number; arc: number; to: 'bell' | 'floor'; then: 'ride' | 'land' | 'thrown' | 'hub' };
/** Служебные паттерны Звонаря не считаются атаками на полу. */
const RINGER_SYSTEM = new Set(['mount', 'drop', 'hub', 'clapper', 'awaken', 'rage']);

const CLAPPER: Pattern = {
  id: 'clapper', weight: 0, cooldown: 0, phases: [], unstoppable: true,
  steps: [
    { t: 0, do: 'turn', to: 'center' },
    { t: 0, do: 'pose', id: 'summon', blend: 0.2 },
    { t: 0.55, do: 'call', fn: 'rip' },
    { t: 0.6, do: 'pose', id: 'raise', blend: 0.08 },
    { t: 1.0, do: 'pose', id: 'roar', blend: 0.06 },
    { t: 1.0, do: 'sfx', id: 'boss_roar' },
    { t: 1.02, do: 'fx', id: 'shockwave', at: 'self', r: 9 },
    { t: 1.02, do: 'shake', trauma: 0.6 },
  ],
  dur: 2.0,
};

export class BellRinger extends BruteGuardian implements BellOwner {
  patterns: Pattern[] = [
    // I фаза, на полу: размах, выпад, топот — и обратно на колокол
    {
      id: 'swing', weight: 3, cooldown: 2, range: [0, 5.5], phases: [1, 3],
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
    {
      id: 'thrust', weight: 2, cooldown: 3, range: [0, 8], phases: [1],
      steps: [
        { t: 0, do: 'pose', id: 'thrustWind', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { line: [7, 1.7] }, at: 'self', dur: 0.9 },
        { t: 0, do: 'telegraphSound', kind: 'whistle' },
        { t: 0.9, do: 'pose', id: 'thrust', blend: 0.04 },
        { t: 0.9, do: 'hitbox', shape: { line: [7, 1.7] }, at: 'self', dmg: 0.22, kb: 7 },
        { t: 0.9, do: 'sfx', id: 'swing_heavy' },
        { t: 0.95, do: 'vulnerable', dur: 1.1 },
      ],
    },
    {
      id: 'stomp', weight: 2, cooldown: 4, range: [0, 3.5], phases: [1],
      steps: [
        { t: 0, do: 'pose', id: 'raise', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { circle: 3.0 }, at: 'self', dur: 1.0 },
        { t: 0, do: 'telegraphSound', kind: 'roar' },
        { t: 1.0, do: 'pose', id: 'slam', blend: 0.04 },
        { t: 1.0, do: 'hitbox', shape: { circle: 3.0 }, at: 'self', dmg: 0.24, kb: 9 },
        { t: 1.0, do: 'fx', id: 'impact', at: 'self', r: 3 },
        { t: 1.02, do: 'shake', trauma: 0.4 },
        { t: 1.1, do: 'vulnerable', dur: 1.3 },
      ],
    },
    // II фаза: Звонарь — ось кистеня. Бьёт только на остановке колокола, чтобы удар кончился до раскрутки.
    {
      id: 'hubSweep', weight: 3, cooldown: 3, range: [0, 5], phases: [2],
      steps: [
        { t: 0, do: 'pose', id: 'sweepWind', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { circle: 3.6 }, at: 'self', dur: 1.2 },
        { t: 0, do: 'telegraphSound', kind: 'whistle' },
        { t: 1.2, do: 'pose', id: 'sweep', blend: 0.04 },
        { t: 1.2, do: 'hitbox', shape: { circle: 3.6 }, at: 'self', dmg: 0.22, kb: 10 },
        { t: 1.2, do: 'sfx', id: 'swing_heavy' },
        { t: 1.22, do: 'shake', trauma: 0.3 },
        { t: 1.3, do: 'vulnerable', dur: 1.2 },
      ],
    },
    {
      id: 'ropeLash', weight: 3, cooldown: 3, range: [3, 30], phases: [2],
      steps: [
        { t: 0, do: 'pose', id: 'ringWind', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { line: [11, 1.4] }, at: 'self', dur: 1.2 },
        { t: 0, do: 'telegraphSound', kind: 'whistle' },
        { t: 1.2, do: 'pose', id: 'ring', blend: 0.04 },
        { t: 1.2, do: 'hitbox', shape: { line: [11, 1.4] }, at: 'self', dmg: 0.2, kb: 7 },
        { t: 1.2, do: 'sfx', id: 'thread_snap' },
        { t: 1.25, do: 'vulnerable', dur: 1.2 },
      ],
    },
    // III фаза: язык колокола — молот
    {
      id: 'clapperSlam', weight: 3, cooldown: 2.5, range: [0, 6], phases: [3],
      steps: [
        { t: 0, do: 'pose', id: 'raise', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { circle: 3.4 }, at: 'front', dur: 1.0 },
        { t: 0, do: 'telegraphSound', kind: 'bell' },
        { t: 1.0, do: 'pose', id: 'slam', blend: 0.04 },
        { t: 1.0, do: 'hitbox', shape: { circle: 3.4 }, at: 'front', dmg: 0.26, kb: 8 },
        { t: 1.0, do: 'fx', id: 'impact', at: 'front', r: 3.4 },
        { t: 1.0, do: 'sfx', id: 'boss_bell' },
        { t: 1.02, do: 'shake', trauma: 0.5 },
        { t: 1.1, do: 'vulnerable', dur: 1.4 },
      ],
    },
    {
      id: 'clapperCombo', weight: 2, cooldown: 5, range: [0, 7], phases: [3],
      steps: [
        { t: 0, do: 'pose', id: 'raise', blend: 0.25 },
        { t: 0, do: 'telegraph', shape: { circle: 3.0 }, at: 'front', dur: 0.9 },
        { t: 0, do: 'telegraphSound', kind: 'bell' },
        { t: 0.9, do: 'pose', id: 'slam', blend: 0.04 },
        { t: 0.9, do: 'hitbox', shape: { circle: 3.0 }, at: 'front', dmg: 0.2, kb: 6 },
        { t: 0.9, do: 'fx', id: 'impact', at: 'front', r: 3 },
        { t: 0.9, do: 'sfx', id: 'boss_bell' },
        { t: 1.05, do: 'resnap' },
        { t: 1.05, do: 'pose', id: 'sweepWind', blend: 0.15 },
        { t: 1.05, do: 'telegraph', shape: { arc: [5, 200] }, at: 'self', dur: 0.85 },
        { t: 1.9, do: 'pose', id: 'sweep', blend: 0.04 },
        { t: 1.9, do: 'hitbox', shape: { arc: [5, 200] }, at: 'self', dmg: 0.22, kb: 8 },
        { t: 1.9, do: 'sfx', id: 'swing_heavy' },
        { t: 1.92, do: 'shake', trauma: 0.35 },
        { t: 2.0, do: 'vulnerable', dur: 1.5 },
      ],
    },
    {
      id: 'leap', weight: 2, cooldown: 6, range: [5, 30], phases: [3],
      steps: [
        { t: 0, do: 'pose', id: 'crouch', blend: 0.2 },
        { t: 0, do: 'telegraph', shape: { circle: 3.2 }, at: 'snapshot', dur: 1.05 },
        { t: 0, do: 'telegraphSound', kind: 'roar' },
        { t: 0.3, do: 'move', to: 'snapshot', dur: 0.75, arc: 4, ease: 'inOutQuad' },
        { t: 0.32, do: 'pose', id: 'air', blend: 0.1 },
        { t: 1.0, do: 'pose', id: 'slam', blend: 0.04 },
        { t: 1.05, do: 'hitbox', shape: { circle: 3.2 }, at: 'self', dmg: 0.26, kb: 8 },
        { t: 1.05, do: 'fx', id: 'impact', at: 'self', r: 3.2 },
        { t: 1.05, do: 'sfx', id: 'boss_bell' },
        { t: 1.05, do: 'shake', trauma: 0.5 },
        { t: 1.1, do: 'vulnerable', dur: 1.5 },
      ],
    },
  ];
  /** Великий колокол (создаётся, когда Звонарь входит в мир). */
  bell: GreatBell | null = null;
  /** Едет на колоколе: недосягаем для клинка, колокол качается. */
  riding = false;
  /** Прыжок на колокол, с колокола, в центр или сброс рывком верёвки. */
  hop: Hop | null = null;
  /** III фаза: язык колокола в руках. */
  clapper = false;
  /** Вспышка колокола на спине (визуальный дубль звука). */
  bellFlash = 0;
  /** Полоса HP: ромбы на порогах, ниже которых клинок не опустит, пока целы верёвки. */
  readonly hudPhases: readonly number[] = [RINGER.floors[0], RINGER.floors[1]];
  readonly metrics = { drops: 0, mounts: 0, thrown: 0, warded: 0 };
  protected override rageAt = -1;
  private rideFrom = 0; private rideFor: number = RINGER.ride[0];
  private floorLeft = 0;
  private atHub = false;
  private clapperQueued = false;
  private hopTarget = { x: 0, z: 0 };
  private wardT = 0;
  private readonly offs: (() => void)[] = [];

  constructor(o: SpawnOpts) { super('bellRinger', 1.45, o); }

  protected override poses(): PoseLib { return RINGER_POSES; }

  override onAdded(w: World): void {
    super.onAdded(w);
    const b = w.arena.bounds;
    w.greatBell?.dispose();
    this.bell = new GreatBell(w, this, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
    w.greatBell = this.bell;
    this.offs.push(w.bus.on('bellFall', () => this.bellFell(w)));
  }

  override get targetable(): boolean { return super.targetable && !this.riding && this.hop?.to !== 'bell'; }

  override get invulnerable(): boolean {
    const id = this.cur?.id;
    return super.invulnerable || this.riding || id === 'clapper' || id === 'hub';
  }

  /** Трещина на горбе-колоколе (точка удара добивания). */
  bellPoint(out: { x: number; y: number; z: number }): void {
    const L = this.puppet.layout, s = 1.45;
    this.puppet.skel.jointPoint(L.idx('bell'), BELL_CONTACT[0] * s, BELL_CONTACT[1] * s, BELL_CONTACT[2] * s, _p);
    out.x = _p.x; out.y = _p.y; out.z = _p.z;
  }

  /** Герой сзади: угол между взглядом Звонаря и направлением на героя больше 100°. */
  heroBehind(w: World): boolean {
    const h = w.hero, dx = h.x - this.x, dz = h.z - this.z, l = Math.hypot(dx, dz) || 1;
    return (Math.sin(this.facing) * dx + Math.cos(this.facing) * dz) / l < Math.cos((BELL_BACK_DEG * Math.PI) / 180);
  }

  /** Горб-колокол — оружие героя: полный заряженный удар сзади звонит в него. */
  override onBladeHit(w: World, p: StrikeParams, kind: StunKind): void {
    if (kind !== 'charged' || p.feel !== 'heavy' || !this.heroBehind(w)) return;
    this.bellPoint(_b);
    this.bellFlash = 1.5;
    w.bus.emit('bellStrike', { x: _b.x, y: _b.y, z: _b.z, r: BELL_RING_R });
    w.addStunTo(this, BELL_STUN);
    w.heroRing(this.x, this.z, BELL_RING_R, BELL_RING_SPEED, BELL_RING_MULT, 0);
  }

  /** Перерубленная верёвка: рывок бьёт по Звонарю, фаза меняется по числу целых верёвок. */
  onRopeCut(w: World, _index: number, left: number): void {
    if (this.dead) return;
    const dmg = Math.min(this.hp - 1, this.maxHp * RINGER.cut);
    if (dmg > 0) {
      this.hp -= dmg;
      this.puppet.flash = Math.max(this.puppet.flash, 0.6);
      w.bus.emit('hit', { target: this, dmg, crit: false, feel: 'heavy', dirX: 0, dirZ: 0, x: this.x, y: this.y + this.height * 0.55, z: this.z, source: 'env' });
    }
    if (left === 0) { this.toFinale(w); return; }
    if (left === 2 && this.phase === 1) { this.phase = 2; this.atHub = false; this.bell?.toOrbit(); }
    if (this.riding || this.hop?.to === 'bell') this.throwOff(w);
    else if (!this.hop && this.state !== 'stunned') { this.cur = null; this.move = null; this.kneelT = Math.max(this.kneelT, 0.9); this.setPose('broken', 0.1); }
  }

  /** Последняя верёвка: колокол срывается в центр — Звонарь отскакивает, удар колокола о пол сбивает его с ног. */
  private toFinale(w: World): void {
    this.phase = 3; this.atHub = false; this.stationary = false;
    this.speed *= 1.12;
    this.restRange = RINGER.rest3;
    if (this.riding) { this.throwOff(w); return; }
    if (this.hop) return;
    const bell = this.bell!, h = w.hero;
    let dx = this.x - bell.cx, dz = this.z - bell.cz;
    if (Math.hypot(dx, dz) < 0.5) { dx = this.x - h.x; dz = this.z - h.z; }
    const l = Math.hypot(dx, dz) || 1, o = { x: 0, z: 0 };
    w.arena.nearestWalkable(bell.cx + dx / l * RINGER.away, bell.cz + dz / l * RINGER.away, o);
    this.cur = null; this.move = null; this.kneelT = 0;
    this.startHop(o.x, o.z, 0, 0.7, 2.6, 'floor', 'land');
  }

  private bellFell(w: World): void {
    if (this.dead) return;
    this.clapperQueued = true;
    w.stunEnemy(this);
  }

  /** Сразу к III фазе (пересмотр добивания, стенды, боты): колокол лежит, язык в руках. */
  skipToFinale(): void {
    const bell = this.bell;
    bell?.settleFallen();
    this.phase = 3; this.riding = false; this.hop = null; this.aloft = false; this.flying = false;
    this.clapper = true; this.clapperQueued = false; this.stationary = false; this.atHub = false;
    this.cur = null; this.move = null; this.y = 0;
    this.restRange = RINGER.rest3;
    if (bell && Math.hypot(this.x - bell.cx, this.z - bell.cz) < RINGER.away - 1) {
      const o = { x: 0, z: 0 };
      this.w_.arena.nearestWalkable(bell.cx, bell.cz + RINGER.away, o);
      this.x = o.x; this.z = o.z;
    }
  }

  override onDamaged(w: World, dmg: number, before: number): void {
    super.onDamaged(w, dmg, before);
    const bell = this.bell;
    if (!bell || this.dead) return;
    const floor = ringerFloor(bell.intact) * this.maxHp;
    if (this.hp >= floor) return;
    this.hp = Math.min(before, floor);
    this.metrics.warded++;
    if (this.wardT <= 0) { this.wardT = 0.5; w.bus.emit('bellWard', { x: this.x, z: this.z, left: bell.intact }); }
  }

  override onStun(): void {
    const fy = this.y;
    super.onStun();
    // оглушён на колоколе (идеальный уход от его удара) — падает с маковки
    if (this.riding) { this.y = fy; this.throwOff(this.w_); }
    else if (this.hop) this.y = fy;
  }

  override startPattern(p: Pattern): void {
    if (this.phase === 1 && !RINGER_SYSTEM.has(p.id)) this.floorLeft--;
    super.startPattern(p);
  }

  override step(w: World, dt: number): void {
    this.bell?.step(dt);
    this.wardT -= dt;
    if (!this.dead) {
      if (this.riding) this.stickToBell();
      this.stepHop(w, dt);
    }
    super.step(w, dt);
    if (this.riding && !this.dead) this.stickToBell();
  }

  private stickToBell(): void {
    const b = this.bell!;
    this.x = b.x; this.z = b.z; this.y = b.topY - 0.15;
    this.vx = this.vz = 0; this.kbX = this.kbZ = 0;
  }

  private startHop(tx: number, tz: number, ty: number, dur: number, arc: number, to: Hop['to'], then: Hop['then']): void {
    this.hop = { fx: this.x, fz: this.z, fy: this.y, tx, tz, ty, t: 0, dur, arc, to, then };
    this.riding = false; this.aloft = true; this.flying = true;
    if (Math.hypot(tx - this.x, tz - this.z) > 0.3) this.facing = angleOf(tx - this.x, tz - this.z);
  }

  private stepHop(w: World, dt: number): void {
    const h = this.hop;
    if (!h) return;
    h.t += dt;
    const u = Math.min(1, h.t / h.dur), e = u * u * (3 - 2 * u);
    if (h.to === 'bell' && this.bell) { h.tx = this.bell.x; h.tz = this.bell.z; h.ty = this.bell.topY - 0.15; }
    this.x = h.fx + (h.tx - h.fx) * e; this.z = h.fz + (h.tz - h.fz) * e;
    this.y = h.fy + (h.ty - h.fy) * u + h.arc * Math.sin(u * Math.PI);
    this.vx = this.vz = 0; this.kbX = this.kbZ = 0;
    if (u < 1) return;
    this.hop = null; this.flying = false;
    if (h.then === 'ride' && (this.phase !== 1 || !this.bell?.hanging)) { this.throwOff(w); return; }
    if (h.then === 'ride') {
      const bell = this.bell!;
      this.riding = true; this.aloft = true; this.flying = true;
      this.rideFrom = bell.metrics.passes;
      this.rideFor = RINGER.ride[0] + Math.floor(w.rng.next() * (RINGER.ride[1] - RINGER.ride[0] + 1));
      this.metrics.mounts++;
      if (bell.mode === 'idle') bell.startSwing();
      this.setPose('ride', 0.12);
      this.bellFlash = 1;
      w.bus.emit('sfx', { id: 'bell_strike', x: this.x, z: this.z, gain: 0.7 });
      w.bus.emit('bellMount', { x: this.x, z: this.z });
      return;
    }
    this.y = 0; this.aloft = false;
    w.bus.emit('impact', { x: this.x, z: this.z, r: 2.2, kind: 'land' });
    if (h.then === 'thrown') { this.setPose('broken', 0.1); w.stunEnemy(this); }
    else if (h.then === 'hub') this.atHub = true;
  }

  /** Сброшен рывком верёвки: летит с маковки к центру зала и падает оглушённым. */
  private throwOff(w: World): void {
    const bell = this.bell!;
    this.cur = null; this.move = null;
    let dx = bell.cx - this.x, dz = bell.cz - this.z;
    if (Math.hypot(dx, dz) < 0.5) { dx = Math.sin(this.facing); dz = Math.cos(this.facing); }
    const l = Math.hypot(dx, dz) || 1, o = { x: 0, z: 0 };
    w.arena.nearestWalkable(this.x + dx / l * RINGER.thrown.dist, this.z + dz / l * RINGER.thrown.dist, o);
    this.metrics.thrown++;
    this.startHop(o.x, o.z, 0, RINGER.thrown.dur, 1.2, 'floor', 'thrown');
    this.setPose('air', 0.08);
    w.bus.emit('bellThrown', { x: this.x, z: this.z });
  }

  protected override think(w: World, dt: number, tick: boolean): void {
    const bell = this.bell;
    if (this.killcam || !bell || this.cur || this.kneelT > 0) { super.think(w, dt, tick); return; }
    if (this.hop) { this.vx = this.vz = 0; return; }
    if (this.riding) { this.rideThink(w, dt); return; }
    if (this.clapperQueued && !this.move) {
      this.clapperQueued = false; this.awakenQueued = false;
      this.startPattern(CLAPPER);
      w.bus.emit('guardianRage', { x: this.x, z: this.z, kind: this.kind });
      return;
    }
    if (!this.awakenQueued && !w.hero.dead) {
      if (this.phase === 1 && bell.hanging && (bell.mode === 'idle' || (this.floorLeft <= 0 && bell.paused && bell.pauseLeft > 0.2))) { this.startPattern(this.mountPattern()); return; }
      if (this.phase === 2 && bell.hanging && !this.atHub) { this.startPattern(this.hubPattern()); return; }
    }
    // II фаза: пока колокол раскручивается, Звонарь крутит его и не бьёт
    const crank = this.phase === 2 && this.atHub && bell.mode === 'orbit' && !(bell.orbit.stage === 'hold' && bell.orbit.t < RINGER.hubTell);
    if (crank) this.idleT = Math.max(this.idleT, 0.05);
    this.stationary = this.phase === 2;
    super.think(w, dt, tick);
    if (crank && !this.cur && !this.awakenQueued) {
      if (bell.orbit.stage !== 'hold') { this.facing = angleOf(bell.x - this.x, bell.z - this.z); this.setPose('crank', 0.15); }
      else if (this.poseId === 'crank') this.setPose('idle', 0.3);
    }
  }

  private rideThink(w: World, dt: number): void {
    const bell = this.bell!, h = w.hero;
    this.vx = this.vz = 0;
    this.faceTo(h.x, h.z, 0.25, dt);
    if (this.poseId !== 'ride') this.setPose('ride', 0.2);
    if (this.phase !== 1) { this.throwOff(w); return; }
    if (h.dead || Math.hypot(h.x - this.x, h.z - this.z) >= RINGER.drop.reach) return;
    // герой бежит к тумбе натянутой верёвки — Звонарь (не всегда) прыгает на него, защищая опору; бросок решается
    // раз на каждую паузу и каждый проход колокола
    const stage = bell.metrics.passes * 2 + (bell.paused ? 1 : 0);
    if (this.guardRoll !== stage) { this.guardRoll = stage; this.guarding = w.rng.next() < RINGER.guard.chance; }
    const defend = this.guarding && bell.ropes.some((r) => bell.cuttable(r) && Math.hypot(h.x - r.cleat.x, h.z - r.cleat.z) < RINGER.guard.near);
    const due = bell.paused && bell.pauseLeft > 0.35 && bell.metrics.passes - this.rideFrom >= this.rideFor;
    if (defend || due) this.startPattern(this.dropPattern());
  }
  private guardRoll = -1; private guarding = false;

  /** Прыжок с маковки колокола на героя: метка в его точке, удар, окно наказания. */
  private dropPattern(): Pattern {
    const D = RINGER.drop;
    return { id: 'drop', weight: 0, cooldown: 0, phases: [], steps: [], build: () => {
      const h = this.w_.hero, o = this.hopTarget;
      this.w_.arena.nearestWalkable(h.x, h.z, o);
      const at = { x: o.x, z: o.z };
      return [
        { t: 0, do: 'pose', id: 'crouch', blend: 0.15 },
        { t: 0, do: 'telegraph', shape: { circle: D.r }, at, dur: D.tele },
        { t: 0, do: 'telegraphSound', kind: 'roar' },
        { t: D.tele - D.hop, do: 'call', fn: 'leapOff' },
        { t: D.tele - D.hop + 0.02, do: 'pose', id: 'air', blend: 0.1 },
        { t: D.tele - 0.06, do: 'pose', id: 'slam', blend: 0.04 },
        { t: D.tele, do: 'hitbox', shape: { circle: D.r }, at, dmg: D.dmg, kb: 8 },
        { t: D.tele, do: 'fx', id: 'impact', at, r: D.r },
        { t: D.tele, do: 'sfx', id: 'land_impact' },
        { t: D.tele, do: 'shake', trauma: 0.5 },
        { t: D.tele + 0.05, do: 'vulnerable', dur: D.open },
      ];
    } };
  }

  /** Прыжок на колокол: колокол ждёт на краю, пока Звонарь не встанет на маковку. */
  private mountPattern(): Pattern {
    const M = RINGER.mount, bell = this.bell!;
    const d = Math.hypot(bell.x - this.x, bell.z - this.z);
    const hop = Math.min(M.hop[1], Math.max(M.hop[0], 0.45 + d * 0.035));
    bell.holdFor(M.crouch + hop + 0.35);
    this.hopTarget.x = hop;
    return { id: 'mount', weight: 0, cooldown: 0, phases: [], steps: [
      { t: 0, do: 'pose', id: 'crouch', blend: 0.12 },
      { t: M.crouch, do: 'call', fn: 'leapOn', arg: hop },
      { t: M.crouch + 0.02, do: 'pose', id: 'air', blend: 0.1 },
      { t: M.crouch + hop - 0.1, do: 'pose', id: 'ride', blend: 0.12 },
    ], dur: M.crouch + hop + 0.05 };
  }

  /** II фаза: прыжок в центр зала (метка, удар о пол, рёв) — Звонарь становится осью кистеня. */
  private hubPattern(): Pattern {
    const H = RINGER.hub, bell = this.bell!, c = { x: bell.cx, z: bell.cz };
    return { id: 'hub', weight: 0, cooldown: 0, phases: [], unstoppable: true, steps: [
      { t: 0, do: 'pose', id: 'crouch', blend: 0.15 },
      { t: 0, do: 'telegraph', shape: { circle: H.r }, at: c, dur: H.tele },
      { t: 0, do: 'telegraphSound', kind: 'roar' },
      { t: H.tele - H.hop, do: 'call', fn: 'leapHub' },
      { t: H.tele - H.hop + 0.02, do: 'pose', id: 'air', blend: 0.1 },
      { t: H.tele, do: 'pose', id: 'slam', blend: 0.04 },
      { t: H.tele, do: 'hitbox', shape: { circle: H.r }, at: c, dmg: 0.2, kb: 10 },
      { t: H.tele, do: 'fx', id: 'shockwave', at: c, r: 8 },
      { t: H.tele, do: 'shake', trauma: 0.6 },
      { t: H.tele + 0.3, do: 'pose', id: 'roar', blend: 0.06 },
      { t: H.tele + 0.3, do: 'sfx', id: 'boss_roar' },
      { t: H.tele + 0.3, do: 'call', fn: 'rage' },
    ], dur: H.tele + 1.4 };
  }

  /** Каждый удар колокола виден: пульсация колокола на спине дублирует звук. */
  protected override exec(w: World, s: Step): void {
    super.exec(w, s);
    const big = s.do === 'sfx' && s.id === 'boss_bell';
    if (big || (s.do === 'telegraphSound' && s.kind === 'bell')) {
      this.bellFlash = Math.max(this.bellFlash, big ? 1 : 0.6);
      this.bellPoint(_b);
      w.bus.emit('bellPulse', { x: _b.x, y: _b.y, z: _b.z, big });
    }
  }

  protected override onCall(w: World, fn: string, arg?: number): void {
    const bell = this.bell;
    if (!bell) return;
    if (fn === 'leapOff') {
      const o = this.hopTarget;
      this.floorLeft = RINGER.floorAttacks[0] + Math.floor(w.rng.next() * (RINGER.floorAttacks[1] - RINGER.floorAttacks[0] + 1));
      this.metrics.drops++;
      this.startHop(o.x, o.z, 0, RINGER.drop.hop, 1.6, 'floor', 'land');
      w.bus.emit('bellLeap', { x: this.x, z: this.z });
    } else if (fn === 'leapOn') {
      if (!bell.hanging || this.phase !== 1) return;
      this.startHop(bell.x, bell.z, bell.topY - 0.15, arg ?? 0.8, 1.4, 'bell', 'ride');
      w.bus.emit('bellLeap', { x: this.x, z: this.z });
    } else if (fn === 'leapHub') {
      this.startHop(bell.cx, bell.cz, 0, RINGER.hub.hop, 3, 'floor', 'hub');
      w.bus.emit('bellLeap', { x: this.x, z: this.z });
    } else if (fn === 'rage') {
      if (this.stun) resetStunHabit(this.stun);
      w.bus.emit('guardianRage', { x: this.x, z: this.z, kind: this.kind });
    } else if (fn === 'rip') {
      this.clapper = true;
      if (this.stun) resetStunHabit(this.stun);
      w.bus.emit('bellClapper', { x: this.x, z: this.z, fromX: bell.cx, fromZ: bell.cz });
    }
  }

  override kill(w: World, dirX: number, dirZ: number, power: number): void {
    super.kill(w, dirX, dirZ, power);
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  protected override animate(dt: number, w: World): void {
    super.animate(dt, w);
    this.puppet.boost += this.bellFlash * 1.4;
    this.bellFlash = Math.max(0, this.bellFlash - dt * 3);
  }

  private stance = 0; private ground = 0;
  private readonly sway = { x: 0, vx: 0, z: 0, vz: 0, px: 0, pz: 0, py: 0, ux: 0, uz: 0, uy: 0, init: false };

  /**
   * Акробат: в покое и на ходу — полуприсед (ноги, которые не задала ключевая поза); горб-колокол раскачивается на
   * маковке, отставая от рывков тела, и вздрагивает при приземлении.
   */
  protected override shapePose(out: Float32Array, dt: number): void {
    if (this.killcam || dt <= 0) return;
    const L = this.puppet.layout, P = RINGER_POSES[this.poseId], S = RINGER_STANCE;
    const free = !P?.hipL && this.state !== 'stunned';
    this.stance += ((free ? 1 : 0) - this.stance) * Math.min(1, dt * 6);
    if (this.stance > 0.01) {
      const k = this.stance;
      for (const side of ['L', 'R'] as const) {
        addJoint(out, L.idx('hip' + side), S.hip * k, 0, 0);
        addJoint(out, L.idx('knee' + side), S.knee * k, 0, 0);
        addJoint(out, L.idx('foot' + side), S.foot * k, 0, 0);
      }
    }
    // качание горба: пружина на маковке, её толкает ускорение тела в его же осях
    const w = this.sway;
    if (!w.init) { w.init = true; w.px = this.x; w.pz = this.z; w.py = this.y; }
    const vx = (this.x - w.px) / dt, vz = (this.z - w.pz) / dt, vy = (this.y - w.py) / dt;
    const ax = (vx - w.ux) / dt, az = (vz - w.uz) / dt, ay = (vy - w.uy) / dt;
    w.px = this.x; w.pz = this.z; w.py = this.y; w.ux = vx; w.uz = vz; w.uy = vy;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const fwd = Math.max(-60, Math.min(60, ax * fx + az * fz)), side = Math.max(-60, Math.min(60, ax * fz - az * fx)), up = Math.max(-80, Math.min(80, ay));
    w.vx += (-S.swayK * w.x - S.swayDamp * w.vx - fwd * S.swayPush + up * S.swayDrop) * dt;
    w.vz += (-S.swayK * w.z - S.swayDamp * w.vz + side * S.swayPush) * dt;
    w.x = Math.max(-S.swayMax, Math.min(S.swayMax, w.x + w.vx * dt));
    w.z = Math.max(-S.swayMax, Math.min(S.swayMax, w.z + w.vz * dt));
    if (!P?.bell) addJoint(out, L.idx('bell'), w.x, 0, w.z);
  }

  /** Стопы — на полу или на маковке колокола: присед и позы не оставляют Звонаря висеть в воздухе. */
  protected override groundPose(dt: number): void {
    const s = this.puppet.skel, L = s.layout;
    const onBell = this.riding && !!this.bell;
    if (this.killcam || this.state === 'stunned' || this.hop || this.move || (!onBell && this.y > 0.05)) { this.ground += (0 - this.ground) * Math.min(1, dt * 10); if (Math.abs(this.ground) > 1e-3) { s.y += this.ground; s.update(); } return; }
    const low = Math.min(s.jointPos(L.idx('footL'), _gv).y, s.jointPos(L.idx('footR'), _gv).y);
    const floor = onBell ? this.bell!.topY : 0;
    const want = Math.max(-0.8, Math.min(0.8, floor - low));
    this.ground += (want - this.ground) * Math.min(1, dt * 14);
    s.y += this.ground; s.update();
  }
}

/**
 * Стойка Звонаря (рад): полуприсед, добавленный к походке, когда ключевая поза не задаёт ноги; качание горба —
 * жёсткость и затухание пружины, сколько толкает ускорение тела (рад на м/с²) и приземление, предел наклона.
 */
const RINGER_STANCE = { hip: -0.42, knee: 0.85, foot: -0.4, swayK: 38, swayDamp: 5.5, swayPush: 0.0035, swayDrop: 0.0016, swayMax: 0.28 };
const _gv = new THREE.Vector3();

registerEnemy('gateGuardian', GateGuardian);
registerEnemy('bellRinger', BellRinger);
