import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { BRAZIERS } from '../../world/candleRitual';
import { GeomBuilder, mat, SURF } from '../geom/build';
import { box, lathe, octa, prism, shard, starPlate } from '../geom/prims';
import { chain, GOLD, OBS, OBS_DEEP, WAX } from '../geom/kit';
import { obsidianMaterial } from '../../render/materials';
import type { LightPoolDef } from './arenaView';

export interface CandleSanctumState {
  drain: number;
  lit: readonly boolean[];
  broken: boolean;
  carried: number;
  chargingIndex: number;
  charge: number;
  warning?: number;
  /** Координаты героя относительно корня зала. */
  hero?: { x: number; z: number };
}

const GOLD_FIRE = new THREE.Color('#ffc879');
const COLD = new THREE.Color('#244454');
const DANGER = new THREE.Color('#b32936');

/** Погребальное сердце и три жаровни. Обычные фитили входят в общий, полностью гасимый батч Flames. */
export class CandleSanctum {
  readonly root = new THREE.Group();
  readonly flames: [number, number, number][] = [];
  readonly pools: LightPoolDef[] = [];
  readonly caster: THREE.Mesh;
  private readonly heart: THREE.InstancedMesh;
  private readonly core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly crown: THREE.Mesh;
  private readonly fire: THREE.InstancedMesh;
  private readonly chargeRings: THREE.InstancedMesh;
  private readonly embers: THREE.InstancedMesh;
  private readonly guides: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly guideSectors: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private time = 0;
  private fracture = 0;

  constructor(density = 1) {
    this.root.name = 'Погребальное сердце';
    const stone = new GeomBuilder(); stone.rng = new Rng('candle:sanctum'); stone.color = OBS;
    const rng = new Rng('candle:votives');
    // Разломанный венец лежит вокруг колодца; зубья направлены внутрь, за границей игрового пола.
    for (let i = 0; i < 32; i++) {
      if (i % 8 === 1 || i % 8 === 2) continue;
      const a = i / 32 * Math.PI * 2, x = Math.sin(a) * 4.45, z = Math.cos(a) * 3.48 - 0.5;
      stone.add(box(0.18, 0.3, 0.7), { matrix: mat(x, 0.08, z, 0, a, 0), color: GOLD, surface: SURF.metal });
      if (i % 2 === 0) stone.add(shard(0.9, 0.18, 4, 0.1, i), { matrix: mat(x * 0.94, -0.3, (z + 0.5) * 0.94 - 0.5, -Math.sin(a) * 0.4, a, Math.cos(a) * 0.35), color: OBS });
    }
    // Цепи ведут взгляд вверх, но оставляют боевое кольцо открытым.
    for (const side of [-1, 1]) chain(stone, side * 0.8, 4.4, -0.5, side * 4.8, 10.4, -3.0, 0.4, 0.38);
    const flameAt = (x: number, z: number, base: number, h: number) => {
      stone.add(prism(5, 0.065, 0.052, h), { matrix: mat(x, base, z), color: WAX, surface: SURF.cloth, shade: 0.12 });
      // Никакой светящейся геометрии в фитиле: его видимость задаёт только Flames.
      this.flames.push([x, base + h + 0.06, z]);
    };
    // Поминальные амфитеатры вместо равномерной россыпи: тёмная входная сторона остаётся свободной.
    for (let tier = 0; tier < 2; tier++) {
      const n = Math.round((78 - tier * 12) * Math.max(0.65, density));
      for (let i = 0; i < n; i++) {
        const a = (0.22 + i / (n - 1) * 0.56) * Math.PI * 2;
        const x = Math.sin(a) * (12.2 - tier * 0.6), z = Math.cos(a) * (9.1 - tier * 0.52);
        if (BRAZIERS.some(b => Math.hypot(x - b.x, z - b.z) < 1.8)) continue;
        const base = 0.22 + (1 - tier) * 0.3;
        stone.add(box(0.62, base, 0.64), { matrix: mat(x, base / 2 - 0.03, z, 0, a, 0), color: OBS_DEEP });
        const h = rng.range(0.15, 0.55);
        flameAt(x + rng.spread(0.12), z + rng.spread(0.1), base, h);
        if (i % 6 === 0) this.pools.push({ x, z, r: 2.6, color: '#FFB866', intensity: 0.45, flicker: 1 });
      }
    }
    const guides = new GeomBuilder(); guides.rng = new Rng('candle:traces'); guides.color = GOLD;
    BRAZIERS.forEach((b, index) => {
      // Невысокие чаши в руках обсидиановых опор; их центр не совпадает с укрытиями арены.
      stone.add(starPlate(7, 1.05, 0.7, 0.08), { matrix: mat(b.x, 0.015, b.z), color: GOLD, surface: SURF.metal });
      stone.add(prism(7, 0.6, 0.39, 0.3), { matrix: mat(b.x, 0.08, b.z), color: OBS });
      for (const side of [-1, 1]) stone.add(shard(0.9, 0.21, 5, 0.1, index + side + 2), { matrix: mat(b.x + side * 0.36, 0.3, b.z, 0, 0, side * 0.32), color: OBS });
      stone.add(lathe([[0.19, 0], [0.36, 0.15], [0.6, 0.31], [0.67, 0.4], [0.52, 0.42], [0.2, 0.18]], 10), { matrix: mat(b.x, 0.84, b.z), color: GOLD, surface: SURF.metal });
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2, x = b.x + Math.sin(a) * 1.5, z = b.z + Math.cos(a) * 1.5;
        if (Math.hypot(x / 4.4, (z + 0.5) / 3.4) < 1.02) continue;
        flameAt(x, z, 0, rng.range(0.12, 0.36));
      }
      const start = guides.vertexCount;
      // Три отдельных канала от венца к жаровням объясняют, куда возвращается огонь.
      const len = Math.hypot(b.x, b.z + 0.5), dx = b.x / len, dz = (b.z + 0.5) / len;
      for (let k = 0; k < 7; k++) {
        const t = 4.5 + (len - 4.5) * (k / 7), seg = Math.max(0.12, (len - 4.5) / 7 - 0.08);
        const x = dx * (t + seg / 2), z = -0.5 + dz * (t + seg / 2);
        guides.add(box(0.075, 0.016, seg), { matrix: mat(x, 0.035, z, 0, Math.atan2(dx, dz), 0), color: GOLD });
        stone.add(box(0.17, 0.014, seg + 0.04), { matrix: mat(x, 0.023, z, 0, Math.atan2(dx, dz), 0), color: WAX });
      }
      const sectorCenter = [-Math.PI / 3, Math.PI / 3, Math.PI][index];
      for (let k = 0; k < 14; k++) {
        const a = sectorCenter - Math.PI / 3 + (k + 0.5) / 14 * Math.PI * 2 / 3;
        guides.add(box(0.06, 0.018, 0.52), { matrix: mat(Math.sin(a) * 4.75, 0.045, Math.cos(a) * 3.75, 0, a + Math.PI / 2, 0), color: GOLD });
      }
      for (let i = start; i < guides.vertexCount; i++) this.guideSectors.push(index);
    });
    const material = obsidianMaterial({ rim: '#53616b', rimStrength: 0.18, emissive: '#6b2432', emissive2: '#FFB866', emissiveStrength: 0.4 });
    this.caster = new THREE.Mesh(stone.build(), material); this.root.add(this.caster);
    const guideGeometry = guides.build();
    guideGeometry.setAttribute('color', guideGeometry.getAttribute('aColor'));
    this.guides = new THREE.Mesh(guideGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.guides.name = 'ritual-sector-traces';
    this.root.add(this.guides);

    const heartShape = new GeomBuilder(); heartShape.rng = new Rng('candle:heart');
    heartShape.add(octa(0.63, 1.45, 0.7), { color: '#181a24', surface: SURF.armor, shade: 0.3 });
    heartShape.add(shard(0.9, 0.28, 5, 0.18, 4), { matrix: mat(0.1, -1.2, 0), color: '#2b1b25', shade: 0.2 });
    this.heart = new THREE.InstancedMesh(heartShape.build(), material, 3); this.heart.frustumCulled = false; this.root.add(this.heart);
    this.core = new THREE.Mesh(octa(0.38, 1.25, 0.44), new THREE.MeshBasicMaterial({ color: '#d33545', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.core.position.set(0, 2.7, -0.5); this.root.add(this.core);
    const crown = new GeomBuilder(); crown.rng = new Rng('candle:astrolabe');
    for (let i = 0; i < 18; i++) {
      if (i % 6 === 0) continue;
      const a = i / 18 * Math.PI * 2;
      crown.add(box(0.13, 0.12, 0.65), { matrix: mat(Math.sin(a) * 1.8, 0, Math.cos(a) * 1.8, 0, a + Math.PI / 2), color: GOLD, surface: SURF.metal });
      if (i % 3 === 0) crown.add(shard(0.55, 0.12, 4, 0.05, i), { matrix: mat(Math.sin(a) * 1.8, 0.08, Math.cos(a) * 1.8), color: GOLD });
    }
    this.crown = new THREE.Mesh(crown.build(), material); this.crown.position.set(0, 3.3, -0.5); this.root.add(this.crown);
    const flameShape = new GeomBuilder(); flameShape.rng = new Rng('candle:altar-fire');
    for (let i = 0; i < 5; i++) flameShape.add(octa(0.16, 0.65 - (i % 2) * 0.18, 0.16), { matrix: mat(Math.sin(i * 2.4) * 0.16, 0.35, Math.cos(i * 2.4) * 0.16), color: '#ffb35e' });
    this.fire = new THREE.InstancedMesh(flameShape.build(), new THREE.MeshBasicMaterial({ color: '#ffd69a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), 3);
    this.fire.name = 'brazier-flames';
    this.fire.frustumCulled = false; this.root.add(this.fire);
    const ring = new THREE.RingGeometry(0.92, 0.98, 28); ring.rotateX(-Math.PI / 2);
    this.chargeRings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: '#e8c17b', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 3);
    this.chargeRings.frustumCulled = false; this.root.add(this.chargeRings);
    this.embers = new THREE.InstancedMesh(octa(0.12, 0.18, 0.12), new THREE.MeshBasicMaterial({ color: '#ffcf76', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), 3);
    this.embers.name = 'carried-embers';
    this.embers.frustumCulled = false; this.root.add(this.embers);
    this.update(0, { drain: 0, lit: [false, false, false], broken: false, carried: 0, chargingIndex: -1, charge: 0 });
  }

  update(dt: number, state: CandleSanctumState): void {
    this.time += dt;
    this.fracture += ((state.broken ? 1 : 0) - this.fracture) * Math.min(1, dt * 2.5);
    const warning = state.warning ?? 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (warning > 0 ? 9 : 2.2));
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.25, r = 0.48 + this.fracture * 1.05;
      this.matrix.copy(mat(Math.sin(a) * r, 2.75 + Math.cos(this.time * 1.1 + i) * 0.07 + this.fracture * (i - 1) * 0.35, -0.5 + Math.cos(a) * r, 0.1 * i, a + this.fracture * 0.6, (i - 1) * 0.08, 1, 1, 1));
      this.heart.setMatrixAt(i, this.matrix);
      const b = BRAZIERS[i], lit = !!state.lit[i];
      const size = lit ? 0.75 + pulse * 0.1 : 0;
      this.fire.setMatrixAt(i, mat(b.x, 1.12, b.z, 0, this.time * 0.5 + i, 0, size, size, size));
      const emberVisible = !!state.hero && i < state.carried && !state.broken;
      const emberAngle = this.time * 1.6 + i * Math.PI * 2 / 3;
      this.embers.setMatrixAt(i, mat((state.hero?.x ?? 0) + Math.sin(emberAngle) * 0.58, 1.95 + Math.sin(this.time * 2.2 + i) * 0.12, (state.hero?.z ?? 0) + Math.cos(emberAngle) * 0.58, 0, emberAngle, 0, emberVisible ? 1 : 0));
      const charging = state.chargingIndex === i && state.carried > 0;
      const ringScale = lit ? 1 : charging ? 0.5 + state.charge * 0.5 : state.carried > 0 ? 0.9 + pulse * 0.07 : 0.75;
      this.chargeRings.setMatrixAt(i, mat(b.x, 0.05, b.z, 0, 0, 0, ringScale, 1, ringScale));
      this.chargeRings.setColorAt(i, lit || charging ? GOLD_FIRE : COLD);
    }
    this.heart.instanceMatrix.needsUpdate = true;
    this.embers.instanceMatrix.needsUpdate = true;
    this.fire.instanceMatrix.needsUpdate = true;
    this.chargeRings.instanceMatrix.needsUpdate = true;
    if (this.chargeRings.instanceColor) this.chargeRings.instanceColor.needsUpdate = true;
    this.core.scale.setScalar(1 + state.drain * 0.12 + warning * 0.22 + pulse * 0.05);
    this.core.material.color.set(state.broken ? '#caa66c' : '#d33545');
    this.core.material.opacity = state.broken ? 0.07 : 0.2 + state.drain * 0.18 + warning * 0.36 + pulse * 0.08;
    this.crown.rotation.set(0.15, this.time * 0.05, -0.12);
    const colors = this.guides.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.guideSectors.length; i++) {
      const lit = state.broken || state.lit[this.guideSectors[i]];
      const c = lit ? GOLD_FIRE : warning > 0 ? DANGER : COLD;
      const k = lit ? 0.7 : warning > 0 ? (0.25 + warning * 0.65) * (0.65 + pulse * 0.35) : 0.4;
      colors.setXYZ(i, c.r * k, c.g * k, c.b * k);
    }
    colors.needsUpdate = true;
  }
}
