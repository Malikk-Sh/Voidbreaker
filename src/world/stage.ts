import { TileState } from './arena';
import type { StageDef, SpawnDef, WaveDef } from '../data/stages';
import type { Enemy } from './enemy';
import { createEnemy } from './enemies/factory';
import { ENEMIES } from '../data/enemies';
import { BIG_RADIUS } from './nav';
import type { World } from './world';

type Phase = 'intro' | 'wave' | 'breather' | 'clear' | 'failed';

interface Pending { def: SpawnDef; i: number; n: number; at: number; elite?: SpawnDef['elite'] }

/**
 * Директор волн (GDD §3.2, §9.5): 3–5 волн, между ними 2.5 с передышки (подбор осколков магнитом, стингер «ВОЛНА 02»).
 * Спаун — через портал-разлом 0.8 с, вне радиуса 3 м от героя. Триггеры подкреплений по HP элиты/стража.
 */
export class StageRunner {
  phase: Phase = 'intro';
  waveIdx = -1;
  private t = 0;
  private pending: Pending[] = [];
  private spawnedThisWave: Enemy[] = [];
  private firedTriggers = new Set<string>();
  guardian: Enemy | null = null;
  boss: Enemy | null = null;
  private edgeTiles: { x: number; z: number }[] = [];
  /** Пропустить интро (повторная попытка босса). */
  introTime = 1.4;
  onWaveStart: ((i: number) => void) | null = null;

  constructor(private w: World, readonly def: StageDef) {
    const a = w.arena;
    for (const tile of a.tiles) {
      if (tile.state !== TileState.Alive) continue;
      const t = a.t;
      const edge = !a.walkable(tile.x + t, tile.z) || !a.walkable(tile.x - t, tile.z) || !a.walkable(tile.x, tile.z + t) || !a.walkable(tile.x, tile.z - t);
      if (edge && a.walkable(tile.x, tile.z)) this.edgeTiles.push({ x: tile.x, z: tile.z });
    }
    w.onEliteHalf = (e) => this.onEliteHalf(e);
  }

  get waveTotal(): number { return this.def.waves.length; }

  /** Интро пропущено (кат-сцена закончилась раньше) — первая волна почти сразу. */
  skipIntro(): void { if (this.phase === 'intro') this.introTime = Math.min(this.introTime, this.t + 0.2); }

  /** Отладка: начать сразу с волны i. */
  skipTo(i: number): void { this.introTime = 0.3; this.startAtWave = Math.min(i, this.waveTotal - 1); }
  private startAtWave = 0;
  get wave(): WaveDef | null { return this.def.waves[this.waveIdx] ?? null; }

  step(dt: number): void {
    this.t += dt;
    const w = this.w;
    switch (this.phase) {
      case 'intro':
        if (this.t >= this.introTime) this.startWave(this.startAtWave);
        break;
      case 'wave': {
        // отложенные спауны
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const p = this.pending[i];
          if (this.t >= p.at) { this.pending.splice(i, 1); this.spawn(p); }
        }
        this.checkTriggers();
        const alive = w.enemies.some((e) => !e.dead);
        if (!alive && this.pending.length === 0 && this.t > 1.0) {
          w.rank.endWave();
          w.bus.emit('waveClear', { index: this.waveIdx, total: this.waveTotal });
          if (this.waveIdx + 1 >= this.waveTotal) { this.phase = 'clear'; this.t = 0; w.magnet = true; w.bus.emit('stageClear', {}); }
          else { this.phase = 'breather'; this.t = 0; w.magnet = true; }
        }
        break;
      }
      case 'breather':
        if (this.t >= 2.5) { w.magnet = false; this.startWave(this.waveIdx + 1); }
        break;
      default: break;
    }
  }

  private startWave(i: number): void {
    this.waveIdx = i;
    this.phase = 'wave';
    this.t = 0;
    this.spawnedThisWave = [];
    const wave = this.def.waves[i];
    for (const s of wave.spawns) this.queue(s, s.delay ?? 0);
    this.w.bus.emit('waveStart', { index: i, total: this.waveTotal });
    this.onWaveStart?.(i);
  }

  private queue(s: SpawnDef, delay: number): void {
    const n = s.count;
    for (let k = 0; k < n; k++) this.pending.push({ def: s, i: k, n, at: this.t + delay + k * (s.stagger ?? 0.12) });
  }

  private spawn(p: Pending): void {
    const w = this.w;
    const pos = this.pickPos(p.def, p.i, p.n);
    const e = createEnemy(p.def.enemy, { zone: w.zone, stage: w.stage, elite: p.def.elite, mode: w.mode });
    e.x = pos.x; e.z = pos.z;
    e.facing = Math.atan2(w.hero.x - e.x, w.hero.z - e.z);
    w.addEnemy(e);
    if (!e.isBoss) w.bus.emit('portal', { x: e.x, z: e.z });
    this.spawnedThisWave.push(e);
    if (e.isGuardian) this.guardian = e;
    if (e.isBoss) this.boss = e;
  }

  /** Точка спауна: ближний бой — только в области, связной с героем (стрелкам можно и на островах). */
  pickPos(s: SpawnDef, i: number, n: number): { x: number; z: number } {
    const p = this.pickRaw(s, i, n);
    const def = ENEMIES[s.enemy];
    const big = def.radius > BIG_RADIUS;
    if (!def.ranged && !this.w.nav.reachable(p.x, p.z, big)) this.w.nav.nearestReachable(p.x, p.z, big, p);
    return p;
  }

  private pickRaw(s: SpawnDef, i: number, n: number): { x: number; z: number } {
    const w = this.w, a = w.arena, h = w.hero, b = a.bounds;
    const out = { x: 0, z: 0 };
    const def = ENEMIES[s.enemy];
    const melee = !def.ranged, big = def.radius > BIG_RADIUS;
    const ok = (x: number, z: number) => a.walkable(x, z) && Math.hypot(x - h.x, z - h.z) >= 3.2 && (!melee || w.nav.reachable(x, z, big));
    if (s.at && s.at.length) {
      const anchor = s.at[i % s.at.length];
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const ax = anchor === 'left' ? b.minX + 3.5 : anchor === 'right' ? b.maxX - 3.5 : cx;
      const az = anchor === 'top' ? b.minZ + 3.5 : anchor === 'bottom' ? b.maxZ - 3.5 : cz;
      const jx = ax + w.rng.spread(1.5) + (i >= s.at.length ? w.rng.spread(2) : 0), jz = az + w.rng.spread(1.5);
      a.nearestWalkable(jx, jz, out);
      if (!ok(out.x, out.z)) this.pushAway(out);
      return out;
    }
    const pattern = s.pattern ?? 'random';
    if (pattern === 'ring') {
      for (let tries = 0; tries < 8; tries++) {
        const ang = (i / Math.max(1, n)) * Math.PI * 2 + w.rng.spread(0.3) + tries * 0.7;
        const r = 6 + w.rng.next() * 2.5;
        const x = h.x + Math.sin(ang) * r, z = h.z + Math.cos(ang) * r;
        if (ok(x, z)) return { x, z };
      }
    }
    if (pattern === 'edges' && this.edgeTiles.length) {
      for (let tries = 0; tries < 12; tries++) {
        const t = w.rng.pick(this.edgeTiles);
        if (Math.hypot(t.x - h.x, t.z - h.z) > 6 && ok(t.x, t.z)) return { x: t.x, z: t.z };
      }
    }
    // far / random: лучшая из случайной выборки по удалённости
    let best = { x: 0, z: 0 }, bd = -1;
    const tiles = a.tiles.filter((t) => t.state === TileState.Alive);
    for (let k = 0; k < 14; k++) {
      const t = w.rng.pick(tiles);
      if (!t || !a.walkable(t.x, t.z) || (melee && !w.nav.reachable(t.x, t.z, big))) continue;
      const d = Math.hypot(t.x - h.x, t.z - h.z);
      const score = pattern === 'far' ? d : d > 4 && d < 10 ? 10 - Math.abs(d - 7) : d * 0.3;
      if (score > bd) { bd = score; best = { x: t.x + w.rng.spread(0.4), z: t.z + w.rng.spread(0.4) }; }
    }
    if (!ok(best.x, best.z)) this.pushAway(best);
    return best;
  }

  private pushAway(p: { x: number; z: number }): void {
    const h = this.w.hero;
    const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 1;
    if (d >= 3.2) return;
    const o = { x: 0, z: 0 };
    this.w.arena.nearestWalkable(h.x + (dx / d) * 4.5, h.z + (dz / d) * 4.5, o);
    p.x = o.x; p.z = o.z;
  }

  private checkTriggers(): void {
    const wave = this.wave;
    if (!wave?.triggers) return;
    wave.triggers.forEach((tr, k) => {
      const key = `${this.waveIdx}:${k}`;
      if (this.firedTriggers.has(key)) return;
      let fire = false;
      if (tr.when === 'alive<3') fire = this.w.enemies.filter((e) => !e.dead).length < 3 && this.pending.length === 0;
      if (tr.when === 'guardianHp<0.5') fire = !!this.guardian && !this.guardian.dead && this.guardian.hp < this.guardian.maxHp / 2;
      if (fire) { this.firedTriggers.add(key); this.queue(tr.spawn, 0.3); }
    });
  }

  /** Элита на 50 %: подкрепление (триггер этапа). */
  private onEliteHalf(_e: Enemy): void {
    const wave = this.wave;
    wave?.triggers?.forEach((tr, k) => {
      const key = `${this.waveIdx}:${k}`;
      if (tr.when === 'eliteHp<0.5' && !this.firedTriggers.has(key)) { this.firedTriggers.add(key); this.queue(tr.spawn, 0.3); }
    });
  }
}
