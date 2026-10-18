import { makeImpulse, mtof } from './synth';
import { SFX } from './sfx';

export interface PlayOpts { pitch?: number; gain?: number; pan?: number; reverb?: number; delay?: number; vary?: number }

/**
 * Аудио-граф (Tech §21.1):
 *   SFX → sfxBus ─┐
 *   голоса → voiceBus ├→ master → компрессор → выход
 *   секвенсор → musicBus (lowpass, gain) ┘;  reverbSend → Convolver (импульс из кода)
 * Тяжёлые звуки «запекаются» в буферы при загрузке (OfflineAudioContext).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  comp!: DynamicsCompressorNode;
  limiter!: DynamicsCompressorNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  musicFilter!: BiquadFilterNode;
  musicDuck!: GainNode;
  voiceBus!: GainNode;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private recent = new Map<string, number[]>();
  /** Варианты по кругу, без повтора подряд (план §5.2, п. 6). */
  private nextVariant = new Map<string, number>();
  private tension: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private active = 0;
  ready = false;
  baking: Promise<void> | null = null;
  volumes = { master: 0.9, music: 0.6, sfx: 0.9, voice: 0.8 };
  /** Сдвиг высоты музыки (центы) — «Мгновение Пустоты» опускает на −4 полутона. */
  musicDetune = 0;

  /** Создать/возобновить контекст по первому касанию («Нажмите, чтобы начать»). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      // мастер (план §5.2, п. 5): мягкий «клей» не срезает атаку ударов, за ним — лимитер от перегруза
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18; this.comp.knee.value = 6; this.comp.ratio.value = 3;
      this.comp.attack.value = 0.012; this.comp.release.value = 0.25;
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001; this.limiter.release.value = 0.1;
      this.master = ctx.createGain();
      this.master.connect(this.comp).connect(this.limiter).connect(ctx.destination);
      this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
      this.voiceBus = ctx.createGain(); this.voiceBus.connect(this.master);
      this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 20000; this.musicFilter.Q.value = 0.7;
      this.musicDuck = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.musicFilter).connect(this.musicDuck).connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = makeImpulse(ctx, 3.2, 2.4, 0.025);
      this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.9;
      this.reverbSend.connect(this.reverb).connect(this.master);
      this.applyVolumes();
      // iOS: короткий тихий буфер «разблокирует» вывод
      const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start();
      this.baking = this.bakeAll();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx * 0.7, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(this.volumes.voice * 0.6, t, 0.05);
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); }

  /** Запечь все рецепты в буферы (параллельно; ~100–300 мс). */
  private async bakeAll(): Promise<void> {
    const ctx = this.ctx!;
    const sr = Math.min(ctx.sampleRate, 44100);
    const jobs: Promise<void>[] = [];
    for (const [id, r] of Object.entries(SFX)) {
      const n = r.variants ?? 1;
      for (let v = 0; v < n; v++) {
        // стерео: варианты одного звука разведены по панораме ±0.2
        const off = new OfflineAudioContext(2, Math.ceil(sr * r.len), sr);
        const pan = off.createStereoPanner(); pan.pan.value = n > 1 ? ((v / (n - 1)) - 0.5) * 0.4 : 0;
        pan.connect(off.destination);
        const g = off.createGain(); g.connect(pan);
        try { r.render(off, g, 0.005); } catch (e) { console.warn('sfx render', id, e); continue; }
        jobs.push(off.startRendering().then((buf) => {
          const list = this.buffers.get(id) ?? [];
          list.push(buf);
          this.buffers.set(id, list);
        }));
      }
    }
    await Promise.all(jobs);
    this.ready = true;
  }

  /** Воспроизвести запечённый звук: лимит 24 голоса, ≤ 4 одинаковых за 50 мс (GDD §18.7). */
  play(id: string, o: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const list = this.buffers.get(id);
    if (!list || !list.length) return;
    const now = ctx.currentTime;
    const rec = (this.recent.get(id) ?? []).filter((t) => now - t < 0.05);
    if (rec.length >= 4 || this.active >= 24) return;
    rec.push(now); this.recent.set(id, rec);
    const src = ctx.createBufferSource();
    const vi = (this.nextVariant.get(id) ?? Math.floor(Math.random() * list.length)) % list.length;
    this.nextVariant.set(id, vi + 1);
    src.buffer = list[vi];
    const vary = o.vary ?? 0.06;
    src.playbackRate.value = (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    const g = ctx.createGain(); g.gain.value = o.gain ?? 1;
    let node: AudioNode = src;
    node.connect(g); node = g;
    if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(p); node = p; }
    node.connect(this.sfxBus);
    const rv = o.reverb ?? SFX[id]?.reverb ?? 0.08;
    if (rv > 0) { const s = ctx.createGain(); s.gain.value = rv; node.connect(s).connect(this.reverbSend); }
    this.active++;
    src.onended = () => { this.active--; };
    src.start(now + (o.delay ?? 0));
  }

  /** Приглушение музыки на тяжёлых ударах (−3 дБ, GDD §18.7). */
  duck(amount = 0.7, dur = 0.25): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.musicDuck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.02);
    g.linearRampToValueAtTime(1, t + dur);
  }

  /**
   * Напряжение при низком HP (план §5.2, п. 9): петля низких струнных и дыхания поверх музыки,
   * музыку не глушим. level 0..1.
   */
  setTension(level: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.tension && level > 0.01) {
      const buf = this.buffers.get('tension')?.[0];
      if (!buf) return;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(gain).connect(this.sfxBus);
      src.start();
      this.tension = { src, gain };
    }
    if (!this.tension) return;
    this.tension.gain.gain.setTargetAtTime(level * 0.9, ctx.currentTime, 0.4);
    if (level <= 0.01 && this.tension.gain.gain.value < 0.01) { this.tension.src.stop(); this.tension = null; }
  }

  /** Фильтр музыки: «Мгновение Пустоты» — ФНЧ 1200 Гц; иначе открыт. */
  setMusicFilter(freq: number, tau = 0.15): void {
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(freq, this.ctx.currentTime, tau);
  }

  /** «Голос машины» Каэлис: формантные слоги-блипы в ритме текста с металлическим фильтром (GDD §18.6). */
  speak(text: string, pitch = 1, speaker: 'kaelis' | 'boss' = 'kaelis'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const syll = Math.min(14, Math.max(2, Math.round(text.replace(/[^а-яёa-z]/gi, '').length / 3)));
    let t = ctx.currentTime + 0.02;
    const out = ctx.createGain(); out.gain.value = speaker === 'boss' ? 0.5 : 0.35;
    const comb = ctx.createDelay(0.02); comb.delayTime.value = speaker === 'boss' ? 0.009 : 0.0035;
    const fb = ctx.createGain(); fb.gain.value = 0.45;
    out.connect(this.voiceBus); out.connect(comb); comb.connect(fb).connect(comb); comb.connect(this.voiceBus);
    const s = ctx.createGain(); s.gain.value = 0.25; out.connect(s).connect(this.reverbSend);
    const base = speaker === 'boss' ? 70 : 190 * pitch;
    for (let i = 0; i < syll; i++) {
      const dur = 0.05 + Math.random() * 0.05;
      const f0 = base * (1 + (Math.random() - 0.5) * 0.25) * (i === syll - 1 ? 0.85 : 1);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const vow = [[800, 1150], [450, 800], [325, 700], [400, 1600], [600, 1000]][Math.floor(Math.random() * 5)];
      for (const [fq, k] of [[vow[0], 1], [vow[1], 0.6], [2600, 0.3]] as const) {
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq * (speaker === 'boss' ? 0.6 : 1); f.Q.value = 8;
        const fg = ctx.createGain(); fg.gain.value = k;
        o.connect(f).connect(fg).connect(g);
      }
      g.connect(out);
      o.start(t); o.stop(t + dur + 0.02);
      t += dur + 0.025 + Math.random() * 0.03;
    }
  }

  get time(): number { return this.ctx?.currentTime ?? 0; }
}

export { mtof };
