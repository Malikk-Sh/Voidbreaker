import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import type { RigDef } from '../../anim/skeleton';
import { GeomBuilder, mat, type RGB } from '../geom/build';
import { bipyramid, box, lathe, octa, prism, shard } from '../geom/prims';
import { hull8, limb, plate, torso } from './parts';

/**
 * Пилот (GDD §15.3): шарнирная кукла из граней. Рыцарский шлем с щелью визора и гребнем, многослойные наплечники,
 * сегментированная кираса со шрамом-трещиной, пояс с набедренниками, наручи, латные перчатки, наколенники и поножи.
 * Клинок — прямой полуторный меч из обломка обшивки: гарда-крылья, обмотанная рукоять, навершие.
 * Правая сторона героя — это −X (герой смотрит в +Z).
 */
export const HERO_RIG: RigDef = {
  id: 'hero',
  joints: [
    { name: 'root', pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: [0, 0.95, 0] },
    { name: 'spine', parent: 'pelvis', pos: [0, 0.2, 0] },
    { name: 'chest', parent: 'spine', pos: [0, 0.28, 0] },
    { name: 'neck', parent: 'chest', pos: [0, 0.3, 0.01] },
    { name: 'head', parent: 'neck', pos: [0, 0.09, 0] },
    { name: 'shL', parent: 'chest', pos: [0.25, 0.22, 0] },
    { name: 'elbL', parent: 'shL', pos: [0, -0.3, 0] },
    { name: 'handL', parent: 'elbL', pos: [0, -0.27, 0] },
    { name: 'shR', parent: 'chest', pos: [-0.25, 0.22, 0] },
    { name: 'elbR', parent: 'shR', pos: [0, -0.3, 0] },
    { name: 'handR', parent: 'elbR', pos: [0, -0.27, 0] },
    // рукоять зажата в кулаке чуть впереди запястья; кисть слегка «взведена» вперёд
    { name: 'blade', parent: 'handR', pos: [0, -0.07, 0.03], rot: [-0.12, 0, 0] },
    { name: 'hipL', parent: 'pelvis', pos: [0.11, -0.04, 0] },
    { name: 'kneeL', parent: 'hipL', pos: [0, -0.45, 0] },
    { name: 'footL', parent: 'kneeL', pos: [0, -0.44, 0] },
    { name: 'hipR', parent: 'pelvis', pos: [-0.11, -0.04, 0] },
    { name: 'kneeR', parent: 'hipR', pos: [0, -0.45, 0] },
    { name: 'footR', parent: 'kneeR', pos: [0, -0.44, 0] },
    { name: 'kaelis', parent: 'root', pos: [0.6, 2.05, -0.25] },
  ],
};

export const BLADE_LEN = 1.3;

export interface HeroLook {
  armor: string;
  trim: string;
  dark: string;
}

export const HERO_DEFAULT: HeroLook = { armor: '#1d2533', trim: '#9a7838', dark: '#0f141c' };

/**
 * Меч: навершие, обмотанная рукоять (в кулаке), гарда с крыльями и камнем, прямой обоюдоострый клинок вдоль −Y
 * с центральным ребром, светящимися кромками и жилой Пустоты в доле.
 */
export function bladeParts(b: GeomBuilder, len: number, _curve: number, armor: RGB, scale = 1): void {
  const L = len * scale;
  const gold = hexToLinear('#9a7838');
  const dark = hexToLinear('#0f141c');
  // навершие и рукоять: рукоять проходит сквозь кулак, навершие торчит над ним
  b.add(bipyramid(4, 0.034, 0.03, 0.03), { matrix: mat(0, 0.14, 0, 0, Math.PI / 4), color: gold });
  b.add(prism(6, 0.022, 0.024, 0.26), { matrix: mat(0, -0.13, 0), color: dark });
  for (const y of [0.08, 0.02, -0.04, -0.1]) b.add(prism(6, 0.027, 0.027, 0.012), { matrix: mat(0, y, 0), color: gold, shade: 0.1 });
  // гарда: крылья, загнутые к клинку, и камень-фокус
  plate(b, [[-0.2, -0.13], [-0.16, -0.17], [-0.05, -0.15], [0, -0.17], [0.05, -0.15], [0.16, -0.17], [0.2, -0.13], [0.06, -0.12], [0, -0.1], [-0.06, -0.12]], 0.05, undefined, 0, gold);
  b.add(octa(0.03, 0.04, 0.032), { matrix: mat(0, -0.14, 0), emissive: 1.6, color: dark });
  // клинок: профиль в плоскости XY, толщина по Z
  const y0 = -0.17, tipY = -L - 0.06;
  const w0 = 0.07, w1 = 0.052;
  const prof: [number, number][] = [[w0, y0], [w1, -L + 0.18], [0, tipY], [-w1, -L + 0.18], [-w0, y0]];
  plate(b, prof, 0.026, undefined, 0, armor);
  // центральное ребро (ромб в сечении)
  b.add(prism(4, 0.012, 0.018, L - 0.2), { matrix: mat(0, tipY + 0.2, 0, 0, Math.PI / 4, 0, 1, 1, 1.4), color: armor, shade: 0.3 });
  // светящиеся кромки — обе стороны
  for (const sx of [1, -1]) {
    plate(b, [[sx * (w0 + 0.006), y0 - 0.02], [sx * (w1 + 0.006), -L + 0.18], [0, tipY - 0.012], [sx * (w1 - 0.012), -L + 0.16], [sx * (w0 - 0.014), y0 - 0.02]], 0.03, undefined, 1.2, armor);
  }
  // дол — жила Пустоты
  plate(b, [[0.011, y0 - 0.04], [0.007, -L * 0.72], [0, -L * 0.75], [-0.007, -L * 0.72], [-0.011, y0 - 0.04]], 0.032, undefined, 0.6, armor);
}

export function buildHeroGeometry(look: HeroLook = HERO_DEFAULT, seed = 7): THREE.BufferGeometry {
  const b = new GeomBuilder();
  b.rng = new Rng(seed);
  b.shade = 0.2;
  const armor = hexToLinear(look.armor);
  const trim = hexToLinear(look.trim);
  const dark = hexToLinear(look.dark);
  const J = (name: string) => HERO_RIG.joints.findIndex((j) => j.name === name);
  b.color = armor;

  // ---------------- таз: пояс с пряжкой, набедренники (тассеты), задняя пластина
  b.joint = J('pelvis');
  hull8(b, 0.3, 0.2, -0.1, 0.34, 0.22, 0.08);
  b.add(prism(8, 0.2, 0.2, 0.05), { matrix: mat(0, 0.04, 0, 0, Math.PI / 8, 0, 1, 1, 0.74), color: dark });
  b.add(prism(8, 0.205, 0.205, 0.012), { matrix: mat(0, 0.09, 0, 0, Math.PI / 8, 0, 1, 1, 0.75), color: trim, shade: 0.1 });
  b.add(octa(0.045, 0.04, 0.02), { matrix: mat(0, 0.065, 0.15), color: trim });
  b.add(octa(0.018, 0.016, 0.01), { matrix: mat(0, 0.065, 0.168), emissive: 1.4, color: dark });
  for (const sx of [1, -1]) {
    // два ряда пластин внахлёст
    for (const [row, ry] of [[0, 0], [1, 0]] as const) {
      const y = 0.0 - row * 0.12;
      plate(b, [[-0.075, 0], [0.075, 0], [0.065, -0.15], [0, -0.18], [-0.065, -0.15]], 0.022, mat(sx * 0.12, y, 0.07, 0.22, sx * 0.55 + ry, 0), 0, row ? armor : dark);
      plate(b, [[-0.08, 0], [0.08, 0], [0.07, -0.14], [-0.07, -0.14]], 0.022, mat(sx * 0.16, y - 0.01, -0.03, 0.12, sx * 1.55, 0), 0, armor);
    }
    b.add(box(0.15, 0.01, 0.012), { matrix: mat(sx * 0.12, -0.155, 0.12, 0.22, sx * 0.55, 0), color: trim });
  }
  plate(b, [[-0.1, 0], [0.1, 0], [0.08, -0.26], [0, -0.3], [-0.08, -0.26]], 0.022, mat(0, 0.0, -0.12, -0.15, Math.PI, 0), 0, dark);

  // ---------------- живот: три сегмента-кольца
  b.joint = J('spine');
  for (let k = 0; k < 3; k++) {
    const y = -0.02 + k * 0.075;
    hull8(b, 0.27 + k * 0.025, 0.18 + k * 0.01, y, 0.29 + k * 0.025, 0.19 + k * 0.01, y + 0.07, 0.005);
  }
  b.add(box(0.012, 0.2, 0.02), { matrix: mat(0, 0.08, 0.1), emissive: 0.7, color: dark });

  // ---------------- грудь: кираса, нагрудные пластины, горжет, шрам, спинной хребет
  b.joint = J('chest');
  torso(b, 0.34, 0.5, 0.52, 0.21, 0.27, 0.24, -0.08, 0.14, 0.3);
  for (const sx of [1, -1]) {
    plate(b, [[0, 0.02], [sx * 0.22, 0.04], [sx * 0.23, -0.08], [sx * 0.12, -0.16], [0, -0.12]], 0.03, mat(0, 0.2, 0.125, -0.12, 0, 0), 0, armor);
    b.add(box(0.2, 0.01, 0.012), { matrix: mat(sx * 0.115, 0.235, 0.14, -0.12, 0, sx * 0.08), color: trim });
  }
  b.add(prism(4, 0.015, 0.015, 0.26), { matrix: mat(0, -0.02, 0.135, -0.1, Math.PI / 4), color: trim });
  // шрам — трещина наискосок через грудь (эмиссия), разгорается с Резонансом (буст инстанса)
  const scar: [number, number, number][] = [[0.15, 0.2, 0.16], [0.08, 0.13, 0.165], [0.03, 0.08, 0.16], [-0.05, 0.02, 0.15]];
  for (let i = 0; i < scar.length - 1; i++) {
    const [x0, y0, z0] = scar[i], [x1, y1, z1] = scar[i + 1];
    const g = shard(Math.hypot(x1 - x0, y1 - y0) * 1.1, 0.016, 4, 0.2, i);
    const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    b.add(g, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(x0, y0, z0), q, new THREE.Vector3(1, 1, 0.6)), emissive: 1.5 });
  }
  // горжет
  b.add(prism(8, 0.15, 0.12, 0.09), { matrix: mat(0, 0.27, 0, 0, Math.PI / 8), color: dark });
  b.add(prism(8, 0.155, 0.155, 0.014), { matrix: mat(0, 0.27, 0, 0, Math.PI / 8), color: trim, shade: 0.1 });
  // спина: хребет-гребень и «ядро» под плащом
  for (let k = 0; k < 4; k++) b.add(bipyramid(4, 0.035, 0.05, 0.02), { matrix: mat(0, 0.24 - k * 0.08, -0.13, -1.3, Math.PI / 4), color: dark });
  // наплечники: три пластины внахлёст + золотая кайма + короткий шип
  for (const sx of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const y = 0.3 - k * 0.07, w = 0.14 - k * 0.012;
      b.add(octa(w, 0.06, 0.14 - k * 0.01), { matrix: mat(sx * (0.27 + k * 0.025), y, 0, 0, 0, sx * (-0.45 - k * 0.15)), color: k === 0 ? armor : dark });
      b.add(prism(6, w * 0.98, w * 0.98, 0.012), { matrix: mat(sx * (0.27 + k * 0.025), y - 0.02, 0, 0, 0, sx * (-0.45 - k * 0.15), 1, 1, 0.95), color: trim, shade: 0.1 });
    }
    b.add(shard(0.2, 0.045, 4, 0.15, 3), { matrix: mat(sx * 0.3, 0.33, -0.03, -0.35, 0, sx * -0.8), color: dark });
  }

  // ---------------- шлем: купол, забрало с щелью визора, нащёчники, гребень, откинутые «рога»-плавники
  b.joint = J('neck');
  b.add(prism(6, 0.065, 0.06, 0.1), { matrix: mat(0, -0.02, 0) });
  b.joint = J('head');
  const dome = lathe([[0.0, 0.0], [0.115, 0.02], [0.135, 0.11], [0.125, 0.2], [0.09, 0.27], [0.0, 0.3]], 8, Math.PI / 8);
  b.add(dome, { matrix: mat(0, 0.0, -0.005, 0, 0, 0, 1, 1, 1.12), color: armor });
  // забрало: клин вперёд
  plate(b, [[-0.12, 0.2], [0.12, 0.2], [0.11, 0.06], [0.04, -0.02], [-0.04, -0.02], [-0.11, 0.06]], 0.05, mat(0, 0.0, 0.11, -0.12, 0, 0), 0, dark);
  b.add(box(0.2, 0.026, 0.03), { matrix: mat(0, 0.135, 0.14, -0.12), emissive: 1.7, color: dark });
  b.add(box(0.24, 0.05, 0.02), { matrix: mat(0, 0.135, 0.128, -0.12), emissive: 0.45, color: dark });
  for (const sx of [1, -1]) {
    plate(b, [[0, 0], [0.06, 0.02], [0.05, -0.1], [0, -0.12]], 0.02, mat(sx * 0.125, 0.12, 0.05, 0, sx * 0.35, 0), 0, armor);
    // откинутые назад плавники
    plate(b, [[0, 0], [0.03, 0.02], [-0.24, 0.12], [-0.16, 0.0]], 0.018, mat(sx * 0.11, 0.2, -0.04, 0, Math.PI / 2, sx * -0.25), 0, trim);
  }
  plate(b, [[0, 0], [0.03, 0.12], [-0.02, 0.08], [-0.24, 0.02], [-0.12, -0.02]], 0.02, mat(0, 0.27, 0.0, 0, Math.PI / 2, 0), 0, trim);

  // ---------------- руки: наплечная труба, налокотник-шип, наруч, латная перчатка
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.joint = J('sh' + side);
    limb(b, 0.3, 0.072, 0.06, 6);
    b.add(prism(6, 0.078, 0.082, 0.14), { matrix: mat(0, -0.2, 0), color: armor });
    b.joint = J('elb' + side);
    b.add(bipyramid(4, 0.07, 0.03, 0.07), { matrix: mat(0, 0.0, -0.04, Math.PI / 2, Math.PI / 4), color: dark });
    b.add(shard(0.1, 0.03, 4, 0.1, 5), { matrix: mat(0, -0.01, -0.07, 2.3, 0, 0), color: trim });
    limb(b, 0.26, 0.058, 0.05, 6);
    b.add(prism(6, 0.072, 0.064, 0.17), { matrix: mat(0, -0.24, 0), color: armor });
    b.add(prism(6, 0.075, 0.075, 0.014), { matrix: mat(0, -0.245, 0), color: trim, shade: 0.1 });
    b.add(prism(6, 0.066, 0.066, 0.012), { matrix: mat(0, -0.095, 0), color: trim, shade: 0.1 });
    b.add(box(0.012, 0.13, 0.016), { matrix: mat(sx * 0.0, -0.17, 0.06), emissive: 0.55, color: dark });
    b.joint = J('hand' + side);
    b.add(octa(0.05, 0.065, 0.055), { matrix: mat(0, -0.035, 0), color: dark });
    b.add(box(0.075, 0.07, 0.07), { matrix: mat(0, -0.075, 0.012), color: armor });
    b.add(box(0.08, 0.02, 0.03), { matrix: mat(0, -0.045, 0.045), color: trim });
  }

  // ---------------- ноги: набедренник, наколенник с шипом, поножи с ребром, латный сапог
  for (const side of ['L', 'R'] as const) {
    b.joint = J('hip' + side);
    limb(b, 0.45, 0.095, 0.072, 6);
    plate(b, [[-0.08, 0], [0.08, 0], [0.07, -0.3], [0, -0.34], [-0.07, -0.3]], 0.025, mat(0, -0.04, 0.085, 0.05, 0, 0), 0, armor);
    b.joint = J('knee' + side);
    b.add(octa(0.07, 0.075, 0.07), { matrix: mat(0, 0, 0.035), color: dark });
    b.add(bipyramid(4, 0.05, 0.11, 0.04), { matrix: mat(0, -0.02, 0.07, -1.25, Math.PI / 4), color: trim });
    limb(b, 0.43, 0.075, 0.052, 6);
    b.add(prism(6, 0.066, 0.083, 0.3), { matrix: mat(0, -0.38, 0.008), color: armor });
    b.add(shard(0.28, 0.03, 4, 0.1, 2), { matrix: mat(0, -0.38, 0.075), color: dark });
    b.add(prism(6, 0.068, 0.068, 0.012), { matrix: mat(0, -0.385, 0.008), color: trim, shade: 0.1 });
    b.joint = J('foot' + side);
    hull8(b, 0.12, 0.25, -0.02, 0.09, 0.16, 0.07, 0.02, 0.05);
    b.add(prism(4, 0.045, 0, 0.14), { matrix: mat(0, 0.0, 0.18, Math.PI / 2, Math.PI / 4, 0), color: dark });
    b.add(box(0.13, 0.012, 0.02), { matrix: mat(0, 0.06, 0.06), color: trim });
  }

  // ---------------- клинок
  b.joint = J('blade');
  bladeParts(b, BLADE_LEN, 0, armor);

  // ---------------- Каэлис — гранёный ромб-дрон с золотым кольцом у плеча
  b.joint = J('kaelis');
  b.add(octa(0.085, 0.14, 0.085), { emissive: 0.75, color: armor });
  b.add(octa(0.04, 0.07, 0.04), { emissive: 1.9, color: armor });
  b.add(new THREE.TorusGeometry(0.12, 0.008, 3, 12), { matrix: mat(0, 0, 0, Math.PI / 2, 0, 0), color: trim });

  return b.build();
}
