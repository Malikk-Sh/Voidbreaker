import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { G } from '../render/materials';
import { FX } from '../render/fx';
import type { RingWave, Telegraph } from '../world/entities';

const RED = new THREE.Vector3(...hexToLinear('#FF4A57')).multiplyScalar(1.6);
const WHITE = new THREE.Vector3(1.6, 1.55, 1.7);
/** Повтор «Тени» — тёмно-багровый. */
const ECHO = new THREE.Vector3(...hexToLinear('#8a1020')).multiplyScalar(1.3);

interface Decal { mesh: THREE.Mesh; u: Record<string, THREE.IUniform>; used: boolean }

/**
 * Вид телеграфа (план ×100, D4; флаг tele): логика, заливка от центра к моменту удара и штриховка — прежние,
 * меняется только вид. Тонкий контур (не тоньше px пикселей и m метров) и мягкий отсвет внутри; заливка
 * полупрозрачная — затемняет пол и красит его, а не светится поверх тел; руны по кромке медленно ползут; вокруг
 * Пилота (near…far м) заливка прозрачнее. Было: аддитивно, весь круг ×1.6 HDR, после блума — красное пятно.
 */
export const TELE_LOOK = { px: 1.8, m: 0.045, fill: [0.16, 0.26] as const, fillTint: 0.45, front: 0.5, rune: 0.45, runeLen: 0.42, runeSpeed: 0.12, hatch: 1.0, heroNear: 0.5, heroFar: 1.6, heroMin: 0.35 };
const T = TELE_LOOK;

/** Новый вид: премультиплированная альфа — пол под заливкой темнеет на её долю, сверху ложится цвет. */
const FRAG_LAYERED = /* glsl */ `
  uniform float uKind, uProg, uAlpha, uHalf, uInner, uGapN, uAspect, uTime, uHatch, uSize;
  uniform vec3 uColor, uHero; uniform vec2 uGaps[4];
  varying vec2 vUv; varying vec3 vW;
  float angDiff(float a, float b) { return mod(b - a + 3.14159265, 6.2831853) - 3.14159265; }
  // ширина линии в долях размера фигуры: не тоньше ${T.px} px и ${T.m} м; px — fwidth расстояния
  float lineW(float px) { return max(${T.px.toFixed(2)} * px, ${T.m.toFixed(3)} / uSize); }
  // контур на расстоянии d от кромки
  float rimAt(float d, float px) { float lw = lineW(px); return 1.0 - smoothstep(lw, lw + px, d); }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float inside = 0.0, d = 1.0, fill = 0.0, fd = 9.0, along = 0.0;
    if (uKind < 0.5) {            // круг
      inside = step(r, 1.0);
      d = 1.0 - r; fill = step(r, uProg); fd = abs(r - uProg);
      along = atan(p.x, p.y) * uSize;
    } else if (uKind < 1.5) {     // конус: направление вдоль +Y квада
      float a = atan(p.x, p.y);
      inside = step(r, 1.0) * step(abs(a), uHalf);
      d = min(1.0 - r, (uHalf - abs(a)) * r); fill = step(r, uProg); fd = abs(r - uProg);
      along = a * uSize;
    } else if (uKind < 2.5) {     // линия: vUv.y — вдоль 0..1, поперёк — vUv.x; uSize — полуширина
      float u = vUv.y, v = abs(vUv.x * 2.0 - 1.0);
      inside = 1.0;
      d = min(1.0 - v, min(u, 1.0 - u) * uAspect * 2.0); fill = step(u, uProg); fd = abs(u - uProg) * uAspect * 2.0;
      along = u * uAspect * 2.0 * uSize;
    } else {                      // кольцо с разрывами: заливка — по силе, а не от центра
      inside = step(uInner, r) * step(r, 1.0);
      float a = atan(-p.x, p.y), gd = 9.0;
      for (int i = 0; i < 4; i++) {
        if (float(i) >= uGapN) break;
        float g = abs(angDiff(uGaps[i].x, a)) - uGaps[i].y * 0.5;
        if (g < 0.0) inside = 0.0;
        gd = min(gd, g * r);
      }
      d = min(min(r - uInner, 1.0 - r), gd); fill = 0.6 + 0.4 * uProg;
      along = a * uSize;
    }
    // производные — до discard и вне ветвлений
    float px = max(fwidth(d), 1e-5), pf = max(fwidth(fd), 1e-5);
    if (inside < 0.5) discard;
    float lw = lineW(px);
    float edge = rimAt(d, px);
    float glow = (1.0 - smoothstep(lw, lw * 4.0, d)) * 0.35;
    float front = uKind < 2.5 && uProg > 0.02 && uProg < 0.995 ? rimAt(fd, pf) : 0.0;
    // руны: полоса внутри контура, штрихи разной длины, ползут по кромке
    float band = step(lw * 2.4, d) * (1.0 - step(lw * 2.4 + max(lw * 2.5, 0.1 / uSize), d));
    float L = along + uTime * ${T.runeSpeed.toFixed(2)};
    float id = floor(L / ${T.runeLen.toFixed(2)}), sg = fract(L / ${T.runeLen.toFixed(2)});
    float h = fract(sin(id * 12.9898) * 43758.5453);
    float rune = band * step(0.14, sg) * step(sg, 0.3 + 0.45 * h);
    // штриховка (дальтонизм): диагональные полосы по мировым координатам
    float hatch = step(0.5, fract((vW.x + vW.z) * 1.6)) * uHatch * 0.35 * (0.3 + uProg * 0.7) * fill;
    // у ног Пилота заливка прозрачнее: видно, где он стоит
    float near = mix(${T.heroMin.toFixed(2)}, 1.0, smoothstep(${T.heroNear.toFixed(2)}, ${T.heroFar.toFixed(2)}, length(vW.xz - uHero.xz)));
    float pulse = 0.82 + 0.18 * sin(uTime * 12.0);
    float aFill = fill * mix(${T.fill[0].toFixed(2)}, ${T.fill[1].toFixed(2)}, uProg) * near;
    float aFront = front * ${T.front.toFixed(2)} * near, aRune = rune * ${T.rune.toFixed(2)}, aEdge = edge * 0.9;
    vec3 col = uColor * (aEdge * pulse + glow * 0.45 + aFill * ${T.fillTint.toFixed(2)} + aFront * 0.9 + aRune * 0.75 + hatch * ${T.hatch.toFixed(2)});
    float a = clamp(aEdge + glow * 0.5 + aFill + aFront + aRune + hatch, 0.0, 1.0);
    gl_FragColor = vec4(col * uAlpha, min(1.0, a * uAlpha));
  }
`;

/** Прежний вид (без флага tele): аддитивно, заливка и контур одного цвета. */
const FRAG_ADDITIVE = /* glsl */ `
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
`;

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
        uSize: { value: 1 }, uHero: G.uHero,
      };
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: FX.tele ? FRAG_LAYERED : FRAG_ADDITIVE,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        ...(FX.tele
          ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }
          : { blending: THREE.AdditiveBlending }),
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
      u.uKind.value = 3; u.uInner.value = r0 / r1; u.uProg.value = 1; u.uAlpha.value = 1.15; u.uHatch.value = 0; u.uSize.value = r1;
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
          u.uKind.value = 0; u.uSize.value = s.r;
          m.position.set(s.x, 0.04, s.z); m.scale.set(s.r * 2, 1, s.r * 2);
          break;
        case 'arc':
          u.uKind.value = 1; u.uHalf.value = s.half; u.uSize.value = s.r;
          m.position.set(s.x, 0.04, s.z); m.scale.set(s.r * 2, 1, s.r * 2);
          // плоскость повёрнута: +Y квада (vUv.y) смотрит в −Z мира → поворачиваем на dir + π
          m.rotation.y = s.dir + Math.PI;
          break;
        case 'line': {
          u.uKind.value = 2; u.uAspect.value = s.len / Math.max(0.1, s.w); u.uSize.value = Math.max(0.05, s.w / 2);
          m.position.set(s.x + s.dx * s.len / 2, 0.04, s.z + s.dz * s.len / 2);
          m.scale.set(s.w, 1, s.len);
          m.rotation.y = Math.atan2(s.dx, s.dz) + Math.PI;
          break;
        }
        case 'ring': {
          u.uKind.value = 3; u.uInner.value = s.r0 / s.r1; u.uSize.value = s.r1;
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
