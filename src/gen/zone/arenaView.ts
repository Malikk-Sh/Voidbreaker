import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import { inArenaShape, inOutline, inPart, type ArenaDef, type ShapePart } from '../../data/arenas';
import { GeomBuilder, mat, matAlong } from '../geom/build';
import { box, prism, shard, rock, lathe, starPlate } from '../geom/prims';
import {
  arcade, candelabra, chain, column, floatingRuin, GOLD, hoodedStatue, OBS, OBS_DEEP, OBS_HI, roseWindow, rubble, spire, vein, WAX,
} from '../geom/kit';
import { obsidianMaterial, type ObsidianMaterial } from '../../render/materials';
import { TileState, type Arena } from '../../world/arena';

export interface LightPoolDef { x: number; z: number; r: number; color: string; intensity: number; flicker: number }

export interface ArenaView {
  root: THREE.Group;
  floor: THREE.InstancedMesh[];
  flames: [number, number, number][];
  pools: LightPoolDef[];
  runeRadius: number;
  /** Обновить матрицы плиток (падение/возрождение). */
  syncTiles(): void;
  /** Созвездия на полу загораются: свет бежит по линиям от гвоздя к гвоздю (зачистка волны, победа). */
  lightConstellations(): void;
  /** Анимация живого декора (реальное время). */
  update(realDt: number): void;
  dispose(): void;
}

export interface ZoneLook {
  rim: string; veins: string; warm: string; floorTint: string; decorDensity: number;
}

/** Зона 01: холодный сланец, прожилки звёздного света, тёплые свечи. Фиолет оставлен Пилоту. */
export const ZONE1_LOOK: ZoneLook = { rim: '#3d6688', veins: '#5cc4e0', warm: '#FFB866', floorTint: '#151a22', decorDensity: 1 };

/** Плитка пола со скошенной кромкой; вариант — с прожилкой. */
function tileGeometry(t: number, variant: number, seed: number): THREE.BufferGeometry {
  const b = new GeomBuilder();
  b.rng = new Rng(seed);
  const r = (t / Math.SQRT2) * 0.985;
  b.color = OBS;
  b.shade = 0.06;
  b.add(prism(4, r * 0.97, r * 0.97, 0.7), { matrix: mat(0, -0.78, 0, 0, Math.PI / 4) });
  b.add(prism(4, r * 0.97, r * 0.9, 0.08), { matrix: mat(0, -0.08, 0, 0, Math.PI / 4) });
  if (variant === 1) {
    const rng = new Rng(seed + 5);
    let x = rng.spread(t * 0.3), z = -t * 0.45;
    while (z < t * 0.45) {
      const nx = x + rng.spread(0.25), nz = z + rng.range(0.2, 0.4);
      vein(b, x, -0.01, z, nx - x, 0, nz - z, Math.hypot(nx - x, nz - z), 0.025, 0.4, rng.int(0, 99));
      x = nx; z = nz;
    }
  } else if (variant === 2) {
    // инкрустация: золотой ромб
    b.add(prism(4, r * 0.35, r * 0.35, 0.012), { matrix: mat(0, -0.005, 0), color: GOLD, shade: 0.1 });
    b.add(prism(4, r * 0.28, r * 0.28, 0.016), { matrix: mat(0, -0.004, 0), color: OBS_DEEP });
  }
  return b.build();
}

/** Граница внешнего контура (провалы не в счёт): расстояние от центра до края по направлению. */
function boundaryAt(def: ArenaDef, a: number, cx = 0, cz = 0): number {
  const dx = Math.sin(a), dz = Math.cos(a);
  let r = 0.5;
  while (r < 60 && inOutline(def, cx + dx * r, cz + dz * r)) r += 0.25;
  return r;
}

/** Граница выпуклой части (провала) от её центра. */
function partEdge(p: ShapePart, a: number): number {
  let r = 0.1;
  while (r < 30 && inPart(p, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r)) r += 0.1;
  return r;
}

const CARPET = hexToLinear('#4a1018');
const BRASS = hexToLinear('#8a6a34');

/** Половина семиконечной звезды (расколотая печать): лучи с одной стороны и линия скола через центр. */
function starHalf(rO: number, rI: number, depth: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  for (let i = 0; i <= 7; i++) {
    const r = i % 2 ? rI : rO, a = (i / 14) * Math.PI * 2;
    if (i === 0) sh.moveTo(Math.sin(a) * r, Math.cos(a) * r); else sh.lineTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  sh.lineTo(0.03, -0.02); sh.lineTo(-0.02, 0.04);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Слой созвездий: аддитивные линии и звёзды-гвозди, загораются по порядку пути (aT 0..1). */
function constellationMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uProgress: { value: -1 }, uGlow: { value: 0 } },
    vertexShader: `attribute float aT; attribute float aKind; varying float vT; varying float vKind; varying vec2 vUv;
      void main(){ vT = aT; vKind = aKind; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uProgress, uGlow; varying float vT; varying float vKind; varying vec2 vUv;
      void main(){
        float lit = smoothstep(vT - 0.03, vT + 0.01, uProgress);
        float fresh = exp(-max(0.0, uProgress - vT) * 4.0);
        vec2 c = vUv * 2.0 - 1.0;
        float shape = vKind < 0.5 ? pow(1.0 - abs(c.y), 2.0) : pow(max(0.0, 1.0 - length(c)), 2.2) * 1.6;
        gl_FragColor = vec4(uColor * shape * lit * uGlow * (1.0 + 2.6 * fresh), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
const BANNER = [hexToLinear('#4a1018'), hexToLinear('#14303c')];

/** Знамя: полотнище с ласточкиным хвостом, золотая перекладина и ромб-эмблема. */
function banner(g: GeomBuilder, h: number, color: [number, number, number], seed: number): void {
  const rng = new Rng(seed);
  const s = new THREE.Shape();
  const w = 0.55, tail = rng.range(0.25, 0.45);
  s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w, -h); s.lineTo(0.0, -h + tail); s.lineTo(-w, -h); s.closePath();
  g.add(new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }), { color, shade: 0.12 });
  g.add(box(w * 2 + 0.3, 0.07, 0.07), { matrix: mat(0, 0.03, 0.02), color: GOLD });
  g.add(prism(4, 0.17, 0.17, 0.02), { matrix: mat(0, -h * 0.42, 0.045, Math.PI / 2, 0, 0), color: GOLD, shade: 0.05 });
  g.add(prism(4, 0.08, 0.08, 0.025), { matrix: mat(0, -h * 0.42, 0.05, Math.PI / 2, 0, 0), emissive: 1.2 });
  g.add(box(w * 2 - 0.12, 0.035, 0.04), { matrix: mat(0, -0.16, 0.03), color: GOLD });
}

/** Лучи света из окон фасада: аддитивные полосы, гаснущие к полу. */
function godRayMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float edge = smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x);
        float len = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
        float streak = 0.75 + 0.25 * sin(vUv.x * 19.0 + vUv.y * 3.0);
        gl_FragColor = vec4(uColor * edge * len * streak, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function buildArenaView(arena: Arena, seed: string, look: ZoneLook, density = 1): ArenaView {
  const def = arena.def;
  const rng = new Rng(seed + ':decor');
  const root = new THREE.Group();
  const flames: [number, number, number][] = [];
  const pools: LightPoolDef[] = [];
  const b = arena.bounds;

  // ---------- пол ----------
  const floorMat = obsidianMaterial({ rim: look.rim, rimStrength: 0.06, emissive: look.veins, emissive2: look.warm, spec: 1.0, floor: true });
  const variants = [0, 1, 2].map((v) => tileGeometry(arena.t, v, 11 + v));
  const buckets: number[][] = [[], [], []];
  arena.tiles.forEach((t, idx) => {
    const k = rng.next();
    const onCross = t.cross && def.cross && (Math.abs(Math.abs(t.x) - def.cross.w / 2) < arena.t * 0.6 || Math.abs(Math.abs(t.z) - def.cross.w / 2) < arena.t * 0.6);
    buckets[onCross ? 2 : k < 0.06 ? 1 : k < 0.1 ? 2 : 0].push(idx);
  });
  const floor: THREE.InstancedMesh[] = [];
  const tileRefs: { mesh: THREE.InstancedMesh; slot: number; tile: number; rx: number; rz: number }[] = [];
  const tint = new THREE.Color();
  const baseTint = hexToLinear(look.floorTint);
  buckets.forEach((list, v) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(variants[v], floorMat, list.length);
    m.frustumCulled = false;
    list.forEach((ti, slot) => {
      const k = 0.55 + rng.next() * 1.0;
      tint.setRGB(k * baseTint[0] / OBS[0], k * (0.95 + rng.next() * 0.1) * baseTint[1] / OBS[1], k * (1 + rng.next() * 0.15) * baseTint[2] / OBS[2]);
      m.setColorAt(slot, tint);
      tileRefs.push({ mesh: m, slot, tile: ti, rx: rng.spread(0.016), rz: rng.spread(0.016) });
    });
    floor.push(m);
    root.add(m);
  });

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const syncTiles = () => {
    for (const r of tileRefs) {
      const t = arena.tiles[r.tile];
      if (!t.dirty && !arena.tilesDirty) continue;
      if (t.state === TileState.Gone) {
        _m.makeScale(0, 0, 0);
      } else {
        _q.setFromEuler(_e.set(r.rx + t.rot * 0.7, 0, r.rz + t.rot * 0.4));
        _m.compose(_p.set(t.x, t.y + (Math.abs(r.rx) + Math.abs(r.rz)) * -0.4, t.z), _q, _s);
      }
      r.mesh.setMatrixAt(r.slot, _m);
      r.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const t of arena.tiles) t.dirty = false;
    arena.tilesDirty = false;
  };
  arena.tilesDirty = true;
  syncTiles();
  for (const m of floor) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  // ---------- декор ----------
  const D = new GeomBuilder();
  D.rng = rng;
  const decorMat = obsidianMaterial({ rim: look.rim, rimStrength: 0.14, rimPower: 3.2, emissive: look.veins, emissive2: look.warm, emissiveStrength: 1.8 });
  const place = (fn: (g: GeomBuilder) => void, x: number, y: number, z: number, ry = 0, s = 1) => {
    const g = new GeomBuilder(); g.rng = new Rng(rng.int(0, 1e6));
    fn(g);
    D.append(g, mat(x, y, z, 0, ry, 0, s));
  };
  const style = def.decor;
  const wall = def.edge === 'wall';
  const nearZ = b.maxZ, farZ = b.minZ;
  const farPart = def.parts.reduce((m, p) => (p.z - p.h / 2 < m.z - m.h / 2 ? p : m), def.parts[0]);
  const floorStays = style !== 'boss';
  const freeSpot = (x: number, z: number, m: number) => inArenaShape(def, x, z, m) && !arena.covers.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + m);

  // бортик-кромка и фундамент: огромные осколки, уходящие вниз из-под арены
  const ringN = Math.round(((b.maxX - b.minX) + (b.maxZ - b.minZ)) * 1.4);
  for (let i = 0; i < ringN; i++) {
    const a = (i / ringN) * Math.PI * 2;
    if (def.parts.length > 1) break;
    const r = boundaryAt(def, a, def.parts[0].x, def.parts[0].z);
    const x = def.parts[0].x + Math.sin(a) * (r + 0.25), z = def.parts[0].z + Math.cos(a) * (r + 0.25);
    if (wall) D.add(prism(4, 0.5, 0.42, 0.18), { matrix: mat(x, 0, z, 0, a + Math.PI / 4), color: OBS, shade: 0.15 });
    if (i % 2 === 0) {
      const len = rng.range(3, 9);
      D.add(shard(len, rng.range(0.8, 1.6), 5, 0.3, rng.int(0, 999)), {
        matrix: matAlong(x - Math.sin(a) * 0.6, -0.4, z - Math.cos(a) * 0.6, Math.sin(a) * 0.25, -1, Math.cos(a) * 0.25), color: OBS,
      });
    }
  }
  // центральный «корень» острова
  for (let i = 0; i < 16; i++) {
    const p = rng.pick(def.parts);
    const x = p.x + rng.spread(p.w * 0.35), z = p.z + rng.spread(p.h * 0.35);
    const rad = rng.range(2, 4);
    D.add(shard(rng.range(10, 26), rad, 6, 0.3, rng.int(0, 999)), { matrix: matAlong(x, -1.0 - rad * 0.25, z, rng.spread(0.05), -1, rng.spread(0.05)), color: OBS_DEEP });
  }

  if (wall) {
    // периметр: колонны, статуи, канделябры
    const p0 = def.parts[0];
    const per = Math.PI * (p0.w + p0.h) / 2;
    const n = Math.max(8, Math.round(per / 4.6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.001;
      const r = boundaryAt(def, a, p0.x, p0.z);
      const x = p0.x + Math.sin(a) * (r + 1.2), z = p0.z + Math.cos(a) * (r + 1.2);
      const near = z > nearZ - 3.5;
      const far = z < farZ + 2.5;
      if (far && Math.abs(x - farPart.x) < farPart.w * 0.36) continue; // там стоит аркада-фасад
      if (near) {
        if (rng.next() < 0.6 * density) place((g) => column(g, { h: rng.range(1.2, 2.6), r: 0.5, sides: 8, broken: true, seed: rng.int(0, 1e5) }), x, 0, z);
        else if (rng.next() < 0.7 * density) {
          const c = candelabra(D, x, z, rng.range(0.9, 1.5), rng.int(2, 4), rng.int(0, 1e5));
          flames.push(...c.flames);
          pools.push({ x, z, r: 3.2, color: look.warm, intensity: 0.45, flicker: 1 });
        }
        continue;
      }
      if (i % 3 === 1 && style !== 'candles') {
        place((g) => hoodedStatue(g, rng.range(3.4, 4.2), rng.int(0, 1e5)), x, 0, z, Math.atan2(-Math.sin(a), -Math.cos(a)));
      } else {
        const broken = rng.next() < 0.18;
        // по бокам колонны ниже — ближе к камере они не должны закрывать арену
        const side = Math.abs(Math.sin(a)) > 0.75 && z > farZ + 4;
        const ch = side ? rng.range(5.5, 7) : rng.range(8.5, 11.5);
        place((g) => column(g, { h: ch, r: 0.55, sides: 8, broken, seed: rng.int(0, 1e5) }), x, 0, z);
        // знамёна на колоннах — лицом к арене
        if (!broken && rng.next() < 0.55 * density) {
          const top = Math.min(ch - 0.8, rng.range(5.2, 6.8));
          const col = BANNER[rng.int(0, 1)];
          place((g) => banner(g, rng.range(2.0, 2.8), col, rng.int(0, 1e5)), x - Math.sin(a) * 0.66, top, z - Math.cos(a) * 0.66, Math.atan2(-Math.sin(a), -Math.cos(a)));
        }
      }
      if (rng.next() < 0.5 * density || style === 'candles') {
        const ia = a + 0.32;
        const rr = boundaryAt(def, ia, p0.x, p0.z) - 0.6;
        const cx = p0.x + Math.sin(ia) * rr, cz = p0.z + Math.cos(ia) * rr;
        if (cz < nearZ - 3) {
          const c = candelabra(D, cx, cz, rng.range(1.2, 2.0), rng.int(3, 5), rng.int(0, 1e5));
          flames.push(...c.flames);
          pools.push({ x: cx, z: cz, r: 3.6, color: look.warm, intensity: 0.55, flicker: 1 });
        }
      }
    }
    // фасад на дальней стороне: аркада + розетка (ширина — по самой дальней части: апсида, рукав трансепта)
    const fw = farPart.w * 0.72;
    const count = Math.max(3, Math.round(fw / 4.4));
    const glass = style === 'candles' || style === 'boss' ? 0.9 : 0.5;
    place((g) => arcade(g, count, 3.2, 4.2, rng.int(0, 1e5), glass), farPart.x, 0, farZ - 1.6);
    place((g) => {
      roseWindow(g, 2.6, 12, rng.int(0, 1e5), 1.0);
    }, farPart.x, 11.2, farZ - 1.9);
    place((g) => {
      g.color = OBS;
      g.add(box(fw + 3, 6.5, 0.8), { matrix: mat(0, 11.2, 0) });
      for (let k = -1; k <= 1; k += 2) g.add(prism(4, 0.6, 0, 6.5), { matrix: mat(k * (fw / 2 + 1), 14.4, 0, 0, Math.PI / 4) });
      g.add(prism(4, 1.0, 0, 7), { matrix: mat(0, 14.4, 0, 0, Math.PI / 4) });
    }, farPart.x, 0, farZ - 2.4);
    if (style === 'gate') {
      // Врата: огромная арка с решёткой
      place((g) => gateArch(g), p0.x, 0, farZ - 1.0);
    }
    if (style === 'belfry') {
      // колокол в проёме фасада
      place((g) => {
        g.color = OBS;
        const bell = lathe([[0.05, 0], [1.3, 0.15], [1.15, 0.6], [0.8, 1.6], [0.75, 2.2], [0.4, 2.6], [0.0, 2.7]], 10);
        g.add(bell, { matrix: mat(0, 7.2, 0) });
        g.add(box(0.15, 2.5, 0.15), { matrix: mat(0, 11, 0) });
        g.add(bell.clone().scale(0.98, 0.98, 0.98), { matrix: mat(0, 7.25, 0), emissive: -0.4, color: OBS_DEEP });
      }, p0.x, 0, farZ - 1.4);
      // поминальные свечи кольцом у стен: гаснут по кругу, когда Звонарь заряжает удар (план §7.4)
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + rng.spread(0.05);
        const r = boundaryAt(def, a, p0.x, p0.z) - rng.range(0.5, 1.0);
        const x = p0.x + Math.sin(a) * r, z = p0.z + Math.cos(a) * r;
        if (z > nearZ - 1.5) continue;
        const h = rng.range(0.15, 0.45);
        D.add(prism(6, 0.07, 0.06, h), { matrix: mat(x, 0, z), color: hexToLinear('#5a4a3a') });
        flames.push([x, h + 0.08, z]);
        if (i % 3 === 0) pools.push({ x, z, r: 2.2, color: look.warm, intensity: 0.35, flicker: 1 });
      }
    }
    if (style === 'candles') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        const r = boundaryAt(def, a, p0.x, p0.z) * 0.62;
        const x = p0.x + Math.sin(a) * r, z = p0.z + Math.cos(a) * r;
        if (Math.abs(z) < 2 && Math.abs(x) < 7) continue;
        const c = candelabra(D, x, z, 0.5, rng.int(4, 6), rng.int(0, 1e5));
        flames.push(...c.flames);
        pools.push({ x, z, r: 3.0, color: look.warm, intensity: 0.5, flicker: 1 });
      }
      // оплывшие свечи на полу у стен
      for (let i = 0; i < 26; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = boundaryAt(def, a, p0.x, p0.z) - rng.range(0.3, 0.9);
        const x = p0.x + Math.sin(a) * r, z = p0.z + Math.cos(a) * r;
        if (z > nearZ - 2) continue;
        const h = rng.range(0.15, 0.5);
        D.add(prism(6, 0.07, 0.06, h), { matrix: mat(x, 0, z), color: hexToLinear('#5a4a3a') });
        flames.push([x, h + 0.08, z]);
      }
    }
  } else {
    // мост/островок: балюстрады, обломанные колонны, свисающие цепи
    for (const p of def.parts) {
      const corners = p.kind === 'rect' ? [] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [sx, sz] of corners) {
        const x = p.x + sx * (p.w / 2 - 0.9), z = p.z + sz * (p.h / 2 - 0.9);
        if (!inArenaShape(def, x, z)) continue;
        if (sz > 0) {
          const c = candelabra(D, x, z, 1.1, 3, rng.int(0, 1e5));
          flames.push(...c.flames);
          pools.push({ x, z, r: 3.2, color: look.warm, intensity: 0.5, flicker: 1 });
        } else {
          place((g) => column(g, { h: rng.range(3, 6), r: 0.45, sides: 8, broken: true, seed: rng.int(0, 1e5) }), x, 0, z);
        }
      }
      if (p.kind === 'rect') {
        // балюстрада вдоль длинной стороны моста
        const alongX = p.w >= p.h;
        const len = alongX ? p.w : p.h, half = (alongX ? p.h : p.w) / 2 + 0.15;
        for (let u = -len / 2 + 0.8; u <= len / 2 - 0.8; u += 1.6) {
          for (const sd of [-1, 1]) {
            const x = alongX ? p.x + u : p.x + sd * half, z = alongX ? p.z + sd * half : p.z + u;
            D.add(prism(4, 0.18, 0.14, 0.9), { matrix: mat(x, 0, z, 0, Math.PI / 4), color: OBS });
          }
        }
        for (const sd of [-1, 1]) {
          D.add(box(alongX ? p.w : 0.32, 0.14, alongX ? 0.32 : p.h), { matrix: mat(alongX ? p.x : p.x + sd * half, 0.95, alongX ? p.z + sd * half : p.z), color: GOLD, shade: 0.2 });
        }
      }
    }
    // отдельные столбы-шпили по краям
    if (style === 'hub') {
      place((g) => altar(g), 0, 0, -1.2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const x = Math.sin(a) * 5.3, z = Math.cos(a) * 5.3;
        if (z > 3) {
          const c = candelabra(D, x, z, 1.0, 3, rng.int(0, 1e5));
          flames.push(...c.flames);
          pools.push({ x, z, r: 3, color: look.warm, intensity: 0.5, flicker: 1 });
        } else place((g) => hoodedStatue(g, 3.6, rng.int(0, 1e5)), x, 0, z, Math.atan2(-x, -z));
      }
      pools.push({ x: 0, z: -1.2, r: 4.5, color: look.veins, intensity: 0.6, flicker: 0.2 });
    }
  }

  // общие мелочи: обломки и цепи
  for (let i = 0; i < 8 * density; i++) {
    const a = rng.range(0, Math.PI * 2);
    const p0 = def.parts[0];
    const r = boundaryAt(def, a, p0.x, p0.z) - 1.2;
    const x = p0.x + Math.sin(a) * r, z = p0.z + Math.cos(a) * r;
    if (z > nearZ - 3 || !wall) continue;
    rubble(D, x, z, 1.0, 5, rng.int(0, 1e5));
  }
  if (style === 'boss' || style === 'belfry' || style === 'bridge') {
    for (let i = 0; i < 6; i++) {
      const x = rng.range(b.minX - 6, b.maxX + 6), z = farZ - rng.range(3, 9);
      chain(D, x, 22, z, x + rng.spread(3), rng.range(4, 9), z + rng.spread(2), 0.5);
    }
  }
  // ---------- укрытия: обломанные колонны посреди зала (невысокие — не заслоняют бой), на части — свечи ----------
  for (const c of arena.covers) {
    // низкая колонна-постамент: капитель на высоте h + 0.08 (см. column)
    const h = rng.range(2.9, 3.4);
    place((g) => column(g, { h, r: c.r * 0.8, sides: 8, broken: false, seed: rng.int(0, 1e5) }), c.x, 0, c.z, rng.range(0, Math.PI));
    D.add(prism(8, c.r * 1.25, c.r * 1.15, 0.2), { matrix: mat(c.x, 0, c.z, 0, Math.PI / 8), color: OBS_HI, shade: 0.08 });
    rubble(D, c.x + rng.spread(1.2), c.z + rng.spread(1.2), 0.6, 3, rng.int(0, 1e5));
    if (rng.next() < 0.6) {
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2), rr = c.r * 0.45;
        const ch = rng.range(0.12, 0.3);
        const x = c.x + Math.sin(a) * rr, z = c.z + Math.cos(a) * rr;
        D.add(prism(6, 0.06, 0.05, ch), { matrix: mat(x, h + 0.08, z), color: WAX });
        flames.push([x, h + 0.08 + ch + 0.07, z]);
      }
      pools.push({ x: c.x, z: c.z, r: 2.6, color: look.warm, intensity: 0.4, flicker: 1 });
    }
  }

  // ---------- провалы в полу: обломанная кромка, сталактиты в глубине, свет из бездны ----------
  for (const hole of def.holes ?? []) {
    const per = Math.PI * (hole.w + hole.h) / 2;
    const n = Math.round(per / 0.55);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.spread(0.05);
      const r = partEdge(hole, a);
      const x = hole.x + Math.sin(a) * r, z = hole.z + Math.cos(a) * r;
      // зубцы разбитых плит по краю, наклонены в яму
      D.add(box(rng.range(0.35, 0.7), rng.range(0.25, 0.5), rng.range(0.25, 0.45)), {
        matrix: mat(x - Math.sin(a) * 0.05, -0.22, z - Math.cos(a) * 0.05, rng.spread(0.5), a, rng.spread(0.4)), color: i % 3 ? OBS : OBS_HI, shade: 0.12,
      });
      if (i % 2 === 0) D.add(shard(rng.range(0.8, 2.2), rng.range(0.15, 0.3), 4, 0.3, rng.int(0, 999)), { matrix: matAlong(x, -0.3, z, -Math.sin(a) * 0.4, -1, -Math.cos(a) * 0.4), color: OBS });
      if (i % 5 === 0) vein(D, x, 0.012, z, Math.sin(a), 0, Math.cos(a), rng.range(0.8, 1.6), 0.03, 1.0, rng.int(0, 99));
    }
    // светящаяся кромка — чтобы край ямы читался даже в бою
    const rimN = Math.round(per / 0.35);
    for (let i = 0; i < rimN; i++) {
      const a0 = (i / rimN) * Math.PI * 2, a1 = ((i + 1) / rimN) * Math.PI * 2;
      const r0 = partEdge(hole, a0) + 0.08, r1 = partEdge(hole, a1) + 0.08;
      const x0 = hole.x + Math.sin(a0) * r0, z0 = hole.z + Math.cos(a0) * r0;
      const x1 = hole.x + Math.sin(a1) * r1, z1 = hole.z + Math.cos(a1) * r1;
      vein(D, x0, 0.014, z0, x1 - x0, 0, z1 - z0, Math.hypot(x1 - x0, z1 - z0) + 0.02, 0.03, 0.75, i);
    }
    // далеко внизу — светящееся дно бездны по форме провала
    const sides = hole.kind === 'rect' ? 4 : hole.kind === 'oct' ? 8 : 18;
    const sr = hole.kind === 'rect' ? Math.SQRT1_2 : 0.5;
    D.add(prism(sides, sr, sr, 0.1), { matrix: mat(hole.x, -6.5, hole.z, 0, hole.kind === 'rect' ? Math.PI / 4 : Math.PI / 8, 0, hole.w * 0.95, 1, hole.h * 0.95), color: OBS_DEEP, emissive: 0.45, shade: 0 });
    // глубина: сияющие кристаллы и сталагмиты — видно, что под полом бездна
    for (let k = 0; k < 7; k++) {
      const a = rng.range(0, Math.PI * 2), rr = partEdge(hole, a) * rng.range(0.1, 0.7);
      const x = hole.x + Math.sin(a) * rr, z = hole.z + Math.cos(a) * rr;
      D.add(shard(rng.range(2, 4.5), rng.range(0.3, 0.7), 5, 0.3, rng.int(0, 999)), { matrix: matAlong(x, rng.range(-9, -6), z, rng.spread(0.3), 1, rng.spread(0.3)), color: OBS_DEEP, emissive: k % 3 === 0 ? 0.9 : 0 });
    }
    for (let k = 0; k < 2; k++) {
      const a = rng.range(0, Math.PI * 2), r = partEdge(hole, a);
      chain(D, hole.x + Math.sin(a) * r, -0.1, hole.z + Math.cos(a) * r, hole.x + rng.spread(0.6), -7, hole.z + rng.spread(0.6), 0.3);
    }
    pools.push({ x: hole.x, z: hole.z, r: Math.max(hole.w, hole.h) * 0.75, color: look.veins, intensity: 0.45, flicker: 0.3 });
    if (style === 'candles') {
      // свечи по краю колодца
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + rng.spread(0.08);
        const r = partEdge(hole, a) + rng.range(0.3, 0.6);
        const x = hole.x + Math.sin(a) * r, z = hole.z + Math.cos(a) * r;
        const h = rng.range(0.12, 0.45);
        D.add(prism(6, 0.075, 0.065, h), { matrix: mat(x, 0, z), color: WAX });
        flames.push([x, h + 0.08, z]);
      }
      pools.push({ x: hole.x, z: hole.z, r: Math.max(hole.w, hole.h) * 0.9, color: look.warm, intensity: 0.35, flicker: 1 });
    }
  }

  // ---------- детали пола: дорожка, надгробные плиты, трещины со звёздным светом, обломки ----------
  if (wall && floorStays) {
    if (def.aisle) {
      // ковровая дорожка от входа к фасаду, местами истлела
      const ax = def.parts[0].x;
      for (let z = nearZ - 1.2; z > farZ + 2.2; z -= 1.25) {
        if (!inArenaShape(def, ax, z, 0.5) || rng.next() < 0.07) continue;
        const yaw = rng.spread(0.025), w = 2.3 + rng.spread(0.08);
        D.add(box(w, 0.03, 1.27), { matrix: mat(ax + rng.spread(0.04), 0.018, z, 0, yaw), color: CARPET, shade: 0.08 });
        for (const sx of [-1, 1]) D.add(box(0.1, 0.034, 1.27), { matrix: mat(ax + sx * (w / 2 - 0.16), 0.02, z, 0, yaw), color: GOLD, shade: 0.1 });
      }
    }
    // надгробные плиты со звёздной печатью Литургии (у трети — расколотой)
    const slabs: { x: number; z: number }[] = [];
    for (let tries = 0; tries < 60 && slabs.length < Math.round(7 * density); tries++) {
      const x = rng.range(b.minX + 2, b.maxX - 2), z = rng.range(b.minZ + 2, b.maxZ - 3);
      if (!freeSpot(x, z, 1.4) || Math.abs(x - def.parts[0].x) < 2.2 || slabs.some((q) => Math.hypot(q.x - x, q.z - z) < 2.6)) continue;
      const ry = (rng.int(0, 1) * Math.PI) / 2 + rng.spread(0.06);
      place((g) => {
        g.add(box(1.15, 0.05, 2.0), { matrix: mat(0, 0.025, 0), color: OBS_HI, shade: 0.05 });
        g.add(box(0.95, 0.054, 1.8), { matrix: mat(0, 0.027, 0), color: OBS, shade: 0.05 });
        if (rng.next() < 0.3) {
          const sa = rng.spread(0.4);
          g.add(starHalf(0.42, 0.29, 0.012), { matrix: mat(-0.05, 0.046, -0.12, 0, sa, 0), color: GOLD, shade: 0.05 });
          g.add(starHalf(0.42, 0.29, 0.012), { matrix: mat(0.07, 0.046, -0.05, 0, sa + Math.PI + rng.spread(0.35), 0), color: GOLD, shade: 0.05 });
        } else {
          g.add(starPlate(7, 0.42, 0.29, 0.012), { matrix: mat(0, 0.046, -0.1, 0, rng.spread(0.2), 0), color: GOLD, shade: 0.05 });
          g.add(prism(14, 0.12, 0.12, 0.012), { matrix: mat(0, 0.048, -0.1), color: OBS_DEEP, emissive: 0.25, shade: 0 });
        }
        if (rng.next() < 0.5) g.add(box(1.0, 0.07, 0.03), { matrix: mat(rng.spread(0.1), 0.03, rng.spread(0.6), 0, rng.spread(0.6)), color: OBS_DEEP });
      }, x, 0, z, ry);
      slabs.push({ x, z });
    }
    // трещины, в которых светится звёздная бездна
    for (let i = 0; i < Math.round(6 * density); i++) {
      let x = rng.range(b.minX + 2, b.maxX - 2), z = rng.range(b.minZ + 2, b.maxZ - 2);
      if (!freeSpot(x, z, 0.8)) continue;
      let a = rng.range(0, Math.PI * 2);
      const segs = rng.int(4, 9);
      for (let k = 0; k < segs; k++) {
        a += rng.spread(0.9);
        const len = rng.range(0.4, 0.9);
        const nx = x + Math.sin(a) * len, nz = z + Math.cos(a) * len;
        if (!inArenaShape(def, nx, nz, 0.4)) break;
        vein(D, x, 0.012, z, nx - x, 0, nz - z, len, 0.035 - k * 0.003, 1.1 - k * 0.08, rng.int(0, 99));
        if (rng.next() < 0.3) vein(D, nx, 0.012, nz, Math.sin(a + 1.2), 0, Math.cos(a + 1.2), len * 0.5, 0.02, 0.8, rng.int(0, 99));
        x = nx; z = nz;
      }
    }
    // мелкие обломки плит по всей арене
    for (let i = 0; i < Math.round(18 * density); i++) {
      const x = rng.range(b.minX + 1, b.maxX - 1), z = rng.range(b.minZ + 1, b.maxZ - 1);
      if (!freeSpot(x, z, 0.6)) continue;
      D.add(rock(rng.range(0.06, 0.16), 0, 0.3, rng.int(0, 999)), { matrix: mat(x, 0.03, z, rng.next(), rng.next(), 0, 1, 0.5, 1), color: rng.next() < 0.3 ? OBS_HI : OBS });
    }
  }

  // ---------- созвездия: латунные гвозди и линии на полу, по сиду арены ----------
  const cPos: number[] = [], cUv: number[] = [], cT: number[] = [], cKind: number[] = [], cIdx: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, w: number, t0: number, t1: number, kind: number) => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2;
    const k = cPos.length / 3, y = 0.035;
    cPos.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx - nx, y, bz - nz, bx + nx, y, bz + nz);
    cUv.push(0, 0, 0, 1, 1, 1, 1, 0); cT.push(t0, t0, t1, t1); cKind.push(kind, kind, kind, kind);
    cIdx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  if (floorStays && style !== 'hub') {
    const count = rng.chance(0.5) ? 2 : 1;
    for (let ci = 0; ci < count; ci++) {
      // центр — свободное место подальше от центра рунного круга
      let cx = 0, cz = 0, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        cx = rng.range(b.minX + 3, b.maxX - 3); cz = rng.range(b.minZ + 3, b.maxZ - 3);
        ok = freeSpot(cx, cz, 1.5) && Math.hypot(cx - def.parts[0].x, cz - def.parts[0].z) > 4;
      }
      if (!ok) continue;
      const n = rng.int(5, 9);
      const nails: { x: number; z: number }[] = [];
      for (let tries = 0; tries < 80 && nails.length < n; tries++) {
        const x = cx + rng.spread(3.8), z = cz + rng.spread(3.0);
        if (!freeSpot(x, z, 0.35) || nails.some((q) => Math.hypot(q.x - x, q.z - z) < 1.1)) continue;
        nails.push({ x, z });
      }
      if (nails.length < 4) continue;
      // путь: жадно к ближайшему, плюс одна ветка — у каждой арены свой рисунок
      const order = [nails[0]], rest = nails.slice(1);
      while (rest.length) {
        const last = order[order.length - 1];
        let bi = 0;
        rest.forEach((q, i) => { if (Math.hypot(q.x - last.x, q.z - last.z) < Math.hypot(rest[bi].x - last.x, rest[bi].z - last.z)) bi = i; });
        order.push(rest.splice(bi, 1)[0]);
      }
      const segs: [number, number][] = order.slice(1).map((_, i) => [i, i + 1]);
      if (order.length > 4) segs.push([rng.int(0, 1), order.length - 1 - rng.int(0, 1)]);
      let total = 0;
      const tAt = [0];
      for (let i = 1; i < order.length; i++) { total += Math.hypot(order[i].x - order[i - 1].x, order[i].z - order[i - 1].z); tAt.push(total); }
      for (let i = 0; i < tAt.length; i++) tAt[i] /= total || 1;
      for (const [i0, i1] of segs) {
        const A = order[i0], B = order[i1];
        const len = Math.hypot(B.x - A.x, B.z - A.z), ang = Math.atan2(B.x - A.x, B.z - A.z);
        D.add(box(0.035, 0.012, len), { matrix: mat((A.x + B.x) / 2, 0.012, (A.z + B.z) / 2, 0, ang, 0), color: BRASS, shade: 0.05 });
        quad(A.x, A.z, B.x, B.z, 0.26, tAt[i0], tAt[i1], 0);
      }
      order.forEach((q, i) => {
        D.add(prism(6, 0.06, 0.045, 0.035), { matrix: mat(q.x, 0, q.z), color: BRASS, emissive: -0.35, shade: 0.05 });
        quad(q.x - 0.4, q.z, q.x + 0.4, q.z, 0.8, tAt[i], tAt[i], 1);
      });
    }
  }
  let constellations: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  if (cPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(cUv, 2));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(cT, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(cKind, 1));
    g.setIndex(cIdx);
    constellations = new THREE.Mesh(g, constellationMaterial('#ffd29a'));
    constellations.frustumCulled = false;
    constellations.renderOrder = 2;
    root.add(constellations);
  }
  let cTime = -1;

  const decor = new THREE.Mesh(D.build(), decorMat);
  decor.frustumCulled = false;
  root.add(decor);

  // ---------- лучи света из окон фасада ----------
  if (wall) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const nRays = Math.round(rng.range(3, 5));
    const fw = farPart.w * 0.72;
    for (let i = 0; i < nRays; i++) {
      const tx = farPart.x + ((i + 0.5) / nRays - 0.5) * fw + rng.spread(0.6);
      const top = new THREE.Vector3(tx, rng.range(9, 12), farZ - 1.4);
      const bot = new THREE.Vector3(tx + rng.range(1.2, 2.6), 0.05, farZ + rng.range(5, 9));
      const w = rng.range(1.4, 2.6);
      const k = pos.length / 3;
      pos.push(top.x - w * 0.35, top.y, top.z, top.x + w * 0.35, top.y, top.z, bot.x + w / 2, bot.y, bot.z, bot.x - w / 2, bot.y, bot.z);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const rays = new THREE.Mesh(g, godRayMaterial(style === 'candles' ? '#2a2112' : '#13262e'));
    rays.frustumCulled = false;
    rays.renderOrder = 5;
    root.add(rays);
  }

  // ---------- дальний фон: шпили из бездны, парящие руины ----------
  const F = new GeomBuilder();
  const frng = new Rng(seed + ':far');
  F.rng = frng;
  for (let i = 0; i < 18; i++) {
    const a = frng.range(-Math.PI * 0.75, Math.PI * 0.75) + Math.PI;
    const d = frng.range(70, 240);
    const x = Math.sin(a) * d, z = Math.cos(a) * d - 20;
    const h = frng.range(180, 320);
    const g = new GeomBuilder(); g.rng = new Rng(frng.int(0, 1e6));
    spire(g, { h, r: frng.range(5, 12), tiers: frng.int(3, 6), ruin: frng.chance(0.35) ? frng.range(0.2, 0.5) : 0, seed: frng.int(0, 1e6) });
    F.append(g, mat(x, -h * frng.range(0.75, 0.95), z));
  }
  for (let i = 0; i < 26; i++) {
    const a = frng.range(0, Math.PI * 2);
    const d = frng.range(28, 110);
    const x = Math.sin(a) * d, z = Math.cos(a) * d - 10;
    const g = new GeomBuilder(); g.rng = new Rng(frng.int(0, 1e6));
    floatingRuin(g, frng.range(1.5, 5), frng.int(0, 1e6), frng.chance(0.4));
    F.append(g, mat(x, frng.range(-70, -12), z, 0, frng.range(0, 6), 0));
  }
  for (let i = 0; i < 40; i++) {
    const x = frng.range(-60, 60), z = frng.range(-80, 30);
    if (Math.abs(x) < (b.maxX - b.minX) / 2 + 6 && z > b.minZ - 8 && z < b.maxZ + 6) continue;
    F.add(rock(frng.range(0.4, 1.8), 0, 0.4, frng.int(0, 999)), { matrix: mat(x, frng.range(-30, -4), z, frng.next(), frng.next(), 0), color: OBS });
  }
  const farMat = obsidianMaterial({ rim: look.rim, rimStrength: 0.3, rimPower: 3, emissive: look.veins, emissive2: look.warm, emissiveStrength: 1.4 });
  const far = new THREE.Mesh(F.build(), farMat);
  far.frustumCulled = false;
  root.add(far);

  const p0 = def.parts[0];
  const runeRadius = Math.min(b.maxX - b.minX, b.maxZ - b.minZ, p0.w * 1.2, p0.h * 1.2) * 0.3;

  return {
    root, floor, flames, pools, runeRadius, syncTiles,
    lightConstellations() { cTime = 0; },
    update(realDt: number) {
      if (!constellations || cTime < 0) return;
      cTime += realDt;
      const u = constellations.material.uniforms;
      // 0.8 с свет бежит по линиям, затем созвездие тлеет и гаснет за ~3 с
      u.uProgress.value = Math.min(1.05, cTime / 0.8);
      u.uGlow.value = cTime < 1.2 ? 1 : Math.max(0, 1 - (cTime - 1.2) / 3);
      if (cTime > 4.5) { cTime = -1; u.uGlow.value = 0; u.uProgress.value = -1; }
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as ObsidianMaterial).dispose(); }
      });
    },
  };
}

/** Врата: высокая стрельчатая арка с опущенной решёткой. */
function gateArch(g: GeomBuilder): void {
  g.color = OBS;
  const shape = new THREE.Shape();
  const W = 5.2, H = 9;
  shape.moveTo(-W, 0); shape.lineTo(W, 0); shape.lineTo(W, H); shape.lineTo(0, H + 4.5); shape.lineTo(-W, H); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-3.4, 0); hole.lineTo(-3.4, 6.5); hole.quadraticCurveTo(-3.2, 10.2, 0, 11.4); hole.quadraticCurveTo(3.2, 10.2, 3.4, 6.5); hole.lineTo(3.4, 0); hole.closePath();
  shape.holes.push(hole);
  g.add(new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false }), { matrix: mat(0, 0, -0.7) });
  for (let x = -3; x <= 3; x += 0.75) g.add(box(0.12, 9, 0.12), { matrix: mat(x, 4.6, 0) });
  for (let y = 1; y <= 8; y += 1.4) g.add(box(6.8, 0.1, 0.1), { matrix: mat(0, y, 0) });
  for (let x = -3; x <= 3; x += 0.75) g.add(prism(4, 0.12, 0, 0.4), { matrix: mat(x, -0.1, 0, Math.PI) });
  g.add(box(0.5, 0.5, 0.2), { matrix: mat(0, 12.2, 0.65, 0, 0, Math.PI / 4), emissive: 1, color: OBS_DEEP });
}

/** Алтарь Святилища: ступени, плита, парящий кристалл Пустоты. */
function altar(g: GeomBuilder): void {
  g.color = OBS;
  g.add(prism(8, 2.0, 1.9, 0.25), { matrix: mat(0, 0, 0, 0, Math.PI / 8) });
  g.add(prism(8, 1.5, 1.4, 0.25), { matrix: mat(0, 0.25, 0, 0, Math.PI / 8) });
  g.add(box(1.6, 0.9, 0.8), { matrix: mat(0, 0.95, 0) });
  g.add(box(1.8, 0.1, 0.9), { matrix: mat(0, 1.42, 0), color: GOLD });
  g.add(shard(1.1, 0.25, 5, 0.2, 3), { matrix: mat(0, 2.0, 0), emissive: 1.4, color: OBS_DEEP });
  g.add(shard(0.7, 0.25, 5, 0.2, 4), { matrix: mat(0, 2.0, 0, Math.PI), emissive: 1.4, color: OBS_DEEP });
}
