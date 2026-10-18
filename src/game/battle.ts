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
import { effectiveFlashes, type Settings } from '../meta/settings';
import type { GameContext } from './context';
import { FeelSystem } from './feel';
import { Cinematics } from './cinematics';
import type { Enemy } from '../world/enemy';
import type { BossController } from '../world/boss/bossBase';
import '../world/boss/guardians';
import { Hierophant, HierophantController, type BossHost } from '../world/boss/hierophant';
import { C } from '../vfx/battleVfx';
import { fxRng } from '../core/rng';
import { G } from '../render/materials';


const _top = new THREE.Vector3();
/** Базовая дистанция боевой камеры (м) при «Дистанции камеры» = 100 %. Герой ~13 % высоты экрана (план §5.3). */
const CAM_DIST = 17;
export const STEP = 1 / 60;
/** Dev: ?nav — оверлей поля потоков (план §4.4, п. 9). */
const DEBUG_NAV = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nav');

export interface BattleOutcome { cleared: boolean; world: World; stage: StageDef }

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
  private readonly baseHemi = G.uHemiTop.value.clone();
  private readonly baseMoon = G.uMoonColor.value.clone();

  constructor(private ctx: GameContext, readonly stage: StageDef, stats: HeroStats, loadout: Loadout) {
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
    this.enemies.warm(['husk', 'crawler', 'mantis', 'crucifier', 'eye', 'acolyte', 'brute']);
    r.scene.add(this.group);

    this.runner = new StageRunner(this.world, stage);
    this.world.stepHooks.push((dt) => this.runner.step(dt));

    // старт: герой у ближнего края, смотрит вглубь арены
    const b = this.arena.bounds;
    const sx = ARENAS[stage.arena].parts[0].x, sz = Math.min(b.maxZ - 3, (b.maxZ + b.minZ) / 2 + (b.maxZ - b.minZ) * 0.25);
    const o = { x: 0, z: 0 };
    this.arena.nearestWalkable(sx, sz, o);
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
    this.bindEvents();
    ctx.time.reset();
    if (!stage.boss) {
      // пролёт над ареной; первая волна — когда камера опустится к Пилоту
      const ab = this.arena.bounds;
      this.runner.introTime = 3.0;
      this.cine.stageIntro(stage, { x: (ab.minX + ab.maxX) / 2, z: (ab.minZ + ab.maxZ) / 2 }, Math.max(ab.maxX - ab.minX, ab.maxZ - ab.minZ), () => this.runner.skipIntro());
    }
    ctx.music.play(stage.boss ? hierophantSong() : stageSong(stage.id), 0.3);
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
        hud.showHint(S.input.lastDevice === 'touch' ? 'Левый палец — движение • Кнопка — атака' : 'WASD — движение • ЛКМ / J — атака');
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
      if (this.stage.tutorial === 'charged' && en.kind === 'golem' && !S.flag('tut_charged')) {
        S.setFlag('tut_charged');
        hud.showHint('Удерживайте атаку — заряженный удар быстро оглушает');
      }
      if (this.stage.tutorial === 'charged' && en.kind === 'eye' && !S.flag('tut_q')) {
        S.setFlag('tut_q');
        setTimeout(() => hud.showHint('Q — Серп Луны достанет Око издалека'), 1500);
      }
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
    this.vfx.sync(this.world, realDt, dtW);
    this.view.syncTiles();
    this.view.update(realDt);
    this.rune.u.uPulse.value *= Math.exp(-realDt * 4);
    // руны гаснут, когда пол под ними обрушился (вторая фаза босса)
    const runeTarget = this.arena.edge === 'abyss' && this.stage.boss ? 0 : 1;
    this.rune.u.uAlpha.value += (runeTarget - this.rune.u.uAlpha.value) * Math.min(1, realDt * 2);
    // рендер врагов и героя
    this.enemies.render(this.world.enemies);
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
    };
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
    this.ctx.renderer.sky.u.uEclipse.value = this.eclipseK;
    G.uHemiTop.value.copy(this.baseHemi).lerp(ECLIPSE_HEMI, this.eclipseK * 0.8);
    G.uMoonColor.value.copy(this.baseMoon).lerp(ECLIPSE_MOON, this.eclipseK * 0.7);
    if (!this.ctx.time.paused) this.cine.update(realDt, cam);
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
