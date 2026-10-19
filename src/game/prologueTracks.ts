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

/** Падение снято сверху: герой в плоскости y = 0, окно стика ±5 × ±3 м. */
const FALL_CAM: V3 = [0, 8.6, 2.2], FALL_CAM2: V3 = [0.5, 8.0, 1.9], FALL_LOOK: V3 = [0, 0, -0.3];

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
    { t: T.fall, do: 'cam', path: [FALL_CAM, FALL_CAM2], look: [FALL_LOOK], dur: T.slow - T.fall, fov: 52 },
    { t: T.fall, do: 'sfx', id: 'fall_wind', gain: 0.9 },
    { t: T.fall + 0.6, do: 'call', fn: 'hint' },
    // план 5: роза купола поднимается навстречу; замедление, витраж разлетается
    { t: T.dome, do: 'call', fn: 'dome' },
    { t: T.slow, do: 'time', scale: 0.2, dur: 2.4 },
    { t: T.slow, do: 'cam', path: [FALL_CAM2, [1.2, 4.6, 2.6]], look: [FALL_LOOK, [0, -0.6, 0]], dur: 1.6, ease: 'outCubic', fov: 64, roll: 0.16 },
    { t: T.flash, do: 'flash', v: 1 },
    { t: T.end, do: 'call', fn: 'end' },
  ];
  return { id: 'prologue', steps, dur: T.end + 0.25 };
}

/** Где стоят актёры приземления: кратер, обломок обшивки, откуда выползает Шелуха. */
export interface LandingSpots { x: number; z: number; shardX: number; shardZ: number; huskX: number; huskZ: number }

/** Время шагов приземления (с от начала дорожки). */
export const LANDING_T = { impact: 0.22, say: 3.0, walk: 3.4, pull: 4.5, ignite: 5.62, husk: 8.0, title: 9.0, music: 9.7, end: 10.4 };

/**
 * Пролог, планы 6–8 (≈10 с) — уже на арене 1-1: приземление в кратер (ударная волна гасит свечи), визор,
 * «Системы… живы. Пилот?», обломок обшивки становится клинком (лейтмотив впервые), из темноты выползает
 * Шелуха, титул «впечатывается», управление возвращается.
 */
export function landingTrack(p: LandingSpots): CineTrack {
  const L = LANDING_T;
  const { x, z } = p;
  // герой смотрит вглубь арены (−Z); обломок — впереди справа
  const fx = (p.shardX - x), fz = (p.shardZ - z), fl = Math.hypot(fx, fz) || 1;
  const stand: V3 = [p.shardX - (fx / fl) * 0.75, 0, p.shardZ - (fz / fl) * 0.75];
  const steps: CineStep[] = [
    { t: 0, do: 'flash', v: 1 },
    { t: 0, do: 'call', fn: 'landStart' },
    { t: 0, do: 'actor', who: 'hero', moveTo: [x, 0, z], dur: L.impact, ease: 'inQuad', lookAt: [x, 0, z - 4] },
    // план 6: приземление — суб-удар, волна гасит свечи
    { t: 0, do: 'cam', path: [[x + 5.5, 1.1, z + 7], [x + 4.2, 1.5, z + 5.6]], look: [[x, 0.9, z], [x, 1.0, z]], dur: L.walk, ease: 'outCubic' },
    { t: L.impact, do: 'actor', who: 'hero', clip: 'land' },
    { t: L.impact, do: 'call', fn: 'impact' },
    { t: L.impact, do: 'sfx', id: 'land_impact', gain: 1 },
    // план 7: визор загорается, Каэлис оживает; обломок обшивки «Инея» становится клинком
    { t: 2.4, do: 'call', fn: 'visor' },
    { t: L.say, do: 'say', line: 'Системы… живы. Пилот?' },
    { t: L.walk - 0.1, do: 'call', fn: 'idle' },
    { t: L.walk, do: 'actor', who: 'hero', moveTo: stand, dur: 1.0, lookAt: [p.shardX, 0, p.shardZ] },
    { t: L.walk, do: 'cam', path: [[x + 4.2, 1.5, z + 5.6], [stand[0] + 2.6, 1.7, stand[2] + 3.4]], look: [[x, 1.0, z], [p.shardX, 0.6, p.shardZ]], dur: L.pull - L.walk + 0.6 },
    { t: L.pull, do: 'actor', who: 'hero', clip: 'pullBlade', lookAt: [p.shardX, 0, p.shardZ] },
    { t: L.ignite - 0.5, do: 'cam', path: [[stand[0] + 2.6, 1.7, stand[2] + 3.4], [stand[0] - 2.4, 0.55, stand[2] - 4.6]], look: [[p.shardX, 0.6, p.shardZ], [stand[0], 1.75, stand[2]]], dur: 1.6, ease: 'inOutCubic' },
    { t: L.ignite, do: 'call', fn: 'ignite' },
    { t: L.ignite, do: 'sfx', id: 'blade_ignite', gain: 1 },
    { t: L.ignite, do: 'flash', v: 0.35 },
    { t: L.ignite + 0.15, do: 'music', cue: 'leitmotif' },
    // план 8: из темноты выползает Шелуха, титул «впечатывается», управление возвращается
    { t: L.husk, do: 'call', fn: 'husk' },
    { t: L.husk, do: 'cam', path: [[stand[0] - 2.4, 0.55, stand[2] - 4.6], [x + 1.2, 3.2, z + 7.5]], look: [[stand[0], 1.9, stand[2]], [p.huskX * 0.5 + x * 0.5, 0.6, p.huskZ * 0.5 + z * 0.5]], dur: 1.5, ease: 'inOutSine' },
    { t: L.title, do: 'call', fn: 'title' },
    { t: L.title, do: 'sfx', id: 'title_stamp', gain: 0.9 },
    { t: L.music, do: 'call', fn: 'music' },
    { t: L.end - 0.3, do: 'call', fn: 'idle' },
    { t: L.end, do: 'call', fn: 'end' },
  ];
  return { id: 'prologueLanding', steps, dur: L.end + 0.2, blendOut: 0.9 };
}
