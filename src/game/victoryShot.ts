import { Ease } from '../core/ease';
import type { V3 } from './director';

/** От исходного плана 2.6 с: длительность ×1.25, дуга/подъём ×0.7, дистанция ×0.8. */
export const VICTORY_SHOT = {
  dur: 2.6 * 1.25,
  arc: 0.9 * 0.7,
  radiusFrom: 7 * 0.8,
  radiusTo: 6 * 0.8,
  rise: 0.6 * 0.7,
  height: 2.4,
  lookHeight: 1.25,
  fov: 40,
  poseAt: 0.12,
  accentAt: 0.6,
};

/**
 * Небольшой проход перед Пилотом. Дуга, дистанция и время меняются отдельно;
 * их сочетание даёт более спокойное движение, чем одно замедление на 25%.
 */
export function victoryFrame(origin: V3, facing: number, u: number): { cam: V3; look: V3 } {
  const k = Math.max(0, Math.min(1, u)), e = Ease.inOutSine(k), C = VICTORY_SHOT;
  const a = facing - 0.05 + (e - 0.5) * C.arc;
  const radius = C.radiusFrom + (C.radiusTo - C.radiusFrom) * e;
  return {
    cam: [origin[0] + Math.sin(a) * radius, origin[1] + C.height + e * C.rise, origin[2] + Math.cos(a) * radius],
    look: [origin[0], origin[1] + C.lookHeight, origin[2]],
  };
}
