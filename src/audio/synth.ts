/**
 * Инструменты-синтезаторы (GDD §18.2) поверх BaseAudioContext — работают и вживую, и при запекании в OfflineAudioContext.
 * Ни одного аудиофайла: шум, осцилляторы, фильтры, огибающие.
 */
export type Ctx = BaseAudioContext;

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
const pinkCache = new WeakMap<Ctx, AudioBuffer>();

export function noiseBuffer(ctx: Ctx, sec = 1): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function pinkBuffer(ctx: Ctx, sec = 1.5): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return b;
}

export function noise(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) { b = noiseBuffer(ctx, 2); noiseCache.set(ctx, b); }
  return b;
}
export function pink(ctx: Ctx): AudioBuffer {
  let b = pinkCache.get(ctx);
  if (!b) { b = pinkBuffer(ctx); pinkCache.set(ctx, b); }
  return b;
}

/**
 * «Соборная» реверберация без единого файла (план §5.2): предзадержка и хвост, который темнеет —
 * ФНЧ по шуму закрывается к концу, высокие гаснут первыми (без металлического шипения).
 */
export function makeImpulse(ctx: Ctx, sec = 3, decay = 2.6, predelay = 0.02): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.floor(sr * sec), pre = Math.floor(sr * predelay);
  const b = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const a = 0.65 * Math.pow(1 - t, 1.5) + 0.03;
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, decay) * 1.8;
    }
  }
  return b;
}

export function env(g: AudioParam, t: number, peak: number, attack: number, decay: number, sustain = 0.0001, hold = 0): void {
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, attack));
  if (hold > 0) g.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
  g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + attack + hold + Math.max(0.005, decay));
}

export function osc(ctx: Ctx, type: OscillatorType, f: number, t: number, dur: number, out: AudioNode, gain = 0.3, a = 0.005, d?: number): OscillatorNode {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  env(g.gain, t, gain, a, d ?? dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + a + (d ?? dur) + 0.05);
  return o;
}

/** Шумовой удар через фильтр. */
export function noiseHit(ctx: Ctx, out: AudioNode, t: number, dur: number, freq: number, gain: number, type: BiquadFilterType = 'bandpass', q = 1, src: 'white' | 'pink' = 'white'): { f: BiquadFilterNode; s: AudioBufferSourceNode } {
  const s = ctx.createBufferSource(); s.buffer = src === 'pink' ? pink(ctx) : noise(ctx);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  const g = ctx.createGain();
  env(g.gain, t, gain, 0.002, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  return { f, s };
}

// ------------------------------------------------------------------ блоки удара (план §5.2)
/** Атака: короткий шумовой контакт 1.5–3 кГц без «иголки». */
export function transient(ctx: Ctx, out: AudioNode, t: number, f = 2200, gain = 0.5): void {
  noiseHit(ctx, out, t, 0.012, f, gain, 'bandpass', 0.9);
}
/** Удар: треугольник с падением высоты через перегруз — вес. */
export function punch(ctx: Ctx, out: AudioNode, t: number, f0 = 180, f1 = 55, dur = 0.12, gain = 0.9, drive = 4): void {
  const o = ctx.createOscillator(), g = ctx.createGain(), sat = saturator(ctx, drive);
  o.type = 'triangle';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
  env(g.gain, t, gain, 0.001, dur);
  o.connect(sat).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}
/** Хруст: розовый шум 400–900 Гц через сильный перегруз — «мясо», материал. */
export function crunch(ctx: Ctx, out: AudioNode, t: number, f = 650, dur = 0.07, gain = 0.5): void {
  const sat = saturator(ctx, 6), g = ctx.createGain();
  g.gain.value = gain; sat.connect(g).connect(out);
  noiseHit(ctx, sat, t, dur, f, 1, 'bandpass', 1.1, 'pink');
}
/** Сколы обсидиана: 3–6 узких щелчков 700–1800 Гц, разнесённых по панораме. */
export function chips(ctx: Ctx, out: AudioNode, t: number, n = 4, gain = 0.22, spread = 0.03): void {
  for (let i = 0; i < n; i++) {
    const p = ctx.createStereoPanner(); p.pan.value = (Math.random() * 2 - 1) * 0.4; p.connect(out);
    noiseHit(ctx, p, t + Math.random() * spread, 0.01, 700 + Math.random() * 1100, gain, 'bandpass', 6);
  }
}
/** Шипение Пустоты: шум 1–2 кГц с амплитудной модуляцией 35–50 Гц — фирменный след клинка. */
export function voidHiss(ctx: Ctx, out: AudioNode, t: number, dur = 0.14, gain = 0.16, f = 1500): void {
  const am = ctx.createGain(); am.gain.value = 0.5; am.connect(out);
  const lfo = ctx.createOscillator(), lg = ctx.createGain();
  lfo.frequency.value = 35 + Math.random() * 15; lg.gain.value = 0.5;
  lfo.connect(lg).connect(am.gain); lfo.start(t); lfo.stop(t + dur + 0.05);
  noiseHit(ctx, am, t, dur, f, gain, 'bandpass', 2.5);
}
/** Суб: удар в грудь (только тяжёлые). */
export function sub(ctx: Ctx, out: AudioNode, t: number, f0 = 60, f1 = 38, dur = 0.24, gain = 0.7): void {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g.gain, t, gain, 0.002, dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}
/** Металлический акцент брони: неровные партиалы 1.3–3.4 кГц, короткий звон (только «броня»). */
export function metal(ctx: Ctx, out: AudioNode, t: number, f = 1450, gain = 0.12, dur = 0.35): void {
  for (const [r, k] of [[1, 1], [1.47, 0.6], [2.31, 0.35]] as const) osc(ctx, 'sine', f * r, t, dur, out, gain * k, 0.001, dur / (1 + r * 0.4));
  noiseHit(ctx, out, t, 0.01, 3500, gain * 1.2, 'bandpass', 3);
}
/** Щипок: треугольник + быстро закрывающийся ФНЧ — мягкий «тинь» без стекла. */
export function pluck(ctx: Ctx, out: AudioNode, t: number, f: number, dur = 0.25, gain = 0.08): void {
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 2;
  fl.frequency.setValueAtTime(f * 6, t); fl.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur * 0.5);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = f;
  env(g.gain, t, gain, 0.002, dur);
  o.connect(fl).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}

/** «Стеклянный» хвост: 3–5 коротких высоких синусов. Только там, где звон — смысл (стекло витража, энергия Ока). */
export function glassTail(ctx: Ctx, out: AudioNode, t: number, n: number, gain = 0.08): void {
  for (let i = 0; i < n; i++) {
    const tt = t + Math.random() * 0.06;
    osc(ctx, 'sine', 2400 + Math.random() * 4200, tt, 0.12, out, gain * (0.5 + Math.random()), 0.001, 0.08 + Math.random() * 0.12);
  }
}

/** Сатурация (waveshaper tanh). */
export function saturator(ctx: Ctx, amount = 2): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Колокол: неравномерные гармоники с разными затуханиями (GDD §18.2). */
const BELL = [0.56, 0.92, 1.19, 1.71, 2.0, 2.74, 3.0, 3.76, 4.07];
export function bell(ctx: Ctx, out: AudioNode, t: number, f0: number, gain = 0.25, len = 4): void {
  BELL.forEach((r, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.002);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((gain / (i * 0.6 + 1)) * (i === 1 ? 1.6 : 1), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len / (1 + i * 0.35));
    o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.1);
  });
  noiseHit(ctx, out, t, 0.03, 3000, gain * 0.6, 'highpass', 0.7);
}

/** Бочка: синус 150 → 40 Гц за 0.3 с + щелчок шума + сатурация. */
export function kick(ctx: Ctx, out: AudioNode, t: number, gain = 0.9, low = 40): void {
  const o = ctx.createOscillator(), g = ctx.createGain(), sat = saturator(ctx, 2.5);
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(low, t + 0.3);
  env(g.gain, t, gain, 0.002, 0.42);
  o.connect(sat).connect(g).connect(out); o.start(t); o.stop(t + 0.5);
  noiseHit(ctx, out, t, 0.015, 4000, gain * 0.35, 'highpass', 0.5);
}

/** Малый/хлопок: шум через полосовой + короткий тон 180 Гц. */
export function snare(ctx: Ctx, out: AudioNode, t: number, gain = 0.5): void {
  noiseHit(ctx, out, t, 0.18, 1800, gain, 'bandpass', 0.8);
  noiseHit(ctx, out, t + 0.008, 0.12, 1200, gain * 0.6, 'bandpass', 1.5);
  osc(ctx, 'triangle', 180, t, 0.08, out, gain * 0.5, 0.001, 0.08);
}

export function hat(ctx: Ctx, out: AudioNode, t: number, gain = 0.15, open = false): void {
  noiseHit(ctx, out, t, open ? 0.25 : 0.04, 9000, gain, 'highpass', 0.7);
}

/** Тайко/томы: синус с быстрым спадом высоты + полосовой шум. */
export function tom(ctx: Ctx, out: AudioNode, t: number, f = 110, gain = 0.6): void {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(f * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  env(g.gain, t, gain, 0.002, 0.45);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.5);
  noiseHit(ctx, out, t, 0.08, f * 4, gain * 0.4, 'bandpass', 2);
}

/** Индустриальный удар: шум через гребенчатый фильтр (задержка с обратной связью) + металлический резонанс. */
export function industrial(ctx: Ctx, out: AudioNode, t: number, gain = 0.5, f = 220): void {
  const d = ctx.createDelay(0.05);
  d.delayTime.value = 1 / f;
  const fb = ctx.createGain(); fb.gain.value = 0.82;
  const g = ctx.createGain();
  env(g.gain, t, 1, 0.001, 0.35);
  noiseHit(ctx, d, t, 0.06, 2500, gain, 'bandpass', 0.6);
  d.connect(fb).connect(d);
  d.connect(g).connect(out);
  noiseHit(ctx, out, t, 0.03, 600, gain * 0.8, 'lowpass', 1);
}

/** Орган: сумма синусов на гармониках (1, 2, 3, 4, 6, 8) + медленное тремоло. */
export function organ(ctx: Ctx, out: AudioNode, t: number, f: number, dur: number, gain = 0.12, registers = [1, 0.6, 0.45, 0.35, 0.2, 0.15]): void {
  const H = [1, 2, 3, 4, 6, 8];
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.06);
  g.gain.setValueAtTime(gain, t + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
  const trem = ctx.createOscillator(), tg = ctx.createGain();
  trem.frequency.value = 6; tg.gain.value = gain * 0.15;
  trem.connect(tg).connect(g.gain);
  trem.start(t); trem.stop(t + dur + 0.6);
  H.forEach((h, i) => {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = f * h; og.gain.value = registers[i] / H.length;
    o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.6);
  });
  g.connect(out);
}

/** Хор (формантный синтез): пила + вибрато → 3 полосовых фильтра на формантах гласной. */
const VOWELS: Record<string, [number, number, number]> = { a: [800, 1150, 2900], o: [450, 800, 2830], u: [325, 700, 2530], e: [400, 1600, 2700] };
export function choir(ctx: Ctx, out: AudioNode, t: number, notes: number[], dur: number, gain = 0.08, vowel: keyof typeof VOWELS = 'a', vowel2: keyof typeof VOWELS = 'o'): void {
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.6, dur * 0.3));
  bus.gain.setValueAtTime(gain, t + dur * 0.7);
  bus.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.8);
  const F = VOWELS[vowel], F2 = VOWELS[vowel2];
  const filters = F.map((fq, i) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 9 - i * 2;
    f.frequency.setValueAtTime(fq, t);
    f.frequency.linearRampToValueAtTime(F2[i], t + dur);
    const fg = ctx.createGain(); fg.gain.value = [1, 0.6, 0.25][i];
    f.connect(fg).connect(bus);
    return f;
  });
  for (const m of notes) {
    for (let v = 0; v < 2; v++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = mtof(m) * (1 + (v ? 0.004 : -0.004));
      const vib = ctx.createOscillator(), vg = ctx.createGain();
      vib.frequency.value = 5 + Math.random(); vg.gain.value = mtof(m) * 0.007;
      vib.connect(vg).connect(o.frequency);
      for (const f of filters) o.connect(f);
      o.start(t); o.stop(t + dur + 1); vib.start(t); vib.stop(t + dur + 1);
    }
  }
  bus.connect(out);
}

/** Пэд: 3–5 расстроенных пил, медленный фильтр, длинный хвост. */
export function pad(ctx: Ctx, out: AudioNode, t: number, notes: number[], dur: number, gain = 0.06, cutoff = 900): void {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(cutoff * 0.4, t);
  f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(cutoff * 0.5, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
  g.gain.setValueAtTime(gain, t + dur * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
  f.connect(g).connect(out);
  for (const m of notes) for (const det of [-9, 0, 8]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = mtof(m); o.detune.value = det;
    o.connect(f); o.start(t); o.stop(t + dur + 1.3);
  }
}

/** Бас: пила + квадрат, ФНЧ с огибающей, дисторшн. */
export function bass(ctx: Ctx, out: AudioNode, t: number, m: number, dur: number, gain = 0.22, detune = 0): void {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
  f.frequency.setValueAtTime(1400, t);
  f.frequency.exponentialRampToValueAtTime(140, t + Math.max(0.08, dur * 0.8));
  const sat = saturator(ctx, 3);
  const g = ctx.createGain();
  env(g.gain, t, gain, 0.004, dur, 0.0001);
  f.connect(sat).connect(g).connect(out);
  for (const [type, k] of [['sawtooth', 1], ['square', 0.5]] as const) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(m) * k * (type === 'square' ? 2 : 1); o.detune.value = detune;
    const og = ctx.createGain(); og.gain.value = type === 'square' ? 0.4 : 1;
    o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.05);
  }
}

/** Арпеджиатор: квадрат/пила, короткие ноты. */
export function arp(ctx: Ctx, out: AudioNode, t: number, m: number, dur: number, gain = 0.06, detune = 0): void {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3500, t); f.frequency.exponentialRampToValueAtTime(600, t + dur);
  const g = ctx.createGain();
  env(g.gain, t, gain, 0.003, dur);
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(m); o.detune.value = detune;
  o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
}

/** Струнное остинато (спиккато): две расстроенные пилы, полосовой «смычок», короткая огибающая. */
export function strings(ctx: Ctx, out: AudioNode, t: number, m: number, dur: number, gain = 0.05, detune = 0): void {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(mtof(m) * 6, t);
  f.frequency.exponentialRampToValueAtTime(mtof(m) * 2.2, t + dur);
  const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 900; body.gain.value = 5; body.Q.value = 0.8;
  const g = ctx.createGain();
  env(g.gain, t, gain, 0.008, dur);
  f.connect(body).connect(g).connect(out);
  for (const d of [-7, 6]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = mtof(m); o.detune.value = d + detune;
    o.connect(f); o.start(t); o.stop(t + dur + 0.05);
  }
}

/** Медь: стек пил с «раскрывающимся» фильтром (бвааа), суб-октава и сатурация — стабы и проводки. */
export function brass(ctx: Ctx, out: AudioNode, t: number, notes: number[], dur: number, gain = 0.07, swell = false): void {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3.5;
  const a = swell ? dur * 0.6 : 0.05;
  f.frequency.setValueAtTime(260, t);
  f.frequency.exponentialRampToValueAtTime(swell ? 2600 : 3200, t + a);
  f.frequency.exponentialRampToValueAtTime(700, t + a + Math.max(0.12, dur - a));
  const sat = saturator(ctx, 1.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + a);
  g.gain.setValueAtTime(gain, t + Math.max(a, dur * 0.7));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
  f.connect(sat).connect(g).connect(out);
  for (const m of notes) for (const d of [-8, 0, 7]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = mtof(m); o.detune.value = d;
    o.connect(f); o.start(t); o.stop(t + dur + 0.4);
  }
  const sub = ctx.createOscillator(); sub.type = 'triangle'; sub.frequency.value = mtof(notes[0] - 12);
  const sg = ctx.createGain(); sg.gain.value = 0.6; sub.connect(sg).connect(f); sub.start(t); sub.stop(t + dur + 0.4);
}

/** Тайко: глубокий мембранный удар с телом из розового шума. */
export function taiko(ctx: Ctx, out: AudioNode, t: number, f = 62, gain = 0.8): void {
  const o = ctx.createOscillator(), g = ctx.createGain(), sat = saturator(ctx, 1.8);
  o.frequency.setValueAtTime(f * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  env(g.gain, t, gain, 0.002, 0.7);
  o.connect(sat).connect(g).connect(out); o.start(t); o.stop(t + 0.8);
  noiseHit(ctx, out, t, 0.25, f * 5, gain * 0.55, 'lowpass', 1.2, 'pink');
  noiseHit(ctx, out, t, 0.02, 2500, gain * 0.25, 'bandpass', 1);
}

/** «Бум»: огромный кинематографичный удар — суб-падение, шумовой взрыв, длинный хвост. */
export function boom(ctx: Ctx, out: AudioNode, t: number, gain = 0.9): void {
  const o = ctx.createOscillator(), g = ctx.createGain(), sat = saturator(ctx, 2.2);
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
  env(g.gain, t, gain, 0.003, 2.2);
  o.connect(sat).connect(g).connect(out); o.start(t); o.stop(t + 2.4);
  noiseHit(ctx, out, t, 1.6, 400, gain * 0.7, 'lowpass', 0.8, 'pink');
  noiseHit(ctx, out, t, 0.05, 3000, gain * 0.3, 'bandpass', 0.8);
}
