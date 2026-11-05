import { afterEach, describe, expect, it } from 'vitest';
import { VOID_BLADE, type MoveDef } from '../src/data/weapons';
import { InputBuffer, type Input } from '../src/input/input';
import { Abilities } from '../src/world/abilities';
import { Arena } from '../src/world/arena';
import { FuneralHeart, FUNERAL_HEART } from '../src/world/boss/funeralHeart';
import { createEnemy } from '../src/world/enemies/factory';
import type { GameEvents } from '../src/world/events';
import { World } from '../src/world/world';

const DT = 1 / 60;
const created: { w: World; heart: FuneralHeart }[] = [];
afterEach(() => {
  for (const { w, heart } of created.splice(0)) { heart.dispose(); w.clear(); w.hero.avatar.dispose(); }
});

function setup(centerZ = 0) {
  const arena = new Arena({ id: 'heart-test', tile: 1, edge: 'wall', decor: 'candles',
    parts: [{ kind: 'circle', x: 0, z: centerZ, w: 38, h: 30 }],
    holes: [{ kind: 'circle', x: 0, z: centerZ - 0.5, w: 10, h: 8 }],
  });
  const w = new World(arena, 'funeral-heart'); w.abilities = new Abilities(w);
  w.hero.spawn(0, centerZ + 10, Math.PI); w.hero.invulnUntil = 999;
  const heart = new FuneralHeart(w, centerZ); created.push({ w, heart });
  const input = { moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0,
    attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() } as Input;
  const run = (seconds: number, enabled = true) => {
    for (let i = 0; i < Math.ceil(seconds / DT - 1e-7); i++) {
      input.now += DT;
      // Keep this test focused on the heart; the carriers still use their real World lifecycle.
      for (const enemy of heart.carriers.values()) enemy.leash ??= { x: enemy.x, z: enemy.z, r: 0.1 };
      w.step(DT, DT, input, DT); heart.step(DT, enabled);
    }
  };
  const until = (predicate: () => boolean, timeout = 30) => {
    for (let i = 0; i < timeout / DT && !predicate(); i++) run(DT);
    expect(predicate()).toBe(true);
  };
  const slash = (move: MoveDef = VOID_BLADE.combo[0]) => {
    (w.hero as unknown as { beginMove(m: MoveDef, lunge: number): void }).beginMove(move, 0);
    run(0.4);
  };
  const charged = () => {
    const hero = w.hero as unknown as { chargeLevel: number; releaseCharge(): void };
    hero.chargeLevel = 2; hero.releaseCharge(); run(0.5);
  };
  const igniteFirst = () => {
    heart.start(); until(() => heart.heat.some(h => h > 0.9), 5);
    const index = heart.heat.findIndex(h => h > 0.9), bowl = heart.braziers[index];
    w.hero.spawn(bowl.x - 2.8, bowl.z, Math.PI / 2); charged();
    expect(heart.lit[index]).toBe(true);
    return index;
  };
  return { w, heart, input, run, until, slash, charged, igniteFirst };
}

describe('Funeral Heart: an independent, damageable encounter', () => {
  it('extinguishes a full circular candle front, including the seam, instead of uniformly dimming the hall', () => {
    const { heart, run } = setup(-27);
    const at = (turn: number) => {
      const angle = turn * Math.PI * 2 - Math.PI;
      return heart.visibilityAt(Math.sin(angle) * 14, -27 + Math.cos(angle) * 11);
    };
    const angles = Array.from({ length: 64 }, (_, i) => i / 64);
    expect(angles.every(a => at(a) === 1)).toBe(true);
    heart.start(); run(0.55);
    expect(at(0.1)).toBe(0); expect(at(0.5)).toBe(1);
    expect(at(0.25)).toBeGreaterThan(0); expect(at(0.25)).toBeLessThan(1);
    const first = angles.filter(a => at(a) === 0).length;
    run(0.55);
    const second = angles.filter(a => at(a) === 0).length;
    run(0.55);
    const third = angles.filter(a => at(a) === 0).length;
    expect(second).toBeGreaterThan(first); expect(third).toBeGreaterThan(second);
    expect(at(0.9999)).toBe(1);
    run(0.55 + DT);
    expect([...angles, 0.9999].every(a => at(a) === 0)).toBe(true);
    run(2); expect([...angles, 0.9999].every(a => at(a) === 0)).toBe(true);
  });

  it('is inert before awakening and freezes attacks, heat and spawns while disabled', () => {
    const { w, heart, run } = setup(-27);
    run(20); expect(heart.attack).toBeNull(); expect(w.enemies).toHaveLength(0); expect(w.telegraphs).toHaveLength(0);
    expect(heart.body.y).toBe(3.8); const initialBody = { ...heart.body };
    expect(heart.start()).toBe(true); expect(heart.start()).toBe(false);
    run(DT); expect(heart.body).toEqual(initialBody);
    run(1.9); expect(heart.attack?.kind).toBe('blast');
    const before = { t: heart.attack!.t, hp: heart.hp, heat: [...heart.heat], spawned: heart.spawnedTotal };
    run(8, false);
    expect({ t: heart.attack!.t, hp: heart.hp, heat: heart.heat, spawned: heart.spawnedTotal }).toEqual(before);
    expect(heart.shots).toHaveLength(0);
    run(1.6); expect(heart.heat.some(h => h > 0.9)).toBe(true);
  });

  it('warns before a blast, heats the actual bowl, and requires a real charged slash to ignite it', () => {
    const { w, heart, run, until, charged } = setup(); heart.start();
    until(() => heart.attack !== null, 3);
    expect(heart.attack!.kind).toBe('blast'); expect(heart.attack!.dur).toBeGreaterThan(1.2);
    expect(w.telegraphs.every(t => t.dur >= 1.2)).toBe(true);
    run(FUNERAL_HEART.warning - DT * 2); expect(heart.heat).toEqual([0, 0, 0]);
    run(DT * 3);
    const i = heart.heat.findIndex(h => h > 0.9), bowl = heart.braziers[i]; expect(i).toBeGreaterThanOrEqual(0);
    w.hero.spawn(bowl.x, bowl.z, 0); run(0.7); expect(heart.lit).toEqual([false, false, false]);
    w.hero.spawn(bowl.x - 2.8, bowl.z, Math.PI / 2);
    const hp = heart.hp; charged();
    expect(heart.lit[i]).toBe(true); expect(heart.flameLife[i]).toBeGreaterThan(13);
    expect(heart.heat[i]).toBe(0); expect(heart.hp).toBeLessThanOrEqual(hp - FUNERAL_HEART.counterDamage);
    expect(heart.counters).toBe(1); expect(heart.exposed).toBeGreaterThan(5);
    expect(w.arena.walkable(heart.body.x, heart.body.z)).toBe(true);
    expect(Math.hypot(heart.body.x, heart.body.z)).toBeGreaterThan(6);
    run(0.7); expect(Math.hypot(heart.body.x, heart.body.z)).toBeCloseTo(8, 1);
  });

  it('takes one body hit from a real empty-floor World slash and damage from released abilities', () => {
    const { w, heart, igniteFirst, slash, input, run } = setup(); igniteFirst();
    const body = heart.body, angle = Math.atan2(-body.x, -body.z);
    w.hero.spawn(body.x * 1.4, body.z * 1.4, angle);
    const hp = heart.hp, hits = heart.bodyHits;
    const slashes: GameEvents['slash'][] = []; w.bus.on('slash', e => slashes.push(e));
    slash(); expect(slashes).toHaveLength(1); expect(heart.bodyHits).toBe(hits + 1); expect(heart.hp).toBeLessThan(hp);
    // Repeated active World hitbox frames must not repeat the standalone body's damage.
    const after = heart.hp; run(0.15); expect(heart.hp).toBe(after);
    w.hero.spawn(heart.body.x * 1.4, heart.body.z * 1.4, Math.atan2(-heart.body.x, -heart.body.z));
    input.buffer.push('q', input.now); run(0.6);
    expect(heart.bodyHits).toBeGreaterThan(hits + 1); expect(heart.hp).toBeLessThan(after);
  });

  it('aims touch taps and a held charge at the exposed body without a mouse aim override', () => {
    const { w, heart, input, run, igniteFirst } = setup(); igniteFirst(); run(0.8);
    const body = { ...heart.body }, length = Math.hypot(body.x, body.z), dx = body.x / length, dz = body.z / length;
    w.hero.spawn(body.x + dx * 3.5, body.z + dz * 3.5, Math.atan2(dx, dz));
    const carrier = createEnemy('husk', { zone: 0, stage: 0, mode: 1 });
    carrier.x = w.hero.x + dx * 2.5; carrier.z = w.hero.z + dz * 2.5;
    carrier.state = 'idle'; carrier.leash = { x: carrier.x, z: carrier.z, r: 0.1 }; w.addEnemy(carrier);
    const hp = heart.hp;
    input.buffer.push('attack', input.now); run(0.4);
    expect(input.aimActive).toBe(false); expect(w.hero.aimTarget).not.toBeNull();
    expect(heart.bodyHits).toBe(1); expect(heart.hp).toBeLessThan(hp);
    expect(carrier.hp).toBe(carrier.maxHp);
    run(0.7);
    const beforeCharge = heart.hp;
    input.attackHeldSince = input.now; input.attackHeld = true; run(1.2);
    expect(w.hero.chargeLevel).toBe(2);
    input.attackHeld = false; run(0.55);
    expect(heart.bodyHits).toBeGreaterThan(1); expect(heart.hp).toBeLessThan(beforeCharge);
    // The encounter focus respects the movement cone; the stick can still select another foe.
    w.hero.spawn(heart.body.x + dx * 4, heart.body.z + dz * 4, 0);
    const alternate = createEnemy('husk', { zone: 0, stage: 0, mode: 1 });
    alternate.x = w.hero.x + dx * 2.5; alternate.z = w.hero.z + dz * 2.5;
    alternate.state = 'idle'; alternate.leash = { x: alternate.x, z: alternate.z, r: 0.1 }; w.addEnemy(alternate);
    input.moveX = dx; input.moveZ = dz; run(DT);
    expect(w.hero.aimTarget).toBeNull(); expect(w.hero.target?.id).toBe(alternate.id);
    heart.dispose(); expect(w.aimTargets.size).toBe(0);
  });

  it('returns a large heart orb with an ordinary blade swing, then exposes the heart on arrival', () => {
    const { w, heart, run, until, slash } = setup(); heart.start();
    until(() => heart.shots.length > 0, 10);
    until(() => heart.shots[0].z >= 5.2, 2);
    const shot = heart.shots[0]; w.hero.spawn(shot.x, shot.z + 2.2, Math.PI);
    let maxStep=0;
    const step=heart.step.bind(heart);
    heart.step=(dt,enabled=true)=>{const before={...heart.body};step(dt,enabled);maxStep=Math.max(maxStep,Math.hypot(heart.body.x-before.x,heart.body.z-before.z));};
    const hp = heart.hp; slash();
    until(() => heart.reflectedHits === 1, 3);
    expect(heart.hp).toBe(hp - FUNERAL_HEART.reflectionDamage); expect(heart.bodyHits).toBe(0);
    // The return pulls the Heart toward the ring instead of teleporting it in the impact frame.
    expect(maxStep).toBeLessThan(0.9);
    run(0.7); expect(heart.exposed).toBeGreaterThan(3.5);
    expect(w.arena.walkable(heart.body.x, heart.body.z)).toBe(true);
    expect(heart.reflectedHits).toBe(1);
  });

  it('returns an orb through the real perfect-dash window and records the perfect dodge', () => {
    const { w, heart, run, until, input } = setup(); heart.start();
    until(() => heart.shots.length > 0, 10); until(() => heart.shots[0].z >= 5.2, 2);
    const shot = heart.shots[0]; w.hero.spawn(shot.x, shot.z + 1.4, Math.PI);
    input.moveX = 1; input.buffer.push('dash', input.now); run(0.05); input.moveX = 0;
    expect(shot.reflected).toBe(true); expect(w.run.perfectDodges).toBe(1);
    until(() => heart.reflectedHits === 1, 3); expect(heart.hp).toBe(FUNERAL_HEART.hp - FUNERAL_HEART.reflectionDamage);
  });

  for (const sheltered of [true, false]) it(`carrier fire ${sheltered ? 'shelters' : 'does not protect a hero outside it'} from the real dark-sector pulse`, () => {
    const { w, heart, run, until } = setup(); heart.start();
    until(() => heart.attack?.kind === 'pulse', 25);
    const carrier = [...heart.carriers.values()][0]; expect(carrier).toBeTruthy();
    carrier.x = 0; carrier.z = 10; w.killEnemy(carrier, 0, 0, 1);
    expect(heart.fields.some(f => f.kind === 'wax')).toBe(true); expect(heart.counters).toBe(0);
    w.hero.spawn(sheltered ? 0 : 4, 10, Math.PI); w.hero.invulnUntil = 0;
    const hp = w.hero.hp; run(1.6);
    expect(w.hero.hp === hp).toBe(sheltered);
  });

  it('consumes friendly wax for a charged return and caps finite reinforcement pressure', () => {
    const { w, heart, run, until, charged } = setup(); heart.start(); run(3);
    expect(heart.carriers.size).toBe(2);
    const carrier = [...heart.carriers.values()][0]; carrier.x = -7; carrier.z = 8;
    w.killEnemy(carrier, 0, 0, 1);
    const pool = heart.fields.find(f => f.kind === 'wax')!; expect(pool.life).toBe(FUNERAL_HEART.waxSeconds);
    w.hero.spawn(pool.x - 3, pool.z, Math.PI / 2); const hp = heart.hp; charged();
    expect(heart.fields.filter(f => f.kind === 'wax')).toHaveLength(0); expect(heart.counters).toBe(1);
    expect(heart.hp).toBeLessThanOrEqual(hp - FUNERAL_HEART.waxDamage);
    // Kill subsequent carriers away from braziers, so deaths cannot trigger phase-changing counters.
    for (let i = 0; i < 120 * 60; i++) {
      run(DT);
      for (const enemy of [...heart.carriers.values()]) { enemy.x = 0; enemy.z = 12; w.killEnemy(enemy, 0, 0, 1); }
      expect(heart.carriers.size).toBeLessThanOrEqual(FUNERAL_HEART.maxCarriers);
    }
    until(() => heart.spawnedTotal === FUNERAL_HEART.carriersPerPhase, 2);
    expect(heart.spawnedTotal).toBe(FUNERAL_HEART.carriersPerPhase); expect(heart.phase).toBe(1);
  });

  it('changes all three phases through body damage and cleans every threat exactly once at zero hp', () => {
    const { w, heart, run, igniteFirst, charged } = setup(-27); igniteFirst();
    let defeated = 0; heart.onDefeated = () => defeated++;
    const phases = [heart.phase];
    for (let i = 0; i < 20 && !heart.dead; i++) {
      const dx = heart.body.x, dz = heart.body.z - heart.centerZ;
      w.hero.spawn(dx * 1.32, heart.centerZ + dz * 1.32, Math.atan2(-dx, -dz));
      charged(); if (!phases.includes(heart.phase)) phases.push(heart.phase);
    }
    expect(phases).toEqual([1, 2, 3]); expect(heart.hp).toBe(0); expect(heart.dead).toBe(true); expect(heart.active).toBe(false);
    expect(defeated).toBe(1); expect(heart.carriers.size).toBe(0); expect(heart.shots).toHaveLength(0); expect(heart.fields).toHaveLength(0);
    expect(w.enemies.every(e => e.dead)).toBe(true); expect(w.telegraphs.every(t => !t.alive || t.t >= t.dur)).toBe(true);
    const hp = w.hero.hp; run(20); expect(w.hero.hp).toBe(hp); expect(defeated).toBe(1);
    heart.dispose(); w.bus.emit('kill', { target: w.hero, kind: 'husk', x: 0, z: 0, dirX: 0, dirZ: 0, big: false, elite: false });
    expect(heart.fields).toHaveLength(0);
  });
});
