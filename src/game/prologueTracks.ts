import * as THREE from 'three';
import type { CineStep, CineTrack, V3 } from './director';

/**
 * Пролог «Падение» (план §8.2): геометрия космоса и дорожки режиссёра. Отдельно от сцены — без рендера,
 * чтобы тайминги проверялись тестами.
 */
export const SPACE = {
  /** Кольцо соборов: дистанция до центра (по направлению на погасшую звезду неба) и радиус (м). */
  ringD: 620, ringR: 150, ringCount: 24,
  /** Старт «Инея» (м по осям F, Rt, Up) и скорость (м/с по F, Rt). */
  start: [40, 60, 6] as V3, velF: 6, velR: -22,
  /** Луч попадает (с от начала полёта). */
  hitT: 6.3,
  /** Лучи тянутся из соборов, пока корабль летит (с от начала полёта). */
  beamsT: 3.4, beamGrow: 2.9,
};

/** Время дорожки, когда начинаются планы (с). */
export const PROLOGUE_T = { space: 3, chase: 6, hit: 3 + SPACE.hitT, fall: 13, dome: 20.4, slow: 21.8, flash: 24.4, end: 24.9 };

/** Через сколько секунд падения Пилот пробивает розу купола (время симуляции, замедление его растягивает). */
export const DOME_IMPACT = 8.8 + 0.2;

const _v = new THREE.Vector3();

/** Оси космоса: F — на погасшую звезду (чёрная луна неба), Rt — вправо, Up — вверх кадра. */
export class SpaceBasis {
  readonly F: THREE.Vector3;
  readonly Rt: THREE.Vector3;
  readonly Up: THREE.Vector3;
  /** Центр кольца соборов. */
  readonly C: THREE.Vector3;

  constructor(starDir: { x: number; y: number; z: number }) {
    this.F = new THREE.Vector3(starDir.x, starDir.y, starDir.z).normalize();
    this.Rt = new THREE.Vector3().crossVectors(this.F, new THREE.Vector3(0, 1, 0)).normalize();
    this.Up = new THREE.Vector3().crossVectors(this.Rt, this.F).normalize();
    this.C = this.F.clone().multiplyScalar(SPACE.ringD);
  }

  /** Точка в осях (f, r, u). */
  at(f: number, r: number, u: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.F).multiplyScalar(f).addScaledVector(this.Rt, r).addScaledVector(this.Up, u);
  }

  /** Скорость «Инея» до удара (м/с). */
  shipVel(out = new THREE.Vector3()): THREE.Vector3 { return out.copy(this.F).multiplyScalar(SPACE.velF).addScaledVector(this.Rt, SPACE.velR); }

  /** После удара (u — с после попадания): корабль заваливается к шпилям, теряя ход. */
  shipFall(u: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.shipPos(SPACE.hitT, out);
    const v = this.shipVel(_v).normalize();
    return out.addScaledVector(v, 13 * u).addScaledVector(this.F, 3 * u * u).addScaledVector(this.Up, -2.2 * u * u);
  }

  /** Позиция «Инея» на прямом курсе (t — с от начала полёта, до удара). */
  shipPos(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const [f, r, u] = SPACE.start;
    return this.at(f + SPACE.velF * t, r + SPACE.velR * t, u, out);
  }

  /** Точка на кольце соборов (угол a): откуда бьют лучи. */
  ringPoint(a: number, out = new THREE.Vector3()): THREE.Vector3 {
    const side = _v.copy(this.Rt).multiplyScalar(Math.cos(a)).addScaledVector(this.Up, Math.sin(a));
    return out.copy(this.C).addScaledVector(side, SPACE.ringR);
  }
}

const v3 = (p: THREE.Vector3): V3 => [p.x, p.y, p.z];

/** Падение снято сверху: герой в плоскости y = 0, окно стика ±5 × ±3 м; кадр идёт за героем — камера ближе, Пилот крупнее. */
const FALL_CAM: V3 = [0, 6.6, 1.8], FALL_CAM2: V3 = [0.4, 6.1, 1.6], FALL_LOOK: V3 = [0, 0, -0.3];

/**
 * Пролог, планы 1–5 (≈25 с): тьма с текстом → «Иней» у кольца соборов → луч → играбельное падение → купол.
 * Логика планов — шаги 'call' (выполняются и при пропуске): dark, space, beams, hit, blackout, fall, hint, dome, end.
 */
export function prologueTrack(b: SpaceBasis): CineTrack {
  const T = PROLOGUE_T;
  const ship = (t: number) => b.shipPos(t);
  // план 2а: камера у «Инея», взгляд на кольцо; корабль входит в кадр справа
  const a0 = b.at(0, -3, 1.5), a1 = b.at(4, -6, 2.2);
  const la0 = b.at(300, 40, 4), la1 = b.at(300, -6, 2);
  // план 2б: проводка рядом с кораблём, кольцо и лучи — за ним
  const s0 = ship(T.chase - T.space), s1 = ship(SPACE.hitT);
  const off = (p: THREE.Vector3) => p.clone().addScaledVector(b.F, -30).addScaledVector(b.Up, 6).addScaledVector(b.Rt, 9);
  const look = (p: THREE.Vector3) => p.clone().addScaledVector(b.F, 60).addScaledVector(b.Rt, -6);
  // план 3: удар — камера сбоку ведёт корабль, он заваливается к шпилям (замедление 0.3 × 0.8 с отстаёт на 0.56 с)
  const fall = [0, 1.4, T.fall - T.hit - 0.56].map((u) => b.shipFall(u));
  const cam = fall.map((p) => p.clone().addScaledVector(b.F, -38).addScaledVector(b.Up, 10).addScaledVector(b.Rt, 16));
  const steps: CineStep[] = [
    // план 1: тьма, белый текст, блипы голоса Каэлис
    { t: 0, do: 'call', fn: 'dark' },
    { t: 0, do: 'letterbox', v: 1 },
    { t: 0, do: 'cam', path: [v3(a0)], look: [v3(la0)], dur: T.space },
    { t: 0.2, do: 'sfx', id: 'drone', gain: 0.7 },
    // план 2: корабль у кольца соборов вокруг тусклой звезды; багровые лучи тянутся к нему
    { t: T.space, do: 'call', fn: 'space', arg: 0 },
    { t: T.space, do: 'cam', path: [v3(a0), v3(a1)], look: [v3(la0), v3(la1)], dur: T.chase - T.space, ease: 'linear' },
    { t: T.space + 0.1, do: 'sfx', id: 'drone', gain: 0.9 },
    { t: T.chase, do: 'cam', path: [v3(off(s0)), v3(off(s1))], look: [v3(look(s0)), v3(look(s1))], dur: T.hit - T.chase, ease: 'linear' },
    { t: T.space + SPACE.beamsT, do: 'call', fn: 'beams' },
    { t: T.space + SPACE.beamsT, do: 'sfx', id: 'beam', gain: 0.45 },
    ...[0, 0.7, 1.4, 2.1].map((d): CineStep => ({ t: T.space + SPACE.beamsT + 0.1 + d, do: 'sfx', id: 'alarm', gain: 0.5 })),
    { t: T.space + SPACE.beamsT + 0.6, do: 'say', line: 'Захват лучом! Держись, Пилот!' },
    // план 3: удар — корпус раскалывается, тревога обрывается
    { t: T.hit, do: 'call', fn: 'hit' },
    { t: T.hit, do: 'sfx', id: 'hull_hit', gain: 1 },
    { t: T.hit, do: 'flash', v: 0.7 },
    { t: T.hit, do: 'time', scale: 0.3, dur: 0.8 },
    { t: T.hit, do: 'cam', path: cam.map(v3), look: fall.map(v3), dur: T.fall - T.hit, ease: 'linear' },
    { t: T.fall - 0.45, do: 'call', fn: 'blackout' },
    // план 4: падение — играбельно; камера сверху, стик уводит от обломков
    { t: T.fall, do: 'call', fn: 'fall' },
    { t: T.fall, do: 'letterbox', v: 0 },
    { t: T.fall, do: 'cam', path: [FALL_CAM, FALL_CAM2], look: [FALL_LOOK], dur: T.slow - T.fall, fov: 50 },
    { t: T.fall, do: 'sfx', id: 'fall_wind', gain: 0.9 },
    { t: T.fall + 0.6, do: 'call', fn: 'hint' },
    // план 5: роза купола поднимается навстречу; замедление, витраж разлетается
    { t: T.dome, do: 'call', fn: 'dome' },
    { t: T.slow, do: 'time', scale: 0.2, dur: 2.4 },
    { t: T.slow, do: 'cam', path: [FALL_CAM2, [1.2, 4.6, 2.6]], look: [FALL_LOOK, [0, -0.6, 0]], dur: 1.6, ease: 'outCubic', fov: 64, roll: 0.16 },
    { t: T.flash, do: 'flash', v: 1 },
    // белый держится до конца: под ним строится арена 1-1 — загрузка не видна
    { t: T.end - 0.1, do: 'flash', v: 1 },
    { t: T.end, do: 'call', fn: 'end' },
  ];
  return { id: 'prologue', steps, dur: T.end + 0.25 };
}

/** Где стоят актёры приземления: кратер, обломок обшивки, откуда выползает Шелуха. */
export interface LandingSpots { x: number; z: number; shardX: number; shardZ: number; huskX: number; huskZ: number }

/** Время шагов приземления (с от начала дорожки). */
export const LANDING_T = { impact: 0.9, visor: 2.5, say: 3.0, walk: 4.0, pull: 5.0, grip: 5.95, ignite: 6.12, husk: 7.7, turn: 7.95, title: 9.3, music: 9.9, end: 10.7 };
/** Высота, с которой Пилот падает в кратер (м). */
export const LANDING_FROM = 15;

/**
 * Пролог, планы 6–8 (≈11 с) — уже на арене 1-1. Каждый план — со стороны дальней стены собора, чтобы за
 * Пилотом были колонны и витражи, а не пустое небо:
 * 6 — снизу вверх: Пилот падает из разбитой розы со стеклом; удар в замедлении — с уровня пола, волна
 *     и пыль идут на камеру, свечи гаснут; крупно — визор загорается, «Системы… живы. Пилот?».
 * 7 — обломок обшивки «Инея» зовёт фиолетовым; Пилот идёт к нему (на камеру), сбоку у пола — хват и рывок,
 *     обломок вспыхивает клинком, снизу — клинок над головой (лейтмотив впервые).
 * 8 — за спиной шорох: Пилот оборачивается, через плечо — Шелуха выползает из темноты; кран вверх к бою,
 *     титул «впечатывается», управление возвращается.
 */
export function landingTrack(p: LandingSpots): CineTrack {
  const L = LANDING_T;
  const { x, z } = p;
  // F — к обломку (туда Пилот смотрит после приземления), S — вбок
  const fl = Math.hypot(p.shardX - x, p.shardZ - z) || 1;
  const Fx = (p.shardX - x) / fl, Fz = (p.shardZ - z) / fl, Sx = Fz, Sz = -Fx;
  const at = (ox: number, oz: number, f: number, s: number, y: number): V3 => [ox + Fx * f + Sx * s, y, oz + Fz * f + Sz * s];
  const stand: V3 = [p.shardX - Fx * 0.75, 0, p.shardZ - Fz * 0.75];
  const [sx, , sz] = stand;
  // через плечо на Шелуху: камера за Пилотом, когда он обернулся к ней
  const hl = Math.hypot(p.huskX - sx, p.huskZ - sz) || 1;
  const Hx = (p.huskX - sx) / hl, Hz = (p.huskZ - sz) / hl;
  const over = (back: number, side: number, y: number): V3 => [sx - Hx * back + Hz * side, y, sz - Hz * back - Hx * side];
  const husk = (y: number): V3 => [p.huskX, y, p.huskZ];
  const g1 = over(2.6, 1.15, 1.9), g2 = over(2.2, 1.0, 1.8);
  const steps: CineStep[] = [
    { t: 0, do: 'flash', v: 1 },
    { t: 0, do: 'call', fn: 'landStart' },
    { t: 0, do: 'actor', who: 'hero', moveTo: [x, 0, z], dur: L.impact, ease: 'inQuad', lookAt: [p.shardX, 0, p.shardZ] },
    // план 6а: с пола вверх — Пилот падает из разбитой розы, со стеклом
    { t: 0, do: 'cam', path: [at(x, z, 3.6, 1.3, 0.35), at(x, z, 3.4, 1.2, 0.4)], look: [[x, LANDING_FROM - 2.5, z], [x, 1.0, z]], dur: L.impact, ease: 'inQuad', fov: 48 },
    { t: 0.1, do: 'sfx', id: 'fall_wind', gain: 0.7 },
    // 6б: удар — склейка на уровень пола, замедление; волна и пыль идут на камеру
    { t: L.impact, do: 'actor', who: 'hero', clip: 'land' },
    { t: L.impact, do: 'call', fn: 'impact' },
    { t: L.impact, do: 'sfx', id: 'land_impact', gain: 1 },
    { t: L.impact, do: 'time', scale: 0.25, dur: 0.7 },
    { t: L.impact, do: 'cam', path: [at(x, z, 4.4, -2.3, 0.62), at(x, z, 4.0, -2.0, 0.66)], look: [[x, 0.7, z], [x, 0.85, z]], dur: L.visor - 0.2 - L.impact, ease: 'outCubic', fov: 42, roll: 0.05 },
    // 6в: крупно — визор загорается, Пилот поднимается
    { t: L.visor - 0.2, do: 'cam', path: [at(x, z, 2.3, 0.5, 1.15), at(x, z, 2.15, 0.45, 1.2), at(x, z, 2.9, 0.7, 1.45)], look: [[x, 1.2, z], [x, 1.25, z], [x, 1.55, z]], dur: L.walk - L.visor + 0.2, ease: 'linear', fov: 40 },
    { t: L.visor, do: 'call', fn: 'visor' },
    { t: L.say, do: 'say', line: 'Системы… живы. Пилот?' },
    // план 7: идёт к обломку — на камеру, обломок в переднем плане
    { t: L.walk - 0.1, do: 'call', fn: 'idle' },
    { t: L.walk, do: 'actor', who: 'hero', moveTo: stand, dur: 0.95, lookAt: [p.shardX, 0, p.shardZ] },
    { t: L.walk, do: 'cam', path: [at(x, z, 2.9, 0.7, 1.45), at(p.shardX, p.shardZ, 2.9, 1.2, 1.5)], look: [[x, 1.55, z], [p.shardX * 0.5 + sx * 0.5, 1.15, p.shardZ * 0.5 + sz * 0.5]], dur: L.pull - L.walk, ease: 'inOutSine', fov: 42 },
    // хват и рывок — сбоку, у пола
    { t: L.pull, do: 'actor', who: 'hero', clip: 'pullBlade', lookAt: [p.shardX, 0, p.shardZ] },
    { t: L.pull, do: 'cam', path: [at(p.shardX, p.shardZ, 0.2, 2.9, 0.75), at(p.shardX, p.shardZ, 0.1, 2.5, 0.8)], look: [[(p.shardX + sx) / 2, 0.7, (p.shardZ + sz) / 2], [(p.shardX + sx) / 2, 0.85, (p.shardZ + sz) / 2]], dur: L.ignite - L.pull, ease: 'linear', fov: 40 },
    { t: L.grip, do: 'call', fn: 'grip' },
    { t: L.grip, do: 'sfx', id: 'blade_scrape', gain: 0.8 },
    // клинок вспыхивает: снизу спереди, над Пилотом — своды и витражи
    { t: L.ignite, do: 'call', fn: 'ignite' },
    { t: L.ignite, do: 'sfx', id: 'blade_ignite', gain: 1 },
    { t: L.ignite, do: 'flash', v: 0.35 },
    { t: L.ignite, do: 'cam', path: [at(sx, sz, 2.7, 1.1, 0.55), at(sx, sz, 2.5, -0.2, 0.68), at(sx, sz, 2.3, -1.0, 0.8)], look: [[sx, 1.85, sz], [sx, 1.75, sz], [sx, 1.6, sz]], dur: L.turn - L.ignite, ease: 'outQuad', fov: 44 },
    { t: L.ignite + 0.15, do: 'music', cue: 'leitmotif' },
    // план 8: шорох за спиной — Пилот оборачивается; через плечо — Шелуха выползает из темноты
    { t: L.husk, do: 'call', fn: 'husk' },
    { t: L.turn, do: 'actor', who: 'hero', lookAt: [p.huskX, 0, p.huskZ], turn: 0.45 },
    { t: L.turn, do: 'cam', path: [g1, g2], look: [husk(0.9), husk(0.75)], dur: L.title - L.turn, ease: 'outQuad', fov: 40 },
    // кран вверх и назад — к боевой камере
    { t: L.title, do: 'call', fn: 'title' },
    { t: L.title, do: 'sfx', id: 'title_stamp', gain: 0.9 },
    { t: L.title, do: 'cam', path: [g2, over(4.5, 0.3, 4.2), over(7.5, 0, 6.4)], look: [husk(0.75), [(sx + p.huskX) / 2, 0.6, (sz + p.huskZ) / 2]], dur: L.end - L.title, ease: 'inOutSine', fov: 36 },
    { t: L.music, do: 'call', fn: 'music' },
    { t: L.end - 0.3, do: 'call', fn: 'idle' },
    { t: L.end, do: 'call', fn: 'end' },
  ];
  return { id: 'prologueLanding', steps, dur: L.end + 0.2, blendOut: 0.9 };
}
