import * as THREE from 'three';
import { clamp } from '../../core/math';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { nearestRay, starRay, type StarBridge } from '../../data/arenas';
import { ENEMIES } from '../../data/enemies';
import { ARMS, hierophantRig } from '../../gen/chars/hierophant';
import { Obelisk } from '../enemies/obelisk';
import { registerEnemy } from '../enemies/factory';
import type { SpawnOpts } from '../enemy';
import { resetStunHabit } from '../actor';
import type { World } from '../world';
import type { CameraRig } from '../camera';
import type { BossController } from './bossBase';
import { ScriptedEnemy, type PoseLib } from './scripted';
import type { Pattern, Step } from './timeline';
import type { CineTrack, MusicCue, V3 } from '../../game/director';
import { COLLAPSE_BLEND, COLLAPSE_T, collapseTrack, crackTrack, DESCEND_FROM, executionTrack, hierophantIntroTrack } from './hierophantScenes';
import type { StrikeParams } from '../world';

/** Фазы (план §8.3): I «Литургия» 100–60 %, II «Набат» 60–25 %, III «Последний звон» 25–0 %. */
export const PHASE2_AT = 0.6;
export const PHASE3_AT = 0.25;
/** Окно перехвата фазы (с, план §8.3.1): ядро светится бело-фиолетово. */
export const INTERCEPT_WINDOW = 1.2;
/** Жест на удар перехода: сила отшатывания (пружина) и яркость вспышки маски (× FACE_LIGHT). */
export const GRIEF = { recoil: 1.4, light: 1.4 };
/** После возврата камеры в бой — столько секунд чистого обзора до первого телеграфа новой фазы. */
export const RETURN_CALM = 0.6;
/** Огонь колокола открыт в фазе III: урон ×1.5. */
export const PHASE3_DMG = 1.5;
/** Добивание (план §8.3.2): фаза III, HP не выше этой доли и оглушён — кнопка атаки горит «ДОБИТЬ». */
export const EXEC_HP = 0.06;
/** Фаза III: облёт арены на цепях (радиус м, рад/с, высота м). */
export const ORBIT = { r: 8.5, w: 0.3, speed: 4.5, y: 1.4 };
/** Колокола-спутники: три на кольце r, вращаются навстречу боссу; звонят по очереди со сдвигом period/3. */
export const SATS = { n: 3, r: 5.5, w: -0.22, period: 5.4, tele: 0.9, ring: { speed: 5.5, width: 0.8, maxR: 13, gaps: 2, gapW: 1.3, dmg: 0.12 } };
/** Приговор на звёздном мосту: ширина луча-удара (м) и пауза между группами 3 + 4 луча (с). */
export const JUDGMENT = { width: 2.4, gap: 1.0 };

/**
 * Группы лучей Приговора (план): первая — три луча через один, начиная с луча, где Пилот (dx, dz — от босса);
 * соседние с ним лучи — во второй группе, туда и уходить. Вторая — остальные четыре.
 */
export function judgmentGroups(st: StarBridge, dx: number, dz: number): [number[], number[]] {
  const h = nearestRay(st, dx, dz);
  const a = [0, 2, 4].map((d) => (h + d) % st.rays);
  const b = Array.from({ length: st.rays }, (_, k) => k).filter((k) => !a.includes(k));
  return [a, b];
}

/** Щит Проповеди при двух обелисках (доля срезанного урона). */
export const SERMON_SHIELD = 0.7;

const _bell = new THREE.Vector3();

const POSES: PoseLib = {
  idle: { shUL: [-0.5, 0, 0.5], shUR: [-0.5, 0, -0.5], shLL: [-0.2, 0, 0.35], shLR: [-0.2, 0, -0.35], elbUL: [-0.5, 0, 0], elbUR: [-0.5, 0, 0], elbLL: [-0.4, 0, 0], elbLR: [-0.4, 0, 0] },
  toll: { chest: [-0.25, 0, 0], shUL: [-2.2, 0, 0.6], shUR: [-2.2, 0, -0.6], elbUL: [-0.6, 0, 0], elbUR: [-0.6, 0, 0], shLL: [-0.6, 0, 0.9], shLR: [-0.6, 0, -0.9] },
  censers: { shUL: [-1.5, 0, 1.3], shUR: [-1.5, 0, -1.3], shLL: [-1.4, 0, 1.2], shLR: [-1.4, 0, -1.2], elbUL: [-0.1, 0, 0], elbUR: [-0.1, 0, 0], elbLL: [-0.1, 0, 0], elbLR: [-0.1, 0, 0] },
  sermon: { chest: [-0.35, 0, 0], shUL: [-2.6, 0, 0.9], shUR: [-2.6, 0, -0.9], shLL: [-1.6, 0, 1.3], shLR: [-1.6, 0, -1.3], elbUL: [-0.3, 0, 0], elbUR: [-0.3, 0, 0] },
  rise: { chest: [-0.3, 0, 0], shUL: [-2.8, 0, 0.3], shUR: [-2.8, 0, -0.3], shLL: [-2.4, 0, 0.6], shLR: [-2.4, 0, -0.6] },
  slam: { chest: [0.55, 0, 0], shUL: [-0.4, 0, 1.3], shUR: [-0.4, 0, -1.3], shLL: [-0.2, 0, 1.2], shLR: [-0.2, 0, -1.2] },
  phase: { chest: [-0.5, 0, 0], shUL: [-3.0, 0, 0.5], shUR: [-3.0, 0, -0.5], shLL: [-2.8, 0, 0.9], shLR: [-2.8, 0, -0.9], elbUL: [-0.2, 0, 0], elbUR: [-0.2, 0, 0] },
  // интро (ревью): верхние руки раскрыты у лица в благословении, нижние сложены у груди
  bless: { chest: [-0.12, 0, 0], shUL: [-2.25, 0, 0.75], shUR: [-2.25, 0, -0.75], elbUL: [-0.95, 0, 0], elbUR: [-0.95, 0, 0], shLL: [-1.25, 0, 0.45], shLR: [-1.25, 0, -0.45], elbLL: [-0.7, 0, 0], elbLR: [-0.7, 0, 0] },
  // удар, переводящий бой в новую фазу (этап 4.5, C2): верхние руки хватаются за маску, нижние раскинуты вниз,
  // корпус откинут — «скорбь»; держится всё окно перехвата и первый крупный план сцены
  grief: { chest: [-0.45, 0, 0.1], shUL: [-2.45, 0, 0.42], shUR: [-2.45, 0, -0.42], elbUL: [-1.45, 0, 0], elbUR: [-1.45, 0, 0], shLL: [0.25, 0, 1.15], shLR: [0.25, 0, -1.15], elbLL: [-0.1, 0, 0], elbLR: [-0.1, 0, 0] },
  broken: { chest: [1.1, 0, 0.15], shUL: [0.3, 0, 1.2], shUR: [0.3, 0, -1.2], shLL: [0.6, 0, 1.0], shLR: [0.6, 0, -1.0], elbUL: [-0.2, 0, 0], elbUR: [-0.2, 0, 0] },
};

/**
 * Иерофант Скорби (GDD §11.1): 9 000 HP, оглушение 120 / 3.5 с, фазы 100–55 % / 55–0 %.
 * Учит уклонению сквозь волны, приоритету целей, игре от окон уязвимости.
 */
export class Hierophant extends ScriptedEnemy {
  /** Звон на сильную долю музыки (только вид, ставит бой; план §8.7, п. 9). */
  beatGlow = 0;
  ctrl: HierophantController | null = null;
  private swing = 0;
  private bob = 0;
  dying = false;
  transitioning = 0;
  /** Фаза III: колокол треснул, огонь внутри открыт. */
  bellCracked = false;
  /** Угол облёта (фаза III). */
  orbitA = 0;
  /** Колокола-спутники: угол на кольце, таймер звона, точка метки. */
  readonly sats = Array.from({ length: SATS.n }, (_, i) => ({ a: (i / SATS.n) * Math.PI * 2, t: -i * SATS.period / SATS.n, tele: false, tx: 0, tz: 0 }));
  homeX = 0; homeZ = -2;
  /** Скорость «качания» колокола (звон). */
  private sway = 0;

  patterns: Pattern[] = [
    // Звон: колокол раскачивается 0.9 с → 3 расходящихся кольца с разрывами
    { id: 'toll', weight: 3, cooldown: 4, phases: [1, 2, 3], steps: [
      { t: 0, do: 'pose', id: 'toll', blend: 0.35 },
      { t: 0, do: 'telegraphSound', kind: 'bell' },
      { t: 0, do: 'telegraph', shape: { circle: 3.2 }, at: 'self', dur: 0.9 },
      { t: 0, do: 'call', fn: 'sway', arg: 0.9 },
      { t: 0.9, do: 'hitbox', shape: { circle: 3.2 }, at: 'self', dmg: 0.16, kb: 6 },
      { t: 0.9, do: 'ringwave', at: 'self', speed: 6, width: 0.9, maxR: 20, gaps: 2, gapW: 1.25, dmg: 0.18 },
      { t: 0.9, do: 'sfx', id: 'boss_bell' }, { t: 0.9, do: 'shake', trauma: 0.35 },
      { t: 1.45, do: 'ringwave', at: 'self', speed: 6.3, width: 0.9, maxR: 20, gaps: 2, gapW: 1.2, dmg: 0.18 },
      { t: 1.45, do: 'sfx', id: 'tele_bell' },
      { t: 2.0, do: 'ringwave', at: 'self', speed: 6.6, width: 0.9, maxR: 20, gaps: 2, gapW: 1.15, dmg: 0.18 },
      { t: 2.0, do: 'sfx', id: 'tele_bell' },
      { t: 2.1, do: 'pose', id: 'idle', blend: 0.4 },
      { t: 2.2, do: 'vulnerable', dur: 1.0 },
    ] },
    // Кадильный взмах (план §8.3): вблизи — широкая дуга 200° кадилами, телеграф 0.8 с
    { id: 'swing', weight: 3, cooldown: 3, phases: [1, 2], range: [0, 5.5], steps: [
      { t: 0, do: 'pose', id: 'censers', blend: 0.3 },
      { t: 0, do: 'telegraphSound', kind: 'whistle' },
      { t: 0, do: 'telegraph', shape: { arc: [5.8, 200] }, at: 'self', dur: 0.8 },
      { t: 0.8, do: 'pose', id: 'slam', blend: 0.06 },
      { t: 0.8, do: 'hitbox', shape: { arc: [5.8, 200] }, at: 'self', dmg: 0.18, kb: 7 },
      { t: 0.8, do: 'sfx', id: 'swing_heavy' }, { t: 0.8, do: 'shake', trauma: 0.25 },
      { t: 1.05, do: 'pose', id: 'idle', blend: 0.35 },
      { t: 1.1, do: 'vulnerable', dur: 1.1 },
    ] },
    // Кадила: 4 кадила бьют по кругу последовательно, оставляют дым на 3 с
    { id: 'censers', weight: 3, cooldown: 4, phases: [1], range: [0, 9], steps: [], build: () => this.censerSteps() },
    // Проповедь (план §8.3): два обелиска по бокам питают щит −70 % урона; разбить один — щит вдвое слабее
    { id: 'sermon', weight: 2, cooldown: 24, phases: [1], steps: [], build: () => this.sermonSteps(), dur: 2.2 },
    // Кадило (план §8.3): бросок по линии; полный заряженный удар по летящему кадилу шлёт его в колокол (+40 оглушения)
    { id: 'hurl', weight: 3, cooldown: 5, phases: [1], range: [4, 14], steps: [
      { t: 0, do: 'pose', id: 'censers', blend: 0.3 },
      { t: 0, do: 'telegraphSound', kind: 'whistle' },
      { t: 0, do: 'telegraph', shape: { line: [13, 1.5] }, at: 'self', dur: 0.85 },
      { t: 0.85, do: 'pose', id: 'slam', blend: 0.06 },
      { t: 0.85, do: 'call', fn: 'hurl' },
      { t: 0.85, do: 'sfx', id: 'swing_heavy' },
      { t: 1.1, do: 'pose', id: 'idle', blend: 0.4 },
      { t: 1.2, do: 'vulnerable', dur: 1.3 },
    ] },
    // Падение Понтифика: тень на земле 1.0 с → рушится всем телом в точку игрока; окно 2.0 с
    { id: 'drop', weight: 2, cooldown: 7, phases: [1, 2, 3], range: [3, 40], unstoppable: true, steps: [
      { t: 0, do: 'pose', id: 'rise', blend: 0.25 },
      { t: 0, do: 'telegraph', shape: { circle: 4 }, at: 'snapshot', dur: 1.05 },
      { t: 0, do: 'telegraphSound', kind: 'roar' },
      { t: 0.2, do: 'move', to: 'snapshot', dur: 0.85, arc: 7, ease: 'inOutQuad' },
      { t: 0.95, do: 'pose', id: 'slam', blend: 0.05 },
      { t: 1.05, do: 'hitbox', shape: { circle: 4 }, at: 'self', dmg: 0.3, kb: 9 },
      { t: 1.05, do: 'fx', id: 'impact', at: 'self', r: 4 },
      { t: 1.05, do: 'sfx', id: 'boss_bell' }, { t: 1.05, do: 'shake', trauma: 0.7 },
      { t: 1.08, do: 'ringwave', at: 'self', speed: 8, width: 0.7, maxR: 9, gaps: 3, gapW: 1.3, dmg: 0.1 },
      { t: 1.1, do: 'vulnerable', dur: 2.0 },
      { t: 3.0, do: 'pose', id: 'idle', blend: 0.5 },
    ] },
    // Великий Набат: 3 звона подряд с ускорением, последний — с одним разрывом
    { id: 'tocsin', weight: 3, cooldown: 6, phases: [2, 3], unstoppable: true, steps: [
      { t: 0, do: 'pose', id: 'toll', blend: 0.3 },
      { t: 0, do: 'telegraphSound', kind: 'bell' },
      { t: 0, do: 'telegraph', shape: { circle: 3.2 }, at: 'self', dur: 0.85 },
      { t: 0, do: 'call', fn: 'sway', arg: 0.85 },
      { t: 0.85, do: 'hitbox', shape: { circle: 3.2 }, at: 'self', dmg: 0.16, kb: 6 },
      { t: 0.85, do: 'ringwave', at: 'self', speed: 6, width: 0.9, maxR: 20, gaps: 2, gapW: 1.2, dmg: 0.18 },
      { t: 0.85, do: 'sfx', id: 'boss_bell' }, { t: 0.85, do: 'shake', trauma: 0.3 },
      { t: 1.35, do: 'ringwave', at: 'self', speed: 7.5, width: 0.9, maxR: 20, gaps: 2, gapW: 1.15, dmg: 0.18 },
      { t: 1.35, do: 'sfx', id: 'boss_bell' },
      { t: 1.75, do: 'ringwave', at: 'self', speed: 9, width: 1.0, maxR: 20, gaps: 1, gapW: 1.4, dmg: 0.22 },
      { t: 1.75, do: 'sfx', id: 'boss_bell' }, { t: 1.75, do: 'shake', trauma: 0.4 },
      { t: 1.9, do: 'pose', id: 'idle', blend: 0.4 },
      { t: 2.1, do: 'vulnerable', dur: 1.2 },
    ] },
    // Цепи кадил: кадила летят по мостам как боулинг, разрушают плиты (возрождаются через 6 с)
    { id: 'chains', weight: 3, cooldown: 6, phases: [2], steps: [], build: () => this.chainSteps() },
    // Литания: три веера игл из-под рясы, каждый доворачивает на героя
    { id: 'litany', weight: 2, cooldown: 6, phases: [1], range: [4, 40], steps: [
      { t: 0, do: 'pose', id: 'sermon', blend: 0.35 },
      { t: 0, do: 'telegraphSound', kind: 'chime' },
      { t: 0, do: 'telegraph', shape: { arc: [9, 80] }, at: 'self', dur: 0.8 },
      { t: 0.8, do: 'projectiles', pattern: 'fan', count: 7, speed: 9, kind: 'needle', dmg: 0.1, spread: 1.3 },
      { t: 0.8, do: 'sfx', id: 'slash_enemy' },
      { t: 0.85, do: 'pose', id: 'toll', blend: 0.08 },
      { t: 1.2, do: 'projectiles', pattern: 'fan', count: 6, speed: 9.5, kind: 'needle', dmg: 0.1, spread: 1.1 },
      { t: 1.2, do: 'sfx', id: 'slash_enemy' },
      { t: 1.25, do: 'pose', id: 'sermon', blend: 0.08 },
      { t: 1.6, do: 'projectiles', pattern: 'fan', count: 7, speed: 10, kind: 'needle', dmg: 0.1, spread: 1.4 },
      { t: 1.6, do: 'sfx', id: 'slash_enemy' },
      { t: 1.8, do: 'pose', id: 'idle', blend: 0.4 },
      { t: 1.9, do: 'vulnerable', dur: 1.1 },
    ] },
    // Приговор: косой крест лучей, затем прямой — по мостам
    { id: 'judgment', weight: 3, cooldown: 7, phases: [2, 3], unstoppable: true, steps: [], build: () => this.judgmentSteps() },
    // Жатва: из бездны лезет Шелуха
    { id: 'harvest', weight: 1, cooldown: 16, phases: [2], steps: [
      { t: 0, do: 'pose', id: 'rise', blend: 0.4 },
      { t: 0, do: 'telegraphSound', kind: 'roar' },
      { t: 0.8, do: 'summon', enemy: 'husk', count: 6, at: 'edges' },
      { t: 0.8, do: 'sfx', id: 'boss_roar' },
      { t: 1.3, do: 'pose', id: 'idle', blend: 0.4 },
    ], dur: 2.0 },
  ];

  constructor(o: SpawnOpts) {
    super(ENEMIES.hierophant, layoutOf(hierophantRig()), o);
    this.isBoss = true;
    this.isGuardian = false;
    // фаза I (план §8.3): дальше 7 м — скользит к герою; фаза II — висит над средокрестием
    this.approach = 7;
    this.awakenPoses = ['rise', 'slam'];
    this.restRange = [0.9, 1.6];
    this.idleT = 999; // ждёт конца интро
  }

  protected poses(): PoseLib { return POSES; }

  override get invulnerable(): boolean { return this.transitioning > 0 || this.dying || this.state === 'spawn' || this.idleT > 100; }
  /** На краю смерти в фазе III Раскол уступает казни. */
  override get canShatter(): boolean { return !this.dying && this.transitioning <= 0 && !(this.phase >= 3 && this.hp <= this.maxHp * EXEC_HP); }

  private censerSteps(): Step[] {
    const h = this.w_.hero;
    const base = Math.atan2(h.x - this.x, h.z - this.z);
    const out: Step[] = [
      { t: 0, do: 'pose', id: 'censers', blend: 0.3 },
      { t: 0, do: 'telegraphSound', kind: 'whistle' },
    ];
    for (let i = 0; i < 4; i++) {
      const a = base + (i * Math.PI) / 2;
      const p = { x: this.x + Math.sin(a) * 4.4, z: this.z + Math.cos(a) * 4.4 };
      const t0 = i * 0.24;
      out.push({ t: t0, do: 'telegraph', shape: { circle: 2.1 }, at: p, dur: 0.82 });
      out.push({ t: t0 + 0.82, do: 'hitbox', shape: { circle: 2.1 }, at: p, dmg: 0.17, kb: 5 });
      out.push({ t: t0 + 0.82, do: 'fx', id: 'dust', at: p, r: 2 });
      out.push({ t: t0 + 0.82, do: 'sfx', id: 'slam' });
      out.push({ t: t0 + 0.84, do: 'call', fn: `smoke:${p.x.toFixed(2)}:${p.z.toFixed(2)}` });
    }
    out.push({ t: 1.6, do: 'pose', id: 'idle', blend: 0.4 });
    out.push({ t: 1.7, do: 'vulnerable', dur: 1.5 });
    return out;
  }

  /** Обелиски встают по бокам от босса — поперёк линии на героя. */
  private sermonSteps(): Step[] {
    const h = this.w_.hero;
    const a = Math.atan2(h.x - this.x, h.z - this.z);
    const side = (k: number) => ({ x: this.x + Math.cos(a) * 5.5 * k, z: this.z - Math.sin(a) * 5.5 * k });
    return [
      { t: 0, do: 'pose', id: 'sermon', blend: 0.5 },
      { t: 0, do: 'telegraphSound', kind: 'chime' },
      { t: 0, do: 'telegraph', shape: { circle: 2.6 }, at: 'self', dur: 1.2, white: true },
      { t: 1.2, do: 'summon', enemy: 'obelisk', count: 2, at: [side(1), side(-1)] },
      { t: 1.2, do: 'sfx', id: 'boss_roar' },
      { t: 1.2, do: 'call', fn: 'sermonLine' },
      { t: 1.6, do: 'pose', id: 'idle', blend: 0.4 },
    ];
  }

  /**
   * Приговор: лучи-удары от босса по мостам. На звёздном мосту (план) — двумя группами: сперва три луча через
   * один, начиная с луча Пилота (соседние с ним — безопасны), затем остальные четыре; без звезды — косой и прямой
   * кресты, как раньше.
   */
  private judgmentSteps(): Step[] {
    const out: Step[] = [
      { t: 0, do: 'pose', id: 'phase', blend: 0.35 },
      { t: 0, do: 'telegraphSound', kind: 'bell' },
      { t: 0, do: 'call', fn: 'sway', arg: 1.7 },
    ];
    const strike = (angles: number[], t0: number) => {
      for (const a of angles) {
        const to = { x: this.x + Math.sin(a) * 20, z: this.z + Math.cos(a) * 20 };
        out.push({ t: t0, do: 'telegraph', shape: { line: [18, JUDGMENT.width] }, at: 'self', dir: to, dur: 1.0 });
        out.push({ t: t0 + 1.0, do: 'hitbox', shape: { line: [18, JUDGMENT.width] }, at: 'self', dir: to, dmg: 0.2, kb: 5 });
      }
      out.push({ t: t0 + 1.0, do: 'pose', id: 'slam', blend: 0.05 });
      out.push({ t: t0 + 1.0, do: 'fx', id: 'shockwave', at: 'self', r: 9 });
      out.push({ t: t0 + 1.0, do: 'sfx', id: 'boss_bell' });
      out.push({ t: t0 + 1.02, do: 'shake', trauma: 0.4 });
      out.push({ t: t0 + 1.12, do: 'pose', id: 'phase', blend: 0.15 });
    };
    const st = this.w_.arena.def.star;
    if (st) {
      const [a, b] = judgmentGroups(st, this.w_.hero.x - this.x, this.w_.hero.z - this.z);
      strike(a.map((k) => starRay(st, k)), 0);
      strike(b.map((k) => starRay(st, k)), JUDGMENT.gap);
      out.push({ t: JUDGMENT.gap + 1.2, do: 'pose', id: 'idle', blend: 0.4 });
      out.push({ t: JUDGMENT.gap + 1.3, do: 'vulnerable', dur: 1.3 });
      return out;
    }
    const cross = (off: number) => [0, 1, 2, 3].map((k) => off + (k * Math.PI) / 2);
    strike(cross(Math.PI / 4), 0);
    strike(cross(0), 0.7);
    out.push({ t: 1.9, do: 'pose', id: 'idle', blend: 0.4 });
    out.push({ t: 2.0, do: 'vulnerable', dur: 1.3 });
    return out;
  }

  /** Направления катящихся кадил: по лучам звезды (через один, с луча Пилота) или по кресту. */
  private rollDirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  private chainSteps(): Step[] {
    const out: Step[] = [
      { t: 0, do: 'pose', id: 'censers', blend: 0.3 },
      { t: 0, do: 'telegraphSound', kind: 'whistle' },
    ];
    const st = this.w_.arena.def.star;
    if (st) {
      const h = nearestRay(st, this.w_.hero.x - this.x, this.w_.hero.z - this.z);
      this.rollDirs = [0, 2, 4].map((d) => { const a = starRay(st, (h + d) % st.rays); return [Math.sin(a), Math.cos(a)] as [number, number]; });
    } else this.rollDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of this.rollDirs) {
      const at = { x: this.x + dx * 2, z: this.z + dz * 2 };
      const to = { x: this.x + dx * 16, z: this.z + dz * 16 };
      out.push({ t: 0, do: 'telegraph', shape: { line: [14, 1.9] }, at, dir: to, dur: 0.95 });
    }
    out.push({ t: 0.95, do: 'call', fn: 'roll' });
    out.push({ t: 0.95, do: 'sfx', id: 'swing_heavy' });
    out.push({ t: 1.1, do: 'pose', id: 'idle', blend: 0.4 });
    out.push({ t: 1.4, do: 'vulnerable', dur: 1.2 });
    return out;
  }

  protected override onCall(w: World, fn: string, arg?: number): void {
    if (fn === 'sway') { this.sway = arg ?? 0.9; return; }
    if (fn === 'sermonLine') {
      for (const e of this.summoned) if (e instanceof Obelisk) e.boss = this;
      w.bus.emit('voice', { line: 'Щит держат обелиски. Разбей их — полный заряд ломает с одного удара.', speaker: 'kaelis' });
      return;
    }
    if (fn === 'hurl') {
      // кадило летит по линии телеграфа и гаснет у края; можно отбить полным зарядом
      const dx = this.snapX - this.x, dz = this.snapZ - this.z, l = Math.hypot(dx, dz) || 1;
      const sp = 7.5;
      w.spawnProjectile('censer', this.x + (dx / l) * 2.4, this.z + (dz / l) * 2.4, (dx / l) * sp, (dz / l) * sp, 0.16 * this.dmgUnit, this.id, 0.8, 13 / sp, 1.4);
      w.bus.emit('enemyAttack', { kind: 'censer', x: this.x, z: this.z });
      return;
    }
    if (fn === 'roll') {
      for (const [dx, dz] of this.rollDirs) {
        const p = w.spawnProjectile('censerBall', this.x + dx * 2.2, this.z + dz * 2.2, dx * 9, dz * 9, 0.2 * this.dmgUnit, this.id, 0.95, 2.2, 0.7);
        void p;
      }
      return;
    }
    if (fn.startsWith('smoke:')) {
      const [, xs, zs] = fn.split(':');
      w.addHazard({ shape: { k: 'circle', x: Number(xs), z: Number(zs), r: 1.6 }, dur: 3, tick: 0.5, dmg: 0.04 * this.dmgUnit, hostile: true, kind: 'smoke' });
    }
  }

  override onDamaged(w: World, dmg: number, before: number): void {
    super.onDamaged(w, dmg, before);
    // Проповедь: щит, пока живы призванные Аколиты
    const c = this.ctrl;
    if (!c) return;
    if (this.phase === 1 && this.hp <= this.maxHp * PHASE2_AT && !c.reached(2)) {
      this.hp = Math.max(this.hp, Math.round(this.maxHp * PHASE2_AT));
      c.startTransition(2);
    } else if (this.phase === 2 && this.hp <= this.maxHp * PHASE3_AT && !c.reached(3)) {
      this.hp = Math.max(this.hp, Math.round(this.maxHp * PHASE3_AT));
      c.startTransition(3);
    }
  }

  override onLethal(_w: World): boolean {
    if (this.phase < 3) { this.hp = 1; this.ctrl?.startTransition(this.phase + 1 as 2 | 3); return false; }
    // фаза III: умирает только от казни
    if (this.dying || this.ctrl?.executing || !this.ctrl) return true;
    this.hp = 1;
    return false;
  }

  /** Оглушённый в фазе III падает с цепей на ближний мост (казнь идёт там). */
  private landFrom: { x: number; z: number; y: number; tx: number; tz: number; t: number } | null = null;
  override onStun(): void {
    super.onStun();
    if (this.phase < 3 || !this.w_) return;
    const o = { x: 0, z: 0 };
    this.w_.arena.nearestWalkable(this.x, this.z, o);
    this.landFrom = { x: this.x, z: this.z, y: this.y, tx: o.x, tz: o.z, t: 0 };
  }

  /** Перехват фазы (план §8.3.1): полный заряд или ульта в окне — новая фаза начнётся с оглушением. */
  override preHit(_w: World, p: StrikeParams): boolean {
    const c = this.ctrl;
    if (!c?.interceptOpen) return false;
    const full = p.stunKind === 'charged' && p.feel === 'heavy';
    const ult = p.abilityId === 'eclipse' || p.abilityId === 'eclipseEnd';
    return (full || ult) && c.intercept();
  }

  override onShattered(w: World): void {
    // Раскол: клинок в колокол, звон глохнет, Иерофант на миг оседает
    w.bus.emit('sfx', { id: 'bell_crack', x: this.x, z: this.z, gain: 0.8 });
  }

  protected override think(w: World, dt: number, tick: boolean): void {
    if (this.transitioning > 0 || this.dying) { this.vx = this.vz = 0; return; }
    // интро: ждёт сцену (спускается по цепям), не двигается
    if (this.idleT > 100) { this.vx = this.vz = 0; this.faceTo(w.hero.x, w.hero.z, 0.5, dt); return; }
    this.stationary = this.phase !== 1;
    // щит Проповеди: −70 % урона, пока стоят оба обелиска; каждый разбитый снимает половину
    let ob = 0;
    for (const e of this.summoned) if (e instanceof Obelisk && !e.dead) ob++;
    this.shieldMul = this.phase >= 3 ? PHASE3_DMG : 1 - SERMON_SHIELD * Math.min(2, ob) / 2;
    super.think(w, dt, tick);
    // фаза III: облетает арену по кругу на цепях, спутники звонят
    if (this.phase >= 3) { this.circleArena(dt); this.stepSats(w, dt); return; }
    // фаза II: между атаками дрейфует к «дому» (центр креста)
    if (this.stationary && !this.cur && !this.move) {
      const dx = this.homeX - this.x, dz = this.homeZ - this.z, d = Math.hypot(dx, dz);
      if (d > 0.5) { this.x += (dx / d) * Math.min(d, 1.6 * dt); this.z += (dz / d) * Math.min(d, 1.6 * dt); }
    }
  }

  /** Облёт (план §8.3, фаза III): над бездной по кругу, во время атак — медленнее; паттерн с прыжком — свой путь. */
  private circleArena(dt: number): void {
    this.flying = true;
    if (this.move) return;
    this.orbitA += dt * ORBIT.w * (this.cur ? 0.35 : 1);
    this.steer(Math.sin(this.orbitA) * ORBIT.r, Math.cos(this.orbitA) * ORBIT.r, ORBIT.speed, dt);
    this.y += (ORBIT.y + Math.sin(this.time * 1.3) * 0.3 - this.y) * Math.min(1, dt * 2);
  }

  /** Спутники: метка 0.9 с под колоколом → кольцо с разрывами; оглушённый босс — спутники молчат (новые не начинают). */
  private stepSats(w: World, dt: number): void {
    const h = w.hero;
    w.bellSats.length = 0;
    for (const s of this.sats) {
      s.a += SATS.w * dt;
      const x = Math.sin(s.a) * SATS.r, z = Math.cos(s.a) * SATS.r;
      if (!this.stunned || s.tele) s.t += dt;
      if (!s.tele && s.t >= SATS.period - SATS.tele) {
        s.tele = true; s.tx = x; s.tz = z;
        w.addTelegraph({ k: 'circle', x, z, r: 1.6 }, SATS.tele, false, false);
        w.bus.emit('telegraph', { kind: 'chime', x, z, src: this.kind });
      }
      if (s.t >= SATS.period) {
        s.t -= SATS.period; s.tele = false;
        const R = SATS.ring, toHero = Math.atan2(h.x - s.tx, h.z - s.tz);
        const gaps = Array.from({ length: R.gaps }, (_, i) => ({ a: toHero + Math.PI + w.rng.spread(1.2) + (i * Math.PI * 2) / R.gaps, w: R.gapW }));
        w.addRingWave(s.tx, s.tz, R.speed, R.width, R.maxR, gaps, R.dmg * this.dmgUnit, this.id, 0);
        w.bus.emit('enemyAttack', { kind: 'bell', x: s.tx, z: s.tz });
        w.bus.emit('sfx', { id: 'chime_ring', x: s.tx, z: s.tz });
      }
      const glow = s.tele ? clamp((s.t - (SATS.period - SATS.tele)) / SATS.tele, 0, 1) : 0;
      w.bellSats.push({ x, y: 3.4 + Math.sin(this.time * 1.7 + s.a) * 0.25, z, glow });
    }
  }

  protected animate(dt: number): void {
    if (this.landFrom) {
      const f = this.landFrom;
      f.t += dt;
      const u = Math.min(1, f.t / 0.6), e = u * u;
      this.x = f.x + (f.tx - f.x) * e; this.z = f.z + (f.tz - f.z) * e; this.y = f.y * (1 - e);
      if (u >= 1 || !this.stunned) this.landFrom = null;
    }
    const s = this.puppet.skel, L = s.layout, out = s.rot;
    out.set(L.restRot);
    this.bob += dt;
    const pose = this.blendPose(dt);
    for (const [j, e] of pose) setJoint(out, L, j, e[0], e[1], e[2]);
    // звон: раскачивание колокола
    if (this.sway > 0) {
      this.sway -= dt;
      const k = Math.sin(this.bob * 9) * 0.35 * Math.min(1, this.sway * 2);
      setJoint(out, L, L.idx('bell'), k, 0, k * 0.5);
    }
    const chest = L.idx('chest');
    if (this.cur?.id === 'censers' || this.cur?.id === 'chains' || this.cur?.id === 'swing') {
      this.swing += dt * 7;
      setJoint(out, L, chest, (pose.get(chest)?.[0] ?? 0), this.swing, 0);
    }
    // кадила на цепях: маятники
    for (let i = 0; i < 4; i++) {
      const a = ARMS[i];
      const ph = this.bob * 2.2 + i * 1.3;
      setJoint(out, L, L.idx(`c1${a}`), Math.sin(ph) * 0.35 + this.puppet.springZ * 0.5, 0, Math.cos(ph * 0.8) * 0.3);
      setJoint(out, L, L.idx(`c2${a}`), Math.sin(ph - 0.6) * 0.25, 0, Math.cos(ph * 0.8 - 0.5) * 0.2);
    }
    setJoint(out, L, L.idx('clapper'), Math.sin(this.bob * 3) * 0.2, 0, Math.cos(this.bob * 2.6) * 0.2);
    const float = this.state === 'stunned' ? -1.6 : Math.sin(this.bob * 1.3) * 0.25;
    s.off[L.idx('body') * 3 + 1] = float;
    s.x = this.x; s.z = this.z; s.y = this.y; s.facing = this.facing;
    s.tiltX = this.puppet.springZ * 0.05; s.tiltZ = -this.puppet.springX * 0.05;
    s.update();
    // окно перехвата: ядро бьётся бело-фиолетовым светом
    const open = this.ctrl?.interceptOpen ? 1 : 0;
    this.puppet.boost = this.coreGlow + (this.vulnerableT > 0 ? 0.6 : 0) + (this.transitioning > 0 ? 1.5 : 0) + open * 1.6 + (this.phase >= 3 ? 0.8 : 0) + this.beatGlow * 0.9;
    this.beatGlow = Math.max(0, this.beatGlow - dt * 3);
    if (open) this.puppet.flash = Math.max(this.puppet.flash, 0.35 + 0.25 * Math.sin(this.bob * 22));
    this.coreGlow = Math.max(0, this.coreGlow - dt);
  }

  /** Звёзды оглушения кружат над колоколом. */
  override headPoint(out: { x: number; y: number; z: number }): void {
    this.bellPos(_bell);
    out.x = _bell.x; out.y = _bell.y + 1.0; out.z = _bell.z;
  }

  /** Замах стягивается к колоколу. */
  override windupPoint(out: { x: number; y: number; z: number }): void {
    this.bellPos(_bell);
    out.x = _bell.x; out.y = _bell.y; out.z = _bell.z;
  }

  /** Маска понтифика (огонь, казнь, отбитые кадила): точка на лице, сустав «bell» — голова. */
  bellPos(out: THREE.Vector3): THREE.Vector3 { return this.puppet.skel.jointPoint(this.puppet.layout.idx('bell'), 0, 0.32, 0.18, out); }
  /** Точка на витражном нимбе за головой (угол a): угли, свет. */
  haloPoint(a: number, out: THREE.Vector3): THREE.Vector3 { return this.puppet.skel.jointPoint(this.puppet.layout.idx('clapper'), Math.sin(a) * 0.95, Math.cos(a) * 0.95, 0, out); }
  censerPos(i: number, out: THREE.Vector3): THREE.Vector3 { return this.puppet.skel.jointPoint(this.puppet.layout.idx(`censer${ARMS[i]}`), 0, -0.38, 0, out); }
}

registerEnemy('hierophant', Hierophant);

/** Минимальный интерфейс боя, который нужен контроллеру. */
export interface BossHost {
  world: World;
  say(line: string, speaker: 'kaelis' | 'boss'): void;
  banner(name: string, title: string): void;
  letterbox(v: number): void;
  slow(scale: number, sec: number): void;
  flash(v: number): void;
  starFlare(v: number): void;
  musicPhase(p: number): void;
  emitFire(x: number, y: number, z: number, censer: boolean): void;
  skipRequested(): boolean;
  /** Сцена режиссёра (план §8.1): calls — логика шагов 'call'. */
  scene(track: CineTrack, calls: Record<string, (arg?: number) => void>, onEnd: (skipped: boolean) => void): void;
  music(cue: MusicCue): void;
  /** Тема босса (с первым ударом — имя). */
  startSong(): void;
  /** Свечи гаснут в круге r от точки; r = 0 — зажечь снова. */
  quench(x: number, z: number, r: number): void;
  /** Красные руны на полу. */
  runes(x: number, z: number): void;
  /** Цепи, на которых висит босс (пусто — убрать). */
  chains(list: { x: number; z: number; y0: number; len: number }[]): void;
  /** Пыль с потолка. */
  dust(x: number, z: number): void;
  /** Параметр неба сцены (трещина фазы III). */
  sky(param: 'crack' | 'starLit' | 'star2', v: number): void;
  /** Сдвиг музыки в центах (фаза III — +100). */
  transpose(cents: number): void;
  /** Провал громкости песни (такт тишины). */
  duck(level: number, hold: number): void;
  /** Направление на погасшую звезду неба. */
  starDir(): [number, number, number];
  /** Касание-тайминг сцены попало. */
  sceneHit(id: string): boolean;
  /** Страницы и обсидиан осыпаются в бездну. */
  pages(x: number, y: number, z: number): void;
  /** Луч из провала в небо. */
  beam(x: number, z: number): void;
  /** Звезда зоны загорелась навсегда (flawless — и вторая малая, титул, запись в журнале). */
  saveStar(flawless: boolean): void;
  /** Казнь досмотрена — бой можно закрывать. */
  finishFight(): void;
  /** Свет на лицо в крупном плане (ревью: маска в темноте и красном ободе читалась бурой): точка, цвет, сила, радиус, жизнь. */
  light?(x: number, y: number, z: number, rgb: 'gold' | 'void', intensity: number, radius: number, life: number): void;
}

/** Свет на маску в крупных планах: на сколько метров перед лицом, сила, радиус (м). */
export const FACE_LIGHT = { ahead: 1.3, intensity: 2.4, radius: 4.5 };

/**
 * Контроллер боя с Иерофантом: появление (летербокс, пролёт камеры, имя «впечатывается»), переход фаз
 * (неуязвимость, замедление, ударная волна, крест-мост над бездной, лечение героя 10 %), смерть.
 */
export class HierophantController implements BossController {
  readonly name = 'ИЕРОФАНТ СКОРБИ';
  phase = 0;
  readonly phaseMarks = [PHASE2_AT, PHASE3_AT];
  zoomMul = 1.12;
  private t = 0;
  private introDone = false;
  /** Идущий переход: в первые 1.2 с — окно перехвата, потом сцена. */
  private trans: { to: 2 | 3; t: number; scene: boolean } | null = null;
  private readonly entered = new Set<number>();
  /** Перехват — один раз за бой (без бонуса к наградам). */
  interceptUsed = false;
  /** Идёт казнь (план §8.3.2). */
  executing = false;
  /** В фазе III герой получил урон (безупречная казнь — без него или по кольцу-таймингу). */
  private p3Hurt = false;
  private flawless = false;
  private finished = false;
  private interceptHinted = false;
  private deathT = -1;
  private lines = 0;
  private fireT = 0;
  private readonly tmp = new THREE.Vector3();

  /** Огонь в колоколе разгорается в интро. */
  private fireOn = false;
  /** Цепи спуска видны. */
  private chainsOn = false;
  private hintT = -1;

  constructor(private host: BossHost, readonly boss: Hierophant) {
    boss.ctrl = this;
    boss.homeX = 0; boss.homeZ = 0;
    const h = host.world.hero, b = boss;
    host.world.bus.on('playerHurt', () => { if (this.phase >= 3) this.p3Hurt = true; });
    // интро 2.0 (план §8.3): босс ждёт под сводом, сцена спускает его по цепям
    b.y = DESCEND_FROM;
    host.scene(hierophantIntroTrack({ hx: h.x, hz: h.z, bx: b.x, bz: b.z }), {
      quiet: () => host.music('silence'),
      runes: () => host.runes(b.x, b.z),
      douse: (k) => host.quench(b.x, b.z, [0, 7, 12.5, 18][k ?? 1]),
      descend: () => { this.chainsOn = true; b.setPose('rise', 0.2); },
      ignite: () => { this.fireOn = true; b.setPose('idle', 0.5); b.coreGlow = 1.5; },
      bless: () => { b.setPose('bless', 0.35); this.faceLight('gold', 1.6); },
      slam: () => {
        if (this.introDone) return;
        b.y = 0;
        b.setPose('slam', 0.06);
        this.chainsOn = false; host.chains([]);
        host.dust(b.x, b.z);
        host.quench(b.x, b.z, 0);
        host.world.bus.emit('sfx', { id: 'slam', x: b.x, z: b.z });
        host.world.bus.emit('shake', { trauma: 0.18 });
      },
      music: () => host.startSong(),
      begin: () => this.finishIntro(),
    }, () => this.finishIntro());
  }

  step(dt: number): void {
    const b = this.boss;
    this.t += dt;
    // спуск по цепям: две цепи от плеч уходят под свод
    if (this.chainsOn) {
      b.bellPos(this.tmp);
      const top = this.tmp.y + 3.2, len = Math.max(4, 22 - top);
      const sx = Math.cos(b.facing) * 1.5, sz = -Math.sin(b.facing) * 1.5;
      const list = [{ x: b.x + sx, z: b.z + sz, y0: top, len }, { x: b.x - sx, z: b.z - sz, y0: top, len }];
      for (const s of this.host.world.bellSats) list.push({ x: s.x, z: s.z, y0: s.y + 0.6, len: 16 });
      this.host.chains(b.dead ? [] : list);
    }
    if (this.hintT >= 0) {
      this.hintT += dt;
      if (this.hintT > 1.6) { this.hintT = -1; this.host.say('Бей в окна после ударов — оглуши его. Маска — его сердце.', 'kaelis'); }
    }
    // угли сыплются с витражного нимба, дым кадил
    this.fireT -= dt;
    if (this.fireOn && this.fireT <= 0 && !b.dead) {
      this.fireT = 0.05;
      b.haloPoint(Math.random() * Math.PI * 2, this.tmp);
      this.host.emitFire(this.tmp.x, this.tmp.y, this.tmp.z, false);
      b.censerPos(Math.floor(Math.random() * 4), this.tmp);
      this.host.emitFire(this.tmp.x, this.tmp.y, this.tmp.z, true);
    }
    if (this.trans) this.stepTransition(dt);
    if (this.deathT >= 0) this.stepDeath(dt);
  }

  private finishIntro(): void {
    if (this.introDone) return;
    const b = this.boss;
    this.introDone = true;
    this.fireOn = true;
    this.phase = 1;
    b.phase = 1;
    b.y = 0;
    this.chainsOn = false;
    this.host.chains([]);
    this.host.quench(b.x, b.z, 0);
    this.host.startSong();
    // управление возвращается — и сразу самый читаемый паттерн: Звон
    b.idleT = 0;
    const toll = b.patterns.find((p) => p.id === 'toll');
    if (toll) b.startPattern(toll);
    this.hintT = 0;
  }

  /** Фаза уже наступила (или идёт переход в неё). */
  reached(phase: number): boolean { return this.entered.has(phase) || this.trans?.to === phase; }

  get interceptOpen(): boolean { return !!this.trans && !this.trans.scene && this.trans.t < INTERCEPT_WINDOW && !this.interceptUsed; }

  /** Начать переход: всё прерывается, ядро открыто 1.2 с (перехват), затем сцена перехода. */
  startTransition(to: 2 | 3): void {
    if (this.trans || this.entered.has(to) || this.phase >= to) return;
    const b = this.boss, w = this.host.world;
    this.trans = { to, t: 0, scene: false };
    b.transitioning = 99;
    b.cur = null; b.move = null; b.y = 0;
    // новая фаза: оглушение обрывается, привыкание сбрасывается
    if (b.stun) { b.stun.stunned = 0; b.stun.value = 0; b.stun.immune = 0; resetStunHabit(b.stun); }
    b.stunQueued = false; b.awakenQueued = false; b.vulnerableT = 0;
    if (b.state === 'stunned') b.setState('chase');
    // реакция на удар (этап 4.5, C2): отшатывается от Пилота, хватается за маску, маска вспыхивает золотом —
    // жест читается и с боевой камеры, крупно его покажет первый план сцены
    const h = w.hero, hx = b.x - h.x, hz = b.z - h.z, hl = Math.hypot(hx, hz) || 1;
    b.puppet.kickSpring(hx / hl, hz / hl, GRIEF.recoil);
    b.setPose('grief', 0.1);
    this.faceLight('gold', INTERCEPT_WINDOW + COLLAPSE_T.close, GRIEF.light);
    for (const e of b.summoned) if (!e.dead) w.killEnemy(e, 0, 1, 3);
    w.projectiles.length = 0;
    w.ringWaves.length = 0;
    for (const t of w.telegraphs) t.alive = false;
    w.bus.emit('sfx', { id: 'boss_roar', x: b.x, z: b.z });
    w.bus.emit('shake', { trauma: 0.45 });
    w.bus.emit('bossPhase', { phase: to });
    if (!this.interceptUsed && !this.interceptHinted) {
      this.interceptHinted = true;
      this.host.say('Ядро открыто! Полный заряд — перехвати!', 'kaelis');
    }
  }

  private stepTransition(dt: number): void {
    const tr = this.trans!;
    tr.t += dt;
    if (!tr.scene && tr.t >= INTERCEPT_WINDOW) { tr.scene = true; this.playTransition(tr.to); }
  }

  /** Перехват (план §8.3.1): часть перехода пропускается, новая фаза — сразу с оглушением. */
  intercept(): boolean {
    if (!this.interceptOpen) return false;
    const to = this.trans!.to, b = this.boss, w = this.host.world;
    this.interceptUsed = true;
    this.host.flash(0.6);
    this.host.slow(0.25, 0.5);
    w.bus.emit('bossIntercept', { x: b.x, z: b.z });
    if (to === 2) { this.collapse(true); this.toBridge(); this.host.musicPhase(1); }
    else { this.crack(); this.host.sky('crack', 1); }
    this.host.banner(to === 2 ? 'НАБАТ' : 'ПОСЛЕДНИЙ ЗВОН', to === 2 ? 'Вторая фаза' : 'Третья фаза');
    this.enterPhase(to);
    w.stunEnemy(b);
    return true;
  }

  private playTransition(to: 2 | 3): void {
    const b = this.boss, w = this.host.world, h = w.hero;
    b.bellPos(this.tmp);
    const spots = { hx: h.x, hz: h.z, bx: b.x, bz: b.z, mask: [this.tmp.x, this.tmp.y, this.tmp.z] as V3 };
    const H = this.host;
    if (to === 2) {
      H.scene(collapseTrack(spots), {
        silence: () => H.duck(0.02, 1.6),
        collapse: () => this.collapse(false),
        land: () => this.toBridge(),
        braam: () => w.bus.emit('sfx', { id: 'braam', x: 0, z: 0 }),
        tocsin: () => { H.musicPhase(1); w.bus.emit('sfx', { id: 'boss_bell', x: b.x, z: b.z }); },
        phase: () => this.enterPhase(2),
      }, () => { this.collapse(false); this.enterPhase(2); });
    } else {
      H.scene(crackTrack(spots, H.starDir()), {
        silence: () => H.duck(0.05, 0.9),
        crack: () => this.crack(),
        raise: () => H.transpose(100),
        phase: () => this.enterPhase(3),
      }, () => { this.crack(); H.sky('crack', 1); this.enterPhase(3); });
    }
  }

  /** Пол нефа уходит в бездну: остаётся крест мостов; босс — над средокрестием. */
  private collapse(instant: boolean): void {
    const w = this.host.world, b = this.boss;
    if (w.arena.edge === 'abyss') return;
    w.arena.collapseOutsideCross();
    // руки вверх — пол уходит по его жесту
    b.setPose('phase', 0.25);
    w.bus.emit('sfx', { id: 'shatter_big', x: 0, z: 0 });
    w.bus.emit('shake', { trauma: 0.6 });
    this.host.say('Пол уходит! Держись мостов.', 'kaelis');
    b.homeX = 0; b.homeZ = 0;
    if (instant) { b.x = 0; b.z = 0; }
  }

  /** Пилота — на ближайший мост (плитка, что остаётся после обрушения), +10 % HP. */
  private toBridge(): void {
    const w = this.host.world, h = w.hero, a = w.arena;
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.1);
    if (a.tileAt(h.x, h.z)?.cross) return;
    let best = Infinity, bx = 0, bz = 0;
    for (const t of a.tiles) {
      if (!t.cross) continue;
      const d = (t.x - h.x) ** 2 + (t.z - h.z) ** 2;
      if (d < best) { best = d; bx = t.x; bz = t.z; }
    }
    h.x = bx; h.z = bz;
    h.avatar.resetCloth();
    h.avatar.puppet.play('land', 1.4, 0.05);
    h.invulnUntil = Math.max(h.invulnUntil, h.clock + 1.5);
  }

  /** Колокол треснул: огонь внутри открыт (×1.5 урона), музыка на полтона выше. */
  private crack(): void {
    const b = this.boss, w = this.host.world;
    if (b.bellCracked) return;
    b.bellCracked = true;
    w.bus.emit('sfx', { id: 'bell_crack', x: b.x, z: b.z });
    w.bus.emit('shake', { trauma: 0.5 });
    // огонь вырывается из трещины
    b.bellPos(this.tmp);
    for (let i = 0; i < 40; i++) this.host.emitFire(this.tmp.x, this.tmp.y - 0.6, this.tmp.z, false);
    w.bus.emit('shockwave', { x: b.x, z: b.z, r: 7, color: 'hunger', strength: 0.8 });
    this.host.transpose(100);
  }

  private enterPhase(to: 2 | 3): void {
    if (this.entered.has(to)) return;
    const b = this.boss;
    this.entered.add(to);
    this.trans = null;
    this.phase = to;
    b.phase = to;
    b.transitioning = 0;
    // первый опасный сигнал — после того, как камера вернулась в бой (этап 4.5, C2): дорожка держит ещё 0.2 с,
    // возврат камеры 0.7 с, затем RETURN_CALM чистого обзора. Было 0.6 — «Приговор» начинался посреди возврата
    b.idleT = 0.2 + COLLAPSE_BLEND + RETURN_CALM;
    b.setPose('idle', 0.4);
    this.zoomMul = to === 2 ? 1.25 : 1.35;
    if (to === 3) {
      // облёт начинается с его места; между атаками — передышка длиннее: звонят спутники
      b.orbitA = Math.atan2(b.x, b.z);
      b.restRange = [1.4, 2.2];
      this.chainsOn = true;
    }
  }

  /** Кнопка атаки горит «ДОБИТЬ»: фаза III, ≤ 6 % HP, оглушён. */
  get executable(): boolean {
    const b = this.boss;
    return this.introDone && this.phase >= 3 && !this.executing && !b.dead && b.stunned && b.hp <= b.maxHp * EXEC_HP;
  }

  /** Казнь (план §8.3.2): сцена режиссёра; босс оглушён до конца, умирает отложенным разрезом. */
  execute(): void {
    if (!this.executable) return;
    const b = this.boss, w = this.host.world, h = w.hero, H = this.host;
    this.executing = true;
    // всё вокруг замирает: снаряды, кольца, метки, спутники
    if (b.stun) { b.stun.stunned = 99; b.stun.total = 99; }
    w.projectiles.length = 0; w.ringWaves.length = 0;
    for (const t of w.telegraphs) t.alive = false;
    for (const e of w.enemies) if (e !== b && !e.dead) w.killEnemy(e, 0, 1, 3);
    for (const s of b.sats) { s.tele = false; s.t = 0; }
    h.scripted = true;
    const dx = b.x - h.x, dz = b.z - h.z, dl = Math.hypot(dx, dz) || 1;
    const fx = dx / dl, fz = dz / dl;
    const c = { x: 0, z: 0 }, l = { x: 0, z: 0 };
    w.arena.nearestWalkable(b.x - fx * 2.6, b.z - fz * 2.6, c);
    w.arena.nearestWalkable(b.x + fx * 3.2, b.z + fz * 3.2, l);
    // маска оглушённого — где она на самом деле (склонился: ~2.8 м, ближе к герою); было max(4, …) — планы и удар
    // клинка шли на 1.2–1.5 м выше маски
    b.bellPos(this.tmp);
    const mask: [number, number, number] = [this.tmp.x, Math.max(2.2, this.tmp.y), this.tmp.z];
    const bellY = mask[1];
    // цепь от маски к полу — по ней Пилот взбегает
    const chain = { x: c.x, z: c.z, y0: 0, len: 0, to: { x: mask[0] - fx * 0.5, y: bellY + 0.4, z: mask[2] - fz * 0.5 } };
    this.chainsOn = false;
    H.scene(executionTrack({ bx: b.x, bz: b.z, hx: h.x, hz: h.z, cx: c.x, cz: c.z, bellY, lx: l.x, lz: l.z, star: H.starDir(), mask }), {
      freeze: () => { H.slow(0.05, 0.5); H.duck(0, 30); w.bus.emit('sfx', { id: 'choir_note', x: b.x, z: b.z }); b.inScene = true; this.faceLight('gold', 1.3); },
      // цепь — с рывком: на крупном плане маски она шла поперёк лица
      dash: () => { H.chains([chain]); h.sceneGhosts = true; w.bus.emit('sfx', { id: 'dash', x: h.x, z: h.z }); },
      ghostsOff: () => { h.sceneGhosts = false; },
      flare: () => { h.glowBoost = 2.2; },
      strike: () => {
        this.flawless = H.sceneHit('perfect') || !this.p3Hurt;
        w.bus.emit('sfx', { id: 'shatter_cut', x: b.x, z: b.z });
        w.bus.emit('sfx', { id: 'hit_heavy', x: b.x, z: b.z });
        w.bus.emit('shockwave', { x: b.x, z: b.z, r: this.flawless ? 15 : 7, color: 'void', strength: this.flawless ? 1.6 : 1 });
      },
      toll: () => {
        // огонь нимба на треснувшей маске — свет держится до крупного плана трещин (через 1.5 с)
        this.faceLight('gold', 3.4, 1.5);
        H.chains([]);
        H.music('silence');
        w.bus.emit('sfx', { id: 'boss_bell', x: b.x, z: b.z });
        w.bus.emit('sfx', { id: 'ear_ring', x: b.x, z: b.z });
        w.bus.emit('shake', { trauma: 0.3 });
      },
      cut: () => this.cut(),
      beam: () => { H.beam(b.x, b.z); w.bus.emit('sfx', { id: 'beam_up', x: b.x, z: b.z }); },
      star2: () => { if (this.flawless) H.sky('star2', 1); },
      calm: () => { h.glowBoost = 0; h.sceneGhosts = false; h.avatar.puppet.anim.stop(0.8); },
      end: () => this.finish(),
    }, () => { this.cut(); this.finish(); });
  }

  /** Осветить маску спереди (к герою) на life секунд. */
  private faceLight(rgb: 'gold' | 'void', life: number, k = 1): void {
    const b = this.boss, h = this.host.world.hero;
    b.bellPos(this.tmp);
    const dx = h.x - b.x, dz = h.z - b.z, dl = Math.hypot(dx, dz) || 1;
    this.host.light?.(this.tmp.x + dx / dl * FACE_LIGHT.ahead, this.tmp.y + 0.2, this.tmp.z + dz / dl * FACE_LIGHT.ahead, rgb, FACE_LIGHT.intensity * k, FACE_LIGHT.radius, life);
  }

  /** Отложенный разрез: босс раскалывается по линии удара и осыпается в бездну. */
  private cut(): void {
    const b = this.boss, w = this.host.world, h = w.hero;
    if (b.dead) return;
    b.dying = true;
    b.bellPos(this.tmp);
    this.host.pages(b.x, this.tmp.y, b.z);
    w.bellSats.length = 0;
    this.host.chains([]);
    w.killEnemy(b, b.x - h.x, b.z - h.z, 7);
    w.bus.emit('sfx', { id: 'shatter_big', x: b.x, z: b.z });
    w.bus.emit('shake', { trauma: 0.6 });
    w.bus.emit('bossDeath', { x: b.x, z: b.z });
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const h = this.host.world.hero;
    h.scripted = false; h.sceneGhosts = false; h.glowBoost = 0; h.y = 0;
    this.host.sky('starLit', 1);
    if (this.flawless) this.host.sky('star2', 1);
    this.host.saveStar(this.flawless);
    this.host.banner('ИЕРОФАНТ ПОВЕРЖЕН', this.flawless ? 'Безупречная казнь' : 'Звон умолк');
    this.host.finishFight();
  }

  startDeath(): void {
    if (this.deathT >= 0) return;
    const b = this.boss, w = this.host.world;
    this.deathT = 0;
    w.bellSats.length = 0;
    this.chainsOn = false; this.host.chains([]);
    b.flying = false;
    b.dying = true;
    b.cur = null; b.move = null;
    b.setPose('phase', 0.2);
    this.host.slow(0.2, 1.5);
    this.host.flash(0.55);
    w.projectiles.length = 0; w.ringWaves.length = 0;
    for (const e of w.enemies) if (e !== b && !e.dead) w.killEnemy(e, 0, 1, 3);
    w.bus.emit('sfx', { id: 'stun_break', x: b.x, z: b.z });
    w.bus.emit('bossDeath', { x: b.x, z: b.z });
  }

  private stepDeath(dt: number): void {
    const b = this.boss, w = this.host.world;
    this.deathT += dt;
    // фиолетовые трещины → распад на детали → осколки → лучи света
    b.puppet.crack = Math.min(1, this.deathT * 1.5);
    if (this.deathT > 0.9 && !b.dead) {
      w.killEnemy(b, 0, 1, 9);
      w.bus.emit('shockwave', { x: b.x, z: b.z, r: 16, color: 'void', strength: 1.6 });
      w.bus.emit('sfx', { id: 'victory', x: b.x, z: b.z });
      w.bus.emit('shake', { trauma: 0.8 });
      this.host.banner('ИЕРОФАНТ ПОВЕРЖЕН', 'Звон умолк');
    }
    if (this.deathT > 2.4 && this.lines < 5) { this.lines = 5; this.host.say('Звон умолк. Слышишь тишину, Пилот? Это — наша.', 'kaelis'); }
    this.host.starFlare(clamp((this.deathT - 0.9) / 0.6, 0, 1) * clamp(1 - (this.deathT - 3) / 2, 0, 1));
  }

  cameraTarget(): { x: number; z: number } | null { return this.boss.dead ? null : this.boss; }

  /** Камеру интро ведёт режиссёр (дорожка hierophantIntro). */
  cameraOverride(_cam: CameraRig, _camera: THREE.PerspectiveCamera, _realDt: number): void {}

  hudBoss(): Hierophant | null { return this.introDone && !this.boss.dead ? this.boss : null; }
}
