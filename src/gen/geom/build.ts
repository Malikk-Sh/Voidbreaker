import * as THREE from 'three';
import { hexToLinear } from '../../core/math';
import { Rng } from '../../core/rng';

export type RGB = [number, number, number];

export interface AddOpts {
  /** Цвет граней (линейный RGB или hex). */
  color?: RGB | string;
  /** Разброс яркости граней ±, «каждая грань ловит свет по-своему». */
  shade?: number;
  emissive?: number;
  /** Эмиссия по грани: центр грани (локально) → 0..1. Прожилки, руны. */
  emissiveFn?: (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number) => number;
  joint?: number;
  matrix?: THREE.Matrix4;
  rng?: Rng;
}

const toLin = (c: RGB | string): RGB => (typeof c === 'string' ? hexToLinear(c) : c);

/**
 * Сборщик огранённой геометрии (Tech §5.1, §5.4): неиндексированные треугольники с плоскими нормалями,
 * цвет и эмиссия — в атрибутах вершин, плюс индекс сустава для жёсткого риггинга (без весов).
 */
export class GeomBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private emi: number[] = [];
  private jnt: number[] = [];
  private readonly va = new THREE.Vector3();
  private readonly vb = new THREE.Vector3();
  private readonly vc = new THREE.Vector3();
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  color: RGB = [0.02, 0.018, 0.03];
  emissive = 0;
  joint = 0;
  shade = 0.18;
  rng = new Rng(1);
  matrix = new THREE.Matrix4();

  get vertexCount(): number { return this.pos.length / 3; }

  /** Треугольник в локальных координатах текущей матрицы; нормаль считается после трансформации. */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
      color?: RGB, emissive?: number): void {
    const a = this.va.set(ax, ay, az).applyMatrix4(this.matrix);
    const b = this.vb.set(bx, by, bz).applyMatrix4(this.matrix);
    const c = this.vc.set(cx, cy, cz).applyMatrix4(this.matrix);
    this.e1.subVectors(b, a); this.e2.subVectors(c, a);
    const n = this.n.crossVectors(this.e1, this.e2);
    if (n.lengthSq() < 1e-14) return;
    n.normalize();
    const col = color ?? this.faceColor();
    const em = emissive ?? this.emissive;
    for (const v of [a, b, c]) {
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(col[0], col[1], col[2]);
      this.emi.push(em);
      this.jnt.push(this.joint);
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], color?: RGB, emissive?: number): void {
    const col = color ?? this.faceColor();
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col, emissive);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], col, emissive);
  }

  /** Квад, гарантированно смотрящий наружу от точки (cx,cy,cz) — для выпуклых оболочек. */
  quadOut(a: number[], b: number[], c: number[], d: number[], cx: number, cy: number, cz: number, color?: RGB, emissive?: number): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - cx, my = (a[1] + b[1] + c[1] + d[1]) / 4 - cy, mz = (a[2] + b[2] + c[2] + d[2]) / 4 - cz;
    if (nx * mx + ny * my + nz * mz >= 0) this.quad(a, b, c, d, color, emissive);
    else this.quad(d, c, b, a, color, emissive);
  }

  private faceColor(base: RGB = this.color, shade = this.shade): RGB {
    const k = 1 + this.rng.spread(shade);
    return [base[0] * k, base[1] * k, base[2] * k];
  }

  /** Добавить геометрию Three.js: переводится в неиндексированную, каждая грань — свой цвет и плоская нормаль. */
  add(geo: THREE.BufferGeometry, o: AddOpts = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const prevM = this.matrix.clone(), prevJ = this.joint, prevE = this.emissive, prevS = this.shade, prevC = this.color;
    const prevR = this.rng;
    if (o.matrix) this.matrix = prevM.clone().multiply(o.matrix);
    if (o.joint !== undefined) this.joint = o.joint;
    if (o.emissive !== undefined) this.emissive = o.emissive;
    if (o.shade !== undefined) this.shade = o.shade;
    if (o.color !== undefined) this.color = toLin(o.color);
    if (o.rng) this.rng = o.rng;
    for (let i = 0; i + 2 < p.count; i += 3) {
      const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i);
      const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
      const cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
      let em: number | undefined;
      if (o.emissiveFn) {
        this.e1.set(bx - ax, by - ay, bz - az); this.e2.set(cx - ax, cy - ay, cz - az);
        const n = this.n.crossVectors(this.e1, this.e2).normalize();
        em = o.emissiveFn((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, n.x, n.y, n.z);
      }
      this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, undefined, em);
    }
    this.matrix = prevM; this.joint = prevJ; this.emissive = prevE; this.shade = prevS; this.color = prevC; this.rng = prevR;
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }

  /** Вклеить уже собранный билдер (например, деталь из другого генератора). */
  append(other: GeomBuilder, matrix?: THREE.Matrix4, joint?: number): this {
    const m = matrix ? this.matrix.clone().multiply(matrix) : this.matrix;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < other.pos.length; i += 3) {
      v.set(other.pos[i], other.pos[i + 1], other.pos[i + 2]).applyMatrix4(m);
      n.set(other.nor[i], other.nor[i + 1], other.nor[i + 2]).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(other.col[i], other.col[i + 1], other.col[i + 2]);
    }
    for (let i = 0; i < other.emi.length; i++) {
      this.emi.push(other.emi[i]);
      this.jnt.push(joint ?? other.jnt[i]);
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aEmissive', new THREE.Float32BufferAttribute(this.emi, 1));
    g.setAttribute('aJoint', new THREE.Float32BufferAttribute(this.jnt, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Сырые массивы — для передачи из Web Worker (transferable). */
  arrays(): { position: Float32Array; normal: Float32Array; color: Float32Array; emissive: Float32Array; joint: Float32Array } {
    return {
      position: new Float32Array(this.pos), normal: new Float32Array(this.nor), color: new Float32Array(this.col),
      emissive: new Float32Array(this.emi), joint: new Float32Array(this.jnt),
    };
  }
}

export function geometryFromArrays(a: ReturnType<GeomBuilder['arrays']>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(a.color, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(a.emissive, 1));
  g.setAttribute('aJoint', new THREE.BufferAttribute(a.joint, 1));
  g.computeBoundingSphere();
  return g;
}

/** Быстрые конструкторы матриц для деталей. */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function mat(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return new THREE.Matrix4().compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}

/** Поворот, направляющий ось +Y вдоль вектора (dx,dy,dz) и сдвиг в точку. */
export function matAlong(px: number, py: number, pz: number, dx: number, dy: number, dz: number, sx = 1, sy = 1, sz = sx): THREE.Matrix4 {
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return new THREE.Matrix4().compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}
