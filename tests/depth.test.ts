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
