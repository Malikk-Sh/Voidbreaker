import * as THREE from 'three';
import { LINE_BACK, type HitShape } from '../data/weapons';
import { G } from '../render/materials';
import { FX } from '../render/fx';

/**
 * Форма следа удара (разбор: «у каждого действия своя форма эффекта»). Каждая повторяет зону поражения
 * своего удара — игрок видит и приём, и его досягаемость:
 * arc — плоский полумесяц по взмаху; ring — кольцо вращения; vert — дуга в вертикальной плоскости
 * (рубящий сверху, апперкот); streak — прямой штрих укола/выпада; cross — два косых штриха крест-накрест.
 */
export type SlashShape = 'arc' | 'ring' | 'vert' | 'streak' | 'cross';

export interface SlashSpec {
  shape: SlashShape;
  /** Радиус дуги/кольца или длина штриха (м). */
  reach: number;
  /** Раствор дуги (рад). */
  angle?: number;
  /** Направление взмаха: 1 — слева направо, −1 — справа налево; для vert: 1 — снизу вверх, −1 — сверху вниз. */
  dir?: number;
  /** Высота над полом (м). */
  y?: number;
  /** Наклон плоскости дуги (рад), крен креста. */
  tilt?: number;
  /** Ширина штриха (м). */
  width?: number;
  /** Задержка появления (с) — к кадру удара. */
  delay?: number;
  /** Финишер: ярче и дольше. */
  heavy?: boolean;
  /** Смещение вбок от линии взгляда (м) — уколы шквала. */
  side?: number;
}

/**
 * Время взмаха и жизни следа (с), яркость (× цвета Пустоты); внутренний радиус дуги (доля) — у вертикальных
 * тоньше и тусклее: сверху они видны раскрытым веером, и тяжёлый веер после блума читался белым шаром (ревью).
 */
export const SLASH = { sweep: 0.09, life: 0.26, heavyLife: 0.38, bright: 2.2, heavyBright: 3.0, inner: 0.55, vertInner: 0.8, vertBright: 0.75 };

/**
 * Яркость следа по слоям (план ×100, D1–D2; флаг exposure): фиолетовое тело 0.6–1.0, горячее ядро ≤ 2 HDR —
 * тонкая кромка и фронт взмаха, меньше десятой части площади. Было: весь след ×2.2–3.0 бело-фиолетовым, и после
 * блума контакт выгорал в белый диск.
 */
export const SLASH_HDR = { body: 0.85, heavyBody: 1.0, core: 1.5, heavyCore: 1.9 };

const WHITE_VIOLET = new THREE.Color(0.85, 0.62, 1.6);
/** Тело следа — фиолет Пилота (#9b6cff), ядро — горячий бело-сиреневый. */
const VOID_BODY = new THREE.Color(0.33, 0.15, 1.0);
const VOID_HOT = new THREE.Color(1.0, 0.86, 1.25);

/**
 * Какой след у приёма: по id удара и его хитбоксу. Неизвестный удар — по форме хитбокса.
 * second — второй взмах того же удара (событие клипа: укол шквала, второй разрез креста).
 */
export function slashFor(move: string, hit: HitShape | undefined, second = false): SlashSpec[] {
  const r = hit && hit.shape !== 'line' ? hit.radius : 2.2;
  const arcA = hit && hit.shape === 'arc' ? (hit.angle * Math.PI) / 180 : (2 * Math.PI) / 3;
  const len = hit && hit.shape === 'line' ? hit.length : 2.6;
  switch (move) {
    case 'slash1': return [{ shape: 'arc', reach: r, angle: arcA, dir: -1, y: 1.15, tilt: 0.12 }];
    case 'slash2': return [{ shape: 'arc', reach: r, angle: arcA, dir: 1, y: 1.0, tilt: -0.12 }];
    case 'spin': return [{ shape: 'ring', reach: r, y: 0.95 }];
    // разворот-разрез 270° слева направо (этап 4.5, B2): дуга с центром на цели, второй слой — у пола
    case 'counter': return [{ shape: 'arc', reach: r, angle: arcA, dir: 1, y: 1.0, heavy: true }, { shape: 'arc', reach: r * 0.6, angle: arcA, dir: 1, y: 0.08, heavy: true, delay: 0.04 }];
    case 'rift': case 'skyfall': return [{ shape: 'vert', reach: 1.8, angle: 2.4, dir: -1, y: 0.25, heavy: true }];
    case 'charged': return [{ shape: 'vert', reach: 1.9, angle: 2.4, dir: -1, y: 0.2, heavy: true }, { shape: 'streak', reach: len, width: 0.55, y: 0.06, heavy: true, delay: 0.05 }];
    case 'rising': return [{ shape: 'vert', reach: 1.8, angle: 2.2, dir: 1, y: 0.3 }];
    case 'skycut': return [{ shape: 'arc', reach: r, angle: arcA, dir: 1, y: 1.2, tilt: 0.5 }];
    case 'cross': return [{ shape: 'cross', reach: 2.4, tilt: second ? -0.75 : 0.75, y: 1.15, heavy: second }];
    case 'flurry': return [{ shape: 'streak', reach: len, width: 0.14, y: 1.15, side: second ? 0.25 : -0.25 }];
    case 'lunge': return [{ shape: 'streak', reach: len, width: 0.3, y: 1.1, heavy: true }];
    default:
      if (!hit) return [];
      if (hit.shape === 'circle') return [{ shape: 'ring', reach: r, y: 1.0 }];
      if (hit.shape === 'line') return [{ shape: 'streak', reach: len, width: Math.min(0.5, hit.width * 0.3), y: 1.1 }];
      return [{ shape: 'arc', reach: r, angle: arcA, dir: 1, y: 1.1 }];
  }
}

/** Поворот плоскости вертикальных дуг вокруг линии взгляда (рад): видна из боевой камеры. */
export const VERT_ROLL = 0.85;

const _F = new THREE.Vector3(), _U = new THREE.Vector3(), _R = new THREE.Vector3(), _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3();
const _M = new THREE.Matrix4();

/** Сектор (ось дуги — локальная +Z, плоскость — XZ) → плоскость «вперёд + вверх», повёрнутая на roll вокруг взгляда. */
function basisArc(m: THREE.Mesh, facing: number, roll: number): void {
  _F.set(Math.sin(facing), 0, Math.cos(facing));
  _R.set(Math.cos(facing), 0, -Math.sin(facing));
  _U.set(0, 1, 0).multiplyScalar(Math.cos(roll)).addScaledVector(_R, Math.sin(roll));
  _Z.copy(_F).addScaledVector(_U, 0.35).normalize();
  _X.copy(_U).addScaledVector(_Z, -_U.dot(_Z)).normalize();
  _Y.crossVectors(_Z, _X);
  m.quaternion.setFromRotationMatrix(_M.makeBasis(_X, _Y, _Z));
}

/** Полоса (длина — локальная +Z) → диагональ в вертикальной плоскости перед героем, на dist м впереди. */
function basisCross(m: THREE.Mesh, facing: number, tilt: number, len: number, dist: number): void {
  _F.set(Math.sin(facing), 0, Math.cos(facing));
  _R.set(Math.cos(facing), 0, -Math.sin(facing));
  _Z.copy(_R).multiplyScalar(Math.cos(tilt)).addScaledVector(_U.set(0, 1, 0), Math.sin(tilt));
  _Y.copy(_F);
  _X.crossVectors(_Y, _Z);
  m.quaternion.setFromRotationMatrix(_M.makeBasis(_X, _Y, _Z));
  m.position.x += _F.x * dist - _Z.x * len * 0.5;
  m.position.y -= _Z.y * len * 0.5;
  m.position.z += _F.z * dist - _Z.z * len * 0.5;
}

interface Live { mesh: THREE.Mesh; u: { uBorn: { value: number }; uLife: { value: number }; uDir: { value: number }; uBright: { value: number }; uCore: { value: number } }; busy: boolean }

/** Откуда идёт след: Пилот (живой объект — пока открыт хитбокс, след едет за ним). */
export interface SlashSource { x: number; y: number; z: number; facing: number }

/** След, который ещё едет за Пилотом: где он был в кадре удара, до какого времени, длина штриха. */
interface Follow { l: Live; born: number; src: SlashSource; until: number; x: number; y: number; z: number; streak: number }

/** Сектор кольца в плоскости XZ (вперёд — +Z), uv.x — доля угла, uv.y — от внутреннего края к внешнему. */
function sector(angle: number, r0: number, r1: number, seg: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, a = -angle / 2 + angle * u;
    for (const [r, v] of [[r0, 0], [r1, 1]] as const) { pos.push(Math.sin(a) * r, 0, Math.cos(a) * r); uv.push(u, v); }
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Штрих: полоса от 0 до 1 по +Z, ширина 1 по X. */
function strip(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// раскрытие по взмаху (u < прогресса), яркая голова у фронта, тонкая кромка снаружи, затухание
const FRAG = /* glsl */ `
  uniform float uTime, uBorn, uLife, uDir, uBright, uSweep; uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float age = uTime - uBorn;
    if (age < 0.0 || age > uLife) discard;
    float u = uDir > 0.0 ? vUv.x : 1.0 - vUv.x;
    float p = clamp(age / uSweep, 0.0, 1.0) * 1.12;
    if (u > p) discard;
    float head = smoothstep(p - 0.25, p, u);
    float edge = pow(vUv.y, 1.8);
    float fade = 1.0 - smoothstep(uSweep, uLife, age);
    float tip = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.86, u);
    float a = edge * tip * fade * (0.45 + 0.9 * head);
    gl_FragColor = vec4(uColor * uBright * a, 1.0);
  }
`;
// штрих: светлая ось, к краям гаснет; раскрывается от начала к концу
const FRAG_STRIP = /* glsl */ `
  uniform float uTime, uBorn, uLife, uDir, uBright, uSweep; uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float age = uTime - uBorn;
    if (age < 0.0 || age > uLife) discard;
    float p = clamp(age / uSweep, 0.0, 1.0) * 1.1;
    if (vUv.x > p) discard;
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float core = pow(across, 3.0);
    float fade = 1.0 - smoothstep(uSweep, uLife, age);
    float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    gl_FragColor = vec4(uColor * uBright * core * ends * fade * (0.6 + 0.8 * smoothstep(p - 0.3, p, vUv.x)), 1.0);
  }
`;
// план ×100 (D2): три слоя — тонкое горячее ядро у внешней кромки и фронта, фиолетовое тело, рваный хвост:
// шум съедает след тем сильнее, чем дальше от фронта и чем старше след
const FRAG_LAYERED = /* glsl */ `
  uniform float uTime, uBorn, uLife, uDir, uBright, uSweep, uCore; uniform vec3 uColor, uHot; uniform sampler2D uNoise;
  varying vec2 vUv;
  void main() {
    float age = uTime - uBorn;
    if (age < 0.0 || age > uLife) discard;
    float u = uDir > 0.0 ? vUv.x : 1.0 - vUv.x;
    float p = clamp(age / uSweep, 0.0, 1.0) * 1.12;
    if (u > p) discard;
    float head = smoothstep(p - 0.25, p, u);
    float fade = 1.0 - smoothstep(uSweep, uLife, age);
    float tip = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.86, u);
    float n = texture2D(uNoise, vec2(u * 2.3 + uBorn * 3.7, vUv.y * 0.9 + uBorn)).r;
    float rag = smoothstep(0.0, 0.2, n + 0.25 - (1.0 - head) * 0.5 - (1.0 - fade) * 0.3);
    float body = pow(vUv.y, 1.6) * (0.5 + 0.5 * head);
    float core = smoothstep(0.88, 0.98, vUv.y) * (0.2 + 0.8 * head);
    gl_FragColor = vec4((uColor * body * uBright + uHot * core * uCore) * tip * fade * rag, 1.0);
  }
`;
const FRAG_STRIP_LAYERED = /* glsl */ `
  uniform float uTime, uBorn, uLife, uDir, uBright, uSweep, uCore; uniform vec3 uColor, uHot; uniform sampler2D uNoise;
  varying vec2 vUv;
  void main() {
    float age = uTime - uBorn;
    if (age < 0.0 || age > uLife) discard;
    float p = clamp(age / uSweep, 0.0, 1.0) * 1.1;
    if (vUv.x > p) discard;
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float head = smoothstep(p - 0.3, p, vUv.x);
    float fade = 1.0 - smoothstep(uSweep, uLife, age);
    float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    float n = texture2D(uNoise, vec2(vUv.x * 3.1 + uBorn * 2.9, vUv.y * 0.6 + uBorn)).r;
    float rag = smoothstep(0.0, 0.2, n + 0.25 - (1.0 - head) * 0.45 - (1.0 - fade) * 0.3);
    float body = pow(across, 2.0) * (0.55 + 0.45 * head);
    float core = pow(across, 14.0) * (0.25 + 0.75 * head);
    gl_FragColor = vec4((uColor * body * uBright + uHot * core * uCore) * ends * fade * rag, 1.0);
  }
`;

/**
 * Следы ударов: пул сеток по формам, аддитивно, по времени мира (замедление и стоп-кадр их тоже держат).
 * Геометрия дуг кешируется по раствору.
 */
export class SlashFx {
  readonly group = new THREE.Group();
  private readonly pool: { arc: Live[]; strip: Live[] } = { arc: [], strip: [] };
  private readonly arcs = new Map<string, THREE.BufferGeometry>();
  private readonly stripGeo = strip();
  private readonly pending: { spec: SlashSpec; src: SlashSource; end: number; at: number }[] = [];
  private readonly follows: Follow[] = [];
  private lastLive!: Live;

  constructor() {
    for (let i = 0; i < 10; i++) this.pool.arc.push(this.make(false));
    for (let i = 0; i < 10; i++) this.pool.strip.push(this.make(true));
  }

  private make(isStrip: boolean): Live {
    const layered = FX.exposure;
    const u = {
      uTime: G.uTime, uBorn: { value: -99 }, uLife: { value: SLASH.life }, uDir: { value: 1 }, uBright: { value: SLASH.bright }, uSweep: { value: SLASH.sweep },
      uColor: { value: layered ? VOID_BODY : WHITE_VIOLET }, uCore: { value: SLASH_HDR.core }, uHot: { value: VOID_HOT }, uNoise: G.uNoise,
    };
    const m = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VERT, fragmentShader: layered ? (isStrip ? FRAG_STRIP_LAYERED : FRAG_LAYERED) : (isStrip ? FRAG_STRIP : FRAG),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(isStrip ? this.stripGeo : this.arcGeo(Math.PI * 2 / 3), m);
    mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 22;
    this.group.add(mesh);
    return { mesh, u, busy: false };
  }

  private arcGeo(angle: number, inner = SLASH.inner): THREE.BufferGeometry {
    const key = `${angle.toFixed(2)}:${inner.toFixed(2)}`;
    let g = this.arcs.get(key);
    if (!g) { g = sector(angle, inner, 1, Math.max(12, Math.round(angle * 9))); this.arcs.set(key, g); }
    return g;
  }

  /**
   * Следы приёма от Пилота (src: позиция, высота — в воздухе выше, взгляд), в кадр удара; now — время мира.
   * follow — сколько секунд хитбокс ещё открыт: столько след едет за Пилотом (штрих выпада тянется от точки
   * первого удара до острия), потом стоит в пространстве.
   */
  spawn(specs: SlashSpec[], src: SlashSource, now: number, follow = 0): void {
    for (const spec of specs) this.pending.push({ spec, src, end: now + follow, at: now + (spec.delay ?? 0) });
  }

  private take(isStrip: boolean, now: number): Live {
    const list = isStrip ? this.pool.strip : this.pool.arc;
    // свободная, иначе самая старая
    let best = list[0];
    for (const l of list) {
      if (now - l.u.uBorn.value > l.u.uLife.value) return l;
      if (l.u.uBorn.value < best.u.uBorn.value) best = l;
    }
    return best;
  }

  private place(spec: SlashSpec, src: SlashSource, follow: number, now: number): void {
    const heavy = !!spec.heavy;
    const life = heavy ? SLASH.heavyLife : SLASH.life;
    const { x, y, z, facing } = src;
    const put = (isStrip: boolean, setup: (m: THREE.Mesh) => void, dir = 1) => {
      const l = this.take(isStrip, now);
      this.lastLive = l;
      for (let i = this.follows.length - 1; i >= 0; i--) if (this.follows[i].l === l) this.follows.splice(i, 1);
      l.u.uBorn.value = now; l.u.uLife.value = life; l.u.uDir.value = dir;
      l.u.uBright.value = FX.exposure ? (heavy ? SLASH_HDR.heavyBody : SLASH_HDR.body) : heavy ? SLASH.heavyBright : SLASH.bright;
      l.u.uCore.value = heavy ? SLASH_HDR.heavyCore : SLASH_HDR.core;
      l.mesh.visible = true;
      l.mesh.position.set(x, y + (spec.y ?? 1), z);
      l.mesh.rotation.set(0, 0, 0); l.mesh.scale.set(1, 1, 1);
      setup(l.mesh);
      if (follow > 0) this.follows.push({ l, born: now, src, until: now + follow, x, y, z, streak: spec.shape === 'streak' ? l.mesh.scale.z : 0 });
    };
    const r = spec.reach;
    switch (spec.shape) {
      case 'arc': case 'ring': {
        const angle = spec.shape === 'ring' ? Math.PI * 2 : spec.angle ?? 2;
        put(false, (m) => {
          m.geometry = this.arcGeo(angle);
          m.rotation.set(spec.tilt ?? 0, facing, 0, 'YXZ');
          m.scale.setScalar(r);
        }, spec.dir ?? 1);
        break;
      }
      case 'vert': {
        // рубящий сверху / апперкот: дуга в плоскости «вперёд–вверх», плоскость повёрнута вокруг взгляда на
        // VERT_ROLL — у камеры за спиной Пилота вертикальная дуга иначе видна ребром, одной линией
        put(false, (m) => {
          m.geometry = this.arcGeo(spec.angle ?? 2.4, SLASH.vertInner);
          basisArc(m, facing, spec.tilt ?? VERT_ROLL);
          m.scale.setScalar(r);
          m.position.y = y + (spec.y ?? 0.2) + r * 0.45;
        }, spec.dir ?? -1);
        this.lastLive.u.uBright.value *= SLASH.vertBright;
        break;
      }
      case 'streak': {
        // как линейный хитбокс: от LINE_BACK позади Пилота на всю длину
        const side = spec.side ?? 0;
        const sx = Math.cos(facing) * side - Math.sin(facing) * LINE_BACK, sz = -Math.sin(facing) * side - Math.cos(facing) * LINE_BACK;
        put(true, (m) => {
          m.position.x += sx; m.position.z += sz;
          m.rotation.set(0, facing, 0, 'YXZ');
          m.scale.set(spec.width ?? 0.2, 1, r);
        });
        break;
      }
      case 'cross': {
        // косой штрих в плоскости перед Пилотом (лицом к нему): два взмаха креста складываются в X
        put(true, (m) => {
          basisCross(m, facing, spec.tilt ?? 0.7, r, 1.3);
          m.scale.set(spec.width ?? 0.18, 1, r);
        });
        break;
      }
    }
  }

  /** Кадр: отложенные следы — в момент удара; открытый хитбокс — след за Пилотом; погасшие — скрыть. */
  update(now: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (now < p.at) continue;
      // отложенный слой едет за Пилотом только остаток окна удара
      this.place(p.spec, p.src, Math.max(0, p.end - now), now);
      this.pending.splice(i, 1);
    }
    for (let i = this.follows.length - 1; i >= 0; i--) {
      const f = this.follows[i], m = f.l.mesh, s = f.src;
      if (f.l.u.uBorn.value !== f.born) { this.follows.splice(i, 1); continue; }
      const dx = s.x - f.x, dy = s.y - f.y, dz = s.z - f.z;
      if (f.streak > 0) {
        // штрих выпада: начало там, где был первый удар, острие — у текущего конца хитбокса
        const fx = Math.sin(s.facing), fz = Math.cos(s.facing);
        m.scale.z = f.streak + Math.max(0, dx * fx + dz * fz);
        m.position.y += dy; f.y = s.y;
      } else {
        m.position.x += dx; m.position.y += dy; m.position.z += dz;
        f.x = s.x; f.y = s.y; f.z = s.z;
      }
      if (now >= f.until) this.follows.splice(i, 1);
    }
    for (const l of [...this.pool.arc, ...this.pool.strip]) {
      if (l.mesh.visible && now - l.u.uBorn.value > l.u.uLife.value) l.mesh.visible = false;
    }
  }

  /** Сколько следов на экране (тесты). */
  get active(): number { let n = 0; for (const l of [...this.pool.arc, ...this.pool.strip]) if (l.mesh.visible) n++; return n; }

  clear(): void { this.pending.length = 0; this.follows.length = 0; for (const l of [...this.pool.arc, ...this.pool.strip]) l.mesh.visible = false; }

  dispose(): void {
    for (const g of this.arcs.values()) g.dispose();
    this.stripGeo.dispose();
    for (const l of [...this.pool.arc, ...this.pool.strip]) (l.mesh.material as THREE.Material).dispose();
  }
}
