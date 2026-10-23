import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SLASH, SlashFx, slashFor } from '../src/vfx/slashFx';
import { HIT_FX, IMPACT, STUN_FX } from '../src/vfx/battleVfx';
import { HIT_FLASH, hitFlash } from '../src/world/world';
import { SHOCK_RING } from '../src/game/feel';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import type { GameEvents } from '../src/world/events';
import { Abilities } from '../src/world/abilities';
import { InputBuffer, type Input } from '../src/input/input';

const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
function arena(seed: string): World {
  const w = new World(new Arena(ARENAS.naves), seed);
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 0, 0);
  return w;
}
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

  it('след ложится туда, где Пилот в кадре удара: после выпада, по всей зоне, которую прошёл хитбокс', () => {
    const w = arena('slash');
    const h = w.hero;
    const fx = new SlashFx();
    const got: GameEvents['slash'][] = [];
    let t = 0;
    w.bus.on('slash', (e) => { got.push(e); fx.spawn(slashFor(e.move, e.hit, e.second), h, t, e.active); });
    (h as unknown as { beginMove(m: unknown, lunge: number): void }).beginMove(VOID_BLADE.lunge, 3);
    const input = idle();
    // хитбокс укола по кадрам: начало и конец линии вдоль +z
    let first: { z0: number; z1: number } | null = null, last: { z0: number; z1: number } | null = null;
    for (let i = 0; i < 40; i++) {
      w.step(1 / 60, 1 / 60, input);
      t += 1 / 60;
      fx.update(t);
      if ((h as unknown as { hitActive: boolean }).hitActive) {
        const sh = h.moveShape(VOID_BLADE.lunge) as { z: number; len: number };
        last = { z0: sh.z, z1: sh.z + sh.len };
        first ??= last;
      } else if (last) break;
    }
    expect(got.length).toBe(1);
    expect(got[0].active).toBeGreaterThan(0);
    // выпад унёс Пилота вперёд — хитбокс прошёл больше метра
    expect(last!.z0 - first!.z0).toBeGreaterThan(1);
    const live = fx.group.children.find((m) => m.visible) as THREE.Mesh;
    expect(live).toBeTruthy();
    // штрих: от начала хитбокса в первый кадр удара до его острия в последний
    expect(live.position.z).toBeCloseTo(first!.z0, 1);
    expect(live.position.z + live.scale.z).toBeCloseTo(last!.z1, 1);
    // после удара след стоит в пространстве
    const z = live.position.z, len = live.scale.z;
    h.z += 2;
    fx.update(t + 0.02);
    expect(live.position.z).toBe(z);
    expect(live.scale.z).toBe(len);
  });

  it('заряженный удар даёт один след, а не два', () => {
    const w = arena('slash2');
    const h = w.hero;
    let n = 0;
    w.bus.on('slash', () => n++);
    const hp = h as unknown as { chargeLevel: number; releaseCharge(): void };
    hp.chargeLevel = 2;
    hp.releaseCharge();
    const input = idle();
    for (let i = 0; i < 40; i++) w.step(1 / 60, 1 / 60, input);
    expect(n).toBe(1);
  });

  it('ревью: иерархия эффектов — след приёма главный, вспышки и кольца мельче и тусклее', () => {
    const minReach = Math.min(...['slash1', 'spin', 'flurry', 'cross', 'rift', 'lunge'].map((m) => slashFor(m, undefined)[0].reach));
    // вспышка попадания на пике меньше самого короткого следа
    expect((HIT_FX.flare + HIT_FX.flareHeavy) * HIT_FX.grow).toBeLessThan(minReach);
    expect(STUN_FX.flare * 2.4 * 1.4).toBeLessThan(3);
    // вспышка тела врага — по весу удара, у крупных слабее; не белая заливка
    expect(hitFlash('light', 1.8)).toBeLessThan(hitFlash('heavy', 1.8));
    expect(hitFlash('heavy', 3)).toBeLessThan(hitFlash('heavy', 1.8));
    expect(HIT_FLASH.break).toBeLessThan(1);
    // кольца на полу тусклее следа
    expect(IMPACT.outer * IMPACT.ring).toBeLessThan(SLASH.bright);
    expect(SHOCK_RING).toBeLessThanOrEqual(0.5);
    expect(STUN_FX.ring).toBeLessThan(1);
  });
});
