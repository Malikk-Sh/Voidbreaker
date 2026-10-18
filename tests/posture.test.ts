import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { VOID_BLADE } from '../src/data/weapons';
import { POSTURE_IMMUNE } from '../src/world/actor';
import { Hierophant } from '../src/world/boss/hierophant';
import { GateGuardian } from '../src/world/boss/guardians';
import type { Enemy } from '../src/world/enemy';
import { Abilities } from '../src/world/abilities';

const DT = 1 / 60;

function setup<T extends Enemy>(make: () => T, arena = 'hierophant'): { w: World; e: T; breaks: () => number } {
  const w = new World(new Arena(ARENAS[arena]), 'posture');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 6, Math.PI);
  const e = make();
  e.x = 0; e.z = 0;
  w.addEnemy(e);
  e.setState('idle');
  let n = 0;
  w.bus.on('postureBreak', () => n++);
  return { w, e, breaks: () => n };
}

/** Удар серией клинка с параметрами мува (как в Hero.performHit). */
function strike(w: World, e: Enemy, moveIdx: number): void {
  const m = VOID_BLADE.combo[moveIdx];
  w.damageEnemy(e, { mult: m.dmg, posture: m.posture, knockback: m.knockback, feel: m.feel, dirX: 0, dirZ: -1, source: 'blade', finisher: !!m.finisher });
}

describe('заплатка стойки (план §4.1)', () => {
  it('бот 60 с бьёт Иерофанта серией вне окон — стойка не ломается', () => {
    const { w, e, breaks } = setup(() => new Hierophant({ zone: 0, stage: 0 }));
    const times = VOID_BLADE.combo.map((m) => m.dur);
    let t = 0, next = 0, k = 0;
    while (t < 60) {
      e.idleT = 50; // босс не атакует: окон уязвимости нет
      if (t >= next) { strike(w, e, k % 4); next += times[k % 4]; k++; }
      e.step(w, DT);
      t += DT;
    }
    expect(k).toBeGreaterThan(150);
    expect(breaks()).toBe(0);
  });

  it(`после слома ${POSTURE_IMMUNE} с стойка не убывает`, () => {
    const { w, e, breaks } = setup(() => new Hierophant({ zone: 0, stage: 0 }));
    e.idleT = 50;
    const P = e.posture!;
    P.value = 1;
    e.postureMul = 2; // окно уязвимости
    strike(w, e, 3);
    expect(breaks()).toBe(1);
    e.postureMul = 1;
    // дождаться конца слома
    for (let t = 0; t < P.breakDur + 0.05; t += DT) { e.idleT = 50; e.step(w, DT); }
    expect(P.broken).toBe(0);
    expect(P.value).toBe(P.max);
    for (let t = 0; t < POSTURE_IMMUNE - 0.2; t += DT) { e.idleT = 50; strike(w, e, 3); e.step(w, DT); }
    expect(P.value).toBe(P.max);
    for (let t = 0; t < 0.4; t += DT) { e.idleT = 50; e.step(w, DT); }
    strike(w, e, 3);
    expect(P.value).toBeLessThan(P.max);
  });

  it('Раскол восстанавливает стойку полностью', () => {
    const { w, e } = setup(() => new GateGuardian({ zone: 0, stage: 2 }), 'gate');
    const P = e.posture!;
    P.value = 1; e.postureMul = 2;
    strike(w, e, 0);
    expect(P.broken).toBeGreaterThan(0);
    w.shatterEnemy(e, 0, -1);
    expect(P.broken).toBe(0);
    expect(P.value).toBe(P.max);
    expect(P.immune).toBe(POSTURE_IMMUNE);
  });

  it('неудержимый паттерн не прерывается сломом — слом наступает после него', () => {
    const { w, e, breaks } = setup(() => new GateGuardian({ zone: 0, stage: 2 }), 'gate');
    const g = e as GateGuardian;
    g.phase = 2;
    const combo = g.patterns.find((p) => p.id === 'combo')!;
    expect(combo.unstoppable).toBe(true);
    g.startPattern(combo);
    g.posture!.value = 1; g.postureMul = 2;
    strike(w, g, 3);
    expect(breaks()).toBe(0);
    expect(g.breakQueued).toBe(true);
    let t = 0;
    while (g.cur && t < 10) { g.step(w, DT); t += DT; }
    expect(g.cur).toBeNull();
    g.step(w, DT);
    expect(breaks()).toBe(1);
    expect(g.broken).toBe(true);
  });
});
