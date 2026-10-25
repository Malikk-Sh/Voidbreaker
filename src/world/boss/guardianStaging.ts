import * as THREE from 'three';
import { Clip } from '../../anim/clip';
import { Skeleton, type RigLayout, type V3 } from '../../anim/skeleton';
import type { PoseLib } from './scripted';
import { BELL_CONTACT } from '../../gen/chars/enemies';

export const GUARDIAN_KILL_POSES: PoseLib = {
  killcamStagger: { chest: [0.22, 0, 0], spine: [0.08, 0, 0], shL: [-0.35, 0, 0.6], shR: [-0.4, 0, -0.5], elbL: [-0.5, 0, 0], elbR: [-0.5, 0, 0], hipL: [-0.18, 0, 0.08], kneeL: [0.35, 0, 0], hipR: [0.1, 0, -0.08], kneeR: [0.3, 0, 0] },
  killcamKneel: { chest: [0.7, 0, 0.08], spine: [0.12, 0, 0], shL: [0.15, 0, 0.8], shR: [0.25, 0, -0.8], elbL: [-0.35, 0, 0], elbR: [-0.4, 0, 0], hipL: [-1.15, 0, 0.15], kneeL: [1.55, 0, 0], hipR: [0.1, 0, -0.15], kneeR: [1.3, 0, 0], head: [-0.15, 0, 0] },
  killcamHit: { chest: [0.78, 0, 0.12], spine: [0.12, 0, 0], shL: [0.3, 0, 0.9], shR: [0.35, 0, -0.9], elbL: [-0.2, 0, 0], elbR: [-0.25, 0, 0], hipL: [-1.15, 0, 0.15], kneeL: [1.55, 0, 0], hipR: [0.1, 0, -0.15], kneeR: [1.3, 0, 0], head: [0.08, 0, 0] },
};
const kneel = GUARDIAN_KILL_POSES.killcamKneel;
Object.assign(GUARDIAN_KILL_POSES, {
  gateImpulse: { ...kneel, chest: [0.71, 0, 0.08], spine: [0.125, 0, 0], head: [-0.1, 0, 0] },
  gateCompression: { ...kneel, pelvis: [0.08, 0, 0], chest: [0.96, 0, 0.14], spine: [0.19, 0, 0], head: [0.18, 0, 0], shL: [0.45, 0, 0.95], shR: [0.55, 0, -0.95] },
  gateCollapse: { ...kneel, pelvis: [0.1, 0, 0], chest: [1.02, 0, 0.16], spine: [0.2, 0, 0], head: [0.24, 0, 0], shL: [0.55, 0, 1.0], shR: [0.65, 0, -1.0] },
  bellImpulse: { ...kneel, bell: [-0.035, 0, 0.015] },
  bellCompression: { ...kneel, chest: [0.74, 0.04, 0.1], spine: [0.15, 0, 0], bell: [-0.36, 0, 0.09] },
  bellBody: { ...kneel, pelvis: [0.06, 0.07, 0], chest: [0.86, 0.18, 0.14], spine: [0.18, 0, 0], head: [0.04, 0.12, 0], bell: [-0.12, 0, 0.04], shL: [0.4, 0, 1.05], shR: [0.4, 0, -0.9] },
  bellRebound: { ...kneel, chest: [0.88, 0.12, 0.13], spine: [0.17, 0, 0], head: [0.05, 0.05, 0], bell: [0.15, 0, -0.04] },
  bellSettle: { ...kneel, chest: [0.86, 0.08, 0.13], spine: [0.17, 0, 0], head: [0.05, 0.05, 0], bell: [-0.065, 0, 0.02] },
} satisfies PoseLib);
// Середина того же slerp: дополнительная опора не даёт дуге сгибания утопить стопу между ключами.
const stagger = GUARDIAN_KILL_POSES.killcamStagger, middle: PoseLib[string] = {};
for (const name of new Set([...Object.keys(stagger), ...Object.keys(kneel)])) {
  const a = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(stagger[name] ?? [0, 0, 0])));
  const b = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(kneel[name] ?? [0, 0, 0])));
  const e = new THREE.Euler().setFromQuaternion(a.slerp(b, 0.5));
  middle[name] = [e.x, e.y, e.z];
}
GUARDIAN_KILL_POSES.gateKneeling = middle;
for (const [id, pose] of Object.entries(GUARDIAN_KILL_POSES)) GUARDIAN_KILL_POSES[id] = { root: [0, 0, 0], pelvis: [0, 0, 0], head: [0, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0], bell: [0, 0, 0], ...pose };

/** Опорная нога остаётся на полу: прежние −0.7 м топили стоящего Стража до голени. */
export function guardianSupport(layout: RigLayout, poseName: string): number {
  const s = new Skeleton(layout), root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  new Clip({ id: poseName, dur: 1, keys: [{ t: 0, pose: GUARDIAN_KILL_POSES[poseName] }] }, layout).sample(0, s.rot, root);
  s.y = -0.7; s.update();
  return 0.06 - Math.min(s.jointPos(layout.idx('footL'), new THREE.Vector3()).y, s.jointPos(layout.idx('footR'), new THREE.Vector3()).y);
}

/** Якоря будущих опорных поз: те же размеры рига и FK, что у живого Стража. */
export function guardianPoseTargets(layout: RigLayout, x: number, z: number, facing: number, scale: number, poseName: string, drop = 0) {
  const skel = new Skeleton(layout), root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  skel.x = x; skel.z = z; skel.facing = facing; skel.y = -0.7 + guardianSupport(layout, poseName) + drop;
  const pose = (name: string) => { new Clip({ id: name, dur: 1, keys: [{ t: 0, pose: GUARDIAN_KILL_POSES[name] }] }, layout).sample(0, skel.rot, root); skel.update(); };
  const point = (joint: string, p: V3): V3 => skel.jointPoint(layout.idx(joint), ...p, new THREE.Vector3()).toArray() as V3;
  pose(poseName);
  return { knee: point('kneeL', [0, 0.25 * scale, 0.08 * scale]), head: point('head', [0, 0.18 * scale, 0.18 * scale]), bell: layout.has('bell') ? point('bell', BELL_CONTACT.map(v => v * scale) as V3) : point('chest', [0, scale, -1.2 * scale]) };
}

export function guardianTargets(layout: RigLayout, x: number, z: number, facing: number, scale: number) {
  const stagger = guardianPoseTargets(layout, x, z, facing, scale, 'killcamStagger');
  return { ...guardianPoseTargets(layout, x, z, facing, scale, 'killcamKneel'), knee: stagger.knee };
}
