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

import * as THREE from 'three';
import { World } from '../src/world/world';
import { Arena, TileState } from '../src/world/arena';
import { Abilities } from '../src/world/abilities';
import { ARENAS, inPart } from '../src/data/arenas';
import { stageById } from '../src/data/stages';
import { ArenaEvents, BRIDGE_SPANS, COLUMN_FALL } from '../src/game/arenaEvents';
import { createEnemy } from '../src/world/enemies/factory';
import type { ArenaView } from '../src/gen/zone/arenaView';
import type { BattleVfx } from '../src/vfx/battleVfx';

const vfx = { debris: { burst: () => {} } } as unknown as BattleVfx;
const view = (n: number) => ({ coverMeshes: Array.from({ length: n }, () => new THREE.Mesh()) }) as unknown as ArenaView;

describe('события арен (план §8.5)', () => {
  it('1-5: после волны рушится пролёт без Пилота; середина и площадки целы; после последней — нет', () => {
    const w = new World(new Arena(ARENAS.bridge), 'ev');
    w.abilities = new Abilities(w);
    w.hero.spawn(0, 0, Math.PI);
    new ArenaEvents(w, view(0), new THREE.Group(), vfx, stageById('1-5')!);
    const span = ARENAS.bridge.parts[BRIDGE_SPANS[0]], center = ARENAS.bridge.parts[0];
    w.bus.emit('waveClear', { index: 0, total: 4 });
    const spanTiles = w.arena.tiles.filter((t) => inPart(span, t.x, t.z) && !inPart(center, t.x, t.z) && !inPart(ARENAS.bridge.parts[3], t.x, t.z));
    expect(spanTiles.length).toBeGreaterThan(0);
    expect(spanTiles.every((t) => t.state === TileState.Warning)).toBe(true);
    expect(w.arena.tiles.filter((t) => inPart(center, t.x, t.z)).every((t) => t.state === TileState.Alive)).toBe(true);
    // последняя волна — мост не трогаем
    const before = w.arena.tiles.filter((t) => t.state === TileState.Alive).length;
    w.bus.emit('waveClear', { index: 3, total: 4 });
    expect(w.arena.tiles.filter((t) => t.state === TileState.Alive).length).toBe(before);
  });

  it('1-2: тяжёлый удар рядом валит колонну — она давит врага на линии и больше не укрытие', () => {
    const w = new World(new Arena(ARENAS.naves), 'ev');
    w.abilities = new Abilities(w);
    w.hero.spawn(0, 0, Math.PI);
    const covers0 = w.arena.covers.length;
    const ev = new ArenaEvents(w, view(covers0), new THREE.Group(), vfx, stageById('1-2')!);
    const c = { ...w.arena.covers[0] };
    // удар с одной стороны — колонна падает на другую, там стоит Шелуха
    const e = createEnemy('husk', { zone: 0, stage: 1 });
    const dx = c.x > 0 ? 1 : -1;
    e.x = c.x + dx * 2; e.z = c.z;
    w.addEnemy(e); e.setState('idle');
    w.bus.emit('impact', { x: c.x - dx * 1.5, z: c.z, r: 3, kind: 'slam' });
    expect(w.arena.covers.length).toBe(covers0 - 1);
    for (let t = 0; t < COLUMN_FALL.dur + 0.1; t += 1 / 60) ev.update(1 / 60, 1 / 60);
    expect(e.dead).toBe(true);
  });

  it('интро: низкий план на декорацию есть только у 1-1, 1-3, 1-6; колокол 1-6 виден лишь из-под своего края', () => {
    for (const id of ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6']) {
      const st = stageById(id)!;
      const w = new World(new Arena(ARENAS[st.arena]), 'ev');
      const g = new THREE.Group();
      const ev = new ArenaEvents(w, view(w.arena.covers.length), g, vfx, st);
      const v = ev.vista(0, 0);
      expect(!!v, id).toBe(['1-1', '1-3', '1-6'].includes(id));
      // план смотрит вверх, камера — у пола
      if (v) { expect(v.look.y).toBeGreaterThan(v.pos.y); expect(v.pos.y).toBeLessThan(2); }
      expect(!!ev.overhead(), id).toBe(id === '1-6');
      if (id === '1-6') {
        const bell = g.children[g.children.length - 1];
        ev.update(1 / 60, 1 / 60, 18);
        expect(bell.visible).toBe(true);
        ev.update(1 / 60, 1 / 60, 40);
        expect(bell.visible).toBe(false);
      }
    }
  });
});
