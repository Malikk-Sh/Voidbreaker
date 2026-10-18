import * as THREE from 'three';
import { hash3 } from '../../core/noise';

/**
 * Сид-искажение вершин: смещение зависит от исходной позиции → совпадающие вершины
 * смещаются одинаково, швов нет (Tech §5.1). «Нет двух одинаковых колонн» (GDD §17.2.6).
 */
export function jitter(g: THREE.BufferGeometry, amount: number, seed = 0, axes: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const kx = Math.round(x * 1000), ky = Math.round(y * 1000), kz = Math.round(z * 1000);
    const a = hash3(kx + seed * 13.1, ky, kz) - 0.5;
    const b = hash3(kx, ky + seed * 7.7, kz) - 0.5;
    const c = hash3(kx, ky, kz + seed * 3.3) - 0.5;
    p.setXYZ(i, x + a * 2 * amount * axes[0], y + b * 2 * amount * axes[1], z + c * 2 * amount * axes[2]);
  }
  return g;
}

/** Радиальное «раздувание» с шумом: огранённая глыба. */
export function bulge(g: THREE.BufferGeometry, amount: number, seed = 0): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = hash3(Math.round(x * 1000) + seed, Math.round(y * 1000), Math.round(z * 1000));
    const s = 1 + (k - 0.5) * 2 * amount;
    p.setXYZ(i, x * s, y * s, z * s);
  }
  return g;
}

/** N-гранная призма/усечённая пирамида; основание в y=0. */
export function prism(sides: number, rBot: number, rTop: number, h: number, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, sides, 1, open);
  g.translate(0, h / 2, 0);
  return g;
}

/** Огранённый осколок — основа обсидиана, врагов, обломков (Tech §5.1). */
export function shard(len = 1, radius = 0.25, sides = 5, jit = 0.25, seed = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius * 0.08, radius, len, sides, 2).toNonIndexed();
  g.translate(0, len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = hash3(Math.round(x * 100) + seed, Math.round(y * 100), Math.round(z * 100));
    const s = 1 + (k - 0.5) * 2 * jit;
    p.setXYZ(i, x * s, y * (1 + (k - 0.5) * jit * 0.5), z * s);
  }
  return g;
}

export function octa(rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(rx, ry, rz);
  return g;
}

/** Бипирамида: вершина вверх hUp, вниз hDown. */
export function bipyramid(sides: number, r: number, hUp: number, hDown: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const x0 = Math.sin(a0) * r, z0 = Math.cos(a0) * r, x1 = Math.sin(a1) * r, z1 = Math.cos(a1) * r;
    pos.push(0, hUp, 0, x0, 0, z0, x1, 0, z1);
    pos.push(0, -hDown, 0, x1, 0, z1, x0, 0, z0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function rock(r: number, detail = 0, amount = 0.25, seed = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  return bulge(g, amount, seed);
}

/** Профиль вращения (lathe): точки [радиус, высота]. */
export function lathe(profile: [number, number][], segments: number, phase = 0): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  return new THREE.LatheGeometry(pts, segments, phase);
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export function extrude(shape: THREE.Shape, depth: number, bevel = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Семиконечная звезда Литургии (план §4.2) — плита, лежащая в плоскости XZ: низ y = 0, верх y = depth,
 * один луч смотрит в −Z. rInner = 0.69·rOuter — классическая {7/2}, 0.36–0.45 — острая.
 */
export function starPlate(points = 7, rOuter = 0.5, rInner = rOuter * 0.69, depth = 0.05): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rInner : rOuter;
    const a = (i / (points * 2)) * Math.PI * 2;
    const x = Math.sin(a) * r, y = Math.cos(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  const bevel = Math.min(depth * 0.35, rOuter * 0.06);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, depth - bevel * 2), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  g.translate(0, 0, bevel);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Стрельчатая (готическая) арка — две дуги радиусом в пролёт, выдавленные в толщину (Tech §5.1). */
export function gothicArch(span = 3, springH = 3, wall = 0.6, depth = 0.8): THREE.BufferGeometry {
  const outer = new THREE.Shape();
  const W = span / 2 + wall, top = springH + span * 0.87 + wall;
  outer.moveTo(-W, 0); outer.lineTo(W, 0); outer.lineTo(W, springH);
  outer.lineTo(0, top); outer.lineTo(-W, springH); outer.closePath();
  const hole = new THREE.Path();
  const w = span / 2;
  hole.moveTo(-w, 0); hole.lineTo(-w, springH);
  hole.absarc(w, springH, span, Math.PI, (2 * Math.PI) / 3, true);
  hole.absarc(-w, springH, span, Math.PI / 3, 0, true);
  hole.lineTo(w, 0); hole.closePath();
  outer.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1, curveSegments: 5 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Плоская лента-полумесяц (серп, кромка клинка). */
export function crescent(r: number, thick: number, arc: number, depth: number, segments = 10): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const a0 = -arc / 2, a1 = arc / 2;
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (a1 - a0) * (i / segments);
    const x = Math.sin(a) * r, y = Math.cos(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  for (let i = segments; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / segments);
    const t = 1 - Math.abs((i / segments) * 2 - 1);
    const rr = r - thick * t;
    s.lineTo(Math.sin(a) * rr, Math.cos(a) * rr - thick * 0.3 * t);
  }
  return extrude(s, depth, 0);
}
