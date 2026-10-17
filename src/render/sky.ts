import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { G } from './materials';

const v3 = (hex: string) => new THREE.Vector3(...hexToLinear(hex));

export interface SkyPreset {
  deep: string; nebula: string; nebula2: string; corona: string; moonCore: string;
  moonDir: [number, number, number]; moonSize: number; starDensity: number;
}

export const SKY_NEBULA_MOON: SkyPreset = {
  deep: '#06040c', nebula: '#2b1659', nebula2: '#a04ae0', corona: '#b794ff', moonCore: '#050309',
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
    uCorona: { value: v3(SKY_NEBULA_MOON.corona) },
    uMoonCore: { value: v3(SKY_NEBULA_MOON.moonCore) },
    uMoonDir: { value: new THREE.Vector3(...SKY_NEBULA_MOON.moonDir).normalize() },
    uMoonSize: { value: SKY_NEBULA_MOON.moonSize },
    uStars: { value: 1 },
    uPulse: { value: 0 },
    uBolt: { value: 0 },
    uBoltDir: { value: new THREE.Vector3(0, -1, -1).normalize() },
    uStarFlare: { value: 0 },
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
        uniform vec3 uDeep, uNebula, uNebula2, uCorona, uMoonCore, uMoonDir, uBoltDir;
        uniform float uMoonSize, uStars, uPulse, uBolt, uStarFlare;
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
          vec3 tint = mix(vec3(0.8, 0.75, 1.0), vec3(1.0, 0.85, 0.9), h21(id + 1.3));
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
          // тёмные пылевые прожилки
          col *= 0.65 + 0.35 * smoothstep(0.2, 0.6, n2(w * 3.3 + 1.7));
          col += stars(uv * 60.0) * uStars + stars(uv * 130.0 + 3.0) * 0.6 * uStars;

          // молния в туманности: вспышка + ветвистая маска
          if (uBolt > 0.001) {
            float bd = 1.0 - dot(dir, uBoltDir);
            float glow = exp(-bd * 60.0);
            float branch = smoothstep(0.03, 0.0, abs(n2(uv * 3.0 + uTime * 0.5) - 0.5)) * exp(-bd * 25.0);
            col += (uNebula2 * glow * 2.0 + vec3(0.9, 0.8, 1.0) * branch * 3.0) * uBolt;
          }

          // чёрная луна с фиолетовой короной
          float md = acos(clamp(dot(dir, uMoonDir), -1.0, 1.0));
          float rr = md / uMoonSize;
          vec3 side = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
          vec3 up = cross(side, uMoonDir);
          float ang = atan(dot(dir, up), dot(dir, side));
          float rays = n2(vec2(ang * 0.6, uTime * 0.02)) * 0.6 + n2(vec2(ang * 2.3, uTime * 0.035)) * 0.4;
          float corona = exp(-(rr - 1.0) * (3.2 - rays * 1.6)) * step(1.0, rr);
          float ring = smoothstep(0.06, 0.0, abs(rr - 1.0));
          float pulse = 1.0 + uPulse * 0.6;
          col += uCorona * (corona * 1.4 + ring * 3.5) * pulse;
          col += uCorona * exp(-max(rr - 1.0, 0.0) * 0.6) * 0.12 * pulse;
          col = mix(col, uMoonCore + uCorona * 0.03 * (1.0 - rr), smoothstep(1.0, 0.97, rr));
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
