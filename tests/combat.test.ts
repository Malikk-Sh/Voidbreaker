import { describe, expect, it } from 'vitest';
import { armorReduction, computeDamage, overlaps, type Shape } from '../src/world/combat';
import { RankTracker } from '../src/world/rank';
import { RANK_DECAY, RANK_TIMEOUT } from '../src/data/player';

const ATK = { atk: 100, critChance: 0, critMul: 1.5, dmgBonus: 0 };
const mid = () => 0.5; // разброс ×1.0, без крита

describe('computeDamage (GDD §5.9)', () => {
  it('базовая формула без брони', () => {
    expect(computeDamage(ATK, 1.2, 0, false, mid)).toEqual({ dmg: 120, crit: false });
  });

  it('крит, трещина стойки, бонусы и броня перемножаются', () => {
    const r = computeDamage({ ...ATK, forceCrit: true, dmgBonus: 0.2 }, 1, 100, true, mid);
    // 100 × 1.2 × 1.5 (крит) × 1.25 (треснул) × 0.5 (броня 100) = 112.5
    expect(r).toEqual({ dmg: 113, crit: true });
  });

  it('разброс не выходит за ±5 % и урон не меньше 1', () => {
    expect(computeDamage(ATK, 1, 0, false, () => 0.999).dmg).toBeLessThanOrEqual(105);
    expect(computeDamage(ATK, 1, 0, false, () => 0.001).dmg).toBeGreaterThanOrEqual(95);
    expect(computeDamage({ ...ATK, atk: 0.1 }, 0.1, 900, false, mid).dmg).toBe(1);
  });

  it('armorReduction = броня / (броня + 100)', () => {
    expect(armorReduction(0)).toBe(0);
    expect(armorReduction(100)).toBe(0.5);
    expect(armorReduction(300)).toBe(0.75);
  });
});

describe('overlaps: формы хитбоксов', () => {
  it('circle', () => {
    const s: Shape = { k: 'circle', x: 0, z: 0, r: 2 };
    expect(overlaps(s, 2.4, 0, 0.5)).toBe(true);
    expect(overlaps(s, 2.6, 0, 0.5)).toBe(false);
  });

  it('arc учитывает направление и полуугол', () => {
    const s: Shape = { k: 'arc', x: 0, z: 0, r: 3, dir: 0, half: Math.PI / 4 }; // смотрит в +Z
    expect(overlaps(s, 0, 2.5, 0.3)).toBe(true);
    expect(overlaps(s, 0, -2.5, 0.3)).toBe(false);
    expect(overlaps(s, 2.5, 0.2, 0.3)).toBe(false);
    expect(overlaps(s, 0.1, 0.1, 0.3)).toBe(true); // вплотную — всегда попадание
  });

  it('line (OBB)', () => {
    const s: Shape = { k: 'line', x: 0, z: 0, dx: 1, dz: 0, len: 6, w: 1 };
    expect(overlaps(s, 3, 0.6, 0.3)).toBe(true);
    expect(overlaps(s, 3, 1.0, 0.3)).toBe(false);
    expect(overlaps(s, -0.5, 0, 0.3)).toBe(false);
    expect(overlaps(s, 6.2, 0, 0.3)).toBe(true);
  });

  it('ring: попадает только в кольцо, разрыв спасает', () => {
    const s: Shape = { k: 'ring', x: 0, z: 0, r0: 5, r1: 6, gaps: [{ a: 0, w: 1.2 }] };
    expect(overlaps(s, 0, 2, 0.4)).toBe(false);          // внутри кольца
    expect(overlaps(s, 5.5, 0, 0.4)).toBe(true);         // на кольце, не в разрыве (угол π/2)
    expect(overlaps(s, 0, 5.5, 0.4)).toBe(false);        // в разрыве (угол 0 = +Z)
    expect(overlaps(s, 0, 9, 0.4)).toBe(false);          // снаружи
    // у края разрыва радиус героя «цепляет» кольцо
    const edge = 0.6 + 0.02;
    expect(overlaps(s, Math.sin(edge) * 5.5, Math.cos(edge) * 5.5, 0.4)).toBe(true);
  });
});

describe('RankTracker (GDD §5.7)', () => {
  // разбор: ранг падает постепенно — урон снимает одну ступень, без ударов ранг тает (было: сразу «D»)
  it('растёт от ударов, урон — ступень вниз и счётчик ×N с нуля', () => {
    const r = new RankTracker();
    for (let i = 0; i < 15; i++) r.hit(false);
    expect(r.rank).toBe('C');
    r.perfectDodge(); r.perfectDodge(); r.shatter();
    expect(r.rank).toBe('B');
    r.hurt();
    expect(r.rank).toBe('C');
    expect(r.hits).toBe(0);
    r.hurt();
    expect(r.rank).toBe('D');
  });

  it('без ударов ранг тает по ступеням, а не обрывом', () => {
    const r = new RankTracker();
    r.bonus(150);
    expect(r.rank).toBe('S');
    r.step(RANK_DECAY.grace - 0.1);
    expect(r.rank).toBe('S');
    const seen: string[] = [];
    for (let t = 0; t < 30 && r.rank !== 'D'; t += 0.1) { r.step(0.1); if (seen[seen.length - 1] !== r.rank) seen.push(r.rank); }
    // прошёл каждую ступень вниз
    expect(seen).toEqual(['S', 'A', 'B', 'C', 'D']);
    // счётчик ×N погас после RANK_TIMEOUT
    expect(r.hits).toBe(0);
    void RANK_TIMEOUT;
  });

  it('разнообразие приёмов даёт бонус', () => {
    const r = new RankTracker();
    r.used('combo'); r.used('crescent'); r.used('dash');
    expect(r.points).toBe(10);
    r.used('dash');
    expect(r.points).toBe(10);
  });

  it('ранг этапа — взвешенный пик по волнам', () => {
    const r = new RankTracker();
    r.endWave(); // волна 1: D
    for (let i = 0; i < 50; i++) r.hit(i % 5 === 4);
    r.endWave(); // волна 2: пик A или выше
    expect(['B', 'A', 'S']).toContain(r.stageRank());
    expect(r.stageRankMul()).toBeGreaterThan(1);
  });

  it('сообщает о смене ранга', () => {
    const r = new RankTracker();
    const log: string[] = [];
    r.onRank = (id, up) => log.push(`${id}${up ? '+' : '-'}`);
    for (let i = 0; i < 15; i++) r.hit(false);
    r.hurt();
    expect(log).toEqual(['C+', 'D-']);
  });
});
