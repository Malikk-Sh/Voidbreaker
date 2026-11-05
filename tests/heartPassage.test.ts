import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENAS, inArenaShape } from '../src/data/arenas';
import { Arena } from '../src/world/arena';
import { CATHEDRAL, cathedralArena } from '../src/world/cathedralRoute';
import { HEART_HALL, HeartPassage, heartArena, heartEncounter } from '../src/world/heartPassage';
import { buildArenaView, ZONE1_LOOK } from '../src/gen/zone/arenaView';
import { addHeartHall } from '../src/gen/zone/heartHall';
import { addCathedralBridge } from '../src/gen/zone/cathedralBridge';

for (const foreZ of [0, CATHEDRAL.hallZ]) describe(`Heart passage at ${foreZ}`, () => {
  const definition = () => foreZ === 0 ? heartArena(ARENAS.candles, 0) : cathedralArena();
  it('connects the first hall to a chamber with twice its floor area and retains both wells', () => {
    const def = definition(), arena = new Arena(def), heart = heartEncounter(foreZ);
    expect(heart.w * heart.h / (27 * 21)).toBeGreaterThan(2);
    for (let z = foreZ - 8.5; z >= foreZ - 21; z -= 0.1) expect(arena.walkable(0, z), `neck ${z}`).toBe(true);
    for (const x of [-2.5, 2.5]) for (let z = foreZ - 10; z >= foreZ - 14.3; z -= 0.1) expect(arena.walkable(x, z), `wide neck ${x},${z}`).toBe(true);
    expect(arena.inPit(0, foreZ - 0.5)).toBe(true);
    expect(arena.inPit(0, heart.z - 0.5)).toBe(true);
    expect(arena.walkable(10, heart.z)).toBe(true);
    expect(def.holes).toHaveLength(foreZ === 0 ? 2 : 4);
    expect(def.cover).toContainEqual({ x: -8.5, z: foreZ - 0.5, r: 0.6 });
    expect(def.encounter?.z).toBe(0);
    expect(def.encounter).not.toEqual(heart);
  });

  it('opens once after release, waits for arrival, then closes a visible door behind the player', () => {
    const arena = new Arena(definition()), passage = new HeartPassage(arena, foreZ), gateZ = foreZ + HEART_HALL.gateZ;
    const original = arena.def.encounter;
    expect(passage.phase).toBe('waiting'); expect(passage.gateOpen).toBe(0);
    expect(arena.walkable(0, gateZ)).toBe(false);
    expect(arena.barrierDistance(0, gateZ + 2, 0, -1, 4)).toBeLessThan(2);
    expect(passage.enter(0, foreZ - 18)).toBe(false); expect(passage.activate()).toBe(false);
    passage.step(10); expect(passage.gateOpen).toBe(0);
    expect(passage.release()).toBe(true); expect(passage.release()).toBe(false);
    passage.step(0.8); expect(passage.gateOpen).toBeCloseTo(0.5);
    expect(arena.walkable(0, gateZ)).toBe(false); expect(passage.enter(0, foreZ - 18)).toBe(false);
    passage.step(0); expect(passage.gateOpen).toBeCloseTo(0.5);
    passage.step(0.8); expect(passage.gateOpen).toBe(1); expect(arena.walkable(0, gateZ)).toBe(true);
    expect(arena.def.encounter).toBe(original);
    expect(passage.enter(0, foreZ - 16)).toBe(false);
    expect(passage.enter(0, foreZ - 18)).toBe(true); expect(passage.phase).toBe('awakening');
    expect(arena.def.encounter).toBe(original); expect(passage.enter(0, foreZ - 19)).toBe(false);
    expect(passage.activate()).toBe(true); expect(passage.activate()).toBe(false);
    expect(passage.phase).toBe('combat'); expect(passage.gateOpen).toBe(0);
    expect(arena.def.encounter).toEqual(heartEncounter(foreZ));
    expect(arena.walkable(0, gateZ)).toBe(false); expect(arena.walkable(0, foreZ - 18)).toBe(true);
    passage.win(); expect(passage.phase).toBe('complete'); expect(passage.gateOpen).toBe(1);
    expect(arena.walkable(0, gateZ)).toBe(true); expect(passage.release()).toBe(false);
  });

  it('ignores outside coordinates and the new well instead of starting the boss early', () => {
    const arena = new Arena(definition()), passage = new HeartPassage(arena, foreZ);
    passage.release(); passage.step(2);
    for (const [x, z] of [[100, foreZ - 18], [0, foreZ - 100], [0, foreZ - 27.5], [30, foreZ - 27], [NaN, foreZ - 18]]) {
      expect(passage.enter(x, z), `${x},${z}`).toBe(false);
    }
    expect(passage.phase).toBe('released'); expect(arena.def.encounter).not.toEqual(heartEncounter(foreZ));
  });

  it('adds one sanctum and a matching moving portcullis without adding another floor', () => {
    const arena = new Arena(definition());
    const view = buildArenaView(arena, `heart:test:${foreZ}`, ZONE1_LOOK, 0.65, false);
    const floor = [...view.floor];
    if (foreZ === 0) addHeartHall(view, 0.65, 0); else addCathedralBridge(view, 0.65);
    const sanctums: THREE.Object3D[] = [];
    view.root.traverse(object => { if (object.userData.candleSanctum) sanctums.push(object); });
    expect(sanctums).toHaveLength(1); expect(view.floor).toEqual(floor);
    const sanctum = sanctums[0].userData.candleSanctum;
    expect(sanctum.root.getWorldPosition(new THREE.Vector3()).z).toBe(foreZ + HEART_HALL.offsetZ);
    for (const [x, , z] of sanctum.flames) expect(inArenaShape(arena.def, x, z + foreZ + HEART_HALL.offsetZ)).toBe(true);
    const gate = view.root.getObjectByName('heart-portcullis') as THREE.Mesh;
    gate.geometry.computeBoundingBox();
    const closed = gate.geometry.boundingBox!.clone().applyMatrix4(gate.matrixWorld);
    expect(closed.min.z).toBeCloseTo(foreZ + HEART_HALL.gateZ - 0.325);
    expect(closed.max.z).toBeCloseTo(foreZ + HEART_HALL.gateZ + 0.325);
    expect(closed.min.y).toBeLessThan(0.1);
    const controller = view.root.userData.heartPassageView;
    controller.update(1); view.root.updateMatrixWorld(true);
    expect(gate.geometry.boundingBox!.clone().applyMatrix4(gate.matrixWorld).min.y).toBeGreaterThan(7);
    const floorObjects: THREE.InstancedMesh[] = [];
    view.root.traverse(object => { if (object instanceof THREE.InstancedMesh && floor.includes(object)) floorObjects.push(object); });
    expect(floorObjects).toHaveLength(floor.length);
    view.dispose();
  });
});

it('retains the base arena definition when extending its floor', () => {
  const before = JSON.stringify(ARENAS.candles);
  heartArena(ARENAS.candles, 0);
  expect(JSON.stringify(ARENAS.candles)).toBe(before);
});
