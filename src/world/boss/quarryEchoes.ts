import type { Shape } from '../combat';
import type { Telegraph } from '../entities';
import type { Enemy } from '../enemy';
import type { World } from '../world';

type EchoShape = Extract<Shape, { k: 'circle' | 'line' }>;
interface Echo {
  shape: EchoShape;
  warning: Telegraph;
  remaining: number;
  bell?: number;
}

/** A sound fixes one patch of floor. Its warning and eventual strike share the same shape. */
export class QuarryEchoes {
  private pending: Echo[] = [];

  footprint(w: World, x: number, z: number, last: boolean): void {
    const shape: EchoShape = { k: 'circle', x, z, r: last ? 2.65 : 2.05 };
    this.warn(w, shape, last ? 0.94 : 0.8);
    w.bus.emit('sfx', { id: 'echo_pebble', x, z, gain: 0.58 });
  }

  call(w: World, bell: number, x: number, z: number): Extract<EchoShape, { k: 'line' }> {
    let dx = w.hero.x - x, dz = w.hero.z - z;
    if (Math.hypot(dx, dz) < 0.4) { dx = -x; dz = -z; }
    const dist = Math.hypot(dx, dz) || 1;
    const ray = { k: 'line' as const, x, z, dx: dx / dist, dz: dz / dist, len: 27, w: 2.55 };
    this.warn(w, ray, 1.08, bell);
    w.bus.emit('bellPulse', { x, y: 1.4, z, big: false });
    w.bus.emit('telegraph', { kind: 'chime', x, z });
    return ray;
  }

  private warn(w: World, shape: EchoShape, delay: number, bell?: number): void {
    const warning = w.addTelegraph(shape, delay);
    warning.echo = 'quarry';
    this.pending.push({ shape, warning, remaining: delay, bell });
  }

  isCalling(bell: number): boolean { return this.pending.some(e => e.bell === bell); }

  step(w: World, owner: Enemy, dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      e.remaining -= dt;
      if (e.remaining > 0) continue;
      const s = e.shape;
      w.enemyStrike({ id: owner.id, kind: owner.kind, x: s.x, z: s.z }, s, owner.dmg * (s.k === 'line' ? 1.04 : 0.84), 4);
      if (s.k === 'circle') {
        w.bus.emit('impact', { kind: 'slam', x: s.x, z: s.z, r: s.r });
        w.bus.emit('sfx', { id: 'shatter_stone', x: s.x, z: s.z, gain: 0.6 });
      } else {
        w.bus.emit('quarryWave', { x: s.x, z: s.z, dx: s.dx, dz: s.dz, len: s.len });
        w.bus.emit('sfx', { id: 'boss_bell', x: s.x, z: s.z, gain: 0.82 });
      }
      this.pending.splice(i, 1);
    }
  }

  clear(): void {
    for (const echo of this.pending) echo.warning.alive = false;
    this.pending.length = 0;
  }
}
