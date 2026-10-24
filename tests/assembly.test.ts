import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { Abilities } from '../src/world/abilities';
import { ARENAS } from '../src/data/arenas';
import { stageById } from '../src/data/stages';
import { BREATHER } from '../src/world/stage';
import { ArenaEvents } from '../src/game/arenaEvents';
import { ASSEMBLY, Assembly } from '../src/game/assembly';
import { buildChoristerParts, CHORISTER } from '../src/gen/zone/setPieces';
import type { ArenaView } from '../src/gen/zone/arenaView';
import type { BattleVfx } from '../src/vfx/battleVfx';

/** Этап 4.5, C3: «Хоры» 1-9 — хорист собирается из бездны по ходу боя, перед последней волной встаёт в силуэт. */
const DT = 1 / 60;
const view = { coverMeshes: [] } as unknown as ArenaView;

function choir() {
  const flashes: number[][] = [];
  const vfx = { debris: { burst: () => {} }, smokePuff: () => {}, lights: { flash: (...a: number[]) => flashes.push(a) } } as unknown as BattleVfx;
  const w = new World(new Arena(ARENAS.choir), 'choir');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 0, Math.PI);
  const ev = new ArenaEvents(w, view, new THREE.Group(), vfx, stageById('1-9')!);
  const sfx: { id: string; t: number }[] = [];
  let t = 0;
  w.bus.on('sfx', (s) => sfx.push({ id: s.id, t }));
  const run = (sec: number) => { for (let i = 0; i < sec / DT; i++) { ev.update(DT, DT); t += DT; } };
  const clear = (index: number) => w.bus.emit('waveClear', { index, total: 4 });
  return { w, a: ev.assembly!, run, clear, sfx, flashes, now: () => t };
}

const holes = ARENAS.choir.holes!.map((h) => ({ x0: h.x - h.w / 2, x1: h.x + h.w / 2, z0: h.z - h.h / 2, z1: h.z + h.h / 2 }));
const inHole = (x: number, z: number) => holes.find((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1);

describe('этап 4.5 C3: событие «Хоров» — хорист из бездны', () => {
  it('приходит в движение по ходу боя: каждая закрытая волна — ступень сборки, к следующей волне доходит', () => {
    const { a, run, clear } = choir();
    expect(a).not.toBeNull();
    run(1);
    expect(a.progress).toBe(0);
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      clear(i); run(BREATHER);
      seen.push(a.progress);
      expect(a.stage).toBe(i + 1);
    }
    // ступени 0.45 → 0.75 → 1: каждая доходит за передышку (части с разнобоем, но без хвостов)
    expect(seen[0]).toBeCloseTo(ASSEMBLY.steps[1], 2);
    expect(seen[1]).toBeCloseTo(ASSEMBLY.steps[2], 2);
    expect(seen[2]).toBe(1);
  });

  it('перед последней волной — силуэт: хор поднимается, на сборке один «брам» и золотой свет из обоих провалов', () => {
    const { a, run, clear, sfx, flashes, now } = choir();
    clear(0); run(BREATHER); clear(1); run(BREATHER);
    expect(sfx.filter((s) => s.id === 'braam')).toHaveLength(0);
    const t0 = now();
    clear(2);
    expect(sfx.find((s) => s.id === 'choir_rise')?.t).toBe(t0);
    let peak = 0;
    for (let i = 0; i < BREATHER / DT; i++) { run(DT); peak = Math.max(peak, a.light); }
    const braam = sfx.filter((s) => s.id === 'braam');
    expect(braam).toHaveLength(1);
    // кульминация до начала последней волны (передышка 2.5 с) — бой идёт уже на фоне собранного силуэта
    expect(braam[0].t - t0).toBeLessThan(BREATHER);
    expect(flashes).toHaveLength(holes.length);
    expect(peak).toBeGreaterThan(ASSEMBLY.glow[3] * 1.8);
    // свет спадает до уровня ступени — силуэт не слепит бой
    run(4);
    expect(a.light).toBeLessThan(ASSEMBLY.glow[3] * 1.2);
    run(10);
    expect(sfx.filter((s) => s.id === 'braam')).toHaveLength(1);
  });

  it('конец: после последней волны гаснет и уходит в бездну', () => {
    const { a, run, clear } = choir();
    for (let i = 0; i < 3; i++) { clear(i); run(BREATHER); }
    const y0 = a.group.children.map((m) => m.position.y);
    clear(3);
    expect(a.falling).toBe(true);
    run(ASSEMBLY.fallDur + 0.5);
    expect(a.light).toBeLessThan(0.02);
    a.group.children.forEach((m, i) => expect(m.position.y).toBeLessThan(y0[i] - ASSEMBLY.fall * 0.65));
  });

  it('проверка с волны (?wave=): ступень сразу, без кульминации на старте', () => {
    const { w, a, run, sfx } = choir();
    w.bus.emit('waveStart', { index: 3, total: 4 } as never);
    run(0.2);
    expect(a.progress).toBe(1);
    expect(sfx.some((s) => s.id === 'braam')).toBe(false);
  });

  it('виден с боевой камеры и не мешает бою: собран — в провалах под полом; разобран — не под ближним краем провала', () => {
    const parts = buildChoristerParts();
    for (const p of parts) {
      const [x, y, z] = p.slot;
      expect(inHole(x, z)).toBeDefined();
      // ниже пола (не заслоняет бой), но у самой кромки — видно сверху
      expect(y).toBeLessThan(0);
      expect(y).toBeGreaterThan(-1);
    }
    // лицо — в северном провале, книга — в южном (с камеры с юга: лицо над мостиком, книга под ним)
    expect(inHole(0, CHORISTER.faceZ)!.z1).toBeLessThan(0);
    expect(inHole(0, CHORISTER.bookZ)!.z0).toBeGreaterThan(0);
    const mat = new THREE.ShaderMaterial({ uniforms: { uEmissiveStrength: { value: 0 } } });
    const a = new Assembly(parts, mat, holes, 89);
    for (const m of a.group.children) {
      const h = inHole(m.position.x, m.position.z)!;
      expect(h).toBeDefined();
      // ближний к камере край провала закрывает ~0.9 м на метр глубины
      expect(m.position.z).toBeLessThanOrEqual(h.z1 + m.position.y * ASSEMBLY.view);
    }
  });

  it('бюджет мобильного: до 16 частей, один материал, без теней, ≤ 1500 треугольников (сейчас 924)', () => {
    const parts = buildChoristerParts();
    expect(parts.length).toBeLessThanOrEqual(16);
    const tris = parts.reduce((s, p) => s + (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3, 0);
    expect(tris).toBeLessThanOrEqual(1500);
    const { a } = choir();
    const mats = new Set(a.group.children.map((m) => (m as THREE.Mesh).material));
    expect(mats.size).toBe(1);
    expect(a.group.children.every((m) => !m.castShadow)).toBe(true);
  });
});
