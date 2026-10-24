/**
 * Три шкалы времени (Tech §11): real — UI и тряска, world — замедления и hitstop,
 * hero — в «Мгновении Пустоты» герой замедлен меньше мира.
 */
interface Slowmo { scale: number; hero: number; left: number }

const HITSTOP_SCALE = 0.08;          // не 0: частицы «дышат»
const HITSTOP_CAP = 0.14;            // одно замирание не длиннее 140 мс
const HITSTOP_CLOSE = 0.06;          // повтор вплотную (< 60 мс после конца прошлого) — вдвое короче

export class Time {
  real = 0;          // секунды реального времени с запуска
  world = 0;         // накопленное мировое время (для шейдеров, частиц)
  worldScale = 1;
  heroScale = 1;
  paused = false;
  hitstop = 0;
  private slowmos: Slowmo[] = [];
  private lastHitstopEnd = -1;

  update(realDt: number): void {
    this.real += realDt;
    if (this.paused) { this.worldScale = 0; this.heroScale = 0; return; }
    if (this.hitstop > 0) this.hitstop = Math.max(0, this.hitstop - realDt);
    let scale = 1, hero = 1;
    for (let i = this.slowmos.length - 1; i >= 0; i--) {
      const s = this.slowmos[i];
      s.left -= realDt;
      if (s.left <= 0) { this.slowmos.splice(i, 1); continue; }
      if (s.scale < scale) { scale = s.scale; hero = s.hero; }
    }
    if (this.hitstop > 0) { this.worldScale = HITSTOP_SCALE; this.heroScale = HITSTOP_SCALE; }
    else { this.worldScale = scale; this.heroScale = hero; }
    this.world += realDt * this.worldScale;
  }

  /**
   * Замирание удара (план §5.1): без скользящего окна — каждый взмах замирает одинаково.
   * Повтор вплотную к прошлому замиранию вдвое короче. Возвращает фактическую длительность.
   */
  addHitstop(sec: number): number {
    const since = this.real - this.lastHitstopEnd;
    const v = Math.max(0, Math.min(HITSTOP_CAP, since < HITSTOP_CLOSE ? sec * 0.5 : sec));
    if (v <= 0) return 0;
    this.hitstop = Math.max(this.hitstop, v);
    this.lastHitstopEnd = this.real + this.hitstop;
    return v;
  }

  /** Замедление мира. hero — масштаб для героя (по умолчанию как у мира). */
  slow(scale: number, sec: number, hero = scale): void {
    this.slowmos.push({ scale, hero, left: sec });
  }

  /** Длинные замирания (казнь, смерть босса) — без лимита hitstop. */
  cinematic(sec: number, scale: number): void { this.slow(scale, sec, scale); }

  /** Снять все замедления (пропуск Раскола). */
  endSlow(): void { this.slowmos.length = 0; }

  get slowmoActive(): boolean { return this.slowmos.length > 0; }

  reset(): void {
    this.slowmos.length = 0; this.lastHitstopEnd = -1; this.hitstop = 0;
    this.worldScale = 1; this.heroScale = 1; this.paused = false;
  }
}
