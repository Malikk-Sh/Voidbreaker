import * as THREE from 'three';
import { Clip } from '../../anim/clip';
import { Skeleton, type RigLayout, type V3 } from '../../anim/skeleton';
import type { PoseLib } from './scripted';

export const GUARDIAN_KILL_POSES: PoseLib = {
  killcamStagger: { chest: [0.22, 0, 0], spine: [0.08, 0, 0], shL: [-0.35, 0, 0.6], shR: [-0.4, 0, -0.5], elbL: [-0.5, 0, 0], elbR: [-0.5, 0, 0], hipL: [-0.18, 0, 0.08], kneeL: [0.35, 0, 0], hipR: [0.1, 0, -0.08], kneeR: [0.3, 0, 0] },
  killcamKneel: { chest: [0.7, 0, 0.08], spine: [0.12, 0, 0], shL: [0.15, 0, 0.8], shR: [0.25, 0, -0.8], elbL: [-0.35, 0, 0], elbR: [-0.4, 0, 0], hipL: [-1.15, 0, 0.15], kneeL: [1.55, 0, 0], hipR: [0.1, 0, -0.15], kneeR: [1.3, 0, 0], head: [-0.15, 0, 0] },
  killcamHit: { chest: [0.78, 0, 0.12], spine: [0.12, 0, 0], shL: [0.3, 0, 0.9], shR: [0.35, 0, -0.9], elbL: [-0.2, 0, 0], elbR: [-0.25, 0, 0], hipL: [-1.15, 0, 0.15], kneeL: [1.55, 0, 0], hipR: [0.1, 0, -0.15], kneeR: [1.3, 0, 0], head: [0.08, 0, 0] },
};
for (const [id, pose] of Object.entries(GUARDIAN_KILL_POSES)) GUARDIAN_KILL_POSES[id] = { root: [0, 0, 0], pelvis: [0, 0, 0], head: [0, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0], ...pose };

/** Якоря будущих опорных поз: те же размеры рига и FK, что у живого Стража. */
export function guardianTargets(layout: RigLayout, x: number, z: number, facing: number, scale: number) {
  const skel = new Skeleton(layout), root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  skel.x = x; skel.z = z; skel.facing = facing; skel.y = -0.7;
  const pose = (name: string) => { new Clip({ id: name, dur: 1, keys: [{ t: 0, pose: GUARDIAN_KILL_POSES[name] }] }, layout).sample(0, skel.rot, root); skel.update(); };
  const point = (joint: string, p: V3): V3 => skel.jointPoint(layout.idx(joint), ...p, new THREE.Vector3()).toArray() as V3;
  pose('killcamStagger'); const knee = point('kneeL', [0, 0.25 * scale, 0.08 * scale]);
  pose('killcamKneel');
  return { knee, head: point('head', [0, 0.18 * scale, 0.18 * scale]), bell: point('chest', [0, scale, -1.2 * scale]) };
}
