import type { CineStep, CineTrack, V3 } from '../../game/director';
import { MASK_CONTACT, maskContactRoot } from '../../anim/clips/execution';

/** Где стоят актёры сцены Иерофанта: герой и босс. */
export interface HierophantSpots {
  hx: number; hz: number; bx: number; bz: number;
  /** Где маска на самом деле (bellPos): крупные планы смотрят на неё, а не на расчётную высоту парящего. */
  mask?: V3;
}

/** Время шагов интро (с от начала дорожки). */
export const INTRO_T = { runes: 1.0, tolls: [2.2, 3.2, 4.2], descend: 4.6, ignite: 5.4, mask: 6.0, slam: 7.3, begin: 8.8 };
/**
 * Высота маски парящего Иерофанта (м): тело 2.3 + грудь 1.75 + голова 0.7 + маска 0.32. Ревью: с боевой камеры
 * маска и руки теряются — в интро есть план, где их видно (благословение), в казни — склонённая и треснувшая маска.
 */
export const MASK_Y = 5.05;
/** Высота, с которой Иерофант спускается по цепям (м). */
export const DESCEND_FROM = 16;

/**
 * Интро Иерофанта 2.0 (план §8.3, ≈8 с, пропускается): герой входит в неф, музыка затихает — ветер и гул;
 * на дальнем конце загораются красные руны; колокол бьёт трижды, с каждым ударом гаснет ряд свечей к герою;
 * Иерофант спускается по цепям, в колоколе разгорается огонь; один тяжёлый удар о пол, пыль с потолка;
 * имя «впечатывается» с первым ударом музыки; управление возвращается — и сразу Звон.
 * Логика (шаги 'call'): quiet, runes, douse ×3, descend, ignite, bless, slam, music, begin.
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
    { t: T.descend, do: 'cam', path: [[bx - fx * 9 + sx * 3, 0.8, bz - fz * 9 + sz * 3], [bx - fx * 8 + sx * 2, 1.2, bz - fz * 8 + sz * 2]], look: [[bx, 7.5, bz], [bx, 4.2, bz]], dur: T.mask - T.descend, ease: 'outCubic' },
    { t: T.ignite, do: 'call', fn: 'ignite' },
    // крупно: золотая маска с зашитыми глазами, руки поднимаются в благословении — и голос
    { t: T.mask, do: 'call', fn: 'bless' },
    { t: T.mask, do: 'cam', path: [[bx - fx * 4.4 + sx * 1.2, MASK_Y - 1.15, bz - fz * 4.4 + sz * 1.2], [bx - fx * 3.6 + sx * 0.8, MASK_Y - 0.85, bz - fz * 3.6 + sz * 0.8]], look: [[bx, MASK_Y - 0.3, bz], [bx, MASK_Y - 0.15, bz]], dur: T.slam - T.mask, ease: 'linear', fov: 42 },
    { t: T.mask + 0.15, do: 'say', line: 'Звоню… по спасению… твоему.', speaker: 'boss' },
    // один тяжёлый удар: имя — с первым ударом музыки
    { t: T.slam, do: 'call', fn: 'slam' },
    { t: T.slam, do: 'call', fn: 'music' },
    { t: T.slam, do: 'banner', text: 'ИЕРОФАНТ СКОРБИ', sub: 'Слепой понтифик', color: 'hunger', dur: 3.2, size: 50 },
    { t: T.slam, do: 'cam', path: [[bx - fx * 7 + sx * 2, 1.4, bz - fz * 7 + sz * 2], [walk[0] - fx * 11 + sx * 2, 9, walk[2] - fz * 11 + sz * 2]], look: [[bx, 4.2, bz], [mx, 1.2, mz]], dur: T.begin - T.slam, ease: 'inOutSine' },
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

/**
 * Время шагов перехода I→II (с от начала дорожки). Этап 4.5, C2: сначала крупный план (close) — Понтифик держится
 * за маску верхними руками, нижние раскинуты (жест «скорбь» с удара, переведшего бой в фазу II); дальше всё,
 * как было, на 0.9 с позже.
 */
export const COLLAPSE_T = { close: 0.9, collapse: 1.0, land: 2.0, braam: 2.6, tocsin: 3.5, banner: 3.6, phase: 4.6 };
/** Крупный план жеста: расстояние камеры от маски (м) — наезд с from до to, ниже маски на low (смотрит снизу вверх). */
export const COLLAPSE_CLOSE = { from: 4.6, to: 4.0, low: 0.55, side: 0.9, fov: 44 };

/**
 * Переход I→II (план §8.3): Иерофант хватается за маску; пол нефа проваливается в замедлении, камера
 * отъезжает — под ареной огромный собор и бездна; Пилот приземляется на мост. Музыка: такт тишины →
 * хоровой аккорд и «брам» → набат. Логика: collapse, land, braam, tocsin, phase.
 */
export function collapseTrack(p: HierophantSpots): CineTrack {
  const T = COLLAPSE_T, C = COLLAPSE_CLOSE;
  const { hx, hz, bx, bz } = p;
  const m: V3 = p.mask ?? [bx, MASK_Y, bz];
  // крупный план — со стороны Пилота: он только что нанёс этот удар
  const dx = hx - m[0], dz = hz - m[2], dl = Math.hypot(dx, dz) || 1, fx = dx / dl, fz = dz / dl, sx = fz, sz = -fx;
  const steps: CineStep[] = [
    { t: 0, do: 'call', fn: 'silence' },
    { t: 0, do: 'cam', path: [[m[0] + fx * C.from + sx * C.side, m[1] - C.low, m[2] + fz * C.from + sz * C.side], [m[0] + fx * C.to + sx * C.side * 0.6, m[1] - C.low * 0.8, m[2] + fz * C.to + sz * C.side * 0.6]], look: [[m[0], m[1] - 0.1, m[2]], [m[0], m[1], m[2]]], dur: T.close, ease: 'linear', fov: C.fov },
    { t: T.collapse, do: 'call', fn: 'collapse' },
    { t: T.collapse, do: 'time', scale: 0.45, dur: 1.2 },
    { t: T.close, do: 'actor', who: 'boss', moveTo: [0, 0, 0], dur: 1.6, ease: 'inOutSine' },
    // отъезд: высоко над ареной, взгляд в бездну — там собор под собором
    { t: T.close, do: 'cam', path: [[hx + 3, 12, hz + 14], [hx + 9, 24, hz + 30], [6, 30, 34]], look: [[hx * 0.5, 0, hz * 0.5], [0, -14, 0], [0, -26, -4]], dur: T.tocsin - T.close, ease: 'inOutSine' },
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
  return { id: 'hierophantCollapse', steps, short, dur: T.phase + 0.2, blendOut: COLLAPSE_BLEND };
}
/** Камера возвращается в бой после перехода (с). */
export const COLLAPSE_BLEND = 0.7;

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

/**
 * Точки казни: босс (оглушён на мосту), герой, основание цепи, высота маски, приземление, звезда неба.
 * mask — где маска на самом деле (оглушённый склоняется: ~2.8 м и на 0.8 м к герою); без неё — над центром на bellY.
 */
export interface ExecSpots { bx: number; bz: number; hx: number; hz: number; cx: number; cz: number; bellY: number; lx: number; lz: number; star: V3; mask?: V3 }

/** Договор постановки: контакт вычисляется из маркера специального клипа, а не отдельного таймера. */
export const EXEC_T = { dash: 0.9, run: 2.1, jump: 3.7, tap: 4.0, strike: 4.5, contact: 4.5 + MASK_CONTACT, toll: 5.62, crack: 6.15, land: 6.7, cut: 8.35, beam: 9.3, calm: 11.3, say: 11.5, end: 12.3 };
/** Локальный акцент после контакта, без белого кадра. */
export const EXEC_FLASH = 0.12;

/**
 * Казнь: опора → три шага по цепи → читаемый замах → контакт с маской → крупные фрагменты → выход и звезда.
 * Все корни и позы работают в одной шкале Director; ни dash, ни боевой skyfall не используются.
 * Положения клинка вычислены из реального рига на маркере maskStrike.contact.
 */
export function executionTrack(p: ExecSpots): CineTrack {
  const T = EXEC_T;
  const { bx, bz, hx, hz, cx, cz, lx, lz, star } = p;
  const dx = bx - hx, dz = bz - hz, dl = Math.hypot(dx, dz) || 1;
  const fx = dx / dl, fz = dz / dl, sx = -fz, sz = fx;
  const mask: V3 = p.mask ?? [bx, p.bellY, bz];
  const [kx, ky, kz] = mask;
  const contact = maskContactRoot(mask, Math.atan2(fx, fz));
  const top: V3 = [kx - fx * 0.65, ky + 0.12, kz - fz * 0.65];
  const apex: V3 = [contact[0] - fx * 0.6, ky + 1.2, contact[2] - fz * 0.6];
  const away: V3 = [contact[0] + sx * 1.8 - fx * 0.5, contact[1] + 0.4, contact[2] + sz * 1.8 - fz * 0.5];
  const forward = (v: V3): V3 => [v[0] + fx * 10, v[1], v[2] + fz * 10];
  const faceCam: V3 = [kx - fx * 4.2 + sx * 5.2, ky + 1.3, kz - fz * 4.2 + sz * 5.2];
  const both: V3 = [(contact[0] + kx) / 2, ky + 1.35, (contact[2] + kz) / 2];
  const medium: V3 = [kx - fx * 5.4 + sx * 4.8, Math.max(1.5, ky + 0.4), kz - fz * 5.4 + sz * 4.8];
  const landed: V3 = [lx, 0, lz];
  const steps: CineStep[] = [
    { t: 0, do: 'call', fn: 'freeze' },
    { t: 0, do: 'clip', who: 'hero', clip: 'lowerBlade' },
    // Сначала средний план одновременно показывает героя, маску и всю цепь.
    { t: 0, do: 'cam', path: [medium], look: [[(hx + kx) / 2, ky * 0.65, (hz + kz) / 2]], dur: T.dash, fov: 48 },
    { t: T.dash, do: 'call', fn: 'dash' },
    { t: T.dash, do: 'clip', who: 'hero', clip: 'chainBrace', markers: { brace: 'brace' } },
    { t: T.dash, do: 'actor', who: 'hero', moveTo: [cx, 0, cz], dur: 0.58, ease: 'outCubic', lookAt: [cx + fx * 10, 0, cz + fz * 10] },
    { t: T.dash, do: 'cam', path: [medium, [cx - fx * 3 + sx * 4.7, 1.7, cz - fz * 3 + sz * 4.7]], look: [[(cx + kx) / 2, ky * 0.65, (cz + kz) / 2]], dur: T.run - T.dash, fov: 48 },
    { t: T.dash + 0.55, do: 'call', fn: 'ghostsOff' },
    { t: T.run, do: 'clip', who: 'hero', clip: 'chainRun', markers: { step: 'chainStep' } },
    { t: T.run, do: 'actor', who: 'hero', moveTo: top, dur: T.jump - T.run, ease: 'linear', lookAt: forward(top) },
    { t: T.run, do: 'sfx', id: 'choir_rise', gain: 0.55 },
    { t: T.run, do: 'cam', path: [[(cx + top[0]) / 2 + sx * 6, ky * 0.5 + 1.5, (cz + top[2]) / 2 + sz * 6], [top[0] + sx * 5.8 - fx, ky + 1.0, top[2] + sz * 5.8 - fz]], look: [[cx, 1.1, cz], [top[0], top[1] + 0.9, top[2]]], dur: T.jump - T.run, fov: 48, ease: 'linear' },
    { t: T.jump, do: 'call', fn: 'flare' },
    // Верхняя поза специального удара удерживается до пикирования.
    { t: T.jump, do: 'clip', who: 'hero', clip: 'chainApex' },
    { t: T.jump, do: 'actor', who: 'hero', moveTo: apex, dur: 0.42, ease: 'outQuad', lookAt: forward(apex) },
    { t: T.jump, do: 'time', scale: 0.2, dur: 1.0 },
    { t: T.jump, do: 'sfx', id: 'cast_inhale', gain: 0.5 },
    { t: T.jump, do: 'cam', path: [[top[0] + sx * 5.8 - fx, ky + 1.0, top[2] + sz * 5.8 - fz], faceCam], look: [[kx, ky + 1, kz], both], dur: T.strike - T.jump, fov: 50 },
    { t: T.tap, do: 'tap', dur: 0.4, onHit: 'perfect' },
    { t: T.strike, do: 'clip', who: 'hero', clip: 'maskStrike', markers: { contact: 'strike' } },
    { t: T.strike, do: 'actor', who: 'hero', moveTo: contact, dur: MASK_CONTACT, ease: 'inQuad', lookAt: forward(contact) },
    { t: T.strike, do: 'cam', path: [faceCam], look: [both], dur: T.toll - T.strike, fov: 50 },
    { t: T.toll, do: 'call', fn: 'toll' },
    { t: T.toll, do: 'cam', path: [faceCam, [kx - fx * 4.2 + sx * 5.2, ky + 0.8, kz - fz * 4.2 + sz * 5.2]], look: [[kx, ky + 0.5, kz]], dur: T.land - T.toll, fov: 48 },
    { t: T.crack, do: 'call', fn: 'fracture' },
    { t: T.land, do: 'clip', who: 'hero', clip: 'chainExit' },
    { t: T.land, do: 'actor', who: 'hero', moveTo: away, dur: 0.3, ease: 'outQuad', lookAt: forward(away) },
    { t: T.land + 0.3, do: 'actor', who: 'hero', moveTo: landed, dur: 0.6, ease: 'inQuad', lookAt: forward(landed) },
    { t: T.land, do: 'cam', path: [[kx - fx * 4.2 + sx * 5.2, ky + 0.8, kz - fz * 4.2 + sz * 5.2], [lx + sx * 5.5 - fx * 3.5, 2.3, lz + sz * 5.5 - fz * 3.5]], look: [[kx, ky + 0.5, kz], [(lx + bx) / 2, 1.6, (lz + bz) / 2]], dur: T.cut - T.land, fov: 48 },
    { t: T.cut, do: 'call', fn: 'cut' },
    { t: T.beam, do: 'call', fn: 'beam' },
    { t: T.beam, do: 'sky', param: 'starLit', to: 1, dur: 1.6 },
    { t: T.beam + 0.12, do: 'music', cue: 'major' },
    { t: T.beam + 0.5, do: 'call', fn: 'star2' },
    { t: T.beam, do: 'cam', path: [[bx - fx * 9 + sx * 4, 3, bz - fz * 9 + sz * 4], [bx - star[0] * 22 + sx * 3, 13, bz - star[2] * 22 + sz * 3]], look: [[bx, 3.5, bz], [bx + star[0] * 100, 13 + star[1] * 100, bz + star[2] * 100]], dur: T.calm - T.beam, ease: 'inOutSine', fov: 48 },
    { t: T.calm, do: 'call', fn: 'calm' },
    { t: T.calm, do: 'clip', who: 'hero', clip: 'lowerBlade' },
    { t: T.calm, do: 'cam', path: [[lx + sx * 4.8 - fx * 2.8, 1.9, lz + sz * 4.8 - fz * 2.8]], look: [[lx, 1.15, lz]], dur: T.end - T.calm, fov: 44 },
    { t: T.say, do: 'say', line: 'Одна звезда. Осталось четыре.' },
    { t: T.end, do: 'call', fn: 'end' },
  ];
  const short: CineStep[] = [
    { t: 0, do: 'call', fn: 'freeze' },
    { t: 0, do: 'actor', who: 'hero', moveTo: apex, lookAt: forward(apex) },
    { t: 0, do: 'clip', who: 'hero', clip: 'maskStrike', markers: { contact: 'strike' } },
    { t: 0, do: 'actor', who: 'hero', moveTo: contact, dur: MASK_CONTACT, ease: 'inQuad', lookAt: forward(contact) },
    { t: 0, do: 'cam', path: [faceCam], look: [both], dur: 1.05, fov: 50 },
    { t: 1.05, do: 'call', fn: 'toll' },
    { t: 1.25, do: 'call', fn: 'fracture' },
    { t: 1.25, do: 'clip', who: 'hero', clip: 'chainExit' },
    { t: 1.25, do: 'actor', who: 'hero', moveTo: away, dur: 0.3, ease: 'outQuad', lookAt: forward(away) },
    { t: 1.55, do: 'actor', who: 'hero', moveTo: landed, dur: 0.6, ease: 'inQuad', lookAt: forward(landed) },
    { t: 1.25, do: 'cam', path: [[lx + sx * 6 - fx * 4, 2.6, lz + sz * 6 - fz * 4]], look: [[(lx + bx) / 2, 2, (lz + bz) / 2]], dur: 1.4, fov: 48 },
    { t: 2.3, do: 'call', fn: 'cut' },
    { t: 2.6, do: 'call', fn: 'beam' },
    { t: 2.6, do: 'sky', param: 'starLit', to: 1, dur: 1 },
    { t: 2.7, do: 'music', cue: 'major' },
    { t: 3.0, do: 'call', fn: 'star2' },
    { t: 3.4, do: 'call', fn: 'calm' },
    { t: 3.4, do: 'clip', who: 'hero', clip: 'lowerBlade', dur: 0.7 },
    { t: 4.1, do: 'call', fn: 'end' },
  ];
  return { id: 'hierophantEnd', steps, short, dur: T.end + 0.2, blendOut: 0.7 };
}
