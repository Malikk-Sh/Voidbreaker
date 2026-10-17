import type * as THREE from 'three';
import type { CameraRig } from '../camera';
import type { Enemy } from '../enemy';

/** Контроллер босс-боя: фазы, кинематографичные вставки, камера, данные для HUD. */
export interface BossController {
  name: string;
  phase: number;
  phaseMarks: number[];
  zoomMul: number;
  step(dtW: number): void;
  cameraTarget(): { x: number; z: number } | null;
  cameraOverride(cam: CameraRig, camera: THREE.PerspectiveCamera, realDt: number): void;
  hudBoss(): Enemy | null;
}
