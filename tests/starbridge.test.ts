import { describe, expect, it } from 'vitest';
import { ARENAS, inStar, nearestRay, starRay } from '../src/data/arenas';
import { Arena, TileState } from '../src/world/arena';
import { judgmentGroups, JUDGMENT } from '../src/world/boss/hierophant';

const ST = ARENAS.hierophant.star!;

describe('звёздный мост второй фазы (план)', () => {
  it('центр r = 5 м и семь лучей по 4.5 м', () => {
    expect(ST.r).toBe(5);
    expect(ST.rays).toBe(7);
    expect(ST.len).toBe(4.5);
    expect(inStar(ST, 0, 0)).toBe(true);
    expect(inStar(ST, 4.8, 0.5)).toBe(true);
    // конец каждого луча — на мосту, между лучами на том же радиусе — бездна
    for (let k = 0; k < ST.rays; k++) {
      const a = starRay(ST, k), b = a + Math.PI / ST.rays;
      expect(inStar(ST, Math.sin(a) * 9, Math.cos(a) * 9)).toBe(true);
      expect(inStar(ST, Math.sin(b) * 8, Math.cos(b) * 8)).toBe(false);
    }
  });

  it('обрушение оставляет звезду; Пилот (0, 6) на луче к камере', () => {
    const a = new Arena(ARENAS.hierophant);
    a.collapseOutsideCross();
    for (let i = 0; i < 900; i++) a.step(1 / 60);
    const alive = a.tiles.filter((t) => t.state === TileState.Alive);
    expect(alive.length).toBeGreaterThan(100);
    expect(alive.every((t) => t.cross)).toBe(true);
    expect(a.walkable(0, 6)).toBe(true);
    expect(nearestRay(ST, 0, 6)).toBe(0);
  });

  it('Приговор: сначала три луча с лучом Пилота, соседние — безопасны; затем остальные четыре', () => {
    for (let k = 0; k < ST.rays; k++) {
      const a = starRay(ST, k);
      const [g1, g2] = judgmentGroups(ST, Math.sin(a) * 7, Math.cos(a) * 7);
      expect(g1.length).toBe(3);
      expect(g2.length).toBe(4);
      expect(g1).toContain(k);
      expect(g2).toContain((k + 1) % ST.rays);
      expect(g2).toContain((k + ST.rays - 1) % ST.rays);
      expect(new Set([...g1, ...g2]).size).toBe(ST.rays);
    }
    // луч-удар уже луча-моста: на мосту рядом с ударом остаётся место
    expect(JUDGMENT.width).toBeLessThanOrEqual(ST.w);
    expect(JUDGMENT.gap).toBeGreaterThanOrEqual(0.8);
  });
});

import { createEnemy } from '../src/world/enemies/factory';

describe('прерванное появление', () => {
  it('сцена пропущена до конца портала — враг проявлен целиком, а не застыл полупрозрачным', () => {
    const e = createEnemy('husk', { zone: 0, stage: 0 });
    e.setState('spawn');
    e.puppet.dissolve = 0.6;
    e.setState('attack');
    expect(e.puppet.dissolve).toBe(0);
  });
});
