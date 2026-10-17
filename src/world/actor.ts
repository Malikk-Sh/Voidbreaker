/** Шкала стойки (GDD §5.6): восстанавливается через 3 с без урона, 15 %/с; слом — оглушение и +50 % урона. */
export interface Posture {
  value: number;
  max: number;
  /** Секунды до начала восстановления. */
  regenDelay: number;
  /** Оставшееся время слома (0 — не сломан). */
  broken: number;
  breakDur: number;
}

export type Faction = 'hero' | 'enemy';

export interface Actor {
  id: number;
  faction: Faction;
  x: number; z: number; y: number;
  radius: number;
  mass: number;
  facing: number;
  hp: number; maxHp: number;
  armor: number;
  dead: boolean;
  posture: Posture | null;
  kbX: number; kbZ: number;
  /** Высота «головы» — для цифр урона и значков. */
  height: number;
}

export function makePosture(max: number, breakDur = 3): Posture {
  return { value: max, max, regenDelay: 0, broken: 0, breakDur };
}

/** Обновить стойку: восстановление через 3 с без урона, 15 %/с. */
export function stepPosture(p: Posture, dt: number): void {
  if (p.broken > 0) {
    p.broken -= dt;
    if (p.broken <= 0) { p.broken = 0; p.value = p.max; }
    return;
  }
  if (p.regenDelay > 0) { p.regenDelay -= dt; return; }
  p.value = Math.min(p.max, p.value + p.max * 0.15 * dt);
}

/** Нанести урон стойке; true — стойка сломана этим ударом. */
export function hitPosture(p: Posture, amount: number): boolean {
  if (p.broken > 0) return false;
  p.value -= amount;
  p.regenDelay = 3;
  if (p.value <= 0) { p.value = 0; p.broken = p.breakDur; return true; }
  return false;
}

let nextId = 1;
export const newId = (): number => nextId++;
