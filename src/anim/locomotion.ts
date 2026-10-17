import * as THREE from 'three';
import type { RigLayout } from './skeleton';

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _r = new THREE.Quaternion();

/** Записать Эйлер сустава поверх его покоя: out[j] = rest[j] · euler. */
export function setJoint(out: Float32Array, layout: RigLayout, j: number, x: number, y: number, z: number): void {
  _r.fromArray(layout.restRot, j * 4);
  _q.setFromEuler(_e.set(x, y, z));
  _r.multiply(_q);
  out[j * 4] = _r.x; out[j * 4 + 1] = _r.y; out[j * 4 + 2] = _r.z; out[j * 4 + 3] = _r.w;
}

/** Аддитивный поворот: out[j] = out[j] · euler (дыхание, вздрагивание, взгляд). */
export function addJoint(out: Float32Array, j: number, x: number, y: number, z: number): void {
  _r.fromArray(out, j * 4);
  _q.setFromEuler(_e.set(x, y, z));
  _r.multiply(_q);
  out[j * 4] = _r.x; out[j * 4 + 1] = _r.y; out[j * 4 + 2] = _r.z; out[j * 4 + 3] = _r.w;
}

export interface BipedJoints {
  pelvis: number; spine: number; chest: number; head: number;
  shL: number; elbL: number; shR: number; elbR: number;
  hipL: number; kneeL: number; footL: number; hipR: number; kneeR: number; footR: number;
  blade?: number;
}

export function bipedJoints(l: RigLayout): BipedJoints {
  return {
    pelvis: l.idx('pelvis'), spine: l.idx('spine'), chest: l.idx('chest'), head: l.idx('head'),
    shL: l.idx('shL'), elbL: l.idx('elbL'), shR: l.idx('shR'), elbR: l.idx('elbR'),
    hipL: l.idx('hipL'), kneeL: l.idx('kneeL'), footL: l.idx('footL'),
    hipR: l.idx('hipR'), kneeR: l.idx('kneeR'), footR: l.idx('footR'),
    blade: l.has('blade') ? l.idx('blade') : undefined,
  };
}

/**
 * Процедурная походка двуногого (Tech §8.3): фаза шага растёт от пройденного пути, а не от времени → ноги не «скользят».
 * Амплитуда от скорости, наклон корпуса от скорости и ускорения, покачивание корня.
 */
export class BipedGait {
  phase = 0;
  amp = 0;
  lean = 0;
  time = 0;
  /** Вертикальное смещение корня (покачивание) — читать после write(). */
  bob = 0;

  constructor(readonly stride = 1.7, readonly runSpeed = 5.5, readonly heavy = false) {}

  update(dist: number, speed: number, accel: number, dt: number): void {
    this.time += dt;
    this.phase += dist / this.stride;
    const target = Math.min(1, speed / this.runSpeed);
    this.amp += (target - this.amp) * Math.min(1, dt * 14);
    this.lean += (accel * 0.03 - this.lean) * Math.min(1, dt * 8);
  }

  /** Записать позу в out (кватернионы суставов). bladeBack — клинок отведён назад (бег героя). */
  write(out: Float32Array, layout: RigLayout, J: BipedJoints, bladeBack = true): void {
    out.set(layout.restRot);
    const a = this.amp, ph = this.phase * Math.PI * 2;
    const s = Math.sin(ph), c = Math.cos(ph);
    const breathe = Math.sin(this.time * Math.PI * 2 * 0.25) * (1 - a);
    const hk = this.heavy ? 0.45 : 0.7;
    // ноги
    setJoint(out, layout, J.hipL, hk * s * a - 0.05 * (1 - a), 0, 0.03);
    setJoint(out, layout, J.hipR, -hk * s * a + 0.05 * (1 - a), 0, -0.03);
    const kneeIdle = 0.12 * (1 - a);
    const kL = Math.max(0, -s) * 1.1 * a + kneeIdle + 0.1 * a;
    const kR = Math.max(0, s) * 1.1 * a + kneeIdle + 0.1 * a;
    setJoint(out, layout, J.kneeL, kL, 0, 0);
    setJoint(out, layout, J.kneeR, kR, 0, 0);
    setJoint(out, layout, J.footL, -(hk * s * a) * 0.5 - kL * 0.6 + 0.1 * a, 0, 0);
    setJoint(out, layout, J.footR, (hk * s * a) * 0.5 - kR * 0.6 + 0.1 * a, 0, 0);
    // корпус: наклон вперёд ~12° на бегу + от ускорения, скручивание в такт шагу
    const lean = 0.21 * a + this.lean;
    setJoint(out, layout, J.pelvis, 0.05 * a, s * 0.12 * a, 0);
    setJoint(out, layout, J.spine, lean * 0.5 + breathe * 0.025, -s * 0.08 * a, 0);
    setJoint(out, layout, J.chest, lean * 0.5 + breathe * 0.02, -s * 0.1 * a, 0);
    setJoint(out, layout, J.head, -lean * 0.6, s * 0.05 * a, 0);
    // левая рука — противофаза, правая держит клинок
    setJoint(out, layout, J.shL, -s * 0.7 * a + 0.05, 0, 0.18 + 0.1 * (1 - a) + breathe * 0.02);
    setJoint(out, layout, J.elbL, -0.35 - 0.5 * a - Math.max(0, s) * 0.4 * a, 0, 0);
    if (bladeBack) {
      setJoint(out, layout, J.shR, 0.35 + 0.35 * a + c * 0.05 * a, 0.1, -0.32 - 0.12 * a);
      setJoint(out, layout, J.elbR, -0.55 + 0.15 * a, 0, 0);
    } else {
      setJoint(out, layout, J.shR, s * 0.7 * a + 0.05, 0, -0.18 - 0.1 * (1 - a));
      setJoint(out, layout, J.elbR, -0.35 - 0.5 * a - Math.max(0, -s) * 0.4 * a, 0, 0);
    }
    if (J.blade !== undefined) setJoint(out, layout, J.blade, bladeBack ? 1.05 + 0.15 * a : 0, 0, 0);
    this.bob = Math.abs(c) * 0.06 * a - 0.03 * a + breathe * 0.008;
  }
}
