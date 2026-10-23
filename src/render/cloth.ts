import * as THREE from 'three';
import type { VerletCloth } from '../anim/verlet';
import { obsidianMaterial, type ObsidianOpts } from './materials';
import { hexToLinear } from '../core/math';

/**
 * Ткань (плащ, шарф, вуали): сетка, вершины которой — точки Верле (Tech §8.5).
 * Плоские нормали пересчитываются каждый кадр; нижний край светится (эмиссия по ряду).
 */
export class ClothMesh {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly geo: THREE.BufferGeometry;

  constructor(readonly cloth: VerletCloth, color: string, opts: ObsidianOpts, edgeRows = 1, edgeGlow = 1.0) {
    const quads = (cloth.w - 1) * (cloth.h - 1);
    const vcount = quads * 6;
    this.pos = new Float32Array(vcount * 3);
    this.nor = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const emi = new Float32Array(vcount);
    const c = hexToLinear(color);
    let v = 0;
    for (let j = 0; j < cloth.h - 1; j++) {
      for (let i = 0; i < cloth.w - 1; i++) {
        for (const [di, dj] of [[0, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0]]) {
          const row = j + dj;
          const shade = 0.85 + 0.3 * ((i + j) % 2);
          col[v * 3] = c[0] * shade; col[v * 3 + 1] = c[1] * shade; col[v * 3 + 2] = c[2] * shade;
          emi[v] = row >= cloth.h - edgeRows ? edgeGlow : 0;
          void di;
          v++;
        }
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.geo.setAttribute('aEmissive', new THREE.BufferAttribute(emi, 1));
    this.geo.setAttribute('aJoint', new THREE.BufferAttribute(new Float32Array(vcount), 1));
    this.mesh = new THREE.Mesh(this.geo, obsidianMaterial({ ...opts, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }

  /** Плоский треугольник ткани с нормалью грани (без замыканий и временных массивов). */
  private tri(v: number, a: number, b: number, c: number): number {
    const P = this.cloth.p, pos = this.pos, nor = this.nor;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const ux = P[b] - ax, uy = P[b + 1] - ay, uz = P[b + 2] - az;
    const vx = P[c] - ax, vy = P[c + 1] - ay, vz = P[c + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let q = 0; q < 3; q++) {
      const k = q === 0 ? a : q === 1 ? b : c;
      pos[v * 3] = P[k]; pos[v * 3 + 1] = P[k + 1]; pos[v * 3 + 2] = P[k + 2];
      nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
      v++;
    }
    return v;
  }

  sync(): void {
    const w = this.cloth.w;
    let v = 0;
    for (let j = 0; j < this.cloth.h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = (j * w + i) * 3, b = ((j + 1) * w + i) * 3, c = ((j + 1) * w + i + 1) * 3, d = (j * w + i + 1) * 3;
        v = this.tri(v, a, b, c);
        v = this.tri(v, a, c, d);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
