/**
 * Темп Пилота (отзыв: «замедлить игрока, чтобы лучше видеть атаку, комбо и удары по врагам, но играть было так же
 * приятно»). Раньше при частых нажатиях следующий удар срезал предыдущий через 0.1 с после начала — сам взмах длился
 * 40 мс, и четыре удара серии укладывались в 0.87 с.
 *
 * attack — скорость приёмов клинка: клипы, окна связки и отмены в рывок (1 — прежняя); chainFrom — следующий удар
 * серии начинается не раньше этой доли длительности текущего: замах успевает показать проводку, нажатие ждёт в буфере
 * ввода; weight — «вес» удара клинка: урон, оглушение, Резонанс и очки ранга за удар растут вместе с паузами, поэтому
 * урон в секунду и длительность боёв прежние; run — бег; accel/stop/turn — разгон, остановка и разворот (с, мягче —
 * без рывков); dashTime — рывок длится дольше, дальность прежняя; dashIframes — неуязвимость рывка (растёт вместе с ним);
 * hitstop — стоп-кадр попадания клинком (и его предел, с); stagger — хитстан рядовых от клинка, чтобы серия
 * по-прежнему держала их до конца; cast — скорость клипов способностей.
 *
 * `?pace=classic` — прежний темп (для сравнения).
 */
export interface HeroPace {
  attack: number; chainFrom: number; weight: number; run: number; accel: number; stop: number; turn: number;
  dashTime: number; dashIframes: number; hitstop: number; hitstopMax: number; stagger: number; cast: number;
}

export const PACE_CLASSIC: HeroPace = {
  attack: 1, chainFrom: 0, weight: 1, run: 1, accel: 0.06, stop: 0.05, turn: 0.08,
  dashTime: 0.18, dashIframes: 0.14, hitstop: 1, hitstopMax: 0.14, stagger: 1, cast: 1,
};

export const PACE_CALM: HeroPace = {
  attack: 0.85, chainFrom: 0.6, weight: 1.32, run: 0.9, accel: 0.09, stop: 0.08, turn: 0.12,
  dashTime: 0.22, dashIframes: 0.17, hitstop: 1.3, hitstopMax: 0.17, stagger: 1.45, cast: 0.9,
};

export function parsePace(search: string): HeroPace {
  const v = new URLSearchParams(search).get('pace');
  return v === 'classic' || v === 'fast' ? PACE_CLASSIC : PACE_CALM;
}

/** Действующий темп: из адреса при загрузке; usePace меняет его на лету (стенды и тесты сравнивают темпы). */
export const HERO_PACE: HeroPace = { ...parsePace(typeof location !== 'undefined' ? location.search : '') };
export function usePace(p: HeroPace): void { Object.assign(HERO_PACE, p); }
