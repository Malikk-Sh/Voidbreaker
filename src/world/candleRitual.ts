/** Жаровни стоят на проходном кольце вокруг погребального колодца. */
export const BRAZIERS = [
  { x: -7.2, z: 2 }, { x: 7.2, z: 2 }, { x: 0, z: -7.7 },
] as const;

const TAU = Math.PI * 2;
const SECTOR_ANGLE = TAU / 3;
const DRAIN_SECONDS = 2.2;
const LIGHT_SECONDS = 0.6;
const LIGHT_RADIUS = 2.2;
const FRONT_SOFTNESS = 0.08;
const PULSE_SECONDS = 12;
const WARNING_SECONDS = 2.2;

/** Три равных сектора; центры −60°, +60°, 180° относительно входа в зал. */
export function sectorAt(x: number, z: number, centerZ = 0): number {
  const angle = Math.atan2(x, z - centerZ);
  const turn = ((angle + SECTOR_ANGLE) % TAU + TAU) % TAU;
  return Math.min(2, Math.floor(turn / SECTOR_ANGLE));
}

/**
 * Сердце один раз забирает свет при входе. Искры павших можно отнести к трём жаровням:
 * каждый возвращённый сектор остаётся светлым, а третья жаровня разрывает ритуал.
 * Контроллер не зависит от волн и не требует решения для завершения обычного боя.
 */
export class CandleRitual {
  active = false;
  broken = false;
  carried = 0;
  readonly lit: [boolean, boolean, boolean] = [false, false, false];
  drain = 0;
  /** Прогресс розжига ближайшей жаровни, 0…1. */
  charge = 0;
  chargingIndex = -1;
  /** Последние 2.2 с перед ударом Сердца: предупреждение нарастает от 0 до 1. */
  warning = 0;
  pulseCount = 0;
  private hasStarted = false;
  private pulseTime = 0;

  constructor(readonly centerZ = 0) {}

  get started(): boolean { return this.hasStarted; }

  start(): boolean {
    if (this.hasStarted) return false;
    this.hasStarted = true;
    this.active = true;
    this.pulseTime = 0;
    this.warning = 0;
    return true;
  }

  /** Вызывается только для смерти враждебной цели; переносится не более трёх искр. */
  collect(): boolean {
    if (!this.active || this.broken || this.carried >= BRAZIERS.length) return false;
    this.carried++;
    return true;
  }

  /** Возвращает индекс только в момент розжига; эффект импульса исполняет игровой слой. */
  step(dt: number, heroX: number, heroZ: number, enabled = true): number | null {
    if (!this.active) return null;
    if (!enabled) { this.clearCharge(); return null; }
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.drain = Math.min(1, this.drain + dt / DRAIN_SECONDS);
    this.pulseTime += dt;
    while (this.pulseTime >= PULSE_SECONDS) { this.pulseTime -= PULSE_SECONDS; this.pulseCount++; }
    this.warning = Math.max(0, (this.pulseTime - (PULSE_SECONDS - WARNING_SECONDS)) / WARNING_SECONDS);
    let nearest = -1, distance = LIGHT_RADIUS;
    if (this.carried > 0) {
      for (let i = 0; i < BRAZIERS.length; i++) {
        if (this.lit[i]) continue;
        const b = BRAZIERS[i], d = Math.hypot(heroX - b.x, heroZ - this.centerZ - b.z);
        if (d <= distance) { nearest = i; distance = d; }
      }
    }
    if (nearest < 0) { this.clearCharge(); return null; }
    if (nearest !== this.chargingIndex) { this.clearCharge(); this.chargingIndex = nearest; }
    this.charge = Math.min(1, this.charge + dt / LIGHT_SECONDS);
    if (this.charge < 1) return null;
    this.lit[nearest] = true;
    this.carried--;
    this.clearCharge();
    if (this.lit.every(Boolean)) this.finish();
    return nearest;
  }

  /** Яркость конкретной свечи: круговой фронт всегда доходит до полного оборота. */
  visibilityAt(x: number, z: number): number {
    if (!this.hasStarted || this.broken || this.lit[sectorAt(x, z, this.centerZ)]) return 1;
    if (this.drain >= 1) return 0;
    const angle = Math.atan2(x, z - this.centerZ);
    const turn = ((angle + Math.PI) % TAU + TAU) % TAU / TAU;
    const gone = Math.max(0, Math.min(1, (this.drain * (1 + FRONT_SOFTNESS) - turn) / FRONT_SOFTNESS));
    return 1 - gone;
  }

  /** В возвращённом секторе жаровня удерживает удар Сердца. */
  isSafeAt(x: number, z: number): boolean {
    return !this.active || this.broken || this.lit[sectorAt(x, z, this.centerZ)];
  }

  /** Разрушение Сердца или победа над последним врагом возвращает весь похищенный огонь. */
  finish(): void {
    this.hasStarted = true;
    this.active = false;
    this.broken = true;
    this.carried = 0;
    this.lit.fill(true);
    this.warning = 0;
    this.pulseTime = 0;
    this.clearCharge();
  }

  private clearCharge(): void { this.charge = 0; this.chargingIndex = -1; }
}
