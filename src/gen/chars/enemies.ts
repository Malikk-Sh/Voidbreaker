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
const OBS = hexToLinear('#131117');
const OBS2 = hexToLinear('#2a2430');
/** Акценты: кость (шипы, маски), потемневшая бронза (оковы, колокола), багровая ткань (рясы, табарды). */
const BONE = hexToLinear('#a39a88');
const BRONZE = hexToLinear('#7d5f30');
const CLOTH = hexToLinear('#4a0f18');

/** Деталь в системе координат другой детали (зубья на лезвии и т.п.). */
const within = (m: THREE.Matrix4, local: THREE.Matrix4) => m.clone().multiply(local);

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
  // брюшко-мешок с тлеющими кольцами (видно сверху — читается издалека)
  b.add(rock(0.3, 0, 0.15, seed + 1), { matrix: mat(0, 0.02, -0.42, 0.3, 0, 0, 0.9, 0.75, 1.1) });
  for (let i = 0; i < 3; i++) b.add(prism(7, 0.235 - i * 0.045, 0.235 - i * 0.045, 0.025), { matrix: mat(0, 0.04 - i * 0.02, -0.3 - i * 0.13, Math.PI / 2 + 0.3, 0, 0, 1, 1, 0.72), emissive: 1.0 - i * 0.2 });
  // панцирь: три налегающие пластины
  for (let i = 0; i < 3; i++) b.add(rock(0.2, 0, 0.12, seed + 10 + i), { matrix: mat(0, 0.22 - i * 0.03, 0.16 - i * 0.2, -0.25, 0, 0, 1.3, 0.32, 0.85), color: OBS2 });
  const rng = new Rng(seed + 3);
  for (let i = 0; i < 16; i++) {
    const u = rng.next(), v = rng.range(-0.2, 1);
    const a = u * Math.PI * 2, el = Math.asin(v);
    const dx = Math.cos(el) * Math.sin(a), dy = Math.sin(el), dz = Math.cos(el) * Math.cos(a) - 0.3;
    if (dz > 0.6 && dy < 0.3) continue; // лицо свободно
    b.add(shard(rng.range(0.28, 0.5), rng.range(0.05, 0.09), 4, 0.3, i), { matrix: matAlong(dx * 0.3, dy * 0.3, dz * 0.3, dx, dy + 0.2, dz), color: i % 3 === 0 ? BONE : OBS });
  }
  // глаза-ядра: главное и четыре малых, багровые прожилки
  b.add(octa(0.1, 0.08, 0.06), { matrix: mat(0, 0.05, 0.36), emissive: 1.8 });
  for (const [x, y] of [[0.13, 0.1], [-0.13, 0.1], [0.08, 0.17], [-0.08, 0.17]]) b.add(octa(0.045, 0.035, 0.035), { matrix: mat(x, y, 0.31), emissive: 1.3 });
  for (let i = 0; i < 4; i++) b.add(shard(0.3, 0.02, 3, 0.3, i), { matrix: matAlong(0, 0.1, 0.33, rng.spread(1), rng.spread(1), -0.6), emissive: 0.9 });
  b.joint = J('jaw');
  // жвалы: изогнутые костяные клешни + мелкие зубы
  for (const s of [1, -1]) {
    b.add(shard(0.32, 0.055, 3, 0.2, 2), { matrix: matAlong(s * 0.1, 0, 0, s * 0.35, -0.3, 1), color: BONE });
    b.add(shard(0.18, 0.03, 3, 0.2, 3), { matrix: matAlong(s * 0.19, -0.08, 0.26, -s * 0.8, -0.1, 0.5), color: BONE });
    for (let k = 0; k < 3; k++) b.add(shard(0.07, 0.015, 3, 0.1, k), { matrix: matAlong(s * (0.03 + k * 0.03), -0.04, 0.12, 0, -1, 0.2), color: BONE });
  }
  for (let i = 0; i < CRAWLER_LEGS; i++) {
    b.joint = J(`hip${i}`);
    b.add(prism(4, 0.045, 0.06, 0.48), { matrix: matAlong(0, 0, 0, 0, 0.47, 0.88) });
    b.add(shard(0.14, 0.03, 3, 0.2, i + 20), { matrix: matAlong(0, 0.22, 0.4, 0, 1, -0.3), color: OBS2 });
    b.joint = J(`knee${i}`);
    b.add(prism(4, 0.005, 0.05, 0.72), { matrix: matAlong(0, 0, 0, 0, -1, 0.35) });
    b.add(shard(0.12, 0.04, 3, 0.2, i), { matrix: matAlong(0, 0.02, 0, 0, 1, -0.4), emissive: 0 });
    b.add(shard(0.16, 0.022, 3, 0.15, i + 30), { matrix: matAlong(0, -0.62, 0.22, 0, -1, 0.9), color: BONE });
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
  // сегментированное брюшко с тлеющими швами и жалом
  for (let i = 0; i < 4; i++) {
    const z = -0.28 - i * 0.16, y = -0.03 - i * 0.06, r = 0.17 - i * 0.03;
    b.add(bipyramid(6, r, 0.07, 0.1), { matrix: mat(0, y, z, 1.35, 0, 0, 1, 1, 1.25), color: i % 2 ? OBS : OBS2 });
    b.add(prism(6, r * 0.92, r * 0.92, 0.014), { matrix: mat(0, y, z + 0.03, 1.35, 0, 0), emissive: 0.85 });
  }
  b.add(shard(0.42, 0.05, 4, 0.2, seed), { matrix: matAlong(0, -0.24, -0.86, 0, -0.45, -1), color: BONE });
  b.joint = J('torso');
  torso(b, 0.18, 0.3, 0.42, 0.14, 0.18, 0.2, 0, 0.35, 0.68);
  // хитиновые пластины груди и светящиеся рёбра по бокам
  plate(b, [[-0.13, 0], [0.13, 0], [0.11, 0.24], [0, 0.32], [-0.11, 0.24]], 0.03, mat(0, 0.3, 0.1, -0.08, 0, 0), undefined, OBS2);
  plate(b, [[-0.1, 0], [0.1, 0], [0.08, 0.16], [-0.08, 0.16]], 0.03, mat(0, 0.1, 0.09, -0.15, 0, 0), undefined, OBS2);
  for (const sx of [1, -1]) for (let i = 0; i < 3; i++) b.add(box(0.02, 0.015, 0.14), { matrix: mat(sx * (0.15 + i * 0.012), 0.18 + i * 0.1, 0, 0, sx * 0.3, 0), emissive: 1.1 });
  for (const sx of [1, -1]) {
    b.add(shard(0.45, 0.06, 4, 0.2, 3), { matrix: matAlong(sx * 0.18, 0.62, -0.05, sx * 0.5, 1, -0.6), color: BONE });
    b.add(shard(0.28, 0.04, 4, 0.2, 6), { matrix: matAlong(sx * 0.2, 0.5, -0.08, sx * 0.9, 0.6, -0.5) });
  }
  b.add(shard(0.3, 0.02, 3, 0.3, 4), { matrix: matAlong(0.05, 0.2, 0.1, -0.2, 1, 0.3), emissive: 0.9 });
  b.add(shard(0.25, 0.02, 3, 0.3, 5), { matrix: matAlong(-0.05, 0.4, 0.11, 0.3, 1, 0.2), emissive: 0.8 });
  b.joint = J('head');
  b.add(bipyramid(4, 0.12, 0.08, 0.2), { matrix: mat(0, 0.05, 0.08, -1.1, Math.PI / 4, 0, 1, 1.3, 1) });
  b.add(box(0.16, 0.025, 0.04), { matrix: mat(0, 0.08, 0.18, -0.3), emissive: 1.8 });
  // гребень-рога, откинутые назад, и жвалы
  b.add(shard(0.5, 0.045, 3, 0.2, 7), { matrix: matAlong(0.05, 0.1, 0, 0.35, 0.5, -1), color: BONE });
  b.add(shard(0.5, 0.045, 3, 0.2, 8), { matrix: matAlong(-0.05, 0.1, 0, -0.35, 0.5, -1), color: BONE });
  b.add(shard(0.3, 0.03, 3, 0.2, 12), { matrix: matAlong(0, 0.14, -0.02, 0, 1, -0.9) });
  for (const sx of [1, -1]) b.add(shard(0.14, 0.022, 3, 0.15, 13), { matrix: matAlong(sx * 0.05, -0.02, 0.2, -sx * 0.4, -0.6, 1), color: BONE });
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    b.joint = J('arm' + side);
    limb(b, 0.5, 0.06, 0.05, 4);
    b.add(shard(0.18, 0.03, 3, 0.2, 14), { matrix: matAlong(0, -0.42, -0.04, 0, 0.4, -1) });
    b.joint = J('scy' + side);
    // коса: длинное изогнутое лезвие вперёд-вниз, светящаяся кромка и костяные зубья по внутреннему краю
    const m = mat(0, 0, 0, 0, Math.PI / 2 + s * 0.2, 0);
    plate(b, [[0, 0.05], [0.06, -0.05], [0.07, -0.4], [0.02, -0.85], [-0.04, -1.05], [-0.02, -0.7], [-0.04, -0.3], [-0.05, 0]], 0.04, m);
    plate(b, [[0.07, -0.1], [0.085, -0.4], [0.035, -0.85], [-0.035, -1.06], [0.02, -0.82], [0.055, -0.4], [0.05, -0.1]], 0.046, m, 1.3);
    for (let k = 0; k < 5; k++) {
      const y = -0.12 - k * 0.13;
      b.add(shard(0.07, 0.014, 3, 0.1, k), { matrix: within(m, matAlong(-0.045 - k * 0.002, y, 0, -1, -0.5, 0)), color: BONE });
    }
    plate(b, [[-0.05, 0.08], [0.08, 0.08], [0.1, -0.06], [-0.07, -0.06]], 0.07, m, undefined, OBS2);
  }
  for (const leg of ['FL', 'FR', 'BL', 'BR']) {
    b.joint = J('leg' + leg);
    b.add(prism(4, 0.04, 0.06, 0.5), { matrix: matAlong(0, 0, 0, 0, 0.37, 0.93) });
    b.add(shard(0.12, 0.025, 3, 0.2, 16), { matrix: matAlong(0, 0.17, 0.44, 0, 1, 0.2), color: OBS2 });
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
  // свисающие щупальца-цепи: звенья-кристаллы, к концу — кость
  for (let t = 0; t < 4; t++) {
    const a = (t / 4) * Math.PI * 2 + 0.4;
    let x = Math.sin(a) * 0.18, z = Math.cos(a) * 0.12 - 0.12, y = -0.3;
    for (let k = 0; k < 5; k++) {
      b.add(octa(0.045 - k * 0.006, 0.07, 0.045 - k * 0.006), { matrix: mat(x, y, z, 0, a, 0), color: k >= 3 ? BONE : OBS2, emissive: k === 1 ? 0.7 : 0 });
      y -= 0.12; x *= 1.08; z -= 0.035;
    }
    b.add(shard(0.14, 0.02, 3, 0.1, t), { matrix: matAlong(x, y + 0.04, z, 0, -1, -0.2), color: BONE });
  }
  b.joint = J('iris');
  b.add(prism(8, 0.22, 0.2, 0.06), { matrix: mat(0, 0, 0.2, Math.PI / 2, 0, 0), emissive: 1.0 });
  b.add(prism(6, 0.1, 0.08, 0.08), { matrix: mat(0, 0, 0.24, Math.PI / 2, 0, 0), emissive: 1.9 });
  // зрачок-щель и костяные «ресницы» вокруг радужки
  b.add(box(0.035, 0.17, 0.02), { matrix: mat(0, 0, 0.325), color: [0, 0, 0], shade: 0 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(shard(0.13, 0.02, 3, 0.15, i), { matrix: matAlong(Math.sin(a) * 0.24, Math.cos(a) * 0.24, 0.2, Math.sin(a), Math.cos(a), 0.5), color: BONE });
  }
  b.joint = J('ring');
  const rng = new Rng(seed + 9);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.add(shard(rng.range(0.35, 0.6), 0.07, 4, 0.25, i), { matrix: matAlong(Math.sin(a) * 0.5, Math.cos(a) * 0.5, -0.15, Math.sin(a), Math.cos(a), -0.2) });
  }
  b.add(new THREE.TorusGeometry(0.5, 0.03, 3, 18), { matrix: mat(0, 0, -0.15), emissive: 0.5 });
  // бронзовый гироскоп вокруг ядра
  b.add(new THREE.TorusGeometry(0.62, 0.022, 4, 24), { matrix: mat(0, 0, -0.05, 1.15, 0, 0), color: BRONZE });
  b.add(new THREE.TorusGeometry(0.68, 0.02, 4, 24), { matrix: mat(0, 0, -0.05, 0, 1.2, 0.3), color: BRONZE });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.add(octa(0.04, 0.04, 0.04), { matrix: mat(Math.sin(a) * 0.62, Math.cos(a) * 0.62 * Math.cos(1.15), -0.05 + Math.cos(a) * 0.62 * Math.sin(1.15)), emissive: 1.4 });
  }
  for (let i = 0; i < 4; i++) {
    b.joint = J(`petal${i}`);
    // лепесток-веко: изогнутая пластина, раскрывается при выстреле
    plate(b, [[-0.22, 0], [0.22, 0], [0.16, 0.38], [0, 0.48], [-0.16, 0.38]], 0.05, mat(0, 0.02, 0.25, 0.9, 0, 0));
    plate(b, [[-0.14, 0.05], [0.14, 0.05], [0.1, 0.3], [0, 0.38], [-0.1, 0.3]], 0.02, mat(0, 0.03, 0.29, 0.9, 0, 0), undefined, OBS2);
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
  // рваный край рясы и бронзовая кайма
  const rng = new Rng(seed);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.add(shard(rng.range(0.25, 0.45), 0.1, 3, 0.3, i), { matrix: matAlong(Math.sin(a) * 0.48, 0.05, Math.cos(a) * 0.48, Math.sin(a) * 0.2, -1, Math.cos(a) * 0.2) });
  }
  b.add(prism(7, 0.53, 0.5, 0.06, true), { matrix: mat(0, 0.12, 0, 0, 0.2, 0), color: BRONZE });
  // багровое полотно спереди с тлеющим швом
  plate(b, [[-0.17, 0], [0.17, 0], [0.12, 1.05], [-0.12, 1.05]], 0.02, mat(0, 0.12, 0.36, -0.12, 0, 0), undefined, CLOTH);
  b.add(box(0.05, 0.9, 0.02), { matrix: mat(0, 0.75, 0.38, -0.12), emissive: 0.7 });
  for (let i = 0; i < 3; i++) b.add(octa(0.035, 0.05, 0.02), { matrix: mat(0, 0.45 + i * 0.25, 0.4 - i * 0.03), color: BRONZE });
  b.joint = J('chest');
  b.add(prism(6, 0.3, 0.2, 0.25), { matrix: mat(0, -0.05, 0) });
  // мантия на плечах и знак-колокол на груди
  b.add(lathe([[0.4, -0.42], [0.37, -0.2], [0.3, 0.02], [0.17, 0.14], [0.0, 0.16]], 7, 0.2), { matrix: mat(0, 0.0, -0.02), color: OBS2 });
  plate(b, [[0, 0.12], [0.07, 0.06], [0.08, -0.06], [0.11, -0.1], [-0.11, -0.1], [-0.08, -0.06], [-0.07, 0.06]], 0.02, mat(0, 0.0, 0.29, -0.1, 0, 0), 1.4);
  b.joint = J('head');
  const hood = lathe([[0.2, 0], [0.22, 0.15], [0.16, 0.36], [0.0, 0.5]], 6);
  b.add(hood, { matrix: mat(0, -0.12, -0.02, -0.25) });
  // костяная маска с прорезями глаз и митра из трёх шипов
  plate(b, [[-0.09, 0.08], [0.09, 0.08], [0.1, -0.02], [0.05, -0.12], [0, -0.15], [-0.05, -0.12], [-0.1, -0.02]], 0.03, mat(0, 0.0, 0.15, -0.25, 0, 0), undefined, BONE);
  b.add(box(0.035, 0.02, 0.04), { matrix: mat(0.045, 0.04, 0.17), emissive: 1.9 });
  b.add(box(0.035, 0.02, 0.04), { matrix: mat(-0.045, 0.04, 0.17), emissive: 1.9 });
  b.add(shard(0.42, 0.05, 4, 0.15, 1), { matrix: matAlong(0, 0.3, -0.08, 0, 1, -0.25), color: OBS2 });
  b.add(shard(0.28, 0.04, 4, 0.15, 2), { matrix: matAlong(0.08, 0.26, -0.08, 0.35, 1, -0.3), color: OBS2 });
  b.add(shard(0.28, 0.04, 4, 0.15, 3), { matrix: matAlong(-0.08, 0.26, -0.08, -0.35, 1, -0.3), color: OBS2 });
  b.joint = J('halo');
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add(shard(0.22, 0.03, 3, 0.2, i), { matrix: matAlong(Math.sin(a) * 0.32, Math.cos(a) * 0.32, 0, Math.sin(a), Math.cos(a), 0), emissive: i % 2 ? 0.8 : 0, color: i % 2 ? OBS : BONE });
  }
  b.add(new THREE.TorusGeometry(0.3, 0.02, 3, 16), { emissive: 1.2 });
  b.add(new THREE.TorusGeometry(0.4, 0.012, 3, 20), { color: BRONZE });
  for (const side of ['L', 'R'] as const) {
    b.joint = J('arm' + side);
    limb(b, 0.5, 0.07, 0.09, 5);
    b.add(prism(5, 0.1, 0.12, 0.12), { matrix: mat(0, -0.5, 0), color: OBS2 });
    b.joint = J('hand' + side);
    b.add(octa(0.05, 0.08, 0.05), { matrix: mat(0, -0.04, 0), color: BONE });
  }
  // левая рука: кадило на цепи с углём
  b.joint = J('handL');
  for (let k = 0; k < 3; k++) b.add(octa(0.02, 0.04, 0.02), { matrix: mat(0, -0.1 - k * 0.07, 0), color: BRONZE });
  b.add(lathe([[0.0, 0], [0.09, 0.03], [0.1, 0.1], [0.06, 0.16], [0.0, 0.2]], 6), { matrix: mat(0, -0.52, 0), color: BRONZE });
  b.add(octa(0.05, 0.05, 0.05), { matrix: mat(0, -0.42, 0), emissive: 1.8 });
  // правая: посох с перекладиной и колокольцем
  b.joint = J('handR');
  b.add(prism(4, 0.025, 0.025, 1.6), { matrix: mat(0, -0.8, 0) });
  b.add(box(0.32, 0.03, 0.03), { matrix: mat(0, 0.72, 0), color: BRONZE });
  b.add(lathe([[0.0, 0], [0.07, 0.0], [0.06, 0.08], [0.03, 0.14], [0.0, 0.15]], 6), { matrix: mat(0, 0.6, 0, Math.PI, 0, 0), color: BRONZE });
  b.add(octa(0.1, 0.16, 0.1), { matrix: mat(0, 0.92, 0), emissive: 1.5 });
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
  const guardian = !!(opts.halberd || opts.bell);
  b.joint = J('pelvis');
  hull8(b, 0.8 * s, 0.6 * s, -0.25 * s, 0.9 * s, 0.65 * s, 0.25 * s);
  // пояс: бронзовый обод с глыбами-заклёпками
  b.add(prism(8, 0.52 * s, 0.52 * s, 0.1 * s, true), { matrix: mat(0, 0.1 * s, 0), color: BRONZE });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(octa(0.06 * s, 0.07 * s, 0.05 * s), { matrix: mat(Math.sin(a) * 0.53 * s, 0.15 * s, Math.cos(a) * 0.53 * s, 0, a, 0), color: BRONZE }); }
  b.joint = J('spine');
  hull8(b, 0.8 * s, 0.6 * s, 0, 1.1 * s, 0.75 * s, 0.45 * s);
  b.joint = J('chest');
  torso(b, 1.1 * s, 1.5 * s, 1.7 * s, 0.75 * s, 0.9 * s, 0.85 * s, 0, 0.35 * s, 0.6 * s);
  boulders(b, rng, 10, 0, 0.45 * s, -0.15 * s, 0.8 * s, 0.25 * s, 0.4 * s, 0.32 * s);
  // грудные плиты (светлее) — между ними горнило
  for (const sx of [1, -1]) plate(b, [[0, 0], [0.55, 0.05], [0.6, 0.4], [0.3, 0.55], [0.05, 0.42]], 0.12 * s, mat(sx * 0.08 * s, 0.05 * s, 0.4 * s, -0.1, sx > 0 ? 0.15 : Math.PI - 0.15, 0, s), undefined, OBS2);
  // гребень спины: кристаллы с тлеющим основанием
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.22 * s, h = (0.75 - Math.abs(i - 2) * 0.17) * s;
    b.add(shard(h, 0.11 * s, 4, 0.2, i + 40), { matrix: matAlong(x, 0.55 * s, -0.42 * s, x * 0.6, 1, -0.55), color: i % 2 ? OBS2 : OBS });
    b.add(octa(0.07 * s, 0.05 * s, 0.07 * s), { matrix: mat(x, 0.55 * s, -0.42 * s), emissive: 1.1 });
  }
  // ядро в груди: светящаяся трещина-горнило и сеть прожилок
  b.add(octa(0.16 * s, 0.24 * s, 0.1 * s), { matrix: mat(0, 0.25 * s, 0.42 * s), emissive: 1.8 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    b.add(shard((0.35 + rng.next() * 0.25) * s, 0.03 * s, 3, 0.3, i), { matrix: matAlong(0, 0.25 * s, 0.43 * s, Math.cos(a), Math.sin(a), 0.1), emissive: 1.0 });
  }
  b.joint = J('head');
  b.add(rock(0.24 * s, 0, 0.25, seed), { matrix: mat(0, 0, 0, 0, 0, 0, 1.1, 0.8, 1) });
  b.add(box(0.26 * s, 0.04 * s, 0.05 * s), { matrix: mat(0, 0.0, 0.2 * s), emissive: 1.8 });
  // челюсть-забрало и рога
  b.add(box(0.3 * s, 0.1 * s, 0.12 * s), { matrix: mat(0, -0.14 * s, 0.14 * s, 0.2, 0, 0), color: OBS2 });
  for (const sx of [1, -1]) {
    b.add(shard(0.42 * s, 0.07 * s, 4, 0.2, 50), { matrix: matAlong(sx * 0.18 * s, 0.08 * s, -0.02 * s, sx * 0.9, 0.7, -0.3), color: BONE });
    b.add(shard(0.2 * s, 0.05 * s, 4, 0.2, 51), { matrix: matAlong(sx * 0.42 * s, 0.38 * s, -0.12 * s, sx * 0.1, 1, 0.3), color: BONE });
  }
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.joint = J('sh' + side);
    boulders(b, rng, 5, sx * 0.05 * s, 0.05 * s, 0, 0.32 * s, 0.25 * s, 0.32 * s, 0.3 * s);
    b.add(shard(0.7 * s, 0.14 * s, 4, 0.25, 3), { matrix: matAlong(sx * 0.1 * s, 0.25 * s, -0.05 * s, sx * 0.4, 1, -0.3) });
    limb(b, 0.65 * s, 0.24 * s, 0.2 * s, 6);
    b.add(shard(0.3 * s, 0.025 * s, 3, 0.3, 5), { matrix: matAlong(sx * 0.12 * s, -0.25 * s, 0.15 * s, 0.1, -1, 0.3), emissive: 0.9 });
    b.joint = J('elb' + side);
    limb(b, 0.6 * s, 0.22 * s, 0.26 * s, 6);
    // наруч: бронзовые кольца
    for (let k = 0; k < 2; k++) b.add(prism(6, 0.27 * s, 0.27 * s, 0.06 * s, true), { matrix: mat(0, (-0.3 - k * 0.15) * s, 0), color: BRONZE });
    b.add(shard(0.25 * s, 0.03 * s, 3, 0.3, 4), { matrix: matAlong(0, -0.3 * s, 0.22 * s, 0, -1, 0.2), emissive: 0.9 });
    b.joint = J('hand' + side);
    b.add(rock(0.36 * s, 0, 0.2, rng.int(0, 99)), { matrix: mat(0, -0.25 * s, 0, 0, 0, 0, 1, 1.1, 1) });
    // костяные шипы на костяшках
    for (let k = -1; k <= 1; k++) b.add(shard(0.22 * s, 0.05 * s, 3, 0.2, 60 + k), { matrix: matAlong(k * 0.13 * s, -0.3 * s, 0.28 * s, k * 0.2, -0.2, 1), color: BONE });
    b.joint = J('hip' + side);
    limb(b, 0.55 * s, 0.26 * s, 0.22 * s, 6);
    b.joint = J('knee' + side);
    limb(b, 0.55 * s, 0.22 * s, 0.26 * s, 6);
    b.add(rock(0.17 * s, 0, 0.2, 70), { matrix: mat(0, 0, 0.16 * s, 0, 0, 0, 1, 1, 0.8), color: OBS2 });
    b.joint = J('foot' + side);
    hull8(b, 0.4 * s, 0.6 * s, -0.05 * s, 0.32 * s, 0.4 * s, 0.15 * s, 0.05 * s, 0.1 * s);
  }
  if (guardian) {
    // стражи: наплечники из плит с бронзовой окантовкой и табард
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      b.joint = J('sh' + side);
      b.add(lathe([[0.42, -0.2], [0.4, 0.0], [0.3, 0.18], [0.0, 0.26]], 7), { matrix: mat(sx * 0.08 * s, 0.12 * s, 0, 0, 0, -sx * 0.35, s), color: OBS2 });
      b.add(prism(7, 0.43 * s, 0.43 * s, 0.05 * s, true), { matrix: mat(sx * 0.08 * s, -0.08 * s, 0, 0, 0, -sx * 0.35), color: BRONZE });
    }
    b.joint = J('pelvis');
    plate(b, [[-0.3, 0], [0.3, 0], [0.26, -0.9], [0, -1.05], [-0.26, -0.9]], 0.04 * s, mat(0, 0.08 * s, 0.36 * s, 0.05, 0, 0, s), undefined, CLOTH);
    plate(b, [[-0.06, 0], [0.06, 0], [0.04, -0.8], [-0.04, -0.8]], 0.05 * s, mat(0, 0.0, 0.38 * s, 0.05, 0, 0, s), 1.0);
    plate(b, [[-0.28, 0], [0.28, 0], [0.24, -0.75], [-0.24, -0.75]], 0.04 * s, mat(0, 0.08 * s, -0.34 * s, -0.05, 0, 0, s), undefined, CLOTH);
  }
  if (opts.halberd) {
    // Страж Врат: алебарда в правой руке — древко с бронзовыми кольцами, лезвие-полумесяц, шип и клевец
    b.joint = J('handR');
    b.add(prism(6, 0.06 * s, 0.06 * s, 3.4 * s), { matrix: mat(0, -0.25 * s, -1.5 * s, Math.PI / 2, 0, 0), color: OBS2 });
    for (const z of [-1.4, -0.4, 0.6, 1.5]) b.add(prism(6, 0.085 * s, 0.085 * s, 0.08 * s), { matrix: mat(0, -0.25 * s, z * s, Math.PI / 2, 0, 0), color: BRONZE });
    plate(b, [[0, 0], [0.75, 0.25], [0.95, 0.75], [0.55, 0.5], [0.1, 0.55]], 0.06 * s, mat(0, -0.25 * s, 1.75 * s, 0, Math.PI / 2, 0, s));
    plate(b, [[0.1, 0.05], [0.72, 0.28], [0.88, 0.68], [0.55, 0.45]], 0.07 * s, mat(0, -0.25 * s, 1.75 * s, 0, Math.PI / 2, 0, s), 1.2);
    plate(b, [[0, 0], [-0.35, 0.12], [-0.42, 0.3], [-0.1, 0.22]], 0.06 * s, mat(0, -0.25 * s, 1.75 * s, 0, Math.PI / 2, 0, s), undefined, BRONZE);
    b.add(prism(4, 0.08 * s, 0, 0.7 * s), { matrix: mat(0, -0.25 * s, 1.9 * s, Math.PI / 2, 0, 0) });
    b.add(shard(0.4 * s, 0.05 * s, 4, 0.1, 80), { matrix: matAlong(0, -0.25 * s, -3.1 * s, 0, 0, -1), color: BRONZE });
    b.joint = J('head');
    b.add(shard(0.9 * s, 0.14 * s, 4, 0.2, 9), { matrix: matAlong(0.15 * s, 0.1 * s, -0.1 * s, 0.4, 1, -0.4) });
    b.add(shard(0.9 * s, 0.14 * s, 4, 0.2, 10), { matrix: matAlong(-0.15 * s, 0.1 * s, -0.1 * s, -0.4, 1, -0.4) });
    // гребень шлема: вертикальный плавник с тлеющей кромкой
    plate(b, [[0, 0], [0.06, 0.35], [-0.05, 0.62], [-0.22, 0.5], [-0.3, 0.1]], 0.04 * s, mat(0, 0.16 * s, 0.05 * s, 0, Math.PI / 2, 0, s), undefined, OBS2);
    plate(b, [[0.02, 0.05], [0.07, 0.35], [-0.03, 0.6], [0.0, 0.34]], 0.05 * s, mat(0, 0.16 * s, 0.05 * s, 0, Math.PI / 2, 0, s), 1.1);
  }
  if (opts.bell) {
    // Звонарь: бронзовый колокол на спине на цепях, капюшон, молот-язык в руке
    b.joint = J('chest');
    const bell = lathe([[0.05, 0], [0.9, 0.12], [0.8, 0.5], [0.55, 1.2], [0.5, 1.55], [0.25, 1.75], [0, 1.8]], 12);
    bell.scale(s, s, s);
    b.add(bell, { matrix: mat(0, 0.3 * s, -0.9 * s, 0.35, 0, 0), color: BRONZE });
    b.add(prism(12, 0.85 * s, 0.85 * s, 0.05 * s), { matrix: mat(0, 0.36 * s, -0.95 * s, 0.35, 0, 0), emissive: 0.8 });
    for (const y of [0.55, 1.0]) b.add(prism(12, (0.83 - y * 0.25) * s, (0.83 - y * 0.25) * s, 0.06 * s, true), { matrix: mat(0, (0.3 + y * 0.94) * s, (-0.9 - y * 0.34) * s, 0.35, 0, 0), color: OBS2 });
    for (const sx of [1, -1]) for (let k = 0; k < 6; k++) {
      const u = k / 5;
      b.add(new THREE.TorusGeometry(0.07 * s, 0.02 * s, 3, 6), { matrix: mat(sx * (0.6 - u * 0.25) * s, (0.9 - u * 0.1) * s, (0.35 - u * 0.95) * s, 0, k % 2 ? Math.PI / 2 : 0, 0), color: BRONZE });
    }
    b.joint = J('head');
    b.add(lathe([[0.36, -0.2], [0.34, 0.1], [0.24, 0.32], [0.08, 0.42], [0.0, 0.44]], 7), { matrix: mat(0, 0.02 * s, -0.06 * s, -0.25, 0, 0, s), color: CLOTH });
    b.joint = J('handR');
    b.add(prism(6, 0.06 * s, 0.06 * s, 1.5 * s), { matrix: mat(0, -1.6 * s, 0), color: OBS2 });
    b.add(rock(0.38 * s, 1, 0.1, 5), { matrix: mat(0, -1.7 * s, 0, 0, 0, 0, 1, 1.3, 1), color: BRONZE });
    b.add(prism(8, 0.3 * s, 0.3 * s, 0.08 * s, true), { matrix: mat(0, -1.55 * s, 0), color: OBS2 });
    b.add(octa(0.12 * s, 0.12 * s, 0.12 * s), { matrix: mat(0, -1.7 * s, 0.34 * s), emissive: 1.4 });
  }
  return { rig, geometry: b.build() };
}

// ------------------------------------------------------------------ Шелуха (рой)
/** Шелуха: сгорбленный обсидиановый упырь, ~1.4 м, длинные руки с когтями — пушечное мясо роя. */
export function huskRig(): RigDef {
  return {
    id: 'husk',
    joints: [
      { name: 'root', pos: [0, 0, 0] },
      { name: 'pelvis', parent: 'root', pos: [0, 0.72, 0] },
      { name: 'spine', parent: 'pelvis', pos: [0, 0.16, 0], rot: [0.35, 0, 0] },
      { name: 'chest', parent: 'spine', pos: [0, 0.24, 0.02], rot: [0.2, 0, 0] },
      { name: 'head', parent: 'chest', pos: [0, 0.22, 0.1], rot: [-0.45, 0, 0] },
      { name: 'shL', parent: 'chest', pos: [0.17, 0.16, 0] },
      { name: 'elbL', parent: 'shL', pos: [0, -0.3, 0] },
      { name: 'handL', parent: 'elbL', pos: [0, -0.3, 0] },
      { name: 'shR', parent: 'chest', pos: [-0.17, 0.16, 0] },
      { name: 'elbR', parent: 'shR', pos: [0, -0.3, 0] },
      { name: 'handR', parent: 'elbR', pos: [0, -0.3, 0] },
      { name: 'hipL', parent: 'pelvis', pos: [0.09, -0.03, 0] },
      { name: 'kneeL', parent: 'hipL', pos: [0, -0.36, 0] },
      { name: 'footL', parent: 'kneeL', pos: [0, -0.34, 0] },
      { name: 'hipR', parent: 'pelvis', pos: [-0.09, -0.03, 0] },
      { name: 'kneeR', parent: 'hipR', pos: [0, -0.36, 0] },
      { name: 'footR', parent: 'kneeR', pos: [0, -0.34, 0] },
    ],
  };
}

export function buildHusk(seed = 6): RigBuild {
  const rig = huskRig(); const J = jidx(rig);
  const b = new GeomBuilder(); const rng = new Rng(seed); b.rng = rng; b.color = OBS;
  b.joint = J('pelvis');
  hull8(b, 0.2, 0.14, -0.06, 0.22, 0.15, 0.08);
  b.joint = J('spine');
  hull8(b, 0.18, 0.13, 0, 0.24, 0.16, 0.22);
  // позвоночник-гребень
  for (let i = 0; i < 4; i++) b.add(shard(0.14 + i * 0.02, 0.025, 3, 0.2, i), { matrix: matAlong(0, 0.04 + i * 0.06, -0.08, 0, 0.5, -1), color: BONE });
  b.joint = J('chest');
  torso(b, 0.24, 0.32, 0.3, 0.16, 0.2, 0.17, -0.02, 0.1, 0.2);
  // рёбра-осколки и тлеющая трещина
  for (const sx of [1, -1]) for (let i = 0; i < 3; i++) b.add(shard(0.16, 0.018, 3, 0.2, i + (sx > 0 ? 0 : 5)), { matrix: matAlong(sx * 0.06, 0.02 + i * 0.06, 0.1, sx, -0.2, 0.6) });
  b.add(shard(0.22, 0.02, 3, 0.3, 4), { matrix: matAlong(0.02, 0.0, 0.1, -0.2, 1, 0.1), emissive: 1.2 });
  b.joint = J('head');
  b.add(bipyramid(5, 0.1, 0.12, 0.16), { matrix: mat(0, 0.06, 0.05, 1.2, 0, 0, 1, 1, 0.9) });
  b.add(shard(0.18, 0.03, 3, 0.2, 9), { matrix: matAlong(0.05, 0.1, -0.02, 0.4, 0.8, -0.6), color: BONE });
  b.add(shard(0.18, 0.03, 3, 0.2, 10), { matrix: matAlong(-0.05, 0.1, -0.02, -0.4, 0.8, -0.6), color: BONE });
  b.add(octa(0.025, 0.012, 0.02), { matrix: mat(0.04, 0.08, 0.13), emissive: 2.0 });
  b.add(octa(0.025, 0.012, 0.02), { matrix: mat(-0.04, 0.08, 0.13), emissive: 2.0 });
  // челюсть-клюв
  b.add(shard(0.12, 0.04, 3, 0.2, 11), { matrix: matAlong(0, 0.0, 0.12, 0, -0.6, 1) });
  for (const side of ['L', 'R'] as const) {
    b.joint = J('sh' + side);
    limb(b, 0.3, 0.045, 0.035, 4);
    b.joint = J('elb' + side);
    limb(b, 0.3, 0.035, 0.03, 4);
    b.joint = J('hand' + side);
    for (let k = -1; k <= 1; k++) b.add(shard(0.2, 0.018, 3, 0.15, k + 3), { matrix: matAlong(k * 0.03, -0.02, 0.01, k * 0.25, -1, 0.35), emissive: k === 0 ? 0.6 : 0, color: BONE });
    b.joint = J('hip' + side);
    limb(b, 0.36, 0.06, 0.045, 4);
    b.joint = J('knee' + side);
    limb(b, 0.34, 0.045, 0.03, 4);
    b.joint = J('foot' + side);
    b.add(shard(0.16, 0.035, 3, 0.2, 7), { matrix: matAlong(0, -0.02, 0, 0, 0, 1) });
  }
  return { rig, geometry: b.build() };
}
