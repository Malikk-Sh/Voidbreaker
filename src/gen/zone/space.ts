import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import type { RigDef } from '../../anim/skeleton';
import { GeomBuilder, mat } from '../geom/build';
import { bipyramid, box, lathe, octa, prism, shard } from '../geom/prims';
import { roseWindow, spire } from '../geom/kit';

/** Корпус «Инея»: светлая сталь, тёмные панели, огни — цвет Пилота (фиолетово-белый). */
const STEEL = hexToLinear('#5a6372');
const STEEL_HI = hexToLinear('#8a93a3');
const PANEL = hexToLinear('#20252e');

/** Части «Инея» на суставах: при ударе луча корпус раскалывается и они расходятся (план §8.2). */
export const SHIP_PARTS = ['nose', 'hull', 'wingL', 'wingR', 'engine', 'fin'] as const;

export function shipRig(): RigDef {
  return {
    id: 'ship',
    joints: [
      { name: 'root', pos: [0, 0, 0] },
      { name: 'hull', parent: 'root', pos: [0, 0, 0] },
      { name: 'nose', parent: 'hull', pos: [0, 0, 3.2] },
      { name: 'wingL', parent: 'hull', pos: [1.1, 0, -0.5] },
      { name: 'wingR', parent: 'hull', pos: [-1.1, 0, -0.5] },
      { name: 'engine', parent: 'hull', pos: [0, 0, -3.0] },
      { name: 'fin', parent: 'hull', pos: [0, 0.9, -2.6] },
    ],
  };
}

/** Разведкорабль «Иней»: корпус-профиль (lathe) вдоль оси Z, крылья-призмы, огни двигателей. ~12 м. */
export function buildShip(seed = 41): { rig: RigDef; geometry: THREE.BufferGeometry } {
  const rig = shipRig();
  const J = (n: string) => rig.joints.findIndex((j) => j.name === n);
  const b = new GeomBuilder(); b.rng = new Rng(seed); b.color = STEEL;
  // корпус: профиль вращения, повёрнут вдоль Z
  b.joint = J('hull');
  b.add(lathe([[0.75, -3.1], [0.95, -2.6], [1.15, -1.0], [1.05, 1.2], [0.75, 2.6], [0.4, 3.3]], 8, 0.4), { matrix: mat(0, 0, 0, Math.PI / 2, 0, 0) });
  for (const z of [-1.8, -0.2, 1.4]) b.add(prism(8, 1.12, 1.12, 0.12, true), { matrix: mat(0, 0, z, Math.PI / 2, 0, 0), color: PANEL });
  // ряд иллюминаторов
  for (let i = 0; i < 6; i++) for (const sx of [1, -1]) b.add(box(0.06, 0.14, 0.3), { matrix: mat(sx * 1.04, 0.25, -1.4 + i * 0.55, 0, sx * 0.1, 0), emissive: 1.4, color: STEEL_HI });
  b.joint = J('nose');
  b.add(lathe([[0.4, 0], [0.32, 0.6], [0.12, 1.4], [0.01, 1.9]], 8, 0.4), { matrix: mat(0, 0, 0, Math.PI / 2, 0, 0) });
  b.add(octa(0.28, 0.16, 0.5), { matrix: mat(0, 0.28, 0.4), emissive: 1.6, color: STEEL_HI });
  for (const [s, sx] of [['L', 1], ['R', -1]] as const) {
    b.joint = J('wing' + s);
    // крыло: стреловидная плита с кромкой-огнём
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.0); shape.lineTo(sx * 3.6, -1.2); shape.lineTo(sx * 3.9, -1.9); shape.lineTo(0, -1.4); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    g.translate(0, 0, -0.06);
    b.add(g, { matrix: mat(0, -0.15, 0, -Math.PI / 2, 0, 0), color: STEEL });
    b.add(box(0.08, 0.1, 1.2), { matrix: mat(sx * 3.75, -0.15, -1.55, 0, sx * 0.4, 0), emissive: 1.8, color: STEEL_HI });
    b.add(prism(6, 0.22, 0.18, 1.6), { matrix: mat(sx * 2.2, -0.3, -1.2, Math.PI / 2, 0, 0), color: PANEL });
  }
  b.joint = J('engine');
  b.add(prism(8, 0.95, 0.7, 1.0), { matrix: mat(0, 0, 0, -Math.PI / 2, 0, 0), color: PANEL });
  // огни двигателей
  for (const [x, y] of [[0, 0], [0.5, 0.3], [-0.5, 0.3], [0.5, -0.3], [-0.5, -0.3]]) b.add(prism(8, 0.18, 0.2, 0.2), { matrix: mat(x, y, -1.05, -Math.PI / 2, 0, 0), emissive: 2.4, color: STEEL_HI });
  b.joint = J('fin');
  b.add(shard(1.6, 0.18, 4, 0.1, seed), { matrix: mat(0, 0, 0, -0.7, 0, 0, 1, 1, 0.4), color: STEEL });
  return { rig, geometry: b.build() };
}

/** Обломок обшивки «Инея», торчащий из пола (станет клинком): стальная пластина с тлеющими швами. */
export function buildHullShard(seed = 43): THREE.BufferGeometry {
  const b = new GeomBuilder(); b.rng = new Rng(seed); b.color = STEEL;
  const shape = new THREE.Shape();
  shape.moveTo(-0.22, 0); shape.lineTo(0.2, 0); shape.lineTo(0.16, 1.0); shape.lineTo(0.02, 1.45); shape.lineTo(-0.14, 1.1); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  g.translate(0, 0, -0.03);
  b.add(g, { matrix: mat(0, -0.3, 0, 0.25, 0.3, 0.12) });
  b.add(box(0.03, 1.1, 0.07), { matrix: mat(0.0, 0.3, 0, 0.25, 0.3, 0.12), emissive: 1.2, color: STEEL_HI });
  for (let i = 0; i < 4; i++) b.add(shard(0.3, 0.08, 3, 0.3, i), { matrix: mat(Math.sin(i * 1.7) * 0.4, 0, Math.cos(i * 1.7) * 0.4, 0.4, i, 0), color: PANEL });
  return b.build();
}

/**
 * Кольцо соборов вокруг погасшей звезды (план §8.2): шпили смотрят наружу от звезды, окна тлеют багровым.
 * Кольцо в плоскости XY с центром в (0, 0, 0): ставится в нужную точку группой.
 */
export function buildCathedralRing(radius: number, count: number, seed = 51): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const D = new GeomBuilder(); D.rng = rng;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.spread(0.04);
    const g = new GeomBuilder(); g.rng = new Rng(rng.int(0, 1e6));
    const big = i % 3 === 0;
    spire(g, { h: big ? 70 : 42, r: big ? 6 : 4, tiers: big ? 5 : 3, ruin: rng.chance(0.3) ? 0.3 : 0, seed: rng.int(0, 1e6) });
    // основание собора — массив-призма и пара малых шпилей
    g.add(prism(8, (big ? 10 : 7), (big ? 8 : 6), 10), { matrix: mat(0, -8, 0) });
    for (const s of [1, -1]) {
      const sub = new GeomBuilder(); sub.rng = new Rng(rng.int(0, 1e6));
      spire(sub, { h: big ? 34 : 22, r: 2.5, tiers: 2, seed: rng.int(0, 1e6) });
      g.append(sub, mat(s * (big ? 9 : 6), -4, rng.spread(3)));
    }
    // шпиль «вверх» = наружу от центра кольца
    const m = new THREE.Matrix4().makeRotationZ(a - Math.PI / 2);
    m.setPosition(Math.cos(a) * radius, Math.sin(a) * radius, rng.spread(20));
    D.append(g, m);
  }
  return D.build();
}

/** Роза-окно купола 1-1, сквозь которое падает Пилот: лежит в плоскости XZ. Стекло и каменное кольцо — отдельно (стекло бьётся). */
export function buildDomeRose(r: number, seed = 61): { rose: THREE.BufferGeometry; ring: THREE.BufferGeometry } {
  const g = new GeomBuilder(); g.rng = new Rng(seed);
  roseWindow(g, r, 16, seed, 1.2);
  const rose = new GeomBuilder(); rose.rng = new Rng(seed);
  rose.append(g, mat(0, 0, 0, -Math.PI / 2, 0, 0));
  // каменное кольцо купола вокруг розы
  const b = new GeomBuilder(); b.rng = new Rng(seed + 1);
  b.add(prism(16, r * 1.5, r * 1.15, 0.8, true), { matrix: mat(0, -0.4, 0) });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.add(bipyramid(4, 0.5, 1.4, 0.2), { matrix: mat(Math.sin(a) * r * 1.35, 0.2, Math.cos(a) * r * 1.35, 0, a, 0) });
  }
  return { rose: rose.build(), ring: b.build() };
}

/** Кратер приземления Пилота в центре 1-1 (план §8.5): вздыбленные плиты по кругу и сколы, без свечения. */
export function buildCrater(seed = 71): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = new GeomBuilder(); b.rng = rng;
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + rng.spread(0.18), d = rng.range(1.5, 2.3);
    const w = rng.range(0.5, 0.95), l = rng.range(0.55, 1.0);
    // плита встаёт ребром наружу: наклон от центра
    b.add(box(w, 0.14, l), { matrix: mat(Math.sin(a) * d, 0.06 + rng.range(0, 0.12), Math.cos(a) * d, -rng.range(0.35, 0.7), a, rng.spread(0.25)) });
  }
  for (let i = 0; i < 18; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0.4, 3.2);
    b.add(shard(rng.range(0.12, 0.3), rng.range(0.05, 0.1), 4, 0.3, i), { matrix: mat(Math.sin(a) * d, 0.02, Math.cos(a) * d, rng.range(0.8, 1.5), rng.range(0, 6), 0) });
  }
  return b.build();
}
