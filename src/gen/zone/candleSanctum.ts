import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { BRAZIERS } from '../../world/candleRitual';
import { GeomBuilder, mat, SURF } from '../geom/build';
import { box, lathe, octa, prism, shard, starPlate } from '../geom/prims';
import { chain, GOLD, OBS, OBS_DEEP, WAX } from '../geom/kit';
import { obsidianMaterial } from '../../render/materials';
import type { LightPoolDef } from './arenaView';
import { inHeartWell, makePiece, piecePose, REMAINS, type RemainsPiece } from './heartRemains';

export interface HeartBodyVisual {
  centerZ: number;
  body: { x: number; y: number; z: number; r?: number };
  phase: number;
  hp: number;
  maxHp: number;
  exposed: number;
  beat: number;
  active: boolean;
  dead: boolean;
  awakening?: number;
  heat?: readonly number[];
  hitFlash?: number;
  lit?: readonly boolean[];
  /** Поза боя (render: funeralHeart.HeartPose), раскрытие брони 0…1, ярость 0…1, гибель 0…1, ядро лопнуло. */
  pose?: string;
  open?: number;
  rage?: number;
  dying?: number;
  burst?: boolean;
  /** До боя: ядро светится принятым светом (золото) вместо багрового, 0…1. */
  glow?: number;
  /**
   * Секунд после вспышки ядра (из сцены гибели); меньше нуля — вспышки не было. Нет поля, а Сердце мертво —
   * вспышка была давно: обруч и броня уже рассыпались.
   */
  sinceBurst?: number;
  /** Пластин брони на ядре (из боя); нет поля — по фазе: 6 / 4 / 2. */
  plates?: number;
}

/** Куски Сердца после вспышки: звенья и шипы обруча, пластины брони. */
interface HeartRemainsSet { links: RemainsPiece[]; spikes: RemainsPiece[]; plates: RemainsPiece[] }

/** Звенья и шипы обруча-астролябии над Сердцем: углы на кольце (рад) и их позы в обруче. */
const CROWN_R = 1.8;
const CROWN_LINKS = Array.from({ length: 18 }, (_, i) => i).filter(i => i % 6 !== 0).map(i => i / 18 * Math.PI * 2);
const CROWN_SPIKES = Array.from({ length: 18 }, (_, i) => i).filter(i => i % 6 !== 0 && i % 3 === 0).map(i => i / 18 * Math.PI * 2);
const LINK_LOCAL = CROWN_LINKS.map(a => mat(Math.sin(a) * CROWN_R, 0, Math.cos(a) * CROWN_R, 0, a + Math.PI / 2));
const SPIKE_LOCAL = CROWN_SPIKES.map(a => mat(Math.sin(a) * CROWN_R, 0.08, Math.cos(a) * CROWN_R));
/**
 * Как разлетаются остатки во вспышке (м/с, рад/с) и когда рассыпаются (с после вспышки): звенья обруча легче
 * и летят дальше, пластины брони тяжелее; сорванные раньше пластины трескаются, когда до них доходит волна.
 */
export const REMAINS_FLING = {
  link: { out: 5.5, up: 3.6, spin: 9 }, spike: { out: 4.2, up: 4.6, spin: 11 }, plate: { out: 3.4, up: 3.0, spin: 5 },
  linkCrumble: [1.05, 0.45] as const, plateCrumble: [1.15, 0.35] as const, restCrumble: 0.25,
};

/**
 * Вид Сердца: scale — во сколько раз оно крупнее прежнего ромба (силуэт читается как босс, а не как деталь
 * венца); tilt — наклон лежащего на полу Сердца; plateFly — полёт сорванной пластины до кромки колодца (с);
 * deathTear — полёт пластины, которую срывает удар сердца в гибели: она ложится у кромки до вспышки ядра.
 */
export const HEART_LOOK = { scale: 1.45, tilt: 0.42, plateFly: 0.8, deathTear: 0.45 };

/** Двойной удар «тук-тук» по фазе пульса 0…1: сильный, затем слабее. */
export function heartbeatPulse(beat: number): number {
  const g = (x: number, w: number) => Math.exp(-(x * x) / (w * w));
  return g(beat, 0.07) + g(beat - 1, 0.07) + 0.6 * g(beat - 0.24, 0.07);
}

export interface CandleSanctumState {
  drain: number;
  lit: readonly boolean[];
  broken: boolean;
  carried: number;
  chargingIndex: number;
  charge: number;
  warning?: number;
  boss?: HeartBodyVisual;
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
  private readonly crownLinks: THREE.InstancedMesh;
  private readonly crownSpikes: THREE.InstancedMesh;
  private readonly fire: THREE.InstancedMesh;
  private readonly chargeRings: THREE.InstancedMesh;
  private readonly embers: THREE.InstancedMesh;
  private readonly guides: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly guideSectors: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly chargeColor = new THREE.Color();
  private time = 0;
  private fracture = 0;
  private wake = 0;
  private openK = 0;
  private stuckK = 0;
  /** Сорванные в ярости пластины: где отделились, куда летят (координаты зала) и сколько летят. */
  private readonly flying: ({ x: number; y: number; z: number; tx: number; tz: number; t: number; dur: number; spin: number } | null)[] = [null, null, null, null, null, null];
  private lastPlates = 6;
  /** Последние живые позы обруча и брони: из них во вспышке рождаются разлетающиеся куски. */
  private readonly aliveLinks = CROWN_LINKS.map(() => new THREE.Matrix4());
  private readonly aliveSpikes = CROWN_SPIKES.map(() => new THREE.Matrix4());
  private readonly alivePlates = Array.from({ length: 6 }, () => new THREE.Matrix4());
  private remains: HeartRemainsSet | null = null;
  /** Куски, которые сейчас рассыпаются: где они (координаты зала) и насколько (0…1) — для пепла и искр. */
  readonly crumbling: { x: number; y: number; z: number; k: number }[] = [];
  private readonly _crown = new THREE.Matrix4();

  constructor(density = 1) {
    this.root.name = 'Погребальное сердце';
    const stone = new GeomBuilder(); stone.rng = new Rng('candle:sanctum'); stone.color = OBS;
    const rng = new Rng('candle:votives');
    // Разломанный венец лежит вокруг колодца; зубья направлены внутрь, за границей игрового пола.
    for (let i = 0; i < 32; i++) {
      if (i % 8 === 1 || i % 8 === 2) continue;
      const a = i / 32 * Math.PI * 2, x = Math.sin(a) * 5.45, z = Math.cos(a) * 4.48 - 0.5;
      stone.add(box(0.18, 0.3, 0.7), { matrix: mat(x, 0.08, z, 0, a, 0), color: GOLD, surface: SURF.metal });
      if (i % 2 === 0) stone.add(shard(0.9, 0.18, 4, 0.1, i), { matrix: mat(x * 0.94, -0.3, (z + 0.5) * 0.94 - 0.5, -Math.sin(a) * 0.4, a, Math.cos(a) * 0.35), color: OBS });
    }
    // Цепи ведут взгляд вверх, но оставляют боевое кольцо открытым.
    for (const side of [-1, 1]) chain(stone, side * 0.8, 5.3, -0.5, side * 6.5, 12.8, -4.0, 0.4, 0.38);
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
        const x = Math.sin(a) * (17.2 - tier * 0.65), z = Math.cos(a) * (13.1 - tier * 0.55);
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
        if (Math.hypot(x / 5.4, (z + 0.5) / 4.4) < 1.02) continue;
        flameAt(x, z, 0, rng.range(0.12, 0.36));
      }
      const start = guides.vertexCount;
      // Три отдельных канала от венца к жаровням объясняют, куда возвращается огонь.
      const len = Math.hypot(b.x, b.z + 0.5), dx = b.x / len, dz = (b.z + 0.5) / len;
      for (let k = 0; k < 7; k++) {
        const t = 5.6 + (len - 5.6) * (k / 7), seg = Math.max(0.12, (len - 5.6) / 7 - 0.08);
        const x = dx * (t + seg / 2), z = -0.5 + dz * (t + seg / 2);
        guides.add(box(0.075, 0.016, seg), { matrix: mat(x, 0.035, z, 0, Math.atan2(dx, dz), 0), color: GOLD });
        stone.add(box(0.17, 0.014, seg + 0.04), { matrix: mat(x, 0.023, z, 0, Math.atan2(dx, dz), 0), color: WAX });
      }
      const sectorCenter = [-Math.PI / 3, Math.PI / 3, Math.PI][index];
      for (let k = 0; k < 14; k++) {
        const a = sectorCenter - Math.PI / 3 + (k + 0.5) / 14 * Math.PI * 2 / 3;
        guides.add(box(0.06, 0.018, 0.52), { matrix: mat(Math.sin(a) * 5.75, 0.045, Math.cos(a) * 4.75, 0, a + Math.PI / 2, 0), color: GOLD });
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
    heartShape.add(octa(0.78, 1.55, 0.44), { color: '#181a24', surface: SURF.armor, shade: 0.3 });
    heartShape.add(shard(0.9, 0.28, 5, 0.18, 4), { matrix: mat(0.1, -1.2, 0), color: '#2b1b25', shade: 0.2 });
    this.heart = new THREE.InstancedMesh(heartShape.build(), material, 6); this.heart.name = 'heart-armour'; this.heart.frustumCulled = false; this.root.add(this.heart);
    this.core = new THREE.Mesh(octa(0.78, 1.52, 0.78), new THREE.MeshBasicMaterial({ color: '#d33545', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.core.name = 'heart-core'; this.core.position.set(0, 3.8, 0); this.root.add(this.core);
    // Обруч-астролябия — отдельные звенья и шипы: во вспышке гибели он разлетается на куски.
    const link = new GeomBuilder(); link.rng = new Rng('candle:astrolabe');
    link.add(box(0.13, 0.12, 0.65), { color: GOLD, surface: SURF.metal });
    const spike = new GeomBuilder(); spike.rng = new Rng('candle:astrolabe-spike');
    spike.add(shard(0.55, 0.12, 4, 0.05, 3), { color: GOLD });
    this.crownLinks = new THREE.InstancedMesh(link.build(), material, CROWN_LINKS.length); this.crownLinks.name = 'heart-crown';
    this.crownSpikes = new THREE.InstancedMesh(spike.build(), material, CROWN_SPIKES.length); this.crownSpikes.name = 'heart-crown-spikes';
    for (const m of [this.crownLinks, this.crownSpikes]) { m.frustumCulled = false; this.root.add(m); }
    const flameShape = new GeomBuilder(); flameShape.rng = new Rng('candle:altar-fire');
    for (let i = 0; i < 5; i++) flameShape.add(octa(0.16, 0.65 - (i % 2) * 0.18, 0.16), { matrix: mat(Math.sin(i * 2.4) * 0.16, 0.35, Math.cos(i * 2.4) * 0.16), color: '#ffb35e' });
    this.fire = new THREE.InstancedMesh(flameShape.build(), new THREE.MeshBasicMaterial({ color: '#ffd69a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), 3);
    this.fire.name = 'brazier-flames';
    this.fire.frustumCulled = false; this.root.add(this.fire);
    const ring = new THREE.RingGeometry(0.92, 0.98, 28); ring.rotateX(-Math.PI / 2);
    this.chargeRings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: '#e8c17b', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 3);
    this.chargeRings.name = 'brazier-heat-rings';
    this.chargeRings.frustumCulled = false; this.root.add(this.chargeRings);
    this.embers = new THREE.InstancedMesh(octa(0.12, 0.18, 0.12), new THREE.MeshBasicMaterial({ color: '#ffcf76', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), 3);
    this.embers.name = 'carried-embers';
    this.embers.frustumCulled = false; this.root.add(this.embers);
    this.update(0, { drain: 0, lit: [false, false, false], broken: false, carried: 0, chargingIndex: -1, charge: 0 });
  }

  update(dt: number, state: CandleSanctumState): void {
    this.time += dt;
    const boss = state.boss;
    const dead = boss ? boss.dead : state.broken;
    const awakening = boss ? Math.max(boss.awakening ?? 0, boss.active || boss.dead ? 1 : 0) : 0;
    this.wake += (awakening - this.wake) * Math.min(1, dt * 3.5);
    if (dt === 0) this.wake = awakening;
    this.fracture += ((dead || boss?.burst ? 1 : 0) - this.fracture) * Math.min(1, dt * 2.5);
    const warning = state.warning ?? 0;
    const pulse = boss ? boss.beat : 0.5 + 0.5 * Math.sin(this.time * (warning > 0 ? 9 : 2.2));
    const phase = boss?.phase ?? 1, exposed = (boss?.exposed ?? 0) > 0;
    const bodyX = boss?.body.x ?? 0, bodyZ = boss ? boss.body.z - boss.centerZ : 0;
    const bodyY = boss?.body.y ?? 3.8;
    const pose = boss?.pose ?? '', dying = boss?.dying ?? 0, rage = boss?.rage ?? 0, burst = !!boss?.burst;
    const S = HEART_LOOK.scale, k = Math.min(1, dt * 6);
    // Раскрытие брони приходит из боя; старые состояния без позы раскрываются по фазе, как раньше.
    const openTarget = boss?.open !== undefined ? boss.open : (exposed ? 1 : phase === 3 ? 0.8 : phase === 2 ? 0.45 : 0.08);
    this.openK += (openTarget - this.openK) * k; if (dt === 0) this.openK = openTarget;
    const lying = pose === 'stuck' || pose === 'knock' ? 1 : 0;
    this.stuckK += (lying - this.stuckK) * Math.min(1, dt * 5);
    // До боя (принятый свет) лепестки раскрываются сами по себе — ядро видно сквозь броню.
    const open = boss?.glow ? this.openK : this.wake * this.openK;
    const plates = boss?.plates ?? (phase >= 3 ? 2 : phase === 2 ? 4 : 6);
    const beatK = boss ? heartbeatPulse(boss.beat) : 0.5;
    const shake = (rage > 0 ? 0.09 : 0) + dying * 0.14 * (burst ? 0 : 1);
    const jx = Math.sin(this.time * 53) * shake, jz = Math.cos(this.time * 47) * shake;
    const tilt = this.stuckK * HEART_LOOK.tilt;
    // Сорванная пластина летит к кромке колодца и остаётся лежать: прогресс боя виден на полу.
    if (plates < this.lastPlates) for (let i = plates; i < this.lastPlates; i++) {
      const a = i / 6 * Math.PI * 2 + 0.25, dur = dying > 0 ? HEART_LOOK.deathTear : HEART_LOOK.plateFly;
      this.flying[i] = { x: bodyX + Math.sin(a) * 0.9 * S, y: bodyY, z: bodyZ + Math.cos(a) * 0.9 * S,
        tx: Math.sin(a + 0.4) * 6.4, tz: Math.cos(a + 0.4) * 5.3 - 0.5, t: dt === 0 ? dur : 0, dur, spin: (i % 2 ? -1 : 1) * (2 + i) };
    }
    this.lastPlates = plates;
    // Секунд после вспышки ядра: с этого момента обруч и броня — разлетающиеся куски, а не части Сердца.
    const sinceBurst = boss?.sinceBurst ?? (dead || burst ? Infinity : -1);
    if (sinceBurst < 0) this.remains = null;
    const alive = sinceBurst < 0 || !this.remains;
    for (let i = 0; i < 6 && sinceBurst < 0; i++) {
      const a = i / 6 * Math.PI * 2 + 0.25 + this.time * 0.05 * (1 - this.stuckK);
      const detached = i >= plates, fly = this.flying[i];
      if (detached && fly) {
        fly.t = Math.min(fly.dur, fly.t + dt);
        const u = fly.t / fly.dur;
        const x = fly.x + (fly.tx - fly.x) * u, z = fly.z + (fly.tz - fly.z) * u;
        const y = fly.y + (0.15 - fly.y) * u * u + Math.sin(u * Math.PI) * 2.2;
        this.matrix.copy(mat(x, y, z, 0.9 + fly.spin * (1 - u) * u * 3, a + fly.spin * u, 1.2 * u, S * 0.8, S * 0.8, S * 0.8));
      } else if (detached) {
        this.matrix.copy(mat(bodyX + Math.sin(a) * 6, 0.15, bodyZ + Math.cos(a) * 5, 0.9, a, 1.2, S * 0.8, S * 0.8, S * 0.8));
      } else {
        // Лепестки: сомкнуты в воздухе, раскрываются, когда Сердце лежит; в ярости дрожат.
        const r = (0.45 + open * 1.15) * S;
        const y = bodyY + Math.cos(this.time * 1.1 + i) * 0.06 * this.wake + Math.sin(a) * tilt * r * 0.6;
        const petal = open * 0.55 + rage * 0.15 * Math.sin(this.time * 30 + i);
        this.matrix.copy(mat(bodyX + jx + Math.sin(a) * r, y, bodyZ + jz + Math.cos(a) * r, petal + tilt * Math.cos(a), a, (i % 2 ? -1 : 1) * open * 0.24, S, S, S));
      }
      this.alivePlates[i].copy(this.matrix);
      this.heart.setMatrixAt(i, this.matrix);
    }
    for (let i = 0; i < 3; i++) {
      const b = BRAZIERS[i], lit = !!state.lit[i];
      const size = lit ? 0.75 + pulse * 0.1 : 0;
      this.fire.setMatrixAt(i, mat(b.x, 1.12, b.z, 0, this.time * 0.5 + i, 0, size, size, size));
      const emberVisible = !!state.hero && i < state.carried && !state.broken;
      const emberAngle = this.time * 1.6 + i * Math.PI * 2 / 3;
      this.embers.setMatrixAt(i, mat((state.hero?.x ?? 0) + Math.sin(emberAngle) * 0.58, 1.95 + Math.sin(this.time * 2.2 + i) * 0.12, (state.hero?.z ?? 0) + Math.cos(emberAngle) * 0.58, 0, emberAngle, 0, emberVisible ? 1 : 0));
      const charging = state.chargingIndex === i && state.carried > 0;
      const heat = Math.max(0,Math.min(1,boss?.heat?.[i] ?? 0));
      const hotPulse = heat >= 0.75 ? 0.08*(1+Math.sin(this.time*8)) : 0;
      const ringScale = lit ? 1 : heat > 0 ? 0.75+heat*0.3+hotPulse : charging ? 0.5 + state.charge * 0.5 : state.carried > 0 ? 0.9 + pulse * 0.07 : 0.75;
      this.chargeRings.setMatrixAt(i, mat(b.x, 0.05, b.z, 0, 0, 0, ringScale, 1, ringScale));
      this.chargeRings.setColorAt(i, lit || charging ? GOLD_FIRE : this.chargeColor.copy(COLD).lerp(GOLD_FIRE,heat));
    }
    this.heart.instanceMatrix.needsUpdate = true;
    this.embers.instanceMatrix.needsUpdate = true;
    this.fire.instanceMatrix.needsUpdate = true;
    this.chargeRings.instanceMatrix.needsUpdate = true;
    if (this.chargeRings.instanceColor) this.chargeRings.instanceColor.needsUpdate = true;
    // Ядро: «тук-тук», раскрытое — золотое и крупнее, перед падением — ярко-багровое; в гибели сжимается.
    const shrink = burst ? 0 : 1 - dying * 0.55;
    const coreSize = (0.45 + this.wake * 0.55) * S * shrink * (1 + beatK * (exposed ? 0.16 : 0.1) + (exposed ? 0.2 : 0));
    this.core.position.set(bodyX + jx, bodyY, bodyZ + jz);
    this.core.scale.setScalar(Math.max(0.001, coreSize));
    this.core.rotation.set(0, this.time * 0.4, tilt);
    const tracking = pose === 'track' || pose === 'lock' || pose === 'fall';
    this.core.material.color.set(dead || burst ? '#ffd399' : dying > 0 ? '#fff1d0' : exposed ? '#ffc46e' : rage > 0 ? '#ff2244' : tracking ? '#ff3a4c' : phase === 3 ? '#ff537a' : '#e0414a');
    this.core.material.color.lerp(GOLD_FIRE, Math.min(1, Math.max((boss?.hitFlash ?? 0) * 0.9, boss?.glow ?? 0)));
    this.core.material.opacity = dead || burst ? Math.max(0, 0.6 * (1 - this.fracture)) * (burst ? 0 : 1)
      : 0.08 + this.wake * ((exposed ? 0.82 : tracking || rage > 0 ? 0.76 : 0.66) + beatK * 0.18);
    if (sinceBurst < 0) {
      this._crown.copy(mat(bodyX + jx, bodyY + 0.6 * S - this.stuckK * 0.5, bodyZ + jz,
        0.15 + phase * 0.03 + tilt, this.time * (0.015 + this.wake * 0.045 + rage * 2.4), -0.12 - open * 0.2, S * (1 + rage * 0.12)));
      LINK_LOCAL.forEach((m, i) => { this.aliveLinks[i].multiplyMatrices(this._crown, m); this.crownLinks.setMatrixAt(i, this.aliveLinks[i]); });
      SPIKE_LOCAL.forEach((m, i) => { this.aliveSpikes[i].multiplyMatrices(this._crown, m); this.crownSpikes.setMatrixAt(i, this.aliveSpikes[i]); });
      this.crumbling.length = 0;
    } else {
      if (alive) this.remains = this.breakApart(bodyX, bodyZ, plates);
      this.updateRemains(sinceBurst);
    }
    this.crownLinks.instanceMatrix.needsUpdate = true;
    this.crownSpikes.instanceMatrix.needsUpdate = true;
    const colors = this.guides.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.guideSectors.length; i++) {
      const lit = dead || state.lit[this.guideSectors[i]];
      const c = lit ? GOLD_FIRE : warning > 0 ? DANGER : COLD;
      const k = lit ? 0.7 : warning > 0 ? (0.25 + warning * 0.65) * (0.65 + pulse * 0.35) : 0.4;
      colors.setXYZ(i, c.r * k, c.g * k, c.b * k);
    }
    colors.needsUpdate = true;
  }

  /**
   * Вспышка ядра: обруч рвётся на звенья и шипы, оставшиеся пластины срываются с ядра, сорванные раньше лежат
   * и трескаются, когда до них доходит золотая волна. Позы — последние живые: куски летят из того, что видно.
   */
  private breakApart(bodyX: number, bodyZ: number, attached: number): HeartRemainsSet {
    const c = { x: bodyX, z: bodyZ }, F = REMAINS_FLING;
    // Порядок рассыпания вразнобой, а не по кругу: обруч не «стирается» по часовой стрелке.
    const spread = (i: number, n: number, [at, d]: readonly [number, number]) => at + d * ((i * 7) % n) / n;
    const links = this.aliveLinks.map((m, i) => makePiece(m, `heart:link:${i}`, F.link, spread(i, CROWN_LINKS.length, F.linkCrumble), c));
    const spikes = this.aliveSpikes.map((m, i) => makePiece(m, `heart:spike:${i}`, F.spike, spread(i + 2, CROWN_SPIKES.length + 2, F.linkCrumble), c));
    const plates = this.alivePlates.map((m, i) => {
      const y = m.elements[13], x = m.elements[12], z = m.elements[14];
      // Пластина на ядре или ещё в полёте — её бросает; лежащая у кромки колодца трескается на месте.
      if (i < attached || y > REMAINS.floorY + 0.5) return makePiece(m, `heart:plate:${i}`, F.plate, spread(i, 6, F.plateCrumble), c);
      return makePiece(m, `heart:plate:${i}`, null, F.restCrumble + Math.hypot(x - bodyX, z - bodyZ) / REMAINS.wave + (i % 3) * 0.06, c);
    });
    return { links, spikes, plates };
  }

  private updateRemains(u: number): void {
    const r = this.remains;
    if (!r) return;
    this.crumbling.length = 0;
    const place = (mesh: THREE.InstancedMesh, pieces: RemainsPiece[]) => pieces.forEach((p, i) => {
      const k = piecePose(p, u, this.matrix);
      mesh.setMatrixAt(i, this.matrix);
      const e = this.matrix.elements;
      if (k > 0 && k < 1 && !inHeartWell(e[12], e[14])) this.crumbling.push({ x: e[12], y: e[13], z: e[14], k });
    });
    place(this.crownLinks, r.links);
    place(this.crownSpikes, r.spikes);
    place(this.heart, r.plates);
  }
}
