import { ARENAS, inPart, type ArenaDef } from '../data/arenas';
import { gatePathArena } from './gatePath';
import type { Arena } from './arena';

export const CATHEDRAL = { hallZ: -55, bridgeStart: -24, hallThreshold: -47, sealZ: -42 } as const;
export const candleEncounter = () => ({ ...ARENAS.candles.parts[0], z: CATHEDRAL.hallZ });

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
  constructor(private readonly arena: Arena) {}
  startBridge(): boolean {
    if (this.phase !== 'gate') return false;
    this.phase = 'bridge';
    this.arena.def.encounter = candleEncounter();
    return true;
  }
  step(x: number, z: number): boolean {
    if (this.phase !== 'bridge' || z > CATHEDRAL.hallThreshold || !inPart(candleEncounter(), x, z)) return false;
    this.phase = 'combat';
    this.arena.setBarrier('candle-entrance', { kind: 'rect', x: 0, z: CATHEDRAL.sealZ, w: 8, h: 2 });
    return true;
  }
  win(): void { this.phase = 'complete'; this.arena.setBarrier('candle-entrance', null); }
}
