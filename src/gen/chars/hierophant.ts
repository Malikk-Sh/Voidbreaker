import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import type { JointDef, RigDef } from '../../anim/skeleton';
import { GeomBuilder, mat, matAlong } from '../geom/build';
import { jitter, lathe, octa, prism, shard, box } from '../geom/prims';
import { hull8, limb } from './parts';
import type { RigBuild } from './enemies';

const OBS = hexToLinear('#110d15');
const GOLD = hexToLinear('#7a5f2c');

export const ARMS = ['UL', 'UR', 'LL', 'LR'] as const;

/**
 * Иерофант Скорби (GDD §11.1, §15.7): ряса — профиль вращения с рваным краем; голова-колокол с огнём внутри;
 * 4 руки, кадила-октаэдры на цепях (суставные цепочки с маятником).
 */
export function hierophantRig(): RigDef {
  const joints: JointDef[] = [
    { name: 'root', pos: [0, 0, 0] },
    { name: 'body', parent: 'root', pos: [0, 2.3, 0] },
    { name: 'robe', parent: 'body', pos: [0, 0, 0] },
    { name: 'chest', parent: 'body', pos: [0, 1.75, 0] },
    { name: 'bell', parent: 'chest', pos: [0, 0.75, 0.05] },
    { name: 'clapper', parent: 'bell', pos: [0, 0.35, 0] },
  ];
  const armPos: Record<string, [number, number, number]> = { UL: [0.95, 0.35, 0.1], UR: [-0.95, 0.35, 0.1], LL: [0.8, -0.4, 0.25], LR: [-0.8, -0.4, 0.25] };
  for (const a of ARMS) {
    joints.push({ name: `sh${a}`, parent: 'chest', pos: armPos[a] });
    joints.push({ name: `elb${a}`, parent: `sh${a}`, pos: [0, -0.9, 0] });
    joints.push({ name: `hand${a}`, parent: `elb${a}`, pos: [0, -0.85, 0] });
    joints.push({ name: `c1${a}`, parent: `hand${a}`, pos: [0, -0.15, 0] });
    joints.push({ name: `c2${a}`, parent: `c1${a}`, pos: [0, -0.55, 0] });
    joints.push({ name: `censer${a}`, parent: `c2${a}`, pos: [0, -0.55, 0] });
  }
  return { id: 'hierophant', joints };
}

export function buildHierophant(seed = 31): RigBuild {
  const rig = hierophantRig();
  const J = (n: string) => rig.joints.findIndex((j) => j.name === n);
  const b = new GeomBuilder(); const rng = new Rng(seed); b.rng = rng; b.color = OBS;

  // ряса: профиль вращения, рваный край, золотые полосы, багровые швы
  b.joint = J('robe');
  const robe = lathe([[1.55, -1.75], [1.4, -1.2], [1.15, -0.2], [0.95, 0.7], [0.9, 1.3], [1.15, 1.75], [0.6, 1.95], [0.0, 2.0]], 11, 0.1);
  jitter(robe, 0.07, seed, [1, 0.4, 1]);
  b.add(robe, {});
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng.spread(0.1);
    b.add(shard(rng.range(0.5, 1.1), rng.range(0.18, 0.3), 3, 0.3, i), {
      matrix: matAlong(Math.sin(a) * 1.45, -1.6, Math.cos(a) * 1.45, Math.sin(a) * 0.3, -1, Math.cos(a) * 0.3),
    });
  }
  for (const [y, r] of [[-1.35, 1.45], [0.55, 0.97]] as const) {
    b.add(new THREE.TorusGeometry(r, 0.045, 3, 22), { matrix: mat(0, y, 0, Math.PI / 2, 0, 0), color: GOLD, shade: 0.2 });
  }
  // столы (стола) спереди: две золотые полосы с рунами
  for (const sx of [-0.28, 0.28]) {
    b.add(box(0.22, 2.6, 0.04), { matrix: mat(sx, -0.2, 1.08, -0.08, 0, 0), color: GOLD, shade: 0.25 });
    for (let k = 0; k < 4; k++) b.add(box(0.1, 0.1, 0.03), { matrix: mat(sx, 0.6 - k * 0.55, 1.12, -0.08, 0, Math.PI / 4), emissive: 1.2, color: OBS });
  }
  // багровые швы-трещины по рясе
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    let y = -1.5, x = Math.sin(a), z = Math.cos(a);
    for (let k = 0; k < 4; k++) {
      const r0 = 1.42 - (y + 1.5) * 0.17;
      const da = rng.spread(0.12);
      const y1 = y + rng.range(0.3, 0.6);
      const r1 = 1.42 - (y1 + 1.5) * 0.17;
      const nx = Math.sin(a + da), nz = Math.cos(a + da);
      b.add(shard(Math.hypot((nx * r1 - x * r0), y1 - y, (nz * r1 - z * r0)) * 1.05, 0.03, 3, 0.2, k), {
        matrix: matAlong(x * r0, y, z * r0, nx * r1 - x * r0, y1 - y, nz * r1 - z * r0), emissive: 0.9,
      });
      y = y1; x = nx; z = nz;
    }
  }

  // грудь и плечевая мантия из шипов
  b.joint = J('chest');
  hull8(b, 1.5, 0.9, -0.3, 2.0, 1.0, 0.45);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(shard(rng.range(0.6, 1.0), 0.12, 4, 0.25, i + 40), { matrix: matAlong(Math.sin(a) * 0.9, 0.4, Math.cos(a) * 0.55, Math.sin(a), 0.6, Math.cos(a) * 0.6) });
  }
  b.add(prism(8, 0.7, 0.55, 0.2), { matrix: mat(0, 0.42, 0), color: GOLD, shade: 0.25 });

  // голова-колокол: профиль вращения, прорези с огнём, венец шипов
  b.joint = J('bell');
  const bell = lathe([[1.05, 0], [0.95, 0.12], [0.8, 0.5], [0.66, 1.05], [0.62, 1.35], [0.4, 1.55], [0.0, 1.6]], 12);
  b.add(bell, {});
  b.add(new THREE.TorusGeometry(1.0, 0.07, 3, 24), { matrix: mat(0, 0.05, 0, Math.PI / 2, 0, 0), color: GOLD, shade: 0.2 });
  b.add(new THREE.TorusGeometry(0.66, 0.05, 3, 20), { matrix: mat(0, 1.0, 0, Math.PI / 2, 0, 0), color: GOLD, shade: 0.2 });
  // огонь внутри: светящиеся прорези-«глаза» и крест
  // прорези-глаза: раскосые щели, сквозь которые виден огонь
  for (const sx of [-1, 1]) {
    b.add(box(0.34, 0.06, 0.06), { matrix: mat(sx * 0.24, 0.68, 0.76, -0.25, sx * 0.25, sx * -0.35), emissive: -1.7 });
    b.add(box(0.05, 0.38, 0.05), { matrix: mat(sx * 0.12, 0.32, 0.88, -0.2, sx * 0.1, sx * 0.12), emissive: -1.1 });
  }
  // внутренняя поверхность — огонь (видна из-под колокола)
  const inner = lathe([[0.98, 0.02], [0.75, 0.5], [0.6, 1.1], [0.0, 1.45]], 10);
  inner.scale(0.97, 0.97, 0.97);
  b.add(inner, { emissive: -1.6, color: OBS });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.add(shard(rng.range(0.4, 0.75), 0.08, 4, 0.2, i + 70), { matrix: matAlong(Math.sin(a) * 0.4, 1.45, Math.cos(a) * 0.4, Math.sin(a) * 0.5, 1, Math.cos(a) * 0.5) });
  }
  b.joint = J('clapper');
  b.add(prism(5, 0.05, 0.05, 0.45), { matrix: mat(0, -0.45, 0) });
  b.add(octa(0.16, 0.22, 0.16), { matrix: mat(0, -0.55, 0), emissive: -1.4 });

  // руки, рукава, цепи, кадила
  for (const a of ARMS) {
    b.joint = J(`sh${a}`);
    b.add(octa(0.28, 0.22, 0.28), {});
    const sleeve = lathe([[0.18, 0], [0.24, -0.4], [0.38, -0.85], [0.42, -0.95]], 6);
    b.add(sleeve, { matrix: mat(0, 0, 0) });
    b.joint = J(`elb${a}`);
    limb(b, 0.85, 0.11, 0.08, 5);
    b.add(shard(0.35, 0.05, 3, 0.2, 5), { matrix: matAlong(0, -0.3, -0.08, 0, 0.4, -1) });
    b.joint = J(`hand${a}`);
    b.add(octa(0.1, 0.16, 0.12), { matrix: mat(0, -0.08, 0) });
    for (const c of ['c1', 'c2']) {
      b.joint = J(`${c}${a}`);
      for (let k = 0; k < 3; k++) b.add(octa(0.05, 0.1, 0.03), { matrix: mat(0, -0.1 - k * 0.17, 0, 0, k % 2 ? Math.PI / 2 : 0, 0), color: GOLD });
    }
    b.joint = J(`censer${a}`);
    // кадило: клетка-октаэдр с тлеющим ядром
    b.add(octa(0.3, 0.38, 0.3), { matrix: mat(0, -0.38, 0), color: GOLD, shade: 0.3 });
    b.add(octa(0.2, 0.26, 0.2), { matrix: mat(0, -0.38, 0, 0, Math.PI / 4, 0), emissive: -1.7 });
    b.add(prism(4, 0.06, 0, 0.3), { matrix: mat(0, -0.76, 0, Math.PI, 0, 0), color: GOLD });
  }
  return { rig, geometry: b.build() };
}
