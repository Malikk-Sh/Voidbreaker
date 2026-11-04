import { describe, expect, it, vi } from 'vitest';
import { ARENAS } from '../src/data/arenas';
import { stageById } from '../src/data/stages';
import { BattleRewards } from '../src/game/battleRewards';
import { newSave, type SaveData } from '../src/meta/save';
import { Arena } from '../src/world/arena';
import { World } from '../src/world/world';

function setup() {
  const save = newSave();
  const commits: SaveData[] = [];
  const persist = vi.fn((s: SaveData) => { commits.push(structuredClone(s)); });
  const rewards = new BattleRewards(persist);
  const world = new World(new Arena(ARENAS.gate), 'checkpoint-reward');
  world.run.time = 80;
  world.run.shards = 40;
  world.run.ether = 2;
  world.rank.peakIdx = 3;
  world.rank.bestHits = 24;
  return { save, commits, persist, rewards, world };
}

describe('награды непрерывного прохождения', () => {
  it('сразу сохраняет Врата, лор и экипированное Затмение перед переходом', () => {
    const { save, commits, persist, rewards, world } = setup();
    const data = rewards.record(save, { cleared: true, world, stage: stageById('1-3')! }, save.settings);
    expect(data.result).toMatchObject({ stageId: '1-3', time: 80, bestCombo: 24, rank: 'A' });
    expect(data.reward).toMatchObject({ first: true, stars: 3, unlocks: ['eclipse'] });
    expect(data.lore).toBe('1-3');
    expect(persist).toHaveBeenCalledWith(save, true);
    expect(commits[0].stages['1-3']).toMatchObject({ clears: 1, stars: 3 });
    expect(commits[0].abilities.eclipse).toEqual({ level: 1 });
    expect(commits[0].loadout.r).toBe('eclipse');
    expect(commits[0].lore).toContain('1-3');
  });

  it('повторное событие в том же мире не начисляет награду второй раз', () => {
    const { save, persist, rewards, world } = setup();
    const outcome = { cleared: true, world, stage: stageById('1-3')! };
    const first = rewards.record(save, outcome, save.settings);
    const currencies = { ...save.currencies };
    world.run.time = 0;
    world.run.shards = 0;
    world.rank.bestHits = 0;
    expect(rewards.record(save, outcome, save.settings)).toBe(first);
    expect(save.currencies).toEqual(currencies);
    expect(save.stages['1-3'].clears).toBe(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(first.run).toMatchObject({ time: 80, shards: 40 });
    expect(first.bestCombo).toBe(24);
  });

  it('поражение в Свечном зале сохраняет награду Врат и даёт только половину новых осколков', () => {
    const { save, commits, persist, rewards, world } = setup();
    rewards.record(save, { cleared: true, world, stage: stageById('1-3')! }, save.settings);
    const checkpoint = structuredClone(save);
    world.hero.hp = 0;
    world.run.time = 30;
    world.run.shards = 25;
    world.run.ether = 3;
    const data = rewards.record(save, { cleared: false, world, stage: stageById('1-4')! }, save.settings);
    expect(data.reward).toMatchObject({ shards: 13, ether: 0, stars: 0, unlocks: [] });
    expect(save.stages['1-3']).toEqual(checkpoint.stages['1-3']);
    expect(save.stages['1-4'].clears).toBe(0);
    expect(save.currencies).toEqual({ ...checkpoint.currencies, shards: checkpoint.currencies.shards + 13 });
    expect(save.loadout.r).toBe('eclipse');
    expect(save.lore).toEqual(['1-3']);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(commits[1].stages['1-3'].clears).toBe(1);
  });

  it('новое прохождение в другом мире получает повторную награду', () => {
    const { save, rewards, world } = setup();
    const stage = stageById('1-3')!;
    const first = rewards.record(save, { cleared: true, world, stage }, save.settings);
    const nextWorld = new World(new Arena(ARENAS.gate), 'checkpoint-replay');
    const repeated = rewards.record(save, { cleared: true, world: nextWorld, stage }, save.settings);
    expect(save.stages['1-3'].clears).toBe(2);
    expect(repeated.reward.first).toBe(false);
    expect(repeated.reward.shards).toBeGreaterThan(0);
    expect(repeated.reward.shards).toBeLessThan(first.reward.shards);
    expect(repeated.lore).toBeUndefined();
    expect(save.lore).toEqual(['1-3']);
  });

  it('обычный финал с обучением прокачке сохраняет бесплатную Силу один раз', () => {
    const { save, rewards, world } = setup();
    const outcome = { cleared: true, world, stage: stageById('1-5')! };
    rewards.record(save, outcome, save.settings);
    rewards.record(save, outcome, save.settings);
    expect(save.flags.freePower).toBe(true);
    expect(save.stats.power).toBe(1);
  });
});
