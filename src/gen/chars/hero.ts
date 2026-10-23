import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import type { RigDef } from '../../anim/skeleton';
import { GeomBuilder, mat, SURF, type RGB } from '../geom/build';
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
  b.add(bipyramid(4, 0.034, 0.03, 0.03), { matrix: mat(0, 0.14, 0, 0, Math.PI / 4), color: gold, surface: SURF.metal });
  b.add(prism(6, 0.022, 0.024, 0.26), { matrix: mat(0, -0.13, 0), color: dark });
  for (const y of [0.08, 0.02, -0.04, -0.1]) b.add(prism(6, 0.027, 0.027, 0.012), { matrix: mat(0, y, 0), color: gold, shade: 0.1, surface: SURF.metal });
  // гарда: крылья, загнутые к клинку, и камень-фокус
  const prevSurf = b.surface;
  b.surface = SURF.metal;
  plate(b, [[-0.2, -0.13], [-0.16, -0.17], [-0.05, -0.15], [0, -0.17], [0.05, -0.15], [0.16, -0.17], [0.2, -0.13], [0.06, -0.12], [0, -0.1], [-0.06, -0.12]], 0.05, undefined, 0, gold);
  b.surface = prevSurf;
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
  b.shade = 0.14;
  const armor = hexToLinear(look.armor);
  const trim = hexToLinear(look.trim);
  const dark = hexToLinear(look.dark);
  const J = (name: string) => HERO_RIG.joints.findIndex((j) => j.name === name);
  const M = SURF.metal;
  b.color = armor;

  // золотые пояса — открытые кольца: сплошная крышка сверху ловила свет и читалась белым диском
  // Пилот 2.0 (разбор): цельный силуэт крупными массами — шлем-гребень, два широких наплечника, плотные
  // руки и ноги; мелкие шипы и кольца убраны, золото — только на поясе, горжете, кромках наплечников,
  // запястьях, сапогах и гребне. Визор — узкая фиолетовая щель, не белое пятно.

  // ---------------- таз: пояс с пряжкой, один ряд широких набедренников, задняя пластина
  b.joint = J('pelvis');
  hull8(b, 0.32, 0.21, -0.1, 0.36, 0.23, 0.08);
  b.add(prism(8, 0.21, 0.21, 0.06), { matrix: mat(0, 0.04, 0, 0, Math.PI / 8, 0, 1, 1, 0.74), color: dark });
  b.add(prism(8, 0.215, 0.215, 0.014, true), { matrix: mat(0, 0.09, 0, 0, Math.PI / 8, 0, 1, 1, 0.75), color: trim, surface: M });
  b.add(octa(0.05, 0.045, 0.022), { matrix: mat(0, 0.065, 0.155), color: trim, surface: M });
  for (const sx of [1, -1]) {
    plate(b, [[-0.09, 0], [0.09, 0], [0.08, -0.2], [0, -0.24], [-0.08, -0.2]], 0.026, mat(sx * 0.13, 0.0, 0.075, 0.2, sx * 0.55, 0), 0, armor);
    plate(b, [[-0.09, 0], [0.09, 0], [0.08, -0.18], [-0.08, -0.18]], 0.026, mat(sx * 0.17, -0.01, -0.03, 0.12, sx * 1.55, 0), 0, dark);
  }
  plate(b, [[-0.11, 0], [0.11, 0], [0.09, -0.28], [0, -0.32], [-0.09, -0.28]], 0.024, mat(0, 0.0, -0.125, -0.15, Math.PI, 0), 0, dark);

  // ---------------- живот: три сегмента-кольца
  b.joint = J('spine');
  for (let k = 0; k < 3; k++) {
    const y = -0.02 + k * 0.075;
    hull8(b, 0.29 + k * 0.025, 0.19 + k * 0.01, y, 0.31 + k * 0.025, 0.2 + k * 0.01, y + 0.07, 0.005);
  }

  // ---------------- грудь: кираса, нагрудные пластины, шрам, горжет, спина
  b.joint = J('chest');
  torso(b, 0.36, 0.53, 0.55, 0.22, 0.28, 0.25, -0.08, 0.14, 0.3);
  for (const sx of [1, -1]) {
    plate(b, [[0, 0.02], [sx * 0.23, 0.04], [sx * 0.24, -0.08], [sx * 0.13, -0.17], [0, -0.13]], 0.034, mat(0, 0.2, 0.13, -0.12, 0, 0), 0, armor);
  }
  // шрам — трещина наискосок через грудь (эмиссия), разгорается с Резонансом (буст инстанса)
  const scar: [number, number, number][] = [[0.15, 0.2, 0.17], [0.08, 0.13, 0.175], [0.03, 0.08, 0.17], [-0.05, 0.02, 0.16]];
  for (let i = 0; i < scar.length - 1; i++) {
    const [x0, y0, z0] = scar[i], [x1, y1, z1] = scar[i + 1];
    const g = shard(Math.hypot(x1 - x0, y1 - y0) * 1.1, 0.016, 4, 0.2, i);
    const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    b.add(g, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(x0, y0, z0), q, new THREE.Vector3(1, 1, 0.6)), emissive: 1.25 });
  }
  b.add(prism(8, 0.16, 0.13, 0.1), { matrix: mat(0, 0.27, 0, 0, Math.PI / 8), color: dark });
  b.add(prism(8, 0.165, 0.165, 0.016, true), { matrix: mat(0, 0.27, 0, 0, Math.PI / 8), color: trim, surface: M });
  // спина: широкая пластина под плащом — масса силуэта сзади
  plate(b, [[-0.2, 0.28], [0.2, 0.28], [0.17, -0.06], [0, -0.1], [-0.17, -0.06]], 0.04, mat(0, 0, -0.13, 0.08, Math.PI, 0), 0, dark);
  // наплечники: две широкие скруглённые пластины, золото — по кромке верхней
  for (const sx of [1, -1]) {
    b.add(octa(0.165, 0.08, 0.165), { matrix: mat(sx * 0.29, 0.3, 0, 0, Math.PI / 8, sx * -0.42), color: armor });
    b.add(prism(8, 0.16, 0.16, 0.016, true), { matrix: mat(sx * 0.29, 0.285, 0, 0, Math.PI / 8, sx * -0.42, 1, 1, 0.98), color: trim, surface: M });
    b.add(octa(0.145, 0.06, 0.15), { matrix: mat(sx * 0.32, 0.2, 0, 0, Math.PI / 8, sx * -0.62), color: dark });
  }

  // ---------------- шлем: купол, забрало, нащёчники, гребень назад; визор — узкая щель
  b.joint = J('neck');
  b.add(prism(6, 0.07, 0.065, 0.1), { matrix: mat(0, -0.02, 0), color: dark });
  b.joint = J('head');
  const dome = lathe([[0.0, 0.0], [0.125, 0.02], [0.15, 0.11], [0.14, 0.2], [0.1, 0.28], [0.0, 0.31]], 8, Math.PI / 8);
  b.add(dome, { matrix: mat(0, 0.0, -0.01, 0, 0, 0, 1, 1, 1.15), color: armor });
  // забрало — клин вперёд
  plate(b, [[-0.13, 0.2], [0.13, 0.2], [0.12, 0.06], [0.04, -0.03], [-0.04, -0.03], [-0.12, 0.06]], 0.055, mat(0, 0.0, 0.115, -0.12, 0, 0), 0, dark);
  // визор: узкая фиолетовая щель и слабый ореол
  b.add(box(0.19, 0.022, 0.03), { matrix: mat(0, 0.135, 0.15, -0.12), emissive: 1.0, color: dark });
  b.add(box(0.24, 0.05, 0.02), { matrix: mat(0, 0.135, 0.138, -0.12), emissive: 0.4, color: dark });
  for (const sx of [1, -1]) plate(b, [[0, 0], [0.065, 0.02], [0.055, -0.11], [0, -0.13]], 0.022, mat(sx * 0.135, 0.12, 0.05, 0, sx * 0.35, 0), 0, armor);
  // гребень: от лба назад и вниз — читается силуэтом с любой стороны
  plate(b, [[0.06, 0.0], [0.08, 0.1], [0.0, 0.13], [-0.2, 0.07], [-0.3, -0.06], [-0.18, -0.02]], 0.03, mat(0, 0.27, 0.0, 0, Math.PI / 2, 0), 0, trim);
  b.add(box(0.03, 0.02, 0.26), { matrix: mat(0, 0.31, -0.05, 0.2, 0, 0), color: trim, surface: M });

  // ---------------- руки: плотные — наплечная труба, налокотник, наруч, латный кулак
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.joint = J('sh' + side);
    limb(b, 0.3, 0.085, 0.072, 6);
    b.add(prism(6, 0.092, 0.096, 0.15), { matrix: mat(0, -0.2, 0), color: armor });
    b.joint = J('elb' + side);
    b.add(octa(0.08, 0.06, 0.08), { matrix: mat(0, 0.0, -0.02), color: dark });
    limb(b, 0.26, 0.07, 0.06, 6);
    b.add(prism(6, 0.085, 0.076, 0.18), { matrix: mat(0, -0.235, 0), color: armor });
    b.add(prism(6, 0.088, 0.088, 0.018, true), { matrix: mat(0, -0.25, 0), color: trim, surface: M });
    b.add(box(0.014, 0.13, 0.016), { matrix: mat(sx * 0.0, -0.17, 0.072), emissive: 0.5, color: dark });
    b.joint = J('hand' + side);
    // кулак: ладонь за рукоятью, пальцы обхватывают её спереди, большой палец сверху
    b.add(box(0.08, 0.075, 0.055), { matrix: mat(0, -0.06, -0.008), color: dark });
    b.add(box(0.085, 0.055, 0.035), { matrix: mat(0, -0.078, 0.066), color: armor });
    b.add(box(0.03, 0.04, 0.05), { matrix: mat(sx * 0.045, -0.045, 0.045), color: armor });
    b.add(box(0.09, 0.02, 0.06), { matrix: mat(0, -0.03, 0.02), color: dark });
  }

  // ---------------- ноги: набедренник, наколенник, поножи, латный сапог
  for (const side of ['L', 'R'] as const) {
    b.joint = J('hip' + side);
    limb(b, 0.45, 0.11, 0.084, 6);
    plate(b, [[-0.09, 0], [0.09, 0], [0.08, -0.3], [0, -0.34], [-0.08, -0.3]], 0.028, mat(0, -0.04, 0.095, 0.05, 0, 0), 0, armor);
    b.joint = J('knee' + side);
    b.add(octa(0.08, 0.085, 0.08), { matrix: mat(0, 0, 0.04), color: dark });
    b.add(bipyramid(4, 0.05, 0.08, 0.04), { matrix: mat(0, -0.02, 0.08, -1.25, Math.PI / 4), color: armor });
    limb(b, 0.43, 0.085, 0.062, 6);
    b.add(prism(6, 0.078, 0.095, 0.32), { matrix: mat(0, -0.37, 0.008), color: armor });
    b.joint = J('foot' + side);
    hull8(b, 0.14, 0.27, -0.02, 0.105, 0.17, 0.08, 0.02, 0.05);
    b.add(prism(4, 0.05, 0, 0.14), { matrix: mat(0, 0.0, 0.19, Math.PI / 2, Math.PI / 4, 0), color: dark });
    b.add(box(0.15, 0.014, 0.022), { matrix: mat(0, 0.07, 0.07), color: trim, surface: M });
  }

  // ---------------- клинок
  b.joint = J('blade');
  bladeParts(b, BLADE_LEN, 0, armor);

  // ---------------- Каэлис — гранёный ромб-дрон с золотым кольцом у плеча
  b.joint = J('kaelis');
  b.add(octa(0.085, 0.14, 0.085), { emissive: 0.75, color: armor });
  b.add(octa(0.04, 0.07, 0.04), { emissive: 1.9, color: armor });
  b.add(new THREE.TorusGeometry(0.12, 0.008, 3, 12), { matrix: mat(0, 0, 0, Math.PI / 2, 0, 0), color: trim, surface: M });

  return b.build();
}
