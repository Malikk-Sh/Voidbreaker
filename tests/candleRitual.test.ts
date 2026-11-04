import { describe, expect, it } from 'vitest';
import { BRAZIERS, CandleRitual, sectorAt } from '../src/world/candleRitual';

const light = (r: CandleRitual, i: number) => {
  const b = BRAZIERS[i];
  return r.step(0.61, b.x, b.z + r.centerZ);
};

describe('Погребальное сердце и возвращение огня', () => {
  it('один раз забирает свет по полному кругу, включая шов и дальние свечи', () => {
    const r = new CandleRitual(-55);
    expect(r.visibilityAt(0, -65)).toBe(1);
    expect(r.collect()).toBe(false);
    expect(r.start()).toBe(true);
    expect(r.start()).toBe(false);
    r.step(1.1, 0, -48);
    const half = Array.from({ length: 36 }, (_, i) => r.visibilityAt(Math.sin(i / 36 * Math.PI * 2) * 12, -55 + Math.cos(i / 36 * Math.PI * 2) * 12));
    expect(half.some(v => v === 0)).toBe(true);
    expect(half.some(v => v === 1)).toBe(true);
    r.step(1.2, 0, -48);
    expect(r.drain).toBe(1);
    for (const radius of [1, 8, 16, 45]) for (let i = 0; i <= 720; i++) {
      const a = i / 720 * Math.PI * 2;
      expect(r.visibilityAt(Math.sin(a) * radius, -55 + Math.cos(a) * radius), `${radius}, ${i}`).toBe(0);
    }
  });

  it('смерть врага даёт искру, близость без искры не зажигает жаровню', () => {
    const r = new CandleRitual(); r.start();
    expect(light(r, 0)).toBe(null);
    expect(r.lit).toEqual([false, false, false]);
    expect(r.collect()).toBe(true);
    const b = BRAZIERS[0];
    expect(r.step(0.3, b.x, b.z)).toBe(null);
    expect(r.charge).toBeCloseTo(0.5);
    expect(r.chargingIndex).toBe(0);
    expect(r.step(0.31, b.x, b.z)).toBe(0);
    expect(r.carried).toBe(0);
    expect(r.lit).toEqual([true, false, false]);
    expect(light(r, 0)).toBe(null);
  });

  it('возвращённый сектор остаётся светлым между волнами, остальные остаются тёмными', () => {
    const r = new CandleRitual(-55); r.start(); r.step(3, 0, -48);
    r.collect(); expect(light(r, 1)).toBe(1);
    for (let i = 0; i < BRAZIERS.length; i++) {
      const b = BRAZIERS[i];
      expect(sectorAt(b.x, b.z - 55, -55)).toBe(i);
      expect(r.visibilityAt(b.x, b.z - 55)).toBe(i === 1 ? 1 : 0);
    }
    r.step(45, 0, -48);
    expect(r.start()).toBe(false);
    expect(r.lit).toEqual([false, true, false]);
    expect(r.visibilityAt(7.2, -53)).toBe(1);
    expect(r.visibilityAt(-7.2, -53)).toBe(0);
  });

  it('три жаровни разрывают ритуал навсегда и посылают по одному событию', () => {
    const r = new CandleRitual(); r.start();
    expect([r.collect(), r.collect(), r.collect(), r.collect()]).toEqual([true, true, true, false]);
    const events = BRAZIERS.map((_, i) => light(r, i));
    expect(events).toEqual([0, 1, 2]);
    expect(r.broken).toBe(true); expect(r.active).toBe(false);
    expect(r.carried).toBe(0); expect(r.collect()).toBe(false);
    expect(r.start()).toBe(false);
    for (let i = 0; i < 36; i++) expect(r.visibilityAt(Math.sin(i) * 20, Math.cos(i) * 20)).toBe(1);
    expect(light(r, 2)).toBe(null);
  });

  it('пауза замораживает ход, а выход из круга и смена цели сбрасывают розжиг', () => {
    const r = new CandleRitual(); r.start(); r.collect();
    const [a,b] = BRAZIERS;
    r.step(0.3, a.x, a.z);
    const before = r.drain;
    r.step(0, a.x, a.z);
    expect(r.drain).toBe(before); expect(r.charge).toBeCloseTo(0.5);
    r.step(30, a.x, a.z, false);
    expect(r.drain).toBe(before); expect(r.charge).toBe(0);
    r.step(0.3, a.x, a.z); r.step(0.1, 0, 8);
    expect(r.charge).toBe(0); expect(r.chargingIndex).toBe(-1);
    r.step(0.3, a.x, a.z); r.step(0.3, b.x, b.z);
    expect(r.lit).toEqual([false, false, false]);
    expect(r.charge).toBeCloseTo(0.5); expect(r.chargingIndex).toBe(1);
    expect(r.step(0.31, b.x, b.z)).toBe(1);
  });

  it('обычная победа возвращает огонь без обязательного решения ритуала', () => {
    const r = new CandleRitual(); r.start(); r.step(3, 0, 8);
    r.collect(); r.finish();
    expect(r.active).toBe(false); expect(r.broken).toBe(true);
    expect(r.visibilityAt(0, -10)).toBe(1);
    expect(r.carried).toBe(0); expect(r.charge).toBe(0);
    expect(r.start()).toBe(false);
  });

  it('Сердце предупреждает перед ударом раз в 12 игровых секунд и не атакует на паузе', () => {
    const r = new CandleRitual(); r.start();
    r.step(9.7, 0, 8);
    expect(r.pulseCount).toBe(0); expect(r.warning).toBe(0);
    r.step(0.3, 0, 8);
    expect(r.warning).toBeGreaterThan(0); expect(r.warning).toBeLessThan(0.2);
    const warning = r.warning;
    r.step(30, 0, 8, false);
    expect(r.pulseCount).toBe(0); expect(r.warning).toBe(warning);
    r.step(2.01, 0, 8);
    expect(r.pulseCount).toBe(1); expect(r.warning).toBe(0);
    r.step(24, 0, 8);
    expect(r.pulseCount).toBe(3); expect(r.warning).toBe(0);
  });

  it('жаровни защищают свои сектора, а разрушенное Сердце больше не пульсирует', () => {
    const r = new CandleRitual(-55); r.start();
    expect(r.isSafeAt(-7.2, -53)).toBe(false);
    r.collect(); expect(light(r, 0)).toBe(0);
    expect(r.isSafeAt(-7.2, -53)).toBe(true);
    expect(r.isSafeAt(7.2, -53)).toBe(false);
    expect(r.isSafeAt(0, -62.7)).toBe(false);
    r.step(12, 0, -48); expect(r.pulseCount).toBe(1);
    r.collect(); r.collect(); expect(light(r, 1)).toBe(1); expect(light(r, 2)).toBe(2);
    const pulses = r.pulseCount;
    r.step(100, 0, -48);
    expect(r.pulseCount).toBe(pulses); expect(r.warning).toBe(0);
    expect(r.isSafeAt(7.2, -53)).toBe(true);
    expect(r.isSafeAt(0, -62.7)).toBe(true);
  });
});
