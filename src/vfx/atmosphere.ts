import * as THREE from 'three';
import { G } from '../render/materials';

/** Пылинок на один луч света и слоёв пепла (план §8.5) — при качестве 1. */
export const DUST_PER_RAY = 36;
export const ASH_LAYERS = [
  // ближний — между камерой и полом: крупный, медленный; средний — над полом; глубокий — в бездне за краями
  { n: 34, y0: 7, y1: 12, size: [0.08, 0.12], fall: [0.22, 0.36], alpha: 0.18, zOff: 7, box: [26, 20] },
  { n: 70, y0: 0.3, y1: 5.5, size: [0.035, 0.06], fall: [0.14, 0.28], alpha: 0.4, zOff: 0, box: [34, 26] },
  { n: 54, y0: -26, y1: -4, size: [0.12, 0.2], fall: [0.3, 0.5], alpha: 0.3, zOff: -14, box: [60, 44] },
] as const;

/** Квад-билборд в пространстве вида (как у частиц). */
function quad(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * Пыль в лучах из окон (план §8.5): видна только внутри конусов света — ярче у оси луча,
 * медленно оседает вдоль него и покачивается. Положения считает шейдер по времени (CPU не трогает).
 */
export class BeamDust {
  readonly mesh: THREE.Mesh;

  constructor(rays: { top: THREE.Vector3; bot: THREE.Vector3; w: number }[], color: string, quality = 1) {
    const per = Math.max(8, Math.round(DUST_PER_RAY * quality));
    const n = rays.length * per;
    const g = quad();
    const top = new Float32Array(n * 4), bot = new Float32Array(n * 4), seed = new Float32Array(n * 4);
    let i = 0;
    for (const r of rays) {
      for (let k = 0; k < per; k++, i++) {
        top.set([r.top.x, r.top.y, r.top.z, r.w], i * 4);
        bot.set([r.bot.x, r.bot.y, r.bot.z, 0], i * 4);
        // доля вдоль луча, поперёк, в глубину, фаза
        seed.set([Math.random(), Math.random() - 0.5, Math.random() - 0.5, Math.random()], i * 4);
      }
    }
    g.setAttribute('aTop', new THREE.InstancedBufferAttribute(top, 4));
    g.setAttribute('aBot', new THREE.InstancedBufferAttribute(bot, 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = n;
    const c = new THREE.Color(color);
    // пылинка ярче самого луча (луч — едва заметная дымка)
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uColor: { value: new THREE.Color(Math.min(1, c.r * 7 + 0.12), Math.min(1, c.g * 7 + 0.1), Math.min(1, c.b * 7 + 0.08)) } },
      vertexShader: /* glsl */ `
        attribute vec4 aTop; attribute vec4 aBot; attribute vec4 aSeed;
        uniform float uTime;
        varying vec2 vC; varying float vK;
        void main() {
          // оседает вдоль луча (медленно, у каждой своя скорость) и покачивается поперёк
          float s = fract(aSeed.x + uTime * (0.006 + 0.01 * aSeed.w));
          float l = aSeed.y + 0.07 * sin(uTime * (0.25 + 0.3 * aSeed.w) + aSeed.w * 40.0);
          float hw = mix(0.35, 0.5, s) * aTop.w;
          vec3 axis = mix(aTop.xyz, aBot.xyz, s);
          vec3 dir = normalize(aBot.xyz - aTop.xyz);
          vec3 side = vec3(1.0, 0.0, 0.0);
          vec3 depth = normalize(cross(dir, side));
          vec3 p = axis + side * l * 2.0 * hw + depth * aSeed.z * hw * 0.8;
          p.y += 0.12 * sin(uTime * 0.4 + aSeed.w * 17.0);
          // свет только в конусе: ярче у оси, гаснет к краям и к концам луча, мерцает
          float across = 1.0 - smoothstep(0.18, 0.5, abs(l));
          float along = smoothstep(0.08, 0.3, s) * (1.0 - smoothstep(0.7, 0.95, s));
          vK = across * along * (0.55 + 0.45 * sin(uTime * (1.2 + aSeed.w) + aSeed.w * 23.0));
          vC = position.xy;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          mv.xy += position.xy * (0.022 + 0.018 * aSeed.w);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec2 vC; varying float vK;
        void main() {
          float d = 1.0 - smoothstep(0.2, 1.0, length(vC));
          if (d * vK < 0.01) discard;
          gl_FragColor = vec4(uColor * d * vK, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/**
 * Медленный пепел на разной глубине (план §8.5): ближний слой между камерой и полом, средний над полом,
 * глубокий — в бездне за краями арены (виден только там, где пола нет). Поле пепла «едет» за камерой:
 * хлопья заворачиваются по модулю вокруг фокуса, поэтому их число постоянно.
 */
export class AshFall {
  readonly mesh: THREE.Mesh;
  private readonly focus: THREE.Vector3;

  constructor(quality = 1) {
    let n = 0;
    const layers = ASH_LAYERS.map((L) => { const c = Math.max(6, Math.round(L.n * quality)); n += c; return { L, c }; });
    const g = quad();
    const a = new Float32Array(n * 4), b = new Float32Array(n * 4), c4 = new Float32Array(n * 4);
    let i = 0;
    for (const { L, c } of layers) {
      for (let k = 0; k < c; k++, i++) {
        // старт (x, y, z) в коробке слоя, слой; размер, скорость падения, фаза, яркость
        a.set([Math.random() * L.box[0], L.y0 + Math.random() * (L.y1 - L.y0), Math.random() * L.box[1], 0], i * 4);
        b.set([L.size[0] + Math.random() * (L.size[1] - L.size[0]), L.fall[0] + Math.random() * (L.fall[1] - L.fall[0]), Math.random(), L.alpha * (0.6 + Math.random() * 0.4)], i * 4);
        c4.set([L.y0, L.y1, L.zOff, 0], i * 4);
        a[i * 4 + 3] = L.box[0]; c4[i * 4 + 3] = L.box[1];
      }
    }
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(b, 4));
    g.setAttribute('aL', new THREE.InstancedBufferAttribute(c4, 4));
    g.instanceCount = n;
    this.focus = new THREE.Vector3();
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uFocus: { value: this.focus }, uColor: { value: new THREE.Color(0.36, 0.34, 0.33) } },
      vertexShader: /* glsl */ `
        attribute vec4 aP; attribute vec4 aS; attribute vec4 aL;
        uniform float uTime; uniform vec3 uFocus;
        varying vec2 vC; varying float vA;
        void main() {
          float t = uTime;
          // ветер сносит вбок, хлопья кружат и падают; y — по кругу внутри слоя
          float y = aL.x + mod(aP.y - aL.x - t * aS.y, aL.y - aL.x);
          vec2 drift = vec2(t * 0.12 + 0.5 * sin(t * 0.3 + aS.z * 30.0), 0.35 * cos(t * 0.23 + aS.z * 19.0));
          vec2 box = vec2(aP.w, aL.w);
          vec2 c = vec2(uFocus.x, uFocus.z + aL.z);
          vec2 xz = c + mod(aP.xz + drift - c + box * 0.5, box) - box * 0.5;
          // у границ коробки и слоя — гаснут (без хлопков при заворачивании)
          vec2 e = abs(xz - c) / (box * 0.5);
          float fy = (y - aL.x) / (aL.y - aL.x);
          vA = aS.w * (1.0 - smoothstep(0.8, 1.0, max(e.x, e.y))) * smoothstep(0.0, 0.12, fy) * (1.0 - smoothstep(0.88, 1.0, fy));
          // хлопья кувыркаются: вращение и сплющивание
          float ang = t * (0.6 + aS.z) + aS.z * 50.0;
          vec2 q = position.xy * vec2(0.45 + 0.55 * abs(sin(t * 1.3 + aS.z * 11.0)), 1.0);
          q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
          vC = position.xy;
          vec4 mv = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
          mv.xy += q * aS.x;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec2 vC; varying float vA;
        void main() {
          float d = 1.0 - smoothstep(0.35, 1.0, length(vC));
          if (d * vA < 0.01) discard;
          gl_FragColor = vec4(uColor * d * vA, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Поле пепла следует за фокусом камеры. */
  follow(x: number, z: number): void { this.focus.set(x, 0, z); }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
