import * as THREE from 'three';
import { buildAcolyte, buildBrute, buildCrawler, buildCrucifier, buildEye, buildHusk, buildMantis, buildObelisk, buildPsalmist, type RigBuild } from '../gen/chars/enemies';
import { buildHierophant } from '../gen/chars/hierophant';
import type { Enemy } from '../world/enemy';
import type { ShadowCopy } from '../world/shadow';
import { RigBatch } from './rigbatch';

/** Сборщики геометрии по id рига (кэш на сессию: сид → одна и та же модель). */
const BUILDERS: Record<string, { build: () => RigBuild; max: number }> = {
  husk: { build: () => buildHusk(16), max: 96 },
  crawler: { build: () => buildCrawler(11), max: 64 },
  mantis: { build: () => buildMantis(12), max: 20 },
  crucifier: { build: () => buildCrucifier(17), max: 8 },
  eye: { build: () => buildEye(13), max: 16 },
  acolyte: { build: () => buildAcolyte(14), max: 12 },
  psalmist: { build: () => buildPsalmist(18), max: 6 },
  obelisk: { build: () => buildObelisk(19), max: 4 },
  brute: { build: () => buildBrute(15), max: 10 },
  gateGuardian: { build: () => buildBrute(21, 1.65, { halberd: true }), max: 2 },
  bellRinger: { build: () => buildBrute(22, 1.45, { bell: true }), max: 2 },
  hierophant: { build: () => buildHierophant(31), max: 1 },
};
/** Крупные риги — слабее контурный свет, иначе они превращаются в красное пятно. */
const BIG = new Set(['brute', 'gateGuardian', 'bellRinger', 'hierophant']);

export function registerRigBuilder(id: string, build: () => RigBuild, max: number): void { BUILDERS[id] = { build, max }; }

/** Доля белой сердцевины в свечении врагов в покое (разбор: у всех горели одинаковые белые глаза). */
export const ENEMY_WHITE = 0.3;

/**
 * Рендер врагов: батч на тип рига — один draw call на всех Шипников, всех Жнецов и т.д. (Tech §7.1).
 */
export class EnemyRenderer {
  readonly group = new THREE.Group();
  private batches = new Map<string, RigBatch>();

  batch(id: string): RigBatch {
    let b = this.batches.get(id);
    if (!b) {
      const def = BUILDERS[id];
      if (!def) throw new Error(`no rig builder ${id}`);
      const r = def.build();
      b = new RigBatch(r.geometry, r.rig.joints.length, def.max, {
        // понтифик в тёмной рясе на фоне ночного неба над бездной — контур ярче, иначе силуэт пропадает
        rim: id === 'hierophant' ? '#ff3b4a' : '#d02838', rimStrength: id === 'hierophant' ? 0.8 : BIG.has(id) ? 0.34 : 0.62, rimPower: id === 'hierophant' ? 2.4 : BIG.has(id) ? 3.2 : 2.8,
        emissive: '#E11D2E', emissive2: '#FF8A3D', emissiveStrength: 2.8, white: ENEMY_WHITE,
      });
      this.batches.set(id, b);
      this.group.add(b.mesh);
    }
    return b;
  }

  /** Прогреть батчи заранее (без фриза при первом спавне). */
  warm(ids: string[]): void { for (const id of ids) this.batch(id); }

  render(enemies: Enemy[], shadows: readonly ShadowCopy[] = []): void {
    for (const b of this.batches.values()) b.begin();
    for (const e of enemies) {
      const p = e.puppet;
      const b = this.batch(p.layout.def.id);
      // элита светится; Отдача — ярче с каждым зарядом, на волне — полностью
      const eliteGlow = e.elite.length ? 0.5 + e.recoil * 0.12 + (e.recoilTele ? 1.2 : 0) : 0;
      b.push(p.skel.world, Math.min(1, p.flash), p.dissolve, p.boost + eliteGlow, p.crack);
    }
    // «Тень»: полупрозрачная тёмно-багровая копия — растворена наполовину, светится своим багровым
    for (const s of shadows) {
      if (!s.ready || s.vis <= 0) continue;
      const b = this.batch(s.owner.puppet.layout.def.id);
      b.push(s.world, 0, 1 - 0.55 * s.vis, 1.1 * s.vis, 0.35);
    }
    for (const b of this.batches.values()) b.end();
  }

  dispose(): void {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
  }
}
