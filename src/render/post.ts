import * as THREE from 'three';
import { G } from './materials';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Ударные волны искажения: до 4 одновременно (центр в UV, радиус, сила). */
export const MAX_WAVES = 4;

export interface PostState {
  bloom: number;
  exposure: number;
  chroma: number;
  desat: number;
  vignette: number;
  lowHp: number;
  flash: number;
  flashColor: THREE.Color;
  grain: number;
  saturation: number;
  lift: THREE.Vector3;
  gamma: THREE.Vector3;
  gain: THREE.Vector3;
  waves: THREE.Vector4[];
  letterbox: number;
  frost: number;
}

/**
 * Пост-обработка (Tech §19.4): свой лёгкий bloom (порог → даунсемпл → dual-Kawase → сложение)
 * и один uber-проход: искажения волн, аберрация, обесцвечивание «Мгновения Пустоты» (фиолетовый и красный остаются),
 * цветокоррекция lift/gamma/gain, виньетка, зерно, тонмаппинг.
 */
export class Post {
  readonly state: PostState = {
    bloom: 0.55, exposure: 1.0, chroma: 0, desat: 0, vignette: 0.55, lowHp: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1),
    grain: 0.018, saturation: 1.05, lift: new THREE.Vector3(0.004, 0.002, 0.007), gamma: new THREE.Vector3(1, 1, 1),
    gain: new THREE.Vector3(1, 1, 1), waves: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, 0)),
    letterbox: 0, frost: 0,
  };
  sceneRT: THREE.WebGLRenderTarget;
  private levels: THREE.WebGLRenderTarget[] = [];
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly brightMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly compMat: THREE.ShaderMaterial;
  bloomLevels = 3;
  bloomEnabled = true;
  private w = 1; private h = 1;

  constructor(private renderer: THREE.WebGLRenderer, msaa: number) {
    this.sceneRT = this.makeRT(1, 1, msaa, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g);
    this.quad.frustumCulled = false;

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uKnee: { value: 0.5 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee; varying vec2 vUv;
        vec3 pick(vec2 uv) {
          vec3 c = texture2D(tSrc, uv).rgb;
          float br = max(c.r, max(c.g, c.b));
          float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
          soft = soft * soft / (4.0 * uKnee + 1e-4);
          float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
          return min(c * contrib, vec3(24.0));
        }
        void main() {
          vec2 o = uTexel;
          vec3 c = pick(vUv) * 4.0 + pick(vUv - o) + pick(vUv + o) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv - vec2(o.x, -o.y));
          gl_FragColor = vec4(c / 8.0, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
    this.downMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          vec2 o = uTexel;
          vec3 c = texture2D(tSrc, vUv).rgb * 4.0 + texture2D(tSrc, vUv - o).rgb + texture2D(tSrc, vUv + o).rgb
            + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb + texture2D(tSrc, vUv - vec2(o.x, -o.y)).rgb;
          gl_FragColor = vec4(c / 8.0, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight; varying vec2 vUv;
        void main() {
          vec2 o = uTexel;
          vec3 c = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0
            + texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb * 2.0
            + texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0
            + texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
          gl_FragColor = vec4(c / 12.0 * uWeight, 1.0);
        }
      `,
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    const s = this.state;
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 1 }, uHasBloom: { value: 1 },
        uExposure: { value: 1 }, uChroma: { value: 0 }, uDesat: { value: 0 }, uVignette: { value: 0.55 },
        uLowHp: { value: 0 }, uFlash: { value: 0 }, uFlashColor: { value: s.flashColor }, uGrain: { value: 0.03 },
        uSat: { value: 1 }, uLift: { value: s.lift }, uGamma: { value: s.gamma }, uGain: { value: s.gain },
        uWaves: { value: s.waves }, uAspect: { value: 1 }, uTime: G.uTime, uLetterbox: { value: 0 }, uFrost: { value: 0 },
        uNoise: G.uNoise,
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tBloom, uNoise;
        uniform float uBloom, uHasBloom, uExposure, uChroma, uDesat, uVignette, uLowHp, uFlash, uGrain, uSat, uAspect, uTime, uLetterbox, uFrost;
        uniform vec3 uFlashColor, uLift, uGamma, uGain;
        uniform vec4 uWaves[${MAX_WAVES}];
        varying vec2 vUv;

        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        vec3 toSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }

        void main() {
          vec2 uv = vUv;
          // ударные волны: смещение UV вдоль радиуса тонким кольцом
          for (int i = 0; i < ${MAX_WAVES}; i++) {
            vec4 w = uWaves[i];
            if (w.w <= 0.0) continue;
            vec2 d = uv - w.xy; d.x *= uAspect;
            float r = length(d);
            float k = smoothstep(0.07, 0.0, abs(r - w.z)) * w.w;
            uv -= (d / max(r, 1e-4)) / vec2(uAspect, 1.0) * k * 0.025;
          }
          vec3 c;
          if (uChroma > 0.001) {
            vec2 dir = (uv - 0.5) * uChroma * 0.012;
            c = vec3(texture2D(tScene, uv + dir).r, texture2D(tScene, uv).g, texture2D(tScene, uv - dir).b);
          } else {
            c = texture2D(tScene, uv).rgb;
          }
          if (uHasBloom > 0.5) c += texture2D(tBloom, uv).rgb * uBloom;

          // «Мгновение Пустоты»: мир обесцвечивается, фиолетовый и красный остаются
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float keep = smoothstep(0.04, 0.35, (max(c.r, c.b) - c.g) / (max(c.r, c.b) + 1e-3));
          c = mix(c, mix(vec3(l) * vec3(0.92, 0.95, 1.05), c * 1.15, keep), uDesat);

          c = aces(c * uExposure);
          // цветокоррекция кривыми (lift/gamma/gain) и насыщенность
          c = pow(max(c * uGain + uLift * (1.0 - c), 0.0), 1.0 / uGamma);
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(lum), c, uSat);

          vec2 vc = vUv - 0.5; vc.x *= uAspect * 0.8;
          float v = dot(vc, vc);
          c *= 1.0 - uVignette * smoothstep(0.1, 0.65, v);
          // низкое HP: пульсирующая красная виньетка
          float beat = 0.6 + 0.4 * pow(abs(sin(uTime * 2.6)), 6.0);
          c = mix(c, vec3(0.55, 0.02, 0.05), uLowHp * beat * smoothstep(0.05, 0.5, v) * 0.85);
          // иней по краям экрана (Сестра Безмолвия / «Тишина»)
          if (uFrost > 0.001) {
            float fr = texture2D(uNoise, vUv * vec2(uAspect, 1.0) * 1.5).g;
            float edge = smoothstep(0.42 - uFrost * 0.42, 0.62 - uFrost * 0.3, length(vc) + fr * 0.08);
            c = mix(c, vec3(0.75, 0.8, 0.95), edge * 0.8);
          }
          c += uFlashColor * uFlash;
          float gr = texture2D(uNoise, vUv * vec2(uAspect, 1.0) * 3.0 + fract(uTime * 7.31)).b - 0.5;
          c += gr * uGrain;
          // летербокс (казни, появление босса)
          float lb = uLetterbox * 0.11;
          if (vUv.y < lb || vUv.y > 1.0 - lb) c = vec3(0.0);
          gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
  }

  private makeRT(w: number, h: number, samples = 0, depth = false): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: depth, samples,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
  }

  setSize(w: number, h: number, msaa: number): void {
    this.w = w; this.h = h;
    if (this.sceneRT.samples !== msaa) { this.sceneRT.dispose(); this.sceneRT = this.makeRT(w, h, msaa, true); }
    this.sceneRT.setSize(w, h);
    for (const l of this.levels) l.dispose();
    this.levels = [];
    let lw = w, lh = h;
    for (let i = 0; i < 4; i++) {
      lw = Math.max(1, Math.floor(lw / 2)); lh = Math.max(1, Math.floor(lh / 2));
      this.levels.push(this.makeRT(lw, lh));
    }
    (this.compMat.uniforms.uAspect as THREE.IUniform).value = w / h;
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, clear = true): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    if (clear) this.renderer.clear(true, false, false);
    this.renderer.render(this.quad, this.cam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(scene, camera);

    const useBloom = this.bloomEnabled && this.bloomLevels > 0;
    const n = Math.min(this.bloomLevels, this.levels.length);
    if (useBloom) {
      this.brightMat.uniforms.tSrc.value = this.sceneRT.texture;
      (this.brightMat.uniforms.uTexel.value as THREE.Vector2).set(1 / this.w, 1 / this.h);
      this.pass(this.brightMat, this.levels[0]);
      for (let i = 1; i < n; i++) {
        const src = this.levels[i - 1];
        this.downMat.uniforms.tSrc.value = src.texture;
        (this.downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        this.pass(this.downMat, this.levels[i]);
      }
      for (let i = n - 1; i > 0; i--) {
        const src = this.levels[i];
        this.upMat.uniforms.tSrc.value = src.texture;
        (this.upMat.uniforms.uTexel.value as THREE.Vector2).set(0.5 / src.width, 0.5 / src.height);
        this.upMat.uniforms.uWeight.value = 1.0;
        this.pass(this.upMat, this.levels[i - 1], false);
      }
    }
    const s = this.state, u = this.compMat.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.levels[0].texture;
    u.uHasBloom.value = useBloom ? 1 : 0;
    u.uBloom.value = s.bloom;
    u.uExposure.value = s.exposure;
    u.uChroma.value = s.chroma;
    u.uDesat.value = s.desat;
    u.uVignette.value = s.vignette;
    u.uLowHp.value = s.lowHp;
    u.uFlash.value = s.flash;
    u.uGrain.value = s.grain;
    u.uSat.value = s.saturation;
    u.uLetterbox.value = s.letterbox;
    u.uFrost.value = s.frost;
    this.pass(this.compMat, null);
  }

  dispose(): void {
    this.sceneRT.dispose();
    for (const l of this.levels) l.dispose();
  }
}
