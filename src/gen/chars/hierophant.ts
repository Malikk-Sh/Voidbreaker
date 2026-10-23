import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import type { JointDef, RigDef } from '../../anim/skeleton';
import { GeomBuilder, mat, matAlong, SURF } from '../geom/build';
import { jitter, lathe, octa, prism, shard, box, starPlate } from '../geom/prims';
import { hull8, limb, plate } from './parts';
import type { RigBuild } from './enemies';

const OBS = hexToLinear('#110d15');

export const ARMS = ['UL', 'UR', 'LL', 'LR'] as const;

/**
 * Иерофант Скорби — «Слепой понтифик» (замена модели по решению автора): высокий и тонкий, парит над полом;
 * длинная митра, золотая маска с зашитыми глазами, за головой — нимб из витражных осколков, ряса из ткани
 * с рваным подолом, в правой руке посох с кадилом на крюке, ещё три кадила на цепях.
 * Суставы те же, что у прежней модели (позы, атаки и сцены работают без изменений): сустав «bell» — голова
 * с маской и митрой, «clapper» — нимб, новый «staff» — посох; кадило правой верхней руки висит на его крюке.
 */
export function hierophantRig(): RigDef {
  const joints: JointDef[] = [
    { name: 'root', pos: [0, 0, 0] },
    { name: 'body', parent: 'root', pos: [0, 2.3, 0] },
    { name: 'robe', parent: 'body', pos: [0, 0, 0] },
    { name: 'chest', parent: 'body', pos: [0, 1.75, 0] },
    { name: 'bell', parent: 'chest', pos: [0, 0.7, 0.05] },
    { name: 'clapper', parent: 'bell', pos: [0, 0.45, -0.38] },
    // посох у правого бока, чуть впереди: держится корпусом, рука лежит на нём
    { name: 'staff', parent: 'chest', pos: [-0.72, -0.15, 0.42] },
  ];
  const armPos: Record<string, [number, number, number]> = { UL: [0.6, 0.32, 0.05], UR: [-0.6, 0.32, 0.05], LL: [0.48, -0.42, 0.2], LR: [-0.48, -0.42, 0.2] };
  for (const a of ARMS) {
    joints.push({ name: `sh${a}`, parent: 'chest', pos: armPos[a] });
    joints.push({ name: `elb${a}`, parent: `sh${a}`, pos: [0, a[0] === 'U' ? -0.95 : -0.7, 0] });
    joints.push({ name: `hand${a}`, parent: `elb${a}`, pos: [0, a[0] === 'U' ? -0.9 : -0.65, 0] });
    joints.push({ name: `c1${a}`, parent: a === 'UR' ? 'staff' : `hand${a}`, pos: a === 'UR' ? [0, 1.55, 0.32] : [0, -0.15, 0] });
    joints.push({ name: `c2${a}`, parent: `c1${a}`, pos: [0, -0.55, 0] });
    joints.push({ name: `censer${a}`, parent: `c2${a}`, pos: [0, -0.55, 0] });
  }
  return { id: 'hierophant', joints };
}

/** Цвета понтифика: ряса — чёрно-багровая (цвет врага), золото маски и посоха, витраж нимба — багрец и янтарь. */
const ROBE = hexToLinear('#3a0e16');
const ROBE2 = hexToLinear('#55141e');
// ревью: в темноте и красном ободе маска читалась бурой — золото светлее
const MASK = hexToLinear('#c99a48');
const GLASS = [hexToLinear('#7a1420'), hexToLinear('#a8461a'), hexToLinear('#5c0f1c'), hexToLinear('#9a6a22')];

export function buildHierophant(seed = 31): RigBuild {
  const rig = hierophantRig();
  const J = (n: string) => rig.joints.findIndex((j) => j.name === n);
  const b = new GeomBuilder(); const rng = new Rng(seed); b.rng = rng; b.color = OBS;
  const M = SURF.metal, C = SURF.cloth;

  // ---------- ряса: узкая и длинная, подол висит над полом рваными лентами
  b.joint = J('robe');
  const robe = lathe([[0.98, -1.75], [0.86, -1.1], [0.7, -0.2], [0.56, 0.7], [0.52, 1.3], [0.68, 1.72], [0.4, 1.92], [0.0, 1.98]], 12, 0.1);
  jitter(robe, 0.05, seed, [1, 0.3, 1]);
  b.add(robe, { color: ROBE, surface: C });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rng.spread(0.08);
    b.add(shard(rng.range(0.35, 0.75), rng.range(0.12, 0.2), 3, 0.25, i), {
      matrix: matAlong(Math.sin(a) * 0.93, -1.7, Math.cos(a) * 0.93, Math.sin(a) * 0.15, -1, Math.cos(a) * 0.15), color: i % 3 ? ROBE : ROBE2, surface: C,
    });
  }
  // стола: две золотые полосы спереди до подола, руны тлеют
  for (const sx of [-0.17, 0.17]) {
    b.add(box(0.14, 3.2, 0.04), { matrix: mat(sx, -0.1, 0.62 - Math.abs(sx) * 0.3, -0.13, 0, 0), color: MASK, surface: M, shade: 0.15 });
    for (let k = 0; k < 5; k++) b.add(box(0.07, 0.07, 0.03), { matrix: mat(sx, 1.0 - k * 0.55, 0.67 - k * 0.07, -0.13, 0, Math.PI / 4), emissive: 1.0, color: OBS });
  }
  b.add(new THREE.TorusGeometry(0.94, 0.03, 3, 24), { matrix: mat(0, -1.62, 0, Math.PI / 2, 0, 0), color: MASK, surface: M });
  // тлеющие швы — тонкие багровые нити по рясе
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.5;
    b.add(shard(1.6, 0.018, 3, 0.2, i + 3), { matrix: matAlong(Math.sin(a) * 0.82, -1.5, Math.cos(a) * 0.82, -Math.sin(a) * 0.18, 1, -Math.cos(a) * 0.18), emissive: 0.8 });
  }

  // ---------- грудь: узкие плечи, высокий воротник-пелерина, наперсный знак
  b.joint = J('chest');
  hull8(b, 0.82, 0.5, -0.3, 1.05, 0.56, 0.4);
  const cape = lathe([[0.62, -0.5], [0.74, 0.0], [0.7, 0.32], [0.42, 0.48], [0.0, 0.5]], 10, 0.2);
  b.add(cape, { color: ROBE2, surface: C });
  b.add(new THREE.TorusGeometry(0.72, 0.025, 3, 20), { matrix: mat(0, 0.02, 0, Math.PI / 2, 0, 0), color: MASK, surface: M });
  // воротник: веер плоских пластин за головой (не шипы — цельный силуэт)
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.28;
    plate(b, [[-0.08, 0], [0.08, 0], [0.04, 0.55], [-0.04, 0.55]], 0.03, mat(Math.sin(a) * 0.34, 0.38, -0.12 - Math.cos(a) * 0.12, -0.35, a, 0), 0, ROBE2);
  }
  // наперсный знак: семилучевая звезда (погасшая) на золотой цепи
  b.add(starPlate(7, 0.14, 0.07, 0.03), { matrix: mat(0, 0.05, 0.31, -0.1, 0, 0), color: MASK, surface: M });
  b.add(octa(0.035, 0.035, 0.02), { matrix: mat(0, 0.05, 0.335), emissive: 1.4, color: OBS });

  // ---------- голова: шея, золотая маска с зашитыми глазами, длинная митра
  b.joint = J('bell');
  b.add(prism(8, 0.12, 0.1, 0.22), { matrix: mat(0, -0.12, 0), color: ROBE2, surface: C });
  // маска: выпуклая золотая пластина-овал, лоб и скулы — грани
  const mask = lathe([[0.0, -0.02], [0.13, 0.02], [0.19, 0.18], [0.18, 0.38], [0.12, 0.52], [0.0, 0.56]], 8, Math.PI / 8);
  b.add(mask, { matrix: mat(0, 0.0, 0.0, 0, 0, 0, 1, 1, 0.8), color: MASK, surface: M });
  // зашитые глаза: тёмные швы-прорези и багровые стежки поперёк
  for (const sx of [-1, 1]) {
    b.add(box(0.12, 0.016, 0.03), { matrix: mat(sx * 0.075, 0.3, 0.15, 0, sx * 0.25, sx * 0.08), color: OBS });
    for (let k = 0; k < 5; k++) b.add(box(0.008, 0.05, 0.02), { matrix: mat(sx * (0.03 + k * 0.022), 0.3, 0.157, 0, sx * 0.25, sx * 0.08), emissive: 0.9, color: OBS });
  }
  // рот — тонкая щель, нос — ребро
  b.add(box(0.07, 0.01, 0.02), { matrix: mat(0, 0.12, 0.155), color: OBS });
  b.add(prism(3, 0.02, 0.0, 0.12), { matrix: mat(0, 0.2, 0.16, 0, 0, 0), color: MASK, surface: M });
  // митра: две высокие заострённые пластины (перед и зад) с золотой каймой и багровыми полями
  const MITRE = hexToLinear('#6e1826');
  for (const z of [0.07, -0.07]) {
    const tilt = z > 0 ? -0.06 : 0.06;
    plate(b, [[-0.21, 0.0], [0.21, 0.0], [0.25, 0.55], [0.0, 1.5], [-0.25, 0.55]], 0.04, mat(0, 0.5, z, tilt, 0, 0), 0, MITRE);
    // золотая кайма по контуру — митра читается силуэтом на тёмном своде
    b.surface = M;
    for (const [[x0, y0], [x1, y1]] of [[[0.21, 0.0], [0.25, 0.55]], [[0.25, 0.55], [0.0, 1.5]], [[0.0, 1.5], [-0.25, 0.55]], [[-0.25, 0.55], [-0.21, 0.0]]] as [[number, number], [number, number]][]) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      b.add(box(0.035, len, 0.05), { matrix: mat((x0 + x1) / 2, 0.5 + (y0 + y1) / 2, z * 1.15, tilt, 0, Math.atan2(x0 - x1, y1 - y0)), color: MASK });
    }
    b.surface = SURF.armor;
    plate(b, [[-0.03, 0.02], [0.03, 0.02], [0.03, 1.2], [-0.03, 1.2]], 0.05, mat(0, 0.5, z * 1.25, tilt, 0, 0), 0, MASK);
  }
  b.add(starPlate(7, 0.09, 0.045, 0.02), { matrix: mat(0, 1.05, 0.11, -0.06, 0, 0), emissive: 0.8, color: MASK });
  b.add(prism(8, 0.22, 0.22, 0.08, true), { matrix: mat(0, 0.48, 0, 0, Math.PI / 8, 0, 1, 1, 0.75), color: MASK, surface: M });
  b.add(octa(0.05, 0.08, 0.05), { matrix: mat(0, 1.98, 0), color: MASK, surface: M });
  // ленты митры (инфулы) — назад и вниз
  for (const sx of [-0.1, 0.1]) b.add(box(0.06, 0.7, 0.015), { matrix: mat(sx, 0.2, -0.17, 0.18, 0, sx), color: ROBE2, surface: C });

  // ---------- нимб: кольцо витражных осколков за головой, золотая оправа
  b.joint = J('clapper');
  b.add(new THREE.TorusGeometry(1.0, 0.03, 3, 36), { color: MASK, surface: M });
  b.add(new THREE.TorusGeometry(0.62, 0.02, 3, 28), { color: MASK, surface: M });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng.spread(0.05);
    const r = rng.range(0.66, 0.96), len = rng.range(0.22, 0.42);
    // пластина-осколок, повёрнута по радиусу; стекло светится (эмиссия), рама тёмная
    plate(b, [[-0.06, 0], [0.07, 0.02], [0.05, len], [-0.04, len * 0.9]], 0.02, mat(Math.sin(a) * r, Math.cos(a) * r, 0, 0, 0, -a), 0.65 + rng.next() * 0.35, GLASS[i % GLASS.length]);
  }

  // ---------- посох: золотой жезл до пола, навершие-звезда и крюк для кадила
  b.joint = J('staff');
  b.add(prism(6, 0.035, 0.03, 4.6), { matrix: mat(0, -3.2, 0), color: MASK, surface: M });
  for (const y of [-1.6, -0.2, 0.8]) b.add(prism(6, 0.05, 0.05, 0.06), { matrix: mat(0, y, 0), color: MASK, surface: M });
  b.add(starPlate(7, 0.26, 0.12, 0.04), { matrix: mat(0, 1.55, 0, 0, 0, 0), color: MASK, surface: M });
  b.add(octa(0.06, 0.06, 0.04), { matrix: mat(0, 1.55, 0.02), emissive: 1.2, color: OBS });
  b.add(box(0.03, 0.03, 0.34), { matrix: mat(0, 1.6, 0.16), color: MASK, surface: M });

  // ---------- руки: длинные тонкие рукава, сухие кисти; кадила на цепях
  for (const a of ARMS) {
    const upper = a[0] === 'U';
    b.joint = J(`sh${a}`);
    b.add(octa(upper ? 0.18 : 0.14, 0.14, upper ? 0.18 : 0.14), { color: ROBE2, surface: C });
    const sleeve = lathe([[0.09, 0], [0.12, -0.4], [0.18, -0.85], [0.22, -0.95]], 7);
    b.add(sleeve, { matrix: mat(0, 0, 0, 0, 0, 0, 1, upper ? 1 : 0.75, 1), color: ROBE, surface: C });
    b.joint = J(`elb${a}`);
    limb(b, upper ? 0.9 : 0.65, 0.07, 0.05, 5);
    b.add(prism(7, 0.12, 0.18, 0.32), { matrix: mat(0, -0.55, 0, Math.PI, 0, 0), color: ROBE, surface: C });
    b.joint = J(`hand${a}`);
    // сухая кисть с длинными пальцами
    b.add(octa(0.06, 0.09, 0.05), { matrix: mat(0, -0.05, 0), color: MASK, surface: M });
    for (let k = -1; k <= 1; k++) b.add(shard(0.18, 0.012, 3, 0.1, k + 5), { matrix: matAlong(k * 0.025, -0.1, 0.01, k * 0.15, -1, 0.25), color: MASK, surface: M });
    for (const c of ['c1', 'c2']) {
      b.joint = J(`${c}${a}`);
      for (let k = 0; k < 3; k++) b.add(octa(0.035, 0.08, 0.02), { matrix: mat(0, -0.1 - k * 0.17, 0, 0, k % 2 ? Math.PI / 2 : 0, 0), color: MASK, surface: M });
    }
    b.joint = J(`censer${a}`);
    // кадило: золотая чаша-фонарь с куполом, внутри тлеет
    b.add(lathe([[0.0, -0.62], [0.2, -0.55], [0.27, -0.36], [0.24, -0.2], [0.12, -0.1], [0.0, -0.02]], 8), { color: MASK, surface: M, shade: 0.25 });
    b.add(octa(0.17, 0.2, 0.17), { matrix: mat(0, -0.38, 0, 0, Math.PI / 4, 0), emissive: -1.6 });
    b.add(prism(4, 0.04, 0, 0.22), { matrix: mat(0, -0.8, 0, Math.PI, 0, 0), color: MASK, surface: M });
  }
  return { rig, geometry: b.build() };
}
