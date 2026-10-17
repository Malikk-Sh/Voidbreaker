import { PLAYER_BASE } from '../data/player';

/** Итоговые характеристики героя после прокачки (GDD §8.2) и реликвий. */
export interface HeroStats {
  maxHp: number;
  atk: number;
  critChance: number;
  critMul: number;
  speed: number;
  atkSpeed: number;
  dashCharges: number;
  dashRecharge: number;
  armor: number;
  dmgBonus: number;
  abilityDmg: number;
  resGain: number;
  perfectWindow: number;
  cdr: number;
  executionHeal: number;
  secondWind: boolean;
  startResonance: number;
  /** Ловкость 10: рывок оставляет фиолетовый след с уроном. */
  dashTrail: boolean;
  /** Сила 10: удар 4 оставляет трещину. */
  riftCrack: boolean;
  /** Стойкость 20: после удара 1 с щита. */
  hurtShield: boolean;
  ultHeal: number;
  shardBonus: number;
  autoAim: number;
}

export function baseStats(): HeroStats {
  const B = PLAYER_BASE;
  return {
    maxHp: B.hp, atk: B.atk, critChance: B.critChance, critMul: B.critMul, speed: B.speed, atkSpeed: 1,
    dashCharges: B.dashCharges, dashRecharge: B.dashRecharge, armor: B.armor, dmgBonus: 0, abilityDmg: 0, resGain: 0,
    perfectWindow: B.perfectWindow, cdr: 0, executionHeal: 0.05, secondWind: false, startResonance: 0,
    dashTrail: false, riftCrack: false, hurtShield: false, ultHeal: 0, shardBonus: 0, autoAim: 1,
  };
}
