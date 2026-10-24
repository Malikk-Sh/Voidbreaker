import type { Input } from '../input/input';
import type { Enemy } from './enemy';

/** Интерфейс системы способностей, которым пользуются герой и мир. */
export interface AbilityHost {
  tryCast(slot: 'q' | 'e' | 'r', input: Input): boolean;
  step(dtW: number, dtH: number): void;
  addFloorRift(x: number, z: number, facing: number, len: number): void;
  riftUnder(x: number, z: number, dx: number, dz: number): boolean;
  eclipseWave(x: number, z: number, facing: number): void;
  bladeWave(x: number, z: number, facing: number, mult: number, dist: number, r: number): void;
  onDash?(x: number, z: number, dx: number, dz: number): void;
  onKill(e: Enemy): void;
  canDeflect(): boolean;
  /** Множитель урона по врагу от эффектов (Горизонт событий). */
  damageMulOn(e: Enemy): number;
}
