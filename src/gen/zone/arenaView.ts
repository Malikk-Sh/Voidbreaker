import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { hexToLinear } from '../../core/math';
import { inArenaShape, type ArenaDef } from '../../data/arenas';
import { GeomBuilder, mat, matAlong } from '../geom/build';
import { box, prism, shard, rock, lathe } from '../geom/prims';
import {
  arcade, candelabra, chain, column, crackLine, floatingRuin, GOLD, hoodedStatue, OBS, OBS_DEEP, roseWindow, rubble, spire, vein,
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
  dispose(): void;
}

export interface ZoneLook {
  rim: string; veins: string; warm: string; floorTint: string; decorDensity: number;
}

export const ZONE1_LOOK: ZoneLook = { rim: '#5b3fb8', veins: '#8B5CF6', warm: '#FFB866', floorTint: '#14121C', decorDensity: 1 };

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

/** Граница выпуклой формы: расстояние от центра до края по направлению. */
function boundaryAt(def: ArenaDef, a: number, cx = 0, cz = 0): number {
  const dx = Math.sin(a), dz = Math.cos(a);
  let r = 0.5;
  while (r < 60 && inArenaShape(def, cx + dx * r, cz + dz * r)) r += 0.25;
  return r;
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
      if (far && Math.abs(x) < p0.w * 0.36) continue; // там стоит аркада-фасад
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
        place((g) => column(g, { h: side ? rng.range(5.5, 7) : rng.range(8.5, 11.5), r: 0.55, sides: 8, broken, seed: rng.int(0, 1e5) }), x, 0, z);
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
    // фасад на дальней стороне: аркада + розетка
    const fw = p0.w * 0.72;
    const count = Math.max(3, Math.round(fw / 4.4));
    const glass = style === 'candles' || style === 'boss' ? 0.9 : 0.5;
    place((g) => arcade(g, count, 3.2, 4.2, rng.int(0, 1e5), glass), p0.x, 0, farZ - 1.6);
    place((g) => {
      roseWindow(g, 2.6, 12, rng.int(0, 1e5), 1.0);
    }, p0.x, 11.2, farZ - 1.9);
    place((g) => {
      g.color = OBS;
      g.add(box(fw + 3, 6.5, 0.8), { matrix: mat(0, 11.2, 0) });
      for (let k = -1; k <= 1; k += 2) g.add(prism(4, 0.6, 0, 6.5), { matrix: mat(k * (fw / 2 + 1), 14.4, 0, 0, Math.PI / 4) });
      g.add(prism(4, 1.0, 0, 7), { matrix: mat(0, 14.4, 0, 0, Math.PI / 4) });
    }, p0.x, 0, farZ - 2.4);
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
        for (let x = p.x - p.w / 2 + 0.8; x <= p.x + p.w / 2 - 0.8; x += 1.6) {
          for (const sz of [-1, 1]) {
            const z = p.z + sz * (p.h / 2 + 0.15);
            D.add(prism(4, 0.18, 0.14, 0.9), { matrix: mat(x, 0, z, 0, Math.PI / 4), color: OBS });
          }
        }
        for (const sz of [-1, 1]) D.add(box(p.w, 0.14, 0.32), { matrix: mat(p.x, 0.95, p.z + sz * (p.h / 2 + 0.15)), color: GOLD, shade: 0.2 });
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
  // прожилки по полу у стен
  for (let i = 0; i < 0; i++) {
    const g = new GeomBuilder(); g.rng = new Rng(rng.int(0, 1e6));
    const p0 = def.parts[0];
    crackLine(g, 0.01, 0, 0.01, 0, g.rng, 0.4);
    D.append(g, mat(p0.x + rng.spread(p0.w * 0.3), 0, p0.z + rng.spread(p0.h * 0.3)));
  }

  const decor = new THREE.Mesh(D.build(), decorMat);
  decor.frustumCulled = false;
  root.add(decor);

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

  const runeRadius = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.3;

  return {
    root, floor, flames, pools, runeRadius, syncTiles,
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
