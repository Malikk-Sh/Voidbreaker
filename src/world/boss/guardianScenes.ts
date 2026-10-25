import type { CineStep, CineTrack, V3 } from '../../game/director';
import { MASK_CONTACT, MASK_RELEASE, bladeContactRoot, bladeEdgeRoot } from '../../anim/clips/execution';
import { RigLayout } from '../../anim/skeleton';
import { bruteRig } from '../../gen/chars/enemies';
import { guardianTargets, guardianSupport, GUARDIAN_KILL_POSES } from './guardianStaging';
import { along, attackFraming, ballisticPoint, ballisticVelocity } from '../../game/finisherMotion';

export const KILL_FOV = 44;
export interface KillSpots { gx: number; gz: number; hx: number; hz: number; facing?: number; knee?: V3; head?: V3; bell?: V3; landing?: V3 }
export const GATE_KILL_T = { knee: 0.62, leap: 1.18, jump: 1.45, strike: 1.95, contact: 1.95 + MASK_CONTACT, exit: 2.95, land: 4.0, crumble: 4.25, end: 6.25 };
export const BELL_KILL_T = { knee: 0.62, leap: 1.15, jump: 1.42, strike: 1.92, contact: 1.92 + MASK_CONTACT, exit: 2.92, land: 3.97, crumble: 4.22, end: 6.22 };

function killTrack(p: KillSpots, bell: boolean): CineTrack {
  const T = bell ? BELL_KILL_T : GATE_KILL_T, who = bell ? 'bellRinger' : 'gateGuardian';
  const { gx, gz, hx, hz } = p;
  const initial = Math.atan2(gx - hx, gz - hz), facing = p.facing ?? Math.atan2(hx - gx, hz - gz);
  const size = bell ? 1.45 : 1.65;
  const layout = new RigLayout(bruteRig(who, size)), anchors = guardianTargets(layout, gx, gz, facing, size);
  const support = (name: string): V3 => [0, guardianSupport(layout, name), 0];
  const target = (bell ? p.bell : p.head) ?? (bell ? anchors.bell : anchors.head);
  const attackFacing = bell ? facing : initial, fx = Math.sin(attackFacing), fz = Math.cos(attackFacing), sx = -fz, sz = fx;
  const attack = bell ? 'bellBreak' : 'gateCrush', contact = bladeEdgeRoot(attack, MASK_CONTACT, target, attackFacing);
  const knee = p.knee ?? anchors.knee, sweep = bladeContactRoot('guardianSweep', T.knee, knee, initial);
  const approach: V3 = bell ? [contact[0] - fx * 0.8, 0, contact[2] - fz * 0.8] : sweep;
  const landing: V3 = p.landing ?? [gx - fx * 3.8 + sx * 1.5, 0, gz - fz * 3.8 + sz * 1.5];
  const takeoff: V3 = [approach[0], 0, approach[2]], flightDur = T.contact - T.jump;
  const flight = ballisticVelocity(takeoff, contact, flightDur, bell ? 2.0 : 2.4);
  const softened: V3 = [flight.velocityTo[0] * 0.25, -0.25, flight.velocityTo[2] * 0.25];
  const compression: V3 = contact.map((v, i) => v + (flight.velocityTo[i] + softened[i]) * 0.025) as V3;
  const driven = along(contact, attackFacing, bell ? 0.1 : 0.14, bell ? 0.16 : 0.19, bell ? 0.08 : 0.02);
  const kickDirection = Math.atan2(landing[0] - driven[0], landing[2] - driven[2]);
  const kick = along(driven, kickDirection, 0.18, -0.06), kickAt = T.exit + 0.12;
  const retreat = ballisticVelocity(kick, landing, T.land - kickAt, 2 * kick[1] / (T.land - kickAt) + 1.0);
  const forward = (r: V3): V3 => [r[0] + fx * 10, 0, r[2] + fz * 10];
  // Держим одну сторону оси боя: обход, клинок и цель не меняются местами при склейке.
  const wide: V3 = [gx - fx * 8 + sx * 9, 3.3, gz - fz * 8 + sz * 9];
  const lowLook: V3 = [(approach[0] + gx) / 2, bell ? 2.1 : 1.6, (approach[2] + gz) / 2];
  const hit = attackFraming(attack, attackFacing, [0, 0.3, 0.44, MASK_RELEASE, MASK_CONTACT].map(time => ({ time, root: ballisticPoint(takeoff, contact, flightDur, T.strike + time - T.jump, bell ? 2 : 2.4) })).concat([{ time: MASK_CONTACT + 0.05, root: compression }, { time: MASK_CONTACT + 0.2, root: driven }]), target, KILL_FOV);
  const landingCam: V3 = [landing[0] - fx * 5 + sx * 6.5, 2.7, landing[2] - fz * 5 + sz * 6.5];
  const landingLook: V3 = [(landing[0] + gx) / 2, 1.5, (landing[2] + gz) / 2];
  const steps: CineStep[] = [
    { t: 0, do: 'clip', who: 'hero', clip: bell ? 'guardianApproach' : 'guardianSweep', blend: 0.18 },
    // Реакция врага тоже идёт по времени сцены: замедление мира не уводит шлем от маркера клинка.
    { t: 0, do: 'clip', who, clip: `${who}Reaction`, blend: 0.2, markers: { crumble: 'crumble', ...(bell ? { ring: 'bellRing' } : {}) }, definition: { id: `${who}Reaction`, dur: T.end, mask: 'full', events: [{ t: T.crumble, name: 'crumble' }, ...(bell ? [{ t: T.contact + 0.09, name: 'ring' }] : [])], keys: [
      { t: 0, pose: GUARDIAN_KILL_POSES[bell ? 'killcamKneel' : 'killcamStagger'], rootOffset: support(bell ? 'killcamKneel' : 'killcamStagger') },
      { t: T.knee, pose: GUARDIAN_KILL_POSES[bell ? 'killcamKneel' : 'killcamStagger'], rootOffset: support(bell ? 'killcamKneel' : 'killcamStagger') },
      ...(!bell ? [{ t: (T.knee + T.leap) / 2, ease: 'inSine' as const, pose: GUARDIAN_KILL_POSES.gateKneeling, rootOffset: support('gateKneeling') }] : []),
      { t: T.leap, ease: bell ? 'inOutSine' : 'outSine', pose: GUARDIAN_KILL_POSES.killcamKneel, rootOffset: support('killcamKneel') },
      { t: T.contact, pose: GUARDIAN_KILL_POSES.killcamKneel },
      { t: T.contact + 0.05, ease: 'outQuad', pose: GUARDIAN_KILL_POSES[bell ? 'bellImpulse' : 'gateImpulse'], rootOffset: support(bell ? 'bellImpulse' : 'gateImpulse') },
      { t: T.contact + (bell ? 0.12 : 0.18), ease: 'inOutSine', pose: GUARDIAN_KILL_POSES[bell ? 'bellCompression' : 'gateCompression'], rootOffset: support(bell ? 'bellCompression' : 'gateCompression') },
      { t: T.contact + (bell ? 0.24 : 0.3), ease: 'outCubic', pose: GUARDIAN_KILL_POSES[bell ? 'bellBody' : 'gateCollapse'], rootOffset: support(bell ? 'bellBody' : 'gateCollapse') },
      { t: T.contact + 0.48, ease: 'inOutSine', pose: GUARDIAN_KILL_POSES[bell ? 'bellRebound' : 'gateCompression'], rootOffset: support(bell ? 'bellRebound' : 'gateCompression') },
      ...(bell ? [
        { t: T.contact + 0.74, ease: 'inOutSine' as const, pose: GUARDIAN_KILL_POSES.bellSettle, rootOffset: support('bellSettle') },
        { t: T.contact + 1.04, ease: 'inOutSine' as const, pose: { ...GUARDIAN_KILL_POSES.bellSettle, bell: [0.035, 0, -0.01] as V3 }, rootOffset: support('bellSettle') },
      ] : []),
      { t: T.end, pose: GUARDIAN_KILL_POSES[bell ? 'bellSettle' : 'gateCompression'], rootOffset: support(bell ? 'bellSettle' : 'gateCompression') },
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
    { t: T.jump, do: 'actor', who: 'hero', moveTo: contact, dur: flightDur, ...flight, lookAt: forward(contact) },
    { t: T.leap, do: 'cam', path: [[wide[0] - sx * 0.3, wide[1], wide[2] - sz * 0.3], hit.cam], look: [lowLook, hit.look], dur: T.strike - T.leap, fov: KILL_FOV, blend: 0.25 },
    { t: T.strike, do: 'clip', who: 'hero', clip: attack, markers: { contact: bell ? 'bell' : 'helmet' }, blend: 0.12 },
    { t: T.strike + MASK_RELEASE, do: 'sfx', id: 'swing_heavy', gain: 0.9 },
    { t: T.strike, do: 'time', scale: 0.2, dur: MASK_RELEASE, rampIn: 0.1, rampOut: 0.18 },
    { t: T.contact, do: 'time', scale: 0.08, dur: 0.16, rampIn: 0, rampOut: 0.06 },
    { t: T.contact + 0.035, do: 'hold', dur: bell ? 0.045 : 0.065 },
    { t: T.strike, do: 'cam', path: [hit.cam], look: [hit.look], dur: T.exit - T.strike, fov: KILL_FOV, blend: 0 },
    { t: T.contact, do: 'actor', who: 'hero', moveTo: compression, dur: 0.05, velocityFrom: flight.velocityTo, velocityTo: softened },
    { t: T.contact + 0.05, do: 'actor', who: 'hero', moveTo: driven, dur: T.exit - T.contact - 0.05, velocityFrom: softened, velocityTo: [0, 0, 0] },
    ...(!bell ? [{ t: T.contact + 0.1, do: 'sfx' as const, id: 'shatter_stone', gain: 0.45 }] : []),
    // После удара остаётся отдельный читаемый кадр трещины/кольца, до распада.
    { t: T.contact, do: 'crack', who, to: 1, dur: 0.3 },
    { t: T.exit, do: 'clip', who: 'hero', clip: 'executionLand', blend: 0.22 },
    { t: T.exit, do: 'actor', who: 'hero', moveTo: kick, dur: 0.12, velocityFrom: [0, 0, 0], velocityTo: retreat.velocityFrom },
    { t: kickAt, do: 'actor', who: 'hero', moveTo: landing, dur: T.land - kickAt, ...retreat },
    { t: T.exit, do: 'cam', path: [hit.cam, landingCam], look: [hit.look, landingLook], dur: T.land - T.exit, fov: KILL_FOV, ease: 'inOutSine', blend: 0.22 },
    { t: T.land, do: 'sfx', id: 'land_impact', gain: 0.65 },
    { t: T.crumble + 0.35, do: 'call', fn: 'guardianTitle' },
    { t: T.crumble, do: 'time', scale: 0.32, dur: 0.7, rampIn: 0.08, rampOut: 0.25 },
    { t: T.land, do: 'cam', path: [landingCam, [landingCam[0] + sx * 0.5, landingCam[1] + 0.2, landingCam[2] + sz * 0.5]], look: [landingLook], dur: T.end - T.land, fov: KILL_FOV },
  ];
  // Подсечка также проходит после сэмплирования позы — как основной удар.
  if (!bell) {
    const clip = steps[0]; if (clip.do === 'clip') clip.markers = { contact: 'knee' };
    const i = steps.findIndex((s) => s.do === 'call' && s.fn === 'knee'); steps.splice(i, 1);
  }
  return { id: bell ? 'killBell' : 'killGate', revision: 4, cameraBlend: 0.25, origin: [gx, 0, gz], heading: attackFacing, steps, dur: T.end, blendOut: 0.65 };
}
export function killGateTrack(p: KillSpots): CineTrack { return killTrack(p, false); }
export function killBellTrack(p: KillSpots): CineTrack { return killTrack(p, true); }
