import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { HEART_HALL } from '../../world/heartPassage';
import { obsidianMaterial } from '../../render/materials';
import { GeomBuilder, mat } from '../geom/build';
import { box, gothicArch, prism, shard } from '../geom/prims';
import { column, GOLD, OBS, OBS_DEEP, roseWindow } from '../geom/kit';
import type { ArenaView, LightPoolDef } from './arenaView';
import { CandleSanctum } from './candleSanctum';

/** A raised, visible gate uses exactly the passage's collision opening. */
export class HeartPassageView {
  constructor(readonly gate: THREE.Mesh) {}
  update(open: number): void { this.gate.position.y = Math.max(0, Math.min(1, open)) * 7.2; }
}

/** Architecture only: the parent ArenaView already owns the floor of both connected rooms. */
export function addHeartHall(view: ArenaView, density: number, foreZ: number): CandleSanctum {
  const bossZ = foreZ + HEART_HALL.offsetZ;
  const root = new THREE.Group(); root.name = 'Чертог Последнего Огня'; root.position.z = bossZ;
  const material = obsidianMaterial({ rim: '#53616b', rimStrength: 0.14, emissive: '#728c99', emissive2: '#FFB866', emissiveStrength: 1.2 });
  const stone = new GeomBuilder(); stone.rng = new Rng('heart:architecture'); stone.color = OBS;
  const pools: LightPoolDef[] = [];
  const localFlames: [number, number, number][] = [];
  const place = (builder: GeomBuilder, x: number, y: number, z: number, turn = 0) => stone.append(builder, mat(x, y, z, 0, turn));

  // Tall, widely spaced pillars keep the enlarged fighting ring and all three braziers legible.
  const angles = [0.42, 0.85, 1.28, 1.74, 2.18, 2.65, 3.14, 3.63, 4.1, 4.54, 5, 5.43, 5.86];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i], x = Math.sin(a) * 20.1, z = Math.cos(a) * 16.1;
    const g = new GeomBuilder(); g.rng = new Rng(i + 601);
    column(g, { h: z > 4 ? 5.8 : 9.8 + i % 3, r: 0.55, sides: 6, broken: false, veins: false, seed: i + 601 });
    place(g, x, 0, z, a);
    // Sparse foundation fragments establish depth without drawing another floor.
    stone.add(shard(5 + i % 3, 0.8, 4, 0.15, i + 40), { matrix: mat(x * 0.94, -0.4, z * 0.94, Math.PI, a, 0), color: OBS_DEEP });
  }

  // The only new facade is at the chamber's far end. Its rose draws the eye beyond the Heart.
  // Place the rose independently above the open arch; keep its lower geometry out of the room.
  const rose = new GeomBuilder(); rose.rng = new Rng('heart:rose'); roseWindow(rose, 2.25, 10, 712, 0.65);
  const arch = new GeomBuilder(); arch.add(gothicArch(7.4, 6, 0.7, 0.9), { color: OBS });
  place(arch, 0, 0, -16.5);
  place(rose, 0, 10.2, -16.7);
  for (const side of [-1, 1]) {
    stone.add(box(0.24, 6.3, 0.32), { matrix: mat(side * 5.6, 6.6, -15.8, 0, 0, side * -0.42), color: GOLD });
  }

  // A seven metre doorway replaces the old hall's closed northern facade.
  const doorZ = foreZ + HEART_HALL.gateZ - bossZ;
  for (const side of [-1, 1]) {
    stone.add(box(1.1, 8.6, 1.25), { matrix: mat(side * 4.05, 4.3, doorZ), color: OBS });
    stone.add(box(1.5, 0.35, 1.55), { matrix: mat(side * 4.25, 0.18, doorZ), color: OBS });
    stone.add(box(0.14, 7.9, 1.3), { matrix: mat(side * 3.57, 4.1, doorZ), color: GOLD });
    stone.add(prism(4, 0.6, 0, 2.3), { matrix: mat(side * 4.05, 8.6, doorZ, 0, Math.PI / 4), color: OBS });
  }
  stone.add(box(9.2, 0.75, 1.3), { matrix: mat(0, 8.1, doorZ), color: OBS });
  stone.add(box(7.1, 0.13, 1.36), { matrix: mat(0, 7.68, doorZ), color: GOLD });

  const bars = new GeomBuilder(); bars.rng = new Rng('heart:portcullis');
  for (let i = 0; i <= 12; i++) {
    const x = -3.37 + i * 6.74 / 12;
    bars.add(box(0.15, 6.3, 0.35), { matrix: mat(x, 3.3, doorZ), color: i % 3 === 0 ? GOLD : OBS });
    bars.add(prism(4, 0, 0.15, 0.35), { matrix: mat(x, 0.02, doorZ, 0, Math.PI / 4), color: GOLD });
  }
  for (const y of [0.7, 3.1, 5.8]) bars.add(box(7, 0.16, 0.65), { matrix: mat(0, y, doorZ), color: GOLD });
  const gate = new THREE.Mesh(bars.build(), material); gate.name = 'heart-portcullis'; gate.frustumCulled = false; root.add(gate);
  const passage = new HeartPassageView(gate);
  view.root.userData.heartPassageView = passage;

  // Short candle clusters light the threshold, leaving the central approach and combat ring open.
  for (const side of [-1, 1]) {
    for (let i = 0; i < Math.round(5 * Math.max(0.5, density)); i++) {
      const x = side * (4.75 + i % 2 * 0.24), z = doorZ - 1.1 - Math.floor(i / 2) * 0.3, h = 0.22 + i % 3 * 0.12;
      stone.add(prism(5, 0.065, 0.055, h), { matrix: mat(x, 0, z), color: '#c7ae7d' });
      localFlames.push([x, h + 0.07, z]);
    }
    pools.push({ x: side * 4.9, z: doorZ - 1.5, r: 3.1, color: '#FFB866', intensity: 0.4, flicker: 1 });
  }
  const architecture = new THREE.Mesh(stone.build(), material); architecture.name = 'heart-hall-architecture'; architecture.frustumCulled = false; root.add(architecture);
  const sanctum = new CandleSanctum(density); root.add(sanctum.root);
  root.userData.candleSanctum = sanctum;
  view.root.add(root);

  view.flames.push(...[...localFlames, ...sanctum.flames].map(([x, y, z]): [number, number, number] => [x, y, z + bossZ]));
  view.pools.push(...[...pools, ...sanctum.pools].map(pool => ({ ...pool, z: pool.z + bossZ })));
  view.casters.push(architecture, sanctum.caster);
  // Renderer light shafts are definitions in world coordinates, just like the common flames and pools.
  for (const x of [-2.3, 2.3]) view.rays.push({ top: new THREE.Vector3(x, 10.8, bossZ - 16.2), bot: new THREE.Vector3(x + 1.5, 0.05, bossZ - 8), w: 2.1 });
  view.root.updateMatrixWorld(true);
  return sanctum;
}
