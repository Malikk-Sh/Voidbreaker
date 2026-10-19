import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { G } from '../render/materials';

const QUAD = (): [THREE.Float32BufferAttribute, THREE.Float32BufferAttribute] => [
  new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
];
const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

/** Пламя свечей: billboard, вытянутый шум вверх, градиент белый → оранжевый → прозрачный (Tech §6.3). */
export class Flames {
  readonly mesh: THREE.Mesh;
  /** Горит ли свеча 0..1 (гаснут по кругу при заряде удара Звонаря, план §7.4). */
  private readonly lit: Float32Array;
  private readonly litAttr: THREE.InstancedBufferAttribute;
  private doused = false;
  constructor(private readonly points: [number, number, number][], scale = 1) {
    const g = new THREE.InstancedBufferGeometry();
    const [pos, uv] = QUAD();
    g.setAttribute('position', pos); g.setAttribute('uv', uv); g.setIndex(QUAD_INDEX);
    const ip = new Float32Array(Math.max(1, points.length) * 4);
    points.forEach((p, i) => { ip[i * 4] = p[0]; ip[i * 4 + 1] = p[1]; ip[i * 4 + 2] = p[2]; ip[i * 4 + 3] = Math.random() * 100; });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4));
    this.lit = new Float32Array(Math.max(1, points.length)).fill(1);
    this.litAttr = new THREE.InstancedBufferAttribute(this.lit, 1);
    this.litAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iLit', this.litAttr);
    g.instanceCount = points.length;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uScale: { value: scale }, uColor: { value: new THREE.Vector3(...hexToLinear('#FFB866')) } },
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute float iLit; uniform float uTime, uScale; varying vec2 vUv; varying float vSeed;
        void main() {
          vUv = uv; vSeed = iPos.w;
          float fl = 1.0 + 0.12 * sin(uTime * 13.0 + iPos.w) + 0.08 * sin(uTime * 23.0 + iPos.w * 2.0);
          vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
          mv.xy += vec2(position.x * 0.07, (position.y * 0.5 + 0.35) * 0.2 * fl) * uScale * iLit;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying float vSeed;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float sway = sin(uTime * 7.0 + vSeed + p.y * 3.0) * 0.12 * (p.y + 1.0) * 0.5;
          p.x -= sway;
          float w = mix(0.95, 0.15, (p.y + 1.0) * 0.5);
          float d = abs(p.x) / max(w, 0.05);
          float body = smoothstep(1.0, 0.2, d) * smoothstep(1.0, 0.3, p.y) * smoothstep(-1.0, -0.7, p.y);
          float core = smoothstep(0.55, 0.0, d) * smoothstep(0.4, -0.6, p.y);
          vec3 col = uColor * body * 3.0 + vec3(1.0, 0.95, 0.85) * core * 4.0;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /**
   * Гасить по кругу вокруг (cx, cz) от угла from: погашена доля frac. Гаснут быстро (0.1 с), загораются медленнее.
   * В out — точки, которые только что погасли (дымок).
   */
  douse(cx: number, cz: number, from: number, frac: number, dt: number, out: [number, number, number][]): void {
    if (frac <= 0 && !this.doused) return;
    let any = false;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const a = (((Math.atan2(p[0] - cx, p[2] - cz) - from) % TAU) + TAU) % TAU / TAU;
      const target = a < frac ? 0 : 1;
      const was = this.lit[i];
      this.lit[i] = target < was ? Math.max(target, was - dt * 10) : Math.min(target, was + dt * 2.5);
      if (was > 0.5 && this.lit[i] <= 0.5) out.push(p);
      if (this.lit[i] < 1) any = true;
    }
    this.doused = any;
    this.litAttr.needsUpdate = true;
  }

  /**
   * Ударная волна гасит свечи в круге r (приземление в прологе, план §8.2): пламя срывается за доли секунды.
   * Зажигаются обратно тем же douse(…, 0), когда круг снят.
   */
  quench(cx: number, cz: number, r: number, dt: number, out: [number, number, number][]): void {
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (Math.hypot(p[0] - cx, p[2] - cz) > r) continue;
      const was = this.lit[i];
      this.lit[i] = Math.max(0, was - dt * 14);
      if (was > 0.5 && this.lit[i] <= 0.5) out.push(p);
      this.doused = true;
    }
    this.litAttr.needsUpdate = true;
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

const TAU = Math.PI * 2;

/**
 * Световые пятна на полу (Tech §4.2): аддитивные квады с радиальным градиентом — «свет» без источников.
 * Статические (свечи) + динамические (клинок, ядра врагов, снаряды), переписываемые каждый кадр.
 */
export class LightPools {
  readonly mesh: THREE.Mesh;
  private readonly data: Float32Array; // x, z, r, flicker
  private readonly col: Float32Array;  // rgb * intensity, seed
  private readonly a1: THREE.InstancedBufferAttribute;
  private readonly a2: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;
  private staticCount = 0;
  private dyn = 0;
  /** Исходные цвета статичных пятен (для багрового оттенка при замахе босса). */
  private orig: Float32Array | null = null;
  private tinted = false;
  constructor(readonly max = 256) {
    this.geo = new THREE.InstancedBufferGeometry();
    const [pos, uv] = QUAD();
    this.geo.setAttribute('position', pos); this.geo.setAttribute('uv', uv); this.geo.setIndex(QUAD_INDEX);
    this.data = new Float32Array(max * 4); this.col = new Float32Array(max * 4);
    this.a1 = new THREE.InstancedBufferAttribute(this.data, 4); this.a1.setUsage(THREE.DynamicDrawUsage);
    this.a2 = new THREE.InstancedBufferAttribute(this.col, 4); this.a2.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iA', this.a1); this.geo.setAttribute('iB', this.a2);
    this.geo.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime },
      vertexShader: /* glsl */ `
        attribute vec4 iA; attribute vec4 iB; uniform float uTime; varying vec2 vUv; varying vec3 vCol;
        void main() {
          vUv = uv * 2.0 - 1.0;
          float f = 1.0 - iA.w * (0.12 + 0.1 * sin(uTime * 9.0 + iB.w * 7.0) + 0.06 * sin(uTime * 17.0 + iB.w));
          vCol = iB.rgb * f;
          vec3 p = vec3(iA.x + position.x * iA.z, 0.03, iA.y + position.y * iA.z);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vCol;
        void main() {
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;
          float a = (1.0 - r2); a *= a;
          gl_FragColor = vec4(vCol * a, 1.0);
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  setStatic(list: { x: number; z: number; r: number; color: string; intensity: number; flicker: number }[]): void {
    this.staticCount = Math.min(list.length, this.max - 64);
    for (let i = 0; i < this.staticCount; i++) this.write(i, list[i].x, list[i].z, list[i].r, list[i].color, list[i].intensity, list[i].flicker);
    this.orig = this.col.slice(0, this.staticCount * 4);
    this.tinted = false;
    this.dyn = 0;
    this.commit();
  }

  /**
   * Ближние к точке источники слегка багровеют (план §5.8, п. 7): босс готовит красную атаку.
   * k — сила 0..1; 0 возвращает исходные цвета.
   */
  tintNear(x: number, z: number, radius: number, rgb: [number, number, number], k: number): void {
    const o = this.orig;
    const dark = this.dFrac > 0 || this.qR > 0;
    if (!o || (k <= 0.001 && !this.tinted && !dark)) return;
    for (let i = 0; i < this.staticCount; i++) {
      const j = i * 4, d = Math.hypot(this.data[j] - x, this.data[j + 1] - z);
      const w = k * Math.max(0, 1 - d / radius);
      const lum = (o[j] + o[j + 1] + o[j + 2]) / 3;
      // свечи гаснут по кругу — их пятна света тоже (мягкий край)
      let lit = 1;
      if (dark) {
        const a = (((Math.atan2(this.data[j] - this.dX, this.data[j + 1] - this.dZ) - this.dFrom) % TAU) + TAU) % TAU / TAU;
        lit = this.dFrac > 0 ? Math.min(1, Math.max(0.12, (a - this.dFrac) / 0.05 + 0.5)) : 1;
        if (this.qR > 0) lit = Math.min(lit, Math.max(0.12, (Math.hypot(this.data[j] - this.qX, this.data[j + 1] - this.qZ) - this.qR) / 1.5 + 0.5));
      }
      this.col[j] = (o[j] + (rgb[0] * lum * 1.6 - o[j]) * w) * lit;
      this.col[j + 1] = (o[j + 1] + (rgb[1] * lum * 1.6 - o[j + 1]) * w) * lit;
      this.col[j + 2] = (o[j + 2] + (rgb[2] * lum * 1.6 - o[j + 2]) * w) * lit;
    }
    this.tinted = k > 0.001 || dark;
  }

  private dX = 0; private dZ = 0; private dFrom = 0; private dFrac = 0;
  /** Погасить статичные пятна по кругу (вместе со свечами); применяется в tintNear. */
  douse(cx: number, cz: number, from: number, frac: number): void { this.dX = cx; this.dZ = cz; this.dFrom = from; this.dFrac = frac; }
  private qX = 0; private qZ = 0; private qR = 0;
  /** Погасить статичные пятна в круге (ударная волна приземления); r = 0 — снять. */
  quench(x: number, z: number, r: number): void { this.qX = x; this.qZ = z; this.qR = r; }

  private write(i: number, x: number, z: number, r: number, color: string | [number, number, number], intensity: number, flicker: number): void {
    const c = typeof color === 'string' ? hexToLinear(color) : color;
    const o = i * 4;
    this.data[o] = x; this.data[o + 1] = z; this.data[o + 2] = r; this.data[o + 3] = flicker;
    this.col[o] = c[0] * intensity; this.col[o + 1] = c[1] * intensity; this.col[o + 2] = c[2] * intensity; this.col[o + 3] = (i * 0.618) % 1 * 10;
  }

  beginDynamic(): void { this.dyn = 0; }
  addDynamic(x: number, z: number, r: number, rgb: [number, number, number], intensity: number): void {
    const i = this.staticCount + this.dyn;
    if (i >= this.max) return;
    this.write(i, x, z, r, rgb, intensity, 0);
    this.dyn++;
  }
  commit(): void {
    this.geo.instanceCount = this.staticCount + this.dyn;
    this.a1.needsUpdate = true; this.a2.needsUpdate = true;
  }
}

/** Рунический круг на полу (SDF-шейдер): золотые кольца, глифы-засечки, фиолетовые линии. */
export class RuneCircle {
  readonly mesh: THREE.Mesh;
  readonly u = { uPulse: { value: 0 }, uGold: { value: new THREE.Vector3(...hexToLinear('#B8954E')) }, uVoid: { value: new THREE.Vector3(...hexToLinear('#5cc4e0')) }, uAlpha: { value: 1 } };
  constructor(radius: number) {
    const g = new THREE.PlaneGeometry(radius * 2, radius * 2);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.u, uTime: G.uTime },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, 0.025, 0.0), 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uPulse, uAlpha; uniform vec3 uGold, uVoid; varying vec2 vUv;
        float ring(float r, float at, float w) { return smoothstep(w, 0.0, abs(r - at)); }
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x);
          float rot = a + uTime * 0.05;
          float g = ring(r, 0.97, 0.008) + ring(r, 0.9, 0.005) + ring(r, 0.55, 0.006) * 0.8 + ring(r, 0.5, 0.004) * 0.6;
          // засечки-глифы между кольцами
          float ticks = step(0.92, fract(rot * 24.0 / 6.2831)) * step(0.905, r) * step(r, 0.965);
          float seg = floor(rot * 12.0 / 6.2831);
          float lr = fract(rot * 12.0 / 6.2831);
          float glyph = smoothstep(0.012, 0.0, abs(r - (0.66 + 0.12 * fract(seg * 0.618)))) * step(0.15, lr) * step(lr, 0.85)
                      + smoothstep(0.02, 0.0, abs(lr - 0.5)) * step(0.62, r) * step(r, 0.84) * step(0.5, fract(seg * 0.37));
          // семиконечная звезда Литургии {7/2}: 7 хорд на расстоянии R·cos(2π/7) от центра, R = 0.55
          float star = 0.0;
          for (int k = 0; k < 7; k++) {
            float ang = float(k) * 0.8976 - uTime * 0.03;
            vec2 n = vec2(cos(ang), sin(ang));
            star += smoothstep(0.006, 0.0, abs(dot(vUv, n) - 0.343)) * step(r, 0.55);
          }
          vec3 col = uGold * (g * 1.4 + ticks * 0.9 + glyph * 0.25) + uVoid * (star * 0.9 + glyph * 0.5) * (0.6 + 0.4 * sin(uTime * 1.3));
          col += uVoid * uPulse * smoothstep(1.0, 0.0, r) * 1.5;
          gl_FragColor = vec4(col * 0.18 * uAlpha, 1.0);
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.renderOrder = 1;
  }
}
