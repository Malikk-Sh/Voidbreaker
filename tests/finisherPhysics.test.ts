import { describe, expect, it } from 'vitest';
import { Director, type CineTrack, type DirectorActor, type DirectorHost, type V3 } from '../src/game/director';
import { CameraRig } from '../src/world/camera';
import { Time } from '../src/core/time';
import { EXECUTION_CLIPS } from '../src/anim/clips/execution';
import { executionTrack } from '../src/world/boss/hierophantScenes';
import { killGateTrack, killBellTrack } from '../src/world/boss/guardianScenes';
import type { ClipDef } from '../src/anim/clip';
import { Clip } from '../src/anim/clip';
import { RigLayout, Skeleton } from '../src/anim/skeleton';
import { HERO_RIG } from '../src/gen/chars/hero';
import { FINISHER_EDGE_Y, MASK_RELEASE } from '../src/anim/clips/execution';
import * as THREE from 'three';
import { emptyProject, resolveScene } from '../src/game/sceneEdits';

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
const position = (a: DirectorActor): V3 => [a.x, a.y ?? 0, a.z];

function fixture(hero: DirectorActor = { x: 0, y: 0, z: 0, facing: 0 }) {
  const boss: DirectorActor = { x: 0, y: 0, z: 0, facing: 0 };
  const clips = new Map<string, ClipDef>(EXECUTION_CLIPS.map(c => [c.id, c]));
  const poses = new Map<string, number>(), calls: { name: string; real: number }[] = [];
  let real = 0, tapped = false;
  const host: DirectorHost = {
    actor: who => who === 'hero' ? hero : boss,
    defineClip: (_who, id, definition) => { clips.set(id, definition); },
    clipEvents: (_who, id) => clips.get(id)?.events ?? [],
    clipDuration: (_who, id) => clips.get(id)?.dur ?? 0,
    sampleClip: (who, _id, t) => { poses.set(who, t); },
    call: name => { calls.push({ name, real }); },
    holding: () => false, tapped: () => tapped, seen: () => 0, markSeen: () => {},
  };
  const d = new Director(host), cam = new CameraRig(), time = new Time(); d.full = true;
  const step = (dt: number) => { real += dt; time.update(dt); d.update(dt, cam); };
  return { hero, boss, poses, calls, d, cam, time, step, real: () => real, setTapped: (v: boolean) => { tapped = v; } };
}

describe('физика сценических добиваний: импульс и время', () => {
  it('Hermite начинает с фактического положения, достигает обеих опорных точек и сохраняет скорость на стыке', () => {
    const f = fixture({ x: 4, y: 0.3, z: -2, facing: 0 });
    f.d.play({ id: 'momentum', dur: 1.01, steps: [
      { t: 0, do: 'actor', who: 'hero', moveTo: [6, 1, -2], dur: 0.4, velocityFrom: [0, 0, 0], velocityTo: [3, 0, 1] },
      { t: 0.4, do: 'actor', who: 'hero', moveTo: [10, 0, 0], dur: 0.6, velocityFrom: [3, 0, 1], velocityTo: [0, -1, 0] },
    ] });
    const epsilon = 1 / 10000;
    f.step(0); expect(position(f.hero)).toEqual([4, 0.3, -2]);
    f.step(0.4 - epsilon); const before = position(f.hero);
    f.step(epsilon); const seam = position(f.hero);
    f.step(epsilon); const after = position(f.hero);
    for (let i = 0; i < 3; i++) {
      expect(seam[i]).toBeCloseTo([6, 1, -2][i], 8);
      const left = (seam[i] - before[i]) / epsilon, right = (after[i] - seam[i]) / epsilon;
      expect(left).toBeCloseTo([3, 0, 1][i], 2);
      expect(right).toBeCloseTo([3, 0, 1][i], 2);
      expect(Math.abs(right - left)).toBeLessThan(0.02);
    }
    f.step(0.6 - epsilon);
    for (let i = 0; i < 3; i++) expect(position(f.hero)[i]).toBeCloseTo([10, 0, 0][i], 8);
  });

  it('изменение темпа сохраняет пространственную дугу и дожим Hermite, меняя только время', () => {
    const track: CineTrack = { id: 'momentumRetime', revision: 1, dur: 0.85, steps: [
      { t: 0, do: 'actor', who: 'hero', moveTo: [2, 1, -1], dur: 0.8, velocityFrom: [1, 2, 0], velocityTo: [3, -1, 1] },
    ] };
    const project = emptyProject(); project.enabled = true;
    project.scenes.momentumRetime = { full: { revision: 1, rate: 2, steps: {} } };
    const normal = fixture(), accelerated = fixture(); normal.d.play(track); accelerated.d.play(resolveScene(track, project, 'full'));
    for (let i = 0; i < 4; i++) {
      normal.step(0.2); accelerated.step(0.1);
      for (let j = 0; j < 3; j++) expect(position(accelerated.hero)[j]).toBeCloseTo(position(normal.hero)[j], 8);
    }
  });

  for (const fps of [30, 60, 120]) it(`${fps} Гц: контактная остановка одинаково держит обоих актёров и позы, не теряя остаток кадра`, () => {
    const f = fixture(), dt = 1 / fps, hold = 0.055;
    const pose: ClipDef = { id: 'holdFixture', dur: 1, keys: [{ t: 0, pose: {} }], events: [{ t: 0.72, name: 'contact' }] };
    f.d.play({ id: 'contactHold', dur: 1, steps: [
      { t: 0, do: 'actor', who: 'hero', moveTo: [1, 0, 0], dur: 1, ease: 'linear' },
      { t: 0, do: 'actor', who: 'boss', moveTo: [0, 0, 2], dur: 1, ease: 'linear' },
      { t: 0, do: 'clip', who: 'hero', clip: pose.id, definition: pose, markers: { contact: 'contact' } },
      { t: 0, do: 'clip', who: 'boss', clip: pose.id, definition: pose },
      { t: 0, do: 'cam', path: [[0, 2, 5], [2, 2, 5]], look: [[0, 1, 0]], dur: 1, ease: 'linear', fov: 44 },
      { t: 0.4, do: 'call', fn: 'compression' },
      { t: 0.4, do: 'hold', dur: hold },
    ] });
    let previous = -1, frozenFrames = 0;
    for (let i = 0; i < fps * 2 && f.d.active; i++) {
      f.step(dt);
      if (Math.abs(f.d.time - previous) < 1e-10 && Math.abs(f.d.time - 0.4) < 1e-10) {
        frozenFrames++;
        expect(f.hero.x).toBeCloseTo(0.4, 9); expect(f.boss.z).toBeCloseTo(0.8, 9);
        expect(f.poses.get('hero')).toBeCloseTo(0.4, 9); expect(f.poses.get('boss')).toBeCloseTo(0.4, 9);
        expect(f.d.cameraSample?.pos.x).toBeCloseTo(0.8, 8);
      }
      previous = f.d.time;
    }
    expect(frozenFrames).toBeGreaterThan(0);
    const expectedFinish = Math.ceil((1 + hold) / dt - 1e-8) * dt;
    expect(f.real()).toBeCloseTo(expectedFinish, 8);
    expect(f.time.real).toBeCloseTo(f.real(), 10);
    expect(f.calls.map(c => c.name)).toEqual(['compression', 'contact']);
    const contact = f.calls.find(c => c.name === 'contact')!;
    expect(contact.real).toBeGreaterThanOrEqual(0.72 + hold - 1e-8);
    expect(contact.real).toBeLessThan(0.72 + hold + dt + 1e-8);
    expect(f.hero.x).toBe(1); expect(f.boss.z).toBe(2); expect(f.d.active).toBe(false);
  });

  for (const skipAt of [0.2, 0.42]) it(`пропуск в ${skipAt} с не ждёт контактную остановку и выполняет исход один раз`, () => {
    const f = fixture();
    f.d.play({ id: 'skipHold', dur: 1, steps: [
      { t: 0, do: 'actor', who: 'hero', moveTo: [3, 0, 2], dur: 1, velocityFrom: [0, 0, 0], velocityTo: [0, 0, 0] },
      { t: 0.4, do: 'hold', dur: 0.055 },
      { t: 0.7, do: 'call', fn: 'contact' },
      { t: 0.9, do: 'call', fn: 'death' },
    ] });
    for (let t = 0; t < skipAt - 1e-8; t += 0.01) f.step(0.01);
    const real = f.real(); f.d.skip();
    expect(f.real()).toBe(real); expect(f.d.active).toBe(false); expect(position(f.hero)).toEqual([3, 0, 2]);
    expect(f.calls.map(c => c.name)).toEqual(['contact', 'death']);
    f.step(2); expect(f.calls.map(c => c.name)).toEqual(['contact', 'death']);
  });

  it('ожидание касания не расходует контактную остановку, которая ещё впереди', () => {
    const f = fixture();
    f.d.play({ id: 'waitBeforeHold', dur: 1, steps: [
      { t: 0, do: 'actor', who: 'hero', moveTo: [1, 0, 0], dur: 1, ease: 'linear' },
      { t: 0.3, do: 'wait', prompt: 'Продолжить' },
      { t: 0.5, do: 'hold', dur: 0.055 },
      { t: 0.7, do: 'call', fn: 'contact' },
    ] });
    for (let i = 0; i < 30; i++) f.step(0.05);
    expect(f.d.waiting).toBe(true); expect(f.d.time).toBeLessThan(0.3);
    f.setTapped(true); f.step(0.01); f.setTapped(false);
    expect(f.d.time).toBeCloseTo(0.3, 8);
    f.step(0.255); expect(f.d.time).toBeCloseTo(0.5, 8); expect(f.hero.x).toBeCloseTo(0.5, 8);
    f.step(0.1); expect(f.d.time).toBeCloseTo(0.6, 8); expect(f.calls).toHaveLength(0);
    f.step(0.1); expect(f.calls.map(c => c.name)).toEqual(['contact']);
  });
});

function contactAt(track: CineTrack): number {
  const clip = track.steps.find(s => s.do === 'clip' && Object.values(s.markers ?? {}).some(v => ['strike', 'helmet', 'bell'].includes(v)));
  if (!clip || clip.do !== 'clip') throw new Error(`${track.id}: нет ударного клипа`);
  const definition = clip.definition ?? EXECUTION_CLIPS.find(c => c.id === clip.clip);
  const marker = definition?.events?.find(e => e.name === 'contact');
  if (!marker) throw new Error(`${track.id}: нет маркера контакта`);
  return clip.t + marker.t / (clip.speed ?? 1);
}

describe('кинематика трёх добиваний', () => {
  const tracks = () => [
    executionTrack({ bx: 0, bz: 0, hx: 0, hz: 6, mask: [0.2, 2.8, 0.85], bellY: 2.8, lx: 0, lz: -3.2, star: [0.42, -0.5, -0.76] }),
    killGateTrack({ gx: 0, gz: 0, hx: 0, hz: 6, facing: 0 }),
    killBellTrack({ gx: 0, gz: 0, hx: 0, hz: 6, facing: 0 }),
  ];
  for (const index of [0, 1, 2]) it(`${['Иерофант', 'Страж Врат', 'Звонарь'][index]}: тело не висит перед ударом, контакт получает дожим, камера не заменяет разрез рывком`, () => {
    const track = tracks()[index], contact = contactAt(track), f = fixture({ x: 0, y: 0, z: 6, facing: Math.PI });
    const strike = track.steps.find(s => s.do === 'clip' && Object.values(s.markers ?? {}).some(v => ['strike', 'helmet', 'bell'].includes(v)))!;
    if (strike.do !== 'clip') throw new Error('нет клипа');
    const layout = new RigLayout(HERO_RIG), skel = new Skeleton(layout), clip = new Clip(EXECUTION_CLIPS.find(c => c.id === strike.clip)!, layout);
    const root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
    const dt = 1 / 240, samples: { t: number; p: V3; camera: V3 | null; edge?: V3 }[] = [];
    f.d.play(track);
    for (let i = 0; i < Math.ceil((contact + 0.23) / dt) + 30; i++) {
      f.step(dt); const c = f.d.cameraSample;
      let edge: V3 | undefined;
      if (f.d.time >= strike.t) {
        skel.rot.set(layout.restRot); clip.sample(f.d.time - strike.t, skel.rot, root);
        skel.x = f.hero.x; skel.y = (f.hero.y ?? 0) + root.y; skel.z = f.hero.z; skel.facing = f.hero.facing; skel.update();
        edge = skel.jointPoint(layout.idx('blade'), 0, FINISHER_EDGE_Y, 0, new THREE.Vector3()).toArray() as V3;
      }
      samples.push({ t: f.d.time, p: position(f.hero), camera: c ? c.pos.toArray() as V3 : null, edge });
      if (f.d.time >= contact + 0.22) break;
    }
    let stationary = 0, longestStationary = 0;
    for (let i = 1; i < samples.length; i++) {
      const s = samples[i], previous = samples[i - 1];
      if (s.t < contact - 0.45 || s.t > contact - 0.06 || s.p[1] < 0.1) continue;
      stationary = distance(s.p, previous.p) < 1e-5 ? stationary + s.t - previous.t : 0;
      longestStationary = Math.max(longestStationary, stationary);
    }
    expect(longestStationary, 'зависание тела перед ударом').toBeLessThan(0.1);
    const compression = samples.filter(s => s.t >= contact + 0.015 && s.t <= contact + 0.18);
    expect(compression.length).toBeGreaterThan(10);
    const followThrough = Math.max(...compression.map(s => distance(s.p, compression[0].p)));
    expect(followThrough, 'после попадания тело должно передать импульс, а не застыть в точке').toBeGreaterThan(0.025);
    expect(followThrough, 'дожим не превращается в новый рывок').toBeLessThan(0.7);
    const contactShot = samples.filter(s => s.t >= contact - 0.1 && s.t <= contact + 0.12 && s.camera);
    expect(contactShot.length).toBeGreaterThan(20);
    const cameraTravel = Math.max(...contactShot.map(s => distance(s.camera!, contactShot[0].camera!)));
    expect(cameraTravel, 'кадр контакта остаётся устойчивым').toBeLessThan(0.45);
    const speeds = samples.slice(1).flatMap((s, i) => {
      const before = samples[i];
      return s.edge && before.edge && s.t - before.t > 1e-6 ? [{ t: s.t - strike.t, speed: distance(s.edge, before.edge) / (s.t - before.t) }] : [];
    });
    const windupPeak = Math.max(...speeds.filter(s => s.t > 0.05 && s.t < 0.44).map(s => s.speed));
    const releasePeak = Math.max(...speeds.filter(s => s.t > MASK_RELEASE && s.t < contact - strike.t + 1e-8).map(s => s.speed));
    expect(releasePeak, 'рабочий край заметно ускоряется после медленного замаха').toBeGreaterThan(windupPeak * 2.5);
    expect(releasePeak, 'быстрый разрез проходит в сценическом времени, а не только в эффекте камеры').toBeGreaterThan(10);
  });
});
