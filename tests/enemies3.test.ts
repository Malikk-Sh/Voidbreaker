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
