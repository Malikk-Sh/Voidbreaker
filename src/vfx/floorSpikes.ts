import * as THREE from 'three';
import { fxRng } from '../core/rng';
import { GeomBuilder } from '../gen/geom/build';
import { shard } from '../gen/geom/prims';
import { obsidianMaterial } from '../render/materials';

const MAX = 64;
/** Подъём, удержание, уход в пол (с). */
const RISE = 0.06, HOLD = 0.35, SINK = 0.25;

interface Spike { x: number; z: number; h: number; tx: number; tz: number; yaw: number; t: number; delay: number }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Шипы из пола (Погребальный ряд Распинателя, план §7.2): обсидиановые колья с раскалённым острием
 * вырываются полосой поперёк ряда, держатся 0.35 с и уходят обратно. Красный — цвет врага.
 */
export class FloorSpikes {
  readonly mesh: THREE.InstancedMesh;
  private spikes: Spike[] = [];

  constructor() {
    const b = new GeomBuilder();
    b.color = [0.014, 0.012, 0.018];
    b.add(shard(1, 0.13, 4, 0.2, 3), { emissiveFn: (_x, y) => (y > 0.7 ? 1.4 : y > 0.45 ? 0.3 : 0) });
    this.mesh = new THREE.InstancedMesh(b.build(), obsidianMaterial({ rim: '#d02838', rimStrength: 0.6, rimPower: 2.6, emissive: '#E11D2E', emissive2: '#FF8A3D', emissiveStrength: 2.6 }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Полоса кольев поперёк оси ряда (dirX, dirZ) шириной w с центром (x, z). */
  row(x: number, z: number, dirX: number, dirZ: number, w: number, big: boolean): void {
    const n = big ? 9 : 7, px = dirZ, pz = -dirX;
    for (let i = 0; i < n && this.spikes.length < MAX; i++) {
      const u = (i / (n - 1) - 0.5) * w + fxRng.spread(0.12);
      const along = fxRng.spread(0.3);
      // наклон наружу от оси ряда и чуть вперёд — «ёж», а не частокол
      const out = Math.sign(u) * fxRng.range(0.05, 0.3);
      this.spikes.push({
        x: x + px * u + dirX * along, z: z + pz * u + dirZ * along,
        h: (big ? fxRng.range(1.3, 2.0) : fxRng.range(0.9, 1.4)) * (1 - Math.abs(u) / w * 0.5),
        tx: dirX * 0.15 + px * out, tz: dirZ * 0.15 + pz * out, yaw: fxRng.next() * Math.PI * 2,
        t: 0, delay: Math.abs(u) * 0.03,
      });
    }
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.t += dt;
      if (s.t >= RISE + HOLD + SINK) { this.spikes[i] = this.spikes[this.spikes.length - 1]; this.spikes.pop(); }
    }
    for (const s of this.spikes) {
      if (s.delay > 0) continue;
      const k = s.t < RISE ? 1.15 * s.t / RISE : s.t < RISE + 0.05 ? 1.15 - 3 * (s.t - RISE) : s.t < RISE + HOLD ? 1 : 1 - (s.t - RISE - HOLD) / SINK;
      if (k <= 0.01) continue;
      _q.setFromEuler(_e.set(s.tz * 1.2, s.yaw, -s.tx * 1.2, 'YXZ'));
      _m.compose(_p.set(s.x, -0.15, s.z), _q, _s.set(1, s.h * k, 1));
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void { this.spikes.length = 0; this.mesh.count = 0; }
}
