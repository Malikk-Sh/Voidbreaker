import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import type { Enemy } from '../src/world/enemy';
import { InputBuffer, type Input } from '../src/input/input';

const DT = 1 / 60;

export function arena(name = 'fall'): World {
  const w = new World(new Arena(ARENAS[name]), 'z1enemies');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 4, Math.PI);
  w.hero.invulnUntil = 1e9;
  return w;
}
export function put<T extends Enemy>(w: World, e: T, x = 0, z = 0): T {
  e.x = x; e.z = z; w.addEnemy(e); e.setState('idle');
  return e;
}
const heavyHit = (w: World, e: Enemy): void => { w.damageEnemy(e, { mult: 0.1, stun: 0, knockback: 2, feel: 'heavy', dirX: 0, dirZ: -1, source: 'blade' }); };

describe('общие приёмы и реакции (план §7.1)', () => {
  it('дуэлянт от тяжёлого удара опрокидывается на 0.6 с; рой отлетает с пылью', async () => {
    const { Reaper } = await import('../src/world/enemies/reaper');
    const { Husk } = await import('../src/world/enemies/husk');
    const w = arena();
    const r = put(w, new Reaper({ zone: 0, stage: 0, hpMul: 20 }), 0, 0);
    const h = put(w, new Husk({ zone: 0, stage: 0, hpMul: 20 }), 3, 0);
    let dust = 0;
    w.bus.on('hitReact', (e) => { if (e.kind === 'dust') dust++; });
    heavyHit(w, r); heavyHit(w, h);
    expect(r.toppleT).toBeCloseTo(0.6);
    expect(dust).toBe(1);
    expect(Math.abs(h.kbZ)).toBeGreaterThan(Math.abs(r.kbZ) * 0.5);
  });

  it('Голем от лёгкого удара почти не сдвигается, от тяжёлого — шаг назад и камни', async () => {
    const { Golem } = await import('../src/world/enemies/golem');
    const w = arena();
    const g = put(w, new Golem({ zone: 0, stage: 0, hpMul: 20 }));
    let stones = 0;
    w.bus.on('hitReact', (e) => { if (e.kind === 'stones') stones++; });
    w.damageEnemy(g, { mult: 0.1, stun: 0, knockback: 1.5, feel: 'light', dirX: 0, dirZ: -1, source: 'blade' });
    const light = Math.abs(g.kbZ);
    g.kbZ = 0;
    heavyHit(w, g);
    expect(Math.abs(g.kbZ)).toBeGreaterThan(light * 2);
    expect(stones).toBe(1);
  });

  it('этап 4.5 B1: Голем принимает тяжёлый удар корпусом и коленями после стопкадра, ступни на полу', async () => {
    const THREE = await import('three');
    const { Golem } = await import('../src/world/enemies/golem');
    const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
    const w = arena();
    const g = put(w, new Golem({ zone: 0, stage: 0, hpMul: 20 }));
    const s = g.puppet.skel, L = g.puppet.layout, head = L.idx('head'), foot = L.idx('footL');
    const v = new THREE.Vector3();
    // положение сустава относительно корня: отделяет изгиб тела от отлёта
    const rel = (i: number) => { s.jointPos(i, v); return { y: v.y, z: v.z - g.z }; };
    w.step(DT, DT, idle());
    g.facing = 0; w.step(DT, DT, idle()); // лицом в +z, удар толкает в −z
    const head0 = rel(head), foot0 = rel(foot);
    heavyHit(w, g);
    // пружина стоит, пока длится стопкадр (раньше успевала затухнуть, и реакции не было видно)
    const kick = Math.abs(g.puppet.springVZ);
    expect(g.freeze).toBeGreaterThan(0);
    while (g.freeze > 0) w.step(DT, DT, idle());
    expect(Math.abs(g.puppet.springVZ)).toBeCloseTo(kick, 5);
    let back = 0, footLift = 0;
    for (let i = 0; i < 12; i++) {
      w.step(DT, DT, idle());
      const hd = rel(head), ft = rel(foot);
      back = Math.max(back, head0.z - hd.z);
      footLift = Math.max(footLift, ft.y - foot0.y);
    }
    // голова отходит назад относительно корня; ступни не отрываются (раньше наклонялось всё тело от корня)
    expect(back).toBeGreaterThan(0.15);
    expect(footLift).toBeLessThan(0.03);
  });

  it('распад по сегментам: конечности отрываются позже корпуса', async () => {
    const { Reaper } = await import('../src/world/enemies/reaper');
    const w = arena();
    const r = put(w, new Reaper({ zone: 0, stage: 0 }));
    w.killEnemy(r, 0, -1, 5);
    const sk = r.puppet.skel as unknown as { debris: { delay: number }[] };
    const delays = sk.debris.map((d) => d.delay);
    expect(Math.min(...delays)).toBeLessThan(0.04);
    expect(Math.max(...delays)).toBeGreaterThan(0.1);
    for (let t = 0; t < 1.2; t += DT) r.step(w, DT);
    expect(r.removable).toBe(true);
  });
});

describe('Распинатель (план §7.2)', () => {
  const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
  const run = (w: World, sec: number, each?: (t: number) => void): void => {
    const inp = idle();
    for (let t = 0; t < sec; t += DT) { w.step(DT, DT, inp, DT); each?.(t + DT); }
  };
  type Priv = { pickAttack(w: World, d: number): void };
  async function setup(hx: number, hz: number) {
    const { Crucifier } = await import('../src/world/enemies/crucifier');
    const w = arena();
    w.hero.x = hx; w.hero.z = hz;
    const c = put(w, new Crucifier({ zone: 0, stage: 0, hpMul: 20 }), 0, 0);
    c.cooldown = 99;
    const start = (): void => (c as unknown as Priv).pickAttack(w, c.distTo(w.hero));
    return { w, c, start };
  }
  const light = (w: World, e: Enemy, feel: 'light' | 'heavy' = 'light'): void => {
    w.damageEnemy(e, { mult: 0.01, stun: 0, knockback: 1, feel, dirX: 0, dirZ: -1, source: 'blade' });
  };

  it('сборка: рост 2.8 м, четыре руки, рёбра, ноги обратным коленом; телеграфы не короче минимумов', async () => {
    const { crucifierRig } = await import('../src/gen/chars/enemies');
    const C = await import('../src/world/enemies/crucifier');
    const names = crucifierRig().joints.map((j) => j.name);
    for (const n of ['armL', 'armR', 'arm2L', 'arm2R', 'bladeL', 'blade2R', 'ribsL', 'ribsR', 'kneeL', 'ankleR']) expect(names).toContain(n);
    const { ENEMIES } = await import('../src/data/enemies');
    expect(ENEMIES.crucifier).toMatchObject({ hp: 140, stun: 50, height: 2.8 });
    expect(C.FAN_TELE).toBeGreaterThanOrEqual(0.7);
    expect(C.NAIL_TELE).toBeGreaterThanOrEqual(0.42);
    expect(C.ROW_TELE).toBeGreaterThanOrEqual(0.42);
  });

  it('суперброня: лёгкий удар не прерывает замах, тяжёлый прерывает; вне атаки лёгкий сбивает', async () => {
    const { w, c, start } = await setup(0, 4.5);
    start();
    expect(c.state).toBe('telegraph');
    light(w, c);
    expect(c.state).toBe('telegraph');
    light(w, c, 'heavy');
    expect(c.state).toBe('stagger');
    const b = await setup(0, 4.5);
    b.c.setState('orbit');
    light(b.w, b.c);
    expect(b.c.state).toBe('stagger');
  });

  it('Веер: четыре полосы от тела; просвет на линии героя безопасен, полоса бьёт', async () => {
    const { overlaps } = await import('../src/world/combat');
    const { FAN_ANG } = await import('../src/world/enemies/crucifier');
    const { w, c, start } = await setup(0, 5);
    start();
    const lines = w.telegraphs.filter((t) => t.alive && t.shape.k === 'line');
    expect(lines.length).toBe(4);
    const R = w.hero.radius;
    // герой на линии атаки — в центральном просвете; на угле полосы — под ударом; за краем веера — свободен
    expect(lines.some((t) => overlaps(t.shape, 0, 5, R))).toBe(false);
    const at = (deg: number, d: number) => [Math.sin((deg * Math.PI) / 180) * d, Math.cos((deg * Math.PI) / 180) * d] as const;
    expect(lines.some((t) => overlaps(t.shape, ...at((FAN_ANG[2] * 180) / Math.PI, 5), R))).toBe(true);
    expect(lines.some((t) => overlaps(t.shape, ...at(24, 5), R))).toBe(false);
    expect(lines.some((t) => overlaps(t.shape, ...at(60, 4), R))).toBe(false);
    // удар: герой в просвете не ранен
    w.hero.invulnUntil = 0;
    const hp = w.hero.hp;
    run(w, 1.0);
    expect(w.hero.hp).toBe(hp);
    expect(c.state).toBe('recover');
  });

  it('Гвоздь: круг следует за героем первые 50 %; промах — клинок застревает на 1.4 с (окно), попадание — нет', async () => {
    const { NAIL_TELE, NAIL_STUCK } = await import('../src/world/enemies/crucifier');
    const { w, c, start } = await setup(0, 2);
    start();
    expect(c.attackMode).toBe('nail');
    const circle = () => w.telegraphs.find((t) => t.alive && t.shape.k === 'circle')!.shape as { x: number; z: number };
    run(w, NAIL_TELE * 0.3);
    w.hero.x = 1;
    run(w, DT * 2);
    expect(circle().x).toBeCloseTo(1, 1);
    run(w, NAIL_TELE * 0.3);
    w.hero.x = 6; w.hero.z = 0;
    run(w, DT * 2);
    expect(circle().x).toBeLessThan(2);
    const stuckAt: number[] = [];
    w.bus.on('stuck', (e) => stuckAt.push(e.dur));
    run(w, NAIL_TELE * 0.5);
    expect(stuckAt).toEqual([NAIL_STUCK]);
    expect(c.inWindow).toBe(true);
    expect(c.superArmor).toBe(false);
    light(w, c);
    expect(c.state).toBe('recover');
    run(w, NAIL_STUCK + 0.05);
    expect(c.inWindow).toBe(false);

    const b = await setup(0, 2);
    b.w.hero.invulnUntil = 0;
    b.start();
    run(b.w, NAIL_TELE + 0.1);
    expect(b.w.hero.hp).toBeLessThan(b.w.hero.maxHp);
    expect(b.c.inWindow).toBe(false);
  });

  it('выпад Гвоздя у края колодца не сбрасывает Распинателя в провал', async () => {
    const { Crucifier } = await import('../src/world/enemies/crucifier');
    const w = arena('candles');
    // герой за колодцем; до края провала (x 4) 1 м, выпад к кругу Гвоздя — 1.1 м: отбрасыванием он упал бы
    w.hero.x = -5; w.hero.z = -0.5;
    const c = put(w, new Crucifier({ zone: 0, stage: 0 }), 5, -0.5);
    c.cooldown = 99;
    (c as unknown as Priv).pickAttack(w, 2);
    expect(c.attackMode).toBe('nail');
    run(w, 1.2);
    expect(c.dead).toBe(false);
    expect(c.x).toBeLessThan(4.6);
    expect(w.arena.walkable(c.x, c.z)).toBe(true);
  });

  it('Погребальный ряд: полосы на 2, 4, 6 м с шагом 0.3 с, шипы через 0.7 с — «та-та-ТА»', async () => {
    const { w, c, start } = await setup(0, 6.5);
    start();
    expect(c.attackMode).toBe('row');
    const spikes: { t: number; z: number; big: boolean }[] = [];
    let now = 0;
    w.bus.on('spikes', (e) => spikes.push({ t: now, z: e.z, big: e.big }));
    run(w, 1.6, (t) => { now = t; });
    expect(spikes.length).toBe(3);
    expect(spikes.map((s) => Math.round(s.z))).toEqual([2, 4, 6]);
    expect(spikes.map((s) => s.big)).toEqual([false, false, true]);
    expect(spikes[0].t).toBeCloseTo(0.7, 1);
    expect(spikes[1].t - spikes[0].t).toBeCloseTo(0.3, 1);
    expect(spikes[2].t - spikes[1].t).toBeCloseTo(0.3, 1);
    expect(c.state).toBe('recover');
  });

  it('смерть: четыре клинка втыкаются в пол и стоят ~1 с, затем растворение', async () => {
    const { w, c } = await setup(0, 5);
    w.killEnemy(c, 0, -1, 5);
    const L = c.puppet.layout;
    const sk = c.puppet.skel as unknown as { debris: { rest: boolean; stickY?: number; py: number }[] };
    for (let t = 0; t < 0.9; t += DT) c.step(w, DT);
    for (const n of ['bladeL', 'bladeR', 'blade2L', 'blade2R']) {
      const d = sk.debris[L.idx(n)];
      expect(d.rest).toBe(true);
      expect(d.py).toBeCloseTo(d.stickY!, 5);
    }
    expect(c.puppet.dissolve).toBe(0);
    expect(c.removable).toBe(false);
    for (let t = 0; t < 1.1; t += DT) c.step(w, DT);
    expect(c.removable).toBe(true);
  });
});

describe('Псаломщик Голода (план §7.3)', () => {
  const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
  const run = (w: World, sec: number): void => { const inp = idle(); for (let t = 0; t < sec; t += DT) w.step(DT, DT, inp, DT); };
  async function setup() {
    const { Psalmist } = await import('../src/world/enemies/psalmist');
    const { Crucifier } = await import('../src/world/enemies/crucifier');
    const { Reaper } = await import('../src/world/enemies/reaper');
    const { Husk } = await import('../src/world/enemies/husk');
    const w = arena();
    w.hero.x = 0; w.hero.z = 9;
    const p = put(w, new Psalmist({ zone: 0, stage: 0, hpMul: 5 }), 0, 0);
    const c = put(w, new Crucifier({ zone: 0, stage: 0, hpMul: 20 }), -3, 3);
    const r = put(w, new Reaper({ zone: 0, stage: 0, hpMul: 20 }), 3, 3);
    const h = put(w, new Husk({ zone: 0, stage: 0, hpMul: 20 }), 0, 4);
    // союзники стоят на месте (без ИИ): проверяется только Псаломщик
    for (const e of [c, r, h]) (e as unknown as { think(): void }).think = () => {};
    p.speed = 0;
    const events: string[] = [];
    w.bus.on('psalm', (e) => events.push(e.kind));
    return { w, p, c, r, h, events };
  }
  const hit = (w: World, e: Enemy, feel: 'light' | 'heavy'): void => { w.damageEnemy(e, { mult: 0.01, stun: 0, knockback: 0, feel, dirX: 0, dirZ: -1, source: 'blade' }); };

  it('с Аколитом в одной волне Зоны 01 не появляется; впервые — на 1-5', async () => {
    const { ZONE1 } = await import('../src/data/stages');
    for (const st of ZONE1) for (const wv of st.waves) {
      const kinds = [...wv.spawns.map((s) => s.enemy), ...(wv.triggers ?? []).map((t) => t.spawn.enemy)];
      expect(kinds.includes('psalmist') && kinds.includes('acolyte')).toBe(false);
    }
    const first = ZONE1.find((s) => s.waves.some((wv) => wv.spawns.some((sp) => sp.enemy === 'psalmist')));
    expect(first?.id).toBe('1-5');
  });

  it('Красный псалом: за 0.6 с связывает двух сильнейших; +25 % урона, лёгкие удары их не прерывают', async () => {
    const { w, p, c, r, h, events } = await setup();
    for (let t = 0; t < 1 && p.state !== 'telegraph'; t += DT) run(w, DT);
    expect(p.state).toBe('telegraph');
    expect(p.casting).toEqual([c, r]);
    run(w, 0.7);
    expect(events).toContain('link');
    expect(p.links).toEqual([c, r]);
    expect(c.psalmLinked && r.psalmLinked).toBe(true);
    expect(h.psalmLinked).toBe(false);
    hit(w, r, 'light');
    expect(r.state).not.toBe('stagger');
    hit(w, h, 'light');
    expect(h.state).toBe('stagger');
    // урон: связанный бьёт на 25 % сильнее
    w.hero.invulnUntil = 0;
    const shape = { k: 'circle' as const, x: w.hero.x, z: w.hero.z, r: 1 };
    let hp = w.hero.hp;
    w.enemyStrike(h, shape, 20); const plain = hp - w.hero.hp;
    w.hero.invulnUntil = 0; hp = w.hero.hp;
    w.enemyStrike(r, shape, 20); const linked = hp - w.hero.hp;
    expect(linked / plain).toBeCloseTo(1.25, 1);
  });

  it('тяжёлый удар гасит связь на 2 с; рывок сквозь нить рвёт её, восстановление — через 6 с', async () => {
    const { PSALM_OFF, PSALM_RELINK } = await import('../src/world/enemies/psalmist');
    const { w, p, c, r, events } = await setup();
    run(w, 1.3);
    hit(w, p, 'heavy');
    expect(events).toContain('off');
    expect(r.psalmLinked).toBe(false);
    run(w, PSALM_OFF + 0.1);
    expect(r.psalmLinked).toBe(true);
    // рывок поперёк нити к Жнецу
    w.hero.x = 1.5 - 0.6; w.hero.z = 1.5;
    w.hero.invulnUntil = 1e9;
    (w.hero as unknown as { startDash(dx: number, dz: number): void }).startDash(1, -1);
    run(w, 0.1);
    expect(events.filter((k) => k === 'snap').length).toBe(1);
    expect(p.links).toEqual([c]);
    expect(r.linkedBy).toBe(null);
    run(w, PSALM_RELINK - 1);
    expect(p.links.length).toBe(1);
    run(w, 2);
    expect(p.links.length).toBe(2);
  });

  it('Перезвон: герой ближе 3.5 м — кольцо r 3 за 0.7 с, затем перенос на 6 м', async () => {
    const { CHIME_TELE, CHIME_CD } = await import('../src/world/enemies/psalmist');
    const { w, p } = await setup();
    run(w, 1.3);
    w.hero.x = 0; w.hero.z = -2;
    let rings = 0;
    w.bus.on('enemyAttack', (e) => { if (e.kind === 'chime') rings++; });
    run(w, 0.15);
    expect(p.mode).toBe('chime');
    expect(p.state).toBe('telegraph');
    run(w, CHIME_TELE + 0.5);
    expect(rings).toBe(1);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(5);
    expect(p.puppet.dissolve).toBe(0);
    expect(p.chimeCd).toBeGreaterThan(CHIME_CD - 1);
  });

  it('смерть: нити лопаются, связанные сразу оглушены — Раскол открыт', async () => {
    const { w, p, c, r, h, events } = await setup();
    run(w, 1.3);
    w.killEnemy(p, 0, 1, 4);
    expect(events.filter((k) => k === 'snap').length).toBe(2);
    expect(c.stunned && r.stunned).toBe(true);
    expect(r.shatterable).toBe(true);
    expect(h.stunned).toBe(false);
    expect(c.linkedBy).toBe(null);
  });

  it('ряса — ткань Верле: висит от пояса, не разлетается; после гибели падает на пол', async () => {
    const { w, p } = await setup();
    p.speed = 3;
    run(w, 2);
    const P = p.robe.p;
    for (let k = 0; k < p.robe.n; k++) {
      expect(Number.isFinite(P[k * 3])).toBe(true);
      expect(Math.hypot(P[k * 3] - p.x, P[k * 3 + 2] - p.z)).toBeLessThan(1.2);
      expect(P[k * 3 + 1]).toBeGreaterThan(0.05);
    }
    w.killEnemy(p, 0, 1, 4);
    for (let t = 0; t < 1.2; t += DT) p.step(w, DT);
    let maxY = 0;
    for (let k = 0; k < p.robe.n; k++) maxY = Math.max(maxY, P[k * 3 + 1]);
    expect(maxY).toBeLessThan(0.6);
  });
});

describe('Звонарь: уловки (план §7.4)', () => {
  const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
  const run = (w: World, sec: number, each?: () => void): void => { const inp = idle(); for (let t = 0; t < sec; t += DT) { w.step(DT, DT, inp, DT); each?.(); } };
  async function setup(arenaName = 'belfry') {
    const G = await import('../src/world/boss/guardians');
    const w = arena(arenaName);
    w.hero.x = 0; w.hero.z = 4;
    const b = put(w, new G.BellRinger({ zone: 0, stage: 5 }), 0, 0);
    b.idleT = 99;
    return { w, b, G };
  }
  const charged = (w: World, e: Enemy): void => {
    w.damageEnemy(e, { mult: 1, stun: 0, stunKind: 'charged', knockback: 1, feel: 'heavy', dirX: 0, dirZ: -1, source: 'blade' });
  };

  it('колокол на спине: полный заряд сзади — фиолетовое кольцо, урон Звонарю и врагам, +30 оглушения; спереди — нет', async () => {
    const { Husk } = await import('../src/world/enemies/husk');
    const { w, b, G } = await setup();
    const husk = put(w, new Husk({ zone: 0, stage: 0, hpMul: 50 }), 4, 0);
    let strikes = 0;
    w.bus.on('bellStrike', () => strikes++);
    // лицом к герою — удар спереди
    b.facing = 0;
    charged(w, b);
    expect(strikes).toBe(0);
    // спиной к герою
    b.facing = Math.PI;
    const stun0 = b.stun!.value, hp0 = b.hp, huskHp = husk.hp;
    charged(w, b);
    expect(strikes).toBe(1);
    expect(b.stun!.value - stun0).toBeCloseTo(G.BELL_STUN, 0);
    run(w, 0.5);
    expect(b.hp).toBeLessThan(hp0);
    expect(husk.hp).toBeLessThan(huskHp);
  });

  // «Маятник»: колокол на четырёх верёвках, фазы по целым верёвкам
  const slashAt = (w: World, x: number, z: number): void => {
    w.bus.emit('swing', { kind: 'light' });
    w.bus.emit('slash', { move: 'light1', hit: { shape: 'circle', radius: 1.2 }, second: false, x, y: 1, z, facing: 0, reach: 1, active: 0.1 });
  };
  /** Ждать, пока колокол встанет на краю качания и какая-то верёвка будет натянута. */
  const untilTaut = (w: World, sec = 12): number => {
    const bell = w.greatBell!;
    for (let t = 0; t < sec; t += DT) {
      run(w, DT);
      const i = bell.ropes.findIndex((r) => bell.cuttable(r));
      if (i >= 0 && (bell.mode !== 'swing' || bell.paused)) return i;
    }
    return -1;
  };
  async function mounted() {
    const s = await setup();
    s.b.idleT = 0;
    run(s.w, 4);
    return s;
  }

  it('Маятник: тумбы верёвок — на полу у кромки провалов, блоки — над провалами', async () => {
    const { w } = await setup();
    const bell = w.greatBell!;
    expect(bell.ropes.length).toBe(4);
    for (const r of bell.ropes) {
      expect(w.arena.walkable(r.cleat.x, r.cleat.z)).toBe(true);
      expect(w.arena.walkable(r.pulley.x, r.pulley.z)).toBe(false);
      expect(Math.hypot(r.cleat.x - r.pulley.x, r.cleat.z - r.pulley.z)).toBeLessThan(3.6);
    }
  });

  it('Маятник: Звонарь вскакивает на колокол и едет недосягаемым; на паузе натянуты верёвки дальней стороны', async () => {
    const { w, b } = await mounted();
    const bell = w.greatBell!;
    expect(b.riding).toBe(true);
    expect(b.targetable).toBe(false);
    expect(bell.mode).toBe('swing');
    const i = untilTaut(w);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(b.x - bell.x, b.z - bell.z)).toBeLessThan(0.01);
    expect(b.y).toBeGreaterThan(3);
    // натянуты только верёвки с другой стороны зала от колокола
    for (const r of bell.ropes) if (bell.cuttable(r)) expect(Math.sign(r.pulley.x - bell.cx)).toBe(-Math.sign(bell.x - bell.cx));
  });

  it('Маятник: удар по натянутой тумбе перерубает верёвку — Звонарь теряет 10 % и падает с колокола; по ослабленной — звон', async () => {
    const { w, b, G } = await mounted();
    const bell = w.greatBell!;
    const i = untilTaut(w);
    const slack = bell.ropes.findIndex((r) => !bell.cuttable(r));
    let clanks = 0;
    w.bus.on('bellClank', () => clanks++);
    slashAt(w, bell.ropes[slack].cleat.x, bell.ropes[slack].cleat.z);
    expect(bell.ropes[slack].cut).toBe(false);
    expect(clanks).toBe(1);
    const hp0 = b.hp;
    slashAt(w, bell.ropes[i].cleat.x, bell.ropes[i].cleat.z);
    expect(bell.ropes[i].cut).toBe(true);
    expect(hp0 - b.hp).toBeCloseTo(b.maxHp * G.RINGER.cut, 0);
    expect(b.riding).toBe(false);
    run(w, 0.8);
    expect(b.stunned).toBe(true);
    expect(b.y).toBe(0);
    // качание повернуло поперёк зала
    run(w, 2.5);
    expect(Math.abs(bell.swing.next.x)).toBeLessThan(0.01);
    expect(Math.abs(bell.swing.next.z)).toBeGreaterThan(5);
  });

  it('Маятник: после рывка срезанной верёвки остальные провисают на GREAT_BELL.settle секунд', async () => {
    const { GREAT_BELL } = await import('../src/world/boss/greatBell');
    const { w } = await mounted();
    const bell = w.greatBell!;
    const i = untilTaut(w);
    slashAt(w, bell.ropes[i].cleat.x, bell.ropes[i].cleat.z);
    let cuttableAt = -1;
    for (let t = 0; t < GREAT_BELL.settle + 8 && cuttableAt < 0; t += DT) { run(w, DT); if (bell.ropes.some((r) => bell.cuttable(r))) cuttableAt = t; }
    expect(cuttableAt).toBeGreaterThanOrEqual(GREAT_BELL.settle - 0.05);
  });

  it('Маятник: верёвку срезали, пока Звонарь прыгал на колокол, — он падает на пол, а не едет во II фазе', async () => {
    const { w, b } = await setup();
    const bell = w.greatBell!;
    run(w, 2);
    b.idleT = 0;
    for (let t = 0; t < 4 && b.hop?.to !== 'bell'; t += DT) run(w, DT);
    expect(b.hop?.to).toBe('bell');
    bell.cut(0); bell.cut(1);
    expect(b.phase).toBe(2);
    run(w, 1.5);
    expect(b.riding).toBe(false);
    expect(b.y).toBe(0);
  });

  it('Маятник: герой у тумбы натянутой верёвки — Звонарь прыгает на него с колокола', async () => {
    const { w, b, G } = await mounted();
    const bell = w.greatBell!;
    const chance = G.RINGER.guard.chance;
    G.RINGER.guard.chance = 1;
    try {
      const i = untilTaut(w);
      w.hero.x = bell.ropes[i].cleat.x + 0.8; w.hero.z = bell.ropes[i].cleat.z;
      run(w, 0.1);
      expect(b.cur?.id).toBe('drop');
      run(w, 1.4);
      expect(b.riding).toBe(false);
      expect(b.metrics.drops).toBe(1);
      expect(b.y).toBe(0);
    } finally { G.RINGER.guard.chance = chance; }
  });

  it('Маятник: пока целы верёвки, клинок не опустит Звонаря ниже порогов 60 % и 30 %', async () => {
    const { w, b, G } = await setup();
    const bell = w.greatBell!;
    const hit = () => w.damageEnemy(b, { mult: 40, stun: 0, knockback: 0, feel: 'heavy', dirX: 0, dirZ: -1, source: 'blade' });
    for (let k = 0; k < 6; k++) hit();
    expect(b.hp / b.maxHp).toBeCloseTo(G.RINGER.floors[0], 3);
    bell.ropes[0].cut = bell.ropes[1].cut = true;
    for (let k = 0; k < 6; k++) hit();
    expect(b.hp / b.maxHp).toBeCloseTo(G.RINGER.floors[1], 3);
    bell.ropes[2].cut = true;
    for (let k = 0; k < 6; k++) hit();
    expect(b.hp / b.maxHp).toBeCloseTo(G.RINGER.floors[1], 3);
    expect(b.dead).toBe(false);
  });

  it('Круг: две верёвки — Звонарь прыгает в центр и крутит колокол; на каждой остановке одна целая верёвка натянута', async () => {
    const { w, b } = await mounted();
    const bell = w.greatBell!;
    for (let k = 0; k < 2; k++) { const i = untilTaut(w); slashAt(w, bell.ropes[i].cleat.x, bell.ropes[i].cleat.z); run(w, 0.3); }
    expect(b.phase).toBe(2);
    expect(bell.mode).toBe('orbit');
    run(w, 7);
    expect(Math.hypot(b.x - bell.cx, b.z - bell.cz)).toBeLessThan(0.8);
    // атаки Звонаря не начинаются, пока колокол раскручивается
    let attacksInSpin = 0, holds = 0, tautAtHold = 0, wasHold = false;
    run(w, 14, () => {
      if (b.cur && !['awaken', 'hub'].includes(b.cur.id) && b.ct < 0.02 && bell.orbit.stage === 'spin') attacksInSpin++;
      const hold = bell.orbit.stage === 'hold';
      if (hold && !wasHold) { holds++; run(w, 0.2); if (bell.ropes.some((r) => bell.cuttable(r))) tautAtHold++; }
      wasHold = hold;
    });
    expect(attacksInSpin).toBe(0);
    expect(holds).toBeGreaterThanOrEqual(2);
    expect(tautAtHold).toBe(holds);
  });

  it('III фаза: последняя верёвка — колокол рушится в центр, Звонарь отскакивает, оглушён и вырывает язык; колокол — укрытие', async () => {
    const { w, b } = await mounted();
    const bell = w.greatBell!;
    for (let k = 0; k < 4; k++) {
      const i = untilTaut(w, 20);
      expect(i).toBeGreaterThanOrEqual(0);
      slashAt(w, bell.ropes[i].cleat.x, bell.ropes[i].cleat.z);
      run(w, 0.3);
    }
    expect(b.phase).toBe(3);
    expect(bell.mode).toBe('fall');
    const covers0 = w.arena.covers.length;
    run(w, 1.2);
    expect(bell.mode).toBe('fallen');
    expect(w.arena.covers.length).toBe(covers0 + 1);
    expect(b.stunned).toBe(true);
    expect(Math.hypot(b.x - bell.cx, b.z - bell.cz)).toBeGreaterThan(4);
    for (let t = 0; t < 8 && !b.clapper; t += DT) run(w, DT);
    expect(b.clapper).toBe(true);
    for (let t = 0; t < 3 && b.cur?.id === 'clapper'; t += DT) run(w, DT);
    // клинок теперь может убить: порогов нет
    w.damageEnemy(b, { mult: 1e4, stun: 0, knockback: 0, feel: 'heavy', dirX: 0, dirZ: -1, source: 'blade' });
    expect(b.hp).toBeLessThanOrEqual(0);
  });

  it('Колокол бьёт героя на проходе по метке и разбрасывает шелуху; на паузе не бьёт', async () => {
    const { Husk } = await import('../src/world/enemies/husk');
    const { w, b } = await mounted();
    const bell = w.greatBell!;
    // Звонарь остаётся на колоколе: проверяем только удар колокола
    (b as unknown as { rideFor: number }).rideFor = 99;
    w.hero.invulnUntil = 0;
    let hits = 0;
    w.bus.on('bellHit', () => hits++);
    const pauseStart = () => { for (let t = 0; t < 8 && !(bell.paused && bell.swing.t < 0.1); t += DT) run(w, DT); };
    const pass = () => { for (let t = 0; t < 4 && bell.paused; t += DT) run(w, DT); run(w, 1.1); };
    // встать в центр зала на пути колокола в начале паузы
    pauseStart();
    w.hero.x = bell.cx; w.hero.z = bell.cz - 0.6; w.hero.hp = w.hero.maxHp;
    expect(w.telegraphs.find((t) => t.alive && t.shape.k === 'line')).toBeDefined();
    run(w, 0.5);
    expect(hits).toBe(0);
    pass();
    expect(hits).toBe(1);
    // шелуха на пути колокола
    w.hero.x = bell.cx; w.hero.z = bell.cz + 6; w.hero.invulnUntil = 1e9;
    pauseStart();
    for (let t = 0; t < 4 && bell.paused; t += DT) run(w, DT);
    const husk = put(w, new Husk({ zone: 0, stage: 0, hpMul: 50 }), bell.cx, bell.cz);
    const huskHp = husk.hp;
    run(w, 1);
    expect(bell.metrics.enemyHits).toBeGreaterThanOrEqual(1);
    expect(husk.hp).toBeLessThan(huskHp);
  });

  it('модель: точка удара добивания лежит на трещине горба-колокола', async () => {
    const { buildRinger, BELL_CONTACT, RINGER_SCALE } = await import('../src/gen/chars/ringer');
    const { rig, geometry } = buildRinger(22, RINGER_SCALE);
    const bell = rig.joints.findIndex((j) => j.name === 'bell');
    const P = geometry.attributes.position.array, Jn = geometry.attributes.aJoint.array;
    const c = BELL_CONTACT.map((v) => v * RINGER_SCALE);
    let best = Infinity;
    for (let i = 0; i < Jn.length; i++) if (Math.round(Jn[i]) === bell) best = Math.min(best, Math.hypot(P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]));
    expect(best).toBeLessThan(0.12);
  });

  it('модель: в присяде стопы на полу, на колоколе — на маковке', async () => {
    const THREE = await import('three');
    const { w, b } = await setup();
    const L = b.puppet.layout, v = new THREE.Vector3();
    const feet = () => Math.min(b.puppet.skel.jointPos(L.idx('footL'), v).y, b.puppet.skel.jointPos(L.idx('footR'), v).y);
    b.idleT = 1e9;
    for (let i = 0; i < 40; i++) { b.setPose('crouch', 0.02); run(w, DT); }
    expect(Math.abs(feet())).toBeLessThan(0.06);
    b.idleT = 0;
    run(w, 4);
    expect(b.riding).toBe(true);
    expect(Math.abs(feet() - w.greatBell!.topY)).toBeLessThan(0.1);
  });

  it('пересмотр добивания: skipToFinale — колокол лежит, язык в руках, Звонарь не в центре', async () => {
    const { w, b } = await setup();
    b.skipToFinale();
    const bell = w.greatBell!;
    expect(bell.mode).toBe('fallen');
    expect(bell.intact).toBe(0);
    expect(b.phase).toBe(3);
    expect(b.clapper).toBe(true);
    expect(Math.hypot(b.x - bell.cx, b.z - bell.cz)).toBeGreaterThan(4);
  });
});

describe('Страж Врат: застрявшая алебарда (план §7.5)', () => {
  const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
  const run = (w: World, sec: number, each?: () => void): void => { const inp = idle(); for (let t = 0; t < sec; t += DT) { w.step(DT, DT, inp, DT); each?.(); } };
  async function stuckGuard() {
    const G = await import('../src/world/boss/guardians');
    const w = arena('gate');
    w.hero.x = 0; w.hero.z = 7;
    const g = put(w, new G.GateGuardian({ zone: 0, stage: 2 }), 0, 0);
    g.phase = 2;
    g.idleT = 99;
    g.startPattern(g.patterns.find((p) => p.id === 'combo')!);
    // герой в стороне: серия мимо
    w.hero.x = 9; w.hero.z = 6;
    run(w, 2.75);
    return { w, g, G };
  }
  const dash = (w: World, dx: number, dz: number): void => (w.hero as unknown as { startDash(dx: number, dz: number): void }).startDash(dx, dz);

  it('после серии из трёх ударов алебарда застревает на 2.5 с — окно наказания', async () => {
    const { w, g, G } = await stuckGuard();
    expect(g.halberdT).toBeGreaterThan(G.HALBERD_STUCK - 0.2);
    expect(g.inWindow).toBe(true);
    // острие у пола перед Стражем
    const sh = g.shaft();
    expect(Math.hypot(sh.tx - g.x, sh.tz - g.z)).toBeGreaterThan(2);
    run(w, G.HALBERD_STUCK);
    expect(g.halberdT).toBe(0);
  });

  it('рывок на древко — пробежка к шлему: тяжёлый урон и +40 к оглушению, герой приземляется', async () => {
    const { w, g, G } = await stuckGuard();
    const sh = g.shaft();
    // герой у острия, рывок к Стражу вдоль древка
    w.hero.x = sh.tx + (sh.tx - g.x) * 0.25; w.hero.z = sh.tz + (sh.tz - g.z) * 0.25;
    w.hero.invulnUntil = 1e9;
    let helmet = 0, maxY = 0;
    w.bus.on('helmetHit', () => helmet++);
    const hp0 = g.hp, st0 = g.stun!.value;
    dash(w, g.x - w.hero.x, g.z - w.hero.z);
    run(w, 0.4, () => { maxY = Math.max(maxY, w.hero.y); });
    expect(g.running).toBe(true);
    expect(w.hero.state).toBe('frozen');
    run(w, 0.3, () => { maxY = Math.max(maxY, w.hero.y); });
    expect(helmet).toBe(1);
    expect(maxY).toBeGreaterThan(3);
    expect(g.hp).toBeLessThan(hp0);
    expect(g.stun!.value - st0 >= G.SHAFT_STUN * 0.9 || g.stunned).toBe(true);
    run(w, 0.6);
    expect(g.running).toBe(false);
    expect(w.hero.y).toBe(0);
    expect(w.hero.state).toBe('move');
  });

  it('рывок мимо древка или после того, как алебарда освободилась, — без пробежки', async () => {
    const { w, g, G } = await stuckGuard();
    w.hero.x = g.x + 6; w.hero.z = g.z - 3;
    dash(w, 0, 1);
    run(w, 0.3);
    expect(g.running).toBe(false);
    run(w, G.HALBERD_STUCK);
    const sh = g.shaft();
    w.hero.x = sh.tx; w.hero.z = sh.tz + 0.5;
    dash(w, g.x - w.hero.x, g.z - w.hero.z);
    run(w, 0.3);
    expect(g.running).toBe(false);
  });
});

describe('элитные аффиксы: Отдача и Тень (план §7.6)', () => {
  const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
  const run = (w: World, sec: number): void => { const inp = idle(); for (let t = 0; t < sec; t += DT) w.step(DT, DT, inp, DT); };
  const hit = (w: World, e: Enemy, finisher = false): void => {
    w.damageEnemy(e, { mult: 0.01, stun: 0, knockback: 0, feel: finisher ? 'heavy' : 'light', dirX: 0, dirZ: -1, source: 'blade', finisher });
  };
  const frozen = (e: Enemy): void => { (e as unknown as { think(): void }).think = () => {}; };

  it('«Зеркальный» заменён «Тенью»; Отдача — с 1-4, Тень — с 1-5', async () => {
    const { AFFIX_NAMES } = await import('../src/data/enemies');
    const { ZONE1, stageById } = await import('../src/data/stages');
    expect(Object.keys(AFFIX_NAMES)).not.toContain('mirror');
    expect(AFFIX_NAMES.shadow).toBe('Тень');
    expect(AFFIX_NAMES.recoil).toBe('Отдача');
    const affixes = (id: string) => stageById(id)!.waves.flatMap((wv) => wv.spawns.flatMap((s) => s.elite ?? []));
    expect(affixes('1-4')).toContain('recoil');
    expect(affixes('1-5')).toContain('shadow');
    expect(ZONE1.length).toBeGreaterThan(0);
  });

  it('Отдача: каждый удар — заряд, финишер сбрасывает; на 8 — волна r 3.5 через 0.7 с', async () => {
    const { Golem } = await import('../src/world/enemies/golem');
    const { RECOIL } = await import('../src/data/enemies');
    const w = arena();
    const g = put(w, new Golem({ zone: 0, stage: 0, elite: ['recoil'], hpMul: 50 }), 0, 0);
    frozen(g);
    for (let i = 0; i < 7; i++) hit(w, g);
    expect(g.recoil).toBe(7);
    expect(g.recoilTele).toBe(null);
    hit(w, g, true);
    expect(g.recoil).toBe(0);
    let waves = 0;
    w.bus.on('recoilWave', () => waves++);
    for (let i = 0; i < RECOIL.max; i++) hit(w, g);
    expect(g.recoilTele).not.toBe(null);
    expect(g.recoilTele!.dur).toBeCloseTo(RECOIL.tele);
    w.hero.x = 0; w.hero.z = 2.5; w.hero.invulnUntil = 0;
    const hp = w.hero.hp;
    run(w, RECOIL.tele - 0.1);
    expect(waves).toBe(0);
    run(w, 0.15);
    expect(waves).toBe(1);
    expect(w.hero.hp).toBeLessThan(hp);
    expect(g.recoil).toBe(0);
  });

  it('Отдача: идеальное уклонение сквозь волну — +20 Резонанса; оглушение гасит волну', async () => {
    const { Golem } = await import('../src/world/enemies/golem');
    const { RECOIL } = await import('../src/data/enemies');
    const w = arena();
    const g = put(w, new Golem({ zone: 0, stage: 0, elite: ['recoil'], hpMul: 50 }), 0, 0);
    frozen(g);
    w.hero.x = 0; w.hero.z = 2.5;
    (w.hero as unknown as { receiveAttack(): string }).receiveAttack = () => 'perfect';
    w.hero.resonance = 0;
    for (let i = 0; i < RECOIL.max; i++) hit(w, g);
    run(w, RECOIL.tele + 0.05);
    expect(w.hero.resonance).toBeGreaterThanOrEqual(RECOIL.dodgeResonance);
    for (let i = 0; i < RECOIL.max; i++) hit(w, g);
    expect(g.recoilTele).not.toBe(null);
    w.addStunTo(g, 999);
    expect(g.recoilTele).toBe(null);
    expect(g.recoil).toBe(0);
  });

  it('Тень: повторяет атаку через 0.6 с со своей позиции, 40 % урона; прерванную — не повторяет', async () => {
    const { Reaper } = await import('../src/world/enemies/reaper');
    const { SHADOW } = await import('../src/data/enemies');
    const w = arena();
    const r = put(w, new Reaper({ zone: 0, stage: 0, elite: ['shadow'], hpMul: 50 }), 0, 0);
    frozen(r);
    expect(w.shadows.length).toBe(1);
    const s = w.shadows[0];
    run(w, SHADOW.delay + 0.1);
    expect(s.ready).toBe(true);
    // поза копии — поза оригинала со сдвигом
    const m = r.puppet.skel.world;
    expect(s.world[12] - m[12]).toBeCloseTo(s.ox, 3);
    // атака оригинала (метка с владельцем) — копия повторяет её на 0.6 с позже со сдвигом
    const shape = { k: 'circle' as const, x: 0, z: 0, r: 1.2 };
    const t = w.addTelegraph(shape, 0.5); t.owner = r;
    // герой только под повтором, а не под оригиналом
    w.hero.x = s.ox; w.hero.z = s.oz; w.hero.invulnUntil = 0;
    const hp = w.hero.hp;
    run(w, SHADOW.delay - 0.05);
    expect(w.telegraphs.some((x) => x.echo)).toBe(false);
    run(w, 0.1);
    const echo = w.telegraphs.find((x) => x.echo)!;
    expect(echo.shape.x).toBeCloseTo(s.ox, 3);
    expect(echo.shape.z).toBeCloseTo(s.oz, 3);
    run(w, 0.55);
    const lost = hp - w.hero.hp;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual(Math.ceil(r.dmg * SHADOW.dmg));
    // прерванная атака: метку сняли на половине — повтора нет
    const t2 = w.addTelegraph({ ...shape }, 0.8); t2.owner = r;
    run(w, 0.3);
    t2.alive = false;
    run(w, SHADOW.delay + 0.2);
    expect(w.telegraphs.filter((x) => x.echo && x.alive).length).toBe(0);
  });

  it('Тень исчезает при оглушении оригинала — вместе с ещё не повторёнными атаками', async () => {
    const { Reaper } = await import('../src/world/enemies/reaper');
    const w = arena();
    const r = put(w, new Reaper({ zone: 0, stage: 0, elite: ['shadow'], hpMul: 50 }), 0, 0);
    frozen(r);
    run(w, 0.8);
    const s = w.shadows[0];
    const t = w.addTelegraph({ k: 'circle', x: 0, z: 0, r: 1 }, 1.0); t.owner = r;
    run(w, 0.7);
    expect(w.telegraphs.some((x) => x.echo && x.alive)).toBe(true);
    let gone = 0;
    w.bus.on('shadow', (e) => { if (e.kind === 'gone') gone++; });
    w.addStunTo(r, 999);
    run(w, DT);
    expect(s.alive).toBe(false);
    expect(gone).toBe(1);
    expect(w.telegraphs.some((x) => x.echo && x.alive)).toBe(false);
    run(w, 0.5);
    expect(w.shadows.length).toBe(0);
  });
});
