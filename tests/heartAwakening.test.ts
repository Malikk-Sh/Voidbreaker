import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ClipDef } from '../src/anim/clip';
import { HEART_DEATH_T, heartAwakeningTrack, heartDeathTrack, heartSoulFlightTrack, type ForeHall } from '../src/game/heartAwakening';
import { Director, type CineTrack, type DirectorActor, type DirectorHost } from '../src/game/director';
import { CameraRig } from '../src/world/camera';
import { HEART_SOUL, HeartSoul } from '../src/world/heartSoul';

const DT = 1 / 120;
const GATE = -12, CORE = -27.5, CENTER = -27;
const HALL: ForeHall = { z: 0, rx: 13.5, rz: 10.5 };
const PILLARS = [{ x: -8.5, z: -0.5, r: 0.6 }, { x: 8.5, z: -0.5, r: 0.6 }];
/** Места гибели элиты: у самого прохода, у колонн, в дальнем конце притвора. */
const SOURCES: [number, number][] = [[3, 2], [11.5, 1], [-10, 4], [0, 8.5], [2, -8.6], [-6, -6]];
const launched = (x = 3, z = 2) => { const soul = new HeartSoul(); soul.launch(x, z, GATE, CORE, PILLARS); return soul; };
const times = (soul: HeartSoul, step = 0.02) => {
  const out: number[] = [];
  for (let t = 0; t < soul.timing!.absorbAt; t += step) out.push(t);
  return out;
};

describe('свет элиты летит прямо в Сердце', () => {
  it('не появляется без гибели элиты и вылетает один раз', () => {
    const soul = new HeartSoul();
    expect(soul.phase).toBe('idle');
    expect(soul.visible).toBe(false);
    soul.sampleFlight(3);
    expect(soul.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(soul.beginAwakening()).toBe(false);
    expect(soul.launch(3, 2, GATE, CORE)).toBe(true);
    expect(soul.visible).toBe(true);
    expect(soul.position).toEqual({ x: 3, y: 1.9, z: 2 });
    expect(soul.launch(0, 0, GATE, CORE)).toBe(false);
  });

  for (const [x, z] of SOURCES) {
    it(`из (${x}, ${z}): низко над полом, через ворота по оси прохода и в ядро — не вверх`, () => {
      const soul = launched(x, z), m = soul.timing!;
      let lastZ = Infinity, crossedX = NaN, maxY = 0;
      for (const t of times(soul)) {
        soul.sampleFlight(t);
        const p = soul.position;
        maxY = Math.max(maxY, p.y);
        expect(p.y, `t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(1.1);
        // После вспышки над телом свет только приближается к Сердцу.
        if (t >= HEART_SOUL.burst + m.hover) { expect(p.z, `t=${t.toFixed(2)}`).toBeLessThanOrEqual(lastZ + 0.05); lastZ = p.z; }
        if (Number.isNaN(crossedX) && p.z <= GATE) crossedX = p.x;
      }
      expect(maxY).toBeLessThanOrEqual(HEART_SOUL.ceiling);
      expect(Math.abs(crossedX)).toBeLessThan(1);
      expect(soul.visible).toBe(true);
      soul.sampleFlight(m.absorbAt);
      expect(soul.phase).toBe('absorbed');
      expect(soul.visible).toBe(false);
      expect(soul.position).toEqual({ x: 0, y: HEART_SOUL.coreY, z: CORE });
      // Полёт быстрый: даже из дальнего угла свет в ядре меньше чем за 4 с.
      expect(m.absorbAt).toBeLessThan(4);
      expect(m.dur).toBeCloseTo(m.absorbAt + HEART_SOUL.hold + HEART_SOUL.outro);
    });
  }

  it('облетает колонны притвора, а не проходит сквозь камень', () => {
    for (const [x, z] of [[12, 1.5], [12, -2.5], [-12, 0.5], [-12.5, -3]] as const) {
      const soul = launched(x, z);
      for (const t of times(soul)) {
        soul.sampleFlight(t);
        for (const o of PILLARS) expect(Math.hypot(soul.position.x - o.x, soul.position.z - o.z), `(${x},${z}) t=${t.toFixed(2)}`).toBeGreaterThan(o.r + 0.75);
      }
    }
  });

  it('ворота начинают подниматься раньше, чем свет до них долетает', () => {
    for (const [x, z] of SOURCES) {
      const soul = launched(x, z), m = soul.timing!;
      soul.sampleFlight(m.gateAt);
      const open = (m.gateAt - m.gateOpenAt) / 1.6, barsBottom = Math.min(1, open) * 7.2;
      expect(m.gateOpenAt).toBeGreaterThanOrEqual(0.3);
      expect(barsBottom, `(${x},${z})`).toBeGreaterThan(soul.position.y + 1.2);
      expect(Math.abs(soul.position.z - GATE)).toBeLessThan(0.3);
    }
  });

  it('абсолютные выборки дают тот же путь при любом числе кадров', () => {
    const a = launched(-10, 4), b = launched(-10, 4);
    for (const t of [0.1, 0.4, 0.9, 1.3, 1.9]) a.sampleFlight(t);
    b.sampleFlight(1.9);
    expect(a.position).toEqual(b.position);
  });

  it('поглощённый свет тлеет в ядре и ждёт; пробуждение — только при входе героя', () => {
    const soul = launched(), m = soul.timing!;
    soul.sampleFlight(m.absorbAt);
    expect(soul.awakened).toBe(0);
    soul.sampleFlight(m.absorbAt + 0.4);
    expect(soul.awakened).toBeGreaterThan(0);
    expect(soul.awakened).toBeLessThan(HEART_SOUL.dormant);
    soul.absorb();
    expect(soul.awakened).toBeCloseTo(HEART_SOUL.dormant);
    for (const t of [10, 60, 3600]) soul.sampleFlight(t);
    soul.sampleAwakening(HEART_SOUL.awakenedAt);
    expect(soul.phase).toBe('absorbed');
    expect(soul.awakened).toBeCloseTo(HEART_SOUL.dormant);
    expect(soul.beginAwakening()).toBe(true);
    expect(soul.beginAwakening()).toBe(false);
    soul.sampleAwakening(HEART_SOUL.beats[0] - 0.01);
    expect(soul.awakened).toBeCloseTo(HEART_SOUL.dormant);
    soul.sampleAwakening(HEART_SOUL.awakeAt);
    expect(soul.awakened).toBeGreaterThan(HEART_SOUL.dormant);
    expect(soul.awakened).toBeLessThan(1);
    soul.sampleAwakening(HEART_SOUL.awakenedAt);
    expect(soul.phase).toBe('awake');
    expect(soul.awakened).toBe(1);
    expect(soul.launch(0, 0, GATE, CORE)).toBe(false);
  });
});

type Mode = 'full' | 'short' | 'skip';
function directorFixture(mode: Mode, soul: HeartSoul) {
  const hero: DirectorActor = { x: 1, y: 0, z: 3, facing: Math.PI };
  const calls: string[] = [];
  let ended = false;
  let endTime = 0;
  const clips = new Map<string, ClipDef>();
  let director: Director;
  const host: DirectorHost = {
    actor: who => who === 'hero' ? hero : null,
    defineClip: (_who, id, definition) => { clips.set(id, definition); },
    clipDuration: (_who, id) => clips.get(id)?.dur ?? 0,
    holding: () => mode === 'skip', tapped: () => false,
    seen: () => mode === 'short' ? 2 : 0, markSeen: () => {},
    call: fn => {
      calls.push(fn);
      if (fn === 'heartSoulAbsorb') soul.absorb(director.time);
      if (fn === 'heartAwake') soul.sampleAwakening(HEART_SOUL.awakeAt);
    },
  };
  director = new Director(host);
  const rig = new CameraRig();
  return {
    director, rig, hero, calls,
    play: (track: CineTrack, onEnd: () => void = () => {}) => { ended = false; director.play(track, () => { ended = true; endTime = director.time; onEnd(); }); },
    ended: () => ended,
    endTime: () => endTime,
  };
}

describe('Director: полёт света и пробуждение Сердца', () => {
  it('маркеры заданы в точные моменты, без ожидания касания', () => {
    const soul = launched();
    const flight = heartSoulFlightTrack([1, 0, 3], soul, GATE, HALL), awake = heartAwakeningTrack([0, 0, -17], CENTER);
    const m = soul.timing!;
    expect(flight.dur).toBeCloseTo(m.dur);
    expect(awake.dur).toBeCloseTo(HEART_SOUL.awakeningDur);
    expect(flight.steps.find(s => s.do === 'call' && s.fn === 'heartGateOpen')?.t).toBeCloseTo(m.gateOpenAt);
    expect(flight.steps.find(s => s.do === 'call' && s.fn === 'heartSoulAbsorb')?.t).toBeCloseTo(m.absorbAt);
    expect(awake.steps.find(s => s.do === 'call' && s.fn === 'heartAwake')?.t).toBe(HEART_SOUL.awakeAt);
    for (const track of [flight, awake]) {
      expect(track.short).toBeDefined();
      for (const steps of [track.steps, track.short!]) expect(steps.some(s => s.do === 'wait' || s.do === 'tap')).toBe(false);
      const calls = (steps: typeof track.steps) => steps.filter(s => s.do === 'call').map(s => ({ t: s.t, fn: s.fn }));
      expect(calls(track.short!)).toEqual(calls(track.steps));
    }
  });

  for (const mode of ['full', 'short', 'skip'] as const) {
    it(`${mode}: свет открывает ворота и входит в ядро, пробуждение доводит Сердце до конца`, () => {
      const soul = launched();
      const f = directorFixture(mode, soul);
      f.play(heartSoulFlightTrack([1, 0, 3], soul, GATE, HALL), () => soul.absorb());
      for (let t = 0; t < 8; t += DT) {
        f.director.update(DT, f.rig);
        if (f.director.active) soul.sampleFlight(f.director.time);
      }
      expect(f.ended()).toBe(true);
      expect(f.calls).toEqual(['heartGateOpen', 'heartSoulAbsorb']);
      const m = soul.timing!;
      if (mode === 'full') expect(f.endTime()).toBeCloseTo(m.dur, 1);
      if (mode === 'short') expect(f.endTime()).toBeLessThan(m.dur - 1);
      expect(soul.phase).toBe('absorbed');
      expect(soul.awakened).toBeCloseTo(HEART_SOUL.dormant);
      expect(soul.position).toEqual({ x: 0, y: HEART_SOUL.coreY, z: CORE });
      expect(soul.beginAwakening()).toBe(true);
      f.calls.length = 0;
      f.play(heartAwakeningTrack([0, 0, -17], CENTER), () => soul.awake());
      for (let t = 0; t < 7; t += DT) {
        f.director.update(DT, f.rig);
        if (f.director.active) soul.sampleAwakening(f.director.time);
      }
      expect(f.ended()).toBe(true);
      expect(f.calls).toEqual(['heartAwake']);
      if (mode === 'full') expect(f.endTime()).toBeCloseTo(HEART_SOUL.awakeningDur, 1);
      if (mode === 'short') expect(f.endTime()).toBeLessThan(HEART_SOUL.awakeningDur - 0.8);
      expect(soul.phase).toBe('awake');
      expect(soul.awakened).toBe(1);
      expect(f.hero).toMatchObject({ x: 1, y: 0, z: 3 });
      expect(f.rig.cine).toBe(null);
    });
  }
});

function cameraAt(track: CineTrack, t: number, soul: HeartSoul, mode: Mode = 'full') {
  const f = directorFixture(mode, soul);
  f.play(track);
  for (let elapsed = 0; elapsed < t; elapsed += DT) f.director.update(Math.min(DT, t - elapsed), f.rig);
  return f.director.cameraSample!;
}

function project(c: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number }, width: number, height: number, p: THREE.Vector3) {
  const camera = new THREE.PerspectiveCamera(c.fov ?? 45, width / height, 0.05, 200);
  camera.position.copy(c.pos);
  camera.lookAt(c.look);
  camera.updateMatrixWorld();
  return p.clone().project(camera);
}

/** Камера не уходит за стены: в притворе — внутри эллипса или в коридоре к воротам, дальше — внутри Чертога. */
function insideWalls(p: THREE.Vector3, rim = -0.8): boolean {
  if (Math.abs(p.x) <= 3 && p.z < -6 && p.z > GATE - 3) return true;
  if (p.z > GATE + 0.5) return Math.hypot(p.x / (HALL.rx + rim), (p.z - HALL.z) / (HALL.rz + rim)) <= 1.001;
  return Math.hypot(p.x / 18, (p.z - CENTER) / 14.5) <= 1;
}

describe('кадры Сердца на мобильном экране', () => {
  for (const [width, height] of [[844, 390], [740, 360]]) {
    for (const [x, z] of SOURCES) {
      it(`${width}×${height}, свет из (${x}, ${z}): камера ведёт свет до самого ядра и не уходит за стены`, () => {
        const soul = launched(x, z), m = soul.timing!, hero: [number, number, number] = [x + 1.5, 0, z + 2];
        const track = heartSoulFlightTrack(hero, soul, GATE, HALL);
        for (let t = 0.08; t < m.absorbAt - 0.04; t += 0.18) {
          const probe = launched(x, z); probe.sampleFlight(t);
          const c = cameraAt(track, t, launched(x, z));
          const q = project(c, width, height, new THREE.Vector3(probe.position.x, probe.position.y, probe.position.z)), at = `t=${t.toFixed(2)}`;
          expect(Math.abs(q.x), at).toBeLessThan(0.9);
          expect(Math.abs(q.y), at).toBeLessThan(0.85);
          expect(q.z, at).toBeGreaterThan(-1);
          expect(q.z, at).toBeLessThan(1);
          expect(insideWalls(c.pos), `${at} cam=${c.pos.toArray().map(v => v.toFixed(1))}`).toBe(true);
          // Свет всегда ниже камеры и недалеко: это полёт по проходу, а не взлёт к своду.
          expect(c.pos.y).toBeLessThan(7.5);
        }
        // Пауза у Сердца: ядро в кадре.
        const hold = cameraAt(track, m.absorbAt + HEART_SOUL.hold * 0.6, launched(x, z));
        const core = project(hold, width, height, new THREE.Vector3(0, HEART_SOUL.coreY, CORE));
        expect(Math.abs(core.x)).toBeLessThan(0.6);
        expect(Math.abs(core.y)).toBeLessThan(0.6);
        // Финал: герой у открытых ворот.
        const outro = cameraAt(track, m.absorbAt + HEART_SOUL.hold + HEART_SOUL.outro * 0.5, launched(x, z));
        for (const y of [0.2, 1.9]) {
          const q = project(outro, width, height, new THREE.Vector3(hero[0], y, hero[2]));
          expect(Math.abs(q.x)).toBeLessThan(0.95);
          expect(Math.abs(q.y)).toBeLessThan(0.9);
          expect(q.z).toBeLessThan(1);
        }
        // Общий план героя может стоять над кромкой притвора, но не дальше 2 м от неё.
        expect(insideWalls(outro.pos, 2)).toBe(true);
      });
    }

    for (const centerZ of [-27, -82]) {
      for (const heroX of [-5, 0, 5]) {
        it(`${width}×${height}, центр ${centerZ}, герой x=${heroX}: общие планы пробуждения держат ноги, голову и ядро`, () => {
          const hero: [number, number, number] = [heroX, 0, centerZ + 10];
          const track = heartAwakeningTrack(hero, centerZ);
          for (const [mode, t] of [['full', 0.05], ['full', 3.95], ['full', 4.6], ['short', 3.5]] as const) {
            const c = cameraAt(track, t, launched(), mode);
            expect(c).not.toBeNull();
            const anchors = [
              new THREE.Vector3(heroX, 0.2, hero[2]), new THREE.Vector3(heroX, 1.9, hero[2]),
              new THREE.Vector3(0, HEART_SOUL.coreY, centerZ), new THREE.Vector3(0, HEART_SOUL.coreY + 1.6, centerZ),
            ];
            for (const [i, anchor] of anchors.entries()) {
              const q = project(c, width, height, anchor), at = `${mode} t=${t}, anchor=${i}`;
              expect(Math.abs(q.x), at).toBeLessThan(0.95);
              expect(Math.abs(q.y), at).toBeLessThan(0.75);
              expect(q.z, at).toBeGreaterThan(-1);
              expect(q.z, at).toBeLessThan(1);
            }
          }
        });
      }

      it(`${width}×${height}, центр ${centerZ}: удары сердца и рёв — ядро и венец в кадре`, () => {
        const track = heartAwakeningTrack([0, 0, centerZ + 10], centerZ);
        for (const t of [0.95, 1.3, 1.7, 2.2, 2.45]) {
          const c = cameraAt(track, t, launched());
          for (const anchor of [new THREE.Vector3(0, HEART_SOUL.coreY, centerZ), new THREE.Vector3(0, HEART_SOUL.coreY + 1.6, centerZ)]) {
            const q = project(c, width, height, anchor);
            expect(Math.abs(q.x), `t=${t}`).toBeLessThan(0.9);
            expect(Math.abs(q.y), `t=${t}`).toBeLessThan(0.9);
            expect(q.z, `t=${t}`).toBeGreaterThan(-1);
            expect(q.z, `t=${t}`).toBeLessThan(1);
          }
        }
      });
    }
  }

  it('камера пробуждения остаётся внутри новых ворот в полной и короткой версиях', () => {
    for (const centerZ of [-27, -82]) for (const heroX of [-5, 0, 5]) {
      const track = heartAwakeningTrack([heroX, 0, centerZ + 10], centerZ);
      for (const steps of [track.steps, track.short!]) for (const step of steps) {
        if (step.do !== 'cam') continue;
        for (const point of step.path) expect(point[2], `centerZ=${centerZ}, heroX=${heroX}, t=${step.t}`).toBeLessThanOrEqual(centerZ + 14);
      }
    }
  });
});

describe('гибель Сердца: отдельная сцена', () => {
  for (const [width, height] of [[844, 390], [740, 360]]) {
    for (const [hero, body] of [[[0, 0, -19], [0, 1.05, -24]], [[-9, 0, -30], [-6, 1.05, -33]], [[12, 0, -26], [7.6, 1.05, -27.5]]] as [[number, number, number], [number, number, number]][]) {
      it(`${width}×${height}, герой (${hero[0]}, ${hero[2]}): ядро в кадре до вспышки, затем общий план с героем`, () => {
        const track = heartDeathTrack(hero, body, CENTER);
        expect(track.skippable).toBe(true);
        for (const t of [0.1, 0.9, 1.8]) {
          const c = cameraAt(track, t, launched());
          const q = project(c, width, height, new THREE.Vector3(body[0], 2.3, body[2]));
          expect(Math.abs(q.x), `t=${t}`).toBeLessThan(0.5); expect(Math.abs(q.y), `t=${t}`).toBeLessThan(0.5);
          expect(Math.hypot(c.pos.x / 18, (c.pos.z - CENTER) / 14)).toBeLessThanOrEqual(1);
        }
        const c = cameraAt(track, HEART_DEATH_T.end - 0.4, launched());
        for (const p of [new THREE.Vector3(hero[0], 0.2, hero[2]), new THREE.Vector3(hero[0], 1.9, hero[2]), new THREE.Vector3(body[0], 1.4, body[2])]) {
          const q = project(c, width, height, p);
          expect(Math.abs(q.x)).toBeLessThan(0.95); expect(Math.abs(q.y)).toBeLessThan(0.85); expect(q.z).toBeLessThan(1);
        }
        expect(Math.hypot(c.pos.x / 18, (c.pos.z - CENTER) / 14)).toBeLessThanOrEqual(1);
      });
    }
  }
});
