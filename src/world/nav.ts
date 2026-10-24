import type { Arena } from './arena';

/** Порог «крупного» врага: ему нужны проходы с зазором (план §4.4). */
export const BIG_RADIUS = 0.9;
const CELL = 0.5;
const DIAG = Math.SQRT2;
/** 8 соседей плоскими массивами: индексный цикл без итераторов и деструктуризации (не мусорит в горячих циклах). */
const N8I = [1, -1, 0, 0, 1, 1, -1, -1];
const N8J = [0, 0, 1, -1, 1, -1, 1, -1];
const N8C = [1, 1, 1, 1, DIAG, DIAG, DIAG, DIAG];

/** Минимальная двоичная куча по приоритету (Дейкстра) на типизированных массивах: растёт удвоением, не мусорит. */
class Heap {
  private ids = new Int32Array(1024);
  private pr = new Float32Array(1024);
  private n = 0;
  get size(): number { return this.n; }
  clear(): void { this.n = 0; }
  push(id: number, p: number): void {
    if (this.n === this.ids.length) {
      const ids = new Int32Array(this.n * 2), pr = new Float32Array(this.n * 2);
      ids.set(this.ids); pr.set(this.pr);
      this.ids = ids; this.pr = pr;
    }
    const a = this.ids, q = this.pr;
    let i = this.n++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (q[up] <= p) break;
      a[i] = a[up]; q[i] = q[up];
      i = up;
    }
    a[i] = id; q[i] = p;
  }
  /** Извлечь минимум: [id, приоритет] в out. */
  pop(out: [number, number]): void {
    const a = this.ids, q = this.pr;
    out[0] = a[0]; out[1] = q[0];
    const n = --this.n;
    if (n <= 0) return;
    const lastId = a[n], lastP = q[n];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i, mp = lastP;
      if (l < n && q[l] < mp) { m = l; mp = q[l]; }
      if (r < n && q[r] < mp) { m = r; mp = q[r]; }
      if (m === i) break;
      a[i] = a[m]; q[i] = q[m];
      i = m;
    }
    a[i] = lastId; q[i] = lastP;
  }
}

/**
 * Навигация врагов (план §4.4): сетка 0.5 м поверх арены, карта зазора и два поля потоков к герою —
 * для обычных и для крупных (им нужен проход шире радиуса). Поле пересчитывается, когда герой сменил клетку
 * (не чаще 4 раз в секунду) или изменилась арена (плиты рухнули/поднялись, появились временные стены).
 */
export class NavGrid {
  readonly nx: number;
  readonly nz: number;
  readonly x0: number;
  readonly z0: number;
  readonly cell = CELL;
  /** 1 — непроходимо. */
  readonly blocked: Uint8Array;
  /** Расстояние (м) до ближайшей непроходимой клетки. */
  readonly clearance: Float32Array;
  /** Длина пути до героя (м); Infinity — недостижимо. */
  readonly field: Float32Array;
  readonly fieldBig: Float32Array;
  private builtVersion = -1;
  private heroCell = -1;
  private recalcT = 0;
  private fieldsDirty = true;
  private readonly heap = new Heap();
  private readonly tmp: [number, number] = [0, 0];

  constructor(private arena: Arena) {
    const b = arena.bounds;
    this.x0 = b.minX - 2; this.z0 = b.minZ - 2;
    this.nx = Math.ceil((b.maxX + 2 - this.x0) / CELL);
    this.nz = Math.ceil((b.maxZ + 2 - this.z0) / CELL);
    const n = this.nx * this.nz;
    this.blocked = new Uint8Array(n);
    this.clearance = new Float32Array(n);
    this.field = new Float32Array(n).fill(Infinity);
    this.fieldBig = new Float32Array(n).fill(Infinity);
    this.rebuild();
  }

  idx(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  cx(id: number): number { return this.x0 + ((id % this.nx) + 0.5) * CELL; }
  cz(id: number): number { return this.z0 + (Math.floor(id / this.nx) + 0.5) * CELL; }

  /** Непроходимость и карта зазора по текущему состоянию арены. */
  rebuild(): void {
    const a = this.arena;
    this.builtVersion = a.version;
    const B = this.blocked, C = this.clearance;
    for (let id = 0; id < B.length; id++) {
      const x = this.cx(id), z = this.cz(id);
      let bl = !a.walkable(x, z);
      if (!bl) for (const c of a.covers) if (Math.hypot(x - c.x, z - c.z) < c.r + 0.5) { bl = true; break; }
      B[id] = bl ? 1 : 0;
      C[id] = Infinity;
    }
    // зазор: многоисточниковая Дейкстра от непроходимых клеток (край сетки — тоже стена)
    const h = this.heap; h.clear();
    for (let id = 0; id < B.length; id++) {
      const i = id % this.nx, j = (id / this.nx) | 0;
      if (B[id] || i === 0 || j === 0 || i === this.nx - 1 || j === this.nz - 1) { C[id] = 0; h.push(id, 0); }
    }
    this.flood(C, (id) => id >= 0);
    this.fieldsDirty = true;
  }

  /** Обновить поля потоков к герою. force — пересчитать сейчас (спаун, тесты). */
  update(dt: number, hx: number, hz: number, force = false): void {
    if (this.arena.version !== this.builtVersion) this.rebuild();
    this.recalcT -= dt;
    let hc = this.idx(hx, hz);
    if (hc < 0 || this.blocked[hc]) hc = this.nearestOpen(hx, hz);
    if (hc < 0) return;
    if (!force && !this.fieldsDirty && (hc === this.heroCell || this.recalcT > 0)) return;
    this.heroCell = hc;
    this.recalcT = 0.25;
    this.fieldsDirty = false;
    this.solve(this.field, hc, 0);
    // крупным — только клетки с зазором; старт ищем ближайший подходящий к герою
    let bc = hc;
    if (this.clearance[bc] < BIG_RADIUS) bc = this.nearestOpen(hx, hz, BIG_RADIUS);
    if (bc >= 0) this.solve(this.fieldBig, bc, BIG_RADIUS);
    else this.fieldBig.fill(Infinity);
  }

  private solve(F: Float32Array, start: number, minClear: number): void {
    F.fill(Infinity);
    F[start] = 0;
    const h = this.heap; h.clear();
    h.push(start, 0);
    const C = this.clearance, B = this.blocked;
    this.flood(F, (id) => !B[id] && C[id] >= minClear);
  }

  /** Дейкстра по 8 соседям: F уже заполнено стартами в куче; ok — можно ли войти в клетку. */
  private flood(F: Float32Array, ok: (id: number) => boolean): void {
    const h = this.heap, t = this.tmp, nx = this.nx, nz = this.nz;
    while (h.size) {
      h.pop(t);
      const id = t[0], d = t[1];
      if (d > F[id]) continue;
      const i = id % nx, j = (id / nx) | 0;
      for (let k = 0; k < 8; k++) {
        const di = N8I[k], dj = N8J[k], c = N8C[k];
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const nid = jj * nx + ii;
        if (!ok(nid)) continue;
        // по диагонали — только если оба боковых соседа проходимы (не срезать углы колонн)
        if (di && dj && (!ok(j * nx + ii) || !ok(jj * nx + i))) continue;
        const nd = d + c * CELL;
        if (nd < F[nid]) { F[nid] = nd; h.push(nid, nd); }
      }
    }
  }

  /** Ближайшая проходимая клетка (с зазором не меньше minClear). */
  nearestOpen(x: number, z: number, minClear = 0): number {
    let best = -1, bd = Infinity;
    const ci = Math.floor((x - this.x0) / CELL), cj = Math.floor((z - this.z0) / CELL);
    for (let r = 0; r < 40 && best < 0; r++) {
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const id = j * this.nx + i;
        if (this.blocked[id] || this.clearance[id] < minClear) continue;
        const d = Math.hypot(this.cx(id) - x, this.cz(id) - z);
        if (d < bd) { bd = d; best = id; }
      }
    }
    return best;
  }

  /** Ближайшая к точке клетка, из которой герой достижим (спаун ближнего боя, план §4.4 п. 8). */
  nearestReachable(x: number, z: number, big = false, out: { x: number; z: number } = { x: 0, z: 0 }): boolean {
    const F = big ? this.fieldBig : this.field;
    const ci = Math.floor((x - this.x0) / CELL), cj = Math.floor((z - this.z0) / CELL);
    for (let r = 0; r < Math.max(this.nx, this.nz); r++) {
      let best = -1, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const id = j * this.nx + i;
        if (F[id] === Infinity) continue;
        const d = Math.hypot(this.cx(id) - x, this.cz(id) - z);
        if (d < bd) { bd = d; best = id; }
      }
      if (best >= 0) { out.x = this.cx(best); out.z = this.cz(best); return true; }
    }
    return false;
  }

  /** Длина пути до героя из точки (м); Infinity — недостижимо. */
  distance(x: number, z: number, big = false): number {
    const id = this.idx(x, z);
    if (id < 0) return Infinity;
    const F = big ? this.fieldBig : this.field;
    if (F[id] < Infinity) return F[id];
    // точка на границе клетки, упёршейся в стену: ближайшая открытая клетка рядом
    const n = this.nearestOpen(x, z, big ? BIG_RADIUS : 0);
    return n >= 0 && Math.hypot(this.cx(n) - x, this.cz(n) - z) < 0.8 ? F[n] : Infinity;
  }

  reachable(x: number, z: number, big = false): boolean { return this.distance(x, z, big) < Infinity; }

  /** Достижимая точка в кольце [r0, r1] м пути от героя (уход порталом, подкрепления). */
  pointNearHero(hx: number, hz: number, r0: number, r1: number, big: boolean, rng: { next(): number }): { x: number; z: number } | null {
    const F = big ? this.fieldBig : this.field;
    let pick: number = -1, seen = 0;
    for (let id = 0; id < F.length; id++) {
      const v = F[id];
      if (v < r0 || v > r1) continue;
      const d = Math.hypot(this.cx(id) - hx, this.cz(id) - hz);
      if (d < r0 * 0.7) continue;
      // равномерный выбор без массива кандидатов
      seen++;
      if (rng.next() * seen < 1) pick = id;
    }
    if (pick < 0) return null;
    return { x: this.cx(pick), z: this.cz(pick) };
  }

  /**
   * Направление вниз по полю (к герою): в out — точка-ориентир на ~1 м вперёд по пути. false — недостижимо.
   * Берётся лучший из 8 соседей; при равенстве — тот, что ближе к прямому направлению.
   */
  descend(x: number, z: number, big: boolean, out: { x: number; z: number }): boolean {
    const F = big ? this.fieldBig : this.field;
    let id = this.idx(x, z);
    if (id < 0) return false;
    if (F[id] === Infinity) {
      id = this.nearestOpen(x, z, big ? BIG_RADIUS : 0);
      if (id < 0 || F[id] === Infinity) return false;
      out.x = this.cx(id); out.z = this.cz(id);
      return true;
    }
    // пройти по полю два шага — сглаживает ступенчатость сетки
    let cur = id;
    for (let s = 0; s < 2; s++) {
      const i = cur % this.nx, j = (cur / this.nx) | 0;
      let best = cur, bv = F[cur];
      for (let k = 0; k < 8; k++) {
        const ii = i + N8I[k], jj = j + N8J[k];
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue;
        const nid = jj * this.nx + ii;
        if (F[nid] < bv - 1e-4) { bv = F[nid]; best = nid; }
      }
      if (best === cur) break;
      cur = best;
    }
    out.x = this.cx(cur); out.z = this.cz(cur);
    return true;
  }

  /** Отрезок свободен для тела радиуса r (провалы, стены, укрытия). */
  losClear(ax: number, az: number, bx: number, bz: number, r = 0): boolean {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    for (let s = 1; s <= steps; s++) {
      const id = this.idx(ax + (dx * s) / steps, az + (dz * s) / steps);
      if (id < 0 || this.blocked[id] || this.clearance[id] < r) return false;
    }
    return true;
  }
}
