/**
 * Темп кадров (ревью: «телефон нагревается»). Каждый кадр — работа процессора и видеочипа, и нагрев растёт с их
 * числом. Бой и сцены — не больше play кадров в секунду и на экранах 90–120 Гц: глаз там почти не видит разницы,
 * а работы вдвое больше. Меню, Святилище, карта и итоги боя — menu: за ними медленный фон. Пауза — paused: мир
 * стоит, картинка не меняется, а редкий кадр нужен, только чтобы перерисоваться после смены размера экрана.
 * Настройка «Частота кадров — 30» опускает до 30 и бой.
 * slack — допуск раннего кадра (мс): метки времени кадров чуть дрожат, а кадр на 60 Гц пропадать не должен.
 */
export const FRAME_PACE = { play: 60, menu: 30, paused: 4, slack: 2 };

/** Что на экране: бой и сцены — полный темп; меню, Святилище, карта, итоги боя — спокойный. */
export type PaceView = 'play' | 'menu';

/** Сколько кадров в секунду рисовать. cap — настройка «Частота кадров» (60 или 30). */
export function targetFps(view: PaceView, paused: boolean, cap: number): number {
  if (paused) return FRAME_PACE.paused;
  return Math.min(cap > 0 ? cap : FRAME_PACE.play, view === 'menu' ? FRAME_PACE.menu : FRAME_PACE.play);
}

/**
 * Пропуск кадров до заданной частоты. Кадры идут по расписанию с ровным шагом: на 120 Гц при 60 — каждый второй,
 * на 90 Гц — в среднем 60, на 60 Гц при 60 — все. Если кадр опоздал больше чем на шаг (вкладка была скрыта, долгий
 * кадр), расписание начинается заново — без пачки кадров «вдогонку».
 */
export class FramePacer {
  private nextAt = -Infinity;
  private fps = 0;

  /**
   * Рисовать ли кадр с меткой времени now (мс) при частоте fps. Смена частоты — кадр сразу: снятие с паузы (4 → 60)
   * не ждёт следующего редкого кадра.
   */
  tick(now: number, fps: number): boolean {
    if (fps !== this.fps) { this.fps = fps; this.nextAt = -Infinity; }
    const interval = 1000 / Math.max(1, fps);
    if (now < this.nextAt - FRAME_PACE.slack) return false;
    this.nextAt = now - this.nextAt < interval ? this.nextAt + interval : now + interval;
    return true;
  }

  /** Следующий кадр — сразу: после смены размера холст пуст, а в паузе кадры редкие. */
  kick(): void { this.nextAt = -Infinity; }
}
