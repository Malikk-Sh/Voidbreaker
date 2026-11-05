import { inPart, type ArenaDef, type ShapePart } from '../data/arenas';
import type { Arena } from './arena';

/** Both chapters share one floor; all offsets are relative to the first candle hall. */
export const HEART_HALL = { offsetZ: -27, enterZ: -17, gateZ: -12, width: 38, depth: 30 } as const;
const OPEN_SECONDS = 1.6;
const BARRIER_ID = 'heart-passage';

export function heartEncounter(foreZ: number): ShapePart {
  return { kind: 'circle', x: 0, z: foreZ + HEART_HALL.offsetZ, w: HEART_HALL.width, h: HEART_HALL.depth };
}

/** Keep the first encounter, well and cover intact while adding the chamber beyond its north door. */
export function heartArena(base: ArenaDef, foreZ: number): ArenaDef {
  const heart = heartEncounter(foreZ);
  return {
    ...base,
    encounter: base.encounter ?? base.parts[0],
    parts: [...base.parts,
      // Overlap both curved rims: the narrow tips must not leave gaps in the common tile grid.
      { kind: 'rect', x: 0, z: foreZ - 11.25, w: 7, h: 6 },
      heart,
    ],
    holes: [...(base.holes ?? []), { kind: 'circle', x: 0, z: heart.z - 0.5, w: 10, h: 8 }],
    cover: [...(base.cover ?? [])],
  };
}

export type HeartPassagePhase = 'waiting' | 'released' | 'awakening' | 'combat' | 'complete';

/** The visible portcullis and navigation use the same opening state. */
export class HeartPassage {
  phase: HeartPassagePhase = 'waiting';
  gateOpen = 0;
  private blocked = false;

  constructor(private readonly arena: Arena, private readonly foreZ: number) { this.close(); }

  private close(): void {
    if (this.blocked) return;
    this.blocked = true;
    this.arena.setBarrier(BARRIER_ID, { kind: 'rect', x: 0, z: this.foreZ + HEART_HALL.gateZ, w: 7, h: 0.65 });
  }

  private open(): void {
    if (!this.blocked) return;
    this.blocked = false;
    this.arena.setBarrier(BARRIER_ID, null);
  }

  release(): boolean {
    if (this.phase !== 'waiting') return false;
    this.phase = 'released';
    return true;
  }

  step(dt: number): void {
    if ((this.phase !== 'released' && this.phase !== 'complete') || dt <= 0) return;
    this.gateOpen = Math.min(1, this.gateOpen + dt / OPEN_SECONDS);
    if (this.gateOpen >= 1) this.open();
  }

  enter(x: number, z: number): boolean {
    if (this.phase !== 'released' || this.gateOpen < 1 || z > this.foreZ + HEART_HALL.enterZ) return false;
    if (!inPart(heartEncounter(this.foreZ), x, z, 0.35) || !this.arena.walkable(x, z)) return false;
    this.phase = 'awakening';
    return true;
  }

  activate(): boolean {
    if (this.phase !== 'awakening') return false;
    this.phase = 'combat';
    this.arena.def.encounter = heartEncounter(this.foreZ);
    this.gateOpen = 0;
    this.close();
    return true;
  }

  win(): void {
    if (this.phase !== 'combat') return;
    this.phase = 'complete';
    this.gateOpen = 1;
    this.open();
  }
}
