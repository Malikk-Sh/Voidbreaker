import type { ClipDef, Key } from '../clip';
import type { V3 } from '../skeleton';

type Pose = Record<string, V3>;
function key(t: number, pose: Pose, y = 0): Key {
  const open = pose.jaw?.[0] ?? 0.07;
  const rigPose: Pose = { ...pose };
  for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
    const ear = pose['fin' + side]?.[2] ?? 0;
    rigPose['mantle' + side] ??= [-0.11 * open, -ear * 0.32, -sign * (0.09 + open * 0.44) - ear * 0.27];
    rigPose['rib' + side] ??= [-0.06 * open, sign * open * 0.16, sign * open * 0.51];
  }
  rigPose.core ??= [0.13 * open, 0.54 * open, -0.12 * open];
  return { t, pose: rigPose, rootOffset: [0, y, 0], ease: 'inOutSine' };
}
function clip(id: string, keys: Key[], loop = false): ClipDef {
  const bones = new Set(keys.flatMap((k) => Object.keys(k.pose)));
  // The shared sampler holds missing channels. Explicit rest keys let the paw plant and the gills close.
  const complete = keys.map((k) => ({
    ...k,
    pose: Object.fromEntries([...bones].map((n) => [n, k.pose[n] ?? ([0, 0, 0] as V3)])),
  }));
  return { id, keys: complete, dur: keys[keys.length - 1].t, loop, mask: 'full' };
}
function mirror(p: Pose): Pose {
  const out: Pose = {};
  for (const [n, [x, y, z]] of Object.entries(p))
    out[n.endsWith('L') ? n.slice(0, -1) + 'R' : n.endsWith('R') ? n.slice(0, -1) + 'L' : n] = [x, -y, -z];
  return out;
}
const rest: Pose = {
  neck: [-0.07, 0, 0],
  jaw: [0.11, 0, 0],
  tail: [0.08, 0.12, 0],
  finL: [0, 0, 0.1],
  finR: [0, 0, -0.1],
};
const hear: Pose = {
  ...rest,
  head: [-0.12, -0.35, -0.22],
  neck: [-0.14, -0.12, 0.1],
  finL: [-0.2, 0.5, 0.45],
  finR: [0, -0.28, -0.13],
  jaw: [0.03, 0, 0],
  tailTip: [0, 0.33, 0],
};
const coil: Pose = {
  chest: [0.18, 0, 0],
  neck: [0.24, 0, 0],
  head: [-0.16, 0, 0],
  jaw: [0.03, 0, 0],
  shoulderL: [-0.28, 0, 0.23],
  shoulderR: [-0.28, 0, -0.23],
  elbowL: [0.5, 0, 0],
  elbowR: [0.5, 0, 0],
  hipL: [-0.45, 0, 0],
  hipR: [-0.45, 0, 0],
  hockL: [0.65, 0, 0],
  hockR: [0.65, 0, 0],
  tail: [-0.26, 0, 0],
};
const stretch: Pose = {
  chest: [-0.09, 0, 0],
  head: [0.09, 0, 0],
  jaw: [0.69, 0, 0],
  shoulderL: [-0.95, 0, -0.15],
  shoulderR: [-0.87, 0, 0.15],
  elbowL: [0.25, 0, 0],
  elbowR: [0.2, 0, 0],
  hipL: [0.78, 0, 0],
  hipR: [0.98, 0, 0],
  tailMid: [0.32, 0.2, 0],
};
const step: Pose = {
  body: [0.025, 0.06, -0.045],
  chest: [-0.04, -0.1, 0.04],
  shoulderL: [-0.38, 0, 0.05],
  elbowL: [0.14, 0, 0],
  shoulderR: [0.34, 0, 0],
  elbowR: [-0.13, 0, 0],
  hipL: [0.36, 0, 0],
  hipR: [-0.33, 0, 0],
  hockR: [0.24, 0, 0],
  tail: [0, 0.18, 0],
  tailMid: [0, 0.21, 0],
  tailTip: [0, 0.26, 0],
};
const rakeWind: Pose = {
  body: [-0.08, 0.27, -0.08],
  chest: [-0.18, 0.47, -0.19],
  neck: [0, -0.55, 0.14],
  shoulderL: [-1.1, 0.18, 0.82],
  elbowL: [-0.39, 0, 0.64],
  pawL: [0, 0.22, 0.12],
  hipR: [-0.24, 0, 0],
  tail: [0, -0.52, 0],
};
const rakeHit: Pose = {
  body: [0.06, -0.32, 0.06],
  chest: [0.15, -0.42, 0.16],
  head: [0.14, -0.14, 0.07],
  jaw: [0.4, 0, 0],
  shoulderL: [-0.93, -0.84, -0.65],
  elbowL: [0.63, -0.22, -0.55],
  pawL: [0.38, 0, 0.1],
  tail: [0, 0.62, 0],
};
const opened: Pose = {
  chest: [0.16, 0, -0.15],
  neck: [-0.46, 0.08, -0.28],
  head: [-0.44, 0, 0.18],
  jaw: [0.95, 0, 0],
  gillL: [0, -0.55, 0.95],
  gillR: [0, 0.55, -0.95],
  shoulderL: [-0.56, 0, 0.4],
  shoulderR: [-0.24, 0, -0.51],
  elbowL: [0.4, 0, 0],
  elbowR: [0.44, 0, 0],
  finL: [0, 0, -0.25],
  finR: [0, 0, 0.26],
  tailMid: [0.2, 0.42, 0],
};
const flinch: Pose = {
  ...opened,
  chest: [-0.12, -0.21, 0.16],
  neck: [-0.71, -0.21, 0.23],
  head: [-0.52, -0.18, -0.34],
  jaw: [1.12, 0, 0],
  tail: [-0.28, -0.36, 0],
  tailTip: [0.23, -0.48, 0],
};
const howl: Pose = {
  ...opened,
  body: [-0.1, 0, 0],
  chest: [-0.28, 0, 0],
  neck: [-0.44, 0, 0],
  head: [-0.37, 0, 0],
  jaw: [1.12, 0, 0],
  finL: [0, 0.56, 0.42],
  finR: [0, -0.56, -0.42],
};
const tailWind: Pose = {
  ...coil, body: [0.05, -0.36, -0.13], neck: [0.09, 0.46, 0.09],
  hipL: [-0.43, -0.31, 0.24], tail: [-0.38, -0.94, -0.16],
  tailMid: [-0.29, -0.81, -0.1], tailTip: [-0.12, -1.03, 0],
};
const tailStrike: Pose = {
  ...stretch, body: [-0.02, 0.43, 0.12], chest: [0.03, 0.29, 0.05],
  neck: [0, -0.55, -0.12], tail: [-0.12, 1.14, 0.04],
  tailMid: [0.16, 0.9, 0], tailTip: [0.12, 0.55, 0],
};
const earsUp: Pose = {
  ...hear, body: [-0.08, 0, 0], neck: [-0.32, -0.16, 0.14], jaw: [0.02, 0, 0],
  finL: [-0.48, 0.82, 0.67], finR: [-0.48, -0.82, -0.67],
  shoulderL: [-0.21, 0, 0.2], shoulderR: [-0.21, 0, -0.2], tail: [-0.38, 0, 0],
};
const groundBlow: Pose = {
  ...coil, chest: [0.39, 0.12, -0.15], neck: [0.53, 0.12, 0.1], head: [-0.19, 0, 0],
  jaw: [0.76, 0, 0], shoulderL: [-0.81, -0.21, 0.31], elbowL: [0.78, 0, 0.06],
  shoulderR: [-0.56, 0, -0.28], tailMid: [-0.44, 0.2, 0],
};
const rearUp: Pose = {
  ...coil, body: [-0.19, 0.04, 0], chest: [-0.38, 0, 0], neck: [-0.13, 0, 0],
  shoulderL: [-1.02, -0.13, 0.42], shoulderR: [-1.02, 0.13, -0.42],
  elbowL: [0.94, 0, 0.16], elbowR: [0.94, 0, -0.16], tail: [0.39, 0, 0],
};
const hammer: Pose = {
  ...groundBlow, body: [0.21, 0, 0], chest: [0.32, 0, 0], jaw: [0.48, 0, 0],
  shoulderL: [-0.46, 0, 0.37], shoulderR: [-0.46, 0, -0.37], elbowL: [0.18, 0, 0], elbowR: [0.18, 0, 0],
};
const drawBreath: Pose = {
  ...earsUp, chest: [-0.33, 0, 0], head: [0.19, 0, 0], jaw: [1.25, 0, 0],
  finL: [-0.53, 0.84, 0.71], finR: [-0.53, -0.84, -0.71],
  gillL: [0, -0.72, 1.04], gillR: [0, 0.72, -1.04], tailMid: [-0.38, 0.19, 0],
};
const spit: Pose = {
  ...stretch, body: [0.2, 0, 0], neck: [0.07, 0, 0], head: [-0.12, 0, 0], jaw: [0.89, 0, 0],
  finL: [-0.22, -0.21, -0.42], finR: [-0.22, 0.21, 0.42],
};
const dropped: Pose = {
  ...opened, body: [0.16, -0.07, -0.32], chest: [0.25, 0.07, -0.13],
  neck: [-0.48, 0.22, 0.18], head: [-0.22, 0.2, 0.32],
  shoulderL: [-0.79, -0.22, 0.71], elbowL: [0.97, 0, 0.26],
  shoulderR: [0.29, 0.06, -0.52], elbowR: [0.78, 0.12, -0.26],
  hipL: [-0.58, 0.12, 0.26], hockL: [1.06, 0, 0], hipR: [-0.3, 0, -0.16],
  hockR: [0.79, 0.08, 0], tailMid: [0.32, 0.58, 0.12], tailTip: [0, 0.67, 0],
};
const bellFlinch: Pose = {
  ...dropped, neck: [-0.66, -0.21, 0.25], head: [-0.42, -0.32, -0.14],
  gillL: [-0.2, -0.39, 1.16], jaw: [1.17, 0, 0], tailTip: [-0.18, -0.41, 0],
};
const folded: Pose = {
  ...coil, head: [0.38, 0, -0.15], neck: [0.28, 0.16, 0], jaw: [0.02, 0, 0],
  mantleL: [0.63, -0.48, 0.65], mantleR: [0.69, 0.34, -0.69], tailTip: [0.2, 0.7, -0.14],
};
const display: Pose = {
  ...rearUp, hipL: [0.08,0,0.065], hipR: [0.08,0,-0.065], hockL: [-0.14,0,0], hockR: [-0.14,0,0],
  shoulderL: [-0.56,-0.12,0.31], shoulderR: [-0.56,0.12,-0.31], elbowL: [0.35,0,0.08], elbowR: [0.35,0,-0.08],
  chest: [-0.22, 0.1, -0.04], jaw: [0.72, 0, 0], neck: [-0.24, -0.11, 0.07],
  mantleL: [-0.35, 0.31, -0.83], mantleR: [-0.27, -0.25, 0.94],
  ribL: [-0.16, 0.13, 0.53], ribR: [-0.17, -0.11, -0.57],
};
const stringDraw: Pose = {
  ...display, body: [-0.08, -0.28, 0.12], chest: [-0.27, -0.2, 0.16], head: [0.06, 0.54, -0.18],
  shoulderL: [-0.98, -0.24, 0.53], elbowL: [0.77, 0.15, 0.17], pawL: [0.42, 0.26, -0.35],
  shoulderR: [-0.31, 0, -0.23], mantleL: [-0.37, 0.52, -1.02], mantleR: [0.1, 0.18, 0.05],
  tail: [-0.19, 0.49, 0], tailMid: [0.09, 0.29, 0.09], core: [-0.16, 0.88, 0.32],
};
const stringRelease: Pose = {
  ...hammer, body: [0.09, 0.21, -0.12], neck: [-0.14, -0.14, 0.1], head: [-0.03, -0.3, -0.11],
  shoulderL: [-0.69, 0.51, -0.36], elbowL: [0.13, 0.36, -0.32], jaw: [0.83, 0, 0],
  mantleL: [0.25, -0.32, 0.16], mantleR: [-0.18, -0.26, 0.71], tailTip: [-0.11, -0.81, -0.09],
};
export const DEVOURER_CLIPS: ClipDef[] = [
  clip('awaken', [key(0, folded, -0.31), key(0.26, { ...folded, head: [0.01, -0.31, -0.11], finL: [-0.26,0.31,0.43] }, -0.28),
    key(0.55, { ...stringDraw, shoulderL: [-0.42, 0.13, 0.19] }, 0.02), key(0.82, display, 0.23), key(1, rest)]),
  clip('pluck', [key(0, rest), key(0.31, stringDraw, 0.08), key(0.62, stringDraw, 0.11),
    key(0.72, stringRelease, -0.18), key(0.85, { ...stringRelease, tailMid: [0.1,-0.68,0] }, -0.13), key(1, rest)]),
  clip('counterpoint', [key(0, rest), key(0.18, stringDraw, 0.24), key(0.36, stringDraw, 0.09),
    key(0.45, stringRelease, -0.19), key(0.56, mirror(stringDraw), 0.24), key(0.71, mirror(stringDraw), 0.33),
    key(0.79, mirror(stringRelease), -0.23), key(1, rest)]),
  clip('reversal', [key(0, rest), key(0.17, stringDraw, 0.23), key(0.26, stringRelease, -0.17),
    key(0.42, mirror(stringDraw), 0.27), key(0.51, mirror(stringRelease), -0.17), key(0.62, folded, -0.28),
    key(0.76, display, 0.17), key(0.85, { ...display, jaw:[1.16,0,0], core:[0,1.42,0] }, 0.41),
    key(1, rest)]),
  clip('unfurl', [key(0, rest), key(0.19, folded, -0.28), key(0.38, stringDraw, 0.22),
    key(0.61, mirror(stringDraw), 0.1), key(0.8, display, 0.12), key(1, rest)]),
  clip('eclipse', [key(0, rest), key(0.35, { ...folded, jaw:[0.44,0,0] }, -0.29),
    key(0.59, { ...display, head:[-0.53,0,0], jaw:[1.12,0,0] }, 0.36),
    key(0.79, { ...display, core:[0,1.76,0], neck:[-0.32,0.19,0] }, 0.28), key(1, rest)]),
  clip('guardThroat', [key(0, dropped, -0.49),
    key(0.62, { ...dropped, jaw: [0.12, 0, 0], neck: [0.29, 0, 0], head: [0.22, 0, 0],
      mantleL: [0.41, -0.38, 0.58], mantleR: [0.45, 0.32, -0.59], gillL: [0,0,0.05], gillR: [0,0,-0.05] }, -0.56),
    key(1, { ...dropped, jaw: [0.07,0,0], neck: [0.31,0,0], head: [0.19,-0.06,0],
      mantleL: [0.49,-0.42,0.62], mantleR: [0.52,0.38,-0.62], gillL: [0,0,0], gillR: [0,0,0] }, -0.53)]),
  clip('bellFall', [key(0, rest), key(0.13, { ...flinch, finL: [0, 0.8, 0.86], finR: [0, -0.8, -0.86] }, 0.09),
    key(0.46, dropped, -0.62), key(0.69, { ...dropped, tailTip: [-0.29, -0.43, 0] }, -0.48), key(1, dropped, -0.53)]),
  clip('bellWoundL', [key(0, dropped, -0.53), key(0.19, bellFlinch, -0.42), key(1, dropped, -0.53)]),
  clip('bellWoundR', [key(0, dropped, -0.53),
    key(0.19, { ...dropped, neck: [-0.66, 0.4, -0.2], head: [-0.42, 0.34, 0.3], jaw: [1.18, 0, 0] }, -0.42),
    key(1, dropped, -0.53)]),
  clip('bellRise', [key(0, dropped, -0.53), key(0.44, { ...coil, head: [-0.31, 0, 0] }, -0.23), key(1, rest)]),
  clip('fault', [
    key(0, rest), key(0.24, rearUp, 0.28), key(0.35, rearUp, 0.35),
    key(0.40, hammer, -0.28), key(0.55, { ...rearUp, head: [-0.24, 0, 0] }, 0.2),
    key(0.73, rearUp, 0.42), key(0.79, hammer, -0.33), key(1, rest),
  ]),
  clip('caveIn', [
    key(0, rest), key(0.19, { ...earsUp, head: [-0.63, 0.15, 0] }, 0.19),
    key(0.34, howl, 0.25), key(0.48, mirror(howl), 0.16), key(0.60, coil, -0.28),
    key(0.71, stretch, 0.08), key(0.81, { ...stretch, jaw: [0.83, 0, 0] }),
    key(0.85, hammer, -0.35), key(1, rest),
  ]),
  clip('inhale', [
    key(0, coil, -0.14), key(0.27, drawBreath, 0.1),
    key(0.75, { ...drawBreath, neck: [-0.26, 0, 0], jaw: [1.39, 0, 0] }, 0.18),
    key(1, { ...coil, gillL: [0, -0.34, 0.51], gillR: [0, 0.34, -0.51] }, -0.14),
  ]),
  clip('vent', [
    key(0, coil, -0.14), key(0.47, { ...coil, head: [-0.13, 0, 0], jaw: [0.29, 0, 0] }, -0.22),
    key(0.64, { ...coil, neck: [-0.29, 0, 0] }, -0.24), key(0.69, spit, 0.08),
    key(0.79, { ...spit, neck: [-0.25, 0, 0] }, 0.13), key(1, rest),
  ]),
  clip('snap', [key(0, rest), key(0.34, { ...coil, chest: [-0.16,0,0], neck: [-0.34,0,0], jaw: [0.9,0,0] }, -0.18),
    key(0.7, { ...coil, head: [-0.42,0,0], jaw: [1.16,0,0] }, -0.26),
    key(0.84, { ...stretch, neck: [0.24,0,0], head: [0.2,0,0], jaw: [0.05,0,0] }, 0.13), key(1, rest)]),
  clip('tailSweep', [key(0, rest), key(0.36, tailWind, -0.14), key(0.69, tailWind, -0.21),
    key(0.82, tailStrike, 0.1), key(1, rest)]),
  clip('soundHunt', [key(0, rest), key(0.2, earsUp, 0.13), key(0.48, mirror(earsUp), 0.16),
    key(0.72, earsUp, 0.15), key(1, mirror(hear), 0.03)]),
  clip('groundCall', [key(0, groundBlow, -0.16), key(0.21, howl, 0.19), key(0.36, mirror(groundBlow), -0.17),
    key(0.52, mirror(groundBlow), -0.11), key(0.78, howl, 0.19), key(1, rest)]),
  clip('listen', [key(0, rest), key(0.31, hear, 0.025), key(0.7, hear, 0.045), key(1, rest)], true),
  clip(
    'stalk',
    [key(0, step), key(0.25, rest, 0.055), key(0.5, mirror(step)), key(0.75, rest, 0.055), key(1, step)],
    true
  ),
  clip('brace', [key(0, rest), key(0.38, hear), key(0.88, coil, -0.24), key(1, coil, -0.24)]),
  clip(
    'gallop',
    [key(0, coil, -0.14), key(0.31, stretch, 0.12), key(0.62, mirror(stretch), 0.08), key(1, coil, -0.14)],
    true
  ),
  clip('rakeL', [
    key(0, rest),
    key(0.53, rakeWind, 0.08),
    key(0.73, rakeWind, 0.1),
    key(0.84, rakeHit, -0.08),
    key(1, rest),
  ]),
  clip('rakeR', [
    key(0, rest),
    key(0.53, mirror(rakeWind), 0.08),
    key(0.73, mirror(rakeWind), 0.1),
    key(0.84, mirror(rakeHit), -0.08),
    key(1, rest),
  ]),
  clip('bound', [
    key(0, coil, -0.18),
    key(0.32, stretch, 0.02),
    key(0.7, { ...stretch, jaw: [0.22, 0, 0] }),
    key(0.91, coil, -0.22),
    key(1, rest),
  ]),
  clip('roar', [key(0, rest), key(0.47, coil, -0.2), key(0.74, howl, 0.14), key(0.88, howl, 0.18), key(1, rest)]),
  clip('crash', [
    key(0, stretch),
    key(0.13, flinch, 0.04),
    key(0.38, opened, -0.26),
    key(0.68, { ...opened, tailTip: [0, -0.73, 0] }, -0.22),
    key(1, opened, -0.22),
  ]),
  clip('woundL', [
    key(0, opened, -0.22),
    key(0.18, flinch, -0.1),
    key(0.5, { ...flinch, jaw: [0.61, 0, 0] }, -0.18),
    key(1, opened, -0.22),
  ]),
  clip('woundR', [
    key(0, opened, -0.22),
    key(0.18, mirror(flinch), -0.1),
    key(0.5, { ...mirror(flinch), jaw: [0.61, 0, 0] }, -0.18),
    key(1, opened, -0.22),
  ]),
  clip('rise', [key(0, opened, -0.22), key(0.38, { ...opened, head: [0.19, 0.16, 0] }, -0.24), key(1, rest)]),
  clip('fall', [
    key(0, rest),
    key(0.2, flinch, 0.1),
    key(0.54, { ...opened, body: [0.05, 0.04, -0.46] }, -0.39),
    key(1, { ...opened, body: [0.18, -0.09, -1.02], tailTip: [0.19, 0.62, 0] }, -0.8),
  ]),
];
