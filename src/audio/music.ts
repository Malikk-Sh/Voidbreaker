import type { AudioEngine } from './engine';
import { bass, bell, boom, brass, choir, harp, hat, industrial, kick, mtof, organ, pad, snare, strings, taiko, tom, type Ctx } from './synth';
import { Rng } from '../core/rng';

/**
 * Мотивы (план §8.7): лейтмотив Пилота D–E♭–F–D–C–D (ре фригийский); Иерофант — тритон колокола D–A♭;
 * Голод — хроматическое сползание вниз.
 */
export const MOTIF = [62, 63, 65, 62, 60, 62];
export const TRITONE = [62, 56];
export const HUNGER_SLIDE = [0, -1, -2, -3];

/** Лейтмотив медью: notes — сколько нот мотива, step — шаг (с), shift — сдвиг (полутона). */
export function motifBrass(c: Ctx, o: AudioNode, t: number, notes = 6, step = 0.18, shift = 0, gain = 0.07): void {
  MOTIF.slice(0, notes).forEach((n, i) => brass(c, o, t + i * step, [n + shift], i === notes - 1 ? step * 3 : step * 0.9, gain));
}

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
/** Отдать управление браузеру (кадр, ввод) между тяжёлыми синхронными шагами. */
const yieldTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export class Sequencer {
  song: Song | null = null;
  /** Слои текущей песни. У каждой песни свои шины: старая затухает и отключается, не смешиваясь с новой. */
  private layers = {} as Record<Layer, GainNode>;
  private bus: GainNode | null = null;
  /** Отправка песни в реверберацию: своя шина, чтобы хвосты старой песни глохли вместе с ней. */
  private room: ConvolverNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  step = 0;
  /** Кэш запечённых буферов: ключ включает id песни (у песен разный темп — разная длина аккордов). */
  private bufs = new Map<string, AudioBuffer>();
  intensity = 0;
  /** Фаза босса / вариант паттерна. */
  phase = 0;
  /** Ранг SS: медный акцент на каждую долю (план §8.7, п. 9). */
  accent = false;
  /** Последняя волна этапа / фаза III (план §8.7, уровень 4): вокальные текстуры и глубокие удары поверх всех слоёв.
   *  Переживает смену песни (Страж на последней волне), снимается боем. */
  final = false;
  readonly rng = new Rng(Date.now() >>> 0);
  onBeat: ((bar: number, beat: number) => void) | null = null;
  /** Поколение запуска: отложенные onBeat и загрузки старых песен игнорируются. */
  private gen = 0;
  private readonly loading = new Map<string, Promise<void>>();

  constructor(private engine: AudioEngine) {}

  private key(name: string): string { return `${this.song?.id ?? ''}:${name}`; }

  private makeLayers(): boolean {
    const ctx = this.engine.ctx;
    if (!ctx) return false;
    this.bus = ctx.createGain();
    this.bus.connect(this.engine.musicBus);
    // Each song owns its return. Even notes already inside the impulse response fade with its dry mix.
    this.room = ctx.createConvolver();
    this.room.buffer = this.engine.reverb.buffer;
    const send = ctx.createGain();
    send.gain.value = 0.3;
    send.connect(this.room).connect(this.bus);
    for (const l of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.bus);
      if (l === 'A' || l === 'D') g.connect(send);
      this.layers[l] = g;
    }
    return true;
  }

  /**
   * Запечь фразы песни. Граф нот одной фразы строится синхронно (5–30 мс), поэтому фразы — по одной, с отдачей
   * кадра между ними: раньше вся песня строилась за один кадр — фриз 0.3–0.6 с на титуле пролога и в интро этапа.
   * Повторный вызов для той же песни ждёт уже идущую загрузку, а не строит всё заново.
   */
  load(song: Song): Promise<void> {
    const ctx = this.engine.ctx;
    if (!ctx) return Promise.resolve();
    const going = this.loading.get(song.id);
    if (going) return going;
    const sr = Math.min(44100, ctx.sampleRate);
    const job = (async () => {
      const renders: Promise<void>[] = [];
      for (const [k, b] of Object.entries(song.bake)) {
        const key = `${song.id}:${k}`;
        if (this.bufs.has(key)) continue;
        const off = new OfflineAudioContext(2, Math.ceil(sr * b.len), sr);
        const g = off.createGain(); g.connect(off.destination);
        b.render(off, g, 0.005);
        renders.push(off.startRendering().then((buf) => { this.bufs.set(key, buf); }));
        await yieldTask();
      }
      await Promise.all(renders);
    })();
    this.loading.set(song.id, job);
    return job.finally(() => this.loading.delete(song.id));
  }

  /** Запечь заранее (тема стража/босса) — переключение потом без паузы. */
  preload(song: Song): void { void this.load(song); }

  play(song: Song, intensity = 0.3): void {
    if (!this.engine.ctx) return;
    if (this.song?.id === song.id) { this.setIntensity(intensity); return; }
    this.stop(0.8);
    if (!this.makeLayers()) return;
    this.song = song;
    this.phase = 0;
    const gen = ++this.gen;
    void this.load(song).then(() => {
      if (gen !== this.gen) return;
      const ctx = this.engine.ctx!;
      this.next = ctx.currentTime + 0.1;
      this.step = 0;
      this.setIntensity(intensity, 0.8);
      this.timer = setInterval(() => this.tick(), TICK_MS);
    });
  }

  stop(fade = 0.5): void {
    this.gen++;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const ctx = this.engine.ctx, bus = this.bus, room = this.room;
    if (ctx && bus && room) {
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => { room.disconnect(); bus.disconnect(); }, (fade + 0.05) * 1000);
    }
    this.bus = null;
    this.room = null;
    this.layers = {} as Record<Layer, GainNode>;
    this.song = null;
  }

  /**
   * Провал громкости песни (план §8.7, п. 5): тишина перед сменой фазы, −18 дБ перед сигнатурной атакой.
   * level — множитель громкости, hold — сколько держать (с).
   */
  duck(level: number, hold: number, attack = 0.15, release = 0.5): void {
    const ctx = this.engine.ctx, bus = this.bus;
    if (!ctx || !bus) return;
    const t = ctx.currentTime, g = bus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + attack);
    g.setValueAtTime(level, t + attack + hold);
    g.linearRampToValueAtTime(1, t + attack + hold + release);
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
    const gen = this.gen;
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this.song.schedule(this, this.step, this.next);
      if (this.step % 4 === 0) {
        const bar = (this.step / 16) | 0, beat = (this.step / 4) % 4;
        const delay = Math.max(0, (this.next - ctx.currentTime) * 1000);
        setTimeout(() => { if (gen === this.gen) this.onBeat?.(bar, beat); }, delay);
      }
      this.next += 60 / this.song.bpm / 4;
      this.step++;
    }
  }

  /** Воспроизвести запечённый буфер в слой. */
  buf(name: string, t: number, layer: Layer, gain = 1, rate = 1): void {
    const ctx = this.engine.ctx, b = this.bufs.get(this.key(name));
    if (!ctx || !b || !this.layers[layer]) return;
    const s = ctx.createBufferSource(); s.buffer = b;
    s.playbackRate.value = rate * Math.pow(2, this.engine.musicDetune / 1200);
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(this.layers[layer]);
    s.start(t);
  }

  /** Живой инструмент в слой. */
  live(layer: Layer, fn: (ctx: Ctx, out: AudioNode, t: number) => void, t: number): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.layers[layer]) return;
    fn(ctx, this.layers[layer], t);
  }

  /** Стингер (слой E): колокол + удар + хоровой аккорд — вне сетки, сразу. */
  stinger(name: string): void {
    const ctx = this.engine.ctx;
    const b = this.bufs.get(this.key(name));
    if (!ctx || !b || !this.bus) { this.engine.play(name); return; }
    const s = ctx.createBufferSource(); s.buffer = b;
    s.connect(this.bus); s.start(ctx.currentTime + 0.01);
  }

  get detuneCents(): number { return this.engine.musicDetune; }
}

// ======================================================================== песни
const D = 50; // ре малой октавы
/** Аккорды ре фригийского: i, ♭II, ♭VI, ♭vii (Святилище). */
const CHORDS: Record<string, number[]> = {
  Dm: [D, D + 3, D + 7], Eb: [D + 1, D + 5, D + 8], Bb: [D - 4, D, D + 3], Cm: [D - 2, D + 1, D + 5], Gm: [D + 5, D + 8, D + 12],
};

/** Ступени лада от тоники (полутона трезвучия). */
const DEG: Record<string, [number, number, number]> = {
  i: [0, 3, 7], iv: [5, 8, 12], v: [7, 10, 14], V: [7, 11, 14],
  bII: [1, 5, 8], bIII: [3, 7, 10], bVI: [-4, 0, 3], bVII: [-2, 2, 5], bvii: [-2, 1, 5],
};

function drumBakes(): Record<string, BakeSpec> {
  return {
    kick: { len: 0.6, render: (c, o, t) => kick(c, o, t, 0.9) },
    snare: { len: 0.4, render: (c, o, t) => snare(c, o, t, 0.45) },
    hat: { len: 0.1, render: (c, o, t) => hat(c, o, t, 0.12) },
    hatO: { len: 0.35, render: (c, o, t) => hat(c, o, t, 0.1, true) },
    tomL: { len: 0.6, render: (c, o, t) => tom(c, o, t, 80, 0.6) },
    tomH: { len: 0.6, render: (c, o, t) => tom(c, o, t, 125, 0.5) },
    ind: { len: 0.5, render: (c, o, t) => industrial(c, o, t, 0.4, 196) },
    taiko: { len: 0.9, render: (c, o, t) => taiko(c, o, t, 58, 0.85) },
    taikoHi: { len: 0.9, render: (c, o, t) => taiko(c, o, t, 96, 0.6) },
    boom: { len: 2.6, render: (c, o, t) => boom(c, o, t, 0.85) },
    bellD: { len: 4, render: (c, o, t) => bell(c, o, t, mtof(62), 0.18, 4) },
    bellA: { len: 4, render: (c, o, t) => bell(c, o, t, mtof(57), 0.16, 4) },
    bellLow: { len: 5, render: (c, o, t) => bell(c, o, t, mtof(38), 0.3, 5) },
    // стингер волны: колокол, удар, хор и лейтмотив Пилота медью (первые четыре ноты)
    stinger: { len: 3, render: (c, o, t) => { bell(c, o, t, mtof(62), 0.2, 3); kick(c, o, t, 0.6, 35); choir(c, o, t, [50, 57, 62, 65], 1.4, 0.06, 'a', 'o'); motifBrass(c, o, t + 0.05, 4, 0.11, -12, 0.065); } },
    bellAb: { len: 4, render: (c, o, t) => bell(c, o, t, mtof(56), 0.16, 4) },
    // порталы волны открылись: тайко и «бум» (план §8.7, п. 4)
    waveHit: { len: 2.8, render: (c, o, t) => { taiko(c, o, t, 55, 0.9); boom(c, o, t, 0.6); } },
    // хоровой акцент: финишер на ранге SS, рывок ранга
    choirHit: { len: 1.6, render: (c, o, t) => { choir(c, o, t, [62, 69, 74, 77], 0.5, 0.07, 'a', 'o'); taiko(c, o, t, 70, 0.4); } },
    // оглушение Стража или босса: медный удар на ♭II и тайко — «сбили с ног»
    stunStinger: { len: 2.2, render: (c, o, t) => { taiko(c, o, t, 52, 0.8); brass(c, o, t, [39, 46, 51], 0.5, 0.08); choir(c, o, t + 0.04, [63, 67, 70], 0.9, 0.045, 'o', 'u'); } },
  };
}

/** Запечённые аккорды: пэд, хорал, медные стабы и «вздохи», хоровой скандированный слог. */
function chordBakes(barSec: number, chords: Record<string, number[]>, epic = false): Record<string, BakeSpec> {
  const out: Record<string, BakeSpec> = {};
  for (const [k, notes] of Object.entries(chords)) {
    out['pad_' + k] = { len: barSec * 2 + 1.5, render: (c, o, t) => pad(c, o, t, notes.map((n) => n + 12), barSec * 2, 0.05, 1100) };
    out['choir_' + k] = { len: barSec * 2 + 1.5, render: (c, o, t) => choir(c, o, t, [...notes.map((n) => n + 12), notes[0] + 24], barSec * 2, 0.055, 'a', 'o') };
    if (!epic) continue;
    out['brass_' + k] = { len: 1.1, render: (c, o, t) => brass(c, o, t, notes, 0.42, 0.075) };
    out['swell_' + k] = { len: barSec * 2 + 0.6, render: (c, o, t) => brass(c, o, t, [notes[0] - 12, ...notes], barSec * 2 - 0.2, 0.06, true) };
    out['chant_' + k] = { len: 1.3, render: (c, o, t) => choir(c, o, t, [notes[0] + 12, notes[2] + 12], 0.28, 0.09, 'a', 'a') };
  }
  return out;
}

const HAT_ACC = [1, 0.4, 0.7, 0.4, 1, 0.4, 0.7, 0.5, 1, 0.4, 0.7, 0.4, 1, 0.5, 0.8, 0.6];
const BASS_PAT = [[0, 0, 12, 0, 0, 7, 0, 12], [0, 12, 0, 0, 10, 0, 12, 0], [0, 0, 0, 12, 0, 0, 7, 10]];

type Groove = 'march' | 'gallop' | 'taiko' | 'drive' | 'double' | 'halftime';
const KICK: Record<Groove, number[]> = {
  march: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.7, 0, 0, 0, 0],
  gallop: [1, 0, 0, 0.7, 1, 0, 0, 0.7, 1, 0, 0, 0.7, 1, 0, 0.7, 0.7],
  taiko: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  drive: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  double: [1, 0, 0.8, 0, 1, 0, 0.8, 0, 1, 0, 0.8, 0, 1, 0, 0.8, 0],
  halftime: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
};
const TAIKO = [1, 0, 0, 0.6, 0, 0, 0.8, 0, 1, 0, 0.6, 0, 0.8, 0, 0.6, 0.6];
/** Остинато струнных: индексы тонов аккорда [1, 3, 5, 1', 3'], −1 — пауза. */
const OST = {
  pulse: [0, -1, 0, 2, 0, -1, 0, 3, 0, -1, 0, 2, 1, -1, 2, 3],
  gallop: [0, -1, 0, 0, 0, -1, 0, 0, 2, -1, 2, 2, 1, -1, 1, 1],
  run: [0, 0, 2, 0, 3, 0, 2, 0, 0, 0, 2, 0, 4, 0, 2, 0],
  sparse: [0, -1, -1, 0, -1, -1, 2, -1, 0, -1, -1, 0, -1, -1, 3, -1],
};

interface EpicCfg {
  id: string; bpm: number; root: number;
  progs: string[][];
  groove: Groove;
  ost: number[];
  /** Шаги такта с медными стабами (слой D). */
  brassAt: number[];
  organ?: boolean; bells?: boolean;
  /** Стражи и босс: скандирующий хор, «бумы», во второй фазе — двойная бочка 16-ми. */
  harsh?: boolean;
  /** Иерофант: набат колоколов во второй фазе. */
  tocsin?: boolean;
  /** Колокола — тритоном D–A♭ (мотив Иерофанта), а не квинтой. */
  tritone?: boolean;
}

/**
 * Эпический боевой трек (GDD §18.3): струнное остинато, медь, тайко, хор. Слои по интенсивности:
 * A — пэд/орган/колокол, B — бас, бочка, струнные, C — ударные и тайко, D — хор, медь, мелодия.
 * phase ≥ 1 (ярость стража, вторая фаза босса) — плотнее и жёстче.
 */
/**
 * Запечённые фразы такта (план §8.7, п. 8): бас восьмыми (3 рисунка), струнное остинато (своё и «бег» ярости),
 * арфа по тонам аккорда — на каждый аккорд; в теме — один буфер на такт вместо десятков живых узлов.
 */
function phraseBakes(cfg: EpicCfg, chords: Record<string, number[]>, barSec: number): Record<string, BakeSpec> {
  const st = barSec / 16, out: Record<string, BakeSpec> = {};
  const bassGain = cfg.harsh ? 0.24 : 0.2;
  for (const [ch, tones] of Object.entries(chords)) {
    BASS_PAT.forEach((pat, pi) => {
      out[`bass_${ch}_${pi}`] = { len: barSec + 0.4, render: (c, o, t) => { for (let k = 0; k < 8; k++) bass(c, o, t + k * 2 * st, tones[0] - 12 + pat[k], 0.15, bassGain); } };
    });
    for (const [name, pat] of [['ost', cfg.ost], ['ostR', OST.run]] as const) {
      out[`${name}_${ch}`] = { len: barSec + 0.3, render: (c, o, t) => pat.forEach((oi, k) => {
        if (oi < 0) return;
        strings(c, o, t + k * st, (oi >= 3 ? tones[oi - 3] + 12 : tones[oi]) + 12, st * 0.9, 0.045);
      }) };
    }
    // арфа вместо квадратного арпеджио: восьмые на слабые доли, тона аккорда вверх-вниз
    if (!cfg.harsh) {
      const lead = [...tones, tones[0] + 12];
      out[`harp_${ch}`] = { len: barSec + 1.2, render: (c, o, t) => { for (let k = 0; k < 8; k++) harp(c, o, t + (2 * k + 1) * st, lead[(3 * k) % 4] + 24, 0.55, 0.05); } };
    }
  }
  // раз в восемь тактов вместо арпеджио арфа поёт лейтмотив Пилота
  if (!cfg.harsh) out.harpMotif = { len: barSec + 1.6, render: (c, o, t) => MOTIF.forEach((n, i) => harp(c, o, t + i * 2 * st, n + 12, i === 5 ? 1.4 : 0.6, 0.06)) };
  return out;
}

function epicSong(cfg: EpicCfg): Song {
  const barSec = (60 / cfg.bpm) * 4;
  const used = new Set(cfg.progs.flat());
  const chords: Record<string, number[]> = {};
  for (const d of used) chords[d] = DEG[d].map((n) => cfg.root + n);
  let prog = cfg.progs[0], bassIdx = 0;
  const hatsOn16 = cfg.groove === 'drive' || cfg.groove === 'double' || cfg.groove === 'gallop';
  return {
    id: cfg.id, bpm: cfg.bpm,
    bake: {
      ...drumBakes(), ...chordBakes(barSec, chords, true), ...phraseBakes(cfg, chords, barSec),
      // мотив Голода (Стражи, босс): медь сползает вниз по полутонам восьмыми
      ...(cfg.harsh ? { hunger: { len: barSec * 0.5 + 0.8, render: (c: Ctx, o: AudioNode, t: number) => HUNGER_SLIDE.forEach((d, i) => brass(c, o, t + i * barSec / 8, [cfg.root + 12 + d], barSec / 8 * 0.95, 0.06)) } } : {}),
    },
    schedule(s, step, t) {
      const inBar = step % 16, bar = (step / 16) | 0, inCycle = bar % 8;
      if (step % 128 === 0) { prog = s.rng.pick(cfg.progs); bassIdx = s.rng.int(0, BASS_PAT.length - 1); }
      const ch = prog[(inCycle / 2) | 0];
      const tones = chords[ch];
      const root = tones[0];
      const det = s.detuneCents;
      const rage = s.phase >= 1;
      const fill = inCycle === 7 && inBar >= 8;
      // A — пэд, органный дрон, колокол на начале цикла
      if (inBar === 0 && inCycle % 2 === 0) {
        s.buf('pad_' + ch, t, 'A', 0.8);
        if (cfg.organ) s.live('A', (c, o, tt) => organ(c, o, tt, mtof(root - 12) * Math.pow(2, det / 1200), barSec * 2 - 0.1, 0.06), t);
      }
      if (inBar === 0 && inCycle % 4 === 0 && (cfg.bells || cfg.tocsin)) s.buf(cfg.tocsin ? 'bellLow' : 'bellD', t, 'A', 0.5);
      // тритон Иерофанта: ответ колокола на ♭5 через полтакта
      if (cfg.tritone && inBar === 8 && inCycle % 4 === 0) s.buf('bellAb', t, 'A', 0.45);
      // B — бас восьмыми и струнное остинато (запечённые фразы такта), бочка грува
      if (inBar === 0) {
        s.buf(`bass_${ch}_${bassIdx}`, t, 'B', 1);
        s.buf(`${rage ? 'ostR' : 'ost'}_${ch}`, t, 'B', 1);
      }
      const kv = rage && cfg.harsh ? (inBar % 2 === 0 ? 1 : 0.75) : KICK[cfg.groove][inBar];
      if (kv > 0) s.buf('kick', t, 'B', kv * (rage ? 0.7 : 0.9));
      // C — ударные: малый, хэты, тайко, брейки томов
      const half = cfg.groove === 'halftime' || cfg.groove === 'taiko';
      if (half ? inBar === 8 : inBar === 4 || inBar === 12) s.buf('snare', t, 'C', 0.9);
      if (hatsOn16 || rage) s.buf('hat', t, 'C', HAT_ACC[inBar] * 0.7);
      else if (inBar % 2 === 0) s.buf('hat', t, 'C', HAT_ACC[inBar] * 0.8);
      if (cfg.groove === 'taiko' || cfg.harsh) { const tv = TAIKO[inBar]; if (tv > 0) s.buf(inBar % 4 === 0 ? 'taiko' : 'taikoHi', t, 'C', tv * 0.6); }
      if (inBar === 10 || (inBar === 3 && bar % 2 === 0)) s.buf('ind', t, 'C', 0.45);
      if (fill) s.buf(inBar % 2 ? 'tomL' : 'tomH', t, 'C', 0.85);
      // D — хорал и медь на смене аккорда, стабы, скандирование, мелодия, «бум» на начало цикла
      if (inBar === 0 && inCycle % 2 === 0) {
        s.buf('choir_' + ch, t, 'D', 0.85);
        if (inCycle % 4 === 0) s.buf('swell_' + ch, t, 'D', 0.7);
      }
      if (inBar === 0 && inCycle === 0 && (cfg.harsh || rage)) s.buf('boom', t, 'D', 0.55);
      // уровень 4: скандирующий хор каждые полтакта и «бум» каждые два такта
      if (s.final) {
        if (inBar % 8 === 0) s.buf('chant_' + ch, t, 'D', 0.7);
        if (inBar === 0 && inCycle % 2 === 0 && inCycle !== 0) s.buf('boom', t, 'D', 0.45);
      }
      const stab = rage ? inBar % 4 === 0 || inBar === 14 : cfg.brassAt.includes(inBar);
      if (stab) s.buf('brass_' + ch, t, 'D', rage ? 0.75 : 0.7);
      else if (s.accent && inBar % 4 === 0) s.buf('brass_' + ch, t, 'D', 0.5);
      if (cfg.harsh && (rage ? inBar % 4 === 0 : inBar === 0 || inBar === 8)) s.buf('chant_' + ch, t, 'D', 0.8);
      // Голод в темах Стражей и босса: сползание в конце каждой четвёртой строки
      if (cfg.harsh && inCycle % 4 === 3 && inBar === 8) s.buf('hunger', t, 'D', 0.75);
      if (inBar === 0 && !cfg.harsh) s.buf(inCycle === 4 ? 'harpMotif' : `harp_${ch}`, t, 'D', 1);
      // набат: колокол каждую долю, к концу цикла — восьмыми
      if (cfg.tocsin && rage) {
        const dense = inCycle >= 6 ? 2 : 4;
        if (inBar % dense === 0) s.buf(inBar % 8 === 0 ? 'bellD' : cfg.tritone ? 'bellAb' : 'bellA', t, 'D', 0.35);
      }
    },
  };
}

/** Боевые темы этапов зоны 01: у каждого свой лад, темп и грув. */
const STAGE_SONGS: Record<string, EpicCfg> = {
  '1-1': { id: 'st-1-1', bpm: 138, root: 50, progs: [['i', 'bII', 'i', 'bvii'], ['i', 'bVI', 'bII', 'i']], groove: 'march', ost: OST.pulse, brassAt: [0, 10], organ: true, bells: true },
  '1-2': { id: 'st-1-2', bpm: 146, root: 52, progs: [['i', 'bVI', 'bVII', 'i'], ['i', 'iv', 'bVI', 'bVII']], groove: 'gallop', ost: OST.gallop, brassAt: [0, 6, 12] },
  '1-3': { id: 'st-1-3', bpm: 132, root: 48, progs: [['i', 'bVI', 'bVII', 'V'], ['i', 'iv', 'bVI', 'V']], groove: 'taiko', ost: OST.sparse, brassAt: [0, 8], organ: true },
  '1-4': { id: 'st-1-4', bpm: 140, root: 53, progs: [['i', 'bIII', 'bVII', 'iv'], ['i', 'bVI', 'bIII', 'bVII']], groove: 'drive', ost: OST.run, brassAt: [0, 10], organ: true },
  '1-5': { id: 'st-1-5', bpm: 156, root: 51, progs: [['i', 'bVII', 'bVI', 'bVII'], ['i', 'bII', 'bVI', 'V']], groove: 'double', ost: OST.run, brassAt: [0, 6, 8, 14] },
  '1-6': { id: 'st-1-6', bpm: 144, root: 50, progs: [['i', 'bII', 'bVII', 'i'], ['i', 'bVI', 'bII', 'bvii']], groove: 'halftime', ost: OST.pulse, brassAt: [0, 3, 10], bells: true },
  // клуатр — сдержанный марш с органом; крипта — тяжёлые барабаны внизу; хоры — бег перед боссом, колокола
  '1-7': { id: 'st-1-7', bpm: 136, root: 49, progs: [['i', 'bVI', 'bIII', 'bVII'], ['i', 'iv', 'bVII', 'i']], groove: 'march', ost: OST.sparse, brassAt: [0, 8], organ: true },
  '1-8': { id: 'st-1-8', bpm: 128, root: 47, progs: [['i', 'bII', 'iv', 'i'], ['i', 'bVI', 'bII', 'V']], groove: 'taiko', ost: OST.pulse, brassAt: [0, 12], organ: true },
  '1-9': { id: 'st-1-9', bpm: 152, root: 52, progs: [['i', 'bVII', 'bVI', 'V'], ['i', 'bIII', 'bVI', 'bVII']], groove: 'double', ost: OST.run, brassAt: [0, 4, 8, 12], bells: true },
};

/** Тема этапа (по умолчанию — первая). */
export function stageSong(stageId: string): Song { return epicSong(STAGE_SONGS[stageId] ?? STAGE_SONGS['1-1']); }

/** Совместимость: тема зоны 01 = тема первого этапа. */
export function zone1Song(): Song { return stageSong('1-1'); }

/** Тема Стража: гармонический минор, тайко и скандирующий хор; в ярости — двойная бочка и медь на каждую долю. */
export function guardianSong(kind: string): Song {
  return epicSong(kind === 'bellRinger'
    ? { id: 'guardian-bell', bpm: 152, root: 49, progs: [['i', 'bII', 'bVI', 'V'], ['i', 'bVI', 'iv', 'V']], groove: 'taiko', ost: OST.run, brassAt: [0, 3, 6, 10, 14], harsh: true, bells: true }
    : { id: 'guardian-gate', bpm: 150, root: 48, progs: [['i', 'bVI', 'iv', 'V'], ['i', 'bII', 'bVI', 'V']], groove: 'taiko', ost: OST.gallop, brassAt: [0, 3, 6, 8, 11, 14], harsh: true });
}

/** Святилище: тот же лад, медленно, только эмбиент и колокола. */
export function hubSong(): Song {
  const bpm = 84, barSec = (60 / bpm) * 4;
  return {
    id: 'hub', bpm,
    bake: {
      ...chordBakes(barSec, CHORDS), bellD: drumBakes().bellD, bellA: drumBakes().bellA,
      // лейтмотив Пилота хором (план §8.7): Святилище помнит его
      motifChoir: { len: 6.5, render: (c, o, t) => MOTIF.forEach((n, i) => choir(c, o, t + i * 0.7, [n, n - 12], i === 5 ? 2.2 : 0.85, 0.05, 'o', 'u')) },
    },
    schedule(s, step, t) {
      const inBar = step % 16, bar = (step / 16) | 0;
      const chord = ['Dm', 'Bb', 'Eb', 'Dm'][((bar % 8) / 2) | 0];
      if (inBar === 0 && bar % 2 === 0) {
        s.buf('pad_' + chord, t, 'A', 1);
        s.buf('choir_' + chord, t, 'A', 0.5);
      }
      if (inBar === 0 && bar % 4 === 0) s.buf(bar % 8 === 0 ? 'bellD' : 'bellA', t, 'A', 0.4);
      if (inBar === 0 && bar % 8 === 4) s.buf('motifChoir', t, 'A', 0.9);
      if (inBar % 4 === 2 && s.rng.chance(0.35)) {
        const tones = CHORDS[chord];
        s.live('A', (c, o, tt) => harp(c, o, tt, s.rng.pick(tones) + 24, 0.9, 0.03), t);
      }
    },
  };
}

/** Иерофант (GDD §18.4): колокола, орган, медь и хор; во второй фазе — набат, двойная бочка, «бумы». */
export function hierophantSong(): Song {
  return epicSong({
    id: 'hierophant', bpm: 140, root: 50, progs: [['i', 'bII', 'iv', 'bII'], ['i', 'bVI', 'bII', 'V']],
    groove: 'taiko', ost: OST.pulse, brassAt: [0, 6, 10], organ: true, harsh: true, tocsin: true, tritone: true,
  });
}

/** A four-note call in B returns at three speeds. The bell and blade cues have the upper register to themselves. */
export function devourerSong(): Song {
  const bpm = 132, unit = 60 / bpm / 4;
  const drums = drumBakes();
  const bake: Record<string, BakeSpec> = {
    taiko: drums.taiko, skin: drums.taikoHi, kick: drums.kick, metal: drums.ind,
    stinger: drums.stinger, stunStinger: drums.stunStinger, choirHit: drums.choirHit,
    waveHit: drums.waveHit,
    tread: { len: 0.9, render: (c, o, t) => bass(c, o, t, 35, 0.32, 0.22) },
    bow: { len: 0.48, render: (c, o, t) => strings(c, o, t, 59, 0.19, 0.084) },
    horn: { len: 1.55, render: (c, o, t) => brass(c, o, t, [47, 54, 59], 0.84, 0.077, true) },
    overtone: { len: 1.4, render: (c, o, t) => harp(c, o, t, 71, 0.86, 0.056) },
    horizon: { len: 2.25, render: (c, o, t) => choir(c, o, t, [47, 54, 62, 66], 1.55, 0.056, 'u', 'a') },
    undertow: { len: 2.6, render: (c, o, t) => pad(c, o, t, [35, 42, 59], 1.78, 0.058, 790) },
    arrival: { len: 1.85, render: (c, o, t) => {
      taiko(c, o, t, 55, 0.64); brass(c, o, t + 0.065, [35, 42, 59], 0.94, 0.068, true);
    } },
    split: { len: 1.4, render: (c, o, t) => {
      [0, 3, 6].forEach((k, i) => { taiko(c, o, t + k * unit, 60 + i * 21, 0.52 - i * 0.07); });
      strings(c, o, t + 7 * unit, 60, 0.31, 0.079);
    } },
    recall: { len: 1.85, render: (c, o, t) => {
      harp(c, o, t, 66, 0.84, 0.08); harp(c, o, t + 2 * unit, 62, 0.8, 0.08);
      brass(c, o, t + 4 * unit, [35, 47, 54], 0.88, 0.07, true);
    } },
    // Two antiphonal phrases. The second bow answers from below before the next bar turns.
    answer: { len: 1.45, render: (c, o, t) => {
      strings(c, o, t, 66, 3 * unit, 0.072);
      strings(c, o, t + 3 * unit, 62, 5 * unit, 0.084);
    } },
  };
  const harmony = [[0, 0, 1, -4, 0, 3, -4, -2], [0, 1, 0, -2, 3, 1, -4, -2], [0, -4, 3, -2, 0, 1, -4, 0]];
  const motif = [0, 1, 7, 3];
  const ratio = (n: number) => 2 ** (n / 12);
  let movement = -1, firstStep = 0;
  return { id: 'devourer', bpm, bake, schedule(s, step, t) {
    const phase = Math.min(2, s.phase);
    if (movement !== phase || step === 0) {
      firstStep = step;
      movement = phase;
      s.buf(['arrival', 'split', 'recall'][phase], t, 'A', 0.84);
    }
    const local = step - firstStep, bar = Math.floor(local / 16) % 8, k = local % 16;
    const root = harmony[phase][bar];
    const note = (voice: string, layer: Layer, semitone: number, gain = 1) => s.buf(voice, t, layer, gain, ratio(semitone));
    if (k === 0) note('undertow', 'A', root);
    if (phase === 0) {
      if (k === 0 || k === 10) { note('tread', 'A', root, k ? 0.65 : 1); s.buf('taiko', t, 'B', k ? 0.36 : 0.68); }
      if (k === 2 || k === 8) note('bow', 'B', motif[(bar + (k === 8 ? 1 : 0)) % 4] + root);
      if (bar % 2 === 0 && k === 4) note('horn', 'A', motif[bar / 2], 0.83);
      if (bar % 2 && k === 8) note('answer', 'C', root, 0.9);
    } else if (phase === 1) {
      // Three, three, two eighths. The bow anticipates the drum on the next bar.
      if ([0, 6, 12].includes(k)) { s.buf(k === 6 ? 'skin' : 'taiko', t, 'A', k ? 0.6 : 0.78); note('tread', 'B', root); }
      if (k % 2 === 0 || k === 15) note('bow', 'A', root + motif[(Math.floor(k / 2) + bar) % 4], k % 6 ? 0.6 : 0.98);
      if (k === 3 || k === 9 || (bar % 2 && k === 14)) s.buf('metal', t, 'C', 0.38);
      if (k === 4 && bar % 2 === 0) note('horn', 'B', root, 0.84);
      if (k === 12 && bar % 2) note('overtone', 'C', root + 3);
    } else {
      if (k === 0) { note('horizon', 'A', root); note('horn', 'B', root, 1.05); }
      if (k === 0 || k === 7 || k === 10) { s.buf('kick', t, 'B', k ? 0.6 : 0.86); note('tread', 'A', root, 0.9); }
      if (k === 8 || (bar % 2 && k === 14)) s.buf('taiko', t, 'A', 0.76);
      if (k === 4 || k === 12) note('overtone', 'C', motif[(bar + (k === 12 ? 2 : 0)) % 4] + root);
      if (k === 6) note('answer', 'B', root + (bar % 2 ? 5 : 0));
      if (bar % 4 === 3 && k >= 12) s.buf('skin', t, 'D', 0.24 + (k - 12) * 0.1);
    }
  } };
}
