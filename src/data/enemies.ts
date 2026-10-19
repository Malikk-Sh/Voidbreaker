/** Ростер врагов (GDD §9.2). HP и урон — для зоны 1 (множитель 1.0). */
export type EnemyKind = 'husk' | 'spiker' | 'reaper' | 'crucifier' | 'eye' | 'golem' | 'acolyte' | 'psalmist' | 'gateGuardian' | 'bellRinger' | 'hierophant';

export interface EnemyDef {
  id: EnemyKind;
  name: string;
  hp: number;
  dmg: number;
  speed: number;
  radius: number;
  mass: number;
  height: number;
  /** Порог шкалы оглушения (план §5.5). */
  stun?: number;
  /** Длительность оглушения (с). */
  stunDur?: number;
  armor?: number;
  /** Дроп Осколков (доля базы этапа распределяется по весу). */
  drop: number;
  ranged?: boolean;
  /** Получает хитстан от лёгких ударов (рядовые). */
  staggerable: boolean;
}

/**
 * Сколько ударов держит враг (план §6.8) — при ATK 12 (старт), лёгкий удар 1.0×, серия 1+1+1.3+2.2:
 * | враг     | HP  | ударов на старте            | заметный рост                                   |
 * | Шелуха   | 20  | 2                           | 1 после 7 уровней Силы (ATK ≈ 20.4)             |
 * | Шипник   | 20  | 2                           | как Шелуха                                      |
 * | Око      | 45  | 4 — или один Серп и удар    | 3 с ATK ≈ 15                                    |
 * | Жнец     | 60  | одна полная серия (≈ 66)    | серия без финишера с ATK ≈ 20                   |
 * | Аколит   | 70  | серия и удар                | одна серия с ATK ≈ 13.5                         |
 * | Псаломщик | 60 | одна полная серия — если добежать: держит 7–9 м и уходит перезвоном |                 |
 * | Распинатель | 140 | две серии и удар — или оглушить (50) и Расколоть | одна серия и удар с ATK ≈ 20         |
 * | Голем    | 260 | ≈ 4 серии — дешевле оглушить и Расколоть (14 %) |                              |
 * Этапы добавляют +12 % HP за шаг (scaleHp), поэтому к 1-5 Шелуха снова держит два удара без прокачки.
 */
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  husk: { id: 'husk', name: 'Шелуха', hp: 20, dmg: 5, speed: 4.6, radius: 0.4, mass: 0.45, height: 1.45, drop: 0.5, staggerable: true },
  spiker: { id: 'spiker', name: 'Шипник', hp: 20, dmg: 6, speed: 4.4, radius: 0.48, mass: 0.5, height: 1.1, drop: 1, staggerable: true },
  reaper: { id: 'reaper', name: 'Жнец', hp: 60, dmg: 14, speed: 4.0, radius: 0.6, mass: 1.1, height: 2.3, drop: 3, staggerable: true },
  crucifier: { id: 'crucifier', name: 'Распинатель', hp: 140, dmg: 16, speed: 2.7, radius: 0.75, mass: 2.2, height: 2.8, stun: 50, stunDur: 2.0, drop: 5, staggerable: true },
  eye: { id: 'eye', name: 'Око', hp: 45, dmg: 10, speed: 2.4, radius: 0.65, mass: 0.8, height: 2.6, drop: 3, ranged: true, staggerable: true },
  golem: { id: 'golem', name: 'Обсидиановый голем', hp: 260, dmg: 26, speed: 1.7, radius: 1.05, mass: 5, height: 3.3, stun: 40, stunDur: 1.8, drop: 8, staggerable: false },
  acolyte: { id: 'acolyte', name: 'Аколит Хора', hp: 70, dmg: 8, speed: 2.6, radius: 0.55, mass: 0.8, height: 2.5, drop: 4, ranged: true, staggerable: true },
  psalmist: { id: 'psalmist', name: 'Псаломщик Голода', hp: 60, dmg: 9, speed: 3.2, radius: 0.5, mass: 0.7, height: 2.4, drop: 4, ranged: true, staggerable: true },
  gateGuardian: { id: 'gateGuardian', name: 'Страж Врат', hp: 1350, dmg: 24, speed: 2.1, radius: 1.6, mass: 30, height: 5.2, stun: 90, stunDur: 3.0, armor: 0, drop: 30, staggerable: false },
  bellRinger: { id: 'bellRinger', name: 'Звонарь', hp: 1500, dmg: 22, speed: 2.4, radius: 1.4, mass: 30, height: 4.6, stun: 90, stunDur: 3.0, drop: 30, staggerable: false },
  hierophant: { id: 'hierophant', name: 'Иерофант Скорби', hp: 9000, dmg: 34, speed: 2.6, radius: 2.2, mass: 999, height: 7.5, stun: 120, stunDur: 3.5, drop: 0, staggerable: false },
};

/**
 * Аффиксы элиты (план §7.6): «Отдача» и «Тень» (заменила «Зеркальный»). «Хор», «Пылающий», «Гравитационный» —
 * из GDD, пока не реализованы (TODO(design)).
 */
export type Affix = 'hasted' | 'explosive' | 'chorus' | 'vampiric' | 'recoil' | 'shadow' | 'burning' | 'gravity';

export const AFFIX_NAMES: Record<Affix, string> = {
  hasted: 'Ускоренный', explosive: 'Взрывной', chorus: 'Хор', vampiric: 'Вампирический', recoil: 'Отдача', shadow: 'Тень', burning: 'Пылающий', gravity: 'Гравитационный',
};

/** Отдача: заряды за удары, на 8 — красная волна r 3.5 (телеграф 0.7 с); уклонение сквозь неё — +20 Резонанса. */
export const RECOIL = { max: 8, r: 3.5, tele: 0.7, dodgeResonance: 20 };
/** Тень: копия повторяет каждую атаку через 0.6 с со своей позиции, 40 % урона. */
export const SHADOW = { delay: 0.6, dmg: 0.4, offset: 1.4 };

/** Масштабирование врагов (GDD §13.1): z — зона 0..4, s — этап 0..5. */
export function scaleHp(base: number, z: number, s: number, mode = 1): number {
  return base * Math.pow(2.1, z) * (1 + 0.12 * s) * mode;
}
export function scaleDmg(base: number, z: number, s: number, mode = 1): number {
  return base * Math.pow(1.75, z) * (1 + 0.08 * s) * mode;
}

/** Элита: ×3 HP, ×1.3 урон, красная аура, шкала оглушения 60 / 2.5 с (GDD §9.4, план §5.5). */
export const ELITE = { hp: 3, dmg: 1.3, stun: 60, stunDur: 2.5, scale: 1.25 };
