import type { CineStep, CineTrack, V3 } from '../../game/director';

/** Где стоят актёры сцены Иерофанта: герой и босс. */
export interface HierophantSpots { hx: number; hz: number; bx: number; bz: number }

/** Время шагов интро (с от начала дорожки). */
export const INTRO_T = { runes: 1.0, tolls: [2.2, 3.2, 4.2], descend: 4.6, ignite: 5.4, slam: 6.3, begin: 7.8 };
/** Высота, с которой Иерофант спускается по цепям (м). */
export const DESCEND_FROM = 16;

/**
 * Интро Иерофанта 2.0 (план §8.3, ≈8 с, пропускается): герой входит в неф, музыка затихает — ветер и гул;
 * на дальнем конце загораются красные руны; колокол бьёт трижды, с каждым ударом гаснет ряд свечей к герою;
 * Иерофант спускается по цепям, в колоколе разгорается огонь; один тяжёлый удар о пол, пыль с потолка;
 * имя «впечатывается» с первым ударом музыки; управление возвращается — и сразу Звон.
 * Логика (шаги 'call'): quiet, runes, douse ×3, descend, ignite, slam, music, begin.
 */
export function hierophantIntroTrack(p: HierophantSpots): CineTrack {
  const T = INTRO_T;
  const { hx, hz, bx, bz } = p;
  const dx = bx - hx, dz = bz - hz, dl = Math.hypot(dx, dz) || 1;
  const fx = dx / dl, fz = dz / dl;
  // герой проходит 2.5 м вглубь нефа
  const walk: V3 = [hx + fx * 2.5, 0, hz + fz * 2.5];
  const mx = (hx + bx) / 2, mz = (hz + bz) / 2;
  // поперёк нефа
  const sx = -fz, sz = fx;
  const steps: CineStep[] = [
    { t: 0, do: 'call', fn: 'quiet' },
    { t: 0, do: 'sfx', id: 'drone', gain: 0.7 },
    { t: 0, do: 'actor', who: 'hero', moveTo: walk, dur: 2.2, ease: 'inOutSine', lookAt: [bx, 0, bz] },
    // за спиной героя — взгляд в глубину нефа, к будущему алтарю
    { t: 0, do: 'cam', path: [[hx - fx * 4.5 + sx * 1.6, 1.5, hz - fz * 4.5 + sz * 1.6], [walk[0] - fx * 3.2 + sx * 1.2, 1.7, walk[2] - fz * 3.2 + sz * 1.2]], look: [[bx, 2.6, bz]], dur: T.tolls[0] + 0.2, ease: 'linear' },
    { t: T.runes, do: 'call', fn: 'runes' },
    // три удара колокола — ряды свечей гаснут к герою
    ...T.tolls.flatMap((t, i): CineStep[] => [
      { t, do: 'sfx', id: 'boss_bell', gain: 0.8 + i * 0.1 },
      { t, do: 'call', fn: 'douse', arg: i + 1 },
    ]),
    // от алтаря вдоль нефа к герою: ряды свечей по обе стороны гаснут к нему
    { t: T.tolls[0], do: 'cam', path: [[bx - fx * 1.5, 3.4, bz - fz * 1.5], [bx - fx * 4, 2.6, bz - fz * 4]], look: [[hx, 0.6, hz], [walk[0], 0.9, walk[2]]], dur: T.descend - T.tolls[0] + 0.1 },
    // спуск по цепям: снизу вверх
    { t: T.descend, do: 'call', fn: 'descend' },
    { t: T.descend, do: 'actor', who: 'boss', moveTo: [bx, 0, bz], dur: 1.6, ease: 'outCubic' },
    { t: T.descend, do: 'sfx', id: 'chain_drop', gain: 0.9 },
    { t: T.descend, do: 'cam', path: [[bx - fx * 9 + sx * 3, 0.8, bz - fz * 9 + sz * 3], [bx - fx * 8 + sx * 2, 1.2, bz - fz * 8 + sz * 2]], look: [[bx, 7.5, bz], [bx, 4.2, bz]], dur: T.slam - T.descend + 0.2, ease: 'outCubic' },
    { t: T.descend + 0.7, do: 'say', line: 'Звоню… по спасению… твоему.', speaker: 'boss' },
    { t: T.ignite, do: 'call', fn: 'ignite' },
    // один тяжёлый удар: имя — с первым ударом музыки
    { t: T.slam, do: 'call', fn: 'slam' },
    { t: T.slam, do: 'call', fn: 'music' },
    { t: T.slam, do: 'banner', text: 'ИЕРОФАНТ СКОРБИ', sub: 'Звонящий по спасению', color: 'hunger', dur: 3.2, size: 50 },
    { t: T.slam, do: 'cam', path: [[bx - fx * 8 + sx * 2, 1.2, bz - fz * 8 + sz * 2], [walk[0] - fx * 11 + sx * 2, 9, walk[2] - fz * 11 + sz * 2]], look: [[bx, 4.2, bz], [mx, 1.2, mz]], dur: T.begin - T.slam, ease: 'inOutSine' },
    { t: T.begin, do: 'call', fn: 'begin' },
  ];
  // увиденное дважды: только спуск, удар и имя
  const short: CineStep[] = [
    { t: 0, do: 'call', fn: 'quiet' },
    { t: 0, do: 'call', fn: 'descend' },
    { t: 0, do: 'actor', who: 'boss', moveTo: [bx, 0, bz], dur: 1.2, ease: 'outCubic' },
    { t: 0, do: 'cam', path: [[bx - fx * 9 + sx * 3, 0.8, bz - fz * 9 + sz * 3]], look: [[bx, 6, bz], [bx, 4.2, bz]], dur: 1.4, ease: 'outCubic' },
    { t: 0.5, do: 'call', fn: 'ignite' },
    { t: 1.3, do: 'call', fn: 'slam' },
    { t: 1.3, do: 'call', fn: 'music' },
    { t: 1.3, do: 'banner', text: 'ИЕРОФАНТ СКОРБИ', sub: 'Звонящий по спасению', color: 'hunger', dur: 2.6, size: 50 },
    { t: 2.6, do: 'call', fn: 'begin' },
  ];
  return { id: 'hierophantIntro', steps, short, dur: T.begin + 0.2, blendOut: 0.8 };
}
