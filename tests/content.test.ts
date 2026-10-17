import { describe, expect, it } from 'vitest';
import { patternDur, pickPattern, validatePattern, type Pattern } from '../src/world/boss/timeline';
import { BellRinger, GateGuardian } from '../src/world/boss/guardians';
import { Hierophant } from '../src/world/boss/hierophant';
import type { ScriptedEnemy } from '../src/world/boss/scripted';
import type { World } from '../src/world/world';
import { ZONE1 } from '../src/data/stages';
import { ENEMIES } from '../src/data/enemies';
import { ABILITIES } from '../src/data/abilities';
import { ARENAS } from '../src/data/arenas';
import { Arena, TileState } from '../src/world/arena';
import { buildAcolyte, buildBrute, buildCrawler, buildEye, buildMantis } from '../src/gen/chars/enemies';
import { buildHierophant } from '../src/gen/chars/hierophant';
import { buildHeroGeometry } from '../src/gen/chars/hero';
import { Rng } from '../src/core/rng';

/** GDD §11: телеграфы в зоне 1 — минимум 0.8 с. */
const MIN_TELE_ZONE1 = 0.8;

/** Стаб мира: паттернам с build() нужны только позиции героя и арена. */
function attach(e: ScriptedEnemy, hx = 4, hz = 3): ScriptedEnemy {
  e.w_ = { hero: { x: hx, z: hz }, arena: new Arena(ARENAS.hierophant) } as unknown as World;
  return e;
}

function resolved(e: ScriptedEnemy): Pattern[] {
  return e.patterns.map((p) => (p.build ? { ...p, steps: p.build().sort((a, b) => a.t - b.t) } : p));
}

describe('паттерны Стражей и Иерофанта (Tech §17)', () => {
  const bosses: [string, () => ScriptedEnemy][] = [
    ['Страж Врат', () => new GateGuardian({ zone: 0, stage: 2 })],
    ['Звонарь', () => new BellRinger({ zone: 0, stage: 4 })],
    ['Иерофант', () => new Hierophant({ zone: 0, stage: 6 })],
  ];

  for (const [name, make] of bosses) {
    it(`${name}: каждый хитбокс телеграфирован ≥ ${MIN_TELE_ZONE1} с`, () => {
      const e = attach(make());
      const list = resolved(e);
      expect(list.length).toBeGreaterThan(0);
      for (const p of list) expect(validatePattern(p, MIN_TELE_ZONE1)).toBeNull();
    });

    it(`${name}: у паттернов есть фазы, веса и окно наказания`, () => {
      const e = attach(make());
      for (const p of resolved(e)) {
        expect(p.phases.length).toBeGreaterThan(0);
        expect(p.weight).toBeGreaterThan(0);
        expect(patternDur(p)).toBeGreaterThan(0.5);
        const hostile = p.steps.some((s) => s.do === 'hitbox' || s.do === 'ringwave' || s.do === 'projectiles');
        if (hostile) expect(p.steps.some((s) => s.do === 'vulnerable'), `${p.id} без окна наказания`).toBe(true);
      }
    });
  }

  it('Иерофант: кольцевые волны всегда с разрывами', () => {
    const e = attach(new Hierophant({ zone: 0, stage: 6 }));
    for (const p of resolved(e)) for (const s of p.steps) if (s.do === 'ringwave') expect(s.gaps).toBeGreaterThan(0);
  });

  it('pickPattern: не повторяет подряд, уважает фазу и кулдауны', () => {
    const e = attach(new Hierophant({ zone: 0, stage: 6 }));
    const rng = new Rng(9);
    const cds = new Map<string, number>();
    let last: string | null = null;
    for (let i = 0; i < 200; i++) {
      const phase = i < 100 ? 1 : 2;
      const p: Pattern = pickPattern(e.patterns, phase, 5, last, cds, () => rng.next())!;
      expect(p).toBeTruthy();
      expect(p.id).not.toBe(last);
      expect(p.phases).toContain(phase);
      last = p.id;
    }
    cds.set('toll', 10);
    for (let i = 0; i < 50; i++) expect(pickPattern(e.patterns, 1, 5, 'drop', cds, () => rng.next())!.id).not.toBe('toll');
  });
});

describe('данные Зоны 01', () => {
  it('7 этапов: 6 обычных + босс, индексы и арены корректны', () => {
    expect(ZONE1).toHaveLength(7);
    expect(ZONE1.filter((d) => d.boss)).toHaveLength(1);
    ZONE1.forEach((d, i) => {
      expect(d.index).toBe(i);
      expect(ARENAS[d.arena], `арена ${d.arena}`).toBeTruthy();
    });
  });

  it('волны ссылаются на существующих врагов, способности — на существующие', () => {
    for (const d of ZONE1) {
      if (!d.boss) expect(d.waves.length).toBeGreaterThan(0);
      for (const w of d.waves) {
        for (const s of [...w.spawns, ...(w.triggers ?? []).map((t) => t.spawn)]) {
          expect(ENEMIES[s.enemy], `${d.id}: ${s.enemy}`).toBeTruthy();
          expect(s.count).toBeGreaterThan(0);
        }
      }
      for (const a of d.unlocks ?? []) expect(ABILITIES[a]).toBeTruthy();
    }
  });

  it('арена босса обрушается в крест-мост', () => {
    const def = ZONE1.find((d) => d.boss)!;
    const a = new Arena(ARENAS[def.arena]);
    const before = a.tiles.length;
    a.collapseOutsideCross();
    // дать плиткам упасть
    for (let i = 0; i < 900; i++) a.step(1 / 60);
    const alive = a.tiles.filter((t) => t.state === TileState.Alive);
    expect(alive.length).toBeLessThan(before * 0.7);
    expect(alive.every((t) => t.cross)).toBe(true);
    expect(a.tiles.filter((t) => !t.cross).every((t) => t.state === TileState.Gone)).toBe(true);
    expect(a.walkable(0, 0)).toBe(true);
    a.restoreAll();
    expect(a.tiles.every((t) => t.state === TileState.Alive)).toBe(true);
  });
});

describe('процедурная геометрия детерминирована (Tech §3)', () => {
  const builds: [string, () => { geometry: { attributes: Record<string, { array: ArrayLike<number>; count: number }> } }][] = [
    ['ползун', () => buildCrawler(1)],
    ['богомол', () => buildMantis(2)],
    ['око', () => buildEye(3)],
    ['аколит', () => buildAcolyte(4)],
    ['голем', () => buildBrute(5)],
    ['Иерофант', () => buildHierophant(31)],
    ['герой', () => ({ geometry: buildHeroGeometry() as never })],
  ];
  for (const [name, make] of builds) {
    it(`${name}: одинаковый сид → одинаковые вершины, без NaN`, () => {
      const a = make().geometry.attributes.position, b = make().geometry.attributes.position;
      expect(a.count).toBeGreaterThan(30);
      expect(Array.from(a.array)).toEqual(Array.from(b.array));
      for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i])).toBe(true);
    });
  }
});
