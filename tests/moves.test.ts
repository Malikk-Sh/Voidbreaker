import { describe, expect, it } from 'vitest';
import { slashFor } from '../src/vfx/slashFx';
import { VOID_BLADE } from '../src/data/weapons';
import { Clip } from '../src/anim/clip';
import { HERO_CLIPS, WHIP, WHIP_CLIPS } from '../src/anim/clips/hero';
import { HERO_RIG } from '../src/gen/chars/hero';
import { layoutOf } from '../src/anim/puppet';

describe('приёмы: своя форма следа и вес (разбор)', () => {
  it('у каждого приёма — своя форма, и она повторяет зону поражения', () => {
    const W = VOID_BLADE;
    const s1 = slashFor('slash1', W.combo[0].hitbox)[0], s2 = slashFor('slash2', W.combo[1].hitbox)[0];
    expect(s1.shape).toBe('arc');
    expect(s1.dir).toBe(-s2.dir!);
    expect(s1.reach).toBeCloseTo(2.2);
    expect(slashFor('spin', W.combo[2].hitbox)[0].shape).toBe('ring');
    expect(slashFor('flurry', W.flurry.hitbox)[0].shape).toBe('streak');
    expect(slashFor('lunge', W.lunge.hitbox)[0].reach).toBeCloseTo(3.6);
    expect(slashFor('cross', W.cross.hitbox)[0].shape).toBe('cross');
    // второй взмах креста — зеркальная диагональ
    expect(slashFor('cross', W.cross.hitbox, true)[0].tilt).toBe(-slashFor('cross', W.cross.hitbox)[0].tilt!);
    expect(slashFor('rising', W.rising.hitbox)[0].dir).toBe(1);
    const shapes = new Set(['slash1', 'spin', 'flurry', 'cross', 'rising', 'counter'].map((m) => slashFor(m, undefined)[0].shape));
    expect(shapes.size).toBeGreaterThanOrEqual(5);
  });

  it('хлыст: таз ведёт, клинок догоняет — не больше кадра', () => {
    expect(WHIP.pelvis).toBeLessThan(0);
    expect(WHIP.blade).toBeGreaterThan(WHIP.shR);
    expect(WHIP.blade).toBeLessThanOrEqual(1 / 60 + 1e-9);
    const layout = layoutOf(HERO_RIG);
    const def = HERO_CLIPS.find((c) => c.id === 'atk1')!;
    expect(WHIP_CLIPS.has('atk1')).toBe(true);
    const whip = new Clip(def, layout), flat = new Clip({ ...def, lag: undefined }, layout);
    const a = new Float32Array(layout.n * 4), b = new Float32Array(layout.n * 4), root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
    whip.sample(0.06, a, root); flat.sample(0.06, b, root);
    const bi = layout.idx('blade') * 4;
    // в середине взмаха поза клинка отличается (запаздывает), к концу — совпадает
    expect(Math.abs(a[bi] - b[bi]) + Math.abs(a[bi + 1] - b[bi + 1]) + Math.abs(a[bi + 2] - b[bi + 2])).toBeGreaterThan(1e-4);
    whip.sample(def.dur + 0.05, a, root); flat.sample(def.dur + 0.05, b, root);
    for (let k = 0; k < 4; k++) expect(a[bi + k]).toBeCloseTo(b[bi + k], 5);
  });
});
