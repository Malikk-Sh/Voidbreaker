import * as THREE from 'three';
import { Clip } from '../anim/clip';
import { EXTRACTION_CLIPS, EXTRACTION_T } from '../anim/clips/extraction';
import { layoutOf } from '../anim/puppet';
import { Skeleton } from '../anim/skeleton';
import { HERO_RIG } from '../gen/chars/hero';

const layout = layoutOf(HERO_RIG);
const gripClip = new Clip(EXTRACTION_CLIPS[0], layout);
const gripSkeleton = new Skeleton(layout);
const gripRoot = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
const point = new THREE.Vector3();

/** The planted object is authored from the actual future grip pose. */
export function extractionGripMatrix(x: number, z: number, facing: number, out: THREE.Matrix4): THREE.Matrix4 {
  gripSkeleton.resetPose();
  gripClip.sample(EXTRACTION_T.grip, gripSkeleton.rot, gripRoot);
  gripSkeleton.x = x; gripSkeleton.z = z; gripSkeleton.facing = facing;
  gripSkeleton.y = gripRoot.y;
  gripSkeleton.sx = gripSkeleton.sy = gripSkeleton.sz = 1;
  gripSkeleton.update();
  return out.fromArray(gripSkeleton.world, layout.idx('blade') * 16);
}

/** Put the future hilt at the requested location without a hand/prop teleport. */
export function extractionStand(shardX: number, shardZ: number, facing: number): [number, number, number] {
  const matrix = extractionGripMatrix(0, 0, facing, new THREE.Matrix4());
  point.setFromMatrixPosition(matrix);
  return [shardX - point.x, 0, shardZ - point.z];
}

/** One visual object: planted → held → transferred to the matching rig blade. */
export class ExtractionAttachment {
  readonly matrix = new THREE.Matrix4();
  phase: 'planted' | 'held' | 'awake' = 'planted';
  released = false;

  constructor(planted: THREE.Matrix4) { this.matrix.copy(planted); }

  grip(hand: THREE.Matrix4): void {
    if (this.phase !== 'planted') return;
    this.phase = 'held';
    this.matrix.copy(hand);
  }

  release(): void { this.released = true; }

  follow(hand: THREE.Matrix4): void {
    if (this.phase === 'held') this.matrix.copy(hand);
  }

  awaken(hand: THREE.Matrix4): void {
    this.released = true;
    this.phase = 'awake';
    this.matrix.copy(hand);
  }

  get propVisible(): boolean { return this.phase !== 'awake'; }
  get rigVisible(): boolean { return this.phase === 'awake'; }
}
