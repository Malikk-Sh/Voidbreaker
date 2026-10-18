import { arp, bell, choir, chips, crunch, env, glassTail, industrial, kick, metal, mtof, noiseHit, osc, pluck, punch, saturator, sub, tom, transient, voidHiss, type Ctx } from './synth';

/**
 * Рецепты SFX (GDD §18.5). Все звуки синтезируются и «запекаются» в буферы при загрузке (OfflineAudioContext);
 * в бою — дешёвое воспроизведение с вариацией высоты и фильтра.
 */
export interface SfxRecipe {
  len: number;
  variants?: number;
  /** Отправка в реверберацию по умолчанию (удары — 0.05–0.08; колокола, ульта, рёв — больше). */
  reverb?: number;
  render: (ctx: Ctx, out: AudioNode, t: number) => void;
}

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

/** Приглушённое гудение колокола: низкие партиалы без удара, медленное вибрато, закрытый фильтр. */
const hum = (ctx: Ctx, out: AudioNode, t: number, f0: number, dur: number, gain: number): void => {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 0.4;
  const g = ctx.createGain();
  env(g.gain, t, gain, 0.18, dur, 0.0001, dur * 0.35);
  lp.connect(g).connect(out);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 2.4;
  lfo.start(t); lfo.stop(t + dur + 0.1);
  for (const [m, a] of [[1, 1], [2, 0.42], [2.76, 0.2], [3.0, 0.16]] as const) {
    const o = ctx.createOscillator(); o.frequency.value = f0 * m;
    const dv = ctx.createGain(); dv.gain.value = f0 * m * 0.011;
    lfo.connect(dv).connect(o.frequency);
    const og = ctx.createGain(); og.gain.value = a;
    o.connect(og).connect(lp); o.start(t); o.stop(t + dur + 0.1);
  }
};

export const SFX: Record<string, SfxRecipe> = {
  // взмахи клинка: розовый шум, полосовой фильтр скользит 600 → 3000 Гц за 0.12 с + шипение
  swing_light: { len: 0.25, variants: 5, render: (c, o, t) => { sweep(c, o, t, 400, 1800, 0.12, 0.5); noiseHit(c, o, t, 0.08, 300, 0.22, 'lowpass', 0.7, 'pink'); } },
  swing_heavy: { len: 0.4, variants: 3, render: (c, o, t) => { sweep(c, o, t, 280, 1500, 0.24, 0.7, 0.9); body(c, o, t, 90, 50, 0.25, 0.25); noiseHit(c, o, t, 0.12, 260, 0.3, 'lowpass', 0.7, 'pink'); } },
  swing_spin: { len: 0.45, variants: 3, render: (c, o, t) => { sweep(c, o, t, 400, 1800, 0.16, 0.45); sweep(c, o, t + 0.12, 1800, 500, 0.18, 0.4); noiseHit(c, o, t, 0.08, 300, 0.22, 'lowpass', 0.7, 'pink'); } },
  swing_stab: { len: 0.15, variants: 4, render: (c, o, t) => { sweep(c, o, t, 700, 1800, 0.06, 0.35, 2); noiseHit(c, o, t, 0.06, 300, 0.15, 'lowpass', 0.7, 'pink'); } },
  swing_charged: { len: 0.6, render: (c, o, t) => { sweep(c, o, t, 200, 1800, 0.32, 0.8, 0.8); voidHiss(c, o, t + 0.05, 0.3, 0.14); body(c, o, t, 70, 35, 0.4, 0.4); } },
  // попадания (план §5.2): атака + удар + хруст + сколы + шипение Пустоты; без «стеклянного» хвоста
  hit_light: { len: 0.35, variants: 5, reverb: 0.05, render: (c, o, t) => { transient(c, o, t, 2400, 0.7); punch(c, o, t, 200, 60, 0.10, 0.8, 3); crunch(c, o, t, 720, 0.05, 0.35); chips(c, o, t, 3, 0.16); voidHiss(c, o, t, 0.10, 0.12, 2100); } },
  hit_medium: { len: 0.45, variants: 4, reverb: 0.06, render: (c, o, t) => { transient(c, o, t, 2000, 0.7); punch(c, o, t, 170, 52, 0.14, 0.9, 4); crunch(c, o, t, 600, 0.07, 0.45); chips(c, o, t, 4, 0.2); voidHiss(c, o, t, 0.14, 0.15, 2000); } },
  hit_heavy: { len: 0.8, variants: 3, reverb: 0.08, render: (c, o, t) => { transient(c, o, t, 1700, 0.75); punch(c, o, t, 140, 45, 0.22, 1, 5); sub(c, o, t, 62, 38, 0.25, 0.7); crunch(c, o, t, 480, 0.12, 0.6); chips(c, o, t, 6, 0.22, 0.05); voidHiss(c, o, t, 0.2, 0.16, 1700); noiseHit(c, o, t + 0.02, 0.3, 300, 0.3, 'lowpass', 0.8, 'pink'); } },
  hit_crowd: { len: 0.5, variants: 2, reverb: 0.05, render: (c, o, t) => { punch(c, o, t, 120, 45, 0.18, 0.7, 3); crunch(c, o, t, 380, 0.12, 0.5); chips(c, o, t, 8, 0.12, 0.08); } },
  // по броне (неуязвимая цель, щит): звон значит «броня» — единственный металлический акцент удара
  hit_armor: { len: 0.5, variants: 3, reverb: 0.08, render: (c, o, t) => { transient(c, o, t, 2600, 0.4); punch(c, o, t, 220, 90, 0.06, 0.4, 2); metal(c, o, t, 1300 + Math.random() * 300, 0.1, 0.4); } },
  // в уязвимость (окно, ядро, спина): короткий чистый тон → глубокий резонанс ядра
  hit_weak: { len: 0.9, variants: 2, reverb: 0.1, render: (c, o, t) => { osc(c, 'sine', 1320, t, 0.06, o, 0.06, 0.001, 0.06); sub(c, o, t + 0.03, 110, 55, 0.5, 0.55); crunch(c, o, t, 520, 0.08, 0.4); } },



  // оглушение (план §5.5): удар каменной плиты — низкое тело, хруст, без стекла
  stun_break: { reverb: 0.2, len: 1.6, render: (c, o, t) => {
    transient(c, o, t, 1500, 0.6); punch(c, o, t, 120, 38, 0.3, 1, 5); sub(c, o, t + 0.02, 58, 30, 0.6, 0.9);
    crunch(c, o, t, 320, 0.2, 0.6); noiseHit(c, o, t + 0.03, 0.5, 220, 0.4, 'lowpass', 0.7, 'pink');
  } },
  // …и приглушённый гул колокола с медленным вибрато — низко, без звона
  stun_hum: { reverb: 0.3, len: 3.6, render: (c, o, t) => hum(c, o, t, 73.4, 3.1, 0.34) },
  // погасла звезда: мягкий низкий «тук»
  stun_tick: { len: 0.3, variants: 3, reverb: 0.12, render: (c, o, t) => { body(c, o, t, 190, 120, 0.12, 0.45); noiseHit(c, o, t, 0.03, 900, 0.12, 'lowpass', 0.8, 'pink'); } },
  // гибель: «осыпание» — хруст, каскад сколов, низкий шорох обломков
  shatter: { len: 0.7, variants: 4, reverb: 0.06, render: (c, o, t) => { crunch(c, o, t, 420, 0.12, 0.5); chips(c, o, t, 8, 0.16, 0.14); noiseHit(c, o, t + 0.05, 0.35, 900, 0.25, 'lowpass', 0.7, 'pink'); osc(c, 'sine', 1800, t, 0.12, o, 0.025, 0.002, 0.12); } },
  shatter_wet: { len: 0.6, variants: 3, reverb: 0.05, render: (c, o, t) => { crunch(c, o, t, 350, 0.1, 0.55); noiseHit(c, o, t + 0.03, 0.3, 500, 0.3, 'lowpass', 0.8, 'pink'); chips(c, o, t, 4, 0.1, 0.1); } },
  shatter_stone: { len: 1.0, variants: 2, reverb: 0.1, render: (c, o, t) => { sub(c, o, t, 70, 32, 0.4, 0.8); crunch(c, o, t, 300, 0.18, 0.6); for (let i = 0; i < 10; i++) noiseHit(c, o, t + Math.random() * 0.35, 0.02, 400 + Math.random() * 600, 0.2, 'bandpass', 5); noiseHit(c, o, t + 0.05, 0.6, 250, 0.35, 'lowpass', 0.7, 'pink'); } },
  shatter_energy: { len: 0.9, variants: 2, reverb: 0.12, render: (c, o, t) => { crunch(c, o, t, 600, 0.08, 0.35); glassTail(c, o, t, 6, 0.05); const x = osc(c, 'sine', 900, t, 0.4, o, 0.08, 0.002, 0.4); x.frequency.exponentialRampToValueAtTime(140, t + 0.4); } },
  shatter_big: { len: 1.3, reverb: 0.1, render: (c, o, t) => { sub(c, o, t, 80, 30, 0.5, 0.8); crunch(c, o, t, 380, 0.2, 0.6); noiseHit(c, o, t, 0.6, 400, 0.6, 'lowpass', 0.8); chips(c, o, t, 14, 0.18, 0.4); for (let i = 0; i < 6; i++) noiseHit(c, o, t + 0.1 + Math.random() * 0.5, 0.05, 500 + Math.random() * 500, 0.2, 'bandpass', 4); } },
  // рывок: короткий шумовой «фшх» с реверс-огибающей
  dash: { len: 0.3, variants: 2, render: (c, o, t) => {
    const { f, s } = noiseHit(c, o, t, 0.2, 1400, 0.5, 'bandpass', 0.8, 'pink'); void s;
    f.frequency.setValueAtTime(800, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.15);
  } },
  // идеальное уклонение: реверс-нарастание шума + чистый высокий «тинь»
  // идеальное уклонение: резкий свист «мимо головы» справа налево с падением высоты
  perfect_dodge: { len: 0.8, reverb: 0.12, render: (c, o, t) => {
    const p = c.createStereoPanner(); p.pan.setValueAtTime(0.85, t); p.pan.linearRampToValueAtTime(-0.85, t + 0.28); p.connect(o);
    const { f } = noiseHit(c, p, t, 0.3, 3200, 0.55, 'bandpass', 3, 'pink'); f.frequency.exponentialRampToValueAtTime(700, t + 0.28);
    const x = osc(c, 'sine', 1900, t, 0.26, p, 0.05, 0.004, 0.26); x.frequency.exponentialRampToValueAtTime(520, t + 0.26);
  } },
  // нота лейтмотива Пилота (ре малой октавы — высота меняется playbackRate): челеста + мягкий хор
  motif_note: { len: 2.2, reverb: 0.3, render: (c, o, t) => { pluck(c, o, t, mtof(62 + 12), 1.2, 0.09); pluck(c, o, t, mtof(62 + 24), 0.6, 0.03); choir(c, o, t, [62, 74], 1.0, 0.035, 'o', 'u'); } },
  // «Мгновение Пустоты»: низкий вдох перед замедлением
  void_moment: { len: 1.2, reverb: 0.2, render: (c, o, t) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); g.connect(o);
    const { f } = noiseHit(c, g, t, 0.9, 300, 1, 'lowpass', 1.5, 'pink'); f.frequency.exponentialRampToValueAtTime(900, t + 0.4);
    sub(c, o, t + 0.05, 55, 40, 0.8, 0.35);
  } },
  hurt: { len: 0.6, render: (c, o, t) => { body(c, o, t, 160, 50, 0.25, 0.9); const s = saturator(c, 6); s.connect(o); noiseHit(c, s, t, 0.12, 900, 0.4, 'bandpass', 1.5); osc(c, 'square', 330, t, 0.15, o, 0.05, 0.002, 0.15); } },
  death: { len: 2.5, render: (c, o, t) => { chips(c, o, t, 10, 0.14, 0.3); body(c, o, t, 100, 25, 1.4, 1); const { f } = noiseHit(c, o, t, 1.8, 2000, 0.4, 'bandpass', 1, 'pink'); f.frequency.exponentialRampToValueAtTime(150, t + 1.7); bell(c, o, t + 0.1, 146.8, 0.12, 2.3); } },
  // телеграфы врагов: гул с нарастающим фильтром / свист / звон
  tele_hum: { len: 0.7, render: (c, o, t) => { const { f } = noiseHit(c, o, t, 0.55, 200, 0.25, 'lowpass', 4); f.frequency.exponentialRampToValueAtTime(1600, t + 0.5); osc(c, 'sawtooth', 70, t, 0.55, o, 0.04, 0.2, 0.35); } },
  tele_whistle: { len: 0.7, render: (c, o, t) => { const ox = osc(c, 'sine', 700, t, 0.6, o, 0.06, 0.1, 0.5); ox.frequency.exponentialRampToValueAtTime(2300, t + 0.55); noiseHit(c, o, t, 0.5, 3000, 0.06, 'bandpass', 4); } },
  tele_chime: { len: 0.6, render: (c, o, t) => { osc(c, 'sine', 1244, t, 0.4, o, 0.07, 0.002, 0.4); osc(c, 'sine', 1864, t + 0.05, 0.35, o, 0.05, 0.002, 0.35); } },
  tele_bell: { reverb: 0.25, len: 3, render: (c, o, t) => bell(c, o, t, 196, 0.22, 3) },
  tele_roar: { len: 1.0, render: (c, o, t) => growl(c, o, t, 0.8, 70, 0.35) },
  // слой замаха по классу врага: рой — щелчки, дуэлянт — свист стали, тяжёлый — каменный скрежет, поддержка — хоровой тон
  tele_click: { len: 0.5, variants: 3, render: (c, o, t) => { for (let i = 0; i < 4; i++) noiseHit(c, o, t + i * 0.07 + Math.random() * 0.02, 0.008, 2500 + Math.random() * 900, 0.18, 'bandpass', 7); } },
  tele_steel: { len: 0.7, variants: 2, render: (c, o, t) => { const x = osc(c, 'sawtooth', 1100, t, 0.5, o, 0.025, 0.08, 0.45); x.frequency.exponentialRampToValueAtTime(2400, t + 0.45); const { f } = noiseHit(c, o, t, 0.5, 2000, 0.12, 'bandpass', 8); f.frequency.exponentialRampToValueAtTime(4200, t + 0.45); } },
  tele_grind: { len: 1.0, variants: 2, render: (c, o, t) => { const sat = saturator(c, 5); const g = c.createGain(); env(g.gain, t, 0.3, 0.15, 0.7); sat.connect(g).connect(o); const { f } = noiseHit(c, sat, t, 0.8, 140, 1, 'bandpass', 3, 'pink'); f.frequency.exponentialRampToValueAtTime(320, t + 0.8); for (let i = 0; i < 6; i++) noiseHit(c, o, t + Math.random() * 0.7, 0.02, 500 + Math.random() * 400, 0.12, 'bandpass', 5); } },
  tele_choir: { len: 1.0, render: (c, o, t) => choir(c, o, t, [69, 76], 0.6, 0.05, 'o', 'a') },
  shot: { len: 0.3, variants: 2, render: (c, o, t) => { const x = osc(c, 'sine', 950, t, 0.12, o, 0.15, 0.002, 0.12); x.frequency.exponentialRampToValueAtTime(260, t + 0.12); noiseHit(c, o, t, 0.06, 2500, 0.15, 'bandpass', 1.5); } },
  proj_hit: { len: 0.3, render: (c, o, t) => { noiseHit(c, o, t, 0.08, 1800, 0.3, 'bandpass', 1); body(c, o, t, 300, 80, 0.08, 0.3); } },
  slam: { len: 1.0, render: (c, o, t) => { kick(c, o, t, 1, 28); noiseHit(c, o, t, 0.5, 500, 0.7, 'lowpass', 0.7); for (let i = 0; i < 5; i++) noiseHit(c, o, t + 0.05 + Math.random() * 0.3, 0.06, 600 + Math.random() * 800, 0.2, 'bandpass', 2); } },
  // Распинатель: гвоздь в камень, клинок застрял и скрежещет, шипы из пола, искры волочащихся клинков
  nail: { len: 0.9, reverb: 0.1, render: (c, o, t) => { transient(c, o, t, 2200, 0.7); metal(c, o, t, 880, 0.16, 0.5); sub(c, o, t, 72, 34, 0.3, 0.65); crunch(c, o, t, 380, 0.12, 0.5); chips(c, o, t, 6, 0.16, 0.1); } },
  nail_strain: { len: 1.4, render: (c, o, t) => { const { f } = noiseHit(c, o, t + 0.1, 1.1, 1100, 0.12, 'bandpass', 7); f.frequency.linearRampToValueAtTime(700, t + 1.2); for (let i = 0; i < 5; i++) metal(c, o, t + 0.15 + i * 0.22 + Math.random() * 0.05, 1500 + Math.random() * 400, 0.04, 0.12); } },
  spikes: { len: 0.8, variants: 2, reverb: 0.08, render: (c, o, t) => { crunch(c, o, t, 520, 0.1, 0.55); chips(c, o, t, 8, 0.14, 0.08); body(c, o, t, 130, 50, 0.16, 0.6); noiseHit(c, o, t, 0.25, 1300, 0.22, 'bandpass', 2); } },
  blade_scrape: { len: 0.25, variants: 3, render: (c, o, t) => { noiseHit(c, o, t, 0.12, 3600 + Math.random() * 800, 0.07, 'bandpass', 6); metal(c, o, t, 2600 + Math.random() * 600, 0.015, 0.1); } },
  // Псаломщик: хоровой псалм и натянутая нить, хлёсткий разрыв нити, перезвон плит, разлёт плит
  psalm_link: { reverb: 0.3, len: 1.8, render: (c, o, t) => { choir(c, o, t, [50, 57, 62], 1.1, 0.045, 'o', 'u'); const x = osc(c, 'sawtooth', 300, t, 0.6, o, 0.025, 0.2, 0.4); x.frequency.exponentialRampToValueAtTime(900, t + 0.6); } },
  thread_snap: { len: 0.5, variants: 2, reverb: 0.08, render: (c, o, t) => { transient(c, o, t, 3400, 0.6); noiseHit(c, o, t, 0.05, 3000, 0.35, 'bandpass', 1); sweep(c, o, t + 0.01, 2600, 400, 0.14, 0.35, 2); } },
  chime_ring: { reverb: 0.25, len: 2.2, render: (c, o, t) => { bell(c, o, t, 587, 0.12, 1.8); bell(c, o, t + 0.02, 880, 0.07, 1.4); kick(c, o, t, 0.45, 40); } },
  plates_scatter: { len: 0.8, reverb: 0.1, render: (c, o, t) => { glassTail(c, o, t, 6, 0.05); crunch(c, o, t, 700, 0.06, 0.3); chips(c, o, t, 5, 0.12, 0.12); } },
  bite: { len: 0.2, variants: 2, render: (c, o, t) => { noiseHit(c, o, t, 0.02, 3000, 0.35, 'bandpass', 2); noiseHit(c, o, t + 0.05, 0.02, 2200, 0.4, 'bandpass', 2); } },
  slash_enemy: { len: 0.35, render: (c, o, t) => { sweep(c, o, t, 2500, 800, 0.2, 0.5, 2); osc(c, 'sawtooth', 600, t, 0.1, o, 0.04, 0.002, 0.15); } },
  beam: { len: 0.6, render: (c, o, t) => { const x = osc(c, 'sawtooth', 220, t, 0.5, o, 0.05, 0.05, 0.45); x.frequency.exponentialRampToValueAtTime(880, t + 0.45); } },
  portal: { len: 1.0, variants: 2, render: (c, o, t) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8); g.connect(o);
    const { f } = noiseHit(c, g, t, 0.85, 300, 1, 'bandpass', 2, 'pink'); f.frequency.exponentialRampToValueAtTime(2500, t + 0.75);
    osc(c, 'sine', 55, t, 0.8, o, 0.15, 0.4, 0.4);
  } },
  // стингер волны: колокол + удар + хоровой аккорд
  stinger: { reverb: 0.25, len: 3.2, render: (c, o, t) => { bell(c, o, t, mtof(62), 0.2, 3); kick(c, o, t, 0.6, 35); choir(c, o, t, [50, 57, 62, 65], 1.4, 0.06, 'a', 'o'); } },
  wave_clear: { reverb: 0.25, len: 2.5, render: (c, o, t) => { bell(c, o, t, mtof(69), 0.14, 2.2); bell(c, o, t + 0.12, mtof(74), 0.12, 2.2); } },
  pickup: { len: 0.4, variants: 5, reverb: 0.05, render: (c, o, t) => { const n = [62, 65, 67, 69, 72][Math.floor(Math.random() * 5)]; pluck(c, o, t, mtof(n + 12), 0.28, 0.07); pluck(c, o, t + 0.03, mtof(n + 19), 0.2, 0.03); } },
  pickup_ether: { len: 1.2, render: (c, o, t) => { [74, 78, 81, 86].forEach((n, i) => osc(c, 'sine', mtof(n + 12), t + i * 0.06, 0.8, o, 0.05, 0.002, 0.9)); } },
  charge1: { len: 0.8, render: (c, o, t) => { osc(c, 'sine', 1320, t, 0.6, o, 0.06, 0.01, 0.6); osc(c, 'sine', 1980, t, 0.5, o, 0.03, 0.01, 0.5); } },
  charge2: { len: 2.0, render: (c, o, t) => { bell(c, o, t, 880, 0.12, 1.8); osc(c, 'sine', 3520, t, 1.2, o, 0.04, 0.002, 1.2); } },
  crescent: { len: 0.5, render: (c, o, t) => { sweep(c, o, t, 1200, 4000, 0.2, 0.35, 1.5); osc(c, 'sine', 2093, t, 0.35, o, 0.05, 0.01, 0.35); osc(c, 'sine', 2637, t + 0.02, 0.3, o, 0.03, 0.01, 0.3); } },
  phase: { len: 0.6, render: (c, o, t) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); g.connect(o);
    noiseHit(c, g, t, 0.2, 2500, 1, 'bandpass', 1, 'pink'); const x = osc(c, 'sawtooth', 220, t + 0.08, 0.2, o, 0.08, 0.002, 0.2); x.frequency.exponentialRampToValueAtTime(1760, t + 0.25);
  } },
  well: { len: 2.2, render: (c, o, t) => { const { f } = noiseHit(c, o, t, 2.0, 3000, 0.25, 'bandpass', 3, 'pink'); f.frequency.exponentialRampToValueAtTime(150, t + 2); osc(c, 'sine', 45, t, 2, o, 0.3, 0.3, 1.7); } },
  well_boom: { reverb: 0.25, len: 1.5, render: (c, o, t) => { kick(c, o, t, 1, 30); chips(c, o, t, 8, 0.16, 0.2); noiseHit(c, o, t, 0.6, 600, 0.5, 'lowpass', 1); } },
  ult: { reverb: 0.25, len: 3.5, render: (c, o, t) => {
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); g.connect(o);
    const { f } = noiseHit(c, g, t, 0.5, 400, 1, 'bandpass', 1.2, 'pink'); f.frequency.exponentialRampToValueAtTime(5000, t + 0.48);
    kick(c, o, t + 0.48, 1, 25); bell(c, o, t + 0.48, mtof(50), 0.22, 3); choir(c, o, t + 0.45, [50, 57, 62, 65, 69], 2.2, 0.07, 'a', 'u'); 
  } },
  // Раскол: хруст обсидиана + стеклянный хвост осколков
  // Раскол 2.0 (план §5.6): разрез — один чистый высокий удар; затем тишина и тонкий звон; затем разлёт с сабом
  shatter_cut: { reverb: 0.05, len: 0.4, render: (c, o, t) => { transient(c, o, t, 3200, 0.8); sweep(c, o, t, 2400, 7000, 0.07, 0.5, 2.5); osc(c, 'sine', 1760, t, 0.08, o, 0.05, 0.001, 0.08); } },
  shatter_ring: { len: 1.2, render: (c, o, t) => { osc(c, 'sine', 2637, t, 0.9, o, 0.07, 0.004, 0.9); osc(c, 'sine', 3951, t + 0.01, 0.6, o, 0.025, 0.004, 0.6); osc(c, 'sine', 5274, t + 0.02, 0.35, o, 0.012, 0.004, 0.35); } },
  shatter_burst: { reverb: 0.25, len: 2.4, render: (c, o, t) => {
    sub(c, o, t, 64, 28, 0.9, 1); kick(c, o, t, 0.9, 32); punch(c, o, t, 110, 36, 0.3, 0.9, 5); crunch(c, o, t, 360, 0.22, 0.6);
    chips(c, o, t, 16, 0.2, 0.3); noiseHit(c, o, t, 0.5, 420, 0.5, 'lowpass', 0.9, 'pink'); voidHiss(c, o, t + 0.02, 0.3, 0.14, 1600);
  } },
  bell_crack: { reverb: 0.25, len: 2.6, render: (c, o, t) => { bell(c, o, t, 103, 0.22, 2.4); noiseHit(c, o, t, 0.2, 2400, 0.4, 'bandpass', 1.5); crunch(c, o, t, 400, 0.15, 0.4); } },
  // детонация меток Пустоты: короткий «хруст» трещин и шипение
  detonate: { len: 0.4, variants: 3, reverb: 0.06, render: (c, o, t) => { crunch(c, o, t, 900, 0.06, 0.45); chips(c, o, t, 5, 0.14, 0.05); voidHiss(c, o, t, 0.12, 0.12, 2600); } },
  // подача способностей (план §6.9): короткий низкий «вдох» перед кастом, «клац» пойманного Серпа, схлопывание Колодца
  cast_inhale: { len: 0.3, reverb: 0.05, render: (c, o, t) => {
    const { f, s } = noiseHit(c, o, t, 0.16, 300, 0.0001, 'bandpass', 1.2, 'pink'); void s;
    f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.15);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.14); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    noiseHit(c, g, t, 0.17, 500, 0.7, 'lowpass', 0.8, 'pink'); g.connect(o);
    body(c, o, t + 0.02, 60, 95, 0.14, 0.2);
  } },
  sickle_catch: { len: 0.4, variants: 2, reverb: 0.08, render: (c, o, t) => { transient(c, o, t, 3000, 0.6); metal(c, o, t, 1850, 0.14, 0.25); punch(c, o, t, 260, 120, 0.05, 0.4, 2); } },
  well_collapse: { len: 0.6, reverb: 0.15, render: (c, o, t) => {
    const { f } = noiseHit(c, o, t, 0.32, 2400, 0.45, 'bandpass', 2, 'pink');
    f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.3);
    body(c, o, t, 40, 90, 0.32, 0.5);
  } },
  // способность готова: короткий двойной блик
  ability_ready: { len: 0.5, reverb: 0.12, render: (c, o, t) => { pluck(c, o, t, 1175, 0.2, 0.05); pluck(c, o, t + 0.06, 1760, 0.25, 0.04); } },
  ui_click: { len: 0.2, render: (c, o, t) => { osc(c, 'sine', 1568, t, 0.1, o, 0.05, 0.001, 0.1); osc(c, 'sine', 2350, t, 0.06, o, 0.02, 0.001, 0.06); } },
  ui_confirm: { len: 0.6, render: (c, o, t) => { bell(c, o, t, mtof(74), 0.06, 0.6); bell(c, o, t + 0.07, mtof(81), 0.05, 0.6); } },
  ui_back: { len: 0.25, render: (c, o, t) => { osc(c, 'triangle', 440, t, 0.1, o, 0.06, 0.001, 0.12); noiseHit(c, o, t, 0.03, 2000, 0.05, 'bandpass', 2); } },
  // «камень по металлу» + восходящие колокольчики
  ui_upgrade: { len: 1.6, render: (c, o, t) => { industrial(c, o, t, 0.25, 330); [62, 69, 74, 81].forEach((n, i) => bell(c, o, t + 0.05 + i * 0.07, mtof(n), 0.05, 1.2)); } },
  boss_bell: { reverb: 0.25, len: 5, render: (c, o, t) => { bell(c, o, t, 98, 0.35, 5); kick(c, o, t, 0.5, 30); } },
  boss_roar: { reverb: 0.25, len: 2.0, render: (c, o, t) => { growl(c, o, t, 1.6, 55, 0.45); bell(c, o, t, 73.4, 0.15, 1.8); } },
  step_heavy: { len: 0.4, variants: 2, render: (c, o, t) => { body(c, o, t, 80, 35, 0.2, 0.5); noiseHit(c, o, t, 0.12, 300, 0.2, 'lowpass', 1); } },
  heartbeat: { len: 0.6, render: (c, o, t) => { body(c, o, t, 70, 40, 0.12, 0.7); body(c, o, t + 0.18, 62, 38, 0.14, 0.55); } },
  // напряжение при низком HP: пульсирующие низкие струнные и дыхание героя (петля 2 с, музыку не глушит)
  tension: { len: 2.0, reverb: 0, render: (c, o, t) => {
    for (let k = 0; k < 4; k++) {
      const tt = t + k * 0.5, f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 1.5; f.connect(o);
      for (const d of [-8, 7]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = mtof(38); x.detune.value = d; const g = c.createGain(); env(g.gain, tt, 0.07, 0.03, 0.38); x.connect(g).connect(f); x.start(tt); x.stop(tt + 0.45); }
    }
    for (const [at, dur, fq] of [[0.1, 0.55, 900], [1.05, 0.7, 600]] as const) noiseHit(c, o, t + at, dur, fq, 0.06, 'bandpass', 0.8, 'pink');
  } },
  rank_up: { len: 1.2, render: (c, o, t) => { bell(c, o, t, mtof(81), 0.08, 1.1); sweep(c, o, t, 800, 4000, 0.15, 0.15, 1.5); } },
  victory: { reverb: 0.25, len: 4.5, render: (c, o, t) => { choir(c, o, t, [50, 57, 62, 66, 69], 3, 0.07, 'a', 'o'); [62, 66, 69, 74].forEach((n, i) => bell(c, o, t + i * 0.25, mtof(n), 0.1, 2.5)); } },
  defeat: { reverb: 0.25, len: 4, render: (c, o, t) => { choir(c, o, t, [38, 45, 50, 53], 2.8, 0.06, 'o', 'u'); bell(c, o, t, mtof(38), 0.15, 3.5); } },
  boss_intro: { reverb: 0.25, len: 4, render: (c, o, t) => { kick(c, o, t, 1.1, 22); body(c, o, t, 50, 28, 2, 0.8); bell(c, o, t, 65.4, 0.3, 4); const { f } = noiseHit(c, o, t, 2.5, 200, 0.3, 'lowpass', 1); f.frequency.exponentialRampToValueAtTime(60, t + 2.4); } },
  tom_hit: { len: 0.6, render: (c, o, t) => tom(c, o, t, 90, 0.7) },
  arp_blip: { len: 0.3, render: (c, o, t) => arp(c, o, t, 74, 0.2, 0.06) },
};
