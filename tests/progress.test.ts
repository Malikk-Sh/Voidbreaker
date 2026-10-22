import { describe, expect, it } from 'vitest';
import { EMBLEM, litRays, starPoints } from '../src/ui/emblem';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { stageById } from '../src/data/stages';
import { StageRunner } from '../src/world/stage';
import { DEATH_SLOW } from '../src/game/feel';
import { POST_SILENCE, WAVE_END } from '../src/game/battle';

describe('эмблема прогресса и послебоевые моменты (план §8.8)', () => {
  it('эмблема: семь лучей, луч за каждого побеждённого босса, два последних тёмные', () => {
    expect(EMBLEM.rays).toBe(7);
    expect(EMBLEM.dark).toBe(2);
    expect(litRays({ stars: {} })).toBe(0);
    expect(litRays({ stars: { z1: 1 } })).toBe(1);
    expect(litRays({ stars: { z1: 2, z2: 1, z3: 0 } })).toBe(2);
    expect(starPoints(10).split(' ').length).toBe(14);
  });

  it('у раннера видно, остались ли невышедшие враги волны (последний враг — только когда их нет)', () => {
    const st = stageById('1-1')!;
    const w = new World(new Arena(ARENAS[st.arena]), 'wv');
    w.hero.spawn(0, 4, Math.PI);
    const r = new StageRunner(w, st);
    w.stepHooks.push((dt) => r.step(dt));
    r.skipTo(0);
    // только раннер: мир не шагаем — враги выходят и стоят, волна не кончается
    for (let t = 0; t < 0.4; t += 1 / 60) r.step(1 / 60);
    expect(r.phase).toBe('wave');
    const total = st.waves[0].spawns.reduce((n, s) => n + s.count, 0);
    // сразу после старта часть врагов ещё в очереди (задержки, интервал выхода)
    if (w.enemies.length < total) expect(r.spawnsPending).toBe(true);
    for (let t = 0; t < 12; t += 1 / 60) r.step(1 / 60);
    expect(r.spawnsPending).toBe(false);
  });

  it('смерть Пилота: замедление 0.5 с, затем осколки растворяются', () => {
    expect(DEATH_SLOW.sec).toBeCloseTo(0.5);
    const w = new World(new Arena(ARENAS.fall), 'dd');
    w.hero.spawn(0, 0, Math.PI);
    w.hero.die(0, 1);
    for (let t = 0; t < 0.5; t += 1 / 60) w.hero.update(1 / 60, null as never);
    expect(w.hero.avatar.puppet.dissolve).toBe(0);
    for (let t = 0; t < 1.6; t += 1 / 60) w.hero.update(1 / 60, null as never);
    expect(w.hero.avatar.puppet.dissolve).toBeGreaterThan(0.5);
  });

  it('последний враг волны: замедление 0.3 на 0.4 с с наездом 6 %; тишина после этапа — 2.5 с', () => {
    expect(WAVE_END).toEqual({ scale: 0.3, sec: 0.4, push: 0.06 });
    expect(POST_SILENCE).toBe(2.5);
  });
});
