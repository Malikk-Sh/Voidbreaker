import type { CineStep, CineTrack, V3 } from './director';

/** Вход Стража действием: решётка, два шага с переносом веса, опора и только затем бой. */
export function gateEntranceTrack(hero: V3, landing: V3 = [0, 0, -5.5]): CineTrack {
  const idle = { chest: [0.08, 0, 0] as V3, shR: [-0.45, 0, -0.25] as V3, elbR: [-0.7, 0, 0] as V3, shL: [-0.3, 0, 0.3] as V3 };
  const left = { ...idle, chest: [0.18, 0.07, 0.04] as V3, hipL: [-0.3, 0, 0.08] as V3, kneeL: [0.5, 0, 0] as V3, hipR: [0.18, 0, -0.04] as V3 };
  const right = { ...idle, chest: [0.15, -0.07, -0.04] as V3, hipR: [-0.3, 0, -0.08] as V3, kneeR: [0.5, 0, 0] as V3, hipL: [0.18, 0, 0.04] as V3 };
  const steps: CineStep[] = [
    { t: 0, do: 'actor', who: 'gateGuardian', moveTo: [0, 0, -16], lookAt: hero },
    { t: 0, do: 'clip', who: 'gateGuardian', clip: 'gateEntrance', blend: 0.2, definition: {
      id: 'gateEntrance', dur: 4.2, mask: 'full', keys: [
        { t: 0, pose: idle }, { t: 0.85, pose: idle },
        { t: 1.2, pose: left }, { t: 1.65, pose: right },
        { t: 2.1, pose: left }, { t: 2.5, pose: right },
        { t: 2.75, pose: { ...idle, chest: [0.25, 0, 0], kneeL: [0.18, 0, 0], kneeR: [0.18, 0, 0] } },
        { t: 3.25, pose: idle }, { t: 4.2, pose: idle },
      ],
    } },
    { t: 0, do: 'cam', path: [[6, 4.5, 16], [landing[0] + 5, 3.5, landing[2] + 17.5]], look: [[0, 4.5, -13], [landing[0], 4.3, landing[2] - 2.5]], dur: 2.75, fov: 48, ease: 'inOutSine' },
    { t: 0.15, do: 'call', fn: 'gateLift', arg: 0.48 },
    { t: 0.15, do: 'sfx', id: 'shatter_stone', gain: 0.5 },
    { t: 0.85, do: 'actor', who: 'gateGuardian', moveTo: landing, dur: 1.9, ease: 'inOutSine', lookAt: hero, turn: 0.3 },
    { t: 1.65, do: 'call', fn: 'gateStep' },
    { t: 2.75, do: 'call', fn: 'gateStep' },
    { t: 2.75, do: 'sfx', id: 'boss_roar', gain: 0.65 },
    { t: 2.8, do: 'banner', text: 'СТРАЖ ВРАТ', sub: 'Хранитель порога', color: 'hunger', dur: 1.6, size: 48 },
    { t: 2.75, do: 'cam', path: [[landing[0] + 5, 3.5, landing[2] + 17.5], [hero[0] + 2, 6.8, hero[2] + 11]], look: [[landing[0], 4.3, landing[2]], [hero[0] * 0.65 + landing[0] * 0.35, 0.8, hero[2] * 0.65 + landing[2] * 0.35]], dur: 1.45, fov: 42, ease: 'inOutSine', blend: 0.2 },
    { t: 3.1, do: 'call', fn: 'gateLift', arg: 0 },
  ];
  const short: CineStep[] = steps.map((s) => {
    const t = s.t * 0.6;
    if (s.do === 'clip') return { ...s, t, speed: 1 / 0.6 };
    return 'dur' in s && s.dur !== undefined ? { ...s, t, dur: s.dur * 0.6 } : { ...s, t };
  });
  return { id: 'gateEntrance', dur: 4.2, steps, short, skippable: true, blendOut: 0.55 };
}
