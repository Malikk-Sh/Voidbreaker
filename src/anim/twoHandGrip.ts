import * as THREE from 'three';
import { Skeleton, type RigLayout, type V3 } from './skeleton';

/** Центр сомкнутых пальцев из buildHeroGeometry, не запястье. */
export const GRIP_PALM: V3 = [0, -0.07, 0.03];
/** Нижняя кисть на обмотке: рукоять −0.13..+0.13, навершие начинается на +0.14. */
export const GRIP_HANDLE: V3 = [0, 0.09, 0];

export interface TwoHandWindow { start: number; full: number; release: number; end: number }

export function gripWeight(time: number, window: TwoHandWindow): number {
  const enter = Math.min(1, Math.max(0, (time - window.start) / Math.max(0.001, window.full - window.start)));
  const leave = Math.min(1, Math.max(0, (window.end - time) / Math.max(0.001, window.end - window.release)));
  const u = Math.min(enter, leave);
  return u * u * (3 - 2 * u);
}

/** Два костных звена фиксированной длины: левое запястье следует реальной обмотке меча. */
export class TwoHandGrip {
  private readonly skel: Skeleton;
  private readonly sh: number;
  private readonly elb: number;
  private readonly hand: number;
  private readonly blade: number;
  private readonly chest: number;
  private readonly a: number;
  private readonly b: number;
  private readonly p = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly upper = new THREE.Vector3();
  private readonly lower = new THREE.Vector3();
  private readonly x = new THREE.Vector3();
  private readonly y = new THREE.Vector3();
  private readonly z = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly chestQ = new THREE.Quaternion();
  private readonly handQ = new THREE.Quaternion();
  private readonly shoulderQ = new THREE.Quaternion();
  private readonly elbowQ = new THREE.Quaternion();
  private readonly twist = new THREE.Quaternion();
  private readonly local = new THREE.Quaternion();
  private readonly original = new THREE.Quaternion();

  constructor(readonly layout: RigLayout, private readonly wristCant = 0.12) {
    this.skel = new Skeleton(layout);
    this.sh = layout.idx('shL'); this.elb = layout.idx('elbL'); this.hand = layout.idx('handL');
    this.blade = layout.idx('blade'); this.chest = layout.parent[this.sh];
    this.a = new THREE.Vector3().fromArray(layout.rest, this.elb * 3).length();
    this.b = new THREE.Vector3().fromArray(layout.rest, this.hand * 3).length();
  }

  apply(out: Float32Array, weight: number): void {
    if (weight <= 0) return;
    const s = this.skel;
    s.rot.set(out); s.update();
    this.matrix.fromArray(s.world, this.chest * 16).decompose(this.p, this.chestQ, this.scale);
    this.matrix.fromArray(s.world, this.blade * 16).decompose(this.p, this.handQ, this.scale);
    // Кисть обнимает рукоять продольно. В локальном риге небольшой наклон оружия к ладони −0.12 рад.
    this.handQ.multiply(this.local.setFromAxisAngle(this.x.set(1, 0, 0), this.wristCant));
    s.jointPoint(this.blade, ...GRIP_HANDLE, this.target);
    this.target.sub(this.p.fromArray(GRIP_PALM).applyQuaternion(this.handQ));
    s.jointPos(this.sh, this.shoulder);
    this.dir.subVectors(this.target, this.shoulder);
    const d = Math.min(this.a + this.b - 0.004, Math.max(Math.abs(this.a - this.b) + 0.004, this.dir.length()));
    this.dir.normalize();
    this.target.copy(this.shoulder).addScaledVector(this.dir, d);
    // Локоть остаётся снаружи и перед кирасой, а не складывается внутрь груди.
    this.pole.set(0.8, -0.05, 0.7).applyQuaternion(this.chestQ);
    this.pole.addScaledVector(this.dir, -this.pole.dot(this.dir));
    if (this.pole.lengthSq() < 1e-8) this.pole.set(0, 1, 0).applyQuaternion(this.chestQ).cross(this.dir);
    this.pole.normalize();
    const along = (this.a * this.a + d * d - this.b * this.b) / (2 * d);
    const height = Math.sqrt(Math.max(0, this.a * this.a - along * along));
    this.elbow.copy(this.shoulder).addScaledVector(this.dir, along).addScaledVector(this.pole, height);
    this.upper.subVectors(this.elbow, this.shoulder).normalize();
    this.lower.subVectors(this.target, this.elbow).normalize();
    this.x.crossVectors(this.lower, this.upper).normalize();
    this.y.copy(this.upper).negate(); this.z.crossVectors(this.x, this.y).normalize();
    this.shoulderQ.setFromRotationMatrix(this.matrix.makeBasis(this.x, this.y, this.z));
    this.y.copy(this.lower).negate(); this.z.crossVectors(this.x, this.y).normalize();
    this.elbowQ.setFromRotationMatrix(this.matrix.makeBasis(this.x, this.y, this.z));
    // Пронация приходится на предплечье, а не на невозможный разворот запястья на 120°.
    this.local.copy(this.elbowQ).invert().multiply(this.handQ);
    const rawTurn = 2 * Math.atan2(this.local.y, this.local.w);
    const turn = Math.max(-1.4, Math.min(1.4, Math.atan2(Math.sin(rawTurn), Math.cos(rawTurn))));
    this.elbowQ.multiply(this.twist.setFromAxisAngle(this.y.set(0, 1, 0), turn));
    this.local.copy(this.chestQ).invert().multiply(this.shoulderQ); this.write(out, this.sh, weight);
    this.local.copy(this.shoulderQ).invert().multiply(this.elbowQ); this.write(out, this.elb, weight);
    this.local.copy(this.elbowQ).invert().multiply(this.handQ); this.write(out, this.hand, weight);
  }

  private write(out: Float32Array, joint: number, weight: number): void {
    this.original.fromArray(out, joint * 4).slerp(this.local, weight).toArray(out, joint * 4);
  }
}
