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
  /** Стоять у тела Сердца и смотреть на него (лицом к центру зала). */
  const faceBody = (k = 1.32) => {
    const dx = heart.body.x, dz = heart.body.z - heart.centerZ;
    w.hero.spawn(dx * k, heart.centerZ + dz * k, Math.atan2(-dx, -dz));
  };
  /** Встать сбоку от лежащего Сердца на кольце 8–12 м: долгий бой не уводит героя к краю зала. */
  const besideBody = () => {
    const dx = heart.body.x, dz = heart.body.z - heart.centerZ + 0.5, a = Math.atan2(dx, dz);
    const r = Math.max(8, Math.min(12, Math.hypot(dx, dz))), b = a + 2 / r;
    const x = Math.sin(b) * r, z = heart.centerZ - 0.5 + Math.cos(b) * r;
    w.hero.spawn(x, z, Math.atan2(heart.body.x - x, heart.body.z - z));
  };
  /** Первое падение боя: Сердце выслеживает героя, падает в его точку и лежит открытым. */
  const firstDive = () => {
    heart.start(); until(() => heart.pose === 'stuck', 8);
    expect(heart.exposed).toBeGreaterThan(2.5);
  };
  /** Огонь: падение рядом с чашей раскаляет её, обычный удар клинком зажигает. */
  const igniteFirst = () => {
    const bowl = heart.braziers[0];
    w.hero.spawn(bowl.x + 2.2, bowl.z, -Math.PI / 2);
    heart.start(); until(() => heart.pose === 'stuck', 8);
    expect(heart.heat[0]).toBeGreaterThan(0.9);
    w.hero.spawn(bowl.x + 1.6, bowl.z, -Math.PI / 2); slash();
    expect(heart.lit[0]).toBe(true);
    return 0;
  };
  return { w, heart, input, run, until, slash, charged, faceBody, besideBody, firstDive, igniteFirst };
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

  it('is inert before awakening and freezes the dive, heat and spawns while disabled', () => {
    const { w, heart, run, until } = setup(-27);
    run(20); expect(heart.attack).toBeNull(); expect(w.enemies).toHaveLength(0); expect(w.telegraphs).toHaveLength(0);
    expect(heart.body.y).toBe(FUNERAL_HEART.hover[0]); const initialBody = { ...heart.body };
    expect(heart.start()).toBe(true); expect(heart.start()).toBe(false);
    run(DT); expect(heart.body.x).toBe(initialBody.x); expect(heart.body.z).toBe(initialBody.z); expect(heart.body.y).toBeCloseTo(initialBody.y, 2);
    run(1.9); expect(heart.attack?.kind).toBe('dive'); expect(heart.pose).toBe('track');
    const before = { t: heart.attack!.t, hp: heart.hp, pose: heart.pose, body: { ...heart.body }, spawned: heart.spawnedTotal };
    run(8, false);
    expect({ t: heart.attack!.t, hp: heart.hp, pose: heart.pose, body: heart.body, spawned: heart.spawnedTotal }).toEqual(before);
    expect(heart.shots).toHaveLength(0);
    until(() => heart.pose === 'stuck', 5); expect(heart.metrics.dives).toBe(1);
  });

  it('dives where the hero stood: a shadow tracks, then a locked mark warns at least 1.2 s; standing still is punished', () => {
    const { w, heart, run, until } = setup(); heart.start();
    w.hero.invulnUntil = 0;
    until(() => heart.pose === 'lock', 4);
    // Метка стоит там, где был герой, и не двигается за ним после фиксации.
    const mark = { ...heart.target };
    expect(Math.hypot(mark.x - w.hero.x, mark.z - w.hero.z)).toBeLessThan(0.6);
    const tele = w.telegraphs.find(t => t.alive && t.shape.k === 'circle' && Math.hypot(t.shape.x - mark.x, t.shape.z - mark.z) < 0.01);
    expect(tele).toBeTruthy(); expect(tele!.dur).toBeGreaterThanOrEqual(1.2);
    // Сердце висит над меткой, высоко над полом.
    run(0.4); expect(heart.body.y).toBeGreaterThan(4.5);
    expect(Math.hypot(heart.body.x - mark.x, heart.body.z - mark.z)).toBeLessThan(0.8);
    const hp = w.hero.hp;
    until(() => heart.pose === 'stuck', 3);
    expect(w.hero.hp).toBeLessThan(hp);
    expect(hp - w.hero.hp).toBeGreaterThanOrEqual(Math.round(w.hero.maxHp * FUNERAL_HEART.dmg.dive * 0.8));
    expect(Math.hypot(heart.body.x - mark.x, heart.body.z - mark.z)).toBeLessThan(0.01);
    run(0.3); expect(heart.body.y).toBeLessThan(1.6); expect(heart.open).toBeGreaterThan(0.5);
  });

  it('the heart lies open after a missed dive, then marks its get-up strike before rising', () => {
    const { w, heart, until, firstDive } = setup(); firstDive();
    const at = { ...heart.body };
    expect(w.arena.walkable(at.x, at.z)).toBe(true);
    until(() => w.telegraphs.some(t => t.alive && t.shape.k === 'circle' && t.shape.r > 3 && Math.hypot(t.shape.x - at.x, t.shape.z - at.z) < 0.01), 4);
    const getUp = w.telegraphs.find(t => t.alive && t.shape.k === 'circle' && t.shape.r > 3)!;
    expect(getUp.dur).toBeGreaterThanOrEqual(1.2);
    expect(heart.exposed).toBeGreaterThan(0); expect(heart.pose).toBe('stuck');
    w.hero.spawn(at.x + 1.5, at.z, -Math.PI / 2); w.hero.invulnUntil = 0;
    const hp = w.hero.hp;
    until(() => heart.pose === 'rise', 3);
    expect(w.hero.hp).toBeLessThan(hp); expect(heart.exposed).toBe(0);
    until(() => heart.pose === 'hover', 2);
  });

  it('closed armour rings and only chips; the open core takes the real blow', () => {
    const { w, heart, run, slash } = setup();
    const clanks: GameEvents['heartClank'][] = []; w.bus.on('heartClank', e => clanks.push(e));
    heart.start(); run(0.2);
    // Над колодцем, с кромки: удар достаёт броню, но почти не ранит.
    w.hero.spawn(0, 3.9, Math.PI); let hp = heart.hp; slash();
    const chip = hp - heart.hp;
    expect(clanks.length).toBe(1); expect(chip).toBeGreaterThan(0);
    const open = setup(); open.firstDive(); open.faceBody(); hp = open.heart.hp; open.slash();
    expect(hp - open.heart.hp).toBeGreaterThan(chip * 4);
  });

  it('a dive near a bowl heats it; any blade swing returns the fire, which knocks the heart down toward the bowl', () => {
    const { w, heart, run, until, slash } = setup();
    const bowl = heart.braziers[0];
    w.hero.spawn(bowl.x + 2.2, bowl.z, -Math.PI / 2);
    heart.start(); until(() => heart.pose === 'stuck', 8);
    expect(heart.heat[0]).toBeGreaterThan(0.9); expect(heart.lit[0]).toBe(false);
    // Пока Сердце лежит рядом, проверим розжиг на поднявшемся: ждём, когда оно вернётся в воздух.
    until(() => heart.pose === 'hover', 5);
    w.hero.spawn(bowl.x + 1.6, bowl.z, -Math.PI / 2);
    const hp = heart.hp; slash();
    expect(heart.lit[0]).toBe(true); expect(heart.flameLife[0]).toBeGreaterThan(13);
    expect(heart.counters).toBe(1); expect(heart.hp).toBeLessThanOrEqual(hp - FUNERAL_HEART.counterDamage);
    expect(heart.pose).toBe('knock');
    run(0.6); expect(heart.pose).toBe('stuck'); expect(heart.exposed).toBeGreaterThan(2);
    expect(w.arena.walkable(heart.body.x, heart.body.z)).toBe(true);
    // Сброшено на кольцо в сторону огня.
    const toBowl = Math.atan2(bowl.x, bowl.z + 0.5), toBody = Math.atan2(heart.body.x, heart.body.z + 0.5);
    expect(Math.abs(toBowl - toBody)).toBeLessThan(0.5);
  });

  it('takes one body hit from a real empty-floor World slash and damage from released abilities', () => {
    const { w, heart, firstDive, slash, faceBody, input, run } = setup(); firstDive();
    faceBody(1.4);
    const hp = heart.hp, hits = heart.bodyHits;
    const slashes: GameEvents['slash'][] = []; w.bus.on('slash', e => slashes.push(e));
    slash(); expect(slashes).toHaveLength(1); expect(heart.bodyHits).toBe(hits + 1); expect(heart.hp).toBeLessThan(hp);
    // Repeated active World hitbox frames must not repeat the standalone body's damage.
    const after = heart.hp; run(0.15); expect(heart.hp).toBe(after);
    faceBody(1.4);
    input.buffer.push('q', input.now); run(0.6);
    expect(heart.bodyHits).toBeGreaterThan(hits + 1); expect(heart.hp).toBeLessThan(after);
  });

  it('aims touch taps and a held charge at the exposed body without a mouse aim override', () => {
    const { w, heart, input, run, firstDive } = setup(); firstDive();
    heart.exposed = 10; run(0.2);
    const body = { ...heart.body }, length = Math.hypot(body.x, body.z), dx = body.x / length, dz = body.z / length;
    w.hero.spawn(body.x + dx * 3.5, body.z + dz * 3.5, Math.atan2(dx, dz));
    const carrier = createEnemy('husk', { zone: 0, stage: 0, mode: 1 });
    carrier.x = w.hero.x + dx * 2.5; carrier.z = w.hero.z + dz * 2.5;
    carrier.state = 'idle'; carrier.leash = { x: carrier.x, z: carrier.z, r: 0.1 }; w.addEnemy(carrier);
    const hp = heart.hp, hits = heart.bodyHits;
    input.buffer.push('attack', input.now); run(0.4);
    expect(input.aimActive).toBe(false); expect(w.hero.aimTarget).not.toBeNull();
    expect(heart.bodyHits).toBe(hits + 1); expect(heart.hp).toBeLessThan(hp);
    expect(carrier.hp).toBe(carrier.maxHp);
    run(0.7);
    const beforeCharge = heart.hp;
    input.attackHeldSince = input.now; input.attackHeld = true; run(1.2);
    expect(w.hero.chargeLevel).toBe(2);
    input.attackHeld = false; run(0.55);
    expect(heart.bodyHits).toBeGreaterThan(hits + 1); expect(heart.hp).toBeLessThan(beforeCharge);
    // The encounter focus respects the movement cone; the stick can still select another foe.
    w.killEnemy(carrier, 0, 0, 0);
    w.hero.spawn(heart.body.x + dx * 4, heart.body.z + dz * 4, 0);
    const alternate = createEnemy('husk', { zone: 0, stage: 0, mode: 1 });
    alternate.x = w.hero.x + dx * 2.5; alternate.z = w.hero.z + dz * 2.5;
    alternate.state = 'idle'; alternate.leash = { x: alternate.x, z: alternate.z, r: 0.1 }; w.addEnemy(alternate);
    input.moveX = dx; input.moveZ = dz; run(DT);
    expect(w.hero.aimTarget).toBeNull(); expect(w.hero.target?.id).toBe(alternate.id);
    heart.dispose(); expect(w.aimTargets.size).toBe(0);
  });

  it('returns a large heart orb with an ordinary blade swing; the return knocks the heart down onto the ring', () => {
    const { w, heart, run, until, slash } = setup(); heart.start();
    until(() => heart.shots.length > 0, 15);
    until(() => heart.shots[0].z >= 5.2, 2);
    const shot = heart.shots[0]; w.hero.spawn(shot.x, shot.z + 2.2, Math.PI);
    let maxStep = 0;
    const step = heart.step.bind(heart);
    heart.step = (dt, enabled = true) => { const before = { ...heart.body }; step(dt, enabled); maxStep = Math.max(maxStep, Math.hypot(heart.body.x - before.x, heart.body.z - before.z)); };
    const hp = heart.hp; slash();
    until(() => heart.reflectedHits === 1, 3);
    expect(heart.hp).toBe(hp - FUNERAL_HEART.reflectionDamage); expect(heart.bodyHits).toBe(0);
    expect(heart.pose).toBe('knock');
    // The return pulls the Heart toward the ring instead of teleporting it in the impact frame.
    expect(maxStep).toBeLessThan(0.9);
    run(0.7); expect(heart.pose).toBe('stuck'); expect(heart.exposed).toBeGreaterThan(1.8);
    expect(w.arena.walkable(heart.body.x, heart.body.z)).toBe(true);
    expect(heart.reflectedHits).toBe(1); expect(heart.metrics.knockdowns).toBe(1);
  });

  it('returns an orb through the real perfect-dash window and records the perfect dodge', () => {
    const { w, heart, run, until, input } = setup(); heart.start();
    until(() => heart.shots.length > 0, 15); until(() => heart.shots[0].z >= 5.2, 2);
    const shot = heart.shots[0]; w.hero.spawn(shot.x, shot.z + 1.4, Math.PI);
    input.moveX = 1; input.buffer.push('dash', input.now); run(0.05); input.moveX = 0;
    expect(shot.reflected).toBe(true); expect(w.run.perfectDodges).toBe(1);
    until(() => heart.reflectedHits === 1, 3); expect(heart.hp).toBe(FUNERAL_HEART.hp - FUNERAL_HEART.reflectionDamage);
  });

  for (const sheltered of [true, false]) it(`a golden dome ${sheltered ? 'carves a gap in' : 'does not protect a hero outside it from'} the dark ring wave`, () => {
    const { w, heart, until, run } = setup(); heart.start();
    heart.fields.push({ id: 999, x: 0, z: 10, r: FUNERAL_HEART.dome, life: 90, dur: 90, kind: 'wax' });
    until(() => heart.attack?.kind === 'pulse', 40);
    const ring = w.telegraphs.find(t => t.alive && t.shape.k === 'ring');
    expect(ring?.shape.k === 'ring' && (ring.shape.gaps ?? []).some(g => Math.abs(g.a) < 0.05)).toBe(true);
    w.hero.spawn(sheltered ? 0 : 4, 10, Math.PI); w.hero.invulnUntil = 0;
    const hp = w.hero.hp;
    until(() => w.ringWaves.length > 0, 2);
    expect(w.ringWaves[0].gaps.length).toBeGreaterThan(0);
    run(2.2);
    expect(w.hero.hp === hp).toBe(sheltered);
  });

  it('a lit bowl carves its own gap in the wave; the telegraph shows the gaps before the wave', () => {
    const { w, heart, until, igniteFirst } = setup(); igniteFirst();
    until(() => heart.attack?.kind === 'pulse', 40);
    const ring = w.telegraphs.find(t => t.alive && t.shape.k === 'ring');
    expect(ring).toBeTruthy();
    const gaps = ring!.shape.k === 'ring' ? ring!.shape.gaps ?? [] : [];
    const bowl = heart.braziers[0], a = Math.atan2(bowl.x, bowl.z + 0.5);
    if (heart.lit[0]) expect(gaps.some(g => Math.abs(g.a - a) < 0.05)).toBe(true);
    until(() => w.ringWaves.length > 0, 3);
    if (heart.lit[0]) expect(w.ringWaves[0].gaps.some(g => Math.abs(g.a - a) < 0.05)).toBe(true);
  });

  it('fire-bearers come only from phase II, at most two alive; each fallen bearer leaves a golden dome, not a weapon', () => {
    const { w, heart, run, charged } = setup(); heart.start(); run(30);
    expect(heart.spawnedTotal).toBe(0);
    heart.phase = 2; run(1);
    expect(heart.carriers.size).toBe(1);
    const domes: GameEvents['heartDome'][] = []; w.bus.on('heartDome', e => domes.push(e));
    const bearer = [...heart.carriers.values()][0]; bearer.x = -7; bearer.z = 8;
    w.killEnemy(bearer, 0, 0, 1);
    expect(domes).toHaveLength(1); expect(heart.metrics.domes).toBe(1);
    const dome = heart.fields.find(f => f.kind === 'wax')!;
    expect(dome.life).toBe(FUNERAL_HEART.domeSeconds); expect(dome.r).toBe(FUNERAL_HEART.dome);
    expect(heart.inDome(dome.x, dome.z)).toBe(true); expect(heart.inDome(dome.x + dome.r + 0.2, dome.z)).toBe(false);
    // Заряженный удар по куполу больше не жжёт Сердце: купол — укрытие, а не оружие.
    w.hero.spawn(dome.x - 3, dome.z, Math.PI / 2); const hp = heart.hp; charged();
    expect(heart.hp).toBe(hp); expect(heart.fields.some(f => f.kind === 'wax')).toBe(true); expect(heart.counters).toBe(0);
    for (let i = 0; i < 60 * 60; i++) { run(DT); expect(heart.carriers.size).toBeLessThanOrEqual(FUNERAL_HEART.maxBearers); }
    expect(heart.spawnedTotal).toBeGreaterThanOrEqual(3);
  });

  for (const sheltered of [true, false]) it(`the Funeral Flood opens phase II: out of reach, three fire-bearers, a tide to the walls — ${sheltered ? 'a dome shelters' : 'outside a dome it hurts'}`, () => {
    const { w, heart, run, until, charged, faceBody, firstDive } = setup(); firstDive();
    const summons: GameEvents['heartSummon'][] = [], crashes: GameEvents['heartFlood'][] = [], roars: GameEvents['heartRoar'][] = [];
    w.bus.on('heartSummon', e => summons.push(e)); w.bus.on('heartFlood', e => crashes.push(e)); w.bus.on('heartRoar', e => roars.push(e));
    heart.exposed = 30;
    for (let i = 0; i < 40 && heart.phase === 1; i++) { faceBody(); charged(); }
    expect(heart.phase).toBe(2);
    until(() => heart.pose === 'flood', FUNERAL_HEART.rage + 1);
    expect(heart.attack?.kind).toBe('flood'); expect(roars).toHaveLength(1);
    expect(heart.lit.some(Boolean)).toBe(false); expect(heart.heat.every(h => h === 0)).toBe(true);
    run(0.6);
    expect(summons).toHaveLength(1); expect(heart.carriers.size).toBe(FUNERAL_HEART.bearers);
    expect(heart.body.y).toBeGreaterThan(5);
    const front = heart.flood!.front; run(1.5);
    expect(heart.flood!.front).toBeGreaterThan(front); expect(heart.flood!.level).toBe(1);
    // Недосягаемо: клинок только звенит.
    const hp0 = heart.hp; faceBody(1.2); charged(); expect(heart.hp).toBe(hp0);
    const [first] = [...heart.carriers.values()];
    first.x = 0; first.z = 10; w.killEnemy(first, 0, 0, 1);
    const dome = heart.fields.find(f => f.kind === 'wax')!;
    expect(dome).toBeTruthy();
    w.hero.spawn(sheltered ? dome.x : dome.x + 4.5, dome.z, Math.PI); w.hero.invulnUntil = 0;
    const hp = w.hero.hp;
    until(() => crashes.length === FUNERAL_HEART.flood.pulses, 8);
    expect(heart.flood!.front).toBeGreaterThan(18);
    // Огненосцев, не отдавших свет, тьма поглотила без купола.
    expect(heart.carriers.size).toBe(0); expect(heart.metrics.domes).toBe(1);
    expect(crashes.every(c => c.safe === sheltered)).toBe(true);
    if (sheltered) { expect(w.hero.hp).toBe(hp); expect(heart.metrics.sheltered).toBe(FUNERAL_HEART.flood.pulses); }
    else expect(hp - w.hero.hp).toBeGreaterThanOrEqual(2 * Math.round(w.hero.maxHp * FUNERAL_HEART.dmg.flood) - 1);
    until(() => heart.flood === null, 3);
    until(() => heart.pose === 'hover', 3);
  });

  it('wax rain (phase II) drops warned circles one after another where the hero stands and runs', () => {
    const { w, heart, run, until } = setup(); heart.start(); run(0.1);
    heart.phase = 2; (heart as unknown as { beginAttack(k: string): void }).beginAttack('rain');
    expect(heart.attack?.kind).toBe('rain');
    run(DT);
    const first = w.telegraphs.filter(t => t.alive && t.shape.k === 'circle');
    expect(first).toHaveLength(1); expect(first[0].dur).toBeGreaterThanOrEqual(1.2);
    expect(first[0].shape.k === 'circle' && Math.hypot(first[0].shape.x - w.hero.x, first[0].shape.z - w.hero.z)).toBeLessThan(0.6);
    expect(heart.drops).toHaveLength(1);
    run(1.3); expect(heart.metrics.drops).toBe(1);
    until(() => heart.attack === null, 5);
    expect(heart.metrics.drops).toBe(8); expect(heart.drops).toHaveLength(0);
  });

  it('phase III dives leave echoes that strike again after a warned 1.3 s; the open landing leaves none', () => {
    const { w, heart, run, until } = setup(); heart.start(); run(0.1);
    heart.phase = 3; (heart as unknown as { beginAttack(k: string): void }).beginAttack('dives');
    until(() => heart.metrics.dives === 1, 6);
    expect(heart.echoes).toHaveLength(1);
    const echo = heart.echoes[0];
    const tele = w.telegraphs.find(t => t.alive && t.shape.k === 'circle' && Math.hypot(t.shape.x - echo.x, t.shape.z - echo.z) < 0.01 && t.dur === FUNERAL_HEART.echo);
    expect(tele).toBeTruthy(); expect(FUNERAL_HEART.echo).toBeGreaterThanOrEqual(1.2);
    until(() => heart.pose === 'stuck', 6);
    expect(heart.metrics.dives).toBe(3);
    until(() => heart.metrics.echoes === 2, 3);
    run(2); expect(heart.metrics.echoes).toBe(2); expect(heart.echoes).toHaveLength(0);
  });

  it('a phase change is a rage, not a free window: one series stops at the threshold, armour flies off, the core stays shut', () => {
    const { w, heart, run, until, charged, faceBody, firstDive } = setup(); firstDive();
    const rages: GameEvents['heartRage'][] = []; w.bus.on('heartRage', e => rages.push(e));
    heart.exposed = 30;
    for (let i = 0; i < 40 && heart.phase === 1; i++) { faceBody(); charged(); }
    expect(heart.phase).toBe(2); expect(rages).toHaveLength(1);
    expect(heart.hp).toBe(Math.round(heart.maxHp * 2 / 3));
    expect(heart.pose).toBe('rage'); expect(heart.exposed).toBe(0);
    // В ярости клинок лишь звенит.
    const hp = heart.hp; faceBody(1.6); charged(); expect(heart.hp).toBe(hp);
    // После ярости новая фаза открывается приливом.
    until(() => heart.pose === 'flood', FUNERAL_HEART.rage + 1);
    expect(heart.rage).toBe(0); expect(heart.exposed).toBe(0); expect(heart.attack?.kind).toBe('flood');
    run(DT);
  });

  it('a scene can drive the death by its own clock: one burst, one defeat, then the fire wave keeps going', () => {
    const { w, heart, firstDive, faceBody, slash } = setup(-27);
    let defeated = 0; heart.onDefeated = () => defeated++;
    const bursts: GameEvents['heartBurst'][] = []; w.bus.on('heartBurst', e => bursts.push(e));
    firstDive(); heart.phase = 3; heart.hp = 1; faceBody(); slash();
    expect(heart.hp).toBe(0); expect(heart.pose).toBe('dying');
    heart.sampleDeath(1.0); expect(heart.burst).toBe(false); expect(heart.dead).toBe(false);
    heart.sampleDeath(0.5); expect(heart.burst).toBe(false);
    heart.sampleDeath(FUNERAL_HEART.burstAt); expect(bursts).toHaveLength(1);
    heart.sampleDeath(FUNERAL_HEART.dying); expect(heart.dead).toBe(true); expect(defeated).toBe(1);
    heart.sampleDeath(FUNERAL_HEART.dying + 1.6); heart.sampleDeath(1);
    expect(bursts).toHaveLength(1); expect(defeated).toBe(1);
    expect(heart.visibilityAt(14, -27)).toBe(1); expect(heart.visibilityAt(-14, -38)).toBe(1);
  });

  it('changes all three phases through real windows, then bursts and cleans every threat exactly once', () => {
    const { w, heart, run, charged, besideBody } = setup(-27);
    let defeated = 0; heart.onDefeated = () => defeated++;
    const bursts: GameEvents['heartBurst'][] = []; w.bus.on('heartBurst', e => bursts.push(e));
    heart.start();
    const phases = [heart.phase];
    for (let i = 0; i < 2400 && !heart.dead && heart.dying === 0; i++) {
      if (heart.pose === 'stuck' && heart.exposed > 0.6) { besideBody(); charged(); }
      else run(0.25);
      expect(w.hero.dead).toBe(false);
      if (!phases.includes(heart.phase)) phases.push(heart.phase);
    }
    expect(phases).toEqual([1, 2, 3]); expect(heart.hp).toBe(0);
    expect(heart.dying).toBeGreaterThan(0); expect(heart.dead).toBe(false); expect(defeated).toBe(0);
    // Гибель: огонь ещё не вернулся, все угрозы уже убраны.
    expect(heart.carriers.size).toBe(0); expect(heart.shots).toHaveLength(0); expect(heart.fields).toHaveLength(0);
    expect(heart.drops).toHaveLength(0); expect(heart.echoes).toHaveLength(0); expect(heart.flood).toBeNull();
    expect(heart.metrics.floods).toBeGreaterThanOrEqual(2);
    expect(w.ringWaves.filter(r => r.owner === -941)).toHaveLength(0);
    expect(w.enemies.every(e => e.dead)).toBe(true); expect(w.telegraphs.every(t => !t.alive || t.t >= t.dur)).toBe(true);
    run(FUNERAL_HEART.burstAt + 0.1); expect(bursts).toHaveLength(1); expect(heart.burst).toBe(true);
    run(FUNERAL_HEART.dying - FUNERAL_HEART.burstAt); expect(heart.dead).toBe(true); expect(heart.active).toBe(false); expect(defeated).toBe(1);
    // Огонь возвращается волной от лопнувшего ядра и доходит до всех свечей.
    run(2.5); expect(heart.visibilityAt(14, -27)).toBe(1); expect(heart.visibilityAt(-14, -38)).toBe(1);
    const hp = w.hero.hp; run(20); expect(w.hero.hp).toBe(hp); expect(defeated).toBe(1);
    heart.dispose(); w.bus.emit('kill', { target: w.hero, kind: 'husk', x: 0, z: 0, dirX: 0, dirZ: 0, big: false, elite: false });
    expect(heart.fields).toHaveLength(0);
  });
});
