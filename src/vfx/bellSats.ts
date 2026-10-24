import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { GeomBuilder, mat } from '../gen/geom/build';
import { lathe, octa } from '../gen/geom/prims';
import { obsidianMaterial } from '../render/materials';
import type { World } from '../world/world';

const MAX = 4;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Колокола-спутники Иерофанта (план §8.3, фаза III): тёмная бронза с багровым ободом; перед звоном
 * раскачиваются и набухают — метка на полу под ними уже горит.
 */
export class BellSatsView {
  readonly mesh: THREE.InstancedMesh;

  constructor() {
    const b = new GeomBuilder();
    b.color = hexToLinear('#5a4524');
    b.add(lathe([[0.06, 1.0], [0.3, 0.92], [0.4, 0.6], [0.46, 0.22], [0.62, 0.02], [0.58, -0.04]], 12, 0), { matrix: mat(0, -0.5, 0) });
    b.add(new THREE.TorusGeometry(0.6, 0.04, 4, 20), { matrix: mat(0, -0.5, 0, Math.PI / 2, 0, 0), emissive: 1.6 });
    b.add(octa(0.12, 0.2, 0.12), { matrix: mat(0, -0.62, 0), emissive: 1.2 });
    this.mesh = new THREE.InstancedMesh(b.build(), obsidianMaterial({ rim: '#ff3b4a', rimStrength: 0.7, rimPower: 2.2, emissive: '#E11D2E', emissive2: '#FF8A3D', emissiveStrength: 2.2 }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  sync(w: World): void {
    let n = 0;
    for (const s of w.bellSats) {
      if (n >= MAX) break;
      const sw = Math.sin(w.time * 14) * 0.35 * s.glow;
      _e.set(sw, 0, sw * 0.6);
      _m.compose(_p.set(s.x, s.y, s.z), _q.setFromEuler(_e), _s.setScalar(1 + s.glow * 0.25));
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void { this.mesh.count = 0; }
}
