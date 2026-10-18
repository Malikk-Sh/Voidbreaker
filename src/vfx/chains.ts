import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { GeomBuilder, mat } from '../gen/geom/build';
import { obsidianMaterial } from '../render/materials';
import type { World } from '../world/world';

const MAX = 320;
/** Шаг звеньев и высота цепи (уходит за верх кадра). */
const STEP = 0.26, TOP = 9;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

/**
 * Цепи «Колокольного плена» (план §7.4): падают с потолка за 0.12 с, качаются, пока стоят стеной,
 * и уходят вверх за 0.35 с до конца. Тёмная бронза — это стена арены, а не удар.
 */
export class ChainsView {
  readonly mesh: THREE.InstancedMesh;

  constructor() {
    const b = new GeomBuilder();
    b.color = hexToLinear('#5a4524');
    b.add(new THREE.TorusGeometry(0.12, 0.035, 4, 8), { matrix: mat(0, 0, 0, 0, 0, 0, 1, 1.6, 1) });
    this.mesh = new THREE.InstancedMesh(b.build(), obsidianMaterial({ rim: '#c9a253', rimStrength: 0.5, rimPower: 2.4, emissive: '#FF8A3D', emissiveStrength: 1 }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  sync(w: World): void {
    let n = 0;
    for (const c of w.tempWalls) {
      const drop = Math.max(0, 1 - c.t / 0.12), lift = Math.max(0, (c.t - (c.dur - 0.35)) / 0.35);
      const y0 = drop * drop * 10 + lift * lift * 12;
      const sway = Math.sin(w.time * 2.3 + c.x) * 0.04 * (1 - drop);
      for (let k = 0; k * STEP < TOP && n < MAX; k++) {
        const y = y0 + k * STEP + 0.1, u = k * STEP / TOP;
        _e.set(sway * u * 3, (k % 2) * Math.PI / 2, sway * u * 2);
        _m.compose(_p.set(c.x + Math.sin(w.time + k * 0.3) * 0.02 * u, y, c.z), _q.setFromEuler(_e), _s);
        this.mesh.setMatrixAt(n++, _m);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void { this.mesh.count = 0; }
}
