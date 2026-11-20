import * as THREE from 'three';
import type { JointDef, RigDef, V3 } from '../../anim/skeleton';
import { GeomBuilder, mat, matAlong, SURF } from '../geom/build';
import { crescent, octa, prism, shard } from '../geom/prims';
import type { RigBuild } from './enemies';

const joints: JointDef[] = [];
function joint(name: string, parent: string | undefined, pos: V3): void {
  joints.push({ name, parent, pos });
}
joint('root', undefined, [0, 0, 0]);
joint('body', 'root', [0, 1.63, -0.28]);
joint('chest', 'body', [0, 0.29, 0.65]);
joint('neck', 'chest', [0, 0.42, 0.72]);
joint('core', 'chest', [0, 0.4, 0.18]);
joint('head', 'neck', [0, 0.19, 0.46]);
joint('jaw', 'head', [0, -0.18, 0.14]);
for (const [side, s] of [
  ['L', 1],
  ['R', -1],
] as const) {
  joint('mantle' + side, 'chest', [s * 0.47, 0.62, -0.21]);
  joint('rib' + side, 'chest', [s * 0.48, 0.46, 0.28]);
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

export const DEVOURER_FINISH = {
  rim: '#b69b96', rimStrength: 0.28, rimPower: 3.1,
  emissive: '#ef3145', emissive2: '#ffc77e', emissiveStrength: 1.53, white: 0.2,
};

/** A suspended shard between two empty rib arches. All the armour, wires and flying vanes share one draw call. */
export function buildDevourer(): RigBuild {
  const b = new GeomBuilder();
  const hide = '#272b33', shale = '#50515c', ivory = '#a48255',
    bone = '#796458', vein = '#621d2a', dark = '#1c1920', gilt = '#c69a60';
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
  // A pointed plate has two differently sloped faces and a raised spine. The outline reads from overhead.
  const plate = (p: V3, size: V3, pitch: number, yaw: number, roll: number, color: string, edge = false) => {
    const frame = mat(...p, pitch, yaw, roll, ...size);
    b.add(octa(1, 0.34, 1), { matrix: frame, color, shade: 0.15, surface: SURF.armor });
    if (edge) {
      const inlay = mat(0, 0.23, -0.05, 0, 0, 0, 0.11, 0.15, 0.71);
      b.add(octa(1, 1, 1), { matrix: frame.clone().multiply(inlay), color: gilt, emissive: -0.22, surface: SURF.metal });
    }
  };
  at('body');
  shell([0, 0.02, -0.3], [0.59, 0.5, 1.12], hide, -0.15);
  for (let i = 0; i < 4; i++) {
    const z = -1.03 + i * 0.46;
    shell([0, 0.2 + i * 0.085, z], [0.38, 0.25, 0.32], shale, -0.12);
    for (const s of [-1, 1]) plate([s * 0.47, 0.22, z], [0.33, 0.43, 0.57], -0.21, s * 0.23, -s * 0.61, i % 2 ? hide : shale, i % 2 === 0);
  }
  at('chest');
  shell([0, -0.25, 0.01], [0.49, 0.31, 0.91], dark, -0.08);
  spar([0, -0.24, -0.66], [0, 0.30, 0.88], 0.21, 0.24, hide);
  at('core');
  b.add(octa(0.32, 0.66, 0.31), { color: '#891f33', emissive: 0.87 });
  for (const s of [-1, 1]) {
    spar([0, 0.59, 0], [s * 0.305, 0.01, 0], 0.022, 0.035, gilt, -0.45);
    spar([s * 0.305, 0.01, 0], [0, -0.62, 0], 0.035, 0.01, gilt);
  }
  at('neck');
  shell([0, 0, 0.23], [0.37, 0.33, 0.65], vein);
  for (let i = 0; i < 5; i++)
    shell([0, -0.29 + i * 0.016, 0.05 + i * 0.12], [0.29, 0.082, 0.052], dark, 0, 0, 0.28 + i * 0.065);
  at('head');
  // Split mask: two long black planes frame a recessed garnet lens. The central cleft stays open.
  for (const s of [-1, 1]) {
    plate([s * 0.32, 0.17, 0.34], [0.36, 0.72, 0.94], 0.16, -s * 0.16, -s * 0.34, shale, true);
    plate([s * 0.46, 0.025, 0.09], [0.23, 0.42, 0.72], -0.16, s * 0.13, -s * 0.65, hide);
    spar([s * 0.39, 0.29, 0.12], [s * 0.63, 0.52, -0.21], 0.16, 0.105, hide);
    spar([s * 0.63, 0.52, -0.21], [s * 0.68, s > 0 ? 0.86 : 0.68, -0.44], 0.107, 0.015, gilt);
  }
  b.add(octa(0.105, 0.21, 0.68), { matrix: mat(0, 0.175, 0.31, 0.12), color: vein, emissive: 0.97 });
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
    // Hollow cheek vents sit outside the jaw hinge, leaving the throat visible through the mask.
    for (let i = 0; i < 3; i++) {
      const z = -0.18 + i * 0.21;
      plate([s * (0.54 - i * 0.026), 0.08, z], [0.11, 0.74, 0.32], -0.43, -s * 0.24, s * 0.32, i === 1 ? ivory : shale, true);
      spar([s * 0.57, 0.21, z], [s * 0.59, -0.06, z + 0.11], 0.024, 0.012, gilt, -0.36);
    }
    spar([s * 0.45, -0.1, 0.12], [s * 0.31, -0.13, 0.82], 0.13, 0.07, bone);
    for (let i = 0; i < 5; i++) {
      const z = 0.12 + i * 0.15,
        x = s * (0.46 - i * 0.044);
      spar([x, -0.1, z], [x * 0.97, -0.27 - (i === 1 ? 0.16 : 0.04), z + 0.05], 0.068, 0.008, ivory);
      at('jaw');
      spar([x * 0.95, -0.065, z], [x * 0.94, 0.09, z + 0.015], 0.052, 0.008, bone);
      at('head');
    }
    at('jaw');
    // A gapped bronze rail across the mandible picks out its opening against the black mouth.
    spar([s * 0.405, -0.09, -0.16], [s * 0.49, -0.13, 0.37], 0.06, 0.043, gilt, -0.22);
    spar([s * 0.49, -0.13, 0.37], [s * 0.22, -0.095, 0.93], 0.045, 0.017, gilt);
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
    at('rib' + side);
    for (let i = 0; i < 4; i++) {
      const z = 0.37 - i * 0.28;
      spar([0, 0.045, z], [s * (0.49 - i * 0.035), -0.21, z - 0.08], 0.10, 0.082, i % 2 ? shale : bone);
      spar([s * (0.49 - i * 0.035), -0.21, z - 0.08], [s * 0.07, -0.74, z - 0.15], 0.08, 0.02, gilt);
    }
    at('mantle' + side);
    // Two resonators of unequal height fold like the arms of a broken instrument.
    // Large voids between the spars expose the sky and separate the silhouette from the quarry floor.
    const h = s > 0 ? 1.68 : 1.29;
    spar([0, 0, 0], [s * 0.9, h * 0.59, -0.48], 0.205, 0.14, hide);
    spar([s * 0.9, h * 0.59, -0.48], [s * 0.71, h, -0.87], 0.145, 0.055, shale);
    b.add(crescent(0.69, 0.15, 2.62, 0.105, 10), {
      matrix: mat(s * 0.43, h * 0.58, -0.56, -0.48, s * 0.19, -s * 0.49), color: gilt, surface: SURF.metal,
    });
    for (let i = 0; i < 3; i++) {
      const k = i / 3;
      spar([s * (0.17 + k * 0.57), 0.19 + h * k * 0.38, -0.14 - k * 0.31],
        [s * (0.26 + k * 0.62), h * (0.87 + 0.07 * k), -0.73 + 0.12 * k], 0.017, 0.012, gilt, i === 1 ? 0.49 : -0.25);
      plate([s * (0.4 + k * 0.72), 0.22 + h * k * 0.54, -0.48 - k * 0.34],
        [0.25, 0.42, 0.81 - 0.19 * k], -0.39, -s * 0.36, -s * 0.29, i % 2 ? shale : hide, true);
    }
    at('shoulder' + side);
    shell([s * 0.12, -0.05, 0], [0.395, 0.4, 0.48], hide);
    // Inset spindle, keeper rings and a boss on the outer face of the scapula.
    b.add(prism(12, 0.32, 0.32, 0.13), { matrix: mat(s * 0.36, -0.08, 0, 0, 0, -s * Math.PI / 2), color: bone, surface: SURF.metal });
    for (const r of [0.2, 0.315]) b.add(new THREE.TorusGeometry(r, 0.036, 4, 14), {
      matrix: mat(s * 0.51, -0.08, 0, 0, Math.PI / 2), color: gilt, emissive: -0.3, surface: SURF.metal,
    });
    b.add(octa(0.12, 0.135, 0.135), { matrix: mat(s * 0.51, -0.08, 0), color: hide, emissive: 0.32 });
    for (let i = 0; i < 3; i++) plate([s * (0.18 + i * 0.07), 0.26 - i * 0.17, -i * 0.105],
      [0.48 - i * 0.06, 0.5, 0.68], -0.21, s * 0.18, -s * 0.44, i === 1 ? shale : hide, i === 0);
    spar([0, 0, 0], [s * 0.34, -0.87, -0.25], 0.32, 0.21, hide);
    for (let i = 0; i < 3; i++) {
      const y = -0.32 - i * 0.185;
      plate([s * (0.24 + i * 0.07), y, -0.015 - i * 0.06], [0.31, 0.62, 0.34],
        -0.38, -s * 0.14, -s * 0.45, i === 0 ? bone : shale, true);
    }
    at('elbow' + side);
    const end: V3 = [s * 0.12, -0.96, 0.64];
    for (const k of [0.12, 0.42, 0.79]) {
      const r = 0.26 - k * 0.1;
      b.add(prism(8, r + 0.026, r + 0.019, k === 0.79 ? 0.095 : 0.068), {
        matrix: matAlong(end[0] * k, end[1] * k, end[2] * k, ...end), color: gilt, emissive: -0.22, surface: SURF.metal,
      });
    }
    spar([s * 0.21, -0.04, 0.08], [s * 0.25, -0.78, 0.58], 0.059, 0.035, gilt, -0.22);
    spar([-s * 0.08, -0.09, 0.18], [-s * 0.035, -0.78, 0.64], 0.046, 0.029, vein, 0.32);
    spar([0, 0, 0], [s * 0.12, -0.96, 0.64], 0.25, 0.15, shale);
    spar([s * 0.12, -0.07, 0], [s * 0.22, -0.72, 0.49], 0.14, 0.06, bone);
    at('paw' + side);
    shell([0, -0.015, 0.12], [0.39, 0.17, 0.42], dark);
    plate([0, 0.11, 0.26], [0.32, 0.29, 0.49], -0.14, 0, 0, shale, true);
    for (let i = -1; i <= 1; i++) {
      const x = i * 0.17;
      spar([x, 0, 0.14], [x * 1.6, -0.025, 0.49 - 0.06 * Math.abs(i)], 0.1, 0.075, shale);
      spar(
        [x * 1.6, -0.025, 0.49 - 0.06 * Math.abs(i)],
        [x * 2.08, -0.11, 0.91 - 0.09 * Math.abs(i)],
        0.082,
        0.006,
        ivory
      );
    }
    at('hip' + side);
    shell([s * 0.04, -0.22, 0.1], [0.36, 0.54, 0.47], shale, -0.35);
    spar([0, 0, 0], [s * 0.12, -0.68, 0.36], 0.33, 0.18, hide);
    for (let i = 0; i < 2; i++) plate([s * 0.19, -0.12 - 0.22 * i, 0.16], [0.27, 0.44, 0.49], -0.55, s * 0.32, -s * 0.59, shale, true);
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
  at('tailTip');
  for (const s of [-1, 1]) {
    spar([0, -0.06, -0.38], [s * 0.23, 0.03, -0.85], 0.13, 0.085, shale);
    spar([s * 0.23, 0.03, -0.85], [s * 0.16, 0.15, -1.34], 0.09, 0.012, gilt, -0.22);
  }
  return { rig: DEVOURER_RIG, geometry: b.build() };
}
