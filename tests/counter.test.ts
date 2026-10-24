import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { VOID_BLADE } from '../src/data/weapons';
import { angleDiff } from '../src/core/math';
import { Husk } from '../src/world/enemies/husk';
import { Golem } from '../src/world/enemies/golem';
import { REACT_SWEEP, type Enemy } from '../src/world/enemy';
import { slashFor } from '../src/vfx/slashFx';
import { InputBuffer, type Input } from '../src/input/input';

/** Этап 4.5, B2: идеальное уклонение → Контрудар — разворот, контакт, силуэт на выходе, реакция цели. */
const DT = 1 / 60;
const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;

interface HeroPriv {
  counterUntil: number; clock: number; hitActive: boolean; state: string; target: Enemy | null;
  startAttack(i: Input, mx: number, mz: number, stick: boolean): void;
  beginMove(m: unknown, lunge: number): void;
}

function world(): World {
  const w = new World(new Arena(ARENAS.naves), 'counter');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 0, 0);
  w.hero.invulnUntil = 1e9;
  return w;
}
function put<T extends Enemy>(w: World, e: T, x: number, z: number): T {
  e.x = x; e.z = z; e.maxHp *= 50; e.hp = e.maxHp; w.addEnemy(e); e.setState('idle');
  (e as unknown as { think: () => void }).think = () => {};
  return e;
}
/** Контрудар по цели из открытого окна (как после идеального уклонения). */
function counter(w: World, e: Enemy): HeroPriv {
  const h = w.hero as unknown as HeroPriv;
  h.counterUntil = h.clock + 0.5;
  h.target = e;
  h.startAttack(idle(), 0, 0, false);
  return h;
}
const yaw = (w: World): number => w.hero.avatar.puppet.skel.facing;

describe('этап 4.5 B2: идеальное уклонение → Контрудар', () => {
  it('Пилот приходит спиной к цели и разворачивается к ней на 270°; клинок проходит цель в кадре контакта', () => {
    const w = world();
    const e = put(w, new Husk({ zone: 0, stage: 0 }), 0, 2);
    const h = counter(w, e);
    expect(w.hero.move?.id).toBe('counter');
    const toTarget = w.hero.facing, travel = toTarget + Math.PI;
    w.step(DT, DT, idle());
    // приход: тело смотрит по ходу проскока (±50°), а не уже на цель
    expect(Math.abs(angleDiff(yaw(w), travel))).toBeLessThan(0.9);
    let turned = 0, prev = yaw(w), bladeAtHit = NaN, holdYaw = NaN, holdY = NaN;
    const base = new THREE.Vector3(), tip = new THREE.Vector3();
    for (let i = 0; i < 20; i++) {
      w.step(DT, DT, idle());
      turned += angleDiff(prev, yaw(w)); prev = yaw(w);
      if (h.hitActive && Number.isNaN(bladeAtHit)) {
        w.hero.avatar.bladePoints(base, tip);
        bladeAtHit = Math.atan2(tip.x - base.x, tip.z - base.z);
      }
      // удержание выхода: 0.14–0.27 с клипа
      if (i === 11) { holdYaw = yaw(w); holdY = w.hero.avatar.puppet.anim.root.y; }
    }
    // разворот слева направо больше пол-оборота (клинок идёт поперёк цели, а не крутится на месте)
    expect(turned).toBeLessThan(-Math.PI);
    // в первом кадре открытого хитбокса клинок смотрит на цель (±35°)
    expect(Math.abs(angleDiff(bladeAtHit, toTarget))).toBeLessThan(0.6);
    // силуэт на выходе: тело к цели (±60°), Пилот в низкой стойке
    expect(Math.abs(angleDiff(holdYaw, toTarget))).toBeLessThan(1.05);
    expect(holdY).toBeLessThan(-0.15);
  });

  it('путь проскока виден: силуэты Пилота стоят между началом и точкой прихода', () => {
    const w = world();
    const e = put(w, new Husk({ zone: 0, stage: 0 }), 0, 2);
    const x0 = w.hero.x, z0 = w.hero.z;
    let blink: { x0: number; z0: number; x1: number; z1: number } | null = null;
    w.bus.on('counterBlink', (b) => { blink = b; });
    counter(w, e);
    w.step(DT, DT, idle());
    expect(blink).toMatchObject({ x0, z0 });
    const x1 = w.hero.x, z1 = w.hero.z, L = Math.hypot(x1 - x0, z1 - z0);
    expect(L).toBeGreaterThan(2);
    const ghosts = (w.hero.avatar as unknown as { ghosts: { world: Float32Array; age: number }[] }).ghosts.filter((g) => g.age < 0.2);
    const onPath = ghosts.filter((g) => {
      const gx = g.world[12] - x0, gz = g.world[14] - z0;
      const t = (gx * (x1 - x0) + gz * (z1 - z0)) / (L * L), off = Math.abs(gx * (z1 - z0) - gz * (x1 - x0)) / L;
      return t > 0.1 && t < 0.95 && off < 0.5;
    });
    expect(onPath.length).toBeGreaterThanOrEqual(3);
  });

  it('дуга 270° с центром на цели: враг впереди задет, враг в секторе за спиной — нет; след — та же дуга', () => {
    const w = world();
    const front = put(w, new Husk({ zone: 0, stage: 0 }), 0, 1.6);
    const back = put(w, new Husk({ zone: 0, stage: 0 }), 0, -1.6);
    const h = w.hero as unknown as HeroPriv;
    w.hero.facing = 0;
    h.beginMove(VOID_BLADE.counter, 0);
    for (let i = 0; i < 30; i++) w.step(DT, DT, idle());
    expect(front.hp).toBeLessThan(front.maxHp);
    expect(back.hp).toBe(back.maxHp);
    const hb = VOID_BLADE.counter.hitbox;
    expect(hb.shape === 'arc' && hb.angle).toBe(270);
    const s = slashFor('counter', hb)[0];
    expect(s.shape).toBe('arc');
    expect(s.angle).toBeCloseTo(1.5 * Math.PI);
    expect(s.dir).toBe(VOID_BLADE.counter.sweep);
  });

  it('цель отшатывается и проворачивается по ходу клинка; без хода поперёк — только по линии удара', () => {
    const turn = (sweep: number | undefined): number => {
      const w = world();
      const e = put(w, new Husk({ zone: 0, stage: 0 }), 0, 2);
      e.facing = Math.PI;
      const f0 = e.facing;
      const m = VOID_BLADE.counter;
      w.damageEnemy(e, { mult: 0.01, stun: 0, knockback: m.knockback, feel: m.feel, dirX: 0, dirZ: 1, source: 'blade', moveId: m.id, sweep });
      for (let i = 0; i < 24; i++) w.step(DT, DT, idle());
      return angleDiff(f0, e.facing);
    };
    // рой: проворот ≈ 0.9 рад в сторону хода клинка (знак sweep), без sweep — на месте
    expect(turn(1)).toBeGreaterThan(REACT_SWEEP.twist.swarm * 0.7);
    expect(turn(-1)).toBeLessThan(-REACT_SWEEP.twist.swarm * 0.7);
    expect(Math.abs(turn(undefined))).toBeLessThan(0.05);
  });

  it('тяжёлая цель принимает удар поперёк корпусом вбок, не только назад', () => {
    const w = world();
    const g = put(w, new Golem({ zone: 0, stage: 0 }), 0, 2);
    w.damageEnemy(g, { mult: 0.01, stun: 0, knockback: 3, feel: 'heavy', dirX: 0, dirZ: 1, source: 'blade', moveId: 'counter', sweep: 1 });
    const vx = g.puppet.springVX, vz = g.puppet.springVZ;
    // ход клинка при sweep 1 и ударе в +z — вправо от Пилота, то есть в −x
    expect(vx).toBeLessThan(0);
    expect(Math.abs(vx)).toBeGreaterThan(Math.abs(vz));
    expect(vz).toBeGreaterThan(0);
  });
});
