import * as THREE from 'three';
import { Rng } from '../../core/rng';

/**
 * Гибель Сердца без остатков. В момент вспышки обруч разлетается на звенья и шипы, оставшиеся пластины брони
 * срываются с ядра, а сорванные раньше трескаются на полу, когда до них доходит золотая волна. Всё катится по
 * полу и рассыпается пеплом до кадра победы. Каждый кусок — функция времени после вспышки, поэтому полная,
 * короткая и пропущенная сцены дают одно и то же: после done от Сердца остаётся только колодец.
 *
 * gravity — м/с²; floorY — высота пола зала; crumble — сколько рассыпается кусок (с); sinkTo — куда падают
 * куски, угодившие в колодец; done — к этому моменту после вспышки не остаётся ни одного куска;
 * wave — скорость золотой волны (м/с), той же, что возвращает огонь свечам.
 */
export const REMAINS = { gravity: 11, floorY: 0.08, crumble: 0.55, sinkTo: -6, done: 2.2, wave: 16 };

/** Колодец под Сердцем (координаты зала): внутри эллипса пола нет. */
export function inHeartWell(x: number, z: number): boolean { return Math.hypot(x / 5.4, (z + 0.5) / 4.4) < 1; }

export interface RemainsPiece {
  readonly pos: THREE.Vector3;
  readonly quat: THREE.Quaternion;
  readonly scale: THREE.Vector3;
  /** Начальная скорость (м/с); нулевая — кусок уже лежит на полу. */
  readonly v: THREE.Vector3;
  readonly axis: THREE.Vector3;
  readonly spin: number;
  /** Когда кусок начинает рассыпаться (с после вспышки). */
  readonly crumbleAt: number;
  /** Когда кусок ложится на пол (с после вспышки); Infinity — улетел в колодец. */
  readonly landAt: number;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

/**
 * Кусок из позы в момент вспышки. fling — куда и как сильно его бросает (0 — лежит и только рассыпается);
 * crumbleAt — когда рассыпаться. Скорость и вращение — от сида: один и тот же кусок летит одинаково.
 */
export function makePiece(start: THREE.Matrix4, seed: string, fling: { out: number; up: number; spin: number } | null, crumbleAt: number, center = { x: 0, z: 0 }): RemainsPiece {
  const rng = new Rng(seed);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  start.decompose(pos, quat, scale);
  const v = new THREE.Vector3();
  if (fling) {
    let dx = pos.x - center.x, dz = pos.z - center.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) { const a = rng.range(0, Math.PI * 2); dx = Math.sin(a); dz = Math.cos(a); } else { dx /= l; dz /= l; }
    // Небольшой разброс направления: обруч рвётся не идеально ровно.
    const a = Math.atan2(dx, dz) + rng.spread(0.35), out = fling.out * rng.range(0.75, 1.25);
    v.set(Math.sin(a) * out, fling.up * rng.range(0.75, 1.25), Math.cos(a) * out);
  }
  const axis = new THREE.Vector3(rng.spread(1), rng.spread(1), rng.spread(1));
  if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
  axis.normalize();
  const spin = fling ? fling.spin * rng.range(0.7, 1.3) * (rng.next() < 0.5 ? -1 : 1) : 0;
  let landAt = 0;
  if (fling) {
    const g = REMAINS.gravity, h = Math.max(0, pos.y - REMAINS.floorY);
    landAt = (v.y + Math.sqrt(v.y * v.y + 2 * g * h)) / g;
    if (inHeartWell(pos.x + v.x * landAt, pos.z + v.z * landAt)) landAt = Infinity;
  }
  return { pos, quat, scale, v, axis, spin, crumbleAt, landAt };
}

/**
 * Поза куска через u с после вспышки в out (координаты зала). Возвращает, насколько он рассыпался: 0 — цел,
 * 1 — исчез (масштаб 0). Кусок в колодце просто падает из вида.
 */
export function piecePose(p: RemainsPiece, u: number, out: THREE.Matrix4): number {
  if (u <= 0) { out.compose(p.pos, p.quat, p.scale); return 0; }
  if (u >= REMAINS.done) { out.compose(p.pos, p.quat, _s.set(0, 0, 0)); return 1; }
  const g = REMAINS.gravity, t = Math.min(u, p.landAt);
  _p.set(p.pos.x + p.v.x * t, p.pos.y + p.v.y * t - 0.5 * g * t * t, p.pos.z + p.v.z * t);
  if (Number.isFinite(p.landAt) && u >= p.landAt) _p.y = REMAINS.floorY;
  _q.setFromAxisAngle(p.axis, p.spin * t).multiply(p.quat);
  const k = _p.y < REMAINS.sinkTo ? 1 : Math.max(0, Math.min(1, (u - p.crumbleAt) / REMAINS.crumble));
  // Рассыпаясь, кусок оседает и съёживается неровно: сперва тоньше, потом пропадает.
  const shrink = 1 - k;
  _s.set(p.scale.x * shrink, p.scale.y * shrink * shrink, p.scale.z * shrink);
  _p.y -= 0.12 * k;
  out.compose(_p, _q, _s);
  return k;
}
