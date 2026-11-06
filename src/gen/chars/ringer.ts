import * as THREE from 'three';
import { hexToLinear } from '../../core/math';
import { Rng } from '../../core/rng';
import type { RigDef, V3 } from '../../anim/skeleton';
import { GeomBuilder, mat, matAlong, SURF } from '../geom/build';
import { box, lathe, octa, prism, rock, shard } from '../geom/prims';
import { hull8, limb, plate } from './parts';

/**
 * Звонарь («Маятник: срежь опоры»): сгорбленный акробат, сросшийся с колоколом. Голова низко и впереди корпуса, под
 * острым капюшоном — костяная маска с горящей прорезью. Горб — малый колокол, вросший в хребет: маковка выше головы,
 * раструб смотрит назад и вниз, сквозь маковку торчат позвонки; по спинке горба идёт тлеющая трещина — сюда бьёт
 * добивание. Руки длинные, до колен: левая — костяные когти, правая срослась с языком колокола (железный стержень и
 * чугунная гиря вместо кисти). Ноги длинные и тонкие, цепкие стопы — он стоит на маковке качающегося колокола. На поясе
 * — канат, обрывки рясы и бубенцы.
 *
 * Суставы — те же имена, что у тяжёлых стражей: позы, походка и постановка добивания работают без перевода.
 */
export const RINGER_SCALE = 1.45;
/** Центр чугунной гири языка в координатах кисти 'handR' (до масштаба): туда в III фазе ложится язык Великого колокола. */
export const RINGER_CLAPPER_BALL: V3 = [0, -0.86, 0];
/** Маковка горба в координатах груди (до масштаба): выше и позади головы. Подвес сустава 'bell'. */
export const BELL_PIVOT: V3 = [0, 1.0, -0.42];
/**
 * Горб-колокол: высота от раструба до маковки, радиус раструба, наклон оси (раструб назад и вниз), высота трещины от
 * раструба (доля высоты) — там точка удара добивания.
 */
export const RINGER_HUMP = { h: 1.3, r: 0.7, tilt: 0.7, crackAt: 0.5 };
/** Профиль горба (радиус, высота) в долях радиуса раструба и высоты. */
const HUMP_PROFILE: [number, number][] = [[1, 0], [1.065, 0.04], [0.97, 0.12], [0.79, 0.32], [0.69, 0.6], [0.61, 0.81], [0.4, 0.94], [0.13, 0.99], [0.002, 1]];
function humpRadius(v: number): number {
  for (let i = 1; i < HUMP_PROFILE.length; i++) {
    const [r0, y0] = HUMP_PROFILE[i - 1], [r1, y1] = HUMP_PROFILE[i];
    if (v <= y1) return r0 + (r1 - r0) * (v - y0) / (y1 - y0);
  }
  return 0;
}
/** Трещина на спинке горба — точка удара добивания, относительно маковки (до масштаба): та же точка, что на модели. */
export const BELL_CONTACT: V3 = (() => {
  const H = RINGER_HUMP, y = H.h * H.crackAt - H.h, z = -H.r * humpRadius(H.crackAt), c = Math.cos(H.tilt), sn = Math.sin(H.tilt);
  return [0, +(y * c - z * sn).toFixed(4), +(y * sn + z * c).toFixed(4)];
})();

const OBS = hexToLinear('#131117'), OBS2 = hexToLinear('#2a2430'), BONE = hexToLinear('#a39a88');
const BRONZE = hexToLinear('#7d5f30'), CLOTH = hexToLinear('#4a0f18'), ROPE = hexToLinear('#4b3a26');
const IRON = hexToLinear('#26232b'), BELL_DARK = hexToLinear('#2b2219'), BELL_IN = hexToLinear('#120d0a');

export function ringerRig(scale = RINGER_SCALE): RigDef {
  const s = scale, p = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  return {
    id: 'bellRinger',
    joints: [
      { name: 'root', pos: [0, 0, 0] },
      { name: 'pelvis', parent: 'root', pos: p(0, 1.2, 0) },
      { name: 'spine', parent: 'pelvis', pos: p(0, 0.3, -0.04) },
      { name: 'chest', parent: 'spine', pos: p(0, 0.36, 0.16) },
      // голова ниже плеч и впереди корпуса — горбун тянет шею вперёд
      { name: 'head', parent: 'chest', pos: p(0, 0.22, 0.5) },
      { name: 'shL', parent: 'chest', pos: p(0.5, 0.28, 0.08) },
      { name: 'elbL', parent: 'shL', pos: p(0, -0.72, 0) },
      { name: 'handL', parent: 'elbL', pos: p(0, -0.7, 0) },
      { name: 'shR', parent: 'chest', pos: p(-0.5, 0.28, 0.08) },
      { name: 'elbR', parent: 'shR', pos: p(0, -0.72, 0) },
      { name: 'handR', parent: 'elbR', pos: p(0, -0.7, 0) },
      { name: 'hipL', parent: 'pelvis', pos: p(0.24, -0.06, 0) },
      { name: 'kneeL', parent: 'hipL', pos: p(0, -0.58, 0.04) },
      { name: 'footL', parent: 'kneeL', pos: p(0, -0.56, -0.04) },
      { name: 'hipR', parent: 'pelvis', pos: p(-0.24, -0.06, 0) },
      { name: 'kneeR', parent: 'hipR', pos: p(0, -0.58, 0.04) },
      { name: 'footR', parent: 'kneeR', pos: p(0, -0.56, -0.04) },
      { name: 'bell', parent: 'chest', pos: p(...BELL_PIVOT) },
    ],
  };
}

export function buildRinger(seed = 22, s = RINGER_SCALE): { rig: RigDef; geometry: THREE.BufferGeometry } {
  const rig = ringerRig(s), J = (n: string) => rig.joints.findIndex((j) => j.name === n);
  const b = new GeomBuilder(), rng = new Rng(seed);
  b.rng = rng; b.color = OBS;
  // позиция в метрах до масштаба → матрица детали
  const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => mat(x * s, y * s, z * s, rx, ry, rz);
  const along = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => matAlong(x * s, y * s, z * s, dx, dy, dz);
  const ring = (r: number, tube: number, sides = 8) => new THREE.TorusGeometry(r * s, tube * s, 3, sides);

  // ---- таз: узкие бёдра, канат-пояс, лохмотья рясы, бубенцы
  b.joint = J('pelvis');
  hull8(b, 0.52 * s, 0.36 * s, -0.18 * s, 0.6 * s, 0.4 * s, 0.14 * s);
  b.add(ring(0.33, 0.05, 14), { matrix: M(0, 0.06, 0, Math.PI / 2, 0, 0), color: ROPE, surface: SURF.cloth });
  for (const x of [-0.06, 0.08]) b.add(octa(0.05 * s, 0.07 * s, 0.05 * s), { matrix: M(x, 0.02, 0.3), color: ROPE, surface: SURF.cloth });
  for (const [x, z] of [[-0.24, 0.16], [0.24, 0.14], [0.02, 0.3]]) {
    b.add(lathe([[0.075 * s, 0], [0.06 * s, 0.05 * s], [0.04 * s, 0.1 * s], [0, 0.12 * s]], 6), { matrix: M(x, -0.12, z), color: BRONZE, surface: SURF.metal });
    b.add(octa(0.025 * s, 0.025 * s, 0.025 * s), { matrix: M(x, -0.13, z), emissive: 0.9 });
  }
  const rag = (pts: [number, number][], m: THREE.Matrix4) => plate(b, pts.map(([x, y]) => [x * s, y * s] as [number, number]), 0.03 * s, m, undefined, CLOTH);
  rag([[-0.17, 0], [0.17, 0], [0.13, -0.58], [0.02, -0.7], [-0.11, -0.56]], M(0, 0.04, 0.27, 0.1, 0, 0));
  rag([[-0.2, 0], [0.2, 0], [0.16, -0.78], [0.04, -0.66], [-0.05, -0.86], [-0.17, -0.7]], M(0, 0.04, -0.29, -0.12, 0, 0));
  for (const sx of [1, -1]) rag([[-0.1, 0], [0.12, 0], [0.08, -0.5], [-0.06, -0.6]], M(sx * 0.27, 0.04, 0, 0, sx * Math.PI / 2, sx * 0.1));

  // ---- поясница: узкая талия и позвонки, выпирающие на спине
  b.joint = J('spine');
  hull8(b, 0.48 * s, 0.34 * s, -0.02 * s, 0.62 * s, 0.42 * s, 0.38 * s, 0.08 * s);
  for (let i = 0; i < 4; i++) b.add(octa(0.07 * s, 0.055 * s, 0.08 * s), { matrix: M(0, 0.03 + i * 0.1, -0.17 + i * 0.012), color: BONE });

  // ---- грудь: рёбра вперёд и вверх, к шее; горнило в груди; кость лопаток сквозь кожу
  b.joint = J('chest');
  hull8(b, 0.64 * s, 0.44 * s, 0, 1.0 * s, 0.6 * s, 0.26 * s, 0.08 * s);
  hull8(b, 1.0 * s, 0.6 * s, 0.26 * s, 0.7 * s, 0.52 * s, 0.46 * s, 0.18 * s, 0.08 * s);
  // плащ: рваные полосы с плеч вниз по спине, под горбом — даёт силуэту массу
  for (const [x, len, ry] of [[-0.34, 1.25, -0.35], [-0.12, 1.45, -0.1], [0.12, 1.35, 0.1], [0.34, 1.2, 0.35]] as const) {
    plate(b, [[-0.13 * s, 0], [0.13 * s, 0], [0.11 * s, -len * 0.7 * s], [0.03 * s, -len * s], [-0.04 * s, -len * 0.82 * s], [-0.12 * s, -len * 0.9 * s]], 0.03 * s, M(x, 0.4, -0.3, 0.18, ry, 0), undefined, CLOTH);
  }
  for (const sx of [1, -1]) for (let k = 0; k < 3; k++) {
    b.add(box(0.3 * s, 0.035 * s, 0.05 * s), { matrix: M(sx * 0.22, 0.1 + k * 0.1, 0.28 + k * 0.025, 0, sx * 0.35, sx * -0.3), color: OBS2 });
  }
  b.add(octa(0.07 * s, 0.1 * s, 0.05 * s), { matrix: M(0, 0.1, 0.3), emissive: 1.3 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    b.add(shard((0.18 + rng.next() * 0.14) * s, 0.022 * s, 3, 0.3, i + 11), { matrix: along(0, 0.1, 0.31, Math.cos(a), Math.sin(a), 0.08), emissive: 0.8 });
  }
  // шея тянется вперёд и вниз к голове
  b.add(prism(5, 0.11 * s, 0.09 * s, 0.36 * s), { matrix: along(0, 0.38, 0.22, 0, -0.16, 0.3) });
  // лопатки и позвонки прорастают сквозь основание горба
  for (const sx of [1, -1]) b.add(shard(0.42 * s, 0.07 * s, 4, 0.2, 31 + sx), { matrix: along(sx * 0.24, 0.4, -0.18, sx * 0.35, 1, -0.55), color: BONE });
  // ремень-перевязь через грудь держит горб
  b.add(box(0.06 * s, 0.98 * s, 0.05 * s), { matrix: M(0.04, 0.24, 0.27, 0.15, 0, 0.62), color: ROPE, surface: SURF.cloth });
  b.add(prism(6, 0.06 * s, 0.06 * s, 0.05 * s), { matrix: M(0.06, 0.24, 0.3, Math.PI / 2, 0, 0), color: BRONZE, surface: SURF.metal });

  // ---- голова: костяная маска с прорезью, клюв-челюсть, острый капюшон, открытый спереди
  b.joint = J('head');
  b.add(rock(0.25 * s, 0, 0.18, seed), { matrix: mat(0, 0.03 * s, 0.06 * s, 0, 0, 0, 0.95, 0.85, 1.2), color: BONE });
  b.add(box(0.22 * s, 0.035 * s, 0.05 * s), { matrix: M(0, 0.07, 0.32), emissive: 1.9 });
  b.add(shard(0.32 * s, 0.1 * s, 4, 0.15, 7), { matrix: along(0, -0.08, 0.22, 0, -0.55, 1), color: BONE });
  // острый капюшон, открытый спереди: кончик торчит назад и вверх над горбом
  const hood = new THREE.LatheGeometry([[0.38, -0.24], [0.39, 0], [0.32, 0.24], [0.19, 0.48], [0.07, 0.7], [0.001, 0.82]].map(([r, y]) => new THREE.Vector2(r * s, y * s)), 9, Math.PI * 0.27, Math.PI * 1.46);
  b.add(hood, { matrix: M(0, 0.05, -0.05, -0.7, 0, 0), color: CLOTH, surface: SURF.cloth });
  b.add(rock(0.29 * s, 0, 0.15, seed + 3), { matrix: mat(0, 0.07 * s, -0.14 * s, 0, 0, 0, 1, 0.9, 1), color: CLOTH, surface: SURF.cloth });

  // ---- руки: длинные, тонкие, обмотаны канатом
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.joint = J('sh' + side);
    b.add(rock(0.22 * s, 0, 0.2, rng.int(0, 99)), { matrix: M(sx * 0.04, 0.02, 0), color: OBS2 });
    b.add(shard(0.32 * s, 0.06 * s, 4, 0.2, 40 + sx), { matrix: along(sx * 0.05, 0.08, -0.04, sx * 0.25, 1, -0.45), color: BONE });
    limb(b, 0.72 * s, 0.16 * s, 0.11 * s, 5);
    for (const y of [-0.26, -0.46]) b.add(ring(0.14, 0.026), { matrix: M(0, y, 0, Math.PI / 2, 0, 0), color: ROPE, surface: SURF.cloth });
    b.add(shard(0.22 * s, 0.045 * s, 3, 0.2, 45), { matrix: along(0, -0.68, -0.05, 0, -0.2, -1), color: BONE });
    b.joint = J('elb' + side);
    if (side === 'L') {
      limb(b, 0.7 * s, 0.13 * s, 0.09 * s, 5);
      b.add(prism(6, 0.12 * s, 0.11 * s, 0.07 * s, true), { matrix: M(0, -0.52, 0), color: BRONZE, surface: SURF.metal });
      // кисть: узкая ладонь и три длинных костяных когтя
      b.joint = J('handL');
      hull8(b, 0.22 * s, 0.1 * s, -0.2 * s, 0.16 * s, 0.12 * s, 0);
      for (let k = -1; k <= 1; k++) b.add(shard(0.38 * s, 0.04 * s, 3, 0.15, 60 + k), { matrix: along(k * 0.06, -0.18, 0.03, k * 0.15, -1, 0.35), color: BONE });
      b.add(shard(0.2 * s, 0.035 * s, 3, 0.15, 64), { matrix: along(-0.08, -0.06, 0.06, -0.6, -0.6, 0.5), color: BONE });
    } else {
      // правая рука срослась с языком колокола: плоть переходит в железный стержень
      b.add(rock(0.17 * s, 0, 0.3, 77), { matrix: M(0, -0.06, 0), color: OBS });
      limb(b, 0.7 * s, 0.14 * s, 0.1 * s, 6);
      for (const y of [-0.2, -0.38, -0.56]) b.add(prism(6, 0.145 * s, 0.135 * s, 0.05 * s, true), { matrix: M(0, y, 0), color: BRONZE, surface: SURF.metal });
      b.joint = J('handR');
      b.add(prism(8, 0.17 * s, 0.15 * s, 0.09 * s, true), { matrix: M(0, -0.08, 0), color: BRONZE, surface: SURF.metal });
      b.add(prism(6, 0.075 * s, 0.075 * s, 0.6 * s), { matrix: M(0, -0.6, 0), color: IRON, surface: SURF.metal });
      // чугунная гиря языка, по ней — горящие трещины
      b.add(rock(0.34 * s, 1, 0.08, 5), { matrix: mat(0, RINGER_CLAPPER_BALL[1] * s, 0, 0, 0, 0, 1, 1.15, 1), color: IRON, surface: SURF.metal });
      b.add(prism(10, 0.24 * s, 0.24 * s, 0.06 * s, true), { matrix: M(0, -0.55, 0), color: BRONZE, surface: SURF.metal });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.3;
        b.add(shard(0.28 * s, 0.022 * s, 3, 0.35, 90 + k), { matrix: along(Math.sin(a) * 0.3, -0.98, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 1, Math.cos(a) * 0.3), emissive: 1.25 });
      }
    }
  }

  // ---- ноги: длинные, тонкие; цепкие стопы с когтями
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.joint = J('hip' + side);
    limb(b, 0.58 * s, 0.21 * s, 0.14 * s, 5);
    b.add(ring(0.16, 0.025), { matrix: M(0, -0.3, 0, Math.PI / 2, 0, 0), color: ROPE, surface: SURF.cloth });
    b.joint = J('knee' + side);
    b.add(rock(0.13 * s, 0, 0.2, 70 + sx), { matrix: M(0, 0, 0.1), color: BONE });
    limb(b, 0.56 * s, 0.13 * s, 0.085 * s, 5);
    b.add(shard(0.2 * s, 0.04 * s, 3, 0.2, 72), { matrix: along(0, -0.12, -0.08, 0, 0.5, -1), color: BONE });
    b.joint = J('foot' + side);
    hull8(b, 0.22 * s, 0.46 * s, -0.06 * s, 0.16 * s, 0.26 * s, 0.06 * s, 0.05 * s, 0.11 * s);
    for (let k = -1; k <= 1; k++) b.add(shard(0.2 * s, 0.035 * s, 3, 0.15, 80 + k), { matrix: along(k * 0.05, -0.04, 0.28, k * 0.15, -0.2, 1), color: BONE });
    b.add(shard(0.14 * s, 0.03 * s, 3, 0.15, 84), { matrix: along(0, -0.03, -0.1, 0, -0.1, -1), color: BONE });
  }

  // ---- горб: малый колокол, вросший в хребет. Маковка — в суставе 'bell', ось наклонена: раструб назад и вниз
  b.joint = J('bell');
  const H = RINGER_HUMP;
  const hump = new THREE.Matrix4().makeRotationX(H.tilt).multiply(new THREE.Matrix4().makeTranslation(0, -H.h * s, 0));
  const inHump = (m: THREE.Matrix4) => hump.clone().multiply(m);
  const at = (r: number, y: number): [number, number] => [r * H.r * s, y * H.h * s];
  b.add(lathe(HUMP_PROFILE.map(([r, y]) => at(r, y)), 14), { matrix: hump, color: BELL_DARK, surface: SURF.metal });
  // изнанка — тёмная бронза; в глубине раструба маленькое тлеющее сердце, не диск во весь раструб
  // матовая изнанка: металл блестит внутри раструба почти белым
  b.add(lathe(HUMP_PROFILE.slice(0, -2).map(([r, y]) => at(Math.max(0.03, r - 0.09), y + 0.015)).reverse(), 14), { matrix: hump, color: BELL_IN, surface: SURF.cloth, shade: 0.05 });
  b.add(octa(0.12 * s, 0.16 * s, 0.12 * s), { matrix: inHump(M(0, H.h * 0.7, 0)), emissive: 1.2 });
  b.add(ring(H.r * 0.98, 0.04, 18), { matrix: inHump(M(0, 0.03, 0, Math.PI / 2, 0, 0)), color: BRONZE, surface: SURF.metal });
  b.add(ring(H.r * 0.7, 0.034, 16), { matrix: inHump(M(0, H.h * 0.55, 0, Math.PI / 2, 0, 0)), color: BRONZE, surface: SURF.metal });
  // трещина по спинке горба (сторона −z до наклона смотрит вверх и назад) — сюда бьёт добивание
  const crack: [number, number, number][] = [[0.0, 0.26, 0.2], [0.05, 0.42, -0.25], [-0.03, 0.58, 0.18], [0.03, 0.73, -0.1]];
  crack.forEach(([x, v, lean], i) => {
    const r = H.r * humpRadius(v) + 0.012;
    b.add(shard(0.27 * s, 0.032 * s, 3, 0.35, 120 + i), { matrix: inHump(matAlong(x * s, v * H.h * s, -r * s, lean, 1, 0.05)), emissive: 1.5 });
  });
  // позвонки прорастают сквозь маковку; железная петля, за которую горб когда-то висел
  for (const [x, dx] of [[0, 0], [0.13, 0.35], [-0.13, -0.35]] as const) b.add(shard(0.4 * s, 0.07 * s, 4, 0.2, 130 + Math.round(x * 100)), { matrix: along(x, 0.02, 0.02, dx, 1, -0.55), color: BONE });
  b.add(ring(0.15, 0.045, 10), { matrix: M(0, 0.06, -0.06, 0.4, 0, 0), color: IRON, surface: SURF.metal });
  return { rig, geometry: b.build() };
}
