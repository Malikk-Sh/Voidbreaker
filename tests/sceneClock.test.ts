import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Clip } from '../src/anim/clip';
import { Time } from '../src/core/time';
import { ARENAS } from '../src/data/arenas';
import { Director, type CineTrack, type DirectorActor, type DirectorHost } from '../src/game/director';
import { InputBuffer, type Input } from '../src/input/input';
import { Abilities } from '../src/world/abilities';
import { Arena } from '../src/world/arena';
import { CameraRig } from '../src/world/camera';
import { World } from '../src/world/world';

const DT = 1 / 60;
const idle = { moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, now: 0, buffer: new InputBuffer() } as unknown as Input;

function fixture() {
  const w = new World(new Arena(ARENAS.naves), 'scene-clock');
  w.abilities = new Abilities(w);
  const h = w.hero;
  h.spawn(0, 0, 0);
  const clip = new Clip({ id: 'sceneClockProbe', dur: 1, mask: 'full', keys: [
    { t: 0, rootOffset: [4, 0, 3], spin: 1.2, pose: { chest: [0.1, 0, 0], shR: [-0.2, 0, 0] } },
    { t: 1, rootOffset: [6, 0, 7], spin: 2.4, pose: { chest: [0.6, 0, 0], shR: [-1.2, 0, 0] } },
  ], events: [{ t: 0, name: 'start' }, { t: 0.2, name: 'hitOn' }, { t: 0.5, name: 'contact' }, { t: 1, name: 'contact' }] }, h.avatar.puppet.layout);
  h.avatar.puppet.clips.set(clip.id, clip);
  const calls: { name: string; clipTime: number; x: number; pose: number[] }[] = [];
  const actor: DirectorActor = {
    get x() { return h.x; }, set x(v) { h.x = v; },
    get y() { return h.y; }, set y(v) { h.y = v; },
    get z() { return h.z; }, set z(v) { h.z = v; },
    get facing() { return h.facing; }, set facing(v) { h.facing = v; },
  };
  const host: DirectorHost = {
    actor: () => actor,
    holding: () => false, tapped: () => false, seen: () => 0, markSeen: () => {},
    clipEvents: (_who, id) => h.avatar.puppet.clips.get(id)?.events ?? [],
    clipDuration: (_who, id) => h.avatar.puppet.clips.get(id)?.dur ?? 0,
    sampleClip: (_who, id, time, reset) => h.sampleSceneClip(id, time, reset),
    releaseClip: () => h.releaseSceneClip(),
    call: (name) => calls.push({ name, clipTime: h.avatar.puppet.anim.t, x: h.x, pose: [...h.avatar.puppet.skel.world] }),
  };
  const director = new Director(host), cam = new CameraRig();
  const track: CineTrack = { id: 'clock', dur: 1.2, steps: [
    { t: 0, do: 'actor', who: 'hero', moveTo: [2, 0, 0], dur: 1, ease: 'linear' },
    { t: 0, do: 'clip', who: 'hero', clip: clip.id, markers: { contact: 'contact' } },
  ] };
  return { w, h, clip, calls, host, director, cam, track };
}

describe('Director + настоящий Animator: единое время постановки', () => {
  it('контакт и кости совпадают при обычном времени, замедлении и hitstop; боевые события не исполняются', () => {
    const poses: number[][] = [];
    for (const scale of [1, 0.2, 0.05]) {
      const { w, h, calls, director, cam, track } = fixture();
      const time = new Time();
      time.cinematic(5, scale);
      let combatEvents = 0;
      h.avatar.puppet.anim.onEvent = () => combatEvents++;
      director.play(track);
      for (let i = 0; i < 34; i++) {
        if (scale === 0.05 && i % 10 === 0) time.addHitstop(0.1);
        time.update(DT);
        w.step(DT * time.worldScale, DT * time.heroScale, idle);
        director.update(DT, cam);
      }
      expect(calls).toHaveLength(1);
      expect(calls[0].clipTime).toBeCloseTo(0.5, 8);
      expect(calls[0].x).toBeCloseTo(1, 8);
      poses.push(calls[0].pose);
      expect(combatEvents).toBe(0);
      // Ни XZ, ни spin боевого корня не искажают постановку.
      expect(h.avatar.puppet.anim.root.x).toBe(0);
      expect(h.avatar.puppet.anim.root.z).toBe(0);
      expect(h.avatar.puppet.skel.facing).toBe(h.facing);
      h.avatar.dispose();
    }
    expect(poses[1]).toEqual(poses[0]);
    expect(poses[2]).toEqual(poses[0]);
  });

  it('крупный шаг не теряет последний маркер перед повторным запуском того же клипа', () => {
    const { h, calls, director, cam, clip } = fixture();
    director.play({ id: 'rebind', dur: 2.2, steps: [
      { t: 0, do: 'clip', who: 'hero', clip: clip.id, markers: { start: 'start', contact: 'contact' } },
      { t: 1, do: 'clip', who: 'hero', clip: clip.id, markers: { start: 'start', contact: 'contact' } },
    ] });
    director.update(1.1, cam);
    expect(calls.map((c) => [c.name, c.clipTime])).toEqual([['start', 0], ['contact', 0.5], ['contact', 1], ['start', 0]]);
    expect(h.avatar.puppet.anim.t).toBeCloseTo(0.1, 8);
    director.update(0, cam);
    expect(calls).toHaveLength(4);
    director.update(0.45, cam);
    expect(calls.at(-1)?.clipTime).toBeCloseTo(0.5, 8);
    h.avatar.dispose();
  });

  it('перепривязка, пропуск и освобождение не передают сценический root в физику', () => {
    const { h, director, cam, track } = fixture();
    let handoffs = 0;
    h.avatar.puppet.anim.onRootHandoff = () => handoffs++;
    h.avatar.puppet.anim.root.x = 4;
    h.avatar.puppet.anim.root.z = 7;
    director.play(track);
    director.update(0.3, cam);
    director.skip();
    expect(handoffs).toBe(0);
    expect(h.x).toBeCloseTo(2, 8);
    expect(h.z).toBe(0);
    expect(h.avatar.puppet.anim.sceneDriven).toBe(false);
    expect(h.scripted).toBe(false);
    expect(h.state).toBe('move');
    h.avatar.dispose();
  });

  it('clear, замена и обычный конец освобождают внешнее время до callback следующей сцены', () => {
    const { h, director, cam, track } = fixture();
    director.play(track); director.update(0.2, cam); director.clear(cam);
    expect(h.avatar.puppet.anim.sceneDriven).toBe(false);
    director.play(track); director.update(0.2, cam);
    director.play({ id: 'next', dur: 0.1, steps: [] });
    expect(h.avatar.puppet.anim.sceneDriven).toBe(false);
    director.play(track, () => director.play({ id: 'callback-scene', dur: 2, steps: track.steps }));
    director.update(1.3, cam);
    expect(director.id).toBe('callback-scene');
    director.update(0.2, cam);
    expect(h.avatar.puppet.anim.sceneDriven).toBe(true);
    director.clear(cam); h.avatar.dispose();
  });

  it('маркер может заменить сцену; оставшиеся вызовы прежней сцены не исполняются', () => {
    const { h, host, calls, director, cam, track } = fixture();
    const call = host.call!;
    host.call = (fn) => { call(fn); director.play({ id: 'replacement', dur: 2, steps: [] }); };
    director.play(track);
    director.update(1.1, cam);
    expect(calls).toHaveLength(1);
    expect(director.id).toBe('replacement');
    expect(director.time).toBe(0);
    expect(h.avatar.puppet.anim.sceneDriven).toBe(false);
    h.avatar.dispose();
  });

  it('якорь и матрица клинка сохраняют настоящий размер при скрытом rig-предмете', () => {
    const { h, clip } = fixture();
    h.sampleSceneClip(clip.id, 0.65, true);
    const before = h.avatar.weaponMatrix(new THREE.Matrix4());
    const tip = h.avatar.sceneAnchor('bladeTip', new THREE.Vector3());
    h.avatar.bladeVisible = false;
    h.sampleSceneClip(clip.id, 0.65);
    const hidden = h.avatar.weaponMatrix(new THREE.Matrix4());
    expect(hidden.elements).toEqual(before.elements);
    expect(h.avatar.sceneAnchor('bladeTip', new THREE.Vector3()).distanceTo(tip)).toBe(0);
    expect(hidden.determinant()).toBeCloseTo(1, 6);
    h.releaseSceneClip(); h.avatar.dispose();
  });
});
