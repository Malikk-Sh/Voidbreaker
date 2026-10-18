import { arp, bell, choir, env, glassTail, industrial, kick, mtof, noiseHit, osc, saturator, tom, type Ctx } from './synth';

/**
 * Рецепты SFX (GDD §18.5). Все звуки синтезируются и «запекаются» в буферы при загрузке (OfflineAudioContext);
 * в бою — дешёвое воспроизведение с вариацией высоты и фильтра.
 */
export interface SfxRecipe { len: number; variants?: number; render: (ctx: Ctx, out: AudioNode, t: number) => void }

const sweep = (ctx: Ctx, out: AudioNode, t: number, f0: number, f1: number, dur: number, gain: number, q = 1.2): void => {
  const { f } = noiseHit(ctx, out, t, dur, f0, gain, 'bandpass', q, 'pink');
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.9);
};

/** Тело удара: синус с падением высоты. */
const body = (ctx: Ctx, out: AudioNode, t: number, f0: number, f1: number, dur: number, gain: number): void => {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
  env(g.gain, t, gain, 0.002, dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
};

const growl = (ctx: Ctx, out: AudioNode, t: number, dur: number, f0: number, gain: number): void => {
  const sat = saturator(ctx, 4);
  const g = ctx.createGain();
  env(g.gain, t, gain, 0.08, dur, 0.0001, dur * 0.3);
  sat.connect(g).connect(out);
  for (const [fq, q] of [[f0 * 2.2, 5], [f0 * 4.5, 6], [f0 * 7, 8]] as const) {
    const { f } = noiseHit(ctx, sat, t, dur, fq, gain * 2, 'bandpass', q);
    f.frequency.setValueAtTime(fq, t);
    f.frequency.exponentialRampToValueAtTime(fq * 0.6, t + dur);
  }
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + dur);
  const og = ctx.createGain(); env(og.gain, t, gain * 0.5, 0.05, dur);
  o.connect(og).connect(sat); o.start(t); o.stop(t + dur + 0.05);
};

export const SFX: Record<string, SfxRecipe> = {
  // взмахи клинка: розовый шум, полосовой фильтр скользит 600 → 3000 Гц за 0.12 с + шипение
  swing_light: { len: 0.25, variants: 3, render: (c, o, t) => { sweep(c, o, t, 600, 3000, 0.12, 0.5); noiseHit(c, o, t + 0.02, 0.06, 7000, 0.12, 'highpass', 0.7); } },
  swing_heavy: { len: 0.4, variants: 2, render: (c, o, t) => { sweep(c, o, t, 300, 2200, 0.24, 0.7, 0.9); body(c, o, t, 90, 50, 0.25, 0.25); } },
  swing_spin: { len: 0.45, variants: 2, render: (c, o, t) => { sweep(c, o, t, 500, 2800, 0.16, 0.45); sweep(c, o, t + 0.12, 2800, 700, 0.18, 0.4); } },
  swing_stab: { len: 0.15, variants: 3, render: (c, o, t) => { sweep(c, o, t, 1500, 5000, 0.06, 0.35, 2); } },
  swing_charged: { len: 0.6, render: (c, o, t) => { sweep(c, o, t, 200, 4500, 0.32, 0.8, 0.8); osc(c, 'sine', 1760, t, 0.3, o, 0.08, 0.01, 0.4); body(c, o, t, 70, 35, 0.4, 0.4); } },
  // попадания: щелчок + тело + «стеклянный» хвост
  hit_light: { len: 0.4, variants: 3, render: (c, o, t) => { noiseHit(c, o, t, 0.005, 5000, 0.6, 'highpass', 0.6); body(c, o, t, 240, 42, 0.16, 0.7); glassTail(c, o, t + 0.01, 3, 0.06); noiseHit(c, o, t, 0.05, 1200, 0.25, 'bandpass', 1); } },
  hit_medium: { len: 0.5, variants: 3, render: (c, o, t) => { noiseHit(c, o, t, 0.006, 4500, 0.7, 'highpass', 0.6); body(c, o, t, 190, 40, 0.22, 0.85); glassTail(c, o, t + 0.01, 4, 0.07); noiseHit(c, o, t, 0.08, 900, 0.35, 'bandpass', 1); } },
  hit_heavy: { len: 0.8, variants: 2, render: (c, o, t) => { noiseHit(c, o, t, 0.008, 4000, 0.8, 'highpass', 0.6); body(c, o, t, 130, 42, 0.38, 1); body(c, o, t, 45, 40, 0.2, 0.6); glassTail(c, o, t + 0.01, 5, 0.08); noiseHit(c, o, t, 0.14, 700, 0.5, 'lowpass', 1); } },
  posture_break: { len: 2.2, render: (c, o, t) => {
    for (let i = 0; i < 14; i++) noiseHit(c, o, t + Math.random() * 0.08, 0.004, 3000 + Math.random() * 3000, 0.5, 'highpass', 1);
    body(c, o, t + 0.05, 110, 32, 0.6, 1); kick(c, o, t + 0.05, 0.6, 30); bell(c, o, t + 0.06, 220, 0.18, 2);
  } },
  shatter: { len: 0.7, variants: 3, render: (c, o, t) => { glassTail(c, o, t, 10, 0.07); noiseHit(c, o, t, 0.12, 5000, 0.25, 'highpass', 0.8); body(c, o, t, 180, 60, 0.12, 0.3); } },
  shatter_big: { len: 1.3, render: (c, o, t) => { glassTail(c, o, t, 18, 0.08); noiseHit(c, o, t, 0.6, 400, 0.6, 'lowpass', 0.8); body(c, o, t, 90, 30, 0.5, 0.8); for (let i = 0; i < 6; i++) noiseHit(c, o, t + 0.1 + Math.random() * 0.4, 0.05, 800 + Math.random() * 600, 0.25, 'bandpass', 2); } },
  // рывок: короткий шумовой «фшх» с реверс-огибающей
  dash: { len: 0.3, variants: 2, render: (c, o, t) => {
    const { f, s } = noiseHit(c, o, t, 0.2, 1400, 0.5, 'bandpass', 0.8, 'pink'); void s;
    f.frequency.setValueAtTime(800, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.15);
  } },
  // идеальное уклонение: реверс-нарастание шума + чистый высокий «тинь»
  perfect_dodge: { len: 1.4, render: (c, o, t) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    const { f } = noiseHit(c, g, t, 0.3, 2000, 1, 'bandpass', 1, 'pink'); f.frequency.exponentialRampToValueAtTime(6000, t + 0.22); g.connect(o);
    osc(c, 'sine', 3520, t + 0.22, 1, o, 0.18, 0.002, 1.0); osc(c, 'sine', 2637, t + 0.22, 1, o, 0.1, 0.002, 1.1); osc(c, 'sine', 5274, t + 0.22, 0.6, o, 0.05, 0.002, 0.6);
  } },
  hurt: { len: 0.6, render: (c, o, t) => { body(c, o, t, 160, 50, 0.25, 0.9); const s = saturator(c, 6); s.connect(o); noiseHit(c, s, t, 0.12, 900, 0.4, 'bandpass', 1.5); osc(c, 'square', 330, t, 0.15, o, 0.05, 0.002, 0.15); } },
  death: { len: 2.5, render: (c, o, t) => { glassTail(c, o, t, 20, 0.07); body(c, o, t, 100, 25, 1.4, 1); const { f } = noiseHit(c, o, t, 1.8, 2000, 0.4, 'bandpass', 1, 'pink'); f.frequency.exponentialRampToValueAtTime(150, t + 1.7); bell(c, o, t + 0.1, 146.8, 0.12, 2.3); } },
  // телеграфы врагов: гул с нарастающим фильтром / свист / звон
  tele_hum: { len: 0.7, render: (c, o, t) => { const { f } = noiseHit(c, o, t, 0.55, 200, 0.25, 'lowpass', 4); f.frequency.exponentialRampToValueAtTime(1600, t + 0.5); osc(c, 'sawtooth', 70, t, 0.55, o, 0.04, 0.2, 0.35); } },
  tele_whistle: { len: 0.7, render: (c, o, t) => { const ox = osc(c, 'sine', 700, t, 0.6, o, 0.06, 0.1, 0.5); ox.frequency.exponentialRampToValueAtTime(2300, t + 0.55); noiseHit(c, o, t, 0.5, 3000, 0.06, 'bandpass', 4); } },
  tele_chime: { len: 0.6, render: (c, o, t) => { osc(c, 'sine', 1244, t, 0.4, o, 0.07, 0.002, 0.4); osc(c, 'sine', 1864, t + 0.05, 0.35, o, 0.05, 0.002, 0.35); } },
  tele_bell: { len: 3, render: (c, o, t) => bell(c, o, t, 196, 0.22, 3) },
  tele_roar: { len: 1.0, render: (c, o, t) => growl(c, o, t, 0.8, 70, 0.35) },
  shot: { len: 0.3, variants: 2, render: (c, o, t) => { const x = osc(c, 'sine', 950, t, 0.12, o, 0.15, 0.002, 0.12); x.frequency.exponentialRampToValueAtTime(260, t + 0.12); noiseHit(c, o, t, 0.06, 2500, 0.15, 'bandpass', 1.5); } },
  proj_hit: { len: 0.3, render: (c, o, t) => { noiseHit(c, o, t, 0.08, 1800, 0.3, 'bandpass', 1); body(c, o, t, 300, 80, 0.08, 0.3); } },
  slam: { len: 1.0, render: (c, o, t) => { kick(c, o, t, 1, 28); noiseHit(c, o, t, 0.5, 500, 0.7, 'lowpass', 0.7); for (let i = 0; i < 5; i++) noiseHit(c, o, t + 0.05 + Math.random() * 0.3, 0.06, 600 + Math.random() * 800, 0.2, 'bandpass', 2); } },
  bite: { len: 0.2, variants: 2, render: (c, o, t) => { noiseHit(c, o, t, 0.02, 3000, 0.35, 'bandpass', 2); noiseHit(c, o, t + 0.05, 0.02, 2200, 0.4, 'bandpass', 2); } },
  slash_enemy: { len: 0.35, render: (c, o, t) => { sweep(c, o, t, 2500, 800, 0.2, 0.5, 2); osc(c, 'sawtooth', 600, t, 0.1, o, 0.04, 0.002, 0.15); } },
  beam: { len: 0.6, render: (c, o, t) => { const x = osc(c, 'sawtooth', 220, t, 0.5, o, 0.05, 0.05, 0.45); x.frequency.exponentialRampToValueAtTime(880, t + 0.45); } },
  portal: { len: 1.0, variants: 2, render: (c, o, t) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8); g.connect(o);
    const { f } = noiseHit(c, g, t, 0.85, 300, 1, 'bandpass', 2, 'pink'); f.frequency.exponentialRampToValueAtTime(2500, t + 0.75);
    osc(c, 'sine', 55, t, 0.8, o, 0.15, 0.4, 0.4);
  } },
  // стингер волны: колокол + удар + хоровой аккорд
  stinger: { len: 3.2, render: (c, o, t) => { bell(c, o, t, mtof(62), 0.2, 3); kick(c, o, t, 0.6, 35); choir(c, o, t, [50, 57, 62, 65], 1.4, 0.06, 'a', 'o'); } },
  wave_clear: { len: 2.5, render: (c, o, t) => { bell(c, o, t, mtof(69), 0.14, 2.2); bell(c, o, t + 0.12, mtof(74), 0.12, 2.2); } },
  pickup: { len: 0.4, variants: 3, render: (c, o, t) => { const n = [74, 77, 79, 81, 84][Math.floor(Math.random() * 5)]; osc(c, 'sine', mtof(n + 12), t, 0.25, o, 0.06, 0.002, 0.25); osc(c, 'sine', mtof(n + 19), t + 0.03, 0.2, o, 0.03, 0.002, 0.2); } },
  pickup_ether: { len: 1.2, render: (c, o, t) => { [74, 78, 81, 86].forEach((n, i) => osc(c, 'sine', mtof(n + 12), t + i * 0.06, 0.8, o, 0.05, 0.002, 0.9)); } },
  charge1: { len: 0.8, render: (c, o, t) => { osc(c, 'sine', 1320, t, 0.6, o, 0.06, 0.01, 0.6); osc(c, 'sine', 1980, t, 0.5, o, 0.03, 0.01, 0.5); } },
  charge2: { len: 2.0, render: (c, o, t) => { bell(c, o, t, 880, 0.12, 1.8); osc(c, 'sine', 3520, t, 1.2, o, 0.04, 0.002, 1.2); } },
  crescent: { len: 0.5, render: (c, o, t) => { sweep(c, o, t, 1200, 4000, 0.2, 0.35, 1.5); osc(c, 'sine', 2093, t, 0.35, o, 0.05, 0.01, 0.35); osc(c, 'sine', 2637, t + 0.02, 0.3, o, 0.03, 0.01, 0.3); } },
  phase: { len: 0.6, render: (c, o, t) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); g.connect(o);
    noiseHit(c, g, t, 0.2, 2500, 1, 'bandpass', 1, 'pink'); const x = osc(c, 'sawtooth', 220, t + 0.08, 0.2, o, 0.08, 0.002, 0.2); x.frequency.exponentialRampToValueAtTime(1760, t + 0.25); glassTail(c, o, t + 0.1, 4, 0.05);
  } },
  well: { len: 2.2, render: (c, o, t) => { const { f } = noiseHit(c, o, t, 2.0, 3000, 0.25, 'bandpass', 3, 'pink'); f.frequency.exponentialRampToValueAtTime(150, t + 2); osc(c, 'sine', 45, t, 2, o, 0.3, 0.3, 1.7); } },
  well_boom: { len: 1.5, render: (c, o, t) => { kick(c, o, t, 1, 30); glassTail(c, o, t, 10, 0.07); noiseHit(c, o, t, 0.6, 600, 0.5, 'lowpass', 1); } },
  ult: { len: 3.5, render: (c, o, t) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); g.connect(o);
    const { f } = noiseHit(c, g, t, 0.5, 400, 1, 'bandpass', 1.2, 'pink'); f.frequency.exponentialRampToValueAtTime(5000, t + 0.48);
    kick(c, o, t + 0.48, 1, 25); bell(c, o, t + 0.48, mtof(50), 0.22, 3); choir(c, o, t + 0.45, [50, 57, 62, 65, 69], 2.2, 0.07, 'a', 'u'); glassTail(c, o, t + 0.5, 12, 0.06);
  } },
  // Раскол: хруст обсидиана + стеклянный хвост осколков
  shatter_burst: { len: 2.2, render: (c, o, t) => { kick(c, o, t, 0.9, 32); noiseHit(c, o, t, 0.25, 3200, 0.55, 'highpass', 0.8); body(c, o, t, 70, 32, 0.35, 0.6); glassTail(c, o, t, 20, 0.07); noiseHit(c, o, t, 0.35, 450, 0.45, 'lowpass', 1); } },
  bell_crack: { len: 2.6, render: (c, o, t) => { bell(c, o, t, 103, 0.22, 2.4); noiseHit(c, o, t, 0.2, 2400, 0.4, 'bandpass', 1.5); glassTail(c, o, t, 12, 0.06); } },
  ui_click: { len: 0.2, render: (c, o, t) => { osc(c, 'sine', 1568, t, 0.1, o, 0.05, 0.001, 0.1); osc(c, 'sine', 2350, t, 0.06, o, 0.02, 0.001, 0.06); } },
  ui_confirm: { len: 0.6, render: (c, o, t) => { bell(c, o, t, mtof(74), 0.06, 0.6); bell(c, o, t + 0.07, mtof(81), 0.05, 0.6); } },
  ui_back: { len: 0.25, render: (c, o, t) => { osc(c, 'triangle', 440, t, 0.1, o, 0.06, 0.001, 0.12); noiseHit(c, o, t, 0.03, 2000, 0.05, 'bandpass', 2); } },
  // «камень по металлу» + восходящие колокольчики
  ui_upgrade: { len: 1.6, render: (c, o, t) => { industrial(c, o, t, 0.25, 330); [62, 69, 74, 81].forEach((n, i) => bell(c, o, t + 0.05 + i * 0.07, mtof(n), 0.05, 1.2)); } },
  boss_bell: { len: 5, render: (c, o, t) => { bell(c, o, t, 98, 0.35, 5); kick(c, o, t, 0.5, 30); } },
  boss_roar: { len: 2.0, render: (c, o, t) => { growl(c, o, t, 1.6, 55, 0.45); bell(c, o, t, 73.4, 0.15, 1.8); } },
  step_heavy: { len: 0.4, variants: 2, render: (c, o, t) => { body(c, o, t, 80, 35, 0.2, 0.5); noiseHit(c, o, t, 0.12, 300, 0.2, 'lowpass', 1); } },
  heartbeat: { len: 0.6, render: (c, o, t) => { body(c, o, t, 70, 40, 0.12, 0.7); body(c, o, t + 0.18, 62, 38, 0.14, 0.55); } },
  rank_up: { len: 1.2, render: (c, o, t) => { bell(c, o, t, mtof(81), 0.08, 1.1); sweep(c, o, t, 800, 4000, 0.15, 0.15, 1.5); } },
  victory: { len: 4.5, render: (c, o, t) => { choir(c, o, t, [50, 57, 62, 66, 69], 3, 0.07, 'a', 'o'); [62, 66, 69, 74].forEach((n, i) => bell(c, o, t + i * 0.25, mtof(n), 0.1, 2.5)); } },
  defeat: { len: 4, render: (c, o, t) => { choir(c, o, t, [38, 45, 50, 53], 2.8, 0.06, 'o', 'u'); bell(c, o, t, mtof(38), 0.15, 3.5); } },
  boss_intro: { len: 4, render: (c, o, t) => { kick(c, o, t, 1.1, 22); body(c, o, t, 50, 28, 2, 0.8); bell(c, o, t, 65.4, 0.3, 4); const { f } = noiseHit(c, o, t, 2.5, 200, 0.3, 'lowpass', 1); f.frequency.exponentialRampToValueAtTime(60, t + 2.4); } },
  tom_hit: { len: 0.6, render: (c, o, t) => tom(c, o, t, 90, 0.7) },
  arp_blip: { len: 0.3, render: (c, o, t) => arp(c, o, t, 74, 0.2, 0.06) },
};
