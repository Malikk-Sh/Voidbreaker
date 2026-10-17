import * as THREE from 'three';
import { noise1 } from '../core/noise';

/**
 * Камера (GDD §4.3, Tech §18): перспектива с узким углом (~30°), наклон 55°, ~28 м.
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
  baseDist = 28;
  shakeScale = 1;
  /** Внешняя цель кинематографа (пролёт): если задана, перекрывает следование. */
  cine: { pos: THREE.Vector3; look: THREE.Vector3; w: number } | null = null;
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
    if (this.cine) {
      const w = this.cine.w;
      cam.position.lerp(this.cine.pos, w);
      const look = _look.set(fx, 0, fz).lerp(this.cine.look, w);
      cam.lookAt(look);
    }
  }

  addTrauma(v: number): void { this.trauma = Math.min(1, this.trauma + v); }
  addKick(dx: number, dz: number, px: number): void { this.kick.x += dx * px; this.kick.y += dz * px; }
  snap(x: number, z: number): void { this.focus.set(x, 0, z); }
}

const _look = new THREE.Vector3();
