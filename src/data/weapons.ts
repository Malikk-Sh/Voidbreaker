import type { FeelId } from './feel';

export type HitShape =
  | { shape: 'arc'; radius: number; angle: number }
  | { shape: 'circle'; radius: number; offset?: number }
  | { shape: 'line'; length: number; width: number };

/** Линейный хитбокс начинается чуть позади Пилота (м): укол цепляет вплотную стоящего. След штриха — оттуда же. */
export const LINE_BACK = 0.3;

/**
 * Источник оглушения (план §5.5): у Стражей и боссов вне окна уязвимости лёгкие и финишеры дают ¼,
 * заряд — ⅓, Контрудар — полностью, украденный снаряд — ×2.5.
 */
export type StunKind = 'light' | 'finisher' | 'charged' | 'counter' | 'stolen' | 'other';

/** Удар мувсета (Tech §15.1). Окно активного хитбокса — из событий клипа hitOn/hitOff. */
export interface MoveDef {
  id: string;
  clip: string;
  dur: number;
  /** Окно продолжения комбо (от начала удара). */
  chain: [number, number];
  /** Отмена в рывок разрешена с этого момента (и всегда в первые 60 мс). */
  dashCancelFrom: number;
  hitbox: HitShape;
  dmg: number;
  /** Наполнение шкалы оглушения (элита; Стражи и боссы — по StunKind). */
  stun: number;
  /** Источник оглушения; по умолчанию финишер → 'finisher', иначе 'light'. */
  stunKind?: StunKind;
  knockback: number;
  feel: FeelId;
  lunge: number;
  finisher?: boolean;
  /** Несколько попаданий за удар (каждое hitOn сбрасывает список целей). */
  multi?: boolean;
  swing: 'light' | 'spin' | 'heavy' | 'stab';
  /** Подбросить рядовых врагов (высота, м). */
  launch?: number;
  /** Ударная волна клинка: летит вперёд и пробивает (множитель урона, дальность, радиус). */
  wave?: { mult: number; dist: number; r: number };
  /** Финишер ветки: после него комбо начинается заново. */
  noChain?: boolean;
  /** Мгновенный рывок сквозь цель (Контрудар). */
  blink?: boolean;
  /**
   * Куда клинок идёт поперёк цели (вид от Пилота): 1 — слева направо, −1 — справа налево. Цель отшатывается
   * и проворачивается по ходу клинка (этап 4.5, B2); без поля реакция — по линии удара.
   */
  sweep?: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  combo: MoveDef[];
  flurry: MoveDef;
  lunge: MoveDef;
  /** Ветки комбо: Рассечение → Восходящий месяц → Звездопад; Шквал → Крест; Контрудар после идеального уклонения. */
  rising: MoveDef;
  /** Небесный разрез: прыжок к подброшенному врагу и два удара в воздухе (план §6.5). */
  skycut: MoveDef;
  skyfall: MoveDef;
  cross: MoveDef;
  counter: MoveDef;
  charged: { minHold: number; fullHold: number; dmg: [number, number]; stun: [number, number]; length: number; width: number };
}

/** Клинок Пустоты — базовое оружие (GDD §5.2, §5.3). */
export const VOID_BLADE: WeaponDef = {
  id: 'void_blade',
  name: 'Клинок Пустоты',
  combo: [
    { id: 'slash1', clip: 'atk1', dur: 0.26, chain: [0.1, 0.4], dashCancelFrom: 0.13, hitbox: { shape: 'arc', radius: 2.2, angle: 120 }, dmg: 1.0, stun: 4, knockback: 1.5, feel: 'light', lunge: 0.6, swing: 'light' },
    { id: 'slash2', clip: 'atk2', dur: 0.26, chain: [0.1, 0.4], dashCancelFrom: 0.13, hitbox: { shape: 'arc', radius: 2.2, angle: 120 }, dmg: 1.0, stun: 4, knockback: 1.5, feel: 'light', lunge: 0.6, swing: 'light' },
    { id: 'spin', clip: 'spin', dur: 0.34, chain: [0.15, 0.45], dashCancelFrom: 0.2, hitbox: { shape: 'circle', radius: 2.4 }, dmg: 1.3, stun: 6, knockback: 2.2, feel: 'medium', lunge: 0.4, swing: 'spin' },
    { id: 'rift', clip: 'rift', dur: 0.48, chain: [0.48, 0.48], dashCancelFrom: 0.3, hitbox: { shape: 'circle', radius: 3.0, offset: 0.7 }, dmg: 2.2, stun: 12, knockback: 5, feel: 'heavy', lunge: 0.8, finisher: true, noChain: true, swing: 'heavy' },
  ],
  // Задержанное комбо: пауза 0.4–0.7 с между ударами 2 и 3 → «Шквал» (5 уколов по 0.45×, по 2 оглушения)
  flurry: { id: 'flurry', clip: 'flurry', dur: 0.55, chain: [0.38, 0.8], dashCancelFrom: 0.1, hitbox: { shape: 'line', length: 2.6, width: 1.4 }, dmg: 0.45, stun: 2, knockback: 0.6, feel: 'light', lunge: 0.5, multi: true, swing: 'stab' },
  // Рассечение: атака в течение 0.2 с после рывка → выпад 3 м, 1.5×, пробивает насквозь
  lunge: { id: 'lunge', clip: 'lunge', dur: 0.3, chain: [0.16, 0.5], dashCancelFrom: 0.12, hitbox: { shape: 'line', length: 3.6, width: 1.3 }, dmg: 1.5, stun: 6, knockback: 2.5, feel: 'medium', lunge: 3.0, swing: 'stab' },
  // Восходящий месяц: апперкот-разрез, подбрасывает рядовых
  rising: { id: 'rising', clip: 'rising', dur: 0.4, chain: [0.2, 0.6], dashCancelFrom: 0.18, hitbox: { shape: 'arc', radius: 2.4, angle: 140 }, dmg: 1.4, stun: 8, knockback: 0.8, feel: 'medium', lunge: 0.6, launch: 1.6, swing: 'heavy' },
  // Небесный разрез: прыжок к подброшенному и два разреза в воздухе; удары держат цель в воздухе
  skycut: { id: 'skycut', clip: 'skycut', dur: 0.46, chain: [0.3, 0.75], dashCancelFrom: 0.36, hitbox: { shape: 'arc', radius: 2.6, angle: 160 }, dmg: 1.1, stun: 6, knockback: 0, feel: 'medium', lunge: 2.4, multi: true, launch: 0.01, swing: 'spin' },
  // Звездопад: взлёт с переворотом и удар клинком в землю — волна осколков
  skyfall: { id: 'skyfall', clip: 'skyfall', dur: 0.62, chain: [0.62, 0.62], dashCancelFrom: 0.45, hitbox: { shape: 'circle', radius: 3.4, offset: 0.9 }, dmg: 2.8, stun: 14, knockback: 6, feel: 'heavy', lunge: 1.4, finisher: true, noChain: true, swing: 'heavy' },
  // Крест: два диагональных разреза крест-накрест
  cross: { id: 'cross', clip: 'cross', dur: 0.42, chain: [0.42, 0.42], dashCancelFrom: 0.28, hitbox: { shape: 'arc', radius: 2.6, angle: 150 }, dmg: 1.25, stun: 6, knockback: 3, feel: 'heavy', lunge: 0.7, multi: true, finisher: true, noChain: true, swing: 'heavy' },
  // Контрудар: после идеального уклонения — мгновенный рывок сквозь цель и разрез-вращение
  // этап 4.5, B2: разрез — разворот на 270° к цели, поэтому дуга 270° с центром на цели вместо круга 360°;
  // сектор 90° за спиной (сторона, откуда Пилот проскочил) клинок не проходит
  counter: { id: 'counter', clip: 'counter', dur: 0.38, chain: [0.2, 0.55], dashCancelFrom: 0.2, hitbox: { shape: 'arc', radius: 2.6, angle: 270 }, dmg: 2.4, stun: 20, stunKind: 'counter', knockback: 3, feel: 'heavy', lunge: 0, finisher: true, blink: true, sweep: 1, swing: 'spin' },
  charged: { minHold: 0.45, fullHold: 0.9, dmg: [3.0, 4.5], stun: [12, 30], length: 5, width: 1.4 },
};

/** Магнетизм автоприцела (GDD §4.2). */
export const AIM = {
  cone: 70,
  radius: 6,
  radiusNoStick: 4,
  magnetRange: 2.5,
  magnetDist: 0.6,
};
