import * as THREE from 'three';
import { Clip, type ClipDef, type Key } from '../clip';
import { RigLayout, Skeleton, type V3 } from '../skeleton';
import { BLADE_LEN, HERO_RIG } from '../../gen/chars/hero';

/** Контакт — событие специального клипа, в секундах времени сцены. */
export const MASK_CONTACT = 0.72;
/** Замедлен только замах. Последние 80 мс до контакта — быстрый разрез. */
export const MASK_RELEASE = 0.64;
/** Рубка попадает рабочим участком лезвия, оставляя кончик пройти за силуэт цели. */
export const FINISHER_EDGE = 0.72;
export const FINISHER_EDGE_Y = -BLADE_LEN * FINISHER_EDGE - 0.02;

type FinisherId = 'maskStrike' | 'gateCrush' | 'bellBreak';

/** Вес начинается тазом, затем грудью; руки разгоняют меч только после переноса корпуса. */
function finisherAttack(id: FinisherId): ClipDef {
  const bell = id === 'bellBreak', gate = id === 'gateCrush';
  const dur = gate ? 1.15 : bell ? 1.2 : 1.25;
  const twist = bell ? 0.38 : gate ? 0 : 0.16;
  // Размыкание принадлежит следующему клипу отталкивания: ранний отпуск заставляет кисть прыгать на стыке.
  return { id, dur, mask: 'full', twoHanded: { start: -0.08, full: 0, release: dur, end: dur + 0.2 }, keys: [
    { t: 0, pose: { pelvis: [-0.1, -twist * 0.6, 0], spine: [-0.12, 0, 0], chest: [-0.18, -twist, 0], head: [0.22, twist * 0.6, 0], shR: [-1.95, 0, 0.48], elbR: [-0.65, 0, 0], handR: [0.02, 0, 0], blade: [0.12, 0, 0], shL: [-2.3, 0, -0.4], elbL: [-1.0, 0, 0], handL: [0, 0, 0], hipL: [-1.1, 0, 0.1], kneeL: [1.6, 0, 0], hipR: [-0.55, 0, -0.1], kneeR: [1.3, 0, 0], footL: [-0.1, 0, 0], footR: [-0.1, 0, 0] } },
    // Таз уже начинает поворот, плечи и клинок ещё сзади — читаемая натяжка всей цепи.
    { t: 0.3, ease: 'inOutSine', pose: { pelvis: [0.12, twist * 0.15, 0], hipL: [-0.9, 0, 0.1], kneeL: [1.4, 0, 0], hipR: [-0.25, 0, -0.1], kneeR: [1.1, 0, 0] } },
    { t: 0.44, ease: 'inQuad', pose: { spine: [0.1, twist * 0.15, 0], chest: [0.02, -twist * 0.55, 0], head: [0.15, twist * 0.4, 0] } },
    { t: MASK_RELEASE, ease: 'inQuad', pose: { pelvis: [0.16, twist * 0.3, 0], chest: [0.17, -twist * 0.2, 0], shR: [-1.85, 0, 0.46], elbR: [-0.65, 0, 0], blade: [0.08, 0, 0], hipL: [-0.7, 0, 0.1], kneeL: [1.2, 0, 0], hipR: [0.1, 0, -0.1], kneeR: [0.8, 0, 0] } },
    // На контакте локти ещё согнуты: есть запас для сжатия и передачи импульса, руки не растянуты.
    { t: MASK_CONTACT, ease: 'inCubic', pose: { pelvis: [0.2, twist * 0.7, 0], spine: [0.13, twist * 0.2, 0], chest: [0.4, twist * 0.55, bell ? 0.12 : 0], shR: [-0.65, 0, 0.46], elbR: [-0.84, 0, 0], handR: [-0.05, 0, 0], blade: [0, 0, bell ? -0.18 : 0], shL: [-1.1, 0, -0.35], elbL: [-0.9, 0, 0], hipL: [-0.65, 0, 0.1], kneeL: [1.1, 0, 0], hipR: [0.25, 0, -0.1], kneeR: [0.7, 0, 0] } },
    // 50 мс сопротивления материала: запястья остаются на рукояти, локти и грудь пружинят.
    { t: MASK_CONTACT + 0.05, ease: 'outCubic', pose: { pelvis: [0.215, twist * 0.72, 0], chest: [gate ? 0.415 : 0.41, twist * 0.57, bell ? 0.125 : 0], shR: [-0.655, 0, 0.46], elbR: [-0.9, 0, 0], head: [0.12, -twist * 0.1, 0] } },
    // Меч продолжает путь после соприкосновения: это разрубание, а не остановленный тычок.
    { t: MASK_CONTACT + 0.18, ease: 'inOutSine', pose: { pelvis: [0.28, twist, 0], spine: [0.2, twist * 0.4, 0], chest: [gate ? 0.64 : 0.58, twist * 1.35, bell ? 0.2 : 0.04], shR: [-0.3, 0, bell ? 0.65 : 0.45], elbR: [-0.72, 0, 0], handR: [-0.1, 0, 0], blade: [-0.08, 0, bell ? -0.25 : 0], hipL: [-0.45, 0, 0.1], kneeL: [1.0, 0, 0], hipR: [0.35, 0, -0.1], kneeR: [0.75, 0, 0] } },
    ...(bell ? [{ t: MASK_CONTACT + 0.24, ease: 'outCubic' as const, pose: { pelvis: [0.24, 0.42, 0.06] as V3, chest: [0.45, 0.66, 0.18] as V3, shR: [-0.12, 0, 0.62] as V3, elbR: [-0.68, 0, 0] as V3 } }] : []),
    { t: dur, ease: 'outCubic', pose: { pelvis: [0.12, twist * 0.35, 0], spine: [0.1, 0, 0], chest: [0.27, twist * 0.4, 0], shR: [-0.7, 0, 0.4], elbR: [-0.85, 0, 0], handR: [0, 0, 0], blade: [0.08, 0, 0], shL: [-0.6, 0, 0.55], elbL: [-0.6, 0, 0] } },
  ], events: [{ t: MASK_CONTACT, name: 'contact' }] };
}

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
  finisherAttack('maskStrike'),
  finisherAttack('gateCrush'),
  finisherAttack('bellBreak'),
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
  id: 'executionLeap', dur: 1.9, mask: 'full', twoHanded: { start: 0.25, full: 0.75, release: 1.9, end: 2.05 }, keys: [
    { t: 0, pose: { pelvis: [0.05, 0, 0], spine: [0.08, 0, 0], chest: [0.12, 0, 0], shR: [0.1, 0, 0.35], elbR: [-0.8, 0, 0], handR: [0, 0, 0], blade: [0.08, 0, 0], shL: [-0.2, 0, 0.35], elbL: [-0.4, 0, 0], handL: [0, 0, 0], hipL: [-0.3, 0, 0.08], kneeL: [0.45, 0, 0], hipR: [0.1, 0, -0.08], kneeR: [0.4, 0, 0] } },
    { t: 0.5, ease: 'inOutSine', rootOffset: [0, -0.2, 0], pose: { pelvis: [0.22, 0, 0], spine: [0.22, 0, 0], chest: [0.38, -0.12, 0], shR: [-0.6, 0, 0.45], elbR: [-1.0, 0, 0], shL: [-0.65, 0, 0.35], hipL: [-0.9, 0, 0.08], kneeL: [1.25, 0, 0], hipR: [-0.55, 0, -0.08], kneeR: [1.05, 0, 0] } },
    { t: 1.25, ease: 'outCubic', rootOffset: [0, 0, 0], pose: { ...airPose, shR: [-1.95, 0, 0.48], hipL: [-1.05, 0, 0.08], kneeL: [1.5, 0, 0] } },
    { t: 1.9, ease: 'inOutSine', pose: { ...airPose } },
  ],
});
EXECUTION_CLIPS.push({ id: 'executionLand', dur: 1.5, mask: 'full', twoHanded: { start: -0.1, full: 0, release: 0.22, end: 0.48 }, keys: [
  { t: 0, pose: { pelvis: [0.16, 0, 0], spine: [0.12, 0, 0], chest: [0.35, 0.16, 0], head: [-0.05, -0.1, 0], shR: [-0.8, 0, 0.4], elbR: [-0.85, 0, 0], handR: [0, 0, 0], blade: [0.08, 0, 0], shL: [-0.5, 0, 0.6], elbL: [-0.6, 0, 0], handL: [0, 0, 0], hipL: [-0.8, 0, 0.12], kneeL: [1.2, 0, 0], hipR: [-0.8, 0, -0.1], kneeR: [1.25, 0, 0], footL: [-0.1, 0, 0], footR: [-0.1, 0, 0] } },
  // Вектор отлёта рождается от видимого разгибания левой ноги, пока вторая ещё под корпусом.
  { t: 0.12, ease: 'outCubic', pose: { pelvis: [0.02, 0, 0], spine: [0.08, 0, 0], chest: [0.2, 0.1, 0], hipL: [-0.18, 0, 0.1], kneeL: [0.35, 0, 0], footL: [0, 0, 0], hipR: [-0.95, 0, -0.1], kneeR: [1.4, 0, 0] } },
  { t: 0.4, ease: 'inOutSine', pose: { pelvis: [0.08, 0, 0], chest: [0.28, 0.1, 0], hipL: [-0.4, 0, 0.1], kneeL: [0.85, 0, 0], hipR: [-0.65, 0, -0.1], kneeR: [1.2, 0, 0], shL: [-0.9, 0, 0.8], elbL: [-0.35, 0, 0] } },
  { t: 0.8, ease: 'inOutSine', pose: { pelvis: [0.1, 0, 0], chest: [0.42, 0.1, 0], hipL: [-0.25, 0, 0.08], kneeL: [0.45, 0, 0], hipR: [-0.15, 0, -0.08], kneeR: [0.5, 0, 0], shL: [-0.8, 0, 0.65], elbL: [-0.3, 0, 0] } },
  // Посадка идёт через сгибание таза/коленей; стопы посажены на пол ниже, после компиляции FK.
  { t: 1.05, ease: 'inCubic', pose: { pelvis: [0.18, 0, 0], spine: [0.2, 0, 0], chest: [0.62, 0.12, 0], shR: [-0.5, 0, -0.6], elbR: [-0.4, 0, 0], shL: [-0.8, 0, 0.6], elbL: [-0.2, 0, 0], hipL: [-0.95, 0, 0.12], kneeL: [1.4, 0, 0], hipR: [-0.45, 0, -0.12], kneeR: [1.1, 0, 0], footL: [-0.2, 0, 0], footR: [0.12, 0, 0] } },
  { t: 1.5, ease: 'outCubic', pose: { pelvis: [0.03, 0, 0], chest: [0.15, 0.12, 0], spine: [0.05, 0, 0], head: [0.08, -0.12, 0], shR: [0.15, 0, -0.3], elbR: [-0.3, 0, 0], blade: [0.4, 0, 0], shL: [0.05, 0, 0.3], elbL: [-0.3, 0, 0], hipL: [-0.18, 0, 0.08], kneeL: [0.3, 0, 0], hipR: [-0.18, 0, -0.08], kneeR: [0.3, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0] } },
] });
EXECUTION_CLIPS.push({
  id: 'guardianSweep', dur: 1.15, mask: 'full', keys: [
    { t: 0, pose: { pelvis: [0.1, 0, 0], spine: [0.25, 0, 0], chest: [0.35, -0.45, 0], shR: [-0.3, 0, -0.45], elbR: [-1.0, 0, 0], blade: [0.1, 0, 0], shL: [-0.6, 0, 0.5], elbL: [-0.6, 0, 0], hipL: [-0.9, 0, 0.15], kneeL: [1.2, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.6, 0, 0] } },
    { t: 0.35, ease: 'inOutSine', pose: { chest: [0.45, -0.6, 0], shR: [-0.5, 0, -0.65], elbR: [-0.8, 0, 0] } },
    { t: 0.62, ease: 'inOutSine', pose: { chest: [0.5, 0.4, 0], shR: [-2.123363, 0.25, 0.2], elbR: [-0.15, 0, 0], blade: [0, 0, 0] } },
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
{
  const def = EXECUTION_CLIPS.find(c => c.id === 'executionLand')!, layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout), clip = new Clip(def, layout);
  for (const key of def.keys.filter(k => k.t >= 1.05)) {
    clip.sample(key.t, skel.rot, { x: 0, y: 0, z: 0, stretch: 1, spin: 0 }); skel.update();
    const foot = Math.min(skel.jointPos(layout.idx('footL'), new THREE.Vector3()).y, skel.jointPos(layout.idx('footR'), new THREE.Vector3()).y);
    key.rootOffset = [0, 0.06 - foot, 0];
  }
}

/** FK контакта для любой сценической атаки: эффект принадлежит реальному кончику клинка. */
export function bladeContactRoot(clipId: string, time: number, target: V3, facing: number, fraction = 1): V3 {
  const layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout);
  const clip = new Clip(EXECUTION_CLIPS.find((c) => c.id === clipId)!, layout);
  const root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  clip.sample(time, skel.rot, root); skel.y = root.y; skel.update();
  const tip = skel.jointPoint(layout.idx('blade'), 0, -BLADE_LEN * fraction - 0.02, 0, new THREE.Vector3());
  const c = Math.cos(facing), s = Math.sin(facing);
  return [target[0] - tip.x * c - tip.z * s, target[1] - tip.y, target[2] + tip.x * s - tip.z * c];
}
export function bladeEdgeRoot(clipId: string, time: number, target: V3, facing: number): V3 { return bladeContactRoot(clipId, time, target, facing, FINISHER_EDGE); }
export const MASK_CONTACT_TIP: V3 = (() => {
  const r = bladeContactRoot('maskStrike', MASK_CONTACT, [0, 0, 0], 0);
  return [-r[0], -r[1], -r[2]];
})();
export function maskContactRoot(mask: V3, facing: number): V3 { return bladeContactRoot('maskStrike', MASK_CONTACT, mask, facing); }
