import type { CineStep, CineTrack } from '../../game/director';

/** Угол обзора kill-cam (°): шире игрового — Страж и Пилот на древке в одном кадре. */
export const KILL_FOV = 42;

/** Где стоят Страж и Пилот в момент добивания. */
export interface KillSpots { gx: number; gz: number; hx: number; hz: number }

/**
 * Kill-cam Стража Врат (план §8.4), 3–4 с, без летербокса: Пилот проскальзывает под алебардой, подрубает
 * колено — Страж падает на колено; взлетает по древку и бьёт в шлем; по шлему бежит разлом, из трещин — свет;
 * Страж осыпается. Логика: knee, helmet, crumble.
 */
export function killGateTrack(p: KillSpots): CineTrack {
  const { gx, gz, hx, hz } = p;
  const dx = gx - hx, dz = gz - hz, dl = Math.hypot(dx, dz) || 1;
  const fx = dx / dl, fz = dz / dl, sx = -fz, sz = fx;
  const steps: CineStep[] = [
    { t: 0, do: 'actor', who: 'hero', clip: 'dash', moveTo: [gx + sx * 1.4 - fx * 0.3, 0, gz + sz * 1.4 - fz * 0.3], dur: 0.35, ease: 'outExpo', lookAt: [gx, 0, gz] },
    { t: 0, do: 'sfx', id: 'dash', gain: 0.8 },
    { t: 0, do: 'cam', path: [[gx + sx * 9 - fx * 4, 1.2, gz + sz * 9 - fz * 4], [gx + sx * 8.5 - fx * 3, 1.5, gz + sz * 8.5 - fz * 3]], look: [[gx, 1.6, gz]], dur: 1.0, ease: 'outCubic', fov: KILL_FOV },
    { t: 0.4, do: 'actor', who: 'hero', clip: 'atk1', lookAt: [gx, 0, gz] },
    { t: 0.45, do: 'call', fn: 'knee' },
    // по древку — в шлем
    { t: 0.9, do: 'actor', who: 'hero', clip: 'shaftRun', moveTo: [gx - fx * 0.6, 2.7, gz - fz * 0.6], dur: 0.45, ease: 'inOutQuad', lookAt: [gx, 0, gz] },
    { t: 0.9, do: 'cam', path: [[gx + sx * 10.5, 2.6, gz + sz * 10.5], [gx + sx * 10 - fx, 3.1, gz + sz * 10 - fz]], look: [[gx, 2.9, gz], [gx, 3.4, gz]], dur: 1.3, fov: KILL_FOV },
    { t: 1.32, do: 'call', fn: 'helmet' },
    { t: 1.32, do: 'flash', v: 0.35 },
    { t: 1.35, do: 'crack', who: 'gateGuardian', to: 1, dur: 0.9 },
    { t: 1.6, do: 'actor', who: 'hero', moveTo: [gx - fx * 2.8, 0, gz - fz * 2.8], dur: 0.4, ease: 'inQuad', lookAt: [gx, 0, gz] },
    { t: 2.2, do: 'cam', path: [[gx - fx * 10 + sx * 4, 3.0, gz - fz * 10 + sz * 4]], look: [[gx, 2.2, gz]], dur: 1.4, fov: KILL_FOV },
    { t: 2.4, do: 'call', fn: 'crumble' },
  ];
  return { id: 'killGate', steps, dur: 3.6, blendOut: 0.6 };
}

/**
 * Kill-cam Звонаря (план §8.4): удар по колоколу на спине — колокол выпускает фиолетовое кольцо; кольцо
 * проходит сквозь Звонаря, он рассыпается, колокол падает и гудит. Логика: bell, crumble.
 */
export function killBellTrack(p: KillSpots): CineTrack {
  const { gx, gz, hx, hz } = p;
  const dx = gx - hx, dz = gz - hz, dl = Math.hypot(dx, dz) || 1;
  const fx = dx / dl, fz = dz / dl, sx = -fz, sz = fx;
  const steps: CineStep[] = [
    // за спину — к колоколу
    { t: 0, do: 'actor', who: 'hero', clip: 'dash', moveTo: [gx + fx * 1.9, 0, gz + fz * 1.9], dur: 0.4, ease: 'outExpo', lookAt: [gx, 0, gz] },
    { t: 0, do: 'sfx', id: 'dash', gain: 0.8 },
    { t: 0, do: 'cam', path: [[gx + sx * 8, 1.5, gz + sz * 8], [gx + sx * 7.5 + fx * 1.5, 1.8, gz + sz * 7.5 + fz * 1.5]], look: [[gx, 2.2, gz]], dur: 1.2, ease: 'outCubic', fov: KILL_FOV },
    { t: 0.45, do: 'actor', who: 'hero', clip: 'atk2', lookAt: [gx, 0, gz] },
    { t: 0.5, do: 'call', fn: 'bell' },
    { t: 0.5, do: 'flash', v: 0.3 },
    { t: 0.65, do: 'crack', who: 'bellRinger', to: 1, dur: 0.9 },
    { t: 1.2, do: 'cam', path: [[gx - fx * 6 + sx * 2.5, 1.8, gz - fz * 6 + sz * 2.5], [gx - fx * 7 + sx * 3, 2.2, gz - fz * 7 + sz * 3]], look: [[gx, 1.5, gz]], dur: 2.2, fov: KILL_FOV },
    { t: 1.6, do: 'call', fn: 'crumble' },
    { t: 1.95, do: 'sfx', id: 'bell_strike', gain: 0.7 },
    { t: 2.1, do: 'sfx', id: 'stun_hum', gain: 0.6 },
  ];
  return { id: 'killBell', steps, dur: 3.4, blendOut: 0.6 };
}
