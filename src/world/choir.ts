import type { Telegraph } from './entities';
import type { World } from './world';

/** Ответный псалом: места шагов запоминаются заранее, рывок в такт возвращает весь аккорд. */
export const CHOIR = { first: 4, rest: 5.8, spacing: 0.65, warning: 1.3, radius: 2.1, damage: 0.12, enemyMult: 1.8, quiet: 9, returnRadius: 8, returnMult: 2.4, resonance: 12 };
interface Note { x: number; z: number; left: number; index: number; total: number; tele: Telegraph }

export class ChoirPsalm {
  readonly notes: Note[] = [];
  private active = false;
  private wave = 0;
  private timer = CHOIR.first;
  private remaining = 0;
  private count = 1;
  private quietT = 0;
  private readonly offs: (() => void)[];
  private readonly hook = (dt: number) => this.update(dt);

  constructor(private readonly w: World) {
    this.offs = [
      w.bus.on('waveStart', e => { this.cancel(); this.active = true; this.wave = e.index; this.timer = CHOIR.first; this.quietT = 0; }),
      w.bus.on('waveClear', () => this.stop()),
      w.bus.on('stageClear', () => this.stop()),
      w.bus.on('heroDeath', () => this.stop()),
    ];
    w.stepHooks.push(this.hook);
  }

  get silenced(): boolean { return this.quietT > 0; }

  private update(dt: number): void {
    if (!this.active || dt <= 0) return;
    // Интро, пауза и Раскол не дают невидимым меткам дозреть под закрытым HUD.
    if (this.w.hero.scripted || this.w.hero.locked || this.w.shatterSeq) { this.cancel(); this.timer = Math.max(this.timer, CHOIR.first); return; }
    this.quietT = Math.max(0, this.quietT - dt);
    for (const note of [...this.notes]) {
      note.left -= dt;
      if (note.left > 1e-7 || !this.notes.includes(note)) continue;
      this.notes.splice(this.notes.indexOf(note), 1); note.tele.alive = false;
      this.impact(note);
      if (!this.active) return;
    }
    this.timer -= dt;
    if (this.timer > 1e-7) return;
    if (this.remaining === 0) { this.count = Math.min(3, 1 + Math.ceil(this.wave / 2)); this.remaining = this.count; }
    const h = this.w.hero, p = { x: 0, z: 0 };
    this.w.arena.nearestWalkable(h.x, h.z, p);
    const index = this.count - this.remaining + 1;
    const tele = this.w.addTelegraph({ k: 'circle', x: p.x, z: p.z, r: CHOIR.radius }, CHOIR.warning);
    this.notes.push({ x: p.x, z: p.z, left: CHOIR.warning, index, total: this.count, tele });
    this.w.bus.emit('choir', { kind: 'mark', x: p.x, z: p.z, radius: CHOIR.radius, note: index, total: this.count });
    this.remaining--;
    this.timer += this.remaining ? CHOIR.spacing : CHOIR.rest;
  }

  private impact(n: Note): void {
    const w = this.w, h = w.hero;
    const result = w.enemyStrike({ x: 0, z: -3.6, id: -919, kind: 'Псалом Хоров' }, { k: 'circle', x: n.x, z: n.z, r: CHOIR.radius }, h.maxHp * CHOIR.damage, 1.5);
    if (result === 'perfect') {
      this.cancel(); this.quietT = CHOIR.quiet; this.timer = CHOIR.quiet;
      h.addResonance(CHOIR.resonance);
      w.heroRing(n.x, n.z, CHOIR.returnRadius, 18, CHOIR.returnMult, 60);
      w.bus.emit('choir', { kind: 'return', x: n.x, z: n.z, radius: CHOIR.returnRadius, note: n.index, total: n.total });
      return;
    }
    // Враждебный псалом тоже бьёт чудовищ: можно заманить толпу в запомненное место.
    w.heroStrike({ k: 'circle', x: n.x, z: n.z, r: CHOIR.radius }, new Set(), {
      mult: CHOIR.enemyMult, stun: 8, knockback: 2, feel: 'heavy', dirX: 0, dirZ: 1, source: 'env', noResonance: true,
    });
    w.bus.emit('choir', { kind: 'impact', x: n.x, z: n.z, radius: CHOIR.radius, note: n.index, total: n.total });
  }

  private cancel(): void { for (const n of this.notes) n.tele.alive = false; this.notes.length = 0; this.remaining = 0; }
  private stop(): void { this.active = false; this.cancel(); this.quietT = 0; }
  dispose(): void {
    this.stop(); for (const off of this.offs) off();
    const i = this.w.stepHooks.indexOf(this.hook); if (i >= 0) this.w.stepHooks.splice(i, 1);
  }
}
