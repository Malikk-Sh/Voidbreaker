import * as THREE from 'three';
import { CRIT_HITSTOP, FEEL } from '../data/feel';
import type { AudioEngine } from '../audio/engine';
import type { Sequencer } from '../audio/music';
import type { Time } from '../core/time';
import type { Input } from '../input/input';
import type { Post } from '../render/post';
import { C, type BattleVfx } from '../vfx/battleVfx';
import type { CameraRig } from '../world/camera';
import type { World } from '../world/world';
import type { Hud } from '../ui/hud';
import type { Settings } from '../meta/settings';

const _v = new THREE.Vector3();

/**
 * Система «сочности» (GDD §14, Tech §9): подписчик событий боя. Стек обратной связи на один удар —
 * hitstop, вспышка цели, отбрасывание и пружина, частицы, цифра урона, звук, вибрация, тряска/кик камеры.
 */
export class FeelSystem {
  private offs: (() => void)[] = [];
  private chroma = 0;
  private flash = 0;
  private desat = 0;
  private voidMoment = 0;
  private zoomCine = 0;
  private letterbox = 0;
  private lowHpBeat = 0;
  private waveSlots: { x: number; z: number; t: number; life: number; r: number; s: number }[] = [];
  private lastVoice = -99;

  constructor(
    private w: World, private time: Time, private cam: CameraRig, private post: Post, private vfx: BattleVfx,
    private audio: AudioEngine, private music: Sequencer, private input: Input, private hud: Hud, private settings: Settings,
    private camera: THREE.PerspectiveCamera,
  ) {
    const b = w.bus;
    this.offs.push(
      b.on('hit', (e) => {
        const f = FEEL[e.feel];
        const isEnemy = e.target.faction === 'enemy';
        if (isEnemy && e.dmg > 0) {
          let hs = f.hitstop + (e.crit ? CRIT_HITSTOP : 0);
          if (e.source === 'ability' && e.feel === 'light') hs *= 0.5;
          this.time.addHitstop(hs);
          this.cam.addTrauma(f.trauma * (e.source === 'ability' ? 0.6 : 1));
          this.cam.addKick(e.dirX, e.dirZ, f.kick * 0.5);
          if (f.zoomPunch) this.cam.zoomPunch += f.zoomPunch;
          if (f.chroma) this.chroma = Math.max(this.chroma, f.chroma);
          const heavy = e.feel === 'heavy' || e.feel === 'break' ? 1 : e.feel === 'medium' ? 0.5 : 0;
          this.vfx.hitSparks(e.x, e.y, e.z, e.dirX, e.dirZ, heavy, e.crit);
          this.audio.play(f.sfx, { gain: e.shielded ? 0.6 : 1, pitch: e.shielded ? 0.8 : 1, pan: this.pan(e.x) });
          if (e.feel === 'heavy' || e.feel === 'break') { this.audio.duck(0.7, 0.3); }
          this.input.vibrate(f.vibrate);
        } else if (isEnemy && e.shielded) {
          this.audio.play('proj_hit', { pitch: 1.5, gain: 0.5 });
        }
        this.hud.damageNumber(e.x, e.y + 0.6, e.z, e.dmg, e.crit, e.shielded ?? false);
      }),
      b.on('kill', (e) => {
        this.vfx.shatter(e.x, e.target.height * 0.45, e.z, e.dirX, e.dirZ, e.big ? 1 : e.elite ? 0.6 : 0);
        this.audio.play(e.big || e.elite ? 'shatter_big' : 'shatter', { pan: this.pan(e.x) });
        if (e.big) this.cam.addTrauma(0.25);
      }),
      b.on('postureBreak', (e) => {
        this.time.addHitstop(FEEL.break.hitstop);
        this.cam.addTrauma(FEEL.break.trauma);
        this.chroma = Math.max(this.chroma, 0.6);
        this.vfx.postureBreak(e.x, (e.target.height ?? 2) * 0.6, e.z);
        this.shockwave(e.x, e.z, 0.6, 0.45);
        this.audio.play('posture_break');
        this.input.vibrate(80);
        this.voice('Стойка сломана — бей!', 6);
      }),
      b.on('perfectDodge', (e) => {
        // «Мгновение Пустоты»: мир ×0.3 на 0.6 с реального времени, герой ×0.8; обесцвечивание
        this.time.slow(0.3, 0.6 + (this.w.hero.stats.perfectWindow > 0.15 ? 0.3 : 0), 0.8);
        this.voidMoment = 0.6;
        this.vfx.perfectDodge(e.x, e.z);
        this.audio.play('perfect_dodge', { reverb: 0.5 });
        this.shockwave(e.x, e.z, 0.8, 0.5);
        this.hud.flashText('ИДЕАЛЬНО', '#B794FF');
      }),
      b.on('dodge', () => { /* рывок сквозь атаку без бонуса — только звук свиста */ this.audio.play('swing_stab', { pitch: 0.7, gain: 0.4 }); }),
      b.on('playerHurt', (e) => {
        if (e.dmg <= 0) return;
        this.cam.addTrauma(0.35);
        this.cam.addKick(e.dirX, e.dirZ, 0.25);
        this.flash = Math.max(this.flash, 0.25);
        this.post.state.flashColor.setRGB(0.8, 0.05, 0.08);
        this.audio.play('hurt');
        this.input.vibrate(35);
        this.time.addHitstop(0.06);
      }),
      b.on('heroDeath', (e) => {
        this.time.cinematic(1.4, 0.25);
        this.vfx.shatter(e.x, 1.2, e.z, 0, 1, 1);
        this.audio.play('death');
        this.cam.addTrauma(0.6);
        this.music.setIntensity(0, 1.5);
      }),
      b.on('secondWind', (e) => {
        this.time.addHitstop(0.2);
        this.vfx.impact(e.x, e.z, 5, C.voidHot, 1.5);
        this.shockwave(e.x, e.z, 1, 0.6);
        this.audio.play('ult', { gain: 0.6 });
        this.hud.flashText('ВТОРОЕ ДЫХАНИЕ', '#F1E8FF');
        for (const en of this.w.enemies) if (en.targetable && Math.hypot(en.x - e.x, en.z - e.z) < 5) { const d = Math.hypot(en.x - e.x, en.z - e.z) || 1; en.kbX += (en.x - e.x) / d * 12; en.kbZ += (en.z - e.z) / d * 12; }
      }),
      b.on('swing', (e) => {
        const id = e.kind === 'light' ? 'swing_light' : e.kind === 'spin' ? 'swing_spin' : e.kind === 'stab' ? 'swing_stab' : e.kind === 'charged' ? 'swing_charged' : 'swing_heavy';
        this.audio.play(id, { gain: 0.8 });
      }),
      b.on('dash', (e) => {
        this.vfx.dashPuff(e.x, e.z, e.dirX, e.dirZ);
        this.audio.play('dash');
      }),
      b.on('chargeReady', (e) => {
        this.audio.play(e.level >= 2 ? 'charge2' : 'charge1');
        if (e.level >= 2) { this.w.hero.avatar.puppet.flash = 0.8; this.vfx.lights.flash(this.w.hero.x, 1.5, this.w.hero.z, C.core, 4, 5, 0.3); }
      }),
      b.on('impact', (e) => {
        if (e.kind === 'land') {
          this.cam.addTrauma(0.05);
          this.audio.play('step_heavy', { gain: 0.5, pan: this.pan(e.x) });
          this.vfx.burst(4, { x: e.x, y: 0.15, z: e.z, life: 0.6, size: 0.4, size1: 0.9, color: C.dust, alpha: 0.4, drag: 3, frame: 'smoke' }, { v: 1.5, vy: 0.3 }, false);
          return;
        }
        const hero = e.kind === 'rift' || e.kind === 'execute';
        this.vfx.impact(e.x, e.z, e.r, hero ? C.voidHot : C.hungerHot, e.kind === 'slam' || e.kind === 'bell' ? 1.3 : 1);
        this.shockwave(e.x, e.z, hero ? 0.6 : 0.8, 0.4);
        if (!hero) {
          const d = Math.hypot(this.w.hero.x - e.x, this.w.hero.z - e.z);
          this.cam.addTrauma(d < 6 ? 0.5 : 0.25);
          this.audio.play('slam', { pan: this.pan(e.x) });
        } else if (e.kind === 'rift') this.audio.play('hit_heavy', { gain: 0.6, pitch: 0.7 });
      }),
      b.on('execute', (e) => {
        this.letterbox = 1;
        this.zoomCine = 0.15;
        this.audio.play('execute');
        this.music.setIntensity(this.music.intensity, 0.2);
        void e;
      }),
      b.on('executeImpact', (e) => {
        this.time.addHitstop(0.22);
        this.time.cinematic(0.5, 0.3);
        this.cam.addTrauma(0.6);
        this.chroma = 0.8;
        this.flash = this.settings.flashes ? 0.5 : 0.15;
        this.post.state.flashColor.setRGB(0.9, 0.85, 1);
        this.vfx.impact(e.x, e.z, 3.5, C.core, 1.6);
        this.shockwave(e.x, e.z, 1, 0.6);
        this.audio.play('execute_impact');
        this.audio.duck(0.4, 0.8);
        this.input.vibrate(80);
        setTimeout(() => { this.letterbox = 0; this.zoomCine = 0; }, 600);
      }),
      b.on('telegraph', (e) => {
        const id = e.kind === 'hum' ? 'tele_hum' : e.kind === 'whistle' ? 'tele_whistle' : e.kind === 'chime' ? 'tele_chime' : e.kind === 'bell' ? 'tele_bell' : 'tele_roar';
        this.audio.play(id, { gain: 0.6, pan: this.pan(e.x) });
      }),
      b.on('enemyAttack', (e) => {
        if (e.kind === 'shot') this.audio.play('shot', { gain: 0.5, pan: this.pan(e.x) });
        else if (e.kind === 'bite') this.audio.play('bite', { gain: 0.6, pan: this.pan(e.x) });
        else if (e.kind === 'slash') this.audio.play('slash_enemy', { pan: this.pan(e.x) });
        else if (e.kind === 'beam') this.audio.play('beam', { gain: 0.6 });
      }),
      b.on('projectileHit', (e) => {
        this.audio.play('proj_hit', { gain: 0.5, pan: this.pan(e.x) });
        this.vfx.burst(8, { x: e.x, y: 1.2, z: e.z, life: 0.3, size: 0.07, size1: 0.01, color: C.hungerHot, drag: 3, frame: 'spark', stretch: 1 }, { v: 5, vy: 3 });
      }),
      b.on('portal', (e) => { this.vfx.portal(e.x, e.z); this.audio.play('portal', { gain: 0.5, pan: this.pan(e.x) }); }),
      b.on('pickup', (e) => {
        if (e.kind === 'shard') this.audio.play('pickup', { gain: 0.35 });
        else if (e.kind === 'ether') this.audio.play('pickup_ether');
        else this.audio.play('ui_confirm');
      }),
      b.on('ability', (e) => {
        if (e.id === 'crescent') this.audio.play('crescent');
        else if (e.id === 'phase') { this.audio.play('phase'); this.cam.addTrauma(0.15); }
        else if (e.id === 'well') this.audio.play('well');
      }),
      b.on('ultimate', (e) => {
        this.time.addHitstop(0.12);
        this.time.cinematic(0.45, 0.25);
        this.cam.addTrauma(0.5);
        this.chroma = 0.7;
        this.flash = this.settings.flashes ? 0.45 : 0.1;
        this.post.state.flashColor.setRGB(0.7, 0.5, 1);
        this.vfx.impact(e.x, e.z, 6, C.voidHot, 2);
        this.audio.play('ult');
        this.music.setIntensity(1, 0.3);
        this.voice('Затмение. Покажи им.', 0);
      }),
      b.on('shockwave', (e) => {
        this.vfx.rings.spawn(e.x, e.z, 0.5, e.r, 0.5, e.color === 'void' ? C.voidHot : e.color === 'gold' ? C.gold : C.hungerHot, 0.25, e.strength);
        this.shockwave(e.x, e.z, e.strength, 0.5);
        if (e.color === 'void') this.audio.play('well_boom', { gain: 0.6 * e.strength });
      }),
      b.on('fall', (e) => {
        if (e.hero) { this.audio.play('swing_heavy', { pitch: 0.5 }); this.hud.flashText('ПАДЕНИЕ', '#FF4A57'); }
        else this.audio.play('shatter', { pitch: 0.6, gain: 0.5 });
      }),
      b.on('rank', (e) => { if (e.up) this.audio.play('rank_up', { gain: 0.5, pitch: 0.9 + ['C', 'B', 'A', 'S', 'SS'].indexOf(e.rank) * 0.06 }); }),
      b.on('voice', (e) => this.voice(e.line, 0, e.speaker)),
      b.on('resonanceFull', () => { this.audio.play('charge2', { gain: 0.6 }); this.hud.pulseUlt(); }),
    );
  }

  private pan(x: number): number {
    _v.set(x, 0, 0).project(this.camera);
    return Math.max(-0.7, Math.min(0.7, _v.x * 0.7));
  }

  /** Короткая фраза Каэлис (субтитры + «речь» блипами), не чаще чем раз в minGap с. */
  voice(line: string, minGap = 4, speaker: 'kaelis' | 'boss' = 'kaelis'): void {
    const now = this.time.real;
    if (now - this.lastVoice < minGap && speaker === 'kaelis') return;
    this.lastVoice = now;
    this.hud.subtitle(line, speaker);
    this.audio.speak(line, 1, speaker);
  }

  /** Ударная волна искажения в посте (экранные координаты). */
  shockwave(x: number, z: number, strength: number, life: number): void {
    if (!this.settings.distortion) return;
    this.waveSlots.push({ x, z, t: 0, life, r: 0.02, s: strength });
    if (this.waveSlots.length > 4) this.waveSlots.shift();
  }

  update(realDt: number): void {
    const P = this.post.state, S = this.settings;
    // «Мгновение Пустоты»
    if (this.voidMoment > 0) this.voidMoment -= realDt;
    const targetDesat = this.voidMoment > 0 ? 1 : 0;
    this.desat += (targetDesat - this.desat) * Math.min(1, realDt * (targetDesat ? 14 : 4));
    P.desat = this.desat;
    this.audio.musicDetune = this.desat > 0.5 ? -400 : 0;
    // аберрация по событию
    this.chroma = Math.max(0, this.chroma - realDt * 2.5);
    P.chroma = S.aberration ? this.chroma + this.desat * 0.4 : 0;
    // вспышка экрана (без вспышек — мягкое затемнение)
    this.flash = Math.max(0, this.flash - realDt * 3);
    P.flash = S.flashes ? this.flash : -this.flash * 0.3;
    // летербокс и кинематографичное приближение
    P.letterbox += (this.letterbox - P.letterbox) * Math.min(1, realDt * 10);
    this.cam.zoomTarget = this.baseZoom * (1 - this.zoomCine);
    // низкое HP: виньетка, low-pass, сердцебиение (GDD §5.8)
    const h = this.w.hero;
    const low = !h.dead && h.hp / h.maxHp < 0.25;
    P.lowHp += ((low ? 1 : 0) - P.lowHp) * Math.min(1, realDt * 3);
    this.audio.setMusicFilter(this.desat > 0.5 ? 600 : low ? 800 : 20000);
    if (low) {
      this.lowHpBeat -= realDt;
      if (this.lowHpBeat <= 0) { this.lowHpBeat = 0.85; this.audio.play('heartbeat', { gain: 0.7, reverb: 0 }); }
    }
    // искажения волн: проекция центра в UV, радиус растёт
    for (const w of this.waveSlots) w.t += realDt;
    this.waveSlots = this.waveSlots.filter((w) => w.t < w.life);
    for (let i = 0; i < 4; i++) {
      const s = this.waveSlots[i], u = P.waves[i];
      if (!s) { u.set(0, 0, 0, 0); continue; }
      _v.set(s.x, 0.5, s.z).project(this.camera);
      const f = s.t / s.life;
      u.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, 0.02 + f * 0.35 * s.s, (1 - f) * s.s);
    }
    this.cam.shakeScale = S.shake;
  }

  baseZoom = 1;

  dispose(): void { for (const o of this.offs) o(); this.offs = []; }
}
