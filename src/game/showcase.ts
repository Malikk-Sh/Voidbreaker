import * as THREE from 'three';
import { ARENAS } from '../data/arenas';
import { buildArenaView, ZONE1_LOOK, type ArenaView } from '../gen/zone/arenaView';
import { Flames, LightPools, RuneCircle } from '../vfx/ambient';
import { Particles } from '../vfx/particles';
import { LightManager } from '../vfx/lights';
import { Arena } from '../world/arena';
import { HeroAvatar } from '../world/heroAvatar';
import type { Renderer } from '../render/renderer';
import { fxRng } from '../core/rng';
import { hexToLinear } from '../core/math';

export type ShowcaseView = 'title' | 'hub' | 'map' | 'results';

const VOID = hexToLinear('#B794FF');

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
  private camPos = new THREE.Vector3(0, 30, 30);
  private camLook = new THREE.Vector3();
  private flourishT = 6;
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
      this.particles.emit({ x: fxRng.spread(0.4), y: 2.2 + fxRng.spread(0.2), z: -1.2 + fxRng.spread(0.3), vy: 0.6, vx: fxRng.spread(0.4), vz: fxRng.spread(0.4), life: 2.2, size: 0.07, size1: 0.01, color: [VOID[0] * 2, VOID[1] * 2, VOID[2] * 2], frame: 'star' });
      this.particles.emit({ x: fxRng.spread(14), y: fxRng.range(-2, 6), z: fxRng.spread(10), vy: 0.15, life: 5, size: 0.04, color: [0.35, 0.3, 0.5], frame: 'dot' });
    }
    this.particles.flush();
    this.lights.begin();
    this.lights.add(0, 2.2, -1.2, VOID, 2.5 + Math.sin(this.t * 2) * 0.5, 7);
    h.bladePoints(_a, _b);
    this.lights.add(_b.x, _b.y, _b.z, VOID, 1.2, 4);
    this.lights.end(dt);
    this.rune.u.uPulse.value = 0.15 + Math.sin(this.t * 0.8) * 0.1;
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
        // герой — в левой трети кадра, справа место под панель
        const a = 0.25 + Math.sin(t * 0.08) * 0.1;
        pos.set(Math.sin(a) * 8 + 1.2, 3.6, Math.cos(a) * 8 + 1.6);
        look.set(3.2, 1.4, 0.2);
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
  }

  snapCamera(): void { this.camPos.set(0, 40, 40); }

  dispose(): void {
    this.renderer.scene.remove(this.group);
    this.view.dispose();
    this.hero.dispose();
    this.flames.dispose();
    this.lights.clear();
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3();
