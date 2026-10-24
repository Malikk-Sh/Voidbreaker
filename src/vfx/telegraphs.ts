import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { G } from '../render/materials';
import type { RingWave, Telegraph } from '../world/entities';

const RED = new THREE.Vector3(...hexToLinear('#FF4A57')).multiplyScalar(1.6);
const WHITE = new THREE.Vector3(1.6, 1.55, 1.7);
/** Повтор «Тени» — тёмно-багровый. */
const ECHO = new THREE.Vector3(...hexToLinear('#8a1020')).multiplyScalar(1.3);

interface Decal { mesh: THREE.Mesh; u: Record<string, THREE.IUniform>; used: boolean }

/**
 * Наземные метки телеграфов (GDD §15.8, Tech §19.3): декаль-квад на полу, SDF-форма (круг, конус, линия, кольцо с разрывами).
 * Заливка от центра к краю завершается ровно в момент удара; поверх — штриховка для дальтоников (§21).
 */
export class TelegraphView {
  readonly group = new THREE.Group();
  private pool: Decal[] = [];
  private readonly geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  hatch = 0.35;

  constructor(n = 48) {
    for (let i = 0; i < n; i++) {
      const u: Record<string, THREE.IUniform> = {
        uKind: { value: 0 }, uProg: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: RED.clone() },
        uHalf: { value: 0.5 }, uInner: { value: 0 }, uGaps: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
        uGapN: { value: 0 }, uAspect: { value: 1 }, uTime: G.uTime, uHatch: { value: 0.35 }, uShadow: { value: 0 },
      };
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uKind, uProg, uAlpha, uHalf, uInner, uGapN, uAspect, uTime, uHatch, uShadow;
          uniform vec3 uColor; uniform vec2 uGaps[4];
          varying vec2 vUv; varying vec3 vW;
          float angDiff(float a, float b) { float d = mod(b - a + 3.14159265, 6.2831853) - 3.14159265; return d; }
          void main() {
            vec2 p = vUv * 2.0 - 1.0;   // круговые формы: [-1,1]
            float inside = 0.0, edge = 0.0, fill = 0.0;
            float pulse = 0.65 + 0.35 * sin(uTime * 20.0);
            if (uKind < 0.5) {            // круг
              float r = length(p);
              inside = step(r, 1.0);
              edge = smoothstep(0.86, 0.95, r) * inside;
              fill = step(r, uProg);
              fill = fill * 0.32 + smoothstep(uProg - 0.06, uProg, r) * fill * 0.55;
            } else if (uKind < 1.5) {     // дуга/конус: квад центрирован, направление вдоль +Y квада
              float r = length(p);
              float a = atan(p.x, p.y);
              float ia = step(abs(a), uHalf);
              inside = step(r, 1.0) * ia;
              float ae = smoothstep(uHalf - 0.06 / max(r, 0.15), uHalf, abs(a));
              edge = max(smoothstep(0.88, 0.96, r), ae) * inside;
              fill = step(r, uProg) * inside;
              fill = fill * 0.32 + smoothstep(uProg - 0.06, uProg, r) * fill * 0.55;
            } else if (uKind < 2.5) {     // линия: u вдоль длины 0..1 (vUv.y), поперёк vUv.x
              float u = vUv.y, v = abs(vUv.x * 2.0 - 1.0);
              inside = 1.0;
              float eu = min(u, 1.0 - u) * uAspect;
              edge = max(smoothstep(0.86, 0.97, v), smoothstep(0.08, 0.0, eu));
              fill = step(u, uProg);
              fill = fill * 0.32 + smoothstep(uProg - 0.04, uProg, u) * fill * 0.5;
            } else {                      // кольцо с разрывами
              float r = length(p);
              inside = step(uInner, r) * step(r, 1.0);
              float a = atan(-p.x, p.y);
              for (int i = 0; i < 4; i++) {
                if (float(i) >= uGapN) break;
                if (abs(angDiff(uGaps[i].x, a)) < uGaps[i].y * 0.5) inside = 0.0;
              }
              float mid = (uInner + 1.0) * 0.5, hw = (1.0 - uInner) * 0.5;
              edge = smoothstep(hw * 0.6, hw, abs(r - mid)) * inside;
              fill = inside * (0.35 + 0.25 * uProg);
            }
            if (inside < 0.5) discard;
            // штриховка (дальтонизм): диагональные полосы по мировым координатам
            float hatch = step(0.5, fract((vW.x + vW.z) * 1.6)) * uHatch * 0.35;
            float a = edge * pulse + fill + hatch * (0.3 + uProg * 0.7);
            vec3 col = uColor * a;
            if (uShadow > 0.5) col = mix(col, vec3(0.0), 0.0);
            gl_FragColor = vec4(col * uAlpha, 1.0);
          }
        `,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.pool.push({ mesh, u, used: false });
    }
  }

  sync(list: Telegraph[], rings: RingWave[] = []): void {
    let i = 0;
    // волны-кольца — «живые» атаки: яркое кольцо с разрывами
    for (const rw of rings) {
      if (i >= this.pool.length) break;
      const d = this.pool[i++];
      const u = d.u, m = d.mesh;
      m.visible = true;
      const r1 = rw.r + rw.width / 2, r0 = Math.max(0, rw.r - rw.width / 2);
      u.uKind.value = 3; u.uInner.value = r0 / r1; u.uProg.value = 1; u.uAlpha.value = 1.15; u.uHatch.value = 0;
      (u.uColor.value as THREE.Vector3).copy(RED);
      m.position.set(rw.x, 0.06, rw.z); m.scale.set(r1 * 2, 1, r1 * 2); m.rotation.set(0, Math.PI, 0);
      u.uGapN.value = Math.min(4, rw.gaps.length);
      for (let k = 0; k < 4; k++) (u.uGaps.value as THREE.Vector2[])[k].set(rw.gaps[k]?.a ?? 0, rw.gaps[k]?.w ?? 0);
    }
    for (const t of list) {
      if (i >= this.pool.length) break;
      const d = this.pool[i++];
      const s = t.shape, u = d.u, m = d.mesh;
      m.visible = true;
      const prog = Math.min(1, t.t / t.dur);
      u.uProg.value = prog;
      u.uAlpha.value = t.fade > 0 ? Math.max(0, 1 - t.fade / 0.15) * (t.t >= t.dur ? 1.6 : 1) : Math.min(1, t.t / 0.06);
      (u.uColor.value as THREE.Vector3).copy(t.white ? WHITE : t.echo ? ECHO : RED);
      u.uHatch.value = this.hatch;
      m.rotation.set(0, 0, 0);
      switch (s.k) {
        case 'circle':
          u.uKind.value = 0;
          m.position.set(s.x, 0.04, s.z); m.scale.set(s.r * 2, 1, s.r * 2);
          break;
        case 'arc':
          u.uKind.value = 1; u.uHalf.value = s.half;
          m.position.set(s.x, 0.04, s.z); m.scale.set(s.r * 2, 1, s.r * 2);
          // плоскость повёрнута: +Y квада (vUv.y) смотрит в −Z мира → поворачиваем на dir + π
          m.rotation.y = s.dir + Math.PI;
          break;
        case 'line': {
          u.uKind.value = 2; u.uAspect.value = s.len / Math.max(0.1, s.w);
          m.position.set(s.x + s.dx * s.len / 2, 0.04, s.z + s.dz * s.len / 2);
          m.scale.set(s.w, 1, s.len);
          m.rotation.y = Math.atan2(s.dx, s.dz) + Math.PI;
          break;
        }
        case 'ring': {
          u.uKind.value = 3; u.uInner.value = s.r0 / s.r1;
          m.position.set(s.x, 0.04, s.z); m.scale.set(s.r1 * 2, 1, s.r1 * 2);
          const gaps = s.gaps ?? [];
          u.uGapN.value = Math.min(4, gaps.length);
          for (let k = 0; k < 4; k++) (u.uGaps.value as THREE.Vector2[])[k].set(gaps[k]?.a ?? 0, gaps[k]?.w ?? 0);
          m.rotation.y = Math.PI;
          break;
        }
      }
    }
    for (; i < this.pool.length; i++) this.pool[i].mesh.visible = false;
  }
}
