import * as THREE from 'three';
import { CRIT_HITSTOP, FEEL } from '../data/feel';

/** Лейтмотив Пилота (план §8.7): D–E♭–F–D–C–D, ре фригийский. */

/** Материал гибели: мокрая Шелуха, каменные големы и Стражи, энергетическое Око (план §5.2.1). */
const DEATH_SOUND: Record<string, string> = {
  husk: 'shatter_wet', golem: 'shatter_stone', gateGuardian: 'shatter_stone', bellRinger: 'shatter_stone', eye: 'shatter_energy',
};
/** Слой замаха по классу: рой — щелчки, дуэлянт — сталь, тяжёлый — скрежет, поддержка — хоровой тон. */
const WINDUP_LAYER: Record<string, string> = {
  husk: 'tele_click', spiker: 'tele_click', reaper: 'tele_steel', crucifier: 'tele_steel', golem: 'tele_grind', gateGuardian: 'tele_grind', bellRinger: 'tele_grind',
  acolyte: 'tele_choir', eye: 'tele_choir', psalmist: 'tele_choir',
};

/** Высота звука удара по шагам комбо: финишеры ниже и тяжелее (план §5.1, п. 5). */
const STEP_PITCH: Record<string, number> = {
  slash1: 1.0, slash2: 1.06, spin: 0.94, rift: 0.8, flurry: 1.08, lunge: 1.0, rising: 0.96, skycut: 1.04, skyfall: 0.78, cross: 0.85, counter: 0.9, charged: 0.82,
};
import type { AudioEngine } from '../audio/engine';
import { MOTIF, type Sequencer } from '../audio/music';

/** Смертельный удар по Пилоту: замедление (реальные с, масштаб времени). */
export const DEATH_SLOW = { sec: 0.5, scale: 0.25 };
import type { Time } from '../core/time';
import type { Input } from '../input/input';
import type { Post } from '../render/post';
import { C, type BattleVfx } from '../vfx/battleVfx';
import type { CameraRig } from '../world/camera';
import type { World } from '../world/world';
import type { Enemy } from '../world/enemy';
import type { Hud } from '../ui/hud';
import type { Settings } from '../meta/settings';

const _v = new THREE.Vector3();
const _hp = { x: 0, y: 0, z: 0 };
const UI_GOLD = '#f0d9a0';
/** Финишеры — для хорового акцента на ранге SS. */
const FINISHERS = new Set(['rift', 'skyfall', 'cross', 'counter', 'charged']);

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
  private lastAbyssText = -9;
  private lowHpBeat = 0;
  /** Счётчик искр клинка: скрежет — на каждую третью. */
  private scrapeN = 0;
  /** Каждое следующее «Мгновение Пустоты» — следующая нота лейтмотива Пилота. */
  private motifStep = 0;
  private waveSlots: { x: number; z: number; t: number; life: number; r: number; s: number }[] = [];
  private lastVoice = -99;
  private lastChoir = -99;
  /** Стягивание экрана к схлопывающемуся Колодцу (реальные с). */
  private pinchT = 0; private pinchX = 0; private pinchZ = 0;
  /** Летербокс врезки ульты (реальные с). */
  private letterboxPulse = 0;
  /** Раскол 2.0: сколько ещё длится (реальные с), замедление после разлёта, линия разреза. */
  private shatterLeft = 0;
  private shatterAfter = 0;
  private shatterLine: { x: number; z: number; dx: number; dz: number; len: number } | null = null;

  constructor(
    private w: World, private time: Time, private cam: CameraRig, private post: Post, private vfx: BattleVfx,
    private audio: AudioEngine, private music: Sequencer, private input: Input, private hud: Hud, public settings: Settings,
    private camera: THREE.PerspectiveCamera,
  ) {
    const b = w.bus;
    this.offs.push(
      // один взмах — один отклик (план §5.1): замирание, тряска, кик, звук, вибрация
      b.on('strike', (e) => {
        const f = FEEL[e.feel];
        const crowd = 1 + 0.25 * Math.log2(e.n);
        let hs = (f.hitstop + (e.crit ? CRIT_HITSTOP : 0)) * crowd;
        if (e.source === 'ability' && e.feel === 'light') hs *= 0.5;
        const held = this.time.addHitstop(Math.min(0.14, hs));
        // поза героя застывает в кадре удара вместе с растяжением
        if (e.source === 'blade' && held > 0) this.w.hero.avatar.holdPose(held);
        if (e.feel !== 'light') this.cam.addTrauma(f.trauma * Math.min(1.5, crowd) * (e.source === 'ability' ? 0.6 : 1));
        this.cam.addKick(e.dirX, e.dirZ, f.kick * 0.5);
        if (f.zoomPunch) this.cam.zoomPunch += f.zoomPunch;
        if (f.chroma) this.chroma = Math.max(this.chroma, f.chroma);
        this.audio.play(f.sfx, { gain: Math.min(1.25, 0.85 + 0.1 * e.n), pitch: STEP_PITCH[e.moveId ?? ''] ?? 1, pan: this.pan(e.x) });
        if (e.n >= 3) this.audio.play('hit_crowd', { gain: Math.min(1, 0.25 * e.n), pan: this.pan(e.x) });
        // ранг SS: короткий хоровой акцент в музыке на финишерах
        if (this.w.rank.rankIdx >= 5 && FINISHERS.has(e.moveId ?? '') && this.time.real - this.lastChoir > 1.2) { this.lastChoir = this.time.real; this.music.stinger('choirHit'); }
        if (e.feel === 'heavy' || e.feel === 'break') this.audio.duck(0.7, 0.3);
        this.input.vibrate(f.vibrate);
      }),
      // попадание по цели: искры и цифры (рядовые без крита — без цифр, элита — сумма за взмах)
      b.on('hit', (e) => {
        const isEnemy = e.target.faction === 'enemy';
        if (isEnemy && e.dmg > 0) {
          const heavy = e.feel === 'heavy' || e.feel === 'break' ? 1 : e.feel === 'medium' ? 0.5 : 0;
          // искры клинка — по касательной к дуге взмаха (ход кончика), а не взрывом от героя
          const tv = this.w.hero.avatar.tipVel, sp = Math.hypot(tv.x, tv.z);
          const tang = e.source === 'blade' && sp > 3;
          this.vfx.hitSparks(e.x, e.y, e.z, e.dirX, e.dirZ, heavy, e.crit, tang ? tv.x / sp : e.dirX, tang ? tv.z / sp : e.dirZ);
        }
        // звон — только броня (неуязвимая цель, щит Аколита); удар в окно уязвимости — чистый тон и резонанс
        if (isEnemy && e.shielded) this.audio.play('hit_armor', { gain: e.dmg > 0 ? 0.45 : 0.7, pan: this.pan(e.x) });
        else if (isEnemy && e.dmg > 0 && e.weak) this.audio.play('hit_weak', { gain: 0.6, pan: this.pan(e.x) });
        const t = e.target as { elite?: unknown[]; isBoss?: boolean; isGuardian?: boolean; id: number };
        const big = !!(t.isBoss || t.isGuardian);
        const notable = big || (t.elite?.length ?? 0) > 0;
        if (!isEnemy || e.crit || notable || e.shielded) this.hud.damageNumber(e.x, e.y + 0.6, e.z, e.dmg, e.crit, e.shielded ?? false, notable ? t.id : -1, big);
      }),
      b.on('kill', (e) => {
        this.vfx.shatter(e.x, e.target.height * 0.45, e.z, e.dirX, e.dirZ, e.big ? 1 : e.elite ? 0.6 : 0);
        const mat = DEATH_SOUND[e.kind];
        this.audio.play(e.big ? 'shatter_big' : mat ?? (e.elite ? 'shatter_big' : 'shatter'), { pan: this.pan(e.x) });
        if (e.big && mat) this.audio.play(mat, { pan: this.pan(e.x), gain: 0.8 });
        if (e.big) this.cam.addTrauma(0.25);
      }),
      // оглушение (план §5.5): удар плиты, гул колокола, у Стражей и боссов — стингер в музыке
      b.on('stun', (e) => {
        this.time.addHitstop(FEEL.break.hitstop);
        this.cam.addTrauma(e.boss ? 0.5 : FEEL.break.trauma);
        this.chroma = Math.max(this.chroma, 0.45);
        this.vfx.stunBurst(e.x, (e.target.height ?? 2) * 0.75, e.z, e.boss);
        this.shockwave(e.x, e.z, 0.5, 0.4);
        this.audio.play('stun_hum', { gain: e.boss ? 0.8 : 0.55, pan: this.pan(e.x) });
        if (e.boss) { this.music.stinger('stunStinger'); this.audio.duck(0.6, 0.5); this.hud.launchStunStars(e.target as Enemy); }
        this.input.vibrate(80);
        this.voice('Оглушён! Финишер или полный заряд — Раскол!', 6);
      }),
      b.on('stunTick', (e) => {
        const en = e.target as { headPoint?: (o: { x: number; y: number; z: number }) => void };
        if (en.headPoint) { en.headPoint(_hp); this.vfx.starOut(_hp.x, _hp.y, _hp.z); }
        this.audio.play('stun_tick', { gain: e.boss ? 0.55 : 0.4, pitch: 1 + e.left * 0.03, pan: this.pan(e.x) });
      }),
      // реакции на удар (план §7.1): пыль у ног роя, камни с плеч тяжёлых
      b.on('hitReact', (e) => {
        if (e.kind === 'dust') this.vfx.burst(5, { x: e.x, y: e.y, z: e.z, life: 0.6, size: 0.35, size1: 0.8, color: C.dust, alpha: 0.45, drag: 3, frame: 'smoke' }, { v: 2, vy: 0.4 }, false);
        else this.vfx.debris.burst(e.x, e.y, e.z, 0, 0, 3, 3, 0.12);
      }),
      b.on('detonate', (e) => {
        this.vfx.detonate(e.x, e.y, e.z, e.stacks);
        this.audio.play('detonate', { gain: 0.35 + e.stacks * 0.08, pitch: 1.2 - e.stacks * 0.05, pan: this.pan(e.x) });
      }),
      b.on('daze', (e) => { this.audio.play('stun_tick', { gain: 0.3, pitch: 1.3, pan: this.pan(e.x) }); }),
      b.on('perfectDodge', (e) => {
        this.vfx.perfectDodge(e.x, e.z, e.heavy, e.sx, e.sz);
        this.audio.play('perfect_dodge', { gain: 0.6 });
        if (!e.heavy) {
          // против рядового: короткая заминка, бой не тормозит (план §5.4)
          this.time.slow(0.35, 0.18, 0.9);
          return;
        }
        // «Мгновение Пустоты»: мир 0.25 на 0.45 с, обесцвечивание, музыка ниже и глуше, вдох и нота лейтмотива
        this.time.slow(0.25, 0.45, 0.75);
        this.voidMoment = 0.45;
        this.audio.play('void_moment', { gain: 0.7 });
        const note = MOTIF[this.motifStep++ % MOTIF.length];
        this.audio.play('motif_note', { gain: 0.55, pitch: Math.pow(2, (note - 62) / 12), vary: 0, delay: 0.12 });
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
        // смертельный удар (план §8.8): 0.5 с замедления — видно, что произошло; дальше Пилот распадается
        this.time.cinematic(DEATH_SLOW.sec, DEATH_SLOW.scale);
        this.vfx.shatter(e.x, 1.2, e.z, 0, 1, 1);
        this.audio.play('death');
        this.cam.addTrauma(0.6);
        // музыка смолкает: разбитый лейтмотив прозвучит на экране поражения
        this.music.stop(1.5);
        this.voice('Пилот… Пилот!', 0);
      }),
      b.on('secondWind', (e) => {
        this.time.addHitstop(0.2);
        this.vfx.impact(e.x, e.z, 5, C.voidHot, 1.5);
        this.shockwave(e.x, e.z, 1, 0.6);
        this.audio.play('ult', { gain: 0.6 });
        this.hud.flashText('ВТОРОЕ ДЫХАНИЕ', '#F1E8FF', e.x, 2.4, e.z, true);
        for (const en of this.w.enemies) if (en.targetable && Math.hypot(en.x - e.x, en.z - e.z) < 5) { const d = Math.hypot(en.x - e.x, en.z - e.z) || 1; en.kbX += (en.x - e.x) / d * 12; en.kbZ += (en.z - e.z) / d * 12; }
      }),
      b.on('swing', (e) => {
        const id = e.kind === 'light' ? 'swing_light' : e.kind === 'spin' ? 'swing_spin' : e.kind === 'stab' ? 'swing_stab' : e.kind === 'charged' ? 'swing_charged' : 'swing_heavy';
        this.audio.play(id, { gain: 0.8 });
        // смазанный кадр в кадре удара (уколы — без веера)
        if (e.kind !== 'stab') this.vfx.trail.armSmear(e.hitAt ?? 0.06);
      }),
      // украденный импульс: снаряд стал осколком Пилота; удар клинка их отправляет
      b.on('steal', (e) => {
        this.audio.play('ability_ready', { gain: 0.5, pitch: 1.4, vary: 0 });
        this.vfx.burst(8, { x: e.x, y: 1.2, z: e.z, life: 0.3, size: 0.1, size1: 0.02, color: C.voidHot, drag: 3, frame: 'spark', stretch: 1.2 }, { v: 5, vy: 2 });
      }),
      b.on('stolenFire', () => { this.audio.play('swing_stab', { pitch: 1.5, gain: 0.6 }); }),
      // скольжение по трещине: низкий свист клинка и фиолетовый след
      b.on('slide', (e) => {
        this.audio.play('swing_heavy', { pitch: 1.25, gain: 0.7 });
        this.vfx.lights.flash(e.x, 0.6, e.z, C.void, 3, 5, 0.3);
        this.vfx.burst(10, { x: e.x, y: 0.2, z: e.z, life: 0.4, size: 0.12, size1: 0.02, color: C.voidHot, drag: 3, frame: 'spark', stretch: 1.6 }, { v: 6, vy: 1, dir: [e.dirX, e.dirZ], cone: 0.3 });
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
          // вес: тяжёлые трясут камеру только вблизи (8 м) и оставляют раскалённые следы
          const near = Math.hypot(this.w.hero.x - e.x, this.w.hero.z - e.z) < 8;
          if (near) this.cam.addTrauma(0.03);
          this.vfx.footprint(e.x, e.z, e.r);
          this.audio.play('step_heavy', { gain: near ? 0.5 : 0.25, pan: this.pan(e.x) });
          this.vfx.burst(4, { x: e.x, y: 0.15, z: e.z, life: 0.6, size: 0.4, size1: 0.9, color: C.dust, alpha: 0.4, drag: 3, frame: 'smoke' }, { v: 1.5, vy: 0.3 }, false);
          return;
        }
        const hero = e.kind === 'rift' || e.kind === 'shatter';
        this.vfx.impact(e.x, e.z, e.r, hero ? C.voidHot : C.hungerHot, e.kind === 'slam' || e.kind === 'bell' ? 1.3 : 1);
        this.shockwave(e.x, e.z, hero ? 0.6 : 0.8, 0.4);
        if (!hero) {
          const d = Math.hypot(this.w.hero.x - e.x, this.w.hero.z - e.z);
          this.cam.addTrauma(d < 6 ? 0.5 : 0.25);
          this.audio.play('slam', { pan: this.pan(e.x) });
        } else if (e.kind === 'rift') this.audio.play('hit_heavy', { gain: 0.6, pitch: 0.7 });
      }),
      // Раскол 2.0 (план §5.6): мир почти стоит, клинок вспыхивает, по линии разреза бегут трещины
      b.on('shatterStart', (e) => {
        this.time.cinematic(e.impact, 0.05);
        this.shatterLeft = e.dur;
        this.shatterAfter = e.dur - e.impact;
        this.shatterLine = { x: e.x, z: e.z, dx: e.dirX, dz: e.dirZ, len: e.len };
        const h = this.w.hero;
        h.avatar.puppet.flash = 0.3;
        this.vfx.lights.flash(h.x, 1.4, h.z, C.voidHot, 2, 4, 0.4);
        this.input.vibrate(30);
      }),
      // один удар: смазанный кадр, вспышка; затем тишина −24 дБ, слышен только тонкий звон
      b.on('shatterCut', (e) => {
        this.whiteFlash(0.35);
        this.vfx.shatterCut(e.x, e.z, e.dirX, e.dirZ, e.len);
        this.cam.addKick(e.dirX, e.dirZ, 0.18);
        this.audio.play('shatter_cut', { gain: 0.9, clear: true, vary: 0 });
        this.audio.silence(e.silence);
        this.audio.play('shatter_ring', { gain: 0.75, clear: true, vary: 0, delay: 0.04 });
      }),
      b.on('shatterEnd', (e) => {
        this.shatterLeft = 0;
        if (e.skipped) { this.time.endSlow(); this.audio.unsilence(); }
      }),
      b.on('shatter', (e) => {
        // разлёт: всё по линии — осколками, низкий удар с сабом, ударная волна; после — короткое замедление
        if (this.shatterLine) {
          const l = this.shatterLine;
          this.vfx.shatterLine(l.x, l.z, l.dx, l.dz, l.len);
          this.shatterLine = null;
        }
        if (this.shatterAfter > 0) { this.time.cinematic(this.shatterAfter, 0.3); this.shatterAfter = 0; }
        this.time.addHitstop(0.1);
        this.cam.addTrauma(e.boss ? 0.45 : 0.4);
        this.cam.zoomPunch += 0.05;
        this.chroma = Math.max(this.chroma, 0.5);
        this.vfx.shatterBurst(e.x, e.y, e.z, e.boss || (e.target.radius ?? 1) > 1.2);
        this.shockwave(e.x, e.z, 0.8, 0.45);
        this.audio.play('shatter_burst', { pan: this.pan(e.x) });
        this.audio.duck(0.6, 0.4);
        this.input.vibrate(70);
        this.hud.flashText('РАСКОЛ', UI_GOLD, e.x, (e.target.height ?? 2) + 0.4, e.z);
      }),
      b.on('telegraph', (e) => {
        const id = e.kind === 'hum' ? 'tele_hum' : e.kind === 'whistle' ? 'tele_whistle' : e.kind === 'chime' ? 'tele_chime' : e.kind === 'bell' ? 'tele_bell' : 'tele_roar';
        this.audio.play(id, { gain: 0.45, pan: this.pan(e.x) });
        // класс замаха узнаётся краем уха (план §5.2.1)
        const layer = e.src ? WINDUP_LAYER[e.src] : undefined;
        if (layer) this.audio.play(layer, { gain: 0.5, pan: this.pan(e.x) });
      }),
      b.on('enemyAttack', (e) => {
        if (e.kind === 'shot') this.audio.play('shot', { gain: 0.5, pan: this.pan(e.x) });
        else if (e.kind === 'bite') this.audio.play('bite', { gain: 0.6, pan: this.pan(e.x) });
        else if (e.kind === 'slash') { this.audio.play('slash_enemy', { pan: this.pan(e.x) }); if (e.dir !== undefined) this.vfx.enemySlash(e.x, e.z, e.dir, e.r ?? 1.8, (e.r ?? 0) > 2.2); }
        else if (e.kind === 'throw') this.audio.play('swing_heavy', { pitch: 0.5, pan: this.pan(e.x) });
        else if (e.kind === 'beam') this.audio.play('beam', { gain: 0.6 });
        else if (e.kind === 'fan') {
          this.audio.play('slash_enemy', { pan: this.pan(e.x) });
          this.audio.play('swing_heavy', { pitch: 0.6, gain: 0.7, pan: this.pan(e.x) });
          this.vfx.bladeFan(e.x, e.z, e.dir ?? 0, e.angles ?? [0], e.len ?? 6);
          this.cam.addTrauma(this.near(e.x, e.z, 8) ? 0.18 : 0.08);
        } else if (e.kind === 'chime') {
          this.audio.play('chime_ring', { pan: this.pan(e.x) });
          this.vfx.chime(e.x, e.z, e.r ?? 3);
          this.cam.addTrauma(this.near(e.x, e.z, 5) ? 0.2 : 0.05);
        } else if (e.kind === 'nail') {
          this.audio.play('nail', { pan: this.pan(e.x) });
          this.vfx.nail(e.x, e.z, e.r ?? 1.1);
          this.cam.addTrauma(this.near(e.x, e.z, 6) ? 0.3 : 0.1);
        }
      }),
      // Погребальный ряд: «та-та-ТА» — третий такт громче и тяжелее
      b.on('spikes', (e) => {
        this.audio.play('spikes', { gain: e.big ? 1 : 0.7, pitch: e.big ? 0.8 : 1, pan: this.pan(e.x) });
        if (e.big) this.audio.play('slam', { gain: 0.4, pan: this.pan(e.x) });
        this.vfx.spikeRow(e.x, e.z, e.dirX, e.dirZ, e.w, e.big);
        this.cam.addTrauma(this.near(e.x, e.z, 7) ? (e.big ? 0.3 : 0.14) : 0.05);
      }),
      b.on('scrape', (e) => {
        this.vfx.scrape(e.x, e.y, e.z);
        if ((this.scrapeN = (this.scrapeN + 1) % 3) === 0) this.audio.play('blade_scrape', { gain: 0.3, pan: this.pan(e.x) });
      }),
      b.on('psalm', (e) => {
        if (e.kind === 'link') this.audio.play('psalm_link', { gain: 0.6, pan: this.pan(e.x) });
        else if (e.kind === 'off') this.audio.play('plates_scatter', { pan: this.pan(e.x) });
        else {
          this.audio.play('thread_snap', { pan: this.pan(e.tx ?? e.x) });
          this.vfx.threadSnap(e.x, e.z, e.tx ?? e.x, e.tz ?? e.z);
        }
      }),
      // Звонарь: каждый удар колокола виден; кольцо героя из колокола; цепи с потолка
      b.on('bellPulse', (e) => this.vfx.bellPulse(e.x, e.y, e.z, e.big)),
      b.on('bellStrike', (e) => {
        this.audio.play('bell_strike', { pan: this.pan(e.x) });
        this.vfx.bellStrike(e.x, e.y, e.z, e.r);
        this.shockwave(e.x, e.z, 0.9, 0.5);
        this.cam.addTrauma(0.4);
        this.time.addHitstop(0.08);
        this.hud.flashText('ЗВОН', '#B794FF', e.x, e.y + 1, e.z, true);
      }),
      // Страж Врат: пробежка по древку и удар в шлем
      b.on('shaftRun', (e) => {
        this.audio.play('dash', { pitch: 0.8 });
        this.audio.play('blade_scrape', { gain: 0.5, pan: this.pan(e.x) });
        this.cam.zoomPunch -= 0.04;
      }),
      // перехват фазы (план §8.3.1): удар в открытое ядро — новая фаза начинается с оглушением
      b.on('bossIntercept', (e) => {
        this.time.addHitstop(0.14);
        this.cam.addTrauma(0.7);
        this.cam.zoomPunch += 0.08;
        this.audio.play('stun_break', { gain: 0.9 });
        this.audio.play('void_moment', { gain: 0.6 });
        this.vfx.lights.flash(e.x, 5, e.z, C.core, 7, 10, 0.5);
        this.input.vibrate(90);
        this.hud.flashText('ПЕРЕХВАТ!', UI_GOLD, e.x, 6.5, e.z);
      }),
      // отбитое кадило Иерофанта (план §8.3): звон металла, затем удар в колокол
      b.on('censer', (e) => {
        if (e.kind === 'deflect') {
          this.time.addHitstop(0.1);
          this.cam.addTrauma(0.3);
          this.audio.play('hit_armor', { gain: 0.8, pan: this.pan(e.x) });
          this.audio.play('blade_scrape', { gain: 0.5, pan: this.pan(e.x) });
          this.vfx.hitSparks(e.x, 1.4, e.z, 0, 1, 1, true);
          this.hud.flashText('ОТБИТО!', UI_GOLD, e.x, 2.2, e.z);
        } else {
          this.time.addHitstop(0.14);
          this.cam.addTrauma(0.55);
          this.cam.zoomPunch += 0.05;
          this.audio.play('bell_crack', { gain: 0.9, pan: this.pan(e.x) });
          this.audio.play('boss_bell', { gain: 0.5, pitch: 1.15 });
          this.vfx.lights.flash(e.x, 5, e.z, C.voidHot, 6, 8, 0.4);
          this.input.vibrate(70);
          this.hud.flashText('В КОЛОКОЛ!', UI_GOLD, e.x, 6, e.z);
        }
      }),
      b.on('helmetHit', (e) => {
        this.time.addHitstop(0.12);
        this.cam.addTrauma(0.5);
        this.cam.zoomPunch += 0.06;
        this.audio.play('hit_heavy', { pitch: 0.8 });
        this.audio.play('bell_crack', { gain: 0.7, pan: this.pan(e.x) });
        this.vfx.hitSparks(e.x, e.y, e.z, 0, 1, 1, true);
        this.vfx.lights.flash(e.x, e.y, e.z, C.voidHot, 5, 6, 0.3);
        this.input.vibrate(60);
        this.hud.flashText('В ШЛЕМ!', UI_GOLD, e.x, e.y + 0.8, e.z);
      }),
      // аффиксы элиты (план §7.6)
      b.on('recoilCharge', (e) => this.audio.play('recoil_charge', { pan: this.pan(e.x) })),
      b.on('recoilWave', (e) => {
        this.audio.play('recoil_wave', { pan: this.pan(e.x) });
        this.vfx.impact(e.x, e.z, e.r, C.hungerHot, 1.2);
        this.cam.addTrauma(this.near(e.x, e.z, 7) ? 0.45 : 0.15);
      }),
      b.on('recoilDodge', (e) => this.hud.flashText('+20 РЕЗОНАНСА', '#B794FF', e.x, 2.4, e.z, true)),
      b.on('shadow', (e) => {
        this.vfx.shadowPuff(e.x, e.z, e.kind === 'gone');
        this.audio.play('portal', { gain: e.kind === 'gone' ? 0.5 : 0.3, pitch: 0.7, pan: this.pan(e.x) });
      }),
      b.on('chains', (e) => {
        this.audio.play('chain_drop', { pan: this.pan(e.x) });
        for (const c of this.w.tempWalls) if (c.t < 0.05) this.vfx.impact(c.x, c.z, 0.9, C.ember, 0.5);
        this.cam.addTrauma(0.25);
      }),
      b.on('stuck', (e) => this.audio.play('nail_strain', { gain: 0.6, pan: this.pan(e.x) })),
      b.on('lob', (e) => this.vfx.lob(e.fx, e.fz, e.tx, e.tz, e.dur, e.size)),
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
      // подача способностей (план §6.9): «вдох» на замахе, на release — замирание 60 мс и вспышка в руке
      b.on('castStart', () => { this.audio.play('cast_inhale', { gain: 0.55, vary: 0.03 }); }),
      b.on('ability', (e) => {
        this.time.addHitstop(0.06);
        const hand = this.w.hero.hand();
        this.vfx.lights.flash(hand.x, hand.y, hand.z, C.voidHot, 3, 4, 0.18);
        this.vfx.add.emit({ x: hand.x, y: hand.y, z: hand.z, life: 0.14, size: 0.5, size1: 1.2, color: C.core, alpha: 0.8, frame: 'flare' });
        if (e.id === 'crescent') this.audio.play('crescent');
        else if (e.id === 'phase') { this.audio.play('phase'); this.cam.addTrauma(0.15); }
        else if (e.id === 'well') this.audio.play('well');
      }),
      b.on('sickleCatch', () => {
        this.audio.play('sickle_catch', { gain: 0.6 });
        const hand = this.w.hero.hand();
        this.vfx.burst(5, { x: hand.x, y: hand.y, z: hand.z, life: 0.2, size: 0.07, size1: 0.01, color: C.voidHot, drag: 3, frame: 'spark' }, { v: 3, vy: 1 });
      }),
      // схлопывание Колодца: экран стягивается к нему, мир глохнет — потом взрыв
      b.on('wellCollapse', (e) => {
        this.audio.muffle(0.32);
        this.audio.play('well_collapse', { gain: 0.8, clear: true, vary: 0 });
        this.pinchT = 0.32; this.pinchX = e.x; this.pinchZ = e.z;
      }),
      b.on('ultimate', (e) => {
        // врезка Затмения: время замирает на 0.5 с, летербокс; камеру и небо ведёт бой
        this.time.addHitstop(0.12);
        this.time.cinematic(0.5, 0.02);
        this.letterboxPulse = 0.6;
        this.w.hero.avatar.puppet.flash = 0.35;
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
        if (e.hero) { this.audio.play('swing_heavy', { pitch: 0.5 }); this.hud.flashText('ПАДЕНИЕ', '#FF4A57', e.x, 2, e.z, true); }
        else {
          this.audio.play('shatter', { pitch: 0.6, gain: 0.5 });
          // сброшен в бездну — отдельная похвала, не чаще раза в секунду
          if (this.time.real - this.lastAbyssText > 1.2) { this.lastAbyssText = this.time.real; this.hud.flashText('В БЕЗДНУ', '#8fd8ef', e.x, 1.2, e.z); }
        }
      }),
      b.on('rankBurst', () => { this.cam.zoomPunch += 0.08; this.music.stinger('choirHit'); }),
      b.on('rank', (e) => { if (e.up) this.audio.play('rank_up', { gain: 0.5, pitch: 0.9 + ['C', 'B', 'A', 'S', 'SS'].indexOf(e.rank) * 0.06 }); }),
      b.on('voice', (e) => this.voice(e.line, 0, e.speaker)),
      b.on('sfx', (e) => this.audio.play(e.id, { gain: e.gain ?? 1, pan: this.pan(e.x) })),
      b.on('shake', (e) => this.cam.addTrauma(e.trauma)),
      b.on('resonanceFull', () => { this.audio.play('charge2', { gain: 0.6 }); this.hud.pulseUlt(); }),
      b.on('abilityReady', (e) => { this.audio.play('ability_ready', { gain: 0.35, vary: 0 }); this.hud.abilityReady(e.slot); }),
    );
  }

  /** Событие ближе r м к герою (тряска только вблизи). */
  private near(x: number, z: number, r: number): boolean { return Math.hypot(this.w.hero.x - x, this.w.hero.z - z) < r; }

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
    const av = this.w.hero.avatar;
    if (av.hold > 0) av.hold = Math.max(0, av.hold - realDt);
    // «Мгновение Пустоты»
    if (this.voidMoment > 0) this.voidMoment -= realDt;
    // лёгкое приглушение красок на долю секунды — без провала музыки и полного обесцвечивания
    if (this.shatterLeft > 0) this.shatterLeft -= realDt;
    const targetDesat = this.voidMoment > 0 ? 0.85 : this.shatterLeft > 0 ? 0.6 : 0;
    this.desat += (targetDesat - this.desat) * Math.min(1, realDt * (targetDesat ? 14 : 5));
    P.desat = this.desat;
    // «Мгновение Пустоты»: −400 центов и ФНЧ 1200 Гц только на его время
    this.audio.musicDetune = this.audio.musicTranspose + (this.voidMoment > 0 ? -400 : 0);
    this.audio.setMusicFilter(this.voidMoment > 0 ? 1200 : 20000, this.voidMoment > 0 ? 0.05 : 0.2);
    // аберрация по событию
    this.chroma = Math.max(0, this.chroma - realDt * 2.5);
    P.chroma = S.aberration ? this.chroma + this.desat * 0.2 : 0;
    // вспышка экрана (без вспышек — мягкое затемнение)
    this.flash = Math.max(0, this.flash - realDt * 3);
    P.flash = S.flashes ? this.flash : -this.flash * 0.3;
    // летербокс и кинематографичное приближение
    if (this.letterboxPulse > 0) this.letterboxPulse -= realDt;
    const lb = Math.max(this.letterbox, this.letterboxPulse > 0 ? 1 : 0);
    P.letterbox += (lb - P.letterbox) * Math.min(1, realDt * 10);
    // схлопывание Колодца: сила растёт к взрыву
    if (this.pinchT > 0) {
      this.pinchT -= realDt;
      _v.set(this.pinchX, 0.5, this.pinchZ).project(this.camera);
      const k = S.distortion ? Math.max(0, 1 - this.pinchT / 0.32) : 0;
      P.pinch.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, 0.45, this.pinchT > 0 ? k : 0);
    } else P.pinch.w = 0;
    // Раскол: камера подъезжает на 6 %
    this.zoomCine += ((this.shatterLeft > 0 ? 0.06 : 0) - this.zoomCine) * Math.min(1, realDt * 8);
    this.cam.zoomTarget = this.baseZoom * (1 - this.zoomCine);
    // низкое HP: лёгкая виньетка, слой напряжения (низкие струнные + дыхание) и сердцебиение;
    // музыку не глушим (план §5.2, п. 9)
    const h = this.w.hero;
    const low = !h.dead && h.hp / h.maxHp < 0.25;
    P.lowHp += ((low ? 0.6 : 0) - P.lowHp) * Math.min(1, realDt * 3);
    this.audio.setTension(low ? 1 : 0);
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

  setLetterbox(v: number): void { this.letterbox = v; }

  /** Музыкальные реплики сцен (план §8.1): тишина, стингер, лейтмотив Пилота, разрешение. */
  musicCue(cue: 'silence' | 'stinger' | 'leitmotif' | 'major' | 'resolve'): void {
    if (cue === 'silence') this.music.setIntensity(0, 0.12);
    else if (cue === 'major') {
      // лейтмотив в мажоре — звезда загорелась (план §8.3.2): D–E–F♯–D–C♯–D
      [62, 64, 66, 62, 61, 62].forEach((n, i) => this.audio.play('motif_note', { gain: 0.85, pitch: Math.pow(2, (n - 62) / 12), delay: i * 0.34, vary: 0 }));
    }
    else if (cue === 'stinger') this.music.stinger('stinger');
    else if (cue === 'resolve') this.music.setIntensity(0.6, 1.5);
    else {
      // лейтмотив Пилота D–E♭–F–D–C–D (план §8.7)
      [62, 63, 65, 62, 60, 62].forEach((n, i) => this.audio.play('motif_note', { gain: 0.8, pitch: Math.pow(2, (n - 62) / 12), delay: i * 0.32, vary: 0 }));
    }
  }
  whiteFlash(v: number): void {
    this.flash = Math.max(this.flash, this.settings.flashes ? v : v * 0.25);
    this.post.state.flashColor.setRGB(1, 0.95, 1);
  }

  dispose(): void { for (const o of this.offs) o(); this.offs = []; }
}
