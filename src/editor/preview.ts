import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Clip, type ClipDef } from '../anim/clip';
import { Puppet, layoutOf } from '../anim/puppet';
import { Director, type DirectorActor, type CineTrack, type V3 } from '../game/director';
import { resolveScene, type SceneProject, type Variant } from '../game/sceneEdits';
import { HeroAvatar } from '../world/heroAvatar';
import { CameraRig } from '../world/camera';
import { Renderer } from '../render/renderer';
import { G } from '../render/materials';
import { RigBatch } from '../render/rigbatch';
import { buildHierophant } from '../gen/chars/hierophant';
import { buildBrute } from '../gen/chars/enemies';
import { buildShip, buildCathedralRing } from '../gen/zone/space';
import { PROLOGUE_T, SPACE } from '../game/prologueTracks';
import { BASIS, BOSS_CLIPS, MASK, type SceneSpec } from './catalog';

interface Actor extends DirectorActor { y: number }
const rootParams = () => ({ x: 0, y: 0, z: 0, stretch: 1, spin: 0 });

/** Монтажная площадка: настоящие риги, клипы и Director. Боевая логика и сохранение игрока не запускаются. */
export class StudioPreview {
  readonly renderer: Renderer;
  readonly hero = new HeroAvatar();
  readonly controls: OrbitControls;
  readonly actors: Record<string, Actor> = {};
  private puppets = new Map<string, Puppet>();
  private bossPuppet: Puppet | null = null;
  private bossBatch: RigBatch | null = null;
  private shipPuppet: Puppet;
  private shipBatch: RigBatch;
  private ring: THREE.Mesh;
  private group = new THREE.Group();
  private guides = new THREE.Group();
  private chain: THREE.Line;
  private target: THREE.Mesh;
  private shard: THREE.Mesh;
  private rig = new CameraRig();
  private director: Director;
  private spec!: SceneSpec;
  private prepared!: CineTrack;
  private variant: Variant = 'full';
  private moonSaved = new THREE.Vector3();
  private sizeObserver: ResizeObserver;
  private legacy = new Map<string, { id: string; start: number }>();
  time = 0;
  cameraMode: 'shot' | 'orbit' | 'side' | 'top' = 'shot';
  showGuides = true;
  contactError = 0;
  duration = 1;

  constructor(readonly canvas: HTMLCanvasElement, readonly viewport: HTMLElement) {
    this.renderer = new Renderer(canvas, 'medium');
    this.renderer.camera.near = 0.05;
    this.renderer.post.bloomEnabled = false;
    G.uFogRange.value.set(100, 800);
    G.uHemiTop.value.set(0.24, 0.28, 0.4);
    G.uMoonColor.value.set(0.65, 0.72, 0.9);
    this.moonSaved.copy(this.renderer.sky.u.uMoonDir.value);
    this.renderer.scene.add(this.group, this.guides, this.hero.group);
    const grid = new THREE.GridHelper(50, 50, 0x39364c, 0x1c1e2a);
    grid.position.y = -0.025; this.group.add(grid);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshBasicMaterial({ color: 0x10121c }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.035; this.group.add(floor);
    const ship = buildShip();
    this.shipPuppet = new Puppet(layoutOf(ship.rig), []);
    this.shipPuppet.skel.size = 1.4;
    this.shipBatch = new RigBatch(ship.geometry, this.shipPuppet.layout.n, 1, { rim: '#9fb4d0', rimStrength: 0.7, emissive: '#d6c4ff', emissiveStrength: 2 });
    this.renderer.scene.add(this.shipBatch.mesh);
    this.ring = new THREE.Mesh(buildCathedralRing(SPACE.ringR, SPACE.ringCount), new THREE.MeshBasicMaterial({ color: 0x494153 }));
    this.ring.position.copy(BASIS.C);
    this.ring.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(BASIS.Rt, BASIS.Up, BASIS.F.clone().negate()));
    this.renderer.scene.add(this.ring);
    this.chain = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xc6ae78 }));
    this.target = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffcc80, depthTest: false }));
    this.target.renderOrder = 100;
    this.shard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.22), new THREE.MeshBasicMaterial({ color: 0xbeb1dd }));
    this.shard.position.set(1.8, 0.7, -2.1);
    this.guides.add(this.chain, this.target); this.group.add(this.shard);
    this.controls = new OrbitControls(this.renderer.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.minDistance = 0.8; this.controls.maxDistance = 800;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE; this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.addEventListener('change', () => { if (this.cameraMode === 'orbit') this.renderer.render(this.time); });
    this.director = this.createDirector();
    this.sizeObserver = new ResizeObserver(() => this.resize());
    this.sizeObserver.observe(viewport);
    this.resize();
    canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); viewport.dataset.contextLost = 'true'; });
  }

  private createDirector(): Director {
    const d = new Director({
      actor: (who) => this.actors[who] ?? null,
      defineClip: (who, id, definition) => { const p = this.puppets.get(who); if (p) p.clips.set(id, new Clip({ ...definition, id }, p.layout)); },
      playClip: (who, id) => { this.legacy.set(who, { id, start: this.director.time }); this.samplePose(who, id, 0, true, 0.12); },
      clipEvents: (who, id) => this.puppets.get(who)?.clips.get(id)?.events ?? [],
      clipDuration: (who, id) => this.puppets.get(who)?.clips.get(id)?.dur ?? 0,
      sampleClip: (who, id, time, reset, blend) => { this.legacy.delete(who); this.samplePose(who, id, time, reset, blend); },
      releaseClip: () => {},
      sky: (param, value) => { const u = this.renderer.sky.u; if (param === 'starLit') u.uStarLit.value = value; if (param === 'crack') u.uSkyCrack.value = value; },
      moonBehind: (dir) => { const v = this.renderer.sky.u.uMoonDir.value; if (dir) v.set(...dir).normalize(); else v.copy(this.moonSaved); },
      holding: () => false, tapped: () => true, autoContinue: () => true,
      seen: () => this.variant === 'short' ? 2 : 0, markSeen: () => {},
    });
    d.studio = true;
    return d;
  }

  private samplePose(who: string, id: string, time: number, reset = false, blend = 0): void {
    const p = this.puppets.get(who), c = p?.clips.get(id);
    if (!p || !c) return;
    p.anim.sampleScene(c, time, reset, blend);
    p.anim.compose(p.base); p.skel.rot.set(p.anim.out);
  }

  load(spec: SceneSpec, project: SceneProject, variant: Variant): void {
    this.spec = spec; this.variant = variant;
    this.prepared = resolveScene(spec.track, project, variant);
    if (this.bossBatch) { this.renderer.scene.remove(this.bossBatch.mesh); this.bossBatch.dispose(); this.bossBatch = null; }
    this.bossPuppet = null;
    if (['hierophant', 'gate', 'bell'].includes(spec.model)) {
      const b = spec.model === 'hierophant' ? buildHierophant() : buildBrute(5, spec.model === 'gate' ? 1.65 : 1.4, { halberd: spec.model === 'gate', bell: spec.model === 'bell' });
      this.bossPuppet = new Puppet(layoutOf(b.rig), spec.model === 'hierophant' ? BOSS_CLIPS : []);
      this.bossBatch = new RigBatch(b.geometry, this.bossPuppet.layout.n, 1, { rim: '#d59a7d', rimStrength: 0.65, emissive: '#ff534b', emissiveStrength: 1.4 });
      this.renderer.scene.add(this.bossBatch.mesh);
    }
    const all = variant === 'short' ? this.prepared.short ?? this.prepared.steps : this.prepared.steps;
    this.duration = variant === 'short' ? Math.max(0, ...all.map((s) => s.t + ('dur' in s ? s.dur ?? 0 : 0))) + 0.3 : this.prepared.dur ?? 1;
    this.seek(0);
  }

  refresh(project: SceneProject, variant: Variant): void {
    const t = this.time;
    this.variant = variant; this.prepared = resolveScene(this.spec.track, project, variant);
    const steps = variant === 'short' ? this.prepared.short ?? this.prepared.steps : this.prepared.steps;
    this.duration = variant === 'short' ? Math.max(0, ...steps.map((s) => s.t + ('dur' in s ? s.dur ?? 0 : 0))) + 0.3 : this.prepared.dur ?? 1;
    this.seek(Math.min(t, this.duration));
  }

  private reset(): void {
    this.director.clear(this.rig);
    this.legacy.clear();
    this.puppets.clear();
    for (const key of Object.keys(this.actors)) delete this.actors[key];
    this.puppets.set('hero', this.hero.puppet);
    for (const [who, a] of Object.entries(this.spec.actors)) {
      const p = who === 'hero' ? this.hero.puppet : who === 'ship' ? this.shipPuppet : this.bossPuppet;
      this.actors[who] = { ...a, puppet: p ?? undefined };
      if (p) this.puppets.set(who, p);
    }
    for (const p of this.puppets.values()) {
      p.skel.resetPose(); p.base.set(p.layout.restRot);
      p.anim.stop(0); p.anim.out.set(p.layout.restRot); Object.assign(p.anim.root, rootParams());
    }
    if (this.bossPuppet && this.spec.model === 'hierophant') {
      const pose = this.spec.id === 'hierophantEnd' ? 'executionBrace' : 'idle';
      const c = this.bossPuppet.clips.get(pose)!;
      c.sample(0, this.bossPuppet.base, rootParams());
      this.bossPuppet.anim.out.set(this.bossPuppet.base);
      if (this.spec.id === 'hierophantEnd') this.bossPuppet.skel.off[this.bossPuppet.layout.idx('body') * 3 + 1] = -1.6;
    }
    this.renderer.sky.u.uStarLit.value = 0; this.renderer.sky.u.uSkyCrack.value = 0;
    this.renderer.sky.u.uMoonDir.value.copy(this.moonSaved);
    this.director = this.createDirector();
    this.director.play(this.prepared);
    this.director.update(0, this.rig);
  }

  seek(t: number): void {
    this.reset();
    const target = Math.min(Math.max(0, t), this.duration - 1e-5);
    while (this.director.time + 1e-7 < target && this.director.active) {
      this.director.update(Math.min(1 / 60, target - this.director.time), this.rig);
      this.advanceLegacy();
    }
    this.time = t; this.hero.resetCloth(); this.draw(0);
  }

  advance(dt: number): void {
    this.director.update(dt, this.rig); this.advanceLegacy(); this.time = Math.min(this.duration, this.time + dt); this.draw(dt);
  }

  private advanceLegacy(): void {
    for (const [who, b] of this.legacy) this.samplePose(who, b.id, this.director.time - b.start, false, 0.12);
  }

  private draw(dt: number): void {
    const rate = this.prepared.playbackRate ?? 1;
    const space = this.spec.model === 'space', fall = space && this.time >= PROLOGUE_T.fall / rate;
    this.group.visible = !space || fall;
    this.hero.group.visible = !space || fall;
    this.ring.visible = space && !fall;
    this.shipBatch.mesh.visible = space && !fall;
    const h = this.actors.hero;
    if (h) {
      const anim = this.hero.puppet.anim;
      if (space && fall && !this.prepared.steps.some((s) => s.do === 'clip' && s.who === 'hero' && s.t <= this.director.time)) {
        const clip = this.hero.puppet.clips.get('skydive');
        if (clip) this.samplePose('hero', 'skydive', ((this.time - PROLOGUE_T.fall / rate) * rate) % clip.dur, !anim.sceneDriven);
      }
      this.hero.lift = h.y + (fall ? -0.3 : 0);
      this.hero.puppet.skel.tiltX = fall ? 1.35 : 0;
      this.hero.update(dt, h.x, h.z + (fall ? 1.4 : 0), h.facing + (fall ? Math.PI : 0), 0, 0, 0, false);
      this.hero.render();
    }
    if (space && !fall) {
      let t = Math.max(0, this.time * rate - PROLOGUE_T.space);
      for (const step of this.prepared.steps) if (step.do === 'time') t -= Math.max(0, Math.min(this.time - step.t, step.dur)) * rate * (1 - step.scale);
      const pos = t <= SPACE.hitT ? BASIS.shipPos(t) : BASIS.shipFall(t - SPACE.hitT);
      const s = this.shipPuppet.skel, a = this.actors.ship;
      s.x = pos.x + (a?.x ?? 0); s.y = pos.y + (a?.y ?? 0); s.z = pos.z + (a?.z ?? 0);
      const head = BASIS.shipVel().normalize();
      if (t > SPACE.hitT) head.lerp(BASIS.F, Math.min(1, (t - SPACE.hitT) / 2.4)).normalize();
      s.facing = Math.atan2(head.x, head.z) + (a?.facing ?? 0); s.tiltX = -Math.asin(head.y); s.tiltZ = t > SPACE.hitT ? -(t - SPACE.hitT) * 0.9 : Math.sin(t * 0.7) * 0.06; s.update();
      this.shipBatch.begin(); this.shipBatch.push(s.world, 0, 0, 0, 0); this.shipBatch.end();
    }
    if (this.bossPuppet && this.bossBatch) {
      const who = this.spec.model === 'gate' ? 'gateGuardian' : this.spec.model === 'bell' ? 'bellRinger' : 'boss';
      const a = this.actors[who], p = this.bossPuppet, s = p.skel;
      s.rot.set(p.anim.sceneDriven ? p.anim.out : p.base);
      Object.assign(s, { x: a.x, y: a.y, z: a.z, facing: a.facing }); s.update();
      this.bossBatch.begin(); this.bossBatch.push(s.world, 0, p.dissolve, 0, p.crack); this.bossBatch.end();
    }
    this.chain.visible = this.spec.id === 'hierophantEnd'; this.target.visible = this.chain.visible;
    if (this.chain.visible) {
      if (this.bossPuppet) this.bossPuppet.skel.jointPoint(this.bossPuppet.layout.idx('bell'), 0, 0.32, 0.18, this.target.position);
      else this.target.position.set(...MASK);
      this.chain.geometry.dispose();
      this.chain.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 2.6), new THREE.Vector3(MASK[0], MASK[1] + 0.12, MASK[2] + 0.65)]);
      const tip = this.hero.sceneAnchor('bladeTip', new THREE.Vector3());
      this.contactError = tip.distanceTo(this.target.position);
    }
    this.shard.visible = this.spec.model === 'landing';
    this.guides.visible = this.showGuides;
    this.controls.enabled = this.cameraMode === 'orbit';
    const c = this.renderer.camera;
    const shot = this.director.cameraSample ?? this.rig.cine;
    if (this.cameraMode === 'shot' && shot) {
      c.position.copy(shot.pos); c.fov = shot.fov ?? 48; c.lookAt(shot.look); c.rotateZ(shot.roll ?? 0);
    } else if (this.cameraMode === 'side' || this.cameraMode === 'top') {
      const y = h?.y ?? 0, z = h?.z ?? 0;
      c.position.set(this.cameraMode === 'top' ? 0 : 12, this.cameraMode === 'top' ? 20 : 5 + y * 0.3, this.cameraMode === 'top' ? 0.01 : 6);
      c.lookAt(0, this.cameraMode === 'top' ? 0 : 2 + y * 0.3, z * 0.3); c.fov = 50;
    }
    c.updateProjectionMatrix(); this.renderer.render(this.time);
  }

  setCamera(mode: StudioPreview['cameraMode']): void {
    this.cameraMode = mode;
    if (mode === 'orbit') { this.renderer.camera.position.set(9, 6, 11); this.controls.target.set(0, 2, 1); this.controls.enabled = true; this.controls.update(); }
    this.draw(0);
  }
  resize(): void { const b = this.viewport.getBoundingClientRect(); this.renderer.resize(b.width, b.height); if (this.spec) this.draw(0); }
  snapshotPose(who: string): ClipDef {
    const p = this.puppets.get(who) ?? this.hero.puppet;
    const pose: Record<string, V3> = {}, rest = new THREE.Quaternion(), q = new THREE.Quaternion(), e = new THREE.Euler();
    p.layout.names.forEach((name, i) => { rest.fromArray(p.layout.restRot, i * 4).invert(); q.fromArray(p.anim.out, i * 4).premultiply(rest); e.setFromQuaternion(q); pose[name] = [e.x, e.y, e.z]; });
    return { id: 'customPose', dur: 1, mask: 'full', keys: [{ t: 0, pose }, { t: 1, pose: structuredClone(pose), ease: 'inOutSine' }] };
  }
  joints(who: string): string[] { return this.puppets.get(who)?.layout.names ?? []; }
  contactDelta(): V3 {
    const tip = this.hero.sceneAnchor('bladeTip', new THREE.Vector3());
    return [this.target.position.x - tip.x, this.target.position.y - tip.y, this.target.position.z - tip.z];
  }
  dispose(): void { this.sizeObserver.disconnect(); this.controls.dispose(); this.hero.dispose(); this.bossBatch?.dispose(); this.shipBatch.dispose(); this.renderer.gl.dispose(); }
}
