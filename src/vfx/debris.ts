import * as THREE from 'three';
import { GeomBuilder, mat } from '../gen/geom/build';
import { shard } from '../gen/geom/prims';
import { obsidianMaterial } from '../render/materials';
import { fxRng } from '../core/rng';

interface Piece { x: number; y: number; z: number; vx: number; vy: number; vz: number; q: THREE.Quaternion; ax: THREE.Vector3; w: number; s: number; t: number; life: number; alive: boolean; v: number }

/**
 * Осколки обсидиана (GDD §16.1): 6–20 чёрных кристаллов с цветной кромкой, отскакивают от пола и растворяются.
 * Инстансы генератора осколков с псевдо-физикой.
 */
export class Debris {
  readonly meshes: THREE.InstancedMesh[] = [];
  private pieces: Piece[] = [];
  private readonly _m = new THREE.Matrix4(); private readonly _q = new THREE.Quaternion(); private readonly _p = new THREE.Vector3(); private readonly _s = new THREE.Vector3();

  constructor(readonly max = 220, emissive = '#FF4A57', rim = '#c0303d') {
    const variants = 3;
    for (let v = 0; v < variants; v++) {
      const b = new GeomBuilder();
      b.color = [0.012, 0.01, 0.016];
      b.add(shard(1, 0.32, 4 + v, 0.35, v * 7), { matrix: mat(0, -0.5, 0) });
      b.add(shard(0.35, 0.05, 3, 0.2, v), { matrix: mat(0.12, -0.3, 0.1, 0.3, 0, 0.2), emissive: 1.2 });
      const g = b.build();
      const m = new THREE.InstancedMesh(g, obsidianMaterial({ rim, rimStrength: 0.8, emissive, emissiveStrength: 1.6 }), Math.ceil(max / variants));
      m.count = 0;
      m.frustumCulled = false;
      this.meshes.push(m);
    }
  }

  burst(x: number, y: number, z: number, dirX: number, dirZ: number, count: number, power = 4, size = 0.22): void {
    const r = fxRng;
    for (let i = 0; i < count; i++) {
      if (this.pieces.length >= this.max) this.pieces.shift();
      const a = Math.atan2(dirX, dirZ) + r.spread(1.1);
      const sp = power * r.range(0.4, 1.2);
      this.pieces.push({
        x: x + r.spread(0.2), y: y + r.spread(0.2), z: z + r.spread(0.2),
        vx: Math.sin(a) * sp, vy: r.range(2, 6) * (power / 4), vz: Math.cos(a) * sp,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r.next() * 6, r.next() * 6, r.next() * 6)),
        ax: new THREE.Vector3(r.spread(1), r.spread(1), r.spread(1)).normalize(), w: r.range(6, 18),
        s: size * r.range(0.5, 1.4), t: 0, life: r.range(0.9, 1.6), alive: true, v: i % 3,
      });
    }
  }

  update(dt: number): void {
    const counts = [0, 0, 0];
    for (const p of this.pieces) {
      if (!p.alive) continue;
      p.t += dt;
      p.vy -= 20 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.s * 0.3) { p.y = p.s * 0.3; p.vy *= -0.35; p.vx *= 0.65; p.vz *= 0.65; p.w *= 0.7; }
      this._q.setFromAxisAngle(p.ax, p.w * dt); p.q.premultiply(this._q);
      if (p.t > p.life) p.alive = false;
      const k = p.t > p.life - 0.3 ? Math.max(0, (p.life - p.t) / 0.3) : 1;
      const mesh = this.meshes[p.v];
      const idx = counts[p.v]++;
      if (idx >= mesh.instanceMatrix.count) continue;
      this._m.compose(this._p.set(p.x, p.y, p.z), p.q, this._s.setScalar(p.s * k));
      mesh.setMatrixAt(idx, this._m);
    }
    this.pieces = this.pieces.filter((p) => p.alive);
    this.meshes.forEach((m, i) => { m.count = Math.min(counts[i], m.instanceMatrix.count); m.instanceMatrix.needsUpdate = true; });
  }

  clear(): void { this.pieces.length = 0; for (const m of this.meshes) m.count = 0; }
}
