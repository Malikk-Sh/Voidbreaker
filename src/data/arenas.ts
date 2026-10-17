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
  /** Крест-мост для второй фазы Иерофанта: плитки вне креста обрушиваются. */
  cross?: { w: number };
}

export const ARENAS: Record<string, ArenaDef> = {
  fall: {
    id: 'fall', tile: 1.5, edge: 'wall', decor: 'nave',
    parts: [{ kind: 'oct', x: 0, z: 0, w: 24, h: 17 }],
  },
  naves: {
    id: 'naves', tile: 1.5, edge: 'wall', decor: 'nave',
    parts: [{ kind: 'rect', x: 0, z: 0, w: 27, h: 15 }],
    cover: [{ x: -6, z: -2.5, r: 0.75 }, { x: 6, z: -2.5, r: 0.75 }, { x: -6, z: 3.5, r: 0.75 }, { x: 6, z: 3.5, r: 0.75 }],
  },
  gate: {
    id: 'gate', tile: 1.5, edge: 'wall', decor: 'gate',
    parts: [{ kind: 'oct', x: 0, z: 0, w: 25, h: 19 }],
  },
  candles: {
    id: 'candles', tile: 1.5, edge: 'wall', decor: 'candles',
    parts: [{ kind: 'circle', x: 0, z: 0, w: 24, h: 18 }],
    cover: [{ x: -5, z: 0, r: 0.6 }, { x: 5, z: 0, r: 0.6 }],
  },
  bridge: {
    id: 'bridge', tile: 1.5, edge: 'abyss', decor: 'bridge',
    parts: [
      { kind: 'oct', x: 0, z: 0, w: 13, h: 12 },
      { kind: 'rect', x: -11, z: 0, w: 10, h: 4.5 },
      { kind: 'rect', x: 11, z: 0, w: 10, h: 4.5 },
      { kind: 'oct', x: -19, z: 0, w: 9, h: 9 },
      { kind: 'oct', x: 19, z: 0, w: 9, h: 9 },
    ],
  },
  belfry: {
    id: 'belfry', tile: 1.5, edge: 'wall', decor: 'belfry',
    parts: [{ kind: 'oct', x: 0, z: 0, w: 22, h: 19 }],
    cover: [{ x: -7, z: -5, r: 0.7 }, { x: 7, z: -5, r: 0.7 }],
  },
  hierophant: {
    id: 'hierophant', tile: 1.5, edge: 'wall', decor: 'boss',
    parts: [{ kind: 'oct', x: 0, z: 0, w: 27, h: 22 }],
    cross: { w: 4.5 },
  },
  hub: {
    id: 'hub', tile: 1.25, edge: 'abyss', decor: 'hub',
    parts: [{ kind: 'circle', x: 0, z: 0, w: 12, h: 12 }],
  },
};

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
