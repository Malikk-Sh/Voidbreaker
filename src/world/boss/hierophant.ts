import * as THREE from 'three';
import { clamp } from '../../core/math';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { ARMS, hierophantRig } from '../../gen/chars/hierophant';
import { Acolyte } from '../enemies/acolyte';
import { registerEnemy } from '../enemies/factory';
import type { SpawnOpts } from '../enemy';
import { resetStunHabit } from '../actor';
import type { World } from '../world';
import type { CameraRig } from '../camera';
import type { BossController } from './bossBase';
import { ScriptedEnemy, type PoseLib } from './scripted';
import type { Pattern, Step } from './timeline';
import type { CineTrack, MusicCue } from '../../game/director';
import { DESCEND_FROM, hierophantIntroTrack } from './hierophantScenes';

const PHASE2_AT = 0.55;
const _bell = new THREE.Vector3();

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
 * Иерофант Скорби (GDD §11.1): 9 000 HP, оглушение 120 / 3.5 с, фазы 100–55 % / 55–0 %.
 * Учит уклонению сквозь волны, приоритету целей, игре от окон уязвимости.
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
    // Падение колокола: тень на земле 1.0 с → падает всем телом в точку игрока; окно 2.0 с
    { id: 'drop', weight: 2, cooldown: 7, phases: [1, 2], range: [3, 40], unstoppable: true, steps: [
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
    { id: 'tocsin', weight: 3, cooldown: 6, phases: [2], unstoppable: true, steps: [
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
    { id: 'judgment', weight: 3, cooldown: 7, phases: [2], unstoppable: true, steps: [], build: () => this.judgmentSteps() },
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

  private judgmentSteps(): Step[] {
    const out: Step[] = [
      { t: 0, do: 'pose', id: 'phase', blend: 0.35 },
      { t: 0, do: 'telegraphSound', kind: 'bell' },
      { t: 0, do: 'call', fn: 'sway', arg: 1.7 },
    ];
    const cross = (off: number, t0: number) => {
      for (let k = 0; k < 4; k++) {
        const a = off + (k * Math.PI) / 2;
        const to = { x: this.x + Math.sin(a) * 20, z: this.z + Math.cos(a) * 20 };
        out.push({ t: t0, do: 'telegraph', shape: { line: [18, 2.2] }, at: 'self', dir: to, dur: 1.0 });
        out.push({ t: t0 + 1.0, do: 'hitbox', shape: { line: [18, 2.2] }, at: 'self', dir: to, dmg: 0.2, kb: 5 });
      }
      out.push({ t: t0 + 1.0, do: 'pose', id: 'slam', blend: 0.05 });
      out.push({ t: t0 + 1.0, do: 'fx', id: 'shockwave', at: 'self', r: 9 });
      out.push({ t: t0 + 1.0, do: 'sfx', id: 'boss_bell' });
      out.push({ t: t0 + 1.02, do: 'shake', trauma: 0.4 });
      out.push({ t: t0 + 1.12, do: 'pose', id: 'phase', blend: 0.15 });
    };
    cross(Math.PI / 4, 0);
    cross(0, 0.7);
    out.push({ t: 1.9, do: 'pose', id: 'idle', blend: 0.4 });
    out.push({ t: 2.0, do: 'vulnerable', dur: 1.3 });
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
    // интро: ждёт сцену (спускается по цепям), не двигается
    if (this.idleT > 100) { this.vx = this.vz = 0; this.faceTo(w.hero.x, w.hero.z, 0.5, dt); return; }
    this.stationary = this.phase !== 1;
    // щит Проповеди
    const acolytes = this.summoned.filter((e) => e instanceof Acolyte && !e.dead);
    this.shieldMul = acolytes.length ? 0.3 : 1;
    super.think(w, dt, tick);
    // фаза II: между атаками дрейфует к «дому» (центр креста)
    if (this.stationary && !this.cur && !this.move) {
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
    this.puppet.boost = this.coreGlow + (this.vulnerableT > 0 ? 0.6 : 0) + (this.transitioning > 0 ? 1.5 : 0);
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
    // интро 2.0 (план §8.3): босс ждёт под сводом, сцена спускает его по цепям
    b.y = DESCEND_FROM;
    host.scene(hierophantIntroTrack({ hx: h.x, hz: h.z, bx: b.x, bz: b.z }), {
      quiet: () => host.music('silence'),
      runes: () => host.runes(b.x, b.z),
      douse: (k) => host.quench(b.x, b.z, [0, 7, 12.5, 18][k ?? 1]),
      descend: () => { this.chainsOn = true; b.setPose('rise', 0.2); },
      ignite: () => { this.fireOn = true; b.setPose('idle', 0.5); b.coreGlow = 1.5; },
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
      this.host.chains([{ x: b.x + sx, z: b.z + sz, y0: top, len }, { x: b.x - sx, z: b.z - sz, y0: top, len }]);
    }
    if (this.hintT >= 0) {
      this.hintT += dt;
      if (this.hintT > 1.6) { this.hintT = -1; this.host.say('Бей в окна после ударов — оглуши его. Колокол — его сердце.', 'kaelis'); }
    }
    // огонь из колокола, дым кадил
    this.fireT -= dt;
    if (this.fireOn && this.fireT <= 0 && !b.dead) {
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

  startTransition(): void {
    if (this.transitionDone || this.transT >= 0) return;
    const b = this.boss, w = this.host.world;
    this.transT = 0;
    b.transitioning = 3;
    b.cur = null; b.move = null; b.y = 0;
    // новая фаза: оглушение обрывается, привыкание сбрасывается
    if (b.stun) { b.stun.stunned = 0; b.stun.value = 0; b.stun.immune = 0; resetStunHabit(b.stun); }
    b.stunQueued = false; b.awakenQueued = false; b.vulnerableT = 0;
    if (b.state === 'stunned') b.setState('chase');
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
    this.host.banner('НАБАТ', 'Вторая фаза');
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
      this.host.banner('ИЕРОФАНТ ПОВЕРЖЕН', 'Колокол умолк');
    }
    if (this.deathT > 2.4 && this.lines < 5) { this.lines = 5; this.host.say('Колокол умолк. Слышишь тишину, Пилот? Это — наша.', 'kaelis'); }
    this.host.starFlare(clamp((this.deathT - 0.9) / 0.6, 0, 1) * clamp(1 - (this.deathT - 3) / 2, 0, 1));
  }

  cameraTarget(): { x: number; z: number } | null { return this.boss.dead ? null : this.boss; }

  /** Камеру интро ведёт режиссёр (дорожка hierophantIntro). */
  cameraOverride(_cam: CameraRig, _camera: THREE.PerspectiveCamera, _realDt: number): void {}

  hudBoss(): Hierophant | null { return this.introDone && !this.boss.dead ? this.boss : null; }
}
