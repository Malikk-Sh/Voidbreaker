import * as THREE from 'three';
import { Clip, type ClipDef } from '../clip';
import { RigLayout, Skeleton, type V3 } from '../skeleton';
import { BLADE_LEN, HERO_RIG } from '../../gen/chars/hero';

/** Контакт — событие специального клипа, в секундах времени сцены. */
export const MASK_CONTACT = 0.72;

/**
 * Клипы казни не содержат боевых hitOn/impact и смещения корня: географией ведёт Director.
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
      { t: MASK_CONTACT, ease: 'inExpo', pose: { pelvis: [0.05, 0, 0], spine: [0.08, 0, 0], chest: [0.37, 0, 0], head: [0.15, 0, 0], shR: [-0.55, 0, -0.08], elbR: [-0.08, 0, 0], blade: [0, 0, 0], shL: [-1.1, 0, 0.18], elbL: [-0.55, 0, 0], hipL: [-0.65, 0, 0.1], kneeL: [1.1, 0, 0], hipR: [0.25, 0, -0.1], kneeR: [0.7, 0, 0] } },
      { t: 1.2, ease: 'linear', pose: {} },
    ],
    events: [{ t: MASK_CONTACT, name: 'contact' }],
  },
  {
    id: 'chainExit', dur: 1.3, mask: 'full',
    keys: [
      { t: 0, pose: { pelvis: [0.1, 0, 0], chest: [0.25, 0.2, 0], spine: [0.12, 0, 0], head: [-0.1, -0.2, 0], shR: [-0.8, 0, -0.45], elbR: [-0.3, 0, 0], blade: [0.2, 0, 0], shL: [-0.45, 0, 0.8], elbL: [-0.5, 0, 0], hipL: [-0.8, 0, 0.12], kneeL: [1.2, 0, 0], hipR: [0.45, 0, -0.12], kneeR: [0.45, 0, 0] } },
      { t: 0.5, ease: 'linear', pose: {} },
      { t: 0.9, ease: 'inQuad', pose: { chest: [0.7, 0.15, 0], spine: [0.25, 0, 0], shR: [-0.5, 0, -0.65], elbR: [-0.4, 0, 0], shL: [-0.8, 0, 0.6], elbL: [-0.2, 0, 0], hipL: [-1.0, 0, 0.14], kneeL: [1.5, 0, 0], hipR: [0.2, 0, -0.12], kneeR: [1.3, 0, 0], footL: [-0.2, 0, 0], footR: [0.2, 0, 0] } },
      { t: 1.3, ease: 'outCubic', pose: { chest: [0.15, 0.12, 0], spine: [0.05, 0, 0], head: [0.08, -0.12, 0], shR: [0.15, 0, -0.3], elbR: [-0.3, 0, 0], blade: [0.4, 0, 0], shL: [0.05, 0, 0.3], elbL: [-0.3, 0, 0], hipL: [-0.25, 0, 0.08], kneeL: [0.3, 0, 0], hipR: [0.15, 0, -0.08], kneeR: [0.25, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0] } },
    ],
  },
];

// Отдельная неподвижная вершина прыжка: без почти нулевой скорости ударного клипа.
EXECUTION_CLIPS.push({
  id: 'chainApex', dur: 0.8, mask: 'full',
  keys: [{ t: 0, pose: EXECUTION_CLIPS.find((c) => c.id === 'maskStrike')!.keys[0].pose }],
});

/** Та же FK, что у игрового рига: правка клипа/пропорций не уводит попадание от маски. */
function contactTip(): V3 {
  const layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout);
  const clip = new Clip(EXECUTION_CLIPS.find((c) => c.id === 'maskStrike')!, layout);
  clip.sample(MASK_CONTACT, skel.rot, { x: 0, y: 0, z: 0, stretch: 1, spin: 0 });
  skel.update();
  const tip = skel.jointPoint(layout.idx('blade'), 0, -BLADE_LEN - 0.02, 0, new THREE.Vector3());
  return [tip.x, tip.y, tip.z];
}

export const MASK_CONTACT_TIP = contactTip();

/** Позиция стоп Пилота, при которой кончик клинка касается именованного якоря маски. */
export function maskContactRoot(mask: V3, facing: number): V3 {
  const [x, y, z] = MASK_CONTACT_TIP, c = Math.cos(facing), s = Math.sin(facing);
  return [mask[0] - x * c - z * s, mask[1] - y, mask[2] + x * s - z * c];
}
