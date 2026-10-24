import type { ClipDef, Key } from '../clip';

/** Секунды сцены от начала extractBlade; этими часами владеет Director. */
export const EXTRACTION_T = { grip: 0.65, releaseFromGround: 1.35, weaponAwake: 2.15, ready: 3.45 } as const;

// Правая рука гасит наклон корпуса вперёд: пока Пилот тянет, рукоять стоит на месте,
// а посаженный клинок не скользит сквозь пол.
const BRACED: Key['pose'] = {
  pelvis: [0, 0, 0], spine: [0.18, 0, 0], chest: [0.45, 0, 0], head: [0.22, 0, 0],
  shR: [-1.2, 0, 0], elbR: [-0.8, 0, 0], handR: [1.37, 0, 0], blade: [0, 0, 0],
  shL: [-0.5, 0, -0.95], elbL: [-0.1, 0, 0], handL: [0, 0, 0],
  hipL: [-0.72, 0, 0.08], kneeL: [1.04, 0, 0], footL: [-0.32, 0, 0],
  hipR: [0.32, 0, -0.08], kneeR: [0.65, 0, 0], footR: [-0.97, 0, 0],
};

/** Поставленные хват, усилие, рывок и осмотр; без боевых событий хитбокса и следа. */
export const EXTRACTION_CLIPS: ClipDef[] = [{
  id: 'extractBlade', dur: EXTRACTION_T.ready, mask: 'full',
  keys: [
    { t: 0, pose: { pelvis: [0, 0, 0], spine: [0.04, 0, 0], chest: [0.1, 0, 0], head: [0.38, 0, 0], shR: [-0.15, 0, -0.18], elbR: [-0.2, 0, 0], handR: [0, 0, 0], blade: [0, 0, 0], shL: [0, 0, 0.15], elbL: [-0.3, 0, 0], hipL: [-0.12, 0, 0.06], kneeL: [0.22, 0, 0], footL: [-0.1, 0, 0], hipR: [0.08, 0, -0.06], kneeR: [0.15, 0, 0], footR: [-0.23, 0, 0] } },
    { t: 0.4, ease: 'inOutSine', rootOffset: [0, -0.08, 0], pose: { ...BRACED, shR: [-1.1, 0, -0.06], head: [0.28, 0, 0], shL: [-0.3, 0, -0.6] } },
    { t: EXTRACTION_T.grip, ease: 'outQuad', rootOffset: [0, -0.12, 0], pose: BRACED },
    // Неподвижная рукоять делает сопротивление читаемым. Усилие несут голова и помогающая рука,
    // стопы и правая рука остаются в позе хвата.
    { t: 1.02, ease: 'inOutSine', rootOffset: [0, -0.12, 0], pose: { ...BRACED, head: [0.03, 0, 0], shL: [-0.54, 0, -0.98], elbL: [-0.14, 0, 0] } },
    { t: EXTRACTION_T.releaseFromGround, ease: 'inQuad', rootOffset: [0, -0.12, 0], pose: { ...BRACED, head: [0.03, 0, 0], shL: [-0.54, 0, -0.98], elbL: [-0.14, 0, 0] } },
    // Тот же клинок выходит из гнезда, прежде чем повернуться к свету.
    { t: 1.8, ease: 'outCubic', rootOffset: [0, -0.04, 0], pose: { pelvis: [0, 0, 0], spine: [0.05, 0, 0], chest: [0.18, 0, 0], head: [-0.06, 0, 0], shR: [-1.0, 0, -0.1], elbR: [-0.12, 0, 0], handR: [0, 0, 0], blade: [0, 0, 0], shL: [-0.5, 0, -0.45], elbL: [-0.4, 0, 0], hipL: [-0.3, 0, 0.09], kneeL: [0.46, 0, 0], footL: [-0.16, 0, 0], hipR: [0.12, 0, -0.09], kneeR: [0.28, 0, 0], footR: [-0.4, 0, 0] } },
    { t: EXTRACTION_T.weaponAwake, ease: 'inOutSine', rootOffset: [0, 0, 0], pose: { pelvis: [0, -0.04, 0], spine: [-0.02, -0.04, 0], chest: [-0.06, -0.08, 0], head: [-0.13, -0.18, 0], shR: [-1.05, 0, -0.5], elbR: [-1.0, 0, 0], blade: [0.1, 0, 0], shL: [-0.2, 0, 0.3], elbL: [-0.5, 0, 0], hipL: [-0.23, 0, 0.1], kneeL: [0.38, 0, 0], footL: [-0.15, 0, 0], hipR: [0.12, 0, -0.1], kneeR: [0.26, 0, 0], footR: [-0.38, 0, 0] } },
    { t: 2.8, ease: 'linear', pose: { head: [-0.1, -0.12, 0], blade: [0.18, 0, 0] } },
    { t: EXTRACTION_T.ready, ease: 'inOutSine', rootOffset: [0, 0, 0], pose: { pelvis: [0, 0, 0], spine: [0.03, 0, 0], chest: [0.08, 0, 0], head: [0, 0, 0], shR: [-0.55, 0, -0.35], elbR: [-0.6, 0, 0], blade: [0.1, 0, 0], shL: [0, 0, 0.28], elbL: [-0.3, 0, 0], hipL: [-0.2, 0, 0.08], kneeL: [0.32, 0, 0], footL: [-0.12, 0, 0], hipR: [0.1, 0, -0.08], kneeR: [0.2, 0, 0], footR: [-0.3, 0, 0] } },
  ],
  events: [
    { t: EXTRACTION_T.grip, name: 'grip' },
    { t: EXTRACTION_T.releaseFromGround, name: 'releaseFromGround' },
    { t: EXTRACTION_T.weaponAwake, name: 'weaponAwake' },
  ],
}];
