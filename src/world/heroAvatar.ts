import * as THREE from 'three';
import { BipedGait, bipedJoints, addJoint, type BipedJoints } from '../anim/locomotion';
import { layoutOf, Puppet } from '../anim/puppet';
import { VerletCloth } from '../anim/verlet';
import { HERO_CLIPS } from '../anim/clips/hero';
import { buildHeroGeometry, HERO_RIG, BLADE_LEN } from '../gen/chars/hero';
import { RigBatch } from '../render/rigbatch';
import { ClothMesh } from '../render/cloth';

const GHOSTS = 6;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/**
 * Визуальный герой: кукла + походка + плащ (Верле 3 × 7) + шарф (2 × 8) + Каэлис + остаточные изображения.
 * Батч на одного — но призраки рисуются тем же батчем деталей с «призрачным» материалом (Tech §8.6).
 */
export class HeroAvatar {
  readonly puppet: Puppet;
  readonly gait = new BipedGait(1.75, 5.5);
  readonly J: BipedJoints;
  readonly batch: RigBatch;
  readonly ghostBatch: RigBatch;
  readonly cloak = new VerletCloth(3, 7, 0.17, 0.16);
  readonly scarf = new VerletCloth(2, 8, 0.1, 0.13);
  readonly cloakMesh: ClothMesh;
  readonly scarfMesh: ClothMesh;
  readonly group = new THREE.Group();
  private ghosts: { world: Float32Array; age: number }[] = [];
  private ghostTimer = 0;
  ghostsOn = false;
  bladeScale = 1;
  stretch = 1;
  squash = 1;
  private time = 0;
  private iChest: number; private iNeck: number; private iPelvis: number; private iKaelis: number; private iBlade: number;
  private iHandR: number;
  private cloakReady = false;
  /** Свечение шрама/визора: растёт с Резонансом. */
  glow = 0;
  /** Тон кукловода: >0 — аура ульты. */
  aura = 0;

  constructor() {
    const layout = layoutOf(HERO_RIG);
    this.puppet = new Puppet(layout, HERO_CLIPS);
    this.J = bipedJoints(layout);
    const geo = buildHeroGeometry();
    // холодный контровой свет — силуэт читается на любом фоне; фиолет — только в швах, визоре и клинке
    // герой заметнее своим светом (план §5.3): фиолетовый контур — только у Пилота
    this.batch = new RigBatch(geo, layout.n, 1, { rim: '#b49cff', rimStrength: 1.05, rimPower: 2.8, emissive: '#a07cff', emissiveStrength: 2.1, emissive2: '#ffd29a' });
    this.ghostBatch = RigBatch.sibling(this.batch, GHOSTS, { ghost: true, rim: '#9b6cff', emissive: '#b794ff' });
    this.cloakMesh = new ClothMesh(this.cloak, '#121823', { rim: '#9b7cff', rimStrength: 1.0, emissive: '#8B5CF6', emissiveStrength: 1.6 }, 1, 1.2);
    this.scarfMesh = new ClothMesh(this.scarf, '#5a1420', { rim: '#ff8a8a', rimStrength: 0.25, emissive: '#c9a253', emissiveStrength: 1.2 }, 1, 0.5);
    this.group.add(this.batch.mesh, this.ghostBatch.mesh, this.cloakMesh.mesh, this.scarfMesh.mesh);
    this.iChest = layout.idx('chest'); this.iNeck = layout.idx('neck'); this.iPelvis = layout.idx('pelvis');
    this.iKaelis = layout.idx('kaelis'); this.iBlade = layout.idx('blade'); this.iHandR = layout.idx('handR');
    for (let i = 0; i < GHOSTS; i++) this.ghosts.push({ world: new Float32Array(layout.n * 16), age: 99 });
    this.cloak.wind = 1.2; this.scarf.wind = 1.6;
    this.cloak.iterations = 4; this.scarf.iterations = 3;
    this.cloak.damping = 0.94; this.scarf.damping = 0.95;
  }

  /**
   * dt — время героя (с замедлением), moveDist/speed — для походки, facing — разворот.
   * running=false подавляет походку (атака на месте).
   */
  update(dt: number, x: number, z: number, facing: number, moveDist: number, speed: number, accel: number, bladeBack: boolean): void {
    const p = this.puppet, s = p.skel;
    this.time += dt;
    this.gait.update(moveDist, speed, accel, dt);
    this.gait.write(p.base, p.layout, this.J, bladeBack);
    p.anim.update(dt);
    p.anim.compose(p.base);
    s.rot.set(p.anim.out);
    // аддитивные слои: пружина отдачи на корпусе
    p.stepSpring(dt);
    const cf = Math.cos(facing), sf = Math.sin(facing);
    const lx = p.springX * cf - p.springZ * sf, lz = p.springX * sf + p.springZ * cf;
    if (Math.abs(lx) + Math.abs(lz) > 1e-4) {
      addJoint(s.rot, this.J.spine, -lz * 0.6, 0, lx * 0.6);
      addJoint(s.rot, this.J.chest, -lz * 0.4, 0, lx * 0.4);
    }
    // Каэлис парит у плеча
    s.off[this.iKaelis * 3 + 1] = Math.sin(this.time * 2.2) * 0.06;
    s.setRotEuler(this.iKaelis, Math.sin(this.time * 0.9) * 0.3, this.time * 2.0, 0);
    // клинок ×2 в ульте «Затмение»
    s.scl[this.iBlade * 3] = this.bladeScale; s.scl[this.iBlade * 3 + 1] = this.bladeScale; s.scl[this.iBlade * 3 + 2] = this.bladeScale;

    const r = p.anim.root;
    const st = r.stretch * this.stretch;
    s.facing = facing + r.spin;
    s.x = x + r.z * sf + r.x * cf;
    s.z = z + r.z * cf - r.x * sf;
    s.y = this.gait.bob + r.y;
    if (st >= 1) { const k = 1 / Math.sqrt(st); s.sx = k; s.sy = k; s.sz = st; }
    else { const k = 1 / Math.sqrt(st); s.sx = k; s.sy = st; s.sz = k; }
    if (this.squash !== 1) { s.sy *= this.squash; const k = 1 / Math.sqrt(this.squash); s.sx *= k; s.sz *= k; }
    s.update();

    this.updateCloth(dt);
    this.updateGhosts(dt);
  }

  private anchor(joint: number, lx: number, ly: number, lz: number): THREE.Vector3 {
    return this.puppet.skel.jointPoint(joint, lx, ly, lz, _v);
  }

  private updateCloth(dt: number): void {
    const s = this.puppet.skel;
    const ax = [-0.17, 0, 0.17];
    if (!this.cloakReady) {
      // начальная раскладка: свисает за спиной
      for (let j = 0; j < this.cloak.h; j++) for (let i = 0; i < this.cloak.w; i++) {
        const a = this.anchor(this.iChest, ax[i], 0.22 - j * 0.16, -0.16 - j * 0.03);
        const k = (j * this.cloak.w + i) * 3;
        this.cloak.p[k] = this.cloak.q[k] = a.x; this.cloak.p[k + 1] = this.cloak.q[k + 1] = a.y; this.cloak.p[k + 2] = this.cloak.q[k + 2] = a.z;
      }
      for (let j = 0; j < this.scarf.h; j++) for (let i = 0; i < this.scarf.w; i++) {
        const a = this.anchor(this.iNeck, i ? 0.05 : -0.05, 0.02 - j * 0.13, -0.09 - j * 0.02);
        const k = (j * this.scarf.w + i) * 3;
        this.scarf.p[k] = this.scarf.q[k] = a.x; this.scarf.p[k + 1] = this.scarf.q[k + 1] = a.y; this.scarf.p[k + 2] = this.scarf.q[k + 2] = a.z;
      }
      this.cloakReady = true;
    }
    for (let i = 0; i < 3; i++) {
      const a = this.anchor(this.iChest, ax[i], 0.22, -0.15 + (i === 1 ? -0.02 : 0));
      this.cloak.setPinned(i, a.x, a.y, a.z);
    }
    for (let i = 0; i < 2; i++) {
      const a = this.anchor(this.iNeck, i ? 0.05 : -0.05, 0.02, -0.09);
      this.scarf.setPinned(i, a.x, a.y, a.z);
    }
    const col = this.cloak.colliders;
    col.length = 0;
    s.jointPoint(this.iChest, 0, 0.05, 0.02, _w); col.push({ x: _w.x, y: _w.y, z: _w.z, r: 0.24 });
    s.jointPoint(this.iPelvis, 0, -0.05, 0.02, _w); col.push({ x: _w.x, y: _w.y, z: _w.z, r: 0.25 });
    s.jointPoint(this.iPelvis, 0, -0.42, 0.04, _w); col.push({ x: _w.x, y: _w.y, z: _w.z, r: 0.2 });
    this.scarf.colliders.length = 0;
    this.scarf.colliders.push(col[0]);
    const sub = dt > 1 / 70 ? 2 : 1;
    for (let i = 0; i < sub; i++) { this.cloak.step(dt / sub); this.scarf.step(dt / sub); }
    this.cloakMesh.sync();
    this.scarfMesh.sync();
  }

  /** Сбросить ткань (телепорт/спаун). */
  resetCloth(): void { this.cloakReady = false; }

  private updateGhosts(dt: number): void {
    for (const g of this.ghosts) g.age += dt;
    if (this.ghostsOn) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.03;
        let oldest = this.ghosts[0];
        for (const g of this.ghosts) if (g.age > oldest.age) oldest = g;
        oldest.world.set(this.puppet.skel.world);
        oldest.age = 0;
      }
    }
  }

  /** Точки рукояти и кончика клинка в мире (для шлейфа). */
  bladePoints(base: THREE.Vector3, tip: THREE.Vector3): void {
    const s = this.puppet.skel;
    s.jointPoint(this.iBlade, 0, -0.25, 0, base);
    s.jointPoint(this.iBlade, 0, -BLADE_LEN - 0.02, 0, tip);
  }

  handPos(out: THREE.Vector3): THREE.Vector3 { return this.puppet.skel.jointPos(this.iHandR, out); }
  chestPos(out: THREE.Vector3): THREE.Vector3 { return this.puppet.skel.jointPos(this.iChest, out); }
  kaelisPos(out: THREE.Vector3): THREE.Vector3 { return this.puppet.skel.jointPos(this.iKaelis, out); }

  dispose(): void {
    this.group.removeFromParent();
    this.batch.dispose(); this.ghostBatch.dispose();
    this.cloakMesh.dispose(); this.scarfMesh.dispose();
  }

  render(visible = true, blink = false): void {
    const p = this.puppet;
    this.batch.begin();
    if (visible && !blink) this.batch.push(p.skel.world, p.flash, p.dissolve, this.glow, p.crack);
    this.batch.end();
    this.ghostBatch.begin();
    for (const g of this.ghosts) {
      const a = Math.max(0, 1 - g.age / 0.22) * 0.55;
      if (a > 0.01) this.ghostBatch.push(g.world, a, 0, 0, 0);
    }
    this.ghostBatch.end();
    const show = visible && !p.skel.broken;
    this.cloakMesh.mesh.visible = show && !blink;
    this.scarfMesh.mesh.visible = show && !blink;
  }
}
