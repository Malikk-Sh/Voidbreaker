import type { CineStep, CineTrack, V3 } from '../../game/director';

export const DEVOURER_SCENES = ['devourerIntro', 'devourerFrenzy', 'devourerEcho', 'devourerEnd'] as const;
export const DEVOURER_START: V3 = [4.4, 0, -6.5];
export const STONE_MARK: V3 = [-2.6, 0.18, -1.5];
export const LANDING: V3 = [-1.1, 0, -2.55];
const cam = (t: number, path: V3[], look: V3[], dur: number, fov: number, roll = 0): CineStep => ({
  t,
  do: 'cam',
  path,
  look,
  dur,
  fov,
  roll,
  ease: 'inOutSine',
});
const cue = (t: number, fn: string): CineStep => ({ t, do: 'call', fn, onSkip: false });
const pose = (t: number, clip: string, dur: number): CineStep => ({
  t,
  do: 'clip',
  who: 'boss',
  clip,
  speed: 1 / dur,
  dur,
  blend: 0.26,
});
const sound = (t: number, id: string, gain: number): CineStep => ({ t, do: 'sfx', id, gain });

/** Each scene is a single dolly. Position and point of attention follow independent continuous splines. */
export function devourerIntro(hx = 0, hz = 6): CineTrack {
  const listenAt: V3 = [STONE_MARK[0], 0.85, STONE_MARK[2]];
  const approach: CineStep = { t: 2.45, do: 'actor', who: 'boss', lookAt: [-3.85, 1, -0.58], turn: 0.78,
    moveTo: LANDING, dur: 2.18, ease: 'inOutSine' };
  return {
    id: DEVOURER_SCENES[0], revision: 2, dur: 8.65, blendOut: 0.82, skippable: true,
    steps: [
      { t: 0, do: 'music', cue: 'silence' },
      cam(0, [[hx - 1.3, 6.4, hz + 3.8], [-3.7, 3.45, 2.25], [-2.8, 2.74, 1.8],
        [-4.77, 2.62, 4.65], [-4.23, 3.14, 5.74], [-0.55, 9.2, 11.9]],
        [[0.6, 1.16, -2.4], [0.1, 1.53, -3.3], [1.68, 2.03, -4.22], [-1.33, 2.12, -2.06],
          [LANDING[0], 1.72, LANDING[2]], [0, 0.87, 0.5]], 8.65, 45),
      pose(0, 'awaken', 2.55), sound(0.12, 'drone', 0.36),
      { t: 0.54, do: 'actor', who: 'echoStone', moveTo: STONE_MARK, dur: 0.95, ease: 'inQuad' },
      cue(1.49, 'stoneTick'), { t: 1.54, do: 'actor', who: 'boss', lookAt: STONE_MARK, turn: 0.8 },
      approach, { t: 2.45, do: 'clip', who: 'boss', clip: 'stalk', dur: 2.18, speed: 0.92, blend: 0.3 },
      cue(4.63, 'stoneImpact'), { t: 4.64, do: 'actor', who: 'boss', lookAt: [-6.5, 1.2, 2.5], turn: 0.84 },
      pose(4.64, 'pluck', 1.72), cue(5.76, 'bellAnswer'), pose(6.18, 'unfurl', 2.18),
      { t: 6.14, do: 'banner', text: 'ПОЖИРАТЕЛЬ', color: 'hunger', size: 48, dur: 1.95 },
      { t: 7.12, do: 'actor', who: 'boss', lookAt: [hx, 1, hz], turn: 0.96 },
    ],
    short: [
      cam(0, [[-3.6, 3.1, 4.1], [-4.3, 3.2, 4.8], [-2.8, 6.4, 8.8]],
        [[2.35, 1.7, -4.85], [-0.6, 1.6, -2.55], [0, 1.0, -0.5]], 3.0, 47),
      pose(0, 'awaken', 0.96),
      { t: 0, do: 'actor', who: 'echoStone', moveTo: STONE_MARK, dur: 0.41, ease: 'inQuad' },
      cue(0.41, 'stoneTick'),
      { ...approach, t: 0.52, lookAt: listenAt, dur: 1.54 }, pose(0.72, 'stalk', 1.28),
      pose(2.0, 'pluck', 1.03), cue(2.57, 'bellAnswer'),
      { t: 1.18, do: 'banner', text: 'ПОЖИРАТЕЛЬ', color: 'hunger', size: 45, dur: 1.45 },
    ],
  };
}

export function devourerShift(phase: 2 | 3, x = 0, z = 0, hx = 0, hz = 5): CineTrack {
  const frenzy = phase === 2, dur = frenzy ? 4.15 : 4.55;
  const fx = hx * 0.55 + x * 0.45, fz = hz * 0.55 + z * 0.45;
  const wide: V3 = [fx, 9.6, fz + 10.8];
  const framing: V3 = [fx, 0.95, fz];
  const path: V3[] = frenzy ? [wide, [x - 2.7, 4.6, z + 6.4], [x - 3.8, 3.55, z + 5.1],
    [fx - 2.6, 7.15, fz + 7.95], wide] : [wide, [x - 3.1, 4.1, z + 5.35],
    [x - 4.2, 3.2, z + 5.95], [fx - 2.65, 7.8, fz + 8.7], wide];
  const strokes: CineStep[] = frenzy
    ? [{ t: 1.39, do: 'call', fn: 'rimAnswer', onSkip: false, arg: 0 }, { t: 2.12, do: 'call', fn: 'rimAnswer', onSkip: false, arg: 1 }]
    : [cue(1.18, 'drawBreath'), cue(2.38, 'echoCry'), ...[2, 1, 0].map((i, n): CineStep => ({ t: 2.42 + n * 0.25, do: 'call', fn: 'rimAnswer', onSkip: false, arg: i }))];
  return {
    id: DEVOURER_SCENES[frenzy ? 1 : 2], revision: 2, dur, blendOut: 0.72, skippable: true,
    steps: [
      cam(0, path, [framing, [x, 1.74, z], [x, 2.44, z + 0.35], [x, 1.49, z], framing], dur, 47),
      pose(0, frenzy ? 'unfurl' : 'eclipse', dur - 0.12),
      { t: 0.1, do: 'actor', who: 'boss', lookAt: [x - 1.2, 1, z + 4.2], turn: 1.04 },
      cue(frenzy ? 1.25 : 2.16, 'newMovement'), ...strokes,
      { t: dur - 1.06, do: 'actor', who: 'boss', lookAt: [hx, 0, hz], turn: 0.84 },
      { t: frenzy ? 1.38 : 1.66, do: 'banner', text: frenzy ? 'ИССТУПЛЕНИЕ' : 'ПОСЛЕДНЕЕ ЭХО', color: 'hunger', size: 39, dur: 1.55 },
    ],
  };
}
export function devourerEnd(x = 0, z = 0): CineTrack {
  return {
    id: DEVOURER_SCENES[3], revision: 2, dur: 3.8, blendOut: 0.68,
    steps: [
      { t: 0, do: 'music', cue: 'silence' }, pose(0, 'fall', 1.72),
      cam(0, [[x - 3.2, 3.1, z + 6.4], [x - 3.85, 2.51, z + 5.8], [x - 4.86, 3.8, z + 7.1], [x - 5.1, 6.9, z + 9.4]],
        [[x, 1.85, z], [x, 0.97, z], [x, 1.5, z], [x, 3.14, z]], 3.8, 48),
      cue(1.72, 'lastBreath'), sound(1.72, 'shatter_stone', 0.67),
      { t: 1.98, do: 'sky', param: 'starLit', to: 1, dur: 1.42 }, { t: 2.55, do: 'music', cue: 'resolve' },
    ],
  };
}
