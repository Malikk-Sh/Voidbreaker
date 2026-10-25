import type { V3 } from './director';
import * as THREE from 'three';
import { Clip } from '../anim/clip';
import { RigLayout, Skeleton } from '../anim/skeleton';
import { EXECUTION_CLIPS } from '../anim/clips/execution';
import { HERO_RIG, BLADE_LEN } from '../gen/chars/hero';

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

/** Один неподвижный передний ракурс на весь замах, контакт и дожим. Камера не подменяет скорость меча. */
export function attackFraming(clipId: string, facing: number, samples: { time: number; root: V3 }[], target: V3, fov = 44): { cam: V3; look: V3 } {
  const layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout), clip = new Clip(EXECUTION_CLIPS.find(c => c.id === clipId)!, layout);
  const points = [new THREE.Vector3(...target)], root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  for (const s of samples) {
    clip.sample(s.time, skel.rot, root); skel.x = s.root[0]; skel.y = s.root[1] + root.y; skel.z = s.root[2]; skel.facing = facing; skel.update();
    for (const name of ['head', 'handR', 'handL', 'footL', 'footR']) points.push(skel.jointPoint(layout.idx(name), 0, name === 'head' ? 0.36 : 0, 0, new THREE.Vector3()));
    points.push(skel.jointPoint(layout.idx('blade'), 0, -BLADE_LEN - 0.02, 0, new THREE.Vector3()));
  }
  const look = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const fx = Math.sin(facing), fz = Math.cos(facing), dx = fx * 0.38 - fz * 0.925, dz = fz * 0.38 + fx * 0.925;
  const camera = new THREE.PerspectiveCamera(fov, 1.7, 0.05, 500);
  let dist = 3.8;
  for (let i = 0; i < 75; i++) {
    camera.position.set(look.x + dx * dist, look.y + dist * 0.25, look.z + dz * dist); camera.lookAt(look); camera.updateMatrixWorld(true);
    if (points.every(p => { const q = p.clone().project(camera); return Math.abs(q.x) < 0.85 && Math.abs(q.y) < 0.69 && q.z > -1 && q.z < 1; })) break;
    dist *= 1.035;
  }
  return { cam: camera.position.toArray() as V3, look: look.toArray() as V3 };
}
