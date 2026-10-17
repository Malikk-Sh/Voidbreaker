import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from '../src/core/rng';
import { Time } from '../src/core/time';
import { EventBus } from '../src/core/events';
import { InputBuffer, BUFFER } from '../src/input/input';
import { VerletCloth } from '../src/anim/verlet';

describe('Rng', () => {
  it('детерминирован по сиду (числовому и строковому)', () => {
    const a = new Rng('stage-1-1'), b = new Rng('stage-1-1'), c = new Rng('stage-1-2');
    const sa = Array.from({ length: 32 }, () => a.next());
    const sb = Array.from({ length: 32 }, () => b.next());
    const sc = Array.from({ length: 32 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    expect(new Rng(42).next()).toBe(new Rng(42).next());
  });

  it('выдаёт значения в [0, 1) и корректные диапазоны', () => {
    const r = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
      expect(Math.abs(r.spread(3))).toBeLessThanOrEqual(3);
    }
  });

  it('weighted игнорирует нулевые веса, shuffle сохраняет элементы', () => {
    const r = new Rng(1);
    for (let i = 0; i < 200; i++) expect(r.weighted(['a', 'b', 'c'], (x) => (x === 'b' ? 0 : 1))).not.toBe('b');
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect([...r.shuffle([...arr])].sort((x, y) => x - y)).toEqual(arr);
  });

  it('hashSeed стабилен', () => {
    expect(hashSeed('voidbreaker')).toBe(hashSeed('voidbreaker'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
});

describe('Time: hitstop и замедления', () => {
  it('ограничивает суммарный hitstop 120 мс за 250 мс', () => {
    const t = new Time();
    expect(t.addHitstop(0.08)).toBeCloseTo(0.08);
    expect(t.addHitstop(0.08)).toBeCloseTo(0.04);
    expect(t.addHitstop(0.05)).toBe(0);
    // окно сдвигается: через 0.3 с лимит снова доступен
    for (let i = 0; i < 18; i++) t.update(1 / 60);
    expect(t.addHitstop(0.06)).toBeCloseTo(0.06);
  });

  it('во время hitstop мир почти замирает, но не стоит', () => {
    const t = new Time();
    t.addHitstop(0.1);
    t.update(1 / 60);
    expect(t.worldScale).toBeGreaterThan(0);
    expect(t.worldScale).toBeLessThan(0.2);
    for (let i = 0; i < 10; i++) t.update(1 / 60);
    expect(t.worldScale).toBe(1);
  });

  it('берёт самое сильное замедление и отпускает его по таймеру', () => {
    const t = new Time();
    t.slow(0.5, 0.2);
    t.slow(0.2, 0.1, 0.6);
    t.update(1 / 60);
    expect(t.worldScale).toBe(0.2);
    expect(t.heroScale).toBe(0.6);
    for (let i = 0; i < 8; i++) t.update(1 / 60);
    expect(t.worldScale).toBe(0.5);
    for (let i = 0; i < 10; i++) t.update(1 / 60);
    expect(t.worldScale).toBe(1);
    expect(t.slowmoActive).toBe(false);
  });

  it('пауза обнуляет масштабы', () => {
    const t = new Time();
    t.paused = true;
    t.update(1 / 60);
    expect(t.worldScale).toBe(0);
    expect(t.heroScale).toBe(0);
  });
});

describe('EventBus', () => {
  it('доставляет события подписчикам и позволяет отписаться', () => {
    const bus = new EventBus<{ hit: { n: number } }>();
    const got: number[] = [];
    const off = bus.on('hit', (e) => got.push(e.n));
    bus.emit('hit', { n: 1 });
    off();
    bus.emit('hit', { n: 2 });
    expect(got).toEqual([1]);
  });
});

describe('InputBuffer', () => {
  it('хранит нажатие 150 мс и выдаёт его один раз', () => {
    const b = new InputBuffer();
    b.push('dash', 1.0, 0.5, -1);
    expect(b.peek('dash', 1.1)).toBe(true);
    expect(b.consume('dash', 1.1)).toEqual({ dx: 0.5, dz: -1 });
    expect(b.consume('dash', 1.1)).toBeNull();
  });

  it('просроченное нажатие не срабатывает', () => {
    const b = new InputBuffer();
    b.push('attack', 1.0);
    expect(b.consume('attack', 1.0 + BUFFER + 0.01)).toBeNull();
    b.push('q', 2.0);
    b.prune(2.5);
    expect(b.peek('q', 2.0)).toBe(false);
  });
});

describe('VerletCloth', () => {
  it('остаётся устойчивой: без NaN, длина ткани ограничена', () => {
    const c = new VerletCloth(3, 7, 0.12, 0.14);
    c.colliders.push({ x: 0.12, y: -0.4, z: 0.1, r: 0.2 });
    c.wind = 2;
    for (let s = 0; s < 600; s++) {
      const x = Math.sin(s * 0.05) * 2;
      for (let i = 0; i < 3; i++) c.setPinned(i, x + i * 0.12, 0, Math.cos(s * 0.07));
      c.step(1 / 60);
    }
    for (let k = 0; k < c.n * 3; k++) expect(Number.isFinite(c.p[k])).toBe(true);
    // нижний ряд не улетел дальше, чем позволяет длина (6 сегментов × 0.14 с запасом на растяжение)
    for (let i = 0; i < 3; i++) {
      const top = i * 3, bot = (6 * 3 + i) * 3;
      const d = Math.hypot(c.p[bot] - c.p[top], c.p[bot + 1] - c.p[top + 1], c.p[bot + 2] - c.p[top + 2]);
      expect(d).toBeLessThan(6 * 0.14 * 1.6);
    }
  });
});
