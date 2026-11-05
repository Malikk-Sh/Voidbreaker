import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ClipDef } from '../src/anim/clip';
import { heartAwakeningTrack, heartSoulEscapeTrack } from '../src/game/heartAwakening';
import { Director, type CineTrack, type DirectorActor, type DirectorHost } from '../src/game/director';
import { CameraRig } from '../src/world/camera';
import { HEART_SOUL, HeartSoul } from '../src/world/heartSoul';

const DT = 1 / 120;
const hiddenSoul = () => {
  const soul = new HeartSoul();
  soul.escape(3, 2);
  soul.hide();
  return soul;
};

describe('душа Сердца: ожидание прихода героя', () => {
  it('не прилетает в Сердце до побега и отдельного прибытия героя', () => {
    const soul = new HeartSoul();
    expect(soul.phase).toBe('idle');
    expect(soul.visible).toBe(false);
    expect(soul.awakened).toBe(0);
    expect(soul.arrive(-27)).toBe(false);
    soul.sampleArrival(1000);
    expect(soul.phase).toBe('idle');
    expect(soul.escape(3, 2)).toBe(true);
    expect(soul.arrive(-27)).toBe(false);
    soul.sampleEscape(HEART_SOUL.escapeDur);
    expect(soul.phase).toBe('hidden');
    const escaped = { ...soul.position };
    for (const t of [10, 60, 3600]) soul.sampleArrival(t);
    expect(soul.phase).toBe('hidden');
    expect(soul.visible).toBe(false);
    expect(soul.position).toEqual(escaped);
    expect(soul.awakened).toBe(0);
  });

  it('побег происходит один раз и поднимается над местом смерти, без полёта к боссу', () => {
    const soul = new HeartSoul();
    expect(soul.escape(3, 2)).toBe(true);
    soul.sampleEscape(0);
    expect(soul.position).toEqual({ x: 3, y: 1.2, z: 2 });
    expect(soul.visible).toBe(true);
    expect(soul.escape(30, -27)).toBe(false);
    soul.sampleEscape(1.2);
    expect(soul.position.y).toBeGreaterThan(1.2);
    expect(Math.abs(soul.position.z - 2)).toBeLessThan(5);
    soul.sampleEscape(HEART_SOUL.escapeDur);
    expect(soul.position.y).toBe(18);
    expect(Math.abs(soul.position.z - 2)).toBeLessThan(5);
    expect(soul.visible).toBe(false);
    expect(soul.escape(30, -27)).toBe(false);
  });

  it('абсолютные выборки дают тот же путь независимо от количества промежуточных кадров', () => {
    const a = new HeartSoul(), b = new HeartSoul();
    a.escape(3, 2); b.escape(3, 2);
    a.sampleEscape(0.2); a.sampleEscape(0.9); a.sampleEscape(1.5);
    b.sampleEscape(1.5);
    expect(a.position).toEqual(b.position);
    a.hide(); b.hide();
    a.arrive(-27); b.arrive(-27);
    a.sampleArrival(0.25); a.sampleArrival(0.8); a.sampleArrival(1.7);
    b.sampleArrival(1.7);
    expect(a.position).toEqual(b.position);
    expect(a.awakened).toBe(b.awakened);
  });

  for (const centerZ of [-27, -82]) {
    it(`прилёт к ${centerZ}: источник появляется сверху, поглощается и затем будит Сердце`, () => {
      const soul = hiddenSoul();
      expect(soul.arrive(centerZ)).toBe(true);
      expect(soul.arrive(centerZ)).toBe(false);
      soul.sampleArrival(0);
      expect(soul.position).toEqual({ x: 0, y: 15, z: centerZ + 9 });
      expect(soul.visible).toBe(true);
      soul.sampleArrival(HEART_SOUL.absorbAt - 0.01);
      expect(soul.visible).toBe(true);
      expect(soul.awakened).toBe(0);
      soul.sampleArrival(HEART_SOUL.absorbAt);
      expect(soul.phase).toBe('absorbed');
      expect(soul.visible).toBe(false);
      expect(soul.position).toEqual({ x: 0, y: HEART_SOUL.coreY, z: centerZ });
      expect(soul.awakened).toBe(0);
      soul.sampleArrival(3.3);
      expect(soul.awakened).toBeGreaterThan(0);
      expect(soul.awakened).toBeLessThan(1);
      soul.sampleArrival(4.2);
      expect(soul.awakened).toBe(1);
      expect(soul.escape(0, 0)).toBe(false);
    });
  }

  it('hide и absorb фиксируют конечные позы и повторяются без побочных эффектов', () => {
    const soul = new HeartSoul();
    soul.escape(3, 2);
    soul.sampleEscape(0.1);
    soul.hide();
    const escaped = { ...soul.position };
    soul.hide();
    expect(soul.position).toEqual(escaped);
    expect(soul.position.y).toBe(18);
    soul.arrive(-27);
    soul.absorb();
    const absorbed = { ...soul.position };
    soul.absorb();
    expect(soul.position).toEqual(absorbed);
    expect(soul.position).toEqual({ x: 0, y: HEART_SOUL.coreY, z: -27 });
    expect(soul.phase).toBe('absorbed');
  });
});

type Mode = 'full' | 'short' | 'skip';
function directorFixture(mode: Mode, soul: HeartSoul) {
  const hero: DirectorActor = { x: 0, y: 0, z: -17, facing: Math.PI };
  const calls: string[] = [];
  let ended = false;
  let endTime = 0;
  const clips = new Map<string, ClipDef>();
  const host: DirectorHost = {
    actor: who => who === 'hero' ? hero : null,
    defineClip: (_who, id, definition) => { clips.set(id, definition); },
    clipDuration: (_who, id) => clips.get(id)?.dur ?? 0,
    holding: () => mode === 'skip', tapped: () => false,
    seen: () => mode === 'short' ? 2 : 0, markSeen: () => {},
    call: fn => {
      calls.push(fn);
      if (fn === 'heartSoulHide') soul.hide();
      if (fn === 'heartSoulAbsorb') soul.absorb();
      if (fn === 'heartAwake') soul.sampleArrival(HEART_SOUL.awakeAt);
    },
  };
  const director = new Director(host), rig = new CameraRig();
  return {
    director, rig, hero, calls,
    play: (track: CineTrack) => { ended = false; director.play(track, () => { ended = true; endTime = director.time; }); },
    ended: () => ended,
    endTime: () => endTime,
  };
}

describe('Director: побег души и пробуждение Сердца', () => {
  it('логические маркеры заданы в точные моменты и нет ожидания касания или обучения', () => {
    const escape = heartSoulEscapeTrack([0, 0, 5], [3, 1.2, 2]);
    const awake = heartAwakeningTrack([0, 0, -17], -27);
    expect(escape.dur).toBeCloseTo(2.4);
    expect(awake.dur).toBeCloseTo(5.6);
    expect(escape.steps.find(s => s.do === 'call' && s.fn === 'heartSoulHide')?.t).toBe(1.9);
    expect(awake.steps.find(s => s.do === 'call' && s.fn === 'heartSoulAbsorb')?.t).toBe(2.3);
    expect(awake.steps.find(s => s.do === 'call' && s.fn === 'heartAwake')?.t).toBe(4.4);
    for (const track of [escape, awake]) {
      expect(track.short).toBeDefined();
      for (const steps of [track.steps, track.short!]) {
        expect(steps.some(s => s.do === 'wait' || s.do === 'tap')).toBe(false);
      }
      const fullCalls = track.steps.filter(s => s.do === 'call').map(s => ({ t: s.t, fn: s.fn }));
      const shortCalls = track.short!.filter(s => s.do === 'call').map(s => ({ t: s.t, fn: s.fn }));
      expect(shortCalls).toEqual(fullCalls);
    }
  });

  for (const mode of ['full', 'short', 'skip'] as const) {
    it(`${mode}: побег заканчивается скрытой душой, прилёт — поглощением и пробуждением`, () => {
      const soul = new HeartSoul();
      soul.escape(3, 2);
      const f = directorFixture(mode, soul);
      f.play(heartSoulEscapeTrack([0, 0, 5], [3, 1.2, 2]));
      for (let t = 0; t < 3.5; t += DT) {
        f.director.update(DT, f.rig);
        if (f.director.active) soul.sampleEscape(f.director.time);
      }
      expect(f.ended()).toBe(true);
      expect(soul.phase).toBe('hidden');
      expect(soul.position.y).toBe(18);
      expect(f.calls).toEqual(['heartSoulHide']);
      if (mode !== 'skip') expect(f.endTime()).toBeCloseTo(mode === 'short' ? 2.2 : 2.4, 1);
      expect(soul.arrive(-27)).toBe(true);
      f.calls.length = 0;
      f.play(heartAwakeningTrack([0, 0, -17], -27));
      for (let t = 0; t < 7; t += DT) {
        f.director.update(DT, f.rig);
        if (f.director.active) soul.sampleArrival(f.director.time);
      }
      expect(f.ended()).toBe(true);
      expect(f.calls).toEqual(['heartSoulAbsorb', 'heartAwake']);
      if (mode !== 'skip') expect(f.endTime()).toBeCloseTo(mode === 'short' ? 4.9 : 5.6, 1);
      expect(soul.phase).toBe('absorbed');
      expect(soul.position).toEqual({ x: 0, y: HEART_SOUL.coreY, z: -27 });
      expect(soul.awakened).toBe(1);
      expect(f.hero).toMatchObject({ x: 0, y: 0, z: -17 });
      expect(f.rig.cine).toBe(null);
    });
  }
});

function cameraAt(track: CineTrack, t: number, mode: Mode = 'full') {
  const soul = hiddenSoul(), f = directorFixture(mode, soul);
  f.play(track);
  for (let elapsed = 0; elapsed < t; elapsed += DT) f.director.update(Math.min(DT, t - elapsed), f.rig);
  return f.director.cameraSample!;
}

describe('кадры Сердца на мобильном экране', () => {
  it('камера пробуждения остаётся внутри новых ворот в полной и короткой версиях', () => {
    for (const centerZ of [-27, -82]) for (const heroX of [-5, 0, 5]) {
      const track = heartAwakeningTrack([heroX, 0, centerZ + 10], centerZ);
      for (const steps of [track.steps, track.short!]) for (const step of steps) {
        if (step.do !== 'cam') continue;
        for (const point of step.path) expect(point[2], `centerZ=${centerZ}, heroX=${heroX}, t=${step.t}`).toBeLessThanOrEqual(centerZ + 14);
      }
    }
  });

  for (const [width, height] of [[844, 390], [740, 360]]) {
    it(`${width}×${height}: побег следует за душой над местом смерти`, () => {
      const source: [number, number, number] = [3, 1.2, 2];
      const track = heartSoulEscapeTrack([0, 0, 5], source);
      const soul = new HeartSoul();
      soul.escape(source[0], source[2]);
      for (const t of [0.05, 0.6, 1.3, 1.7]) {
        soul.sampleEscape(t);
        const c = cameraAt(track, t);
        const camera = new THREE.PerspectiveCamera(c.fov ?? 45, width / height, 0.05, 200);
        camera.position.copy(c.pos);
        camera.lookAt(c.look);
        camera.updateMatrixWorld();
        const q = new THREE.Vector3(soul.position.x, soul.position.y, soul.position.z).project(camera);
        expect(Math.abs(q.x)).toBeLessThan(0.95);
        expect(Math.abs(q.y)).toBeLessThan(0.9);
        expect(q.z).toBeLessThan(1);
        expect(q.z).toBeGreaterThan(-1);
        expect(Math.abs(c.pos.z - source[2])).toBeLessThan(16);
      }
    });
    for (const centerZ of [-27, -82]) {
      for (const heroX of [-5, 0, 5]) {
        it(`${width}×${height}, центр ${centerZ}, герой x=${heroX}: общие планы сохраняют ноги, голову и ядро внутри letterbox`, () => {
          const hero: [number, number, number] = [heroX, 0, centerZ + 10];
          const track = heartAwakeningTrack(hero, centerZ);
          for (const [mode, t] of [['full', 0.05], ['full', 4.6], ['full', 5], ['short', 4.55]] as const) {
            const c = cameraAt(track, t, mode);
            expect(c).not.toBeNull();
            const camera = new THREE.PerspectiveCamera(c.fov ?? 45, width / height, 0.05, 200);
            camera.position.copy(c.pos);
            camera.lookAt(c.look);
            camera.updateMatrixWorld();
            const anchors = [
              new THREE.Vector3(heroX, 0.2, hero[2]),
              new THREE.Vector3(heroX, 1.9, hero[2]),
              new THREE.Vector3(0, HEART_SOUL.coreY, centerZ),
              new THREE.Vector3(0, HEART_SOUL.coreY + 1.6, centerZ),
            ];
            for (const [i, anchor] of anchors.entries()) {
              const q = anchor.project(camera), at = `${mode} t=${t}, anchor=${i}`;
              expect(Math.abs(q.x), at).toBeLessThan(0.95);
              expect(Math.abs(q.y), at).toBeLessThan(0.75);
              expect(q.z, at).toBeGreaterThan(-1);
              expect(q.z, at).toBeLessThan(1);
            }
          }
        });
      }

      it(`${width}×${height}, центр ${centerZ}: нисходящая душа и вход в ядро остаются в кадре`, () => {
        const track = heartAwakeningTrack([0, 0, centerZ + 10], centerZ);
        const soul = hiddenSoul();
        soul.arrive(centerZ);
        for (const t of [0.85, 1.3, 1.8, 2.2]) {
          soul.sampleArrival(t);
          const c = cameraAt(track, t);
          const camera = new THREE.PerspectiveCamera(c.fov ?? 45, width / height, 0.05, 200);
          camera.position.copy(c.pos);
          camera.lookAt(c.look);
          camera.updateMatrixWorld();
          const anchors = [new THREE.Vector3(soul.position.x, soul.position.y, soul.position.z)];
          if (t >= 1.8) anchors.push(new THREE.Vector3(0, HEART_SOUL.coreY, centerZ));
          for (const anchor of anchors) {
            const q = anchor.project(camera);
            expect(Math.abs(q.x), `t=${t}`).toBeLessThan(0.95);
            expect(Math.abs(q.y), `t=${t}`).toBeLessThan(0.9);
            expect(q.z, `t=${t}`).toBeGreaterThan(-1);
            expect(q.z, `t=${t}`).toBeLessThan(1);
          }
        }
      });
      it(`${width}×${height}, центр ${centerZ}: начальный и финальный планы содержат героя и ядро`, () => {
        const hero: [number, number, number] = [0, 0, centerZ + 10];
        const track = heartAwakeningTrack(hero, centerZ);
        for (const t of [0.05, 5]) {
          const c = cameraAt(track, t);
          expect(c).not.toBeNull();
          const camera = new THREE.PerspectiveCamera(c.fov ?? 45, width / height, 0.05, 200);
          camera.position.copy(c.pos);
          camera.lookAt(c.look);
          camera.updateMatrixWorld();
          for (const p of [new THREE.Vector3(0, 0.2, hero[2]), new THREE.Vector3(0, 1.9, hero[2]), new THREE.Vector3(0, HEART_SOUL.coreY, centerZ)]) {
            const q = p.project(camera);
            expect(Math.abs(q.x)).toBeLessThan(0.95);
            expect(Math.abs(q.y)).toBeLessThan(0.9);
            expect(q.z).toBeGreaterThan(-1);
            expect(q.z).toBeLessThan(1);
          }
        }
      });
    }
  }
});
