import type { V3 } from './director';
import * as THREE from 'three';
import { Clip } from '../anim/clip';
import { RigLayout, Skeleton } from '../anim/skeleton';
import { EXECUTION_CLIPS, FINISHER_EDGE_Y, MASK_CONTACT } from '../anim/clips/execution';
import { HERO_RIG, BLADE_LEN } from '../gen/chars/hero';

/** Склейка на подготовке разреза: зритель успевает увидеть цель до контакта. */
export const FINISHER_CUT_LEAD = 0.15;
type MotionSample = { time: number; root: V3 };

/** Непрерывная парабола от толчка до контакта; ускорение постоянно, остановки на вершине нет. */
export function ballisticVelocity(from: V3, to: V3, dur: number, endFall = 2.4): { velocityFrom: V3; velocityTo: V3 } {
  const vx = (to[0] - from[0]) / dur, vz = (to[2] - from[2]) / dur;
  return { velocityFrom: [vx, 2 * (to[1] - from[1]) / dur + endFall, vz], velocityTo: [vx, -endFall, vz] };
}

/** Локальная проводка через материал без потери направления первого импульса. */
export function along(p: V3, facing: number, forward: number, down = 0, side = 0): V3 {
  const fx = Math.sin(facing), fz = Math.cos(facing);
  return [p[0] + fx * forward - fz * side, p[1] - down, p[2] + fz * forward + fx * side];
}

export function ballisticPoint(from: V3, to: V3, dur: number, time: number, endFall = 2.4): V3 {
  const k = Math.max(0, Math.min(1, time / dur)), t = k * dur, v = ballisticVelocity(from, to, dur, endFall).velocityFrom;
  return [from[0] + (to[0] - from[0]) * k, from[1] + v[1] * t + ((to[1] - from[1]) - v[1] * dur) * k * k, from[2] + (to[2] - from[2]) * k];
}

/** Передняя четверть на подготовку: весь поднятый меч и двуручный хват. */
export function attackFraming(clipId: string, facing: number, samples: MotionSample[], target: V3, fov = 44, extra: V3[] = []): { cam: V3; look: V3 } {
  const layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout), clip = new Clip(EXECUTION_CLIPS.find(c => c.id === clipId)!, layout);
  const points = [target, ...extra].map(p => new THREE.Vector3(...p)), root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  for (const s of samples) {
    clip.sample(s.time, skel.rot, root); skel.x = s.root[0]; skel.y = s.root[1] + root.y; skel.z = s.root[2]; skel.facing = facing; skel.update();
    for (const name of ['head', 'handR', 'handL', 'footL', 'footR']) points.push(skel.jointPoint(layout.idx(name), 0, name === 'head' ? 0.36 : 0, 0, new THREE.Vector3()));
    points.push(skel.jointPoint(layout.idx('blade'), 0, -BLADE_LEN - 0.02, 0, new THREE.Vector3()));
  }
  return fitShot(points, facing, fov, 0.38, 0.25);
}

/** Контрплан на босса с той же стороны оси: материал цели, кисти и рабочая кромка. */
export function bossImpactFraming(clipId: string, facing: number, samples: MotionSample[], target: V3, width = 1, height = 1, fov = 40): { cam: V3; look: V3 } {
  const layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout), clip = new Clip(EXECUTION_CLIPS.find(c => c.id === clipId)!, layout);
  const fx = Math.sin(facing), fz = Math.cos(facing), side: V3 = [-fz, 0, fx];
  const points = [new THREE.Vector3(...target)], root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  for (const x of [-1, 1]) for (const y of [-1, 1]) points.push(new THREE.Vector3(target[0] + side[0] * width * x, target[1] + height * y, target[2] + side[2] * width * x));
  for (const s of samples) {
    clip.sample(s.time, skel.rot, root); skel.x = s.root[0]; skel.y = s.root[1] + root.y; skel.z = s.root[2]; skel.facing = facing; skel.update();
    for (const name of ['handR', 'handL']) points.push(skel.jointPos(layout.idx(name), new THREE.Vector3()));
    if (s.time >= MASK_CONTACT) points.push(skel.jointPoint(layout.idx('blade'), 0, FINISHER_EDGE_Y, 0, new THREE.Vector3()));
  }
  return fitShot(points, facing, fov, -0.42, 0.2);
}

function fitShot(points: THREE.Vector3[], facing: number, fov: number, forward: number, rise: number): { cam: V3; look: V3 } {
  const look = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const fx = Math.sin(facing), fz = Math.cos(facing), side = Math.sqrt(1 - forward * forward), dx = fx * forward - fz * side, dz = fz * forward + fx * side;
  const camera = new THREE.PerspectiveCamera(fov, 1.7, 0.05, 500);
  let dist = 3.8;
  for (let i = 0; i < 75; i++) {
    camera.position.set(look.x + dx * dist, look.y + dist * rise, look.z + dz * dist); camera.lookAt(look); camera.updateMatrixWorld(true);
    if (points.every(p => { const q = p.clone().project(camera); return Math.abs(q.x) < 0.85 && Math.abs(q.y) < 0.69 && q.z > -1 && q.z < 1; })) break;
    dist *= 1.035;
  }
  return { cam: camera.position.toArray() as V3, look: look.toArray() as V3 };
}
