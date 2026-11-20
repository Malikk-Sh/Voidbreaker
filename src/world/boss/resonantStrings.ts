import { BELL_STANDS } from '../../data/echoBells';
import { clamp, dampAngle } from '../../core/math';
import { overlaps, type Shape } from '../combat';
import type { Enemy } from '../enemy';
import type { Telegraph } from '../entities';
import type { AimTarget, World } from '../world';

type Lane = Extract<Shape, { k: 'line' }>;
const FLIGHT = 0.78;
const RETURN_REST = 0.99;

export interface QuarryString {
  bell: number;
  lane: Lane;
  knot: { x: number; z: number };
  show: number;
  launch: number;
  cut: boolean;
  target: AimTarget;
  warning: Telegraph | null;
  reversing: boolean;
  struck: boolean;
  // World-space position of the echo travelling along the string, in either direction.
  flight: number | null;
}

/** Each bell freezes a line through a footfall once, so stepping aside and cutting are both deliberate counters. */
export class ResonantStrings {
  readonly lines: QuarryString[] = [];
  active = false;
  elapsed = 0;
  private world: World | null = null;
  private phase = 1;
  private first = 0;
  private ordinal = 0;
  private count = 1;
  private readonly plant = { x: 0, z: 0 };
  private readonly perch = { x: 0, z: 0 };
  private footAt = 0;

  start(w: World, b: Enemy, phase: number): number {
    this.clear();
    this.world = w;
    this.active = true;
    this.phase = phase;
    this.count = phase === 1 ? 1 : 2;
    // Choose the source on the other side of the pilot, never a bell under their feet.
    const possible = [0, 1, 2].filter(i => Math.hypot(BELL_STANDS[i].x - w.hero.x, BELL_STANDS[i].z - w.hero.z) > 6);
    this.first = possible[this.ordinal++ % possible.length];
    this.pluck(w, b, this.first, 0);
    const last = phase === 1 ? 0 : this.secondAt;
    return last + this.wind + FLIGHT + (phase === 3 ? RETURN_REST + FLIGHT : 0) + 0.12;
  }
  private get wind(): number { return this.phase === 1 ? 1.85 : this.phase === 2 ? 1.42 : 1.32; }
  private get secondAt(): number { return this.phase === 2 ? 1.16 : 1.32; }
  private pluck(w: World, b: Enemy, bell: number, show: number): void {
    const anchor = BELL_STANDS[bell], h = w.hero;
    const distance = Math.hypot(h.x - anchor.x, h.z - anchor.z) || 1;
    const dx = (h.x - anchor.x) / distance, dz = (h.z - anchor.z) / distance;
    let extra = 3.6;
    while (extra > 0 && !w.arena.walkable(h.x + dx * extra, h.z + dz * extra)) extra = Math.max(0, extra - 0.35);
    const lane: Lane = { k: 'line', x: anchor.x, z: anchor.z, dx, dz, len: distance + extra, w: 2.15 };
    // Put the cutter's target inside the arena, in front of the incoming echo.
    const knot = { x: h.x, z: h.z };
    const approach = Math.min(distance * 0.66, this.phase === 1 ? 3.85 : 4.35);
    w.arena.move(h.x, h.z, -dx * approach, -dz * approach, 0.45, knot);
    if (this.phase >= 2) {
      this.footAt = show;
      this.plant.x = b.x; this.plant.z = b.z;
      // Lean back against the bell's pull and plant the other foreleg for the answering stroke.
      const side = show ? -1 : 1;
      w.arena.move(b.x, b.z, dz * 1.94 * side + dx * 0.53, -dx * 1.94 * side + dz * 0.53, b.radius, this.perch);
    }
    const warning = w.addTelegraph(lane, this.wind);
    warning.echo = 'quarry';
    const target = { ...knot, radius: 0.66, get targetable() { return Math.hypot(h.x - knot.x, h.z - knot.z) < 3.5; } };
    w.aimTargets.add(target);
    this.lines.push({ bell, lane, knot, target, show, launch: show + this.wind, cut: false,
      warning, reversing: false, struck: false, flight: null });
    w.bus.emit('sfx', { id: 'quarry_wire', x: anchor.x, z: anchor.z, pitch: 0.86 + bell * 0.12, gain: 0.62 });
    w.bus.emit('shockwave', { x: b.x, y: 2.3, z: b.z, r: 1.55, color: 'hunger', strength: 0.32 });
  }
  available(line: QuarryString): boolean { return this.active && !line.cut && this.elapsed < line.launch; }
  get downbeat(): boolean { return this.lines.some(l => this.available(l) && l.launch - this.elapsed <= 0.42); }

  cut(w: World, b: Enemy, shape: Shape, hits: Set<number>): boolean {
    // A long sweep spanning two marks still has to answer the second pluck separately.
    if (!this.active || hits.has(-24)) return false;
    const line = this.lines.find(l => this.available(l) && Math.hypot(w.hero.x - l.knot.x, w.hero.z - l.knot.z) <= 2.65 && overlaps(shape, l.knot.x, l.knot.z, 0.66));
    if (!line) return false;
    hits.add(-24);
    line.cut = true;
    w.aimTargets.delete(line.target);
    if (line.warning) line.warning.alive = false;
    const { x, z } = line.knot;
    w.bus.emit('shockwave', { x, y: 0.78, z, r: 2.35, color: 'gold', strength: 0.64 });
    w.bus.emit('sfx', { id: 'quarry_note', x, z, pitch: 1.08 + line.bell * 0.13, gain: 0.92 });
    const length = Math.hypot(b.x - x, b.z - z);
    if (length > 0.1) w.bus.emit('quarryWave', { x, z, dx: (b.x - x) / length, dz: (b.z - z) / length, len: length });
    return true;
  }
  get severed(): boolean { return this.lines.length === this.count && this.lines.every(l => l.cut); }
  get uncut(): boolean { return this.lines.every(l => !l.cut); }

  step(w: World, b: Enemy, now: number): void {
    const previous = this.elapsed;
    this.elapsed = now;
    if (this.count === 2 && this.lines.length === 1 && now >= this.secondAt) {
      const firstLane = this.lines[0].lane;
      // A different bearing makes the second response cross the first, even against a running player.
      let next = (this.first + 1) % 3, best = -Infinity;
      BELL_STANDS.forEach((p, i) => {
        if (i === this.first) return;
        const x = w.hero.x - p.x, z = w.hero.z - p.z, d = Math.hypot(x, z);
        const score = Math.abs(x * firstLane.dz - z * firstLane.dx) / Math.max(d, 0.01) - (d < 5.5 ? 2 : 0);
        if (score > best) { best = score; next = i; }
      });
      this.pluck(w, b, next, this.secondAt);
    }
    if (this.phase >= 2) {
      const u = clamp((now - this.footAt) / 0.95, 0, 1), ease = u * u * (3 - 2 * u);
      b.x = this.plant.x + (this.perch.x - this.plant.x) * ease;
      b.z = this.plant.z + (this.perch.z - this.plant.z) * ease;
      b.facing = dampAngle(b.facing, Math.atan2(w.hero.x - b.x, w.hero.z - b.z), 0.34, now - previous);
    }
    for (const line of this.lines) {
      line.flight = null;
      if (line.cut) continue;
      const at = line.launch, back = at + FLIGHT + RETURN_REST;
      if (!line.reversing) this.travel(w, b, line, previous, now, at);
      if (this.phase === 3 && !line.reversing && now >= at + FLIGHT) {
        line.reversing = true;
        line.struck = false;
        line.warning = w.addTelegraph(line.lane, Math.max(0.01, back - now));
        line.warning.echo = 'quarry';
        const l = line.lane;
        w.bus.emit('sfx', { id: 'echo_pebble', x: l.x + l.dx * l.len, z: l.z + l.dz * l.len, gain: 0.74 });
      }
      if (line.reversing) this.travel(w, b, line, previous, now, back);
    }
  }

  private travel(w: World, b: Enemy, line: QuarryString, previous: number, now: number, start: number): void {
    if (now < start || previous >= start + FLIGHT) return;
    const a = clamp((previous - start) / FLIGHT, 0, 1), u = clamp((now - start) / FLIGHT, 0, 1);
    const l = line.lane, sign = line.reversing ? -1 : 1;
    const from = (line.reversing ? 1 - a : a) * l.len;
    line.flight = line.reversing ? 1 - u : u;
    if (previous < start) {
      if (line.warning) line.warning.alive = false;
      w.aimTargets.delete(line.target);
      w.bus.emit('sfx', { id: 'slash_enemy', x: l.x + l.dx * from, z: l.z + l.dz * from, gain: 0.7 });
    }
    if (line.struck) return;
    const strike: Lane = { ...l, x: l.x + l.dx * from, z: l.z + l.dz * from,
      dx: l.dx * sign, dz: l.dz * sign, len: (u - a) * l.len };
    line.struck = w.enemyStrike({ id: b.id, kind: b.kind, x: strike.x, z: strike.z }, strike,
      b.dmg * (line.reversing ? 0.86 : 1.12), 4) !== 'miss';
  }

  clear(): void {
    for (const line of this.lines) {
      if (line.warning) line.warning.alive = false;
      this.world?.aimTargets.delete(line.target);
    }
    this.world = null;
    this.lines.length = 0;
    this.elapsed = 0;
    this.active = false;
  }
}
