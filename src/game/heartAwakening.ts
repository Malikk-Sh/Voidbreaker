import type { ClipDef } from '../anim/clip';
import { HEART_SOUL, HeartSoul } from '../world/heartSoul';
import type { CineStep, CineTrack, V3 } from './director';

const aisleX = (x: number): number => Math.max(-3, Math.min(3, x));
const ready = {
  chest: [0.06, 0, 0] as V3, head: [-0.08, 0, 0] as V3,
  shR: [-0.45, 0, -0.18] as V3, elbR: [-0.55, 0, 0] as V3,
  shL: [-0.25, 0, 0.24] as V3, elbL: [-0.35, 0, 0] as V3,
  hipL: [-0.08, 0, 0] as V3, hipR: [0.08, 0, 0] as V3,
  kneeL: [0.12, 0, 0] as V3, kneeR: [0.12, 0, 0] as V3,
};

function witnessClip(id: string, dur: number, awakening: boolean): ClipDef {
  const lookUp = { ...ready, head: [-0.45, 0, 0] as V3, chest: [-0.06, 0, 0] as V3 };
  const brace = { ...ready, chest: [0.17, 0, 0] as V3, shL: [-0.5, 0, 0.32] as V3, kneeL: [0.25, 0, 0] as V3, kneeR: [0.2, 0, 0] as V3 };
  return { id, dur, mask: 'full', keys: awakening ? [
    { t: 0, pose: ready }, { t: 0.8, pose: lookUp },
    { t: 2.3, pose: brace }, { t: 2.65, pose: ready },
    { t: 3.25, pose: brace }, { t: 3.7, pose: ready }, { t: dur, pose: ready },
  ] : [
    { t: 0, pose: ready }, { t: 0.6, pose: lookUp },
    { t: Math.min(1.9, dur - 0.2), pose: lookUp }, { t: dur, pose: ready },
  ] };
}

/** Душа уходит вверх над павшей элитой; камера не летит к ещё не найденному Сердцу. */
export function heartSoulEscapeTrack(hero: V3, source: V3): CineTrack {
  const x = source[0], z = source[2];
  const soul = new HeartSoul();
  soul.escape(x, z);
  const orb = (t: number): V3 => {
    soul.sampleEscape(t);
    return [soul.position.x, soul.position.y, soul.position.z];
  };
  const first: V3 = [x + 2.8, 3.1, z + 6.8];
  const lift: V3 = [x + 3.1, 6.4, z + 7];
  const high: V3 = [x + 1.3, 16.8, z + 7.5];
  const steps: CineStep[] = [
    { t: 0, do: 'actor', who: 'hero', lookAt: [x, hero[1], z], turn: 0.3 },
    { t: 0, do: 'clip', who: 'hero', clip: 'heartSoulWitness', definition: witnessClip('heartSoulWitness', HEART_SOUL.escapeDur, false), blend: 0.18 },
    { t: 0, do: 'music', cue: 'silence' },
    { t: 0, do: 'cam', path: [first, lift], look: [orb(0), orb(0.55)], dur: 0.55, fov: 46, ease: 'linear' },
    { t: 0.55, do: 'cam', path: [lift, [x + 2.4, 11.5, z + 7.3], high], look: [orb(0.55), orb(1.2), orb(HEART_SOUL.hideAt)], dur: 1.35, fov: 48, ease: 'linear', blend: 0.12 },
    { t: HEART_SOUL.hideAt, do: 'call', fn: 'heartSoulHide' },
    { t: HEART_SOUL.hideAt, do: 'cam', path: [high, [x + 1.3, 17.2, z + 7.7]], look: [[x - 0.55, 18, z - 0.6]], dur: 0.5, fov: 48, ease: 'outSine', blend: 0.12 },
  ];
  const short: CineStep[] = steps.map((s): CineStep => {
    if (s.do === 'cam' && s.t === HEART_SOUL.hideAt) return { ...s, dur: 0 };
    if (s.do === 'clip') return { ...s, dur: 1.9, definition: witnessClip('heartSoulWitness', 1.9, false) };
    return s;
  });
  return { id: 'heartSoulEscape', dur: HEART_SOUL.escapeDur, steps, short, skippable: true, blendOut: 0.65 };
}

/** Arrival, absorption and two heavy beats are one continuous reveal, then a readable hero/boss frame. */
export function heartAwakeningTrack(hero: V3, centerZ: number): CineTrack {
  // Весь отъезд остаётся перед внутренней стороной ворот (centerZ + 15).
  // Высота и чуть более близкий к герою взгляд сохраняют ноги/голову даже при входе сбоку.
  const wide: V3 = [aisleX(hero[0] * 0.5), 18.5, Math.min(hero[2] + 3, centerZ + 13.5)];
  const wideLook: V3 = [hero[0] * 0.3, 2.4, centerZ + (hero[2] - centerZ) * 0.55];
  const incoming: V3 = [2, 10.7, centerZ + 14];
  const incomingLook: V3 = [0, 10.8, centerZ + 4];
  const coreCam: V3 = [1.7, 5.5, centerZ + 10.5];
  const coreLook: V3 = [0, HEART_SOUL.coreY, centerZ];
  const openedCam: V3 = [2.1, 6.3, centerZ + 12.5];
  const steps: CineStep[] = [
    { t: 0, do: 'actor', who: 'hero', lookAt: [0, hero[1], centerZ], turn: 0.3 },
    { t: 0, do: 'clip', who: 'hero', clip: 'heartAwakeningWitness', definition: witnessClip('heartAwakeningWitness', HEART_SOUL.arrivalDur, true), blend: 0.18 },
    { t: 0, do: 'music', cue: 'silence' },
    { t: 0, do: 'cam', path: [wide, [aisleX(hero[0] * 0.4), wide[1] + 0.3, wide[2] + 0.25]], look: [wideLook], dur: 0.65, fov: 56, ease: 'inOutSine' },
    { t: 0.65, do: 'cam', path: [incoming, [1.8, 9.2, centerZ + 12.5]], look: [incomingLook, [0, 8, centerZ + 2.3]], dur: 0.95, fov: 48, ease: 'linear', blend: 0.2 },
    { t: 1.6, do: 'cam', path: [[1.8, 9.2, centerZ + 12.5], coreCam], look: [[0, 8, centerZ + 2.3], coreLook], dur: 0.7, fov: 46, ease: 'inQuad', blend: 0.12 },
    { t: HEART_SOUL.absorbAt, do: 'call', fn: 'heartSoulAbsorb' },
    { t: HEART_SOUL.absorbAt, do: 'sfx', id: 'heartbeat', gain: 0.7 },
    { t: HEART_SOUL.absorbAt, do: 'cam', path: [coreCam, [1.6, 5.35, centerZ + 10.2]], look: [coreLook], dur: 0.85, fov: 44, ease: 'outCubic', blend: 0.08 },
    { t: 3.15, do: 'sfx', id: 'heartbeat', gain: 0.85 },
    { t: 3.15, do: 'sfx', id: 'land_impact', gain: 0.22 },
    { t: 3.15, do: 'cam', path: [[1.6, 5.35, centerZ + 10.2], openedCam], look: [coreLook, [0, 4.2, centerZ]], dur: 0.65, fov: 48, ease: 'outSine', blend: 0.1 },
    { t: 3.8, do: 'cam', path: [openedCam, wide], look: [[0, 4.2, centerZ], wideLook], dur: 0.6, fov: 56, ease: 'inOutSine', blend: 0.12 },
    { t: HEART_SOUL.awakeAt, do: 'call', fn: 'heartAwake' },
    { t: 4.9, do: 'banner', text: 'ПОГРЕБАЛЬНОЕ СЕРДЦЕ', color: 'hunger', dur: 1.4, size: 42 },
    { t: 4.9, do: 'cam', path: [wide, [wide[0], wide[1] + 0.3, wide[2] + 0.4]], look: [wideLook], dur: 0.7, fov: 56, ease: 'outSine', blend: 0.12 },
  ];
  // Логические маркеры сохраняют абсолютное время: HeartSoul не требует отдельного short-clock.
  const short = steps.flatMap<CineStep>((s): CineStep[] => {
    if (s.do === 'banner' || s.t >= 4.9) return [];
    if (s.do === 'clip') return [{ ...s, dur: 4.6 }];
    return [s];
  });
  return { id: 'heartAwakening', dur: HEART_SOUL.arrivalDur, steps, short, skippable: true, blendOut: 0.8 };
}
