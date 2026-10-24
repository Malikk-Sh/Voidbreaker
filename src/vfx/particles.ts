import * as THREE from 'three';
import { G } from '../render/materials';
import { makeParticleAtlas, ATLAS_COLS, ATLAS_FRAMES, type AtlasFrame } from '../gen/tex/textures';

let atlas: THREE.Texture | null = null;

/**
 * Приглушение вторичных эффектов у Пилота (разбор): дым, пыль, пепел между камерой и героем не закрывают его.
 * Расстояние от точки до отрезка «грудь Пилота → камера»: ближе 0.7 м — ×HERO_DIM.min, дальше 2.4 м — как есть.
 */
export const HERO_DIM = { min: 0.3, near: 0.7, far: 2.4 };
export const HERO_DIM_GLSL = /* glsl */ `
  float heroDim(vec3 p) {
    vec3 h = uHero, c = cameraPosition - uHero;
    float t = clamp(dot(p - h, c) / max(dot(c, c), 1e-4), 0.0, 1.0);
    float d = length(p - (h + c * t));
    return mix(${HERO_DIM.min.toFixed(2)}, 1.0, smoothstep(${HERO_DIM.near.toFixed(2)}, ${HERO_DIM.far.toFixed(2)}, d));
  }
`;
const getAtlas = () => (atlas ??= makeParticleAtlas());

export interface ParticleSpec {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  size: number; size1?: number;
  color: [number, number, number];
  alpha?: number;
  gravity?: number;
  drag?: number;
  frame?: AtlasFrame;
  /** Вытягивание по скорости (искры). */
  stretch?: number;
  rot?: number; spin?: number;
  /** Задержка рождения. */
  delay?: number;
}

/**
 * GPU-частицы (Tech §19.1): один InstancedMesh квадов на тип смешивания; вся симуляция — в вершинном шейдере
 * по формуле от времени (p = p0 + v·t + ½·g·t², затухание, вращение). CPU только пишет новые частицы в кольцевой буфер.
 */
export class Particles {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly a: { p: THREE.InstancedBufferAttribute; v: THREE.InstancedBufferAttribute; s: THREE.InstancedBufferAttribute; c: THREE.InstancedBufferAttribute; m: THREE.InstancedBufferAttribute };
  private head = 0;
  private lo = Infinity; private hi = -1;
  /** Ограничение качества: активная ёмкость (≤ max). */
  cap: number;

  constructor(readonly max: number, additive: boolean) {
    this.cap = max;
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = () => { const b = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); b.setUsage(THREE.DynamicDrawUsage); return b; };
    this.a = { p: mk(), v: mk(), s: mk(), c: mk(), m: mk() };
    // «мертвые» по умолчанию: время рождения далеко в будущем
    for (let i = 0; i < max; i++) (this.a.p.array as Float32Array)[i * 4 + 3] = 1e9;
    this.geo.setAttribute('aP', this.a.p); this.geo.setAttribute('aV', this.a.v); this.geo.setAttribute('aS', this.a.s);
    this.geo.setAttribute('aC', this.a.c); this.geo.setAttribute('aM', this.a.m);
    this.geo.instanceCount = max;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uAtlas: { value: getAtlas() }, uHero: G.uHero },
      defines: additive ? {} : { DIM_NEAR_HERO: '' },
      vertexShader: /* glsl */ `
        attribute vec4 aP; attribute vec4 aV; attribute vec4 aS; attribute vec4 aC; attribute vec4 aM;
        uniform float uTime; uniform vec3 uHero;
        varying vec2 vUv; varying vec4 vCol;
        ${HERO_DIM_GLSL}
        void main() {
          float t = uTime - aP.w;
          float life = aV.w;
          if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float f = t / life;
          float k = aS.w;
          float dk = k > 0.0 ? (1.0 - exp(-k * t)) / k : t;
          vec3 p = aP.xyz + aV.xyz * dk + vec3(0.0, 0.5 * aS.z * t * t, 0.0);
          vec3 vel = aV.xyz * (k > 0.0 ? exp(-k * t) : 1.0) + vec3(0.0, aS.z * t, 0.0);
          float size = mix(aS.x, aS.y, f);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vec2 corner = position.xy;
          float stretch = aM.y;
          if (stretch > 0.0) {
            vec3 vv = mat3(viewMatrix) * vel;
            vec2 d = vv.xy; float l = length(d);
            vec2 dir = l > 1e-4 ? d / l : vec2(1.0, 0.0);
            vec2 nrm = vec2(-dir.y, dir.x);
            float len = size * (1.0 + stretch * l * 0.08);
            corner = dir * corner.x * len + nrm * corner.y * size * 0.35;
          } else {
            float r = aM.z + aM.w * t;
            float c = cos(r), s = sin(r);
            // Бумага медленно переворачивается и парит; каменные осколки сохраняют прежнюю форму.
            if (aM.x == ${ATLAS_FRAMES.page.toFixed(1)}) {
              corner.x *= 0.2 + 0.8 * abs(cos(t * 5.0 + aM.z));
              corner.y *= 1.35;
              mv.xy += vec2(sin(t * 3.2 + aM.z) * 0.15, sin(t * 4.5 + aM.z) * 0.07);
            }
            corner = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
          }
          mv.xy += corner;
          gl_Position = projectionMatrix * mv;
          float frame = aM.x;
          vUv = vec2((uv.x + frame) / ${ATLAS_COLS.toFixed(1)}, uv.y);
          float fadeIn = smoothstep(0.0, 0.06, f);
          vCol = vec4(aC.rgb, aC.a * fadeIn * pow(1.0 - f, 1.4));
        #ifdef DIM_NEAR_HERO
          vCol.a *= heroDim(p);
        #endif
        }
      `,
      fragmentShader: additive ? /* glsl */ `
        uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol;
        void main() { float a = texture2D(uAtlas, vUv).a * vCol.a; gl_FragColor = vec4(vCol.rgb * a, 1.0); }
      ` : /* glsl */ `
        uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol;
        void main() { float a = texture2D(uAtlas, vUv).a * vCol.a; if (a < 0.01) discard; gl_FragColor = vec4(vCol.rgb, a); }
      `,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
  }

  emit(s: ParticleSpec): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const o = i * 4;
    const P = this.a.p.array as Float32Array, V = this.a.v.array as Float32Array, S = this.a.s.array as Float32Array;
    const C = this.a.c.array as Float32Array, M = this.a.m.array as Float32Array;
    P[o] = s.x; P[o + 1] = s.y; P[o + 2] = s.z; P[o + 3] = (G.uTime.value as number) + (s.delay ?? 0);
    V[o] = s.vx ?? 0; V[o + 1] = s.vy ?? 0; V[o + 2] = s.vz ?? 0; V[o + 3] = s.life;
    S[o] = s.size; S[o + 1] = s.size1 ?? s.size; S[o + 2] = s.gravity ?? 0; S[o + 3] = s.drag ?? 0;
    C[o] = s.color[0]; C[o + 1] = s.color[1]; C[o + 2] = s.color[2]; C[o + 3] = s.alpha ?? 1;
    M[o] = ATLAS_FRAMES[s.frame ?? 'dot']; M[o + 1] = s.stretch ?? 0; M[o + 2] = s.rot ?? Math.random() * 6.28; M[o + 3] = s.spin ?? 0;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
  }

  /** Загрузить изменённые срезы буферов (частичная загрузка). */
  flush(): void {
    if (this.hi < 0) return;
    const start = this.lo * 4, count = (this.hi - this.lo + 1) * 4;
    for (const b of Object.values(this.a)) {
      b.clearUpdateRanges();
      b.addUpdateRange(start, count);
      b.needsUpdate = true;
    }
    this.lo = Infinity; this.hi = -1;
  }

  clear(): void {
    const P = this.a.p.array as Float32Array;
    for (let i = 0; i < this.max; i++) P[i * 4 + 3] = 1e9;
    this.a.p.clearUpdateRanges();
    this.a.p.needsUpdate = true;
    this.head = 0;
  }
}
