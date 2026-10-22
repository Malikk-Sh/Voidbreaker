import * as THREE from 'three';
import { inPart } from '../data/arenas';
import type { StageDef } from '../data/stages';
import { buildGiantBell, buildGiantGate, buildGuardianSilhouette, buildWreck } from '../gen/zone/setPieces';
import { ZONE1_LOOK, type ArenaView } from '../gen/zone/arenaView';
import { obsidianMaterial } from '../render/materials';
import { overlaps, type Shape } from '../world/combat';
import type { Enemy } from '../world/enemy';
import type { World } from '../world/world';
import type { BattleVfx } from '../vfx/battleVfx';
import type { StageVista } from './cinematics';

/** 1-2: колонна падает за столько (с), давит полосой длиной/шириной (м). */
export const COLUMN_FALL = { dur: 0.65, len: 3.8, w: 1.5, reach: 2.6, dmg: 6 };
/** 1-5: какие пролёты моста рушатся после волн (индексы частей арены) и предупреждение (с). */
export const BRIDGE_SPANS = [1, 2, 5];
export const SPAN_WARN = 1.4;
/** 1-6: высота подвеса и масштаб колокола (нижний край на y − 7.4·scale). */
export const BELL = { y: 34, scale: 1.4 };
/** 1-3: ворота-гигант стоят на месте дальнего фасада — чуть за краем арены. */
const GATE_Z = (minZ: number) => minZ - 4;

/**
 * Своё событие каждой арены (план §8.5): обломки «Инея» над 1-1, падающие колонны 1-2, ворота-гигант и
 * силуэт Стража на 1-3, свечное поле 1-4, рушащийся мост 1-5, огромный колокол 1-6.
 */
export class ArenaEvents {
  /** 1-4: доля погашенного свечного поля 0..1 (гасят волны, зажигает зачистка). */
  fieldOut = 0;
  private fieldTarget = 0;
  private silhouette: THREE.Mesh | null = null;
  private haze: THREE.Mesh | null = null;
  private bell: THREE.Object3D | null = null;
  private bellAmp = 0.03;
  private bellT = 0;
  private bellSide = 1;
  private readonly falling: { m: THREE.Mesh; t: number; dx: number; dz: number; hit: boolean; axis: THREE.Vector3; x: number; z: number }[] = [];
  private readonly standing: { m: THREE.Mesh; cover: { x: number; z: number; r: number } }[] = [];
  private spanIdx = 0;
  private readonly cx: number;
  private readonly stageId: string;

  constructor(private readonly w: World, view: ArenaView, group: THREE.Group, private readonly vfx: BattleVfx, stage: StageDef) {
    const b = w.arena.bounds, id = stage.id;
    this.stageId = id;
    const enemyMat = obsidianMaterial({ rim: ZONE1_LOOK.rim, rimStrength: 0.25, rimPower: 3, emissive: ZONE1_LOOK.veins, emissive2: '#E11D2E', emissiveStrength: 1.8 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.frustumCulled = false; group.add(o); return o;
    };
    const cx = (b.minX + b.maxX) / 2;
    this.cx = cx;
    if (id === '1-1') add(buildWreck(), obsidianMaterial({ rim: '#9fb4d0', rimStrength: 0.5, rimPower: 2.4, emissive: '#d6c4ff', emissive2: '#ffd29a', emissiveStrength: 1.6 }), 0, 0, b.minZ);
    if (id === '1-3') {
      // ворота встают на место дальнего фасада; старая арка-калитка остаётся в их проёме
      const gateMat = obsidianMaterial({ rim: ZONE1_LOOK.rim, rimStrength: 0.3, rimPower: 2.6, emissive: ZONE1_LOOK.veins, emissive2: '#E11D2E', emissiveStrength: 1.4 });
      add(buildGiantGate(), gateMat, cx, -2, GATE_Z(b.minZ));
      // сбоку от арки-калитки, чтобы она его не заслоняла; в полтора роста — гигант за решёткой
      this.silhouette = add(buildGuardianSilhouette(), enemyMat, cx + 7.5, -3, GATE_Z(b.minZ) - 7);
      this.silhouette.scale.setScalar(1.35);
      this.silhouette.rotation.y = -0.25;
      // багровое марево за Стражем: на нём читается чёрный силуэт сквозь решётку
      this.haze = add(new THREE.PlaneGeometry(40, 36), hazeMaterial(), cx + 6, 12, GATE_Z(b.minZ) - 13);
      this.haze.renderOrder = -1;
    }
    if (id === '1-6') {
      const bz = b.minZ + (b.maxZ - b.minZ) * 0.3;
      // выше боевой камеры (до ~22 м при рамке Стража): в бою не заслоняет схватку, виден в интро и в «Ярости»
      this.bell = add(buildGiantBell(), obsidianMaterial({ rim: '#c9a253', rimStrength: 0.35, rimPower: 2.6, emissive: '#FFB866', emissive2: '#FF8A3D', emissiveStrength: 1.2 }), cx, BELL.y, bz);
      this.bell.scale.setScalar(BELL.scale);
    }
    if (id === '1-2') view.coverMeshes.forEach((m, i) => { const c = w.arena.covers[i]; if (c) this.standing.push({ m, cover: c }); });

    const bus = w.bus;
    bus.on('spawned', (e) => {
      if (!(e.actor as Enemy).isGuardian) return;
      if (this.silhouette) this.silhouette.visible = false;
      if (this.haze) this.haze.visible = false;
    });
    // 1-6: ярость Звонаря — колокол вздрагивает и начинает раскачиваться (план «Ярость» смотрит на него)
    bus.on('guardianRage', () => {
      if (!this.bell) return;
      this.bellAmp = Math.max(this.bellAmp, 0.2);
      bus.emit('sfx', { id: 'boss_bell', x: this.bell.position.x, z: this.bell.position.z, gain: 0.6 });
    });
    bus.on('waveStart', () => { if (id === '1-4') this.fieldTarget = 0.86; });
    bus.on('waveClear', (e) => {
      if (id === '1-4') this.fieldTarget = 0;
      if (id === '1-5' && e.index + 1 < e.total) this.collapseSpan();
    });
    if (id === '1-2') {
      bus.on('impact', (e) => { if (e.r >= 2.5 || e.kind === 'slam') this.shove(e.x, e.z); });
      bus.on('strike', (e) => { if (e.source === 'blade' && (e.feel === 'heavy' || e.feel === 'break')) this.shove(e.x, e.z); });
    }
  }

  /**
   * Низкий план на декорацию для интро этапа (из боевой камеры сверху её не видно): из-за плеча Пилота
   * (hx, hz) — на ворота 1-3 и обломки «Инея» 1-1, снизу — на колокол 1-6. null — арена без такого плана.
   */
  vista(hx: number, hz: number): StageVista | null {
    const b = this.w.arena.bounds, cx = this.cx;
    const V = (p: [number, number, number], l: [number, number, number], d: [number, number, number], fov?: number): StageVista =>
      ({ pos: new THREE.Vector3(...p), look: new THREE.Vector3(...l), drift: new THREE.Vector3(...d), fov });
    switch (this.stageId) {
      case '1-1': return V([hx - 1.4, 1.1, hz + 4.5], [cx + 8, 52, b.minZ - 60], [0.8, 0.4, -1.6]);
      case '1-3': return V([hx + 1.5, 1.2, hz + 6], [cx + 2, 15, GATE_Z(b.minZ)], [-0.6, 0.4, -2.2], 56);
      case '1-6': if (this.bell) return V([cx + 4, 1.4, this.bell.position.z + 19], [cx, BELL.y - 5, this.bell.position.z], [-1.5, 0.4, -2.5], 40); return null;
      default: return null;
    }
  }

  /** Что над головой (центр колокола 1-6) — план «Ярость» Стража поднимает на это взгляд; иначе null. */
  overhead(): THREE.Vector3 | null {
    return this.bell ? new THREE.Vector3(this.bell.position.x, this.bell.position.y - 3.6 * BELL.scale, this.bell.position.z) : null;
  }

  /** camY — высота камеры: колокол виден, только пока камера ниже его края (сверху он лишь заслонял бы бой). */
  update(realDt: number, dtW: number, camY = 0): void {
    if (this.bell) this.bell.visible = camY < this.bell.position.y - 7.4 * BELL.scale;
    this.fieldOut += (this.fieldTarget - this.fieldOut) * Math.min(1, realDt * (this.fieldTarget > this.fieldOut ? 0.9 : 1.6));
    this.updateBell(dtW);
    this.updateColumns(dtW);
  }

  // ------------------------------------------------------------------ 1-6 колокол
  /** На кульминации (Звонарь в ярости) колокол над головой раскачивается и гудит на краях размаха. */
  private updateBell(dt: number): void {
    const b = this.bell;
    if (!b) return;
    let g: Enemy | null = null;
    for (const e of this.w.enemies) if (e.isGuardian && !e.dead) g = e;
    const rage = g && (g as { phase?: number }).phase === 2;
    this.bellAmp += ((rage ? 0.26 : g ? 0.08 : 0.03) - this.bellAmp) * Math.min(1, dt * 0.6);
    this.bellT += dt * 1.15;
    const a = Math.sin(this.bellT) * this.bellAmp;
    b.rotation.z = a;
    const side = Math.sign(Math.cos(this.bellT));
    if (side !== this.bellSide) {
      this.bellSide = side;
      if (this.bellAmp > 0.15) this.w.bus.emit('sfx', { id: 'boss_bell', x: b.position.x, z: b.position.z, gain: 0.35 });
    }
  }

  // ------------------------------------------------------------------ 1-2 колонны
  /** Тяжёлый удар рядом с колонной валит её прочь от удара. */
  private shove(x: number, z: number): void {
    for (let i = this.standing.length - 1; i >= 0; i--) {
      const s = this.standing[i], c = s.cover;
      const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
      if (d > COLUMN_FALL.reach + c.r) continue;
      const nx = d > 0.1 ? dx / d : 0, nz = d > 0.1 ? dz / d : 1;
      this.standing.splice(i, 1);
      // больше не укрытие: навигация пересоберётся
      const k = this.w.arena.covers.indexOf(c);
      if (k >= 0) { this.w.arena.covers.splice(k, 1); this.w.arena.version++; }
      this.falling.push({ m: s.m, t: 0, dx: nx, dz: nz, hit: false, axis: new THREE.Vector3(nz, 0, -nx), x: c.x, z: c.z });
      this.w.bus.emit('sfx', { id: 'shatter_stone', x: c.x, z: c.z });
    }
  }

  private updateColumns(dt: number): void {
    for (const f of this.falling) {
      if (f.t >= COLUMN_FALL.dur) continue;
      f.t = Math.min(COLUMN_FALL.dur, f.t + dt);
      const u = f.t / COLUMN_FALL.dur;
      f.m.quaternion.setFromAxisAngle(f.axis, (Math.PI / 2 - 0.08) * u * u);
      if (u >= 1 && !f.hit) {
        f.hit = true;
        // давит полосой вдоль падения: рядовых насмерть, крупных — тяжело
        const sh: Shape = { k: 'line', x: f.x, z: f.z, dx: f.dx, dz: f.dz, len: COLUMN_FALL.len, w: COLUMN_FALL.w };
        this.w.beginStrike();
        for (const e of this.w.enemies) {
          if (!e.targetable || !overlaps(sh, e.x, e.z, e.radius)) continue;
          this.w.damageEnemy(e, { mult: COLUMN_FALL.dmg, stun: 25, knockback: 6, feel: 'heavy', dirX: f.dx, dirZ: f.dz, source: 'env' });
        }
        this.w.endStrike({ dirX: f.dx, dirZ: f.dz, source: 'env' });
        const ex = f.x + f.dx * COLUMN_FALL.len * 0.6, ez = f.z + f.dz * COLUMN_FALL.len * 0.6;
        this.w.bus.emit('impact', { x: ex, z: ez, r: 2.2, kind: 'slam' });
        this.w.bus.emit('shake', { trauma: 0.45 });
        this.w.bus.emit('sfx', { id: 'slam', x: ex, z: ez });
        this.vfx.debris.burst(ex, 0.6, ez, f.dx, f.dz, 10, 6, 0.2);
      }
    }
  }

  // ------------------------------------------------------------------ 1-5 мост
  /** После волны рушится пролёт, на котором нет Пилота: тряска плит, затем — в бездну навсегда. */
  private collapseSpan(): void {
    const a = this.w.arena, h = this.w.hero, parts = a.def.parts;
    while (this.spanIdx < BRIDGE_SPANS.length) {
      const pi = BRIDGE_SPANS[this.spanIdx++];
      const span = parts[pi];
      if (!span) continue;
      // соседние площадки остаются: рушится только пролёт
      const keep = parts.filter((_, i) => i !== pi && !BRIDGE_SPANS.includes(i));
      const tiles = a.tiles.filter((t) => inPart(span, t.x, t.z) && !keep.some((k) => inPart(k, t.x, t.z)));
      if (!tiles.length || tiles.some((t) => Math.hypot(t.x - h.x, t.z - h.z) < 2.2)) continue;
      for (const t of tiles) a.breakTile(t, 0, SPAN_WARN + Math.hypot(t.x - span.x, t.z - span.z) * 0.06);
      this.w.bus.emit('sfx', { id: 'shatter_big', x: span.x, z: span.z });
      this.w.bus.emit('shake', { trauma: 0.35 });
      this.w.bus.emit('voice', { line: 'Мост рушится! Держись середины.', speaker: 'kaelis' });
      return;
    }
  }
}

/** Мягкое багровое свечение (радиальный градиент) для фона силуэта Стража. */
function hazeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#E11D2E') } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying vec2 vUv;
      void main() {
        vec2 p = (vUv - vec2(0.5, 0.42)) * vec2(1.0, 1.25);
        float k = exp(-dot(p, p) * 9.0);
        gl_FragColor = vec4(uColor * k * 0.42, 1.0);
      }
    `,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
