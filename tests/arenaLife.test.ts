import { describe, expect, it } from 'vitest';
import { FloorScars, SCARS_MAX, SCAR_LIFE } from '../src/vfx/scars';

describe('живые арены (план §8.5)', () => {
  it('следы боя: не больше 24, старейший вытесняется, гаснут за 60 с, снимаются над провалом', () => {
    const s = new FloorScars();
    for (let i = 0; i < SCARS_MAX + 6; i++) s.add(i, 0, 1);
    expect(s.count).toBe(SCARS_MAX);
    // первые шесть вытеснены новыми
    expect(s.spots.filter((p) => p.alive).map((p) => p.x).sort((a, b) => a - b)[0]).toBe(6);
    expect(SCAR_LIFE).toBe(60);
    s.remove(0);
    expect(s.spots[0].alive).toBe(false);
    s.dispose();
  });
});
