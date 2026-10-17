import { angleDiff } from '../core/math';

/** Формы хитбоксов (Tech §15.3): circle, arc, line (OBB), ring (внутр./внешн. радиус + разрывы по углу). */
export type Shape =
  | { k: 'circle'; x: number; z: number; r: number }
  | { k: 'arc'; x: number; z: number; r: number; dir: number; half: number }
  | { k: 'line'; x: number; z: number; dx: number; dz: number; len: number; w: number }
  | { k: 'ring'; x: number; z: number; r0: number; r1: number; gaps?: { a: number; w: number }[] };

/** Пересекает ли форма круг (px, pz, pr). */
export function overlaps(s: Shape, px: number, pz: number, pr: number): boolean {
  switch (s.k) {
    case 'circle': {
      const dx = px - s.x, dz = pz - s.z, rr = s.r + pr;
      return dx * dx + dz * dz <= rr * rr;
    }
    case 'arc': {
      const dx = px - s.x, dz = pz - s.z;
      const d = Math.hypot(dx, dz);
      if (d > s.r + pr) return false;
      if (d < pr + 0.35) return true;
      const a = Math.atan2(dx, dz);
      return Math.abs(angleDiff(s.dir, a)) <= s.half + Math.atan(pr / d);
    }
    case 'line': {
      const ox = px - s.x, oz = pz - s.z;
      const t = ox * s.dx + oz * s.dz;
      if (t < -pr || t > s.len + pr) return false;
      const perp = Math.abs(ox * s.dz - oz * s.dx);
      return perp <= s.w / 2 + pr;
    }
    case 'ring': {
      const dx = px - s.x, dz = pz - s.z;
      const d = Math.hypot(dx, dz);
      if (d < s.r0 - pr || d > s.r1 + pr) return false;
      if (s.gaps && d > 1e-3) {
        const a = Math.atan2(dx, dz);
        const slack = Math.atan(pr / d);
        for (const g of s.gaps) if (Math.abs(angleDiff(g.a, a)) < g.w / 2 - slack) return false;
      }
      return true;
    }
  }
}

export interface AttackerStats {
  atk: number;
  critChance: number;
  critMul: number;
  dmgBonus: number;
  forceCrit?: boolean;
}

export interface DamageResult { dmg: number; crit: boolean }

/**
 * Формула урона (GDD §5.9, Tech §15.3):
 * урон = ATK × множитель × (1 + Σ бонусы) × крит × (1 + 0.5 × сломан) × элемент; × (1 − броня/(броня+100)); разброс ±5 %.
 */
export function computeDamage(a: AttackerStats, mult: number, armor: number, broken: boolean, rng: () => number, extraMul = 1): DamageResult {
  const crit = a.forceCrit || rng() < a.critChance;
  let dmg = a.atk * mult * (1 + a.dmgBonus) * extraMul;
  if (crit) dmg *= a.critMul;
  if (broken) dmg *= 1.5;
  dmg *= 1 - armor / (armor + 100);
  dmg *= 0.95 + rng() * 0.1;
  return { dmg: Math.max(1, Math.round(dmg)), crit };
}

/** Снижение урона бронёй (для показа в UI). */
export const armorReduction = (armor: number): number => armor / (armor + 100);
