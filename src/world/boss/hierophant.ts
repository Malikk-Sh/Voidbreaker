import * as THREE from 'three';
import { clamp } from '../../core/math';
import { Ease } from '../../core/ease';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { ARMS, hierophantRig } from '../../gen/chars/hierophant';
import { Acolyte } from '../enemies/acolyte';
import { registerEnemy } from '../enemies/factory';
import type { SpawnOpts } from '../enemy';
import type { World } from '../world';
import type { CameraRig } from '../camera';
import type { BossController } from './bossBase';
import { ScriptedEnemy, type PoseLib } from './scripted';
import type { Pattern, Step } from './timeline';

const PHASE2_AT = 0.55;

const POSES: PoseLib = {
  idle: { shUL: [-0.5, 0, 0.5], shUR: [-0.5, 0, -0.5], shLL: [-0.2, 0, 0.35], shLR: [-0.2, 0, -0.35], elbUL: [-0.5, 0, 0], elbUR: [-0.5, 0, 0], elbLL: [-0.4, 0, 0], elbLR: [-0.4, 0, 0] },
  toll: { chest: [-0.25, 0, 0], shUL: [-2.2, 0, 0.6], shUR: [-2.2, 0, -0.6], elbUL: [-0.6, 0, 0], elbUR: [-0.6, 0, 0], shLL: [-0.6, 0, 0.9], shLR: [-0.6, 0, -0.9] },
  censers: { shUL: [-1.5, 0, 1.3], shUR: [-1.5, 0, -1.3], shLL: [-1.4, 0, 1.2], shLR: [-1.4, 0, -1.2], elbUL: [-0.1, 0, 0], elbUR: [-0.1, 0, 0], elbLL: [-0.1, 0, 0], elbLR: [-0.1, 0, 0] },
  sermon: { chest: [-0.35, 0, 0], shUL: [-2.6, 0, 0.9], shUR: [-2.6, 0, -0.9], shLL: [-1.6, 0, 1.3], shLR: [-1.6, 0, -1.3], elbUL: [-0.3, 0, 0], elbUR: [-0.3, 0, 0] },
  rise: { chest: [-0.3, 0, 0], shUL: [-2.8, 0, 0.3], shUR: [-2.8, 0, -0.3], shLL: [-2.4, 0, 0.6], shLR: [-2.4, 0, -0.6] },
  slam: { chest: [0.55, 0, 0], shUL: [-0.4, 0, 1.3], shUR: [-0.4, 0, -1.3], shLL: [-0.2, 0, 1.2], shLR: [-0.2, 0, -1.2] },
  phase: { chest: [-0.5, 0, 0], shUL: [-3.0, 0, 0.5], shUR: [-3.0, 0, -0.5], shLL: [-2.8, 0, 0.9], shLR: [-2.8, 0, -0.9], elbUL: [-0.2, 0, 0], elbUR: [-0.2, 0, 0] },
  broken: { chest: [1.1, 0, 0.15], shUL: [0.3, 0, 1.2], shUR: [0.3, 0, -1.2], shLL: [0.6, 0, 1.0], shLR: [0.6, 0, -1.0], elbUL: [-0.2, 0, 0], elbUR: [-0.2, 0, 0] },
};

/**
 * Иерофант Скорби (GDD §11.1): 9 000 HP, стойка 300, фазы 100–55 % / 55–0 %.
 * Учит уклонению сквозь волны, приоритету целей, слому стойки.
 */
export class Hierophant extends ScriptedEnemy {
  ctrl: HierophantController | null = null;
  private swing = 0;
  private bob = 0;
  dying = false;
  transitioning = 0;
  homeX = 0; homeZ = -2;
  /** Скорость «качания» колокола (звон). */
  private sway = 0;

  patterns: Pattern[] = [
    // Звон: колокол раскачивается 0.9 с → 3 расходящихся кольца с разрывами
    { id: 'toll', weight: 3, cooldown: 4, phases: [1, 2], steps: [
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
    // Кадила: 4 кадила бьют по кругу последовательно, оставляют дым на 3 с
    { id: 'censers', weight: 3, cooldown: 4, phases: [1], range: [0, 9], steps: [], build: () => this.censerSteps() },
    // Проповедь: 4 Аколита по краям; пока живы — щит −70 % урона
    { id: 'sermon', weight: 2, cooldown: 24, phases: [1], steps: [
      { t: 0, do: 'pose', id: 'sermon', blend: 0.5 },
      { t: 0, do: 'telegraphSound', kind: 'chime' },
      { t: 0, do: 'telegraph', shape: { circle: 2.6 }, at: 'self', dur: 1.2, white: true },
      { t: 1.2, do: 'summon', enemy: 'acolyte', count: 4, at: 'edges' },
      { t: 1.2, do: 'sfx', id: 'boss_roar' },
      { t: 1.2, do: 'call', fn: 'sermonLine' },
      { t: 1.6, do: 'pose', id: 'idle', blend: 0.4 },
    ], dur: 2.2 },
    // Падение колокола: тень на земле 1.0 с → падает всем телом в точку игрока; окно 2.0 с (стойка ×2)
    { id: 'drop', weight: 2, cooldown: 7, phases: [1, 2], range: [3, 40], steps: [
      { t: 0, do: 'pose', id: 'rise', blend: 0.25 },
      { t: 0, do: 'telegraph', shape: { circle: 4 }, at: 'snapshot', dur: 1.05 },
      { t: 0, do: 'telegraphSound', kind: 'roar' },
      { t: 0.2, do: 'move', to: 'snapshot', dur: 0.85, arc: 7, ease: 'inOutQuad' },
      { t: 0.95, do: 'pose', id: 'slam', blend: 0.05 },
      { t: 1.05, do: 'hitbox', shape: { circle: 4 }, at: 'self', dmg: 0.3, kb: 9 },
      { t: 1.05, do: 'fx', id: 'impact', at: 'self', r: 4 },
      { t: 1.05, do: 'sfx', id: 'boss_bell' }, { t: 1.05, do: 'shake', trauma: 0.7 },
      { t: 1.08, do: 'ringwave', at: 'self', speed: 8, width: 0.7, maxR: 9, gaps: 3, gapW: 1.3, dmg: 0.1 },
      { t: 1.1, do: 'vulnerable', dur: 2.0, postureMul: 2 },
      { t: 3.0, do: 'pose', id: 'idle', blend: 0.5 },
    ] },
    // Великий Набат: 3 звона подряд с ускорением, последний — с одним разрывом
    { id: 'tocsin', weight: 3, cooldown: 6, phases: [2], steps: [
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
  ];

  constructor(o: SpawnOpts) {
    super(ENEMIES.hierophant, layoutOf(hierophantRig()), o);
    this.isBoss = true;
    this.isGuardian = false;
    this.stationary = true;
    this.approach = 0;
    this.restRange = [0.9, 1.6];
    this.idleT = 999; // ждёт конца интро
  }

  protected poses(): PoseLib { return POSES; }

  override get invulnerable(): boolean { return this.transitioning > 0 || this.dying || this.state === 'spawn' || this.idleT > 100; }
  override get canShatter(): boolean { return !this.dying && this.transitioning <= 0; }

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

  private chainSteps(): Step[] {
    const out: Step[] = [
      { t: 0, do: 'pose', id: 'censers', blend: 0.3 },
      { t: 0, do: 'telegraphSound', kind: 'whistle' },
    ];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
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
    if (fn === 'sermonLine') { w.bus.emit('voice', { line: 'Пока хор поёт — он неуязвим. Глуши хор.', speaker: 'kaelis' }); return; }
    if (fn === 'roll') {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
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
    if (this.phase === 1 && this.hp <= this.maxHp * PHASE2_AT && !this.ctrl?.transitionDone) {
      this.hp = Math.max(this.hp, Math.round(this.maxHp * PHASE2_AT));
      this.ctrl?.startTransition();
    }
  }

  override onLethal(_w: World): boolean {
    if (this.phase === 1) { this.ctrl?.startTransition(); return false; }
    if (this.dying) return true;
    this.ctrl?.startDeath();
    return false;
  }

  override onShattered(w: World): void {
    // Раскол: клинок в колокол, звон глохнет, Иерофант на миг оседает
    w.bus.emit('sfx', { id: 'bell_crack', x: this.x, z: this.z, gain: 0.8 });
  }

  protected override think(w: World, dt: number, tick: boolean): void {
    if (this.transitioning > 0 || this.dying) { this.vx = this.vz = 0; return; }
    // щит Проповеди
    const acolytes = this.summoned.filter((e) => e instanceof Acolyte && !e.dead);
    this.shieldMul = acolytes.length ? 0.3 : 1;
    super.think(w, dt, tick);
    // между атаками дрейфует к «дому» (центр креста)
    if (!this.cur && !this.move) {
      const dx = this.homeX - this.x, dz = this.homeZ - this.z, d = Math.hypot(dx, dz);
      if (d > 0.5) { this.x += (dx / d) * Math.min(d, 1.6 * dt); this.z += (dz / d) * Math.min(d, 1.6 * dt); }
    }
  }

  protected animate(dt: number): void {
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
    if (this.cur?.id === 'censers' || this.cur?.id === 'chains') {
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
    const float = this.state === 'broken' ? -1.6 : Math.sin(this.bob * 1.3) * 0.25;
    s.off[L.idx('body') * 3 + 1] = float;
    s.x = this.x; s.z = this.z; s.y = this.y; s.facing = this.facing;
    s.tiltX = this.puppet.springZ * 0.05; s.tiltZ = -this.puppet.springX * 0.05;
    s.update();
    this.puppet.boost = this.coreGlow + (this.vulnerableT > 0 ? 0.6 : 0) + (this.transitioning > 0 ? 1.5 : 0);
    this.coreGlow = Math.max(0, this.coreGlow - dt);
  }

  /** Позиция колокола (для огня и казни). */
  bellPos(out: THREE.Vector3): THREE.Vector3 { return this.puppet.skel.jointPoint(this.puppet.layout.idx('bell'), 0, 1.4, 0, out); }
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
}

/**
 * Контроллер боя с Иерофантом: появление (летербокс, пролёт камеры, имя «впечатывается»), переход фаз
 * (неуязвимость, замедление, ударная волна, крест-мост над бездной, лечение героя 10 %), смерть.
 */
export class HierophantController implements BossController {
  readonly name = 'ИЕРОФАНТ СКОРБИ';
  phase = 0;
  readonly phaseMarks = [PHASE2_AT];
  zoomMul = 1.12;
  private t = 0;
  private introDone = false;
  transitionDone = false;
  private transT = -1;
  private deathT = -1;
  private lines = 0;
  private cineW = 0;
  private fireT = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private host: BossHost, readonly boss: Hierophant) {
    boss.ctrl = this;
    boss.homeX = boss.x; boss.homeZ = boss.z;
    host.world.hero.locked = true;
    host.letterbox(1);
  }

  step(dt: number): void {
    const w = this.host.world, b = this.boss;
    this.t += dt;
    // интро: 2–4 реплики, пропуск тапом
    if (!this.introDone) {
      if (this.t > 0.3 && this.lines === 0) { this.lines++; this.host.say('Пилот, колокол над нами. Это не служба — это охота.', 'kaelis'); }
      if (this.t > 1.6 && this.lines === 1) { this.lines++; this.host.banner(this.name, 'Звонящий по спасению'); w.bus.emit('sfx', { id: 'boss_intro', x: b.x, z: b.z }); w.bus.emit('shake', { trauma: 0.5 }); }
      if (this.t > 2.9 && this.lines === 2) { this.lines++; this.host.say('Звоню… по спасению… твоему.', 'boss'); }
      if (this.t > 4.4 && this.lines === 3) { this.lines++; this.host.say('Ломай стойку. Колокол — его сердце.', 'kaelis'); }
      if (this.t > 5.6 || (this.t > 0.8 && this.host.skipRequested())) this.finishIntro();
      return;
    }
    // огонь из колокола, дым кадил
    this.fireT -= dt;
    if (this.fireT <= 0 && !b.dead) {
      this.fireT = 0.05;
      b.bellPos(this.tmp);
      this.host.emitFire(this.tmp.x, this.tmp.y, this.tmp.z, false);
      b.censerPos(Math.floor(Math.random() * 4), this.tmp);
      this.host.emitFire(this.tmp.x, this.tmp.y, this.tmp.z, true);
    }
    if (this.transT >= 0) this.stepTransition(dt);
    if (this.deathT >= 0) this.stepDeath(dt);
  }

  private finishIntro(): void {
    this.introDone = true;
    this.phase = 1;
    this.boss.phase = 1;
    this.boss.idleT = 1.0;
    this.host.world.hero.locked = false;
    this.host.letterbox(0);
  }

  startTransition(): void {
    if (this.transitionDone || this.transT >= 0) return;
    const b = this.boss, w = this.host.world;
    this.transT = 0;
    b.transitioning = 3;
    b.cur = null; b.move = null; b.y = 0;
    b.setPose('phase', 0.3);
    for (const e of b.summoned) if (!e.dead) w.killEnemy(e, 0, 1, 3);
    w.projectiles.length = 0;
    w.ringWaves.length = 0;
    for (const t of w.telegraphs) t.alive = false;
    this.host.slow(0.3, 1.0);
    w.bus.emit('shockwave', { x: b.x, z: b.z, r: 14, color: 'hunger', strength: 1.4 });
    w.bus.emit('sfx', { id: 'boss_roar', x: b.x, z: b.z });
    w.bus.emit('shake', { trauma: 0.8 });
    w.bus.emit('bossPhase', { phase: 2 });
  }

  private stepTransition(dt: number): void {
    const b = this.boss, w = this.host.world, h = w.hero;
    const prev = this.transT;
    this.transT += dt;
    b.transitioning = Math.max(0, 3 - this.transT);
    if (prev < 0.6 && this.transT >= 0.6) {
      // колокольня рушится: пол уходит вниз, остаётся крестообразный мост над бездной
      w.arena.collapseOutsideCross();
      w.bus.emit('sfx', { id: 'shatter_big', x: 0, z: 0 });
      this.host.say('Пол уходит! Держись мостов.', 'kaelis');
      this.host.musicPhase(1);
    }
    if (prev < 1.2 && this.transT >= 1.2) {
      // героя отталкивает на мост и лечит на 10 %
      const o = { x: 0, z: 0 };
      const cw = w.arena.def.cross?.w ?? 4;
      const tx = Math.abs(h.x) < Math.abs(h.z) ? 0 : Math.sign(h.x) * Math.min(Math.abs(h.x), 11);
      const tz = Math.abs(h.x) < Math.abs(h.z) ? Math.sign(h.z) * Math.min(Math.abs(h.z), 9) : 0;
      w.arena.nearestWalkable(Math.abs(h.x) <= cw / 2 || Math.abs(h.z) <= cw / 2 ? h.x : tx, Math.abs(h.x) <= cw / 2 || Math.abs(h.z) <= cw / 2 ? h.z : tz, o);
      h.x = o.x; h.z = o.z;
      h.avatar.resetCloth();
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.1);
      h.invulnUntil = h.clock + 1.5;
      b.homeX = 0; b.homeZ = 0;
    }
    if (this.transT >= 3) {
      this.transT = -1;
      this.transitionDone = true;
      this.phase = 2;
      b.phase = 2;
      b.transitioning = 0;
      b.idleT = 0.6;
      b.setPose('idle', 0.4);
      this.zoomMul = 1.25;
    }
  }

  startDeath(): void {
    if (this.deathT >= 0) return;
    const b = this.boss, w = this.host.world;
    this.deathT = 0;
    b.dying = true;
    b.cur = null; b.move = null;
    b.setPose('phase', 0.2);
    this.host.slow(0.2, 1.5);
    this.host.flash(0.55);
    w.projectiles.length = 0; w.ringWaves.length = 0;
    for (const e of w.enemies) if (e !== b && !e.dead) w.killEnemy(e, 0, 1, 3);
    w.bus.emit('sfx', { id: 'posture_break', x: b.x, z: b.z });
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
    }
    this.host.starFlare(clamp((this.deathT - 0.9) / 0.6, 0, 1) * clamp(1 - (this.deathT - 3) / 2, 0, 1));
  }

  cameraTarget(): { x: number; z: number } | null { return this.boss.dead ? null : this.boss; }

  cameraOverride(cam: CameraRig, _camera: THREE.PerspectiveCamera, realDt: number): void {
    // пролёт камеры: сверху над колоколом → в обычный вид
    const target = this.introDone ? 0 : this.t < 2.2 ? 1 : Math.max(0, 1 - (this.t - 2.2) / 2.5);
    this.cineW += (target - this.cineW) * Math.min(1, realDt * 3);
    if (this.cineW < 0.01) { cam.cine = null; return; }
    const b = this.boss;
    const sweep = Ease.inOutSine(clamp(this.t / 5, 0, 1));
    cam.cine = {
      pos: new THREE.Vector3(b.x + Math.sin(sweep * 1.2 - 0.6) * 9, 9 + sweep * 6, b.z + 13 - sweep * 2),
      look: new THREE.Vector3(b.x, 4.2, b.z),
      w: this.cineW,
    };
  }

  hudBoss(): Hierophant | null { return this.introDone && !this.boss.dead ? this.boss : null; }
}
