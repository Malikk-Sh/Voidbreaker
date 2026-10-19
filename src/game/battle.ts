import * as THREE from 'three';
import { ARENAS } from '../data/arenas';
import type { StageDef } from '../data/stages';
import { buildArenaView, ZONE1_LOOK, type ArenaView } from '../gen/zone/arenaView';
import { EnemyRenderer } from '../render/enemyRenderer';
import { QUALITY } from '../render/renderer';
import { Flames, LightPools, RuneCircle } from '../vfx/ambient';
import { BattleVfx } from '../vfx/battleVfx';
import { Abilities, type Loadout } from '../world/abilities';
import { Arena } from '../world/arena';
import { CameraRig } from '../world/camera';
import type { HeroStats } from '../world/heroStats';
import { StageRunner } from '../world/stage';
import { World } from '../world/world';
import { guardianSong, hierophantSong, stageSong } from '../audio/music';
import type { MusicCue } from './director';
import { effectiveFlashes, type Settings } from '../meta/settings';
import type { GameContext } from './context';
import { FeelSystem } from './feel';
import { Cinematics } from './cinematics';
import { Director, type CineTrack, type DirectorActor, type SkyParam } from './director';
import type { Enemy } from '../world/enemy';
import type { BossController } from '../world/boss/bossBase';
import '../world/boss/guardians';
import { Hierophant, HierophantController, type BossHost } from '../world/boss/hierophant';
import { C } from '../vfx/battleVfx';
import { fxRng } from '../core/rng';
import { G, obsidianMaterial } from '../render/materials';
import { buildCrater, buildHullShard } from '../gen/zone/space';
import { createEnemy } from '../world/enemies/factory';
import { landingTrack, type LandingSpots } from './prologueTracks';


const _top = new THREE.Vector3();
/** Базовая дистанция боевой камеры (м) при «Дистанции камеры» = 100 %. Герой ~13 % высоты экрана (план §5.3). */
const CAM_DIST = 17;
export const STEP = 1 / 60;
/** Dev: ?nav — оверлей поля потоков (план §4.4, п. 9). */
const DEBUG_NAV = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nav');

export interface BattleOutcome { cleared: boolean; world: World; stage: StageDef }
/** prologue — бой 1-1 начинается приземлением Пилота (план §8.2, планы 6–8), а не пролётом над ареной. */
export interface BattleOpts { prologue?: boolean }

/** Кратер от падения Пилота в центре 1-1 (план §8.5). */
const CRATER = { x: 0, z: 0.5 };

/**
 * Бой на этапе: мир + арена + директор волн + VFX + камера + «сочность». Цикл — фиксированный шаг 60 Гц
 * в реальном времени, каждая система получает своё масштабированное dt (мир/герой).
 */
/** Свет арены в Затмении (план §6.9): небо и полусфера уходят в фиолетовый. */
const ECLIPSE_HEMI = new THREE.Vector3(0.09, 0.05, 0.2);
const ECLIPSE_MOON = new THREE.Vector3(0.42, 0.24, 0.8);
const _cutPos = new THREE.Vector3(), _cutLook = new THREE.Vector3();

/** Полных Расколов на сессию (план §5.6): первые два — полная версия, дальше — короткая. */
let fullShattersLeft = 2;

export class Battle {
  readonly world: World;
  readonly arena: Arena;
  readonly view: ArenaView;
  readonly runner: StageRunner;
  readonly vfx: BattleVfx;
  readonly enemies = new EnemyRenderer();
  readonly cam = new CameraRig();
  readonly feel: FeelSystem;
  readonly cine: Cinematics;
  /** Дорожки режиссёра (план §8.1): пролог, интро и казнь босса, kill-cam Стражей. */
  readonly director: Director;
  /** Параметры неба, которые ведёт сцена (поверх боевых). */
  readonly skyCine: Record<SkyParam, number> = { starLit: 0, eclipse: 0, crack: 0 };
  /** Актёры-реквизит сцены по имени (корабль, обломки…). */
  readonly props = new Map<string, DirectorActor>();
  readonly abilities: Abilities;
  readonly group = new THREE.Group();
  private flames: Flames;
  private pools: LightPools;
  private rune: RuneCircle;
  private acc = 0;
  private endT = -1;
  outcome: 'playing' | 'won' | 'lost' = 'playing';
  onEnd: ((o: BattleOutcome) => void) | null = null;
  boss: BossController | null = null;
  private fpsAcc = 0; private fpsN = 0; fps = 60;
  private dashCount = 0;
  private tutorialReaperDone = false;
  private intensityT = 0;
  private bladeA = new THREE.Vector3(); private bladeB = new THREE.Vector3();
  /** Доп. отъезд, чтобы голова босса/Стража не уходила под верхний HUD. */
  private bossFrame = 0;
  /** Подъезд камеры к оглушённому Стражу или боссу (0..1). */
  private stunZoom = 0;
  /** Врезка Затмения: секунды наезда камеры снизу на Пилота. */
  private ultCut = 0;
  /** Сила затмения в небе и фиолетового света арены 0..1. */
  private eclipseK = 0;
  private readonly douseOut: [number, number, number][] = [];
  private readonly baseHemi = G.uHemiTop.value.clone();
  private readonly baseMoon = G.uMoonColor.value.clone();

  /** Приземление пролога: свечи гаснут волной, визор, обломок-клинок. */
  private landing: { visorT: number; igniteT: number; shard: THREE.Mesh; music: boolean } | null = null;

  constructor(private ctx: GameContext, readonly stage: StageDef, stats: HeroStats, loadout: Loadout, readonly opts: BattleOpts = {}) {
    const r = ctx.renderer;
    const Q = QUALITY[r.quality];
    this.arena = new Arena(ARENAS[stage.arena]);
    this.world = new World(this.arena, `stage:${stage.id}`);
    this.world.zone = stage.zone;
    this.world.stage = stage.boss ? 0 : Math.min(5, stage.index);
    this.world.damageTakenMul = ctx.settings.story ? 0.6 : 1;
    this.world.shortShatters = ctx.settings.shortExec;
    this.world.fullShatters = fullShattersLeft;
    this.world.shardPerDrop = 3 + stage.index * 0.6;
    this.abilities = new Abilities(this.world);
    this.abilities.loadout = loadout;
    this.world.abilities = this.abilities;
    this.world.hero.applyStats(stats);

    this.view = buildArenaView(this.arena, `stage:${stage.id}`, ZONE1_LOOK, Q.decor);
    this.group.add(this.view.root);
    if (stage.id === '1-1') this.group.add(...craterMeshes());
    this.flames = new Flames(this.view.flames);
    this.pools = new LightPools(320);
    this.pools.setStatic(this.view.pools);
    this.rune = new RuneCircle(this.view.runeRadius);
    const runeAt = ARENAS[stage.arena].rune ?? ARENAS[stage.arena].parts[0];
    if (runeAt) this.rune.mesh.position.set(runeAt.x, 0, runeAt.z);
    this.rune.mesh.visible = runeAt !== false;
    this.vfx = new BattleVfx(Q.particles, this.pools);
    this.vfx.quality = r.quality === 'low' ? 0.5 : r.quality === 'medium' ? 0.75 : 1;
    this.vfx.tele.hatch = ctx.settings.hatch;
    this.vfx.camera = ctx.renderer.camera;
    this.group.add(this.flames.mesh, this.pools.mesh, this.rune.mesh, this.enemies.group, this.world.hero.avatar.group, this.vfx.group);
    this.enemies.warm(['husk', 'crawler', 'mantis', 'crucifier', 'eye', 'acolyte', 'psalmist', 'brute']);
    r.scene.add(this.group);

    this.runner = new StageRunner(this.world, stage);
    this.world.stepHooks.push((dt) => this.runner.step(dt));

    // старт: герой у ближнего края, смотрит вглубь арены
    const b = this.arena.bounds;
    const sx = ARENAS[stage.arena].parts[0].x, sz = Math.min(b.maxZ - 3, (b.maxZ + b.minZ) / 2 + (b.maxZ - b.minZ) * 0.25);
    const o = { x: 0, z: 0 };
    if (opts.prologue) this.arena.nearestWalkable(CRATER.x, CRATER.z, o);
    else this.arena.nearestWalkable(sx, sz, o);
    this.world.hero.spawn(o.x, o.z, Math.PI);
    this.abilities.resetCooldowns();
    this.cam.snap(o.x, o.z - 1);
    this.cam.baseDist = CAM_DIST * ctx.settings.camDist;

    ctx.hud.clear();
    ctx.hud.subtitleScale = ctx.settings.subtitleSize;
    this.feel = new FeelSystem(this.world, ctx.time, this.cam, r.post, this.vfx, ctx.audio, ctx.music, ctx.input, ctx.hud,
      Battle.feelSettings(ctx.settings), r.camera);
    this.cine = new Cinematics({
      world: this.world,
      letterbox: (v) => this.feel.setLetterbox(v),
      slow: (scale, sec) => ctx.time.cinematic(sec, scale),
      banner: (text, sub, color, dur, size) => ctx.hud.bigBanner(text, sub, color, dur, size),
      say: (line, sp) => this.feel.voice(line, 0, sp),
      flash: (v) => this.feel.whiteFlash(v),
      musicPhase: (p) => { ctx.music.phase = p; },
      stinger: () => ctx.music.stinger('stinger'),
      skipRequested: () => ctx.input.buffer.peek('attack', ctx.input.now) || ctx.input.buffer.peek('dash', ctx.input.now),
      once: (f) => { if (ctx.flag(f)) return false; ctx.setFlag(f); return true; },
    });
    this.director = new Director(this.directorHost());
    this.bindEvents();
    ctx.time.reset();
    if (opts.prologue) this.startLanding();
    else if (!stage.boss) {
      // пролёт над ареной; первая волна — когда камера опустится к Пилоту
      const ab = this.arena.bounds;
      this.runner.introTime = 3.0;
      this.cine.stageIntro(stage, { x: (ab.minX + ab.maxX) / 2, z: (ab.minZ + ab.maxZ) / 2 }, Math.max(ab.maxX - ab.minX, ab.maxZ - ab.minZ), () => this.runner.skipIntro());
    }
    // в прологе музыка 1-1 вступает после титула; тема босса — с его именем в интро (план §8.3)
    if (stage.boss) { this.runner.introTime = 0.05; ctx.music.preload(hierophantSong()); }
    else if (!opts.prologue) ctx.music.play(stageSong(stage.id), 0.3);
    // тема Стража запекается заранее — переключение на его появлении без паузы
    const guardianWave = stage.waves.find((wv) => wv.guardian);
    if (guardianWave) ctx.music.preload(guardianSong(guardianWave.spawns[0].enemy));
    ctx.music.onBeat = (bar, beat) => { if (beat === 0) this.rune.u.uPulse.value = 0.5; void bar; };
  }

  private bindEvents(): void {
    const b = this.world.bus, hud = this.ctx.hud, S = this.ctx;
    b.on('waveStart', (e) => {
      if (!this.stage.boss) hud.waveBanner(e.index, e.total);
      if (e.index > 0) S.music.stinger('stinger');
      if (this.stage.tutorial === 'basics' && e.index === 0 && !S.flag('tut_move')) {
        S.setFlag('tut_move');
        // стику учит падение в прологе (план §8.2): остаётся только атака
        const fell = S.flag('prologue');
        if (S.input.lastDevice === 'touch') hud.showHint(fell ? 'Кнопка — атака' : 'Левый палец — движение • Кнопка — атака');
        else hud.showHint(fell ? 'ЛКМ / J — атака' : 'WASD — движение • ЛКМ / J — атака');
      }
      // обучение ульты (план §6.7): в толпе второй волны Свечного зала Резонанс сразу полон
      if (this.stage.tutorial === 'ult' && e.index === 1 && this.abilities.loadout.r && !S.flag('tut_ult_crowd')) {
        S.setFlag('tut_ult_crowd');
        setTimeout(() => this.world.hero.addResonance(100), 2500);
      }
    });
    b.on('waveClear', () => { S.audio.play('wave_clear', { gain: 0.6 }); this.view.lightConstellations(); });
    b.on('stageClear', () => {
      this.outcome = 'won';
      if (this.stage.boss) { this.endT = 1.8; return; }
      this.endT = this.cine.busy === 'down' ? 4.6 : 2.9;
      this.cine.victory();
    });
    b.on('guardianRage', () => { if (this.runner.guardian) this.cine.guardianRage(this.runner.guardian); });
    b.on('kill', (e) => {
      const en = e.target as Enemy;
      if (en.isGuardian && !en.isBoss) this.cine.guardianDown(en);
    });
    b.on('heroDeath', () => { this.endT = 2.4; this.outcome = 'lost'; });
    b.on('dash', () => {
      this.dashCount++;
      if (this.stage.tutorial === 'basics' && this.dashCount === 2 && !S.flag('tut_perfect')) {
        S.setFlag('tut_perfect');
        this.feel.voice('Ещё ближе к удару — увидишь.', 0);
      }
    });
    b.on('telegraph', (e) => {
      // онбординг: первый замах Жнеца — замедление и подсказка «РЫВОК»
      if (this.stage.tutorial === 'basics' && !this.tutorialReaperDone && e.kind === 'whistle' && !S.flag('tut_dash')) {
        this.tutorialReaperDone = true;
        S.setFlag('tut_dash');
        S.time.slow(0.25, 0.9, 0.25);
        hud.showHint(S.input.lastDevice === 'touch' ? 'РЫВОК — кнопка или свайп правой рукой' : 'РЫВОК — Пробел / Shift / ПКМ');
      }
    });
    b.on('spawned', (e) => {
      const en = e.actor as { kind?: string; isGuardian?: boolean; isBoss?: boolean };
      if (en.isGuardian && !en.isBoss && en.kind) { S.music.play(guardianSong(en.kind), 0.9); this.cine.guardianIntro(e.actor as Enemy); }
      else if ((e.actor as Enemy).elite?.length && !en.isBoss) this.cine.elite(e.actor as Enemy);
      // новые враги Зоны 01 (план §7.2–7.3): одна подсказка при первой встрече
      if (en.kind === 'crucifier' && !S.flag('tut_crucifier')) {
        S.setFlag('tut_crucifier');
        hud.showHint('Распинатель: стой в просвете веера. Промах Гвоздём — клинок застрял, бей');
      }
      if (this.stage.tutorial === 'charged' && en.kind === 'golem' && !S.flag('tut_charged')) {
        S.setFlag('tut_charged');
        hud.showHint('Удерживайте атаку — заряженный удар быстро оглушает');
      }
      if (this.stage.tutorial === 'charged' && en.kind === 'eye' && !S.flag('tut_q')) {
        S.setFlag('tut_q');
        setTimeout(() => hud.showHint('Q — Серп Луны достанет Око издалека'), 1500);
      }
    });
    b.on('psalm', (e) => {
      if (e.kind === 'link' && !S.flag('tut_psalmist')) { S.setFlag('tut_psalmist'); hud.showHint('Псаломщик связал врагов нитью. Убей его первым — связанные будут оглушены'); }
    });
    b.on('shatterStart', () => { fullShattersLeft = this.world.fullShatters; });
    b.on('ultimate', () => { this.ultCut = 0.9; });
    b.on('stun', () => {
      if (!S.flag('tut_shatter')) { S.setFlag('tut_shatter'); hud.showHint('Враг оглушён — финишер или заряженный удар: РАСКОЛ'); }
    });
    // подсказки о ветках комбо — по одному разу
    const comboHints: Record<string, [string, string]> = {
      lunge: ['tut_branch_dash', 'Рассечение! Атака ещё: Восходящий месяц → Звездопад'],
      flurry: ['tut_branch_flurry', 'Шквал! Ещё атака — Крест'],
      skyfall: ['tut_branch_sky', 'Звездопад — волна осколков вокруг'],
    };
    b.on('moveStart', (e) => {
      const hnt = comboHints[e.id];
      if (hnt && !S.flag(hnt[0])) { S.setFlag(hnt[0]); hud.showHint(hnt[1]); }
    });
    b.on('perfectDodge', () => {
      if (!S.flag('tut_counter')) { S.setFlag('tut_counter'); hud.showHint('Идеально! Атакуй сразу — КОНТРУДАР'); }
    });
    b.on('resonanceFull', () => {
      if (this.abilities.loadout.r && !S.flag('tut_ult')) { S.setFlag('tut_ult'); hud.showHint('Резонанс полон — R: ЗАТМЕНИЕ'); }
    });
    b.on('playerHurt', () => {
      if (this.world.hero.hp < this.world.hero.maxHp * 0.25 && !S.flag('tut_low')) { S.setFlag('tut_low'); this.feel.voice('Пилот, броня трещит. Держи дистанцию.', 0); }
    });
  }

  /** Шаг симуляции + VFX + камера + HUD. realDt — реальное время кадра. */
  frame(realDt: number): void {
    const T = this.ctx.time;
    const input = this.ctx.input;
    input.update(T.real);
    T.update(realDt);
    // фиксированный шаг 60 Гц
    this.acc += realDt;
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      this.acc -= STEP; steps++;
      if (!T.paused) this.step(STEP * T.worldScale, STEP * T.heroScale, STEP);
    }
    if (steps >= 6) this.acc = 0;
    const dtW = realDt * T.worldScale;

    // шлейф клинка: сэмплы рукоять/кончик
    const h = this.world.hero;
    if (h.trailOn && !h.dead) { h.bladePoints(this.bladeA, this.bladeB); this.vfx.trail.push(this.bladeA, this.bladeB, h.swingWeight); }
    // ступени ранга (план §6.6): A — шлейф толще и ярче, искры гуще; S — следы и альтернативные финишеры; SS — аура
    const ri = this.world.rank.rankIdx;
    this.vfx.rankTier = ri >= 5 ? 3 : ri >= 4 ? 2 : ri >= 3 ? 1 : 0;
    this.vfx.trail.width = ri >= 3 ? 1.15 : 1;
    this.vfx.trail.intensity = h.eclipse ? 1.6 : ri >= 3 ? 1.35 : 1;
    this.vfx.trail.update(realDt * T.heroScale);
    // свечи гаснут по кругу, пока Звонарь заряжает удар (план §7.4): пламя, пятна света и дымок от погасших
    const ab = this.arena.bounds, acx = (ab.minX + ab.maxX) / 2, acz = (ab.minZ + ab.maxZ) / 2;
    this.douseOut.length = 0;
    this.flames.douse(acx, acz, this.world.candlesFrom, this.world.candlesOut, realDt, this.douseOut);
    this.pools.douse(acx, acz, this.world.candlesFrom, this.world.candlesOut);
    this.updateQuench(realDt);
    if (this.landing) this.updateLanding(realDt);
    for (const p of this.douseOut) this.vfx.smokePuff(p[0], p[1], p[2]);
    this.vfx.sync(this.world, realDt, dtW);
    this.view.syncTiles();
    this.view.update(realDt);
    this.rune.u.uPulse.value *= Math.exp(-realDt * 4);
    // руны гаснут, когда пол под ними обрушился (вторая фаза босса)
    const runeTarget = this.arena.edge === 'abyss' && this.stage.boss ? 0 : 1;
    this.rune.u.uAlpha.value += (runeTarget - this.rune.u.uAlpha.value) * Math.min(1, realDt * 2);
    // рендер врагов и героя
    this.enemies.render(this.world.enemies, this.world.shadows);
    h.avatar.render(true, h.blinking);
    // камера
    this.updateCamera(realDt);
    this.feel.update(realDt);
    this.updateMusic(realDt);
    // fps
    this.fpsAcc += realDt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    // конец этапа
    if (this.endT > 0) {
      this.endT -= realDt;
      if (this.outcome === 'won' && this.endT < (this.stage.boss ? 1.0 : 2.3) && h.state !== 'victory' && !h.dead) h.victory();
      if (this.endT <= 0) { this.endT = -1; this.onEnd?.({ cleared: this.outcome === 'won', world: this.world, stage: this.stage }); }
    }
  }

  private step(dtW: number, dtH: number, dtR: number): void {
    this.world.step(dtW, dtH, this.ctx.input, dtR);
    if (!this.boss && this.runner.boss instanceof Hierophant) this.boss = new HierophantController(this.bossHost(), this.runner.boss);
    this.boss?.step(dtW);
  }

  private bossHost(): BossHost {
    const ctx = this.ctx;
    return {
      world: this.world,
      say: (line, sp) => this.feel.voice(line, 0, sp),
      banner: (name, title) => ctx.hud.bigBanner(name, title, 'hunger', 3.2, 50),
      letterbox: (v) => this.feel.setLetterbox(v),
      slow: (scale, sec) => ctx.time.cinematic(sec, scale),
      flash: (v) => this.feel.whiteFlash(v),
      starFlare: (v) => { ctx.renderer.sky.u.uStarFlare.value = v; },
      musicPhase: (p) => { ctx.music.phase = p; },
      emitFire: (x, y, z, censer) => {
        if (censer) this.vfx.norm.emit({ x, y, z, vy: 1.2, vx: fxRng.spread(0.3), vz: fxRng.spread(0.3), life: 1.6, size: 0.35, size1: 1.1, color: [0.06, 0.04, 0.06], alpha: 0.5, drag: 1, frame: 'smoke' });
        else for (let i = 0; i < 2; i++) this.vfx.add.emit({ x: x + fxRng.spread(0.3), y, z: z + fxRng.spread(0.3), vy: fxRng.range(1.5, 3), vx: fxRng.spread(0.4), vz: fxRng.spread(0.4), life: 0.8, size: 0.22, size1: 0.03, color: C.ember, drag: 0.6, frame: 'dot' });
      },
      skipRequested: () => ctx.input.buffer.peek('attack', ctx.input.now) || ctx.input.buffer.peek('dash', ctx.input.now),
      scene: (track, calls, onEnd) => {
        for (const [k, f] of Object.entries(calls)) this.sceneCalls.set(k, f);
        this.playScene(track, onEnd, { hud: false });
      },
      music: (cue: MusicCue) => { if (cue === 'silence') ctx.music.stop(1.2); else this.feel.musicCue(cue); },
      startSong: () => {
        if (ctx.music.song?.id === 'hierophant') return;
        ctx.music.play(hierophantSong(), 0.6);
        ctx.audio.play('boss_intro', { gain: 0.8 });
      },
      quench: (x, z, r) => this.quench(x, z, r),
      runes: (x, z) => {
        // красные руны вокруг алтаря: кольца-печати и багровые пятна света
        for (let i = 0; i < 3; i++) this.vfx.rings.spawn(x, z, 1 + i * 1.6, 2.4 + i * 1.8, 1.6 + i * 0.3, C.hungerHot, 0.18, 0.9);
        this.vfx.lights.flash(x, 0.6, z, C.hunger, 3, 8, 2.2);
        ctx.audio.play('tele_choir', { gain: 0.35 });
      },
      chains: (list) => { this.vfx.chains.hang = list; },
      dust: (x, z) => {
        for (let i = 0; i < 46; i++) this.vfx.norm.emit({ x: x + fxRng.spread(9), y: fxRng.range(7, 11), z: z + fxRng.spread(8), vy: -fxRng.range(0.5, 1.5), gravity: -1.5, life: 2.6, size: fxRng.range(0.15, 0.35), size1: 0.6, color: C.dust, alpha: 0.4, drag: 0.6, frame: 'smoke' });
      },
    };
  }

  /** Свечи гаснут в круге r от точки волной (r растёт); r = 0 — снова зажечь (план §8.2, §8.3). */
  private readonly quenchAt = { x: 0, z: 0, r: 0, target: 0 };
  quench(x: number, z: number, r: number): void {
    const q = this.quenchAt;
    q.x = x; q.z = z; q.target = r;
    if (r <= 0) { q.r = 0; this.pools.quench(0, 0, 0); }
  }

  private updateQuench(realDt: number): void {
    const q = this.quenchAt;
    if (q.target <= 0) return;
    q.r = Math.min(q.target, q.r + realDt * 34);
    this.flames.quench(q.x, q.z, q.r, realDt, this.douseOut);
    this.pools.quench(q.x, q.z, q.r);
  }

  private updateCamera(realDt: number): void {
    const h = this.world.hero, cam = this.cam;
    let tx = h.x, tz = h.z;
    const focusBoss = this.boss?.cameraTarget() ?? (this.runner.guardian && !this.runner.guardian.dead ? this.runner.guardian : null);
    let zoom = 1;
    if (focusBoss) {
      // центр масс с весом 0.65 на героя; зум под размер босса
      tx = h.x * 0.65 + focusBoss.x * 0.35; tz = h.z * 0.65 + focusBoss.z * 0.35;
      const d = Math.hypot(focusBoss.x - h.x, focusBoss.z - h.z);
      zoom = Math.max(1, Math.min(1.35, 0.85 + d / 22)) * (this.boss?.zoomMul ?? 1);
      // рамка босса (план §5.3, п. 4): верх модели не выше 78 % высоты экрана — иначе отъезжаем
      _top.set(focusBoss.x, (focusBoss as { height?: number }).height ?? 4, focusBoss.z).project(this.ctx.renderer.camera);
      const frac = (_top.y + 1) / 2;
      if (frac > 0.78) this.bossFrame = Math.min(0.8, this.bossFrame + realDt * 0.9);
      else if (frac < 0.7) this.bossFrame = Math.max(0, this.bossFrame - realDt * 0.4);
      zoom *= 1 + this.bossFrame;
      // оглушённый Страж или босс: камера подъезжает на 6 % (эталонный эпизод §4.0, п. 5)
      const stunned = (focusBoss as { stunned?: boolean }).stunned ? 1 : 0;
      this.stunZoom += (stunned - this.stunZoom) * Math.min(1, realDt * (stunned ? 5 : 2));
      zoom *= 1 - 0.06 * this.stunZoom;
    } else {
      // боевой зум: только большая толпа (12+ в 13 м) отодвигает камеру, не дальше 1.12
      let near = 0;
      for (const e of this.world.enemies) if (!e.dead && Math.hypot(e.x - h.x, e.z - h.z) < 13) near++;
      if (near >= 12) zoom = 1 + Math.min(0.12, (near - 11) * 0.02);
      this.bossFrame = 0;
    }
    this.feel.baseZoom = zoom;
    const lead = this.world.hero.state === 'move' ? 0.18 : 0;
    cam.update(realDt, tx, tz, h.vx * lead, h.vz * lead, this.ctx.renderer.camera);
    this.boss?.cameraOverride(cam, this.ctx.renderer.camera, realDt);
    // врезка Затмения: камера наезжает на Пилота снизу, за ним — небо, где луна закрывает солнце
    if (this.ultCut > 0 && !this.cine.busy) {
      this.ultCut -= realDt;
      const t = 0.9 - this.ultCut;
      const w = Math.max(0, Math.min(1, t / 0.15, this.ultCut / 0.35));
      // спереди-сбоку, ниже груди: Пилот целиком, за ним — небо
      const fx = Math.sin(h.facing), fz = Math.cos(h.facing);
      _cutPos.set(h.x + fx * 6 + fz * 1.6, 1.0, h.z + fz * 6 - fx * 1.6);
      _cutLook.set(h.x, 1.55, h.z);
      cam.cine = w > 0 ? { pos: _cutPos, look: _cutLook, w } : null;
      cam.update(0, tx, tz, 0, 0, this.ctx.renderer.camera);
      if (this.ultCut <= 0) cam.cine = null;
    }
    // небо и свет арены на время ульты
    const ek = h.eclipse ? 1 : 0;
    this.eclipseK += (ek - this.eclipseK) * Math.min(1, realDt * (ek ? 3 : 1.2));
    const sky = this.ctx.renderer.sky.u;
    sky.uEclipse.value = Math.max(this.eclipseK, this.skyCine.eclipse);
    sky.uStarLit.value = this.skyCine.starLit;
    sky.uSkyCrack.value = this.skyCine.crack;
    G.uHemiTop.value.copy(this.baseHemi).lerp(ECLIPSE_HEMI, this.eclipseK * 0.8);
    G.uMoonColor.value.copy(this.baseMoon).lerp(ECLIPSE_MOON, this.eclipseK * 0.7);
    if (!this.ctx.time.paused) {
      this.cine.update(realDt, cam);
      // дорожка режиссёра ведёт камеру поверх пролётов
      this.director.update(realDt, cam);
    }
  }

  /**
   * Сыграть сцену (план §8.1): герой заперт и неуязвим, HUD скрыт, летербокс; по концу — всё обратно.
   * Пропуск — удержанием атаки.
   */
  playScene(track: CineTrack, onEnd?: (skipped: boolean) => void, opts: { hud?: boolean; letterbox?: boolean } = {}): void {
    const h = this.world.hero, ctx = this.ctx;
    h.locked = true;
    h.invulnUntil = Math.max(h.invulnUntil, h.clock + 999);
    if (opts.letterbox !== false) this.feel.setLetterbox(1);
    if (opts.hud === false) ctx.hud.visible = false;
    this.director.play(track, (skipped) => {
      h.locked = false;
      h.invulnUntil = h.clock + 0.5;
      this.feel.setLetterbox(0);
      ctx.hud.visible = true;
      onEnd?.(skipped);
    });
  }

  private directorHost() {
    const ctx = this.ctx, w = this.world;
    const heroActor: DirectorActor = {
      get x() { return w.hero.x; }, set x(v) { w.hero.x = v; },
      get z() { return w.hero.z; }, set z(v) { w.hero.z = v; },
      get y() { return w.hero.y; }, set y(v) { w.hero.y = v; },
      get facing() { return w.hero.facing; }, set facing(v) { w.hero.facing = v; },
      get puppet() { return w.hero.avatar.puppet; },
    };
    const enemyActor = (who: string): DirectorActor | null => {
      const e = who === 'boss' ? (this.runner.boss ?? this.runner.guardian) : w.enemies.find((x) => x.kind === who && !x.dead) ?? null;
      return e ?? null;
    };
    return {
      actor: (who: string) => (who === 'hero' ? heroActor : this.props.get(who) ?? enemyActor(who)),
      playClip: (who: string, clip: string) => { if (who === 'hero') w.hero.avatar.puppet.play(clip, 1, 0.08); },
      shatter: (who: string, dx: number, dz: number, power: number) => {
        const e = enemyActor(who) as Enemy | null;
        if (e) w.killEnemy(e, dx, dz, power);
      },
      timeScale: (scale: number, dur: number) => ctx.time.cinematic(dur, scale),
      sky: (p: SkyParam, v: number) => { this.skyCine[p] = v; },
      skyValue: (p: SkyParam) => this.skyCine[p],
      music: (cue: 'silence' | 'stinger' | 'leitmotif' | 'resolve') => this.feel.musicCue(cue),
      sfx: (id: string, gain: number) => ctx.audio.play(id, { gain }),
      say: (line: string, sp: 'kaelis' | 'boss') => this.feel.voice(line, 0, sp),
      banner: (text: string, sub: string | undefined, color: 'gold' | 'void' | 'hunger' | 'white' | 'ether' | 'steel', dur: number, size: number) => ctx.hud.bigBanner(text, sub, color, dur, size),
      flash: (v: number) => this.feel.whiteFlash(v),
      letterbox: (v: number) => this.feel.setLetterbox(v),
      call: (fn: string, arg?: number) => this.sceneCalls.get(fn)?.(arg),
      holding: () => ctx.input.attackHeld,
      tapped: () => !!ctx.input.buffer.consume('attack', ctx.input.now),
      seen: (id: string) => ctx.save.cine[id] ?? 0,
      markSeen: (id: string) => { ctx.save.cine[id] = (ctx.save.cine[id] ?? 0) + 1; ctx.persist(); },
      overlay: (skip: number, tap: { k: number; hit: boolean } | null) => ctx.hud.cineOverlay(skip, tap),
    };
  }

  /** Логика сцен (шаг do: 'call'): регистрируют пролог, босс, kill-cam. */
  readonly sceneCalls = new Map<string, (arg?: number) => void>();

  /**
   * Пролог, планы 6–8 (план §8.2): Пилот падает в кратер, ударная волна гасит свечи, визор загорается,
   * обломок обшивки «Инея» вспыхивает Пустотой и становится клинком, из темноты выползает Шелуха.
   */
  private startLanding(): void {
    const w = this.world, h = w.hero, ctx = this.ctx;
    this.runner.introTime = 1e9;
    const spots: LandingSpots = { x: h.x, z: h.z, shardX: h.x + 1.0, shardZ: h.z - 1.5, huskX: -2, huskZ: -10 };
    const hp = { x: 0, z: 0 };
    this.arena.nearestWalkable(spots.huskX, spots.huskZ, hp);
    spots.huskX = hp.x; spots.huskZ = hp.z;
    const shard = new THREE.Mesh(buildHullShard(), obsidianMaterial({ rim: '#9fb4d0', rimStrength: 0.6, rimPower: 2.2, emissive: '#d6c4ff', emissive2: '#ffd29a', emissiveStrength: 1.4 }));
    shard.position.set(spots.shardX, 0, spots.shardZ);
    this.group.add(shard);
    this.landing = { visorT: -1, igniteT: -1, shard, music: false };
    const L = this.landing;
    const calls = this.sceneCalls;
    let thaw = () => {};
    calls.set('landStart', () => {
      h.y = 9; h.bladeTarget = 0.001; h.avatar.bladeScale = 0.001; h.avatar.resetCloth();
    });
    calls.set('impact', () => {
      h.y = 0;
      w.bus.emit('shockwave', { x: h.x, z: h.z, r: 9, color: 'gold', strength: 1 });
      this.cam.addTrauma(0.75);
      this.vfx.debris.burst(h.x, 0.2, h.z, 0, 0, 14, 7, 0.2);
      this.vfx.burst(26, { x: h.x, y: 0.25, z: h.z, life: 1.4, size: 0.6, size1: 1.9, color: C.dust, alpha: 0.5, drag: 2.4, frame: 'smoke' }, { v: 8, vy: 0.5 }, false);
      this.quench(h.x, h.z, 26);
      ctx.input.vibrate(60);
    });
    calls.set('visor', () => { if (L.visorT < 0) L.visorT = 0; });
    calls.set('idle', () => { h.avatar.puppet.anim.stop(0.3); });
    calls.set('ignite', () => {
      if (L.igniteT >= 0) return;
      L.igniteT = 0;
      shard.visible = false;
      h.bladeTarget = 1;
      h.avatar.handPos(_top);
      this.vfx.rings.spawn(_top.x, _top.z, 0.3, 4.5, 0.6, C.voidHot, 0.3, 0.9, _top.y);
      this.vfx.burst(30, { x: _top.x, y: _top.y, z: _top.z, life: 0.7, size: 0.1, size1: 0.01, color: C.voidHot, drag: 2.5, frame: 'spark', stretch: 1.6 }, { v: 7, vy: 3 });
      this.vfx.lights.flash(_top.x, _top.y, _top.z, C.voidHot, 4, 9, 0.9);
    });
    calls.set('husk', () => {
      if (w.enemies.length) return;
      const e = createEnemy('husk', { zone: w.zone, stage: w.stage, mode: w.mode });
      e.x = spots.huskX; e.z = spots.huskZ;
      e.facing = Math.atan2(h.x - e.x, h.z - e.z);
      // проявляется из тьмы и ждёт: нападает только когда управление вернётся
      const brain = e as unknown as { think: (...a: unknown[]) => void };
      const think = brain.think;
      brain.think = () => {};
      thaw = () => { brain.think = think; };
      w.addEnemy(e);
    });
    calls.set('title', () => {
      this.quench(0, 0, 0);
      ctx.hud.bigBanner('VOIDBREAKER', 'Разрушитель Пустоты', 'void', 2.8, 70);
      this.cam.addTrauma(0.35);
    });
    calls.set('music', () => {
      if (L.music) return;
      L.music = true;
      ctx.music.play(stageSong(this.stage.id), 0.3);
    });
    this.playScene(landingTrack(spots), () => {
      // конец сцены или пропуск: всё в конечное состояние, первая волна
      calls.get('ignite')!();
      calls.get('music')!();
      thaw();
      this.quench(0, 0, 0);
      h.y = 0; h.avatar.puppet.anim.stop(0.3);
      this.runner.introTime = 0;
      this.runner.skipIntro();
    }, { hud: false });
  }

  private updateLanding(realDt: number): void {
    const L = this.landing!, h = this.world.hero;
    // визор загорается, на клинке — вспышка Пустоты, дальше — как обычно
    if (L.visorT >= 0) { L.visorT += realDt; h.glowBoost = Math.min(1.2, L.visorT * 2.4) * (L.igniteT >= 0 ? Math.max(0, 1 - L.igniteT / 2.5) : 1); }
    if (L.igniteT >= 0) { L.igniteT += realDt; h.glowBoost += Math.max(0, 1.6 - L.igniteT * 1.6); }
    if (!this.director.active && L.igniteT > 3) { h.glowBoost = 0; this.landing = null; }
  }

  /** Слои музыки по интенсивности боя (GDD §18.3). */
  private updateMusic(realDt: number): void {
    this.intensityT -= realDt;
    if (this.intensityT > 0) return;
    this.intensityT = 0.5;
    const w = this.world;
    if (w.hero.dead || this.outcome !== 'playing') return;
    let alive = 0, elite = false;
    for (const e of w.enemies) if (!e.dead) { alive++; if (e.elite.length || e.isGuardian || e.isBoss) elite = true; }
    let x = 0.3;
    if (alive >= 4 || elite) x = 0.6;
    if (w.rank.rankIdx >= 3 || this.runner.guardian || this.boss) x = 0.9;
    if (this.runner.phase === 'breather' || this.runner.phase === 'intro') x = Math.min(x, 0.3);
    if (w.hero.eclipse) x = 1;
    if (Math.abs(x - this.ctx.music.intensity) > 0.01) this.ctx.music.setIntensity(x);
  }

  hudFrame(): Parameters<GameContext['hud']['draw']>[1] {
    const r = this.ctx.renderer;
    return {
      world: this.world, abilities: this.abilities, input: this.ctx.input,
      project: (x, y, z, out) => r.project(x, y, z, out),
      wave: this.runner.phase === 'intro' || this.stage.boss ? null : { index: Math.max(0, this.runner.waveIdx), total: this.runner.waveTotal },
      boss: this.boss?.hudBoss() ?? null, bossName: this.boss?.name ?? '', bossPhases: this.boss?.phaseMarks ?? [], bossPhase: this.boss?.phase ?? 0,
      guardian: this.runner.guardian,
      stageLabel: this.stage.boss ? 'БОСС' : `${this.stage.zone + 1}-${this.stage.index + 1}`,
      stageName: this.stage.name,
      showTouch: this.ctx.input.touchUi,
      fps: this.fps,
      showFps: this.ctx.settings.showFps,
      debugNav: DEBUG_NAV,
    };
  }

  private static feelSettings(s: Settings): Settings { return { ...s, flashes: effectiveFlashes(s) }; }

  /** Настройки, изменённые из паузы, сразу действуют в текущем бою. */
  applySettings(): void {
    this.feel.settings = Battle.feelSettings(this.ctx.settings);
    this.cam.baseDist = CAM_DIST * this.ctx.settings.camDist;
    this.ctx.hud.subtitleScale = this.ctx.settings.subtitleSize;
  }

  dispose(): void {
    this.cine.clear(this.cam);
    this.director.clear(this.cam);
    this.feel.dispose();
    this.world.hero.avatar.dispose();
    this.world.bus.clear();
    this.ctx.renderer.scene.remove(this.group);
    this.view.dispose();
    this.flames.dispose();
    this.enemies.dispose();
    this.vfx.clear();
    this.ctx.music.onBeat = null;
    this.ctx.renderer.post.state.letterbox = 0;
    this.ctx.renderer.post.state.desat = 0;
    this.ctx.renderer.post.state.lowHp = 0;
    this.ctx.renderer.post.state.pinch.w = 0;
    this.ctx.renderer.sky.u.uEclipse.value = 0;
    G.uHemiTop.value.copy(this.baseHemi);
    G.uMoonColor.value.copy(this.baseMoon);
    this.ctx.time.reset();
  }
}

/** Кратер 1-1: вздыбленные плиты и тёмное пятно копоти — без свечения (фиолетовый — только у Пилота). */
function craterMeshes(): THREE.Object3D[] {
  const rubble = new THREE.Mesh(buildCrater(), obsidianMaterial({ rim: ZONE1_LOOK.rim, rimStrength: 0.14, rimPower: 3.2, emissive: ZONE1_LOOK.veins, emissive2: ZONE1_LOOK.warm, emissiveStrength: 1.8 }));
  rubble.position.set(CRATER.x, 0, CRATER.z);
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(3.1, 40), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; void main() { float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.01, 0.012, 0.018, smoothstep(1.0, 0.2, d) * 0.7); }',
  }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(CRATER.x, 0.015, CRATER.z);
  scorch.renderOrder = 2;
  return [scorch, rubble];
}
