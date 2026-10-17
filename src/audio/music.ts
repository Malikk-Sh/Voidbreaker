import type { AudioEngine } from './engine';
import { bass, bell, choir, hat, industrial, kick, mtof, organ, pad, snare, tom, arp, type Ctx } from './synth';
import { Rng } from '../core/rng';

type Layer = 'A' | 'B' | 'C' | 'D';
const LAYERS: Layer[] = ['A', 'B', 'C', 'D'];

interface BakeSpec { len: number; render: (ctx: Ctx, out: AudioNode, t: number) => void }

export interface Song {
  id: string;
  bpm: number;
  bake: Record<string, BakeSpec>;
  /** Запланировать всё на шаг (16-я) в момент t. */
  schedule(s: Sequencer, step: number, t: number): void;
}

const LOOKAHEAD = 0.12, TICK_MS = 25;

/**
 * Секвенсор «двух часов» (Tech §21.4): JS-таймер планирует ноты чуть вперёд по точному времени AudioContext.
 * Слои A–D включаются кроссфейдом по интенсивности боя (GDD §18.3), E — стингеры.
 */
export class Sequencer {
  song: Song | null = null;
  private layers = {} as Record<Layer, GainNode>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  step = 0;
  private bufs = new Map<string, AudioBuffer>();
  intensity = 0;
  /** Фаза босса / вариант паттерна. */
  phase = 0;
  readonly rng = new Rng(Date.now() >>> 0);
  onBeat: ((bar: number, beat: number) => void) | null = null;

  constructor(private engine: AudioEngine) {}

  private ensureLayers(): boolean {
    const ctx = this.engine.ctx;
    if (!ctx) return false;
    if (!this.layers.A) for (const l of LAYERS) { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.engine.musicBus); this.layers[l] = g; }
    return true;
  }

  async load(song: Song): Promise<void> {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const sr = Math.min(44100, ctx.sampleRate);
    const jobs = Object.entries(song.bake).filter(([k]) => !this.bufs.has(k)).map(async ([k, b]) => {
      const off = new OfflineAudioContext(1, Math.ceil(sr * b.len), sr);
      const g = off.createGain(); g.connect(off.destination);
      b.render(off, g, 0.005);
      this.bufs.set(k, await off.startRendering());
    });
    await Promise.all(jobs);
  }

  play(song: Song, intensity = 0.3): void {
    if (!this.ensureLayers()) return;
    if (this.song?.id === song.id && this.timer) { this.setIntensity(intensity); return; }
    this.stop(0.6);
    this.song = song;
    this.phase = 0;
    void this.load(song).then(() => {
      if (this.song !== song) return;
      const ctx = this.engine.ctx!;
      this.next = ctx.currentTime + 0.1;
      this.step = 0;
      this.setIntensity(intensity, 0.8);
      this.timer = setInterval(() => this.tick(), TICK_MS);
    });
  }

  stop(fade = 0.5): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const ctx = this.engine.ctx;
    if (ctx && this.layers.A) for (const l of LAYERS) this.layers[l].gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
    this.song = null;
  }

  /** Пересинхронизировать после suspend/resume (visibilitychange). */
  resync(): void {
    const ctx = this.engine.ctx;
    if (ctx) this.next = ctx.currentTime + 0.05;
  }

  setIntensity(x: number, tau = 0.6): void {
    this.intensity = x;
    const ctx = this.engine.ctx;
    if (!ctx || !this.layers.A) return;
    const t = ctx.currentTime;
    const on = (th: number) => (x >= th ? 1 : 0);
    this.layers.A.gain.setTargetAtTime(1, t, tau);
    this.layers.B.gain.setTargetAtTime(on(0.2), t, tau);
    this.layers.C.gain.setTargetAtTime(on(0.5), t, tau);
    this.layers.D.gain.setTargetAtTime(on(0.8), t, tau);
  }

  private tick(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.song || ctx.state !== 'running') return;
    if (this.next < ctx.currentTime - 0.5) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this.song.schedule(this, this.step, this.next);
      if (this.step % 4 === 0) {
        const bar = (this.step / 16) | 0, beat = (this.step / 4) % 4;
        const delay = Math.max(0, (this.next - ctx.currentTime) * 1000);
        setTimeout(() => this.onBeat?.(bar, beat), delay);
      }
      this.next += 60 / this.song.bpm / 4;
      this.step++;
    }
  }

  /** Воспроизвести запечённый буфер в слой. */
  buf(name: string, t: number, layer: Layer, gain = 1, rate = 1): void {
    const ctx = this.engine.ctx, b = this.bufs.get(name);
    if (!ctx || !b) return;
    const s = ctx.createBufferSource(); s.buffer = b;
    s.playbackRate.value = rate * Math.pow(2, this.engine.musicDetune / 1200);
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(this.layers[layer]);
    if (layer === 'A' || layer === 'D') { const r = ctx.createGain(); r.gain.value = 0.35; g.connect(r).connect(this.engine.reverbSend); }
    s.start(t);
  }

  /** Живой инструмент в слой. */
  live(layer: Layer, fn: (ctx: Ctx, out: AudioNode, t: number) => void, t: number): void {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    fn(ctx, this.layers[layer], t);
  }

  /** Стингер (слой E): колокол + удар + хоровой аккорд — вне сетки, сразу. */
  stinger(name: string): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.bufs.has(name)) { this.engine.play(name); return; }
    const s = ctx.createBufferSource(); s.buffer = this.bufs.get(name)!;
    s.connect(this.engine.musicBus); s.start(ctx.currentTime + 0.01);
  }

  get detuneCents(): number { return this.engine.musicDetune; }
}

// ======================================================================== песни
const D = 50; // ре малой октавы
/** Аккорды ре фригийского: i, ♭II, ♭VI, ♭vii. */
const CHORDS: Record<string, number[]> = {
  Dm: [D, D + 3, D + 7], Eb: [D + 1, D + 5, D + 8], Bb: [D - 4, D, D + 3], Cm: [D - 2, D + 1, D + 5], Gm: [D + 5, D + 8, D + 12],
};
const PROG = [['Dm', 'Eb', 'Dm', 'Cm'], ['Dm', 'Bb', 'Eb', 'Dm'], ['Dm', 'Eb', 'Bb', 'Cm']];

function drumBakes(): Record<string, BakeSpec> {
  return {
    kick: { len: 0.6, render: (c, o, t) => kick(c, o, t, 0.9) },
    snare: { len: 0.4, render: (c, o, t) => snare(c, o, t, 0.45) },
    hat: { len: 0.1, render: (c, o, t) => hat(c, o, t, 0.12) },
    hatO: { len: 0.35, render: (c, o, t) => hat(c, o, t, 0.1, true) },
    tomL: { len: 0.6, render: (c, o, t) => tom(c, o, t, 80, 0.6) },
    tomH: { len: 0.6, render: (c, o, t) => tom(c, o, t, 125, 0.5) },
    ind: { len: 0.5, render: (c, o, t) => industrial(c, o, t, 0.4, 196) },
    bellD: { len: 4, render: (c, o, t) => bell(c, o, t, mtof(62), 0.18, 4) },
    bellA: { len: 4, render: (c, o, t) => bell(c, o, t, mtof(57), 0.16, 4) },
    bellLow: { len: 5, render: (c, o, t) => bell(c, o, t, mtof(38), 0.3, 5) },
    stinger: { len: 3, render: (c, o, t) => { bell(c, o, t, mtof(62), 0.2, 3); kick(c, o, t, 0.6, 35); choir(c, o, t, [50, 57, 62, 65], 1.4, 0.06, 'a', 'o'); } },
  };
}

function chordBakes(barSec: number): Record<string, BakeSpec> {
  const out: Record<string, BakeSpec> = {};
  for (const [k, notes] of Object.entries(CHORDS)) {
    out['pad_' + k] = { len: barSec * 2 + 1.5, render: (c, o, t) => pad(c, o, t, notes.map((n) => n + 12), barSec * 2, 0.05, 1100) };
    out['choir_' + k] = { len: barSec * 2 + 1.5, render: (c, o, t) => choir(c, o, t, [...notes.map((n) => n + 12), notes[0] + 24], barSec * 2, 0.055, 'a', 'o') };
  }
  return out;
}

const HAT_ACC = [1, 0.4, 0.7, 0.4, 1, 0.4, 0.7, 0.5, 1, 0.4, 0.7, 0.4, 1, 0.5, 0.8, 0.6];
const BASS_PAT = [[0, 0, 12, 0, 0, 7, 0, 12], [0, 12, 0, 0, 10, 0, 12, 0], [0, 0, 0, 12, 0, 0, 7, 10]];

/** Зона 01: ре фригийский, 140 BPM — орган, колокола, мрачный хорал (GDD §18.3). */
export function zone1Song(): Song {
  const bpm = 140, barSec = (60 / bpm) * 4;
  let prog = PROG[0], bassPat = BASS_PAT[0];
  return {
    id: 'zone1', bpm,
    bake: { ...drumBakes(), ...chordBakes(barSec) },
    schedule(s, step, t) {
      const inBar = step % 16, bar = (step / 16) | 0, inCycle = bar % 8;
      if (step % 128 === 0) { prog = s.rng.pick(PROG); bassPat = s.rng.pick(BASS_PAT); }
      const chord = prog[(inCycle / 2) | 0];
      const root = CHORDS[chord][0];
      const det = s.detuneCents;
      // A — эмбиент: пэд + органный дрон
      if (inBar === 0 && inCycle % 2 === 0) {
        s.buf('pad_' + chord, t, 'A', 0.9);
        s.live('A', (c, o, tt) => organ(c, o, tt, mtof(root - 12) * Math.pow(2, det / 1200), barSec * 2 - 0.1, 0.06), t);
      }
      // B — пульс: бас и бочка
      if (inBar % 2 === 0) s.live('B', (c, o, tt) => bass(c, o, tt, root - 12 + bassPat[(inBar / 2) | 0], 0.16, 0.2, det), t);
      if (inBar % 4 === 0) s.buf('kick', t, 'B', inBar % 8 === 0 ? 1 : 0.8);
      // C — ударные
      s.buf('hat', t, 'C', HAT_ACC[inBar] * 0.8);
      if (inBar === 4 || inBar === 12) s.buf('snare', t, 'C', 0.9);
      if (inBar === 14 && bar % 2 === 1) s.buf('hatO', t, 'C', 0.6);
      if (inBar === 10 || (inBar === 3 && bar % 2 === 0)) s.buf('ind', t, 'C', 0.5);
      if (inCycle === 7 && inBar >= 10) s.buf(inBar % 2 ? 'tomL' : 'tomH', t, 'C', 0.8);
      // D — хор и органный рифф
      if (inBar === 0 && inCycle % 2 === 0) s.buf('choir_' + chord, t, 'D', 0.9);
      if (inBar % 2 === 1) {
        const tones = [...CHORDS[chord], CHORDS[chord][0] + 12];
        const n = tones[((step >> 1) * 3) % tones.length] + 24;
        s.live('D', (c, o, tt) => arp(c, o, tt, n, 0.12, 0.035, det), t);
      }
      if (inBar === 0 && inCycle === 0) s.buf('bellD', t, 'A', 0.5);
    },
  };
}

/** Святилище: тот же лад, медленно, только эмбиент и колокола. */
export function hubSong(): Song {
  const bpm = 84, barSec = (60 / bpm) * 4;
  return {
    id: 'hub', bpm,
    bake: { ...chordBakes(barSec), bellD: drumBakes().bellD, bellA: drumBakes().bellA },
    schedule(s, step, t) {
      const inBar = step % 16, bar = (step / 16) | 0;
      const chord = ['Dm', 'Bb', 'Eb', 'Dm'][((bar % 8) / 2) | 0];
      if (inBar === 0 && bar % 2 === 0) {
        s.buf('pad_' + chord, t, 'A', 1);
        s.buf('choir_' + chord, t, 'A', 0.5);
      }
      if (inBar === 0 && bar % 4 === 0) s.buf(bar % 8 === 0 ? 'bellD' : 'bellA', t, 'A', 0.4);
      if (inBar % 4 === 2 && s.rng.chance(0.35)) {
        const tones = CHORDS[chord];
        s.live('A', (c, o, tt) => arp(c, o, tt, s.rng.pick(tones) + 24, 0.4, 0.02), t);
      }
    },
  };
}

/** Иерофант: колокола и орган; во второй фазе — «набат», ускоряющиеся удары колокола (GDD §18.4). */
export function hierophantSong(): Song {
  const bpm = 140, barSec = (60 / bpm) * 4;
  return {
    id: 'hierophant', bpm,
    bake: { ...drumBakes(), ...chordBakes(barSec) },
    schedule(s, step, t) {
      const inBar = step % 16, bar = (step / 16) | 0, inCycle = bar % 8;
      const chord = ['Dm', 'Eb', 'Gm', 'Eb'][(inCycle / 2) | 0];
      const root = CHORDS[chord][0];
      const det = s.detuneCents;
      if (inBar === 0 && inCycle % 2 === 0) {
        s.buf('pad_' + chord, t, 'A', 0.8);
        s.buf('choir_' + chord, t, 'D', 1);
        s.live('A', (c, o, tt) => organ(c, o, tt, mtof(root - 12) * Math.pow(2, det / 1200), barSec * 2 - 0.1, 0.08, [1, 0.8, 0.6, 0.5, 0.3, 0.25]), t);
      }
      if (inBar === 0) s.buf('bellLow', t, 'A', 0.6);
      if (inBar % 2 === 0) s.live('B', (c, o, tt) => bass(c, o, tt, root - 12 + (inBar % 8 === 6 ? 12 : 0), 0.16, 0.22, det), t);
      if (inBar % 4 === 0) s.buf('kick', t, 'B', 1);
      if (inBar === 4 || inBar === 12) s.buf('snare', t, 'C', 1);
      s.buf('hat', t, 'C', HAT_ACC[inBar] * 0.7);
      if (inBar % 8 === 6) s.buf('ind', t, 'C', 0.6);
      if (inCycle === 7 && inBar >= 8) s.buf(inBar % 2 ? 'tomL' : 'tomH', t, 'C', 0.9);
      // набат: во второй фазе колокол бьёт каждую долю, к концу цикла — восьмыми
      if (s.phase >= 1) {
        const dense = inCycle >= 6 ? 2 : 4;
        if (inBar % dense === 0) s.buf(inBar % 8 === 0 ? 'bellD' : 'bellA', t, 'D', 0.35);
      }
      if (inBar % 2 === 1 && s.phase >= 1) {
        const tones = [...CHORDS[chord], CHORDS[chord][0] + 12];
        s.live('D', (c, o, tt) => arp(c, o, tt, tones[(step >> 1) % tones.length] + 24, 0.1, 0.03, det), t);
      }
    },
  };
}
