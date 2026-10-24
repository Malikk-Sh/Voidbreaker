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

import { guardianSong, hierophantSong, hubSong } from '../src/audio/music';

describe('запечённые фразы и арфа (план §8.7, пп. 6–8)', () => {
  const songs = [...['1-1', '1-2', '1-3', '1-4', '1-5', '1-6'].map((id) => stageSong(id)), guardianSong('gateGuardian'), guardianSong('bellRinger'), hierophantSong(), hubSong()];
  it('всё, что тема ставит в слои, запечено; живых узлов — единицы на такт (орган, арфа Святилища)', () => {
    for (const song of songs) {
      for (const [phase, final] of [[0, false], [1, false], [1, true]] as const) {
        const f = fakeSeq(final);
        (f.s as unknown as { phase: number }).phase = phase;
        for (let step = 0; step < 16 * 32; step++) song.schedule(f.s, step, step * 0.1);
        for (const b of f.bufs) expect(song.bake[b], `${song.id}: ${b}`).toBeTruthy();
        expect(f.lives.length / 32, song.id).toBeLessThanOrEqual(2);
      }
    }
  });

  it('в боевых темах нет квадратного арпеджиатора: мелодия — арфа, раз в 8 тактов — лейтмотив', () => {
    const f = fakeSeq(false);
    const song = stageSong('1-1');
    for (let step = 0; step < 16 * 16; step++) song.schedule(f.s, step, step * 0.1);
    expect(f.bufs.some((b) => b.startsWith('harp_'))).toBe(true);
    expect(f.bufs.filter((b) => b === 'harpMotif').length).toBe(2);
    expect(f.bufs.some((b) => b.startsWith('bass_') && b.split('_').length === 3)).toBe(true);
  });
});

describe('синхронизация с боем (план §8.7, п. 9)', () => {
  it('ранг SS: медный акцент на каждую долю', () => {
    const song = stageSong('1-1');
    const count = (accent: boolean) => {
      const f = fakeSeq(false);
      (f.s as unknown as { accent: boolean }).accent = accent;
      for (let step = 0; step < 16 * 8; step++) song.schedule(f.s, step, step * 0.1);
      return f.bufs.filter((b) => b.startsWith('brass_')).length;
    };
    // 8 тактов × 4 доли — каждая с медью (часть — уже стабы темы)
    expect(count(true)).toBeGreaterThanOrEqual(32);
    expect(count(false)).toBeLessThan(count(true));
  });
});
