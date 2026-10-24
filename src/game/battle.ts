import * as THREE from 'three';
import { ARENAS } from '../data/arenas';
import type { StageDef } from '../data/stages';
import { buildArenaView, ZONE1_LOOK, type ArenaView } from '../gen/zone/arenaView';
import { EnemyRenderer } from '../render/enemyRenderer';
import { QUALITY } from '../render/renderer';
import { Flames, LightPools, RuneCircle } from '../vfx/ambient';
import { BattleVfx } from '../vfx/battleVfx';
import { ContactShadows } from '../render/contactShadows';
import { segmentBlocked, XRAY } from '../world/occlusion';
import { BOSS_SCAR_LIFE, FloorScars, SCAR_LIFE } from '../vfx/scars';
import { ArenaEvents } from './arenaEvents';
import { Abilities, type Loadout } from '../world/abilities';
import { Arena } from '../world/arena';
import { CameraRig } from '../world/camera';
import type { HeroStats } from '../world/heroStats';
import { BREATHER, StageRunner } from '../world/stage';
import { World } from '../world/world';
import { guardianSong, hierophantSong, stageSong } from '../audio/music';
import type { MusicCue } from './director';
import { effectiveFlashes, type Settings } from '../meta/settings';
import { awardExecution } from '../meta/progression';
import type { GameContext } from './context';
import { FeelSystem } from './feel';
import { Cinematics, GUARDIAN, STAGE_VISTA_T } from './cinematics';
import { Ambience, AMBIENCE, AMB_LEVEL } from '../audio/ambience';
import { RISER_LEN } from '../audio/sfx';
import { AshFall, BeamDust } from '../vfx/atmosphere';
import { KaelisDrone } from '../vfx/kaelis';
import { killBellTrack, killGateTrack } from '../world/boss/guardianScenes';
import { Clip } from '../anim/clip';
import type { ClipDef } from '../anim/clip';
import { Director, type CineTrack, type DirectorActor, type SkyParam, type V3 } from './director';
import type { Enemy } from '../world/enemy';
import type { BossController } from '../world/boss/bossBase';
import '../world/boss/guardians';
import { EXEC_HP, Hierophant, HierophantController, type BossHost } from '../world/boss/hierophant';
import { C } from '../vfx/battleVfx';
import { fxRng } from '../core/rng';
import { clamp, hexToLinear } from '../core/math';
import { Ease } from '../core/ease';
import { G, obsidianMaterial } from '../render/materials';
import { buildBladeSocket, buildCrater, buildHullShard } from '../gen/zone/space';
import { createEnemy } from '../world/enemies/factory';
import type { EnemyKind } from '../data/enemies';
import { TRAINING_DRILLS, TRAINING_DUMMIES, TRAINING_SPAR } from '../data/stages';
import type { TrainingCard } from '../ui/hud';
import { DrillTracker, type DrillState } from './drills';
import { IGNITE, LANDING_FROM, landingTrack, type LandingSpots } from './prologueTracks';
import { ExtractionAttachment, extractionGripMatrix, extractionStand } from './extraction';


const _top = new THREE.Vector3();
/**
 * Свет загоревшейся звезды на Пилоте в финале казни (ТЗ §5): за reach с прилетает от звезды (from м по
 * горизонтали в её сторону, на высоте fromY) к лицу (near м к камере, высота y) и держится до конца сцены;
 * после — гаснет за fade. Тёплый белый: золото — окружение, не угроза.
 */
export const STAR_LIGHT = { reach: 0.8, fade: 1.0, from: 6, fromY: 7, near: 1.1, y: 1.6, rgb: [1.5, 1.32, 1.05] as [number, number, number], intensity: 4.5, radius: 4.5 };
/** Базовая дистанция боевой камеры (м) при «Дистанции камеры» = 100 %. Герой ~13 % высоты экрана (план §5.3). */
const CAM_DIST = 17;
export const STEP = 1 / 60;
/** Dev: ?nav — оверлей поля потоков (план §4.4, п. 9). */
const DEBUG_NAV = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nav');

export interface BattleOutcome { cleared: boolean; world: World; stage: StageDef }
/** prologue — бой 1-1 начинается приземлением Пилота (план §8.2, планы 6–8), а не пролётом над ареной. */
/** Сцены Кинозала, которые пересматриваются в бою (план §8.1): kill-cam стражей и интро Иерофанта. */
export type ReplayId = 'killGate' | 'killBell' | 'hierophantIntro' | 'hierophantEnd' | 'hierophantCollapse' | 'hierophantCrack' | 'prologueLanding';
/** Этап, на котором играет сцена, и для kill-cam — кто Страж. */
export const REPLAY: Record<ReplayId, { stage: string; guardian?: EnemyKind }> = {
  killGate: { stage: '1-3', guardian: 'gateGuardian' },
  killBell: { stage: '1-6', guardian: 'bellRinger' },
  hierophantIntro: { stage: 'boss1' },
  // казнь: интро пропускается, босс сразу в фазе III — на звёздном мосту, оглушён, на краю смерти
  hierophantEnd: { stage: 'boss1' },
  hierophantCollapse: { stage: 'boss1' },
  hierophantCrack: { stage: 'boss1' },
  prologueLanding: { stage: '1-1' },
};
/** Пауза после сцены перед возвратом в Святилище (с): осыпание Стража доигрывает. */
const REPLAY_TAIL = { kill: 1.6, intro: 0.5, execDelay: 0.4 };

/** prologue — бой 1-1 начинается приземлением; replay — пересмотр сцены: без волн и наград, по концу — onReplayEnd. */
export interface BattleOpts { prologue?: boolean; replay?: ReplayId; previewShort?: boolean }

/** Кратер от падения Пилота в центре 1-1 (план §8.5). */
const CRATER = { x: 0, z: 0.5 };
/** Стекло разбитой розы купола: бирюза и золото витражей. */
const LANDING_GLASS = ([['#5cc4e0', 2.2], ['#FFB866', 2.2], ['#e3c37e', 1.8]] as const).map(([c, k]) => hexToLinear(c).map((v) => v * k) as [number, number, number]);

/**
 * Бой на этапе: мир + арена + директор волн + VFX + камера + «сочность». Цикл — фиксированный шаг 60 Гц
 * в реальном времени, каждая система получает своё масштабированное dt (мир/герой).
 */
/** Свет арены в Затмении (план §6.9): небо и полусфера уходят в фиолетовый. */
const ECLIPSE_HEMI = new THREE.Vector3(0.09, 0.05, 0.2);
const ECLIPSE_MOON = new THREE.Vector3(0.42, 0.24, 0.8);
const _cutPos = new THREE.Vector3(), _cutLook = new THREE.Vector3(), _corona = new THREE.Vector3();
/** Корона в фазах босса уходит в багровый. */
const CORONA_RAGE = new THREE.Vector3(1.2, 0.18, 0.22);

/** Полных Расколов на сессию (план §5.6): первые два — полная версия, дальше — короткая. */
let fullShattersLeft = 2;

const _kp = new THREE.Vector3(), _kh = new THREE.Vector3();
/** Последний враг волны: масштаб времени, длительность (с), наезд камеры. Послебоевая тишина (с). */
export const WAVE_END = { scale: 0.3, sec: 0.4, push: 0.06 };
export const POST_SILENCE = 2.5;
/** Сильная доля: насколько ярче витражи и корона луны на пике пульса. */
export const BEAT = { glass: 0.5, moon: 0.35 };
/** Уровни музыки (интенсивность слоёв A–D): исследование — только A, бой, финал — всё. Последняя волна: +полтона. */
export const MUSIC_LEVEL = { explore: 0.1, fight: 0.3, final: 1 };
export const FINAL_TRANSPOSE = 100;
/** Тишина перед фирменной атакой: за сколько до удара (с) и до какой громкости (−18 дБ). */
export const SIG = { lead: 0.5, level: 0.126 };

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
  readonly skyCine: Record<SkyParam, number> = { starLit: 0, eclipse: 0, crack: 0, star2: 0 };
  /** Актёры-реквизит сцены по имени (корабль, обломки…). */
  readonly props = new Map<string, DirectorActor>();
  readonly abilities: Abilities;
  readonly group = new THREE.Group();
  /** Следы боя на полу (план §8.5). */
  readonly scars: FloorScars;
  /** Контактные тени под героем и врагами (разбор). */
  private readonly contact = new ContactShadows();
  /** Своё событие арены (план §8.5). */
  readonly events: ArenaEvents;
  private readonly ambience: Ambience | null;
  /** Пыль в лучах из окон и пепел на разной глубине (план §8.5). */
  private readonly beamDust: BeamDust | null;
  private readonly ash: AshFall;
  /** Живой дрон Каэлис (план §8.6). */
  readonly kaelis = new KaelisDrone();
  /** Наезд «волна закрыта» (реальные с до конца). */
  private waveEndT = 0;
  /** Пульс сильной доли (1 → 0): луна и витражи. */
  private beatPulse = 0;
  /** Корона луны без пульса доли (к ней тянется фаза босса). */
  private readonly coronaNow = new THREE.Vector3();
  /** Тишина перед фирменной атакой (план §8.7, п. 5): до приглушения и до удара (мировые с). */
  private readonly sigs: { duck: number; hit: number }[] = [];
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
  private disposed = false;
  /** Пересмотр сцены из Кинозала. */
  private readonly replay: { id: ReplayId; target: Enemy | null; seen: boolean; t: number; done: boolean; setup?: boolean } | null;
  /** Тренировочный зал: места манекенов, кто стоит и сколько ждать нового. */
  private training: { x: number; z: number; kind: EnemyKind; e: Enemy | null; t: number; spar?: boolean }[] | null = null;
  /** Упражнения зала: выполненные и строки панели (один массив на всё время — без мусора на кадр). */
  private drills: { tracker: DrillTracker; card: TrainingCard } | null = null;
  /** Сцена пересмотра закончилась — App возвращает в Святилище. */
  onReplayEnd: (() => void) | null = null;
  private landing: { t: number; visorT: number; igniteT: number; releaseT: number; shard: THREE.Mesh; socket: THREE.Mesh; attachment: ExtractionAttachment; music: boolean; call: number } | null = null;
  private readonly landingWeaponMatrix = new THREE.Matrix4();
  private readonly landingProps: THREE.Mesh[] = [];
  /** Положение луны до плана «на фоне луны» (сцена возвращает его). */
  private moonSaved: THREE.Vector3 | null = null;

  constructor(private ctx: GameContext, readonly stage: StageDef, stats: HeroStats, loadout: Loadout, readonly opts: BattleOpts = {}) {
    this.scars = new FloorScars(stage.boss ? BOSS_SCAR_LIFE : SCAR_LIFE);
    const r = ctx.renderer;
    const Q = QUALITY[r.quality];
    this.arena = new Arena(ARENAS[stage.arena]);
    this.world = new World(this.arena, `stage:${stage.id}`);
    this.world.zone = stage.zone;
    // ступень сложности: 1-7…1-9 — 6…8 (здоровье +12 %, урон +8 % за ступень сверх 1-6)
    this.world.stage = stage.boss ? 0 : Math.min(8, stage.index);
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
    this.group.add(this.flames.mesh, this.pools.mesh, this.rune.mesh, this.enemies.group, this.world.hero.avatar.group, this.vfx.group, this.scars.mesh, this.contact.mesh);
    // батчи всех врагов этапа (с Стражами и боссом) заранее: их шейдеры прогреются вместе со сценой
    const rigs = new Set<string>(['husk', 'crawler', 'mantis', 'crucifier', 'eye', 'acolyte', 'psalmist', 'brute']);
    for (const wv of stage.waves) for (const sp of wv.spawns) {
      // батч — по ригу вида (у вида свой риг или общий); узнаём у пробного экземпляра
      try { rigs.add(createEnemy(sp.enemy, { zone: stage.zone, stage: stage.index }).puppet.layout.def.id); } catch { /* вид без рига */ }
    }
    this.enemies.warm([...rigs]);
    r.scene.add(this.group);
    this.events = new ArenaEvents(this.world, this.view, this.group, this.vfx, stage);
    this.beamDust = this.view.rays.length ? new BeamDust(this.view.rays, this.view.rayColor, this.vfx.quality) : null;
    this.ash = new AshFall(this.vfx.quality);
    this.group.add(this.ash.mesh);
    if (this.beamDust) this.group.add(this.beamDust.mesh);
    this.group.add(this.kaelis.group);
    this.world.hero.avatar.kaelisHidden = true;
    ctx.audio.onSpeak = (sp, syl) => { if (sp === 'kaelis') this.kaelis.speak(syl); };
    const amb = AMBIENCE[stage.id];
    this.ambience = amb ? new Ambience(ctx.audio, amb) : null;

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
      sceneHost: () => this.directorHost(),
      letterbox: (v) => this.feel.setLetterbox(v),
      slow: (scale, sec) => ctx.time.cinematic(sec, scale),
      banner: (text, sub, color, dur, size) => ctx.hud.bigBanner(text, sub, color, dur, size),
      say: (line, sp) => this.feel.voice(line, 0, sp),
      flash: (v) => this.feel.whiteFlash(v),
      musicPhase: (p) => { ctx.music.phase = p; },
      stinger: () => ctx.music.stinger('stinger'),
      skipRequested: () => ctx.input.buffer.peek('attack', ctx.input.now) || ctx.input.buffer.peek('dash', ctx.input.now),
      once: (f) => { if (ctx.flag(f)) return false; ctx.setFlag(f); return true; },
      hud: (v) => { if (!this.director.active) ctx.hud.visible = v; },
    });
    this.director = new Director(this.directorHost());
    const su = ctx.renderer.sky.u;
    this.skyBase = { size: su.uMoonSize.value, corona: su.uCorona.value.clone() };
    this.coronaNow.copy(this.skyBase.corona);
    // мир помнит победу (план §8.3.2): звезда зоны горит на всех её аренах
    const lit = ctx.save.stars[`z${stage.zone + 1}`] ?? 0;
    this.skyCine.starLit = lit > 0 ? 1 : 0;
    this.skyCine.star2 = lit >= 2 ? 1 : 0;
    this.replay = opts.replay ? { id: opts.replay, target: null, seen: false, t: 0, done: false } : null;
    if (this.replay) {
      this.director.full = !opts.previewShort;
      if (opts.previewShort) ctx.save.cine[this.replay.id] = Math.max(2, ctx.save.cine[this.replay.id] ?? 0);
    }
    this.bindEvents();
    // шейдеры всей сцены — сейчас, на загрузке, а не фризом посреди боя (оптимизация)
    void ctx.renderer.warmAll(this.group, () => !this.disposed);
    ctx.time.reset();
    if (opts.prologue) this.startLanding();
    else if (this.replay) this.startReplay();
    else if (stage.training) this.startTraining();
    else if (!stage.boss) {
      // пролёт над ареной; первая волна — когда камера опустится к Пилоту
      const ab = this.arena.bounds;
      const vista = this.events.vista(this.world.hero.x, this.world.hero.z);
      this.runner.introTime = vista ? STAGE_VISTA_T.end - 0.1 : 3.0;
      this.cine.stageIntro(stage, { x: (ab.minX + ab.maxX) / 2, z: (ab.minZ + ab.maxZ) / 2 }, Math.max(ab.maxX - ab.minX, ab.maxZ - ab.minZ), () => this.runner.skipIntro(), vista);
    }
    // в прологе музыка 1-1 вступает после титула; тема босса — с его именем в интро (план §8.3)
    if (stage.boss) { this.runner.introTime = 0.05; ctx.music.preload(hierophantSong()); }
    else if (!opts.prologue && !this.replay) ctx.music.play(stageSong(stage.id), 0.3);
    // тема Стража запекается заранее — переключение на его появлении без паузы
    const guardianWave = stage.waves.find((wv) => wv.guardian);
    if (guardianWave) ctx.music.preload(guardianSong(guardianWave.spawns[0].enemy));
    // синхронизация с боем (план §8.7, п. 9): сильная доля — руна, луна, витражи, звон Иерофанта
    ctx.music.onBeat = (bar, beat) => {
      void bar;
      if (beat !== 0) return;
      this.rune.u.uPulse.value = 0.5;
      this.beatPulse = 1;
      if (this.runner.boss instanceof Hierophant) this.runner.boss.beatGlow = 1;
    };
  }

  private bindEvents(): void {
    const b = this.world.bus, hud = this.ctx.hud, S = this.ctx;
    b.on('waveStart', (e) => {
      if (!this.stage.boss) hud.waveBanner(e.index, e.total);
      if (e.index > 0) S.music.stinger('stinger');
      // порталы открылись — тайко и «бум»; последняя волна — уровень 4: +полтона, все слои, хор и удары
      if (!this.stage.boss) S.music.stinger('waveHit');
      if (!this.stage.boss && e.total > 1 && e.index === e.total - 1) { S.music.final = true; S.audio.musicTranspose = FINAL_TRANSPOSE; }
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
    b.on('waveClear', (e) => {
      S.audio.play('wave_clear', { gain: 0.6 });
      this.view.lightConstellations();
      // за такт до следующей волны — райзер: пик приходится на открытие порталов
      if (e.index + 1 < e.total && !this.stage.boss) S.audio.play('riser', { delay: Math.max(0, BREATHER - RISER_LEN), gain: 0.7, vary: 0 });
      if (e.index + 1 >= e.total) { S.music.final = false; S.audio.musicTranspose = 0; }
    });
    b.on('stageClear', () => {
      this.outcome = 'won';
      // казнь (план §8.3.2): экран наград — только когда сцена досмотрена
      if (this.stage.boss) { this.endT = this.director.active ? -1 : 1.8; return; }
      // послебоевая тишина (план §8.8): музыка стихает, обломки ещё падают, Пилот опускает клинок — потом награды
      S.music.stop(POST_SILENCE * 0.8);
      this.endT = this.cine.busy === 'down' ? 4.6 : Math.max(2.9, POST_SILENCE + 0.4);
      this.cine.victory();
    });
    b.on('guardianRage', () => { if (this.runner.guardian) this.cine.guardianRage(this.runner.guardian, this.events.overhead()); });
    b.on('signature', (e) => { this.sigs.push({ duck: e.impactIn - SIG.lead, hit: e.impactIn }); });
    b.on('kill', (e) => {
      const en = e.target as Enemy;
      // последний враг волны (план §8.8): замедление 0.3 на 0.4 с и наезд 6 % — «волна закрыта»
      if (this.runner.phase === 'wave' && !this.runner.spawnsPending && !this.world.enemies.some((x) => !x.dead && x !== en) && !this.stage.boss) {
        this.ctx.time.slow(WAVE_END.scale, WAVE_END.sec);
        this.waveEndT = WAVE_END.sec + 0.35;
      }
      // после kill-cam облёт не нужен — сцена уже показала конец
      if (en.isGuardian && !en.isBoss && !en.killcamDone) this.cine.guardianDown(en);
    });
    b.on('killcam', (e) => this.playKillcam(e.target as Enemy));
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
      if (en.isGuardian && !en.isBoss && en.kind) { S.music.play(guardianSong(en.kind), 0.9); if (!this.replay) this.cine.guardianIntro(e.actor as Enemy); }
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
    b.on('enemyAttack', (e) => {
      if (e.kind === 'censer' && !S.flag('tut_censer')) { S.setFlag('tut_censer'); hud.showHint('Кадило можно отбить: полный заряженный удар вернёт его в золотую маску Иерофанта'); }
    });
    b.on('psalm', (e) => {
      if (e.kind === 'link' && !S.flag('tut_psalmist')) { S.setFlag('tut_psalmist'); hud.showHint('Псаломщик связал врагов нитью. Убей его первым — связанные будут оглушены'); }
    });
    b.on('shatterStart', () => { fullShattersLeft = this.world.fullShatters; });
    b.on('ultimate', () => { this.ultCut = 0.9; this.mood.violet = 1; this.mood.glass = 1; });
    // живые свечи (план §8.5): тяжёлый удар босса или Стража гасит все на 0.4 с; Раскол сильного — фиолетовая вспышка
    b.on('impact', (e) => { if (e.r >= 3 && (this.boss || this.runner.guardian)) this.mood.outT = 0.4; });
    b.on('shatter', (e) => { const t = e.target as Enemy; if (t.isBoss || t.isGuardian) this.mood.violet = 1; this.scar(e.x, e.z, 2.2, 1); });
    // следы боя: тяжёлые удары оставляют трещины и сколы (к концу боя арена выглядит иначе)
    // арена помнит бой (план §8.5): где Пилот много бил, ответный удар раскалывает пол сильнее
    b.on('impact', (e) => {
      if (e.r < 2 || (e.kind !== 'slam' && e.r < 3)) return;
      const wear = this.events.wearAt(e.x, e.z);
      this.scar(e.x, e.z, Math.min(4, e.r * 0.75 * (1 + 0.6 * wear)), 0.9 + 0.3 * wear);
    });
    b.on('strike', (e) => { if (e.source === 'blade' && (e.feel === 'heavy' || e.feel === 'break')) this.scar(e.x, e.z, e.feel === 'break' ? 1.8 : 1.2, 0.7); });
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

    // Сначала корень, поза и маркеры сцены; зависимые объекты и батчи видят
    // тот же момент времени, что и камера, а не позу прошлого кадра.
    if (!T.paused) {
      this.cine.update(realDt, this.cam);
      this.director.update(realDt, this.cam);
    }

    // шлейф клинка: сэмплы рукоять/кончик
    const h = this.world.hero;
    if (h.trailOn && !h.dead) { h.bladePoints(this.bladeA, this.bladeB); this.vfx.trail.push(this.bladeA, this.bladeB, h.swingWeight); }
    this.updateKaelis(realDt);
    this.updateSignatures(dtW);
    // ступени ранга (план §6.6): A — шлейф толще и ярче, искры гуще; S — следы и альтернативные финишеры; SS — аура
    const ri = this.world.rank.rankIdx;
    this.vfx.rankTier = ri >= 5 ? 3 : ri >= 4 ? 2 : ri >= 3 ? 1 : 0;
    this.vfx.trail.width = ri >= 3 ? 1.15 : 1;
    this.vfx.trail.intensity = h.eclipse ? 1.6 : ri >= 3 ? 1.35 : 1;
    this.vfx.trail.update(realDt * T.heroScale);
    // свечи гаснут по кругу, пока Звонарь заряжает удар (план §7.4): пламя, пятна света и дымок от погасших
    const ab = this.arena.bounds, acx = (ab.minX + ab.maxX) / 2, acz = (ab.minZ + ab.maxZ) / 2;
    this.douseOut.length = 0;
    // 1-4: волны гасят свечное поле (и его пятна света), зачистка — зажигает
    this.events.update(realDt, dtW, this.ctx.renderer.camera.position.y);
    // тихий фон арены: между волнами слышен, в бою уходит под музыку
    this.ambience?.set(this.runner.phase === 'wave' ? AMB_LEVEL.fight : AMB_LEVEL.calm);
    this.ambience?.update(realDt);
    this.ash.follow(this.cam.focus.x, this.cam.focus.z);
    const out = Math.max(this.world.candlesOut, this.events.fieldOut);
    this.flames.douse(acx, acz, this.world.candlesFrom, out, realDt, this.douseOut);
    this.pools.douse(acx, acz, this.world.candlesFrom, out);
    this.updateQuench(realDt);
    this.updateBeam(realDt);
    this.updateStarLight(realDt);
    this.updateMood(realDt);
    if (this.landing) this.updateLanding(realDt);
    if (this.replay) this.updateReplay(realDt);
    if (this.training) this.updateTraining(realDt);
    for (const p of this.douseOut) this.vfx.smokePuff(p[0], p[1], p[2]);
    this.vfx.sync(this.world, realDt, dtW);
    this.vfx.slashes.update(this.ctx.time.world);
    this.view.syncTiles();
    // пол ушёл в бездну — следы с ним
    if (this.arena.version !== this.scarArenaV) {
      this.scarArenaV = this.arena.version;
      this.scars.spots.forEach((s, i) => { if (s.alive && !this.arena.walkable(s.x, s.z)) this.scars.remove(i); });
    }
    this.view.update(realDt);
    this.rune.u.uPulse.value *= Math.exp(-realDt * 4);
    // руны гаснут, когда пол под ними обрушился (вторая фаза босса)
    const runeTarget = this.arena.edge === 'abyss' && this.stage.boss ? 0 : 1;
    this.rune.u.uAlpha.value += (runeTarget - this.rune.u.uAlpha.value) * Math.min(1, realDt * 2);
    // рендер врагов и героя
    this.enemies.render(this.world.enemies, this.world.shadows);
    this.updateXray(realDt);
    h.avatar.render(true, h.blinking);
    this.updateContact();
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
      // пересмотр сцены — без итогов и наград: выход в Святилище делает сам пересмотр
      if (this.endT <= 0) { this.endT = -1; if (!this.replay) this.onEnd?.({ cleared: this.outcome === 'won', world: this.world, stage: this.stage }); }
    }
  }

  private step(dtW: number, dtH: number, dtR: number): void {
    // «ДОБИТЬ»: атака по оглушённому боссу на краю смерти запускает казнь, а не удар
    const inp = this.ctx.input;
    if (this.boss?.executable && !this.director.active && inp.buffer.peek('attack', inp.now)) {
      inp.buffer.consume('attack', inp.now);
      this.boss.execute?.();
    }
    this.world.step(dtW, dtH, this.ctx.input, dtR);
    if (!this.boss && this.runner.boss instanceof Hierophant) {
      this.boss = new HierophantController(this.bossHost(), this.runner.boss);
      // цепи, колокола-спутники и прочие объекты босса — тоже до первого кадра с ними
      void this.ctx.renderer.warmAll(this.group, () => !this.disposed);
    }
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
      sky: (param, v) => { this.skyCine[param] = v; },
      transpose: (cents) => { ctx.audio.musicTranspose = cents; },
      duck: (level, hold) => ctx.music.duck(level, hold),
      starDir: () => { const d = ctx.renderer.sky.u.uMoonDir.value; return [d.x, d.y, d.z]; },
      sceneHit: (id) => this.director.hits.has(id),
      pages: (x, y, z) => {
        // обсидиан и страницы молитвенников осыпаются в бездну
        this.vfx.debris.burst(x, y, z, 0, 0, 18, 9, 0.24);
        for (let i = 0; i < 42; i++) this.vfx.norm.emit({ x: x + fxRng.spread(1.3), y: y + fxRng.spread(1.5), z: z + fxRng.spread(1.3), vx: fxRng.spread(1.6), vz: fxRng.spread(1.6), vy: fxRng.range(-0.3, 1.2), gravity: -0.9, drag: 0.6, life: fxRng.range(3, 4.5), size: fxRng.range(0.18, 0.28), size1: 0.12, color: [0.86, 0.82, 0.72], frame: 'page', spin: fxRng.spread(2.2) });
      },
      beam: (x, z) => { this.beamAt = { x, z, t: 0 }; this.feel.whiteFlash(0.45); },
      starLight: (dir) => { this.starLight = { t: 0, dir }; },
      // в пересмотре ctx.save — копия (replayContext): награда остаётся в ней
      saveStar: (flawless) => { awardExecution(ctx.save, this.stage.zone, flawless); ctx.persist(); },
      finishFight: () => { if (this.outcome === 'won') this.endT = 1.2; },
      light: (x, y, z, rgb, i, r, life) => this.vfx.lights.flash(x, y, z, rgb === 'gold' ? C.gold : C.void, i, r, life),
      dust: (x, z) => {
        for (let i = 0; i < 46; i++) this.vfx.norm.emit({ x: x + fxRng.spread(9), y: fxRng.range(7, 11), z: z + fxRng.spread(8), vy: -fxRng.range(0.5, 1.5), gravity: -1.5, life: 2.6, size: fxRng.range(0.15, 0.35), size1: 0.6, color: C.dust, alpha: 0.4, drag: 0.6, frame: 'smoke' });
      },
    };
  }

  /** След боя, если пол под ним цел; рядом с недавним — не дублировать. */
  private scar(x: number, z: number, size: number, strength: number): void {
    if (!this.arena.walkable(x, z)) return;
    for (const s of this.scars.spots) if (s.alive && Math.hypot(s.x - x, s.z - z) < size * 0.5) return;
    this.scars.add(x, z, size, strength);
  }

  /** Фирменная атака: за SIG.lead с до удара музыка падает до −18 дБ за 0.15 с; в момент удара — низкий импульс. */
  private updateSignatures(dtW: number): void {
    for (let i = this.sigs.length - 1; i >= 0; i--) {
      const s = this.sigs[i];
      const wasDuck = s.duck > 0;
      s.duck -= dtW; s.hit -= dtW;
      if (wasDuck && s.duck <= 0) this.ctx.music.duck(SIG.level, Math.max(0.05, s.hit - 0.15), 0.15, 0.6);
      if (s.hit <= 0) { this.ctx.audio.play('sub_pulse', { gain: 0.9 }); this.sigs.splice(i, 1); }
    }
  }

  /** Каэлис: следует за суставом у плеча. */
  private updateKaelis(realDt: number): void {
    const h = this.world.hero;
    this.kaelis.update(realDt, h.avatar.kaelisPos(_kp), h.hp / h.maxHp, h.eclipse, _kh.set(h.x, 0, h.z));
  }

  /** Настроение арены (план §8.5): свечи гаснут на 0.4 с, фиолетовая вспышка победы, витражи на ульте. */
  private readonly mood = { outT: 0, violet: 0, glass: 0 };
  private scarArenaV = -1;
  private readonly skyBase: { size: number; corona: THREE.Vector3 };

  private updateMood(realDt: number): void {
    const w = this.world, f = this.flames.u, m = this.mood;
    // пламя тянется к самому сильному живому: босс, Страж, элита
    let target: Enemy | null = null, k = 0;
    for (const e of w.enemies) {
      if (e.dead || !e.spawned) continue;
      const kk = e.isBoss ? 1 : e.isGuardian ? 0.85 : e.elite.length ? 0.55 : 0;
      if (kk > k) { k = kk; target = e; }
    }
    f.uLean.value += ((target ? k : 0) - f.uLean.value) * Math.min(1, realDt * 2);
    if (target) f.uLeanAt.value.set(target.x, 1, target.z);
    m.outT -= realDt;
    const out = m.outT > 0 ? 1 : 0;
    f.uOut.value += (out - f.uOut.value) * Math.min(1, realDt * (out ? 30 : 4));
    // ярость Стража и фазы босса — пламя краснеет
    const g = this.runner.guardian, ph = this.boss?.phase ?? 0;
    const red = g && !g.dead && (g as { phase?: number }).phase === 2 ? 0.7 : ph >= 3 ? 0.75 : ph === 2 ? 0.45 : 0;
    f.uRed.value += (red - f.uRed.value) * Math.min(1, realDt * 1.5);
    m.violet = Math.max(0, m.violet - realDt / 2.5);
    f.uViolet.value = m.violet;
    m.glass = Math.max(0, m.glass - realDt / 1.6);
    this.beatPulse = Math.max(0, this.beatPulse - realDt * 3.5);
    this.view.tintGlass(m.glass, this.beatPulse * BEAT.glass);
  }

  /** Луч из провала в небо после казни (план §8.3.2). */
  private beamAt: { x: number; z: number; t: number } | null = null;
  private updateBeam(realDt: number): void {
    const b = this.beamAt;
    if (!b) return;
    b.t += realDt;
    if (b.t > 2.6) { this.beamAt = null; return; }
    const k = Math.min(1, b.t / 0.3) * Math.min(1, (2.6 - b.t) / 0.8);
    for (let i = 0; i < 5; i++) this.vfx.add.emit({ x: b.x + fxRng.spread(0.6), y: fxRng.range(-8, 4), z: b.z + fxRng.spread(0.6), vy: fxRng.range(26, 40), life: 1.6, size: fxRng.range(0.8, 1.6) * k, size1: 0.2, color: [2.2, 1.9, 1.3], frame: 'flare' });
    this.vfx.lights.add(b.x, 3, b.z, [1.6, 1.4, 1.0], 5 * k, 14);
  }

  /**
   * Свет загоревшейся звезды на Пилоте (ТЗ §5, 11.3–12.3 с): тёплый белый свет за STAR_LIGHT.reach с прилетает
   * со стороны звезды (высоко и далеко) к лицу и броне Пилота со стороны камеры и держится до конца сцены,
   * затем гаснет за fade. Одно прослеживаемое движение — «свет дошёл до героя».
   */
  private starLight: { t: number; dir: [number, number, number]; out?: number } | null = null;
  private updateStarLight(realDt: number): void {
    const L = this.starLight;
    if (!L) return;
    L.t += realDt;
    const S = STAR_LIGHT, h = this.world.hero, cam = this.ctx.renderer.camera.position;
    if (L.out === undefined && !this.director.active) L.out = 0;
    if (L.out !== undefined) { L.out += realDt; if (L.out > S.fade) { this.starLight = null; return; } }
    const u = Ease.outCubic(Math.min(1, L.t / S.reach));
    const dl = Math.hypot(L.dir[0], L.dir[2]) || 1, cx = cam.x - h.x, cz = cam.z - h.z, cl = Math.hypot(cx, cz) || 1;
    // откуда: со стороны звезды, высоко; куда: перед лицом Пилота, к камере
    const fx = h.x + (L.dir[0] / dl) * S.from, fy = S.fromY, fz = h.z + (L.dir[2] / dl) * S.from;
    const tx = h.x + (cx / cl) * S.near, ty = S.y, tz = h.z + (cz / cl) * S.near;
    const k = Math.min(1, L.t / (S.reach * 0.5)) * (L.out !== undefined ? 1 - L.out / S.fade : 1);
    this.vfx.lights.add(fx + (tx - fx) * u, fy + (ty - fy) * u, fz + (tz - fz) * u, S.rgb, S.intensity * k, S.radius);
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
    if (this.waveEndT > 0) {
      this.waveEndT -= realDt;
      zoom *= 1 - WAVE_END.push * Math.min(1, this.waveEndT / 0.25, (WAVE_END.sec + 0.35 - this.waveEndT) / 0.12);
    }
    this.feel.baseZoom = zoom;
    // со Стражем и боссом камера наклоняется до ~49°: в кадре горизонт и луна (план §8.5)
    cam.tilt += ((focusBoss ? 0.86 : 0.96) - cam.tilt) * Math.min(1, realDt * 1.2);
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
    // реакция неба на фазы босса (план §8.5): луна ближе, корона багровеет
    const ph = Math.max(0, (this.boss?.phase ?? 1) - 1);
    // дальние шпили склоняются к арене с каждой фазой
    if (this.boss) this.view.leanSpires(ph / 2);
    sky.uMoonSize.value += (this.skyBase.size * (1 + 0.12 * ph) - sky.uMoonSize.value) * Math.min(1, realDt);
    _corona.copy(this.skyBase.corona).lerp(CORONA_RAGE, 0.3 * ph);
    this.coronaNow.lerp(_corona, Math.min(1, realDt));
    // пульс луны на сильную долю: корона вспыхивает поверх своей фазы
    sky.uCorona.value.copy(this.coronaNow).multiplyScalar(1 + this.beatPulse * BEAT.moon);
    sky.uStarLit.value = this.skyCine.starLit;
    sky.uStar2.value = this.skyCine.star2;
    sky.uSkyCrack.value = this.skyCine.crack;
    G.uHemiTop.value.copy(this.baseHemi).lerp(ECLIPSE_HEMI, this.eclipseK * 0.8);
    G.uMoonColor.value.copy(this.baseMoon).lerp(ECLIPSE_MOON, this.eclipseK * 0.7);
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
      defineClip: (who: string, id: string, def: ClipDef) => {
        const p = who === 'hero' ? w.hero.avatar.puppet : (enemyActor(who) as Enemy | null)?.puppet;
        if (p) p.clips.set(id, new Clip({ ...def, id }, p.layout));
      },
      playClip: (who: string, clip: string) => { if (who === 'hero') w.hero.avatar.puppet.play(clip, 1, 0.08); },
      clipEvents: (who: string, clip: string) => (who === 'hero' ? w.hero.avatar.puppet : (enemyActor(who) as Enemy | null)?.puppet)?.clips.get(clip)?.events ?? [],
      clipDuration: (who: string, clip: string) => (who === 'hero' ? w.hero.avatar.puppet : (enemyActor(who) as Enemy | null)?.puppet)?.clips.get(clip)?.dur ?? 0,
      sampleClip: (who: string, clip: string, time: number, reset: boolean, blend?: number) => {
        if (who === 'hero') w.hero.sampleSceneClip(clip, time, reset, blend);
        else { const p = (enemyActor(who) as Enemy | null)?.puppet, c = p?.clips.get(clip);
          if (p && c) { if (reset && !p.anim.sceneDriven) { p.anim.out.set(p.skel.rot); p.base.set(p.skel.rot); } p.anim.sampleScene(c, time, reset, blend); p.anim.compose(p.base); p.skel.rot.set(p.anim.out); p.skel.off[p.layout.idx('root') * 3 + 1] = p.anim.root.y; p.skel.update(); }
        }
      },
      releaseClip: (who: string) => { if (who === 'hero') w.hero.releaseSceneClip(); else { const p = (enemyActor(who) as Enemy | null)?.puppet; if (p) { p.anim.releaseScene(); p.skel.off[p.layout.idx('root') * 3 + 1] = 0; } } },
      shatter: (who: string, dx: number, dz: number, power: number) => {
        const e = enemyActor(who) as Enemy | null;
        if (e) w.killEnemy(e, dx, dz, power);
      },
      timeScale: (scale: number, dur: number) => ctx.time.cinematic(dur, scale),
      sky: (p: SkyParam, v: number) => { this.skyCine[p] = v; },
      skyValue: (p: SkyParam) => this.skyCine[p],
      moonBehind: (d: V3 | null) => {
        const u = ctx.renderer.sky.u.uMoonDir.value;
        if (d) { this.moonSaved ??= u.clone(); u.set(d[0], d[1], d[2]).normalize(); }
        else if (this.moonSaved) { u.copy(this.moonSaved); this.moonSaved = null; }
      },
      music: (cue: MusicCue) => this.feel.musicCue(cue),
      sfx: (id: string, gain: number) => ctx.audio.play(id, { gain }),
      say: (line: string, sp: 'kaelis' | 'boss') => this.feel.voice(line, 0, sp),
      banner: (text: string, sub: string | undefined, color: 'gold' | 'void' | 'hunger' | 'white' | 'ether' | 'steel', dur: number, size: number) => ctx.hud.bigBanner(text, sub, color, dur, size),
      flash: (v: number) => this.feel.whiteFlash(v),
      letterbox: (v: number) => this.feel.setLetterbox(v),
      call: (fn: string, arg?: number) => this.sceneCalls.get(fn)?.(arg),
      holding: () => ctx.input.attackHeld,
      // в сцене кнопки боя скрыты: действие — касание экрана где угодно, клик или атака
      tapped: () => ctx.input.consumeSceneTap(),
      autoContinue: () => ctx.settings.autoScenes || !!this.replay,
      seen: (id: string) => ctx.save.cine[id] ?? 0,
      markSeen: (id: string) => { ctx.save.cine[id] = (ctx.save.cine[id] ?? 0) + 1; ctx.persist(); },
      overlay: (skip: number, tap: { k: number; hit: boolean } | null, prompt?: { text: string; t: number } | null) =>
        ctx.hud.cineOverlay(skip, tap, prompt ? { ...prompt, sub: this.promptHint(), at: this.promptAnchor() } : null),
    };
  }

  /**
   * Kill-cam Стража (план §8.4): 3–4 с без летербокса, пропускается. Страж на колене и неуязвим; в конце
   * сцены (или при пропуске) его добивают.
   */
  private playKillcam(e: Enemy): void {
    const w = this.world, h = w.hero, ctx = this.ctx;
    const spots = { gx: e.x, gz: e.z, hx: h.x, hz: h.z };
    const dirX = e.x - h.x, dirZ = e.z - h.z;
    this.cine.clear(this.cam);
    let done = false;
    const crumble = () => {
      if (done) return;
      done = true;
      e.killcamDone = true;
      e.killcam = false;
      w.killEnemy(e, dirX, dirZ, 7);
      w.bus.emit('sfx', { id: 'shatter_big', x: e.x, z: e.z });
      w.bus.emit('shake', { trauma: 0.5 });
      ctx.hud.bigBanner('СТРАЖ ПОВЕРЖЕН', e.def.name, 'gold', 2.0, 50);
      const g = GUARDIAN[e.kind];
      if (g) setTimeout(() => this.feel.voice(g.down, 0), 700);
    };
    this.sceneCalls.set('crumble', crumble);
    if (e.kind === 'gateGuardian') {
      this.sceneCalls.set('knee', () => {
        w.bus.emit('sfx', { id: 'hit_heavy', x: e.x, z: e.z });
        w.bus.emit('sfx', { id: 'blade_scrape', x: e.x, z: e.z });
        w.bus.emit('shake', { trauma: 0.3 });
        this.vfx.hitSparks(e.x, 0.9, e.z, -dirX, -dirZ, 1, true);
      });
      this.sceneCalls.set('helmet', () => {
        w.bus.emit('sfx', { id: 'bell_crack', x: e.x, z: e.z });
        w.bus.emit('sfx', { id: 'hit_heavy', x: e.x, z: e.z });
        // свет из трещин шлема
        this.vfx.lights.flash(e.x, e.height, e.z, [1.6, 1.4, 1.0], 6, 7, 1.2);
        this.vfx.burst(24, { x: e.x, y: e.height * 0.95, z: e.z, life: 0.6, size: 0.12, size1: 0.02, color: C.core, drag: 2, frame: 'spark', stretch: 1.5 }, { v: 6, vy: 3 });
      });
      this.playScene(killGateTrack(spots), crumble, { letterbox: false, hud: false });
    } else {
      this.sceneCalls.set('bell', () => {
        w.bus.emit('sfx', { id: 'boss_bell', x: e.x, z: e.z });
        // фиолетовое кольцо проходит сквозь Звонаря
        w.bus.emit('shockwave', { x: e.x, z: e.z, r: 9, color: 'void', strength: 1.1 });
      });
      this.playScene(killBellTrack(spots), crumble, { letterbox: false, hud: false });
    }
  }

  /** Идёт сцена режиссёра или пролёт камеры (автокачество ждёт). */
  get inScene(): boolean { return this.director.active || !!this.cine.busy; }

  /** Логика сцен (шаг do: 'call'): регистрируют пролог, босс, kill-cam. */
  readonly sceneCalls = new Map<string, (arg?: number) => void>();

  /**
   * Пролог, планы 6–8 (план §8.2): Пилот падает в кратер, ударная волна гасит свечи, визор загорается,
   * обломок обшивки «Инея» вспыхивает Пустотой и становится клинком, из темноты выползает Шелуха.
   */
  private startLanding(): void {
    const w = this.world, h = w.hero, ctx = this.ctx;
    this.runner.introTime = 1e9;
    // обломок — к ближнему краю: Пилот идёт к нему лицом к камере, за ним — дальняя стена собора
    const spots: LandingSpots = { x: h.x, z: h.z, shardX: h.x + 0.9, shardZ: h.z + 1.6, huskX: h.x - 1.2, huskZ: h.z - 6.5 };
    const hp = { x: 0, z: 0 };
    this.arena.nearestWalkable(spots.huskX, spots.huskZ, hp);
    spots.huskX = hp.x; spots.huskZ = hp.z;
    const facing = Math.atan2(spots.shardX - h.x, spots.shardZ - h.z);
    const stand = extractionStand(spots.shardX, spots.shardZ, facing);
    const planted = extractionGripMatrix(stand[0], stand[2], facing, new THREE.Matrix4());
    const attachment = new ExtractionAttachment(planted);
    const shardMat = obsidianMaterial({ rim: '#b49cff', rimStrength: 0.85, rimPower: 3.3, emissive: '#a07cff', emissive2: '#ffd29a', emissiveStrength: 0.7 });
    const shard = new THREE.Mesh(buildHullShard(), shardMat);
    shard.matrixAutoUpdate = false;
    shard.matrix.copy(planted);
    // Рукоять видна над гнездом заранее. Ничего не вырастает из нуля.
    const socket = new THREE.Mesh(buildBladeSocket(), obsidianMaterial({ rim: '#9fb4d0', rimStrength: 0.3, emissiveStrength: 0 }));
    _top.set(0, -1.36, 0).applyMatrix4(planted);
    socket.position.set(_top.x, 0.04, _top.z);
    this.group.add(shard, socket);
    this.landingProps.push(shard, socket);
    this.landing = { t: 0, visorT: -1, igniteT: -1, releaseT: -1, shard, socket, attachment, music: false, call: -1 };
    const L = this.landing;
    const calls = this.sceneCalls;
    let thaw = () => {};
    calls.set('landStart', () => {
      h.y = LANDING_FROM; h.bladeTarget = 1; h.avatar.bladeScale = 1; h.avatar.bladeVisible = false; h.avatar.resetCloth();
      h.avatar.puppet.play('plunge', 1, 0);
      // стекло разбитой розы падает вместе с Пилотом
      for (let i = 0; i < 46; i++) {
        const c = LANDING_GLASS[i % LANDING_GLASS.length];
        this.vfx.add.emit({ x: h.x + fxRng.spread(3), y: LANDING_FROM + fxRng.range(-1, 5), z: h.z + fxRng.spread(3), vx: fxRng.spread(1), vy: -fxRng.range(12, 19), vz: fxRng.spread(1), gravity: -10, life: fxRng.range(1.0, 1.5), size: fxRng.range(0.1, 0.22), size1: 0.06, color: c, frame: 'shard', rot: fxRng.range(0, 6), spin: fxRng.spread(9) });
      }
    });
    calls.set('impact', () => {
      h.y = 0;
      w.bus.emit('shockwave', { x: h.x, z: h.z, r: 9, color: 'gold', strength: 1.2 });
      this.cam.addTrauma(0.85);
      // пыль кольцом по полу — на камеру
      this.vfx.burst(40, { x: h.x, y: 0.2, z: h.z, life: 1.8, size: 0.7, size1: 2.2, color: C.dust, alpha: 0.55, drag: 2.2, frame: 'smoke' }, { v: 10, vy: 0.4 }, false);
      this.vfx.rings.spawn(h.x, h.z, 0.4, 7, 0.9, C.gold, 0.35, 0.7);
      // стекло бьётся о пол
      for (let i = 0; i < 30; i++) {
        const a = fxRng.range(0, Math.PI * 2), v = fxRng.range(3, 8);
        this.vfx.add.emit({ x: h.x + Math.cos(a) * 0.6, y: 0.15, z: h.z + Math.sin(a) * 0.6, vx: Math.cos(a) * v, vy: fxRng.range(1.5, 4), vz: Math.sin(a) * v, gravity: -14, drag: 1.2, life: fxRng.range(0.5, 0.9), size: 0.12, size1: 0.04, color: LANDING_GLASS[i % LANDING_GLASS.length], frame: 'shard', spin: fxRng.spread(12) });
      }
      this.vfx.lights.flash(h.x, 0.6, h.z, C.voidHot, 5, 8, 0.8);
      this.scars.add(h.x, h.z, 2.2, 1);
      this.quench(h.x, h.z, 26);
      ctx.input.vibrate(80);
    });
    calls.set('visor', () => { if (L.visorT < 0) L.visorT = 0; });
    calls.set('idle', () => { h.avatar.puppet.anim.stop(0.3); });
    calls.set('grip', () => {
      if (L.attachment.phase !== 'planted') return;
      h.avatar.weaponMatrix(this.landingWeaponMatrix);
      L.attachment.grip(this.landingWeaponMatrix);
      this.syncLandingWeapon();
      ctx.audio.play('blade_scrape', { gain: 0.35 });
    });
    calls.set('releaseFromGround', () => {
      if (L.attachment.released) return;
      L.attachment.release(); L.releaseT = 0;
      const p = L.socket.position;
      this.vfx.debris.burst(p.x, 0.08, p.z, -Math.sin(facing), -Math.cos(facing), 8, 2.2, 0.09);
      this.vfx.burst(16, { x: p.x, y: 0.08, z: p.z, life: 0.6, size: 0.12, size1: 0.3, color: C.dust, alpha: 0.45, drag: 3, frame: 'smoke', gravity: -3 }, { v: 1.5, vy: 0.5 });
      ctx.audio.play('blade_scrape', { gain: 0.75 });
      this.cam.addTrauma(0.12);
    });
    calls.set('ignite', () => {
      if (L.igniteT >= 0) return;
      L.igniteT = 0;
      h.avatar.weaponMatrix(this.landingWeaponMatrix);
      L.attachment.awaken(this.landingWeaponMatrix);
      // Та же геометрия в том же трансформе сустава: просыпается только энергия.
      h.bladeTarget = 1; h.avatar.bladeScale = 1; h.avatar.bladeVisible = true;
      this.syncLandingWeapon();
      h.avatar.handPos(_top);
      ctx.audio.play('blade_ignite', { gain: 0.8 });
      this.feel.whiteFlash(IGNITE.flash);
      // обломок вспыхивает Пустотой: кольцо у руки и по полу, искры вверх по клинку
      // кольцо у руки — малое: большое на высоте руки проходит сквозь камеру сцены и заливает кадр
      this.vfx.rings.spawn(_top.x, _top.z, 0.2, 1.4, 0.45, C.voidHot, 0.18, 0.9, _top.y);
      this.vfx.rings.spawn(h.x, h.z, 0.5, 5.5, 0.8, C.void, 0.3, 0.6);
      this.vfx.burst(30, { x: _top.x, y: _top.y, z: _top.z, life: 0.7, size: 0.1, size1: 0.01, color: C.voidHot, drag: 2.5, frame: 'spark', stretch: 1.6 }, { v: 7, vy: 3 });
      this.vfx.burst(18, { x: _top.x, y: _top.y + 0.4, z: _top.z, life: 0.9, size: 0.14, size1: 0.01, color: C.core, drag: 1.5, frame: 'spark', stretch: 2.4 }, { v: 1.2, vy: 9 });
      this.vfx.lights.flash(_top.x, _top.y, _top.z, C.voidHot, IGNITE.light, 9, 0.9);
      this.cam.addTrauma(0.3);
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
      // глаза в темноте: багровый отсвет и скрежет — видно и слышно, откуда идёт угроза
      this.vfx.lights.flash(e.x, 0.6, e.z, C.hunger, 3, 7, 1.6);
      ctx.audio.play('tele_grind', { gain: 0.5 });
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
      h.bladeTarget = 1; h.avatar.bladeScale = 1; h.avatar.bladeVisible = true;
      shard.visible = false;
      this.runner.introTime = 0;
      this.runner.skipIntro();
    }, { hud: false });
  }

  /** Тренировочный зал: волн нет, Пилот неуязвим; манекены дугой перед ним (TRAINING_DUMMIES). */
  private startTraining(): void {
    const w = this.world, h = w.hero, D = TRAINING_DUMMIES, P = TRAINING_SPAR;
    this.runner.introTime = 1e9;
    // Пилот уязвим (иначе вне рывка удар Жнеца проходил бы молча), но урон — минимальный, здоровье тут же
    // возвращается (updateTraining): промах виден толчком, вспышкой и рангом
    w.damageTakenMul = 0;
    const fx = Math.sin(h.facing), fz = Math.cos(h.facing), sx = fz, sz = -fx;
    const o = { x: 0, z: 0 };
    this.training = D.kinds.map((kind, i) => {
      const k = i - (D.kinds.length - 1) / 2;
      this.arena.nearestWalkable(h.x + fx * D.dist + sx * k * D.spread, h.z + fz * D.dist + sz * k * D.spread, o);
      return { x: o.x, z: o.z, kind, e: null, t: 0.3 + i * 0.25 };
    });
    this.arena.nearestWalkable(h.x + fx * P.dist + sx * P.side, h.z + fz * P.dist + sz * P.side, o);
    this.training.push({ x: o.x, z: o.z, kind: P.kind, e: null, t: 1.2, spar: true });
    // упражнения (этап 4.5, A3): шаги — по началу приёмов и событиям боя, зачёт — по попаданию нужным приёмом
    const tracker = new DrillTracker();
    const card: TrainingCard = { index: 1, total: TRAINING_DRILLS.length, done: 0, name: '', step: '', stepIdx: 0, steps: 0, stepDone: [], performed: false, allDone: false, rules: 'Полный список — в паузе. Жнец бьёт без урона' };
    this.drills = { tracker, card };
    const now = () => this.ctx.time.world;
    w.bus.on('moveStart', (e) => tracker.move(e.id, now()));
    w.bus.on('perfectDodge', () => tracker.event('perfect', now()));
    w.bus.on('chargeReady', (e) => tracker.event(e.level >= 2 ? 'charge2' : 'charge1', now()));
    w.bus.on('stun', () => tracker.event('stun', now()));
    w.bus.on('strike', (e) => { if (e.source === 'blade') tracker.strike(e.moveId, e.n, h.chargedFull, now()); });
    w.bus.on('shatterStart', () => tracker.shatter());
    const hud = this.ctx.hud;
    tracker.onDone = (d, all) => {
      this.ctx.audio.play('ability_ready', { gain: 0.6 });
      if (all) hud.bigBanner('ЗАЛ ПРОЙДЕН', 'Все связки засчитаны', 'gold', 2.8, 42);
      else hud.bigBanner('ЗАСЧИТАНО', d.name, 'gold', 1.6, 30);
    };
    tracker.onPerformed = () => this.ctx.audio.play('ui_click', { gain: 0.5 });
  }

  /** Упражнения зала для списка в паузе: текст и состояние. */
  get trainingDrills(): { text: string; state: DrillState }[] | null {
    const D = this.drills;
    return D ? TRAINING_DRILLS.map((d) => ({ text: d.text, state: D.tracker.state.get(d.id) ?? 'todo' })) : null;
  }

  /** Карточка HUD — один объект на всё время зала, меняются поля. */
  private syncTrainingCard(): void {
    const D = this.drills!, T = D.tracker, c = D.card, d = T.active;
    T.tick(this.ctx.time.world);
    c.done = T.doneCount;
    c.allDone = !d;
    if (!d) return;
    c.index = TRAINING_DRILLS.indexOf(d) + 1;
    c.name = d.name;
    c.steps = d.steps.length;
    c.stepIdx = Math.min(T.step, d.steps.length - 1);
    c.step = d.steps[c.stepIdx].text;
    c.stepDone.length = d.steps.length;
    for (let i = 0; i < d.steps.length; i++) c.stepDone[i] = i < T.step;
    c.performed = T.state.get(d.id) === 'performed';
  }

  /** Разбитый манекен встаёт через respawn с; манекены стоят, Жнец бьёт без урона и не уходит от своего места. */
  private updateTraining(realDt: number): void {
    const w = this.world, h = w.hero, P = TRAINING_SPAR;
    h.hp = h.maxHp;
    this.syncTrainingCard();
    for (const slot of this.training!) {
      if (slot.e && !slot.e.dead) continue;
      if (slot.e) { slot.e = null; slot.t = slot.spar ? P.respawn : TRAINING_DUMMIES.respawn; }
      slot.t -= realDt;
      if (slot.t > 0) continue;
      const e = createEnemy(slot.kind, { zone: w.zone, stage: w.stage, mode: w.mode });
      e.x = slot.x; e.z = slot.z;
      e.facing = Math.atan2(h.x - e.x, h.z - e.z);
      // Жнец на поводке: дерётся, пока Пилот рядом с его постом; манекены стоят
      if (slot.spar) e.leash = { x: slot.x, z: slot.z, r: P.leash };
      else (e as unknown as { think: () => void }).think = () => {};
      w.addEnemy(e);
      slot.e = e;
    }
  }

  /**
   * Пересмотр (Кинозал): для kill-cam — Страж проявляется перед Пилотом и сразу получает добивающий удар;
   * интро Иерофанта играет само (полной версией). Волн нет, Пилот неуязвим, HUD скрыт.
   */
  private startReplay(): void {
    const R = this.replay!, w = this.world, h = w.hero;
    this.runner.introTime = REPLAY[R.id].guardian ? 1e9 : this.runner.introTime;
    h.invulnUntil = 1e9;
    this.ctx.hud.visible = false;
    const kind = REPLAY[R.id].guardian;
    if (!kind) return;
    const e = createEnemy(kind, { zone: w.zone, stage: w.stage, mode: w.mode });
    const o = { x: 0, z: 0 };
    this.arena.nearestWalkable(h.x, h.z - 5.5, o);
    e.x = o.x; e.z = o.z;
    e.facing = Math.atan2(h.x - e.x, h.z - e.z);
    h.facing = Math.atan2(e.x - h.x, e.z - h.z);
    w.addEnemy(e);
    R.target = e;
  }

  private updateReplay(realDt: number): void {
    const R = this.replay!, w = this.world;
    this.ctx.hud.visible = false;
    const e = R.target;
    if ((R.id === 'hierophantCollapse' || R.id === 'hierophantCrack') && !R.setup && this.boss instanceof HierophantController) {
      R.setup = true;
      this.director.skip();
      this.boss.replayTransition(R.id === 'hierophantCollapse' ? 2 : 3);
      R.seen = true;
      return;
    }
    // Страж проявился — добивающий удар по оглушённому: дальше kill-cam как в бою
    if (e && !R.seen && !this.director.active && e.state !== 'spawn' && !e.killcam) {
      e.hp = Math.min(e.hp, 5);
      (e as unknown as { cur: unknown }).cur = null;
      w.stunEnemy(e);
      w.damageEnemy(e, { mult: 50, stun: 0, knockback: 2, feel: 'heavy', dirX: 0, dirZ: -1, source: 'blade' });
    }
    // «Последний звон»: как только босс на месте — пропустить интро, фаза III, оглушить и казнить
    if (R.id === 'hierophantEnd' && !R.setup && this.boss instanceof HierophantController) {
      R.setup = true;
      this.director.skip();
      const c = this.boss as unknown as { collapse(i: boolean): void; crack(): void; enterPhase(p: number): void; execute(): void; boss: Enemy };
      c.collapse(true); c.crack(); c.enterPhase(2); c.enterPhase(3);
      void c.execute;
      this.skyCine.crack = 1;
      const bb = c.boss, h = w.hero;
      const o = { x: 0, z: 0 };
      this.arena.nearestWalkable(bb.x, bb.z + 6, o);
      h.x = o.x; h.z = o.z; h.facing = Math.atan2(bb.x - h.x, bb.z - h.z);
      bb.hp = bb.maxHp * EXEC_HP * 0.5;
      w.stunEnemy(bb);
      // казнь — через пару кадров: скелет босса ещё стоит в начале спуска интро, точки цепи считались бы от 16 м
      R.t = -REPLAY_TAIL.execDelay;
      return;
    }
    if (R.id === 'hierophantEnd' && R.setup && !R.seen && R.t < 0) {
      R.t += realDt;
      if (R.t >= 0) (this.boss as unknown as { execute(): void }).execute();
      return;
    }
    if (this.director.active) { R.seen = true; return; }
    if (!R.seen || R.done) return;
    R.t += realDt;
    if (R.t >= (e ? REPLAY_TAIL.kill : REPLAY_TAIL.intro)) { R.done = true; this.onReplayEnd?.(); }
  }

  private updateLanding(realDt: number): void {
    const L = this.landing!, h = this.world.hero;
    L.t += realDt;
    this.syncLandingWeapon();
    if (L.releaseT >= 0) { L.releaseT += realDt; L.socket.scale.y = Math.max(0.2, 1 - L.releaseT * 2.5); }
    // падение: фиолетовый след за Пилотом
    if (h.y > 0.3) for (let i = 0; i < 2; i++) this.vfx.add.emit({ x: h.x + fxRng.spread(0.25), y: h.y + 0.9 + fxRng.spread(0.4), z: h.z + fxRng.spread(0.25), vy: 6, life: 0.3, size: 0.12, size1: 0.02, color: C.voidHot, drag: 1, frame: 'spark', stretch: 2.4 });
    // обломок зовёт: пульс Пустоты, чаще и ярче, пока Пилот подходит
    if (L.igniteT < 0 && L.visorT >= 0) {
      const u = L.shard.material as THREE.ShaderMaterial;
      const near = clamp(1 - Math.hypot(h.x - L.shard.matrix.elements[12], h.z - L.shard.matrix.elements[14]) / 3, 0, 1);
      u.uniforms.uEmissiveStrength.value = 0.45 + (0.2 + near * 0.35) * Math.pow(0.5 + 0.5 * Math.sin(L.t * 3), 2);
      if (Math.floor(L.t / 0.9) !== L.call) {
        L.call = Math.floor(L.t / 0.9);
        this.vfx.lights.flash(L.shard.matrix.elements[12], 0.8, L.shard.matrix.elements[14], C.void, 0.7 + near * 0.3, 2.5, 0.6);
      }
    }
    // визор загорается, на клинке — вспышка Пустоты, дальше — как обычно
    if (L.visorT >= 0) { L.visorT += realDt; h.glowBoost = Math.min(IGNITE.visor, L.visorT * 2.4) * (L.igniteT >= 0 ? Math.max(0, 1 - L.igniteT / 2.5) : 1); }
    if (L.igniteT >= 0) { L.igniteT += realDt; h.glowBoost += Math.max(0, IGNITE.glow - L.igniteT * IGNITE.fall); }
    if (!this.director.active && L.igniteT > 3) { h.glowBoost = 0; this.landing = null; this.disposeLandingProps(); }
  }

  /** Как выполнить действие сцены на текущем устройстве. */
  private promptHint(): string {
    const d = this.ctx.input.lastDevice;
    return d === 'touch' ? 'коснитесь экрана' : d === 'pad' ? 'атака' : 'ЛКМ / J';
  }

  /** Место действия сцены на экране (NDC): рукоять посаженного клинка в прологе; иначе — по центру. */
  private promptAnchor(): { x: number; y: number } | null {
    const L = this.landing;
    if (!L || L.attachment.phase !== 'planted') return null;
    const cam = this.ctx.renderer.camera;
    cam.updateMatrixWorld();
    _top.setFromMatrixPosition(L.attachment.matrix).project(cam);
    return _top.z < 1 ? { x: _top.x, y: _top.y } : null;
  }

  /** Вызывается после того, как Director посчитал позу этого кадра. */
  private syncLandingWeapon(): void {
    const L = this.landing;
    if (!L) return;
    this.world.hero.avatar.weaponMatrix(this.landingWeaponMatrix);
    L.attachment.follow(this.landingWeaponMatrix);
    L.shard.matrix.copy(L.attachment.matrix);
    L.shard.matrixWorldNeedsUpdate = true;
    L.shard.visible = L.attachment.propVisible;
  }

  private disposeLandingProps(): void {
    for (const mesh of this.landingProps) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    }
    this.landingProps.length = 0;
  }

  /**
   * Контур Пилота сквозь препятствия (разбор): камера → грудь Пилота пересекает колонну-укрытие или крупного
   * врага (Страж, босс, Голем) — Пилот виден фиолетовым силуэтом. Заодно — точка для приглушения дыма у героя.
   */
  private updateXray(realDt: number): void {
    const h = this.world.hero, cam = this.ctx.renderer.camera.position;
    const cy = h.avatar.visual.y + 1.25;
    G.uHero.value.set(h.x, cy, h.z);
    let hidden = false;
    for (const c of this.arena.covers) {
      if (segmentBlocked(cam.x, cam.y, cam.z, h.x, cy, h.z, { x: c.x, z: c.z, r: c.r * 0.85, h: XRAY.coverH })) { hidden = true; break; }
    }
    if (!hidden) for (const e of this.world.enemies) {
      if (e.dead || e.height < 2.6) continue;
      if (segmentBlocked(cam.x, cam.y, cam.z, h.x, cy, h.z, { x: e.x, z: e.z, r: e.radius, h: e.y + e.height })) { hidden = true; break; }
    }
    const a = h.avatar, target = hidden && !h.dead ? XRAY.strength : 0;
    a.xray += (target - a.xray) * Math.min(1, realDt * (target > a.xray ? XRAY.rise : XRAY.fall));
  }

  /** Контактные тени: герой и живые враги (растворяющиеся бледнеют), над провалом — нет. */
  private updateContact(): void {
    const c = this.contact, w = this.world, h = w.hero, a = this.arena;
    c.begin();
    // по видимой высоте: в прыжке клипа тень уменьшается и бледнеет
    if (!h.dead && a.walkable(h.x, h.z)) c.add(h.x, h.z, 0.62, h.avatar.visual.y);
    for (const e of w.enemies) {
      const dis = e.puppet.dissolve;
      if (dis >= 0.98 || !a.walkable(e.x, e.z)) continue;
      c.add(e.x, e.z, e.radius * 1.25, e.y, 1 - dis);
    }
    c.end();
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
    // четыре уровня (план §8.7, п. 2): 1 — между волнами только A; 2 — волна, +B (и C, D по накалу);
    // 3 — оглушение босса — стингер поверх (feel); 4 — последняя волна / фаза III — все слои
    let x = MUSIC_LEVEL.fight;
    if (alive >= 4 || elite) x = 0.6;
    if (w.rank.rankIdx >= 3 || this.runner.guardian || this.boss) x = 0.9;
    if (this.runner.phase === 'breather' || this.runner.phase === 'intro') x = MUSIC_LEVEL.explore;
    if (this.boss) this.ctx.music.final = this.boss.phase >= 3;
    // ранг SS — медный акцент на каждую долю
    this.ctx.music.accent = w.rank.rankIdx >= 5;
    if (this.ctx.music.final || w.hero.eclipse) x = MUSIC_LEVEL.final;
    if (Math.abs(x - this.ctx.music.intensity) > 0.01) this.ctx.music.setIntensity(x);
  }

  hudFrame(): Parameters<GameContext['hud']['draw']>[1] {
    const r = this.ctx.renderer;
    return {
      world: this.world, abilities: this.abilities, input: this.ctx.input,
      project: (x, y, z, out) => r.project(x, y, z, out),
      wave: this.runner.phase === 'intro' || this.stage.boss || this.stage.training ? null : { index: Math.max(0, this.runner.waveIdx), total: this.runner.waveTotal },
      boss: this.boss?.hudBoss() ?? null, bossName: this.boss?.name ?? '', bossPhases: this.boss?.phaseMarks ?? [], bossPhase: this.boss?.phase ?? 0,
      guardian: this.runner.guardian,
      stageLabel: this.stage.boss ? 'БОСС' : this.stage.training ? 'ЗАЛ' : `${this.stage.zone + 1}-${this.stage.index + 1}`,
      stageName: this.stage.name,
      showTouch: this.ctx.input.touchUi,
      execute: !!this.boss?.executable && !this.director.active,
      fps: this.fps,
      showFps: this.ctx.settings.showFps,
      debugNav: DEBUG_NAV,
      training: this.drills?.card,
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
    this.disposed = true;
    this.disposeLandingProps();
    this.ambience?.stop();
    this.ctx.audio.onSpeak = null;
    this.kaelis.dispose();
    this.cine.clear(this.cam);
    this.director.clear(this.cam);
    this.feel.dispose();
    this.world.hero.avatar.dispose();
    this.world.bus.clear();
    this.ctx.renderer.scene.remove(this.group);
    this.events.dispose();
    this.view.dispose();
    this.flames.dispose();
    this.scars.dispose();
    this.contact.dispose();
    G.uHero.value.set(0, -1000, 0);
    this.ash.dispose();
    this.beamDust?.dispose();
    this.enemies.dispose();
    this.vfx.clear();
    this.ctx.music.onBeat = null;
    this.ctx.renderer.post.state.letterbox = 0;
    this.ctx.renderer.post.state.desat = 0;
    this.ctx.renderer.post.state.lowHp = 0;
    this.ctx.renderer.post.state.pinch.w = 0;
    this.ctx.renderer.sky.u.uEclipse.value = 0;
    this.ctx.renderer.sky.u.uSkyCrack.value = 0;
    this.ctx.renderer.sky.u.uStarLit.value = 0;
    this.ctx.renderer.sky.u.uStar2.value = 0;
    this.ctx.renderer.sky.u.uMoonSize.value = this.skyBase.size;
    this.ctx.renderer.sky.u.uCorona.value.copy(this.skyBase.corona);
    this.ctx.audio.musicTranspose = 0;
    this.ctx.music.final = false;
    this.ctx.music.accent = false;
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
