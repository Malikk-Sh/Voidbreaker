import * as THREE from 'three';

interface Ring { mesh: THREE.Mesh; u: { uR: { value: number }; uW: { value: number }; uA: { value: number }; uColor: { value: THREE.Vector3 } }; t: number; life: number; r0: number; r1: number; w: number; alpha: number; active: boolean; y: number }

/**
 * Ударная волна (GDD §16.1): светлое кольцо на полу, расширяющееся с затуханием.
 * Искажение экрана регистрирует FeelSystem в пост-обработке.
 */
export class Rings {
  readonly group = new THREE.Group();
  private pool: Ring[] = [];
  private readonly geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

  constructor(n = 24) {
    for (let i = 0; i < n; i++) {
      const u = { uR: { value: 0.5 }, uW: { value: 0.1 }, uA: { value: 0 }, uColor: { value: new THREE.Vector3(1, 1, 1) } };
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uR, uW, uA; uniform vec3 uColor; varying vec2 vUv;
          void main() {
            float r = length(vUv);
            float d = abs(r - uR);
            float a = smoothstep(uW, 0.0, d) * uA;
            float inner = smoothstep(uR, uR * 0.2, r) * step(r, uR) * uA * 0.12;
            gl_FragColor = vec4(uColor * (a + inner), 1.0);
          }
        `,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.visible = false;
      mesh.renderOrder = 25;
      this.group.add(mesh);
      this.pool.push({ mesh, u, t: 0, life: 1, r0: 0, r1: 1, w: 0.2, alpha: 1, active: false, y: 0.05 });
    }
  }

  /** color — линейный RGB (можно HDR). */
  spawn(x: number, z: number, r0: number, r1: number, life: number, color: [number, number, number], width = 0.25, alpha = 1, y = 0.06): void {
    let ring = this.pool.find((r) => !r.active);
    if (!ring) ring = this.pool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    ring.active = true; ring.t = 0; ring.life = life; ring.r0 = r0; ring.r1 = r1; ring.w = width; ring.alpha = alpha; ring.y = y;
    ring.u.uColor.value.set(color[0], color[1], color[2]);
    ring.mesh.position.set(x, y, z);
    ring.mesh.visible = true;
  }

  update(dt: number): void {
    for (const r of this.pool) {
      if (!r.active) continue;
      r.t += dt;
      const f = Math.min(1, r.t / r.life);
      const e = 1 - Math.pow(1 - f, 3);
      const R = r.r0 + (r.r1 - r.r0) * e;
      const scale = R + r.w * 2;
      r.mesh.scale.set(scale, 1, scale);
      r.u.uR.value = R / scale;
      r.u.uW.value = r.w / scale;
      r.u.uA.value = r.alpha * (1 - f) * (1 - f) * 2;
      if (f >= 1) { r.active = false; r.mesh.visible = false; }
    }
  }

  clear(): void { for (const r of this.pool) { r.active = false; r.mesh.visible = false; } }
}
