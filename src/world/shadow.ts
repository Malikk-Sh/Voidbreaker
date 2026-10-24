import { SHADOW } from '../data/enemies';
import type { Shape } from './combat';
import type { Enemy } from './enemy';
import type { Telegraph } from './entities';
import type { World } from './world';

/** Сколько поз помнить (с запасом над задержкой при 60 шагах/с). */
const SLOTS = 64;
/** Метку, снятую раньше конца больше чем на столько, считаем прерванной атакой. */
const CANCEL_EPS = 0.06;

interface Pending { at: number; src: Telegraph; group: number }
interface Echo { tele: Telegraph; src: Telegraph; group: number; cancelAt: number }

function moved(s: Shape, dx: number, dz: number): Shape {
  return { ...s, x: s.x + dx, z: s.z + dz } as Shape;
}

/**
 * Аффикс «Тень» (план §7.6, заменил «Зеркальный»): тёмно-красная полупрозрачная копия элиты повторяет каждую
 * атаку через 0.6 с со своей позиции — тело воспроизводит позу оригинала с той же задержкой, метки на полу
 * повторяются тёмными, удар — 40 % урона. Без полосы HP, не цель. Исчезает при оглушении или гибели оригинала.
 * Учит менять позицию после уклонения.
 */
export class ShadowCopy {
  alive = true;
  /** Видимость 0..1: проявление и растворение. */
  vis = 0;
  /** Сдвиг копии от оригинала (м, мир). */
  ox: number; oz: number;
  /** Мировые матрицы суставов позы 0.6 с назад со сдвигом — для рендера. */
  readonly world: Float32Array;
  /** Есть поза для показа (история набралась). */
  ready = false;
  private t = 0;
  private hist: { t: number; m: Float32Array; x: number; z: number }[] = [];
  private head = 0;
  private seen = new Set<Telegraph>();
  private pending: Pending[] = [];
  private echoes: Echo[] = [];
  private hitGroups = new Set<number>();
  private group = 0;

  constructor(readonly owner: Enemy, w: World) {
    const n = owner.puppet.skel.world.length;
    this.world = new Float32Array(n);
    for (let i = 0; i < SLOTS; i++) this.hist.push({ t: -1e9, m: new Float32Array(n), x: 0, z: 0 });
    // сбоку от оригинала; если там стена или провал — с другой стороны
    let ox = Math.cos(owner.facing) * SHADOW.offset, oz = -Math.sin(owner.facing) * SHADOW.offset;
    if (!w.arena.walkable(owner.x + ox, owner.z + oz)) { ox = -ox; oz = -oz; }
    this.ox = ox; this.oz = oz;
  }

  /** Где стоит копия сейчас (её поза — 0.6 с назад). */
  get x(): number { return this.posX + this.ox; }
  get z(): number { return this.posZ + this.oz; }
  private posX = 0; private posZ = 0;

  /** Копия гаснет: метки и удары, которые она ещё не повторила, пропадают. */
  dispel(w: World): void {
    if (!this.alive) return;
    this.alive = false;
    for (const e of this.echoes) e.tele.alive = false;
    this.echoes.length = 0;
    this.pending.length = 0;
    if (this.ready) w.bus.emit('shadow', { kind: 'gone', x: this.x, z: this.z });
  }

  step(w: World, dt: number): void {
    this.t += dt;
    const o = this.owner;
    if (this.alive && (o.dead || o.stunned || !w.enemies.includes(o))) this.dispel(w);
    if (!this.alive) { this.vis = Math.max(0, this.vis - dt * 3); return; }

    // запись позы оригинала
    if (o.spawned) {
      const s = this.hist[this.head];
      s.t = this.t; s.m.set(o.puppet.skel.world); s.x = o.x; s.z = o.z;
      this.head = (this.head + 1) % SLOTS;
    }

    // каждая новая атакующая метка оригинала повторится через 0.6 с; метки одного шага — одна атака
    this.group++;
    for (const tl of w.telegraphs) {
      if (tl.owner !== o || tl.echo || tl.buff || this.seen.has(tl)) continue;
      this.seen.add(tl);
      this.pending.push({ at: this.t + SHADOW.delay, src: tl, group: this.group });
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      // атаку прервали до того, как копия начала её повторять, — повторять нечего
      if (this.cancelled(p.src)) { this.pending.splice(i, 1); continue; }
      if (this.t < p.at) continue;
      this.pending.splice(i, 1);
      const tele = w.addTelegraph(moved(p.src.shape, this.ox, this.oz), Math.max(0.05, p.src.dur));
      tele.echo = true;
      this.echoes.push({ tele, src: p.src, group: p.group, cancelAt: Infinity });
    }
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const e = this.echoes[i];
      // оригинал прервали позже — копия прерывается с той же задержкой
      if (e.cancelAt === Infinity && this.cancelled(e.src)) e.cancelAt = this.t + SHADOW.delay;
      if (this.t >= e.cancelAt) { e.tele.alive = false; this.echoes.splice(i, 1); continue; }
      // форма оригинала могла доворачиваться: повторяем её с задержкой
      if (e.tele.t < e.tele.dur) { e.tele.shape = moved(e.src.shape, this.ox, this.oz); continue; }
      this.echoes.splice(i, 1);
      if (this.hitGroups.has(e.group)) continue;
      const r = w.enemyStrike({ x: this.x, z: this.z, id: -3, kind: 'shadow' }, e.tele.shape, o.dmg * SHADOW.dmg, 3);
      if (r !== 'miss') this.hitGroups.add(e.group);
    }

    // поза для показа: самая свежая не новее «сейчас − 0.6 с»
    const target = this.t - SHADOW.delay;
    let best: { t: number; m: Float32Array; x: number; z: number } | null = null;
    for (const s of this.hist) if (s.t <= target && (!best || s.t > best.t)) best = s;
    if (!best || best.t < -1e8) return;
    if (!this.ready) { this.ready = true; w.bus.emit('shadow', { kind: 'spawn', x: best.x + this.ox, z: best.z + this.oz }); }
    this.vis = Math.min(1, this.vis + dt * 2.5);
    this.posX = best.x; this.posZ = best.z;
    const m = best.m, out = this.world;
    out.set(m);
    for (let j = 0; j + 15 < out.length; j += 16) { out[j + 12] += this.ox; out[j + 14] += this.oz; }
  }

  private cancelled(t: Telegraph): boolean { return !t.alive && t.t < t.dur - CANCEL_EPS; }
}
