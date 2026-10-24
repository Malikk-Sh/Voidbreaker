import * as THREE from 'three';
import { Ease, type EaseId } from '../core/ease';
import { clamp } from '../core/math';
import type { CameraRig } from '../world/camera';

export type V3 = [number, number, number];
export type BannerColor = 'gold' | 'void' | 'hunger' | 'white' | 'ether' | 'steel';
export type SkyParam = 'starLit' | 'eclipse' | 'crack' | 'star2';
export type MusicCue = 'silence' | 'stinger' | 'leitmotif' | 'major' | 'resolve';

/**
 * Шаг дорожки (план §8.1) — тот же язык, что у паттернов боссов: время от начала сцены и действие.
 * Камера — сплайн Катмулла–Рома по точкам позиции и взгляда.
 */
export type CineStep =
  /** moon — план «на фоне луны»: на время плана диск луны в небе стоит за этой точкой с начала плана (киноприём). */
  | { t: number; do: 'cam'; path: V3[]; look: V3[]; dur: number; ease?: EaseId; fov?: number; roll?: number; moon?: V3 }
  /** turn — разворот к lookAt за столько секунд (без него — сразу). */
  | { t: number; do: 'actor'; who: string; clip?: string; moveTo?: V3; dur?: number; lookAt?: V3; ease?: EaseId; turn?: number }
  /**
   * Абсолютное время позы и маркеры клипа; движение корня задаётся отдельным actor. blend — смешивание
   * с предыдущей позой при входе (с сцены; по умолчанию SCENE_BLEND, 0 — склейка).
   */
  | { t: number; do: 'clip'; who: string; clip: string; speed?: number; dur?: number; blend?: number; markers?: Record<string, string> }
  | { t: number; do: 'crack' | 'dissolve'; who: string; to: number; dur?: number }
  | { t: number; do: 'shatter'; who: string; dir?: V3; power?: number }
  | { t: number; do: 'time'; scale: number; dur: number }
  | { t: number; do: 'sky'; param: SkyParam; to: number; dur: number }
  | { t: number; do: 'music'; cue: MusicCue }
  | { t: number; do: 'sfx'; id: string; gain?: number }
  | { t: number; do: 'say'; line: string; speaker?: 'kaelis' | 'boss' }
  | { t: number; do: 'banner'; text: string; sub?: string; color?: BannerColor; dur?: number; size?: number }
  | { t: number; do: 'flash'; v: number }
  | { t: number; do: 'letterbox'; v: number }
  /** Логика сцены (спаун, смена арены): выполняется и при пропуске. */
  | { t: number; do: 'call'; fn: string; arg?: number }
  /** Необязательное касание-тайминг: атака в окне dur — флаг onHit. */
  | { t: number; do: 'tap'; dur: number; onHit: string }
  /**
   * Необязательное действие игрока (план §4.3, ТЗ §14): время сцены стоит на t, пока игрок не коснётся экрана
   * или не нажмёт атаку; при автопродолжении (настройка) сцена идёт сама через auto с. Без наказания за тайминг;
   * удержание атаки по-прежнему пропускает сцену. Шаги с тем же t начинаются после ответа. prompt — подсказка.
   */
  | { t: number; do: 'wait'; prompt: string; auto?: number };

export interface CineTrack {
  id: string;
  steps: CineStep[];
  /** Укороченная версия — играет, если сцену уже видели дважды. */
  short?: CineStep[];
  /** Длительность (иначе — конец последнего шага + 0.3 с). */
  dur?: number;
  skippable?: boolean;
  /** Камера возвращается к бою плавно (с). */
  blendOut?: number;
}

/** Актёр сцены: позиция, разворот и (если есть) марионетка для трещин и растворения. */
export interface DirectorActor { x: number; z: number; y?: number; facing: number; puppet?: { crack: number; dissolve: number } }

/** Что режиссёру нужно от игры. Всё необязательное, кроме актёров и ввода, — сцена работает и без звука. */
export interface DirectorHost {
  actor(who: string): DirectorActor | null;
  playClip?(who: string, clip: string): void;
  clipEvents?(who: string, clip: string): readonly { t: number; name: string }[];
  clipDuration?(who: string, clip: string): number;
  sampleClip?(who: string, clip: string, time: number, reset: boolean, blend?: number): void;
  releaseClip?(who: string): void;
  shatter?(who: string, dirX: number, dirZ: number, power: number): void;
  timeScale?(scale: number, dur: number): void;
  sky?(param: SkyParam, value: number): void;
  /** Диск луны в небе — в направлении dir (план «на фоне луны»); null — вернуть прежнее положение. */
  moonBehind?(dir: V3 | null): void;
  skyValue?(param: SkyParam): number;
  music?(cue: MusicCue): void;
  sfx?(id: string, gain: number): void;
  say?(line: string, speaker: 'kaelis' | 'boss'): void;
  banner?(text: string, sub: string | undefined, color: BannerColor, dur: number, size: number): void;
  flash?(v: number): void;
  letterbox?(v: number): void;
  call?(fn: string, arg?: number): void;
  /** Атака удерживается (пропуск). */
  holding(): boolean;
  /** Касание экрана или атака в этом кадре (касание-тайминг, ожидание действия). */
  tapped(): boolean;
  /** Сцены идут без нажатий: шаги ожидания продолжаются сами (настройка). */
  autoContinue?(): boolean;
  seen(id: string): number;
  markSeen(id: string): void;
  /** Индикаторы поверх кадра: заполнение пропуска 0..1, кольцо касания, подсказка ожидаемого действия (t — сколько ждёт, с). */
  overlay?(skip: number, tap: { k: number; hit: boolean } | null, prompt?: { text: string; t: number } | null): void;
}

/** Сколько держать атаку для пропуска (с). */
export const SKIP_HOLD = 0.6;
/** Смешивание позы при смене сценического клипа (с сцены): 7 кадров — без скачка, но и без «плавания». */
export const SCENE_BLEND = 0.12;
/** Автопродолжение ожидания (с): короткий план места действия успевает прочитаться. */
export const WAIT_AUTO = 0.6;
/** Ожидание держит время сцены чуть раньше своего t: шаги с тем же t начинаются только после ответа. */
const WAIT_EPS = 1e-6;
/** Пропуск доступен не раньше (с): случайное удержание с прошлой сцены не съедает новую. */
const SKIP_FROM = 0.4;

interface Live { s: CineStep; started: boolean; done: boolean; until?: number; from?: number; fromX?: number; fromZ?: number; fromY?: number; fromF?: number; curve?: THREE.CatmullRomCurve3; lookCurve?: THREE.CatmullRomCurve3 }
interface SceneMarker { t: number; fn: string; source: Live; done: boolean }

const _p = new THREE.Vector3();

function curveOf(pts: V3[]): THREE.CatmullRomCurve3 {
  const v = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  if (v.length === 1) v.push(v[0].clone());
  return new THREE.CatmullRomCurve3(v, false, 'catmullrom', 0.5);
}

function stepEnd(s: CineStep): number {
  return s.t + ('dur' in s && typeof s.dur === 'number' ? s.dur : 0);
}

/**
 * Режиссёр дорожек (план §8.1): проигрывает сцену шагами в реальном времени — камера по сплайну, актёры,
 * трещины, время, небо, музыка, реплики, касание-тайминг. Пропуск — удержанием атаки: логика сцены и
 * конечные позиции применяются сразу. Сцену, увиденную дважды, играет укороченной (если она есть).
 */
export class Director {
  private track: CineTrack | null = null;
  private live: Live[] = [];
  private markers: SceneMarker[] = [];
  private readonly bindings = new Set<string>();
  private t = 0;
  private dur = 0;
  private hold = 0;
  private w = 0;
  private hadCam = false;
  private blendOut = 0.4;
  private onEnd: ((skipped: boolean) => void) | null = null;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private fov: number | undefined;
  private roll = 0;
  private tap: { from: number; to: number; id: string; hit: boolean } | null = null;
  /** Сколько (реальных с) сцена стоит у текущего шага ожидания. */
  private waitT = 0;
  /** Луна переставлена планом «на фоне луны» — вернуть её следующим планом или концом сцены. */
  private moonMoved = false;
  /** Флаги касаний, попавших в окно. */
  readonly hits = new Set<string>();
  /** Сцена играет укороченной. */
  short = false;
  /** Всегда полная версия (пересмотр в Кинозале). */
  full = false;

  constructor(private host: DirectorHost) {}

  get active(): boolean { return !!this.track; }
  get id(): string | null { return this.track?.id ?? null; }
  get time(): number { return this.t; }
  /** Сцена стоит у шага ожидания и ждёт действия игрока. */
  get waiting(): boolean { return !!this.pendingWait() && this.waitT > 0; }

  private pendingWait(target = this.t): Live | null {
    return this.live.find((l) => l.s.do === 'wait' && !l.done && l.s.t <= target + WAIT_EPS) ?? null;
  }

  play(track: CineTrack, onEnd?: (skipped: boolean) => void): void {
    if (this.track) this.finish(false);
    this.short = !this.full && !!track.short && this.host.seen(track.id) >= 2;
    const steps = (this.short ? track.short! : track.steps).slice().sort((a, b) => a.t - b.t);
    this.track = track;
    this.live = steps.map((s) => ({ s, started: false, done: false }));
    this.t = 0; this.hold = 0; this.waitT = 0;
    this.dur = track.dur ?? Math.max(0, ...steps.map(stepEnd)) + 0.3;
    if (this.short && track.dur) this.dur = Math.max(0, ...steps.map(stepEnd)) + 0.3;
    // Длина позы берётся из клипа, когда дорожка не задаёт собственный конец.
    if (!track.dur || this.short) for (const s of steps) if (s.do === 'clip') {
      this.dur = Math.max(this.dur, s.t + (s.dur ?? (this.host.clipDuration?.(s.who, s.clip) ?? 0) / (s.speed ?? 1)) + 0.3);
    }
    this.markers = [];
    for (let i = 0; i < this.live.length; i++) {
      const l = this.live[i], s = l.s;
      if (s.do !== 'clip') continue;
      const next = this.live.slice(i + 1).find((x) => x.s.do === 'clip' && x.s.who === s.who);
      l.until = Math.min(next?.s.t ?? this.dur, s.dur === undefined ? this.dur : s.t + s.dur);
      for (const e of this.host.clipEvents?.(s.who, s.clip) ?? []) {
        const fn = s.markers?.[e.name], t = s.t + e.t / (s.speed ?? 1);
        if (fn && t <= l.until + 1e-8) this.markers.push({ t, fn, source: l, done: false });
      }
    }
    this.markers.sort((a, b) => a.t - b.t);
    this.blendOut = track.blendOut ?? 0.4;
    this.hits.clear();
    this.tap = null;
    this.onEnd = onEnd ?? null;
  }

  /** Кадр: шаги, пропуск, камера. realDt — реальное время (сцена не зависит от замедления мира). */
  update(realDt: number, cam: CameraRig): void {
    const tr = this.track;
    if (tr) {
      let target = this.t + realDt;
      // необязательное действие: время сцены стоит у шага ожидания, пока игрок не ответит
      const wait = this.pendingWait(target);
      let prompt: { text: string; t: number } | null = null;
      if (wait && wait.s.do === 'wait') {
        if (this.t < wait.s.t - WAIT_EPS * 2) target = wait.s.t - WAIT_EPS;
        else {
          this.waitT += realDt;
          if (this.host.tapped() || (this.host.autoContinue?.() && this.waitT >= (wait.s.auto ?? WAIT_AUTO))) {
            wait.done = true; wait.started = true; this.waitT = 0; target = wait.s.t;
          } else { target = this.t; prompt = { text: wait.s.prompt, t: this.waitT }; }
        }
      }
      // пропуск удержанием атаки
      if (tr.skippable !== false && target > SKIP_FROM && this.host.holding()) this.hold += realDt;
      else this.hold = Math.max(0, this.hold - realDt * 2);
      if (this.hold >= SKIP_HOLD) { this.skip(); return this.applyCam(realDt, cam); }
      // Пересечённый маркер сначала получает точную позу и корень этого момента.
      // Даже большой dt не теряет контакт перед следующей привязкой того же актёра.
      for (const m of this.markers) if (!m.done && m.t <= target + 1e-8) {
        this.advance(m.t);
        if (this.track !== tr) return this.applyCam(realDt, cam);
        this.samplePose(m.source, m.t);
        this.updateTap();
        m.done = true;
        this.host.call?.(m.fn);
        if (this.track !== tr) return this.applyCam(realDt, cam);
      }
      this.advance(target);
      if (this.track !== tr) return this.applyCam(realDt, cam);
      this.updateTap();
      this.host.overlay?.(tr.skippable === false ? 0 : this.hold / SKIP_HOLD, this.tap ? { k: clamp((this.t - this.tap.from) / Math.max(0.01, this.tap.to - this.tap.from), 0, 1), hit: this.tap.hit } : null, prompt);
      if (this.t >= this.dur) this.finish(false);
    }
    this.applyCam(realDt, cam);
  }

  private updateTap(): void {
    if (!this.tap) return;
    if (!this.tap.hit && this.t >= this.tap.from && this.t <= this.tap.to && this.host.tapped()) { this.tap.hit = true; this.hits.add(this.tap.id); }
    if (this.t > this.tap.to + 0.25) this.tap = null;
  }

  private advance(time: number): void {
    const track = this.track;
    this.t = time;
    for (const l of this.live) {
      if (l.s.do !== 'clip') this.run(l, false);
      if (this.track !== track) return;
    }
    for (const l of this.live) if (l.s.do === 'clip' && !l.done && time >= l.s.t) {
      this.samplePose(l, Math.min(time, l.until!));
      if (time >= l.until!) l.done = true;
    }
  }

  private samplePose(l: Live, time: number): void {
    const s = l.s;
    if (s.do !== 'clip') return;
    const reset = !l.started;
    l.started = true;
    this.bindings.add(s.who);
    this.host.sampleClip?.(s.who, s.clip, Math.max(0, time - s.t) * (s.speed ?? 1), reset, s.blend ?? SCENE_BLEND);
  }

  /** Выполнить шаг (или довести до конца: fast — пропуск). */
  private run(l: Live, fast: boolean): void {
    if (l.done) return;
    const s = l.s, h = this.host;
    if (!fast && this.t < s.t) return;
    const u = fast ? 1 : clamp(('dur' in s && typeof s.dur === 'number' && s.dur > 0) ? (this.t - s.t) / s.dur : 1, 0, 1);
    const start = !l.started;
    l.started = true;
    switch (s.do) {
      case 'cam': {
        if (fast) { l.done = true; return; }
        if (start) {
          l.curve = curveOf(s.path); l.lookCurve = curveOf(s.look);
          // план на фоне луны: диск — по направлению взгляда в начале плана; любой следующий план возвращает его
          if (s.moon) {
            const p = s.path[0], q = s.moon;
            h.moonBehind?.([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
            this.moonMoved = true;
          } else this.restoreMoon();
        }
        // последняя начавшаяся камера ведёт кадр
        const e = Ease[s.ease ?? 'inOutSine'](u);
        l.curve!.getPoint(e, this.pos);
        l.lookCurve!.getPoint(e, this.look);
        this.fov = s.fov; this.roll = s.roll ?? 0;
        if (u >= 1 && this.live.some((o) => o !== l && o.s.do === 'cam' && o.s.t > s.t && this.t >= o.s.t)) l.done = true;
        return;
      }
      case 'actor': {
        const a = h.actor(s.who);
        if (start && s.clip && !fast) {
          // позой актёра, пока идёт его сценический клип, владеет клип: боевой клип шага актёра молча стёр бы её
          // на кадр (Animator.play снимает сценическое управление). Клипы актёра кончились — сначала освободить его.
          if (!this.live.some((o) => o.s.do === 'clip' && o.s.who === s.who && o.started && !o.done)) {
            if (this.bindings.delete(s.who)) h.releaseClip?.(s.who);
            h.playClip?.(s.who, s.clip);
          }
        }
        if (!a) { l.done = true; return; }
        if (start) { l.fromX = a.x; l.fromZ = a.z; l.fromY = a.y ?? 0; l.fromF = a.facing; }
        const e = Ease[s.ease ?? 'inOutQuad'](u);
        if (s.moveTo) {
          a.x = l.fromX! + (s.moveTo[0] - l.fromX!) * e;
          a.z = l.fromZ! + (s.moveTo[2] - l.fromZ!) * e;
          if (a.y !== undefined) a.y = l.fromY! + (s.moveTo[1] - l.fromY!) * e;
        }
        let turned = 1;
        if (s.lookAt) {
          const to = Math.atan2(s.lookAt[0] - a.x, s.lookAt[2] - a.z);
          turned = fast || !s.turn ? 1 : clamp((this.t - s.t) / s.turn, 0, 1);
          // кратчайшим путём от разворота на старте шага
          const d = Math.atan2(Math.sin(to - l.fromF!), Math.cos(to - l.fromF!));
          a.facing = turned >= 1 ? to : l.fromF! + d * Ease.outCubic(turned);
        }
        if (u >= 1 && turned >= 1) l.done = true;
        return;
      }
      case 'crack': case 'dissolve': {
        const p = h.actor(s.who)?.puppet;
        if (!p) { l.done = true; return; }
        if (start) l.from = s.do === 'crack' ? p.crack : p.dissolve;
        const v = l.from! + (s.to - l.from!) * u;
        if (s.do === 'crack') p.crack = v; else p.dissolve = v;
        if (u >= 1) l.done = true;
        return;
      }
      case 'sky': {
        if (start) l.from = h.skyValue?.(s.param) ?? 0;
        h.sky?.(s.param, l.from! + (s.to - l.from!) * u);
        if (u >= 1) l.done = true;
        return;
      }
      case 'shatter': {
        const d = s.dir ?? [0, 0, 1];
        h.shatter?.(s.who, d[0], d[2], s.power ?? 4);
        break;
      }
      case 'call': h.call?.(s.fn, s.arg); break;
      // ниже — только подача: при пропуске не нужна
      case 'time': if (!fast) h.timeScale?.(s.scale, s.dur); break;
      case 'music': if (!fast) h.music?.(s.cue); break;
      case 'sfx': if (!fast) h.sfx?.(s.id, s.gain ?? 1); break;
      case 'say': if (!fast) h.say?.(s.line, s.speaker ?? 'kaelis'); break;
      case 'banner': if (!fast) h.banner?.(s.text, s.sub, s.color ?? 'gold', s.dur ?? 2.4, s.size ?? 56); break;
      case 'flash': if (!fast) h.flash?.(s.v); break;
      case 'letterbox': h.letterbox?.(fast ? 0 : s.v); break;
      case 'tap': if (!fast) this.tap = { from: s.t, to: s.t + s.dur, id: s.onHit, hit: false }; break;
      // ожидание решается в update (или пропуском): здесь — только отметка пройденного шага
      case 'wait': break;
    }
    l.done = true;
  }

  /** Пропуск: логика сцены и конечные состояния — сразу, подача — нет. */
  skip(): void {
    const track = this.track;
    if (!track) return;
    const remaining = [
      ...this.live.filter((l) => !l.done).map((l) => ({ t: l.s.t, live: l, marker: null as SceneMarker | null })),
      ...this.markers.filter((m) => !m.done).map((m) => ({ t: m.t, live: null as Live | null, marker: m })),
    ].sort((a, b) => a.t - b.t);
    for (const item of remaining) {
      if (item.marker) {
        const m = item.marker;
        this.samplePose(m.source, m.t); m.done = true;
        this.host.call?.(m.fn);
      } else if (item.live) {
        const l = item.live;
        if (l.s.do === 'clip') { this.samplePose(l, l.until!); l.done = true; }
        else this.run(l, true);
      }
      if (this.track !== track) return;
    }
    this.finish(true);
  }

  private restoreMoon(): void {
    if (!this.moonMoved) return;
    this.moonMoved = false;
    this.host.moonBehind?.(null);
  }

  private releaseClips(): void {
    for (const who of this.bindings) this.host.releaseClip?.(who);
    this.bindings.clear();
  }

  private finish(skipped: boolean): void {
    const tr = this.track;
    if (!tr) return;
    this.track = null;
    this.live = [];
    this.markers = [];
    this.releaseClips();
    this.restoreMoon();
    this.tap = null; this.waitT = 0;
    this.host.letterbox?.(0);
    this.host.overlay?.(0, null);
    this.host.markSeen(tr.id);
    const cb = this.onEnd; this.onEnd = null;
    cb?.(skipped);
  }

  private applyCam(realDt: number, cam: CameraRig): void {
    const camOn = !!this.track && this.live.some((l) => l.s.do === 'cam' && l.started);
    const target = camOn ? 1 : 0;
    const k = target ? 1 - Math.exp(-realDt / 0.12) : realDt / Math.max(0.01, this.blendOut);
    this.w = target ? this.w + (1 - this.w) * k : Math.max(0, this.w - k);
    if (this.w > 0.002) {
      cam.cine = { pos: this.pos, look: this.look, w: this.w, fov: this.fov, roll: this.roll };
      this.hadCam = true;
    } else if (this.hadCam) {
      cam.cine = null;
      this.hadCam = false;
    }
  }

  /** Точка на сплайне камеры (тесты, предпросмотр). */
  static sample(path: V3[], u: number, out = _p): THREE.Vector3 { return curveOf(path).getPoint(u, out); }

  clear(cam: CameraRig): void {
    this.track = null; this.live = []; this.markers = []; this.releaseClips(); this.restoreMoon(); this.w = 0; this.tap = null; this.waitT = 0; this.onEnd = null;
    if (this.hadCam) { cam.cine = null; this.hadCam = false; }
  }
}
