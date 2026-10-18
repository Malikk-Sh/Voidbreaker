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

describe('один отклик на взмах (план §5.1)', () => {
  it('взмах по 6 целям — ровно одно событие strike', async () => {
    const { Husk } = await import('../src/world/enemies/husk');
    const w = new World(new Arena(ARENAS.fall), 'strike');
    w.abilities = new Abilities(w);
    w.hero.spawn(0, 0, 0);
    for (let k = 0; k < 6; k++) {
      const e = new Husk({ zone: 0, stage: 0 });
      const a = (k / 6) * Math.PI * 2;
      e.x = Math.sin(a) * 1.2; e.z = Math.cos(a) * 1.2;
      w.addEnemy(e); e.setState('idle');
    }
    let strikes = 0, hits = 0, n = 0;
    w.bus.on('strike', (e) => { strikes++; n = e.n; });
    w.bus.on('hit', () => hits++);
    const got = w.heroStrike({ k: 'circle', x: 0, z: 0, r: 3 }, new Set(), { mult: 1, posture: 4, knockback: 1, feel: 'light', dirX: 0, dirZ: 1, source: 'blade', moveId: 'spin' });
    expect(got).toBe(6);
    expect(strikes).toBe(1);
    expect(n).toBe(6);
    expect(hits).toBe(6);
  });
});

describe('идеальное уклонение — уровни (план §5.4)', () => {
  it('тяжёлая атака Стража (телеграф ≥ 0.7 с) даёт heavy, рядовой — нет; враг запаздывает', async () => {
    const { Husk } = await import('../src/world/enemies/husk');
    const w = new World(new Arena(ARENAS.gate), 'pd');
    w.abilities = new Abilities(w);
    w.hero.spawn(0, 5, 0);
    const g = new GateGuardian({ zone: 0, stage: 2 });
    g.x = 0; g.z = 2; w.addEnemy(g); g.setState('idle');
    const hk = new Husk({ zone: 0, stage: 0 });
    hk.x = 1; hk.z = 5; w.addEnemy(hk); hk.setState('idle');
    const got: boolean[] = [];
    w.bus.on('perfectDodge', (e) => got.push(e.heavy));
    // рывок героя: окно идеального уклонения
    const h = w.hero as unknown as { state: string; dashStart: number; clock: number; perfectReadyAt: number };
    const dodge = () => { h.state = 'dash'; h.dashStart = h.clock; h.perfectReadyAt = 0; };
    g.lastTeleDur = 0.9; dodge();
    w.enemyStrike(g, { k: 'circle', x: 0, z: 5, r: 2 }, 10, 3);
    hk.lastTeleDur = 0.42; dodge();
    w.enemyStrike(hk, { k: 'circle', x: 0, z: 5, r: 2 }, 10, 3);
    expect(got).toEqual([true, false]);
    expect(hk.lagT).toBeCloseTo(0.2);
    expect(g.lagT).toBe(0);
  });
});
