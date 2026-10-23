import { describe, expect, it } from 'vitest';
import { buildHeroGeometry } from '../src/gen/chars/hero';
import { GeomBuilder, SURF } from '../src/gen/geom/build';
import { box } from '../src/gen/geom/prims';
import { CONTACT, contactAlpha } from '../src/render/contactShadows';

describe('Пилот 2.0 и контактные тени (разбор)', () => {
  it('профиль поверхности пишется только там, где он не «латы»', () => {
    const a = new GeomBuilder();
    a.add(box(1, 1, 1));
    expect(a.build().getAttribute('aSurf')).toBeUndefined();
    const b = new GeomBuilder();
    b.add(box(1, 1, 1));
    b.add(box(1, 1, 1), { surface: SURF.metal });
    const s = b.build().getAttribute('aSurf');
    expect(s).toBeTruthy();
    const vals = new Set(Array.from(s.array as Float32Array));
    expect(vals.has(SURF.armor) && vals.has(SURF.metal)).toBe(true);
  });

  it('Пилот: золото — металл, визор — тусклая щель (не белая, эмиссия ≤ 1.2)', () => {
    const g = buildHeroGeometry();
    const surf = g.getAttribute('aSurf').array as Float32Array;
    const emi = g.getAttribute('aEmissive').array as Float32Array;
    const metal = surf.filter((v) => v === SURF.metal).length;
    expect(metal / surf.length).toBeGreaterThan(0.02);
    expect(metal / surf.length).toBeLessThan(0.3);
    // ярче 1.6 светится только клинок и Каэлис (у них свой сустав), визор и шрам — до 1.25
    const joint = g.getAttribute('aJoint').array as Float32Array;
    let headMax = 0;
    for (let i = 0; i < emi.length; i++) if (joint[i] === 5) headMax = Math.max(headMax, emi[i]);
    expect(headMax).toBeGreaterThan(0.5);
    expect(headMax).toBeLessThanOrEqual(1.2);
  });

  it('контактная тень: плотная у пола, гаснет с высотой, под полом — нет', () => {
    expect(contactAlpha(0)).toBeCloseTo(CONTACT.alpha);
    expect(contactAlpha(2)).toBeLessThan(contactAlpha(0.5));
    expect(contactAlpha(CONTACT.fadeH + 1)).toBe(0);
    expect(contactAlpha(-1)).toBe(0);
  });
});
