/** Характеристики Пилота, база (GDD §5.1). */
export const PLAYER_BASE = {
  hp: 120,
  atk: 12,
  critChance: 0.05,
  critMul: 1.75,
  speed: 5.5,
  dashDist: 4.5,
  dashTime: 0.18,
  dashCharges: 2,
  dashRecharge: 1.1,
  dashIframes: 0.14,
  armor: 0,
  /** Окно идеального уклонения: рывок начат ≤ 0.15 с до попадания (GDD §5.4). */
  perfectWindow: 0.15,
  perfectCooldown: 2,
  hurtInvuln: 0.6,
  accelTime: 0.06,
  stopTime: 0.05,
  turnTime: 0.08,
  radius: 0.45,
} as const;

/** Резонанс (GDD §5.5). */
export const RESONANCE = {
  max: 100,
  perHit: 2,
  perFinisher: 6,
  perPerfectDodge: 15,
  perShatter: 12,
  perSecondAtS: 1,
  lossOnHurt: 5,
};

/** Ранги комбо (GDD §5.7). */
export const RANKS = [
  { id: 'D', min: 0, mul: 1.0 },
  { id: 'C', min: 15, mul: 1.05 },
  { id: 'B', min: 40, mul: 1.1 },
  { id: 'A', min: 80, mul: 1.2 },
  { id: 'S', min: 140, mul: 1.35 },
  { id: 'SS', min: 220, mul: 1.5 },
] as const;
export type RankId = (typeof RANKS)[number]['id'];

export const RANK_POINTS = { hit: 1, finisher: 4, perfectDodge: 10, shatter: 12, variety: 5 };
/** Счётчик ударов ×N гаснет через 3 с без ударов (и при уроне). */
export const RANK_TIMEOUT = 3;
/**
 * Ранг тает постепенно (разбор): через grace с без ударов очки утекают со скоростью max(min, очки × frac) в
 * секунду — S → D примерно за 15 с, по ступени, а не обрывом. Урон — одна ступень вниз, а не сразу «D».
 */
export const RANK_DECAY = { grace: 2, frac: 0.15, min: 6 };
