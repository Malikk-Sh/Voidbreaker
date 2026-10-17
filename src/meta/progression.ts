import { ABILITY_LEVEL, type AbilityId } from '../data/abilities';
import { ZONE1, stageShards, type StageDef } from '../data/stages';
import type { RankId } from '../data/player';
import { baseStats, type HeroStats } from '../world/heroStats';
import type { SaveData } from './save';

export type Branch = 'power' | 'agility' | 'fortitude' | 'resonance';

/** Созвездие статов (GDD §8.2): 4 ветки по 40 уровней, вехи на 5 / 10 / 20 / 30. */
export const BRANCHES: Record<Branch, { name: string; per: string; icon: 'power' | 'agility' | 'fortitude' | 'resonance'; milestones: [number, string][] }> = {
  power: { name: 'Сила', per: '+5 % ATK', icon: 'power', milestones: [[5, '+15 % крит. урона'], [10, 'Удар 4 оставляет трещину'], [20, '+10 % урона'], [30, 'Финишер — двойная волна']] },
  agility: { name: 'Ловкость', per: '+1.5 % скорости атаки, +0.5 % крита', icon: 'agility', milestones: [[5, 'Окно идеального уклонения +30 мс'], [10, '+1 заряд рывка'], [20, 'Рывок оставляет след с уроном'], [30, 'КД рывка −20 %']] },
  fortitude: { name: 'Стойкость', per: '+6 % HP, +2 брони', icon: 'fortitude', milestones: [[5, 'Второе дыхание'], [10, 'Лечение от казней ×2'], [20, 'После удара 1 с щита'], [30, 'Иммунитет к отбрасыванию в комбо']] },
  resonance: { name: 'Резонанс', per: '+4 % урона способностей, +2 % набора Резонанса', icon: 'resonance', milestones: [[5, 'Старт этапа с 20 Резонанса'], [10, '−10 % КД'], [20, 'Ульта восстанавливает 15 % HP'], [30, 'Скидка на вторую ульту']] },
};

export const MAX_STAT = 40;

/** Стоимость уровня статов (GDD §8.3): 40 × 1.16^n. */
export function statCost(n: number): number { return Math.round(40 * Math.pow(1.16, n + 1)); }

/** Итоговые характеристики героя из прокачки. */
export function computeStats(s: SaveData, autoAim = 2): HeroStats {
  const st = baseStats();
  const { power: P, agility: A, fortitude: F, resonance: R } = s.stats;
  st.atk = st.atk * (1 + 0.05 * P);
  if (P >= 5) st.critMul += 0.15;
  if (P >= 10) st.riftCrack = true;
  if (P >= 20) st.dmgBonus += 0.1;
  st.atkSpeed = 1 + 0.015 * A;
  st.critChance += 0.005 * A;
  if (A >= 5) st.perfectWindow += 0.03;
  if (A >= 10) st.dashCharges += 1;
  if (A >= 20) st.dashTrail = true;
  if (A >= 30) st.dashRecharge *= 0.8;
  st.maxHp = Math.round(st.maxHp * (1 + 0.06 * F));
  st.armor += 2 * F;
  if (F >= 5) st.secondWind = true;
  if (F >= 10) st.executionHeal *= 2;
  if (F >= 20) st.hurtShield = true;
  st.abilityDmg += 0.04 * R;
  st.resGain += 0.02 * R;
  if (R >= 5) st.startResonance = 20;
  if (R >= 10) st.cdr += 0.1;
  if (R >= 20) st.ultHeal = 0.15;
  // реликвии
  for (const id of s.loadout.relics) applyRelic(st, id);
  st.autoAim = autoAim / 2;
  return st;
}

/** Реликвии (GDD §7.2) — пассивные эффекты. */
export const RELICS: Record<string, { name: string; desc: string }> = {
  hierophant_eye: { name: 'Глаз Иерофанта', desc: 'Идеальное уклонение длится на 0.3 с дольше.' },
  black_candle: { name: 'Чёрная Свеча', desc: '+1 заряд рывка, −10 % HP.' },
  star_shard: { name: 'Осколок Звезды', desc: '+15 % Осколков с этапов.' },
};

function applyRelic(st: HeroStats, id: string): void {
  switch (id) {
    case 'hierophant_eye': st.perfectWindow += 0.3; break;
    case 'black_candle': st.dashCharges += 1; st.maxHp = Math.round(st.maxHp * 0.9); break;
    case 'star_shard': st.shardBonus += 0.15; break;
  }
}

export function canBuyStat(s: SaveData, b: Branch): boolean {
  const lvl = s.stats[b];
  return lvl < MAX_STAT && s.currencies.shards >= statCost(lvl);
}

export function buyStat(s: SaveData, b: Branch): boolean {
  if (!canBuyStat(s, b)) return false;
  s.currencies.shards -= statCost(s.stats[b]);
  s.stats[b]++;
  return true;
}

/** Улучшение способности (GDD §8.4). */
export function abilityUpgradeCost(s: SaveData, id: AbilityId): { shards: number; ether: number } | null {
  const a = s.abilities[id];
  if (!a || a.level >= 3) return null;
  return { shards: ABILITY_LEVEL.costs[a.level], ether: ABILITY_LEVEL.etherCost[a.level] };
}

export function upgradeAbility(s: SaveData, id: AbilityId, mutation?: 'A' | 'B'): boolean {
  const c = abilityUpgradeCost(s, id);
  const a = s.abilities[id];
  if (!c || !a) return false;
  if (s.currencies.shards < c.shards || s.currencies.ether < c.ether) return false;
  s.currencies.shards -= c.shards; s.currencies.ether -= c.ether;
  a.level = (a.level + 1) as 1 | 2 | 3;
  if (a.level === 3) a.mutation = mutation ?? 'A';
  return true;
}

export function swapMutation(s: SaveData, id: AbilityId): boolean {
  const a = s.abilities[id];
  if (!a || a.level < 3 || s.currencies.ether < ABILITY_LEVEL.mutationSwap) return false;
  s.currencies.ether -= ABILITY_LEVEL.mutationSwap;
  a.mutation = a.mutation === 'A' ? 'B' : 'A';
  return true;
}

// ------------------------------------------------------------------ награды этапа (GDD §3.3, §8.5)
export interface StageResult {
  stageId: string;
  cleared: boolean;
  hpFrac: number;
  rank: RankId;
  rankMul: number;
  time: number;
  pickedShards: number;
  pickedEther: number;
  bestCombo: number;
  story: boolean;
}

export interface Reward {
  stars: 0 | 1 | 2 | 3;
  newStars: number;
  shards: number;
  ether: number;
  first: boolean;
  unlocks: AbilityId[];
  relic?: string;
}

export const RANK_ORDER: RankId[] = ['D', 'C', 'B', 'A', 'S', 'SS'];

export function globalIndex(def: StageDef): number { return def.zone * 6 + Math.min(5, def.index); }

export function computeReward(s: SaveData, def: StageDef, r: StageResult, shardBonus = 0): Reward {
  const prev = s.stages[def.id];
  const first = !prev || prev.clears === 0;
  let stars: 0 | 1 | 2 | 3 = 0;
  if (r.cleared) {
    stars = 1;
    if (r.hpFrac >= 0.5) stars = 2;
    if (stars === 2 && RANK_ORDER.indexOf(r.rank) >= RANK_ORDER.indexOf('A') && !r.story) stars = 3;
  }
  const prevStars = prev?.stars ?? 0;
  const base = stageShards(globalIndex(def)) * (def.boss ? 5 : 1);
  const stageBase = r.cleared ? (first ? base : base * 0.6) : 0;
  const shards = Math.round((stageBase + r.pickedShards) * r.rankMul * (1 + shardBonus));
  let ether = Math.round(r.pickedEther);
  if (stars === 3 && prevStars < 3) ether += 1;
  if (def.boss && first && r.cleared) ether += 5;
  return {
    stars, newStars: Math.max(0, stars - prevStars), shards, ether, first: first && r.cleared,
    unlocks: first && r.cleared ? def.unlocks ?? [] : [],
    relic: def.boss && first && r.cleared ? 'hierophant_eye' : undefined,
  };
}

export function applyReward(s: SaveData, def: StageDef, r: StageResult, rw: Reward): void {
  s.currencies.shards += rw.shards;
  s.currencies.ether += rw.ether;
  const prev = s.stages[def.id] ?? { stars: 0, bestRank: 'D', bestTime: 0, clears: 0 };
  if (r.cleared) {
    prev.clears++;
    prev.stars = Math.max(prev.stars, rw.stars) as 0 | 1 | 2 | 3;
    if (RANK_ORDER.indexOf(r.rank) > RANK_ORDER.indexOf(prev.bestRank as RankId)) prev.bestRank = r.rank;
    if (!prev.bestTime || r.time < prev.bestTime) prev.bestTime = r.time;
  }
  s.stages[def.id] = prev;
  for (const id of rw.unlocks) {
    if (!s.abilities[id]) s.abilities[id] = { level: 1 };
    // экипировать новое в пустой слот (Затмение → R, Колодец → E)
    if (id === 'eclipse' && !s.loadout.r) s.loadout.r = 'eclipse';
    if (id === 'well' && !s.loadout.e) s.loadout.e = 'well';
  }
  if (rw.relic && !s.relics.includes(rw.relic)) { s.relics.push(rw.relic); if (s.loadout.relics.length < 1) s.loadout.relics.push(rw.relic); }
  if (def.boss) {
    const b = s.bosses[def.id] ?? { defeated: false, attempts: 0, losses: 0 };
    b.attempts++;
    if (r.cleared) b.defeated = true; else b.losses++;
    s.bosses[def.id] = b;
  }
}

/** Звёзды зоны и открытие врат босса (GDD §3.4: 12 из 18). */
export function zoneStars(s: SaveData): number {
  return ZONE1.filter((d) => !d.boss).reduce((a, d) => a + (s.stages[d.id]?.stars ?? 0), 0);
}

export function stageUnlocked(s: SaveData, def: StageDef): boolean {
  if (def.index === 0) return true;
  if (def.boss) return zoneStars(s) >= 12 || !!s.flags.cheatGate;
  const prev = ZONE1[def.index - 1];
  return (s.stages[prev.id]?.clears ?? 0) > 0;
}

/** Всё, что можно улучшить, помечено фиолетовым ромбом в хабе (GDD §19.3). */
export function anyUpgradeAffordable(s: SaveData): boolean {
  return (['power', 'agility', 'fortitude', 'resonance'] as Branch[]).some((b) => canBuyStat(s, b));
}
