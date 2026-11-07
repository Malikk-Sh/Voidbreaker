import * as THREE from 'three';
import { hexToLinear } from '../../core/math';
import { Rng } from '../../core/rng';
import type { RigDef, V3 } from '../../anim/skeleton';
import { GeomBuilder, mat, matAlong, SURF } from '../geom/build';
import { box, lathe, octa, prism, rock, shard } from '../geom/prims';
import { hull8, limb, plate } from './parts';

/**
 * Звонарь — жакемар: заводная фигура башенных часов, что веками отбивала часы молотом по колоколу. Тело — тёмное
 * лакированное дерево на латунных шарнирах. Голова — фарфоровая маска с нарисованной улыбкой и румянцем, через неё
 * идёт трещина, в глазницах тлеет огонь; на голове высокий восьмигранный колпак-шпиль, как крыша колокольни, с
 * флюгером. На груди — циферблат со стрелками (крутятся, в ярости быстрее), под ним в окошке живота качается маятник.
 * На спине вместо колокола — большой заводной ключ: крутится, пока фигура движется, и раскручивается перед прыжком.
 * Левая кисть — латунные пальцы-когти, правая держит молот жакемара. Ливрея — выцветшая красная с золотом: пышные
 * рукава, юбка-табард, полосы по спине; на бёдрах висят латунные гири часов, туфли с загнутыми носами.
 *
 * Суставы — те же имена, что у тяжёлых стражей (позы, походка и постановка добивания работают без перевода), плюс
 * key (ключ), pend (маятник), hourH и minH (стрелки).
 */
export const RINGER_SCALE = 1.45;
/** Центр головы молота в координатах кисти 'handR' (до масштаба): в III фазе на неё ложится язык Великого колокола. */
export const RINGER_CLAPPER_BALL: V3 = [0, -0.86, 0];
/** Циферблат на груди: центр лицевой стороны в координатах сустава 'chest' (до масштаба) и радиус. */
export const RINGER_DIAL = { at: [0, 0.22, 0.34] as V3, r: 0.3 };
/** Точка удара добивания — центр циферблата, чуть впереди стрелок (сустав 'chest', до масштаба). */
export const RINGER_CONTACT: V3 = [0, 0.22, 0.37];
/** Сустав точки удара добивания. */
export const RINGER_CONTACT_JOINT = 'chest';
/** Заводной ключ: гнездо в спине, ось ключа — назад по −z (сустав 'chest', до масштаба). */
export const RINGER_KEY: V3 = [0, 0.28, -0.27];
/** Маятник в окошке живота: точка подвеса (сустав 'spine', до масштаба). */
export const RINGER_PEND: V3 = [0, 0.33, 0.21];

const WOOD = hexToLinear('#29221e'), WOOD2 = hexToLinear('#3a3029'), BRASS = hexToLinear('#a07c38'), BRASS_DARK = hexToLinear('#6a5226');
const IRON = hexToLinear('#232028'), IVORY = hexToLinear('#c4bba6'), PORCELAIN = hexToLinear('#bfb6a6'), SOCKET = hexToLinear('#0d0b0e');
const CHEEK = hexToLinear('#8a2c30'), LIVERY = hexToLinear('#741c24'), GOLD = hexToLinear('#b08a3e'), SLATE = hexToLinear('#2b3438');
const LINEN = hexToLinear('#a39a88'), DARK_IN = hexToLinear('#0b0908');

export function ringerRig(scale = RINGER_SCALE): RigDef {
  const s = scale, p = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  return {
    id: 'bellRinger',
    joints: [
      { name: 'root', pos: [0, 0, 0] },
      { name: 'pelvis', parent: 'root', pos: p(0, 1.22, 0) },
      { name: 'spine', parent: 'pelvis', pos: p(0, 0.28, -0.02) },
      { name: 'chest', parent: 'spine', pos: p(0, 0.4, 0.03) },
      // голова чуть впереди корпуса: заводная фигура словно кланяется
      { name: 'head', parent: 'chest', pos: p(0, 0.62, 0.08) },
      { name: 'shL', parent: 'chest', pos: p(0.53, 0.46, 0) },
      { name: 'elbL', parent: 'shL', pos: p(0, -0.68, 0) },
      { name: 'handL', parent: 'elbL', pos: p(0, -0.64, 0) },
      { name: 'shR', parent: 'chest', pos: p(-0.53, 0.46, 0) },
      { name: 'elbR', parent: 'shR', pos: p(0, -0.68, 0) },
      { name: 'handR', parent: 'elbR', pos: p(0, -0.64, 0) },
      { name: 'hipL', parent: 'pelvis', pos: p(0.21, -0.06, 0) },
      { name: 'kneeL', parent: 'hipL', pos: p(0, -0.6, 0.03) },
      { name: 'footL', parent: 'kneeL', pos: p(0, -0.58, -0.03) },
      { name: 'hipR', parent: 'pelvis', pos: p(-0.21, -0.06, 0) },
      { name: 'kneeR', parent: 'hipR', pos: p(0, -0.6, 0.03) },
      { name: 'footR', parent: 'kneeR', pos: p(0, -0.58, -0.03) },
      { name: 'key', parent: 'chest', pos: p(...RINGER_KEY) },
      { name: 'pend', parent: 'spine', pos: p(...RINGER_PEND) },
      { name: 'hourH', parent: 'chest', pos: p(...RINGER_DIAL.at) },
      { name: 'minH', parent: 'chest', pos: p(...RINGER_DIAL.at) },
    ],
  };
}

export function buildRinger(seed = 22, s = RINGER_SCALE): { rig: RigDef; geometry: THREE.BufferGeometry } {
  const rig = ringerRig(s), J = (n: string) => rig.joints.findIndex((j) => j.name === n);
  const b = new GeomBuilder(), rng = new Rng(seed);
  b.rng = rng; b.color = WOOD;
  // позиция в метрах до масштаба → матрица детали
  const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => mat(x * s, y * s, z * s, rx, ry, rz);
  const along = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => matAlong(x * s, y * s, z * s, dx, dy, dz);
  const ring = (r: number, tube: number, sides = 10) => new THREE.TorusGeometry(r * s, tube * s, 4, sides);
  const metal = { surface: SURF.metal } as const, cloth = { surface: SURF.cloth } as const;
  /** Латунный шарнир: диск, ось вдоль (dx, 0, 0) — снаружи сустава. */
  const hinge = (x: number, y: number, z: number, sx: number, r: number) => b.add(prism(10, r * s, r * s, 0.06 * s), { matrix: along(x, y, z, sx, 0, 0), color: BRASS, ...metal });
  const livery = (pts: [number, number][], m: THREE.Matrix4) => plate(b, pts.map(([x, y]) => [x * s, y * s] as [number, number]), 0.03 * s, m, undefined, LIVERY);

  // ---- таз: деревянный пояс с латунной лентой, юбка-табард ливреи, гири часов на бёдрах
  b.joint = J('pelvis');
  hull8(b, 0.54 * s, 0.36 * s, -0.16 * s, 0.6 * s, 0.4 * s, 0.12 * s);
  b.add(ring(0.32, 0.04, 16), { matrix: M(0, 0.1, 0, Math.PI / 2, 0, 0), color: BRASS, ...metal });
  for (const sx of [1, -1]) hinge(sx * 0.27, -0.06, 0, sx, 0.11);
  livery([[-0.2, 0], [0.2, 0], [0.17, -0.5], [0.06, -0.58], [-0.06, -0.5], [-0.17, -0.56]], M(0, 0.06, 0.215, 0.1, 0, 0));
  livery([[-0.24, 0], [0.24, 0], [0.2, -0.6], [0.07, -0.52], [-0.05, -0.64], [-0.2, -0.55]], M(0, 0.06, -0.225, -0.1, 0, 0));
  for (const z of [0.23, -0.24]) b.add(box(0.4 * s, 0.04 * s, 0.035 * s), { matrix: M(0, 0.04, z, z > 0 ? 0.1 : -0.1, 0, 0), color: GOLD, ...metal });
  for (const sx of [1, -1]) {
    // цепочка и цилиндрическая гиря, как у часов с кукушкой
    b.add(box(0.015 * s, 0.3 * s, 0.015 * s), { matrix: M(sx * 0.35, -0.12, -0.04), color: BRASS_DARK, ...metal });
    b.add(prism(8, 0.065 * s, 0.065 * s, 0.32 * s), { matrix: M(sx * 0.35, -0.6, -0.04), color: BRASS, ...metal });
    b.add(prism(8, 0.07 * s, 0.07 * s, 0.03 * s), { matrix: M(sx * 0.35, -0.3, -0.04), color: BRASS_DARK, ...metal });
  }

  // ---- живот: деревянный короб с окошком, за стеклом — маятник
  b.joint = J('spine');
  hull8(b, 0.54 * s, 0.38 * s, -0.02 * s, 0.66 * s, 0.46 * s, 0.4 * s, 0.02 * s);
  b.add(box(0.28 * s, 0.3 * s, 0.02 * s), { matrix: M(0, 0.19, 0.229), color: DARK_IN, ...cloth, shade: 0.02 });
  for (const [x, y, w, h] of [[0, 0.345, 0.34, 0.04], [0, 0.035, 0.34, 0.04], [0.155, 0.19, 0.04, 0.34], [-0.155, 0.19, 0.04, 0.34]] as const) {
    b.add(box(w * s, h * s, 0.035 * s), { matrix: M(x, y, 0.24), color: BRASS, ...metal });
  }
  // латунные накладки по углам короба
  for (const sx of [1, -1]) b.add(box(0.04 * s, 0.4 * s, 0.04 * s), { matrix: M(sx * 0.3, 0.19, 0.19), color: BRASS_DARK, ...metal });

  // ---- маятник: стержень и латунная линза, ловит отблеск
  b.joint = J('pend');
  b.add(prism(4, 0.012 * s, 0.012 * s, 0.22 * s), { matrix: M(0, -0.22, 0.035), color: BRASS, ...metal });
  b.add(lathe([[0.001, -0.02], [0.07, -0.008], [0.07, 0.008], [0.001, 0.02]].map(([r, y]) => [r * s, y * s] as [number, number]), 14), { matrix: M(0, -0.25, 0.04, Math.PI / 2, 0, 0), color: BRASS, emissive: 0.35, ...metal });
  b.add(prism(6, 0.022 * s, 0.022 * s, 0.03 * s), { matrix: M(0, 0, 0.02, Math.PI / 2, 0, 0), color: BRASS_DARK, ...metal });

  // ---- грудь: бочка из дерева, циферблат спереди, гнездо ключа сзади, брыжи у шеи, полосы ливреи по спине
  b.joint = J('chest');
  hull8(b, 0.7 * s, 0.5 * s, 0, 1.02 * s, 0.58 * s, 0.42 * s, 0.02 * s);
  hull8(b, 1.02 * s, 0.58 * s, 0.42 * s, 0.74 * s, 0.46 * s, 0.6 * s, 0, 0.02 * s);
  // циферблат: светлая слоновая кость, латунный ободок, тлеющий зазор, часовые метки
  const D = RINGER_DIAL;
  b.add(lathe([[0.001, 0], [D.r - 0.01, 0], [D.r - 0.005, 0.03], [D.r - 0.01, 0.06], [0.001, 0.06]].map(([r, y]) => [r * s, y * s] as [number, number]), 24), { matrix: M(D.at[0], D.at[1], D.at[2] - 0.06, Math.PI / 2, 0, 0), color: IVORY, shade: 0.03 });
  b.add(ring(D.r, 0.035, 24), { matrix: M(D.at[0], D.at[1], D.at[2] - 0.005), color: BRASS, ...metal });
  b.add(ring(D.r - 0.035, 0.009, 24), { matrix: M(D.at[0], D.at[1], D.at[2] + 0.002), emissive: 1.4 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, big = k % 3 === 0, r = D.r - 0.075;
    b.add(box((big ? 0.035 : 0.02) * s, (big ? 0.08 : 0.05) * s, 0.01 * s), { matrix: M(D.at[0] + Math.sin(a) * r, D.at[1] + Math.cos(a) * r, D.at[2] + 0.003, 0, 0, -a), color: IRON });
  }
  b.add(prism(8, 0.035 * s, 0.035 * s, 0.04 * s), { matrix: M(D.at[0], D.at[1], D.at[2], Math.PI / 2, 0, 0), color: BRASS, ...metal });
  // латунные ремни по бокам циферблата
  for (const sx of [1, -1]) b.add(box(0.04 * s, 0.46 * s, 0.035 * s), { matrix: M(sx * 0.38, 0.22, 0.28, 0.1, 0, 0), color: BRASS_DARK, ...metal });
  // гнездо заводного ключа в спине
  b.add(prism(8, 0.08 * s, 0.08 * s, 0.06 * s), { matrix: along(RINGER_KEY[0], RINGER_KEY[1], RINGER_KEY[2] + 0.04, 0, 0, -1), color: BRASS, ...metal });
  // плечевые шарниры
  for (const sx of [1, -1]) hinge(sx * 0.5, 0.46, 0, sx, 0.14);
  // шея и брыжи: гофрированный воротник из полотна
  b.add(prism(8, 0.08 * s, 0.07 * s, 0.16 * s), { matrix: M(0, 0.56, 0.05), color: BRASS, ...metal });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.add(octa(0.11 * s, 0.04 * s, 0.07 * s), { matrix: M(Math.sin(a) * 0.21, 0.62, 0.05 + Math.cos(a) * 0.21, 0.25 * Math.cos(a), a, 0), color: LINEN, ...cloth });
  }
  // ливрея по спине: рваные полосы с плеч, посередине — просвет для ключа
  for (const [x, len, ry] of [[-0.42, 1.2, -0.3], [-0.21, 1.4, -0.12], [0.21, 1.35, 0.12], [0.42, 1.15, 0.3]] as const) {
    livery([[-0.11, 0], [0.11, 0], [0.1, -len * 0.72], [0.02, -len], [-0.04, -len * 0.84], [-0.11, -len * 0.92]], M(x, 0.56, -0.3, 0.16, ry, 0));
    b.add(box(0.22 * s, 0.035 * s, 0.035 * s), { matrix: M(x, 0.55, -0.31, 0.16, ry, 0), color: GOLD, ...metal });
  }

  // ---- голова: фарфоровая маска с трещиной, тлеющие глазницы, нарисованные румянец и улыбка; колпак-шпиль
  b.joint = J('head');
  b.add(rock(0.21 * s, 1, 0.025, seed), { matrix: mat(0, 0.17 * s, 0.03 * s, 0, 0, 0, 0.92, 1.18, 0.95), color: PORCELAIN, shade: 0.02 });
  for (const sx of [1, -1]) {
    b.add(octa(0.055 * s, 0.035 * s, 0.032 * s), { matrix: M(sx * 0.075, 0.21, 0.2), color: SOCKET });
    b.add(octa(0.022 * s, 0.022 * s, 0.015 * s), { matrix: M(sx * 0.075, 0.21, 0.222), emissive: 1.8 });
    b.add(prism(10, 0.036 * s, 0.036 * s, 0.006 * s), { matrix: along(sx * 0.115, 0.12, 0.18, sx * 0.45, 0, 1), color: CHEEK, ...cloth });
    b.add(box(0.08 * s, 0.014 * s, 0.01 * s), { matrix: M(sx * 0.04, 0.075, 0.207, 0, sx * 0.25, sx * 0.28), color: SOCKET });
  }
  // трещина через маску: тёмный скол и огонь в глубине
  b.add(shard(0.24 * s, 0.015 * s, 3, 0.4, 7), { matrix: along(0.04, 0.35, 0.16, -0.35, -1, 0.25), color: SOCKET });
  b.add(shard(0.22 * s, 0.008 * s, 3, 0.4, 8), { matrix: along(0.04, 0.35, 0.166, -0.35, -1, 0.25), emissive: 1.5 });
  // колпак — восьмигранный шатёр колокольни, чуть откинут назад; латунный обруч, шар и флюгер-стрела на шпиле
  const cap = M(0, 0.33, -0.01, -0.14, 0, 0), inCap = (m: THREE.Matrix4) => cap.clone().multiply(m);
  b.add(prism(8, 0.29 * s, 0.004 * s, 1.0 * s), { matrix: cap, color: SLATE });
  b.add(ring(0.285, 0.04, 16), { matrix: inCap(M(0, 0.02, 0, Math.PI / 2, 0, 0)), color: BRASS, ...metal });
  b.add(ring(0.18, 0.024, 12), { matrix: inCap(M(0, 0.37, 0, Math.PI / 2, 0, 0)), color: GOLD, ...metal });
  b.add(octa(0.04 * s, 0.04 * s, 0.04 * s), { matrix: inCap(M(0, 1.01, 0)), color: BRASS, ...metal });
  b.add(prism(4, 0.012 * s, 0.012 * s, 0.26 * s), { matrix: inCap(M(0, 1.01, 0)), color: BRASS_DARK, ...metal });
  plate(b, [[0, 0.035], [0.19, 0.035], [0.24, 0], [0.19, -0.035], [0, -0.035]].map(([x, y]) => [x * s, y * s] as [number, number]), 0.012 * s, inCap(M(-0.09, 1.22, 0, 0, 0.6, 0)), undefined, GOLD);

  // ---- руки: пышный рукав ливреи, дерево на латунных шарнирах
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.joint = J('sh' + side);
    b.add(lathe([[0.1, 0.07], [0.19, 0.0], [0.21, -0.11], [0.17, -0.22], [0.1, -0.29]].map(([r, y]) => [r * s, y * s] as [number, number]), 9), { matrix: M(0, 0, 0), color: LIVERY, ...cloth });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      b.add(box(0.025 * s, 0.24 * s, 0.025 * s), { matrix: M(Math.sin(a) * 0.2, -0.11, Math.cos(a) * 0.2, 0, a, 0), color: GOLD, ...metal });
    }
    limb(b, 0.68 * s, 0.13 * s, 0.1 * s, 6);
    b.joint = J('elb' + side);
    hinge(sx * 0.07, 0, 0, sx, 0.1);
    b.add(rock(0.11 * s, 0, 0.1, 50 + sx), { matrix: M(0, 0, 0), color: WOOD2 });
    limb(b, 0.64 * s, 0.105 * s, 0.08 * s, 6);
    b.add(ring(0.095, 0.025), { matrix: M(0, -0.56, 0, Math.PI / 2, 0, 0), color: BRASS, ...metal });
    if (side === 'L') {
      // кисть: латунная ладонь и три длинных пальца-когтя
      b.joint = J('handL');
      hull8(b, 0.2 * s, 0.1 * s, -0.18 * s, 0.15 * s, 0.11 * s, 0);
      b.color = BRASS; b.surface = SURF.metal;
      for (let k = -1; k <= 1; k++) b.add(shard(0.36 * s, 0.035 * s, 3, 0.1, 60 + k), { matrix: along(k * 0.055, -0.17, 0.03, k * 0.12, -1, 0.3) });
      b.add(shard(0.2 * s, 0.03 * s, 3, 0.1, 64), { matrix: along(-0.08, -0.06, 0.06, -0.6, -0.6, 0.5) });
      b.color = WOOD; b.surface = SURF.armor;
    } else {
      // молот жакемара: деревянная рукоять вниз от кулака, железная голова поперёк, латунные обручи и бойки
      b.joint = J('handR');
      b.add(rock(0.12 * s, 0, 0.15, 77), { matrix: M(0, -0.04, 0), color: WOOD2 });
      b.add(prism(6, 0.042 * s, 0.038 * s, 0.82 * s), { matrix: M(0, -0.82, 0), color: WOOD2 });
      const hy = RINGER_CLAPPER_BALL[1];
      b.add(box(0.5 * s, 0.28 * s, 0.28 * s), { matrix: M(0, hy, 0), color: IRON, ...metal });
      for (const x of [-0.15, 0.15]) b.add(box(0.05 * s, 0.3 * s, 0.3 * s), { matrix: M(x, hy, 0), color: BRASS, ...metal });
      for (const bx of [1, -1]) b.add(prism(8, 0.15 * s, 0.15 * s, 0.06 * s), { matrix: along(bx * 0.25, hy, 0, bx, 0, 0), color: BRASS_DARK, ...metal });
      // по голове молота — тлеющие трещины от ударов
      for (let k = 0; k < 3; k++) b.add(shard(0.2 * s, 0.014 * s, 3, 0.35, 90 + k), { matrix: along(-0.07 + k * 0.07, hy - 0.08, 0.141, 0.3 - k * 0.3, 1, 0), emissive: 1.2 });
    }
  }

  // ---- ноги: дерево на шарнирах, полосатые чулки ливреи, туфли с загнутыми носами
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.joint = J('hip' + side);
    limb(b, 0.6 * s, 0.13 * s, 0.1 * s, 6);
    for (let k = 0; k < 3; k++) b.add(ring(0.122 - k * 0.008, 0.025), { matrix: M(0, -0.14 - k * 0.14, 0, Math.PI / 2, 0, 0), color: k % 2 ? GOLD : LIVERY, ...(k % 2 ? metal : cloth) });
    b.joint = J('knee' + side);
    hinge(sx * 0.07, 0, 0, sx, 0.1);
    b.add(rock(0.1 * s, 0, 0.1, 70 + sx), { matrix: M(0, 0, 0.02), color: WOOD2 });
    limb(b, 0.58 * s, 0.095 * s, 0.07 * s, 6);
    b.joint = J('foot' + side);
    hull8(b, 0.18 * s, 0.34 * s, -0.06 * s, 0.14 * s, 0.22 * s, 0.05 * s, 0.04 * s, 0.07 * s);
    b.add(shard(0.3 * s, 0.065 * s, 4, 0.1, 80 + sx), { matrix: along(0, -0.02, 0.22, 0, 0.5, 1), color: WOOD });
    b.add(octa(0.035 * s, 0.035 * s, 0.035 * s), { matrix: M(0, 0.115, 0.49), color: BRASS, ...metal });
  }

  // ---- заводной ключ: латунный стержень из спины и широкая «бабочка» из двух колец (вращается вокруг оси −z)
  b.joint = J('key');
  b.add(prism(6, 0.045 * s, 0.045 * s, 0.46 * s), { matrix: along(0, 0, 0, 0, 0, -1), color: BRASS, ...metal });
  b.add(box(0.24 * s, 0.09 * s, 0.15 * s), { matrix: M(0, 0, -0.5), color: BRASS, ...metal });
  for (const sx of [1, -1]) {
    b.add(ring(0.2, 0.05, 16), { matrix: M(sx * 0.27, 0, -0.52, Math.PI / 2, 0, 0), color: BRASS, ...metal });
    b.add(prism(14, 0.16 * s, 0.16 * s, 0.035 * s), { matrix: M(sx * 0.27, -0.0175, -0.52), color: BRASS, ...metal });
  }

  // ---- стрелки циферблата: минутная длинная, часовая короткая (вращаются вокруг оси циферблата)
  b.joint = J('minH');
  b.add(shard(0.24 * s, 0.024 * s, 3, 0, 0), { matrix: M(0, -0.035, 0.012), color: IRON, ...metal });
  b.joint = J('hourH');
  b.add(shard(0.16 * s, 0.034 * s, 3, 0, 0), { matrix: M(0, -0.03, 0.022), color: IRON, ...metal });
  return { rig, geometry: b.build() };
}
