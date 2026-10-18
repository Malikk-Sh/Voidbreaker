import { arenaBounds, inArenaShape, inHole, type ArenaDef } from '../data/arenas';

export enum TileState { Gone = 0, Alive = 1, Falling = 2, Rising = 3, Warning = 4 }

export interface Tile {
  i: number; j: number; x: number; z: number;
  state: TileState;
  /** Анимация падения/подъёма: y-смещение, скорость, таймер до возрождения. */
  y: number; vy: number; rot: number; timer: number;
  /** Принадлежит кресту-мосту (не обрушается во второй фазе босса). */
  cross: boolean;
  dirty: boolean;
}

/**
 * Игровая арена (Tech §14): сетка плиток — источник проходимости, ямы и разрушаемые плиты
 * (динамические арены меняют маску по событию `arena`).
 */
export class Arena {
  readonly tiles: Tile[] = [];
  private grid: (Tile | undefined)[] = [];
  readonly nx: number; readonly nz: number;
  readonly x0: number; readonly z0: number;
  readonly t: number;
  edge: 'wall' | 'abyss';
  readonly covers: { x: number; z: number; r: number }[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  tilesDirty = true;

  constructor(readonly def: ArenaDef) {
    this.t = def.tile;
    this.edge = def.edge;
    this.bounds = arenaBounds(def);
    this.x0 = Math.floor(this.bounds.minX / this.t) * this.t - this.t;
    this.z0 = Math.floor(this.bounds.minZ / this.t) * this.t - this.t;
    this.nx = Math.ceil((this.bounds.maxX - this.x0) / this.t) + 2;
    this.nz = Math.ceil((this.bounds.maxZ - this.z0) / this.t) + 2;
    this.grid = new Array(this.nx * this.nz);
    this.covers = def.cover ? def.cover.map((c) => ({ ...c })) : [];
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + (i + 0.5) * this.t, z = this.z0 + (j + 0.5) * this.t;
        if (!inArenaShape(def, x, z)) continue;
        const cross = !!def.cross && (Math.abs(x) <= def.cross.w / 2 || Math.abs(z) <= def.cross.w / 2);
        const tile: Tile = { i, j, x, z, state: TileState.Alive, y: 0, vy: 0, rot: 0, timer: 0, cross, dirty: true };
        this.tiles.push(tile);
        this.grid[j * this.nx + i] = tile;
      }
    }
  }

  tileAt(x: number, z: number): Tile | undefined {
    const i = Math.floor((x - this.x0) / this.t), j = Math.floor((z - this.z0) / this.t);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return undefined;
    return this.grid[j * this.nx + i];
  }

  /** Можно ли стоять в точке (плитка жива; у «стеновых» арен ещё и внутри формы). */
  walkable(x: number, z: number): boolean {
    const t = this.tileAt(x, z);
    if (!t || (t.state !== TileState.Alive && t.state !== TileState.Warning)) return false;
    if (this.edge === 'wall') return inArenaShape(this.def, x, z, 0.35);
    return true;
  }

  /** Над провалом в полу (яма внутри арены со стенами). */
  inPit(x: number, z: number): boolean { return inHole(this.def, x, z); }

  /** Перемещение с «скольжением» по краю: сначала полный шаг, затем по осям. */
  move(x: number, z: number, dx: number, dz: number, r: number, out: { x: number; z: number }): void {
    let nx = x + dx, nz = z + dz;
    if (!this.walkable(nx, nz)) {
      if (this.walkable(x + dx, z)) { nz = z; }
      else if (this.walkable(x, z + dz)) { nx = x; }
      else { nx = x; nz = z; }
    }
    // укрытия — круги, выталкивание
    for (const c of this.covers) {
      const ddx = nx - c.x, ddz = nz - c.z, rr = c.r + r;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-3;
        nx = c.x + (ddx / d) * rr; nz = c.z + (ddz / d) * rr;
      }
    }
    out.x = nx; out.z = nz;
  }

  /** Снаряд упёрся в укрытие? */
  blocked(x: number, z: number, r = 0): boolean {
    for (const c of this.covers) {
      const dx = x - c.x, dz = z - c.z, rr = c.r + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  /** Ближайшая проходимая точка (для спавна и возврата после падения). */
  nearestWalkable(x: number, z: number, out: { x: number; z: number }): void {
    if (this.walkable(x, z)) { out.x = x; out.z = z; return; }
    let best = Infinity;
    for (const t of this.tiles) {
      if (t.state !== TileState.Alive || !this.walkable(t.x, t.z)) continue;
      const d = (t.x - x) ** 2 + (t.z - z) ** 2;
      if (d < best) { best = d; out.x = t.x; out.z = t.z; }
    }
  }

  /** Обрушить плитку (Цепи кадил / вторая фаза босса). respawn — секунды до возрождения, 0 — навсегда. */
  breakTile(t: Tile, respawn: number, warn = 0): void {
    if (t.state === TileState.Gone || t.state === TileState.Falling) return;
    if (warn > 0) { t.state = TileState.Warning; t.timer = warn; t.vy = respawn; t.dirty = true; return; }
    t.state = TileState.Falling; t.vy = 0; t.rot = 0; t.timer = respawn > 0 ? respawn : -1; t.dirty = true;
    this.tilesDirty = true;
  }

  step(dt: number): void {
    for (const t of this.tiles) {
      switch (t.state) {
        case TileState.Warning:
          t.timer -= dt;
          t.y = Math.sin(t.timer * 60) * 0.03;
          t.dirty = true;
          if (t.timer <= 0) { const resp = t.vy; t.state = TileState.Alive; this.breakTile(t, resp); }
          break;
        case TileState.Falling:
          t.vy -= 22 * dt; t.y += t.vy * dt; t.rot += dt * 1.5; t.dirty = true;
          if (t.timer > 0) t.timer -= dt;
          if (t.y < -40) {
            if (t.timer < 0) { t.state = TileState.Gone; }
            else { t.state = TileState.Rising; t.y = -12; }
          }
          break;
        case TileState.Rising:
          if (t.timer > 0) { t.timer -= dt; break; }
          t.y += (0 - t.y) * Math.min(1, dt * 6); t.rot *= 0.9; t.dirty = true;
          if (t.y > -0.02) { t.y = 0; t.rot = 0; t.state = TileState.Alive; }
          break;
        default: break;
      }
      if (t.dirty) this.tilesDirty = true;
    }
  }

  /** Вторая фаза Иерофанта: всё вне креста уходит вниз волной от краёв. */
  collapseOutsideCross(): void {
    for (const t of this.tiles) {
      if (t.cross) continue;
      const d = Math.hypot(t.x, t.z);
      this.breakTile(t, 0, 0.6 + Math.max(0, 14 - d) * 0.09);
    }
    this.edge = 'abyss';
  }

  restoreAll(): void {
    for (const t of this.tiles) { t.state = TileState.Alive; t.y = 0; t.rot = 0; t.dirty = true; }
    this.edge = this.def.edge;
    this.tilesDirty = true;
  }
}
