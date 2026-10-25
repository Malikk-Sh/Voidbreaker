import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VICTORY_SHOT, victoryFrame } from '../src/game/victoryShot';
import { HERO_CLIPS } from '../src/anim/clips/hero';
import { Clip } from '../src/anim/clip';
import { RigLayout, Skeleton } from '../src/anim/skeleton';
import { HERO_RIG, BLADE_LEN } from '../src/gen/chars/hero';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';

const layout = new RigLayout(HERO_RIG);
const def = HERO_CLIPS.find(c => c.id === 'victory')!;
const root = () => ({ x: 0, y: 0, z: 0, stretch: 1, spin: 0 });

describe('победная стойка и спокойный пролёт', () => {
  it('новый план сохраняет заданные доли времени, дуги и дистанции, плавно останавливается', () => {
    expect(VICTORY_SHOT.dur).toBeCloseTo(2.6 * 1.25, 10);
    expect(VICTORY_SHOT.arc).toBeCloseTo(0.9 * 0.7, 10);
    const origin: [number, number, number] = [3, 0, -4], facing = 1.3;
    const a = victoryFrame(origin, facing, 0), b = victoryFrame(origin, facing, 1);
    const radius = (p: number[]) => Math.hypot(p[0] - origin[0], p[2] - origin[2]);
    expect(radius(a.cam)).toBeCloseTo(7 * 0.8, 10);
    expect(radius(b.cam)).toBeCloseTo(6 * 0.8, 10);
    expect(b.cam[1] - a.cam[1]).toBeCloseTo(0.6 * 0.7, 10);
    const azimuth = (p: number[]) => Math.atan2(p[0] - origin[0], p[2] - origin[2]);
    expect(azimuth(b.cam) - azimuth(a.cam)).toBeCloseTo(VICTORY_SHOT.arc, 10);
    const step = 0.001;
    const start = new THREE.Vector3(...a.cam).distanceTo(new THREE.Vector3(...victoryFrame(origin, facing, step).cam));
    const middle = new THREE.Vector3(...victoryFrame(origin, facing, 0.5).cam).distanceTo(new THREE.Vector3(...victoryFrame(origin, facing, 0.5 + step).cam));
    expect(start).toBeLessThan(middle * 0.01);
  });

  it('стойка сохраняет опору обеих стоп, клинок не касается пола и не машет за спиной', () => {
    const clip = new Clip(def, layout), s = new Skeleton(layout);
    let feet: THREE.Vector3[] | undefined;
    for (let t = 0; t <= def.dur; t += 1 / 120) {
      const r = root(); clip.sample(t, s.rot, r); s.y = r.y; s.update();
      const next = ['footL', 'footR'].map(n => s.jointPos(layout.idx(n), new THREE.Vector3()));
      if (feet) for (let i = 0; i < feet.length; i++) expect(next[i].distanceTo(feet[i])).toBeLessThan(0.00001);
      feet = next;
      expect(Math.min(...next.map(p => p.y))).toBeGreaterThan(0.04);
      expect(Math.min(...next.map(p => p.y))).toBeLessThan(0.08);
      const tip = s.jointPoint(layout.idx('blade'), 0, -BLADE_LEN - 0.02, 0, new THREE.Vector3());
      expect(tip.y).toBeGreaterThan(0.12);
      expect(Math.abs(tip.x)).toBeGreaterThan(0.45);
    }
  });

  it('полный силуэт и меч остаются внутри мобильного кадра на всём пролёте', () => {
    const clip = new Clip(def, layout), s = new Skeleton(layout);
    for (const aspect of [844 / 390, 740 / 360, 1280 / 720]) {
      const camera = new THREE.PerspectiveCamera(VICTORY_SHOT.fov, aspect, 0.05, 100);
      for (let t = 0; t <= def.dur; t += 1 / 30) {
        const r = root(); clip.sample(t, s.rot, r); s.y = r.y; s.update();
        const frame = victoryFrame([0, 0, 0], 0, t / def.dur);
        camera.position.set(...frame.cam); camera.lookAt(new THREE.Vector3(...frame.look)); camera.updateMatrixWorld(true);
        const points = ['footL', 'footR', 'handL', 'handR'].map(n => s.jointPos(layout.idx(n), new THREE.Vector3()));
        points.push(s.jointPoint(layout.idx('head'), 0, 0.36, 0, new THREE.Vector3()));
        points.push(s.jointPoint(layout.idx('blade'), 0, -BLADE_LEN - 0.02, 0, new THREE.Vector3()));
        for (const point of points) {
          const projected = point.project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(0.96);
          expect(Math.abs(projected.y)).toBeLessThan(0.72);
          expect(projected.z).toBeGreaterThan(-1); expect(projected.z).toBeLessThan(1);
        }
      }
    }
  });

  it('победа не перезапускает стойку повторно и сохраняет сценическую анимацию', () => {
    const w = new World(new Arena(ARENAS.naves), 'victory-pose'), h = w.hero, p = h.avatar.puppet;
    h.vx = 2; h.vz = -3; h.kbX = 1; h.kbZ = 2; h.chargeLevel = 2;
    p.anim.sampleScene(p.clips.get('victory')!, 0.8, true); p.anim.compose(p.base);
    h.victory();
    expect(h.state).toBe('victory'); expect(h.move).toBeNull(); expect(h.chargeLevel).toBe(0);
    expect([h.vx, h.vz, h.kbX, h.kbZ]).toEqual([0, 0, 0, 0]);
    expect(p.anim.sceneDriven).toBe(true); expect(p.anim.clip?.id).toBe('victory'); expect(p.anim.t).toBe(0.8);
    h.stateT = 1.2; h.victory(); expect(h.stateT).toBe(1.2); expect(p.anim.t).toBe(0.8);
    h.avatar.dispose();
  });

  it('после конца сцены победная стойка сохраняется во время выхода камеры и ожидания итогов', () => {
    const w = new World(new Arena(ARENAS.naves), 'victory-handoff'), h = w.hero, p = h.avatar.puppet;
    h.sampleSceneClip('victory', def.dur, true, 0); h.victory();
    const joints = ['pelvis', 'chest', 'head', 'shR', 'elbR', 'handR', 'blade', 'footL', 'footR'];
    const before = new Map(joints.map(name => {
      const i = p.layout.idx(name);
      return [name, { rotation: Array.from(p.skel.rot.slice(i * 4, i * 4 + 4)), point: p.skel.jointPos(i, new THREE.Vector3()).clone() }];
    }));
    const rootY = p.anim.root.y;
    h.releaseSceneClip();
    expect(p.anim.sceneDriven).toBe(false); expect(h.scripted).toBe(false); expect(h.state).toBe('victory');
    for (const dt of [0.2, 0.8]) {
      h.avatar.update(dt, h.x, h.z, h.facing, 0, 0, 0, false);
      expect(p.anim.clip?.id).toBe('victory'); expect(p.anim.t).toBe(def.dur); expect(p.anim.speed).toBe(0);
      expect(p.anim.root.y).toBeCloseTo(rootY, 8);
      for (const name of joints) {
        const i = p.layout.idx(name), old = before.get(name)!;
        for (let a = 0; a < 4; a++) expect(p.skel.rot[i * 4 + a]).toBeCloseTo(old.rotation[a], 7);
        expect(p.skel.jointPos(i, new THREE.Vector3()).distanceTo(old.point)).toBeLessThan(0.00001);
      }
    }
    h.avatar.dispose();
  });

  it('пропуск смешанного входа сразу фиксирует конечную позу победы, до первого настоящего кадра', () => {
    const w = new World(new Arena(ARENAS.naves), 'victory-skip-handoff'), h = w.hero, p = h.avatar.puppet;
    h.sampleSceneClip('maskStrike', 0.72, true, 0);
    h.sampleSceneClip('victory', def.dur, true, 0.25); h.victory();
    const expected = new Skeleton(p.layout), expectedRoot = root();
    new Clip(def, p.layout).sample(def.dur, expected.rot, expectedRoot);
    expected.x = h.x; expected.z = h.z; expected.facing = h.facing; expected.y = h.y + expectedRoot.y; expected.update();
    h.releaseSceneClip();
    const assertTerminalPose = () => {
      expect(p.anim.sceneDriven).toBe(false); expect(p.anim.clip?.id).toBe('victory'); expect(p.anim.speed).toBe(0);
      expect(p.anim.t).toBe(def.dur); expect(p.anim.root.y).toBeCloseTo(expectedRoot.y, 8);
      for (const name of ['pelvis', 'chest', 'head', 'handR', 'blade', 'footL', 'footR']) {
        const i = p.layout.idx(name);
        for (let a = 0; a < 4; a++) expect(p.skel.rot[i * 4 + a]).toBeCloseTo(expected.rot[i * 4 + a], 7);
        expect(p.skel.jointPos(i, new THREE.Vector3()).distanceTo(expected.jointPos(i, new THREE.Vector3()))).toBeLessThan(0.00001);
      }
    };
    assertTerminalPose();
    h.avatar.update(0.2, h.x, h.z, h.facing, 0, 0, 0, false); assertTerminalPose();
    h.avatar.dispose();
  });
});
