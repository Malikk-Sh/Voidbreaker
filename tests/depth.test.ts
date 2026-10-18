import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { VOID_BLADE } from '../src/data/weapons';
import { Abilities } from '../src/world/abilities';
import { Reaper } from '../src/world/enemies/reaper';
import type { Enemy } from '../src/world/enemy';

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
