import { clamp } from '../core/math';

/** Вертикальный цилиндр, который может закрыть Пилота от камеры: колонна-укрытие, Страж, босс. */
export interface Occluder { x: number; z: number; r: number; h: number }

/** Контур сквозь препятствия (разбор): сила, скорость появления и гашения (1/с), высота колонн-укрытий (м). */
export const XRAY = { strength: 0.6, rise: 10, fall: 4, coverH: 3.4 };

/**
 * Закрывает ли цилиндр отрезок «камера A → точка B»: ближайшая к оси цилиндра точка отрезка — внутри круга
 * и ниже его верха. Сам конец отрезка не считается (Пилот, стоящий вплотную к колонне, не «за» ней).
 */
export function segmentBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Occluder): boolean {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  if (l2 < 1e-6) return false;
  const t = clamp(((o.x - ax) * dx + (o.z - az) * dz) / l2, 0, 1);
  if (t > 0.96) return false;
  const px = ax + dx * t - o.x, pz = az + dz * t - o.z;
  if (px * px + pz * pz > o.r * o.r) return false;
  return ay + (by - ay) * t < o.h;
}
