import * as THREE from 'three';
import type { Skeleton } from '../../anim/skeleton';
import { clamp } from '../../core/math';
import type { ResonantStrings } from '../../world/boss/resonantStrings';

const GOLD = new THREE.Color('#ffdb8c');
const THREAD = new THREE.Color('#e96354');
const BRASS = new THREE.Color('#bb8a66');
const ECHO = new THREE.Color('#ed514a');
const RETURN = new THREE.Color('#ffad8c');

/** A taut string, a gold spindle at blade height and a serrated crest travelling over its actual hitbox. */
export class QuarryStringView {
  readonly mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 96);
  private readonly piece = new THREE.Object3D();
  private readonly bone = new THREE.Matrix4();
  private readonly tip = new THREE.Vector3();
  constructor() {
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }
  private gem(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, roll: number, color: THREE.Color): void {
    const p = this.piece;
    p.position.set(x, y, z);
    p.scale.set(sx, sy, sz);
    p.rotation.set(0, yaw, roll, 'YXZ');
    p.updateMatrix();
    const slot = this.mesh.count++;
    this.mesh.setMatrixAt(slot, p.matrix);
    this.mesh.setColorAt(slot, color);
  }
  sync(score: ResonantStrings | null, rig?: Skeleton): void {
    this.mesh.count = 0;
    if (!score?.active) return;
    const t = score.elapsed;
    for (const l of score.lines) {
      if (l.cut) continue;
      const { lane, knot } = l;
      const { x, z, dx, dz, len } = lane;
      const yaw = Math.atan2(dx, dz);
      if (score.available(l) || l.reversing && l.warning?.alive) {
        const tension = clamp((t - l.show) / (l.launch - l.show), 0, 1);
        const color = l.reversing ? RETURN : THREAD;
        for (let j = 0; j < 8; j++) {
          const f = (j + 0.5) / 8, d = f * len;
          const y = 0.58 + (1 - f) * 0.32 + 0.06 * Math.sin(2.4 * j + t * 17) * (1 - tension * 0.65);
          this.gem(x + dx * d, y, z + dz * d, 0.042, 0.047, len / 16 + 0.09, yaw, 0, color);
        }
        // Travelling pairs on the line indicate which end fires, including the returning stroke.
        for (let i = 0; i < 3; i++) {
          const u = (t * 0.65 + i / 3) % 1, d = len * (l.reversing ? 1 - u : u);
          this.gem(x + dx * d, 0.76, z + dz * d, 0.09, 0.095, 0.28, yaw, 0, color);
        }
        if (score.available(l)) {
          if (rig) {
            const left = l === score.lines[0];
            const index = rig.layout.idx(left ? 'mantleL' : 'mantleR');
            this.bone.fromArray(rig.world, index * 16);
            const tip = this.tip.set(left ? 0.71 : -0.71, left ? 1.68 : 1.29, -0.87).applyMatrix4(this.bone);
            const reach = Math.hypot(tip.x - x, tip.z - z), a = Math.atan2(tip.x - x, tip.z - z);
            // The raised wire to the beast has no floor warning. The dangerous stroke starts at the bell.
            for (let j = 0; j < 7; j++) {
              const f = (j + 0.5) / 7;
              this.gem(x + (tip.x - x) * f, 1.75 + (tip.y - 1.75) * f + Math.sin(f * Math.PI) * 0.22,
                z + (tip.z - z) * f, 0.025, 0.037, reach / 14 + 0.06, a, 0, BRASS);
            }
          }
          const pulse = 1 + 0.14 * Math.sin(10 * t);
          this.gem(knot.x, 0.91, knot.z, 0.22 * pulse, 0.5, 0.22 * pulse, 2.5 * t, 0, GOLD);
          for (let i = 0; i < 4; i++) {
            const a = t * 1.9 + i * Math.PI / 2;
            this.gem(knot.x + Math.sin(a) * 0.35, 0.83, knot.z + Math.cos(a) * 0.35,
              0.065, 0.27, 0.08, a, i % 2 ? -0.46 : 0.46, GOLD);
          }
        }
      }
      if (l.flight === null) continue;
      const d = l.flight * len, dir = l.reversing ? -1 : 1, color = l.reversing ? RETURN : ECHO;
      for (let i = -3; i <= 3; i++) {
        const side = i * 0.29, back = Math.abs(i) * 0.21;
        const wx = x + dx * (d - dir * back) + dz * side, wz = z + dz * (d - dir * back) - dx * side;
        this.gem(wx, 0.8 - Math.abs(i) * 0.1, wz, 0.15, 0.79 - Math.abs(i) * 0.1, 0.42, yaw, -i * 0.19 * dir, color);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
}
