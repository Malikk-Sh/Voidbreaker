import type { FeelId } from './feel';

export type HitShape =
  | { shape: 'arc'; radius: number; angle: number }
  | { shape: 'circle'; radius: number; offset?: number }
  | { shape: 'line'; length: number; width: number };

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
  posture: number;
  knockback: number;
  feel: FeelId;
  lunge: number;
  finisher?: boolean;
  /** Несколько попаданий за удар (каждое hitOn сбрасывает список целей). */
  multi?: boolean;
  swing: 'light' | 'spin' | 'heavy' | 'stab';
}

export interface WeaponDef {
  id: string;
  name: string;
  combo: MoveDef[];
  flurry: MoveDef;
  lunge: MoveDef;
  charged: { minHold: number; fullHold: number; dmg: [number, number]; posture: [number, number]; length: number; width: number };
}

/** Клинок Пустоты — базовое оружие (GDD §5.2, §5.3). */
export const VOID_BLADE: WeaponDef = {
  id: 'void_blade',
  name: 'Клинок Пустоты',
  combo: [
    { id: 'slash1', clip: 'atk1', dur: 0.26, chain: [0.1, 0.4], dashCancelFrom: 0.13, hitbox: { shape: 'arc', radius: 2.2, angle: 120 }, dmg: 1.0, posture: 4, knockback: 1.5, feel: 'light', lunge: 0.6, swing: 'light' },
    { id: 'slash2', clip: 'atk2', dur: 0.26, chain: [0.1, 0.4], dashCancelFrom: 0.13, hitbox: { shape: 'arc', radius: 2.2, angle: 120 }, dmg: 1.0, posture: 4, knockback: 1.5, feel: 'light', lunge: 0.6, swing: 'light' },
    { id: 'spin', clip: 'spin', dur: 0.34, chain: [0.15, 0.45], dashCancelFrom: 0.2, hitbox: { shape: 'circle', radius: 2.4 }, dmg: 1.3, posture: 6, knockback: 2.2, feel: 'medium', lunge: 0.4, swing: 'spin' },
    { id: 'rift', clip: 'rift', dur: 0.48, chain: [0.48, 0.48], dashCancelFrom: 0.3, hitbox: { shape: 'circle', radius: 3.0, offset: 0.7 }, dmg: 2.2, posture: 14, knockback: 5, feel: 'heavy', lunge: 0.8, finisher: true, swing: 'heavy' },
  ],
  // Задержанное комбо: пауза 0.4–0.7 с между ударами 2 и 3 → «Шквал» (5 уколов по 0.45×, 2 слома каждый)
  flurry: { id: 'flurry', clip: 'flurry', dur: 0.55, chain: [0.45, 0.75], dashCancelFrom: 0.1, hitbox: { shape: 'line', length: 2.6, width: 1.4 }, dmg: 0.45, posture: 2, knockback: 0.6, feel: 'light', lunge: 0.5, multi: true, swing: 'stab' },
  // Рассечение: атака в течение 0.2 с после рывка → выпад 3 м, 1.5×, пробивает насквозь
  lunge: { id: 'lunge', clip: 'lunge', dur: 0.3, chain: [0.2, 0.45], dashCancelFrom: 0.12, hitbox: { shape: 'line', length: 3.6, width: 1.3 }, dmg: 1.5, posture: 8, knockback: 2.5, feel: 'medium', lunge: 3.0, swing: 'stab' },
  charged: { minHold: 0.45, fullHold: 0.9, dmg: [3.0, 4.5], posture: [20, 35], length: 6, width: 0.9 },
};

/** Магнетизм автоприцела (GDD §4.2). */
export const AIM = {
  cone: 70,
  radius: 6,
  radiusNoStick: 4,
  magnetRange: 2.5,
  magnetDist: 0.6,
};
