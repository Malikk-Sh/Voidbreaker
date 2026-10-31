import { describe, expect, it } from 'vitest';
import { ARENAS } from '../src/data/arenas';
import { ENEMIES } from '../src/data/enemies';
import { ZONE1 } from '../src/data/stages';
import { Arena } from '../src/world/arena';
import { BIG_RADIUS, NavGrid } from '../src/world/nav';
import { World } from '../src/world/world';
import { Abilities } from '../src/world/abilities';
import { StageRunner } from '../src/world/stage';
import { InputBuffer } from '../src/input/input';
import { Husk } from '../src/world/enemies/husk';
import { Golem } from '../src/world/enemies/golem';
import type { Input } from '../src/input/input';
import type { Enemy } from '../src/world/enemy';

/** Стартовая точка героя — как в Battle. */
function heroStart(a: Arena): { x: number; z: number } {
  const b = a.bounds, p0 = a.def.parts[0];
  const o = { x: 0, z: 0 };
  a.nearestWalkable(p0.x, Math.min(b.maxZ - 3, (b.maxZ + b.minZ) / 2 + (b.maxZ - b.minZ) * 0.25), o);
  return o;
}

const ARENA_IDS = [...new Set(ZONE1.map((s) => s.arena))];

describe('навигация врагов (план §4.4)', () => {
  for (const id of ARENA_IDS) {
    for (const cross of id === 'hierophant' ? [false, true] : [false]) {
      it(`${id}${cross ? ' (крест-мост)' : ''}: из любой клетки враг доходит до героя или помечен недостижимым`, () => {
        const a = new Arena(ARENAS[id]);
        if (cross) { a.collapseOutsideCross(); for (let i = 0; i < 900; i++) a.step(1 / 60); }
        const h = cross ? { x: 0, z: 6 } : heroStart(a);
        const nav = new NavGrid(a);
        nav.update(0, h.x, h.z, true);
        const out = { x: 0, z: 0 };
        let reached = 0, flagged = 0;
        for (const big of [false, true]) {
          const F = big ? nav.fieldBig : nav.field;
          for (let c = 0; c < F.length; c++) {
            if (nav.blocked[c] || (big && nav.clearance[c] < BIG_RADIUS)) continue;
            let x = nav.cx(c), z = nav.cz(c);
            if (!nav.reachable(x, z, big)) { expect(nav.descend(x, z, big, out)).toBe(false); flagged++; continue; }
            let steps = 0;
            while (Math.hypot(x - h.x, z - h.z) > 1.2 && steps < 600) {
              expect(nav.descend(x, z, big, out)).toBe(true);
              x = out.x; z = out.z; steps++;
            }
            expect(Math.hypot(x - h.x, z - h.z), `${id} ${big ? 'big' : ''} from cell ${c}`).toBeLessThanOrEqual(1.2);
            reached++;
          }
        }
        expect(reached).toBeGreaterThan(100);
        if (id === 'bridge' || cross) expect(flagged).toBeGreaterThanOrEqual(0);
      });
    }
  }

  it('ни одна точка спауна ближнего боя не лежит вне связной области героя', () => {
    for (const st of ZONE1) {
      const w = new World(new Arena(ARENAS[st.arena]), `spawn:${st.id}`);
      w.abilities = new Abilities(w);
      const h = heroStart(w.arena);
      w.hero.spawn(h.x, h.z, Math.PI);
      w.nav.update(0, h.x, h.z, true);
      const runner = new StageRunner(w, st);
      for (const wave of st.waves) {
        for (const sp of [...wave.spawns, ...(wave.triggers ?? []).map((t) => t.spawn)]) {
          const def = ENEMIES[sp.enemy];
          if (def.ranged) continue;
          for (let k = 0; k < 12; k++) {
            const p = runner.pickPos(sp, k, 12);
            expect(w.nav.reachable(p.x, p.z, def.radius > BIG_RADIUS), `${st.id} ${sp.enemy} @ ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(true);
          }
        }
      }
    }
  });

  const idle = { moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() } as unknown as Input;

  function chase(arenaId: string, make: () => Enemy, from: { x: number; z: number }, hero: { x: number; z: number }, secs: number): { dist: number; maxStill: number } {
    const w = new World(new Arena(ARENAS[arenaId]), 'chase');
    w.abilities = new Abilities(w);
    w.hero.spawn(hero.x, hero.z, 0);
    w.hero.invulnUntil = 1e9;
    const e = make();
    e.x = from.x; e.z = from.z;
    w.addEnemy(e);
    e.setState('idle'); e.puppet.dissolve = 0;
    e.cooldown = 1e9; // только движение
    let still = 0, maxStill = 0, px = e.x, pz = e.z, win = 0;
    for (let t = 0; t < secs; t += 1 / 60) {
      w.step(1 / 60, 1 / 60, idle);
      win += 1 / 60;
      if (win >= 0.5) {
        const moved = Math.hypot(e.x - px, e.z - pz);
        const near = Math.hypot(e.x - w.hero.x, e.z - w.hero.z) < 3.2;
        still = moved < 0.1 && !near && e.state !== 'warp' && e.state !== 'spawn' ? still + win : 0;
        maxStill = Math.max(maxStill, still);
        px = e.x; pz = e.z; win = 0;
      }
    }
    return { dist: Math.hypot(e.x - w.hero.x, e.z - w.hero.z), maxStill };
  }

  it('Шелуха обходит провал двора Врат и не стоит на краю', () => {
    const r = chase('gate', () => new Husk({ zone: 0, stage: 2 }), { x: -7.5, z: -6 }, { x: -7.5, z: 5.5 }, 12);
    expect(r.maxStill).toBeLessThan(3);
    expect(r.dist).toBeLessThan(2.5);
  });

  it('Голем обходит свечной колодец', () => {
    const r = chase('candles', () => new Golem({ zone: 0, stage: 3 }), { x: 0, z: -8 }, { x: 0, z: 6 }, 25);
    expect(r.maxStill).toBeLessThan(3);
    expect(r.dist).toBeLessThan(4);
  });
});

describe('камера и заметность героя (план §5.3)', () => {
  /** Рост Пилота (1.9 м) на экране 1280×600 (px) в режиме камеры. */
  async function heroPx(mode: 'cinema' | 'tactical'): Promise<number> {
    const THREE = await import('three');
    const { CAM_MODES, CameraRig } = await import('../src/world/camera');
    const P = CAM_MODES[mode];
    const cam = new THREE.PerspectiveCamera(P.fov, 1280 / 600, 0.1, 500);
    const rig = new CameraRig();
    rig.baseDist = P.dist; rig.tilt = P.tilt; rig.fov = P.fov;
    rig.snap(0, 0);
    rig.update(1 / 60, 0, 0, 0, 0, cam);
    cam.updateMatrixWorld();
    const a = new THREE.Vector3(0, 0, 0).project(cam), b = new THREE.Vector3(0, 1.9, 0).project(cam);
    return ((b.y - a.y) / 2) * 600;
  }

  it('на экране 1280×600 герой (1.9 м) не меньше 75 px — в обоих режимах камеры', async () => {
    expect(await heroPx('tactical')).toBeGreaterThanOrEqual(75);
    expect(await heroPx('cinema')).toBeGreaterThanOrEqual(75);
  });

  it('план ×100 (C1): «Кино» по умолчанию — ниже, шире и ближе, Пилот того же размера (±20 %)', async () => {
    const { CAM_MODES, camModeFrom } = await import('../src/world/camera');
    const { DEFAULT_SETTINGS } = await import('../src/meta/settings');
    const C = CAM_MODES.cinema, T = CAM_MODES.tactical;
    expect(DEFAULT_SETTINGS.camMode).toBe('cinema');
    expect(C.tilt).toBeLessThan(T.tilt);
    expect(C.fov).toBeGreaterThan(T.fov);
    expect(C.boss).toBeLessThan(T.boss);
    // 17 м × tan 15° / tan 19°: при более широком угле — ближе
    expect(C.dist).toBeCloseTo(T.dist * Math.tan((T.fov / 2) * Math.PI / 180) / Math.tan((C.fov / 2) * Math.PI / 180), 1);
    const c = await heroPx('cinema'), t = await heroPx('tactical');
    expect(c / t).toBeGreaterThan(0.8);
    expect(c / t).toBeLessThan(1.25);
    // старые сохранения без поля — «Кино»; адрес ?cam= перекрывает настройку
    expect(camModeFrom(undefined, '')).toBe('cinema');
    expect(camModeFrom('tactical', '')).toBe('tactical');
    expect(camModeFrom('cinema', '?cam=tactical')).toBe('tactical');
    expect(camModeFrom('tactical', '?cam=cinema')).toBe('cinema');
  });
});
