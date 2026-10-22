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
