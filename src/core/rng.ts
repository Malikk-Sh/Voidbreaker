/** Детерминированный ГПСЧ (Tech §3): сид этапа → одна и та же арена, сид врага → одна и та же модель. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashSeed = (s: string): number =>
  [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

export class Rng {
  readonly next: () => number;
  constructor(seed: number | string) {
    this.next = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed >>> 0);
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  sign(): number { return this.next() < 0.5 ? -1 : 1; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** Симметричный разброс: [-a, a]. */
  spread(a: number): number { return (this.next() * 2 - 1) * a; }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weight(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Глобальный недетерминированный поток для косметики (частицы, разброс звука). */
export const fxRng = new Rng((Date.now() ^ 0x9e3779b9) >>> 0);
