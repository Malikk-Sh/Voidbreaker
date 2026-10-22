import * as THREE from 'three';
import { BipedGait, bipedJoints, addJoint, type BipedJoints } from '../anim/locomotion';
import { layoutOf, Puppet } from '../anim/puppet';
import { VerletCloth } from '../anim/verlet';
import { HERO_CLIPS } from '../anim/clips/hero';
import { Clip } from '../anim/clip';
import { buildHeroGeometry, HERO_RIG, BLADE_LEN } from '../gen/chars/hero';
import { RigBatch } from '../render/rigbatch';
import { ClothMesh } from '../render/cloth';

const GHOSTS = 6;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _tb = new THREE.Vector3(), _tt = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

/** Шаг-выпад под удары серии (план §5.8, п. 5): передняя нога вперёд, таз ниже. L — левая нога впереди. */
const LUNGE_POSE = {
  L: { hipL: [-0.6, 0, 0.12], kneeL: [0.8, 0, 0], footL: [-0.2, 0, 0], hipR: [0.32, 0, -0.12], kneeR: [0.55, 0, 0], footR: [0.18, 0, 0] },
  R: { hipR: [-0.6, 0, -0.12], kneeR: [0.8, 0, 0], footR: [-0.2, 0, 0], hipL: [0.32, 0, 0.12], kneeL: [0.55, 0, 0], footL: [0.18, 0, 0] },
} as const;
/** Удары серии с маской «верх» — им нужен шаг ногами; какая нога впереди. */
const LUNGE_CLIPS: Record<string, 'L' | 'R'> = { atk1: 'L', atk2: 'R', flurry: 'L' };

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
  /** Высота корня над полом (м): прыжки, падение в провал, сцены пролога. Входит в матрицы до расчёта ткани. */
  lift = 0;
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
  /** Скорость кончика клинка в мире (м/с): искры по касательной, ширина шлейфа. */
  readonly tipVel = new THREE.Vector3();
  private readonly prevTip = new THREE.Vector3();
  private tipReady = false;
  /** Удержание позы в кадре удара (реальные с; уменьшает FeelSystem): поза и растяжение стоят. */
  hold = 0;
  private holdStretch = 1;
  private lastStretch = 1;
  private lunge: Record<'L' | 'R', Clip>;
  private lungeW = 0;
  private lungeSide: 'L' | 'R' = 'L';
  private prevYaw = 0;
  private yawRate = 0;

  constructor() {
    const layout = layoutOf(HERO_RIG);
    this.puppet = new Puppet(layout, HERO_CLIPS);
    this.J = bipedJoints(layout);
    const geo = buildHeroGeometry();
    // холодный контровой свет — силуэт читается на любом фоне; фиолет — только в швах, визоре и клинке
    // герой заметнее своим светом (план §5.3): фиолетовый контур — только у Пилота
    this.batch = new RigBatch(geo, layout.n, 1, { rim: '#b49cff', rimStrength: 1.05, rimPower: 2.8, emissive: '#a07cff', emissiveStrength: 2.1, emissive2: '#ffd29a' });
    this.ghostBatch = RigBatch.sibling(this.batch, GHOSTS + 1, { ghost: true, rim: '#9b6cff', emissive: '#b794ff' });
    this.cloakMesh = new ClothMesh(this.cloak, '#121823', { rim: '#9b7cff', rimStrength: 1.0, emissive: '#8B5CF6', emissiveStrength: 1.6 }, 1, 1.2);
    this.scarfMesh = new ClothMesh(this.scarf, '#5a1420', { rim: '#ff8a8a', rimStrength: 0.25, emissive: '#c9a253', emissiveStrength: 1.2 }, 1, 0.5);
    this.group.add(this.batch.mesh, this.ghostBatch.mesh, this.cloakMesh.mesh, this.scarfMesh.mesh);
    this.iChest = layout.idx('chest'); this.iNeck = layout.idx('neck'); this.iPelvis = layout.idx('pelvis');
    this.iKaelis = layout.idx('kaelis'); this.iBlade = layout.idx('blade'); this.iHandR = layout.idx('handR');
    for (let i = 0; i < GHOSTS; i++) this.ghosts.push({ world: new Float32Array(layout.n * 16), age: 99 });
    this.cloak.wind = 1.2; this.scarf.wind = 1.6;
    this.cloak.iterations = 4; this.scarf.iterations = 3;
    this.cloak.damping = 0.94; this.scarf.damping = 0.95;
    this.lunge = {
      L: new Clip({ id: 'lungeL', dur: 0.1, mask: 'full', keys: [{ t: 0, pose: LUNGE_POSE.L as unknown as Record<string, [number, number, number]> }] }, layout),
      R: new Clip({ id: 'lungeR', dur: 0.1, mask: 'full', keys: [{ t: 0, pose: LUNGE_POSE.R as unknown as Record<string, [number, number, number]> }] }, layout),
    };
  }

  /** Замереть в кадре удара на sec реальных секунд, удерживая растяжение (без отката). */
  holdPose(sec: number): void {
    this.hold = Math.max(this.hold, sec);
    this.holdStretch = Math.max(1.06, this.lastStretch);
  }

  /** Финишер/заряд ударил в землю: плащ взлетает и раскрывается. */
  cloakImpulse(up: number, out: number): void {
    const c = this.cloak, s = this.puppet.skel;
    s.jointPoint(this.iChest, 0, 0, 0, _w);
    for (let k = c.w; k < c.n; k++) {
      const o = k * 3, rx = c.p[o] - _w.x, rz = c.p[o + 2] - _w.z, l = Math.hypot(rx, rz) || 1;
      c.q[o] -= (rx / l) * out * 0.016; c.q[o + 2] -= (rz / l) * out * 0.016; c.q[o + 1] -= up * 0.016;
    }
  }

  /**
   * dt — время героя (с замедлением), moveDist/speed — для походки, facing — разворот.
   * running=false подавляет походку (атака на месте).
   */
  update(dt: number, x: number, z: number, facing: number, moveDist: number, speed: number, accel: number, bladeBack: boolean): void {
    const p = this.puppet, s = p.skel;
    this.time += dt;
    // удержание позы на hitstop: клип и походка стоят
    const adt = this.hold > 0 ? 0 : dt;
    this.gait.update(moveDist, speed, accel, adt);
    this.gait.write(p.base, p.layout, this.J, bladeBack);
    p.anim.update(adt);
    p.anim.compose(p.base);
    s.rot.set(p.anim.out);
    this.applyLunge(adt);
    // аддитивные слои: пружина отдачи на корпусе
    p.stepSpring(dt);
    const cf = Math.cos(facing), sf = Math.sin(facing);
    const lx = p.springX * cf - p.springZ * sf, lz = p.springX * sf + p.springZ * cf;
    if (Math.abs(lx) + Math.abs(lz) > 1e-4) {
      addJoint(s.rot, this.J.spine, -lz * 0.6, 0, lx * 0.6);
      addJoint(s.rot, this.J.chest, -lz * 0.4, 0, lx * 0.4);
    }
    // Каэлис парит у плеча (в бою её рисует живой дрон — vfx/kaelis, здесь только точка)
    s.off[this.iKaelis * 3 + 1] = Math.sin(this.time * 2.2) * 0.06;
    const ks = this.kaelisHidden ? 0 : 1;
    s.scl[this.iKaelis * 3] = ks; s.scl[this.iKaelis * 3 + 1] = ks; s.scl[this.iKaelis * 3 + 2] = ks;
    s.setRotEuler(this.iKaelis, Math.sin(this.time * 0.9) * 0.3, this.time * 2.0, 0);
    // клинок ×2 в ульте «Затмение»
    s.scl[this.iBlade * 3] = this.bladeScale; s.scl[this.iBlade * 3 + 1] = this.bladeScale; s.scl[this.iBlade * 3 + 2] = this.bladeScale;

    const r = p.anim.root;
    let st = r.stretch * this.stretch;
    if (this.hold > 0) st = Math.max(st, this.holdStretch);
    else this.lastStretch = st;
    s.facing = facing + r.spin;
    s.x = x + r.z * sf + r.x * cf;
    s.z = z + r.z * cf - r.x * sf;
    s.y = this.lift + this.gait.bob + r.y - this.lungeW * 0.11;
    // скорость поворота корпуса: от неё плащ раскрывается во вращении
    if (adt > 0) {
      let dy = s.facing - this.prevYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yawRate = dy / adt;
    } else this.yawRate = 0;
    this.prevYaw = s.facing;
    if (st >= 1) { const k = 1 / Math.sqrt(st); s.sx = k; s.sy = k; s.sz = st; }
    else { const k = 1 / Math.sqrt(st); s.sx = k; s.sy = st; s.sz = k; }
    if (this.squash !== 1) { s.sy *= this.squash; const k = 1 / Math.sqrt(this.squash); s.sx *= k; s.sz *= k; }
    s.update();

    // скорость кончика клинка (сглаженная)
    if (adt > 0) {
      this.bladePoints(_tb, _tt);
      if (this.tipReady) {
        _tb.copy(_tt).sub(this.prevTip).divideScalar(adt);
        this.tipVel.lerp(_tb, 0.6);
      }
      this.prevTip.copy(_tt);
      this.tipReady = true;
    }

    this.updateCloth(adt);
    this.updateGhosts(dt);
  }

  /** Шаг-выпад (вес 0.6 по маске «всё тело»): ноги из клипа «верх» иначе стоят на месте. */
  private applyLunge(dt: number): void {
    const a = this.puppet.anim, c = a.clip;
    const side = c && !a.done ? LUNGE_CLIPS[c.id] : undefined;
    if (side) this.lungeSide = side;
    // быстро встаёт в выпад к кадру удара, мягче возвращается
    const target = side && a.t < c!.dur * 0.8 ? 0.6 : 0;
    this.lungeW += (target - this.lungeW) * Math.min(1, dt * (target > this.lungeW ? 30 : 8));
    if (this.lungeW < 0.01) return;
    const L = this.lunge[this.lungeSide], q = L.quats[0], rot = this.puppet.skel.rot;
    for (let j = 0; j < L.joints.length; j++) {
      const o = L.joints[j] * 4;
      _qa.fromArray(rot, o); _qb.fromArray(q, j * 4);
      _qa.slerp(_qb, this.lungeW);
      rot[o] = _qa.x; rot[o + 1] = _qa.y; rot[o + 2] = _qa.z; rot[o + 3] = _qa.w;
    }
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
    // вращение корпуса (Удар 3, разворот): ткань раскрывается от центробежного импульса
    const yr = Math.abs(this.yawRate);
    if (yr > 4 && dt > 0) {
      s.jointPoint(this.iChest, 0, 0, 0, _w);
      const out = Math.min(4, yr * 0.09) * dt, c = this.cloak;
      for (let k = c.w; k < c.n; k++) {
        const o = k * 3, rx = c.p[o] - _w.x, rz = c.p[o + 2] - _w.z, l = Math.hypot(rx, rz) || 1;
        c.q[o] -= (rx / l) * out; c.q[o + 2] -= (rz / l) * out; c.q[o + 1] -= out * 0.25;
      }
    }
    if (dt <= 0) { this.cloakMesh.sync(); this.scarfMesh.sync(); return; }
    const sub = dt > 1 / 70 ? 2 : 1;
    for (let i = 0; i < sub; i++) { this.cloak.step(dt / sub); this.scarf.step(dt / sub); }
    this.cloakMesh.sync();
    this.scarfMesh.sync();
  }

  /** Сбросить ткань (телепорт/спаун). */
  resetCloth(): void { this.cloakReady = false; }

  /** Силуэт на месте начала рывка (план §5.4): живёт 0.5 с, вражеская атака раскалывает его. */
  private silhouette: { world: Float32Array; age: number; broken: boolean } | null = null;

  markSilhouette(): void {
    if (!this.silhouette) this.silhouette = { world: new Float32Array(this.puppet.skel.world.length), age: 99, broken: false };
    this.silhouette.world.set(this.puppet.skel.world);
    this.silhouette.age = 0;
    this.silhouette.broken = false;
  }

  shatterSilhouette(): void { if (this.silhouette) this.silhouette.broken = true; }

  private updateGhosts(dt: number): void {
    if (this.silhouette) this.silhouette.age += dt;
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
  /** Скрыть дрона в риге: его рисует отдельный KaelisDrone (бой). */
  kaelisHidden = false;
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
    const sil = this.silhouette;
    if (sil && !sil.broken && sil.age < 0.5) this.ghostBatch.push(sil.world, 0.7 * (1 - sil.age / 0.5), 0, 0.6, 0);
    this.ghostBatch.end();
    const show = visible && !p.skel.broken;
    this.cloakMesh.mesh.visible = show && !blink;
    this.scarfMesh.mesh.visible = show && !blink;
  }
}
