import { ARENAS, inPart, type ArenaDef } from '../data/arenas';
import { gatePathArena } from './gatePath';
import { TileState, type Arena, type Tile } from './arena';

export const CATHEDRAL = { hallZ: -55, bridgeStart: -24, hallThreshold: -47 } as const;
export const candleEncounter = () => ({ ...ARENAS.candles.parts[0], z: CATHEDRAL.hallZ });

/** Центры десяти рядов общей сетки (плита 1.5 м). Кромка зала и площадка у Врат остаются целыми. */
export const BRIDGE_COLLAPSE = { minZ: -43, maxZ: -28, firstRowZ: -42.75, rows: 10, rowSize: 1.5, duration: 2.5 } as const;
export function bridgeCollapseDelay(z: number): number {
  const row = Math.max(0, Math.min(BRIDGE_COLLAPSE.rows - 1, Math.round((z - BRIDGE_COLLAPSE.firstRowZ) / BRIDGE_COLLAPSE.rowSize)));
  return row / (BRIDGE_COLLAPSE.rows - 1) * BRIDGE_COLLAPSE.duration;
}

/** Один мир и одна сетка навигации: подход, Врата, мост и Свечной зал. */
export function cathedralArena(): ArenaDef {
  const gate = gatePathArena(ARENAS.gate), c = ARENAS.candles;
  return { ...gate,
    parts: [...gate.parts, { kind: 'rect', x: 0, z: -34, w: 5.4, h: 25 }, ...c.parts.map(p => ({ ...p, z: p.z + CATHEDRAL.hallZ }))],
    holes: [...gate.holes ?? [], ...c.holes!.map(p => ({ ...p, z: p.z + CATHEDRAL.hallZ }))],
    cover: [...gate.cover ?? [], ...c.cover!.map(p => ({ ...p, z: p.z + CATHEDRAL.hallZ }))],
  };
}

export class CathedralRoute {
  phase: 'gate' | 'bridge' | 'combat' | 'complete' = 'gate';
  collapseStarted = false;
  collapseTime = 0;
  private readonly collapseTiles: Tile[];
  private readonly released = new Set<Tile>();
  constructor(private readonly arena: Arena) {
    this.collapseTiles = arena.tiles.filter(t => t.z >= BRIDGE_COLLAPSE.minZ && t.z <= BRIDGE_COLLAPSE.maxZ && Math.abs(t.x) < 3);
  }
  startBridge(): boolean {
    if (this.phase !== 'gate') return false;
    this.phase = 'bridge';
    this.arena.def.encounter = candleEncounter();
    return true;
  }
  step(x: number, z: number): boolean {
    if (this.phase !== 'bridge' || z > CATHEDRAL.hallThreshold || !inPart(candleEncounter(), x, z)) return false;
    this.phase = 'combat';
    this.collapseStarted = true;
    return true;
  }
  /** dt приходит из игрового времени: пауза и режиссёрская остановка не продвигают обвал. */
  advanceCollapse(dt: number): number {
    if (!this.collapseStarted || dt <= 0) return 0;
    this.collapseTime = Math.min(BRIDGE_COLLAPSE.duration, this.collapseTime + dt);
    let count = 0;
    for (const tile of this.collapseTiles) {
      if (this.released.has(tile) || bridgeCollapseDelay(tile.z) > this.collapseTime) continue;
      this.released.add(tile); count++;
      if (tile.state === TileState.Falling) {
        // Уже сбитая цепью плита тоже не должна вернуться по её старому таймеру.
        tile.timer = -1;
      } else this.arena.breakTile(tile, 0);
    }
    return count;
  }
  win(): void { this.phase = 'complete'; }
}
