import * as THREE from 'three';
import { hexToLinear } from '../core/math';

const MAX_SAMPLES = 24;
const SUB = 3;

/**
 * Шлейф клинка (Tech §19.2): кольцевой буфер сэмплов пары точек (рукоять, кончик) →
 * сглаживание Катмулла–Рома → лента-меш с UV по длине; белая кромка → фиолетовый → прозрачный, аддитивно.
 */
export class RibbonTrail {
  readonly mesh: THREE.Mesh;
  private readonly base: THREE.Vector3[] = [];
  private readonly tip: THREE.Vector3[] = [];
  private readonly age: number[] = [];
  private count = 0;
  private readonly pos: Float32Array;
  private readonly uv: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  readonly color: THREE.Vector3;
  readonly core: THREE.Vector3;
  /** Время жизни сэмпла (с). */
  life = 0.14;
  intensity = 1;
  width = 1;

  constructor(color = '#8B5CF6', core = '#F1E8FF') {
    for (let i = 0; i < MAX_SAMPLES; i++) { this.base.push(new THREE.Vector3()); this.tip.push(new THREE.Vector3()); this.age.push(0); }
    const maxV = (MAX_SAMPLES - 1) * SUB * 6;
    this.pos = new Float32Array(maxV * 3);
    this.uv = new Float32Array(maxV * 2);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.color = new THREE.Vector3(...hexToLinear(color));
    this.core = new THREE.Vector3(...hexToLinear(core));
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.color }, uCore: { value: this.core }, uI: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor, uCore; uniform float uI; varying vec2 vUv;
        void main() {
          float age = vUv.x;          // 0 — свежий, 1 — старый
          float across = vUv.y;       // 0 — рукоять, 1 — кончик
          float a = pow(1.0 - age, 1.6) * smoothstep(0.0, 0.35, across);
          float edge = smoothstep(0.72, 1.0, across);
          vec3 col = mix(uColor * 1.8, uCore * 3.2, edge * (1.0 - age * 0.7));
          gl_FragColor = vec4(col * a * uI, 1.0);
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
  }

  /** Добавить сэмпл (вызывать каждый кадр, пока шлейф включён). */
  push(b: THREE.Vector3, t: THREE.Vector3): void {
    for (let i = Math.min(this.count, MAX_SAMPLES - 1); i > 0; i--) {
      this.base[i].copy(this.base[i - 1]); this.tip[i].copy(this.tip[i - 1]); this.age[i] = this.age[i - 1];
    }
    this.base[0].copy(b);
    // ширина ленты (ульта, заряд) — тянем кончик от рукояти
    this.tip[0].copy(t).sub(b).multiplyScalar(this.width).add(b);
    this.age[0] = 0;
    this.count = Math.min(MAX_SAMPLES, this.count + 1);
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) this.age[i] += dt;
    while (this.count > 0 && this.age[this.count - 1] > this.life) this.count--;
    this.rebuild();
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uI.value = this.intensity;
  }

  clear(): void { this.count = 0; this.geo.setDrawRange(0, 0); }

  private rebuild(): void {
    const n = this.count;
    if (n < 2) { this.geo.setDrawRange(0, 0); return; }
    let v = 0;
    const cr = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3) => {
      const t2 = t * t, t3 = t2 * t;
      out.set(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      );
      return out;
    };
    const B = this.base, T = this.tip, A = this.age;
    let pb = _a.copy(B[0]), pt = _b.copy(T[0]), pa = A[0] / this.life;
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1), i3 = Math.min(n - 1, i + 2);
      for (let s = 1; s <= SUB; s++) {
        const t = s / SUB;
        const nb = cr(B[i0], B[i], B[i + 1], B[i3], t, _c);
        const nt = cr(T[i0], T[i], T[i + 1], T[i3], t, _d);
        const na = (A[i] + (A[i + 1] - A[i]) * t) / this.life;
        // два треугольника: (pb, pt, nt), (pb, nt, nb)
        const quad = [[pb, pa, 0], [pt, pa, 1], [nt, na, 1], [pb, pa, 0], [nt, na, 1], [nb, na, 0]] as const;
        for (const [p, a, across] of quad) {
          this.pos[v * 3] = p.x; this.pos[v * 3 + 1] = p.y; this.pos[v * 3 + 2] = p.z;
          this.uv[v * 2] = Math.min(1, a); this.uv[v * 2 + 1] = across;
          v++;
        }
        pb = _e.copy(nb); pt = _f.copy(nt); pa = na;
        _a.copy(_e); _b.copy(_f); pb = _a; pt = _b;
      }
    }
    this.geo.setDrawRange(0, v);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
