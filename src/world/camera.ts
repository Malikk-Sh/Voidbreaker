import * as THREE from 'three';
import { noise1 } from '../core/noise';

/**
 * Режимы боевой камеры (план ×100, C1): наклон (рад), угол обзора (°), базовая дистанция (м) и наклон в бою со
 * Стражем и боссом. «Кино» — по умолчанию: 47°, 38°, 17 м × tan 15° / tan 19° ≈ 13.2 м — Пилот того же размера,
 * перспектива глубже, край арены и фон входят в кадр; у боссов 42°. «Тактическая» — прежняя: 55°, 30°, 17 м, 49°.
 */
export const CAM_MODES = {
  cinema: { tilt: 0.82, fov: 38, dist: 13.2, boss: 0.733 },
  tactical: { tilt: 0.96, fov: 30, dist: 17, boss: 0.86 },
} as const;
export type CamMode = keyof typeof CAM_MODES;

/** Режим из настроек; адрес ?cam=tactical|cinema перекрывает (разработка, стенд кадров). */
export function camModeFrom(setting: CamMode | undefined, search = typeof location !== 'undefined' ? location.search : ''): CamMode {
  const q = new URLSearchParams(search).get('cam');
  return q === 'tactical' || q === 'cinema' ? q : setting === 'tactical' ? 'tactical' : 'cinema';
}

/**
 * Камера (GDD §4.3, Tech §18): перспектива с узким углом, наклон и дистанция — по режиму (CAM_MODES).
 * Следование с упреждением, тряска по модели «травмы», направленный кик, зум-панч. Тряска — в реальном времени.
 */
export class CameraRig {
  focus = new THREE.Vector3();
  trauma = 0;
  kick = new THREE.Vector2();
  zoomPunch = 0;
  /** Множитель дистанции: боевой зум, рамка босса, кинематографичные приближения. */
  zoom = 1;
  zoomTarget = 1;
  tilt = 0.96;
  roll = 0;
  /** Базовая дистанция (м); настройка «Дистанция камеры» масштабирует её. */
  baseDist = 22;
  shakeScale = 1;
  /** Внешняя цель кинематографа (пролёт, дорожки режиссёра): перекрывает следование; fov и крен — по желанию. */
  cine: { pos: THREE.Vector3; look: THREE.Vector3; w: number; fov?: number; roll?: number } | null = null;
  /** Игровой угол обзора (°): режим камеры; 0 — взять у камеры при первом кадре. */
  fov = 0;
  private seed = Math.random() * 1000;
  private t = 0;

  update(realDt: number, tx: number, tz: number, leadX: number, leadZ: number, cam: THREE.PerspectiveCamera): void {
    this.t += realDt;
    const k = 1 - Math.exp(-realDt / 0.12);
    this.focus.x += (tx + leadX * 1.2 - this.focus.x) * k;
    this.focus.z += (tz + leadZ * 1.2 - this.focus.z) * k;

    this.trauma = Math.max(0, this.trauma - 1.6 * realDt);
    this.kick.multiplyScalar(Math.exp(-realDt * 18));
    this.zoomPunch *= Math.exp(-realDt * 10);
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-realDt / 0.35));

    const s = this.trauma * this.trauma * this.shakeScale;
    const t = this.t * 25;
    const ox = 0.35 * s * noise1(this.seed, t) + this.kick.x;
    const oz = 0.35 * s * noise1(this.seed + 100, t) + this.kick.y;

    // на узких экранах (4:3) отодвигаем камеру, чтобы ширина обзора не падала
    const aspectFix = Math.max(1, (16 / 9) / Math.max(0.5, cam.aspect)) ** 0.85;
    const dist = (this.baseDist * this.zoom * aspectFix) / (1 + this.zoomPunch);
    const fx = this.focus.x + ox, fz = this.focus.z + oz;
    cam.position.set(fx, dist * Math.sin(this.tilt), fz + dist * Math.cos(this.tilt));
    cam.lookAt(fx, 0, fz);
    cam.rotation.z += 0.02 * s * noise1(this.seed + 200, t) + this.roll;
    if (!this.fov) this.fov = cam.fov;
    let fov = this.fov;
    if (this.cine) {
      const w = this.cine.w;
      cam.position.lerp(this.cine.pos, w);
      const look = _look.set(fx, 0, fz).lerp(this.cine.look, w);
      cam.lookAt(look);
      if (this.cine.roll) cam.rotation.z += this.cine.roll * w;
      if (this.cine.fov) fov = this.fov + (this.cine.fov - this.fov) * w;
    }
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  addTrauma(v: number): void { this.trauma = Math.min(1, this.trauma + v); }
  addKick(dx: number, dz: number, px: number): void { this.kick.x += dx * px; this.kick.y += dz * px; }
  snap(x: number, z: number): void { this.focus.set(x, 0, z); }
}

const _look = new THREE.Vector3();
