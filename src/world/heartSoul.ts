export type HeartSoulPhase = 'idle' | 'flying' | 'absorbed' | 'awakening' | 'awake';
export type V3 = [number, number, number];
export interface SoulObstacle { x: number; z: number; r: number }

/**
 * Свет павшей элиты сам находит Сердце. Он вырывается из тела, разворачивается к воротам Чертога и низко,
 * над самым полом, летит по проходу прямо в ядро. Вверх и за кадр он не уходит.
 *
 * burst — сколько свет вырывается из тела и разворачивается; speed — крейсерская скорость полёта (м/с);
 * accel / brake — разгон после разворота и торможение перед ядром (с); flyY — высота полёта, coreY — высота ядра;
 * ceiling — выше этой высоты свет не поднимается; gateLead — за сколько до пролёта света начинают подниматься ворота;
 * hold — крупный план Сердца, принявшего свет; outro — общий план героя у открытых ворот;
 * dormant — насколько разгорается Сердце, приняв свет (дальше оно тлеет и ждёт героя).
 * Пробуждение в начале боя (сцена heartIntro): awakeningDur, удары сердца beats, рёв awakeAt, полный свет awakenedAt.
 */
export const HEART_SOUL = {
  burst: 0.62, speed: 13, accel: 0.4, brake: 0.55,
  flyY: 2.2, coreY: 3.8, ceiling: 4.7,
  gateLead: 0.9, hold: 1.05, outro: 1.2,
  dormant: 0.45,
  awakeningDur: 9.0, beats: [4.1, 4.7] as const, awakeAt: 5.3, awakenedAt: 5.7,
} as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => v * v * (3 - 2 * v);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

function catmull(p0: V3, p1: V3, p2: V3, p3: V3, t: number, out: V3): V3 {
  const t2 = t * t, t3 = t2 * t;
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

/** Сплайн через контрольные точки с таблицей длины: позиция задаётся пройденными метрами. */
export class SoulRoute {
  readonly length: number;
  private readonly samples: V3[] = [];
  private readonly dist: number[] = [];

  constructor(readonly points: readonly V3[]) {
    const pts = [points[0], ...points, points[points.length - 1]], n = 48;
    const p: V3 = [0, 0, 0];
    let total = 0;
    for (let seg = 0; seg < points.length - 1; seg++) {
      for (let i = seg === 0 ? 0 : 1; i <= n; i++) {
        catmull(pts[seg], pts[seg + 1], pts[seg + 2], pts[seg + 3], i / n, p);
        const last = this.samples[this.samples.length - 1];
        if (last) total += Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
        this.samples.push([p[0], p[1], p[2]]); this.dist.push(total);
      }
    }
    this.length = total;
  }

  at(s: number, out: V3 = [0, 0, 0]): V3 {
    const d = this.dist, k = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = d.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (d[mid] <= k) lo = mid; else hi = mid; }
    const a = this.samples[lo], b = this.samples[hi], span = d[hi] - d[lo], u = span > 1e-9 ? (k - d[lo]) / span : 0;
    out[0] = lerp(a[0], b[0], u); out[1] = lerp(a[1], b[1], u); out[2] = lerp(a[2], b[2], u);
    return out;
  }

  /** Первая точка маршрута, где z опускается до плоскости ворот. */
  crossing(z: number): number {
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1], b = this.samples[i];
      if (a[2] > z && b[2] <= z) return lerp(this.dist[i - 1], this.dist[i], (a[2] - z) / Math.max(1e-9, a[2] - b[2]));
    }
    return this.length;
  }
}

/**
 * Контрольные точки: вспышка над телом → разворот к воротам (с обходом колонн) → ровно по оси прохода →
 * над полом Чертога → подъём над краем колодца → ядро.
 */
export function soulRoute(sx: number, sz: number, gateZ: number, coreZ: number, avoid: readonly SoulObstacle[] = []): V3[] {
  const { flyY, coreY } = HEART_SOUL;
  // Свет вырывается из груди павшей элиты и поднимается над её телом — не выше полутора её ростов.
  const lift: V3 = [sx * 0.97, 3.45, sz - 0.35];
  const points: V3[] = [[sx, 1.9, sz], lift];
  // К воротам свет подходит по оси прохода: даже из угла зала он входит в проём прямо.
  const approach: V3 = [Math.max(-1.1, Math.min(1.1, sx * 0.2)), flyY + 0.25, gateZ + 3.4];
  if (lift[2] > approach[2] + 1.2) {
    // Колонны зала свет облетает сбоку, а не проходит сквозь камень.
    for (const o of avoid) {
      const dx = approach[0] - lift[0], dz = approach[2] - lift[2], len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((o.x - lift[0]) * dx + (o.z - lift[2]) * dz) / len2));
      const cx = lift[0] + dx * t, cz = lift[2] + dz * t, d = Math.hypot(cx - o.x, cz - o.z), clear = o.r + 1.5;
      if (t <= 0.05 || t >= 0.95 || d >= clear) continue;
      const nx = d > 1e-6 ? (cx - o.x) / d : -dz / Math.sqrt(len2), nz = d > 1e-6 ? (cz - o.z) / d : dx / Math.sqrt(len2);
      points.push([o.x + nx * clear, flyY + 0.35, o.z + nz * clear]);
    }
    points.push(approach);
  }
  points.push([0, flyY, gateZ + 1.1], [0, flyY, gateZ - 1.8], [0.35, flyY + 0.2, coreZ + 9], [0, coreY + 0.55, coreZ + 4.4], [0, coreY, coreZ]);
  return points;
}

/** Время полёта: вспышка с разворотом, разгон, ровный полёт, торможение в ядре. */
export interface SoulTiming { route: SoulRoute; hover: number; dart: number; gateAt: number; gateOpenAt: number; absorbAt: number; dur: number }

export function soulTiming(route: SoulRoute, gateZ: number): SoulTiming {
  const { burst, speed, accel, brake, gateLead, hold, outro } = HEART_SOUL;
  const dartFrom = riseLength(route);
  const dartLen = route.length - dartFrom;
  const cruise = Math.max(0, dartLen / speed - (accel + brake) / 2);
  const base = { route, hover: 0, dart: accel + cruise + brake, gateAt: 0, gateOpenAt: 0, absorbAt: 0, dur: 0 };
  const gateS = route.crossing(gateZ);
  const timeAt = (s: number, hover: number): number => {
    if (s <= dartFrom) return burst * clamp01(s / Math.max(1e-6, dartFrom));
    let lo = 0, hi = base.dart;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (dartDistance(mid, base.dart, accel, brake, dartLen) < s - dartFrom) lo = mid; else hi = mid; }
    return burst + hover + hi;
  };
  // Если свет погиб у самого прохода, он чуть дольше висит над телом: ворота успевают подняться.
  const early = timeAt(gateS, 0);
  const hover = Math.max(0, gateLead + 0.3 - early);
  const gateAt = timeAt(gateS, hover), absorbAt = burst + hover + base.dart;
  return { ...base, hover, gateAt, gateOpenAt: Math.max(0.3, gateAt - gateLead), absorbAt, dur: absorbAt + hold + outro };
}

/** Вспышка над телом: первый отрезок маршрута. */
function riseLength(route: SoulRoute): number {
  const [a, b] = route.points;
  return Math.min(route.length, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
}

/** Пройденные метры за время t ровного полёта: трапеция скорости, площадь — вся длина. */
function dartDistance(t: number, total: number, accel: number, brake: number, length: number): number {
  const cruise = Math.max(0, total - accel - brake), v = length / Math.max(1e-6, cruise + (accel + brake) / 2);
  if (t <= 0) return 0;
  if (t < accel) return 0.5 * v * t * t / accel;
  if (t < accel + cruise) return v * (accel / 2 + t - accel);
  if (t < total) { const r = total - t; return length - 0.5 * v * r * r / brake; }
  return length;
}

/**
 * Свет движется только по абсолютному времени сцены Director: позиция в момент t одна и та же при любом
 * числе промежуточных кадров. Приняв свет, Сердце тлеет; пробуждение начинается, только когда входит герой.
 */
export class HeartSoul {
  phase: HeartSoulPhase = 'idle';
  readonly position = { x: 0, y: 0, z: 0 };
  /** Насколько ожило Сердце: 0 — спит, dormant — приняло свет и ждёт, 1 — проснулось. */
  awakened = 0;
  timing: SoulTiming | null = null;
  private readonly tmp: V3 = [0, 0, 0];
  private absorbedAt = 0;

  get visible(): boolean { return this.phase === 'flying'; }

  launch(sourceX: number, sourceZ: number, gateZ: number, coreZ: number, avoid: readonly SoulObstacle[] = []): boolean {
    if (this.phase !== 'idle') return false;
    const route = new SoulRoute(soulRoute(sourceX, sourceZ, gateZ, coreZ, avoid));
    this.timing = soulTiming(route, gateZ);
    this.phase = 'flying';
    this.sampleFlight(0);
    return true;
  }

  /** Пройденный путь в момент t сцены полёта. */
  distanceAt(t: number): number {
    const m = this.timing;
    if (!m) return 0;
    const { burst, accel, brake } = HEART_SOUL, rise = riseLength(m.route);
    if (t <= burst) {
      // Вспышка: свет вырывается вверх рывком и замирает над телом.
      const u = clamp01(t / burst);
      return rise * (1 - Math.pow(1 - u, 3));
    }
    return rise + dartDistance(t - burst - m.hover, m.dart, accel, brake, m.route.length - rise);
  }

  /** Кадр сцены полёта; после поглощения тот же вызов разжигает тление ядра. */
  sampleFlight(t: number): void {
    const m = this.timing;
    if (!m) return;
    if (this.phase === 'absorbed') { this.glow(t); return; }
    if (this.phase !== 'flying') return;
    if (t >= m.absorbAt) { this.absorb(t); return; }
    const p = m.route.at(this.distanceAt(t), this.tmp);
    this.position.x = p[0]; this.position.y = Math.min(HEART_SOUL.ceiling, p[1]); this.position.z = p[2];
  }

  /** Маркер Director: свет вошёл в ядро. Без времени (пропуск, конец сцены) ядро сразу тлеет полностью. */
  absorb(t?: number): void {
    const m = this.timing;
    if ((this.phase !== 'flying' && this.phase !== 'absorbed') || !m) return;
    const end = m.route.points[m.route.points.length - 1];
    this.position.x = end[0]; this.position.y = end[1]; this.position.z = end[2];
    if (this.phase === 'flying') { this.phase = 'absorbed'; this.absorbedAt = m.absorbAt; }
    this.glow(t ?? m.dur);
  }

  /** Тление после поглощения: ядро разгорается до dormant за 0.8 с и так ждёт героя. */
  glow(t: number): void {
    if (this.phase !== 'absorbed') return;
    this.awakened = Math.max(this.awakened, HEART_SOUL.dormant * smooth(clamp01((t - this.absorbedAt) / 0.8)));
  }

  /** Вход героя в Чертог. Повторный вызов ничего не делает. */
  beginAwakening(): boolean {
    if (this.phase !== 'absorbed') return false;
    this.phase = 'awakening'; this.awakened = HEART_SOUL.dormant;
    return true;
  }

  sampleAwakening(t: number): void {
    if (this.phase !== 'awakening' && this.phase !== 'awake') return;
    const { dormant, beats, awakenedAt } = HEART_SOUL;
    // Каждый удар сердца прибавляет свет; после раскрытия ядро горит полностью.
    const k = smooth(clamp01((t - beats[0]) / (awakenedAt - beats[0])));
    this.awakened = Math.max(this.awakened, dormant + (1 - dormant) * k);
    if (t >= awakenedAt) this.awake();
  }

  awake(): void {
    if (this.phase !== 'awakening' && this.phase !== 'awake') return;
    this.phase = 'awake'; this.awakened = 1;
  }
}
