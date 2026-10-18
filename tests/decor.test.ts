import { describe, expect, it } from 'vitest';

/** Исходники игры как текст (Vite glob с ?raw). */
const SOURCES = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = (path: string): string => SOURCES[`../src/${path}`];

describe('символика мира (план §4.2–4.3)', () => {
  it('в проекте нет гексаграммы — только семиконечная звезда', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    for (const [f, s] of Object.entries(SOURCES)) expect(/hexagram|гексаграм/i.test(s), f).toBe(false);
    expect(src('vfx/ambient.ts')).toMatch(/k < 7/);
  });

  it('на плитах пола печати-звёзды, а не кресты; созвездия загораются', () => {
    const s = src('gen/zone/arenaView.ts');
    expect(s).not.toMatch(/гравировк\w* креста/);
    expect(s).toMatch(/starPlate\(7/);
    expect(s).toMatch(/lightConstellations/);
  });
});
