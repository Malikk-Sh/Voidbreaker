export type HeartSoulPhase = 'idle' | 'escaping' | 'hidden' | 'arriving' | 'absorbed';

export const HEART_SOUL = {
  escapeDur: 2.4,
  hideAt: 1.9,
  arrivalDur: 5.6,
  absorbAt: 2.3,
  awakeAt: 4.4,
  awakenedAt: 4.2,
  coreY: 3.8,
} as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => v * v * (3 - 2 * v);

/**
 * Душа движется только по абсолютному времени двух сцен Director.
 * Между ними она скрыта: прогулка к сердцу не запускает ни полёт, ни пробуждение.
 */
export class HeartSoul {
  phase: HeartSoulPhase = 'idle';
  readonly position = { x: 0, y: 0, z: 0 };
  awakened = 0;
  private sourceX = 0;
  private sourceZ = 0;
  private centerZ = 0;

  get visible(): boolean { return this.phase === 'escaping' || this.phase === 'arriving'; }

  escape(sourceX: number, sourceZ: number): boolean {
    if (this.phase !== 'idle') return false;
    this.sourceX = sourceX;
    this.sourceZ = sourceZ;
    this.phase = 'escaping';
    this.sampleEscape(0);
    return true;
  }

  sampleEscape(t: number): void {
    if (this.phase !== 'escaping') return;
    const u = smooth(clamp01(t / HEART_SOUL.hideAt));
    this.position.x = this.sourceX - 0.55 * u;
    this.position.y = 1.2 + 16.8 * u;
    this.position.z = this.sourceZ - 0.6 * u;
    if (t >= HEART_SOUL.hideAt) this.hide();
  }

  /** Конечная поза одинакова при полном просмотре и пропуске сцены. */
  hide(): void {
    if (this.phase !== 'escaping' && this.phase !== 'hidden') return;
    this.position.x = this.sourceX - 0.55;
    this.position.y = 18;
    this.position.z = this.sourceZ - 0.6;
    this.phase = 'hidden';
  }

  arrive(centerZ: number): boolean {
    if (this.phase !== 'hidden') return false;
    this.centerZ = centerZ;
    this.phase = 'arriving';
    this.sampleArrival(0);
    return true;
  }

  sampleArrival(t: number): void {
    if (this.phase !== 'arriving' && this.phase !== 'absorbed') return;
    if (this.phase === 'arriving') {
      const u = clamp01(t / HEART_SOUL.absorbAt);
      this.position.x = 0.65 * Math.sin(Math.PI * u) * (1 - u);
      this.position.y = 15 - (15 - HEART_SOUL.coreY) * (0.15 * u + 0.85 * u * u);
      this.position.z = this.centerZ + 9 * Math.pow(1 - u, 1.35);
      if (t >= HEART_SOUL.absorbAt) this.absorb();
    }
    this.awakened = smooth(clamp01((t - HEART_SOUL.absorbAt) / (HEART_SOUL.awakenedAt - HEART_SOUL.absorbAt)));
  }

  /** Маркер Director: применяется и при пропуске, без раннего запуска атак босса. */
  absorb(): void {
    if (this.phase !== 'arriving' && this.phase !== 'absorbed') return;
    this.position.x = 0;
    this.position.y = HEART_SOUL.coreY;
    this.position.z = this.centerZ;
    this.phase = 'absorbed';
  }
}
