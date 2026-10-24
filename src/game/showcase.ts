import * as THREE from 'three';
import { ARENAS } from '../data/arenas';
import { buildArenaView, ZONE1_LOOK, type ArenaView } from '../gen/zone/arenaView';
import { Flames, LightPools, RuneCircle } from '../vfx/ambient';
import { Particles } from '../vfx/particles';
import { LightManager } from '../vfx/lights';
import { Arena } from '../world/arena';
import { HeroAvatar } from '../world/heroAvatar';
import { CAM_FOV, type Renderer } from '../render/renderer';
import { fxRng } from '../core/rng';
import { clamp, hexToLinear } from '../core/math';

export type ShowcaseView = 'title' | 'hub' | 'map' | 'results';

/**
 * Кадр Святилища (этап 4.5, A3): Пилот с клинком (высота h м, центр на cy м) занимает долю fill высоты свободной
 * области экрана — той, что не закрыта панелями; поле зрения не уже/шире minFov…maxFov.
 */
export const HUB_FRAME = { h: 2.35, cy: 1.1, fill: 0.72, minFov: 22, maxFov: 62, dist: 7.2 };

/** Свободная область экрана под героя: доли ширины и высоты (0 — левый/верхний край). */
export interface ScreenFrame { x0: number; y0: number; x1: number; y1: number }

/**
 * Поле зрения и сдвиг проекции, при которых точка взгляда (центр героя) встаёт в центр области, а герой высотой h
 * на расстоянии dist занимает долю fill её высоты. Сдвиг — доли экрана (для setViewOffset).
 */
export function hubFraming(f: ScreenFrame, dist: number): { fov: number; dx: number; dy: number } {
  const want = HUB_FRAME.fill * Math.max(0.05, f.y1 - f.y0);
  const tanHalf = (HUB_FRAME.h / 2 / dist) / want;
  const fov = clamp((2 * Math.atan(tanHalf) * 180) / Math.PI, HUB_FRAME.minFov, HUB_FRAME.maxFov);
  return { fov, dx: 0.5 - (f.x0 + f.x1) / 2, dy: 0.5 - (f.y0 + f.y1) / 2 };
}

const VOID = hexToLinear('#B794FF');
const STAR = hexToLinear('#8fd8ef');
const WARM = hexToLinear('#ffb866');

/**
 * Живая 3D-сцена под меню (Tech §22: «фон меню — та же 3D-сцена с медленным пролётом камеры»):
 * парящий островок Святилища, алтарь, Пилот у алтаря, свечи, частицы.
 */
export class Showcase {
  readonly group = new THREE.Group();
  readonly hero = new HeroAvatar();
  private view: ArenaView;
  private flames: Flames;
  private pools = new LightPools(64);
  private rune: RuneCircle;
  private particles = new Particles(600, true);
  private lights = new LightManager();
  private t = 0;
  mode: ShowcaseView = 'title';
  /** Звезда зоны в небе Святилища и карты (план §8.3.2): 0 — погасшая, 1 — горит, 2 — и вторая малая. */
  starLit = 0;
  private camPos = new THREE.Vector3(0, 30, 30);
  private camLook = new THREE.Vector3();
  private flourishT = 6;
  /** Свободная область кадра под героя (Святилище): её сообщает экран по своим панелям. */
  frame: ScreenFrame | null = null;
  private fov = CAM_FOV;
  private emitT = 0;

  constructor(private renderer: Renderer) {
    const arena = new Arena(ARENAS.hub);
    this.view = buildArenaView(arena, 'hub', ZONE1_LOOK, 1);
    this.flames = new Flames(this.view.flames);
    this.pools.setStatic(this.view.pools);
    this.rune = new RuneCircle(3.2);
    this.rune.mesh.position.set(0, 0, 1.6);
    this.group.add(this.view.root, this.flames.mesh, this.pools.mesh, this.rune.mesh, this.hero.group, this.particles.mesh);
    renderer.scene.add(this.group);
    this.hero.update(0, 0, 1.6, 0, 0, 0, 0, true);
  }

  update(dt: number): void {
    this.t += dt;
    const h = this.hero;
    this.flourishT -= dt;
    if (this.flourishT <= 0 && this.mode === 'hub') { h.puppet.play('victory', 0.8, 0.2); this.flourishT = 9 + Math.random() * 6; }
    if (h.puppet.anim.clip && h.puppet.anim.done) h.puppet.anim.stop(0.4);
    h.glow = 0.4 + Math.sin(this.t * 1.5) * 0.2;
    h.update(dt, 0, 1.6, this.mode === 'title' ? Math.PI * 0.85 : 0.35, 0, 0, 0, true);
    h.render(true, false);
    // искры Пустоты над алтарём
    this.emitT -= dt;
    if (this.emitT <= 0) {
      this.emitT = 0.06;
      this.particles.emit({ x: fxRng.spread(0.4), y: 2.2 + fxRng.spread(0.2), z: -1.2 + fxRng.spread(0.3), vy: 0.6, vx: fxRng.spread(0.4), vz: fxRng.spread(0.4), life: 2.2, size: 0.07, size1: 0.01, color: [STAR[0] * 2, STAR[1] * 2, STAR[2] * 2], frame: 'star' });
      this.particles.emit({ x: fxRng.spread(14), y: fxRng.range(-2, 6), z: fxRng.spread(10), vy: 0.15, life: 5, size: 0.04, color: [0.35, 0.3, 0.5], frame: 'dot' });
    }
    this.particles.flush();
    this.lights.begin();
    // кристалл алтаря — звёздный свет; тёплый свет свечей сбоку; клинок — слабый фиолетовый акцент
    this.lights.add(0, 2.2, -1.2, STAR, 1.6 + Math.sin(this.t * 2) * 0.3, 6);
    this.lights.add(2.2, 1.6, 3.2, WARM, 1.4, 6);
    h.bladePoints(_a, _b);
    this.lights.add(_b.x, _b.y, _b.z, VOID, 0.6, 3);
    this.lights.end(dt);
    this.rune.u.uPulse.value = 0.15 + Math.sin(this.t * 0.8) * 0.1;
    const sky = this.renderer.sky.u;
    sky.uStarLit.value = this.starLit > 0 ? 1 : 0;
    sky.uStar2.value = this.starLit >= 2 ? 1 : 0;
    this.updateCamera(dt);
  }

  private updateCamera(dt: number): void {
    const cam = this.renderer.camera;
    const t = this.t;
    const pos = _p, look = _l;
    switch (this.mode) {
      case 'title': {
        // медленный пролёт: высоко над островом, к чёрной луне
        const a = t * 0.05;
        pos.set(Math.sin(a) * 16, 13 + Math.sin(t * 0.13) * 1.5, 20 + Math.cos(a) * 4);
        look.set(4, -6, -18);
        break;
      }
      case 'hub': {
        // взгляд — на Пилота; где он на экране и какого размера — решает свободная область (hubFraming)
        const a = 0.25 + Math.sin(t * 0.08) * 0.1, D = HUB_FRAME.dist;
        pos.set(Math.sin(a) * D, 2.9, 1.6 + Math.cos(a) * D);
        look.set(0, HUB_FRAME.cy, 1.6);
        break;
      }
      case 'map':
        // взгляд в туманность к чёрной луне — чистый фон под созвездие
        pos.set(-30, 6, 34);
        look.set(-30 + 0.42 * 100, 6 - 0.42 * 100, 34 - 0.8 * 100);
        break;
      case 'results':
        pos.set(-2.2, 2.8, 7.5);
        look.set(-0.6, 1.4, 0.6);
        break;
    }
    const k = 1 - Math.exp(-dt / 0.9);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    // Святилище: герой — в центре свободной части экрана и целиком; в остальных видах — обычная проекция
    let fov = CAM_FOV;
    if (this.mode === 'hub' && this.frame) {
      const fr = hubFraming(this.frame, cam.position.distanceTo(this.camLook));
      fov = fr.fov;
      const W = 1000 * cam.aspect, H = 1000;
      cam.setViewOffset(W, H, fr.dx * W, fr.dy * H, W, H);
    } else if (cam.view) cam.clearViewOffset();
    this.fov += (fov - this.fov) * k;
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }

  snapCamera(): void { this.camPos.set(0, 40, 40); }

  dispose(): void {
    // камера общая с боем: сдвиг проекции и поле зрения Святилища не должны уйти в бой
    const cam = this.renderer.camera;
    cam.clearViewOffset(); cam.fov = CAM_FOV; cam.updateProjectionMatrix();
    this.renderer.scene.remove(this.group);
    this.view.dispose();
    this.hero.dispose();
    this.flames.dispose();
    this.lights.clear();
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3();
