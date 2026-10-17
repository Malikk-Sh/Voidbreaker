import type { EnemyKind } from '../../data/enemies';

/** Точка привязки шага: сам босс, снимок позиции героя на старте паттерна, центр арены, впереди босса… */
export type Anchor = 'self' | 'player' | 'snapshot' | 'center' | 'front' | { x: number; z: number };

export type ShapeSpec =
  | { circle: number }
  | { arc: [number, number] }          // радиус, угол (градусы), направление — на героя/снимок
  | { line: [number, number] }         // длина, ширина; от якоря к героя/снимку
  | { ring: [number, number] };

/**
 * Шаг таймлайна атаки (Tech §17): синхронизирует позы, телеграфы, хитбоксы, эффекты, звук и камеру.
 * dmg — доля HP героя при ожидаемой прокачке зоны.
 */
export type Step =
  | { t: number; do: 'pose'; id: string; blend?: number }
  | { t: number; do: 'telegraph'; shape: ShapeSpec; at: Anchor; dur: number; white?: boolean; tag?: string; dir?: Anchor }
  | { t: number; do: 'hitbox'; shape: ShapeSpec; at: Anchor; dmg: number; posture?: number; kb?: number; dir?: Anchor }
  | { t: number; do: 'projectiles'; pattern: 'radial' | 'fan' | 'aimed' | 'rain' | 'spiral'; count: number; speed: number; kind?: 'orb' | 'stone' | 'needle'; dmg: number; spread?: number; at?: Anchor }
  | { t: number; do: 'ringwave'; at: Anchor; speed: number; width: number; maxR: number; gaps: number; gapW: number; dmg: number; accel?: number }
  | { t: number; do: 'fx'; id: 'impact' | 'shockwave' | 'dust'; at: Anchor; r?: number }
  | { t: number; do: 'sfx'; id: string }
  | { t: number; do: 'shake'; trauma: number }
  | { t: number; do: 'vulnerable'; dur: number; postureMul?: number }
  | { t: number; do: 'move'; to: Anchor; dur: number; arc?: number; ease?: 'inOutQuad' | 'outCubic' | 'inExpo' }
  | { t: number; do: 'turn'; to: Anchor }
  | { t: number; do: 'summon'; enemy: EnemyKind; count: number; at: Anchor[] | 'edges' }
  | { t: number; do: 'call'; fn: string; arg?: number }
  | { t: number; do: 'telegraphSound'; kind: 'hum' | 'whistle' | 'chime' | 'bell' | 'roar' };

export interface Pattern {
  id: string;
  weight: number;
  cooldown: number;
  range?: [number, number];
  phases: number[];
  steps: Step[];
  /** Длительность паттерна (если не задана — последний шаг + 0.5 с). */
  dur?: number;
  /** Динамическая сборка шагов на старте (позиции от героя/босса). */
  build?: () => Step[];
}

/** Выбор паттерна: взвешенный рандом без повторов подряд + кулдауны («колода»). */
export function pickPattern(list: Pattern[], phase: number, dist: number, last: string | null, cds: Map<string, number>, rnd: () => number): Pattern | null {
  const ok = list.filter((p) => p.phases.includes(phase) && (cds.get(p.id) ?? 0) <= 0 && p.id !== last && (!p.range || (dist >= p.range[0] && dist <= p.range[1])));
  const pool = ok.length ? ok : list.filter((p) => p.phases.includes(phase) && p.id !== last);
  if (!pool.length) return null;
  let total = 0;
  for (const p of pool) total += p.weight;
  let r = rnd() * total;
  for (const p of pool) { r -= p.weight; if (r <= 0) return p; }
  return pool[pool.length - 1];
}

export function patternDur(p: Pattern): number {
  if (p.dur) return p.dur;
  let m = 0;
  for (const s of p.steps) {
    let end = s.t;
    if (s.do === 'telegraph' || s.do === 'move') end += s.dur;
    if (s.do === 'vulnerable') end += s.dur;
    m = Math.max(m, end);
  }
  return m + 0.5;
}

/** Проверка таймлайна (юнит-тест): каждый хитбокс предварён телеграфом не короче минимума зоны. */
export function validatePattern(p: Pattern, minTele: number): string | null {
  const teles = p.steps.filter((s): s is Extract<Step, { do: 'telegraph' }> => s.do === 'telegraph');
  for (const s of p.steps) {
    if (s.do !== 'hitbox') continue;
    const before = teles.filter((t) => t.t < s.t + 1e-6 && t.t + t.dur >= s.t - 0.05);
    if (!before.length) return `${p.id}: hitbox at ${s.t} has no telegraph`;
    const longest = Math.max(...before.map((t) => s.t - t.t));
    if (longest + 1e-6 < minTele) return `${p.id}: telegraph ${longest.toFixed(2)} < ${minTele}`;
  }
  return null;
}
