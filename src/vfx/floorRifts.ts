import * as THREE from 'three';
import { G } from '../render/materials';
import type { FloorRift } from '../world/abilities';

const MAX = 3;

/**
 * Разломы на полу (план §6.2): зубчатая трещина — фиолетовое свечение и белое ядро, бегущий пульс.
 * Фиолетовый — цвет силы Пилота: трещина не читается как опасность (красный на полу — только враг).
 */
export class FloorRiftsView {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: G.uTime, uT: { value: 0 }, uLife: { value: 3 }, uSeed: { value: i * 7.31 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uT, uLife, uSeed; varying vec2 vUv;
          float h(float x) { return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
          void main() {
            float x = vUv.x * 16.0, i = floor(x), f = fract(x);
            float zz = mix(h(i), h(i + 1.0), f) - 0.5;
            float c = abs(vUv.y - 0.5 - zz * 0.32);
            float core = smoothstep(0.05, 0.0, c), glow = smoothstep(0.32, 0.0, c);
            float ends = smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
            float fade = min(1.0, uT / 0.1) * (1.0 - smoothstep(0.7, 1.0, uT / uLife));
            float pulse = 0.8 + 0.2 * sin(uTime * 9.0 - vUv.x * 12.0);
            vec3 col = vec3(0.55, 0.36, 0.96) * glow * 1.3 + vec3(1.0, 0.94, 1.0) * core * 2.0;
            gl_FragColor = vec4(col * ends * fade * pulse, 1.0);
          }
        `,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  sync(list: FloorRift[]): void {
    this.meshes.forEach((m, i) => {
      const r = list[i];
      m.visible = !!r;
      if (!r) return;
      m.position.set(r.x + r.dx * r.len / 2, 0.045, r.z + r.dz * r.len / 2);
      m.rotation.set(0, Math.atan2(-r.dz, r.dx), 0);
      m.scale.set(r.len, 1, 0.7);
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uT.value = r.t; u.uLife.value = r.dur;
    });
  }
}
