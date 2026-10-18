import { describe, expect, it } from 'vitest';
import { SFX } from '../src/audio/sfx';

describe('звук удара (план §5.2)', () => {
  it('у ударов и гибели нет «стеклянного» хвоста', () => {
    for (const id of ['hit_light', 'hit_medium', 'hit_heavy', 'hit_crowd', 'shatter', 'shatter_big', 'shatter_wet', 'shatter_stone', 'death', 'shatter_burst', 'well_boom', 'ult', 'phase']) {
      expect(SFX[id], id).toBeTruthy();
      expect(SFX[id].render.toString(), id).not.toMatch(/glassTail/);
    }
  });

  it('отправка ударов в реверберацию не больше 0.08, частые звуки — с вариантами', () => {
    for (const id of ['hit_light', 'hit_medium', 'hit_heavy', 'hit_crowd']) {
      expect(SFX[id].reverb ?? 0.08, id).toBeLessThanOrEqual(0.08);
    }
    expect(SFX.hit_light.variants).toBeGreaterThanOrEqual(5);
    expect(SFX.swing_light.variants).toBeGreaterThanOrEqual(5);
  });
});
