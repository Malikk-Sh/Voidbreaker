import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import type { RigDef } from '../../anim/skeleton';
import { GeomBuilder, mat, type RGB } from '../geom/build';
import { bipyramid, octa, prism, shard } from '../geom/prims';
import { hull8, limb, plate, torso } from './parts';

/**
 * Пилот (GDD §15.3): шарнирная кукла из граней, ~22 детали. Шлем — вытянутый октаэдр с щелью визора,
 * торс — трапеция со шрамом-трещиной, наплечники-шипы, наручи с гранёным краем, клинок из обломка обшивки.
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
    { name: 'blade', parent: 'handR', pos: [0, -0.05, 0.02] },
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
}

export const HERO_DEFAULT: HeroLook = { armor: '#1b1826', trim: '#5c4a8a' };

/** Клинок: выдавленный контур (кривая кромки), тёмное тело, светящаяся кромка, белая сердцевина в доле. */
export function bladeParts(b: GeomBuilder, len: number, curve: number, armor: RGB, scale = 1): void {
  const L = len * scale;
  // рукоять и гарда
  b.add(prism(6, 0.025, 0.03, 0.2), { matrix: mat(0, -0.02, 0, Math.PI), color: armor });
  b.add(bipyramid(4, 0.045, 0.05, 0.05), { matrix: mat(0, 0.0, 0), color: hexToLinear('#8a6d34') });
  b.add(hull8Geo(0.26, 0.05, 0.08), { matrix: mat(0, -0.2, 0), color: armor });
  // тело клинка вдоль −Y с изгибом кривой
  const pts: [number, number][] = [];
  const seg = 8;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, y = -0.22 - t * (L - 0.22);
    const bend = curve * Math.sin(t * Math.PI * 0.9) * 0.35;
    const w = 0.075 * (1 - t * 0.55);
    pts.push([bend + w, y]);
  }
  const tipY = -L - 0.04;
  const back: [number, number][] = [];
  for (let i = seg; i >= 0; i--) {
    const t = i / seg, y = -0.22 - t * (L - 0.22);
    const bend = curve * Math.sin(t * Math.PI * 0.9) * 0.35;
    const w = 0.05 * (1 - t * 0.7);
    back.push([bend - w, y]);
  }
  plate(b, [...pts, [curve * 0.1, tipY], ...back], 0.028, undefined, 0, armor);
  // кромка: светящаяся полоса по рабочей стороне + раскалённый край
  const edge: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, y = -0.24 - t * (L - 0.24);
    const bend = curve * Math.sin(t * Math.PI * 0.9) * 0.35;
    const w = 0.075 * (1 - t * 0.55);
    edge.push([bend + w + 0.008, y]);
  }
  const inner: [number, number][] = [];
  for (let i = seg; i >= 0; i--) {
    const t = i / seg, y = -0.24 - t * (L - 0.24);
    const bend = curve * Math.sin(t * Math.PI * 0.9) * 0.35;
    const w = 0.075 * (1 - t * 0.55);
    inner.push([bend + w - 0.012, y]);
  }
  plate(b, [...edge, [curve * 0.1, tipY - 0.01], ...inner], 0.032, undefined, 1.25, armor);
  // дол — фиолетовая жила по центру
  const fuller: [number, number][] = [];
  for (let i = 1; i <= seg - 2; i++) {
    const t = i / seg, y = -0.22 - t * (L - 0.22);
    fuller.push([curve * Math.sin(t * Math.PI * 0.9) * 0.35 + 0.005, y]);
  }
  for (let i = seg - 2; i >= 1; i--) {
    const t = i / seg, y = -0.22 - t * (L - 0.22);
    fuller.push([curve * Math.sin(t * Math.PI * 0.9) * 0.35 - 0.012, y]);
  }
  plate(b, fuller, 0.034, undefined, 0.55, armor);
}

function hull8Geo(w: number, d: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  return g;
}

export function buildHeroGeometry(look: HeroLook = HERO_DEFAULT, seed = 7): THREE.BufferGeometry {
  const b = new GeomBuilder();
  b.rng = new Rng(seed);
  b.shade = 0.22;
  const armor = hexToLinear(look.armor);
  const trim = hexToLinear(look.trim);
  const J = (name: string) => HERO_RIG.joints.findIndex((j) => j.name === name);
  b.color = armor;

  // таз: пояс + набедренные пластины
  b.joint = J('pelvis');
  hull8(b, 0.3, 0.2, -0.1, 0.34, 0.22, 0.08);
  b.add(prism(8, 0.19, 0.19, 0.04), { matrix: mat(0, 0.06, 0, 0, Math.PI / 8, 0, 1, 1, 0.72), color: trim, emissive: 0 });
  for (const [x, z, ry] of [[0.13, 0.08, 0.5], [-0.13, 0.08, -0.5], [0.13, -0.08, 2.6], [-0.13, -0.08, -2.6], [0, 0.12, 0]] as const) {
    plate(b, [[-0.07, 0], [0.07, 0], [0.05, -0.28], [0, -0.33], [-0.05, -0.28]], 0.02, mat(x, 0.02, z, 0.18, ry, 0));
  }

  // живот
  b.joint = J('spine');
  hull8(b, 0.27, 0.18, -0.02, 0.33, 0.2, 0.2);

  // грудь: трапеция + шрам + наплечники-шипы
  b.joint = J('chest');
  torso(b, 0.34, 0.5, 0.52, 0.21, 0.27, 0.24, -0.08, 0.14, 0.3);
  // шрам — трещина наискосок через грудь (эмиссия), разгорается с Резонансом (буст инстанса)
  const scar: [number, number, number][] = [[0.17, 0.25, 0.135], [0.08, 0.17, 0.145], [0.03, 0.1, 0.145], [-0.06, 0.03, 0.14], [-0.14, -0.04, 0.12]];
  for (let i = 0; i < scar.length - 1; i++) {
    const [x0, y0, z0] = scar[i], [x1, y1, z1] = scar[i + 1];
    const g = shard(Math.hypot(x1 - x0, y1 - y0) * 1.1, 0.018, 4, 0.2, i);
    const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    b.add(g, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(x0, y0, z0), q, new THREE.Vector3(1, 1, 0.6)), emissive: 1.5 });
  }
  for (const sx of [1, -1]) {
    // наплечник: пластина + шип
    b.add(octa(0.13, 0.08, 0.13), { matrix: mat(sx * 0.27, 0.27, 0, 0, 0, sx * -0.35) });
    b.add(shard(0.32, 0.06, 4, 0.2, 3), { matrix: mat(sx * 0.3, 0.3, -0.02, -0.2, 0, sx * -0.9) });
    b.add(prism(4, 0.1, 0.09, 0.03), { matrix: mat(sx * 0.27, 0.2, 0, 0, Math.PI / 4, sx * -0.35), color: trim });
  }
  // воротник
  b.add(prism(6, 0.12, 0.14, 0.08), { matrix: mat(0, 0.29, 0) });

  // шея и шлем: вытянутый октаэдр, срезанный снизу; щель визора (белая сердцевина, фиолетовый ореол)
  b.joint = J('neck');
  b.add(prism(5, 0.06, 0.055, 0.1), { matrix: mat(0, -0.02, 0) });
  b.joint = J('head');
  b.add(bipyramid(6, 0.13, 0.3, 0.07), { matrix: mat(0, 0.1, 0, 0, Math.PI / 6, 0, 1, 1, 1.12) });
  b.add(hull8Geo(0.14, 0.035, 0.02), { matrix: mat(0, 0.13, 0.115, -0.15), emissive: 1.5 });
  b.add(hull8Geo(0.19, 0.02, 0.045), { matrix: mat(0, 0.13, 0.108, -0.15), emissive: 0.5 });
  // гребень-плавник, откинутый назад
  plate(b, [[0, 0], [0.02, 0.1], [-0.02, 0.06], [-0.22, -0.02], [-0.1, -0.02]], 0.02, mat(0, 0.3, -0.05, 0, Math.PI / 2, 0), 0, trim);

  // руки
  for (const side of ['L', 'R'] as const) {
    b.joint = J('sh' + side);
    limb(b, 0.3, 0.075, 0.06, 5);
    b.joint = J('elb' + side);
    limb(b, 0.26, 0.058, 0.05, 5);
    // наручь с гранёным краем
    b.add(prism(6, 0.075, 0.062, 0.14), { matrix: mat(0, -0.26, 0), color: trim });
    b.add(shard(0.12, 0.03, 4, 0.2, 9), { matrix: mat(0, -0.16, -0.05, 2.6, 0, 0) });
    b.joint = J('hand' + side);
    b.add(octa(0.045, 0.06, 0.05), { matrix: mat(0, -0.03, 0) });
  }

  // ноги
  for (const side of ['L', 'R'] as const) {
    b.joint = J('hip' + side);
    limb(b, 0.45, 0.095, 0.07, 5);
    b.joint = J('knee' + side);
    limb(b, 0.43, 0.075, 0.05, 5);
    b.add(shard(0.14, 0.05, 4, 0.2, 2), { matrix: mat(0, -0.04, 0.05, -1.2, 0, 0), color: trim });
    b.joint = J('foot' + side);
    hull8(b, 0.11, 0.24, -0.02, 0.08, 0.15, 0.06, 0.02, 0.05);
    b.add(prism(4, 0.04, 0, 0.12), { matrix: mat(0, 0.0, 0.17, Math.PI / 2, Math.PI / 4, 0) });
  }

  // клинок
  b.joint = J('blade');
  bladeParts(b, BLADE_LEN, 0.18, armor);

  // Каэлис — ромб из 8 граней у плеча
  b.joint = J('kaelis');
  b.add(octa(0.09, 0.15, 0.09), { emissive: 0.75, color: armor });
  b.add(octa(0.04, 0.07, 0.04), { emissive: 1.9, color: armor });

  return b.build();
}
