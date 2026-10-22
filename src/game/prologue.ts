import * as THREE from 'three';
import { RigLayout, Skeleton } from '../anim/skeleton';
import { clamp, hexToLinear } from '../core/math';
import { fxRng, Rng } from '../core/rng';
import { GeomBuilder, mat } from '../gen/geom/build';
import { spire } from '../gen/geom/kit';
import { box, shard } from '../gen/geom/prims';
import { buildCathedralRing, buildDomeRose, buildShip } from '../gen/zone/space';
import { G, obsidianMaterial } from '../render/materials';
import { RigBatch } from '../render/rigbatch';
import { h } from '../ui/dom';
import { LightManager } from '../vfx/lights';
import { Particles } from '../vfx/particles';
import { CameraRig } from '../world/camera';
import { HeroAvatar } from '../world/heroAvatar';
import type { GameContext } from './context';
import { Director, type DirectorHost } from './director';
import { FALL, FallField } from './prologueFall';
import { DOME_IMPACT, prologueTrack, SPACE, SpaceBasis } from './prologueTracks';

type Seg = 'dark' | 'space' | 'fall' | 'done';

const CRIMSON = hexToLinear('#ff3048');
const PILOT = hexToLinear('#d6c4ff');
const VOID = hexToLinear('#B794FF');
const EMBER = hexToLinear('#ffb866');
const GLASS: [number, number, number][] = [hexToLinear('#5cc4e0'), hexToLinear('#FFB866'), hexToLinear('#e3c37e'), hexToLinear('#3d6688')];
/** Лучи соборов: углы на кольце; последний попадает в «Инея». */
const BEAMS = [0.4, 1.7, 2.6, 3.9, 5.2];
const TEXT = 'Разведкорабль «Иней». Орбита погасшей звезды';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/**
 * Пролог «Падение» (план §8.2), планы 1–5: всё на движке, одной дорожкой режиссёра. Тьма с текстом →
 * «Иней» у кольца соборов → багровый луч раскалывает корпус → играбельное падение сквозь пепел и обломки →
 * роза купола 1-1 разлетается в замедлении. Планы 6–8 (приземление, клинок, первая Шелуха) — уже в бою 1-1.
 */
export class Prologue {
  readonly group = new THREE.Group();
  private readonly director: Director;
  private readonly cam = new CameraRig();
  private readonly basis: SpaceBasis;
  private seg: Seg = 'dark';
  /** Часы планов (время симуляции: замедление дорожки растягивает их). */
  private spaceT = 0;
  private fallT = 0;
  private beamsOn = false;
  private hitDone = false;
  private domeOn = false;
  private broken = false;
  private flash = 0;
  private trauma = 0;
  private letterbox = 0;
  private lbTarget = 0;
  private realT = 0;
  private readonly follow = { x: 0, z: 0 };
  // космос
  private readonly ring: THREE.Mesh;
  private readonly ship: RigBatch;
  private readonly shipSkel: Skeleton;
  private readonly parts: { j: number; dir: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private readonly beams: THREE.Mesh[] = [];
  private readonly hitPos = new THREE.Vector3();
  private readonly hitHead = new THREE.Vector3();
  // падение
  private readonly hero = new HeroAvatar();
  private readonly field = new FallField();
  private readonly rocks: THREE.InstancedMesh;
  private readonly plates: THREE.InstancedMesh;
  private readonly spires: THREE.InstancedMesh;
  private readonly spireY: number[] = [];
  private readonly spireXZ: [number, number][] = [];
  private readonly rose: THREE.Mesh;
  private readonly domeRing: THREE.Mesh;
  private readonly norm = new Particles(900, false);
  private readonly add = new Particles(900, true);
  private readonly lights = new LightManager();
  private emitT = 0;
  // DOM: тьма и текст
  private readonly el: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly typed: HTMLElement;
  private readonly rest: HTMLElement;
  private shown = 0;
  private darkTarget = 1;
  private darkK = 1;
  // что вернуть миру после сцены
  private readonly fog = { range: G.uFogRange.value.clone(), height: G.uFogHeight.value.clone(), color: G.uFogColor.value.clone() };
  private readonly fov: number;
  private disposed = false;

  constructor(private ctx: GameContext, layer: HTMLElement, private onDone: (skipped: boolean) => void) {
    const r = ctx.renderer;
    this.fov = r.camera.fov;
    this.basis = new SpaceBasis(r.sky.u.uMoonDir.value);
    const B = this.basis;

    // кольцо соборов вокруг погасшей звезды: плоскость кольца — поперёк взгляда на звезду
    const ringMat = obsidianMaterial({ rim: '#3d6688', rimStrength: 0.35, rimPower: 2.6, emissive: '#c8283c', emissive2: '#FFB866', emissiveStrength: 1.7 });
    this.ring = new THREE.Mesh(buildCathedralRing(SPACE.ringR, SPACE.ringCount), ringMat);
    this.ring.position.copy(B.C);
    this.ring.quaternion.setFromRotationMatrix(_m.makeBasis(B.Rt, B.Up, B.F.clone().negate()));
    this.ring.frustumCulled = false;

    // «Иней»: риг из деталей — при ударе луча детали расходятся
    const sh = buildShip();
    const layout = new RigLayout(sh.rig);
    this.ship = new RigBatch(sh.geometry, layout.n, 1, { rim: '#9fb4d0', rimStrength: 0.7, rimPower: 2.2, emissive: '#d6c4ff', emissive2: '#ffd29a', emissiveStrength: 2.0 });
    this.shipSkel = new Skeleton(layout);
    this.shipSkel.size = 1.4;
    const prng = new Rng(19);
    for (const n of ['nose', 'wingL', 'wingR', 'engine', 'fin']) {
      const j = layout.idx(n), rest = layout.def.joints[j].pos;
      const d = new THREE.Vector3(rest[0], rest[1] + 0.3, rest[2]).normalize();
      this.parts.push({ j, dir: d, spin: new THREE.Vector3(prng.spread(1.2), prng.spread(1.2), prng.spread(1.6)) });
    }
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
    for (let i = 0; i < BEAMS.length; i++) {
      const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(CRIMSON[0] * 3, CRIMSON[1] * 3, CRIMSON[2] * 3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      const glow = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(CRIMSON[0], CRIMSON[1] * 0.6, CRIMSON[2] * 0.6), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(2.6, 1, 2.6);
      core.add(glow);
      core.visible = false; core.frustumCulled = false; glow.frustumCulled = false;
      this.beams.push(core);
    }

    // падение: обломки с красной обводкой (опасность — цвет врага), шпили проносятся мимо
    const debrisMat = obsidianMaterial({ rim: '#ff3b3b', rimStrength: 3.2, rimPower: 1.25, emissive: '#ff4a3a', emissive2: '#FFB866', emissiveStrength: 1.6 });
    const rb = new GeomBuilder(); rb.rng = new Rng(5);
    rb.add(shard(1.9, 0.7, 5, 0.35, 3), { matrix: mat(0, -0.95, 0) });
    rb.add(shard(1.1, 0.45, 4, 0.3, 4), { matrix: mat(0.4, -0.2, 0.2, 0.9, 0, 0.6) });
    // тлеющие сколы — обломок виден и на тёмном небе
    rb.add(box(0.08, 1.5, 0.08), { matrix: mat(0.18, -0.9, 0.2, 0, 0, 0.2), emissive: 1.4 });
    rb.add(box(0.07, 0.9, 0.07), { matrix: mat(-0.2, -0.5, -0.15, 0.4, 0, -0.3), emissive: 1.4 });
    this.rocks = new THREE.InstancedMesh(rb.build(), debrisMat, 12);
    const pb = new GeomBuilder(); pb.rng = new Rng(6); pb.color = hexToLinear('#5a6372');
    pb.add(box(1.6, 0.1, 1.1), { matrix: mat(0, 0, 0, 0.2, 0, 0.1) });
    pb.add(box(0.06, 0.12, 1.0), { matrix: mat(0.4, 0.06, 0), emissive: 1.4 });
    pb.add(box(1.5, 0.12, 0.06), { matrix: mat(0, 0.06, -0.5), emissive: 1.4 });
    this.plates = new THREE.InstancedMesh(pb.build(), debrisMat, 12);
    for (const m of [this.rocks, this.plates]) { m.count = 0; m.frustumCulled = false; }
    const decorMat = obsidianMaterial({ rim: '#3d6688', rimStrength: 0.2, rimPower: 3, emissive: '#5cc4e0', emissive2: '#FFB866', emissiveStrength: 1.6 });
    const sp = new GeomBuilder(); sp.rng = new Rng(8);
    spire(sp, { h: 46, r: 3.2, tiers: 4, seed: 8 });
    this.spires = new THREE.InstancedMesh(sp.build(), decorMat, 6);
    this.spires.frustumCulled = false;
    const srng = new Rng(9);
    for (let i = 0; i < 6; i++) {
      const sx = (i % 2 ? 1 : -1) * srng.range(10, 16), sz = srng.range(-11, 9);
      this.spireXZ.push([sx, sz]);
      this.spireY.push(-120 - i * 55);
    }
    const dome = buildDomeRose(6);
    this.rose = new THREE.Mesh(dome.rose, decorMat);
    this.domeRing = new THREE.Mesh(dome.ring, decorMat);
    for (const m of [this.rose, this.domeRing]) { m.visible = false; m.frustumCulled = false; }

    this.group.add(this.ring, this.ship.mesh, ...this.beams, this.hero.group, this.rocks, this.plates, this.spires, this.rose, this.domeRing, this.norm.mesh, this.add.mesh);
    r.scene.add(this.group);
    // звезда ещё мертва: пролог — до Иерофанта (и при пересмотре из Кинозала)
    r.sky.u.uStarLit.value = 0; r.sky.u.uStar2.value = 0; r.sky.u.uSkyCrack.value = 0;
    // в космосе нет тумана: кольцо за 600 м видно целиком
    G.uFogRange.value.set(500, 1400);
    G.uFogHeight.value.set(-5000, -6000);

    // герой падает лицом вниз; клинка ещё нет — он родится из обломка обшивки (план 7)
    this.hero.bladeScale = 0.001;
    this.hero.cloak.gravity = 13; this.hero.scarf.gravity = 11;
    this.hero.cloak.wind = 3.5; this.hero.scarf.wind = 4;
    this.hero.puppet.play('skydive', 1, 0);
    this.hero.group.visible = false;

    this.typed = h('span', {});
    this.rest = h('span', { style: { opacity: '0' } }, TEXT);
    this.textEl = h('div', { style: { color: '#f4f1ea', fontSize: 'clamp(14px, 2.3vw, 22px)', letterSpacing: '.22em', textAlign: 'center', padding: '0 24px', minHeight: '1.4em' } }, this.typed, this.rest);
    this.el = h('div', { class: 'vb-screen', style: { display: 'grid', placeItems: 'center', background: '#000', pointerEvents: 'none' } }, this.textEl);
    layer.appendChild(this.el);

    ctx.input.enabled = true;
    ctx.input.reset();
    ctx.music.stop(0.6);
    this.director = new Director(this.host());
    this.director.play(prologueTrack(B), (skipped) => this.finish(skipped));
  }

  get active(): boolean { return !this.disposed; }

  private host(): DirectorHost {
    const ctx = this.ctx;
    return {
      actor: () => null,
      timeScale: (scale, dur) => ctx.time.cinematic(dur, scale),
      sfx: (id, gain) => ctx.audio.play(id, { gain }),
      say: (line, sp) => { ctx.hud.subtitle(line, sp); ctx.audio.speak(line, 1, sp); },
      banner: (text, sub, color, dur, size) => ctx.hud.bigBanner(text, sub, color, dur, size),
      flash: (v) => { this.flash = Math.max(this.flash, ctx.settings.flashes ? v : v * 0.25); },
      letterbox: (v) => { this.lbTarget = v; },
      call: (fn, arg) => this.call(fn, arg),
      holding: () => ctx.input.attackHeld,
      tapped: () => false,
      seen: (id) => ctx.save.cine[id] ?? 0,
      markSeen: (id) => { ctx.save.cine[id] = (ctx.save.cine[id] ?? 0) + 1; ctx.persist(); },
      overlay: (skip, tap) => ctx.hud.cineOverlay(skip, tap),
    };
  }

  /** Логика планов (шаги 'call'): при пропуске выполняется подряд, без подачи. */
  private call(fn: string, arg?: number): void {
    switch (fn) {
      case 'dark': this.seg = 'dark'; this.darkTarget = 1; break;
      case 'space':
        this.seg = 'space'; this.darkTarget = 0; this.spaceT = arg ?? 0;
        this.ctx.audio.speak('иней', 1.3);
        break;
      case 'beams': this.beamsOn = true; break;
      case 'hit': this.breakShip(); break;
      case 'blackout': this.darkTarget = 1; this.shown = TEXT.length; this.typed.textContent = ''; this.rest.textContent = ''; break;
      case 'fall':
        this.seg = 'fall'; this.darkTarget = 0; this.fallT = 0;
        this.ring.visible = false; this.ship.mesh.visible = false;
        for (const b of this.beams) b.visible = false;
        this.hero.group.visible = true;
        this.hero.resetCloth();
        // падение сквозь пепел: туман по дальности, без высотного
        G.uFogRange.value.set(30, 170);
        G.uFogColor.value.set(0.02, 0.025, 0.04);
        break;
      case 'hint': {
        const touch = this.ctx.input.lastDevice === 'touch';
        this.ctx.hud.showHint(touch ? 'Левый палец — уходи от обломков' : 'WASD — уходи от обломков');
        break;
      }
      case 'dome': this.domeOn = true; this.rose.visible = true; this.domeRing.visible = true; break;
      case 'end': this.seg = 'done'; break;
    }
  }

  private breakShip(): void {
    if (this.hitDone) return;
    this.hitDone = true;
    this.beamsOn = true;
    this.basis.shipPos(SPACE.hitT, this.hitPos);
    this.basis.shipVel(this.hitHead).normalize();
    this.trauma = 0.8;
    this.lights.flash(this.hitPos.x, this.hitPos.y, this.hitPos.z, CRIMSON, 6, 40, 1.2);
    for (let i = 0; i < 40; i++) {
      const v = _a.set(fxRng.spread(1), fxRng.spread(1), fxRng.spread(1)).normalize().multiplyScalar(fxRng.range(4, 14));
      this.add.emit({ x: this.hitPos.x, y: this.hitPos.y, z: this.hitPos.z, vx: v.x, vy: v.y, vz: v.z, life: fxRng.range(0.8, 1.8), size: fxRng.range(0.15, 0.4), size1: 0.02, color: i % 3 ? [EMBER[0] * 3, EMBER[1] * 2.4, EMBER[2] * 1.6] : [CRIMSON[0] * 3, CRIMSON[1] * 2, CRIMSON[2] * 2], drag: 0.6, frame: 'spark', stretch: 2 });
    }
  }

  private finish(skipped: boolean): void {
    if (this.disposed) return;
    this.onDone(skipped);
  }

  /** Кадр (реальное время). */
  update(realDt: number): void {
    if (this.disposed) return;
    const ctx = this.ctx, T = ctx.time;
    const dt = realDt * T.worldScale;
    this.realT += realDt;
    this.director.update(realDt, this.cam);
    if (this.disposed) return;
    this.lights.begin();
    if (this.seg === 'space') this.updateSpace(dt);
    if (this.seg === 'fall' || this.seg === 'done') this.updateFall(dt, realDt);
    this.lights.end(realDt);
    this.norm.flush(); this.add.flush();
    this.updateDark(realDt);
    this.updateCamera(realDt);
    // вспышка, летербокс
    this.flash = Math.max(0, this.flash - realDt * 1.6);
    const post = ctx.renderer.post.state;
    post.flash = this.flash;
    post.flashColor.setRGB(1, 0.95, 1);
    this.letterbox += (this.lbTarget - this.letterbox) * Math.min(1, realDt * 4);
    post.letterbox = this.letterbox;
    // сенсорное управление: в падении — полностью, в кадрах сцены — бледно (атака держится для пропуска)
    ctx.hud.drawScene(realDt, ctx.input.touchUi ? ctx.input : null, this.seg === 'fall' ? 0.95 : 0.3);
  }

  private updateDark(realDt: number): void {
    // текст печатается в первые секунды, с блипами голоса Каэлис
    const n = Math.min(TEXT.length, Math.max(0, Math.floor((this.realT - 0.3) / 0.04)));
    if (this.seg === 'dark' && !this.hitDone && n > this.shown) {
      if (Math.floor(n / 4) > Math.floor(this.shown / 4)) this.ctx.audio.speak('и', 1.25);
      this.shown = n;
      this.typed.textContent = TEXT.slice(0, n);
      this.rest.textContent = TEXT.slice(n);
    }
    const k = this.darkTarget > this.darkK ? realDt / 0.4 : realDt / 0.9;
    this.darkK = this.darkTarget > this.darkK ? Math.min(this.darkTarget, this.darkK + k) : Math.max(this.darkTarget, this.darkK - k);
    this.el.style.opacity = this.darkK.toFixed(3);
  }

  private updateSpace(dt: number): void {
    this.spaceT += dt;
    const B = this.basis, t = this.spaceT, s = this.shipSkel;
    const pos = _a, head = _b;
    if (!this.hitDone || t < SPACE.hitT) {
      B.shipPos(Math.min(t, SPACE.hitT), pos);
      B.shipVel(head).normalize();
      s.tiltZ = Math.sin(t * 0.7) * 0.06;
    } else {
      // корпус расколот: «Иней» заваливается к шпилям, детали расходятся, кувырок
      const u = t - SPACE.hitT;
      head.copy(this.hitHead).lerp(B.F, Math.min(1, u / 2.4)).normalize();
      B.shipFall(u, pos);
      s.tiltZ = -u * 0.9;
      for (const p of this.parts) {
        const d = 1.6 * u + 0.6 * u * u;
        s.off[p.j * 3] = p.dir.x * d; s.off[p.j * 3 + 1] = p.dir.y * d; s.off[p.j * 3 + 2] = p.dir.z * d;
        s.setRotEuler(p.j, p.spin.x * u, p.spin.y * u, p.spin.z * u);
      }
      // огонь и дым из разлома
      this.emitT -= dt;
      if (this.emitT <= 0) {
        this.emitT = 0.03;
        this.add.emit({ x: pos.x + fxRng.spread(1.5), y: pos.y + fxRng.spread(1), z: pos.z + fxRng.spread(1.5), vx: fxRng.spread(2), vy: fxRng.spread(2), vz: fxRng.spread(2), life: 0.7, size: 0.9, size1: 0.1, color: [EMBER[0] * 2.4, EMBER[1] * 1.4, EMBER[2] * 0.8], drag: 1, frame: 'flare' });
        this.norm.emit({ x: pos.x, y: pos.y, z: pos.z, vx: -head.x * 3, vy: -head.y * 3, vz: -head.z * 3, life: 2.4, size: 1.0, size1: 3.2, color: [0.05, 0.05, 0.07], alpha: 0.55, drag: 0.5, frame: 'smoke' });
      }
    }
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.facing = Math.atan2(head.x, head.z);
    s.tiltX = -Math.asin(clamp(head.y, -1, 1));
    s.update();
    this.ship.begin();
    this.ship.push(s.world, 0, 0, this.hitDone ? 0.2 : 1, this.hitDone ? Math.min(1, (t - SPACE.hitT) * 2) : 0);
    this.ship.end();
    // огни двигателей — фиолетово-белый свет Пилота
    if (!this.hitDone) this.lights.add(pos.x - head.x * 6, pos.y - head.y * 6, pos.z - head.z * 6, PILOT, 2.2, 14);
    this.updateBeams(pos);
  }

  /** Багровые лучи из соборов тянутся к «Инею»; четыре проходят мимо, пятый попадает. */
  private updateBeams(ship: THREE.Vector3): void {
    if (!this.beamsOn) return;
    const B = this.basis;
    const grow = clamp((this.spaceT - SPACE.beamsT) / SPACE.beamGrow, 0, 1);
    const fade = this.hitDone ? clamp(1 - (this.spaceT - SPACE.hitT) / 1.2, 0, 1) : 1;
    for (let i = 0; i < this.beams.length; i++) {
      const m = this.beams[i];
      const from = B.ringPoint(BEAMS[i], _c);
      const last = i === this.beams.length - 1;
      // промахи — перед носом корабля, мимо камеры: луч «ищет» цель
      const tgt = last ? (this.hitDone ? this.hitPos : ship) : _t.copy(ship).addScaledVector(B.Rt, -9 - i * 6).addScaledVector(B.Up, (i - 1.5) * 7);
      const k = last ? grow : Math.min(1, grow * (1.1 + i * 0.08));
      const dir = _s.copy(tgt).sub(from);
      const len = dir.length() * k;
      dir.normalize();
      m.visible = len > 1 && fade > 0;
      m.position.copy(from);
      m.quaternion.setFromUnitVectors(_up, dir);
      const w = (last ? 0.55 : 0.4) * fade * (0.85 + Math.sin(this.realT * 30 + i) * 0.15);
      m.scale.set(w, len, w);
    }
    if (this.hitDone && fade > 0) this.lights.add(this.hitPos.x, this.hitPos.y, this.hitPos.z, CRIMSON, 3 * fade, 30);
  }

  private updateFall(dt: number, realDt: number): void {
    this.fallT += dt;
    const f = this.field, input = this.ctx.input, H = this.hero;
    // до купола — обломки; в розу герой входит сам
    const hit = this.fallT < DOME_IMPACT ? f.step(dt, input.moveX, input.moveZ) : null;
    if (hit) {
      this.trauma = Math.min(1, this.trauma + 0.45);
      this.ctx.audio.play('hit_armor', { gain: 0.6 });
      input.vibrate(30);
      for (let i = 0; i < 14; i++) this.add.emit({ x: f.hx + fxRng.spread(0.3), y: 0.3, z: f.hz + fxRng.spread(0.3), vx: fxRng.spread(7), vy: fxRng.range(0, 6), vz: fxRng.spread(7), life: 0.45, size: 0.12, size1: 0.01, color: [EMBER[0] * 3, EMBER[1] * 2.4, EMBER[2] * 1.4], drag: 3, frame: 'spark', stretch: 2.5 });
    }
    // шрам разгорается по ходу падения
    H.glow = 0.3 + clamp(this.fallT / DOME_IMPACT, 0, 1) * 1.6;
    // ровно в плоскости y = 0: грудь — над точкой стика; корпус лицом вниз, головой к верху кадра
    const sk = H.puppet.skel;
    sk.tiltX = 1.35 - f.vz * 0.025;
    sk.tiltZ = -f.vx * 0.05;
    H.lift = -0.3;
    H.update(dt, f.hx, f.hz + 1.4, Math.PI, 0, 0, 0, true);
    H.render(true, false);
    H.chestPos(_a);
    this.lights.add(_a.x, _a.y + 0.6, _a.z, VOID, 0.6 + H.glow * 0.6, 5);

    // обломки
    let nr = 0, np = 0;
    for (const d of f.debris) {
      const mesh = d.kind ? this.plates : this.rocks;
      _e.set(d.rot, d.rot * 0.7, d.rot * 0.3);
      _m.compose(_c.set(d.x, d.y, d.z), _q.setFromEuler(_e), _s.setScalar(d.r * (d.kind ? 1.35 : 1.15)));
      mesh.setMatrixAt(d.kind ? np++ : nr++, _m);
    }
    this.rocks.count = nr; this.plates.count = np;
    this.rocks.instanceMatrix.needsUpdate = true; this.plates.instanceMatrix.needsUpdate = true;
    // шпили собора проносятся мимо
    for (let i = 0; i < this.spireY.length; i++) {
      this.spireY[i] += FALL.speed * dt;
      if (this.spireY[i] > 30 && this.fallT < DOME_IMPACT - 3) this.spireY[i] -= 330;
      _m.makeTranslation(this.spireXZ[i][0], this.spireY[i] - 46, this.spireXZ[i][1]);
      this.spires.setMatrixAt(i, _m);
    }
    this.spires.instanceMatrix.needsUpdate = true;
    // пепел и искры летят навстречу — линии скорости
    this.emitT -= realDt;
    if (this.emitT <= 0) {
      this.emitT = 0.02;
      for (let i = 0; i < 3; i++) this.norm.emit({ x: fxRng.spread(13), y: fxRng.range(-34, -6), z: fxRng.spread(9), vy: FALL.speed * 1.05, life: 1.3, size: fxRng.range(0.04, 0.09), color: [0.3, 0.29, 0.33], alpha: 0.7, frame: 'dot', stretch: 0.7 });
      if (fxRng.chance(0.3)) this.add.emit({ x: fxRng.spread(12), y: -30, z: fxRng.spread(8), vy: FALL.speed * 1.1, life: 1.2, size: 0.06, color: [EMBER[0] * 2, EMBER[1] * 1.4, EMBER[2]], frame: 'dot', stretch: 1 });
    }
    // купол
    if (this.domeOn) {
      const y = (this.fallT - DOME_IMPACT) * FALL.speed;
      this.rose.position.set(0, y, 0);
      this.domeRing.position.set(0, y, 0);
      if (!this.broken && this.fallT >= DOME_IMPACT) this.shatterRose();
      if (y > 30) this.domeRing.visible = false;
    }
  }

  /** Пилот пробивает розу: осколки витража разлетаются в замедлении, звон стекла, затем тишина. */
  private shatterRose(): void {
    this.broken = true;
    this.rose.visible = false;
    this.trauma = 0.7;
    this.ctx.audio.play('glass_break', { gain: 1 });
    this.lights.flash(0, 0.5, 0, GLASS[1], 4, 14, 1.5);
    const f = this.field;
    for (let i = 0; i < 260; i++) {
      // часть осколков падает рядом с Пилотом, остальные уходят вверх вместе с куполом
      const near = i % 5 < 2;
      const a = fxRng.range(0, Math.PI * 2), d = near ? Math.sqrt(fxRng.next()) * 2.6 : 1.5 + Math.sqrt(fxRng.next()) * 4.4;
      const cx = near ? f.hx : 0, cz = near ? f.hz : 0;
      const c = GLASS[i % GLASS.length], out = near ? fxRng.range(0.6, 3) : fxRng.range(2, 7), k = i % 6 === 0 ? 2.4 : 1.3;
      (i % 4 === 0 ? this.add : this.norm).emit({
        x: cx + Math.cos(a) * d, y: fxRng.spread(0.4), z: cz + Math.sin(a) * d,
        vx: Math.cos(a) * out, vy: near ? fxRng.range(-2, 5) : FALL.speed * fxRng.range(0.4, 0.8), vz: Math.sin(a) * out,
        life: fxRng.range(2.4, 3.6), size: fxRng.range(0.06, 0.22), size1: 0.03, color: [c[0] * k, c[1] * k, c[2] * k],
        drag: 0.25, frame: 'shard', spin: fxRng.spread(9),
      });
    }
  }

  private updateCamera(realDt: number): void {
    const cam = this.ctx.renderer.camera;
    this.cam.update(realDt, 0, 0, 0, 0, cam);
    // в падении кадр сдвигается за героем (без поворота): стик не уводит Пилота к краю экрана
    if (this.seg === 'fall' || this.seg === 'done') {
      const k = 1 - Math.exp(-realDt / 0.35);
      this.follow.x += (this.field.hx * 0.6 - this.follow.x) * k;
      this.follow.z += (this.field.hz * 0.6 - this.follow.z) * k;
      cam.position.x += this.follow.x; cam.position.z += this.follow.z;
    }
    this.trauma = Math.max(0, this.trauma - realDt * 1.4);
    const s = this.trauma * this.trauma;
    if (s > 0.001) {
      cam.position.x += fxRng.spread(0.35) * s; cam.position.y += fxRng.spread(0.35) * s; cam.position.z += fxRng.spread(0.35) * s;
      cam.rotation.z += fxRng.spread(0.03) * s;
    }
  }

  /** Пропустить сцену (из Кинозала — тоже удержанием атаки). */
  skip(): void { this.director.skip(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const r = this.ctx.renderer;
    this.director.clear(this.cam);
    r.scene.remove(this.group);
    this.el.remove();
    this.hero.dispose();
    this.ship.dispose();
    for (const m of [this.ring, this.rose, this.domeRing]) m.geometry.dispose();
    this.rocks.dispose(); this.plates.dispose(); this.spires.dispose();
    this.lights.clear();
    G.uFogRange.value.copy(this.fog.range);
    G.uFogHeight.value.copy(this.fog.height);
    G.uFogColor.value.copy(this.fog.color);
    r.camera.fov = this.fov; r.camera.updateProjectionMatrix();
    r.post.state.flash = 0; r.post.state.letterbox = 0;
    this.ctx.hud.cineOverlay(0, null);
    this.ctx.hud.draw(0, null as never);
    this.ctx.time.reset();
  }
}
