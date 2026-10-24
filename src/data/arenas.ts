/**
 * Раскладки арен (GDD §17.4): форма пола, ямы, укрытия, точки спавна — вручную, ради баланса.
 * Декор (колонны, свечи, статуи, фоновые руины) расставляет генератор по сиду этапа.
 */
export type ShapeKind = 'oct' | 'rect' | 'circle';
export interface ShapePart { kind: ShapeKind; x: number; z: number; w: number; h: number }
export type DecorStyle = 'nave' | 'gate' | 'candles' | 'bridge' | 'belfry' | 'boss' | 'hub';

export interface ArenaDef {
  id: string;
  parts: ShapePart[];
  holes?: ShapePart[];
  tile: number;
  edge: 'wall' | 'abyss';
  cover?: { x: number; z: number; r: number }[];
  decor: DecorStyle;
  /** Крест-мост: плитки вне креста обрушиваются (прежняя вторая фаза Иерофанта). */
  cross?: { w: number };
  /**
   * Звёздный мост второй фазы Иерофанта: остаются центр радиуса r и rays лучей-мостов длиной len и шириной w;
   * луч k смотрит под углом rot + k·2π/rays (0 — к камере, +Z).
   */
  star?: StarBridge;
  /** Рунный круг на полу: по умолчанию в центре первой части; false — нет (в центре провал). */
  rune?: { x: number; z: number } | false;
  /** Ковровая дорожка вдоль оси нефа (декор). */
  aisle?: boolean;
}

export const ARENAS: Record<string, ArenaDef> = {
  // 1-1: базилика — неф и полукруглая апсида за ним
  fall: {
    id: 'fall', tile: 1.5, edge: 'wall', decor: 'nave', aisle: true,
    parts: [{ kind: 'rect', x: 0, z: 1, w: 26, h: 13 }, { kind: 'circle', x: 0, z: -5.5, w: 17, h: 12 }],
    cover: [{ x: -8.5, z: -2.6, r: 0.7 }, { x: 8.5, z: -2.6, r: 0.7 }],
  },
  // 1-2: крестовый план — неф и трансепт, колонны в углах средокрестия
  naves: {
    id: 'naves', tile: 1.5, edge: 'wall', decor: 'nave', aisle: true,
    parts: [{ kind: 'rect', x: 0, z: 0, w: 31, h: 12 }, { kind: 'rect', x: 0, z: 0, w: 11, h: 23 }],
    cover: [
      { x: -5.6, z: -6.1, r: 0.75 }, { x: 5.6, z: -6.1, r: 0.75 }, { x: -5.6, z: 6.1, r: 0.75 }, { x: 5.6, z: 6.1, r: 0.75 },
      { x: -11.5, z: -3, r: 0.65 }, { x: 11.5, z: -3, r: 0.65 }, { x: -11.5, z: 3, r: 0.65 }, { x: 11.5, z: 3, r: 0.65 },
    ],
  },
  // 1-3: двор перед Вратами — два провала делят его на три прохода
  gate: {
    id: 'gate', tile: 1.5, edge: 'wall', decor: 'gate',
    parts: [{ kind: 'oct', x: 0, z: 0, w: 27, h: 20 }],
    holes: [{ kind: 'rect', x: -7.5, z: -0.5, w: 4.5, h: 7.5 }, { kind: 'rect', x: 7.5, z: -0.5, w: 4.5, h: 7.5 }],
  },
  // 1-4: кольцо вокруг свечного колодца
  candles: {
    id: 'candles', tile: 1.5, edge: 'wall', decor: 'candles', rune: false,
    parts: [{ kind: 'circle', x: 0, z: 0, w: 27, h: 21 }],
    holes: [{ kind: 'circle', x: 0, z: -0.5, w: 8, h: 6 }],
    cover: [{ x: -8.5, z: -0.5, r: 0.6 }, { x: 8.5, z: -0.5, r: 0.6 }],
  },
  // 1-5: три острова и дальняя площадка над бездной
  bridge: {
    id: 'bridge', tile: 1.5, edge: 'abyss', decor: 'bridge',
    parts: [
      { kind: 'oct', x: 0, z: 0, w: 13, h: 12 },
      { kind: 'rect', x: -11, z: 0, w: 10, h: 4.5 },
      { kind: 'rect', x: 11, z: 0, w: 10, h: 4.5 },
      { kind: 'oct', x: -19, z: 0, w: 9, h: 9 },
      { kind: 'oct', x: 19, z: 0, w: 9, h: 9 },
      { kind: 'rect', x: 0, z: -8, w: 4, h: 5 },
      { kind: 'oct', x: 0, z: -13.5, w: 10, h: 8 },
    ],
  },
  // 1-6: колокольня — пол проломлен в четырёх местах
  belfry: {
    id: 'belfry', tile: 1.5, edge: 'wall', decor: 'belfry',
    parts: [{ kind: 'oct', x: 0, z: 0, w: 25, h: 21 }],
    holes: [
      { kind: 'oct', x: -6.8, z: -4.2, w: 4, h: 3.4 }, { kind: 'oct', x: 6.8, z: -4.2, w: 4, h: 3.4 },
      { kind: 'oct', x: -6.8, z: 4.6, w: 3.6, h: 3 }, { kind: 'oct', x: 6.8, z: 4.6, w: 3.6, h: 3 },
    ],
  },
  // 1-7: клуатр — квадратный двор вокруг провала на месте сада, четыре колонны по углам сада
  cloister: {
    id: 'cloister', tile: 1.5, edge: 'wall', decor: 'nave', rune: false,
    parts: [{ kind: 'rect', x: 0, z: 0, w: 24, h: 19 }],
    holes: [{ kind: 'rect', x: 0, z: -0.5, w: 6, h: 4.5 }],
    cover: [{ x: -5.2, z: -4.3, r: 0.7 }, { x: 5.2, z: -4.3, r: 0.7 }, { x: -5.2, z: 3.3, r: 0.7 }, { x: 5.2, z: 3.3, r: 0.7 }],
  },
  // 1-8: крипта — крест узких коридоров, саркофаги вдоль стен
  crypt: {
    id: 'crypt', tile: 1.5, edge: 'wall', decor: 'candles', rune: false,
    parts: [{ kind: 'rect', x: 0, z: 0, w: 27, h: 7.5 }, { kind: 'rect', x: 0, z: 0, w: 7.5, h: 22 }],
    cover: [{ x: -8, z: 2.2, r: 0.65 }, { x: 8, z: -2.2, r: 0.65 }, { x: 2.2, z: -7.5, r: 0.65 }, { x: -2.2, z: 7.5, r: 0.65 }],
  },
  // 1-9: хоры — восьмиугольник над бездной: два провала по сторонам от мостика через середину
  choir: {
    id: 'choir', tile: 1.5, edge: 'wall', decor: 'belfry', rune: false,
    parts: [{ kind: 'oct', x: 0, z: 0, w: 26, h: 21 }],
    holes: [{ kind: 'rect', x: 0, z: -3.6, w: 11, h: 4.2 }, { kind: 'rect', x: 0, z: 3.6, w: 11, h: 4.2 }],
    cover: [{ x: -8.5, z: 0, r: 0.7 }, { x: 8.5, z: 0, r: 0.7 }],
  },
  hierophant: {
    // плитка 1 м: на 1.5 м диагональные лучи звезды выходят лесенкой (2–3 плитки в ширину — проходимы)
    id: 'hierophant', tile: 1.0, edge: 'wall', decor: 'boss',
    parts: [{ kind: 'oct', x: 0, z: 0, w: 27, h: 22 }],
    star: { r: 5, rays: 7, len: 4.5, w: 2.8, rot: 0 },
  },
  hub: {
    id: 'hub', tile: 1.25, edge: 'abyss', decor: 'hub',
    parts: [{ kind: 'circle', x: 0, z: 0, w: 12, h: 12 }],
  },
};

export interface StarBridge { r: number; rays: number; len: number; w: number; rot: number }

/** Угол луча k звёздного моста (рад; направление — (sin, cos)). */
export function starRay(st: StarBridge, k: number): number { return st.rot + (k * Math.PI * 2) / st.rays; }

/** Точка на звёздном мосту: в центральном круге или на одном из лучей. */
export function inStar(st: StarBridge, x: number, z: number, margin = 0): boolean {
  const d = Math.hypot(x, z);
  if (d <= st.r - margin) return true;
  for (let k = 0; k < st.rays; k++) {
    const a = starRay(st, k), sa = Math.sin(a), ca = Math.cos(a);
    const along = x * sa + z * ca, perp = Math.abs(x * ca - z * sa);
    if (along > 0 && along <= st.r + st.len - margin && perp <= st.w / 2 - margin) return true;
  }
  return false;
}

/** Ближайший луч к точке (индекс). */
export function nearestRay(st: StarBridge, x: number, z: number): number {
  const a = Math.atan2(x, z);
  let best = 0, bd = Infinity;
  for (let k = 0; k < st.rays; k++) { const d = Math.abs(Math.atan2(Math.sin(a - starRay(st, k)), Math.cos(a - starRay(st, k)))); if (d < bd) { bd = d; best = k; } }
  return best;
}

export function inPart(p: ShapePart, x: number, z: number, margin = 0): boolean {
  const dx = Math.abs(x - p.x), dz = Math.abs(z - p.z);
  const hw = p.w / 2 - margin, hh = p.h / 2 - margin;
  if (hw <= 0 || hh <= 0) return false;
  switch (p.kind) {
    case 'rect': return dx <= hw && dz <= hh;
    case 'circle': return (dx * dx) / (hw * hw) + (dz * dz) / (hh * hh) <= 1;
    case 'oct': return dx <= hw && dz <= hh && dx / hw + dz / hh <= 1.45;
  }
}

/** Точка над провалом внутри арены (яма в полу). */
export function inHole(a: ArenaDef, x: number, z: number, margin = 0): boolean {
  if (a.holes) for (const h of a.holes) if (inPart(h, x, z, margin)) return true;
  return false;
}

/** Внутри внешнего контура (без учёта провалов) — для периметра и декора. */
export function inOutline(a: ArenaDef, x: number, z: number, margin = 0): boolean {
  for (const p of a.parts) if (inPart(p, x, z, margin)) return true;
  return false;
}

export function inArenaShape(a: ArenaDef, x: number, z: number, margin = 0): boolean {
  if (a.holes) for (const h of a.holes) if (inPart(h, x, z, -margin)) return false;
  for (const p of a.parts) if (inPart(p, x, z, margin)) return true;
  return false;
}

export function arenaBounds(a: ArenaDef): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of a.parts) {
    minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2);
    minZ = Math.min(minZ, p.z - p.h / 2); maxZ = Math.max(maxZ, p.z + p.h / 2);
  }
  return { minX, maxX, minZ, maxZ };
}
