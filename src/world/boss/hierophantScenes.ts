import type { CineStep, CineTrack, V3 } from '../../game/director';
import { MASK_CONTACT, MASK_RELEASE, bladeEdgeRoot } from '../../anim/clips/execution';
import { along, attackFraming, ballisticPoint, ballisticVelocity, bossImpactFraming, FINISHER_CUT_LEAD } from '../../game/finisherMotion';
import { VICTORY_SHOT, victoryFrame } from '../../game/victoryShot';
import { HIEROPHANT_POSES } from './hierophantPoses';

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
export const EXEC_T = { jump: 0.55, strike: 1.9, contact: 1.9 + MASK_CONTACT, toll: 2.78, crack: 2.96, land: 3.05, cut: 3.28, touchdown: 4.1, beam: 6.2, calm: 8.4, say: 8.65, end: 8.4 + VICTORY_SHOT.dur };
export const EXEC_SHORT_T = { jump: 0.3, strike: 1.15, contact: 1.15 + MASK_CONTACT, toll: 2.02, crack: 2.18, land: 2.3, cut: 2.55, touchdown: 3.35, beam: 4.95, calm: 6.5, say: 6.75, end: 6.5 + VICTORY_SHOT.dur };
export const CONTACT_SHOT = { fov: 44 };
export const EXEC_FLASH = 0.025;

export function executionTrack(p: ExecSpots): CineTrack {
  const { bx, bz, hx, hz, lx, lz, star } = p;
  const distance = Math.hypot(bx - hx, bz - hz) || 1, fx = (bx - hx) / distance, fz = (bz - hz) / distance, sx = -fz, sz = fx;
  const mask: V3 = p.mask ?? [bx, p.bellY, bz], [kx, ky, kz] = mask;
  const facing = Math.atan2(fx, fz), contact = bladeEdgeRoot('maskStrike', MASK_CONTACT, mask, facing);
  const landed: V3 = [lx, 0, lz], forward = (r: V3): V3 => [r[0] + fx * 10, 0, r[2] + fz * 10];
  const C = CONTACT_SHOT;
  const wide = Math.max(8.5, distance * 1.15);
  const medium: V3 = [hx + fx * wide * 0.6 + sx * wide, Math.max(4, ky + 1.6), hz + fz * wide * 0.6 + sz * wide];
  const establish: V3 = [(hx + kx) / 2, ky * 0.65, (hz + kz) / 2];
  const landingCam: V3 = [lx + sx * 5.5 + fx * 3.5, 2.3, lz + sz * 5.5 + fz * 3.5];
  const landingLook: V3 = [(lx + bx) / 2, 1.6, (lz + bz) / 2];
  const make = (T: typeof EXEC_T, short: boolean): CineStep[] => {
    const takeoff: V3 = [hx, 0, hz], flightDur = T.contact - T.jump;
    const flight = ballisticVelocity(takeoff, contact, flightDur, 2.4);
    const softened: V3 = [flight.velocityTo[0] * 0.25, -0.25, flight.velocityTo[2] * 0.25];
    const compression = contact.map((v, i) => v + (flight.velocityTo[i] + softened[i]) * 0.025) as V3;
    const driven = along(contact, facing, 0.15, 0.2, 0.04);
    const kick = along(driven, Math.atan2(lx - driven[0], lz - driven[2]), 0.18, -0.06), kickAt = T.land + 0.12;
    const retreat = ballisticVelocity(kick, landed, T.touchdown - kickAt, 2 * kick[1] / (T.touchdown - kickAt) + 1);
    const cutAt = T.contact - FINISHER_CUT_LEAD;
    const motion = (time: number) => ({ time, root: ballisticPoint(takeoff, contact, flightDur, T.strike + time - T.jump, 2.4) });
    const leapSpeed = short ? 1.9 / T.strike : 1;
    const launch = attackFraming('executionLeap', facing, [0, 0.25, 0.5, 0.75, 1].map(k => ({ time: (T.jump + (T.strike - T.jump) * k) * leapSpeed, root: ballisticPoint(takeoff, contact, flightDur, (T.strike - T.jump) * k, 2.4) })), mask, 48, [[bx, 0, bz], [kx, ky + 1.2, kz]]);
    const windup = attackFraming('maskStrike', facing, [0, 0.3, 0.44, MASK_CONTACT - FINISHER_CUT_LEAD].map(motion), mask, C.fov);
    const hit = bossImpactFraming('maskStrike', facing, [MASK_CONTACT - FINISHER_CUT_LEAD, MASK_RELEASE, MASK_CONTACT].map(motion).concat([{ time: MASK_CONTACT + 0.05, root: compression }, { time: MASK_CONTACT + 0.18, root: driven }]), mask, 1.1, 1.0);
    const victory = [0, 0.5, 1].map(u => victoryFrame(landed, facing, u));
    const P = HIEROPHANT_POSES;
    return [
    { t: 0, do: 'call', fn: 'freeze' },
    { t: 0, do: 'time', scale: 0.35, dur: T.jump, rampIn: 0.1, rampOut: 0.16 },
    { t: 0, do: 'clip', who: 'hero', clip: 'executionLeap', speed: short ? 1.9 / T.strike : 1, blend: 0.2 },
    // Удар сначала сдвигает маску, затем сгибает тяжёлый корпус. Все кости живут по часам режиссёра.
    { t: 0, do: 'clip', who: 'boss', clip: 'hierophantReaction', blend: 0, markers: { cut: 'cut' }, definition: { id: 'hierophantReaction', dur: T.cut, mask: 'full', events: [{ t: T.cut, name: 'cut' }], keys: [
      { t: 0, pose: P.executionBrace },
      { t: T.contact, pose: P.executionBrace },
      { t: T.contact + 0.05, ease: 'outQuad', pose: { ...P.executionBrace, chest: [0.925, 0, 0], bell: [-0.565, 0, 0.012] } },
      { t: T.contact + 0.16, ease: 'inOutSine', pose: P.executionHit },
      { t: T.crack, ease: 'outCubic', pose: P.executionBreak },
      { t: T.cut, pose: P.executionBreak },
    ] } },
    { t: 0, do: 'actor', who: 'hero', lookAt: forward([hx, 0, hz]), turn: T.jump * 0.8, dur: T.jump },
    { t: 0, do: 'cam', path: [medium], look: [establish], dur: T.jump, fov: 48 },
    { t: T.jump, do: 'call', fn: 'flare' },
    { t: T.jump, do: 'sfx', id: 'dash', gain: 0.65 },
    { t: T.jump, do: 'actor', who: 'hero', moveTo: contact, dur: flightDur, ...flight, lookAt: forward(contact) },
    { t: T.jump, do: 'cam', path: [launch.cam], look: [launch.look], dur: T.strike - T.jump, fov: 48, blend: 0 },
    // Поза и корень замедляются самими траекториями; окружение и частицы — той же паузой перед ударом.
    { t: T.strike - 0.45, do: 'time', scale: 0.16, dur: 0.45 + MASK_RELEASE, rampIn: 0.12, rampOut: 0.18 },
    { t: T.strike - 0.4, do: 'sfx', id: 'cast_inhale', gain: 0.45 },
    { t: T.strike, do: 'clip', who: 'hero', clip: 'maskStrike', markers: { contact: 'strike' }, blend: 0.16 },
    { t: T.strike + MASK_RELEASE, do: 'sfx', id: 'swing_heavy', gain: 0.95 },
    { t: T.strike, do: 'cam', path: [windup.cam], look: [windup.look], dur: cutAt - T.strike, fov: C.fov, blend: 0 },
    { t: cutAt, do: 'cam', path: [hit.cam], look: [hit.look], dur: T.land - cutAt, fov: 40, blend: 0 },
    { t: T.contact, do: 'time', scale: 0.08, dur: 0.16, rampIn: 0, rampOut: 0.06 },
    { t: T.contact + 0.035, do: 'hold', dur: 0.055 },
    { t: T.contact, do: 'actor', who: 'hero', moveTo: compression, dur: 0.05, velocityFrom: flight.velocityTo, velocityTo: softened },
    { t: T.contact + 0.05, do: 'actor', who: 'hero', moveTo: driven, dur: T.land - T.contact - 0.05, velocityFrom: softened, velocityTo: [0, 0, 0] },
    { t: T.toll, do: 'call', fn: 'toll' },
    { t: T.land, do: 'clip', who: 'hero', clip: 'executionLand', blend: 0.22 },
    { t: T.land, do: 'actor', who: 'hero', moveTo: kick, dur: 0.12, velocityFrom: [0, 0, 0], velocityTo: retreat.velocityFrom },
    { t: T.land, do: 'cam', path: [hit.cam, landingCam], look: [hit.look, landingLook], dur: T.touchdown - T.land, ease: 'inOutSine', fov: 48, blend: 0.22 },
    { t: T.crack, do: 'call', fn: 'fracture' },
    // Маска раскрывается, и сразу виден взрыв всего тела — пока Пилот ещё в воздухе.
    { t: T.cut, do: 'time', scale: 0.18, dur: 0.9, rampIn: 0.06, rampOut: 0.3 },
    { t: kickAt, do: 'actor', who: 'hero', moveTo: landed, dur: T.touchdown - kickAt, ...retreat },
    { t: T.touchdown, do: 'sfx', id: 'land_impact', gain: 0.65 },
    { t: T.beam, do: 'call', fn: 'beam' },
    { t: T.beam, do: 'sky', param: 'starLit', to: 1, dur: T.calm - T.beam },
    { t: T.beam + 0.1, do: 'music', cue: 'major' },
    { t: T.beam + 0.4, do: 'call', fn: 'star2' },
    { t: T.beam, do: 'cam', path: [landingCam, [bx - star[0] * 22 + sx * 3, 13, bz - star[2] * 22 + sz * 3]], look: [landingLook, [bx + star[0] * 100, 13 + star[1] * 100, bz + star[2] * 100]], dur: T.calm - T.beam, ease: 'inOutSine', fov: 48, blend: 0.3 },
    { t: T.calm, do: 'call', fn: 'calm' },
    { t: T.calm, do: 'clip', who: 'hero', clip: 'victory', dur: VICTORY_SHOT.dur, blend: 0.24 },
    { t: T.calm, do: 'cam', path: victory.map(s => s.cam), look: victory.map(s => s.look), dur: VICTORY_SHOT.dur, fov: VICTORY_SHOT.fov, ease: 'inOutSine', blend: 0 },
    { t: T.calm + VICTORY_SHOT.accentAt, do: 'call', fn: 'bossVictory' },
    ...(!short ? [{ t: T.say, do: 'say' as const, line: 'Одна звезда. Осталось четыре.' }] : []),
    { t: T.end, do: 'call', fn: 'end' },
  ];
  };
  return { id: 'hierophantEnd', revision: 5, cameraBlend: 0.24, origin: [bx, 0, bz], heading: facing, steps: make(EXEC_T, false), short: make(EXEC_SHORT_T, true), dur: EXEC_T.end + 0.2, blendOut: 0.7 };
}
