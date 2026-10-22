import * as THREE from 'three';
import { Ease } from '../core/ease';
import { clamp } from '../core/math';
import { CAM_FOV } from '../render/renderer';
import type { StageDef } from '../data/stages';
import { AFFIX_NAMES } from '../data/enemies';
import type { CameraRig } from '../world/camera';
import type { Enemy } from '../world/enemy';
import type { World } from '../world/world';

type BannerColor = 'gold' | 'void' | 'hunger' | 'white' | 'ether' | 'steel';

/** Что режиссёру нужно от боя: мир, летербокс, замедление, баннеры, реплики, музыка. */
export interface CineHost {
  world: World;
  letterbox(v: number): void;
  slow(scale: number, sec: number): void;
  banner(text: string, sub: string | undefined, color: BannerColor, dur: number, size: number): void;
  say(line: string, speaker: 'kaelis' | 'boss'): void;
  flash(v: number): void;
  musicPhase(p: number): void;
  stinger(): void;
  skipRequested(): boolean;
  /** Реплика один раз за сохранение. */
  once(flag: string): boolean;
}

interface Shot {
  id: string;
  t: number;
  dur: number;
  /** Плавный вход/выход веса кинокамеры (с). */
  fadeIn: number;
  fadeOut: number;
  letterbox: boolean;
  lock: boolean;
  skippable: boolean;
  cam: ((u: number, pos: THREE.Vector3, look: THREE.Vector3) => void) | null;
  /** Угол обзора по ходу плана (по умолчанию — игровой). */
  fov?: (u: number) => number | undefined;
  /** События по таймлайну (реальное время от начала плана). */
  cues: { at: number; fn: () => void; done?: boolean }[];
  onEnd?: () => void;
}

const STAGE_INTRO: Record<string, { sub: string; line: string }> = {
  '1-1': { sub: 'Собор встречает незваных', line: 'Пилот, мы внутри. Держись света — и бей первым.' },
  '1-2': { sub: 'Хоры поют о тех, кто не вернулся', line: 'Неф широкий. Не дай им зайти со спины — колонны твои союзники.' },
  '1-3': { sub: 'Порог стережёт тот, кто не спит', line: 'За вратами — Страж. И ямы в полу: сбрасывай туда всё, что шевелится.' },
  '1-4': { sub: 'Тысяча свечей — тысяча молитв', line: 'Колодец в центре бездонный. Тяжёлым ударом — прямо в него.' },
  '1-5': { sub: 'Под ногами — только звёзды', line: 'Мосты узкие. Один удар — и враг летит в бездну. Ты — тоже.' },
  '1-6': { sub: 'Колокол звонит по спасению', line: 'Слышишь звон? Звонарь знает, что мы идём.' },
};

export const GUARDIAN: Record<string, { title: string; intro: string; rage: string; down: string }> = {
  gateGuardian: {
    title: 'Хранитель порога',
    intro: 'Страж Врат. Алебарда длиннее, чем кажется — бей после размаха.',
    rage: 'Он сорвал печати! Удары пойдут сериями — считай до трёх.',
    down: 'Страж пал. Врата открыты.',
  },
  bellRinger: {
    title: 'Глас колокольни',
    intro: 'Звонарь. Каждый удар колокола — волна. Ищи разрывы.',
    rage: 'Колокол треснул — сейчас будет громко!',
    down: 'Звон стих. Дальше — только Иерофант.',
  },
};

const VICTORY = ['Чисто. Дыши, Пилот.', 'Ещё один зал наш.', 'Они кончились раньше, чем твоя ярость.', 'Тишина. Значит, мы победили.'];

/**
 * Режиссёр кинематографичных вставок боя (GDD §19): пролёт камеры над ареной на старте этапа,
 * появление Стража, его ярость и падение, облёт героя после победы, представление элиты.
 * Планы идут в реальном времени, камера смешивается с боевой по весу — без резких склеек.
 */
/** Низкий план на декорацию арены в начале интро (план §8.5): откуда, куда смотрит, куда дрейфует за план, угол обзора. */
export interface StageVista { pos: THREE.Vector3; look: THREE.Vector3; drift: THREE.Vector3; fov?: number }
/** Тайминг интро с декорацией (с): держим план, кран в пролёт (с его доли from), конец. */
export const STAGE_VISTA_T = { hold: 1.5, crane: 2.6, end: 4.7, from: 0.3 };
const _sp = new THREE.Vector3(), _sl = new THREE.Vector3();

export class Cinematics {
  private shot: Shot | null = null;
  private hadCam = false;
  private w = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(private host: CineHost) {}

  get active(): boolean { return !!this.shot; }
  get busy(): string | null { return this.shot?.id ?? null; }

  /** Пролёт над ареной: общий план сверху → снижение к Пилоту. */
  stageIntro(stage: StageDef, arenaCenter: { x: number; z: number }, extent: number, onEnd?: () => void, vista?: StageVista | null): void {
    const info = STAGE_INTRO[stage.id];
    const h = this.host.world.hero;
    const label = `${stage.zone + 1}-${stage.index + 1}`;
    // пролёт: с высоты над ареной (e = 0) к Пилоту (e = 1)
    const sweep = (e: number, pos: THREE.Vector3, look: THREE.Vector3) => {
      const cx = arenaCenter.x + (h.x - arenaCenter.x) * e, cz = arenaCenter.z + (h.z - arenaCenter.z) * e;
      const sw = (1 - e) * 0.5;
      const dist = extent * 1.5 * (1 - e) + 17 * e;
      pos.set(cx + Math.sin(sw) * dist * 0.5, dist * 0.82, cz + Math.cos(sw) * dist * 0.62);
      look.set(cx, 0.6 * e, cz - (1 - e) * 2);
    };
    // своя декорация арены (план §8.5): сначала низкий план на неё, затем кран вверх — в пролёт с его трети
    const V = vista ? STAGE_VISTA_T : null;
    const dur = V ? V.end : 3.1;
    this.play({
      id: 'intro', dur, fadeIn: 0, fadeOut: 0.9, letterbox: true, lock: true, skippable: true,
      cam: (u, pos, look) => {
        if (!V || !vista) { sweep(Ease.inOutSine(u), pos, look); return; }
        const t = u * dur;
        if (t < V.hold) {
          const k = t / V.hold;
          pos.copy(vista.pos).addScaledVector(vista.drift, k);
          look.copy(vista.look);
          return;
        }
        if (t < V.crane) {
          const k = Ease.inOutSine((t - V.hold) / (V.crane - V.hold));
          sweep(Ease.inOutSine(V.from), _sp, _sl);
          pos.copy(vista.pos).add(vista.drift).lerp(_sp, k);
          look.copy(vista.look).lerp(_sl, k);
          return;
        }
        const k = (t - V.crane) / (dur - V.crane);
        sweep(Ease.inOutSine(V.from + (1 - V.from) * k), pos, look);
      },
      fov: (u) => {
        if (!V || !vista?.fov) return undefined;
        const t = u * dur;
        return t < V.hold ? vista.fov : t < V.crane ? vista.fov + (CAM_FOV - vista.fov) * Ease.inOutSine((t - V.hold) / (V.crane - V.hold)) : undefined;
      },
      cues: [
        { at: V ? 0.5 : 0.35, fn: () => this.host.banner(stage.name.toUpperCase(), info ? `${label} · ${info.sub}` : label, 'gold', 2.6, 58) },
        { at: V ? 1.1 : 1.4, fn: () => { if (info && this.host.once(`cine_intro_${stage.id}`)) this.host.say(info.line, 'kaelis'); } },
      ],
      onEnd,
    });
  }

  /** Появление Стража: замедление, низкий ракурс снизу вверх, имя «впечатывается». */
  guardianIntro(e: Enemy): void {
    const g = GUARDIAN[e.kind];
    const h = this.host.world.hero;
    const dx = h.x - e.x, dz = h.z - e.z, d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;
    this.host.slow(0.4, 1.6);
    h.invulnUntil = Math.max(h.invulnUntil, h.clock + 2.2);
    this.play({
      id: 'guardian', dur: 2.6, fadeIn: 0.45, fadeOut: 0.7, letterbox: true, lock: true, skippable: true,
      cam: (u, pos, look) => {
        const a = (u - 0.5) * 0.5;
        const ca = Math.cos(a), sa = Math.sin(a);
        const ox = nx * ca - nz * sa, oz = nz * ca + nx * sa;
        const r = 11.5 - u * 1.5;
        pos.set(e.x + ox * r, 2.6 + u * 0.8, e.z + oz * r);
        look.set(e.x, e.height * 0.62, e.z);
      },
      cues: [
        { at: 0.5, fn: () => this.host.banner(e.def.name.toUpperCase(), g?.title, 'hunger', 2.4, 54) },
        { at: 0.55, fn: () => this.host.world.bus.emit('shake', { trauma: 0.45 }) },
        { at: 1.5, fn: () => { if (g && this.host.once(`cine_g_${e.kind}`)) this.host.say(g.intro, 'kaelis'); } },
      ],
    });
  }

  /** Ярость Стража (50 % HP): наезд камеры, замедление, вторая фаза музыки. overhead — во второй половине взгляд вверх (колокол 1-6). */
  guardianRage(e: Enemy, overhead?: THREE.Vector3 | null): void {
    const g = GUARDIAN[e.kind];
    const h = this.host.world.hero;
    const dx = h.x - e.x, dz = h.z - e.z, d = Math.hypot(dx, dz) || 1;
    this.host.slow(0.3, 0.9);
    this.host.musicPhase(1);
    this.host.stinger();
    this.play({
      id: 'rage', dur: 1.5, fadeIn: 0.25, fadeOut: 0.5, letterbox: true, lock: false, skippable: false,
      cam: (u, pos, look) => {
        // взгляд вверх: камера отходит и чуть поднимается — колокол в профиль, а не раструбом в объектив
        const up = overhead ? Ease.inOutSine(clamp((u - 0.3) / 0.45, 0, 1)) : 0;
        const r = 8 - Ease.outCubic(u) * 2.5 + up * 9;
        pos.set(e.x + (dx / d) * r - (dz / d) * 1.5, 3.2 + up * 2, e.z + (dz / d) * r + (dx / d) * 1.5);
        look.set(e.x, e.height * 0.7, e.z);
        if (overhead) look.lerp(overhead, up);
      },
      fov: overhead ? (u) => CAM_FOV + 16 * Ease.inOutSine(clamp((u - 0.3) / 0.45, 0, 1)) : undefined,
      cues: [
        { at: 0.38, fn: () => this.host.banner('ЯРОСТЬ', e.def.name, 'hunger', 1.6, 46) },
        { at: 0.6, fn: () => { if (g) this.host.say(g.rage, 'kaelis'); } },
      ],
    });
  }

  /** Страж повержен: глубокое замедление, облёт, вспышка. */
  guardianDown(e: Enemy): void {
    const g = GUARDIAN[e.kind];
    const x = e.x, z = e.z, hgt = e.height;
    this.host.slow(0.18, 1.3);
    this.host.flash(0.5);
    this.play({
      id: 'down', dur: 2.3, fadeIn: 0.3, fadeOut: 0.7, letterbox: true, lock: true, skippable: true,
      cam: (u, pos, look) => {
        const a = 0.6 + u * 1.1;
        pos.set(x + Math.sin(a) * 9.5, 3.4 + u * 1.5, z + Math.cos(a) * 9.5);
        look.set(x, hgt * 0.35, z);
      },
      cues: [
        { at: 0.45, fn: () => this.host.banner('СТРАЖ ПОВЕРЖЕН', e.def.name, 'gold', 2.0, 50) },
        { at: 1.1, fn: () => { if (g) this.host.say(g.down, 'kaelis'); } },
      ],
    });
  }

  /** Победа: медленный облёт Пилота в победной стойке. */
  victory(): void {
    // падение Стража доигрывается до конца, облёт — следом
    if (this.shot?.id === 'down') { this.shot.onEnd = () => this.victory(); return; }
    const h = this.host.world.hero;
    const line = VICTORY[(Math.random() * VICTORY.length) | 0];
    this.play({
      id: 'victory', dur: 2.6, fadeIn: 0.6, fadeOut: 0.01, letterbox: true, lock: true, skippable: false,
      cam: (u, pos, look) => {
        const a = -0.5 + Ease.inOutSine(u) * 0.9;
        const r = 7 - u;
        pos.set(h.x + Math.sin(a) * r, 2.4 + u * 0.6, h.z + Math.cos(a) * r);
        look.set(h.x, 1.75, h.z);
      },
      cues: [
        { at: 0.6, fn: () => this.host.banner('ЭТАП ПРОЙДЕН', undefined, 'gold', 2.0, 52) },
        { at: 0.9, fn: () => this.host.say(line, 'kaelis') },
      ],
    });
  }

  /** Элита: короткая заминка и титул (без захвата камеры — бой не прерывается). */
  elite(e: Enemy): void {
    if (this.shot) return;
    this.host.slow(0.55, 0.35);
    // название и аффиксы: игрок сразу знает, чему учит эта элита
    const affixes = e.elite.map((a) => AFFIX_NAMES[a]).join(' · ');
    this.host.banner('ЭЛИТА', affixes ? `${e.def.name} — ${affixes}` : e.def.name, 'hunger', 1.5, 36);
  }

  private play(s: Omit<Shot, 't'>): void {
    this.end(false);
    this.shot = { ...s, t: 0 };
    if (s.letterbox) this.host.letterbox(1);
    if (s.lock) this.host.world.hero.locked = true;
  }

  private end(callEnd = true): void {
    const s = this.shot;
    if (!s) return;
    if (s.letterbox) this.host.letterbox(0);
    if (s.lock) this.host.world.hero.locked = false;
    this.shot = null;
    if (callEnd) s.onEnd?.();
  }

  /** Кадр: таймлайн, вес кинокамеры, пропуск. Вызывать после боевой камеры. */
  update(realDt: number, cam: CameraRig): void {
    const s = this.shot;
    if (s) {
      s.t += realDt;
      for (const c of s.cues) if (!c.done && s.t >= c.at) { c.done = true; c.fn(); }
      if (s.skippable && s.t > 0.5 && this.host.skipRequested() && s.t < s.dur - s.fadeOut) s.t = s.dur - s.fadeOut;
      if (s.t >= s.dur) this.end();
    }
    const cur = this.shot;
    const target = cur?.cam ? 1 : 0;
    if (cur?.cam) {
      const u = clamp(cur.t / cur.dur, 0, 1);
      cur.cam(u, this.pos, this.look);
      const fin = cur.fadeIn > 0 ? clamp(cur.t / cur.fadeIn, 0, 1) : 1;
      const fout = clamp((cur.dur - cur.t) / Math.max(0.01, cur.fadeOut), 0, 1);
      this.w = Ease.inOutSine(Math.min(fin, fout));
    } else {
      this.w += (target - this.w) * Math.min(1, realDt * 6);
    }
    if (this.w > 0.002 && (cur?.cam || this.hadCam)) {
      cam.cine = { pos: this.pos, look: this.look, w: this.w, fov: cur?.fov?.(clamp(cur.t / cur.dur, 0, 1)) };
      this.hadCam = true;
    } else if (this.hadCam) {
      cam.cine = null;
      this.hadCam = false;
    }
  }

  /** Сбросить всё (выход из боя). */
  clear(cam: CameraRig): void {
    this.end(false);
    this.w = 0;
    if (this.hadCam) { cam.cine = null; this.hadCam = false; }
  }
}
