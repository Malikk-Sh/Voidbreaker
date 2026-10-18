import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import { GeomBuilder, mat, matAlong, type RGB } from './build';
import { bipyramid, box, gothicArch, jitter, lathe, prism, rock, shard } from './prims';

/** Базовые цвета огранённой готики (линейные). Геймплейные цвета всегда ярче (GDD §16.3). */
export const OBS: RGB = hexToLinear('#151a22');
export const OBS_DEEP: RGB = hexToLinear('#080a0e');
export const OBS_HI: RGB = hexToLinear('#2a313c');
export const GOLD: RGB = hexToLinear('#9a7838');
export const WAX: RGB = hexToLinear('#5a4a3a');

/** Эмиссия «прожилкой»: тонкий светящийся осколок, вдавленный в поверхность. */
export function vein(b: GeomBuilder, x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, w: number, em = 0.9, seed = 0): void {
  b.add(shard(len, w, 4, 0.3, seed), { matrix: matAlong(x, y, z, dx, dy, dz), emissive: em, color: OBS_DEEP, shade: 0 });
}

/** Зигзаг-трещина из нескольких прожилок по поверхности цилиндра радиуса r. */
export function crackLine(b: GeomBuilder, r: number, y0: number, y1: number, a0: number, rng: Rng, em = 0.8): void {
  let a = a0, y = y0;
  while (y < y1) {
    const dy = rng.range(0.35, 0.8), da = rng.spread(0.35);
    const x0 = Math.sin(a) * r, z0 = Math.cos(a) * r;
    const x1 = Math.sin(a + da) * r, z1 = Math.cos(a + da) * r;
    vein(b, x0, y, z0, x1 - x0, dy, z1 - z0, Math.hypot(x1 - x0, dy, z1 - z0) * 1.05, 0.045, em, rng.int(0, 999));
    a += da; y += dy;
  }
}

/** Ствол с каннелюрами: кольца чередующихся радиусов, лёгкое сужение. */
function fluted(b: GeomBuilder, sides: number, r: number, h: number, y0: number, taper: number, rng: Rng, broken = 0): void {
  const rings = Math.max(2, Math.round(h / 1.2));
  const n = sides * 2;
  const pts: number[][][] = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings, y = y0 + h * t;
    const ring: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - taper * t) * (i % 2 === 0 ? 1 : 0.88);
      let yy = y;
      if (broken > 0 && k === rings) yy -= rng.next() * broken;
      ring.push([Math.sin(a) * rr, yy, Math.cos(a) * rr]);
    }
    pts.push(ring);
  }
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      b.quad(pts[k][i], pts[k][j], pts[k + 1][j], pts[k + 1][i]);
    }
  }
  if (broken > 0) {
    // рваный верх: веер треугольников к центру
    const top = pts[rings];
    const cy = y0 + h - broken * 0.6;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      b.tri(top[i][0], top[i][1], top[i][2], 0, cy, 0, top[j][0], top[j][1], top[j][2]);
    }
  }
}

export interface ColumnOpts { h: number; r: number; sides: number; broken?: boolean; veins?: boolean; seed: number }

/** Колонна (Tech §5.2): база (призма) + ствол с каннелюрами + капитель + сколы и трещины. */
export function column(b: GeomBuilder, o: ColumnOpts): void {
  const rng = new Rng(o.seed);
  const { r, sides } = o;
  b.color = OBS;
  b.add(prism(4, r * 1.9, r * 1.9, 0.45), { matrix: mat(0, 0, 0, 0, Math.PI / 4), rng });
  b.add(prism(4, r * 1.6, r * 1.55, 0.3), { matrix: mat(0, 0.45, 0, 0, Math.PI / 4), rng });
  b.add(prism(sides, r * 1.25, r * 1.1, 0.28), { matrix: mat(0, 0.75, 0, 0, 0.2), color: GOLD, shade: 0.25, rng });
  const shaftH = o.broken ? o.h * rng.range(0.35, 0.7) : o.h - 1.9;
  fluted(b, sides, r, shaftH, 1.03, 0.08, rng, o.broken ? r * 1.2 : 0);
  if (!o.broken) {
    const top = 1.03 + shaftH;
    b.add(prism(sides, r * 0.94, r * 1.05, 0.15), { matrix: mat(0, top, 0), color: GOLD, shade: 0.25, rng });
    b.add(prism(sides, r * 1.05, r * 1.6, 0.55), { matrix: mat(0, top + 0.15, 0, 0, 0.2), rng });
    b.add(prism(4, r * 2.35, r * 2.35, 0.25), { matrix: mat(0, top + 0.7, 0, 0, Math.PI / 4), rng });
  } else {
    // обломки у подножия
    for (let i = 0; i < 4; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(r * 1.6, r * 3);
      b.add(rock(rng.range(0.25, 0.55), 0, 0.35, rng.int(0, 999)), { matrix: mat(Math.sin(a) * d, 0.15, Math.cos(a) * d, rng.next(), rng.next(), 0, 1, 0.6, 1), rng });
    }
  }
  if (o.veins !== false) crackLine(b, r * 0.97, 1.2, 1.2 + Math.min(shaftH * 0.6, 4), rng.range(0, Math.PI * 2), rng);
}

export interface SpireOpts { h: number; r: number; tiers: number; ruin?: number; seed: number; windows?: boolean }

/** Шпиль / пинакль: ярусы-призмы с конусами и кольцом малых пинаклей, обломанный верх по параметру ruin. */
export function spire(b: GeomBuilder, o: SpireOpts): void {
  const rng = new Rng(o.seed);
  b.color = OBS;
  let y = 0, r = o.r;
  const tierH = (o.h * 0.75) / o.tiers;
  const lastTier = o.ruin ? Math.max(1, Math.round(o.tiers * (1 - o.ruin))) : o.tiers;
  for (let t = 0; t < lastTier; t++) {
    b.add(prism(8, r, r * 0.92, tierH), { matrix: mat(0, y, 0, 0, Math.PI / 8), rng });
    if (o.windows !== false) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        b.add(box(r * 0.35, tierH * 0.45, 0.05), {
          matrix: mat(Math.sin(a) * r * 0.93, y + tierH * 0.45, Math.cos(a) * r * 0.93, 0, a),
          emissive: rng.chance(0.5) ? 0.7 : 0.25, color: OBS_DEEP, shade: 0,
        });
      }
    }
    y += tierH;
    // кольцо пинаклей
    const pn = 8;
    for (let i = 0; i < pn; i++) {
      const a = (i / pn) * Math.PI * 2;
      b.add(prism(4, r * 0.12, 0.0, tierH * 0.55), { matrix: mat(Math.sin(a) * r * 0.95, y, Math.cos(a) * r * 0.95), rng });
    }
    b.add(prism(8, r * 0.95, r * 0.6, tierH * 0.25), { matrix: mat(0, y, 0, 0, Math.PI / 8), rng });
    y += tierH * 0.25;
    r *= 0.62;
  }
  if (!o.ruin) {
    b.add(prism(8, r * 1.1, 0, o.h * 0.25 + tierH), { matrix: mat(0, y, 0, 0, Math.PI / 8), rng });
  } else {
    const g = prism(8, r * 1.1, r * 0.7, tierH * 0.6);
    jitter(g, r * 0.25, o.seed, [1, 2, 1]);
    b.add(g, { matrix: mat(0, y, 0), rng });
  }
}

/** Аркада стрельчатых арок: ряд арок с колоннами-пилонами, открытые проёмы на небо. */
export function arcade(b: GeomBuilder, count: number, span: number, springH: number, seed: number, glass = 0): void {
  const rng = new Rng(seed);
  b.color = OBS;
  const step = span + 1.2;
  const x0 = -((count - 1) * step) / 2;
  for (let i = 0; i < count; i++) {
    const x = x0 + i * step;
    b.add(gothicArch(span, springH, 0.6, 0.9), { matrix: mat(x, 0, 0), rng });
    // пинакль над пилоном
    b.add(prism(4, 0.35, 0, 2.2), { matrix: mat(x + step / 2, springH + span * 0.87 + 0.2, 0, 0, Math.PI / 4), rng });
    if (glass > 0) {
      // витраж в проёме: мозаика стёкол со свинцовыми перемычками, верх — по стрельчатой арке
      const cols = 4, rows = 9;
      const gw = span * 0.92, gh = springH + span * 0.78;
      const cw = gw / cols, ch = gh / rows;
      for (let r0 = 0; r0 < rows; r0++) {
        for (let c0 = 0; c0 < cols; c0++) {
          const px = x - gw / 2 + (c0 + 0.5) * cw, py = 0.15 + (r0 + 0.5) * ch;
          // внутри стрельчатого контура: две дуги радиусом в пролёт
          if (py > springH) {
            const half = span / 2, dy = py - springH;
            const allowed = Math.sqrt(Math.max(0, span * span - dy * dy)) - half;
            if (Math.abs(px - x) + cw * 0.45 > allowed) continue;
          }
          const hue = rng.next();
          const em = (hue < 0.07 ? -0.45 : 0.1 + rng.next() * 0.45) * glass;
          b.add(box(cw * 0.86, ch * 0.86, 0.05), { matrix: mat(px, py, -0.12), emissive: em, color: OBS_DEEP, shade: 0 });
        }
      }
      // розетка-кружок в вершине окна
      b.add(new THREE.CircleGeometry(span * 0.16, 8), { matrix: mat(x, springH + span * 0.42, -0.09), emissive: 0.7 * glass, color: OBS_DEEP, shade: 0 });
    }
  }
  // карниз
  b.add(box(count * step + 1, 0.5, 1.2), { matrix: mat(0, springH + span * 0.87 + 0.6, 0), rng });
  b.add(box(count * step + 1, 0.12, 1.25), { matrix: mat(0, springH + span * 0.87 + 0.9, 0), color: GOLD, rng });
}

/** Розетка-окно: кольцо + спицы + эмиссивное «стекло». */
export function roseWindow(b: GeomBuilder, r: number, petals: number, seed: number, em = 0.9): void {
  const rng = new Rng(seed);
  b.color = OBS;
  const ring = new THREE.TorusGeometry(r, r * 0.08, 4, petals * 2);
  b.add(ring, { rng });
  const ring2 = new THREE.TorusGeometry(r * 0.38, r * 0.05, 4, petals);
  b.add(ring2, { rng });
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    b.add(box(r * 0.05, r * 0.62, r * 0.08), { matrix: mat(Math.sin(a) * r * 0.69, Math.cos(a) * r * 0.69, 0, 0, 0, -a), rng });
    // лепесток стекла
    const pa = a + Math.PI / petals;
    const shape = new THREE.Shape();
    const r0 = r * 0.42, r1 = r * 0.93, w = Math.PI / petals * 0.8;
    shape.moveTo(Math.sin(pa - w) * r0, Math.cos(pa - w) * r0);
    shape.lineTo(Math.sin(pa - w * 0.7) * r1, Math.cos(pa - w * 0.7) * r1);
    shape.lineTo(Math.sin(pa) * r1 * 1.02, Math.cos(pa) * r1 * 1.02);
    shape.lineTo(Math.sin(pa + w * 0.7) * r1, Math.cos(pa + w * 0.7) * r1);
    shape.lineTo(Math.sin(pa + w) * r0, Math.cos(pa + w) * r0);
    shape.closePath();
    b.add(new THREE.ShapeGeometry(shape), { matrix: mat(0, 0, -0.02), emissive: i % 3 === 0 ? -em : em, color: OBS_DEEP, shade: 0 });
  }
  b.add(new THREE.CircleGeometry(r * 0.36, petals), { matrix: mat(0, 0, -0.02), emissive: em * 1.3, color: OBS_DEEP, shade: 0 });
}

export interface CandelabraResult { flames: [number, number, number][] }

/** Канделябр: стойка + чаши + свечи (цилиндры с оплывом). Возвращает точки огней для billboard-пламени. */
export function candelabra(b: GeomBuilder, x: number, z: number, h: number, candles: number, seed: number): CandelabraResult {
  const rng = new Rng(seed);
  const flames: [number, number, number][] = [];
  b.color = OBS;
  b.add(prism(6, 0.38, 0.12, 0.35), { matrix: mat(x, 0, z), rng });
  b.add(prism(6, 0.06, 0.05, h), { matrix: mat(x, 0.35, z), color: GOLD, shade: 0.3, rng });
  const top = 0.35 + h;
  const arms = Math.max(1, candles);
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rng.next();
    const d = arms === 1 ? 0 : rng.range(0.25, 0.45);
    const cx = x + Math.sin(a) * d, cz = z + Math.cos(a) * d;
    const ch = rng.range(0.25, 0.6), cy = top - rng.range(0, 0.35);
    if (d > 0) b.add(box(0.04, 0.04, d), { matrix: mat(x + Math.sin(a) * d / 2, cy - 0.05, z + Math.cos(a) * d / 2, 0, a), color: GOLD, rng });
    b.add(prism(6, 0.13, 0.09, 0.06), { matrix: mat(cx, cy - 0.06, cz), color: GOLD, rng });
    const g = prism(6, 0.055, 0.05, ch);
    jitter(g, 0.012, rng.int(0, 999));
    b.add(g, { matrix: mat(cx, cy, cz), color: WAX, shade: 0.1, rng });
    flames.push([cx, cy + ch + 0.08, cz]);
  }
  return { flames };
}

/** Статуя в капюшоне: профиль вращения мантии + капюшон + тёмная впадина лица + меч остриём вниз. */
export function hoodedStatue(b: GeomBuilder, h: number, seed: number, sword = true): void {
  const rng = new Rng(seed);
  b.color = OBS;
  b.add(prism(6, 0.9 * h / 4, 0.8 * h / 4, 0.4), { matrix: mat(0, 0, 0), rng });
  const s = h / 4;
  const robe = lathe([[0.75, 0], [0.7, 0.4], [0.55, 1.6], [0.45, 2.5], [0.5, 2.9], [0.3, 3.15], [0.0, 3.2]], 7, rng.next());
  robe.scale(s, s, s);
  jitter(robe, 0.04 * s, seed);
  b.add(robe, { matrix: mat(0, 0.4, 0), rng });
  // капюшон
  const hood = lathe([[0.36, 0], [0.4, 0.3], [0.3, 0.65], [0.0, 0.95]], 6);
  hood.scale(s, s, s);
  b.add(hood, { matrix: mat(0, 0.4 + 2.95 * s, 0.02 * s, -0.25), rng });
  // впадина лица — тёмная, с тусклыми глазами
  b.add(box(0.36 * s, 0.32 * s, 0.1 * s), { matrix: mat(0, 0.4 + 3.25 * s, 0.32 * s, -0.25), color: [0, 0, 0], shade: 0 });
  b.add(box(0.05 * s, 0.03 * s, 0.05 * s), { matrix: mat(-0.08 * s, 0.4 + 3.3 * s, 0.36 * s), emissive: 0.6, color: OBS_DEEP });
  b.add(box(0.05 * s, 0.03 * s, 0.05 * s), { matrix: mat(0.08 * s, 0.4 + 3.3 * s, 0.36 * s), emissive: 0.6, color: OBS_DEEP });
  if (sword) {
    b.add(box(0.12 * s, 2.0 * s, 0.03 * s), { matrix: mat(0, 0.4 + 1.25 * s, 0.62 * s), rng });
    b.add(box(0.7 * s, 0.08 * s, 0.08 * s), { matrix: mat(0, 0.4 + 2.3 * s, 0.6 * s), color: GOLD, rng });
    b.add(bipyramid(4, 0.08 * s, 0.1 * s, 0.1 * s), { matrix: mat(0, 0.4 + 2.55 * s, 0.6 * s), color: GOLD });
  }
}

/** Парящий обломок: кусок пола + перевёрнутый «сталактит» из осколков снизу. */
export function floatingRuin(b: GeomBuilder, size: number, seed: number, column_ = false): void {
  const rng = new Rng(seed);
  b.color = OBS;
  const slab = prism(rng.int(5, 8), size, size * 0.9, size * 0.35);
  jitter(slab, size * 0.08, seed);
  b.add(slab, { matrix: mat(0, -size * 0.35, 0), rng });
  const n = 5 + Math.floor(size * 2);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, size * 0.7);
    const len = rng.range(size * 0.6, size * 2.2) * (1 - d / size * 0.6);
    b.add(shard(len, rng.range(size * 0.15, size * 0.35), 5, 0.3, rng.int(0, 999)), {
      matrix: matAlong(Math.sin(a) * d, -size * 0.3, Math.cos(a) * d, rng.spread(0.3), -1, rng.spread(0.3)), rng,
    });
  }
  if (column_) column(b, { h: size * 2.5, r: size * 0.15, sides: 8, broken: true, seed: seed + 1, veins: false });
}

/** Груда обломков: осколки разных размеров. */
export function rubble(b: GeomBuilder, x: number, z: number, r: number, count: number, seed: number): void {
  const rng = new Rng(seed);
  b.color = OBS;
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * r;
    const s = rng.range(0.15, 0.5) * (1 - d / r * 0.5);
    b.add(rock(s, 0, 0.4, rng.int(0, 9999)), { matrix: mat(x + Math.sin(a) * d, s * 0.4, z + Math.cos(a) * d, rng.next() * 3, rng.next() * 3, 0, 1, rng.range(0.5, 1), 1), rng });
  }
}

/** Цепь: звенья — вытянутые октаэдры с чередованием ориентации. */
export function chain(b: GeomBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, sag: number, link = 0.22): void {
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const n = Math.max(2, Math.floor(len / (link * 0.8)));
  b.color = OBS_HI;
  let px = x0, py = y0, pz = z0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * sag;
    const g = new THREE.TorusGeometry(link * 0.4, link * 0.09, 3, 6);
    g.scale(1, 1.5, 1);
    const m = matAlong((px + x) / 2, (py + y) / 2, (pz + z) / 2, x - px, y - py, z - pz).multiply(mat(0, 0, 0, 0, i % 2 ? Math.PI / 2 : 0));
    b.add(g, { matrix: m });
    px = x; py = y; pz = z;
  }
}
