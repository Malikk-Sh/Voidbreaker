import * as THREE from 'three';
import { Clip, type ClipDef, type Key } from '../clip';
import { RigLayout, Skeleton, type V3 } from '../skeleton';
import { BLADE_LEN, HERO_RIG } from '../../gen/chars/hero';

/** Контакт — событие специального клипа, в секундах времени сцены. */
export const MASK_CONTACT = 0.72;

/**
 * Клипы казни не содержат боевых hitOn/impact: перемещением по сцене ведёт Director,
 * вертикальная коррекция клипа удерживает опорную стопу у пола.
 * Крупные опорные позы остаются читаемы без следов и вспышек.
 */
export const EXECUTION_CLIPS: ClipDef[] = [
  {
    id: 'chainBrace', dur: 1.2, mask: 'full',
    keys: [
      { t: 0, pose: { pelvis: [0.1, 0, 0], spine: [0.15, 0, 0], chest: [0.3, -0.15, 0], head: [-0.15, 0.15, 0], shR: [0.2, 0, -0.35], elbR: [-0.5, 0, 0], blade: [0.4, 0, 0], shL: [-0.8, 0, 0.3], elbL: [-0.65, 0, 0], hipL: [-0.8, 0, 0.1], kneeL: [1.2, 0, 0], hipR: [0.25, 0, -0.1], kneeR: [0.45, 0, 0], footL: [-0.25, 0, 0], footR: [0.1, 0, 0] } },
      { t: 0.65, ease: 'outCubic', pose: { pelvis: [0.06, 0, 0], spine: [0.1, 0, 0], chest: [0.35, 0, 0], shL: [-1.2, 0, 0.08], elbL: [-0.15, 0, 0], hipL: [-0.55, 0, 0.05], kneeL: [0.65, 0, 0], hipR: [0.35, 0, -0.08], kneeR: [0.4, 0, 0] } },
      { t: 1.2, ease: 'inQuad', pose: { chest: [0.46, 0, 0], shL: [-1.4, 0, 0.1], elbL: [-0.8, 0, 0], hipL: [-0.8, 0, 0.06], kneeL: [0.9, 0, 0], hipR: [0.45, 0, -0.06], kneeR: [0.35, 0, 0] } },
    ],
    events: [{ t: 0.65, name: 'brace' }],
  },
  {
    id: 'chainRun', dur: 1.6, mask: 'full',
    keys: [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const left = i % 2 === 0;
      return { t: i * 1.6 / 6, ease: 'inOutSine', pose: {
        pelvis: [0.12, left ? -0.1 : 0.1, 0], spine: [0.18, 0, 0], chest: [0.38, left ? 0.12 : -0.12, 0], head: [-0.2, 0, 0],
        shR: [0.45, 0, -0.35], elbR: [-0.9, 0, 0], blade: [0.25, 0, 0], shL: [left ? -1.2 : -0.6, 0, 0.28], elbL: [left ? -0.3 : -0.85, 0, 0],
        hipL: [left ? -1.0 : 0.45, 0, 0.06], kneeL: [left ? 1.35 : 0.25, 0, 0], footL: [left ? -0.3 : 0.2, 0, 0],
        hipR: [left ? 0.45 : -1.0, 0, -0.06], kneeR: [left ? 0.25 : 1.35, 0, 0], footR: [left ? 0.2 : -0.3, 0, 0],
      } };
    }),
    events: [{ t: 0.2, name: 'step' }, { t: 0.73, name: 'step' }, { t: 1.27, name: 'step' }],
  },
  {
    id: 'maskStrike', dur: 1.2, mask: 'full',
    keys: [
      // Подтянутые ноги и клинок над плечом: силуэт перед пикированием.
      { t: 0, pose: { pelvis: [-0.1, 0, 0], spine: [-0.15, 0, 0], chest: [-0.2, -0.12, 0], head: [0.3, 0, 0], shR: [-2.9, 0, -0.15], elbR: [-0.45, 0, 0], blade: [0.15, 0, 0], shL: [-2.4, 0, 0.25], elbL: [-0.8, 0, 0], hipL: [-1.2, 0, 0.08], kneeL: [1.7, 0, 0], hipR: [-0.65, 0, -0.08], kneeR: [1.4, 0, 0], footL: [-0.1, 0, 0], footR: [-0.1, 0, 0] } },
      { t: 0.47, ease: 'inQuad', pose: { pelvis: [0.05, 0, 0], spine: [0.05, 0, 0], chest: [0.15, 0, 0], head: [0.2, 0, 0], shR: [-2.55, 0, -0.12], elbR: [-0.2, 0, 0], blade: [0.15, 0, 0], hipL: [-0.8, 0, 0.08], kneeL: [1.2, 0, 0], hipR: [0.1, 0, -0.08], kneeR: [0.9, 0, 0] } },
      // Точно эта поза используется для вычисления root-space bladeTip ниже.
      { t: MASK_CONTACT, ease: 'inOutSine', pose: { pelvis: [0.05, 0, 0], spine: [0.08, 0, 0], chest: [0.37, 0, 0], head: [0.15, 0, 0], shR: [-0.55, 0, -0.08], elbR: [-0.08, 0, 0], blade: [0, 0, 0], shL: [-1.1, 0, 0.18], elbL: [-0.55, 0, 0], hipL: [-0.65, 0, 0.1], kneeL: [1.1, 0, 0], hipR: [0.25, 0, -0.1], kneeR: [0.7, 0, 0] } },
      { t: 1.2, ease: 'linear', pose: {} },
    ],
    events: [{ t: MASK_CONTACT, name: 'contact' }],
  },
  {
    id: 'chainExit', dur: 1.3, mask: 'full',
    keys: [
      { t: 0, pose: { pelvis: [0.1, 0, 0], chest: [0.25, 0.2, 0], spine: [0.12, 0, 0], head: [-0.1, -0.2, 0], shR: [-0.8, 0, -0.45], elbR: [-0.3, 0, 0], blade: [0.2, 0, 0], shL: [-0.45, 0, 0.8], elbL: [-0.5, 0, 0], hipL: [-0.8, 0, 0.12], kneeL: [1.2, 0, 0], hipR: [0.45, 0, -0.12], kneeR: [0.45, 0, 0] } },
      { t: 0.5, ease: 'linear', pose: {} },
      { t: 0.9, ease: 'inQuad', rootOffset: [0, -0.26, 0], pose: { chest: [0.7, 0.15, 0], spine: [0.25, 0, 0], shR: [-0.5, 0, -0.65], elbR: [-0.4, 0, 0], shL: [-0.8, 0, 0.6], elbL: [-0.2, 0, 0], hipL: [-1.0, 0, 0.14], kneeL: [1.5, 0, 0], hipR: [0.2, 0, -0.12], kneeR: [1.3, 0, 0], footL: [-0.2, 0, 0], footR: [0.2, 0, 0] } },
      { t: 1.3, ease: 'outCubic', rootOffset: [0, 0, 0], pose: { chest: [0.15, 0.12, 0], spine: [0.05, 0, 0], head: [0.08, -0.12, 0], shR: [0.15, 0, -0.3], elbR: [-0.3, 0, 0], blade: [0.4, 0, 0], shL: [0.05, 0, 0.3], elbL: [-0.3, 0, 0], hipL: [-0.25, 0, 0.08], kneeL: [0.3, 0, 0], hipR: [0.15, 0, -0.08], kneeR: [0.25, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0] } },
    ],
  },
];

// Отдельная неподвижная вершина прыжка: без почти нулевой скорости ударного клипа.
EXECUTION_CLIPS.push({
  id: 'chainApex', dur: 0.8, mask: 'full',
  keys: [{ t: 0, pose: EXECUTION_CLIPS.find((c) => c.id === 'maskStrike')!.keys[0].pose }],
});

/** Прыжок начинается читаемым приседом; клинок поднимается за полёт, без смены позы на вершине. */
const airPose = EXECUTION_CLIPS.find((c) => c.id === 'maskStrike')!.keys[0].pose;
EXECUTION_CLIPS.push({
  id: 'executionLeap', dur: 1.9, mask: 'full', keys: [
    { t: 0, pose: { pelvis: [0.05, 0, 0], spine: [0.08, 0, 0], chest: [0.12, 0, 0], shR: [0.1, 0, -0.3], elbR: [-0.4, 0, 0], blade: [0.4, 0, 0], shL: [-0.2, 0, 0.35], elbL: [-0.4, 0, 0], hipL: [-0.3, 0, 0.08], kneeL: [0.45, 0, 0], hipR: [0.1, 0, -0.08], kneeR: [0.4, 0, 0] } },
    { t: 0.5, ease: 'inOutSine', rootOffset: [0, -0.2, 0], pose: { pelvis: [0.22, 0, 0], spine: [0.22, 0, 0], chest: [0.38, -0.12, 0], shR: [0.35, 0, -0.4], elbR: [-0.7, 0, 0], shL: [-0.65, 0, 0.35], hipL: [-0.9, 0, 0.08], kneeL: [1.25, 0, 0], hipR: [-0.55, 0, -0.08], kneeR: [1.05, 0, 0] } },
    { t: 1.25, ease: 'outCubic', rootOffset: [0, 0, 0], pose: { ...airPose, shR: [-2.55, 0, -0.25], hipL: [-1.05, 0, 0.08], kneeL: [1.5, 0, 0] } },
    { t: 1.9, ease: 'inOutSine', pose: { ...airPose } },
  ],
});
const exit = EXECUTION_CLIPS.find((c) => c.id === 'chainExit')!;
EXECUTION_CLIPS.push({ ...exit, id: 'executionLand', dur: 1.5, keys: exit.keys.map((k) => ({ ...k, t: k.t * 1.5 / exit.dur, ease: k.t === 0.9 ? 'inOutSine' : k.ease })) });
EXECUTION_CLIPS.push({
  id: 'guardianSweep', dur: 1.15, mask: 'full', keys: [
    { t: 0, pose: { pelvis: [0.1, 0, 0], spine: [0.25, 0, 0], chest: [0.35, -0.45, 0], shR: [-0.3, 0, -0.45], elbR: [-1.0, 0, 0], blade: [0.1, 0, 0], shL: [-0.6, 0, 0.5], elbL: [-0.6, 0, 0], hipL: [-0.9, 0, 0.15], kneeL: [1.2, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.6, 0, 0] } },
    { t: 0.35, ease: 'inOutSine', pose: { chest: [0.45, -0.6, 0], shR: [-0.5, 0, -0.65], elbR: [-0.8, 0, 0] } },
    { t: 0.62, ease: 'inOutSine', pose: { chest: [0.5, 0.4, 0], shR: [-1.700884, 0.25, 0.2], elbR: [-0.15, 0, 0], blade: [0, 0, 0] } },
    { t: 1.15, ease: 'outCubic', pose: { chest: [0.2, 0.1, 0], shR: [-0.3, 0, -0.2], elbR: [-0.4, 0, 0] } },
  ], events: [{ t: 0.62, name: 'contact' }],
});

/** Два спокойных шага в обход: клинок остаётся внизу до отдельного замаха. */
EXECUTION_CLIPS.push({ id: 'guardianApproach', dur: 1.2, mask: 'full', keys: [0, 1, 2, 3, 4].map((i) => ({ t: i * 0.3, ease: 'inOutSine', pose: { chest: [0.15, i % 2 ? 0.08 : -0.08, 0], spine: [0.1, 0, 0], shR: [0.1, 0, -0.4], elbR: [-0.7, 0, 0], blade: [0.3, 0, 0], shL: [-0.4, 0, 0.3], elbL: [-0.5, 0, 0], hipL: [i % 2 ? -0.5 : 0.35, 0, 0.08], kneeL: [i % 2 ? 0.8 : 0.25, 0, 0], hipR: [i % 2 ? 0.35 : -0.5, 0, -0.08], kneeR: [i % 2 ? 0.25 : 0.8, 0, 0] } })) });

EXECUTION_CLIPS.push({ id: 'cinematicWalk', dur: 2.2, mask: 'full', keys: [
  ...[0, 0.45, 0.9, 1.35, 1.8, 2.2].map((t, i): Key => ({ t, ease: 'inOutSine' as const, pose: { spine: [0.06, 0, 0], chest: [0.1, i === 1 ? -0.06 : i === 3 ? 0.06 : 0, 0], shR: [0.08, 0, -0.3], elbR: [-0.55, 0, 0], blade: [0.3, 0, 0], shL: [i === 1 ? -0.45 : -0.15, 0, 0.3], elbL: [-0.4, 0, 0], hipL: [i === 1 ? -0.5 : i === 3 ? 0.35 : -0.08, 0, 0.06], kneeL: [i === 1 ? 0.75 : 0.2, 0, 0], footL: [i === 1 ? -0.2 : 0, 0, 0], hipR: [i === 3 ? -0.5 : i === 1 ? 0.35 : -0.08, 0, -0.06], kneeR: [i === 3 ? 0.75 : 0.2, 0, 0], footR: [i === 3 ? -0.2 : 0, 0, 0] } })),
] });

// Стопы наземных сцен опираются на пол даже при глубоком приседе и переносе веса.
for (const def of EXECUTION_CLIPS.filter((c) => ['guardianSweep', 'guardianApproach', 'cinematicWalk'].includes(c.id))) {
  const layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout), compiled = new Clip(def, layout);
  for (const key of def.keys) {
    compiled.sample(key.t, skel.rot, { x: 0, y: 0, z: 0, stretch: 1, spin: 0 }); skel.update();
    const left = skel.jointPos(layout.idx('footL'), new THREE.Vector3()).y;
    const right = skel.jointPos(layout.idx('footR'), new THREE.Vector3()).y;
    key.rootOffset = [0, 0.06 - Math.min(left, right), 0];
  }
}

/** FK контакта для любой сценической атаки: эффект принадлежит реальному кончику клинка. */
export function bladeContactRoot(clipId: string, time: number, target: V3, facing: number): V3 {
  const layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout);
  const clip = new Clip(EXECUTION_CLIPS.find((c) => c.id === clipId)!, layout);
  const root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  clip.sample(time, skel.rot, root); skel.y = root.y; skel.update();
  const tip = skel.jointPoint(layout.idx('blade'), 0, -BLADE_LEN - 0.02, 0, new THREE.Vector3());
  const c = Math.cos(facing), s = Math.sin(facing);
  return [target[0] - tip.x * c - tip.z * s, target[1] - tip.y, target[2] + tip.x * s - tip.z * c];
}
export const MASK_CONTACT_TIP: V3 = (() => {
  const r = bladeContactRoot('maskStrike', MASK_CONTACT, [0, 0, 0], 0);
  return [-r[0], -r[1], -r[2]];
})();
export function maskContactRoot(mask: V3, facing: number): V3 { return bladeContactRoot('maskStrike', MASK_CONTACT, mask, facing); }
