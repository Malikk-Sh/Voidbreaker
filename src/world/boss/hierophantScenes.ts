import type { CineStep, CineTrack, V3 } from '../../game/director';
import { MASK_CONTACT, MASK_RELEASE, maskContactRoot } from '../../anim/clips/execution';

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
    { t: 0, do: 'clip', who: 'hero', clip: 'cinematicWalk', blend: 0.22 },
    { t: 2.2, do: 'clip', who: 'hero', clip: 'lowerBlade', blend: 0.25 },
    { t: 0, do: 'actor', who: 'hero', moveTo: walk, dur: 2.2, ease: 'inOutSine', lookAt: [bx, 0, bz], turn: 0.35 },
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
  return { id: 'hierophantIntro', revision: 2, cameraBlend: 0.4, origin: [p.bx, 0, p.bz], heading: Math.atan2(p.bx - p.hx, p.bz - p.hz), steps, short, dur: T.begin + 0.2, blendOut: 0.8 };
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
    { t: T.collapse, do: 'time', scale: 0.45, dur: 1.2, rampIn: 0.12, rampOut: 0.25 },
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
  return { id: 'hierophantCollapse', revision: 2, cameraBlend: 0.4, origin: [p.bx, 0, p.bz], heading: Math.atan2(p.bx - p.hx, p.bz - p.hz), steps, short, dur: T.phase + 0.2, blendOut: COLLAPSE_BLEND };
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
  return { id: 'hierophantCrack', revision: 2, cameraBlend: 0.4, origin: [p.bx, 0, p.bz], heading: Math.atan2(p.bx - p.hx, p.bz - p.hz), steps, short, dur: T.phase + 0.2, blendOut: 0.6 };
}

/**
 * Точки казни: босс (оглушён на мосту), герой, высота маски, приземление, звезда неба.
 * mask — где маска на самом деле (оглушённый склоняется: ~2.8 м и на 0.8 м к герою); без неё — над центром на bellY.
 */
export interface ExecSpots { bx: number; bz: number; hx: number; hz: number; cx?: number; cz?: number; bellY: number; lx: number; lz: number; star: V3; mask?: V3 }

/** Вся казнь — один прыжок: маска → взрыв до касания пола → посадка → звезда. */
export const EXEC_T = { jump: 0.55, strike: 1.9, contact: 1.9 + MASK_CONTACT, toll: 2.78, crack: 2.96, land: 3.05, cut: 3.28, touchdown: 4.1, beam: 6.2, calm: 8.4, say: 8.65, end: 10.1 };
export const EXEC_SHORT_T = { jump: 0.3, strike: 1.15, contact: 1.15 + MASK_CONTACT, toll: 2.02, crack: 2.18, land: 2.3, cut: 2.55, touchdown: 3.35, beam: 4.95, calm: 6.5, say: 6.75, end: 7.65 };
export const CONTACT_SHOT = { fov: 44, fill: 0.58, head: 1.9, below: 0.45, back: 0.62, side: 0.78, rise: 0.1, push: 0.94, headroom: 1.2, dive: { far: 1.9, raise: 2.1 } };
export const EXEC_FLASH = 0.08;

export function executionTrack(p: ExecSpots): CineTrack {
  const { bx, bz, hx, hz, lx, lz, star } = p;
  const distance = Math.hypot(bx - hx, bz - hz) || 1, fx = (bx - hx) / distance, fz = (bz - hz) / distance, sx = -fz, sz = fx;
  const mask: V3 = p.mask ?? [bx, p.bellY, bz], [kx, ky, kz] = mask;
  const contact = maskContactRoot(mask, Math.atan2(fx, fz));
  const apex: V3 = [contact[0] - fx * 0.65, ky + 1.2, contact[2] - fz * 0.65];
  const away: V3 = [contact[0] + sx * 1.8 - fx * 0.5, contact[1] + 0.4, contact[2] + sz * 1.8 - fz * 0.5];
  const landed: V3 = [lx, 0, lz], forward = (r: V3): V3 => [r[0] + fx * 10, 0, r[2] + fz * 10];
  const C = CONTACT_SHOT, bottom = ky - C.below;
  const dist = (contact[1] + C.head - bottom) / (2 * Math.tan(C.fov * Math.PI / 360) * C.fill);
  // Передняя четверть Пилота: видны лицо, грудь и поднятый клинок, а не спина.
  const vx = fx * C.back + sx * C.side, vz = fz * C.back + sz * C.side, vl = Math.hypot(vx, vz);
  const shotOn = (root: V3, k = 1, raise = 0) => {
    const look: V3 = [(root[0] + kx) / 2, (root[1] + C.head + raise + bottom) / 2, (root[2] + kz) / 2];
    return { look, cam: [look[0] + vx / vl * dist * k, look[1] + dist * C.rise * k, look[2] + vz / vl * dist * k] as V3 };
  };
  const dive = shotOn(apex, C.dive.far, C.dive.raise), hit = shotOn(contact, 1, C.headroom), hitNear = shotOn(contact, C.push, C.headroom);
  const wide = Math.max(8.5, distance * 1.15);
  const medium: V3 = [hx + fx * wide * 0.6 + sx * wide, Math.max(4, ky + 1.6), hz + fz * wide * 0.6 + sz * wide];
  const establish: V3 = [(hx + kx) / 2, ky * 0.65, (hz + kz) / 2];
  const exitCam: V3 = [kx + fx * 2.2 + sx * 6.5, ky + 0.8, kz + fz * 2.2 + sz * 6.5];
  const both: V3 = [(contact[0] + kx) / 2, ky + 1.35, (contact[2] + kz) / 2];
  const pushCam: V3 = [exitCam[0] + away[0] - contact[0], exitCam[1] + away[1] - contact[1], exitCam[2] + away[2] - contact[2]];
  const pushLook: V3 = [both[0] + away[0] - contact[0], both[1] + away[1] - contact[1], both[2] + away[2] - contact[2]];
  const landingCam: V3 = [lx + sx * 5.5 + fx * 3.5, 2.3, lz + sz * 5.5 + fz * 3.5];
  const landingLook: V3 = [(lx + bx) / 2, 1.6, (lz + bz) / 2];
  const make = (T: typeof EXEC_T, short: boolean): CineStep[] => [
    { t: 0, do: 'call', fn: 'freeze' },
    { t: 0, do: 'time', scale: 0.35, dur: T.jump, rampIn: 0.1, rampOut: 0.16 },
    { t: 0, do: 'clip', who: 'hero', clip: 'executionLeap', speed: short ? 1.9 / T.strike : 1, blend: 0.2 },
    { t: 0, do: 'actor', who: 'hero', lookAt: forward([hx, 0, hz]), turn: T.jump * 0.8, dur: T.jump },
    { t: 0, do: 'cam', path: [medium], look: [establish], dur: T.jump, fov: 48 },
    { t: T.jump, do: 'call', fn: 'flare' },
    { t: T.jump, do: 'sfx', id: 'dash', gain: 0.65 },
    { t: T.jump, do: 'actor', who: 'hero', moveTo: apex, dur: T.strike - T.jump, ease: 'outQuad', bends: [[0, 0.45, 0]], lookAt: forward(apex) },
    { t: T.jump, do: 'cam', path: [medium, dive.cam], look: [establish, dive.look], dur: T.strike - T.jump, ease: 'outQuad', fov: 48, blend: 0.28 },
    // Поза и корень замедляются самими траекториями; окружение и частицы — той же паузой перед ударом.
    { t: T.strike - 0.45, do: 'time', scale: 0.16, dur: 0.45 + MASK_RELEASE, rampIn: 0.12, rampOut: 0.18 },
    { t: T.strike - 0.4, do: 'sfx', id: 'cast_inhale', gain: 0.45 },
    { t: T.strike, do: 'clip', who: 'hero', clip: 'maskStrike', markers: { contact: 'strike' }, blend: 0.16 },
    { t: T.strike, do: 'actor', who: 'hero', lookAt: forward(apex), dur: MASK_RELEASE },
    { t: T.strike + MASK_RELEASE, do: 'sfx', id: 'swing_heavy', gain: 0.95 },
    { t: T.strike + MASK_RELEASE, do: 'actor', who: 'hero', moveTo: contact, dur: MASK_CONTACT - MASK_RELEASE, ease: 'inQuad', lookAt: forward(contact) },
    { t: T.strike, do: 'cam', path: [dive.cam], look: [dive.look], dur: MASK_RELEASE, fov: C.fov, blend: 0.16 },
    { t: T.strike + MASK_RELEASE, do: 'cam', path: [dive.cam, hit.cam], look: [dive.look, hit.look], dur: MASK_CONTACT - MASK_RELEASE, ease: 'inOutSine', fov: C.fov, blend: 0 },
    { t: T.contact, do: 'time', scale: 0.08, dur: 0.12, rampIn: 0, rampOut: 0.04 },
    { t: T.contact, do: 'cam', path: [hit.cam, hitNear.cam], look: [hit.look], dur: T.toll - T.contact, fov: C.fov, blend: 0 },
    { t: T.toll, do: 'call', fn: 'toll' },
    { t: T.toll, do: 'cam', path: [hitNear.cam, exitCam], look: [hit.look, both], dur: T.land - T.toll, fov: 48 },
    { t: T.land, do: 'clip', who: 'hero', clip: 'executionLand', blend: 0.22 },
    { t: T.land, do: 'actor', who: 'hero', moveTo: away, dur: 0.35, ease: 'outQuad', lookAt: forward(away) },
    { t: T.land, do: 'cam', path: [exitCam, pushCam], look: [both, pushLook], dur: 0.35, ease: 'outQuad', fov: 48, blend: 0 },
    { t: T.crack, do: 'call', fn: 'fracture' },
    // Маска раскрывается, и сразу виден взрыв всего тела — пока Пилот ещё в воздухе.
    { t: T.cut, do: 'call', fn: 'cut' },
    { t: T.cut, do: 'time', scale: 0.18, dur: 0.9, rampIn: 0.06, rampOut: 0.3 },
    { t: T.land + 0.35, do: 'actor', who: 'hero', moveTo: landed, dur: 0.7, ease: 'inQuad', lookAt: forward(landed) },
    { t: T.land + 0.35, do: 'cam', path: [pushCam, landingCam], look: [pushLook, landingLook], dur: 0.7, ease: 'inQuad', fov: 48, blend: 0 },
    { t: T.beam, do: 'call', fn: 'beam' },
    { t: T.beam, do: 'sky', param: 'starLit', to: 1, dur: T.calm - T.beam },
    { t: T.beam + 0.1, do: 'music', cue: 'major' },
    { t: T.beam + 0.4, do: 'call', fn: 'star2' },
    { t: T.beam, do: 'cam', path: [landingCam, [bx - star[0] * 22 + sx * 3, 13, bz - star[2] * 22 + sz * 3]], look: [landingLook, [bx + star[0] * 100, 13 + star[1] * 100, bz + star[2] * 100]], dur: T.calm - T.beam, ease: 'inOutSine', fov: 48, blend: 0.3 },
    { t: T.calm, do: 'call', fn: 'calm' },
    { t: T.calm, do: 'clip', who: 'hero', clip: 'lowerBlade', speed: 2.2 / (T.end - T.calm), dur: T.end - T.calm, blend: 0.24 },
    { t: T.calm, do: 'cam', path: [[lx + sx * 3.1 - fx * 1.8, 1.75, lz + sz * 3.1 - fz * 1.8], [lx + sx * 2.8 - fx * 1.6, 1.7, lz + sz * 2.8 - fz * 1.6]], look: [[lx, 1.3, lz]], dur: T.end - T.calm, fov: 40, blend: 0.4 },
    { t: T.calm + 0.35, do: 'sfx', id: 'exhale', gain: 0.6 },
    ...(!short ? [{ t: T.say, do: 'say' as const, line: 'Одна звезда. Осталось четыре.' }] : []),
    { t: T.end, do: 'call', fn: 'end' },
  ];
  return { id: 'hierophantEnd', revision: 3, cameraBlend: 0.24, origin: [bx, 0, bz], heading: Math.atan2(fx, fz), steps: make(EXEC_T, false), short: make(EXEC_SHORT_T, true), dur: EXEC_T.end + 0.2, blendOut: 0.7 };
}
