/**
 * Вторичная физика Верле (Tech §8.5): плащ (3 × 7), шарф (2 × 8), цепи, вуали.
 * Узлы с pinned=1 следуют за якорями (суставами); остальные — гравитация, демпфирование,
 * ветер, ограничения длины, столкновения со сферами тела и полом.
 */
export interface Sphere { x: number; y: number; z: number; r: number }

export class VerletCloth {
  readonly n: number;
  readonly p: Float32Array;
  readonly q: Float32Array;
  readonly pinned: Uint8Array;
  private readonly cons: number[] = []; // пары индексов + длина
  readonly colliders: Sphere[] = [];
  gravity = -9.8;
  damping = 0.97;
  iterations = 3;
  wind = 0;
  private t = 0;

  /** Сетка w × h; соседние узлы — на расстоянии dx (по ширине) и dy (по длине). */
  constructor(readonly w: number, readonly h: number, dx: number, dy: number) {
    this.n = w * h;
    this.p = new Float32Array(this.n * 3);
    this.q = new Float32Array(this.n * 3);
    this.pinned = new Uint8Array(this.n);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        this.p[k * 3] = this.q[k * 3] = i * dx;
        this.p[k * 3 + 1] = this.q[k * 3 + 1] = -j * dy;
        if (i + 1 < w) this.cons.push(k, k + 1, dx);
        if (j + 1 < h) this.cons.push(k, k + w, dy);
        if (i + 1 < w && j + 1 < h) {
          const d = Math.hypot(dx, dy);
          this.cons.push(k, k + w + 1, d);
          this.cons.push(k + 1, k + w, d);
        }
      }
    }
    for (let i = 0; i < w; i++) this.pinned[i] = 1;
  }

  setPinned(k: number, x: number, y: number, z: number): void {
    this.p[k * 3] = x; this.p[k * 3 + 1] = y; this.p[k * 3 + 2] = z;
  }

  /** Мгновенно перенести всю ткань (телепорт, спаун) без «рывка». */
  teleport(dx: number, dy: number, dz: number): void {
    for (let k = 0; k < this.n; k++) {
      this.p[k * 3] += dx; this.p[k * 3 + 1] += dy; this.p[k * 3 + 2] += dz;
      this.q[k * 3] += dx; this.q[k * 3 + 1] += dy; this.q[k * 3 + 2] += dz;
    }
  }

  step(dt: number): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    const g = this.gravity * dt * dt;
    const P = this.p, Q = this.q;
    for (let k = 0; k < this.n; k++) {
      if (this.pinned[k]) { Q[k * 3] = P[k * 3]; Q[k * 3 + 1] = P[k * 3 + 1]; Q[k * 3 + 2] = P[k * 3 + 2]; continue; }
      const o = k * 3;
      const vx = (P[o] - Q[o]) * this.damping, vy = (P[o + 1] - Q[o + 1]) * this.damping, vz = (P[o + 2] - Q[o + 2]) * this.damping;
      Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
      const wn = this.wind * (Math.sin(this.t * 2.1 + k * 0.7) * 0.6 + Math.sin(this.t * 3.7 + k) * 0.4) * dt * dt;
      P[o] += vx + wn; P[o + 1] += vy + g; P[o + 2] += vz + wn * 0.6;
    }
    const C = this.cons;
    for (let it = 0; it < this.iterations; it++) {
      for (let c = 0; c < C.length; c += 3) {
        const a = C[c] * 3, b = C[c + 1] * 3, rest = C[c + 2];
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / d;
        const pa = this.pinned[C[c]], pb = this.pinned[C[c + 1]];
        if (pa && pb) continue;
        const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
        P[a] += dx * diff * wa; P[a + 1] += dy * diff * wa; P[a + 2] += dz * diff * wa;
        P[b] -= dx * diff * wb; P[b + 1] -= dy * diff * wb; P[b + 2] -= dz * diff * wb;
      }
      for (let k = 0; k < this.n; k++) {
        if (this.pinned[k]) continue;
        const o = k * 3;
        for (const s of this.colliders) {
          const dx = P[o] - s.x, dy = P[o + 1] - s.y, dz = P[o + 2] - s.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < s.r * s.r) {
            const d = Math.sqrt(d2) || 1e-6, k2 = s.r / d;
            P[o] = s.x + dx * k2; P[o + 1] = s.y + dy * k2; P[o + 2] = s.z + dz * k2;
          }
        }
        if (P[o + 1] < 0.02) P[o + 1] = 0.02;
      }
    }
  }
}
