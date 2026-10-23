import { describe, expect, it } from 'vitest';
import { AUTO_Q, autoQualityStep, newAutoQ } from '../src/game/game';

describe('автокачество (разбор: окно и устойчивая перегрузка)', () => {
  it('устойчиво тяжёлые кадры (1/30 с) снижают качество, ровные 60 Гц — нет', () => {
    const a = newAutoQ();
    let downs = 0;
    for (let i = 0; i < 600; i++) if (autoQualityStep(a, 1 / 30) === 'down') downs++;
    // 600 кадров по 1/30 = 20 с = 10 окон → минимум три снижения
    expect(downs).toBeGreaterThanOrEqual(3);
    const b = newAutoQ();
    let any = 0;
    for (let i = 0; i < 60 * 30; i++) if (autoQualityStep(b, 1 / 60) === 'down') any++;
    expect(any).toBe(0);
  });

  it('редкие фризы (один на окно) не снижают; долго ровно — разрешение вверх', () => {
    const a = newAutoQ();
    let downs = 0, ups = 0;
    for (let i = 0; i < 60 * 60; i++) {
      const r = autoQualityStep(a, i % 120 === 0 ? 0.08 : 1 / 60);
      if (r === 'down') downs++;
      if (r === 'up') ups++;
    }
    expect(downs).toBe(0);
    expect(ups).toBeGreaterThan(0);
    expect(AUTO_Q.downAfter * AUTO_Q.window).toBeLessThanOrEqual(8);
  });
});
