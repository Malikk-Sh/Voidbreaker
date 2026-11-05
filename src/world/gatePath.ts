import type { ArenaDef } from '../data/arenas';
import type { Arena } from './arena';

/** «Путь к Вратам»: все поверхности плоские; боевая терраса и её провалы сохранены. */
export const GATE_PATH = {
  start: { x: 0, z: 21 }, revealZ: 14, fightZ: 7.5,
  gateZ: -14, exitZ: -24, openSec: 2.4,
} as const;

export function gatePathArena(base: ArenaDef): ArenaDef {
  return {
    ...base, encounter: base.parts[0],
    parts: [...base.parts,
      { kind: 'rect', x: 0, z: 16, w: 6, h: 16 },
      { kind: 'rect', x: 0, z: -16, w: 6, h: 16 },
      { kind: 'oct', x: 0, z: -24, w: 10, h: 7 },
    ],
  };
}

export type GatePathPhase = 'approach' | 'reveal' | 'combat' | 'opening' | 'passage' | 'complete' | 'failed';
export type GatePathEvent = 'reveal' | 'combat' | 'passage' | 'complete';

/** Только состояние маршрута и коллизии. Камера, звук и декор реагируют в Battle. */
export class GatePath {
  phase: GatePathPhase = 'approach';
  open = 0;
  cleared = false;

  constructor(private readonly arena: Arena) {
    arena.setBarrier('gate', { kind: 'rect', x: 0, z: -11.5, w: 8, h: 3 });
  }

  enterCombat(): void {
    if (this.phase !== 'approach' && this.phase !== 'reveal') return;
    this.phase = 'combat';
    this.arena.setBarrier('gallery', { kind: 'rect', x: 0, z: 11, w: 8, h: 2 });
  }

  win(): void {
    if (this.cleared || this.phase === 'failed') return;
    this.cleared = true;
    this.phase = 'opening';
  }

  step(dt: number, x: number, z: number, dead = false, cinematic = false): GatePathEvent | null {
    if (dead) { this.phase = 'failed'; return null; }
    if (cinematic || this.phase === 'failed') return null;
    if (this.phase === 'approach' && z <= GATE_PATH.revealZ) {
      this.phase = 'reveal';
      return 'reveal';
    }
    if (this.phase === 'reveal' && z <= GATE_PATH.fightZ) {
      this.enterCombat();
      return 'combat';
    }
    if (this.phase === 'opening') {
      this.open = Math.min(1, this.open + dt / GATE_PATH.openSec);
      if (this.open >= 1) {
        this.arena.setBarrier('gate', null);
        this.arena.setBarrier('gallery', null);
        this.phase = 'passage';
        return 'passage';
      }
    }
    if (this.phase === 'passage' && Math.abs(x) < 2.5 && z <= GATE_PATH.exitZ) {
      this.phase = 'complete';
      return 'complete';
    }
    return null;
  }
}
