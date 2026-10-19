import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { G } from './materials';

const v3 = (hex: string) => new THREE.Vector3(...hexToLinear(hex));

export interface SkyPreset {
  deep: string; nebula: string; nebula2: string; nebula3: string; corona: string; moonCore: string;
  moonDir: [number, number, number]; moonSize: number; starDensity: number;
}

export const SKY_NEBULA_MOON: SkyPreset = {
  deep: '#03060a', nebula: '#10293b', nebula2: '#4aa3c8', nebula3: '#3d2238', corona: '#ffd29a', moonCore: '#020305',
  moonDir: [0.42, -0.5, -0.76], moonSize: 0.075, starDensity: 1,
};

/**
 * Небо (Tech §20.1): полноэкранный треугольник на дальней плоскости. Туманность — fbm с домен-варпингом
 * (шум берётся из процедурной текстуры), звёзды — хэш по ячейкам, чёрная луна с короной, молнии.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly u = {
    uInvVP: { value: new THREE.Matrix4() },
    uCam: { value: new THREE.Vector3() },
    uDeep: { value: v3(SKY_NEBULA_MOON.deep) },
    uNebula: { value: v3(SKY_NEBULA_MOON.nebula) },
    uNebula2: { value: v3(SKY_NEBULA_MOON.nebula2) },
    uNebula3: { value: v3(SKY_NEBULA_MOON.nebula3) },
    uCorona: { value: v3(SKY_NEBULA_MOON.corona) },
    uMoonCore: { value: v3(SKY_NEBULA_MOON.moonCore) },
    uMoonDir: { value: new THREE.Vector3(...SKY_NEBULA_MOON.moonDir).normalize() },
    uMoonSize: { value: SKY_NEBULA_MOON.moonSize },
    uStars: { value: 1 },
    uPulse: { value: 0 },
    uBolt: { value: 0 },
    uBoltDir: { value: new THREE.Vector3(0, -1, -1).normalize() },
    uStarFlare: { value: 0 },
    /** Затмение ульты (план §6.9): 0 — обычное небо, 1 — луна закрыла солнце, корона фиолетовая. */
    uEclipse: { value: 0 },
    /** Погасшая звезда зоны загорелась (план §8.3.2); трещина в небе (фаза III). */
    uStarLit: { value: 0 },
    uSkyCrack: { value: 0 },
  };

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.u, uTime: G.uTime, uNoise: G.uNoise },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vNdc;
        void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform mat4 uInvVP; uniform vec3 uCam; uniform float uTime;
        uniform sampler2D uNoise;
        uniform vec3 uDeep, uNebula, uNebula2, uNebula3, uCorona, uMoonCore, uMoonDir, uBoltDir;
        uniform float uMoonSize, uStars, uPulse, uBolt, uStarFlare, uEclipse, uStarLit, uSkyCrack;
        varying vec2 vNdc;

        float n2(vec2 p) { return texture2D(uNoise, p).r; }
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

        vec3 stars(vec2 uv) {
          vec2 id = floor(uv), f = fract(uv) - 0.5;
          float r = h21(id);
          if (r < 0.92) return vec3(0.0);
          vec2 o = vec2(h21(id + 7.1), h21(id + 3.7)) - 0.5;
          float d = length(f - o * 0.7);
          float tw = 0.55 + 0.45 * sin(uTime * (1.0 + r * 4.0) + r * 40.0);
          float b = smoothstep(0.08, 0.0, d) * tw * (r - 0.92) * 14.0;
          vec3 tint = mix(vec3(0.78, 0.88, 1.0), vec3(1.0, 0.9, 0.78), h21(id + 1.3));
          return tint * b;
        }

        void main() {
          vec4 wp = uInvVP * vec4(vNdc, 1.0, 1.0);
          vec3 dir = normalize(wp.xyz / wp.w - uCam);
          vec2 uv = dir.xz / (0.55 + abs(dir.y)) ;
          vec2 q = uv * 0.22 + vec2(uTime * 0.0015, 0.0);
          vec2 w = q + 0.35 * vec2(n2(q * 1.3 + 0.17), n2(q * 1.3 + vec2(0.53, 0.31))) ;
          float n = n2(w * 0.9);
          float n2v = n2(w * 2.1 + 0.4);
          float neb = smoothstep(0.38, 0.78, n);
          vec3 col = uDeep;
          col = mix(col, uNebula, neb * 0.9);
          col += uNebula2 * pow(max(n * n2v, 0.0), 3.0) * 1.6;
          // тёплые розово-винные облака — контрапункт холодной бирюзе
          float rose = smoothstep(0.6, 0.9, n2(w * 0.6 + vec2(0.71, 0.13)));
          col += uNebula3 * rose * (0.3 + 0.7 * n2v) * 0.55;
          // тёмные пылевые прожилки
          col *= 0.65 + 0.35 * smoothstep(0.2, 0.6, n2(w * 3.3 + 1.7));
          col += stars(uv * 60.0) * uStars + stars(uv * 130.0 + 3.0) * 0.6 * uStars;

          // молния в туманности: вспышка + ветвистая маска
          if (uBolt > 0.001) {
            float bd = 1.0 - dot(dir, uBoltDir);
            float glow = exp(-bd * 60.0);
            float branch = smoothstep(0.03, 0.0, abs(n2(uv * 3.0 + uTime * 0.5) - 0.5)) * exp(-bd * 25.0);
            col += (uNebula2 * glow * 2.0 + vec3(0.85, 0.92, 1.0) * branch * 3.0) * uBolt;
          }

          // чёрная луна с золотой короной (затмение)
          float md = acos(clamp(dot(dir, uMoonDir), -1.0, 1.0));
          float rr = md / uMoonSize;
          vec3 side = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
          vec3 up = cross(side, uMoonDir);
          float ang = atan(dot(dir, up), dot(dir, side));
          float rays = n2(vec2(ang * 0.6, uTime * 0.02)) * 0.6 + n2(vec2(ang * 2.3, uTime * 0.035)) * 0.4;
          float corona = exp(-(rr - 1.0) * (3.2 - rays * 1.6)) * step(1.0, rr);
          float ring = smoothstep(0.06, 0.0, abs(rr - 1.0));
          float pulse = 1.0 + uPulse * 0.6;
          // ульта: небо темнеет, корона становится фиолетово-белой и шире
          float ek = uEclipse;
          col *= 1.0 - ek * 0.55;
          vec3 corC = mix(uCorona, vec3(0.75, 0.55, 1.6), ek);
          float corW = mix(1.0, 0.55, ek);
          float coronaE = exp(-(rr - 1.0) * (3.2 - rays * 1.6) * corW) * step(1.0, rr);
          col += corC * (coronaE * (1.4 + ek * 1.8) + ring * (3.5 + ek * 3.0)) * pulse;
          col += corC * exp(-max(rr - 1.0, 0.0) * 0.6) * (0.12 + ek * 0.25) * pulse;
          // солнце заходит за луну: яркий диск съезжает за чёрный круг, пока затмение не полное
          vec3 sunDir = normalize(uMoonDir + side * (1.0 - ek) * uMoonSize * 2.2);
          float sd = acos(clamp(dot(dir, sunDir), -1.0, 1.0)) / uMoonSize;
          float sunVis = (1.0 - smoothstep(0.92, 1.0, sd)) * step(0.001, ek) * step(ek, 0.999);
          col += vec3(1.6, 1.45, 1.9) * sunVis * step(1.0, rr);
          col = mix(col, uMoonCore + corC * 0.03 * (1.0 - rr), smoothstep(1.0, 0.97, rr));
          // погасшая звезда загорелась (план §8.3.2): чёрный диск — живое золотое светило с лучами
          if (uStarLit > 0.001) {
            vec3 starC = vec3(1.7, 1.4, 0.95);
            col = mix(col, starC * (1.3 + 0.8 * (1.0 - rr)), smoothstep(1.0, 0.9, rr) * uStarLit);
            col += starC * exp(-max(rr - 1.0, 0.0) * 1.5) * 0.9 * uStarLit;
            float spikes = pow(abs(cos(ang * 3.5)), 24.0) * exp(-max(rr - 1.0, 0.0) * 0.45);
            col += starC * spikes * 0.6 * uStarLit;
          }
          // трещина в небе (фаза III Иерофанта): багровая ломаная через диск, растёт от центра
          if (uSkyCrack > 0.001) {
            vec2 mp = vec2(dot(dir, side), dot(dir, up)) / uMoonSize;
            float yl = (n2(vec2(mp.x * 0.05, 0.37)) - 0.5) * 4.0 + (n2(vec2(mp.x * 0.23, 0.71)) - 0.5) * 1.4;
            float dl = abs(mp.y - yl);
            float reach = 10.0 * uSkyCrack;
            float len = smoothstep(reach + 0.5, reach - 1.5, abs(mp.x));
            float wdt = 0.05 + 0.05 * n2(vec2(mp.x * 0.7, 1.3));
            float core = smoothstep(wdt, 0.0, dl) * len;
            float glow = exp(-dl * 1.6) * len;
            col += vec3(2.4, 0.22, 0.3) * core + vec3(0.45, 0.04, 0.07) * glow * (0.8 + 0.2 * sin(uTime * 3.0));
          }
          // вспышка «звезды» после победы над боссом
          col += vec3(1.0, 0.95, 1.0) * uStarFlare * (exp(-max(rr - 1.0, 0.0) * 1.2) * 3.0 + smoothstep(1.0, 0.0, rr) * 6.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  apply(p: SkyPreset): void {
    this.u.uDeep.value.copy(v3(p.deep));
    this.u.uNebula.value.copy(v3(p.nebula));
    this.u.uNebula2.value.copy(v3(p.nebula2));
    this.u.uNebula3.value.copy(v3(p.nebula3));
    this.u.uCorona.value.copy(v3(p.corona));
    this.u.uMoonCore.value.copy(v3(p.moonCore));
    this.u.uMoonDir.value.set(...p.moonDir).normalize();
    this.u.uMoonSize.value = p.moonSize;
    this.u.uStars.value = p.starDensity;
  }

  update(cam: THREE.PerspectiveCamera): void {
    this.u.uInvVP.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    this.u.uCam.value.copy(cam.position);
  }
}
