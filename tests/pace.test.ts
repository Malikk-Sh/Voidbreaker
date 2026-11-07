import { afterEach, describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { Husk } from '../src/world/enemies/husk';
import { InputBuffer, type Input } from '../src/input/input';
import { HERO_PACE, PACE_CALM, PACE_CLASSIC, parsePace, usePace, type HeroPace } from '../src/data/pace';
import { PLAYER_BASE } from '../src/data/player';

/** Темп Пилота: серия медленнее и читаемее, урон в секунду прежний, рывок той же дальности. */
const DT = 1 / 60;
afterEach(() => usePace(PACE_CALM));

function mash(pace: HeroPace, sec: number, tapEvery = 6) {
  usePace(pace);
  const w = new World(new Arena(ARENAS.naves), 'pace');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 0, 0);
  w.hero.invulnUntil = 1e9;
  const e = new Husk({ zone: 0, stage: 0 });
  e.x = 0; e.z = 1.6; e.maxHp = e.hp = 1e7; w.addEnemy(e); e.setState('idle');
  (e as unknown as { think: () => void }).think = () => {};
  const input = { moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() } as unknown as Input;
  const starts: [number, string][] = [];
  w.bus.on('moveStart', (m) => starts.push([w.time, m.id]));
  for (let f = 0; f < sec * 60; f++) {
    input.now += DT;
    if (f % tapEvery === 0) input.buffer.push('attack', input.now);
    // цель — на месте, Пилот — у цели (отброс не уводит серию в пустоту)
    e.x = 0; e.z = 1.6; e.kbX = e.kbZ = 0;
    if (w.hero.state === 'move') { w.hero.x = 0; w.hero.z = 0; w.hero.facing = 0; }
    w.step(DT, DT, input);
  }
  return { dmg: 1e7 - e.hp, starts, w };
}

describe('темп Пилота (HERO_PACE)', () => {
  it('серия из четырёх ударов идёт заметно медленнее прежней, и каждый удар доигрывает проводку', () => {
    const calm = mash(PACE_CALM, 2), classic = mash(PACE_CLASSIC, 2);
    const rift = (r: typeof calm) => r.starts.find(([, id]) => id === 'rift')![0] - r.starts[0][0];
    expect(rift(classic)).toBeLessThan(0.42);
    expect(rift(calm)).toBeGreaterThan(rift(classic) * 1.5);
    // следующий удар — не раньше доли chainFrom длительности текущего (время клипа делится на темп)
    const gap = calm.starts[1][0] - calm.starts[0][0];
    expect(gap).toBeGreaterThanOrEqual(0.26 * PACE_CALM.chainFrom / PACE_CALM.attack - 1e-6);
  });

  it('урон в секунду при частых нажатиях почти прежний: каждый удар тяжелее во столько же раз', () => {
    const calm = mash(PACE_CALM, 8), classic = mash(PACE_CLASSIC, 8);
    expect(calm.dmg / classic.dmg).toBeGreaterThan(0.9);
    expect(calm.dmg / classic.dmg).toBeLessThan(1.1);
  });

  it('рывок той же дальности, но дольше; бег медленнее', () => {
    for (const pace of [PACE_CALM, PACE_CLASSIC]) {
      usePace(pace);
      const w = new World(new Arena(ARENAS.naves), 'dash');
      w.abilities = new Abilities(w);
      w.hero.spawn(0, -3, 0);
      const input = { moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() } as unknown as Input;
      input.buffer.push('dash', 0, 0, 1);
      let t = 0;
      for (; t < 1 && (t === 0 || w.hero.state === 'dash'); t += DT) { input.now += DT; w.step(DT, DT, input); }
      expect(w.hero.z + 3).toBeCloseTo(PLAYER_BASE.dashDist, 0);
      expect(t).toBeGreaterThanOrEqual(pace.dashTime);
      expect(t).toBeLessThan(pace.dashTime + 3 * DT);
    }
    expect(PACE_CALM.run).toBeLessThan(1);
  });

  it('?pace=classic — прежний темп, без параметра — новый', () => {
    expect(parsePace('?pace=classic')).toBe(PACE_CLASSIC);
    expect(parsePace('')).toBe(PACE_CALM);
    expect(HERO_PACE.attack).toBe(PACE_CALM.attack);
  });
});
