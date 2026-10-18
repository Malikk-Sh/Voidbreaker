import { RANK_POINTS, RANK_TIMEOUT, RANKS, type RankId } from '../data/player';

/**
 * Ранг комбо (GDD §5.7): счётчик без получения урона; сброс через 3 с без ударов или при уроне.
 * Ранг этапа — средневзвешенный пиковый ранг по волнам.
 */
export class RankTracker {
  points = 0;
  hits = 0;
  timer = 0;
  rankIdx = 0;
  peakIdx = 0;
  bestHits = 0;
  private wavePeaks: number[] = [];
  private lastKinds: { id: string; t: number }[] = [];
  private time = 0;
  onRank: ((rank: RankId, up: boolean) => void) | null = null;

  get rank(): RankId { return RANKS[this.rankIdx].id; }
  get mul(): number { return RANKS[this.rankIdx].mul; }
  /** Прогресс до следующего ранга 0..1. */
  get progress(): number {
    const cur = RANKS[this.rankIdx], next = RANKS[this.rankIdx + 1];
    if (!next) return 1;
    return (this.points - cur.min) / (next.min - cur.min);
  }

  step(dt: number): void {
    this.time += dt;
    if (this.points <= 0) return;
    this.timer += dt;
    if (this.timer >= RANK_TIMEOUT) this.reset();
  }

  private add(p: number): void {
    this.points += p;
    this.timer = 0;
    let idx = 0;
    for (let i = 0; i < RANKS.length; i++) if (this.points >= RANKS[i].min) idx = i;
    if (idx !== this.rankIdx) {
      const up = idx > this.rankIdx;
      this.rankIdx = idx;
      this.onRank?.(RANKS[idx].id, up);
    }
    this.peakIdx = Math.max(this.peakIdx, this.rankIdx);
  }

  hit(finisher: boolean): void {
    this.hits++;
    this.bestHits = Math.max(this.bestHits, this.hits);
    this.add(RANK_POINTS.hit + (finisher ? RANK_POINTS.finisher : 0));
  }
  perfectDodge(): void { this.add(RANK_POINTS.perfectDodge); }
  /** Особый момент (уклонение от босса и сразу оглушение): обычно — следующая ступень. */
  bonus(p: number): void { this.add(p); }
  shatter(): void { this.add(RANK_POINTS.shatter); }
  /** Разнообразие: разные способности/приёмы за 5 с. */
  used(kind: string): void {
    this.lastKinds = this.lastKinds.filter((k) => this.time - k.t < 5);
    if (!this.lastKinds.some((k) => k.id === kind) && this.lastKinds.length > 0) this.add(RANK_POINTS.variety);
    this.lastKinds.push({ id: kind, t: this.time });
  }

  hurt(): void { this.reset(); }

  reset(): void {
    if (this.rankIdx !== 0) this.onRank?.('D', false);
    this.points = 0; this.hits = 0; this.timer = 0; this.rankIdx = 0;
  }

  endWave(): void { this.wavePeaks.push(this.peakIdx); this.peakIdx = this.rankIdx; }

  /** Ранг этапа: средневзвешенный пик по волнам (поздние волны весят больше). */
  stageRank(): RankId {
    const peaks = this.wavePeaks.length ? this.wavePeaks : [this.peakIdx];
    let sum = 0, wsum = 0;
    peaks.forEach((p, i) => { const w = 1 + i * 0.5; sum += p * w; wsum += w; });
    return RANKS[Math.round(sum / wsum)].id;
  }

  stageRankMul(): number { return RANKS.find((r) => r.id === this.stageRank())!.mul; }
}
