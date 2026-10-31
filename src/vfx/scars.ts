import * as THREE from 'three';
import { fxRng } from '../core/rng';
import { G } from '../render/materials';

/** Следов боя на полу одновременно (план §8.5) и сколько живёт один (с). */
export const SCARS_MAX = 24;
export const SCAR_LIFE = 60;
/** У босса арена помнит бой дольше — следы фазы I видны в фазе III (план §8.5). */
export const BOSS_SCAR_LIFE = 150;

/**
 * Следы боя (план §8.5): трещины и сколы в местах тяжёлых ударов — к концу боя арена выглядит иначе.
 * Низкоконтрастные, не красные (бледные лучи трещин и тёмная выбоина), не больше 24, гаснут за 60 с.
 * Кольцевой буфер квадов на полу; узор трещин — в шейдере по сиду.
 */
export class FloorScars {
  readonly mesh: THREE.Mesh;
  private readonly a: THREE.InstancedBufferAttribute; // x, z, size, rot
  private readonly b: THREE.InstancedBufferAttribute; // birth, seed, strength, —
  private head = 0;
  private n = 0;
  /** Где лежат следы (для снятия над провалом). */
  readonly spots: { x: number; z: number; alive: boolean }[] = [];

  constructor(readonly life = SCAR_LIFE) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(SCARS_MAX * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(SCARS_MAX * 4).fill(-1e9), 4);
    this.a.setUsage(THREE.DynamicDrawUsage); this.b.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.a); g.setAttribute('iB', this.b);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uNoise: G.uNoise, uLife: { value: life } },
      vertexShader: /* glsl */ `
        attribute vec4 iA; attribute vec4 iB; uniform float uTime, uLife;
        varying vec2 vP; varying float vSeed, vK;
        void main() {
          float c = cos(iA.w), s = sin(iA.w);
          vec2 p = vec2(c * position.x - s * position.z, s * position.x + c * position.z) * iA.z;
          vP = position.xz; vSeed = iB.y;
          float age = uTime - iB.x;
          // появляется сразу, держится, гаснет к концу жизни
          vK = iB.z * (1.0 - smoothstep(uLife * 0.6, uLife, age)) * step(0.0, age);
          gl_Position = projectionMatrix * viewMatrix * vec4(iA.x + p.x, 0.014, iA.y + p.y, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoise; varying vec2 vP; varying float vSeed, vK;
        float n2(vec2 p) { return texture2D(uNoise, p).r; }
        void main() {
          float r = length(vP);
          if (r > 1.0 || vK < 0.01) discard;
          float a = atan(vP.y, vP.x);
          // лучи трещин от центра удара: ломаные, сужаются к краю
          float crack = 0.0;
          for (int k = 0; k < 7; k++) {
            float fk = float(k);
            float ang = fk * 0.8976 + (n2(vec2(vSeed, fk * 0.13)) - 0.5) * 1.5;
            float wob = (n2(vec2(r * 1.6 + vSeed, fk * 0.27)) - 0.5) * 0.8 * r;
            float d = abs(sin(a - ang - wob)) * r;
            float len = 0.25 + 0.75 * n2(vec2(fk * 0.31, vSeed * 1.7));
            float side = step(0.0, cos(a - ang - wob));
            crack = max(crack, smoothstep(0.04 * (1.0 - r) + 0.008, 0.0, d) * smoothstep(len, len * 0.7, r) * side);
          }
          // выбоина в центре (тёмная) и бледная каменная пыль по трещинам и сколам
          float pit = smoothstep(0.2, 0.04, r);
          float chips = step(0.9, n2(vP * 1.9 + vSeed)) * smoothstep(0.85, 0.25, r);
          float dust = max(crack, chips * 0.7);
          float alpha = max(dust * 0.24 * (1.0 - pit), pit * 0.6) * vK;
          vec3 col = mix(vec3(0.2, 0.22, 0.26), vec3(0.01, 0.012, 0.016), pit);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < SCARS_MAX; i++) this.spots.push({ x: 0, z: 0, alive: false });
  }

  /** Новый след: size — радиус (м), strength 0..1 — насыщенность. Старейший вытесняется. */
  add(x: number, z: number, size: number, strength = 1): void {
    const i = this.head;
    this.head = (this.head + 1) % SCARS_MAX;
    this.n = Math.min(SCARS_MAX, this.n + 1);
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array;
    A[i * 4] = x; A[i * 4 + 1] = z; A[i * 4 + 2] = size; A[i * 4 + 3] = fxRng.next() * 6.28;
    B[i * 4] = G.uTime.value as number; B[i * 4 + 1] = fxRng.next() * 7; B[i * 4 + 2] = Math.min(1, strength);
    this.spots[i].x = x; this.spots[i].z = z; this.spots[i].alive = true;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.n;
    this.a.needsUpdate = true; this.b.needsUpdate = true;
  }

  /** Снять след (пол под ним обрушился). */
  remove(i: number): void {
    const B = this.b.array as Float32Array;
    B[i * 4 + 2] = 0;
    this.spots[i].alive = false;
    this.b.needsUpdate = true;
  }

  get count(): number { return this.n; }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
