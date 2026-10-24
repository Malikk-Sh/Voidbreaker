import * as THREE from 'three';
import { Ease } from '../core/ease';
import { clamp } from '../core/math';
import { CAM_FOV } from '../render/renderer';
import type { StageDef } from '../data/stages';
import { AFFIX_NAMES } from '../data/enemies';
import { CameraRig } from '../world/camera';
import type { Enemy } from '../world/enemy';
import type { World } from '../world/world';
import { Director, type CineTrack, type DirectorHost, type V3 } from './director';
import { offsetWorld, readProject, resolveScene } from './sceneEdits';

type BannerColor = 'gold' | 'void' | 'hunger' | 'white' | 'ether' | 'steel';

/** Что режиссёру нужно от боя: мир, летербокс, замедление, баннеры, реплики, музыка. */
export interface CineHost {
  world: World;
  sceneHost?(): DirectorHost;
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
  /** Скрыть HUD на время плана, который забирает управление (титры и реплики остаются). */
  hud?(visible: boolean): void;
}

interface Shot {
  id: string;
  editorId?: string;
  roll?: number;
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
  '1-7': { sub: 'Сад, где больше ничего не растёт', line: 'Клуатр. На месте сада — провал: сбрасывай их туда.' },
  '1-8': { sub: 'Здесь спят те, кто молился первым', line: 'Крипта. Коридоры узкие — не дай зажать себя с двух сторон.' },
  '1-9': { sub: 'Хор запоминает твои шаги', line: 'Уведи метки Хора во врагов. Рывок в такт вернёт псалом певцу.' },
};

/**
 * Угол обзора планов Стража (°): игровой (30°) для 4–5-метрового Стража с 9–11 м — телевик, шлем уходит за
 * летербокс. Шире — Страж в кадре целиком.
 */
export const GUARD_FOV = { intro: 46, rage: 42, down: 42, victory: 40 };

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
  /** Каталог редактора снимает исходную постановку без локальных правок. */
  studio = false;
  private motionDirector: Director | null = null;
  private motionCam = new CameraRig();
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
      id: 'intro', editorId: `arenaIntro:${stage.id}`, dur, fadeIn: 0, fadeOut: 0.9, letterbox: true, lock: true, skippable: true,
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
      id: 'guardian', editorId: `guardianIntro:${e.kind}`, dur: 2.6, fadeIn: 0.45, fadeOut: 0.7, letterbox: true, lock: true, skippable: true,
      cam: (u, pos, look) => {
        const a = (u - 0.5) * 0.5;
        const ca = Math.cos(a), sa = Math.sin(a);
        const ox = nx * ca - nz * sa, oz = nz * ca + nx * sa;
        // снизу вверх и шире игрового угла: Страж в кадре целиком, со шлемом
        const r = 11 - u * 1.5;
        pos.set(e.x + ox * r, 1.3 + u * 0.6, e.z + oz * r);
        look.set(e.x, e.height * 0.55, e.z);
      },
      fov: () => GUARD_FOV.intro,
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
      id: 'rage', editorId: `guardianRage:${e.kind}`, dur: 1.5, fadeIn: 0.25, fadeOut: 0.5, letterbox: true, lock: false, skippable: false,
      cam: (u, pos, look) => {
        // взгляд вверх: камера отходит и чуть поднимается — колокол в профиль, а не раструбом в объектив
        const up = overhead ? Ease.inOutSine(clamp((u - 0.3) / 0.45, 0, 1)) : 0;
        // наезд до 6.5 м: шлем и грудь в кадре, а не одна грудь во весь экран
        const r = 9 - Ease.outCubic(u) * 2.5 + up * 9;
        pos.set(e.x + (dx / d) * r - (dz / d) * 1.5, 3.2 + up * 2, e.z + (dz / d) * r + (dx / d) * 1.5);
        look.set(e.x, e.height * 0.78, e.z);
        if (overhead) look.lerp(overhead, up);
      },
      fov: (u) => GUARD_FOV.rage + (overhead ? 16 * Ease.inOutSine(clamp((u - 0.3) / 0.45, 0, 1)) : 0),
      cues: [
        { at: 0.38, fn: () => this.host.banner('ЯРОСТЬ', e.def.name, 'hunger', 1.6, 46) },
        { at: 0.6, fn: () => { if (g) this.host.say(g.rage, 'kaelis'); } },
      ],
    });
  }

  /** Страж повержен без отдельной казни: распад и выдержанный финальный план. */
  guardianDown(e: Enemy): void {
    const g = GUARDIAN[e.kind];
    const x = e.x, z = e.z, hgt = e.height;
    this.host.slow(0.18, 1.3);
    this.host.flash(0.5);
    this.play({
      id: 'down', editorId: `guardianDown:${e.kind}`, dur: 3.4, fadeIn: 0.3, fadeOut: 0.7, letterbox: true, lock: true, skippable: true,
      cam: (u, pos, look) => {
        const a = 0.6 + u * 1.1;
        pos.set(x + Math.sin(a) * 9.5, 3.4 + u * 1.5, z + Math.cos(a) * 9.5);
        look.set(x, hgt * 0.35, z);
      },
      fov: () => GUARD_FOV.down,
      cues: [
        { at: 0.45, fn: () => this.host.banner('СТРАЖ ПОВЕРЖЕН', e.def.name, 'gold', 2.0, 50) },
        { at: 1.1, fn: () => { if (g) this.host.say(g.down, 'kaelis'); } },
      ],
    });
  }

  /** Победа: медленный облёт Пилота в победной стойке. */
  victory(): void {
    // У победы над Стражем уже есть заключительный план — второй облёт отвлекал от распада.
    if (this.shot?.id === 'down') return;
    const h = this.host.world.hero;
    const line = VICTORY[(Math.random() * VICTORY.length) | 0];
    this.play({
      id: 'victory', editorId: 'arenaVictory', dur: 2.6, fadeIn: 0.6, fadeOut: 0.01, letterbox: true, lock: true, skippable: false,
      cam: (u, pos, look) => {
        const a = -0.5 + Ease.inOutSine(u) * 0.9;
        const r = 7 - u;
        pos.set(h.x + Math.sin(a) * r, 2.4 + u * 0.6, h.z + Math.cos(a) * r);
        look.set(h.x, 1.75, h.z);
      },
      fov: () => GUARD_FOV.victory,
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
    if (!this.studio) this.applyStudio();
    if (s.letterbox) this.host.letterbox(1);
    if (s.lock) { this.host.world.hero.locked = true; this.host.hud?.(false); }
  }

  private end(callEnd = true): void {
    const s = this.shot;
    if (!s) return;
    if (s.letterbox) this.host.letterbox(0);
    if (s.lock) { this.host.world.hero.locked = false; this.host.hud?.(true); }
    this.shot = null;
    // Движения и позы редактора отпускаются вместе с вставкой.
    this.motionDirector?.clear(this.motionCam);
    this.motionDirector = null;
    if (callEnd) s.onEnd?.();
  }

  /** Кадр: таймлайн, вес кинокамеры, пропуск. Вызывать после боевой камеры. */
  update(realDt: number, cam: CameraRig): void {
    this.motionDirector?.update(realDt, this.motionCam);
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
      cam.cine = { pos: this.pos, look: this.look, w: this.w, fov: cur?.fov?.(clamp(cur.t / cur.dur, 0, 1)), roll: cur?.roll };
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

  /** Исходный план для каталога: позиции камеры сняты по равным долям времени. */
  describe(): CineTrack | null {
    const s = this.shot; if (!s?.cam) return null;
    const path: V3[] = [], look: V3[] = [], p = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i <= 24; i++) { s.cam(i / 24, p, q); path.push([p.x, p.y, p.z]); look.push([q.x, q.y, q.z]); }
    const h = this.host.world.hero;
    return { id: s.editorId ?? `battle:${s.id}`, origin: [h.x, 0, h.z], heading: h.facing, dur: s.dur,
      steps: [{ t: 0, do: 'cam', path, look, dur: s.dur, ease: 'linear', fov: s.fov?.(0) ?? CAM_FOV }] };
  }

  private applyStudio(): void {
    const source = this.describe(), s = this.shot, project = readProject();
    if (!source || !s || !project.enabled) return;
    const edit = project.scenes[source.id]?.full; if (!edit) return;
    const d = edit.steps['cam:0'], original = s.cam!, rate = edit.rate ?? 1;
    const oldDur = s.dur, newDur = Math.max(0.01, d?.dur ?? oldDur), delay = d?.t ?? 0;
    s.dur = (delay + newDur) / rate; s.fadeIn /= rate; s.fadeOut /= rate;
    s.cues = s.cues.map((c) => ({ ...c, at: (delay + c.at * newDur / oldDur) / rate }));
    const offsets = (arr: V3[] | undefined) => arr?.length ? arr.map((v) => offsetWorld(v, source.heading)) : [[0, 0, 0] as V3];
    const p = offsets(d?.pathOffsets), q = offsets(d?.lookOffsets), delta = new THREE.Vector3();
    s.cam = (u, pos, look) => {
      const progress = clamp((u * s.dur * rate - delay) / newDur, 0, 1), k = d?.ease ? Ease[d.ease](progress) : progress;
      original(k, pos, look); if (d?.pathOffsets) pos.add(Director.sample(p, k, delta)); if (d?.lookOffsets) look.add(Director.sample(q, k, delta));
    };
    if (d?.fov !== undefined) s.fov = () => d.fov;
    s.roll = d?.roll;
    const host = this.host.sceneHost?.();
    if (host && (edit.added?.length || Object.keys(edit.placements ?? {}).length)) {
      const track = resolveScene(source, project, 'full'); track.steps = track.steps.filter((step) => step.do !== 'cam');
      this.motionDirector = new Director({ ...host, markSeen: () => {}, overlay: () => {} }); this.motionDirector.studio = true; this.motionDirector.play(track);
    }
  }
}
