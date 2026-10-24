import type { CineStep, CineTrack, V3 } from '../../game/director';
import { MASK_CONTACT, MASK_RELEASE, bladeContactRoot, maskContactRoot } from '../../anim/clips/execution';
import { RigLayout } from '../../anim/skeleton';
import { bruteRig } from '../../gen/chars/enemies';
import { guardianTargets, GUARDIAN_KILL_POSES } from './guardianStaging';

export const KILL_FOV = 44;
export interface KillSpots { gx: number; gz: number; hx: number; hz: number; facing?: number; knee?: V3; head?: V3; bell?: V3; landing?: V3 }
export const GATE_KILL_T = { knee: 0.62, leap: 1.18, jump: 1.45, strike: 1.95, contact: 1.95 + MASK_CONTACT, exit: 2.95, land: 4.0, crumble: 4.25, end: 6.25 };
export const BELL_KILL_T = { knee: 0.62, leap: 1.15, jump: 1.42, strike: 1.92, contact: 1.92 + MASK_CONTACT, exit: 2.92, land: 3.97, crumble: 4.22, end: 6.22 };

function killTrack(p: KillSpots, bell: boolean): CineTrack {
  const T = bell ? BELL_KILL_T : GATE_KILL_T, who = bell ? 'bellRinger' : 'gateGuardian';
  const { gx, gz, hx, hz } = p;
  const initial = Math.atan2(gx - hx, gz - hz), facing = p.facing ?? Math.atan2(hx - gx, hz - gz);
  const size = bell ? 1.45 : 1.65;
  const anchors = guardianTargets(new RigLayout(bruteRig(who, size)), gx, gz, facing, size);
  const target = (bell ? p.bell : p.head) ?? (bell ? anchors.bell : anchors.head);
  const attackFacing = bell ? facing : initial, fx = Math.sin(attackFacing), fz = Math.cos(attackFacing), sx = -fz, sz = fx;
  const contact = maskContactRoot(target, attackFacing);
  const apex: V3 = [contact[0] - fx * 0.45, contact[1] + 0.65, contact[2] - fz * 0.45];
  const knee = p.knee ?? anchors.knee, sweep = bladeContactRoot('guardianSweep', T.knee, knee, initial);
  const approach: V3 = bell ? [contact[0] - fx * 0.8, 0, contact[2] - fz * 0.8] : sweep;
  const landing: V3 = p.landing ?? [gx - fx * 3.8 + sx * 1.5, 0, gz - fz * 3.8 + sz * 1.5];
  const away: V3 = [contact[0] - fx * 1.4 + sx * 1.3, contact[1] + 0.3, contact[2] - fz * 1.4 + sz * 1.3];
  const forward = (r: V3): V3 => [r[0] + fx * 10, 0, r[2] + fz * 10];
  // Держим одну сторону оси боя: обход, клинок и цель не меняются местами при склейке.
  const wide: V3 = [gx - fx * 8 + sx * 9, 3.3, gz - fz * 8 + sz * 9];
  const lowLook: V3 = [(approach[0] + gx) / 2, bell ? 2.1 : 1.6, (approach[2] + gz) / 2];
  const close = (r: V3, extra = 0, distance = 1) => {
    const look: V3 = [(r[0] + target[0]) / 2, (r[1] + 1.9 + extra + target[1] - 0.4) / 2, (r[2] + target[2]) / 2];
    return { look, cam: [look[0] + (fx * 3.2 + sx * 6.6) * distance, look[1] + 0.65 * distance, look[2] + (fz * 3.2 + sz * 6.6) * distance] as V3 };
  };
  const top = close(apex, 2.4, 1.25), hit = close(contact, 0.9);
  const landingCam: V3 = [landing[0] - fx * 5 + sx * 6.5, 2.7, landing[2] - fz * 5 + sz * 6.5];
  const landingLook: V3 = [(landing[0] + gx) / 2, 1.5, (landing[2] + gz) / 2];
  const steps: CineStep[] = [
    { t: 0, do: 'clip', who: 'hero', clip: bell ? 'guardianApproach' : 'guardianSweep', blend: 0.18 },
    // Реакция врага тоже идёт по времени сцены: замедление мира не уводит шлем от маркера клинка.
    { t: 0, do: 'clip', who, clip: `${who}Reaction`, blend: 0.2, definition: { id: `${who}Reaction`, dur: T.end, mask: 'full', keys: [
      { t: 0, pose: GUARDIAN_KILL_POSES[bell ? 'killcamKneel' : 'killcamStagger'] },
      { t: T.knee, pose: GUARDIAN_KILL_POSES[bell ? 'killcamKneel' : 'killcamStagger'] },
      { t: T.leap, ease: 'inOutSine', pose: GUARDIAN_KILL_POSES.killcamKneel },
      { t: T.contact, pose: GUARDIAN_KILL_POSES.killcamKneel },
      { t: T.exit, ease: 'inOutSine', pose: GUARDIAN_KILL_POSES.killcamHit },
      { t: T.end, pose: GUARDIAN_KILL_POSES.killcamHit },
    ] } },
    { t: 0, do: 'actor', who: 'hero', moveTo: approach, dur: bell ? T.leap : T.knee, ease: 'inOutSine', ...(bell ? { bends: [[sx * 3.3, 0, sz * 3.3] as V3] } : {}), lookAt: forward(approach), turn: 0.35 },
    { t: 0, do: 'cam', path: [wide, [wide[0] - sx * 0.3, wide[1], wide[2] - sz * 0.3]], look: [lowLook], dur: T.leap, ease: 'inOutSine', fov: KILL_FOV },
    ...(!bell ? [
      // Контакт подсечки — маркер клипа; падение Стража начинается только после него.
      { t: T.knee, do: 'call' as const, fn: 'knee' },
      { t: T.knee, do: 'time' as const, scale: 0.3, dur: 0.55, rampIn: 0.06, rampOut: 0.2 },
    ] : []),
    { t: T.leap, do: 'clip', who: 'hero', clip: 'executionLeap', speed: 1.9 / (T.strike - T.leap), blend: 0.2 },
    { t: T.leap, do: 'actor', who: 'hero', moveTo: [approach[0], 0, approach[2]], dur: T.jump - T.leap, ease: 'inOutSine', lookAt: forward(approach), turn: 0.18 },
    { t: T.jump, do: 'actor', who: 'hero', moveTo: apex, dur: T.strike - T.jump, ease: 'outQuad', lookAt: forward(apex) },
    { t: T.leap, do: 'cam', path: [[wide[0] - sx * 0.3, wide[1], wide[2] - sz * 0.3], top.cam], look: [lowLook, top.look], dur: T.strike - T.leap, fov: KILL_FOV, blend: 0.25 },
    { t: T.strike, do: 'clip', who: 'hero', clip: 'maskStrike', markers: { contact: bell ? 'bell' : 'helmet' }, blend: 0.14 },
    { t: T.strike, do: 'actor', who: 'hero', lookAt: forward(apex), dur: MASK_RELEASE },
    { t: T.strike + MASK_RELEASE, do: 'actor', who: 'hero', moveTo: contact, dur: MASK_CONTACT - MASK_RELEASE, ease: 'inQuad', lookAt: forward(contact) },
    { t: T.strike + MASK_RELEASE, do: 'sfx', id: 'swing_heavy', gain: 0.9 },
    { t: T.strike, do: 'time', scale: 0.2, dur: MASK_RELEASE, rampIn: 0.1, rampOut: 0.18 },
    { t: T.contact, do: 'time', scale: 0.08, dur: 0.12, rampIn: 0, rampOut: 0.04 },
    { t: T.strike, do: 'cam', path: [top.cam], look: [top.look], dur: MASK_RELEASE, fov: KILL_FOV, blend: 0.14 },
    { t: T.strike + MASK_RELEASE, do: 'cam', path: [top.cam, hit.cam], look: [top.look, hit.look], dur: MASK_CONTACT - MASK_RELEASE, ease: 'inOutSine', fov: KILL_FOV, blend: 0 },
    // После удара остаётся отдельный читаемый кадр трещины/кольца, до распада.
    { t: T.contact, do: 'cam', path: [hit.cam], look: [hit.look], dur: T.exit - T.contact, fov: KILL_FOV, blend: 0 },
    { t: T.contact, do: 'crack', who, to: 1, dur: 0.55 },
    { t: T.exit, do: 'clip', who: 'hero', clip: 'executionLand', blend: 0.22 },
    { t: T.exit, do: 'actor', who: 'hero', moveTo: away, dur: 0.35, ease: 'outQuad', lookAt: forward(away) },
    { t: T.exit + 0.35, do: 'actor', who: 'hero', moveTo: landing, dur: 0.7, ease: 'inQuad', lookAt: forward(landing) },
    { t: T.exit, do: 'cam', path: [hit.cam, landingCam], look: [hit.look, landingLook], dur: T.land - T.exit, fov: KILL_FOV, ease: 'inOutSine', blend: 0.22 },
    { t: T.land, do: 'sfx', id: 'land_impact', gain: 0.65 },
    { t: T.crumble, do: 'call', fn: 'crumble' },
    { t: T.crumble + 0.35, do: 'call', fn: 'guardianTitle' },
    { t: T.crumble, do: 'time', scale: 0.32, dur: 0.7, rampIn: 0.08, rampOut: 0.25 },
    { t: T.land, do: 'cam', path: [landingCam, [landingCam[0] + sx * 0.5, landingCam[1] + 0.2, landingCam[2] + sz * 0.5]], look: [landingLook], dur: T.end - T.land, fov: KILL_FOV },
  ];
  // Подсечка также проходит после сэмплирования позы — как основной удар.
  if (!bell) {
    const clip = steps[0]; if (clip.do === 'clip') clip.markers = { contact: 'knee' };
    const i = steps.findIndex((s) => s.do === 'call' && s.fn === 'knee'); steps.splice(i, 1);
  }
  return { id: bell ? 'killBell' : 'killGate', revision: 3, cameraBlend: 0.25, origin: [gx, 0, gz], heading: attackFacing, steps, dur: T.end, blendOut: 0.65 };
}
export function killGateTrack(p: KillSpots): CineTrack { return killTrack(p, false); }
export function killBellTrack(p: KillSpots): CineTrack { return killTrack(p, true); }
