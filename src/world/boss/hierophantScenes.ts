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
    { t: T.slam, do: 'banner', text: 'ИЕРОФАНТ СКОРБИ', sub: 'Слепой понтифик', color: 'hunger', dur: 3.2, size: 50 },
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
    { t: 1.3, do: 'banner', text: 'ИЕРОФАНТ СКОРБИ', sub: 'Слепой понтифик', color: 'hunger', dur: 2.6, size: 50 },
    { t: 2.6, do: 'call', fn: 'begin' },
  ];
  return { id: 'hierophantIntro', steps, short, dur: T.begin + 0.2, blendOut: 0.8 };
}

/** Время шагов перехода I→II (с от начала дорожки). */
export const COLLAPSE_T = { collapse: 0.1, land: 1.1, braam: 1.7, tocsin: 2.6, banner: 2.7, phase: 3.7 };

/**
 * Переход I→II (план §8.3): Иерофант хватается за колокол; пол нефа проваливается в замедлении, камера
 * отъезжает — под ареной огромный собор и бездна; Пилот приземляется на мост. Музыка: такт тишины →
 * хоровой аккорд и «брам» → набат. Логика: collapse, land, braam, tocsin, phase.
 */
export function collapseTrack(p: HierophantSpots): CineTrack {
  const T = COLLAPSE_T;
  const { hx, hz } = p;
  const steps: CineStep[] = [
    { t: 0, do: 'call', fn: 'silence' },
    { t: T.collapse, do: 'call', fn: 'collapse' },
    { t: T.collapse, do: 'time', scale: 0.45, dur: 1.2 },
    { t: 0, do: 'actor', who: 'boss', moveTo: [0, 0, 0], dur: 1.6, ease: 'inOutSine' },
    // отъезд: высоко над ареной, взгляд в бездну — там собор под собором
    { t: 0, do: 'cam', path: [[hx + 3, 12, hz + 14], [hx + 9, 24, hz + 30], [6, 30, 34]], look: [[hx * 0.5, 0, hz * 0.5], [0, -14, 0], [0, -26, -4]], dur: T.tocsin, ease: 'inOutSine' },
    { t: T.land, do: 'call', fn: 'land' },
    { t: T.braam, do: 'call', fn: 'braam' },
    // назад к мосту: набат
    { t: T.tocsin, do: 'cam', path: [[6, 30, 34], [hx * 0.6 + 4, 11, hz * 0.6 + 15]], look: [[0, -26, -4], [0, 1.5, 0]], dur: T.phase - T.tocsin, ease: 'inOutCubic' },
    { t: T.tocsin, do: 'call', fn: 'tocsin' },
    { t: T.banner, do: 'banner', text: 'НАБАТ', sub: 'Вторая фаза', color: 'hunger', dur: 2.2, size: 52 },
    { t: T.phase, do: 'call', fn: 'phase' },
  ];
  const short: CineStep[] = [
    { t: 0, do: 'call', fn: 'silence' },
    { t: 0, do: 'call', fn: 'collapse' },
    { t: 0, do: 'actor', who: 'boss', moveTo: [0, 0, 0], dur: 0.8 },
    { t: 0.4, do: 'call', fn: 'land' },
    { t: 0.6, do: 'call', fn: 'braam' },
    { t: 1.4, do: 'call', fn: 'tocsin' },
    { t: 1.4, do: 'banner', text: 'НАБАТ', sub: 'Вторая фаза', color: 'hunger', dur: 1.8, size: 52 },
    { t: 2.0, do: 'call', fn: 'phase' },
  ];
  return { id: 'hierophantCollapse', steps, short, dur: T.phase + 0.2, blendOut: 0.7 };
}

/** Время шагов перехода II→III. */
export const CRACK_T = { crack: 0.2, sky: 0.5, raise: 1.0, banner: 1.4, phase: 3.2 };

/**
 * Переход II→III (план §8.3): колокол трескается — огонь внутри открыт; по небу бежит трещина; музыка на
 * полтона выше. Логика: crack, raise, phase.
 */
export function crackTrack(p: HierophantSpots, star: V3 = [0.42, -0.5, -0.76]): CineTrack {
  const T = CRACK_T;
  const { bx, bz, hx, hz } = p;
  const dx = bx - hx, dz = bz - hz, dl = Math.hypot(dx, dz) || 1;
  const fx = dx / dl, fz = dz / dl;
  // высокая точка над ареной и взгляд на погасшую звезду: по ней бежит трещина
  const hi: V3 = [bx - star[0] * 16, 13, bz - star[2] * 16];
  const toStar: V3 = [hi[0] + star[0] * 60, hi[1] + star[1] * 60, hi[2] + star[2] * 60];
  const steps: CineStep[] = [
    { t: 0, do: 'call', fn: 'silence' },
    // крупно: колокол трескается, внутри открывается огонь
    { t: 0, do: 'cam', path: [[bx - fx * 6.5, 4.0, bz - fz * 6.5], [bx - fx * 5.2, 4.6, bz - fz * 5.2]], look: [[bx, 5.0, bz]], dur: T.banner, ease: 'outCubic' },
    { t: T.crack, do: 'call', fn: 'crack' },
    { t: T.sky, do: 'sky', param: 'crack', to: 1, dur: 1.8 },
    { t: T.raise, do: 'call', fn: 'raise' },
    { t: T.banner, do: 'banner', text: 'ПОСЛЕДНИЙ ЗВОН', sub: 'Третья фаза', color: 'hunger', dur: 2.2, size: 50 },
    // широко: над ареной, в сторону звезды — трещина через диск
    { t: T.banner, do: 'cam', path: [[bx - fx * 5.2, 4.6, bz - fz * 5.2], hi], look: [[bx, 5.0, bz], toStar], dur: T.phase - T.banner, ease: 'inOutSine' },
    { t: T.phase, do: 'call', fn: 'phase' },
  ];
  const short: CineStep[] = [
    { t: 0, do: 'call', fn: 'crack' },
    { t: 0, do: 'sky', param: 'crack', to: 1, dur: 0.8 },
    { t: 0.3, do: 'call', fn: 'raise' },
    { t: 0.3, do: 'banner', text: 'ПОСЛЕДНИЙ ЗВОН', sub: 'Третья фаза', color: 'hunger', dur: 1.8, size: 50 },
    { t: 1.4, do: 'call', fn: 'phase' },
  ];
  return { id: 'hierophantCrack', steps, short, dur: T.phase + 0.2, blendOut: 0.6 };
}

/** Точки казни: босс (оглушён на мосту), герой, основание цепи, верх колокола, приземление, звезда неба. */
export interface ExecSpots { bx: number; bz: number; hx: number; hz: number; cx: number; cz: number; bellY: number; lx: number; lz: number; star: V3 }

/** Время планов казни (с от начала дорожки, план §8.3.2). */
export const EXEC_T = { dash: 0.5, run: 2.0, jump: 3.5, tap: 3.6, strike: 4.5, toll: 5.0, crack: 6.5, land: 7.5, cut: 8.3, beam: 9.8, calm: 11.8, say: 12.0, end: 14.0 };

/**
 * Добивание Иерофанта (план §8.3.2), ≈14 с: время замирает → рывок с остаточными образами к цепи, свисающей
 * с колокола → бег вверх по цепи → прыжок над колоколом на фоне чёрной луны (касание-тайминг по кольцу) →
 * клинок в трещину, белая вспышка → последний звон, тишина и звон в ушах → фиолетовые трещины → герой
 * приземляется за спиной, стряхивает клинок → отложенный разрез: босс осыпается в бездну → луч в небо,
 * погасшая звезда загорается, лейтмотив в мажоре → тишина, «Одна звезда. Осталось четыре.»
 * Логика: freeze, dash, ghostsOff, flare, strike, toll, cut, beam, star2, calm, end. Касание — флаг 'perfect'.
 */
export function executionTrack(p: ExecSpots): CineTrack {
  const T = EXEC_T;
  const { bx, bz, hx, hz, cx, cz, bellY, lx, lz, star } = p;
  const dx = bx - hx, dz = bz - hz, dl = Math.hypot(dx, dz) || 1;
  const fx = dx / dl, fz = dz / dl, sx = -fz, sz = fx;
  // верх цепи у колокола и вершина прыжка
  const top: V3 = [bx - fx * 0.8, bellY + 0.4, bz - fz * 0.8];
  const apex: V3 = [bx + fx * 0.3, bellY + 2.6, bz + fz * 0.3];
  const mx = (cx + top[0]) / 2, my = bellY / 2, mz = (cz + top[2]) / 2;
  const steps: CineStep[] = [
    // 1. время замирает; музыка обрывается в одну хоровую ноту
    { t: 0, do: 'call', fn: 'freeze' },
    { t: 0, do: 'cam', path: [[hx - fx * 4 + sx, 2.2, hz - fz * 4 + sz]], look: [[bx, bellY - 0.5, bz]], dur: T.dash },
    // 2. рывок с остаточными образами к цепи
    { t: T.dash, do: 'call', fn: 'dash' },
    { t: T.dash, do: 'actor', who: 'hero', clip: 'dash', moveTo: [cx, 0, cz], dur: 0.45, ease: 'outExpo', lookAt: [bx, 0, bz] },
    { t: T.dash, do: 'cam', path: [[hx - fx * 3 + sx * 0.6, 0.7, hz - fz * 3 + sz * 0.6], [cx - fx * 3.4 + sx * 0.8, 0.9, cz - fz * 3.4 + sz * 0.8]], look: [[cx, 1.2, cz], [bx, bellY - 0.6, bz]], dur: T.run - T.dash, ease: 'outCubic' },
    { t: T.dash + 0.45, do: 'sfx', id: 'chain_drop', gain: 0.6 },
    { t: T.dash + 0.7, do: 'call', fn: 'ghostsOff' },
    // 3. бег вверх по цепи, камера сбоку
    { t: T.run, do: 'actor', who: 'hero', moveTo: top, dur: T.jump - T.run, ease: 'inQuad', lookAt: [bx, 0, bz] },
    { t: T.run, do: 'sfx', id: 'choir_rise', gain: 0.8 },
    ...[0.15, 0.5, 0.85, 1.2].map((d): CineStep => ({ t: T.run + d, do: 'sfx', id: 'step_heavy', gain: 0.35 })),
    { t: T.run, do: 'cam', path: [[mx + sx * 7.5, my + 1.5, mz + sz * 7.5], [mx + sx * 7, my + 2.6, mz + sz * 7]], look: [[cx, 1.2, cz], [top[0], top[1], top[2]]], dur: T.jump - T.run, ease: 'linear' },
    // 4. прыжок над колоколом: замедление, за спиной — чёрная луна; касание по кольцу (по желанию)
    { t: T.jump, do: 'actor', who: 'hero', clip: 'rising', moveTo: apex, dur: 0.45, ease: 'outQuad' },
    { t: T.jump, do: 'time', scale: 0.2, dur: 1.0 },
    { t: T.jump, do: 'call', fn: 'flare' },
    { t: T.jump, do: 'sfx', id: 'cast_inhale', gain: 0.7 },
    { t: T.jump, do: 'cam', path: [[apex[0] - star[0] * 9, apex[1] - star[1] * 9, apex[2] - star[2] * 9]], look: [[apex[0] + star[0] * 30, apex[1] + star[1] * 30, apex[2] + star[2] * 30]], dur: T.strike - T.jump },
    { t: T.tap, do: 'tap', dur: 0.6, onHit: 'perfect' },
    // 5. клинок входит в трещину колокола; белая вспышка
    { t: T.strike, do: 'actor', who: 'hero', clip: 'skyfall', moveTo: [bx, bellY + 0.3, bz], dur: 0.15, ease: 'inExpo' },
    { t: T.strike + 0.12, do: 'call', fn: 'strike' },
    { t: T.strike + 0.12, do: 'flash', v: 1 },
    { t: T.strike, do: 'cam', path: [[bx - fx * 5 + sx * 2, bellY + 1, bz - fz * 5 + sz * 2]], look: [[bx, bellY, bz]], dur: T.toll - T.strike },
    // 6. последний звон обрывается в тишину; 7. трещины бегут по колоколу и рясе
    { t: T.toll, do: 'call', fn: 'toll' },
    { t: T.toll, do: 'cam', path: [[bx - fx * 11 + sx * 3, 1.2, bz - fz * 11 + sz * 3], [bx - fx * 10 + sx * 2.5, 1.4, bz - fz * 10 + sz * 2.5]], look: [[bx, 4, bz]], dur: T.land - T.toll },
    { t: T.crack, do: 'crack', who: 'boss', to: 1, dur: 1.0 },
    // 8. приземляется за спиной босса, спиной к нему; стряхивает клинок
    { t: T.land, do: 'actor', who: 'hero', clip: 'land', moveTo: [lx, 0, lz], dur: 0.45, ease: 'inQuad', lookAt: [lx + fx * 4, 0, lz + fz * 4] },
    { t: T.land, do: 'cam', path: [[lx + fx * 4.5 + sx * 2, 1.4, lz + fz * 4.5 + sz * 2]], look: [[lx, 1.2, lz], [bx, 3, bz]], dur: T.cut - T.land + 1.4 },
    // 9. отложенный разрез: раскалывается и осыпается обсидианом и страницами в бездну
    { t: T.cut, do: 'call', fn: 'cut' },
    // 10. луч из провала — погасшая звезда загорается, небо светлеет, камера поднимается; лейтмотив в мажоре
    { t: T.beam, do: 'call', fn: 'beam' },
    { t: T.beam, do: 'sky', param: 'starLit', to: 1, dur: 2.0 },
    { t: T.beam + 0.2, do: 'music', cue: 'major' },
    { t: T.beam + 0.6, do: 'call', fn: 'star2' },
    { t: T.beam, do: 'cam', path: [[bx - fx * 10 + sx * 3, 3, bz - fz * 10 + sz * 3], [bx - star[0] * 26, 16, bz - star[2] * 26]], look: [[bx, 8, bz], [bx + star[0] * 120, 16 + star[1] * 120, bz + star[2] * 120]], dur: T.calm - T.beam, ease: 'inOutSine' },
    // 11. послебоевая тишина: герой опускает клинок
    { t: T.calm, do: 'call', fn: 'calm' },
    { t: T.calm, do: 'cam', path: [[lx + sx * 5.5 + fx * 2.5, 1.6, lz + sz * 5.5 + fz * 2.5], [lx + sx * 5 + fx * 3.2, 1.9, lz + sz * 5 + fz * 3.2]], look: [[lx, 1.1, lz]], dur: T.end - T.calm },
    { t: T.say, do: 'say', line: 'Одна звезда. Осталось четыре.' },
    { t: T.end, do: 'call', fn: 'end' },
  ];
  // увиденная дважды: удар, звон, разрез, звезда
  const short: CineStep[] = [
    { t: 0, do: 'call', fn: 'freeze' },
    { t: 0, do: 'actor', who: 'hero', moveTo: [bx, bellY + 0.3, bz], dur: 0.3, ease: 'inExpo' },
    { t: 0, do: 'cam', path: [[bx - fx * 6 + sx * 2, bellY + 1, bz - fz * 6 + sz * 2]], look: [[bx, bellY, bz]], dur: 1.2 },
    { t: 0.3, do: 'call', fn: 'strike' },
    { t: 0.3, do: 'flash', v: 1 },
    { t: 0.6, do: 'call', fn: 'toll' },
    { t: 0.6, do: 'crack', who: 'boss', to: 1, dur: 0.6 },
    { t: 1.2, do: 'actor', who: 'hero', clip: 'land', moveTo: [lx, 0, lz], dur: 0.35, lookAt: [lx + fx * 4, 0, lz + fz * 4] },
    { t: 1.2, do: 'cam', path: [[lx + fx * 4.5 + sx * 2, 1.4, lz + fz * 4.5 + sz * 2]], look: [[bx, 3, bz]], dur: 1.0 },
    { t: 1.6, do: 'call', fn: 'cut' },
    { t: 2.2, do: 'call', fn: 'beam' },
    { t: 2.2, do: 'sky', param: 'starLit', to: 1, dur: 1.2 },
    { t: 2.3, do: 'music', cue: 'major' },
    { t: 2.6, do: 'call', fn: 'star2' },
    { t: 2.2, do: 'cam', path: [[bx - fx * 10, 3, bz - fz * 10], [bx - star[0] * 26, 16, bz - star[2] * 26]], look: [[bx, 8, bz], [bx + star[0] * 120, 16 + star[1] * 120, bz + star[2] * 120]], dur: 2.0 },
    { t: 4.2, do: 'call', fn: 'calm' },
    { t: 4.6, do: 'call', fn: 'end' },
  ];
  return { id: 'hierophantEnd', steps, short, dur: T.end + 0.2, blendOut: 1.0 };
}
