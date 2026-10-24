import * as THREE from 'three';
import { makeParticleAtlas, ATLAS_FRAMES, type AtlasFrame } from '../gen/tex/textures';

let atlas: THREE.Texture | null = null;
const getAtlas = () => (atlas ??= makeParticleAtlas());

/**
 * Динамические billboard-спрайты, переписываемые каждый кадр: ядра и ореолы снарядов, сияние ядер врагов,
 * пламя Эфира, значки. Один draw call на систему.
 */
export class Sprites {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly p: Float32Array; private readonly c: Float32Array; private readonly m: Float32Array;
  private readonly ap: THREE.InstancedBufferAttribute; private readonly ac: THREE.InstancedBufferAttribute; private readonly am: THREE.InstancedBufferAttribute;
  private n = 0;

  constructor(readonly max = 512, additive = true) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.p = new Float32Array(max * 4); this.c = new Float32Array(max * 4); this.m = new Float32Array(max * 4);
    this.ap = new THREE.InstancedBufferAttribute(this.p, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.ac = new THREE.InstancedBufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.am = new THREE.InstancedBufferAttribute(this.m, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.geo.setAttribute('aP', this.ap); this.geo.setAttribute('aC', this.ac); this.geo.setAttribute('aM', this.am);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: getAtlas() } },
      vertexShader: /* glsl */ `
        attribute vec4 aP; attribute vec4 aC; attribute vec4 aM;
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 mv = viewMatrix * vec4(aP.xyz, 1.0);
          float r = aM.y; float c = cos(r), s = sin(r);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aP.w;
          q.y *= aM.z;  // вытяжка по вертикали (пламя)
          mv.xy += q;
          // слегка подтянуть к камере, чтобы не резалось полом
          mv.z += aM.w;
          gl_Position = projectionMatrix * mv;
          vUv = vec2((uv.x + aM.x) / 8.0, uv.y);
          vCol = aC;
        }
      `,
      fragmentShader: additive ? /* glsl */ `
        uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol;
        void main() { float a = texture2D(uAtlas, vUv).a * vCol.a; gl_FragColor = vec4(vCol.rgb * a, 1.0); }
      ` : /* glsl */ `
        uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol;
        void main() { float a = texture2D(uAtlas, vUv).a * vCol.a; if (a < 0.02) discard; gl_FragColor = vec4(vCol.rgb, a); }
      `,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
  }

  begin(): void { this.n = 0; }

  add(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a = 1, frame: AtlasFrame = 'dot', rot = 0, stretchY = 1, bias = 0): void {
    if (this.n >= this.max) return;
    const o = this.n++ * 4;
    this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z; this.p[o + 3] = size;
    this.c[o] = r; this.c[o + 1] = g; this.c[o + 2] = b; this.c[o + 3] = a;
    this.m[o] = ATLAS_FRAMES[frame]; this.m[o + 1] = rot; this.m[o + 2] = stretchY; this.m[o + 3] = bias;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    if (this.n) { this.ap.needsUpdate = true; this.ac.needsUpdate = true; this.am.needsUpdate = true; }
  }
}
