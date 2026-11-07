import * as THREE from 'three';
import { fxRng } from '../core/rng';
import { G } from '../render/materials';

/** Следов боя на полу одновременно (план §8.5) и сколько живёт один (с). */
export const SCARS_MAX = 24;
export const SCAR_LIFE = 60;
/** У босса арена помнит бой дольше — следы фазы I видны в фазе III (план §8.5). */
export const BOSS_SCAR_LIFE = 150;

/**
 * Вид следа: crater — кратер с паутиной трещин от удара в пол; fissure — разлом, бегущий вдоль удара от точки
 * удара (волна полного заряда, Нисходящий разлом, Звездопад).
 */
export type ScarKind = 'crater' | 'fissure';

/**
 * Жар трещины Пилота (с): сколько трещина светится фиолетовым после удара (столько же живёт разлом, вдоль
 * которого скользит рывок) и как быстро остывает добела раскалённый край.
 */
export const SCAR_HEAT = { dur: 3.0, flash: 0.22 };
/**
 * Сила жара (ревью: «трещины светятся слишком сильно», затем «всё ещё ярко»): тление внутри трещины, вспышка удара,
 * ореол на полу рядом и белое ядро. Тление тусклое — его хватает, чтобы видеть разлом для скольжения рывком.
 */
export const SCAR_GLOW = { ember: 0.15, flash: 0.32, halo: 0.035, haloFlash: 0.1, core: 0.28, centre: 0.14 };

export interface ScarOpts {
  /** Жар Пилота 0…1: фиолетовое свечение в трещинах, остывает за SCAR_HEAT.dur. Удары врагов — без жара. */
  heat?: number;
  /** Скорость, с которой трещина бежит от точки удара (м/с); 0 — появляется сразу. */
  speed?: number;
}

/**
 * Следы боя (план §8.5): трещины и выбоины в местах тяжёлых ударов — к концу боя арена выглядит иначе.
 *
 * Два слоя на одном буфере экземпляров. Рельеф (модуляция ×2 — умножает освещённый пол, сам не светит): тёмные трещины с подсвеченной ключевым светом
 * кромкой и тенью с другой стороны, выбоина в центре, сдвинутые плиты-осколки, каменная пыль, которая оседает.
 * Жар (сложение): у ударов Пилота трещины сперва раскалены добела и бегут от точки удара, потом остывают в
 * фиолетовый и гаснут. Узор — от сида: кратер — сеть Вороного в лог-полярных координатах (лучи и кольца, как
 * у настоящего удара в камень), разлом — ломаная главная трещина с ветвями.
 * Не больше 24 следов, гаснут к концу жизни; красного нет — красный на полу только у врага.
 */
export class FloorScars {
  readonly mesh = new THREE.Group();
  private readonly relief: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly a: THREE.InstancedBufferAttribute; // x, z, половина длины, поворот
  private readonly b: THREE.InstancedBufferAttribute; // рождение, сид, сила, вид
  private readonly c: THREE.InstancedBufferAttribute; // половина ширины, жар, скорость, заход за точку удара
  private readonly geometry: THREE.InstancedBufferGeometry;
  private head = 0;
  private n = 0;
  /** Где лежат следы (для снятия над провалом). */
  readonly spots: { x: number; z: number; alive: boolean }[] = [];

  constructor(readonly life = SCAR_LIFE) {
    const K = SCAR_GLOW;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(SCARS_MAX * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(SCARS_MAX * 4).fill(-1e9), 4);
    this.c = new THREE.InstancedBufferAttribute(new Float32Array(SCARS_MAX * 4), 4);
    for (const attr of [this.a, this.b, this.c]) attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.a); g.setAttribute('iB', this.b); g.setAttribute('iC', this.c);
    g.instanceCount = 0;
    this.geometry = g;
    const uniforms = { uTime: G.uTime, uLife: { value: life }, uKeyDir: G.uShadowDir, uHeatDur: { value: SCAR_HEAT.dur }, uFlash: { value: SCAR_HEAT.flash },
      uGlow: { value: new THREE.Vector3(K.ember, K.flash, K.core) }, uHalo: { value: new THREE.Vector3(K.halo, K.haloFlash, K.centre) } };
    // Модуляция ×2: результат = 2 · цвет следа · цвет пола. Рельеф зависит от света вокруг, сам не светится.
    const relief = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: COMMON + RELIEF,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const glow = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: COMMON + GLOW,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.relief = new THREE.Mesh(g, relief); this.relief.name = 'floor-scars';
    this.glow = new THREE.Mesh(g, glow); this.glow.name = 'floor-scars-heat';
    for (const [m, order] of [[this.relief, 3], [this.glow, 4]] as const) { m.frustumCulled = false; m.renderOrder = order; this.mesh.add(m); }
    for (let i = 0; i < SCARS_MAX; i++) this.spots.push({ x: 0, z: 0, alive: false });
  }

  /** Кратер: size — радиус (м), strength 0…1 — насыщенность. Старейший след вытесняется. */
  add(x: number, z: number, size: number, strength = 1, opts: ScarOpts = {}): void {
    this.put(x, z, size, size, fxRng.next() * 6.28, strength, 0, opts);
  }

  /**
   * Разлом от точки удара (x, z) вдоль (dx, dz) длиной len (м), шириной width (м). Бежит от точки удара со
   * скоростью opts.speed — вместе с волной клинка.
   */
  addFissure(x: number, z: number, dx: number, dz: number, len: number, width: number, strength = 1, opts: ScarOpts = {}): void {
    const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    // Квад заходит за точку удара на back: кратер в начале разлома не обрезан. Ось x квада — вдоль разлома.
    const back = width * 0.6, half = (len + back) / 2, mid = (len - back) / 2;
    this.put(x + ux * mid, z + uz * mid, half, width / 2, Math.atan2(uz, ux), strength, 1, opts, back);
  }

  private put(x: number, z: number, sx: number, sz: number, rot: number, strength: number, kind: 0 | 1, opts: ScarOpts, back = 0): void {
    const i = this.head;
    this.head = (this.head + 1) % SCARS_MAX;
    this.n = Math.min(SCARS_MAX, this.n + 1);
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array, C = this.c.array as Float32Array;
    A[i * 4] = x; A[i * 4 + 1] = z; A[i * 4 + 2] = sx; A[i * 4 + 3] = rot;
    B[i * 4] = G.uTime.value as number; B[i * 4 + 1] = fxRng.next() * 7; B[i * 4 + 2] = Math.min(1, strength); B[i * 4 + 3] = kind;
    C[i * 4] = sz; C[i * 4 + 1] = Math.max(0, Math.min(1, opts.heat ?? 0)); C[i * 4 + 2] = opts.speed ?? 0; C[i * 4 + 3] = back;
    this.spots[i].x = x; this.spots[i].z = z; this.spots[i].alive = true;
    this.geometry.instanceCount = this.n;
    this.a.needsUpdate = true; this.b.needsUpdate = true; this.c.needsUpdate = true;
  }

  /** Снять след (пол под ним обрушился). */
  remove(i: number): void {
    const B = this.b.array as Float32Array;
    B[i * 4 + 2] = 0;
    this.spots[i].alive = false;
    this.b.needsUpdate = true;
  }

  get count(): number { return this.n; }

  dispose(): void { this.geometry.dispose(); (this.relief.material as THREE.Material).dispose(); (this.glow.material as THREE.Material).dispose(); }
}

const VERT = /* glsl */ `
  attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; uniform float uTime, uLife;
  varying vec2 vP, vM;
  // Постоянные для следа: flat — без интерполяции; иначе сид чуть «плывёт» по пикселям и хеш даёт зерно.
  flat varying float vSeed, vK, vAge, vKind, vHeat, vSpeed, vBack; flat varying vec2 vSize, vRot;
  void main() {
    float c = cos(iA.w), s = sin(iA.w);
    vec2 size = vec2(iA.z, iC.x);
    vec2 local = position.xz * size;
    vec2 p = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
    vP = position.xz; vM = local; vSize = size; vRot = vec2(c, s);
    vSeed = iB.y; vKind = iB.w; vHeat = iC.y; vSpeed = iC.z; vBack = iC.w;
    vAge = uTime - iB.x;
    // появляется сразу, держится, гаснет к концу жизни
    vK = iB.z * (1.0 - smoothstep(uLife * 0.6, uLife, vAge)) * step(0.0, vAge);
    gl_Position = projectionMatrix * viewMatrix * vec4(iA.x + p.x, 0.014, iA.y + p.y, 1.0);
  }
`;

/**
 * Общая часть. Трещины — поле расстояний в метрах (sd < 0 — внутри трещины): ширина и сглаживание заданы в метрах
 * и пикселях, поэтому трещина остаётся чёткой линией на любом удалении камеры, без зерна. Кратер — сеть
 * Вороного в лог-полярных координатах (лучи и дуги колец, как у удара в камень) и пять главных лучей; разлом —
 * ломаная главная трещина с ветвями у неё. from — расстояние от точки удара (м): трещина бежит от неё.
 */
const COMMON = /* glsl */ `
  uniform float uTime, uLife, uHeatDur, uFlash; uniform vec3 uKeyDir, uGlow, uHalo;
  varying vec2 vP, vM;
  // Постоянные для следа: flat — без интерполяции; иначе сид чуть «плывёт» по пикселям и хеш даёт зерно.
  flat varying float vSeed, vK, vAge, vKind, vHeat, vSpeed, vBack; flat varying vec2 vSize, vRot;
  const float TAU = 6.2831853;
  float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 h2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(vec2(i, vSeed)), h1(vec2(i + 1.0, vSeed)), f); }
  // ломаная: линейно между узлами — изломы, как у трещины в камне, а не плавная волна
  float nl(float x) { float i = floor(x), f = fract(x); return mix(h1(vec2(i, vSeed)), h1(vec2(i + 1.0, vSeed)), f); }
  // Вороной: x — край ячейки (F2 − F1), y — номер ячейки (хеш). wrap > 0 — ячейки по кругу (wrap штук).
  vec2 voro(vec2 x, float wrap) {
    vec2 i = floor(x), f = fract(x);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int b = -1; b <= 1; b++) for (int a = -1; a <= 1; a++) {
      vec2 g = vec2(float(a), float(b)), c = i + g;
      if (wrap > 0.0) c.y = mod(c.y, wrap);
      vec2 o = 0.15 + 0.7 * h2(c + vSeed * 1.37);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = h1(c + vSeed); } else if (d < d2) d2 = d;
    }
    return vec2(d2 - d1, id);
  }
  // Направление на ключевой свет в осях следа.
  vec2 keyLocal() { vec2 k = normalize(uKeyDir.xz + vec2(1e-4)); return vec2(vRot.x * k.x + vRot.y * k.y, -vRot.y * k.x + vRot.x * k.y); }
  // Точка удара в осях следа: центр кратера или начало разлома.
  vec2 impactLocal(vec2 m) { return vKind < 0.5 ? m : vec2(m.x + vSize.x - vBack, m.y); }
  float impactR() { return vKind < 0.5 ? vSize.x : vSize.y * 0.95; }

  // Кратер радиуса R (м): расстояние до ближайшей трещины (м), id — номер плиты-осколка.
  float craterSd(vec2 m, float R, out float id) {
    float rm = length(m), r = rm / R, a = atan(m.y, m.x);
    vec2 v = voro(vec2(log(max(r, 0.05)) * 1.15, a / TAU * 9.0), 9.0);
    id = v.y;
    float reach = 0.45 + 0.5 * n1(a / TAU * 6.0 + vSeed);
    // край ячейки в метрах: масштаб лог-полярной сетки растёт с радиусом
    float web = v.x * 0.62 * max(rm, 0.25 * R) - (0.018 + 0.03 * (1.0 - r));
    web += smoothstep(reach * 0.8, reach, r) + step(r, 0.14);
    float rays = 1e3;
    for (int k = 0; k < 5; k++) {
      float fk = float(k), ang = fk * 1.2566 + (h1(vec2(fk, vSeed)) - 0.5) * 1.0;
      float wob = (n1(r * 5.0 + fk * 3.1) - 0.5) * 0.45;
      float da = a - ang - wob * r;
      float len = 0.78 + 0.22 * h1(vec2(fk * 3.3, vSeed));
      float d = abs(sin(da)) * rm + step(cos(da), 0.0) * 1e3;
      rays = min(rays, d - (0.06 * (1.0 - r) + 0.014) + smoothstep(len * 0.82, len, r) + step(r, 0.12));
    }
    return min(web, rays);
  }

  // Разлом вдоль x от точки удара: расстояние до трещины (м), id — номер куска, along — доля длины 0…1.
  float fissureSd(vec2 m, out float id, out float along, out float mainSd, out float across) {
    float L = vSize.x, W = vSize.y, len = 2.0 * L - vBack;
    float s = m.x + L - vBack;
    along = clamp(s / len, 0.0, 1.0);
    float centre = (n1(s * 0.45) - 0.5) * W * 0.5 + (nl(s * 2.6 + 5.0) - 0.5) * W * 0.16 + (nl(s * 7.0 + 2.0) - 0.5) * 0.035;
    across = m.y - centre;
    float d = abs(across);
    // ширина рвётся: то волосок, то раскрытая щель; к концу трещина сужается
    float open = nl(s * 3.1 + 9.0);
    mainSd = d - ((0.022 + 0.055 * open * open) * (W / 0.75) * (1.0 - 0.55 * along) + 0.008);
    vec2 v = voro(vec2(s * 0.75, (m.y - centre) * 1.5), 0.0);
    id = v.y;
    float band = W * (0.6 - 0.3 * along) * (0.7 + 0.6 * n1(s * 0.8 + 3.0));
    float branchSd = v.x * 0.75 - (0.012 + 0.016 * (1.0 - along)) + smoothstep(band * 0.5, band, d);
    // кончик ломается неровно; за точкой удара трещин нет
    float cut = smoothstep(0.88 - 0.08 * n1(vSeed), 1.0, along) * 0.5 + step(s, 0.0) * 1e3;
    mainSd += cut;
    return min(mainSd, branchSd + cut);
  }

  // mainSd, across — главная трещина разлома и сторона от неё (у кратера главной трещины нет: mainSd велико).
  float scarSd(vec2 m, out float id, out float from, out float mainSd, out float across) {
    mainSd = 1e3; across = 0.0;
    if (vKind < 0.5) { from = length(m); return craterSd(m, vSize.x, id); }
    float along; float sd = fissureSd(m, id, along, mainSd, across); from = max(0.0, m.x + vSize.x - vBack);
    // в точке удара разлома — свой маленький кратер
    float cid; vec2 cm = impactLocal(m);
    return min(sd, craterSd(cm, impactR(), cid) + smoothstep(impactR() * 0.7, impactR(), length(cm)));
  }

  // Сглаживание края в метрах: полпикселя, но не больше 3 см — на разрывах поля (край сети, конец луча)
  // производная взлетает, и без предела там проступает зерно.
  float pixelAA(float sd) { return clamp(fwidth(sd) * 0.8, 1e-4, 0.03); }
  // Трещина бежит от точки удара: здесь она уже открылась (0…1).
  float opened(float from) { return vSpeed <= 0.0 ? 1.0 : smoothstep(from - 0.5, from, vAge * vSpeed); }
`;

const RELIEF = /* glsl */ `
  void main() {
    if (vK < 0.01) discard;
    vec2 cm = impactLocal(vM);
    float R = impactR(), r = length(cm) / R;
    if (vKind < 0.5 && r > 1.0) discard;
    float id, from, mainSd, across;
    float sd = scarSd(vM, id, from, mainSd, across);
    float open = opened(from);
    float aa = pixelAA(sd);
    float crack = (1.0 - smoothstep(-aa, aa, sd)) * open;
    // Кромка главной трещины: стенка, обращённая к свету, — светлый скол, другая — в тени. Сторона известна
    // точно (смещение поперёк трещины), поэтому полосы ровные, без зерна. Ветви — узкий бледный скол.
    float lipBand = (1.0 - smoothstep(0.0, 0.05, mainSd)) * step(-aa, mainSd) * open * smoothstep(0.3, 0.6, nl((vM.x + vSize.x) * 5.0 + 11.0));
    float side = -sign(across) * keyLocal().y;
    float lit = lipBand * clamp(side * 1.6, 0.0, 1.0), shade = lipBand * clamp(-side * 1.6, 0.0, 1.0);
    float chipped = (1.0 - smoothstep(0.0, 0.035, sd)) * step(aa, sd) * open * (1.0 - lipBand);
    // выбоина: тёмная чаша с неровным краем, край со стороны света освещён
    float a = atan(cm.y, cm.x);
    float pitR = 0.17 + 0.05 * n1(a / TAU * 7.0 + vSeed);
    float pit = (1.0 - smoothstep(pitR * 0.6, pitR, r)) * open;
    float rim = smoothstep(pitR * 1.45, pitR, r) * (1.0 - pit) * max(0.0, -dot(normalize(cm + 1e-4), keyLocal())) * open;
    // плиты-осколки вокруг удара: соседние куски чуть светлее и темнее — пол сдвинут
    float slab = (id - 0.5) * (1.0 - smoothstep(0.3, 0.7, r)) * step(pitR, r) * open;
    // каменная пыль крупными лучами; со временем оседает, но не пропадает
    float dust = n1(a / TAU * 14.0 + vSeed * 3.0) * (1.0 - smoothstep(0.35, 1.0, r)) * smoothstep(pitR, pitR * 2.0, r)
      * mix(1.0, 0.35, smoothstep(0.0, 10.0, vAge)) * open;
    float edgeFade = vKind < 0.5 ? smoothstep(1.0, 0.92, r) : smoothstep(1.0, 0.8, abs(vP.y)) * smoothstep(1.0, 0.96, abs(vP.x));
    // Рельеф не светит сам: он умножает уже освещённый пол (смешивание «модуляция ×2», 0.5 — без изменений).
    // m — во сколько раз стала ярче или темнее точка пола: в тёмном углу трещина почти не видна, под свечой и
    // в золотом куполе — светлые сколы и глубокая тень.
    float m = 1.0;
    m *= mix(1.0, 1.12, dust * 0.5);
    m *= mix(1.0, slab > 0.0 ? 1.18 : 0.72, min(1.0, abs(slab) * 2.5));
    m *= mix(1.0, 1.45, rim * 0.8);
    m *= mix(1.0, 1.3, chipped * 0.6);
    m *= mix(1.0, 1.6, lit * 0.8);
    m *= mix(1.0, 0.35, shade * 0.85);
    m *= mix(1.0, 0.12, pit * 0.85);
    m *= mix(1.0, 0.06, crack * 0.92);
    m = mix(1.0, m, vK * edgeFade);
    if (abs(m - 1.0) < 0.004) discard;
    gl_FragColor = vec4(vec3(0.5 * m), 1.0);
  }
`;

const GLOW = /* glsl */ `
  void main() {
    if (vK < 0.01 || vHeat < 0.01 || vAge > uHeatDur + 1.0) discard;
    vec2 cm = impactLocal(vM);
    if (vKind < 0.5 && length(cm) > vSize.x) discard;
    float id, from, mainSd, across;
    float sd = scarSd(vM, id, from, mainSd, across);
    // время с момента, когда трещина здесь открылась
    float t = vSpeed > 0.0 ? vAge - from / vSpeed : vAge;
    if (t < 0.0) discard;
    float aa = pixelAA(sd);
    float inside = 1.0 - smoothstep(-aa, aa, sd);
    // свечение чуть шире трещины: раскалённый край светит на пол рядом
    float halo = 1.0 - smoothstep(0.0, 0.08, max(sd, 0.0));
    float core = 1.0 - smoothstep(-aa, aa, sd + 0.012);
    float white = exp(-t / uFlash);
    float ember = 1.0 - smoothstep(uHeatDur * 0.5, uHeatDur, t);
    float pulse = 0.85 + 0.15 * sin(uTime * 6.0 - from * 2.0);
    vec3 violet = vec3(0.46, 0.24, 0.98), hot = vec3(1.0, 0.93, 1.0);
    vec3 col = violet * (inside * (uGlow.x * ember * pulse + uGlow.y * white) + halo * (uHalo.x * ember + uHalo.y * white)) + hot * core * white * uGlow.z;
    // вспышка над раскалённым центром удара в первые доли секунды
    col += violet * (1.0 - smoothstep(0.0, 0.4, length(cm) / impactR())) * white * uHalo.z;
    col *= vHeat * vK;
    if (max(col.r, max(col.g, col.b)) < 0.003) discard;
    gl_FragColor = vec4(col, 1.0);
  }
`;
