import * as THREE from 'three';
import { GeomBuilder, mat } from '../geom/build';
import { prism } from '../geom/prims';

/** Конечность-призма вниз от сустава (−Y): r0 у сустава, r1 на конце. */
export function limb(b: GeomBuilder, len: number, r0: number, r1: number, sides = 5, twist = 0): void {
  const g = prism(sides, r1, r0, len);
  g.translate(0, -len, 0);
  b.add(g, { matrix: mat(0, 0, 0, 0, twist) });
}

/** Выпуклая «коробка» по 8 вершинам: низ (w0×d0 на y0) → верх (w1×d1 на y1) со смещением верха по z. */
export function hull8(b: GeomBuilder, w0: number, d0: number, y0: number, w1: number, d1: number, y1: number, zTop = 0, zBot = 0): void {
  const p = [
    [-w0 / 2, y0, -d0 / 2 + zBot], [w0 / 2, y0, -d0 / 2 + zBot], [w0 / 2, y0, d0 / 2 + zBot], [-w0 / 2, y0, d0 / 2 + zBot],
    [-w1 / 2, y1, -d1 / 2 + zTop], [w1 / 2, y1, -d1 / 2 + zTop], [w1 / 2, y1, d1 / 2 + zTop], [-w1 / 2, y1, d1 / 2 + zTop],
  ];
  const cy = (y0 + y1) / 2, cz = (zTop + zBot) / 2;
  const q = (a: number, c: number, d: number, e: number) => b.quadOut(p[a], p[c], p[d], p[e], 0, cy, cz);
  q(0, 3, 2, 1); q(4, 5, 6, 7); q(3, 7, 6, 2); q(1, 5, 4, 0); q(0, 4, 7, 3); q(2, 6, 5, 1);
}

/** Огранённая «капсула-торс»: два hull8 с переломом по талии — грани ловят свет по-разному. */
export function torso(b: GeomBuilder, wBot: number, wMid: number, wTop: number, dBot: number, dMid: number, dTop: number, y0: number, yMid: number, y1: number): void {
  hull8(b, wBot, dBot, y0, wMid, dMid, yMid, 0.02, 0);
  hull8(b, wMid, dMid, yMid, wTop, dTop, y1, -0.01, 0.02);
}

/** Плоская форма в плоскости XY, выдавленная по Z (клинки, пластины, ленты). */
export function plate(b: GeomBuilder, pts: [number, number][], depth: number, m?: THREE.Matrix4, emissive?: number, color?: [number, number, number]): void {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  b.add(g, { matrix: m, emissive, color });
}
