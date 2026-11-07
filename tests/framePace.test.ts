import { describe, expect, it } from 'vitest';
import { FRAME_PACE, FramePacer, targetFps } from '../src/core/framePace';
import { AUTO_Q, autoQualityStep, newAutoQ } from '../src/game/game';
import { QUALITY } from '../src/render/renderer';
import { DEFAULT_SETTINGS } from '../src/meta/settings';

/** Сколько кадров нарисовано за sec секунд экрана hz Гц при частоте fps (с дрожью меток jitter, мс). */
function rendered(hz: number, fps: number, sec = 4, jitter = 0): number {
  const p = new FramePacer();
  let n = 0;
  for (let i = 0; i < hz * sec; i++) {
    const t = 1000 + i * (1000 / hz) + (jitter ? Math.sin(i * 12.9898) * jitter : 0);
    if (p.tick(t, fps)) n++;
  }
  return n / sec;
}

describe('темп кадров (ревью: «телефон нагревается»)', () => {
  it('бой — не больше 60 кадров на любом экране, на 60 Гц не теряет ни кадра', () => {
    expect(rendered(60, 60)).toBe(60);
    expect(rendered(120, 60)).toBe(60);
    expect(rendered(144, 60)).toBeCloseTo(60, -0.5);
    expect(Math.abs(rendered(90, 60) - 60)).toBeLessThanOrEqual(1);
    // метки времени кадров дрожат на миллисекунду — кадры не пропадают
    expect(rendered(60, 60, 4, 1)).toBeGreaterThanOrEqual(59);
  });

  it('меню — 30, пауза — 4, настройка «30» опускает бой до 30', () => {
    expect(targetFps('menu', false, 60)).toBe(FRAME_PACE.menu);
    expect(targetFps('play', true, 60)).toBe(FRAME_PACE.paused);
    expect(targetFps('play', false, 60)).toBe(60);
    expect(targetFps('play', false, 30)).toBe(30);
    expect(targetFps('menu', false, 30)).toBe(30);
    expect(rendered(120, 30)).toBe(30);
    expect(rendered(60, FRAME_PACE.paused)).toBe(FRAME_PACE.paused);
  });

  it('после скрытой вкладки не догоняет пачкой; kick — кадр сразу', () => {
    const p = new FramePacer();
    expect(p.tick(1000, 60)).toBe(true);
    expect(p.tick(1008, 60)).toBe(false);
    // вкладка была скрыта 5 с: один кадр, затем снова через шаг
    expect(p.tick(6000, 60)).toBe(true);
    expect(p.tick(6008, 60)).toBe(false);
    expect(p.tick(6016.7, 60)).toBe(true);
    // пауза: кадр, следующий — через 250 мс, но после смены размера — сразу
    expect(p.tick(6100, 4)).toBe(true);
    expect(p.tick(6200, 4)).toBe(false);
    p.kick();
    expect(p.tick(6201, 4)).toBe(true);
    expect(p.tick(6300, 4)).toBe(false);
    // снятие с паузы: бой не ждёт следующего редкого кадра
    expect(p.tick(6310, 60)).toBe(true);
    expect(p.tick(6318, 60)).toBe(false);
    expect(p.tick(6326.7, 60)).toBe(true);
  });

  it('автокачество не принимает 30 кадров за перегрузку; HUD на среднем — DPR 1.5; по умолчанию 60', () => {
    const a = newAutoQ();
    let downs = 0;
    for (let i = 0; i < 30 * 30; i++) if (autoQualityStep(a, 1 / 30, AUTO_Q.slowDt * 2) === 'down') downs++;
    expect(downs).toBe(0);
    // те же 30 кадров при пороге 60 — перегрузка (старое поведение для 60)
    const b = newAutoQ();
    let d2 = 0;
    for (let i = 0; i < 30 * 30; i++) if (autoQualityStep(b, 1 / 30) === 'down') d2++;
    expect(d2).toBeGreaterThan(0);
    expect(QUALITY.medium.hudDpr).toBe(1.5);
    expect(QUALITY.high.hudDpr).toBe(2);
    expect(QUALITY.low.hudDpr).toBeLessThan(QUALITY.medium.hudDpr);
    expect(DEFAULT_SETTINGS.fpsCap).toBe(60);
  });
});
