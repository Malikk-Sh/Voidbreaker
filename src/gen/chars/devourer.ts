import * as THREE from 'three';
import type { JointDef, RigDef, V3 } from '../../anim/skeleton';
import { GeomBuilder, mat, matAlong, SURF } from '../geom/build';
import { lathe, prism, shard } from '../geom/prims';
import type { RigBuild } from './enemies';

const joints: JointDef[] = [];
function joint(name: string, parent: string | undefined, pos: V3): void {
  joints.push({ name, parent, pos });
}
joint('root', undefined, [0, 0, 0]);
joint('body', 'root', [0, 1.63, -0.28]);
joint('chest', 'body', [0, 0.29, 0.65]);
joint('neck', 'chest', [0, 0.28, 0.72]);
joint('head', 'neck', [0, 0.19, 0.46]);
joint('jaw', 'head', [0, -0.18, 0.14]);
for (const [side, s] of [
  ['L', 1],
  ['R', -1],
] as const) {
  joint('fin' + side, 'head', [s * 0.5, 0.12, -0.08]);
  joint('gill' + side, 'neck', [s * 0.41, -0.08, 0.1]);
  joint('shoulder' + side, 'chest', [s * 0.81, 0.03, 0.46]);
  joint('elbow' + side, 'shoulder' + side, [s * 0.34, -0.87, -0.25]);
  joint('paw' + side, 'elbow' + side, [s * 0.12, -0.96, 0.64]);
  joint('hip' + side, 'body', [s * 0.58, -0.02, -0.82]);
  joint('hock' + side, 'hip' + side, [s * 0.12, -0.68, 0.36]);
  joint('heel' + side, 'hock' + side, [0, -0.81, -0.47]);
}
joint('tail', 'body', [0, 0.06, -1.08]);
joint('tailMid', 'tail', [0, -0.06, -0.82]);
joint('tailTip', 'tailMid', [0, -0.12, -0.76]);
export const DEVOURER_RIG: RigDef = { id: 'devourer', joints };

/** Rigid pieces share one draw call; the gills rotate clear of the lit throat. */
export function buildDevourer(): RigBuild {
  const b = new GeomBuilder();
  const hide = '#283747',
    shale = '#3e5263',
    ivory = '#dbcba7',
    bone = '#aa977d',
    vein = '#93533d',
    dark = '#18202b';
  const index = new Map(joints.map((j, i) => [j.name, i]));
  const at = (name: string) => {
    b.joint = index.get(name)!;
  };
  const shell = (p: V3, size: V3, color: string, pitch = 0, roll = 0, em = 0) => {
    b.add(new THREE.IcosahedronGeometry(1, 1), {
      matrix: mat(...p, pitch, 0, roll, ...size),
      color,
      emissive: em,
      shade: 0.09,
    });
  };
  const spar = (p: V3, q: V3, r0: number, r1: number, color: string, em = 0) => {
    const dx = q[0] - p[0],
      dy = q[1] - p[1],
      dz = q[2] - p[2];
    b.add(prism(7, r0, r1, Math.hypot(dx, dy, dz)), {
      matrix: matAlong(...p, dx, dy, dz),
      color,
      emissive: em,
      shade: 0.12,
    });
  };
  at('body');
  shell([0, 0, -0.25], [0.77, 0.63, 1.15], hide, -0.12);
  at('chest');
  shell([0, 0, 0.04], [1.02, 0.79, 1.04], hide, -0.14);
  for (let i = 0; i < 6; i++) {
    const z = -0.94 + i * 0.35;
    at(i < 3 ? 'body' : 'chest');
    const zz = i < 3 ? z : z - 0.65;
    shell([0, 0.52 + 0.04 * i, zz], [0.32, 0.21, 0.35], shale);
    spar([0, 0.55, zz], [0, 0.85 + (i % 3) * 0.14, zz - 0.34], 0.18, 0.025, bone);
  }
  at('neck');
  shell([0, 0, 0.23], [0.48, 0.46, 0.65], vein);
  for (let i = 0; i < 5; i++)
    shell([0, -0.29 + i * 0.016, 0.05 + i * 0.12], [0.32, 0.14, 0.075], dark, 0, 0, 0.85 + i * 0.1);
  at('head');
  // A continuous eyeless casque, swept forward to a chipped prow.
  const casque = lathe(
    [
      [0.03, -0.62],
      [0.52, -0.45],
      [0.68, -0.12],
      [0.62, 0.34],
      [0.43, 0.68],
      [0.24, 0.88],
      [0.06, 0.96],
    ],
    14
  );
  b.add(casque, { matrix: mat(0, 0.1, 0.15, Math.PI / 2, 0, 0, 1, 1, 0.61), color: ivory, shade: 0.075 });
  shell([0, 0.41, 0.18], [0.15, 0.095, 0.64], bone, 0.12);
  // A forked brow and chipped nasal blade break up the pale front plane.
  for (const s of [-1, 1]) {
    spar([s * 0.36, 0.38, 0.02], [s * 0.28, 0.35, 0.51], 0.105, 0.07, bone);
    spar([s * 0.28, 0.35, 0.51], [s * 0.07, 0.16, 1.2], 0.075, 0.012, ivory);
    spar([s * 0.49, -0.02, 0.31], [s * 0.52, -0.31, 0.68], 0.13, 0.065, ivory);
    spar([s * 0.52, -0.31, 0.68], [s * 0.37, s > 0 ? -0.59 : -0.43, 0.81], 0.068, 0.016, bone);
    for (let i = 0; i < 4; i++) {
      const z = 0.03 + i * 0.12;
      spar([s * (0.5 - i * 0.022), 0.28 - i * 0.014, z], [s * (0.6 - i * 0.032), 0.13, z + 0.07], 0.022, 0.008, dark);
    }
  }
  at('jaw');
  shell([0, -0.09, 0.38], [0.48, 0.13, 0.7], shale);
  for (const [side, s] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    at('head');
    spar([s * 0.45, -0.1, 0.12], [s * 0.31, -0.13, 0.82], 0.13, 0.07, bone);
    for (let i = 0; i < 5; i++) {
      const z = 0.12 + i * 0.15,
        x = s * (0.46 - i * 0.044);
      spar([x, -0.1, z], [x * 0.97, -0.27 - (i === 1 ? 0.16 : 0.04), z + 0.05], 0.068, 0.008, ivory);
      at('jaw');
      spar([x * 0.95, -0.065, z], [x * 0.94, 0.09, z + 0.015], 0.052, 0.008, bone);
      at('head');
    }
    at('fin' + side);
    shell([s * 0.16, 0.08, -0.18], [0.13, 0.37, 0.55], shale, -0.44, -s * 0.48);
    for (let i = 0; i < 3; i++)
      spar([s * 0.08, 0.02, -0.04], [s * (0.33 + i * 0.045), 0.2 + i * 0.095, -0.39 - i * 0.09], 0.055, 0.015, bone);
    at('gill' + side);
    for (let i = 0; i < 3; i++)
      shell(
        [s * (0.045 + i * 0.02), -0.07, 0.1 - i * 0.18],
        [0.13, 0.33, 0.23],
        i === 1 ? ivory : bone,
        -0.45,
        -s * 0.22
      );
    at('chest');
    for (let i = 0; i < 5; i++) {
      const z = 0.46 - i * 0.25;
      spar([s * (0.6 - i * 0.025), 0.51, z], [s * (0.91 - i * 0.025), 0.04, z - 0.19], 0.115, 0.085, bone);
      spar([s * (0.91 - i * 0.025), 0.04, z - 0.19], [s * 0.62, -0.44, z - 0.29], 0.085, 0.025, bone);
    }
    at('shoulder' + side);
    shell([s * 0.12, -0.05, 0], [0.47, 0.48, 0.56], shale);
    shell([s * 0.25, 0.19, 0.02], [0.37, 0.2, 0.55], bone, 0.13, -s * 0.3);
    spar([0, 0, 0], [s * 0.34, -0.87, -0.25], 0.32, 0.21, hide);
    at('elbow' + side);
    spar([0, 0, 0], [s * 0.12, -0.96, 0.64], 0.25, 0.15, shale);
    spar([s * 0.12, -0.07, 0], [s * 0.22, -0.72, 0.49], 0.14, 0.06, bone);
    at('paw' + side);
    shell([0, -0.015, 0.12], [0.32, 0.14, 0.38], hide);
    for (let i = -1; i <= 1; i++) {
      const x = i * 0.17;
      spar([x, 0, 0.14], [x * 1.6, -0.025, 0.49 - 0.06 * Math.abs(i)], 0.1, 0.075, shale);
      spar(
        [x * 1.6, -0.025, 0.49 - 0.06 * Math.abs(i)],
        [x * 1.8, -0.11, 0.75 - 0.09 * Math.abs(i)],
        0.082,
        0.006,
        ivory
      );
    }
    at('hip' + side);
    shell([s * 0.04, -0.22, 0.1], [0.36, 0.54, 0.47], shale, -0.35);
    spar([0, 0, 0], [s * 0.12, -0.68, 0.36], 0.33, 0.18, hide);
    at('hock' + side);
    spar([0, 0, 0], [0, -0.81, -0.47], 0.17, 0.105, bone);
    at('heel' + side);
    shell([0, -0.025, 0.16], [0.19, 0.11, 0.36], dark);
    for (const x of [-0.1, 0.1]) spar([x, -0.02, 0.26], [x * 1.3, -0.1, 0.54], 0.065, 0.01, ivory);
  }
  for (const [i, name] of ['tail', 'tailMid', 'tailTip'].entries()) {
    at(name);
    const len = 0.83 - i * 0.07;
    spar([0, 0, 0], [0, -0.1, -len], 0.33 - i * 0.09, 0.23 - i * 0.09, hide);
    for (const s of [-1, 1])
      b.add(shard(0.49 - i * 0.045, 0.13, 5, 0.12, i), {
        matrix: matAlong(s * 0.14, 0.03, -0.26, s * 0.42, 0.46, -1),
        color: bone,
        surface: SURF.armor,
      });
  }
  return { rig: DEVOURER_RIG, geometry: b.build() };
}
