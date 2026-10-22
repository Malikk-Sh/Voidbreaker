import * as THREE from 'three';
import { hexToLinear } from '../../core/math';
import { Rng } from '../../core/rng';
import { GeomBuilder, mat } from '../geom/build';
import { GOLD, OBS, OBS_DEEP } from '../geom/kit';
import { bipyramid, box, lathe, octa, prism, shard } from '../geom/prims';

/**
 * Свои события арен (план §8.5): обломки «Инея» над 1-1, ворота-гигант и силуэт Стража за ними на 1-3,
 * огромный колокол над колокольней 1-6. Статичная геометрия — двигает её бой.
 */
const STEEL = hexToLinear('#5a6372'), STEEL_HI = hexToLinear('#8a93a3'), PANEL = hexToLinear('#20252e');

/** Обломки «Инея» в небе 1-1 (высоко над фасадом — их видно из интро): рваные куски корпуса и крыла с тлеющими швами. */
export function buildWreck(seed = 81): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = new GeomBuilder(); b.rng = rng;
  for (let i = 0; i < 9; i++) {
    const x = rng.spread(45) + 8, y = rng.range(42, 92), z = -rng.range(40, 105);
    const s = rng.range(1.5, 4.5);
    const g = new GeomBuilder(); g.rng = new Rng(rng.int(0, 1e6)); g.color = STEEL;
    if (i % 3 === 0) {
      // кусок корпуса: полукольцо обшивки с рёбрами
      g.add(lathe([[0.9, -1], [1.05, 0], [0.95, 1]], 7, 0), { matrix: mat(0, 0, 0, 0, 0, 0, 1, 1, 1) });
      for (const z2 of [-0.6, 0.2]) g.add(prism(7, 1.06, 1.06, 0.12, true), { matrix: mat(0, z2, 0), color: PANEL });
    } else if (i % 3 === 1) {
      // крыло: плита с огнём на кромке
      g.add(box(3, 0.12, 1.2), { matrix: mat(0, 0, 0, 0.1, 0, 0.2) });
      g.add(box(3, 0.08, 0.08), { matrix: mat(0, 0.06, 0.6, 0.1, 0, 0.2), emissive: 1.6, color: STEEL_HI });
    } else {
      g.add(shard(2.2, 0.5, 4, 0.4, i), { color: PANEL });
      g.add(box(0.06, 1.6, 0.06), { matrix: mat(0.2, 0.2, 0.1, 0.3, 0, 0.1), emissive: 1.4, color: STEEL_HI });
    }
    b.append(g, mat(x, y, z, rng.next() * 6, rng.next() * 6, rng.next() * 6, s, s, s));
  }
  return b.build();
}

/** Ворота-гигант (40 м) на фоне 1-3: стрельчатая арка, решётка, контрфорсы. Центр основания — в нуле. */
export function buildGiantGate(seed = 83): THREE.BufferGeometry {
  const b = new GeomBuilder(); b.rng = new Rng(seed); b.color = OBS;
  const W = 14, H = 30;
  const shape = new THREE.Shape();
  shape.moveTo(-W - 4, 0); shape.lineTo(W + 4, 0); shape.lineTo(W + 4, H); shape.lineTo(0, H + 12); shape.lineTo(-W - 4, H); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-W, 0); hole.lineTo(-W, 20); hole.quadraticCurveTo(-W * 0.9, 31, 0, 35); hole.quadraticCurveTo(W * 0.9, 31, W, 20); hole.lineTo(W, 0); hole.closePath();
  shape.holes.push(hole);
  b.add(new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }), { matrix: mat(0, 0, -1.5) });
  // золотая окантовка проёма и карниз: на тёмном небе ворота читаются силуэтом
  b.add(box(0.4, 20, 0.4), { matrix: mat(-W, 10, 1.6), color: GOLD });
  b.add(box(0.4, 20, 0.4), { matrix: mat(W, 10, 1.6), color: GOLD });
  for (let k = 0; k < 12; k++) {
    const t0 = k / 12, t1 = (k + 1) / 12;
    const q = (t: number, s: number): [number, number] => {
      const x0 = s * W, y0 = 20, cxq = s * W * 0.9, cyq = 31, x1 = 0, y1 = 35, u = 1 - t;
      return [u * u * x0 + 2 * u * t * cxq + t * t * x1, u * u * y0 + 2 * u * t * cyq + t * t * y1];
    };
    for (const sd of [-1, 1]) {
      const [ax, ay] = q(t0, sd), [bx, by] = q(t1, sd);
      const len = Math.hypot(bx - ax, by - ay);
      b.add(box(0.4, len + 0.1, 0.4), { matrix: mat((ax + bx) / 2, (ay + by) / 2, 1.6, 0, 0, Math.atan2(-(bx - ax), by - ay)), color: GOLD });
    }
  }
  // карниз — по обе стороны от арки (проём на этой высоте шире 0.8 W)
  for (const sd of [-1, 1]) b.add(box(5.2, 0.6, 0.5), { matrix: mat(sd * (W + 1.4), H, 1.6), color: GOLD });
  // решётка: прутья и перекладины, внизу — зубья
  for (let x = -W + 1.4; x < W; x += 2.2) b.add(box(0.35, 32, 0.35), { matrix: mat(x, 16, 0), color: OBS_DEEP });
  for (let y = 3; y < 30; y += 3.6) b.add(box(W * 2, 0.3, 0.3), { matrix: mat(0, y, 0), color: OBS_DEEP });
  // контрфорсы и шпили
  for (const s of [-1, 1]) {
    b.add(box(4, 40, 5), { matrix: mat(s * (W + 6), 20, 0) });
    b.add(prism(4, 2.6, 0, 12), { matrix: mat(s * (W + 6), 40, 0, 0, Math.PI / 4) });
  }
  // руна-замок в навершии — тлеет багровым (это вход Стража)
  b.add(octa(1.3, 2, 0.6), { matrix: mat(0, H + 7, 1.6), emissive: -1.6, color: OBS_DEEP });
  return b.build();
}

/** Силуэт Стража Врат за решёткой (до его появления): тёмная громада с алебардой и двумя углями глаз. ~14 м. */
export function buildGuardianSilhouette(): THREE.BufferGeometry {
  const b = new GeomBuilder(); b.rng = new Rng(85); b.color = OBS_DEEP;
  b.add(box(2.6, 6, 2.2), { matrix: mat(-1.5, 3, 0, 0, 0, 0.04) });
  b.add(box(2.6, 6, 2.2), { matrix: mat(1.5, 3, 0, 0, 0, -0.04) });
  b.add(box(6.5, 5.5, 3.6), { matrix: mat(0, 8.6, 0) });
  b.add(bipyramid(4, 4.2, 1.6, 0.4), { matrix: mat(0, 11.4, 0, 0, Math.PI / 4, 0) });
  b.add(box(2.2, 2.2, 2.2), { matrix: mat(0, 12.6, 0) });
  for (const s of [-1, 1]) b.add(shard(1.8, 0.35, 4, 0.2, s + 2), { matrix: mat(s * 1.2, 13.6, 0, 0, 0, -s * 0.5) });
  for (const s of [-1, 1]) b.add(box(1.6, 5, 1.6), { matrix: mat(s * 4.2, 7.6, 0, 0, 0, s * 0.15) });
  // алебарда в правой руке
  b.add(box(0.35, 17, 0.35), { matrix: mat(-5, 8.5, 0.4) });
  b.add(shard(3.2, 0.9, 4, 0.25, 7), { matrix: mat(-5, 17.4, 0.4) });
  // угли глаз
  for (const s of [-1, 1]) b.add(octa(0.2, 0.12, 0.1), { matrix: mat(s * 0.5, 12.8, 1.12), emissive: -2.4, color: OBS_DEEP });
  return b.build();
}

/** Огромный колокол над колокольней 1-6 (≈7 м) с ярмом вдоль z: подвешен за верх, качается вокруг оси ярма. */
export function buildGiantBell(): THREE.BufferGeometry {
  const b = new GeomBuilder(); b.rng = new Rng(87); b.color = hexToLinear('#3a2c18');
  // профиль снизу вверх: раструб у пола, корона у ярма
  const bell = lathe([[0.1, 0], [3.4, 0.4], [3.0, 1.6], [2.1, 4.2], [1.95, 5.8], [1.0, 6.6], [0.0, 6.8]], 18);
  b.add(bell, { matrix: mat(0, -7.4, 0) });
  // обод и пояса — тлеющая бронза
  b.add(new THREE.TorusGeometry(3.3, 0.12, 4, 32), { matrix: mat(0, -6.9, 0, Math.PI / 2, 0, 0), emissive: 1.0 });
  b.add(new THREE.TorusGeometry(2.05, 0.08, 4, 28), { matrix: mat(0, -2.6, 0, Math.PI / 2, 0, 0), emissive: 0.8 });
  // язык
  b.add(box(0.2, 4.5, 0.2), { matrix: mat(0, -3.6, 0), color: OBS });
  b.add(octa(0.6, 0.8, 0.6), { matrix: mat(0, -6.2, 0), color: OBS });
  // ярмо
  b.add(box(1.0, 0.8, 9), { matrix: mat(0, 0.6, 0), color: OBS });
  b.add(box(1.4, 1.2, 1.4), { matrix: mat(0, 0, 0), color: OBS });
  return b.build();
}
