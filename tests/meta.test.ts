import { describe, expect, it } from 'vitest';
import { exportSave, importSave, migrate, newSave, type SaveData } from '../src/meta/save';
import {
  applyReward, buyStat, computeReward, computeStats, globalIndex, MAX_STAT, stageUnlocked, statCost, upgradeWeapon, weaponCost, zoneStars,
  type StageResult,
} from '../src/meta/progression';
import { stageById, stageShards, ZONE1 } from '../src/data/stages';

const result = (o: Partial<StageResult> = {}): StageResult => ({
  stageId: '1-1', cleared: true, hpFrac: 1, rank: 'A', rankMul: 1, time: 90, pickedShards: 0, pickedEther: 0, bestCombo: 30, story: false, ...o,
});

describe('формулы прогрессии (GDD §8)', () => {
  it('statCost = 100 × 1.22^(n+1): дорогие, но ощутимые уровни', () => {
    expect([0, 4, 9, 14, 19].map(statCost)).toEqual([122, 270, 730, 1974, 5336]);
    for (let n = 1; n < MAX_STAT; n++) expect(statCost(n)).toBeGreaterThan(statCost(n - 1));
  });

  it('stageShards совпадает с таблицей GDD §8.5', () => {
    expect([0, 5, 11, 17, 23, 29].map(stageShards)).toEqual([120, 330, 582, 834, 1086, 1338]);
  });

  it('weaponCost растёт геометрически', () => {
    expect(weaponCost(1)).toBe(320);
    expect(weaponCost(2)).toBe(480);
    expect(weaponCost(3)).toBeGreaterThan(weaponCost(2));
  });

  it('покупка стата списывает Осколки и меняет характеристики', () => {
    const s = newSave();
    const before = computeStats(s);
    expect(buyStat(s, 'power')).toBe(false);
    s.currencies.shards = 1000;
    expect(buyStat(s, 'power')).toBe(true);
    expect(s.currencies.shards).toBe(1000 - statCost(0));
    expect(s.stats.power).toBe(1);
    expect(computeStats(s).atk).toBeCloseTo(before.atk * 1.1);
  });

  it('улучшение оружия', () => {
    const s = newSave();
    s.currencies.shards = 500;
    expect(upgradeWeapon(s, 'void_blade')).toBe(true);
    expect(s.weapons.void_blade.level).toBe(2);
    expect(upgradeWeapon(s, 'void_blade')).toBe(false); // 180 < 480
    expect(upgradeWeapon(s, 'nope')).toBe(false);
  });
});

describe('награды этапа (GDD §3.3)', () => {
  const def = stageById('1-1')!;

  it('звёзды: прохождение, ≥ 50 % HP, ранг A+', () => {
    const s = newSave();
    expect(computeReward(s, def, result({ cleared: false })).stars).toBe(0);
    expect(computeReward(s, def, result({ hpFrac: 0.3 })).stars).toBe(1);
    expect(computeReward(s, def, result({ rank: 'B' })).stars).toBe(2);
    expect(computeReward(s, def, result()).stars).toBe(3);
    expect(computeReward(s, def, result({ story: true })).stars).toBe(2);
  });

  it('первое прохождение даёт полную базу, повтор — ×0.6, ранг множит', () => {
    const s = newSave();
    const base = stageShards(globalIndex(def));
    const r1 = computeReward(s, def, result({ rankMul: 1.2, pickedShards: 10 }));
    expect(r1.shards).toBe(Math.round((base + 10) * 1.2));
    expect(r1.first).toBe(true);
    expect(r1.ether).toBe(1); // первые ★★★
    applyReward(s, def, result(), r1);
    const r2 = computeReward(s, def, result());
    expect(r2.shards).toBe(Math.round(base * 0.6));
    expect(r2.first).toBe(false);
    expect(r2.ether).toBe(0);
    expect(r2.newStars).toBe(0);
  });

  it('поражение: база этапа не начисляется', () => {
    const r = computeReward(newSave(), def, result({ cleared: false, pickedShards: 40 }));
    expect(r.shards).toBe(40);
    expect(r.unlocks).toEqual([]);
  });

  // после трёх новых этапов: 18 из 27 звёзд (та же доля ⅔, что 12 из 18) и пройдены «Хоры»
  it('открытие этапов и врат босса (18 из 27 звёзд)', () => {
    const s = newSave();
    const boss = ZONE1.find((d) => d.boss)!;
    expect(stageUnlocked(s, ZONE1[0])).toBe(true);
    expect(stageUnlocked(s, ZONE1[1])).toBe(false);
    const regular = ZONE1.filter((x) => !x.boss);
    regular.forEach((d, i) => {
      const r = computeReward(s, d, result({ stageId: d.id, rank: 'B' }));
      applyReward(s, d, result({ stageId: d.id, rank: 'B' }), r);
      // до последнего этапа врата закрыты
      if (i < regular.length - 1) expect(stageUnlocked(s, boss)).toBe(false);
    });
    expect(zoneStars(s)).toBe(18);
    expect(stageUnlocked(s, ZONE1[1])).toBe(true);
    expect(stageUnlocked(s, boss)).toBe(true);
    // кто уже побеждал Иерофанта — врата открыты и без новых звёзд
    const old = newSave();
    old.stages[boss.id] = { ...(old.stages[boss.id] ?? {}), clears: 1 } as typeof old.stages[string];
    expect(stageUnlocked(old, boss)).toBe(true);
  });

  it('победа над боссом: Эфир, реликвия, учёт попыток', () => {
    const s = newSave();
    const boss = ZONE1.find((d) => d.boss)!;
    const lose = computeReward(s, boss, result({ stageId: boss.id, cleared: false }));
    applyReward(s, boss, result({ stageId: boss.id, cleared: false }), lose);
    expect(s.bosses[boss.id]).toMatchObject({ defeated: false, attempts: 1, losses: 1 });
    const win = computeReward(s, boss, result({ stageId: boss.id }));
    expect(win.ether).toBeGreaterThanOrEqual(5);
    expect(win.relic).toBe('hierophant_eye');
    applyReward(s, boss, result({ stageId: boss.id }), win);
    expect(s.bosses[boss.id].defeated).toBe(true);
    expect(s.relics).toContain('hierophant_eye');
  });
});

describe('сохранение (Tech §24)', () => {
  it('migrate дополняет старые сохранения значениями по умолчанию', () => {
    const old = { version: 1, currencies: { shards: 500 }, stats: { power: 3, agility: 40 } } as unknown as Partial<SaveData>;
    const s = migrate(old);
    expect(s.version).toBe(2);
    expect(s.currencies).toEqual({ shards: 500, ether: 0 });
    // v1 → v2: уровни статов пересчитаны ⌈n/2⌉
    expect(s.stats).toEqual({ power: 2, agility: 20, fortitude: 0, resonance: 0 });
    expect(migrate(s).stats.power).toBe(2);
    expect(s.loadout.weapon).toBe('void_blade');
    expect(s.abilities.crescent?.level).toBe(1);
    expect(s.settings).toBeTruthy();
    expect(s.lore).toEqual([]);
  });

  it('экспорт → импорт сохраняет данные (включая кириллицу)', () => {
    const s = newSave();
    s.currencies.shards = 1234;
    s.flags['пролог'] = true;
    s.stages['1-1'] = { stars: 3, bestRank: 'S', bestTime: 61.5, clears: 2 };
    const back = importSave(exportSave(s))!;
    expect(back).not.toBeNull();
    expect(back.currencies.shards).toBe(1234);
    expect(back.flags['пролог']).toBe(true);
    expect(back.stages['1-1']).toEqual(s.stages['1-1']);
  });

  it('повреждённая строка или неверная контрольная сумма отклоняются', () => {
    expect(importSave('not base64 at all ###')).toBeNull();
    const raw = JSON.stringify({ sum: 'bad', data: JSON.stringify(newSave()) });
    expect(importSave(btoa(raw))).toBeNull();
  });
});
