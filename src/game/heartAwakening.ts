import type { ClipDef } from '../anim/clip';
import { HEART_SOUL, type HeartSoul } from '../world/heartSoul';
import type { CineStep, CineTrack, V3 } from './director';
import { VICTORY_SHOT, victoryFrame } from './victoryShot';

const aisleX = (x: number): number => Math.max(-3, Math.min(3, x));
const ready = {
  chest: [0.06, 0, 0] as V3, head: [-0.08, 0, 0] as V3,
  shR: [-0.45, 0, -0.18] as V3, elbR: [-0.55, 0, 0] as V3,
  shL: [-0.25, 0, 0.24] as V3, elbL: [-0.35, 0, 0] as V3,
  hipL: [-0.08, 0, 0] as V3, hipR: [0.08, 0, 0] as V3,
  kneeL: [0.12, 0, 0] as V3, kneeR: [0.12, 0, 0] as V3,
};

function witnessClip(id: string, dur: number, awakening: boolean, offset = 0): ClipDef {
  const lookUp = { ...ready, head: [-0.45, 0, 0] as V3, chest: [-0.06, 0, 0] as V3 };
  const brace = { ...ready, chest: [0.17, 0, 0] as V3, shL: [-0.5, 0, 0.32] as V3, kneeL: [0.25, 0, 0] as V3, kneeR: [0.2, 0, 0] as V3 };
  const [b0, b1] = HEART_SOUL.beats.map(b => b - offset);
  return { id, dur, mask: 'full', keys: awakening ? [
    { t: 0, pose: ready }, { t: Math.min(0.6, b0 - 0.1), pose: lookUp },
    { t: b0, pose: brace }, { t: b0 + 0.35, pose: ready },
    { t: b1, pose: brace }, { t: b1 + 0.4, pose: ready },
    { t: HEART_SOUL.awakeAt - offset, pose: brace }, { t: HEART_SOUL.awakeAt - offset + 0.6, pose: ready }, { t: dur, pose: ready },
  ] : [
    { t: 0, pose: ready }, { t: 0.3, pose: lookUp },
    { t: Math.min(HEART_SOUL.burst + 0.2, dur - 0.4), pose: lookUp }, { t: Math.min(HEART_SOUL.burst + 0.8, dur - 0.2), pose: ready }, { t: dur, pose: ready },
  ] };
}

/** Где можно стоять камере в притворе: эллипс зала с запасом до стены. */
export interface ForeHall { z: number; rx: number; rz: number }

function inside(p: V3, hall: ForeHall, margin = 1.6): V3 {
  const ax = hall.rx - margin, az = hall.rz - margin, dx = p[0], dz = p[2] - hall.z;
  // Коридор к воротам: камера за светом проходит в проём по оси, стена её там не держит.
  if (Math.abs(dx) <= 2.6 && dz < -az * 0.5) return p;
  const k = Math.hypot(dx / ax, dz / az);
  if (k <= 1) return p;
  // Места позади не хватает — камера поднимается на столько же: свет остаётся далеко от объектива.
  const x = dx / k, z = hall.z + dz / k, lost = Math.hypot(p[0] - x, p[2] - z);
  return [x, p[1] + Math.min(2.3, lost * 0.9), z];
}

/**
 * Свет летит к Сердцу: камера идёт за ним низко над полом, сквозь поднимающиеся ворота в Чертог,
 * останавливается перед Сердцем и смотрит, как свет входит в ядро. Затем — герой у открытых ворот.
 * Время каждого шага выводится из маршрута света: камера и свет совпадают при любом месте гибели элиты.
 */
export function heartSoulFlightTrack(hero: V3, soul: HeartSoul, gateZ: number, hall: ForeHall): CineTrack {
  const m = soul.timing;
  if (!m) throw new Error('heartSoulFlightTrack: свет ещё не выпущен');
  const route = m.route, L = route.length, core = route.points[route.points.length - 1];
  const at = (s: number): V3 => route.at(Math.max(0, Math.min(L, s)));
  const soulAt = (t: number): V3 => at(soul.distanceAt(t));
  const timeAtDistance = (s: number): number => {
    let lo = 0, hi = m.absorbAt;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (soul.distanceAt(mid) < s) lo = mid; else hi = mid; }
    return hi;
  };
  // Камера в 5 м позади света по его же дороге, чуть выше и правее; взгляд — на 1.2 м впереди.
  // В начале пути камера стоит на продолжении дороги назад: свет не оказывается вплотную к объективу.
  const lead = route.points.find(p => Math.hypot(p[0] - route.points[1][0], p[2] - route.points[1][2]) > 2) ?? core;
  const l0 = Math.hypot(lead[0] - route.points[1][0], lead[2] - route.points[1][2]) || 1;
  const back = [(lead[0] - route.points[1][0]) / l0, (lead[2] - route.points[1][2]) / l0];
  const chase = (t: number): { cam: V3; look: V3 } => {
    const s = soul.distanceAt(t), cs = s - 5.2;
    let p: V3, fx: number, fz: number;
    if (cs >= 0) {
      p = at(cs); const q = at(cs + 0.6);
      fx = q[0] - p[0]; fz = q[2] - p[2];
      const d = Math.hypot(fx, fz);
      if (d < 1e-4) { fx = back[0]; fz = back[1]; } else { fx /= d; fz /= d; }
    } else {
      const o = at(0); fx = back[0]; fz = back[1];
      p = [o[0] + fx * cs, Math.max(o[1], 1.6), o[2] + fz * cs];
    }
    const cam: V3 = [p[0] - fz * 2.3, p[1] + 1.55, p[2] + fx * 2.3];
    const ahead = at(s + 1.2);
    return { cam: cam[2] > gateZ + 0.5 ? inside(cam, hall) : cam, look: [ahead[0], ahead[1] - 0.25, ahead[2]] };
  };
  const t0 = HEART_SOUL.burst + m.hover;
  const tStop = Math.max(t0 + 0.4, timeAtDistance(L - 9));
  const samples = (from: number, to: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + (to - from) * i / (n - 1));

  // Вспышка над телом: камера сбоку, в 7 м, и за время вспышки облетает свет за спину — к воротам.
  const start = chase(t0), source = route.points[0];
  const tx = -source[0], tz = hall.z - source[2], td = Math.hypot(tx, tz) || 1, cx = tx / td, cz = tz / td;
  // Сторона — к середине притвора: камера не уходит за кромку зала.
  const sideSign = (-back[1]) * cx + back[0] * cz >= 0 ? 1 : -1;
  const sx = -back[1] * sideSign, sz = back[0] * sideSign;
  const side: V3 = inside([source[0] + sx * 9 - back[0] * 1.8, 4.1, source[2] + sz * 9 - back[1] * 1.8], hall);
  const corner: V3 = inside([source[0] + sx * 5.6 - back[0] * 5, 3.7, source[2] + sz * 5.6 - back[1] * 5], hall);
  const burstTimes = samples(0, t0, 5);
  const burstCam: V3[] = [side, [(side[0] + corner[0]) / 2, (side[1] + corner[1]) / 2, (side[2] + corner[2]) / 2], corner, [(corner[0] + start.cam[0]) / 2, (corner[1] + start.cam[1]) / 2, (corner[2] + start.cam[2]) / 2], start.cam];
  const burstLook = burstTimes.map(t => { const p = soulAt(Math.max(0.15, t)); return [p[0], p[1] - 0.15, p[2]] as V3; });
  burstLook[burstLook.length - 1] = start.look;

  const chaseTimes = samples(t0, tStop, 12);
  const chaseShots = chaseTimes.map(chase);

  // Перед Сердцем камера тормозит, свет уходит в ядро; кадр держится на тлеющем Сердце.
  const holdEnd = m.absorbAt + HEART_SOUL.hold;
  const stop = chaseShots[chaseShots.length - 1];
  const heartCam: V3 = [2.1, 4.6, core[2] + 9.6], heartCamIn: V3 = [1.7, 4.4, core[2] + 8.7];
  const heartLook: V3 = [0, HEART_SOUL.coreY - 0.15, core[2]];
  const holdTimes = samples(tStop, holdEnd, 10);
  const holdCam = holdTimes.map(t => {
    const k = Math.min(1, (t - tStop) / Math.max(0.2, m.absorbAt - tStop + 0.25)), e = k * k * (3 - 2 * k);
    const push = Math.max(0, (t - m.absorbAt) / HEART_SOUL.hold);
    const base: V3 = [stop.cam[0] + (heartCam[0] - stop.cam[0]) * e, stop.cam[1] + (heartCam[1] - stop.cam[1]) * e, stop.cam[2] + (heartCam[2] - stop.cam[2]) * e];
    return [base[0] + (heartCamIn[0] - heartCam[0]) * push, base[1] + (heartCamIn[1] - heartCam[1]) * push, base[2] + (heartCamIn[2] - heartCam[2]) * push] as V3;
  });
  const holdLook = holdTimes.map(t => {
    if (t >= m.absorbAt) return heartLook;
    const p = soulAt(t), k = Math.max(0, Math.min(1, (t - tStop) / Math.max(0.2, m.absorbAt - tStop)));
    return [p[0] + (heartLook[0] - p[0]) * k * 0.5, p[1] + (heartLook[1] - p[1]) * k * 0.5, p[2] + (heartLook[2] - p[2]) * k * 0.5] as V3;
  });
  holdCam[0] = stop.cam; holdLook[0] = stop.look;

  // Финал: герой у открытых ворот, за ними тлеет Сердце. У края притвора камера подходит ближе,
  // а взгляд опускается к герою — ноги и голова остаются в кадре.
  const gx = -hero[0], gz = gateZ - hero[2], gd = Math.hypot(gx, gz) || 1, ux = gx / gd, uz = gz / gd;
  const wideHall = { ...hall, rx: hall.rx + 2, rz: hall.rz + 2 };
  const heroCam = inside([hero[0] - ux * 6.8 - uz * 1.4, 4.9, hero[2] - uz * 6.8 + ux * 1.4], wideHall);
  const heroCam2 = inside([heroCam[0] + ux * 0.6, 4.7, heroCam[2] + uz * 0.6], wideHall);
  const reach = Math.max(1.5, Math.min(4.5, Math.hypot(heroCam[0] - hero[0], heroCam[2] - hero[2]) * 0.6));
  const heroLook: V3 = [hero[0] + ux * reach, 1.1, hero[2] + uz * reach];

  const steps: CineStep[] = [
    { t: 0, do: 'actor', who: 'hero', lookAt: [source[0], hero[1], source[2]], turn: 0.3 },
    { t: 0, do: 'clip', who: 'hero', clip: 'heartSoulWitness', definition: witnessClip('heartSoulWitness', m.dur, false), blend: 0.18 },
    { t: 0, do: 'music', cue: 'silence' },
    { t: 0, do: 'sfx', id: 'void_moment', gain: 0.45 },
    { t: 0, do: 'cam', path: burstCam, look: burstLook, dur: t0, fov: 50, ease: 'linear' },
    { t: t0, do: 'sfx', id: 'dash', gain: 0.55 },
    { t: t0, do: 'actor', who: 'hero', lookAt: [0, hero[1], gateZ], turn: 0.7 },
    { t: t0, do: 'cam', path: chaseShots.map(s => s.cam), look: chaseShots.map(s => s.look), dur: tStop - t0, fov: 50, ease: 'linear', blend: 0 },
    { t: m.gateOpenAt, do: 'call', fn: 'heartGateOpen' },
    { t: m.gateOpenAt, do: 'sfx', id: 'tele_grind', gain: 0.45 },
    { t: tStop, do: 'cam', path: holdCam, look: holdLook, dur: holdEnd - tStop, fov: 50, ease: 'linear', blend: 0 },
    { t: m.absorbAt, do: 'call', fn: 'heartSoulAbsorb' },
    { t: m.absorbAt, do: 'sfx', id: 'heartbeat', gain: 0.75 },
    { t: m.absorbAt, do: 'sfx', id: 'boss_bell', gain: 0.3 },
    { t: m.absorbAt + 0.55, do: 'sfx', id: 'heartbeat', gain: 0.45 },
    { t: holdEnd, do: 'cam', path: [heroCam, heroCam2], look: [heroLook], dur: HEART_SOUL.outro, fov: 48, ease: 'inOutSine', blend: 0 },
  ];
  // Повторный просмотр: без общего плана героя и с короткой паузой у Сердца; маркеры — в те же моменты.
  const shortHold = m.absorbAt + 0.45;
  const short = steps.flatMap<CineStep>((s): CineStep[] => {
    if (s.do === 'cam' && s.t >= holdEnd) return [];
    if (s.do === 'cam' && s.t === tStop) return [{ ...s, dur: shortHold - tStop }];
    if (s.do === 'sfx' && s.t > m.absorbAt) return [];
    if (s.do === 'clip') return [{ ...s, dur: shortHold, definition: witnessClip('heartSoulWitness', shortHold, false) }];
    return [s];
  });
  return { id: 'heartSoulFlight', dur: m.dur, steps, short, skippable: true, blendOut: 0.8 };
}

/** Время вступления: обзор зала, шаги героя, подъём Сердца из колодца, два удара, рёв, жернова, имя. */
export const HEART_INTRO_T = { walk: 2.0, rise: 3.6, stones: 6.0, title: 6.9 };

/**
 * Начало боя с Погребальным сердцем. Камера проходит над залом от дальней стены, герой входит в Чертог,
 * Сердце поднимается из колодца, бьётся дважды, ревёт — броня распахивается и наливается багровым; над чашами
 * собираются жернова; общий план героя и босса с именем. Камера не выходит за ворота нового зала.
 */
export function heartIntroTrack(hero: V3, centerZ: number): CineTrack {
  const { beats, awakeAt, awakeningDur } = HEART_SOUL, T = HEART_INTRO_T;
  const walked: V3 = [hero[0] * 0.6, 0, hero[2] - 2.4];
  const coreLook: V3 = [0, HEART_SOUL.coreY, centerZ - 0.5];
  // Обзор: из-за Сердца, сверху, на вход в Чертог — откуда придёт герой.
  const revealA: V3 = [-10, 12.5, centerZ - 9.5], revealB: V3 = [-6.8, 9.2, centerZ - 8];
  // Шаги: низко за спиной героя, взгляд мимо него на тлеющее Сердце.
  const behindA: V3 = [hero[0] + 1.5, 1.7, Math.min(hero[2] + 3.2, centerZ + 13.6)], behindB: V3 = [walked[0] + 1.3, 1.65, walked[2] + 3];
  // Подъём: снизу сбоку, Сердце выходит из колодца над героем.
  const riseA: V3 = [3.6, 1.9, centerZ + 7.8], riseB: V3 = [3.0, 2.3, centerZ + 7.2];
  const close: V3 = [1.7, 4.7, centerZ + 5.6], thrown: V3 = [2.8, 6.4, centerZ + 10.2];
  const wide: V3 = [aisleX(walked[0] * 0.5), 15.5, Math.min(walked[2] + 4.5, centerZ + 13.5)];
  const wideLook: V3 = [walked[0] * 0.3, 2.4, centerZ + (walked[2] - centerZ) * 0.5];
  const steps: CineStep[] = [
    { t: 0, do: 'music', cue: 'silence' },
    { t: 0, do: 'actor', who: 'hero', lookAt: [0, hero[1], centerZ], turn: 0.3 },
    { t: 0, do: 'cam', path: [revealA, revealB], look: [[0, 3, centerZ + 2], [0, 3.4, centerZ + 3]], dur: T.walk, fov: 50, ease: 'inOutSine' },
    { t: 0.8, do: 'sfx', id: 'heartbeat', gain: 0.45 },
    { t: T.walk, do: 'clip', who: 'hero', clip: 'cinematicWalk', speed: 2.2 / (T.rise - T.walk), blend: 0.22 },
    { t: T.walk, do: 'actor', who: 'hero', moveTo: walked, dur: T.rise - T.walk, ease: 'inOutSine', lookAt: [0, 0, centerZ], turn: 0.4 },
    { t: T.walk, do: 'cam', path: [behindA, behindB], look: [[0, 3.2, centerZ], [0, 3.4, centerZ]], dur: T.rise - T.walk, fov: 46, ease: 'linear', blend: 0 },
    { t: T.rise, do: 'clip', who: 'hero', clip: 'heartAwakeningWitness', definition: witnessClip('heartAwakeningWitness', awakeningDur - T.rise, true, T.rise), blend: 0.25 },
    { t: T.rise, do: 'call', fn: 'heartRise' },
    { t: T.rise, do: 'sfx', id: 'chain_drop', gain: 0.7 },
    { t: T.rise, do: 'sfx', id: 'tele_grind', gain: 0.5 },
    { t: T.rise, do: 'cam', path: [riseA, riseB], look: [[0, 2.2, centerZ - 0.5], coreLook], dur: beats[1] - T.rise, fov: 48, ease: 'inOutSine', blend: 0 },
    { t: beats[0], do: 'sfx', id: 'heartbeat', gain: 0.85 },
    { t: beats[0], do: 'sfx', id: 'land_impact', gain: 0.25 },
    { t: beats[1], do: 'sfx', id: 'heartbeat', gain: 1 },
    { t: beats[1], do: 'sfx', id: 'land_impact', gain: 0.35 },
    { t: beats[1], do: 'cam', path: [riseB, close], look: [coreLook], dur: awakeAt - beats[1], fov: 44, ease: 'inCubic', blend: 0.08 },
    { t: awakeAt, do: 'call', fn: 'heartAwake' },
    // Рёв: камеру отбрасывает, броня распахивается, ядро наливается багровым.
    { t: awakeAt, do: 'cam', path: [close, thrown], look: [coreLook, [0, 4.2, centerZ]], dur: 0.55, fov: 50, ease: 'outCubic', blend: 0.04 },
    { t: awakeAt + 0.55, do: 'cam', path: [thrown, wide], look: [[0, 4.2, centerZ], wideLook], dur: T.title - awakeAt - 0.55, fov: 56, ease: 'inOutSine', blend: 0.12 },
    { t: T.stones, do: 'call', fn: 'heartStones' },
    { t: T.title, do: 'banner', text: 'ПОГРЕБАЛЬНОЕ СЕРДЦЕ', sub: 'Страж Последнего Огня', color: 'hunger', dur: 1.8, size: 44 },
    { t: T.title, do: 'cam', path: [wide, [wide[0], wide[1] + 0.3, wide[2] + 0.4]], look: [wideLook], dur: awakeningDur - T.title, fov: 56, ease: 'outSine', blend: 0.12 },
  ];
  // Повторный просмотр — без долгого общего плана с именем; маркеры в те же моменты.
  const cut = T.title + 0.4;
  const short = steps.flatMap<CineStep>((s): CineStep[] => {
    if (s.do === 'banner') return [];
    if (s.do === 'cam' && s.t >= T.title) return [{ ...s, dur: cut - T.title }];
    if (s.do === 'clip' && s.definition) return [{ ...s, dur: cut - s.t }];
    return [s];
  });
  return { id: 'heartIntro', dur: awakeningDur, steps, short, skippable: true, blendOut: 0.8 };
}

/**
 * Время сцены гибели: удары затихают, ядро трескается лучами и лопается в burst; освобождённый свет
 * поднимается к своду (ascend…ascendEnd); затем поза победы героя и имя побеждённого.
 */
export const HEART_DEATH_T = { beats: [0.7, 1.45] as const, burst: 1.9, ascend: 2.35, ascendEnd: 4.25, victory: 4.3, end: 4.3 + VICTORY_SHOT.dur };

/** Где освобождённый свет в момент t сцены гибели (над лопнувшим ядром, всё выше), или null. */
export function releasedLight(t: number, body: V3): V3 | null {
  const T = HEART_DEATH_T;
  if (t < T.burst + 0.1 || t > T.ascendEnd + 0.3) return null;
  const k = Math.max(0, Math.min(1, (t - T.burst - 0.1) / (T.ascendEnd - T.burst))), e = k * k * (3 - 2 * k);
  return [body[0] + Math.sin(k * 5) * 0.5 * (1 - k), 2.3 + e * 11.5, body[2] + Math.cos(k * 5) * 0.5 * (1 - k)];
}

/**
 * Гибель Сердца: крупный план — из трещин ядра бьют лучи, ядро сжимается, камера медленно обходит его;
 * вспышка отбрасывает камеру; освобождённый свет поднимается к своду, золотая волна возвращает огонь свечам;
 * затем — поза победы героя и титул. Камера остаётся над полом Чертога (эллипс 38×30 м с запасом).
 */
export function heartDeathTrack(hero: V3, body: V3, centerZ: number, facing = Math.PI): CineTrack {
  const T = HEART_DEATH_T;
  const clampHall = (p: V3): V3 => {
    const ax = 17.2, az = 13.2, dx = p[0], dz = p[2] - centerZ, k = Math.hypot(dx / ax, dz / az);
    return k <= 1 ? p : [dx / k, p[1], centerZ + dz / k];
  };
  let dx = hero[0] - body[0], dz = hero[2] - body[2];
  const d = Math.hypot(dx, dz);
  if (d < 0.5) { dx = -body[0]; dz = centerZ + 14 - body[2]; }
  const n = Math.hypot(dx, dz) || 1, ux = dx / n, uz = dz / n, sx = -uz, sz = ux;
  const core: V3 = [body[0], 2.3, body[2]];
  const orbit = (a: number, r: number, y: number): V3 => {
    const ca = Math.cos(a), sa = Math.sin(a);
    return clampHall([body[0] + (ux * ca + sx * sa) * r, y, body[2] + (uz * ca + sz * sa) * r]);
  };
  // Крупный план держит всё Сердце с раскрытыми лепестками (до ~4.6 м в ширину) и венцом.
  const close0 = orbit(0.6, 11.2, 5.2), close1 = orbit(0.3, 9.8, 4.6);
  const pull = orbit(0.15, 12.5, 6.2);
  // Вознесение: камера низко у героя, взгляд снизу вверх за светом.
  const up0 = orbit(0.25, 10.5, 1.6), up1 = orbit(0.35, 11.5, 1.9);
  const heroAt: V3 = [hero[0], 0, hero[2]];
  const victory = [0, 0.5, 1].map(u => victoryFrame(heroAt, facing, u));
  const steps: CineStep[] = [
    { t: 0, do: 'actor', who: 'hero', lookAt: [body[0], hero[1], body[2]], turn: 0.35 },
    { t: 0, do: 'music', cue: 'silence' },
    { t: 0, do: 'cam', path: [close0, close1], look: [core], dur: T.burst, fov: 44, ease: 'inOutSine' },
    { t: T.beats[0], do: 'sfx', id: 'heartbeat', gain: 0.85 },
    { t: T.beats[1], do: 'sfx', id: 'heartbeat', gain: 0.6 },
    { t: 1.2, do: 'sfx', id: 'riser', gain: 0.5 },
    // Вспышка: камеру отбрасывает назад.
    { t: T.burst, do: 'cam', path: [close1, pull], look: [core, [body[0], 3.2, body[2]]], dur: T.ascend - T.burst, fov: 50, ease: 'outCubic', blend: 0 },
    // Свет уходит вверх, к своду; по залу идёт золотая волна.
    { t: T.ascend, do: 'cam', path: [up0, up1], look: [[body[0], 4.5, body[2]], [body[0], 13.5, body[2]]], dur: T.victory - T.ascend, fov: 52, ease: 'inOutSine', blend: 0.25 },
    { t: T.ascend, do: 'sfx', id: 'choir_return', gain: 0.6 },
    { t: T.victory, do: 'clip', who: 'hero', clip: 'victory', dur: VICTORY_SHOT.dur, blend: 0.25 },
    { t: T.victory, do: 'cam', path: victory.map(v => v.cam), look: victory.map(v => v.look), dur: VICTORY_SHOT.dur, fov: VICTORY_SHOT.fov, ease: 'inOutSine', blend: 0 },
    { t: T.victory + VICTORY_SHOT.accentAt, do: 'call', fn: 'heartVictory' },
  ];
  // Повтор: без вознесения, сразу к победе героя; маркер — в тот же момент.
  const short = steps.filter(s => !(s.do === 'cam' && s.t === T.ascend));
  return { id: 'heartDeath', dur: T.end, steps, short, skippable: true, blendOut: 0.6 };
}
