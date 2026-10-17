import { BipedGait, bipedJoints, setJoint, type BipedJoints } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { bruteRig } from '../../gen/chars/enemies';
import type { SpawnOpts } from '../enemy';
import { registerEnemy } from '../enemies/factory';
import type { World } from '../world';
import { ScriptedEnemy, type PoseLib } from './scripted';
import type { Pattern } from './timeline';

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
  broken: { chest: [0.7, 0, 0.15], spine: [0.3, 0, 0], shL: [0.35, 0, 0.5], shR: [0.35, 0, -0.5], hipL: [-1.45, 0, 0.2], kneeL: [1.55, 0, 0], hipR: [0.1, 0, -0.2], kneeR: [1.6, 0, 0], head: [-0.4, 0, 0] },
};

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

/** Страж Врат (1-3): гигантский голем с алебардой (GDD §9.3). */
export class GateGuardian extends BruteGuardian {
  patterns: Pattern[] = [
    {
      id: 'sweep', weight: 3, cooldown: 2, range: [0, 6.5], phases: [1],
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
      id: 'thrust', weight: 2, cooldown: 4, range: [2, 10], phases: [1],
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
      id: 'slam', weight: 2, cooldown: 5, range: [0, 5], phases: [1],
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
      id: 'leap', weight: 2, cooldown: 6, range: [5, 30], phases: [1],
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
  ];
  constructor(o: SpawnOpts) { super('gateGuardian', 1.65, o); }
}

/** Звонарь (1-6): предвестник Иерофанта, бьёт в колокол, волны-кольца (GDD §9.3). */
export class BellRinger extends BruteGuardian {
  patterns: Pattern[] = [
    {
      id: 'toll', weight: 3, cooldown: 3, phases: [1],
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
      id: 'swing', weight: 3, cooldown: 2, range: [0, 5.5], phases: [1],
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
      id: 'summon', weight: 1, cooldown: 12, phases: [1],
      steps: [
        { t: 0, do: 'pose', id: 'summon', blend: 0.4 },
        { t: 0, do: 'telegraphSound', kind: 'roar' },
        { t: 0.5, do: 'summon', enemy: 'spiker', count: 4, at: 'edges' },
        { t: 0.5, do: 'sfx', id: 'boss_roar' },
      ],
      dur: 1.8,
    },
    {
      id: 'leap', weight: 2, cooldown: 6, range: [5, 30], phases: [1],
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
  ];
  constructor(o: SpawnOpts) { super('bellRinger', 1.45, o); }
}

registerEnemy('gateGuardian', GateGuardian);
registerEnemy('bellRinger', BellRinger);
