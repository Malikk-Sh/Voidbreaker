import * as THREE from 'three';
import { Ease, type EaseId } from '../core/ease';
import type { RigLayout, V3 } from './skeleton';

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

  constructor(def: ClipDef, layout: RigLayout) {
    this.id = def.id;
    this.dur = def.dur;
    this.mask = def.mask ?? 'upper';
    this.loop = !!def.loop;
    this.events = (def.events ?? []).slice().sort((a, b) => a.t - b.t);
    const names = new Set<string>();
    for (const k of def.keys) for (const n of Object.keys(k.pose)) if (layout.has(n)) names.add(n);
    this.joints = [...names].map((n) => layout.idx(n));
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

  /** Сегмент и локальный прогресс (с эйзингом) в момент t. */
  private seg(t: number): [number, number] {
    const T = this.times;
    if (t <= T[0]) return [0, 0];
    for (let i = 0; i < T.length - 1; i++) {
      if (t < T[i + 1]) {
        const u = (t - T[i]) / Math.max(1e-5, T[i + 1] - T[i]);
        return [i, this.eases[i + 1](u)];
      }
    }
    return [T.length - 2, 1];
  }

  /** Записать позу клипа в массив кватернионов (rig layout); возвращает корневые параметры. */
  sample(t: number, out: Float32Array, root: { x: number; y: number; z: number; stretch: number; spin: number }): void {
    if (this.times.length === 1) {
      const a = this.quats[0];
      for (let j = 0; j < this.joints.length; j++) out.set(a.subarray(j * 4, j * 4 + 4), this.joints[j] * 4);
      const r = this.roots[0];
      root.x = r[0]; root.y = r[1]; root.z = r[2]; root.stretch = this.stretch[0]; root.spin = this.spin[0];
      return;
    }
    const [i, u] = this.seg(t);
    const a = this.quats[i], b = this.quats[i + 1];
    for (let j = 0; j < this.joints.length; j++) {
      _qa.fromArray(a, j * 4); _qb.fromArray(b, j * 4);
      _qa.slerp(_qb, u);
      const o = this.joints[j] * 4;
      out[o] = _qa.x; out[o + 1] = _qa.y; out[o + 2] = _qa.z; out[o + 3] = _qa.w;
    }
    const ra = this.roots[i], rb = this.roots[i + 1];
    root.x = ra[0] + (rb[0] - ra[0]) * u;
    root.y = ra[1] + (rb[1] - ra[1]) * u;
    root.z = ra[2] + (rb[2] - ra[2]) * u;
    root.stretch = this.stretch[i] + (this.stretch[i + 1] - this.stretch[i]) * u;
    root.spin = this.spin[i] + (this.spin[i + 1] - this.spin[i]) * u;
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

  constructor(readonly layout: RigLayout) {
    this.from = new Float32Array(layout.n * 4);
    this.target = new Float32Array(layout.n * 4);
    this.out = new Float32Array(layout.n * 4);
    this.out.set(layout.restRot);
  }

  play(clip: Clip, speed = 1, fade = 0.05, startT = 0): void {
    this.from.set(this.out);
    this.fade = 0; this.fadeDur = fade;
    this.clip = clip; this.t = startT; this.speed = speed; this.evIdx = 0;
    while (this.evIdx < clip.events.length && clip.events[this.evIdx].t < startT) this.evIdx++;
  }

  stop(fade = 0.08): void {
    if (!this.clip) return;
    this.from.set(this.out);
    this.fade = 0; this.fadeDur = fade;
    this.clip = null;
  }

  get done(): boolean { return !this.clip || (!this.clip.loop && this.t >= this.clip.dur); }

  update(dt: number): void {
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
    }
    const k = this.fadeDur > 0 ? Math.min(1, this.fade / this.fadeDur) : 1;
    if (k >= 1) { this.out.set(this.target); return; }
    const w = 1 - (1 - k) * (1 - k);
    for (let i = 0; i < this.layout.n; i++) {
      _qa.fromArray(this.from, i * 4); _qb.fromArray(this.target, i * 4);
      _qa.slerp(_qb, w);
      this.out[i * 4] = _qa.x; this.out[i * 4 + 1] = _qa.y; this.out[i * 4 + 2] = _qa.z; this.out[i * 4 + 3] = _qa.w;
    }
  }
}
