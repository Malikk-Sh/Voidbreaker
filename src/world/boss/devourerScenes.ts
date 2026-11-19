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
const cue = (t: number, fn: string): CineStep => ({ t, do: 'call', fn });
const pose = (t: number, clip: string, dur: number): CineStep => ({
  t,
  do: 'clip',
  who: 'boss',
  clip,
  speed: 1 / dur,
  dur,
  blend: 0.12,
});
const sound = (t: number, id: string, gain: number): CineStep => ({ t, do: 'sfx', id, gain });

export function devourerIntro(hx = 0, hz = 6): CineTrack {
  const smash: CineStep[] = [
    { t: 3.55, do: 'actor', who: 'boss', moveTo: LANDING, dur: 0.59, ease: 'inQuad', lookAt: STONE_MARK },
    pose(3.55, 'bound', 0.6),
    cue(4.14, 'stoneImpact'),
    { t: 4.14, do: 'hold', dur: 0.075 },
    pose(4.15, 'brace', 0.69),
    { t: 4.16, do: 'actor', who: 'echoStone', moveTo: [-4.8, 2.35, -0.18], dur: 0.38, ease: 'outQuad' },
    { t: 4.54, do: 'actor', who: 'echoStone', moveTo: [-7.04, 1.41, 1.15], dur: 0.40, ease: 'inQuad' },
    { t: 4.95, do: 'actor', who: 'echoStone', moveTo: [-6.85, 0.24, 1.43], dur: 0.46, ease: 'inQuad' },
  ];
  return {
    id: DEVOURER_SCENES[0],
    dur: 8.35,
    blendOut: 0.58,
    skippable: true,
    steps: [
      { t: 0, do: 'music', cue: 'silence' },
      sound(0.05, 'drone', 0.4),
      cam(
        0,
        [
          [hx + 1.1, 1.45, hz + 2.3],
          [hx + 0.6, 1.15, hz + 1.5],
        ],
        [
          [-3, 2, -1.5],
          [-2.6, 1.4, -1.5],
        ],
        1.45,
        49
      ),
      cam(
        1.45,
        [
          [-0.45, 1.45, 0.6],
          [-0.95, 0.42, 0.22],
        ],
        [[-2.6, 2.5, -1.5], STONE_MARK],
        0.95,
        38
      ),
      { t: 1.47, do: 'actor', who: 'echoStone', moveTo: STONE_MARK, dur: 0.62, ease: 'inQuad' },
      cue(2.09, 'stoneTick'),
      cam(
        2.4,
        [
          [5.45, 2.6, -2.65],
          [4.85, 2.5, -2.65],
        ],
        [
          [4.15, 2.23, -5.0],
          [3.5, 2.05, -5.17],
        ],
        1.1,
        44
      ),
      pose(2.4, 'listen', 1.08),
      { t: 2.43, do: 'actor', who: 'boss', lookAt: STONE_MARK, turn: 0.55 },
      cam(
        3.5,
        [
          [-4.1, 0.95, -0.8],
          [-4.65, 1.03, 0.16],
        ],
        [
          [2.3, 1.75, -4.6],
          [-1.5, 1.25, -2.3],
        ],
        1.18,
        54,
        -0.035
      ),
      ...smash,
      cam(
        4.68,
        [
          [-8.95, 1.77, 4.65],
          [-6.45, 2.21, 4.82],
        ],
        [
          [-6.0, 1.49, 0.58],
          [-1.1, 1.46, -2.55],
        ],
        1.65,
        46
      ),
      cue(4.94, 'bellAnswer'),
      pose(5.03, 'bellFall', 1.03),
      pose(6.06, 'bellRise', 0.77),
      sound(6.87, 'boss_roar', 0.72),
      pose(6.87, 'roar', 1.20),
      { t: 6.0, do: 'banner', text: 'ПОЖИРАТЕЛЬ', color: 'hunger', size: 48, dur: 1.87 },
      cam(
        6.33,
        [
          [-5.1, 2.15, 1.8],
          [-2.4, 7.1, 9.4],
          [1.4, 11.5, 12.2],
        ],
        [
          [-1.1, 1.4, -2.3],
          [0, 0.8, 0.9],
        ],
        1.72,
        49
      ),
    ],
    short: [
      cam(
        0,
        [
          [-4.4, 1.1, 0.2],
          [-5, 1.4, 0.7],
        ],
        [
          [2, 1.8, -4],
          [-1.4, 1.53, -2.35],
        ],
        1.4,
        49
      ),
      { t: 0, do: 'actor', who: 'echoStone', moveTo: STONE_MARK, dur: 0.24, ease: 'inQuad' },
      cue(0.24, 'stoneTick'),
      { t: 0.4, do: 'actor', who: 'boss', moveTo: LANDING, lookAt: STONE_MARK, dur: 0.55, ease: 'inQuad' },
      pose(0.4, 'bound', 0.55),
      cue(0.95, 'stoneImpact'),
      { t: 0.95, do: 'actor', who: 'echoStone', moveTo: [-7.04, 1.41, 1.15], dur: 0.36, ease: 'outQuad' },
      cue(1.31, 'bellAnswer'),
      pose(1.36, 'bellFall', 0.65),
      pose(2.01, 'bellRise', 0.5),
      { t: 1.03, do: 'banner', text: 'ПОЖИРАТЕЛЬ', color: 'hunger', size: 47, dur: 1.5 },
      cam(
        1.4,
        [
          [-4.8, 2, 1],
          [1.2, 10, 11],
        ],
        [[0, 1, 0]],
        1,
        48
      ),
    ],
  };
}
export function devourerShift(phase: 2 | 3, x = 0, z = 0): CineTrack {
  if (phase === 2)
    return {
      id: DEVOURER_SCENES[1],
      dur: 3.2,
      blendOut: 0.4,
      steps: [
        cam(
          0,
          [
            [x + 4, 3.25, z + 5.2],
            [3.5, 3, -1.5],
          ],
          [
            [x, 1.4, z],
            [0, 1.6, -5.8],
          ],
          1.13,
          54
        ),
        { t: 0, do: 'actor', who: 'boss', lookAt: [0, 1, -5.8], turn: 0.35 },
        pose(0, 'brace', 0.55),
        { t: 0.55, do: 'actor', who: 'boss', moveTo: [0, 0, -4.6], dur: 0.59, ease: 'inQuad' },
        pose(0.55, 'bound', 0.59),
        cue(1.14, 'looseBell'),
        { t: 1.16, do: 'actor', who: 'echoBell', moveTo: [1.8, 0.81, -5.8], dur: 1.43, ease: 'outQuad' },
        sound(1.14, 'chain_drop', 0.88),
        pose(1.15, 'rakeR', 0.65),
        cam(
          1.15,
          [
            [-3.4, 1.1, -2.8],
            [-4.4, 1.5, -1.7],
          ],
          [
            [0, 1.2, -5.8],
            [1.6, 0.8, -5.8],
          ],
          1.45,
          51
        ),
        { t: 1.29, do: 'banner', text: 'ИССТУПЛЕНИЕ', color: 'hunger', size: 40, dur: 1.6 },
      ],
    };
  return {
    id: DEVOURER_SCENES[2],
    dur: 3.12,
    blendOut: 0.36,
    steps: [
      cam(
        0,
        [
          [x - 3.9, 1.3, z + 5],
          [x - 4.8, 2.4, z + 5.8],
        ],
        [
          [x, 1.65, z],
          [x, 2.15, z],
        ],
        1.3,
        52
      ),
      pose(0, 'inhale', 1.27),
      cue(0.13, 'drawBreath'),
      pose(1.27, 'vent', 0.85),
      cam(1.3, [[0.4, 8.8, 12.4], [0, 12.8, 11.9]], [[0, 0.9, -1.4]], 1.62, 59),
      cue(1.84, 'echoCry'),
      sound(1.84, 'boss_roar', 0.8),
      { t: 1.97, do: 'call', fn: 'rimAnswer', arg: 0 },
      { t: 2.09, do: 'call', fn: 'rimAnswer', arg: 1 },
      { t: 2.21, do: 'call', fn: 'rimAnswer', arg: 2 },
      { t: 1.67, do: 'banner', text: 'ПОСЛЕДНЕЕ ЭХО', color: 'hunger', size: 40, dur: 1.36 },
    ],
  };
}
export function devourerEnd(x = 0, z = 0): CineTrack {
  return {
    id: DEVOURER_SCENES[3],
    dur: 3.6,
    blendOut: 0.4,
    steps: [
      { t: 0, do: 'music', cue: 'silence' },
      pose(0, 'fall', 1.52),
      cam(
        0,
        [
          [x - 4.1, 1.2, z + 5.1],
          [x - 3.4, 1.1, z + 4.25],
        ],
        [
          [x, 1.7, z],
          [x, 0.9, z],
        ],
        1.48,
        49
      ),
      cue(1.48, 'lastBreath'),
      sound(1.48, 'shatter_stone', 0.72),
      cam(
        1.5,
        [
          [x - 4.7, 2.2, z + 4.7],
          [x - 6.1, 5.8, z + 9.4],
        ],
        [
          [x, 0.9, z],
          [x, 2.9, z],
        ],
        1.8,
        51
      ),
      { t: 1.85, do: 'sky', param: 'starLit', to: 1, dur: 1.2 },
      { t: 2.32, do: 'music', cue: 'resolve' },
    ],
  };
}
