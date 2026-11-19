import * as THREE from 'three';
import type { QuarryPatterns } from '../../world/boss/quarryPatterns';
import { GeomBuilder, mat } from '../geom/build';
import { rock } from '../geom/prims';

/** The same broken stone severs the floor, falls from the gantries, then streams into the maw. */
export class QuarryRubble {
  readonly mesh: THREE.InstancedMesh;
  private readonly piece = new THREE.Object3D();

  constructor(material: THREE.Material) {
    const g = new GeomBuilder();
    g.add(rock(1, 0, 0.18, 21), { matrix: mat(0, 0, 0), color: '#84969d' });
    g.add(rock(0.78, 0, 0.13, 13), { matrix: mat(0.16, 0.25, -0.18), color: '#d7b07f', emissive: -0.47 });
    this.mesh = new THREE.InstancedMesh(g.build(), material, 40);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  private place(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tilt: number): void {
    const p = this.piece;
    p.position.set(x, y, z);
    p.scale.set(sx, sy, sz);
    p.rotation.set(tilt, yaw, tilt * 0.45);
    p.updateMatrix();
    this.mesh.setMatrixAt(this.mesh.count++, p.matrix);
  }

  sync(sequence: QuarryPatterns | null): void {
    this.mesh.count = 0;
    if (!sequence?.kind) return;
    const t = sequence.elapsed;
    for (const m of sequence.marks) {
      if (!m.warning) continue;
      const s = m.shape;
      const u = Math.min(1, (t - m.show) / (m.at - m.show));
      if (m.kind === 'slab' && s.k === 'circle' && !m.struck) {
        // The shadow of the circular warning stays visible around the falling plates.
        const height = 0.35 + 6.2 * (1 - u * u);
        for (let i = 0; i < 3; i++) {
          const a = 2.1 * i + m.show * 3;
          this.place(s.x + Math.sin(a) * 0.76, height + i * 0.25, s.z + Math.cos(a) * 0.76,
            0.78, 0.38, 1.18, a + 0.3 * u, 0.15 + (i - 1) * u);
        }
      } else if (m.kind === 'crack' && s.k === 'line') {
        for (let i = 0; i < 10; i++) {
          const d = (i + 0.6) * s.len / 10;
          const beat = t - m.at - (i / 10) * 0.11;
          if (beat < 0 || beat >= 0.42) continue;
          const size = Math.sin(Math.PI * beat / 0.42);
          this.place(s.x + d * s.dx, 0.08 + size * 0.34, s.z + d * s.dz,
            size * 0.46, size * (0.72 + 0.2 * (i % 3)), size * 0.87, Math.atan2(s.dx, s.dz), 0.25 + 0.2 * (i % 3));
        }
      } else if (m.kind === 'maw' && s.k === 'arc' && !m.struck) {
        for (let i = 0; i < 18; i++) {
          const travel = (i / 18 + t * 0.97) % 1;
          const a = s.dir + Math.sin(i * 2.4 + travel * 2) * s.half * (1 - travel);
          const d = 1.8 + (1 - travel) * 8;
          const size = 0.065 + 0.13 * Math.sin(travel * Math.PI);
          this.place(s.x + Math.sin(a) * d, 0.18 + 1.9 * travel, s.z + Math.cos(a) * d,
            size, size * 0.68, size * 1.65, a, i + t * 4.2);
        }
      } else if (m.kind === 'vent' && s.k === 'line' && m.struck) {
        const travel = (t - m.at) / 0.26;
        if (travel >= 1) continue;
        for (let i = 0; i < 12; i++) {
          const d = Math.min(s.len, 2 + s.len * travel + i * 0.47);
          const shift = Math.sin(i * 2.4) * (0.35 + travel * 0.65);
          this.place(s.x + d * s.dx + shift * s.dz, 0.95 + (i % 3) * 0.25, s.z + d * s.dz - shift * s.dx,
            0.12, 0.14, 0.65, Math.atan2(s.dx, s.dz), 0.1);
        }
      }
    }
    if (this.mesh.count) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
