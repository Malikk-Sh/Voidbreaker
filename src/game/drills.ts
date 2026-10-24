import { TRAINING_DRILLS, type DrillId, type DrillStep } from '../data/stages';

/** Состояние упражнения: не начато, приём выполнен без попадания, засчитано. */
export type DrillState = 'todo' | 'performed' | 'done';

/**
 * Через сколько секунд без действий серия считается прерванной (шаги — с начала); сколько ждать попадания
 * после последнего шага, прежде чем отметить «приём выполнен, но мимо».
 */
export const DRILL_T = { gap: 1.6, hitWait: 0.7 };

type DrillDef = (typeof TRAINING_DRILLS)[number];

/**
 * Упражнения тренировочного зала (этап 4.5, A3). Засчитываются по своему условию: попадание нужным приёмом
 * (заряд — полным), Раскол — его началом; ввод серии без попадания даёт только «выполнено» — отдельно от зачёта.
 * Шаги ведутся для активного упражнения (первое незасчитанное) — их показывает карточка HUD.
 */
export class DrillTracker {
  readonly state = new Map<DrillId, DrillState>(TRAINING_DRILLS.map((d) => [d.id, 'todo']));
  /** Шаг активного упражнения (сколько шагов пройдено). */
  step = 0;
  onDone: ((d: DrillDef, all: boolean) => void) | null = null;
  onPerformed: ((d: DrillDef) => void) | null = null;
  private lastT = -99;
  /** Приёмы-зачёты, начатые и ещё ждущие попадания (по любому незасчитанному упражнению). */
  private pending: { d: DrillDef; t: number }[] = [];

  constructor(readonly drills: readonly DrillDef[] = TRAINING_DRILLS) {}

  get active(): DrillDef | null { return this.drills.find((d) => this.state.get(d.id) !== 'done') ?? null; }
  get doneCount(): number { let n = 0; for (const v of this.state.values()) if (v === 'done') n++; return n; }

  /** Начался приём (moveStart). */
  move(id: string, t: number): void {
    this.advance({ move: id }, t);
    for (const d of this.drills) if (d.hit === id && this.state.get(d.id) !== 'done' && !this.pending.some((p) => p.d === d)) this.pending.push({ d, t });
  }
  /** Событие боя для шагов: идеальное уклонение, уровень заряда, оглушение. */
  event(ev: NonNullable<DrillStep['ev']>, t: number): void { this.advance({ ev }, t); }

  /** Попадание приёмом moveId (n целей); full — полный заряд. */
  strike(moveId: string | undefined, n: number, full: boolean, t: number): void {
    if (!moveId || n <= 0) return;
    for (const d of this.drills) {
      if (d.hit !== moveId || (d.hit === 'charged' && !full)) continue;
      this.confirm(d);
    }
    void t;
  }

  /** Раскол начался. */
  shatter(): void {
    const d = this.drills.find((x) => x.hit === 'shatter');
    if (d) this.confirm(d);
  }

  /** Кадр: серия прервана паузой; последний шаг без попадания — «выполнено». */
  tick(t: number): void {
    if (this.step > 0 && t - this.lastT > DRILL_T.gap) this.step = 0;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (t - p.t <= DRILL_T.hitWait) continue;
      this.pending.splice(i, 1);
      if (this.state.get(p.d.id) === 'todo') { this.state.set(p.d.id, 'performed'); this.onPerformed?.(p.d); }
    }
  }

  private confirm(d: DrillDef): void {
    if (this.state.get(d.id) === 'done') return;
    const wasActive = this.active === d;
    this.state.set(d.id, 'done');
    this.pending = this.pending.filter((p) => p.d !== d);
    if (wasActive) this.step = 0;
    this.onDone?.(d, this.doneCount === this.drills.length);
  }

  /** Шаг активного упражнения: ожидаемое событие — вперёд (необязательный можно пропустить); иначе — сначала. */
  private advance(e: { move?: string; ev?: DrillStep['ev'] }, t: number): void {
    const d = this.active;
    this.lastT = t;
    if (!d) return;
    const match = (s: DrillStep | undefined) => !!s && ((e.move !== undefined && s.move === e.move) || (e.ev !== undefined && s.ev === e.ev));
    let i = this.step;
    if (match(d.steps[i])) i++;
    else if (d.steps[i]?.optional && match(d.steps[i + 1])) i += 2;
    else if (match(d.steps[0])) i = 1;
    else if (e.move) i = 0;
    else return;
    this.step = Math.min(i, d.steps.length - 1);
  }
}
