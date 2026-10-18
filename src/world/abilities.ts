import { angleOf, clamp, len2 } from '../core/math';
import { ABILITIES, ABILITY_LEVEL, type AbilityId, type Slot } from '../data/abilities';
import type { Input } from '../input/input';
import type { AbilityHost } from './abilityHost';
import { overlaps } from './combat';
import type { Enemy } from './enemy';
import type { World } from './world';

export interface AbilityState { level: 1 | 2 | 3; mutation?: 'A' | 'B' }
export interface Loadout {
  q: AbilityId | null; e: AbilityId | null; r: AbilityId | null;
  levels: Partial<Record<AbilityId, AbilityState>>;
}

export interface Sickle { x: number; z: number; vx: number; vz: number; out: boolean; dist: number; max: number; hover: number; hits: Set<number>; rot: number; alive: boolean; hitT: number }
export interface Well { x: number; z: number; t: number; dur: number; exploded: boolean; follow: boolean; horizon: boolean; alive: boolean; boom: number }
export interface Wave { x: number; z: number; dx: number; dz: number; dist: number; hits: Set<number>; alive: boolean; r: number; kind: 'eclipse' | 'blade'; mult: number; max: number; speed: number }
export interface Phantom { x: number; z: number; facing: number; t: number; fired: boolean; alive: boolean }

/**
 * Способности (GDD §6) поверх стейт-машины героя: Серп Луны, Фазовый шаг, Гравитационный колодец, Затмение.
 * Уровни I–III (+35 % урона, −10 % КД), на III — мутация (ветка А или Б).
 */
export class Abilities implements AbilityHost {
  loadout: Loadout = { q: 'crescent', e: null, r: null, levels: {} };
  readonly cd: Record<Slot, number> = { q: 0, e: 0, r: 0 };
  readonly cdMax: Record<Slot, number> = { q: 1, e: 1, r: 1 };
  phaseCharges = 1;
  sickles: Sickle[] = [];
  wells: Well[] = [];
  waves: Wave[] = [];
  phantoms: Phantom[] = [];
  /** Последний фазовый шаг: от-до (для отрисовки разреза). */
  lastPhase: { x0: number; z0: number; x1: number; z1: number; t: number } | null = null;
  private eclipseActive = false;
  private eclipseMut: 'A' | 'B' | undefined;

  constructor(private w: World) {
    w.bus.on('hit', (e) => {
      // Кровавая луна: вампиризм 4 % от урона во время Затмения
      if (this.eclipseActive && this.eclipseMut === 'B' && e.target.faction === 'enemy') {
        const h = this.w.hero;
        h.hp = Math.min(h.maxHp, h.hp + e.dmg * 0.04);
      }
    });
  }

  state(id: AbilityId): AbilityState { return this.loadout.levels[id] ?? { level: 1 }; }
  private mul(id: AbilityId): number { return ABILITIES[id].dmg * (1 + ABILITY_LEVEL.dmgPerLevel * (this.state(id).level - 1)); }
  private mut(id: AbilityId): 'A' | 'B' | undefined { const s = this.state(id); return s.level >= 3 ? s.mutation : undefined; }

  cooldownFor(id: AbilityId): number {
    const s = this.state(id);
    return ABILITIES[id].cd * (s.level >= 2 ? ABILITY_LEVEL.cdLevel2 : 1) * (1 - this.w.hero.stats.cdr);
  }

  /** Готовность слота 0..1 (для HUD). */
  ready(slot: Slot): number {
    const id = this.loadout[slot];
    if (!id) return 0;
    if (slot === 'r') return this.w.hero.eclipse ? 0 : clamp(this.w.hero.resonance / 100, 0, 1);
    return this.cdMax[slot] > 0 ? 1 - clamp(this.cd[slot] / this.cdMax[slot], 0, 1) : 1;
  }

  resetCooldowns(): void {
    this.cd.q = this.cd.e = this.cd.r = 0;
    this.phaseCharges = this.mut('phase') === 'A' ? 2 : 1;
    this.sickles = []; this.wells = []; this.waves = []; this.phantoms = [];
    this.eclipseActive = false;
  }

  tryCast(slot: Slot, input: Input): boolean {
    const id = this.loadout[slot];
    if (!id) return false;
    const h = this.w.hero;
    if (h.state !== 'move' && h.state !== 'attack') return false;
    if (slot === 'r') {
      if (h.resonance < 100 || h.eclipse) return false;
    } else if (id === 'phase') {
      if (this.phaseCharges < 1) return false;
    } else if (this.cd[slot] > 0) return false;

    // направление: цель → стик → мышь → взгляд
    let dx = Math.sin(h.facing), dz = Math.cos(h.facing);
    const t = h.target;
    if (t) { dx = t.x - h.x; dz = t.z - h.z; }
    else if (len2(input.moveX, input.moveZ) > 0.2) { dx = input.moveX; dz = input.moveZ; }
    else if (input.aimActive) { dx = input.aimX; dz = input.aimZ; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    h.facing = angleOf(dx, dz);

    switch (id) {
      case 'crescent':
        h.beginCast('cast', () => this.castCrescent(dx, dz));
        break;
      case 'phase':
        this.castPhase(dx, dz);
        break;
      case 'well': {
        const tx = t ? t.x : h.x + dx * 4, tz = t ? t.z : h.z + dz * 4;
        h.beginCast('cast', () => this.castWell(tx, tz));
        break;
      }
      case 'eclipse':
        h.beginCast('castBig', () => this.castEclipse(), 0.3);
        h.invulnUntil = Math.max(h.invulnUntil, h.clock + 0.5);
        break;
    }
    if (slot !== 'r' && id !== 'phase') { this.cdMax[slot] = this.cooldownFor(id); this.cd[slot] = this.cdMax[slot]; }
    this.w.rank.used(id);
    return true;
  }

  // ------------------------------------------------------------------ Серп Луны
  private castCrescent(dx: number, dz: number): void {
    const h = this.w.hero;
    const mut = this.mut('crescent');
    const angles = mut === 'A' ? [-0.35, 0, 0.35] : [0];
    const base = angleOf(dx, dz);
    for (const da of angles) {
      const a = base + da;
      this.sickles.push({ x: h.x + Math.sin(a) * 0.6, z: h.z + Math.cos(a) * 0.6, vx: Math.sin(a) * 19, vz: Math.cos(a) * 19, out: true, dist: 0, max: 7, hover: mut === 'B' ? 1.5 : 0, hits: new Set(), rot: 0, alive: true, hitT: 0 });
    }
    this.w.bus.emit('ability', { id: 'crescent', x: h.x, z: h.z });
  }

  // ------------------------------------------------------------------ Фазовый шаг
  private castPhase(dx: number, dz: number): void {
    const h = this.w.hero, a = this.w.arena;
    const x0 = h.x, z0 = h.z;
    let dist = 5;
    // конечная точка — проходимая (сквозь врагов, но не в пропасть)
    while (dist > 0.5 && !a.walkable(x0 + dx * dist, z0 + dz * dist)) dist -= 0.25;
    const x1 = x0 + dx * dist, z1 = z0 + dz * dist;
    const hits = new Set<number>();
    this.w.heroStrike({ k: 'line', x: x0, z: z0, dx, dz, len: dist + 0.6, w: 1.8 }, hits, {
      mult: this.mul('phase'), stun: 8, stunKind: 'other', knockback: 1, feel: 'medium', dirX: dx, dirZ: dz, source: 'ability', abilityId: 'phase', finisher: true,
    });
    h.x = x1; h.z = z1;
    h.avatar.puppet.skel.x = x1; h.avatar.puppet.skel.z = z1;
    h.invulnUntil = Math.max(h.invulnUntil, h.clock + 0.25);
    h.dashCharges = Math.min(h.stats.dashCharges, h.dashCharges + 1);
    this.phaseCharges--;
    this.cdMax.q = this.cooldownFor('phase');
    if (this.cd.q <= 0) this.cd.q = this.cdMax.q;
    this.lastPhase = { x0, z0, x1, z1, t: 0 };
    if (this.mut('phase') === 'B') this.phantoms.push({ x: x0, z: z0, facing: angleOf(dx, dz), t: 0, fired: false, alive: true });
    this.w.bus.emit('ability', { id: 'phase', x: x1, z: z1 });
  }

  // ------------------------------------------------------------------ Гравитационный колодец
  private castWell(x: number, z: number): void {
    const mut = this.mut('well');
    const o = { x, z };
    this.w.arena.nearestWalkable(x, z, o);
    this.wells.push({ x: o.x, z: o.z, t: 0, dur: 2, exploded: false, follow: mut === 'B', horizon: mut === 'A', alive: true, boom: 0 });
    this.w.bus.emit('ability', { id: 'well', x: o.x, z: o.z });
  }

  // ------------------------------------------------------------------ Затмение
  private castEclipse(): void {
    const h = this.w.hero;
    const mut = this.mut('eclipse');
    h.resonance = 0;
    h.eclipseUntil = h.clock + 6 + (mut === 'A' ? 2 : 0);
    this.eclipseActive = true;
    this.eclipseMut = mut;
    this.w.bus.emit('ultimate', { id: 'eclipse', x: h.x, z: h.z });
    this.w.bus.emit('shockwave', { x: h.x, z: h.z, r: 8, color: 'void', strength: 1 });
    // волна активации
    this.w.beginStrike();
    for (const e of this.w.enemies) {
      if (!e.targetable) continue;
      const d = Math.hypot(e.x - h.x, e.z - h.z);
      if (d < 6) {
        const l = d || 1;
        this.w.damageEnemy(e, { mult: 1.5, stun: 10, knockback: 4, feel: 'heavy', dirX: (e.x - h.x) / l, dirZ: (e.z - h.z) / l, source: 'ability', noResonance: true, abilityId: 'eclipse' });
      }
    }
    this.w.endStrike({ dirX: 0, dirZ: 1, source: 'ability' });
  }

  eclipseWave(x: number, z: number, facing: number): void {
    const dx = Math.sin(facing), dz = Math.cos(facing);
    this.waves.push({ x: x + dx * 1.2, z: z + dz * 1.2, dx, dz, dist: 0, hits: new Set(), alive: true, r: 1.4, kind: 'eclipse', mult: this.mul('eclipse'), max: 6, speed: 16 });
  }

  /** Волна клинка (полный заряд): летит вперёд и пробивает строй. */
  bladeWave(x: number, z: number, facing: number, mult: number, dist: number, r: number): void {
    const dx = Math.sin(facing), dz = Math.cos(facing);
    this.waves.push({ x: x + dx * 1.0, z: z + dz * 1.0, dx, dz, dist: 0, hits: new Set(), alive: true, r, kind: 'blade', mult, max: dist, speed: 20 });
  }

  riftCrack(x: number, z: number, facing: number): void {
    const dx = Math.sin(facing), dz = Math.cos(facing);
    this.w.addHazard({ shape: { k: 'line', x: x + dx * 0.5, z: z + dz * 0.5, dx, dz, len: 4.5, w: 1.0 }, dur: 1.6, tick: 0.25, dmg: 0.3, hostile: false, kind: 'crack' });
  }

  onDash(x: number, z: number, dx: number, dz: number): void {
    if (!this.w.hero.stats.dashTrail) return;
    this.w.addHazard({ shape: { k: 'line', x, z, dx, dz, len: 4.5, w: 1.1 }, dur: 1.2, tick: 0.3, dmg: 0.35, hostile: false, kind: 'trail' });
  }

  onKill(_e: Enemy): void {}
  canDeflect(): boolean { return this.w.hero.eclipse; }

  damageMulOn(e: Enemy): number {
    for (const wl of this.wells) if (wl.alive && wl.horizon && !wl.exploded && Math.hypot(e.x - wl.x, e.z - wl.z) < 5) return 1.3;
    return 1;
  }

  // ------------------------------------------------------------------ шаг
  step(dtW: number, dtH: number): void {
    const w = this.w, h = w.hero;
    for (const s of ['q', 'e'] as const) {
      if (this.cd[s] <= 0) continue;
      this.cd[s] = Math.max(0, this.cd[s] - dtH);
      if (this.cd[s] <= 0 && this.loadout[s]) w.bus.emit('abilityReady', { slot: s });
    }
    // заряды Фазового шага (Двойная фаза)
    const maxCh = this.mut('phase') === 'A' ? 2 : 1;
    if (this.loadout.q === 'phase' && this.phaseCharges < maxCh && this.cd.q <= 0) {
      this.phaseCharges++;
      if (this.phaseCharges < maxCh) { this.cdMax.q = this.cooldownFor('phase'); this.cd.q = this.cdMax.q; }
    }
    if (this.lastPhase) { this.lastPhase.t += dtW; if (this.lastPhase.t > 0.4) this.lastPhase = null; }

    // серпы
    for (const s of this.sickles) {
      if (!s.alive) continue;
      s.rot += dtW * 22;
      if (s.out) {
        if (s.dist >= s.max && s.hover > 0) {
          // Бумеранг Бездны: зависает, вращаясь, и бьёт каждые 0.3 с
          s.hover -= dtW;
          s.hitT -= dtW;
          if (s.hitT <= 0) { s.hits.clear(); s.hitT = 0.3; }
          if (s.hover <= 0) { s.out = false; s.hits.clear(); }
        } else {
          const sp = Math.hypot(s.vx, s.vz);
          s.x += s.vx * dtW; s.z += s.vz * dtW; s.dist += sp * dtW;
          if (w.arena.blocked(s.x, s.z, 0.2)) { s.out = false; s.hits.clear(); }
          else if (s.dist >= s.max && s.hover <= 0) { s.out = false; s.hits.clear(); }
        }
      } else {
        const dx = h.x - s.x, dz = h.z - s.z, d = Math.hypot(dx, dz);
        const sp = 21;
        s.x += (dx / (d || 1)) * sp * dtW; s.z += (dz / (d || 1)) * sp * dtW;
        if (d < 0.8) s.alive = false;
      }
      const l = Math.hypot(s.vx, s.vz) || 1;
      w.heroStrike({ k: 'circle', x: s.x, z: s.z, r: 0.75 }, s.hits, {
        mult: this.mul('crescent'), stun: 3, knockback: 0.8, feel: 'light', dirX: s.out ? s.vx / l : -s.vx / l, dirZ: s.out ? s.vz / l : -s.vz / l,
        source: 'ability', abilityId: 'crescent', noStagger: false,
      });
    }
    this.sickles = this.sickles.filter((s) => s.alive);

    // колодцы
    for (const wl of this.wells) {
      if (!wl.alive) continue;
      wl.t += dtW;
      if (wl.follow) {
        const tx = h.x + Math.sin(h.facing) * 2.5, tz = h.z + Math.cos(h.facing) * 2.5;
        wl.x += (tx - wl.x) * Math.min(1, dtW * 2); wl.z += (tz - wl.z) * Math.min(1, dtW * 2);
      }
      if (!wl.exploded) {
        for (const e of w.enemies) {
          if (!e.targetable || e.isBoss || e.isGuardian) continue;
          const dx = wl.x - e.x, dz = wl.z - e.z, d = Math.hypot(dx, dz);
          if (d > 5 || d < 0.3) continue;
          const pull = (6 + (1 - d / 5) * 8) / Math.max(0.6, e.mass);
          e.kbX = (dx / d) * pull; e.kbZ = (dz / d) * pull;
        }
        if (wl.t >= wl.dur) {
          wl.exploded = true;
          const hits = new Set<number>();
          w.beginStrike();
          for (const e of w.enemies) {
            if (!e.targetable || hits.has(e.id) || !overlaps({ k: 'circle', x: wl.x, z: wl.z, r: 3.4 }, e.x, e.z, e.radius)) continue;
            hits.add(e.id);
            const dx = e.x - wl.x, dz = e.z - wl.z, d = Math.hypot(dx, dz) || 1;
            w.damageEnemy(e, { mult: this.mul('well'), stun: 15, stunKind: 'other', knockback: 4, feel: 'heavy', dirX: dx / d, dirZ: dz / d, source: 'ability', abilityId: 'well', finisher: true });
          }
          w.endStrike({ dirX: 0, dirZ: 1, source: 'ability' });
          w.bus.emit('impact', { x: wl.x, z: wl.z, r: 3.4, kind: 'rift' });
          w.bus.emit('shockwave', { x: wl.x, z: wl.z, r: 4, color: 'void', strength: 1 });
        }
      } else {
        wl.boom += dtW;
        if (wl.boom > 0.4) wl.alive = false;
      }
    }
    this.wells = this.wells.filter((wl) => wl.alive);

    // волны Затмения
    for (const wv of this.waves) {
      const step = wv.speed * dtW;
      wv.x += wv.dx * step; wv.z += wv.dz * step; wv.dist += step;
      const blade = wv.kind === 'blade';
      w.heroStrike({ k: 'circle', x: wv.x, z: wv.z, r: wv.r }, wv.hits, {
        mult: wv.mult, stun: 4, stunKind: 'other', knockback: blade ? 3 : 1.5, feel: blade ? 'medium' : 'light', dirX: wv.dx, dirZ: wv.dz, source: blade ? 'blade' : 'ability', abilityId: blade ? 'bladeWave' : 'eclipseWave', noResonance: !blade,
      });
      if (wv.dist > wv.max || w.arena.blocked(wv.x, wv.z, 0.3)) wv.alive = false;
    }
    this.waves = this.waves.filter((wv) => wv.alive);

    // фантомы Расщепления
    for (const p of this.phantoms) {
      p.t += dtW;
      if (!p.fired && p.t > 0.35) {
        p.fired = true;
        const hits = new Set<number>();
        w.heroStrike({ k: 'circle', x: p.x, z: p.z, r: 2.6 }, hits, { mult: 1.2, stun: 6, knockback: 2, feel: 'medium', dirX: Math.sin(p.facing), dirZ: Math.cos(p.facing), source: 'ability', abilityId: 'phantom' });
        w.bus.emit('shockwave', { x: p.x, z: p.z, r: 2.6, color: 'void', strength: 0.5 });
      }
      if (p.t > 0.8) p.alive = false;
    }
    this.phantoms = this.phantoms.filter((p) => p.alive);

    // конец Затмения
    if (this.eclipseActive && !h.eclipse) {
      this.eclipseActive = false;
      if (this.eclipseMut === 'A' && !h.dead) {
        const hits = new Set<number>();
        w.heroStrike({ k: 'circle', x: h.x, z: h.z, r: 5.5 }, hits, { mult: 8, stun: 40, knockback: 6, feel: 'break', dirX: 0, dirZ: 1, source: 'ability', abilityId: 'eclipseEnd', noResonance: true });
        w.bus.emit('shockwave', { x: h.x, z: h.z, r: 6, color: 'void', strength: 1.2 });
        w.bus.emit('impact', { x: h.x, z: h.z, r: 5.5, kind: 'rift' });
      }
      if (h.stats.ultHeal > 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * h.stats.ultHeal);
      if (h.stats.ultRefund > 0 && !h.dead) h.addResonance(h.stats.ultRefund);
    }
  }
}
