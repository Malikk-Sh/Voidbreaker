import { describe, expect, it } from 'vitest';
import { ZONE1 } from '../src/data/stages';
import { ARENAS } from '../src/data/arenas';
import { BELL_STANDS } from '../src/data/echoBells';
import { Arena } from '../src/world/arena';
import { World, type StrikeParams } from '../src/world/world';
import { Abilities } from '../src/world/abilities';
import { createEnemy } from '../src/world/enemies/factory';
import { Devourer, HUNT } from '../src/world/boss/devourer';
import { DevourerEncounter } from '../src/world/boss/devourerEncounter';
import type { BossHost } from '../src/world/boss/hierophant';
import { buildDevourer } from '../src/gen/chars/devourer';
import { DEVOURER_CLIPS } from '../src/anim/clips/devourer';
import { devourerIntro, LANDING } from '../src/world/boss/devourerScenes';
import { CameraRig } from '../src/world/camera';
import { Director } from '../src/game/director';

const hit: StrikeParams = { mult: 1, stun: 0, knockback: 0, feel: 'light', dirX: 0, dirZ: 1, source: 'blade' };
const dt = 1 / 60;
function setup() {
  const stage = ZONE1.find((s) => s.id === 'boss1')!;
  const w = new World(new Arena(ARENAS[stage.arena]), 'devourer-test');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 5, Math.PI);
  const b = createEnemy(stage.waves[0].spawns[0].enemy, { zone: 0, stage: 0 }) as Devourer;
  w.addEnemy(b);
  b.x = 0;
  b.z = -1;
  b.beginHunt(1);
  return { b, w };
}
function advance(b: Devourer, w: World, until: () => boolean, limit = 600) {
  for (let i = 0; i < limit && !until(); i++) {
    w.time += dt;
    b.step(w, dt);
  }
  expect(until()).toBe(true);
}
function ring(w: World, i = 0, list = new Set<number>(), source: StrikeParams['source'] = 'blade') {
  const { x, z } = BELL_STANDS[i];
  w.heroStrike({ k: 'circle', x, z, r: 0.55 }, list, { ...hit, source });
}
describe('Пожиратель', () => {
  it('обитает в открытой каменоломне; все три подвеса достижимы с обеих сторон', () => {
    const { b, w } = setup();
    expect(b).toBeInstanceOf(Devourer);
    expect(b.def.name).toBe('Пожиратель');
    expect(w.arena.def.decor).toBe('quarry');
    for (const p of BELL_STANDS) for (const side of [-1, 1]) expect(w.arena.walkable(p.x + 1.2 * side, p.z)).toBe(true);
    expect(w.aimTargets.size).toBe(3);
    w.hero.x = BELL_STANDS[0].x;
    w.hero.z = BELL_STANDS[0].z;
    expect([...w.aimTargets].filter((t) => t.targetable)).toHaveLength(1);
    ring(w);
    expect([...w.aimTargets].every((t) => !t.targetable)).toBe(true);
  });
  it('реагирует на клинок один раз за взмах; способность или удар вдали не звонят', () => {
    const { b, w } = setup();
    const hits = new Set<number>();
    let count = 0;
    w.bus.on('bellPulse', (e) => {
      if (e.big) count++;
    });
    ring(w, 0, hits, 'ability');
    w.heroStrike({ k: 'circle', x: 3, z: 7, r: 0.7 }, hits, hit);
    expect(count).toBe(0);
    ring(w, 0, hits);
    ring(w, 0, hits);
    ring(w, 0);
    expect(count).toBe(1);
    expect(b.attack).toBe('rush');
    expect(b.motion).toBe('aim');
    expect(b.tele?.shape.k).toBe('line');
    expect(b.lastTeleDur).toBeGreaterThanOrEqual(0.8);
  });
  it('фиксирует направление броска; оставленный путь безопасен, удар об опору открывает горло', () => {
    const { b, w } = setup();
    ring(w);
    const { targetX, targetZ } = b;
    w.hero.x = 8;
    w.hero.z = -7;
    advance(b, w, () => b.inWindow);
    expect([b.x, b.z]).toEqual([targetX, targetZ]);
    expect(w.run.hitsTaken).toBe(0);
    expect(b.hp).toBe(b.maxHp - Math.round(b.maxHp * HUNT.crashFraction));
    const hp = b.hp;
    w.damageEnemy(b, hit);
    const open = hp - b.hp;
    const end = b.duration;
    b.step(w, dt);
    const pose = b.puppet.skel.rot.slice();
    w.damageEnemy(b, hit);
    b.step(w, dt * 4);
    expect(b.puppet.skel.rot).not.toEqual(pose);
    expect(b.duration).toBe(end);
    advance(b, w, () => b.motion === 'hunt');
    const shell = b.hp;
    w.damageEnemy(b, hit);
    expect(open).toBeGreaterThan((shell - b.hp) * 2);
  });
  it('промах по герою не открывает шею; в третьей фазе перед повторным броском есть новая метка', () => {
    const { b, w } = setup();
    b.phase = 3;
    b.beginHunt(0);
    b.step(w, dt);
    expect(b.attack).toBe('rush');
    const first = b.tele;
    advance(b, w, () => b.motion === 'active');
    w.hero.x = 6;
    w.hero.z = 1;
    advance(b, w, () => b.motion === 'aim');
    expect(b.tele).not.toBe(first);
    expect(b.lastTeleDur).toBeGreaterThanOrEqual(0.8);
    expect(b.inWindow).toBe(false);
    advance(b, w, () => b.motion === 'recover');
    expect(b.hp).toBe(b.maxHp);
  });
  it('естественный звон сорванного колокола не отнимает здоровье у босса', () => {
    const { b, w } = setup();
    b.phase = 2;
    b.loose = true;
    w.hero.invulnUntil = 1e6;
    let bounces = 0;
    w.bus.on('bellPulse', (e) => {
      if (!e.big) bounces++;
    });
    for (let i = 0; i < 60 * 24; i++) b.step(w, dt);
    expect(bounces).toBeGreaterThan(2);
    expect(b.hp).toBe(b.maxHp);
    expect(Math.abs(b.bells[2].x)).toBeLessThanOrEqual(5.6);
  });
  it.each(['full', 'short', 'skip'] as const)(
    'вступление %s возвращает одного живого босса и безопасный первый замах',
    (variant) => {
      const { w, b } = setup();
      let calls: Record<string, (arg?: number) => void> = {};
      const director = new Director({
        actor: (id) => (id === 'boss' ? b : id === 'echoStone' ? b.stone : id === 'hero' ? w.hero : null),
        call: (fn) => calls[fn]?.(),
        holding: () => false,
        tapped: () => false,
        seen: () => (variant === 'short' ? 2 : 0),
        markSeen: () => {},
      });
      const host = {
        world: w,
        scene: (track, c, end) => {
          calls = c;
          director.play(track, end);
        },
        startSong: () => {},
      } as Pick<BossHost, 'world' | 'scene' | 'startSong'>;
      const encounter = new DevourerEncounter(host as BossHost, b, () => {});
      expect(encounter.hudBoss()).toBeNull();
      const cam = new CameraRig();
      if (variant === 'skip') director.skip();
      for (let i = 0; director.active && i < 800; i++) director.update(dt, cam);
      expect(b.motion).toBe('hunt');
      expect([b.x, b.y, b.z]).toEqual(LANDING);
      expect(encounter.hudBoss()).toBe(b);
      expect(b.duration).toBeGreaterThan(0.7);
    }
  );
  it('один большой удар не пропускает ни фазу, ни смерть; награда выдаётся один раз', () => {
    const { b, w } = setup();
    let ended = 0,
      stars = 0;
    const host = {
      world: w,
      scene: (track, c, end) => {
        for (const s of track.steps) if (s.do === 'call') c[s.fn]?.(s.arg);
        end(true);
      },
      startSong: () => {},
      musicPhase: () => {},
      sky: () => {},
      beam: () => {},
      finishFight: () => ended++,
      saveStar: () => stars++,
    } as Pick<BossHost, 'world' | 'scene' | 'startSong' | 'musicPhase' | 'sky' | 'beam' | 'finishFight' | 'saveStar'>;
    const enc = new DevourerEncounter(host as BossHost, b, () => {});
    for (const phase of [2, 3]) {
      w.damageEnemy(b, { ...hit, mult: 2000 });
      expect(b.invulnerable).toBe(true);
      expect(b.dead).toBe(false);
      enc.step(dt);
      expect(b.phase).toBe(phase);
    }
    w.damageEnemy(b, { ...hit, mult: 2000 });
    enc.step(dt);
    enc.step(dt);
    expect(b.dead).toBe(true);
    expect(w.run.kills).toBe(1);
    expect([ended, stars]).toEqual([1, 1]);
  });
  it('все кости клипов существуют, модель укладывается в мобильный батч, падение камня предшествует броску', () => {
    const { rig, geometry } = buildDevourer();
    const names = new Set(rig.joints.map((j) => j.name));
    for (const c of DEVOURER_CLIPS)
      for (const k of c.keys) for (const n of Object.keys(k.pose)) expect(names.has(n)).toBe(true);
    const count = geometry.attributes.position.count;
    expect(count / 3).toBeLessThan(18000);
    expect(count / 3).toBeGreaterThan(1000);
    expect(geometry.attributes.position.array.every(Number.isFinite)).toBe(true);
    for (const steps of [devourerIntro().steps, devourerIntro().short!]) {
      const tick = steps.find((s) => s.do === 'call' && s.fn === 'stoneTick')!;
      const charge = steps.find((s) => s.do === 'actor' && s.who === 'boss' && s.moveTo)!;
      expect(charge.t).toBeGreaterThan(tick.t);
    }
    geometry.dispose();
  });
});
