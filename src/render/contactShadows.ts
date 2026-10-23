import * as THREE from 'three';
import { clamp } from '../core/math';

/**
 * Контактные тени (разбор): сколько пятен за кадр, плотность в центре, высота, на которой тень гаснет (м),
 * и насколько она расплывается с высотой (×радиус за метр).
 */
export const CONTACT = { max: 96, alpha: 0.85, fadeH: 4, grow: 0.25 };

/** Плотность пятна для тела на высоте y: 1 у пола, 0 к CONTACT.fadeH; под полом (падение в бездну) — нет. */
export function contactAlpha(y: number): number {
  if (y < -0.25) return 0;
  return CONTACT.alpha * clamp(1 - Math.max(0, y) / CONTACT.fadeH, 0, 1);
}

/**
 * Мягкое тёмное пятно под каждым персонажем: ставит фигуру на пол (без него герой и враги «парят» над
 * тёмным обсидианом) и показывает, где приземлится прыгнувший. Один инстансный квад на пятно, без теней сцены.
 */
export class ContactShadows {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly a: THREE.InstancedBufferAttribute;
  private n = 0;

  constructor(readonly max = CONTACT.max) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.a);
    g.instanceCount = 0;
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 iA; varying vec2 vP; varying float vA;
        void main() {
          vP = position.xz; vA = iA.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(iA.x + position.x * iA.z, 0.035, iA.y + position.z * iA.z, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vP; varying float vA;
        void main() {
          float d = length(vP);
          if (d > 1.0) discard;
          // плотное ядро под ступнями и мягкий край
          float k = (1.0 - smoothstep(0.0, 1.0, d)) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.45, d)));
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

  begin(): void { this.n = 0; }

  /** Пятно под телом радиуса r на высоте y (м); fade — дополнительный множитель (растворение). */
  add(x: number, z: number, r: number, y: number, fade = 1): void {
    const al = contactAlpha(y) * fade;
    if (al < 0.01 || this.n >= this.max) return;
    const o = this.n++ * 4, f = this.a.array as Float32Array;
    f[o] = x; f[o + 1] = z; f[o + 2] = r * (1 + Math.max(0, y) * CONTACT.grow); f[o + 3] = al;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      this.a.clearUpdateRanges();
      this.a.addUpdateRange(0, this.n * 4);
      this.a.needsUpdate = true;
    }
  }

  get count(): number { return this.n; }

  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
