import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { VOID_BLADE, type MoveDef } from '../src/data/weapons';
import { STUN_IMMUNE } from '../src/world/actor';
import { Hierophant } from '../src/world/boss/hierophant';
import { GateGuardian } from '../src/world/boss/guardians';
import { validatePattern } from '../src/world/boss/timeline';
import type { Enemy } from '../src/world/enemy';
import { Abilities } from '../src/world/abilities';
import { InputBuffer, type Input } from '../src/input/input';

const DT = 1 / 60;

function setup<T extends Enemy>(make: () => T, arena = 'hierophant'): { w: World; e: T; stuns: () => number; shatters: () => number } {
  const w = new World(new Arena(ARENAS[arena]), 'stun');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 6, Math.PI);
  w.hero.invulnUntil = 1e9;
  const e = make();
  e.x = 0; e.z = 0;
  w.addEnemy(e);
  e.setState('idle');
  let n = 0, sh = 0;
  w.bus.on('stun', () => n++);
  w.bus.on('shatter', () => sh++);
  return { w, e, stuns: () => n, shatters: () => sh };
}

/** Удар клинком с параметрами мува (как в Hero.performHit). */
function hit(w: World, e: Enemy, m: MoveDef, feel = m.feel): void {
  w.damageEnemy(e, { mult: m.dmg, stun: m.stun, stunKind: m.stunKind, knockback: m.knockback, feel, dirX: 0, dirZ: -1, source: 'blade', finisher: !!m.finisher });
}
const strike = (w: World, e: Enemy, i: number): void => hit(w, e, VOID_BLADE.combo[i]);
const idleInput = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
/** Прогнать отложенный разрез: мир почти стоит (×0.05), Раскол идёт по реальному времени. Возвращает реальные секунды. */
function runShatter(w: World, input = idleInput(), onStep?: (t: number) => void): number {
  let t = 0;
  while (w.shatterSeq && t < 3) { w.step(DT * 0.05, DT * 0.05, input, DT); t += DT; onStep?.(t); }
  return t;
}
/** Полный (или частичный) заряженный удар. */
function charged(w: World, e: Enemy, full = true): void {
  const C = VOID_BLADE.charged;
  w.damageEnemy(e, { mult: C.dmg[full ? 1 : 0], stun: C.stun[full ? 1 : 0], stunKind: 'charged', knockback: 3, feel: full ? 'heavy' : 'medium', dirX: 0, dirZ: -1, source: 'blade', finisher: true });
}

describe('оглушение (план §5.5)', () => {
  it('бот 60 с бьёт Иерофанта серией вне окон — 0 оглушений', () => {
    const { w, e, stuns } = setup(() => new Hierophant({ zone: 0, stage: 0 }));
    const times = VOID_BLADE.combo.map((m) => m.dur);
    let t = 0, next = 0, k = 0;
    while (t < 60) {
      e.idleT = 50; // босс не атакует: окон уязвимости нет
      if (t >= next) { strike(w, e, k % 4); next += times[k % 4]; k++; }
      e.step(w, DT);
      t += DT;
    }
    expect(k).toBeGreaterThan(150);
    expect(stuns()).toBe(0);
    expect(e.stun!.value).toBeLessThan(e.stun!.max * 0.6);
  });

  it(`после оглушения ${STUN_IMMUNE} с шкала не растёт; следующий порог ×1.3, оглушение короче на 0.5 с`, () => {
    const { w, e, stuns } = setup(() => new Hierophant({ zone: 0, stage: 0 }));
    const S = e.stun!;
    e.idleT = 50;
    S.value = S.max - 1;
    e.vulnerableT = 5; // окно уязвимости
    strike(w, e, 3);
    expect(stuns()).toBe(1);
    expect(e.stunned).toBe(true);
    expect(S.total).toBeCloseTo(3.5);
    expect(S.max).toBeCloseTo(S.base * 1.3);
    expect(S.value).toBe(0);
    for (let t = 0; t < S.total + 0.05; t += DT) { e.idleT = 50; e.step(w, DT); }
    expect(e.stunned).toBe(false);
    expect(S.immune).toBeGreaterThan(STUN_IMMUNE - 0.2);
    for (let t = 0; t < STUN_IMMUNE - 0.3; t += DT) { e.idleT = 50; e.vulnerableT = 1; strike(w, e, 3); e.step(w, DT); }
    expect(S.value).toBe(0);
    for (let t = 0; t < 0.5; t += DT) { e.idleT = 50; e.step(w, DT); }
    e.vulnerableT = 1;
    strike(w, e, 3);
    expect(S.value).toBeGreaterThan(0);
    // второе оглушение: −0.5 с
    S.value = S.max - 1;
    strike(w, e, 3);
    expect(stuns()).toBe(2);
    expect(S.total).toBeCloseTo(3.0);
    expect(S.max).toBeCloseTo(S.base * 1.6);
  });

  it('вне окна Страж почти не копит шкалу, в окне — как элита; Контрудар — всегда полностью', () => {
    const { w, e } = setup(() => new GateGuardian({ zone: 0, stage: 2 }), 'gate');
    const S = e.stun!;
    strike(w, e, 0);
    expect(S.value).toBeCloseTo(1);
    S.value = 0; e.vulnerableT = 1;
    strike(w, e, 0);
    expect(S.value).toBeCloseTo(4);
    S.value = 0; e.vulnerableT = 0;
    hit(w, e, VOID_BLADE.counter);
    expect(S.value).toBeCloseTo(20);
    S.value = 0;
    charged(w, e);
    expect(S.value).toBeCloseTo(10);
  });

  it('неудержимый паттерн не прерывается оглушением — оглушение наступает после него', () => {
    const { w, e, stuns } = setup(() => new GateGuardian({ zone: 0, stage: 2 }), 'gate');
    const g = e as GateGuardian;
    g.phase = 2;
    const combo = g.patterns.find((p) => p.id === 'combo')!;
    expect(combo.unstoppable).toBe(true);
    g.startPattern(combo);
    g.stun!.value = g.stun!.max - 1; g.vulnerableT = 1;
    strike(w, g, 3);
    expect(stuns()).toBe(0);
    expect(g.stunQueued).toBe(true);
    expect(g.cur?.id).toBe('combo');
    let t = 0;
    while (g.cur && t < 10) { g.step(w, DT); t += DT; }
    expect(g.cur).toBeNull();
    g.step(w, DT);
    expect(stuns()).toBe(1);
    expect(g.stunned).toBe(true);
  });

  it('после оглушения Страж первым делом отталкивает рёвом (телеграф ≥ 0.8 с)', () => {
    const { w, e } = setup(() => new GateGuardian({ zone: 0, stage: 2 }), 'gate');
    const g = e as GateGuardian;
    w.stunEnemy(g);
    expect(g.state).toBe('stunned');
    let t = 0;
    while (g.stunned && t < 10) { g.step(w, DT); t += DT; }
    for (let i = 0; i < 3; i++) g.step(w, DT);
    expect(g.cur?.id).toBe('awaken');
    expect(validatePattern(g.awakenPattern(), 0.8)).toBeNull();
  });

  it('бот, играющий от окон, оглушает Иерофанта хотя бы дважды за фазу I', () => {
    const { w, e, stuns } = setup(() => new Hierophant({ zone: 0, stage: 0 }));
    e.phase = 1; e.idleT = 1;
    const h = w.hero as unknown as { perfectBuff: boolean };
    const times = VOID_BLADE.combo.map((m) => m.dur);
    let t = 0, next = 0, k = 0, dodgeT = 8;
    while (t < 60) {
      // серия без перерыва; раз в 15 с — идеальное уклонение и Контрудар
      if (t >= dodgeT && e.cur && !e.stunned) {
        dodgeT = t + 15;
        w.addStunTo(e, 10);
        h.perfectBuff = true;
        hit(w, e, VOID_BLADE.counter);
        next = t + VOID_BLADE.counter.dur;
      } else if (t >= next) { strike(w, e, k % 4); next = t + times[k % 4]; k++; }
      // Аколиты Проповеди — приоритетная цель: пока живы, щит режет и урон, и оглушение
      for (const a of e.summoned) if (!a.dead) w.killEnemy(a, 0, 1, 3);
      e.step(w, DT);
      t += DT;
    }
    expect(stuns()).toBeGreaterThanOrEqual(2);
    expect(e.phase).toBe(1);
  });

  it('Раскол — только по оглушённой цели, один раз за оглушение; частичный заряд не раскалывает', () => {
    const { w, e, shatters } = setup(() => new GateGuardian({ zone: 0, stage: 2 }), 'gate');
    strike(w, e, 3);
    expect(w.shatterSeq).toBeNull();
    w.stunEnemy(e);
    charged(w, e, false);
    expect(w.shatterSeq).toBeNull();
    expect(e.stunned).toBe(true);
    strike(w, e, 3);
    expect(w.shatterSeq?.target).toBe(e);
    strike(w, e, 3); // второй финишер во время разреза — не второй Раскол
    expect(runShatter(w)).toBeCloseTo(0.8, 1);
    expect(shatters()).toBe(1);
    expect(e.stunned).toBe(false);
    expect(e.stun!.immune).toBeGreaterThan(STUN_IMMUNE - 0.1);
    charged(w, e, true);
    strike(w, e, 3);
    expect(w.shatterSeq).toBeNull();
    expect(shatters()).toBe(1);
  });

  it('тяжёлый удар сбивает рядового с ног: две звезды на 0.6 с', async () => {
    const { Reaper } = await import('../src/world/enemies/reaper');
    const { w, e } = setup(() => new Reaper({ zone: 0, stage: 0 }), 'fall');
    let dazes = 0;
    w.bus.on('daze', () => dazes++);
    strike(w, e, 0);
    expect(e.dazeT).toBe(0);
    for (let i = 0; i < 30; i++) e.step(w, DT);
    strike(w, e, 3);
    expect(e.state).toBe('stagger');
    expect(e.dazeT).toBeCloseTo(0.6);
    expect(dazes).toBe(1);
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
    const got = w.heroStrike({ k: 'circle', x: 0, z: 0, r: 3 }, new Set(), { mult: 1, stun: 4, knockback: 1, feel: 'light', dirX: 0, dirZ: 1, source: 'blade', moveId: 'spin' });
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

describe('Раскол 2.0 — отложенный разрез (план §5.6)', () => {
  async function line(): Promise<{ w: World; g: Enemy; on: Enemy[]; off: Enemy; g2: Enemy; shatters: () => number; impactAt: () => number }> {
    const { Golem } = await import('../src/world/enemies/golem');
    const { Husk } = await import('../src/world/enemies/husk');
    const w = new World(new Arena(ARENAS.fall), 'shatter2');
    w.abilities = new Abilities(w);
    w.hero.spawn(0, 2, Math.PI);
    const put = (e: Enemy, x: number, z: number): Enemy => { e.x = x; e.z = z; w.addEnemy(e); e.setState('idle'); return e; };
    const g = put(new Golem({ zone: 0, stage: 0 }), 0, 0);
    const on = [put(new Husk({ zone: 0, stage: 0 }), 0.3, -3), put(new Husk({ zone: 0, stage: 0 }), -0.2, -6)];
    const off = put(new Husk({ zone: 0, stage: 0 }), 3, -3);
    const g2 = put(new Golem({ zone: 0, stage: 0 }), 0, -4.5);
    let n = 0, at = -1, t = 0;
    w.bus.on('shatter', () => { n++; if (at < 0) at = t; });
    w.bus.on('shatterStart', () => { t = 0; });
    w.stepHooks.push(() => { t += DT; });
    return { w, g, on, off, g2, shatters: () => n, impactAt: () => at };
  }

  it('урон через 0.45 с; линия 7 × 1.5 м — 2.5× и отброс, оглушённые на линии раскалываются цепочкой', async () => {
    const { w, g, on, off, g2, shatters, impactAt } = await line();
    w.stunEnemy(g); w.stunEnemy(g2);
    const hp0 = g.hp;
    hit(w, g, VOID_BLADE.combo[3]);
    const afterHit = g.hp;
    expect(hp0).toBeGreaterThan(afterHit);
    expect(shatters()).toBe(0);
    runShatter(w);
    expect(impactAt()).toBeGreaterThan(0.44);
    expect(impactAt()).toBeLessThan(0.5);
    expect(shatters()).toBe(2);
    expect(afterHit - g.hp).toBeGreaterThanOrEqual(Math.round(g.maxHp * 0.14) - 1);
    for (const h of on) expect(h.hp < h.maxHp || h.dead).toBe(true);
    expect(off.hp).toBe(off.maxHp);
    expect(g2.stunned).toBe(false);
  });

  it('герой неуязвим, пока идёт Раскол', async () => {
    const { w, g } = await line();
    w.stunEnemy(g);
    hit(w, g, VOID_BLADE.combo[3]);
    expect(w.enemyStrike(g, { k: 'circle', x: 0, z: 2, r: 3 }, 50, 3)).toBe('immune');
    runShatter(w);
    w.hero.invulnUntil = 0;
    expect(w.enemyStrike(g, { k: 'circle', x: 0, z: 2, r: 3 }, 1, 3)).toBe('hit');
  });

  it('первые два — полная версия, дальше короткая; «Короткие казни» — всегда коротко', async () => {
    const { w, g } = await line();
    const durs: number[] = [];
    w.bus.on('shatterStart', (e) => durs.push(e.dur));
    for (let i = 0; i < 3; i++) {
      g.stun!.stunned = 0; g.stun!.immune = 0;
      w.stunEnemy(g);
      hit(w, g, VOID_BLADE.combo[3]);
      runShatter(w);
    }
    w.shortShatters = true; w.fullShatters = 2;
    g.stun!.immune = 0; w.stunEnemy(g); hit(w, g, VOID_BLADE.combo[3]); runShatter(w);
    expect(durs).toEqual([0.6, 0.6, 0.4, 0.4]);
  });

  it('босс — всегда полная версия (1 с), пропуск рывком', () => {
    const { w, e, shatters } = setup(() => new Hierophant({ zone: 0, stage: 0 }));
    e.idleT = 50;
    w.shortShatters = true;
    w.stunEnemy(e);
    strike(w, e, 3);
    expect(w.shatterSeq?.dur).toBe(1.0);
    const input = idleInput();
    const t = runShatter(w, input, (t) => { if (t > 0.2 && t < 0.2 + DT) input.buffer.push('dash', input.now); });
    expect(t).toBeLessThan(0.3);
    expect(shatters()).toBe(1);
  });

  it('Страж после Раскола встаёт на колено, следующие 2 с атакует медленнее', () => {
    const { w, e } = setup(() => new GateGuardian({ zone: 0, stage: 2 }), 'gate');
    const g = e as GateGuardian;
    w.stunEnemy(g);
    strike(w, g, 3);
    runShatter(w);
    expect(g.kneelT).toBeGreaterThan(0.5);
    expect(g.slowT).toBeGreaterThan(2);
  });
});
