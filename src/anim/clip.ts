import * as THREE from 'three';
import { Ease, type EaseId } from '../core/ease';
import type { RigLayout, V3 } from './skeleton';
import { gripWeight, TwoHandGrip, type TwoHandWindow } from './twoHandGrip';

/** Ключевая поза: углы суставов (Эйлер, рад), эйзинг сегмента, смещение корня, растяжение (Tech §8.1). */
export interface Key {
  t: number;
  pose: Record<string, V3>;
  ease?: EaseId;
  rootOffset?: V3;
  stretch?: number;
  /** Доп. поворот корпуса целиком вокруг Y (вращение, развороты). */
  spin?: number;
}
export interface ClipEvent { t: number; name: string }
export interface ClipDef {
  id: string;
  dur: number;
  mask?: 'upper' | 'full';
  loop?: boolean;
  keys: Key[];
  events?: ClipEvent[];
  /**
   * Сдвиг времени суставов (с): >0 — отстаёт, <0 — ведёт. Удар «хлыстом» (разбор): таз ведёт, плечо, локоть
   * и клинок догоняют — вес и захлёст без новых ключей.
   */
  lag?: Record<string, number>;
  /** Окно двуручного хвата: нижняя кисть решается по реальной рукояти после выборки позы. */
  twoHanded?: TwoHandWindow;
}

/** Скомпилированный клип: полные кватернионы суставов клипа на каждом ключе. */
export class Clip {
  readonly id: string;
  readonly dur: number;
  readonly mask: 'upper' | 'full';
  readonly loop: boolean;
  readonly joints: number[];
  readonly times: number[];
  readonly eases: ((t: number) => number)[];
  readonly quats: Float32Array[];   // на ключ: joints.length * 4
  readonly roots: V3[];
  readonly stretch: number[];
  readonly spin: number[];
  readonly events: ClipEvent[];
  /** Сдвиг времени по суставам клипа (null — без сдвигов). */
  readonly lags: Float32Array | null;
  private si = 0; private su = 0;
  private readonly twoHanded?: TwoHandWindow;
  private readonly grip?: TwoHandGrip;

  constructor(def: ClipDef, layout: RigLayout) {
    this.id = def.id;
    this.dur = def.dur;
    this.mask = def.mask ?? 'upper';
    this.loop = !!def.loop;
    this.twoHanded = def.twoHanded;
    if (def.twoHanded && layout.has('blade') && layout.has('handL')) this.grip = new TwoHandGrip(layout);
    this.events = (def.events ?? []).slice().sort((a, b) => a.t - b.t);
    const names = new Set<string>();
    for (const k of def.keys) for (const n of Object.keys(k.pose)) if (layout.has(n)) names.add(n);
    this.joints = [...names].map((n) => layout.idx(n));
    const lag = def.lag;
    this.lags = lag ? Float32Array.from([...names].map((n) => lag[n] ?? 0)) : null;
    this.times = def.keys.map((k) => k.t);
    this.eases = def.keys.map((k) => Ease[k.ease ?? 'inOutQuad']);
    const last: Record<string, V3> = {};
    // первый ключ: незаданные суставы берут значение из первого ключа, где они встречаются
    for (const n of names) {
      const k = def.keys.find((kk) => kk.pose[n]);
      last[n] = k ? k.pose[n] : [0, 0, 0];
    }
    const e = new THREE.Euler(), q = new THREE.Quaternion(), rq = new THREE.Quaternion();
    let lastRoot: V3 = [0, 0, 0], lastStretch = 1, lastSpin = 0;
    this.quats = []; this.roots = []; this.stretch = []; this.spin = [];
    for (const k of def.keys) {
      const arr = new Float32Array(this.joints.length * 4);
      [...names].forEach((n, i) => {
        if (k.pose[n]) last[n] = k.pose[n];
        const ji = layout.idx(n);
        rq.fromArray(layout.restRot, ji * 4);
        q.setFromEuler(e.set(last[n][0], last[n][1], last[n][2]));
        q.premultiply(rq);
        arr.set([q.x, q.y, q.z, q.w], i * 4);
      });
      this.quats.push(arr);
      if (k.rootOffset) lastRoot = k.rootOffset;
      if (k.stretch !== undefined) lastStretch = k.stretch;
      if (k.spin !== undefined) lastSpin = k.spin;
      this.roots.push(lastRoot);
      this.stretch.push(lastStretch);
      this.spin.push(lastSpin);
    }
  }

  /** Сегмент и локальный прогресс (с эйзингом) в момент t → this.si, this.su (без выделений памяти). */
  private seg(t: number): void {
    const T = this.times;
    if (t <= T[0]) { this.si = 0; this.su = 0; return; }
    for (let i = 0; i < T.length - 1; i++) {
      if (t < T[i + 1]) {
        const u = (t - T[i]) / Math.max(1e-5, T[i + 1] - T[i]);
        this.si = i; this.su = this.eases[i + 1](u);
        return;
      }
    }
    this.si = T.length - 2; this.su = 1;
  }

  /** Записать позу клипа в массив кватернионов (rig layout); возвращает корневые параметры. */
  sample(t: number, out: Float32Array, root: { x: number; y: number; z: number; stretch: number; spin: number }): void {
    if (this.times.length === 1) {
      const a = this.quats[0];
      for (let j = 0; j < this.joints.length; j++) out.set(a.subarray(j * 4, j * 4 + 4), this.joints[j] * 4);
      const r = this.roots[0];
      root.x = r[0]; root.y = r[1]; root.z = r[2]; root.stretch = this.stretch[0]; root.spin = this.spin[0];
      this.constrain(out, t);
      return;
    }
    const lags = this.lags;
    for (let j = 0; j < this.joints.length; j++) {
      // свой момент у сустава (хлыст), иначе общий
      if (lags || j === 0) this.seg(lags ? Math.min(this.dur, Math.max(0, t - lags[j])) : t);
      const a = this.quats[this.si], b = this.quats[this.si + 1];
      _qa.fromArray(a, j * 4); _qb.fromArray(b, j * 4);
      _qa.slerp(_qb, this.su);
      const o = this.joints[j] * 4;
      out[o] = _qa.x; out[o + 1] = _qa.y; out[o + 2] = _qa.z; out[o + 3] = _qa.w;
    }
    this.seg(t);
    const i = this.si, u = this.su;
    const ra = this.roots[i], rb = this.roots[i + 1];
    root.x = ra[0] + (rb[0] - ra[0]) * u;
    root.y = ra[1] + (rb[1] - ra[1]) * u;
    root.z = ra[2] + (rb[2] - ra[2]) * u;
    root.stretch = this.stretch[i] + (this.stretch[i + 1] - this.stretch[i]) * u;
    root.spin = this.spin[i] + (this.spin[i + 1] - this.spin[i]) * u;
    this.constrain(out, t);
  }

  /** После смешивания поз хват решается заново: slerp двух замкнутых рук сам по себе не замыкает цепь. */
  constrain(out: Float32Array, t: number): void {
    if (this.grip && this.twoHanded) this.grip.apply(out, gripWeight(t, this.twoHanded));
  }
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

/**
 * Аниматор: слой действия поверх базовой позы (локомоция) с кроссфейдом 40–80 мс (Tech §8.2).
 * События клипа (hitOn/hitOff/trailOn…) вызываются по мере прохождения времени.
 */
export class Animator {
  clip: Clip | null = null;
  t = 0;
  speed = 1;
  /** Постановочный клип получает абсолютное время от Director, а не боевой dt. */
  sceneDriven = false;
  /** Время клипа, с которого идёт смешивание сценического клипа. */
  private sceneFrom = 0;
  private from: Float32Array;
  private target: Float32Array;
  readonly out: Float32Array;
  private fade = 0;
  private fadeDur = 0;
  readonly root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
  private evIdx = 0;
  onEvent: ((name: string) => void) | null = null;
  /** Вес «полной» маски: 1 — ноги тоже из клипа (локомоция подавлена). */
  fullWeight = 0;
  /**
   * Передача корня (этап 4.5, B1): при смене или остановке клипа горизонтальный сдвиг корня (локально: x — вбок,
   * z — вперёд) уходит владельцу — герой переносит его в физическую позицию, а не «прыгает» назад на 0.5 м
   * после Разлома. Высота, растяжение и разворот корня гаснут плавно за время смешивания.
   */
  onRootHandoff: ((x: number, z: number) => void) | null = null;
  private readonly rootFrom = { y: 0, stretch: 1, spin: 0 };

  constructor(readonly layout: RigLayout) {
    this.from = new Float32Array(layout.n * 4);
    this.target = new Float32Array(layout.n * 4);
    this.out = new Float32Array(layout.n * 4);
    this.out.set(layout.restRot);
  }

  /** Остаток корня прежнего клипа: x/z — владельцу, остальное — в плавное угасание. */
  /** Передать накопленный сдвиг корня в позицию (onRootHandoff) — повторный вызов без нового клипа ничего не делает. */
  handoffRoot(): void {
    const r = this.root;
    if (!this.sceneDriven && (r.x || r.z) && this.onRootHandoff) this.onRootHandoff(r.x, r.z);
    this.rootFrom.y = r.y; this.rootFrom.stretch = r.stretch;
    // полный оборот вращения — это ноль: иначе после Вращения тело докрутилось бы назад на 360°
    this.rootFrom.spin = Math.atan2(Math.sin(r.spin), Math.cos(r.spin));
    r.x = 0; r.z = 0;
  }

  play(clip: Clip, speed = 1, fade = 0.05, startT = 0): void {
    this.handoffRoot();
    this.sceneDriven = false;
    this.from.set(this.out);
    this.fade = 0; this.fadeDur = fade;
    this.clip = clip; this.t = startT; this.speed = speed; this.evIdx = 0;
    while (this.evIdx < clip.events.length && clip.events[this.evIdx].t < startT) this.evIdx++;
  }

  stop(fade = 0.08): void {
    if (!this.clip) return;
    this.handoffRoot();
    this.sceneDriven = false;
    this.from.set(this.out);
    this.fade = 0; this.fadeDur = fade;
    this.clip = null;
  }

  get done(): boolean { return !this.clip || (!this.clip.loop && this.t >= this.clip.dur); }

  /**
   * Чистая сценическая поза. Боевые события и передача корня здесь не выполняются;
   * именованные маркеры клипа обрабатывает Director на той же временной основе.
   */
  sampleScene(clip: Clip, time: number, reset = false, blend = 0): void {
    if (reset || !this.sceneDriven || this.clip !== clip) {
      this.sceneDriven = true;
      this.root.x = 0; this.root.z = 0; this.root.spin = 0;
      // смешивание от текущей позы (прежнего клипа сцены или боя) — во времени сцены, не боевого dt:
      // без него смена клипа на стыке была скачком за кадр (плечо на 168° на прыжке казни)
      const F = this.rootFrom;
      F.y = this.root.y; F.stretch = this.root.stretch; F.spin = 0;
      this.from.set(this.out);
      this.clip = clip;
      this.speed = 1;
      this.fadeDur = blend; this.sceneFrom = time;
      this.evIdx = clip.events.length;
    }
    this.sceneDriven = true;
    this.t = Math.max(0, Math.min(time, clip.dur));
    this.fade = Math.max(0, time - this.sceneFrom);
  }

  releaseScene(fade = 0.12): void {
    if (!this.sceneDriven) return;
    this.stop(fade);
  }

  update(dt: number): void {
    if (this.sceneDriven) return;
    if (this.clip) {
      const prev = this.t;
      this.t += dt * this.speed;
      if (this.clip.loop && this.t >= this.clip.dur) { this.t %= this.clip.dur; this.evIdx = 0; }
      const ev = this.clip.events;
      while (this.evIdx < ev.length && ev[this.evIdx].t <= this.t && ev[this.evIdx].t >= prev - 1e-6) {
        this.onEvent?.(ev[this.evIdx].name);
        this.evIdx++;
      }
    }
    if (this.fade < this.fadeDur) this.fade += dt;
  }

  /** base — поза локомоции (кватернионы). Результат пишется в out. */
  compose(base: Float32Array): void {
    this.target.set(base);
    const r = this.root;
    r.x = 0; r.y = 0; r.z = 0; r.stretch = 1; r.spin = 0;
    if (this.clip) {
      const t = Math.min(this.t, this.clip.dur);
      this.clip.sample(t, this.target, r);
      // Путь и разворот сценического актёра принадлежат дорожке режиссёра.
      if (this.sceneDriven) { r.x = 0; r.z = 0; r.spin = 0; }
    }
    const k = this.fadeDur > 0 ? Math.min(1, this.fade / this.fadeDur) : 1;
    if (k >= 1) { this.out.set(this.target); return; }
    const w = 1 - (1 - k) * (1 - k);
    // корень переходит от прежнего клипа к новому вместе с позой (смесь, а не сумма: клипы воздушной связки
    // оба держат Пилота на 1.3 м — сумма поднимала его до 2.6 м, этап 4.5, B3)
    const F = this.rootFrom, u = 1 - w;
    r.y = r.y * w + F.y * u; r.spin = r.spin * w + F.spin * u; r.stretch = r.stretch * w + F.stretch * u;
    for (let i = 0; i < this.layout.n; i++) {
      _qa.fromArray(this.from, i * 4); _qb.fromArray(this.target, i * 4);
      _qa.slerp(_qb, w);
      this.out[i * 4] = _qa.x; this.out[i * 4 + 1] = _qa.y; this.out[i * 4 + 2] = _qa.z; this.out[i * 4 + 3] = _qa.w;
    }
    if (this.clip) this.clip.constrain(this.out, Math.min(this.t, this.clip.dur));
  }
}
