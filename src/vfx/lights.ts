import { G, MAX_POINT_LIGHTS } from '../render/materials';

interface LightReq { x: number; y: number; z: number; r: number; g: number; b: number; i: number; radius: number }
interface Flash extends LightReq { t: number; life: number }

/**
 * Пул динамического света (Tech §4.2): до 4 точечных источников отдаются самым ярким событиям
 * (клинок героя, ульта, взрыв, ядра врагов). Всё остальное — эмиссия + bloom + световые пятна.
 */
export class LightManager {
  private reqs: LightReq[] = [];
  private flashes: Flash[] = [];

  begin(): void { this.reqs.length = 0; }

  add(x: number, y: number, z: number, rgb: [number, number, number], intensity: number, radius: number): void {
    if (intensity <= 0.01) return;
    this.reqs.push({ x, y, z, r: rgb[0], g: rgb[1], b: rgb[2], i: intensity, radius });
  }

  /** Короткая вспышка (взрыв, оглушение), затухает за life секунд. */
  flash(x: number, y: number, z: number, rgb: [number, number, number], intensity: number, radius: number, life: number): void {
    this.flashes.push({ x, y, z, r: rgb[0], g: rgb[1], b: rgb[2], i: intensity, radius, t: 0, life });
  }

  end(dt: number): void {
    for (const f of this.flashes) {
      f.t += dt;
      const k = Math.max(0, 1 - f.t / f.life);
      if (k > 0) this.reqs.push({ ...f, i: f.i * k * k });
    }
    this.flashes = this.flashes.filter((f) => f.t < f.life);
    this.reqs.sort((a, b) => b.i - a.i);
    for (let k = 0; k < MAX_POINT_LIGHTS; k++) {
      const r = this.reqs[k];
      const P = G.uPLPos.value[k], C = G.uPLCol.value[k];
      if (r) { P.set(r.x, r.y, r.z, r.radius); C.set(r.r * r.i, r.g * r.i, r.b * r.i, 1); }
      else { P.set(0, -999, 0, 1); C.set(0, 0, 0, 0); }
    }
  }

  clear(): void { this.flashes.length = 0; this.reqs.length = 0; this.end(0); }
}
