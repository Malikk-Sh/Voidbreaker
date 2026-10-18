import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { VOID_BLADE } from '../src/data/weapons';
import { Abilities } from '../src/world/abilities';
import { Reaper } from '../src/world/enemies/reaper';
import type { Enemy } from '../src/world/enemy';
import { InputBuffer, type Input } from '../src/input/input';
import { PLAYER_BASE } from '../src/data/player';

const DT = 1 / 60;

function setup(): { w: World; e: Enemy } {
  const w = new World(new Arena(ARENAS.fall), 'depth');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 2, Math.PI);
  w.hero.invulnUntil = 1e9;
  w.hero.stats.critChance = 0;
  w.hero.stats.atk = 100;
  const e = new Reaper({ zone: 0, stage: 0, hpMul: 50 });
  e.x = 0; e.z = 0;
  w.addEnemy(e); e.setState('idle');
  return { w, e };
}

const slash = (w: World, e: Enemy): void => {
  const m = VOID_BLADE.combo[0];
  w.damageEnemy(e, { mult: m.dmg, stun: m.stun, knockback: 0, feel: m.feel, dirX: 0, dirZ: -1, source: 'blade', noStagger: true });
};

describe('метки Пустоты (план §6.1)', () => {
  it('удар клинка кладёт метку, не больше 5; через 4 с без ударов гаснут', () => {
    const { w, e } = setup();
    for (let i = 0; i < 7; i++) slash(w, e);
    expect(e.marks).toBe(5);
    for (let t = 0; t < 3.9; t += DT) e.step(w, DT);
    expect(e.marks).toBe(5);
    for (let t = 0; t < 0.2; t += DT) e.step(w, DT);
    expect(e.marks).toBe(0);
  });

  it('способность-детонатор: +20 % урона за стопку, стопки снимаются', () => {
    const { w, e } = setup();
    let det = 0;
    w.bus.on('detonate', (d) => { det = d.stacks; });
    const hit = (): number => {
      const before = e.hp;
      w.damageEnemy(e, { mult: 1, stun: 0, knockback: 0, feel: 'light', dirX: 0, dirZ: -1, source: 'ability', noStagger: true, detonate: 0.2 });
      return before - e.hp;
    };
    const plain = hit();
    for (let i = 0; i < 5; i++) slash(w, e);
    const boosted = hit();
    expect(det).toBe(5);
    expect(e.marks).toBe(0);
    expect(boosted / plain).toBeGreaterThan(1.8);
    expect(boosted / plain).toBeLessThan(2.25);
  });

  it('метки видны трещинами по стопкам (фиолетовые — отрицательный crack)', () => {
    const { w, e } = setup();
    slash(w, e); e.step(w, DT);
    const one = e.puppet.crack;
    for (let i = 0; i < 4; i++) slash(w, e);
    e.step(w, DT);
    expect(one).toBeLessThan(0);
    expect(e.puppet.crack).toBeLessThan(one);
  });
});

const input = (mx = 0, mz = 0): Input => ({ moveX: mx, moveZ: mz, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;

describe('разломы на полу и скольжение (план §6.2)', () => {
  it('трещина живёт 3 с, одновременно не больше двух', () => {
    const { w } = setup();
    const ab = w.abilities as Abilities;
    ab.addFloorRift(0, 0, 0, 6); ab.addFloorRift(2, 0, 0, 6); ab.addFloorRift(4, 0, 0, 6);
    expect(ab.floorRifts.length).toBe(2);
    expect(ab.floorRifts[0].x).toBeCloseTo(2);
    for (let t = 0; t < 3.05; t += DT) ab.step(DT, DT);
    expect(ab.floorRifts.length).toBe(0);
  });

  function dash(along: boolean): { w: World; dist: number; charges: number; max: number; sliding: boolean; hit: boolean } {
    const { w, e } = setup();
    const h = w.hero;
    (w.abilities as Abilities).addFloorRift(0, -6, 0, 7);
    h.x = 0; h.z = -5;
    e.x = along ? 0 : 3; e.z = -3;
    const hp0 = e.hp;
    const inp = along ? input(0, 1) : input(1, 0);
    inp.buffer.push('dash', 0);
    w.step(DT, DT, inp);
    const sliding = h.sliding;
    const charges = h.dashCharges;
    for (let t = 0; t < PLAYER_BASE.dashTime + 0.05; t += DT) w.step(DT, DT, input());
    return { w, dist: Math.hypot(h.x, h.z + 5), charges, max: h.stats.dashCharges, sliding, hit: e.hp < hp0 };
  }

  it('рывок вдоль трещины — скольжение: +50 % дальности, заряд не тратится, разрез по пути', () => {
    const r = dash(true);
    expect(r.sliding).toBe(true);
    expect(r.charges).toBe(r.max);
    expect(r.dist).toBeGreaterThan(PLAYER_BASE.dashDist * 1.4);
    expect(r.hit).toBe(true);
  });

  it('рывок поперёк трещины — обычный', () => {
    const r = dash(false);
    expect(r.sliding).toBe(false);
    expect(r.charges).toBe(r.max - 1);
    expect(r.dist).toBeLessThan(PLAYER_BASE.dashDist * 1.1);
  });
});

describe('украденный импульс и мгновенный заряд (план §6.3)', () => {
  type HeroPriv = { state: string; dashStart: number; clock: number; perfectReadyAt: number; startCharge(): void; chargeLevel: number };
  const dodge = (w: World): void => { const h = w.hero as unknown as HeroPriv; h.state = 'dash'; h.dashStart = h.clock; h.perfectReadyAt = 0; };

  it('без идеального уклонения снаряд просто бьёт — украсть нельзя', () => {
    const { w } = setup();
    const h = w.hero;
    h.invulnUntil = 0;
    const hp = h.hp;
    w.spawnProjectile('needle', h.x, h.z + 0.2, 0, -1, 10, 999);
    w.step(DT, DT, input());
    expect(w.stolen.length).toBe(0);
    expect(h.hp).toBeLessThan(hp);
  });

  it('в окне идеального уклонения снаряд становится осколком; удар клинка отправляет его: 2× и +25 оглушения Стражу', async () => {
    const { GateGuardian } = await import('../src/world/boss/guardians');
    const { w, e } = setup();
    e.x = 8; // Жнец не на пути осколков
    const h = w.hero;
    h.invulnUntil = 0;
    const g = new GateGuardian({ zone: 0, stage: 2 });
    g.x = 0; g.z = -6; w.addEnemy(g); g.setState('idle'); g.idleT = 50;
    let perfect = 0;
    w.bus.on('perfectDodge', () => perfect++);
    dodge(w);
    w.spawnProjectile('needle', h.x, h.z + 0.2, 0, -1, 10, 999);
    w.step(DT, DT, input());
    expect(perfect).toBe(1);
    expect(w.stolen.length).toBe(1);
    // второй снаряд в окне после уклонения — тоже украден
    w.spawnProjectile('orb', h.x + 0.2, h.z, -1, 0, 10, 999);
    w.step(DT, DT, input());
    expect(w.stolen.length).toBe(2);
    const hp0 = g.hp;
    w.fireStolen(g);
    for (let t = 0; t < 1 && w.projectiles.some((p) => p.reflected); t += DT) w.step(DT, DT, input());
    expect(g.hp).toBeLessThan(hp0);
    expect(g.stun!.value).toBeGreaterThanOrEqual(49);
  });

  it('осколки гаснут через 2 с без удара', () => {
    const { w } = setup();
    w.stolen.push({ kind: 'needle', t: 0, a: 0 });
    for (let t = 0; t < 2.1; t += DT) w.step(DT, DT, input());
    expect(w.stolen.length).toBe(0);
  });

  it('после идеального уклонения удержание атаки — сразу полный заряд', () => {
    const { w } = setup();
    const h = w.hero as unknown as HeroPriv;
    dodge(w);
    w.spawnProjectile('needle', w.hero.x, w.hero.z + 0.2, 0, -1, 10, 999);
    w.step(DT, DT, input());
    h.state = 'move';
    h.startCharge();
    expect(h.chargeLevel).toBe(2);
    // без уклонения — с нуля
    const { w: w2 } = setup();
    const h2 = w2.hero as unknown as HeroPriv;
    h2.startCharge();
    expect(h2.chargeLevel).toBe(0);
  });
});

describe('отмены и подсказка ветки (план §6.4)', () => {
  /** Шаги героя с вводом; press — нажатия в начале. */
  function run(w: World, sec: number, inp = input()): void {
    for (let t = 0; t < sec; t += DT) { (inp as { now: number }).now += DT; w.step(DT, DT, inp); }
  }

  it('после идеального уклонения — «Контрудар»; после рывка — «Рассечение»; пауза после второго удара — «Шквал»', () => {
    const { w } = setup();
    const h = w.hero as unknown as { counterUntil: number; clock: number; lastDashEnd: number; lastMove: unknown; lastMoveStart: number; branchHint: string | null; state: string };
    h.counterUntil = h.clock + 0.5;
    expect(h.branchHint).toBe('Контрудар');
    h.counterUntil = 0;
    h.lastDashEnd = h.clock - 0.1;
    expect(h.branchHint).toBe('Рассечение');
    h.lastDashEnd = -9;
    h.lastMove = VOID_BLADE.combo[1]; h.lastMoveStart = h.clock - 0.45;
    expect(h.branchHint).toBe('Шквал');
    h.lastMove = VOID_BLADE.combo[0];
    expect(h.branchHint).toBeNull();
  });

  it('каст отменяется в удар только после release (0.1 с), не дожидаясь конца клипа (0.3 с)', () => {
    const { w } = setup();
    const h = w.hero;
    const inp = input();
    inp.buffer.push('q', 0);
    run(w, DT, inp);
    expect(h.state).toBe('cast');
    // до release удар не перебивает каст
    inp.buffer.push('attack', (inp as { now: number }).now);
    run(w, 0.05, inp);
    expect(h.state).toBe('cast');
    inp.buffer.clear();
    run(w, 0.08, inp);
    expect(h.state).toBe('cast');
    inp.buffer.push('attack', (inp as { now: number }).now);
    run(w, DT, inp);
    expect(h.state).toBe('attack');
  });
});

describe('воздушное комбо (план §6.5)', () => {
  async function golemSetup(): Promise<{ w: World; g: Enemy }> {
    const { Golem } = await import('../src/world/enemies/golem');
    const { w, e } = setup();
    e.x = 9;
    const g = new Golem({ zone: 0, stage: 0, hpMul: 20 });
    g.x = 0; g.z = -1.5; w.addEnemy(g); g.setState('idle');
    return { w, g };
  }
  const rising = (w: World, e: Enemy): void => {
    const m = VOID_BLADE.rising;
    w.damageEnemy(e, { mult: m.dmg, stun: 0, knockback: 0, feel: m.feel, dirX: 0, dirZ: -1, source: 'blade', launch: m.launch, moveId: 'rising' });
  };

  it('Восходящий месяц подбрасывает только оглушённого Голема; оглушение не прерывается', async () => {
    const { w, g } = await golemSetup();
    rising(w, g);
    expect(g.airborne).toBe(false);
    w.stunEnemy(g);
    rising(w, g);
    expect(g.airborne).toBe(true);
    expect(g.stunned).toBe(true);
    expect(g.state).toBe('stunned');
  });

  it('Страж не подбрасывается даже оглушённым', async () => {
    const { GateGuardian } = await import('../src/world/boss/guardians');
    const { w } = setup();
    const gg = new GateGuardian({ zone: 0, stage: 2 });
    gg.x = 0; gg.z = -3; w.addEnemy(gg); gg.setState('idle');
    w.stunEnemy(gg);
    rising(w, gg);
    expect(gg.airborne).toBe(false);
  });

  it('удары в воздухе держат цель; Звездопад вбивает её в пол с ударной волной', async () => {
    const { w, g } = await golemSetup();
    w.stunEnemy(g); g.stun!.dur = 20; g.stun!.stunned = 20;
    rising(w, g);
    let t = 0;
    const sky = VOID_BLADE.skycut;
    // два удара Небесного разреза с интервалом 0.14 с
    for (; t < 0.4; t += DT) {
      if (Math.abs(t - 0.15) < DT / 2 || Math.abs(t - 0.29) < DT / 2) w.damageEnemy(g, { mult: sky.dmg, stun: 0, knockback: 0, feel: sky.feel, dirX: 0, dirZ: -1, source: 'blade', launch: sky.launch, moveId: 'skycut' });
      g.step(w, DT);
    }
    expect(g.airborne).toBe(true); // без жонглирования полёт ≈ 0.63 с — к 0.4 с ещё в воздухе, но держится дольше
    for (; t < 0.75; t += DT) g.step(w, DT);
    expect(g.airborne).toBe(true);
    let slams = 0;
    w.bus.on('impact', (e) => { if (e.kind === 'slam') slams++; });
    const hp = g.hp;
    const sf = VOID_BLADE.skyfall;
    w.damageEnemy(g, { mult: sf.dmg, stun: 0, knockback: 0, feel: sf.feel, dirX: 0, dirZ: -1, source: 'blade', moveId: 'skyfall', finisher: true });
    expect(g.airborne).toBe(false);
    expect(slams).toBe(1);
    expect(g.hp).toBeLessThan(hp);
  });

  it('после Восходящего месяца по подброшенной цели следующий удар — Небесный разрез, затем Звездопад', async () => {
    const { w, g } = await golemSetup();
    w.stunEnemy(g);
    rising(w, g);
    type HP = { lastMove: unknown; lastMoveStart: number; clock: number; target: Enemy | null; state: string; move: { id: string } | null; startAttack(i: Input, x: number, z: number, s: boolean): void };
    const h = w.hero as unknown as HP;
    h.lastMove = VOID_BLADE.rising; h.lastMoveStart = h.clock - 0.3; h.target = g; h.state = 'move';
    h.startAttack(input(), 0, 0, false);
    expect(h.move?.id).toBe('skycut');
    h.lastMove = VOID_BLADE.skycut; h.lastMoveStart = h.clock - 0.35; h.state = 'move';
    h.startAttack(input(), 0, 0, false);
    expect(h.move?.id).toBe('skyfall');
  });
});

describe('ранг как ритм (план §6.6)', () => {
  it('ранг не даёт бонуса к урону', () => {
    const { w, e } = setup();
    const hit = (): number => { const hp = e.hp; w.damageEnemy(e, { mult: 1, stun: 0, knockback: 0, feel: 'light', dirX: 0, dirZ: 1, source: 'ability', noStagger: true }); return hp - e.hp; };
    const low = hit();
    w.rank.bonus(500);
    expect(w.rank.rank).toBe('SS');
    expect(Math.abs(hit() - low)).toBeLessThanOrEqual(Math.ceil(low * 0.11));
  });

  it('на ранге S финишер берёт альтернативный клип', () => {
    const { w } = setup();
    const h = w.hero as unknown as { beginMove(m: unknown, l: number): void; avatar: { puppet: { anim: { clip: { id: string } | null } } } };
    h.beginMove(VOID_BLADE.combo[3], 0);
    expect(h.avatar.puppet.anim.clip?.id).toBe('rift');
    w.rank.bonus(150);
    h.beginMove(VOID_BLADE.combo[3], 0);
    expect(h.avatar.puppet.anim.clip?.id).toBe('riftS');
  });

  it('идеальное уклонение от Стража и сразу оглушение — +80 очков ранга', async () => {
    const { GateGuardian } = await import('../src/world/boss/guardians');
    const { w } = setup();
    const g = new GateGuardian({ zone: 0, stage: 2 });
    g.x = 0; g.z = 0.5; w.addEnemy(g); g.setState('idle');
    let bursts = 0;
    w.bus.on('rankBurst', () => bursts++);
    const h = w.hero as unknown as { state: string; dashStart: number; clock: number; perfectReadyAt: number; invulnUntil: number };
    h.invulnUntil = 0; h.state = 'dash'; h.dashStart = h.clock; h.perfectReadyAt = 0;
    g.lastTeleDur = 0.9;
    w.enemyStrike(g, { k: 'circle', x: w.hero.x, z: w.hero.z, r: 2 }, 10, 3);
    const before = w.rank.points;
    w.stunEnemy(g);
    expect(bursts).toBe(1);
    expect(w.rank.points - before).toBe(80);
  });
});

describe('порядок открытия способностей (план §6.7)', () => {
  it('E (Колодец) на 1-2, R (Затмение) на 1-3, Фазовый шаг на 1-4; босс — III уровень на выбор', async () => {
    const { stageById } = await import('../src/data/stages');
    const { newSave } = await import('../src/meta/save');
    const { applyReward, computeReward, grantLevel3 } = await import('../src/meta/progression');
    expect(stageById('1-2')!.unlocks).toEqual(['well']);
    expect(stageById('1-3')!.unlocks).toEqual(['eclipse']);
    expect(stageById('1-4')!.unlocks).toEqual(['phase']);
    expect(stageById('1-4')!.tutorial).toBe('ult');
    expect(stageById('1-5')!.tutorial).toBe('upgrade');
    expect(stageById('boss1')!.unlocks ?? []).toEqual([]);
    const s = newSave();
    const res = (id: string) => ({ stageId: id, cleared: true, hpFrac: 1, rank: 'A' as const, rankMul: 1, time: 60, pickedShards: 0, pickedEther: 0, bestCombo: 10, story: false });
    for (const id of ['1-1', '1-2', '1-3']) applyReward(s, stageById(id)!, res(id), computeReward(s, stageById(id)!, res(id)));
    expect(s.loadout.e).toBe('well');
    expect(s.loadout.r).toBe('eclipse');
    const bossReward = computeReward(s, stageById('boss1')!, res('boss1'));
    expect(bossReward.freeLevel3).toBe(true);
    expect(grantLevel3(s, 'well')).toBe(true);
    expect(s.abilities.well).toEqual({ level: 3, mutation: 'A' });
    expect(grantLevel3(s, 'well')).toBe(false);
  });
});
