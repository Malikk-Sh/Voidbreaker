import * as THREE from 'three';
import type { Rng } from '../core/rng';

export type V3 = [number, number, number];
export interface JointDef { name: string; parent?: string; pos: V3; rot?: V3 }
export interface RigDef { id: string; joints: JointDef[] }

const _m = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _root = new THREE.Matrix4();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

/** Индексы суставов по имени — общие для всех экземпляров рига. */
export class RigLayout {
  readonly n: number;
  readonly parent: Int16Array;
  readonly rest: Float32Array;
  readonly restRot: Float32Array;
  readonly names: string[];
  private map = new Map<string, number>();
  constructor(readonly def: RigDef) {
    this.n = def.joints.length;
    this.parent = new Int16Array(this.n);
    this.rest = new Float32Array(this.n * 3);
    this.restRot = new Float32Array(this.n * 4);
    this.names = def.joints.map((j) => j.name);
    def.joints.forEach((j, i) => this.map.set(j.name, i));
    def.joints.forEach((j, i) => {
      const p = j.parent ? this.map.get(j.parent) : -1;
      if (p === undefined) throw new Error(`rig ${def.id}: unknown parent ${j.parent}`);
      if (p >= i) throw new Error(`rig ${def.id}: parent ${j.parent} must precede ${j.name}`);
      this.parent[i] = p;
      this.rest.set(j.pos, i * 3);
      _q.setFromEuler(_e.set(...(j.rot ?? [0, 0, 0])));
      this.restRot.set([_q.x, _q.y, _q.z, _q.w], i * 4);
    });
  }
  idx(name: string): number {
    const i = this.map.get(name);
    if (i === undefined) throw new Error(`rig ${this.def.id}: no joint ${name}`);
    return i;
  }
  has(name: string): boolean { return this.map.has(name); }
}

interface Debris { vx: number; vy: number; vz: number; ax: number; ay: number; az: number; w: number; px: number; py: number; pz: number; q: THREE.Quaternion; s: THREE.Vector3; rest: boolean; delay: number; stickY?: number }

/**
 * Особые обломки распада: stick — сустав → высота, на которой клинок застревает в полу; pop — лопнуть наружу;
 * implode — тело складывается внутрь себя (детали падают к центру).
 */
export interface ShatterOpts { stick?: ReadonlyMap<number, number>; pop?: ReadonlySet<number>; implode?: boolean }

/**
 * Экземпляр скелета: локальные повороты суставов (кватернионы) → мировые матрицы.
 * Корень: позиция, разворот по Y (facing), масштаб корня (squash & stretch, Tech §8.6).
 */
export class Skeleton {
  readonly n: number;
  readonly rot: Float32Array;
  readonly off: Float32Array;
  readonly scl: Float32Array;
  readonly world: Float32Array;
  x = 0; y = 0; z = 0; facing = 0;
  /** Масштаб корня в локальных осях (x — вбок, y — вверх, z — вперёд). */
  sx = 1; sy = 1; sz = 1;
  /** Наклон корпуса целиком (рад) вокруг локальных осей X (вперёд) и Z (вбок). */
  tiltX = 0; tiltZ = 0;
  size = 1;
  broken = false;
  private debris: Debris[] = [];

  constructor(readonly layout: RigLayout) {
    this.n = layout.n;
    this.rot = new Float32Array(this.n * 4);
    this.off = new Float32Array(this.n * 3);
    this.scl = new Float32Array(this.n * 3).fill(1);
    this.world = new Float32Array(this.n * 16);
    this.resetPose();
  }

  resetPose(): void {
    this.rot.set(this.layout.restRot);
    this.off.fill(0);
    this.scl.fill(1);
  }

  update(): void {
    if (this.broken) { this.updateDebrisMatrices(); return; }
    const L = this.layout;
    _q.setFromEuler(_e.set(this.tiltX, this.facing, this.tiltZ, 'YXZ'));
    _root.compose(_p.set(this.x, this.y, this.z), _q, _s.set(this.sx * this.size, this.sy * this.size, this.sz * this.size));
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, i4 = i * 4;
      _p.set(L.rest[i3] + this.off[i3], L.rest[i3 + 1] + this.off[i3 + 1], L.rest[i3 + 2] + this.off[i3 + 2]);
      _q.set(this.rot[i4], this.rot[i4 + 1], this.rot[i4 + 2], this.rot[i4 + 3]);
      _s.set(this.scl[i3], this.scl[i3 + 1], this.scl[i3 + 2]);
      _m.compose(_p, _q, _s);
      const p = L.parent[i];
      if (p < 0) _pm.copy(_root); else _pm.fromArray(this.world, p * 16);
      _pm.multiply(_m);
      _pm.toArray(this.world, i * 16);
    }
  }

  /** Мировая позиция сустава. */
  jointPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    const o = i * 16;
    return out.set(this.world[o + 12], this.world[o + 13], this.world[o + 14]);
  }

  /** Точка в локальных координатах сустава → мир. */
  jointPoint(i: number, lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    _pm.fromArray(this.world, i * 16);
    return out.set(lx, ly, lz).applyMatrix4(_pm);
  }

  setRotEuler(i: number, x: number, y: number, z: number): void {
    _q.setFromEuler(_e.set(x, y, z));
    this.rot.set([_q.x, _q.y, _q.z, _q.w], i * 4);
  }

  /**
   * Распад (GDD §15.2, план §7.1): детали отрываются от суставов и разлетаются с физикой — по сегментам:
   * корпус сразу (ядро уже треснуло и погасло), дальше от корня — позже (броня, затем конечности), до ~0.3 с.
   */
  shatter(dirX: number, dirZ: number, power: number, rng: Rng, opts?: ShatterOpts): void {
    if (this.broken) return;
    this.update();
    this.broken = true;
    this.debris.length = 0;
    const depth = new Int16Array(this.n);
    for (let i = 0; i < this.n; i++) { const p = this.layout.parent[i]; depth[i] = p >= 0 ? depth[p] + 1 : 0; }
    for (let i = 0; i < this.n; i++) {
      _pm.fromArray(this.world, i * 16);
      const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      _pm.decompose(p, q, s);
      const rx = p.x - this.x, rz = p.z - this.z;
      const rl = Math.hypot(rx, rz) || 1;
      const k = power * (0.6 + rng.next() * 0.8);
      const ax = rng.spread(1), ay = rng.spread(1), az = rng.spread(1);
      const al = Math.hypot(ax, ay, az) || 1;
      this.debris.push({
        px: p.x, py: p.y, pz: p.z,
        vx: dirX * k + (rx / rl) * power * 0.5 * rng.next(),
        vy: 2 + rng.next() * 4 * Math.min(1.5, power / 4),
        vz: dirZ * k + (rz / rl) * power * 0.5 * rng.next(),
        ax: ax / al, ay: ay / al, az: az / al, w: rng.range(4, 14),
        q, s, rest: false, delay: Math.min(0.3, Math.max(0, depth[i] - 2) * 0.06) + rng.next() * 0.03,
      });
      const d = this.debris[i];
      const stick = opts?.stick?.get(i);
      if (stick !== undefined) {
        // клинок падает остриём вниз и втыкается: ось −Y детали — к полу, лёгкий наклон
        d.q.setFromAxisAngle(_p.set(rng.spread(1), 0, rng.spread(1)).normalize(), rng.range(0.1, 0.35));
        d.q.multiply(_q.setFromAxisAngle(_p.set(0, 1, 0), rng.next() * Math.PI * 2));
        d.vx = (rx / rl) * 1.2 + dirX * 0.8; d.vz = (rz / rl) * 1.2 + dirZ * 0.8; d.vy = 2.5;
        d.w = 0; d.stickY = stick;
      } else if (opts?.pop?.has(i)) {
        // лопнуть наружу: рёбра разлетаются от груди
        d.vx += (rx / rl) * power * 0.8; d.vz += (rz / rl) * power * 0.8; d.vy += 3; d.delay = 0;
      } else if (opts?.implode) {
        d.vx = -rx * 3 + dirX * 0.5; d.vz = -rz * 3 + dirZ * 0.5; d.vy = rng.range(-0.5, 1); d.delay *= 0.5;
      }
    }
  }

  stepDebris(dt: number): void {
    if (!this.broken) return;
    for (const d of this.debris) {
      if (d.rest) continue;
      // сегмент ещё держится: конечности отрываются после корпуса
      if (d.delay > 0) { d.delay -= dt; continue; }
      d.vy -= 18 * dt;
      d.px += d.vx * dt; d.py += d.vy * dt; d.pz += d.vz * dt;
      if (d.stickY !== undefined) {
        if (d.py <= d.stickY && d.vy < 0) { d.py = d.stickY; d.rest = true; }
        continue;
      }
      if (d.py < 0.05) {
        d.py = 0.05; d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; d.w *= 0.6;
        if (Math.abs(d.vy) < 0.6 && Math.hypot(d.vx, d.vz) < 0.3) d.rest = true;
      }
      _q.setFromAxisAngle(_p.set(d.ax, d.ay, d.az), d.w * dt);
      d.q.premultiply(_q);
    }
  }

  private updateDebrisMatrices(): void {
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      _m.compose(_p.set(d.px, d.py, d.pz), d.q, d.s);
      _m.toArray(this.world, i * 16);
    }
  }

  revive(): void { this.broken = false; this.debris.length = 0; this.resetPose(); }
}

