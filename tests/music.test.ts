import { describe, expect, it } from 'vitest';
import { HUNGER_SLIDE, MOTIF, TRITONE } from '../src/audio/music';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { GateGuardian } from '../src/world/boss/guardians';

describe('музыка (план §8.7)', () => {
  it('мотивы: Пилот D–E♭–F–D–C–D, Иерофант — тритон D–A♭, Голод — хроматика вниз', () => {
    expect(MOTIF).toEqual([62, 63, 65, 62, 60, 62]);
    expect(Math.abs(TRITONE[0] - TRITONE[1]) % 12).toBe(6);
    expect(TRITONE[0] % 12).toBe(2); // ре
    for (let i = 1; i < HUNGER_SLIDE.length; i++) expect(HUNGER_SLIDE[i] - HUNGER_SLIDE[i - 1]).toBe(-1);
  });

  it('фирменная атака Стража объявляет удар заранее — музыке хватает 0.5 с на тишину', () => {
    const w = new World(new Arena(ARENAS.gate), 'sig');
    w.hero.spawn(0, 4, Math.PI);
    const g = new GateGuardian({ zone: 0, stage: 2 });
    g.x = 0; g.z = -4;
    w.addEnemy(g);
    const got: number[] = [];
    w.bus.on('signature', (e) => got.push(e.impactIn));
    const combo = g.patterns.find((p) => p.id === 'combo')!;
    expect(combo.unstoppable).toBe(true);
    g.startPattern(combo);
    expect(got.length).toBe(1);
    expect(got[0]).toBeGreaterThan(0.5);
    // обычная атака — без тишины
    const plain = g.patterns.find((p) => !p.unstoppable && p.steps.some((s) => s.do === 'telegraph'))!;
    g.startPattern(plain);
    expect(got.length).toBe(1);
  });
});

import { stageSong, type Sequencer } from '../src/audio/music';
import { MUSIC_LEVEL } from '../src/game/battle';
import { BREATHER } from '../src/world/stage';
import { RISER_LEN } from '../src/audio/sfx';
import { Rng } from '../src/core/rng';

/** Заглушка секвенсора: записывает, что песня ставит в слои. */
function fakeSeq(final: boolean) {
  const bufs: string[] = [], lives: string[] = [];
  const s = { rng: new Rng(3), phase: 0, final, detuneCents: 0, buf: (n: string) => { bufs.push(n); }, live: (l: string) => { lives.push(l); } };
  return { s: s as unknown as Sequencer, bufs, lives };
}

describe('уровни музыки и последняя волна (план §8.7, пп. 2–4)', () => {
  it('уровни: между волнами только слой A, в бою — +B, финал — все слои', () => {
    expect(MUSIC_LEVEL.explore).toBeLessThan(0.2);
    expect(MUSIC_LEVEL.fight).toBeGreaterThanOrEqual(0.2);
    expect(MUSIC_LEVEL.fight).toBeLessThan(0.5);
    expect(MUSIC_LEVEL.final).toBeGreaterThanOrEqual(0.8);
  });

  it('последняя волна: скандирующий хор и «бумы» поверх темы; без неё — нет', () => {
    const song = stageSong('1-2');
    for (const final of [false, true]) {
      const f = fakeSeq(final);
      for (let step = 0; step < 16 * 16; step++) song.schedule(f.s, step, step * 0.1);
      const chants = f.bufs.filter((b) => b.startsWith('chant_')).length, booms = f.bufs.filter((b) => b === 'boom').length;
      if (final) { expect(chants).toBeGreaterThan(16); expect(booms).toBeGreaterThan(2); }
      else { expect(chants).toBe(0); expect(booms).toBe(0); }
    }
  });

  it('райзер помещается в передышку и пикует на открытии порталов', () => {
    expect(RISER_LEN).toBeLessThanOrEqual(BREATHER);
    expect(RISER_LEN).toBeGreaterThan(1);
  });
});
