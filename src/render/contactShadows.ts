import * as THREE from 'three';
import { clamp } from '../core/math';
import { FX } from './fx';
import { G } from './materials';

/**
 * Контактные тени (разбор): сколько пятен за кадр, плотность в центре, высота, на которой тень гаснет (м),
 * и насколько она расплывается с высотой (×радиус за метр). stretch — доля геометрической длины тени, на которую
 * пятно вытягивается от ключевого света (план ×100, A2 для low; флаг shadow): пятно — уже не круг, а направление
 * света. 0 — круглые, как раньше.
 */
export const CONTACT = { max: 96, alpha: 0.85, fadeH: 4, grow: 0.25, stretch: FX.shadow ? 0.55 : 0, tail: 0.7 };

/** Плотность пятна для тела на высоте y: 1 у пола, 0 к CONTACT.fadeH; под полом (падение в бездну) — нет. */
export function contactAlpha(y: number): number {
  if (y < -0.25) return 0;
  return CONTACT.alpha * clamp(1 - Math.max(0, y) / CONTACT.fadeH, 0, 1);
}

/** Длина вытянутой части тени (м) для тела высотой h на высоте y при ключевом свете dir (к свету). */
export function contactStretch(h: number, y: number, dir: { x: number; y: number; z: number }): number {
  if (CONTACT.stretch <= 0 || h <= 0) return 0;
  const tan = Math.hypot(dir.x, dir.z) / Math.max(0.2, dir.y);
  // в прыжке тело отрывается от своей тени: вытянутая часть короче
  return h * tan * CONTACT.stretch * clamp(1 - Math.max(0, y) / CONTACT.fadeH, 0, 1);
}

/**
 * Мягкое тёмное пятно под каждым персонажем: ставит фигуру на пол (без него герой и враги «парят» над
 * тёмным обсидианом) и показывает, где приземлится прыгнувший. Плотное ядро под ногами и бледнеющий хвост
 * от ключевого света — по высоте тела. Один инстансный квад на пятно, без теней сцены.
 */
export class ContactShadows {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly len: THREE.InstancedBufferAttribute;
  private readonly key = { x: 0, y: 1, z: 0 };
  private readonly uKey = { value: new THREE.Vector2(0, 0) };
  private n = 0;
  /**
   * Хвосты от ключевого света. Когда тела бросают настоящие тени в буфер света (план ×100, A2: medium и high),
   * хвост не нужен — остаётся плотное пятно под ногами, оно ставит фигуру на пол.
   */
  tails = true;

  constructor(readonly max = CONTACT.max) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.a.setUsage(THREE.DynamicDrawUsage);
    this.len = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.len.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.a);
    g.setAttribute('iLen', this.len);
    g.instanceCount = 0;
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      uniforms: { uKey: this.uKey },
      vertexShader: /* glsl */ `
        attribute vec4 iA; attribute float iLen; uniform vec2 uKey; varying vec2 vP; varying float vA, vR, vLen;
        void main() {
          // квад вдоль тени: от −r до r + len по направлению uKey, ±r поперёк; vP — метры от ног
          vec2 D = uKey, P = vec2(-uKey.y, uKey.x);
          float r = iA.z, hl = r + iLen * 0.5;
          vP = vec2(iLen * 0.5 + position.x * hl, position.z * r);
          vA = iA.w; vR = r; vLen = iLen;
          vec2 w = iA.xy + D * vP.x + P * vP.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(w.x, 0.035, w.y, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vP; varying float vA, vR, vLen;
        void main() {
          float d = length(vP) / vR;
          // плотное ядро под ступнями и мягкий край
          float k = (1.0 - smoothstep(0.0, 1.0, d)) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.45, d)));
          if (vLen > 0.01) {
            // хвост от ключевого света: сужается и бледнеет к концу
            float s = clamp(vP.x, 0.0, vLen), f = s / vLen, rr = vR * mix(0.85, 0.5, f);
            float tail = (1.0 - smoothstep(rr * 0.25, rr, length(vec2(vP.x - s, vP.y)))) * mix(${CONTACT.tail.toFixed(2)}, 0.15, f);
            k = max(k, tail);
          }
          if (k <= 0.002) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.004, vA * k);
        }
      `,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    // после пола и следов, до эффектов
    this.mesh.renderOrder = 3;
  }

  begin(): void {
    this.n = 0;
    // ключевой свет теней — тот же, что у теней буфера света (окна фасада или дальняя сторона арены)
    const L = G.uShadowDir.value, l = Math.hypot(L.x, L.z) || 1;
    this.key.x = L.x; this.key.y = L.y; this.key.z = L.z;
    this.uKey.value.set(-L.x / l, -L.z / l);
  }

  /** Пятно под телом радиуса r на высоте y (м); fade — дополнительный множитель (растворение); h — рост тела (м). */
  add(x: number, z: number, r: number, y: number, fade = 1, h = 0): void {
    const al = contactAlpha(y) * fade;
    if (al < 0.01 || this.n >= this.max) return;
    const i = this.n++, o = i * 4, f = this.a.array as Float32Array;
    f[o] = x; f[o + 1] = z; f[o + 2] = r * (1 + Math.max(0, y) * CONTACT.grow); f[o + 3] = al;
    (this.len.array as Float32Array)[i] = this.tails ? contactStretch(h, y, this.key) : 0;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      this.a.clearUpdateRanges();
      this.a.addUpdateRange(0, this.n * 4);
      this.a.needsUpdate = true;
      this.len.clearUpdateRanges();
      this.len.addUpdateRange(0, this.n);
      this.len.needsUpdate = true;
    }
  }

  get count(): number { return this.n; }

  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
