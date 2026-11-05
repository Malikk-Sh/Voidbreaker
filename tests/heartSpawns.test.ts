import { describe, expect, it, vi } from 'vitest';
import { ARENAS, inPart } from '../src/data/arenas';
import { ENEMIES } from '../src/data/enemies';
import { stageById } from '../src/data/stages';
import { Arena } from '../src/world/arena';
import { CATHEDRAL, CathedralRoute, cathedralArena } from '../src/world/cathedralRoute';
import { heartArena, HeartPassage } from '../src/world/heartPassage';
import { BIG_RADIUS } from '../src/world/nav';
import { StageRunner } from '../src/world/stage';
import { World } from '../src/world/world';

for (const joined of [false, true]) describe(`First candle hall spawns (${joined ? 'joined' : 'standalone'})`, () => {
  it('keeps every spawn in all four original waves inside the first hall when the next chamber exists', () => {
    const foreZ = joined ? CATHEDRAL.hallZ : 0;
    const arena = new Arena(joined ? cathedralArena() : heartArena(ARENAS.candles, 0));
    if (joined) { const route = new CathedralRoute(arena); route.startBridge(); route.step(0, -47); }
    const passage = new HeartPassage(arena, foreZ);
    const world = new World(arena, `heart:spawns:${joined}`), stage = stageById('1-4')!;
    const hero = { x: 0, z: foreZ + 7 };
    world.hero.spawn(hero.x, hero.z, Math.PI); world.nav.update(0, hero.x, hero.z, true);
    const runner = new StageRunner(world, stage);
    expect(stage.waves).toHaveLength(4);
    expect(stage.waves[3].spawns.some(spawn => !!spawn.elite?.length)).toBe(true);
    for (const wave of stage.waves) for (const spawn of [...wave.spawns, ...(wave.triggers ?? []).map(trigger => trigger.spawn)]) {
      const enemy = ENEMIES[spawn.enemy];
      for (let i = 0; i < 48; i++) {
        const point = runner.pickPos(spawn, i, 48);
        expect(inPart(arena.def.encounter!, point.x, point.z, 0.35), `${spawn.enemy}: ${point.x},${point.z}`).toBe(true);
        expect(arena.walkable(point.x, point.z)).toBe(true);
        expect(Math.hypot(point.x - hero.x, point.z - hero.z)).toBeGreaterThanOrEqual(3.2);
        if (!enemy.ranged) expect(world.nav.reachable(point.x, point.z, enemy.radius > BIG_RADIUS)).toBe(true);
      }
    }
    expect(passage.phase).toBe('waiting');
  });

  it('always finds a valid encounter tile even when random sampling repeatedly chooses the same edge', () => {
    const foreZ = joined ? CATHEDRAL.hallZ : 0;
    const arena = new Arena(joined ? cathedralArena() : heartArena(ARENAS.candles, 0));
    if (joined) { const route = new CathedralRoute(arena); route.startBridge(); route.step(0, -47); }
    new HeartPassage(arena, foreZ);
    const world = new World(arena, 'heart:spawns:fixed'); world.hero.spawn(0, foreZ + 7, Math.PI); world.nav.update(0, 0, foreZ + 7, true);
    const runner = new StageRunner(world, stageById('1-4')!);
    const random = vi.spyOn(world.rng, 'next').mockReturnValue(0);
    const point = runner.pickPos({ enemy: 'golem', count: 1, pattern: 'far' }, 0, 1);
    random.mockRestore();
    expect(inPart(arena.def.encounter!, point.x, point.z, 0.35)).toBe(true);
    expect(arena.walkable(point.x, point.z)).toBe(true);
    expect(world.nav.reachable(point.x, point.z, true)).toBe(true);
  });
});
