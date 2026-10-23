import { describe, expect, it } from 'vitest';
import { segmentBlocked, XRAY } from '../src/world/occlusion';
import { HERO_DIM } from '../src/vfx/particles';
import { ENEMY_WHITE } from '../src/render/enemyRenderer';

describe('читаемость боя (разбор)', () => {
  const col = { x: 0, z: 0, r: 0.7, h: XRAY.coverH };
  it('колонна между камерой и Пилотом закрывает его; сбоку, выше или вплотную — нет', () => {
    // камера сзади-сверху (+Z), Пилот за колонной (−Z)
    expect(segmentBlocked(0, 9, 12, 0, 1.25, -1.2, col)).toBe(true);
    expect(segmentBlocked(0, 9, 12, 2.5, 1.25, -1.2, col)).toBe(false);
    // камера очень высоко: луч проходит над капителью
    expect(segmentBlocked(0, 60, 2, 0, 1.25, -1.2, col)).toBe(false);
    // Пилот перед колонной (между ней и камерой)
    expect(segmentBlocked(0, 9, 12, 0, 1.25, 1.5, col)).toBe(false);
  });

  it('приглушение у Пилота: заметное, но не до нуля; белое у врагов — только на замахе', () => {
    expect(HERO_DIM.min).toBeGreaterThan(0.15);
    expect(HERO_DIM.min).toBeLessThan(0.6);
    expect(HERO_DIM.far).toBeGreaterThan(HERO_DIM.near);
    expect(ENEMY_WHITE).toBeLessThan(0.5);
    // на замахе (boost ≥ 1.2) — снова полностью белое: clamp(white + boost·0.6)
    expect(Math.min(1, ENEMY_WHITE + 1.2 * 0.6)).toBe(1);
  });
});
