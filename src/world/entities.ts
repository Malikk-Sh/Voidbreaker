import type { Shape } from './combat';
import type { Enemy } from './enemy';

/**
 * Телеграф (GDD §15.8): красный контур формы атаки с заливкой от центра к краю,
 * заливка завершается ровно в момент удара. Белый — неблокируемая атака.
 */
export interface Telegraph {
  shape: Shape;
  t: number;
  dur: number;
  white: boolean;
  alive: boolean;
  /** После удара метка быстро гаснет. */
  fade: number;
  /** Высота метки над полом (для «колокола», падающего сверху, — тень). */
  shadow?: boolean;
  /** Кто поставил метку (враг, чей шаг шёл): по ней атаку повторяет «Тень». */
  owner?: Enemy | null;
  /** Метка-повтор «Тени» — тёмная. */
  echo?: boolean;
  /** Не атака (щит Аколита, псалм) — «Тень» её не повторяет. */
  buff?: boolean;
}

export type ProjectileKind = 'orb' | 'acolyteOrb' | 'stone' | 'needle' | 'censerBall' | 'censer' | 'wave' | 'ring';

/** Вражеский снаряд: ядро + ореол + хвост (GDD §16.1). */
export interface Projectile {
  kind: ProjectileKind;
  x: number; z: number; y: number;
  vx: number; vz: number;
  r: number;
  dmg: number;
  life: number;
  age: number;
  alive: boolean;
  /** Ушёл от героя через идеальное уклонение — больше не бьёт. */
  spent: boolean;
  /** Отражён героем (Купол / удар по Искре) — бьёт врагов. */
  reflected: boolean;
  owner: number;
  homing?: number;
  accel?: number;
}

/** Остающаяся зона урона: дым кадил, лава, трещина Силы. */
export interface Hazard {
  shape: Shape;
  t: number;
  dur: number;
  tick: number;
  tickT: number;
  dmg: number;
  hostile: boolean;
  kind: 'smoke' | 'lava' | 'crack' | 'trail';
  alive: boolean;
  hitList?: Set<number>;
}

/** Подбор: Осколки (фиолетовые кристаллы), Эфир (белое пламя), сфера лечения. */
export interface Pickup {
  kind: 'shard' | 'ether' | 'heal';
  x: number; z: number; y: number;
  vx: number; vy: number; vz: number;
  amount: number;
  age: number;
  alive: boolean;
  magnet: boolean;
}

/** Волна-кольцо (Звон колокола): расширяющееся кольцо с разрывами — пройти через разрыв или перепрыгнуть рывком. */
export interface RingWave {
  x: number; z: number;
  r: number; speed: number; accel: number; width: number; maxR: number;
  gaps: { a: number; w: number }[];
  dmg: number;
  hit: boolean;
  alive: boolean;
  owner: number;
}
