import { LINE_BACK, VOID_BLADE } from '../../data/weapons';
import { RESONANCE } from '../../data/player';
import { BRAZIERS, sectorAt } from '../candleRitual';
import { computeDamage, overlaps, type Shape } from '../combat';
import type { Enemy } from '../enemy';
import { createEnemy } from '../enemies/factory';
import type { Telegraph } from '../entities';
import type { GameEvents } from '../events';
import type { AimTarget, World } from '../world';

export const FUNERAL_HEART = {
  hp: 720, warning: 1.55, flameSeconds: 14, waxSeconds: 10,
  reflectionDamage: 38, counterDamage: 58, waxDamage: 44,
  maxCarriers: 3, carriersPerPhase: 9,
} as const;

export interface HeartShot {
  id: number; x: number; y: number; z: number; r: number;
  vx: number; vz: number; alive: boolean; reflected: boolean; life: number;
}
export interface HeartField {
  id: number; x: number; z: number; r: number; life: number; dur: number;
  kind: 'wax' | 'counter';
}
export interface HeartAttack {
  kind: 'blast' | 'pulse' | 'double' | 'chains' | 'drain' | 'orbs';
  x: number; z: number; t: number; dur: number; shapes: Shape[]; targetIndex?: number;
}
export interface FuneralHeartView {
  readonly centerZ: number;
  readonly active: boolean; readonly dead: boolean;
  readonly braziers: readonly { x: number; z: number }[];
  readonly shots: readonly HeartShot[]; readonly fields: readonly HeartField[];
  readonly carriers: ReadonlyMap<number, Enemy>;
  readonly body: { x: number; y: number; z: number; r: number };
  readonly phase: 1 | 2 | 3; readonly hp: number; readonly maxHp: number;
  readonly exposed: number; readonly beat: number; readonly attack: HeartAttack | null;
  readonly lit: readonly boolean[]; readonly heat: readonly number[]; readonly flameLife: readonly number[];
  readonly hitFlash: number;
  readonly metrics: { counters: number; reflectedHits: number; bodyHits: number; spawnedTotal: number };
}
interface Impact { at: number; shapes: Shape[]; done: boolean }
interface Sequence { view: HeartAttack; impacts: Impact[]; telegraphs: Telegraph[] }

/** The heart is a separate encounter, never a fifth wave or a proximity ritual. */
export class FuneralHeart implements FuneralHeartView {
  active = false;
  dead = false;
  hp: number = FUNERAL_HEART.hp;
  readonly maxHp = FUNERAL_HEART.hp;
  phase: 1 | 2 | 3 = 1;
  exposed = 0;
  beat = 0;
  hitFlash = 0;
  attack: HeartAttack | null = null;
  readonly lit: [boolean, boolean, boolean] = [false, false, false];
  readonly heat: [number, number, number] = [0, 0, 0];
  readonly flameLife: [number, number, number] = [0, 0, 0];
  readonly braziers: { x: number; z: number }[];
  readonly shots: HeartShot[] = [];
  readonly fields: HeartField[] = [];
  readonly carriers = new Map<number, Enemy>();
  readonly body: { x: number; y: number; z: number; r: number };
  readonly metrics = { counters: 0, reflectedHits: 0, bodyHits: 0, spawnedTotal: 0 };
  onDefeated: (() => void) | null = null;
  private enabled = false;
  private started = false;
  private disposed = false;
  private clock = 0;
  private nextAttack = 1.8;
  private nextSpawn = 2.6;
  private phaseSpawns = 0;
  private attackIndex = 0;
  private entityId = 0;
  private sequence: Sequence | null = null;
  private leanAngle = 0;
  private swingId = 0;
  private lastSlashAt = -99;
  private slashKeys = new Set<string>();
  private readonly offs: (() => void)[];
  private readonly aimTarget: AimTarget;

  constructor(private readonly w: World, readonly centerZ: number) {
    this.braziers = BRAZIERS.map(b => ({ x: b.x, z: centerZ + b.z }));
    this.body = { x: 0, y: 3.8, z: centerZ - 0.5, r: 2.5 };
    const heart = this;
    this.aimTarget = {
      get x() { return heart.body.x; }, get z() { return heart.body.z; },
      get radius() { return heart.body.r; },
      get targetable() { return heart.active && (heart.exposed > 0 || heart.phase === 3) && heart.w.arena.walkable(heart.body.x, heart.body.z); },
    };
    w.aimTargets.add(this.aimTarget);
    this.offs = [
      w.bus.on('swing', () => { this.swingId++; this.slashKeys.clear(); }),
      w.bus.on('slash', e => this.slash(e)),
      w.bus.on('ability', e => this.ability(e)),
      w.bus.on('perfectDodge', e => this.reflectNear(e.x, e.z, e.sx, e.sz)),
      w.bus.on('kill', e => this.carrierDied(e.target.id, e.x, e.z)),
      w.bus.on('heroDeath', () => { this.enabled = false; this.cancelAttack(); }),
    ];
  }

  get view(): FuneralHeartView { return this; }
  get counters(): number { return this.metrics.counters; }
  get reflectedHits(): number { return this.metrics.reflectedHits; }
  get bodyHits(): number { return this.metrics.bodyHits; }
  get spawnedTotal(): number { return this.metrics.spawnedTotal; }

  start(): boolean {
    if (this.started || this.disposed) return false;
    this.started = true; this.active = true; this.enabled = true;
    this.w.bus.emit('bossPhase', { phase: 1 });
    return true;
  }

  step(dt: number, enabled = true): void {
    this.enabled = this.active && enabled && !this.disposed && !this.w.hero.dead && !this.w.hero.scripted;
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return;
    // A long browser frame cannot skip an entire warning or throw an orb through the blade.
    let remaining = Math.min(dt, 0.5);
    while (remaining > 1e-8 && this.active) {
      const slice = Math.min(remaining, 1 / 60);
      this.advance(slice); remaining -= slice;
    }
  }

  visibilityAt(x: number, z: number): number {
    if (!this.started || this.dead) return 1;
    if (this.lit[sectorAt(x, z, this.centerZ)]) return 1;
    const drain = Math.min(1, this.clock / 2.2);
    if (drain >= 1) return 0;
    const tau = Math.PI * 2, angle = Math.atan2(x, z - this.centerZ) + Math.PI;
    const turn = ((angle % tau) + tau) % tau / tau;
    const gone = Math.max(0, Math.min(1, (drain * 1.08 - turn) / 0.08));
    return 1 - gone;
  }

  private get canAct(): boolean { return this.active && this.enabled && !this.disposed && !this.w.hero.scripted && !this.w.hero.dead; }

  private advance(dt: number): void {
    this.clock += dt;
    this.beat = (this.clock * (this.phase === 3 ? 1.45 : this.phase === 2 ? 1.15 : 0.85)) % 1;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.exposed = Math.max(0, this.exposed - dt);
    for (let i = 0; i < 3; i++) {
      this.heat[i] = Math.max(0, this.heat[i] - dt * 0.055);
      this.flameLife[i] = Math.max(0, this.flameLife[i] - dt);
      this.lit[i] = this.flameLife[i] > 0;
    }
    this.positionBody(dt);
    this.stepShots(dt);
    if (!this.active) return;
    this.stepFields(dt);
    for (const [id, enemy] of this.carriers) if (enemy.dead) this.carriers.delete(id);
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) { this.spawnCarriers(); this.nextSpawn = 8.5 - this.phase * 0.5; }
    const sequence = this.sequence;
    if (sequence) {
      sequence.view.t += dt;
      for (const impact of sequence.impacts) {
        if (impact.done || sequence.view.t + 1e-7 < impact.at) continue;
        impact.done = true; this.impact(sequence.view, impact.shapes);
        if (!this.active || this.sequence !== sequence) return;
      }
      if (sequence.view.t >= sequence.view.dur) {
        this.cancelAttack(); this.nextAttack = this.phase === 3 ? 0.95 : this.phase === 2 ? 1.35 : 1.8;
      }
    } else {
      this.nextAttack -= dt;
      if (this.nextAttack <= 0) this.beginNextAttack();
    }
  }

  private positionBody(dt: number): void {
    const resting = this.exposed <= 0 && this.phase !== 3;
    const target = resting
      ? { x: 0, z: this.centerZ - 0.5 }
      : { x: Math.sin(this.leanAngle)*8, z: this.centerZ+Math.cos(this.leanAngle)*8 };
    if (!resting) this.w.arena.nearestWalkable(target.x,target.z,target);
    const y=resting ? (this.phase===1?3.8:3.1) : this.phase===3?1.35:1.7;
    const k=1-Math.exp(-dt*6);
    this.body.x+=(target.x-this.body.x)*k; this.body.z+=(target.z-this.body.z)*k;
    this.body.y+=(y-this.body.y)*k;
  }

  private expose(seconds: number): void {
    if (this.exposed <= 0 || this.phase === 3) this.leanAngle = Math.atan2(this.w.hero.x, this.w.hero.z - this.centerZ);
    this.exposed = Math.max(this.exposed, seconds);
  }

  private beginNextAttack(): void {
    const patterns: HeartAttack['kind'][] = this.phase === 3
      ? ['blast', 'orbs', 'chains', 'pulse', 'drain', 'chains']
      : this.phase === 2 ? ['blast', 'orbs', 'double', 'blast', 'drain', 'double']
      : ['blast', 'orbs', 'pulse', 'blast', 'drain', 'pulse'];
    const kind = patterns[this.attackIndex % patterns.length];
    // Returning the orb has a readable interval of its own, without an overlapping sector wipe.
    if (this.shots.some(s => s.alive && !s.reflected)) { this.nextAttack = 0.25; return; }
    let x = this.w.hero.x, z = this.w.hero.z, targetIndex: number | undefined;
    let impacts: Impact[] = [];
    const origin = { x: 0, z: this.centerZ - 0.5 };
    if (kind === 'blast') {
      if (this.attackIndex === 0) {
        targetIndex = this.nearestBrazier(x, z); x = this.braziers[targetIndex].x; z = this.braziers[targetIndex].z;
      }
      const dx = x - origin.x, dz = z - origin.z, d = Math.hypot(dx, dz) || 1;
      impacts = [{ at: FUNERAL_HEART.warning, done: false, shapes: [
        { k: 'line', ...origin, dx: dx / d, dz: dz / d, len: d + 1, w: 2.1 },
        { k: 'circle', x, z, r: 2.3 },
      ] }];
    } else if (kind === 'pulse' || kind === 'double') {
      const shapes: Shape[] = [];
      for (let i = 0; i < 3; i++) if (!this.lit[i]) shapes.push({ k: 'arc', x: 0, z: this.centerZ, r: 21, dir: (i * 120 - 60) * Math.PI / 180, half: Math.PI / 3 });
      impacts = [{ at: 1.5, done: false, shapes }];
      if (kind === 'double') impacts.push({ at: 2.65, done: false, shapes });
    } else if (kind === 'chains') {
      const angle = Math.atan2(x, z - origin.z);
      impacts = [0, 0.46, -0.46].map((offset, i) => ({ at: 1.4 + i * 0.85, done: false, shapes: [
        { k: 'line', ...origin, dx: Math.sin(angle + offset), dz: Math.cos(angle + offset), len: 20, w: 2 },
      ] }));
    } else if (kind === 'drain') {
      targetIndex = this.flameLife.indexOf(Math.max(...this.flameLife));
      if (!this.lit[targetIndex]) { this.attackIndex++; this.beginNextAttack(); return; }
      x = this.braziers[targetIndex].x; z = this.braziers[targetIndex].z;
      impacts = [{ at: 2.2, done: false, shapes: [{ k: 'circle', x, z, r: 2.6 }] }];
    } else {
      x = origin.x; z = origin.z;
      impacts = [{ at: 1.2, done: false, shapes: [{ k: 'circle', x, z, r: 1.4 }] }];
    }
    const dur = (impacts.at(-1)?.at ?? 1.5) + 0.28;
    const view: HeartAttack = { kind, x, z, t: 0, dur, shapes: impacts.flatMap(i => i.shapes), targetIndex };
    const telegraphs = impacts.flatMap(i => i.shapes.map(s => this.w.addTelegraph(s, i.at, kind === 'drain')));
    this.sequence = { view, impacts, telegraphs }; this.attack = view; this.attackIndex++;
    this.w.bus.emit('telegraph', { kind: kind === 'orbs' ? 'chime' : 'bell', x, z, src: 'funeralHeart' });
  }

  private impact(attack: HeartAttack, shapes: Shape[]): void {
    if (!this.canAct) return;
    if (attack.kind === 'orbs') { this.launchOrbs(); return; }
    if (attack.kind === 'drain') {
      const i = attack.targetIndex!;
      this.flameLife[i] = 0; this.lit[i] = false; this.heat[i] = 0.6;
      this.w.bus.emit('shockwave', { x: attack.x, z: attack.z, r: 3, color: 'hunger', strength: 0.6 });
      return;
    }
    if (attack.kind === 'blast') for (let i = 0; i < 3; i++) {
      const b = this.braziers[i];
      if (shapes.some(s => overlaps(s, b.x, b.z, 1.25))) this.heat[i] = 1;
    }
    const h = this.w.hero;
    const protectedByFire = (attack.kind === 'pulse' || attack.kind === 'double') &&
      (this.lit[sectorAt(h.x, h.z, this.centerZ)] || this.fields.some(f => f.kind === 'wax' && f.life > 0 && Math.hypot(h.x - f.x, h.z - f.z) <= f.r));
    if (!protectedByFire) for (const shape of shapes) this.w.enemyStrike(
      { x: 0, z: this.centerZ - 0.5, id: -941, kind: 'Погребальное Сердце' }, shape,
      h.maxHp * (attack.kind === 'chains' ? 0.12 : attack.kind === 'blast' ? 0.16 : 0.2), 3,
    );
    this.w.bus.emit('impact', { x: attack.x, z: attack.z, r: attack.kind === 'blast' ? 2.3 : 12, kind: 'bell' });
    if (attack.kind === 'blast') this.w.heroStrike({ k: 'circle', x: attack.x, z: attack.z, r: 2.3 }, new Set(), {
      mult: 2.5, stun: 12, knockback: 2, feel: 'heavy', dirX: 0, dirZ: 1, source: 'env', noResonance: true,
    });
  }

  private launchOrbs(): void {
    const angle = Math.atan2(this.w.hero.x, this.w.hero.z - this.centerZ + 0.5);
    const offsets = this.phase === 1 ? [0] : [-0.13, 0.13];
    for (const offset of offsets) {
      const dx = Math.sin(angle + offset), dz = Math.cos(angle + offset), speed = 5.1 + this.phase * 0.35;
      this.shots.push({ id: ++this.entityId, x: dx * 2.6, z: this.centerZ - 0.5 + dz * 2.6, y: 1.35, r: 0.82,
        vx: dx * speed, vz: dz * speed, alive: true, reflected: false, life: 6 });
    }
    this.w.bus.emit('enemyAttack', { kind: 'shot', x: 0, z: this.centerZ - 0.5 });
  }

  private stepShots(dt: number): void {
    const h = this.w.hero;
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) { s.alive = false; continue; }
      if (!s.reflected && h.inPerfectWindow && (Math.hypot(s.x - h.x, s.z - h.z) <= s.r + 1.6 ||
        segmentDistance(s.x, s.z, h.dashFromX, h.dashFromZ, h.x, h.z) <= s.r + 0.8)) {
        this.reflect(s);
        this.w.enemyStrike({ x: s.x, z: s.z, id: -941, kind: 'Погребальное Сердце' }, { k: 'circle', x: s.x, z: s.z, r: s.r + 1.2 }, 0, 0);
      }
      const oldX = s.x, oldZ = s.z;
      if (s.reflected) {
        const dx = this.body.x - s.x, dz = this.body.z - s.z, d = Math.hypot(dx, dz) || 1;
        s.vx = dx / d * 17; s.vz = dz / d * 17;
      }
      s.x += s.vx * dt; s.z += s.vz * dt;
      if (s.reflected) {
        for (let i = 0; i < 3; i++) if (!this.lit[i] && segmentDistance(this.braziers[i].x, this.braziers[i].z, oldX, oldZ, s.x, s.z) <= 1.8) this.ignite(i);
        if (!this.active) return;
        if (segmentDistance(this.body.x, this.body.z, oldX, oldZ, s.x, s.z) <= this.body.r + s.r) {
          s.alive = false; this.metrics.reflectedHits++;
          this.damage(FUNERAL_HEART.reflectionDamage, 'reflection'); this.expose(4.8);
          this.w.bus.emit('projectileHit', { x: s.x, z: s.z, kind: 'heartReturn' });
        }
      } else if (segmentDistance(h.x, h.z, oldX, oldZ, s.x, s.z) <= h.radius + s.r) {
        const result = this.w.enemyStrike({ x: oldX - s.vx, z: oldZ - s.vz, id: -941, kind: 'Погребальное Сердце' }, { k: 'circle', x: s.x, z: s.z, r: s.r + 0.1 }, h.maxHp * 0.15, 2);
        if (result === 'perfect') this.reflect(s);
        else if (result !== 'miss' && result !== 'immune') s.alive = false;
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) if (!this.shots[i].alive) this.shots.splice(i, 1);
  }

  private reflect(s: HeartShot): void {
    if (!s.alive || s.reflected || !this.canAct) return;
    s.reflected = true; s.life = 6;
    this.w.bus.emit('censer', { kind: 'deflect', x: s.x, z: s.z });
    this.w.bus.emit('shockwave', { x: s.x, z: s.z, r: 1.5, color: 'void', strength: 0.55 });
  }

  private reflectNear(x: number, z: number, sx: number, sz: number): void {
    if (!this.canAct) return;
    for (const shot of this.shots) if (segmentDistance(shot.x, shot.z, sx, sz, x, z) <= shot.r + 1.6) this.reflect(shot);
  }

  private slash(event: GameEvents['slash']): void {
    if (!this.canAct) return;
    const key = `${this.swingId}:${event.second ? 1 : 0}`;
    if (this.slashKeys.has(key) && this.w.time - this.lastSlashAt < 0.18) return;
    this.slashKeys.add(key); this.lastSlashAt = this.w.time;
    const shape = slashShape(event), charged = event.move === 'charged' || this.w.hero.state === 'charged';
    for (const shot of this.shots) if (overlaps(shape, shot.x, shot.z, shot.r + 0.25)) this.reflect(shot);
    if (charged) {
      for (let i = 0; i < 3; i++) if (!this.lit[i] && this.heat[i] >= 0.72 && overlaps(shape, this.braziers[i].x, this.braziers[i].z, 1.35)) this.ignite(i);
      for (const field of [...this.fields]) if (field.kind === 'wax' && field.life > 0 && overlaps(shape, field.x, field.z, field.r)) {
        field.life = 0; this.counterPulse(field.x, field.z, FUNERAL_HEART.waxDamage);
      }
    }
    if (!this.active || !overlaps(shape, this.body.x, this.body.z, this.body.r)) return;
    const move = [...VOID_BLADE.combo, VOID_BLADE.flurry, VOID_BLADE.lunge, VOID_BLADE.rising, VOID_BLADE.skycut, VOID_BLADE.skyfall, VOID_BLADE.cross, VOID_BLADE.counter].find(m => m.id === event.move);
    const mult = charged ? (this.w.hero.chargeLevel >= 2 ? 4.5 : 3) : (move?.dmg ?? 1);
    const h = this.w.hero, perfect = h.consumePerfectBuff();
    const result = computeDamage({ ...h.stats, forceCrit: perfect }, mult, 0, false, () => this.w.rng.next(), perfect ? 1.3 : 1);
    this.metrics.bodyHits++;
    this.damage(result.dmg, 'body');
    h.addResonance(charged || move?.finisher ? RESONANCE.perFinisher : RESONANCE.perHit);
    this.w.rank.hit(charged || !!move?.finisher); this.w.rank.used('blade');
    this.w.bus.emit('strike', { n: 1, crit: result.crit, feel: charged ? 'heavy' : (move?.feel ?? 'light'), x: this.body.x, z: this.body.z,
      dirX: Math.sin(event.facing), dirZ: Math.cos(event.facing), source: 'blade', moveId: event.move, boss: true });
  }

  private ability(event: GameEvents['ability']): void {
    if (!this.canAct) return;
    const h = this.w.hero;
    const shape: Shape = event.id === 'crescent'
      ? { k: 'line', x: event.x, z: event.z, dx: Math.sin(h.facing), dz: Math.cos(h.facing), len: 8, w: 2.5 }
      : { k: 'circle', x: event.x, z: event.z, r: event.id === 'well' ? 4.5 : 3.5 };
    if (!overlaps(shape, this.body.x, this.body.z, this.body.r)) return;
    const perfect = h.consumePerfectBuff();
    const result = computeDamage({ ...h.stats, dmgBonus: h.stats.dmgBonus + h.stats.abilityDmg, forceCrit: perfect },
      event.id === 'well' ? 2.4 : 1.8, 0, false, () => this.w.rng.next(), perfect ? 1.3 : 1);
    this.metrics.bodyHits++; this.damage(result.dmg, 'body');
    h.addResonance(RESONANCE.perHit); this.w.rank.hit(false); this.w.rank.used(event.id);
  }

  private ignite(index: number): void {
    if (!this.canAct || this.lit[index]) return;
    this.lit[index] = true; this.flameLife[index] = FUNERAL_HEART.flameSeconds; this.heat[index] = 0;
    const b = this.braziers[index]; this.counterPulse(b.x, b.z, FUNERAL_HEART.counterDamage);
  }

  private counterPulse(x: number, z: number, damage: number): void {
    if (!this.canAct) return;
    this.metrics.counters++;
    this.fields.push({ id: ++this.entityId, x, z, r: 4.5, life: 0.9, dur: 0.9, kind: 'counter' });
    this.damage(damage, 'counter');
    if (!this.active) return;
    this.expose(6);
    // The return staggers the current ritual and clears its pending strikes.
    this.cancelAttack(); this.nextAttack = Math.max(this.nextAttack, 2.1);
    this.w.bus.emit('shockwave', { x, z, r: 8, color: 'gold', strength: 1 });
    this.w.heroRing(x, z, 5, 12, 1.6, 28);
  }

  private damage(amount: number, source: 'body' | 'counter' | 'reflection'): void {
    if (!this.canAct || !Number.isFinite(amount) || amount <= 0) return;
    const mul = source === 'body' ? (this.phase === 3 || this.exposed > 0 ? 1 : this.phase === 2 ? 0.42 : 0.24) : 1;
    const damage = Math.min(this.hp, Math.max(1, Math.round(amount * mul)));
    this.hp -= damage; this.w.run.dmgDealt += damage; this.hitFlash = 1;
    const phase = this.hp <= this.maxHp / 3 ? 3 : this.hp <= this.maxHp * 2 / 3 ? 2 : 1;
    if (phase > this.phase && this.hp > 0) {
      this.phase = phase; this.phaseSpawns = 0; this.nextSpawn = 2.5;
      this.cancelAttack(); this.nextAttack = 2; this.expose(6.5);
      this.w.bus.emit('bossPhase', { phase });
      this.w.bus.emit('shockwave', { x: 0, z: this.centerZ - 0.5, r: 10, color: 'hunger', strength: 1 });
    }
    if (this.hp <= 0) this.defeat();
  }

  private spawnCarriers(): void {
    if (!this.canAct) return;
    const count = Math.min(this.carriers.size ? 1 : 2, FUNERAL_HEART.maxCarriers - this.carriers.size, FUNERAL_HEART.carriersPerPhase - this.phaseSpawns);
    for (let i = 0; i < count; i++) {
      const index = this.metrics.spawnedTotal % 3, b = this.braziers[index];
      const p = { x: b.x * 1.05, z: b.z + (index === 2 ? -0.5 : 2) };
      this.w.arena.nearestWalkable(p.x, p.z, p);
      const enemy = createEnemy(this.phase > 1 && this.phaseSpawns % 3 === 2 ? 'reaper' : 'husk', { zone: this.w.zone, stage: this.w.stage, mode: this.w.mode, hpMul: 0.85 });
      enemy.x = p.x; enemy.z = p.z;
      this.carriers.set(enemy.id, enemy); this.w.addEnemy(enemy);
      this.phaseSpawns++; this.metrics.spawnedTotal++;
    }
  }

  private carrierDied(id: number, x: number, z: number): void {
    if (!this.carriers.delete(id) || !this.canAct) return;
    this.fields.push({ id: ++this.entityId, x, z, r: 2.05, life: FUNERAL_HEART.waxSeconds, dur: FUNERAL_HEART.waxSeconds, kind: 'wax' });
    for (let i = 0; i < 3; i++) if (Math.hypot(x - this.braziers[i].x, z - this.braziers[i].z) <= 3) this.ignite(i);
  }

  private stepFields(dt: number): void {
    for (const field of this.fields) field.life -= dt;
    for (let i = this.fields.length - 1; i >= 0; i--) if (this.fields[i].life <= 0) this.fields.splice(i, 1);
  }

  private nearestBrazier(x: number, z: number): number {
    let index = 0, distance = Infinity;
    for (let i = 0; i < 3; i++) {
      const b = this.braziers[i], d = Math.hypot(x - b.x, z - b.z);
      if (d < distance) { index = i; distance = d; }
    }
    return index;
  }

  private cancelAttack(): void {
    if (this.sequence) for (const t of this.sequence.telegraphs) t.alive = false;
    this.sequence = null; this.attack = null;
  }

  private defeat(): void {
    if (this.dead) return;
    this.dead = true; this.active = false; this.enabled = false;
    this.cleanup(); this.lit.fill(true); this.flameLife.fill(FUNERAL_HEART.flameSeconds);
    this.w.bus.emit('bossDeath', { x: this.body.x, z: this.body.z });
    this.onDefeated?.();
  }

  private cleanup(): void {
    this.cancelAttack(); this.shots.length = 0; this.fields.length = 0;
    // Disable the encounter first: cleanup kills cannot create fresh fire or counters.
    for (const enemy of this.carriers.values()) if (!enemy.dead) this.w.killEnemy(enemy, 0, 0, 0);
    this.carriers.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.active = false; this.enabled = false;
    this.w.aimTargets.delete(this.aimTarget);
    this.cleanup(); for (const off of this.offs) off(); this.onDefeated = null;
  }
}

function slashShape(event: GameEvents['slash']): Shape {
  const h = event.hit, dx = Math.sin(event.facing), dz = Math.cos(event.facing);
  switch (h.shape) {
    case 'arc': return { k: 'arc', x: event.x, z: event.z, r: h.radius * event.reach, dir: event.facing, half: h.angle * Math.PI / 360 };
    case 'circle': return { k: 'circle', x: event.x + dx * (h.offset ?? 0), z: event.z + dz * (h.offset ?? 0), r: h.radius * event.reach };
    case 'line': return { k: 'line', x: event.x - dx * LINE_BACK, z: event.z - dz * LINE_BACK, dx, dz, len: h.length * event.reach, w: h.width };
  }
}

function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
