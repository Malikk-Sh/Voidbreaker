/**
 * Шкала оглушения (план §5.5): копится от мастерства (окна, заряд, Контрудар), утекает со временем.
 * Порог — оглушение: +25 % урона, один Раскол. Затем пробуждение (5 с шкала не растёт) и привыкание.
 */
export interface Stun {
  /** Наполнение 0..max. */
  value: number;
  /** Текущий порог (растёт с привыканием, до ×1.9 базового). */
  max: number;
  /** Базовый порог. */
  base: number;
  /** Базовая длительность оглушения (с). */
  dur: number;
  /** Длительность текущего оглушения (с). */
  total: number;
  /** Оставшееся время оглушения (0 — в сознании). */
  stunned: number;
  /** Секунды без пополнения (утечка элиты начинается через 2 с). */
  idle: number;
  /** Пробуждение: секунды, пока шкала не наполняется. */
  immune: number;
  /** Оглушений в этой фазе (привыкание). */
  count: number;
  /** Утечка всегда (Стражи, боссы) или только после паузы (элита, Голем). */
  alwaysLeak: boolean;
}

/** Пробуждение после оглушения (с). */
export const STUN_IMMUNE = 5;
/** Утечка шкалы (ед/с). */
export const STUN_LEAK = 4;
/** Элита и Голем начинают терять шкалу через столько секунд без пополнения. */
export const STUN_LEAK_DELAY = 2;
/** Звезда над головой на каждые 0.5 с оставшегося оглушения (не больше семи). */
export const STUN_STAR_SEC = 0.5;

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
  stun: Stun | null;
  kbX: number; kbZ: number;
  /** Высота «головы» — для цифр урона и значков. */
  height: number;
}

export function makeStun(max: number, dur: number, alwaysLeak = false): Stun {
  return { value: 0, max, base: max, dur, total: 0, stunned: 0, idle: 0, immune: 0, count: 0, alwaysLeak };
}

/** Наполнить шкалу; true — порог достигнут этим ударом. Во время оглушения и пробуждения не растёт. */
export function addStun(s: Stun, amount: number): boolean {
  if (s.stunned > 0 || s.immune > 0 || amount <= 0) return false;
  s.idle = 0;
  if (s.value >= s.max) return false;
  s.value = Math.min(s.max, s.value + amount);
  return s.value >= s.max;
}

/**
 * Начать оглушение: длительность −0.5 с за каждое прошлое оглушение фазы (не меньше 2 с),
 * следующий порог +30 % (до ×1.9), шкала — с нуля. Возвращает длительность.
 */
export function triggerStun(s: Stun): number {
  s.total = Math.max(Math.min(s.dur, 2), s.dur - 0.5 * s.count);
  s.stunned = s.total;
  s.value = 0;
  s.count++;
  s.max = s.base * Math.min(1.9, 1 + 0.3 * s.count);
  return s.total;
}

/** Конец оглушения (таймер или Раскол): пробуждение 5 с. */
export function endStun(s: Stun): void {
  s.stunned = 0;
  s.value = 0;
  s.immune = STUN_IMMUNE;
}

/** Новая фаза босса: привыкание сбрасывается. */
export function resetStunHabit(s: Stun): void {
  s.count = 0;
  s.max = s.base;
}

/** Шаг шкалы: таймер оглушения, пробуждение, утечка. true — оглушение закончилось в этом шаге. */
export function stepStun(s: Stun, dt: number): boolean {
  if (s.stunned > 0) {
    s.stunned -= dt;
    if (s.stunned <= 0) { endStun(s); return true; }
    return false;
  }
  if (s.immune > 0) s.immune = Math.max(0, s.immune - dt);
  s.idle += dt;
  if (s.alwaysLeak || s.idle > STUN_LEAK_DELAY) s.value = Math.max(0, s.value - STUN_LEAK * dt);
  return false;
}

let nextId = 1;
export const newId = (): number => nextId++;
