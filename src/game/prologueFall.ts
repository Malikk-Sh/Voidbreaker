import { Rng } from '../core/rng';

/** Обломок, летящий навстречу падающему Пилоту (мир «уезжает» вверх). */
export interface FallDebris {
  x: number; y: number; z: number;
  /** Радиус касания (м). */
  r: number;
  rot: number; spin: number;
  /** Уже задел героя (второй раз не толкает). */
  hit: boolean;
  /** 0 — камень собора, 1 — обшивка «Инея». */
  kind: number;
}

/** Параметры играбельного падения (план §8.2, план 4). */
export const FALL = {
  /** Скорость сближения с обломками (м/с). */
  speed: 32,
  /** Откуда приходят обломки (м ниже героя): ≈1.75 с на глазах — дольше быстрого телеграфа 0.42 с. */
  spawnY: -56,
  /** Окно, в котором стик водит героя (м). */
  rangeX: 5, rangeZ: 3,
  /** Скорость героя от стика (м/с) и отклик. */
  move: 5.5, response: 6,
  /** Толчок от касания (м/с) — без урона. */
  push: 8,
  heroR: 0.45,
  /** Первые обломки и шаг между ними (с), последний — не позже. */
  first: 1.0, every: 0.62, last: 7.2,
} as const;

/**
 * Играбельное падение пролога (план §8.2): стик уводит Пилота от обломков с красной обводкой; касание —
 * толчок и искры, без урона. Провалить нельзя. Чистая логика без рендера (её проверяют тесты).
 */
export class FallField {
  hx = 0; hz = 0; vx = 0; vz = 0;
  t = 0;
  hits = 0;
  readonly debris: FallDebris[] = [];
  private next: number = FALL.first;
  private n = 0;
  private readonly rng: Rng;

  constructor(seed = 77) { this.rng = new Rng(seed); }

  /** Шаг: стик (mx, mz) в −1..1. Возвращает обломок, задевший героя в этом шаге. */
  step(dt: number, mx: number, mz: number): FallDebris | null {
    this.t += dt;
    const k = Math.min(1, dt * FALL.response);
    this.vx += (mx * FALL.move - this.vx) * k;
    this.vz += (mz * FALL.move - this.vz) * k;
    this.hx += this.vx * dt; this.hz += this.vz * dt;
    // мягкие стенки окна: герой не улетает из кадра
    if (Math.abs(this.hx) > FALL.rangeX) { this.hx = Math.sign(this.hx) * FALL.rangeX; this.vx *= -0.3; }
    if (Math.abs(this.hz) > FALL.rangeZ) { this.hz = Math.sign(this.hz) * FALL.rangeZ; this.vz *= -0.3; }

    if (this.t >= this.next && this.next <= FALL.last) {
      this.next += FALL.every;
      this.spawn();
    }
    let hit: FallDebris | null = null;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const y0 = d.y;
      d.y += FALL.speed * dt;
      d.rot += d.spin * dt;
      // пересёк плоскость героя — проверка касания
      if (!d.hit && y0 < d.r && d.y >= -d.r) {
        const dx = this.hx - d.x, dz = this.hz - d.z, l = Math.hypot(dx, dz);
        if (l < d.r + FALL.heroR) {
          d.hit = true; this.hits++;
          const nx = l > 1e-3 ? dx / l : 1, nz = l > 1e-3 ? dz / l : 0;
          this.vx = nx * FALL.push; this.vz = nz * FALL.push;
          hit = d;
        }
      }
      if (d.y > 16) this.debris.splice(i, 1);
    }
    return hit;
  }

  /** Обломок целится в героя (каждый третий — с упреждением по скорости): стоять на месте нельзя. */
  private spawn(): void {
    const r = this.rng, lead = this.n % 3 === 2 ? 1.2 : 0;
    const rad = r.range(0.55, this.n % 4 === 3 ? 1.25 : 0.95);
    const a = r.range(0, Math.PI * 2), off = r.range(0, 0.7);
    this.debris.push({
      x: clampTo(this.hx + this.vx * lead + Math.cos(a) * off, FALL.rangeX), y: FALL.spawnY,
      z: clampTo(this.hz + this.vz * lead + Math.sin(a) * off, FALL.rangeZ),
      r: rad, rot: r.range(0, 6.28), spin: r.spread(2.4), hit: false, kind: this.n % 3 === 1 ? 1 : 0,
    });
    this.n++;
  }
}

function clampTo(v: number, m: number): number { return Math.max(-m, Math.min(m, v)); }
