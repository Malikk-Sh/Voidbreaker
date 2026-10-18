import * as THREE from 'three';
import { fxRng } from '../core/rng';
import { hexToLinear } from '../core/math';
import { GeomBuilder } from '../gen/geom/build';
import { crescent } from '../gen/geom/prims';
import { obsidianMaterial, G } from '../render/materials';
import type { World } from '../world/world';
import type { Abilities } from '../world/abilities';
import { Acolyte } from '../world/enemies/acolyte';
import { Debris } from './debris';
import { LightManager } from './lights';
import { Particles, type ParticleSpec } from './particles';
import { Rings } from './rings';
import { Sprites } from './sprites';
import { TelegraphView } from './telegraphs';
import { RibbonTrail } from './trail';
import { LightPools } from './ambient';
import { StunStars } from './stunStars';
import { FloorRiftsView } from './floorRifts';

const lin = (h: string, k = 1): [number, number, number] => { const c = hexToLinear(h); return [c[0] * k, c[1] * k, c[2] * k]; };
export const C = {
  void: lin('#8B5CF6'), voidHot: lin('#B794FF', 2.2), core: lin('#F1E8FF', 2.5), hunger: lin('#E11D2E'), hungerHot: lin('#FF4A57', 2.4),
  ember: lin('#FF8A3D', 2), gold: lin('#B8954E', 1.5), dust: lin('#3a3150'), dark: lin('#0b0910'), ether: lin('#F4F1FF', 3),
  star: lin('#4aa3c8'), starHot: lin('#9fe4f7', 2.2),
};

const _wp = { x: 0, y: 0, z: 0 };
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/**
 * Все визуальные системы боя (GDD §16): частицы, шлейф клинка, ударные волны, телеграфы, снаряды, подбор,
 * осколки, свет. Рецепты эффектов — методы; sync() переносит состояние мира в рендер каждый кадр.
 */
export class BattleVfx {
  readonly group = new THREE.Group();
  readonly add: Particles;
  readonly norm: Particles;
  readonly trail = new RibbonTrail('#8B5CF6', '#F1E8FF');
  readonly rings = new Rings(28);
  readonly tele = new TelegraphView(48);
  readonly sprites = new Sprites(700, true);
  readonly debris = new Debris(240);
  readonly lights = new LightManager();
  readonly pools: LightPools;
  /** Звёзды оглушения над головами (план §5.5). */
  readonly stars = new StunStars();
  /** Разломы на полу (план §6.2). */
  readonly rifts = new FloorRiftsView();
  /** Ступень ранга (план §6.6): 0 — ниже A, 1 — A, 2 — S, 3 — SS. Только визуал, без бонуса к урону. */
  rankTier = 0;
  /** Фиолетовые отпечатки шагов на ранге S+. */
  private steps: { x: number; z: number; t: number }[] = [];
  private stepAcc = 0; private stepSide = 1; private lastHX = 0; private lastHZ = 0;
  /** Камера рендера: звёзды разворачиваются к ней. */
  camera: THREE.Camera | null = null;
  private sickleMeshes: THREE.Mesh[] = [];
  private wellMeshes: THREE.Mesh[] = [];
  private ambientT = 0;
  /** Пыль/искры атмосферы зоны (слой 7, GDD §17.5). */
  atmosphere: 'dust' | 'embers' | 'none' = 'dust';
  quality = 1;

  constructor(maxParticles: number, pools: LightPools) {
    this.add = new Particles(maxParticles, true);
    this.norm = new Particles(Math.round(maxParticles * 0.35), false);
    this.pools = pools;
    this.group.add(this.add.mesh, this.norm.mesh, this.trail.mesh, this.trail.smearMesh, this.rings.group, this.tele.group, this.sprites.mesh, this.stars.mesh, this.rifts.group);
    for (const m of this.debris.meshes) this.group.add(m);
    // серпы: выдавленный полумесяц с эмиссивной кромкой
    const b = new GeomBuilder();
    b.color = [0.02, 0.015, 0.03];
    b.add(crescent(0.55, 0.22, 2.6, 0.05), { emissive: 0.6 });
    b.add(crescent(0.57, 0.06, 2.4, 0.07), { emissive: 1.8 });
    const sg = b.build();
    const sm = obsidianMaterial({ rim: '#B794FF', rimStrength: 1.0, emissive: '#9b6cff', emissiveStrength: 2.6 });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(sg, sm);
      m.visible = false; m.frustumCulled = false;
      this.sickleMeshes.push(m); this.group.add(m);
    }
    // колодец: чёрное ядро + кольцо аккреции (шейдер)
    const wm = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uK: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uK; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float rim = pow(f, 2.5);
          vec3 col = vec3(0.004, 0.0, 0.01) + vec3(0.55, 0.3, 1.0) * rim * (2.5 + uK * 3.0) + vec3(1.0) * pow(f, 8.0) * 2.0;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const wg = new THREE.IcosahedronGeometry(0.75, 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(wg, wm.clone());
      m.visible = false;
      this.wellMeshes.push(m); this.group.add(m);
    }
  }

  // ------------------------------------------------------------------ рецепты
  burst(n: number, base: ParticleSpec, spread: { v: number; vy?: number; dir?: [number, number]; cone?: number }, additive = true): void {
    const sys = additive ? this.add : this.norm;
    const count = Math.round(n * this.quality);
    for (let i = 0; i < count; i++) {
      let a = fxRng.range(0, Math.PI * 2);
      if (spread.dir) a = Math.atan2(spread.dir[0], spread.dir[1]) + fxRng.spread(spread.cone ?? 0.8);
      const sp = spread.v * fxRng.range(0.35, 1);
      sys.emit({ ...base, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, vy: (spread.vy ?? 0) * fxRng.range(0.3, 1.2), life: base.life * fxRng.range(0.6, 1.2), size: base.size * fxRng.range(0.6, 1.3) });
    }
  }

  /**
   * Попадание: фиолетовые искры от клинка, красные искры и обсидиановые осколки от врага (GDD §14.4).
   * tx, tz — касательная к дуге взмаха (ход кончика клинка): основная часть искр летит узким конусом по ней (план §5.8).
   */
  hitSparks(x: number, y: number, z: number, dx: number, dz: number, heavy: number, crit: boolean, tx = dx, tz = dz): void {
    // ранг A+: искры гуще
    const dense = this.rankTier >= 1 ? 1.6 : 1;
    this.burst((5 + heavy * 6) * dense, { x, y, z, life: 0.3, size: 0.09, size1: 0.02, color: C.voidHot, gravity: -6, drag: 4, frame: 'spark', stretch: 1.5 }, { v: 11, vy: 2.5, dir: [tx, tz], cone: 0.35 });
    this.burst(2 + heavy * 2, { x, y, z, life: 0.25, size: 0.08, size1: 0.02, color: C.voidHot, gravity: -6, drag: 4, frame: 'spark', stretch: 1.2 }, { v: 7, vy: 4, dir: [dx, dz], cone: 0.9 });
    this.burst(4 + heavy * 4, { x, y, z, life: 0.35, size: 0.08, size1: 0.01, color: C.hungerHot, gravity: -10, drag: 3, frame: 'spark', stretch: 1 }, { v: 7, vy: 5, dir: [dx, dz], cone: 1.6 });
    this.add.emit({ x, y, z, life: 0.12, size: 0.9 + heavy * 0.5, size1: 1.6 + heavy, color: crit ? C.core : C.voidHot, alpha: 0.9, frame: 'flare', rot: fxRng.next() * 3 });
    if (heavy > 0.5 || crit) this.add.emit({ x, y, z, life: 0.2, size: 0.4, size1: 2.6, color: C.void, alpha: 0.6, frame: 'ring' });
    this.debris.burst(x, y, z, dx, dz, Math.round((2 + heavy * 4) * this.quality), 4 + heavy * 2, 0.16);
  }

  /** Смерть = распад: осколки, багровый выдох, облачко пыли. */
  shatter(x: number, y: number, z: number, dx: number, dz: number, big: number): void {
    this.debris.burst(x, y, z, dx, dz, Math.round((8 + big * 10) * this.quality), 5 + big * 2, 0.2 + big * 0.12);
    this.burst(14 + big * 16, { x, y, z, life: 0.6, size: 0.12, size1: 0.02, color: C.hungerHot, gravity: -6, drag: 2.5, frame: 'spark', stretch: 0.8 }, { v: 7 + big * 3, vy: 6 });
    this.burst(6 + big * 6, { x, y: 0.4, z, life: 1.1, size: 0.6 + big * 0.5, size1: 1.4 + big, color: C.dust, alpha: 0.5, drag: 3, frame: 'smoke' }, { v: 2.5, vy: 0.8 }, false);
    this.add.emit({ x, y, z, life: 0.25, size: 1.2 + big, size1: 2.5 + big * 2, color: C.hungerHot, alpha: 0.7, frame: 'dot' });
    this.lights.flash(x, 1.2, z, C.hunger, 4 + big * 3, 6 + big * 4, 0.35);
  }

  /** Удар о землю: ударная волна + пылевое кольцо + осколки. */
  impact(x: number, z: number, r: number, color: [number, number, number], strength = 1): void {
    this.rings.spawn(x, z, 0.3, r * 1.15, 0.35, [color[0] * 2.5, color[1] * 2.5, color[2] * 2.5], 0.3 * strength, 1);
    this.rings.spawn(x, z, 0.2, r * 0.8, 0.5, [color[0], color[1], color[2]], 0.6, 0.6);
    const n = Math.round(18 * strength);
    for (let i = 0; i < n * this.quality; i++) {
      const a = (i / n) * Math.PI * 2 + fxRng.spread(0.2);
      this.norm.emit({ x: x + Math.sin(a) * r * 0.3, y: 0.2, z: z + Math.cos(a) * r * 0.3, vx: Math.sin(a) * r * 2.2, vz: Math.cos(a) * r * 2.2, vy: fxRng.range(0.3, 1.5), life: 0.8, size: 0.5, size1: 1.3, color: C.dust, alpha: 0.55, drag: 3.5, frame: 'smoke' });
    }
    this.burst(10 * strength, { x, y: 0.2, z, life: 0.5, size: 0.08, size1: 0.02, color, gravity: -12, drag: 1.5, frame: 'spark', stretch: 1 }, { v: r * 2.5, vy: 6 });
    this.debris.burst(x, 0.2, z, 0, 0, Math.round(6 * strength * this.quality), 4, 0.18);
    this.lights.flash(x, 1, z, color, 3 * strength, r * 2.5, 0.3);
  }

  /** Портал спавна (0.8 с красный разлом). */
  portal(x: number, z: number): void {
    this.rings.spawn(x, z, 1.6, 0.2, 0.8, C.hungerHot, 0.12, 1.2);
    for (let i = 0; i < 14 * this.quality; i++) {
      const a = fxRng.range(0, Math.PI * 2), r = fxRng.range(1.0, 1.8);
      this.add.emit({ x: x + Math.sin(a) * r, y: fxRng.range(0.1, 1.2), z: z + Math.cos(a) * r, vx: -Math.sin(a) * r * 1.6, vz: -Math.cos(a) * r * 1.6, vy: fxRng.range(0.5, 2), life: 0.7, size: 0.07, size1: 0.02, color: C.hungerHot, drag: 0.5, frame: 'spark', stretch: 1, delay: fxRng.range(0, 0.3) });
    }
    this.add.emit({ x, y: 0.1, z, life: 0.9, size: 0.6, size1: 2.2, color: C.hunger, alpha: 0.8, frame: 'ring' });
  }

  dashPuff(x: number, z: number, dx: number, dz: number): void {
    this.rings.spawn(x, z, 0.2, 1.4, 0.3, C.voidHot, 0.12, 0.8);
    this.burst(8, { x, y: 0.15, z, life: 0.45, size: 0.35, size1: 0.9, color: C.dust, alpha: 0.5, drag: 4, frame: 'smoke' }, { v: 3, vy: 0.5, dir: [-dx, -dz], cone: 1.2 }, false);
    this.burst(10, { x, y: 1.0, z, life: 0.3, size: 0.06, size1: 0.01, color: C.voidHot, drag: 3, frame: 'spark', stretch: 1 }, { v: 6, vy: 1, dir: [-dx, -dz], cone: 0.8 });
  }

  /** Взмах врага: дуга багровых искр (серпы, когти, алебарда). */
  enemySlash(x: number, z: number, dir: number, r: number, full = false): void {
    const n = Math.round((full ? 26 : 14) * this.quality) + 4;
    const span = full ? Math.PI * 2 : 2.0;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      const a = dir - span / 2 + span * f;
      const rr = r * fxRng.range(0.75, 1.0);
      this.add.emit({ x: x + Math.sin(a) * rr, y: 0.8 + fxRng.spread(0.25), z: z + Math.cos(a) * rr, vx: Math.cos(a) * 3, vz: -Math.sin(a) * 3, life: 0.22, size: 0.2, size1: 0.03, color: f > 0.3 && f < 0.7 ? C.hungerHot : C.ember, frame: 'spark', stretch: 1.2 });
    }
  }

  private lobs: { fx: number; fz: number; tx: number; tz: number; t: number; dur: number; size: number }[] = [];
  /** Навесной снаряд (камень): дуга, вращение, шлейф пыли и угольков. */
  lob(fx: number, fz: number, tx: number, tz: number, dur: number, size: number): void { this.lobs.push({ fx, fz, tx, tz, t: 0, dur, size }); }

  /** Идеальное уклонение — только лёгкий эффект: тонкое кольцо и россыпь звёздной пыли. */
  /**
   * Идеальное уклонение (план §5.4): силуэт на старом месте раскалывается фиолетовыми осколками;
   * в «Мгновение Пустоты» ещё и красная атака рассыпается фиолетовым вокруг героя.
   */
  perfectDodge(x: number, z: number, heavy = false, sx = x, sz = z): void {
    // силуэт: вертикальный столб осколков по росту героя
    for (let i = 0; i < 18 * this.quality; i++) {
      const y = fxRng.range(0.1, 1.9), a = fxRng.range(0, Math.PI * 2), v = fxRng.range(1.5, 4);
      this.add.emit({ x: sx + fxRng.spread(0.25), y, z: sz + fxRng.spread(0.25), vx: Math.sin(a) * v, vz: Math.cos(a) * v, vy: fxRng.range(-0.5, 2), life: 0.55, size: 0.09, size1: 0.02, color: C.voidHot, gravity: -6, drag: 2, frame: 'spark', stretch: 1.1 });
    }
    this.debris.burst(sx, 1, sz, 0, 0, Math.round(6 * this.quality), 3, 0.12);
    this.rings.spawn(x, z, 0.3, heavy ? 4 : 2.6, heavy ? 0.5 : 0.35, C.voidHot, 0.1, heavy ? 0.9 : 0.6);
    this.burst(heavy ? 26 : 12, { x, y: 1, z, life: heavy ? 0.8 : 0.5, size: heavy ? 0.1 : 0.06, size1: 0.01, color: heavy ? C.voidHot : C.core, drag: 2.5, frame: 'star', gravity: 0.5 }, { v: heavy ? 5 : 3.5, vy: 1.5 });
    this.lights.flash(x, 1.4, z, C.void, heavy ? 6 : 3, heavy ? 8 : 5, heavy ? 0.5 : 0.3);
  }

  /** Раскол: взрыв обсидиановых осколков и светящихся трещин. */
  shatterBurst(x: number, y: number, z: number, big: boolean): void {
    const k = big ? 1.5 : 1;
    this.rings.spawn(x, z, 0.4, 4.2 * k, 0.45, C.core, 0.22, 1.2);
    this.rings.spawn(x, z, 0.3, 3.2 * k, 0.35, C.gold, 0.3, 0.9);
    this.add.emit({ x, y, z, life: 0.25, size: 1.2 * k, size1: 3.2 * k, color: C.core, alpha: 0.9, frame: 'flare' });
    this.burst(Math.round(22 * k), { x, y, z, life: 0.55, size: 0.12, size1: 0.03, color: C.core, gravity: -10, drag: 1.5, frame: 'spark', stretch: 1.6 }, { v: 13, vy: 6 });
    this.burst(Math.round(14 * k), { x, y, z, life: 0.9, size: 0.16, size1: 0.05, color: C.gold, gravity: -14, drag: 1, frame: 'star' }, { v: 7, vy: 7 });
    this.lights.flash(x, y, z, [1, 0.92, 0.8], 7, 8, 0.35);
  }

  /** Оглушение: золотисто-белая вспышка, кольцо и звёздные искры (свет вырывается из твари). */
  stunBurst(x: number, y: number, z: number, big: boolean): void {
    const k = big ? 1.4 : 1;
    this.rings.spawn(x, z, 0.5, 4.5 * k, 0.5, C.core, 0.2, 1.2);
    this.rings.spawn(x, z, 0.3, 3 * k, 0.4, C.gold, 0.25, 0.9);
    this.add.emit({ x, y, z, life: 0.3, size: 1.4 * k, size1: 3.6 * k, color: C.core, alpha: 0.85, frame: 'flare' });
    this.burst(Math.round(18 * k), { x, y, z, life: 0.7, size: 0.13, size1: 0.03, color: C.gold, gravity: -4, drag: 2, frame: 'star' }, { v: 7, vy: 5 });
    this.burst(Math.round(16 * k), { x, y, z, life: 0.45, size: 0.09, size1: 0.02, color: C.core, gravity: -8, drag: 2, frame: 'spark', stretch: 1.4 }, { v: 11, vy: 4 });
    this.lights.flash(x, y, z, [1, 0.88, 0.62], 6, 7, 0.4);
  }

  /** Раскол 2.0: разрез — длинный бело-фиолетовый смазанный след по линии (висит, пока мир стоит). */
  shatterCut(x: number, z: number, dx: number, dz: number, len: number): void {
    const n = Math.round(26 * this.quality) + 8;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1), d = -1 + f * (len + 1);
      this.add.emit({ x: x + dx * d, y: 1.1 + Math.sin(f * Math.PI) * 0.4, z: z + dz * d, vx: dx * 2, vz: dz * 2, life: 0.35, size: 0.55 * (1 - Math.abs(f - 0.3)), size1: 0.05, color: f < 0.5 ? C.core : C.voidHot, frame: 'spark', stretch: 2.5 });
    }
    this.add.emit({ x, y: 1.2, z, life: 0.2, size: 1.6, size1: 3.2, color: C.core, alpha: 0.9, frame: 'flare' });
    this.lights.flash(x + dx * len * 0.4, 1.2, z + dz * len * 0.4, [1, 0.92, 1], 3.5, 7, 0.3);
  }

  /** Раскол 2.0: разлёт — осколки и искры по всей линии разреза. */
  shatterLine(x: number, z: number, dx: number, dz: number, len: number): void {
    const n = Math.max(3, Math.round(len));
    for (let k = 1; k <= n; k++) {
      const d = (k / n) * len, px = x + dx * d, pz = z + dz * d;
      this.debris.burst(px, 0.6, pz, dx, dz, Math.round(3 * this.quality) + 1, 6, 0.16);
      this.burst(4, { x: px, y: 0.7, z: pz, life: 0.5, size: 0.1, size1: 0.02, color: C.voidHot, gravity: -10, drag: 1.5, frame: 'spark', stretch: 1.2 }, { v: 6, vy: 5, dir: [dx, dz], cone: 1.2 });
    }
    this.rings.spawn(x + dx * len * 0.5, z + dz * len * 0.5, 0.4, len * 0.6, 0.35, C.voidHot, 0.2, 1);
  }

  /** Детонация меток Пустоты: салют фиолетовых трещин от цели, сильнее за каждую стопку. */
  detonate(x: number, y: number, z: number, stacks: number): void {
    const k = 0.6 + stacks * 0.2;
    this.burst(Math.round(6 + stacks * 4), { x, y, z, life: 0.35, size: 0.11, size1: 0.02, color: C.voidHot, gravity: -4, drag: 3, frame: 'spark', stretch: 1.8 }, { v: 9 * k, vy: 3 });
    this.add.emit({ x, y, z, life: 0.18, size: 0.6 * k, size1: 1.8 * k, color: C.core, alpha: 0.8, frame: 'flare', rot: fxRng.next() * 3 });
    this.rings.spawn(x, z, 0.3, 1.6 * k, 0.3, C.voidHot, 0.12, 0.8);
  }

  /** Погасла звезда оглушения: маленькая вспышка там, где она кружила. */
  starOut(x: number, y: number, z: number): void {
    this.add.emit({ x, y, z, life: 0.22, size: 0.5, size1: 1.1, color: C.core, alpha: 0.8, frame: 'flare' });
    this.burst(5, { x, y, z, life: 0.35, size: 0.06, size1: 0.01, color: C.gold, gravity: -6, drag: 2, frame: 'spark' }, { v: 2.5, vy: 1 });
  }

  chargeGather(bx: number, by: number, bz: number, level: number): void {
    for (let i = 0; i < 2 + level * 2; i++) {
      const a = fxRng.range(0, Math.PI * 2), r = fxRng.range(0.8, 1.6), up = fxRng.spread(0.8);
      this.add.emit({ x: bx + Math.sin(a) * r, y: by + up, z: bz + Math.cos(a) * r, vx: -Math.sin(a) * r * 3, vy: -up * 3, vz: -Math.cos(a) * r * 3, life: 0.3, size: 0.06, size1: 0.02, color: level >= 2 ? C.core : C.voidHot, drag: 0, frame: 'spark', stretch: 1 });
    }
  }

  // ------------------------------------------------------------------ синхронизация мира
  sync(w: World, dtReal: number, dtW: number): void {
    // телеграфы
    this.tele.sync(w.telegraphs, w.ringWaves);
    this.sprites.begin();
    this.lights.begin();
    this.pools.beginDynamic();
    const h = w.hero;

    // свет клинка героя
    if (!h.dead) {
      h.avatar.bladePoints(_v, _w);
      // заряд удара или способности: фиолетовый свет у клинка нарастает — блики на броне, полу, колоннах
      const charging = h.state === 'charge' ? 0.5 + Math.min(1, h.stateT / 0.9) * 1.3 : h.state === 'cast' ? 1.4 : 0;
      const glow = 0.3 + (h.trailOn ? 1.0 : 0) + (h.eclipse ? 2 : 0) + h.chargeLevel * 0.8 + charging;
      this.lights.add((_v.x + _w.x) / 2, (_v.y + _w.y) / 2 + 0.3, (_v.z + _w.z) / 2, C.void, glow * 1.6, 4 + (h.eclipse ? 3 : 0));
      this.pools.addDynamic(h.x, h.z, 2.4 + (h.eclipse ? 1.5 : 0), C.void, 0.1 + glow * 0.08);
      if (h.eclipse) {
        if (fxRng.chance(0.6)) this.add.emit({ x: h.x + fxRng.spread(0.6), y: fxRng.range(0, 1.8), z: h.z + fxRng.spread(0.6), vy: 2.5, life: 0.7, size: 0.1, size1: 0.02, color: C.voidHot, drag: 1, frame: 'star' });
      }
      if (h.state === 'charge') this.chargeGather(_w.x, _w.y, _w.z, h.chargeLevel);
      // ранг S: фиолетовые отпечатки шагов; SS: лёгкая аура
      const moved = Math.hypot(h.x - this.lastHX, h.z - this.lastHZ);
      this.lastHX = h.x; this.lastHZ = h.z;
      if (this.rankTier >= 2 && h.state === 'move' && moved < 1) {
        this.stepAcc += moved;
        if (this.stepAcc > 0.75) {
          this.stepAcc = 0; this.stepSide = -this.stepSide;
          const sx = Math.cos(h.facing) * 0.14 * this.stepSide, sz = -Math.sin(h.facing) * 0.14 * this.stepSide;
          this.steps.push({ x: h.x + sx, z: h.z + sz, t: 0 });
          if (this.steps.length > 16) this.steps.shift();
        }
      }
      if (this.rankTier >= 3 && fxRng.chance(0.5 * this.quality)) {
        const a = fxRng.range(0, Math.PI * 2);
        this.add.emit({ x: h.x + Math.sin(a) * 0.5, y: fxRng.range(0.1, 1.6), z: h.z + Math.cos(a) * 0.5, vy: 1.2, life: 0.6, size: 0.07, size1: 0.01, color: C.voidHot, drag: 1, frame: 'dot' });
      }
      if (this.rankTier >= 3) this.pools.addDynamic(h.x, h.z, 1.6, C.void, 0.25);
      // украденный импульс: фиолетовые осколки кружат вокруг Пилота
      for (const st of w.stolen) {
        const k = st.t > 1.6 ? 0.5 + 0.5 * Math.sin(st.t * 30) : 1;
        const x = h.x + Math.sin(st.a) * 0.9, z = h.z + Math.cos(st.a) * 0.9, y = 1.25 + Math.sin(st.t * 6) * 0.12;
        this.sprites.add(x, y, z, 0.42 * k, C.voidHot[0], C.voidHot[1], C.voidHot[2], 1, 'star', st.t * 6);
        this.sprites.add(x, y, z, 0.18 * k, 2.4, 2.2, 2.6, 1, 'dot');
        if (fxRng.chance(0.6)) this.add.emit({ x, y, z, life: 0.2, size: 0.12, size1: 0.01, color: C.voidHot, frame: 'dot' });
      }
      if (w.stolen.length) this.lights.add(h.x, 1.3, h.z, C.void, 1 + w.stolen.length * 0.5, 4);
    }

    // босс готовит красную атаку: ближние источники света слегка багровеют
    let tintK = 0, tx = 0, tz = 0;
    for (const e of w.enemies) {
      if (e.dead || !(e.isBoss || e.isGuardian)) continue;
      const k = e.windup * 0.45;
      if (k > tintK) { tintK = k; tx = e.x; tz = e.z; }
    }
    this.pools.tintNear(tx, tz, 14, C.hunger, tintK);

    for (const st of this.steps) {
      st.t += dtW;
      this.pools.addDynamic(st.x, st.z, 0.32, C.voidHot, 0.55 * Math.max(0, 1 - st.t / 1.4));
    }
    this.steps = this.steps.filter((st) => st.t < 1.4);

    // враги: ядра при телеграфе, аура элиты, щиты Аколита
    for (const e of w.enemies) {
      if (e.dead) continue;
      const y = e.height * 0.55;
      if (e.coreGlow > 0.25) {
        this.lights.add(e.x, y, e.z, C.hunger, e.coreGlow * 2.5, 4);
        this.pools.addDynamic(e.x, e.z, 1.6 + e.radius, C.hunger, e.coreGlow * 0.5);
      }
      // замах: искры стягиваются к оружию/ядру, к концу — быстрее и ярче; у тяжёлых — сходящееся кольцо на полу
      const wu = e.windup;
      if (wu > 0) {
        e.windupPoint(_wp);
        const n = (1 + Math.floor(wu * 3)) * this.quality;
        for (let k = 0; k < n; k++) {
          if (!fxRng.chance(0.75)) continue;
          const a = fxRng.range(0, Math.PI * 2), el = fxRng.range(-0.6, 0.9), r = (0.9 + e.radius) * fxRng.range(0.8, 1.4);
          const ox = Math.cos(el) * Math.sin(a) * r, oy = Math.sin(el) * r, oz = Math.cos(el) * Math.cos(a) * r;
          const life = 0.22 + (1 - wu) * 0.12;
          this.add.emit({ x: _wp.x + ox, y: _wp.y + oy, z: _wp.z + oz, vx: -ox / life, vy: -oy / life, vz: -oz / life, life, size: 0.07 + wu * 0.05, size1: 0.015, color: wu > 0.8 ? C.hungerHot : C.ember, drag: 0, frame: 'spark', stretch: 1 });
        }
        this.sprites.add(_wp.x, _wp.y, _wp.z, 0.25 + wu * 0.6, C.hungerHot[0], C.hungerHot[1], C.hungerHot[2], 0.35 + wu * 0.6, 'dot');
        if (e.heavyWindup && fxRng.chance(dtReal * 7)) this.rings.spawn(e.x, e.z, e.radius + 3.2, e.radius * 0.6, 0.35, C.hungerHot, 0.12, 0.5 + wu * 0.4);
      }
      if (e.elite.length && fxRng.chance(0.35 * this.quality)) {
        const a = fxRng.range(0, Math.PI * 2);
        this.add.emit({ x: e.x + Math.sin(a) * e.radius, y: 0.1, z: e.z + Math.cos(a) * e.radius, vy: 2.4, life: 0.8, size: 0.14, size1: 0.03, color: C.hungerHot, frame: 'dot', drag: 0.5 });
      }
      if (e.elite.length) this.pools.addDynamic(e.x, e.z, e.radius + 1.6, C.hunger, 0.35);
      else if (e.spawned) this.pools.addDynamic(e.x, e.z, e.radius + 0.9, C.hunger, 0.1);
      if (e.shieldMul < 1) this.sprites.add(e.x, y, e.z, e.radius * 1.6 + 0.4, C.hunger[0] * 0.8, C.hunger[1] * 0.8, C.hunger[2] * 0.8, 0.55 + Math.sin(w.time * 8) * 0.15, 'ring', w.time);
      if (e instanceof Acolyte) {
        const t = e.beamTarget;
        const links = t ? [t] : e.shielding;
        for (const tg of links) {
          const n = 8;
          for (let k = 1; k < n; k++) {
            const f = k / n;
            const jx = fxRng.spread(0.15), jz = fxRng.spread(0.15);
            this.sprites.add(e.x + (tg.x - e.x) * f + jx, 1.6 + Math.sin(f * Math.PI) * 0.6, e.z + (tg.z - e.z) * f + jz, t ? 0.18 : 0.12, C.hungerHot[0], C.hungerHot[1], C.hungerHot[2], t ? 0.8 : 0.45, 'dot');
          }
        }
      }
    }

    // Раскол 2.0: до удара по линии будущего разреза бегут бело-фиолетовые трещины
    const sq = w.shatterSeq;
    if (sq && !sq.cutDone) {
      const L = sq.line;
      if (L.k === 'line') {
        const f = Math.min(1, sq.t / Math.max(0.01, sq.cut));
        for (let k = 0; k < 3; k++) {
          const d = fxRng.next() * L.len * f, side = fxRng.spread(0.35);
          this.add.emit({ x: L.x + L.dx * d - L.dz * side, y: 0.08, z: L.z + L.dz * d + L.dx * side, life: 0.5, size: 0.16, size1: 0.04, color: fxRng.chance(0.5) ? C.core : C.voidHot, frame: 'spark', stretch: 2, vx: L.dx * 0.5, vz: L.dz * 0.5 });
        }
      }
    }

    // звёзды оглушения: инстансы над головами + тонкий шлейф искр
    if (this.camera) this.stars.sync(w, this.camera, w.time);
    for (const p of this.stars.pos) {
      if (!fxRng.chance(0.35 * this.quality)) continue;
      this.add.emit({ x: p.x, y: p.y, z: p.z, vy: -0.2, life: 0.3, size: p.size * 0.35, size1: 0.01, color: C.gold, drag: 1, frame: 'dot' });
    }

    // навесные броски
    for (const l of this.lobs) {
      l.t += dtW;
      const u = Math.min(1, l.t / l.dur);
      const x = l.fx + (l.tx - l.fx) * u, z = l.fz + (l.tz - l.fz) * u, y = 2.4 + Math.sin(u * Math.PI) * 4.5 - u * 2.2;
      this.sprites.add(x, y, z, 0.9 * l.size, C.ember[0] * 0.5, C.ember[1] * 0.4, C.ember[2] * 0.4, 0.9, 'dot');
      this.sprites.add(x, y, z, 0.45 * l.size, 1.6, 1.0, 0.6, 1, 'dot');
      if (fxRng.chance(0.9 * this.quality)) this.norm.emit({ x, y, z, vy: 0.3, life: 0.7, size: 0.3 * l.size, size1: 0.8 * l.size, color: C.dust, alpha: 0.5, drag: 1, frame: 'smoke' });
      if (fxRng.chance(0.8)) this.add.emit({ x, y, z, vx: fxRng.spread(1), vy: fxRng.spread(1), vz: fxRng.spread(1), life: 0.35, size: 0.08, size1: 0.01, color: C.ember, frame: 'spark' });
      this.lights.add(x, y, z, C.ember, 1.2, 3);
    }
    this.lobs = this.lobs.filter((l) => l.t < l.dur);

    // лучи Ока: багровая жила с белым ядром вдоль линии
    for (const e of w.enemies) {
      const b = (e as { beam?: { x: number; z: number; dx: number; dz: number; len: number; on: boolean } }).beam;
      if (!b || !b.on || e.dead) continue;
      const n = Math.round(18 * this.quality) + 6;
      for (let k = 0; k < n; k++) {
        const f = fxRng.next();
        const px = b.x + b.dx * b.len * f, pz = b.z + b.dz * b.len * f;
        this.add.emit({ x: px + fxRng.spread(0.1), y: 1.7 - f * 0.9, z: pz + fxRng.spread(0.1), vy: fxRng.spread(0.6), life: 0.12, size: 0.35, size1: 0.1, color: C.hungerHot, frame: 'dot' });
      }
      for (let k = 0; k <= 10; k++) {
        const f = k / 10;
        this.sprites.add(b.x + b.dx * b.len * f, 1.7 - f * 0.9, b.z + b.dz * b.len * f, 0.22, 2.4, 1.8, 1.8, 1, 'dot');
      }
      this.lights.add(b.x + b.dx * b.len * 0.5, 1.2, b.z + b.dz * b.len * 0.5, C.hunger, 3, 6);
    }

    // снаряды: ядро + ореол + хвост
    for (const p of w.projectiles) {
      const big = p.kind === 'acolyteOrb' ? 1.3 : p.kind === 'censerBall' ? 2.8 : p.kind === 'stone' ? 1.5 : 1;
      const col = p.reflected ? C.voidHot : p.kind === 'censerBall' || p.kind === 'stone' ? C.ember : C.hungerHot;
      if (p.kind === 'censerBall' && fxRng.chance(0.7)) this.norm.emit({ x: p.x, y: 0.6, z: p.z, vy: 1.5, life: 1.2, size: 0.5, size1: 1.4, color: [0.05, 0.035, 0.05], alpha: 0.5, drag: 1, frame: 'smoke' });
      this.sprites.add(p.x, p.y, p.z, 0.55 * big, col[0], col[1], col[2], 0.9, 'dot');
      this.sprites.add(p.x, p.y, p.z, 0.22 * big, 2.5, 2.2, 2.2, 1, 'dot');
      if (fxRng.chance(0.8 * this.quality)) this.add.emit({ x: p.x, y: p.y, z: p.z, vx: -p.vx * 0.1, vz: -p.vz * 0.1, life: 0.25, size: 0.25 * big, size1: 0.02, color: col, frame: 'dot' });
      this.pools.addDynamic(p.x, p.z, 1.3, p.reflected ? C.void : C.hunger, 0.5);
      this.lights.add(p.x, p.y, p.z, p.reflected ? C.void : C.hunger, 1.0, 3);
    }

    // подбор: Осколки — звёздно-голубые кристаллы (как в интерфейсе), Эфир — белое пламя
    for (const p of w.pickups) {
      const bob = Math.sin(p.age * 6) * 0.08;
      if (p.kind === 'shard') {
        this.sprites.add(p.x, p.y + bob, p.z, 0.32, C.starHot[0], C.starHot[1], C.starHot[2], 1, 'star', p.age * 2);
        this.sprites.add(p.x, p.y + bob, p.z, 0.6, C.star[0], C.star[1], C.star[2], 0.5, 'dot');
      } else if (p.kind === 'ether') {
        this.sprites.add(p.x, p.y + bob + 0.2, p.z, 0.4, C.ether[0], C.ether[1], C.ether[2], 1, 'dot', 0, 1.8);
        this.lights.add(p.x, p.y + 0.5, p.z, [1, 1, 1], 2, 3);
      } else {
        this.sprites.add(p.x, p.y + bob, p.z, 0.45, 2.4, 0.4, 0.6, 1, 'star', p.age);
      }
    }

    // зоны: трещины Силы, след рывка
    for (const hz of w.hazards) {
      if (hz.shape.k === 'line' && fxRng.chance(0.7 * this.quality)) {
        const f = fxRng.next();
        const s = hz.shape;
        this.add.emit({ x: s.x + s.dx * s.len * f + fxRng.spread(0.2), y: 0.1, z: s.z + s.dz * s.len * f + fxRng.spread(0.2), vy: 1.5, life: 0.4, size: 0.12, size1: 0.02, color: hz.hostile ? C.hungerHot : C.voidHot, frame: 'spark', stretch: 0.6 });
      }
    }

    // способности: серпы, колодцы, волны, фазовый разрез, трещины на полу
    const ab = w.abilities as Abilities;
    this.rifts.sync(ab.floorRifts);
    for (const r of ab.floorRifts) {
      if (!fxRng.chance(0.5 * this.quality)) continue;
      const d = fxRng.next() * r.len;
      this.add.emit({ x: r.x + r.dx * d, y: 0.1, z: r.z + r.dz * d, vy: 1.2, life: 0.4, size: 0.08, size1: 0.01, color: C.voidHot, frame: 'spark', stretch: 0.6 });
    }
    this.sickleMeshes.forEach((m, i) => {
      const s = ab.sickles[i];
      m.visible = !!s;
      if (!s) return;
      m.position.set(s.x, 1.1, s.z);
      m.rotation.set(-Math.PI / 2, 0, s.rot);
      this.add.emit({ x: s.x, y: 1.1, z: s.z, life: 0.2, size: 0.4, size1: 0.05, color: C.voidHot, frame: 'dot' });
      this.lights.add(s.x, 1.2, s.z, C.void, 2.5, 4);
    });
    this.wellMeshes.forEach((m, i) => {
      const wl = ab.wells[i];
      m.visible = !!wl && !wl.exploded;
      if (!wl) return;
      const k = Math.min(1, wl.t / 0.25);
      m.position.set(wl.x, 1.3, wl.z);
      m.scale.setScalar(k * (1 + Math.sin(wl.t * 30) * 0.03) * (1 - (wl.t / wl.dur) * 0.3));
      ((m.material as THREE.ShaderMaterial).uniforms.uK as THREE.IUniform).value = wl.t / wl.dur;
      if (!wl.exploded) {
        for (let n = 0; n < 4 * this.quality; n++) {
          const a = fxRng.range(0, Math.PI * 2), r = fxRng.range(2.5, 5);
          this.add.emit({ x: wl.x + Math.sin(a) * r, y: fxRng.range(0.2, 2.2), z: wl.z + Math.cos(a) * r, vx: -Math.sin(a + 0.9) * r * 1.6, vz: -Math.cos(a + 0.9) * r * 1.6, vy: (1.3 - 1.0) * 2, life: 0.55, size: 0.08, size1: 0.01, color: C.voidHot, frame: 'spark', stretch: 1 });
        }
        this.lights.add(wl.x, 1.3, wl.z, C.void, 3, 6);
        this.pools.addDynamic(wl.x, wl.z, 5, C.void, 0.5);
      }
    });
    for (const wv of ab.waves) {
      if (wv.kind === 'blade') {
        // полумесяц: дуга искр поперёк направления, концы отстают — серп летит вперёд
        const n = Math.round(10 * this.quality) + 4;
        for (let k = 0; k < n; k++) {
          const f = (k / (n - 1)) * 2 - 1;
          const back = f * f * 0.9;
          this.add.emit({ x: wv.x - wv.dz * f * wv.r * 1.3 - wv.dx * back, y: 0.5 + (1 - Math.abs(f)) * 0.7, z: wv.z + wv.dx * f * wv.r * 1.3 - wv.dz * back, vx: wv.dx * 6, vz: wv.dz * 6, life: 0.16, size: 0.45 - Math.abs(f) * 0.25, size1: 0.04, color: Math.abs(f) < 0.35 ? C.core : C.voidHot, frame: 'spark', stretch: 1.2 });
        }
        this.lights.add(wv.x, 0.9, wv.z, C.void, 3.5, 5);
        continue;
      }
      for (let n = 0; n < 3; n++) {
        const side = fxRng.spread(1.3);
        this.add.emit({ x: wv.x + -wv.dz * side, y: 0.6 + fxRng.next() * 0.8, z: wv.z + wv.dx * side, vx: wv.dx * 4, vz: wv.dz * 4, vy: 0.5, life: 0.22, size: 0.35, size1: 0.05, color: C.voidHot, frame: 'spark', stretch: 1 });
      }
    }
    const lp = ab.lastPhase;
    if (lp && lp.t < dtW * 1.5 + 0.001) {
      const n = 22;
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        this.add.emit({ x: lp.x0 + (lp.x1 - lp.x0) * f, y: 1.0, z: lp.z0 + (lp.z1 - lp.z0) * f, vy: 0.5, life: 0.4, size: 0.6, size1: 0.05, color: C.voidHot, frame: 'dot' });
      }
      this.rings.spawn(lp.x1, lp.z1, 0.2, 2, 0.3, C.voidHot, 0.15, 1);
    }

    // атмосфера: пыль и искры в воздухе вокруг камеры
    this.ambientT += dtReal;
    if (this.atmosphere !== 'none' && this.ambientT > 0.05) {
      this.ambientT = 0;
      const ember = this.atmosphere === 'embers';
      for (let i = 0; i < 2 * this.quality; i++) {
        this.add.emit({ x: h.x + fxRng.spread(16), y: fxRng.range(0.2, 6), z: h.z + fxRng.spread(11), vx: fxRng.spread(0.3), vy: ember ? 0.8 : 0.12, vz: fxRng.spread(0.3), life: 4, size: ember ? 0.05 : 0.035, color: ember ? C.ember : [0.35, 0.3, 0.5], alpha: 0.8, frame: 'dot' });
      }
    }

    this.sprites.end();
    this.pools.commit();
    this.add.flush();
    this.norm.flush();
    this.rings.update(dtW);
    this.debris.update(dtW);
    this.lights.end(dtW);
  }

  clear(): void {
    this.add.clear(); this.norm.clear(); this.trail.clear(); this.rings.clear(); this.debris.clear(); this.lights.clear(); this.stars.clear();
  }
}

