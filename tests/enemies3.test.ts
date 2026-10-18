import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import type { Enemy } from '../src/world/enemy';

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
