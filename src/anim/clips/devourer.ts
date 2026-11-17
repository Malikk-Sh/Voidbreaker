import type { ClipDef, Key } from '../clip';
import type { V3 } from '../skeleton';

type Pose = Record<string, V3>;
const key = (t: number, pose: Pose, y = 0): Key => ({ t, pose, rootOffset: [0, y, 0], ease: 'inOutSine' });
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
export const DEVOURER_CLIPS: ClipDef[] = [
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
