import { describe, expect, it } from 'vitest';
import { segmentBlocked, XRAY } from '../src/world/occlusion';
import { HERO_DIM } from '../src/vfx/particles';
import { ENEMY_WHITE } from '../src/render/enemyRenderer';

describe('читаемость боя (разбор)', () => {
  const col = { x: 0, z: 0, r: 0.7, h: XRAY.coverH };
  it('колонна между камерой и Пилотом закрывает его; сбоку, выше или вплотную — нет', () => {
    // камера сзади-сверху (+Z), Пилот за колонной (−Z)
    expect(segmentBlocked(0, 9, 12, 0, 1.25, -1.2, col)).toBe(true);
    expect(segmentBlocked(0, 9, 12, 2.5, 1.25, -1.2, col)).toBe(false);
    // камера очень высоко: луч проходит над капителью
    expect(segmentBlocked(0, 60, 2, 0, 1.25, -1.2, col)).toBe(false);
    // Пилот перед колонной (между ней и камерой)
    expect(segmentBlocked(0, 9, 12, 0, 1.25, 1.5, col)).toBe(false);
  });

  it('приглушение у Пилота: заметное, но не до нуля; белое у врагов — только на замахе', () => {
    expect(HERO_DIM.min).toBeGreaterThan(0.15);
    expect(HERO_DIM.min).toBeLessThan(0.6);
    expect(HERO_DIM.far).toBeGreaterThan(HERO_DIM.near);
    expect(ENEMY_WHITE).toBeLessThan(0.5);
    // на замахе (boost ≥ 1.2) — снова полностью белое: clamp(white + boost·0.6)
    expect(Math.min(1, ENEMY_WHITE + 1.2 * 0.6)).toBe(1);
  });
});

import { DRILL_MOVES, stageById, TRAINING, TRAINING_DRILLS, TRAINING_DUMMIES, TRAINING_SPAR, TRAINING_TIPS, ZONE1 } from '../src/data/stages';
import { VOID_BLADE } from '../src/data/weapons';

describe('тренировочный зал (разбор)', () => {
  it('отдельный этап вне Зоны: без волн, с манекенами и памяткой', () => {
    expect(stageById('training')).toBe(TRAINING);
    expect(ZONE1.includes(TRAINING)).toBe(false);
    expect(TRAINING.waves.length).toBe(0);
    expect(TRAINING_DUMMIES.kinds.length).toBeGreaterThanOrEqual(3);
    expect(TRAINING_DUMMIES.kinds).toContain('golem');
    expect(TRAINING_TIPS.length).toBeGreaterThanOrEqual(5);
  });

  it('ревью: спарринг и упражнения — Жнец для уклонений, каждое упражнение засчитывается настоящим приёмом', () => {
    expect(TRAINING_SPAR.kind).toBe('reaper');
    expect(TRAINING_SPAR.leash).toBeLessThan(Math.hypot(TRAINING_SPAR.dist, TRAINING_SPAR.side));
    const ids = new Set(TRAINING_DRILLS.map((d) => d.id));
    expect(ids.size).toBe(TRAINING_DRILLS.length);
    expect(ids.has('counter') && ids.has('charged') && ids.has('shatter')).toBe(true);
    // приёмы, по которым засчитываются упражнения, есть у клинка
    const moves = new Set<string>([...VOID_BLADE.combo.map((m) => m.id), ...Object.values(VOID_BLADE).filter((v): v is { id: string } => !!v && typeof v === 'object' && 'id' in v).map((v) => v.id)]);
    for (const [move, drill] of Object.entries(DRILL_MOVES)) {
      expect(moves.has(move), move).toBe(true);
      expect(ids.has(drill)).toBe(true);
    }
    // в памятке — все упражнения и правила зала
    for (const d of TRAINING_DRILLS) expect(TRAINING_TIPS).toContain(d.text);
    expect(TRAINING_TIPS[TRAINING_TIPS.length - 1]).toMatch(/Жнец/);
  });
});
