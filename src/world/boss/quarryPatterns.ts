import { clamp } from '../../core/math';
import { overlaps, type Shape } from '../combat';
import type { Enemy } from '../enemy';
import type { Telegraph } from '../entities';
import type { World } from '../world';

export type HuntPattern = 'fault' | 'caveIn' | 'inhale';
type MarkKind = 'crack' | 'slab' | 'landing' | 'maw' | 'vent';

interface Mark {
  kind: MarkKind;
  shape: Shape;
  show: number;
  at: number;
  power: number;
  warning: Telegraph | null;
  struck: boolean;
}

const DURATIONS = { fault: 2.54, caveIn: 3.0, inhale: 2.88 };
const LEAP_START = 1.84;
const LAND = 2.54;

export function isHuntPattern(attack: string): attack is HuntPattern {
  return attack === 'fault' || attack === 'caveIn' || attack === 'inhale';
}

/** A sequence owns its marks, movement and live geometry. Clearing it silences every remaining beat. */
export class QuarryPatterns {
  kind: HuntPattern | null = null;
  readonly marks: Mark[] = [];
  elapsed = 0;
  x = 0;
  z = 0;
  facing = 0;
  private owner: Enemy | null = null;
  private readonly moved = { x: 0, z: 0 };

  start(w: World, b: Enemy, kind: HuntPattern): number {
    this.clear();
    this.owner = b;
    this.kind = kind;
    this.x = b.x;
    this.z = b.z;
    this.facing = b.facing;
    if (kind === 'fault') {
      this.ray(-0.40, 15, 2.3, 0, 1.0, 'crack', 0.94);
      this.ray(0.40, 15, 2.3, 0, 1.0, 'crack', 0.94);
      this.ray(0, 17, 3.4, 1.04, 1.99, 'crack', 1.14);
    } else if (kind === 'caveIn') {
      this.rock('slab', 0, 1.03, 2.45, 0.83);
      this.rock('slab', 0.55, 1.56, 2.55, 0.88);
      this.rock('landing', 1.36, LAND, 2.98, 1.18);
    } else {
      this.mark('maw', { k: 'arc', x: b.x, z: b.z, dir: b.facing, half: 0.67, r: 10.7 }, 0, 1.47, 0.55);
      this.ray(0, 23, 3.4, 1.45, 2.43, 'vent', 1.28);
    }
    this.step(w, b, 0, 0);
    return DURATIONS[kind];
  }

  private ray(turn: number, len: number, width: number, show: number, at: number, kind: MarkKind, power: number): void {
    const angle = this.facing + turn;
    this.mark(kind, { k: 'line', x: this.x, z: this.z, dx: Math.sin(angle), dz: Math.cos(angle), len, w: width }, show, at, power);
  }

  private rock(kind: 'slab' | 'landing', show: number, at: number, r: number, power: number): void {
    this.mark(kind, { k: 'circle', x: 0, z: 0, r }, show, at, power);
  }

  private mark(kind: MarkKind, shape: Shape, show: number, at: number, power: number): void {
    this.marks.push({ kind, shape, show, at, power, warning: null, struck: false });
  }

  private warn(w: World, b: Enemy, m: Mark): void {
    const s = m.shape;
    if (s.k === 'circle') {
      const lead = m.kind === 'slab' ? 0.18 : 0.06;
      w.arena.nearestWalkable(w.hero.x + lead * w.hero.vx, w.hero.z + lead * w.hero.vz, this.moved);
      s.x = this.moved.x;
      s.z = this.moved.z;
      if (m.kind === 'landing') b.facing = Math.atan2(s.x - b.x, s.z - b.z);
    }
    m.warning = w.addTelegraph(s, m.at - m.show);
    b.lastTeleDur = m.warning.dur;
    if (m.kind === 'vent') m.warning.echo = 'quarry';
    if (m.kind === 'crack' && m === this.marks[1]) return;
    w.bus.emit('telegraph', { kind: m.kind === 'slab' ? 'whistle' : m.kind === 'vent' ? 'chime' : 'hum', x: s.x, z: s.z });
  }

  step(w: World, b: Enemy, age: number, dt: number): void {
    this.elapsed = age;
    for (const m of this.marks) {
      if (age < m.show || m.struck) continue;
      if (!m.warning) this.warn(w, b, m);
      if (m.kind === 'landing' && age >= LEAP_START) {
        const u = clamp((age - LEAP_START) / (LAND - LEAP_START), 0, 1);
        b.x = this.x + (m.shape.x - this.x) * u;
        b.z = this.z + (m.shape.z - this.z) * u;
        b.y = Math.sin(Math.PI * u) * 3.8;
      }
      if (age >= m.at) {
        m.struck = true;
        this.impact(w, b, m);
      } else if (m.kind === 'maw') {
        this.drawIn(w, m.shape, dt);
      }
    }
  }

  private drawIn(w: World, s: Shape, dt: number): void {
    const h = w.hero;
    if (h.state === 'dash' || h.invulnerable || h.locked || !overlaps(s, h.x, h.z, h.radius)) return;
    const dx = this.x - h.x, dz = this.z - h.z, d = Math.hypot(dx, dz);
    if (d <= 2) return;
    const speed = 2.6 * Math.min(1, this.elapsed / 0.5);
    w.arena.move(h.x, h.z, dx / d * speed * dt, dz / d * speed * dt, h.radius, this.moved);
    h.x = this.moved.x;
    h.z = this.moved.z;
  }

  private impact(w: World, b: Enemy, m: Mark): void {
    const s = m.shape;
    w.enemyStrike({ id: b.id, kind: b.kind, x: s.x, z: s.z }, s, b.dmg * m.power, m.kind === 'vent' ? 8 : 4.5);
    if (s.k === 'circle') {
      w.bus.emit('impact', { kind: 'slam', x: s.x, z: s.z, r: s.r });
      w.bus.emit('shake', { trauma: m.kind === 'landing' ? 0.32 : 0.17 });
      w.bus.emit('sfx', { id: m.kind === 'landing' ? 'slam' : 'shatter_stone', x: s.x, z: s.z, gain: 0.75 });
    } else if (s.k === 'line') {
      w.bus.emit('quarryWave', { x: s.x, z: s.z, dx: s.dx, dz: s.dz, len: s.len });
      if (m !== this.marks[1] || m.show !== 0)
        w.bus.emit('sfx', { id: m.kind === 'vent' ? 'well_collapse' : 'shatter_stone', x: s.x, z: s.z, gain: 0.9 });
    } else {
      w.bus.emit('shockwave', { x: this.x, y: 1.8, z: this.z, r: 2.6, color: 'void', strength: 0.45 });
    }
  }

  clear(): void {
    for (const mark of this.marks) if (mark.warning) mark.warning.alive = false;
    if (this.owner) this.owner.y = 0;
    this.marks.length = 0;
    this.owner = null;
    this.kind = null;
    this.elapsed = 0;
  }
}
