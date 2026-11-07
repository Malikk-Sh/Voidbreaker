import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { obsidianMaterial } from '../../render/materials';
import { GeomBuilder, mat, matAlong } from '../geom/build';
import { box, octa, prism } from '../geom/prims';
import { GOLD, OBS, OBS_HI } from '../geom/kit';

/** Что нужно жерновам, дискам, копьям, щиту и лучам гибели из состояния боя (мировые координаты). */
export interface MillstoneView {
  active: boolean;
  dead: boolean;
  body: { x: number; y: number; z: number };
  exposed?: number;
  pose?: string;
  dying?: number;
  burst?: boolean;
  hitFlash?: number;
  stones?: readonly { x: number; z: number; hp: number; maxHp: number; broken: boolean; hitFlash: number; charge: number; grow: number }[];
  discs?: readonly { id: number; x: number; z: number; dx: number; dz: number; r: number; travelled: number; alive: boolean }[];
  lances?: readonly { id: number; x0: number; z0: number; x1: number; z1: number; t: number; dur: number }[];
}

/**
 * Жернова над чашами: y — высота центра колеса; r — радиус; spin / charged — обороты в покое и в разгоне (рад/с);
 * cracks — трещин, которые проступают по мере урона; lanceFly — сколько копьё веера летит до конца луча (с);
 * rays — лучей света из трескающегося ядра при гибели.
 */
export const MILL_LOOK = { y: 2.15, r: 0.95, spin: 0.6, charged: 9, cracks: 8, lanceFly: 0.12, rays: 10 };

const CRIMSON = new THREE.Color('#ff3b4e'), GOLD_HOT = new THREE.Color('#ffcf6e'), WHITE = new THREE.Color('#fff5dc');
const MAX_DISCS = 12, MAX_LANCES = 24;

const additive = (color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/** Колесо жернова: каменный диск с золотым ободом, зубьями и ступицей; ось — локальная Z. */
function millstoneGeometry(): THREE.BufferGeometry {
  const g = new GeomBuilder(); g.rng = new Rng('heart:millstone'); g.color = OBS;
  const disc = new THREE.CylinderGeometry(MILL_LOOK.r, MILL_LOOK.r, 0.34, 20, 1); disc.rotateX(Math.PI / 2);
  g.add(disc, { color: OBS_HI });
  const rim = new THREE.TorusGeometry(MILL_LOOK.r, 0.07, 4, 28);
  for (const z of [-0.18, 0.18]) g.add(rim, { matrix: mat(0, 0, z), color: GOLD });
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    g.add(box(0.2, 0.26, 0.42), { matrix: mat(Math.sin(a) * (MILL_LOOK.r + 0.09), Math.cos(a) * (MILL_LOOK.r + 0.09), 0, 0, 0, -a), color: GOLD });
  }
  const hub = prism(6, 0.3, 0.3, 0.5); hub.rotateX(Math.PI / 2); hub.translate(0, 0, 0.25);
  g.add(hub, { color: GOLD });
  return g.build();
}

/** Каменный диск, который катится по полу: ось лежит поперёк хода. */
function discGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 0.34, 14, 1);
  g.rotateZ(Math.PI / 2);
  return g;
}

/**
 * Жернова, их диски, копья веера, щит жерновов вокруг Сердца и лучи света из ядра при гибели.
 * Всё создаётся при загрузке; каждый кадр меняются только матрицы и прозрачность.
 */
export class HeartMillstones {
  readonly group = new THREE.Group();
  private readonly stones: { root: THREE.Group; spinner: THREE.Group; core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; cracks: THREE.InstancedMesh; spin: number }[] = [];
  private readonly discs: THREE.InstancedMesh;
  private readonly discRims: THREE.InstancedMesh;
  private readonly lanceBeams: THREE.InstancedMesh;
  private readonly lanceHeads: THREE.InstancedMesh;
  private readonly shield: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly rays: THREE.InstancedMesh;
  private readonly color = new THREE.Color();
  private readonly rayDirs: THREE.Vector3[] = [];
  private time = 0;

  constructor() {
    this.group.name = 'heart-millstones';
    const geometry = millstoneGeometry();
    const material = obsidianMaterial({ rim: '#7a5a2e', rimStrength: 0.35, emissive: '#6b2432', emissive2: '#FFB866', emissiveStrength: 0.6 });
    const crackGeo = box(0.05, 0.6, 0.02);
    const crackMat = additive('#ffffff', 0.95);
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Group(), spinner = new THREE.Group();
      root.name = `heart-millstone-${i}`;
      const wheel = new THREE.Mesh(geometry, material); wheel.frustumCulled = false;
      const core = new THREE.Mesh(octa(0.32, 0.32, 0.32), additive(CRIMSON, 0.9)); core.name = 'heart-millstone-core';
      const cracks = new THREE.InstancedMesh(crackGeo, crackMat, MILL_LOOK.cracks); cracks.name = 'heart-millstone-cracks';
      const rng = new Rng(`heart:cracks:${i}`);
      for (let k = 0; k < MILL_LOOK.cracks; k++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(0.25, 0.75), side = k % 2 ? 0.18 : -0.18;
        cracks.setMatrixAt(k, mat(Math.sin(a) * r, Math.cos(a) * r, side, 0, 0, a + rng.spread(0.6), 1, rng.range(0.5, 1.2), 1));
      }
      cracks.count = 0;
      for (const o of [wheel, core, cracks]) { o.frustumCulled = false; spinner.add(o); }
      root.add(spinner); root.visible = false;
      this.group.add(root);
      this.stones.push({ root, spinner, core, cracks, spin: 0 });
    }
    this.discs = new THREE.InstancedMesh(discGeometry(), new THREE.MeshBasicMaterial({ color: '#2b2730' }), MAX_DISCS);
    this.discs.name = 'heart-millstone-discs';
    this.discRims = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.09, 4, 20).rotateY(Math.PI / 2), additive('#ffffff', 0.9), MAX_DISCS);
    this.discRims.name = 'heart-millstone-disc-rims';
    this.lanceBeams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), additive('#ffffff', 0.85), MAX_LANCES);
    this.lanceBeams.name = 'heart-fan-lances';
    this.lanceHeads = new THREE.InstancedMesh(octa(0.22, 0.22, 0.9), additive('#ffffff', 1), MAX_LANCES);
    this.lanceHeads.name = 'heart-fan-lance-heads';
    // Щит жерновов: багрово-золотая оболочка, яркая к краю; тускнеет с каждым разбитым жерновом.
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color('#ff6a4a') }, opacity: { value: 0 }, time: { value: 0 } },
      vertexShader: 'varying vec3 vN;varying vec3 vV;varying vec3 vP;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);vP=position;gl_Position=projectionMatrix*p;}',
      fragmentShader: 'uniform vec3 color;uniform float opacity;uniform float time;varying vec3 vN;varying vec3 vV;varying vec3 vP;void main(){float f=1.0-abs(dot(normalize(vN),normalize(vV)));float hex=0.5+0.5*sin(vP.x*9.0+time*1.5)*sin(vP.y*9.0-time)*sin(vP.z*9.0);gl_FragColor=vec4(color*opacity*(pow(f,2.0)*0.9+hex*0.12),1.0);}',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.shield.name = 'heart-millstone-shield';
    this.rays = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), additive('#ffffff', 0.9), MILL_LOOK.rays);
    this.rays.name = 'heart-death-rays';
    const rng = new Rng('heart:rays');
    for (let i = 0; i < MILL_LOOK.rays; i++) {
      const a = i / MILL_LOOK.rays * Math.PI * 2 + rng.spread(0.25), e = rng.range(-0.35, 0.75);
      this.rayDirs.push(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize());
    }
    for (const m of [this.discs, this.discRims, this.lanceBeams, this.lanceHeads, this.rays]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
    this.shield.frustumCulled = false; this.shield.visible = false; this.group.add(this.shield);
  }

  update(dt: number, v: MillstoneView): void {
    this.time += dt;
    const visible = (v.active || (v.dying ?? 0) > 0) && !v.dead && !v.burst;
    this.updateStones(dt, v, visible);
    this.updateDiscs(v, visible && v.active);
    this.updateLances(v, visible);
    this.updateShield(v, visible && v.active && (v.dying ?? 0) === 0);
    this.updateRays(v);
  }

  /** Колёса: вращаются, в разгоне раскручиваются и светят; урон проступает трещинами; разбитые не видны. */
  private updateStones(dt: number, v: MillstoneView, visible: boolean): void {
    const list = v.stones ?? [];
    for (let i = 0; i < this.stones.length; i++) {
      const s = this.stones[i], st = list[i];
      const show = visible && !!st && !st.broken;
      s.root.visible = show;
      if (!show || !st) continue;
      const grow = 1 - Math.pow(1 - st.grow, 3);
      s.spin += dt * (MILL_LOOK.spin + st.charge * st.charge * MILL_LOOK.charged);
      const wobble = st.hitFlash * 0.18 * Math.sin(this.time * 40);
      s.root.position.set(st.x, MILL_LOOK.y + Math.sin(this.time * 1.4 + i) * 0.08 + st.charge * 0.25, st.z);
      s.root.rotation.set(wobble, Math.atan2(v.body.x - st.x, v.body.z - st.z), 0);
      s.root.scale.setScalar(Math.max(0.001, grow));
      s.spinner.rotation.set(0, 0, s.spin);
      const damage = 1 - st.hp / Math.max(1, st.maxHp);
      s.cracks.count = Math.min(MILL_LOOK.cracks, Math.ceil(damage * MILL_LOOK.cracks));
      // Ядро ступицы: багровое в покое, золотое в разгоне, белое на ударе.
      this.color.copy(CRIMSON).lerp(GOLD_HOT, st.charge).lerp(WHITE, st.hitFlash);
      s.core.material.color.copy(this.color);
      s.core.scale.setScalar(0.85 + st.charge * 0.7 + Math.sin(this.time * 6 + i) * 0.08 + st.hitFlash * 0.5);
      (s.cracks.material as THREE.MeshBasicMaterial).color.copy(GOLD_HOT).lerp(WHITE, 0.4);
    }
  }

  private updateDiscs(v: MillstoneView, visible: boolean): void {
    let n = 0;
    for (const d of visible ? v.discs ?? [] : []) {
      if (!d.alive || n >= MAX_DISCS) continue;
      // Катится: ось поперёк хода, оборот — пройденный путь на радиус.
      const yaw = Math.atan2(d.dx, d.dz), roll = d.travelled / d.r;
      const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(roll));
      m.scale(new THREE.Vector3(d.r, d.r, d.r)).setPosition(d.x, d.r, d.z);
      this.discs.setMatrixAt(n, m);
      this.discRims.setMatrixAt(n, m);
      this.discRims.setColorAt(n, this.color.copy(CRIMSON).lerp(GOLD_HOT, 0.3 + 0.3 * Math.sin(this.time * 18 + d.id)));
      n++;
    }
    this.discs.count = this.discRims.count = n;
    this.discs.instanceMatrix.needsUpdate = this.discRims.instanceMatrix.needsUpdate = true;
    if (this.discRims.instanceColor) this.discRims.instanceColor.needsUpdate = true;
  }

  /** Копьё веера летит из Сердца до конца луча и оставляет гаснущий след. */
  private updateLances(v: MillstoneView, visible: boolean): void {
    let n = 0;
    for (const l of visible ? v.lances ?? [] : []) {
      if (n >= MAX_LANCES) break;
      const k = Math.min(1, l.t / MILL_LOOK.lanceFly), fade = Math.max(0, 1 - l.t / l.dur);
      const hx = l.x0 + (l.x1 - l.x0) * k, hz = l.z0 + (l.z1 - l.z0) * k, y = 1.25;
      const dx = hx - l.x0, dz = hz - l.z0, len = Math.hypot(dx, dz);
      if (len > 0.05) {
        const w = 0.16 + 0.22 * fade;
        this.lanceBeams.setMatrixAt(n, matAlong((l.x0 + hx) / 2, y, (l.z0 + hz) / 2, dx, 0, dz, w, len, w));
        this.lanceBeams.setColorAt(n, this.color.copy(CRIMSON).lerp(GOLD_HOT, 0.25 * fade).multiplyScalar(fade));
        this.lanceHeads.setMatrixAt(n, matAlong(hx, y, hz, dx, 0, dz, 1, 1, 1));
        this.lanceHeads.setColorAt(n, this.color.copy(WHITE).lerp(GOLD_HOT, 0.4).multiplyScalar(k < 1 ? 1 : fade));
        n++;
      }
    }
    this.lanceBeams.count = this.lanceHeads.count = n;
    for (const m of [this.lanceBeams, this.lanceHeads]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  private updateShield(v: MillstoneView, visible: boolean): void {
    const intact = (v.stones ?? []).filter(s => !s.broken).length;
    this.shield.visible = visible && intact > 0;
    if (!this.shield.visible) return;
    const open = (v.exposed ?? 0) > 0 && (v.pose === 'stuck' || v.pose === 'knock');
    const r = 2.9 + Math.sin(this.time * 2.2) * 0.06;
    this.shield.position.set(v.body.x, v.body.y, v.body.z);
    this.shield.scale.set(r, r * 0.95, r);
    const u = this.shield.material.uniforms;
    u.opacity.value = intact / 3 * (open ? 0.75 + (v.hitFlash ?? 0) * 0.8 : 0.32);
    u.time.value = this.time;
  }

  /** Гибель: из трещин ядра бьют лучи света, их длина растёт до вспышки. */
  private updateRays(v: MillstoneView): void {
    const dying = v.dying ?? 0, on = dying > 0 && !v.burst && !v.dead;
    let n = 0;
    if (on) for (let i = 0; i < MILL_LOOK.rays; i++) {
      const start = i / MILL_LOOK.rays * 0.5;
      if (dying < start) continue;
      const k = Math.min(1, (dying - start) / 0.35), d = this.rayDirs[i];
      const len = (1.5 + 5 * k) * (0.85 + 0.15 * Math.sin(this.time * 23 + i)), w = 0.06 + 0.1 * k;
      this.rays.setMatrixAt(n, matAlong(v.body.x + d.x * len / 2, v.body.y + d.y * len / 2, v.body.z + d.z * len / 2, d.x, d.y, d.z, w, len, w));
      this.rays.setColorAt(n, this.color.copy(GOLD_HOT).lerp(WHITE, k * 0.6).multiplyScalar(0.6 + 0.4 * k));
      n++;
    }
    this.rays.count = n;
    this.rays.instanceMatrix.needsUpdate = true;
    if (this.rays.instanceColor) this.rays.instanceColor.needsUpdate = true;
  }
}
