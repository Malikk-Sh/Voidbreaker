/** Ростер врагов (GDD §9.2). HP и урон — для зоны 1 (множитель 1.0). */
export type EnemyKind = 'spiker' | 'reaper' | 'eye' | 'golem' | 'acolyte' | 'gateGuardian' | 'bellRinger' | 'hierophant';

export interface EnemyDef {
  id: EnemyKind;
  name: string;
  hp: number;
  dmg: number;
  speed: number;
  radius: number;
  mass: number;
  height: number;
  posture?: number;
  breakDur?: number;
  armor?: number;
  /** Дроп Осколков (доля базы этапа распределяется по весу). */
  drop: number;
  ranged?: boolean;
  /** Получает хитстан от лёгких ударов (рядовые). */
  staggerable: boolean;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  spiker: { id: 'spiker', name: 'Шипник', hp: 20, dmg: 6, speed: 4.4, radius: 0.48, mass: 0.5, height: 1.1, drop: 1, staggerable: true },
  reaper: { id: 'reaper', name: 'Жнец', hp: 60, dmg: 14, speed: 4.0, radius: 0.6, mass: 1.1, height: 2.3, drop: 3, staggerable: true },
  eye: { id: 'eye', name: 'Око', hp: 45, dmg: 10, speed: 2.4, radius: 0.65, mass: 0.8, height: 2.6, drop: 3, ranged: true, staggerable: true },
  golem: { id: 'golem', name: 'Обсидиановый голем', hp: 260, dmg: 26, speed: 1.7, radius: 1.05, mass: 5, height: 3.3, posture: 40, breakDur: 1.8, drop: 8, staggerable: false },
  acolyte: { id: 'acolyte', name: 'Аколит Хора', hp: 70, dmg: 8, speed: 2.6, radius: 0.55, mass: 0.8, height: 2.5, drop: 4, ranged: true, staggerable: true },
  gateGuardian: { id: 'gateGuardian', name: 'Страж Врат', hp: 1350, dmg: 24, speed: 2.1, radius: 1.6, mass: 30, height: 5.2, posture: 120, breakDur: 2.4, armor: 0, drop: 30, staggerable: false },
  bellRinger: { id: 'bellRinger', name: 'Звонарь', hp: 1500, dmg: 22, speed: 2.4, radius: 1.4, mass: 30, height: 4.6, posture: 120, breakDur: 2.4, drop: 30, staggerable: false },
  hierophant: { id: 'hierophant', name: 'Иерофант Скорби', hp: 9000, dmg: 34, speed: 2.6, radius: 2.2, mass: 999, height: 7.5, posture: 300, breakDur: 2.8, drop: 0, staggerable: false },
};

export type Affix = 'hasted' | 'explosive' | 'chorus' | 'vampiric' | 'mirror' | 'burning' | 'gravity';

export const AFFIX_NAMES: Record<Affix, string> = {
  hasted: 'Ускоренный', explosive: 'Взрывной', chorus: 'Хор', vampiric: 'Вампирический', mirror: 'Зеркальный', burning: 'Пылающий', gravity: 'Гравитационный',
};

/** Масштабирование врагов (GDD §13.1): z — зона 0..4, s — этап 0..5. */
export function scaleHp(base: number, z: number, s: number, mode = 1): number {
  return base * Math.pow(2.1, z) * (1 + 0.12 * s) * mode;
}
export function scaleDmg(base: number, z: number, s: number, mode = 1): number {
  return base * Math.pow(1.75, z) * (1 + 0.08 * s) * mode;
}

/** Элита: ×3 HP, ×1.3 урон, красная аура, стойка (GDD §9.4). */
export const ELITE = { hp: 3, dmg: 1.3, posture: 60, scale: 1.25 };
