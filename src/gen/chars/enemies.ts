import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import type { JointDef, RigDef } from '../../anim/skeleton';
import { GeomBuilder, mat, matAlong } from '../geom/build';
import { bipyramid, box, lathe, octa, prism, rock, shard, jitter } from '../geom/prims';
import { hull8, limb, plate, torso } from './parts';

/**
 * Генераторы врагов (Tech §7.3): чёрный обсидиан с багровыми прожилками и светящимися ядрами (GDD §9.1).
 * Размер = опасность. Элита — тот же генератор с другим сидом, масштабом и аурой.
 */
const OBS = hexToLinear('#120f17');
const OBS2 = hexToLinear('#1d1820');

export interface RigBuild { rig: RigDef; geometry: THREE.BufferGeometry }

const jidx = (rig: RigDef) => (n: string) => rig.joints.findIndex((j) => j.name === n);

// ------------------------------------------------------------------ Ползун (Шипник)
export const CRAWLER_LEGS = 6;
export function crawlerRig(): RigDef {
  const joints: JointDef[] = [
    { name: 'root', pos: [0, 0, 0] },
    { name: 'body', parent: 'root', pos: [0, 0.55, 0] },
    { name: 'jaw', parent: 'body', pos: [0, -0.08, 0.3] },
  ];
  for (let i = 0; i < CRAWLER_LEGS; i++) {
    const side = i < 3 ? 1 : -1, k = i % 3;
    const a = side * (Math.PI / 2) + (k - 1) * -side * 0.75;
    joints.push({ name: `hip${i}`, parent: 'body', pos: [Math.sin(a) * 0.3, -0.05, Math.cos(a) * 0.3], rot: [0, a, 0] });
    joints.push({ name: `knee${i}`, parent: `hip${i}`, pos: [0, 0.22, 0.42] });
  }
  return { id: 'crawler', joints };
}

export function buildCrawler(seed = 1): RigBuild {
  const rig = crawlerRig(); const J = jidx(rig);
  const b = new GeomBuilder(); b.rng = new Rng(seed); b.color = OBS;
  b.joint = J('body');
  b.add(rock(0.36, 0, 0.18, seed), { matrix: mat(0, 0, 0, 0, 0, 0, 1, 0.85, 1.15) });
  const rng = new Rng(seed + 3);
  for (let i = 0; i < 16; i++) {
    const u = rng.next(), v = rng.range(-0.2, 1);
    const a = u * Math.PI * 2, el = Math.asin(v);
    const dx = Math.cos(el) * Math.sin(a), dy = Math.sin(el), dz = Math.cos(el) * Math.cos(a) - 0.3;
    if (dz > 0.6 && dy < 0.3) continue; // лицо свободно
    b.add(shard(rng.range(0.28, 0.5), rng.range(0.05, 0.09), 4, 0.3, i), { matrix: matAlong(dx * 0.3, dy * 0.3, dz * 0.3, dx, dy + 0.2, dz) });
  }
  // глаз-ядро и багровые прожилки
  b.add(octa(0.1, 0.08, 0.06), { matrix: mat(0, 0.05, 0.36), emissive: 1.8 });
  b.add(octa(0.05, 0.04, 0.04), { matrix: mat(0.13, 0.1, 0.31), emissive: 1.2 });
  b.add(octa(0.05, 0.04, 0.04), { matrix: mat(-0.13, 0.1, 0.31), emissive: 1.2 });
  for (let i = 0; i < 4; i++) b.add(shard(0.3, 0.02, 3, 0.3, i), { matrix: matAlong(0, 0.1, 0.33, rng.spread(1), rng.spread(1), -0.6), emissive: 0.9 });
  b.joint = J('jaw');
  for (const s of [1, -1]) b.add(shard(0.3, 0.05, 3, 0.2, 2), { matrix: matAlong(s * 0.1, 0, 0, s * 0.3, -0.3, 1) });
  for (let i = 0; i < CRAWLER_LEGS; i++) {
    b.joint = J(`hip${i}`);
    b.add(prism(4, 0.045, 0.06, 0.48), { matrix: matAlong(0, 0, 0, 0, 0.47, 0.88) });
    b.joint = J(`knee${i}`);
    b.add(prism(4, 0.005, 0.05, 0.72), { matrix: matAlong(0, 0, 0, 0, -1, 0.35) });
    b.add(shard(0.12, 0.04, 3, 0.2, i), { matrix: matAlong(0, 0.02, 0, 0, 1, -0.4), emissive: 0 });
  }
  return { rig, geometry: b.build() };
}

// ------------------------------------------------------------------ Богомол (Жнец)
export function mantisRig(): RigDef {
  return {
    id: 'mantis',
    joints: [
      { name: 'root', pos: [0, 0, 0] },
      { name: 'pelvis', parent: 'root', pos: [0, 1.05, 0] },
      { name: 'torso', parent: 'pelvis', pos: [0, 0.1, 0.05], rot: [0.45, 0, 0] },
      { name: 'head', parent: 'torso', pos: [0, 0.75, 0.05] },
      { name: 'armL', parent: 'torso', pos: [0.2, 0.6, 0.05] },
      { name: 'scyL', parent: 'armL', pos: [0, -0.5, 0] },
      { name: 'armR', parent: 'torso', pos: [-0.2, 0.6, 0.05] },
      { name: 'scyR', parent: 'armR', pos: [0, -0.5, 0] },
      { name: 'legFL', parent: 'pelvis', pos: [0.18, -0.02, 0.18], rot: [0, 0.6, 0] },
      { name: 'shinFL', parent: 'legFL', pos: [0, 0.18, 0.45] },
      { name: 'legFR', parent: 'pelvis', pos: [-0.18, -0.02, 0.18], rot: [0, -0.6, 0] },
      { name: 'shinFR', parent: 'legFR', pos: [0, 0.18, 0.45] },
      { name: 'legBL', parent: 'pelvis', pos: [0.18, -0.02, -0.15], rot: [0, 2.4, 0] },
      { name: 'shinBL', parent: 'legBL', pos: [0, 0.18, 0.45] },
      { name: 'legBR', parent: 'pelvis', pos: [-0.18, -0.02, -0.15], rot: [0, -2.4, 0] },
      { name: 'shinBR', parent: 'legBR', pos: [0, 0.18, 0.45] },
    ],
  };
}

export function buildMantis(seed = 2): RigBuild {
  const rig = mantisRig(); const J = jidx(rig);
  const b = new GeomBuilder(); b.rng = new Rng(seed); b.color = OBS;
  b.joint = J('pelvis');
  b.add(bipyramid(5, 0.2, 0.15, 0.35), { matrix: mat(0, 0, -0.1, 1.2, 0, 0) });
  b.add(shard(0.7, 0.16, 5, 0.25, seed), { matrix: matAlong(0, 0, -0.1, 0, 0.2, -1) });
  b.joint = J('torso');
  torso(b, 0.18, 0.3, 0.42, 0.14, 0.18, 0.2, 0, 0.35, 0.68);
  for (const s of [1, -1]) b.add(shard(0.45, 0.06, 4, 0.2, 3), { matrix: matAlong(s * 0.18, 0.62, -0.05, s * 0.5, 1, -0.6) });
  b.add(shard(0.3, 0.02, 3, 0.3, 4), { matrix: matAlong(0.05, 0.2, 0.1, -0.2, 1, 0.3), emissive: 0.9 });
  b.add(shard(0.25, 0.02, 3, 0.3, 5), { matrix: matAlong(-0.05, 0.4, 0.11, 0.3, 1, 0.2), emissive: 0.8 });
  b.joint = J('head');
  b.add(bipyramid(4, 0.12, 0.08, 0.2), { matrix: mat(0, 0.05, 0.08, -1.1, Math.PI / 4, 0, 1, 1.3, 1) });
  b.add(box(0.16, 0.025, 0.04), { matrix: mat(0, 0.08, 0.18, -0.3), emissive: 1.8 });
  b.add(shard(0.35, 0.04, 3, 0.2, 7), { matrix: matAlong(0.05, 0.1, 0, 0.3, 0.4, -1) });
  b.add(shard(0.35, 0.04, 3, 0.2, 8), { matrix: matAlong(-0.05, 0.1, 0, -0.3, 0.4, -1) });
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    b.joint = J('arm' + side);
    limb(b, 0.5, 0.06, 0.05, 4);
    b.joint = J('scy' + side);
    // коса: длинное изогнутое лезвие вперёд-вниз
    plate(b, [[0, 0.05], [0.06, -0.05], [0.07, -0.4], [0.02, -0.85], [-0.04, -1.05], [-0.02, -0.7], [-0.04, -0.3], [-0.05, 0]], 0.04, mat(0, 0, 0, 0, Math.PI / 2 + s * 0.2, 0));
    plate(b, [[0.07, -0.1], [0.085, -0.4], [0.035, -0.85], [-0.035, -1.06], [0.02, -0.82], [0.055, -0.4], [0.05, -0.1]], 0.046, mat(0, 0, 0, 0, Math.PI / 2 + s * 0.2, 0), 1.3);
  }
  for (const leg of ['FL', 'FR', 'BL', 'BR']) {
    b.joint = J('leg' + leg);
    b.add(prism(4, 0.04, 0.06, 0.5), { matrix: matAlong(0, 0, 0, 0, 0.37, 0.93) });
    b.joint = J('shin' + leg);
    b.add(prism(4, 0.005, 0.045, 1.25), { matrix: matAlong(0, 0, 0, 0, -1, 0.3) });
  }
  return { rig, geometry: b.build() };
}

// ------------------------------------------------------------------ Парящий (Око)
export function eyeRig(): RigDef {
  const joints: JointDef[] = [
    { name: 'root', pos: [0, 0, 0] },
    { name: 'core', parent: 'root', pos: [0, 1.9, 0] },
    { name: 'iris', parent: 'core', pos: [0, 0, 0.12] },
    { name: 'ring', parent: 'core', pos: [0, 0, 0] },
  ];
  for (let i = 0; i < 4; i++) joints.push({ name: `petal${i}`, parent: 'core', pos: [0, 0, 0], rot: [0, 0, (i / 4) * Math.PI * 2 + Math.PI / 4] });
  return { id: 'eye', joints };
}

export function buildEye(seed = 3): RigBuild {
  const rig = eyeRig(); const J = jidx(rig);
  const b = new GeomBuilder(); b.rng = new Rng(seed); b.color = OBS;
  b.joint = J('core');
  b.add(rock(0.36, 1, 0.05, seed), { matrix: mat(0, 0, -0.05) });
  b.joint = J('iris');
  b.add(prism(8, 0.22, 0.2, 0.06), { matrix: mat(0, 0, 0.2, Math.PI / 2, 0, 0), emissive: 1.0 });
  b.add(prism(6, 0.1, 0.08, 0.08), { matrix: mat(0, 0, 0.24, Math.PI / 2, 0, 0), emissive: 1.9 });
  b.joint = J('ring');
  const rng = new Rng(seed + 9);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.add(shard(rng.range(0.35, 0.6), 0.07, 4, 0.25, i), { matrix: matAlong(Math.sin(a) * 0.5, Math.cos(a) * 0.5, -0.15, Math.sin(a), Math.cos(a), -0.2) });
  }
  b.add(new THREE.TorusGeometry(0.5, 0.03, 3, 18), { matrix: mat(0, 0, -0.15), emissive: 0.5 });
  for (let i = 0; i < 4; i++) {
    b.joint = J(`petal${i}`);
    // лепесток-веко: изогнутая пластина, раскрывается при выстреле
    plate(b, [[-0.22, 0], [0.22, 0], [0.16, 0.38], [0, 0.48], [-0.16, 0.38]], 0.05, mat(0, 0.02, 0.25, 0.9, 0, 0));
    b.add(shard(0.18, 0.025, 3, 0.2, i), { matrix: matAlong(0, 0.3, 0.31, 0, 1, 0.4), emissive: 0.8 });
  }
  return { rig, geometry: b.build() };
}

// ------------------------------------------------------------------ Аколит Хора
export function acolyteRig(): RigDef {
  return {
    id: 'acolyte',
    joints: [
      { name: 'root', pos: [0, 0, 0] },
      { name: 'body', parent: 'root', pos: [0, 0.35, 0] },
      { name: 'chest', parent: 'body', pos: [0, 1.25, 0] },
      { name: 'head', parent: 'chest', pos: [0, 0.32, 0.02] },
      { name: 'halo', parent: 'chest', pos: [0, 0.45, -0.22] },
      { name: 'armL', parent: 'chest', pos: [0.22, 0.12, 0] },
      { name: 'handL', parent: 'armL', pos: [0, -0.5, 0] },
      { name: 'armR', parent: 'chest', pos: [-0.22, 0.12, 0] },
      { name: 'handR', parent: 'armR', pos: [0, -0.5, 0] },
    ],
  };
}

export function buildAcolyte(seed = 4): RigBuild {
  const rig = acolyteRig(); const J = jidx(rig);
  const b = new GeomBuilder(); b.rng = new Rng(seed); b.color = OBS;
  b.joint = J('body');
  const robe = lathe([[0.55, 0], [0.48, 0.2], [0.35, 0.8], [0.27, 1.25], [0.28, 1.45], [0.0, 1.55]], 7, 0.2);
  jitter(robe, 0.04, seed, [1, 0.3, 1]);
  b.add(robe, {});
  // рваный край рясы
  const rng = new Rng(seed);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.add(shard(rng.range(0.25, 0.45), 0.1, 3, 0.3, i), { matrix: matAlong(Math.sin(a) * 0.48, 0.05, Math.cos(a) * 0.48, Math.sin(a) * 0.2, -1, Math.cos(a) * 0.2) });
  }
  b.add(box(0.06, 0.9, 0.02), { matrix: mat(0, 0.75, 0.33, -0.12), emissive: 0.7 });
  b.joint = J('chest');
  b.add(prism(6, 0.3, 0.2, 0.25), { matrix: mat(0, -0.05, 0) });
  b.joint = J('head');
  const hood = lathe([[0.2, 0], [0.22, 0.15], [0.16, 0.36], [0.0, 0.5]], 6);
  b.add(hood, { matrix: mat(0, -0.12, -0.02, -0.25) });
  b.add(box(0.2, 0.17, 0.06), { matrix: mat(0, 0.04, 0.14, -0.25), color: [0, 0, 0], shade: 0 });
  b.add(box(0.035, 0.02, 0.04), { matrix: mat(0.05, 0.06, 0.17), emissive: 1.9 });
  b.add(box(0.035, 0.02, 0.04), { matrix: mat(-0.05, 0.06, 0.17), emissive: 1.9 });
  b.joint = J('halo');
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add(shard(0.22, 0.03, 3, 0.2, i), { matrix: matAlong(Math.sin(a) * 0.32, Math.cos(a) * 0.32, 0, Math.sin(a), Math.cos(a), 0), emissive: i % 2 ? 0.8 : 0 });
  }
  b.add(new THREE.TorusGeometry(0.3, 0.02, 3, 16), { emissive: 1.2 });
  for (const side of ['L', 'R'] as const) {
    b.joint = J('arm' + side);
    limb(b, 0.5, 0.07, 0.09, 5);
    b.joint = J('hand' + side);
    b.add(octa(0.05, 0.08, 0.05), { matrix: mat(0, -0.04, 0) });
  }
  b.joint = J('handR');
  b.add(prism(4, 0.025, 0.025, 1.6), { matrix: mat(0, -0.8, 0) });
  b.add(octa(0.1, 0.16, 0.1), { matrix: mat(0, 0.9, 0), emissive: 1.5 });
  return { rig, geometry: b.build() };
}

// ------------------------------------------------------------------ Тяжёлый двуногий (Голем)
export function bruteRig(id = 'brute', scale = 1): RigDef {
  const s = scale;
  return {
    id,
    joints: [
      { name: 'root', pos: [0, 0, 0] },
      { name: 'pelvis', parent: 'root', pos: [0, 1.2 * s, 0] },
      { name: 'spine', parent: 'pelvis', pos: [0, 0.35 * s, 0] },
      { name: 'chest', parent: 'spine', pos: [0, 0.45 * s, 0.05 * s] },
      { name: 'head', parent: 'chest', pos: [0, 0.55 * s, 0.25 * s] },
      { name: 'shL', parent: 'chest', pos: [0.75 * s, 0.35 * s, 0] },
      { name: 'elbL', parent: 'shL', pos: [0, -0.65 * s, 0] },
      { name: 'handL', parent: 'elbL', pos: [0, -0.6 * s, 0] },
      { name: 'shR', parent: 'chest', pos: [-0.75 * s, 0.35 * s, 0] },
      { name: 'elbR', parent: 'shR', pos: [0, -0.65 * s, 0] },
      { name: 'handR', parent: 'elbR', pos: [0, -0.6 * s, 0] },
      { name: 'hipL', parent: 'pelvis', pos: [0.32 * s, -0.1 * s, 0] },
      { name: 'kneeL', parent: 'hipL', pos: [0, -0.55 * s, 0] },
      { name: 'footL', parent: 'kneeL', pos: [0, -0.55 * s, 0] },
      { name: 'hipR', parent: 'pelvis', pos: [-0.32 * s, -0.1 * s, 0] },
      { name: 'kneeR', parent: 'hipR', pos: [0, -0.55 * s, 0] },
      { name: 'footR', parent: 'kneeR', pos: [0, -0.55 * s, 0] },
    ],
  };
}

/** Глыбы, налепленные на сустав: ~«300 обсидиановых глыб» у Молоха — здесь десятки у Голема. */
function boulders(b: GeomBuilder, rng: Rng, n: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, size: number): void {
  for (let i = 0; i < n; i++) {
    const u = rng.next() * Math.PI * 2, v = rng.range(-1, 1);
    const k = Math.sqrt(1 - v * v);
    b.add(rock(size * rng.range(0.6, 1.2), 0, 0.3, rng.int(0, 999)), {
      matrix: mat(cx + Math.cos(u) * k * rx, cy + v * ry, cz + Math.sin(u) * k * rz, rng.next() * 3, rng.next() * 3, 0),
    });
  }
}

export function buildBrute(seed = 5, s = 1, opts: { halberd?: boolean; bell?: boolean } = {}): RigBuild {
  const rig = bruteRig(opts.halberd ? 'gateGuardian' : opts.bell ? 'bellRinger' : 'brute', s); const J = jidx(rig);
  const b = new GeomBuilder(); const rng = new Rng(seed); b.rng = rng; b.color = OBS;
  b.joint = J('pelvis');
  hull8(b, 0.8 * s, 0.6 * s, -0.25 * s, 0.9 * s, 0.65 * s, 0.25 * s);
  b.joint = J('spine');
  hull8(b, 0.8 * s, 0.6 * s, 0, 1.1 * s, 0.75 * s, 0.45 * s);
  b.joint = J('chest');
  torso(b, 1.1 * s, 1.5 * s, 1.7 * s, 0.75 * s, 0.9 * s, 0.85 * s, 0, 0.35 * s, 0.6 * s);
  boulders(b, rng, 10, 0, 0.45 * s, -0.15 * s, 0.8 * s, 0.25 * s, 0.4 * s, 0.32 * s);
  // ядро в груди: светящаяся трещина-горнило
  b.add(octa(0.16 * s, 0.24 * s, 0.1 * s), { matrix: mat(0, 0.25 * s, 0.42 * s), emissive: 1.8 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.add(shard(0.4 * s, 0.03 * s, 3, 0.3, i), { matrix: matAlong(0, 0.25 * s, 0.43 * s, Math.cos(a), Math.sin(a), 0.1), emissive: 1.0 });
  }
  b.joint = J('head');
  b.add(rock(0.24 * s, 0, 0.25, seed), { matrix: mat(0, 0, 0, 0, 0, 0, 1.1, 0.8, 1) });
  b.add(box(0.26 * s, 0.04 * s, 0.05 * s), { matrix: mat(0, 0.0, 0.2 * s), emissive: 1.8 });
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.joint = J('sh' + side);
    boulders(b, rng, 5, sx * 0.05 * s, 0.05 * s, 0, 0.32 * s, 0.25 * s, 0.32 * s, 0.3 * s);
    b.add(shard(0.7 * s, 0.14 * s, 4, 0.25, 3), { matrix: matAlong(sx * 0.1 * s, 0.25 * s, -0.05 * s, sx * 0.4, 1, -0.3) });
    limb(b, 0.65 * s, 0.24 * s, 0.2 * s, 6);
    b.joint = J('elb' + side);
    limb(b, 0.6 * s, 0.22 * s, 0.26 * s, 6);
    b.add(shard(0.25 * s, 0.03 * s, 3, 0.3, 4), { matrix: matAlong(0, -0.3 * s, 0.22 * s, 0, -1, 0.2), emissive: 0.9 });
    b.joint = J('hand' + side);
    b.add(rock(0.36 * s, 0, 0.2, rng.int(0, 99)), { matrix: mat(0, -0.25 * s, 0, 0, 0, 0, 1, 1.1, 1) });
    b.joint = J('hip' + side);
    limb(b, 0.55 * s, 0.26 * s, 0.22 * s, 6);
    b.joint = J('knee' + side);
    limb(b, 0.55 * s, 0.22 * s, 0.26 * s, 6);
    b.joint = J('foot' + side);
    hull8(b, 0.4 * s, 0.6 * s, -0.05 * s, 0.32 * s, 0.4 * s, 0.15 * s, 0.05 * s, 0.1 * s);
  }
  if (opts.halberd) {
    // Страж Врат: алебарда в правой руке
    b.joint = J('handR');
    b.add(prism(6, 0.06 * s, 0.06 * s, 3.4 * s), { matrix: mat(0, -0.25 * s, -1.5 * s, Math.PI / 2, 0, 0), color: OBS2 });
    plate(b, [[0, 0], [0.75, 0.25], [0.95, 0.75], [0.55, 0.5], [0.1, 0.55]], 0.06 * s, mat(0, -0.25 * s, 1.75 * s, 0, Math.PI / 2, 0, s));
    plate(b, [[0.1, 0.05], [0.72, 0.28], [0.88, 0.68], [0.55, 0.45]], 0.07 * s, mat(0, -0.25 * s, 1.75 * s, 0, Math.PI / 2, 0, s), 1.2);
    b.add(prism(4, 0.08 * s, 0, 0.7 * s), { matrix: mat(0, -0.25 * s, 1.9 * s, Math.PI / 2, 0, 0) });
    b.joint = J('head');
    b.add(shard(0.9 * s, 0.14 * s, 4, 0.2, 9), { matrix: matAlong(0.15 * s, 0.1 * s, -0.1 * s, 0.4, 1, -0.4) });
    b.add(shard(0.9 * s, 0.14 * s, 4, 0.2, 10), { matrix: matAlong(-0.15 * s, 0.1 * s, -0.1 * s, -0.4, 1, -0.4) });
  }
  if (opts.bell) {
    // Звонарь: колокол на спине и молот-язык в руке
    b.joint = J('chest');
    const bell = lathe([[0.05, 0], [0.9, 0.12], [0.8, 0.5], [0.55, 1.2], [0.5, 1.55], [0.25, 1.75], [0, 1.8]], 10);
    bell.scale(s, s, s);
    b.add(bell, { matrix: mat(0, 0.3 * s, -0.9 * s, 0.35, 0, 0) });
    b.add(prism(10, 0.85 * s, 0.85 * s, 0.05 * s), { matrix: mat(0, 0.36 * s, -0.95 * s, 0.35, 0, 0), emissive: 0.8 });
    b.joint = J('handR');
    b.add(prism(6, 0.06 * s, 0.06 * s, 1.5 * s), { matrix: mat(0, -1.6 * s, 0) });
    b.add(rock(0.38 * s, 1, 0.1, 5), { matrix: mat(0, -1.7 * s, 0, 0, 0, 0, 1, 1.3, 1) });
    b.add(octa(0.12 * s, 0.12 * s, 0.12 * s), { matrix: mat(0, -1.7 * s, 0.34 * s), emissive: 1.4 });
  }
  return { rig, geometry: b.build() };
}
