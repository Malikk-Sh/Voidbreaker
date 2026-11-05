import { describe, expect, it } from 'vitest';
import { ARENAS, inPart } from '../src/data/arenas';
import { ZONE1 } from '../src/data/stages';
import { GatePath, GATE_PATH, gatePathArena } from '../src/world/gatePath';
import { Arena } from '../src/world/arena';
import { NavGrid } from '../src/world/nav';
import { World } from '../src/world/world';
import { StageRunner } from '../src/world/stage';
import { Abilities } from '../src/world/abilities';
import type { Input } from '../src/input/input';
import { Director, type DirectorActor, type DirectorHost } from '../src/game/director';
import { gateEntranceTrack } from '../src/game/gateEntrance';
import { CameraRig } from '../src/world/camera';

function setup() {
  const arena = new Arena(gatePathArena(ARENAS.gate));
  return { arena, path: new GatePath(arena) };
}

describe('Путь к Вратам: пространство и состояние', () => {
  it('сохраняет террасу с двумя провалами и соединяет её с галереей', () => {
    const { arena } = setup();
    expect(arena.walkable(0, GATE_PATH.start.z)).toBe(true);
    for (let z = 21; z >= -8; z -= 0.25) expect(arena.walkable(0, z), `ось маршрута ${z}`).toBe(true);
    expect(arena.walkable(-7.5, -0.5)).toBe(false);
    expect(arena.walkable(7.5, -0.5)).toBe(false);
    expect(ARENAS.gate.parts).toHaveLength(1); // пересмотры и исходная раскладка не мутируют
  });

  it('ожидание в галерее не начинает бой; раскрытие и порог срабатывают один раз', () => {
    const { path } = setup();
    for (let i = 0; i < 600; i++) expect(path.step(1 / 60, 0, 21)).toBe(null);
    expect(path.phase).toBe('approach');
    expect(path.step(1 / 60, 0, 13)).toBe('reveal');
    expect(path.step(1 / 60, 0, 13)).toBe(null);
    expect(path.step(1 / 60, 0, 7)).toBe('combat');
    expect(path.step(1 / 60, 0, 7)).toBe(null);
  });

  it('закрытые Врата запирают выход, после подъёма навигация находит проход', () => {
    const { path, arena } = setup();
    path.enterCombat();
    const nav = new NavGrid(arena);
    nav.update(0, 0, 0, true);
    expect(nav.reachable(0, -23, false)).toBe(false);
    expect(arena.walkable(0, 11)).toBe(false);
    const before = arena.version;
    path.win();
    path.step(GATE_PATH.openSec / 2, 0, 0);
    expect(arena.walkable(0, -11.5)).toBe(false);
    path.step(GATE_PATH.openSec, 0, 0);
    expect(path.phase).toBe('passage');
    expect(arena.version).toBeGreaterThan(before);
    nav.update(0, 0, 0, true);
    expect(nav.reachable(0, -23, false)).toBe(true);
    for (let z = -8; z >= -24; z -= 0.25) expect(arena.walkable(0, z), `проход ${z}`).toBe(true);
  });

  it('сцена, пауза и смерть не открывают проход преждевременно', () => {
    const { path, arena } = setup();
    path.enterCombat(); path.win();
    path.step(20, 0, 0, false, true);
    expect(path.open).toBe(0);
    path.step(0, 0, 0);
    expect(path.open).toBe(0);
    path.step(1, 0, 0, true);
    path.step(20, 0, 0);
    expect(path.phase).toBe('failed');
    expect(arena.walkable(0, -11.5)).toBe(false);
  });

  it('победа оставляет время осмотреть результат; завершение — только в следующем помещении', () => {
    const { path } = setup();
    path.enterCombat(); path.win();
    expect(path.step(10, 0, 0)).toBe('passage');
    expect(path.step(60, 0, -19)).toBe(null);
    expect(path.phase).toBe('passage');
    expect(path.step(1, 4, -24)).toBe(null);
    expect(path.step(1, 0, -24.5)).toBe('complete');
    expect(path.step(1, 0, -24.5)).toBe(null);
  });

  it('волны не выбирают галерею и выход даже для стрелков и подкреплений', () => {
    const { path, arena } = setup(); path.enterCombat();
    const w = new World(arena, 'gate-path:spawns'); w.hero.spawn(0, 5, Math.PI);
    w.nav.update(0, 0, 5, true);
    const stage = ZONE1.find((s) => s.id === '1-3')!;
    const runner = new StageRunner(w, stage);
    for (const wave of stage.waves) for (const sp of [...wave.spawns, ...(wave.triggers ?? []).map((t) => t.spawn)]) {
      for (let k = 0; k < 80; k++) {
        const p = runner.pickPos(sp, k, 80);
        expect(inPart(arena.def.encounter!, p.x, p.z, 0.35), `${sp.enemy}: ${p.x},${p.z}`).toBe(true);
        expect(arena.walkable(p.x, p.z)).toBe(true);
      }
    }
  });

  it('Фазовый шаг не пересекает закрытые Врата и снова проходит после их открытия', () => {
    const { path, arena } = setup(); path.enterCombat();
    const w = new World(arena, 'gate-path:phase'), abilities = new Abilities(w);
    w.abilities = abilities; abilities.loadout.q = 'phase';
    const input = { moveX: 0, moveZ: -1, aimActive: false } as Input;
    w.hero.spawn(0, -8.8, Math.PI);
    expect(abilities.tryCast('q', input)).toBe(true);
    expect(w.hero.z).toBeGreaterThan(-9.65);
    expect(arena.walkable(w.hero.x, w.hero.z)).toBe(true);
    path.win(); path.step(3, 0, 0);
    abilities.resetCooldowns(); w.hero.spawn(0, -8.8, Math.PI);
    expect(abilities.tryCast('q', input)).toBe(true);
    expect(w.hero.z).toBeCloseTo(-13.8);
  });

  it('Фазовый шаг по-прежнему может пересечь провал, если за ним есть пол', () => {
    const arena = new Arena({ id: 'phase-pit', tile: 1, edge: 'wall', decor: 'gate',
      parts: [{ kind: 'rect', x: 0, z: 0, w: 12, h: 12 }],
      holes: [{ kind: 'rect', x: 0, z: 0, w: 3, h: 2 }],
    });
    const w = new World(arena, 'phase-pit'), abilities = new Abilities(w);
    w.abilities = abilities; abilities.loadout.q = 'phase'; w.hero.spawn(0, 3, Math.PI);
    expect(arena.walkable(0, 0)).toBe(false);
    expect(abilities.tryCast('q', { moveX: 0, moveZ: -1, aimActive: false } as Input)).toBe(true);
    expect(w.hero.z).toBeCloseTo(-2);
    expect(arena.walkable(0, w.hero.z)).toBe(true);
  });
});

describe('Director: вход Стража', () => {
  for (const mode of ['full', 'short', 'skip'] as const) {
    it(`${mode}: конечное положение, закрытая решётка и возврат камеры совпадают`, () => {
      const actor: DirectorActor = { x: 2, y: 0, z: -5, facing: 0 };
      let lift = 0, steps = 0, finished = false;
      const host: DirectorHost = {
        actor: () => actor,
        holding: () => mode === 'skip', tapped: () => false,
        seen: () => mode === 'short' ? 2 : 0, markSeen: () => {},
        call: (fn, arg) => { if (fn === 'gateLift') lift = arg ?? 0; if (fn === 'gateStep') steps++; },
      };
      const d = new Director(host), cam = new CameraRig();
      d.play(gateEntranceTrack([0, 0, -5.5], [-4, 0, -6.5]), () => { finished = true; });
      for (let i = 0; i < 420; i++) d.update(1 / 60, cam);
      expect(finished).toBe(true);
      expect(actor.x).toBeCloseTo(-4);
      expect(actor.z).toBeCloseTo(-6.5);
      expect(lift).toBe(0);
      expect(steps).toBe(2);
      expect(cam.cine).toBe(null);
    });
  }
});
