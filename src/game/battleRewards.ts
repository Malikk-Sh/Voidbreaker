import { LORE } from '../data/lore';
import { applyReward, computeReward, computeStats, type Reward, type StageResult } from '../meta/progression';
import { writeSave, type SaveData } from '../meta/save';
import type { Settings } from '../meta/settings';
import type { BattleOutcome } from './battle';

export interface BattleRewardData {
  stageId: string;
  cleared: boolean;
  result: StageResult;
  reward: Reward;
  lore?: string;
  run: BattleOutcome['world']['run'];
  bestCombo: number;
}

/** Saves each section immediately, even when the same battle continues across a bridge. */
export class BattleRewards {
  private recorded = new WeakMap<BattleOutcome['world'], Map<string, BattleRewardData>>();

  constructor(private persist: typeof writeSave = writeSave) {}

  record(s: SaveData, o: BattleOutcome, settings: Pick<Settings, 'story' | 'autoAim'>): BattleRewardData {
    let sections = this.recorded.get(o.world);
    const recorded = sections?.get(o.stage.id);
    if (recorded) return recorded;
    const w = o.world;
    const result: StageResult = {
      stageId: o.stage.id, cleared: o.cleared, hpFrac: w.hero.hp / w.hero.maxHp,
      rank: w.rank.stageRank(), rankMul: w.rank.stageRankMul(),
      time: w.run.time, pickedShards: w.run.shards, pickedEther: w.run.ether,
      bestCombo: w.rank.bestHits, story: settings.story,
    };
    const stats = computeStats(s, settings.autoAim);
    const reward: Reward = o.cleared
      ? computeReward(s, o.stage, result, stats.shardBonus)
      : { stars: 0, newStars: 0, shards: Math.round(w.run.shards * 0.5), ether: 0, first: false, unlocks: [], freeLevel3: false };
    const firstClear = o.cleared && !(s.stages[o.stage.id]?.clears);
    applyReward(s, o.stage, result, reward);
    let lore: string | undefined;
    if (firstClear && LORE[o.stage.id] && !s.lore.includes(o.stage.id)) {
      s.lore.push(o.stage.id);
      lore = o.stage.id;
    }
    if (o.stage.tutorial === 'upgrade' && firstClear && !s.flags.freePower) {
      s.flags.freePower = true;
      s.stats.power++;
    }
    const data: BattleRewardData = {
      stageId: o.stage.id, cleared: o.cleared, result, reward, lore,
      run: { ...w.run }, bestCombo: w.rank.bestHits,
    };
    if (!sections) {
      sections = new Map();
      this.recorded.set(w, sections);
    }
    sections.set(o.stage.id, data);
    this.persist(s, true);
    return data;
  }
}
