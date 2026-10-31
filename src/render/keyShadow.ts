import * as THREE from 'three';
import { G } from './materials';
import type { QualityLevel } from './renderer';
import type { RigBatch } from './rigbatch';
import { parseFx } from './fx';

/**
 * Тени ключевого света (план ×100, A2) в буфере света: альфа буфера — видимость ключевого света на полу (1 — свет,
 * 0 — тень). Тела, колонны и декор проецируются на пол вдоль света (тень точки на высоте y — p − L.xz · y / L.y) и
 * пишут в альфу минимум: перекрытые треугольники одного тела не темнеют дважды. Пол затемняет свой небосвод, луну
 * и отражение на долю тени; свет буфера (свечи, вспышки) тень не гасит — у него свои направления.
 *
 * strength — плотность тени тела и декора (сколько света пола остаётся в тени — materials.LIGHT_LOOK.shadowFloor);
 * clipY — вершины глубже под полом (падение в бездну, выход из пола) тень не отбрасывают; minY — нижняя граница
 * высоты света, чтобы тени у горизонта не уходили в бесконечность; maxY — декор выше (цепи под сводом, верх фасада)
 * тень на пол арены не бросает: без свода над ней такие тени — случайные полосы; blur — размытие запечённых теней
 * архитектуры (шаг гаусса в текселях буфера: полутень ~0.4 м).
 */
export const KEY_SHADOW = { strength: 0.85, clipY: -0.35, minY: 0.25, maxY: 10, blur: 1.1 };

/**
 * Свет окон на полу (план ×100, A2, «как бирюзовая сетка в R03»): у каждого луча фасада — проекция стрельчатого окна
 * с переплётом. k — яркость в буфере; len — длина пятна вдоль луча (м); widen — ширина пятна × ширина луча у пола;
 * lead — ширина свинцовой перемычки (м), leadDark — насколько она гасит свет; edge — мягкость края (м); fade — сколько
 * света остаётся на дальнем от окна конце (свет расходится); alt — доля стёкол другого цвета, altMix — насколько их
 * цвет уходит от основного; breathe — глубина «облаков за окном» (медленный шум поверх света); breatheSpeed — их
 * скорость.
 */
export const WINDOW_LIGHT = {
  k: 0.22, len: 4.2, widen: 1.35, lead: 0.07, leadDark: 0.78, edge: 0.28, fade: 0.5, alt: 0.12, altMix: 0.55,
  breathe: 0.22, breatheSpeed: 0.018,
};

/**
 * Включены ли тени ключевого света. Нужен буфер света; ?fx=shadow выключает их вместе с вытянутыми контактными
 * тенями. Запечённые тени архитектуры и свет окон — на любом уровне (одна выборка), тени тел — на medium и high
 * (на low остаются вытянутые пятна, как в плане).
 */
export function keyShadowsEnabled(lightOn: boolean, quality: QualityLevel, search = typeof location !== 'undefined' ? location.search : ''): { statics: boolean; actors: boolean } {
  const on = lightOn && parseFx(search).shadow;
  return { statics: on, actors: on && quality !== 'low' };
}

/** Направление теней по умолчанию (арены без окон): с дальней стороны, чуть слева — тени ложатся к камере. */
export const SHADOW_DIR_DEFAULT: readonly [number, number, number] = [-0.25, 0.8, -0.55];
/** Ниже этой высоты свет не опускается: тени не длиннее ~1.3 роста. */
const SHADOW_DIR_MIN_Y = 0.6;

/**
 * Ключевой свет теней по окнам фасада: средний луч от пола к окну. Без окон — SHADOW_DIR_DEFAULT. Нормирован,
 * высота не ниже SHADOW_DIR_MIN_Y.
 */
export function shadowDirFromRays(rays: readonly { top: THREE.Vector3; bot: THREE.Vector3 }[], out = new THREE.Vector3()): THREE.Vector3 {
  if (!rays.length) return out.set(...SHADOW_DIR_DEFAULT).normalize();
  out.set(0, 0, 0);
  for (const r of rays) out.add(_d.subVectors(r.top, r.bot).normalize());
  out.normalize();
  if (out.y < SHADOW_DIR_MIN_Y) {
    const hl = Math.hypot(out.x, out.z) || 1, k = Math.sqrt(1 - SHADOW_DIR_MIN_Y ** 2) / hl;
    out.set(out.x * k, SHADOW_DIR_MIN_Y, out.z * k);
  }
  return out;
}
const _d = new THREE.Vector3();

/** Сдвиг тени точки на высоте y (м) по полу при свете dir (к свету): куда ляжет её тень. */
export function shadowOffset(y: number, dir: { x: number; y: number; z: number }): [number, number] {
  const h = Math.max(0, y), k = h / Math.max(KEY_SHADOW.minY, dir.y);
  return [-dir.x * k, -dir.z * k];
}

/** Общие униформы всех заслонителей: направление ключевого света теней (G.uShadowDir) и плотность тени. */
const KEY_U = { uKeyDir: G.uShadowDir, uShadow: { value: KEY_SHADOW.strength } };

const CASTER_VERT = /* glsl */ `
attribute float aJoint;
uniform vec3 uKeyDir;
uniform float uMaxY;
uniform float uMinZ;
#ifdef RIGGED
  uniform highp sampler2D uBones;
  attribute vec4 iFx;
  mat4 boneMat(int j) {
    int row = gl_InstanceID;
    return mat4(
      texelFetch(uBones, ivec2(j * 4, row), 0),
      texelFetch(uBones, ivec2(j * 4 + 1, row), 0),
      texelFetch(uBones, ivec2(j * 4 + 2, row), 0),
      texelFetch(uBones, ivec2(j * 4 + 3, row), 0));
  }
#endif
varying float vFade;
varying float vClip;
void main() {
#ifdef RIGGED
  mat4 M = boneMat(int(aJoint + 0.5));
  // растворение тела (смерть, «Тень»-копия) растворяет и его тень
  vFade = 1.0 - clamp(iFx.y, 0.0, 1.0);
#else
  mat4 M = modelMatrix;
  #ifdef USE_INSTANCING
    M = modelMatrix * instanceMatrix;
  #endif
  vFade = 1.0;
#endif
  vec4 wp = M * vec4(position, 1.0);
  // ушедшее под пол и то, что выше свода, тень на пол арены не отбрасывает
  // и то, что стоит у фасада со стороны света: свет идёт сквозь его окна
  vClip = step(${KEY_SHADOW.clipY.toFixed(2)}, wp.y) * step(wp.y, uMaxY) * step(uMinZ, wp.z);
  float h = max(wp.y, 0.0);
  wp.xz -= uKeyDir.xz * (h / max(uKeyDir.y, ${KEY_SHADOW.minY.toFixed(2)}));
  wp.y = 0.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CASTER_FRAG = /* glsl */ `
uniform float uShadow;
varying float vFade;
varying float vClip;
void main() {
  if (vClip < 0.5 || vFade <= 0.01) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - uShadow * vFade);
}
`;

/**
 * Материал заслонителя: цвет буфера не трогает, альфу — минимум (тень одна, сколько треугольников ни легло бы).
 * rigged — батч кукол (матрицы суставов в текстуре bones); иначе — обычный или инстансный меш; maxY — выше тень не
 * бросают (декор под сводом); minZ — ближе к фасаду тоже (свет идёт сквозь окна фасада).
 */
export function casterMaterial(rigged: boolean, bones: THREE.Texture | null = null, maxY = 1e4, minZ = -1e4): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    defines: rigged ? { RIGGED: '' } : {},
    uniforms: { ...KEY_U, uBones: { value: bones }, uMaxY: { value: maxY }, uMinZ: { value: minZ } },
    vertexShader: CASTER_VERT,
    fragmentShader: CASTER_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.MinEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  // у декора нет индекса сустава
  (m as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues.aJoint = [0];
  return m;
}

/** Порядок в сцене буфера: тени тел — первыми, затем запечённые тени и свет окон (им нужна видимость), затем пятна. */
export const CASTER_ORDER = 0;
export const KEYMAP_ORDER = 1;

function visibleInScene(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * Тень меша, который живёт вне сцены буфера (колонна-укрытие, ткань плаща): копия с материалом заслонителя на той же
 * геометрии; перед кадром буфера перенимает мировую матрицу и видимость оригинала.
 */
export class CasterCopy {
  readonly mesh: THREE.Mesh;
  constructor(readonly src: THREE.Mesh, maxY = 1e4, minZ = -1e4) {
    this.mesh = new THREE.Mesh(src.geometry, casterMaterial(false, null, maxY, minZ));
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = CASTER_ORDER;
  }

  sync(): void {
    const vis = visibleInScene(this.src);
    this.mesh.visible = vis;
    if (vis) { this.src.updateWorldMatrix(true, false); this.mesh.matrixWorld.copy(this.src.matrixWorld); }
  }

  dispose(): void { (this.mesh.material as THREE.Material).dispose(); this.mesh.removeFromParent(); }
}

/**
 * Заслонители тел для буфера света: батчи кукол (Пилот, враги, боссы — батчи врагов появляются по ходу боя) и копии
 * отдельных мешей (плащ, шарф, рушащиеся колонны). sync — перед кадром буфера: видимость берётся у оригиналов.
 */
export class KeyCasters {
  readonly group = new THREE.Group();
  private rigs: { batch: RigBatch; mesh: THREE.Mesh }[] = [];
  private known = new Set<RigBatch>();
  private copies: CasterCopy[] = [];

  addRig(batch: RigBatch): void {
    if (this.known.has(batch)) return;
    this.known.add(batch);
    const mesh = batch.casterMesh();
    this.rigs.push({ batch, mesh });
    this.group.add(mesh);
  }

  addMesh(src: THREE.Mesh): void {
    const c = new CasterCopy(src);
    this.copies.push(c);
    this.group.add(c.mesh);
  }

  /** Добавить новые батчи (лениво созданные риги врагов) и обновить видимость всех теней. */
  sync(batches?: Iterable<RigBatch>): void {
    if (batches) for (const b of batches) this.addRig(b);
    for (const r of this.rigs) r.mesh.visible = visibleInScene(r.batch.mesh);
    for (const c of this.copies) c.sync();
  }

  get count(): number { return this.rigs.length + this.copies.length; }

  dispose(): void {
    for (const r of this.rigs) { (r.mesh.material as THREE.Material).dispose(); r.mesh.removeFromParent(); }
    for (const c of this.copies) c.dispose();
    this.rigs.length = 0; this.copies.length = 0; this.known.clear();
    this.group.removeFromParent();
  }
}

/** Окно для света на полу: точка, куда луч приходит на пол (м), направление луча по полу, ширина луча у пола (м). */
export interface WindowLightDef { x: number; z: number; dx: number; dz: number; w: number }

/** Окна из лучей фасада (ArenaView.rays): пятно ложится туда, где луч касается пола, и вытянуто вдоль луча. */
export function windowsFromRays(rays: readonly { top: THREE.Vector3; bot: THREE.Vector3; w: number }[]): WindowLightDef[] {
  return rays.map((r) => {
    const dx = r.bot.x - r.top.x, dz = r.bot.z - r.top.z, l = Math.hypot(dx, dz) || 1;
    return { x: r.bot.x, z: r.bot.z, dx: dx / l, dz: dz / l, w: r.w * WINDOW_LIGHT.widen };
  });
}

const WINDOW_VERT = /* glsl */ `
attribute vec4 iA; // x, z, dx, dz
attribute vec2 iB; // ширина (м), сид
uniform float uLen;
varying vec2 vM;   // метры: x — поперёк от оси, y — вдоль от ближнего к фасаду края
varying vec2 vSize;
varying float vSeed;
void main() {
  float w = iB.x;
  vec2 d = iA.zw, p = vec2(-d.y, d.x);
  // квад: position.x ∈ [−1, 1] поперёк, position.y ∈ [0, 1] вдоль; пятно начинается чуть до точки касания
  vM = vec2(position.x * (w * 0.5 + 0.2), position.y * (uLen + 0.4) - 0.2);
  vSize = vec2(w, uLen);
  vSeed = iB.y;
  vec2 c = iA.xy - d * uLen * 0.35;
  vec2 xz = c + p * vM.x + d * vM.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, 0.0, xz.y, 1.0);
}
`;

const WINDOW_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uK;
varying vec2 vM;
varying vec2 vSize;
varying float vSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1)) + vSeed * 17.0) * 43758.5453); }
void main() {
  float hw = vSize.x * 0.5, len = vSize.y, x = vM.x, y = vM.y;
  float lead = ${WINDOW_LIGHT.lead.toFixed(3)}, soft = ${WINDOW_LIGHT.edge.toFixed(3)};
  // стрельчатое окно: прямые стороны и острая арка на дальнем конце (верх окна ложится дальше от фасада)
  float archH = min(len * 0.45, hw * 1.732), ys = len - archH;
  float side = hw - abs(x);
  float arch = y < ys ? 1e3 : min(vSize.x - length(vec2(x + hw, y - ys)), vSize.x - length(vec2(x - hw, y - ys)));
  float inside = min(min(side, arch), y);
  float a = smoothstep(-soft, soft, inside);
  if (a <= 0.001) discard;
  // переплёт: рама вдоль контура, средник, две поперечины, круг в арке
  float l = 1.0 - smoothstep(lead * 0.5, lead, abs(inside - lead * 1.2));
  l = max(l, 1.0 - smoothstep(lead * 0.4, lead * 0.9, abs(x)) * step(0.0, ys - y + archH * 0.35));
  float t1 = ys * 0.36, t2 = ys * 0.7;
  l = max(l, (1.0 - smoothstep(lead * 0.4, lead * 0.9, abs(y - t1))) * step(y, ys));
  l = max(l, (1.0 - smoothstep(lead * 0.4, lead * 0.9, abs(y - t2))) * step(y, ys));
  vec2 oc = vec2(0.0, ys + archH * 0.42);
  float ro = min(hw * 0.42, archH * 0.32);
  l = max(l, 1.0 - smoothstep(lead * 0.4, lead * 0.9, abs(length(vec2(x, y) - oc) - ro)));
  // стёкла: свой оттенок у каждой ячейки, к середине окна ярче
  vec2 cell = vec2(step(0.0, x), y < t1 ? 0.0 : y < t2 ? 1.0 : y < ys ? 2.0 : 3.0 + step(length(vec2(x, y) - oc), ro));
  float h = hash(cell);
  vec3 col = mix(uColA, uColB, step(1.0 - ${WINDOW_LIGHT.alt.toFixed(2)}, h) * ${WINDOW_LIGHT.altMix.toFixed(2)}) * (0.85 + 0.3 * fract(h * 7.31));
  // к середине окна ярче, к дальнему концу свет расходится и слабеет
  float mid = (1.0 - 0.35 * pow(abs(x) / max(hw, 0.01), 2.0)) * mix(1.0, ${WINDOW_LIGHT.fade.toFixed(2)}, clamp(y / len, 0.0, 1.0));
  gl_FragColor = vec4(col * uK * a * mid * (1.0 - l * ${WINDOW_LIGHT.leadDark.toFixed(2)}), 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uNoise;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec4 m = texture2D(uMap, vUv);
  // облака за окном: медленный шум по свету окон (тени архитектуры не дышат)
  float n = texture2D(uNoise, vUv * 2.3 + vec2(uTime * ${WINDOW_LIGHT.breatheSpeed.toFixed(3)}, uTime * ${(WINDOW_LIGHT.breatheSpeed * 0.6).toFixed(4)})).r;
  gl_FragColor = vec4(m.rgb * (1.0 - ${WINDOW_LIGHT.breathe.toFixed(2)} + ${(2 * WINDOW_LIGHT.breathe).toFixed(2)} * n), m.a);
}
`;

/**
 * Запечённая карта ключевого света (A2): тени архитектуры (альфа) и свет окон с переплётом (цвет), уже затенённый
 * архитектурой. Печётся один раз при включении буфера; каждый кадр полноэкранный квад кладёт её в буфер: свет окон
 * умножается на видимость от тел (тени тел режут свет окна), альфа — минимум с тенями тел.
 */
export class KeyLightMap {
  readonly rt: THREE.WebGLRenderTarget;
  readonly composite: THREE.Mesh;

  constructor(size: number) {
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.rt.texture }, uNoise: G.uNoise, uTime: G.uTime },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: COMPOSITE_FRAG,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.DstAlphaFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.MinEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.composite = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    this.composite.frustumCulled = false;
    this.composite.renderOrder = KEYMAP_ORDER;
  }

  /**
   * Запечь: statics — меши архитектуры (декор арены), windows — окна; цвета окна — основной и редких стёкол;
   * minZ — фасад со стороны света (дальний край арены) тень не бросает. camera — камера буфера света (тот же
   * прямоугольник на полу). После — размыть тени: полутень лунного света, без ступенек текселей.
   */
  bake(gl: THREE.WebGLRenderer, camera: THREE.Camera, statics: readonly THREE.Mesh[], windows: readonly WindowLightDef[], colA: [number, number, number], colB: [number, number, number], minZ = -1e4): void {
    const scene = new THREE.Scene(), temp: THREE.Material[] = [];
    for (const s of statics) {
      const c = new CasterCopy(s, KEY_SHADOW.maxY, minZ);
      c.mesh.visible = true;
      s.updateWorldMatrix(true, false);
      c.mesh.matrixWorld.copy(s.matrixWorld);
      scene.add(c.mesh);
      temp.push(c.mesh.material as THREE.Material);
    }
    let winGeo: THREE.InstancedBufferGeometry | null = null;
    if (windows.length) {
      winGeo = new THREE.InstancedBufferGeometry();
      winGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
      winGeo.setIndex([0, 1, 2, 0, 2, 3]);
      const a = new Float32Array(windows.length * 4), b = new Float32Array(windows.length * 2);
      windows.forEach((w, i) => { a.set([w.x, w.z, w.dx, w.dz], i * 4); b.set([w.w, i * 0.618 + 0.13], i * 2); });
      winGeo.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4));
      winGeo.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 2));
      winGeo.instanceCount = windows.length;
      const wm = new THREE.ShaderMaterial({
        uniforms: { uLen: { value: WINDOW_LIGHT.len }, uK: { value: WINDOW_LIGHT.k }, uColA: { value: new THREE.Vector3(...colA) }, uColB: { value: new THREE.Vector3(...colB) } },
        vertexShader: WINDOW_VERT, fragmentShader: WINDOW_FRAG,
        side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false,
        // свет окна × видимость от архитектуры (уже в альфе), альфа не меняется
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation, blendSrc: THREE.DstAlphaFactor, blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      });
      const mesh = new THREE.Mesh(winGeo, wm);
      mesh.frustumCulled = false;
      mesh.renderOrder = KEYMAP_ORDER;
      scene.add(mesh);
      temp.push(wm);
    }
    const prev = gl.getRenderTarget(), alpha = gl.getClearAlpha(), cc = gl.getClearColor(new THREE.Color());
    gl.setRenderTarget(this.rt);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, false, false);
    const auto = gl.autoClear;
    gl.autoClear = false;
    gl.render(scene, camera);
    this.blur(gl);
    gl.autoClear = auto;
    gl.setRenderTarget(prev);
    gl.setClearColor(cc, alpha);
    for (const m of temp) m.dispose();
    winGeo?.dispose();
  }

  /** Размыть альфу (тени) двумя проходами гауссом; свет окон остаётся резким — переплёт читается. */
  private blur(gl: THREE.WebGLRenderer): void {
    const size = this.rt.width, tmp = this.rt.clone();
    const m = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null as THREE.Texture | null }, uStep: { value: new THREE.Vector2() } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSrc; uniform vec2 uStep; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uSrc, vUv);
          float a = c.a * 0.227027;
          a += (texture2D(uSrc, vUv + uStep * 1.3846).a + texture2D(uSrc, vUv - uStep * 1.3846).a) * 0.316216;
          a += (texture2D(uSrc, vUv + uStep * 3.2308).a + texture2D(uSrc, vUv - uStep * 3.2308).a) * 0.070270;
          gl_FragColor = vec4(c.rgb, a);
        }`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m), scene = new THREE.Scene(), cam = new THREE.Camera();
    quad.frustumCulled = false;
    scene.add(quad);
    const px = KEY_SHADOW.blur / size;
    m.uniforms.uSrc.value = this.rt.texture; m.uniforms.uStep.value.set(px, 0);
    gl.setRenderTarget(tmp); gl.render(scene, cam);
    m.uniforms.uSrc.value = tmp.texture; m.uniforms.uStep.value.set(0, px);
    gl.setRenderTarget(this.rt); gl.render(scene, cam);
    tmp.dispose(); m.dispose(); quad.geometry.dispose();
  }

  dispose(): void {
    this.rt.dispose();
    this.composite.geometry.dispose();
    (this.composite.material as THREE.Material).dispose();
    this.composite.removeFromParent();
  }
}
