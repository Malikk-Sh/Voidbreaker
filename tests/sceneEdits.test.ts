import { afterEach, describe, expect, it, vi } from 'vitest';
import { Director, type CineTrack, type DirectorActor, type DirectorHost } from '../src/game/director';
import { emptyProject, offsetWorld, parseProject, readProject, resolveScene, stepKeys, STUDIO_KEY, type SceneProject } from '../src/game/sceneEdits';
import { CameraRig } from '../src/world/camera';
import { Clip, type ClipDef } from '../src/anim/clip';
import { RigLayout } from '../src/anim/skeleton';
import { Cinematics, type CineHost } from '../src/game/cinematics';
import { SCENES } from '../src/editor/catalog';

afterEach(() => vi.unstubAllGlobals());
const source: CineTrack = {
  id: 'scene', origin: [8, 0, -3], heading: Math.PI / 2, dur: 4,
  steps: [
    { t: 0, do: 'actor', who: 'hero', moveTo: [12, 2, -3], dur: 2, ease: 'linear' },
    { t: 0, do: 'cam', path: [[0, 5, 5], [1, 5, 5]], look: [[8, 1, -3]], dur: 3 },
    { t: 3, do: 'call', fn: 'end' },
  ],
  short: [{ t: 0, do: 'actor', who: 'hero', moveTo: [12, 2, -3], dur: 0.5 }],
};
function project(edit: object, variant = 'full'): SceneProject {
  return parseProject(JSON.stringify({ version: 1, enabled: true, scenes: { scene: { [variant]: { steps: {}, ...edit } } } }));
}
function storage(p: SceneProject): void {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === STUDIO_KEY ? JSON.stringify(p) : null });
}
function host() {
  const hero: DirectorActor = { x: 8, y: 0, z: -3, facing: 0 }, boss: DirectorActor = { x: 0, y: 0, z: 0, facing: 0 };
  const log: string[] = [];
  const h: DirectorHost = { actor: (who) => who === 'hero' ? hero : who === 'boss' ? boss : null, holding: () => false, tapped: () => false, seen: () => 0, markSeen: () => {}, call: (fn) => log.push(fn) };
  return { h, hero, boss, log };
}

describe('проект студии: импорт и перенос на сцену', () => {
  it('ключи шагов стабильны при вставке сюжетных событий', () => {
    expect(stepKeys(source.steps)).toEqual(['actor:hero:0', 'cam:0', 'call:0']);
    expect(stepKeys([{ t: 0, do: 'sfx', id: 'x' }, ...source.steps]).slice(1)).toEqual(stepKeys(source.steps));
  });
  it('переносит смещения по осям живой сцены и не меняет исходник', () => {
    const before = JSON.stringify(source), p = project({ steps: { 'actor:hero:0': { moveOffset: [1, 2, 3], bends: [[1, 0.5, 0]] }, 'cam:0': { lookOffsets: [[1, 0, 0]], fov: 52 } } });
    const out = resolveScene(source, p, 'full'), actor = out.steps[0];
    expect(actor.do).toBe('actor');
    if (actor.do === 'actor') { expect(actor.moveTo).toEqual([15, 4, -4]); expect(actor.bends![0][2]).toBeCloseTo(-1); }
    const cam = out.steps[1]; if (cam.do === 'cam') { expect(cam.look[0][2]).toBeCloseTo(-4); expect(cam.fov).toBe(52); }
    expect(JSON.stringify(source)).toBe(before);
    expect(offsetWorld([0, 0, 2], Math.PI)).toEqual([expect.closeTo(0), 0, -2]);
  });
  it('полная и короткая версии редактируются отдельно', () => {
    const p = project({ steps: { 'actor:hero:0': { dur: 6 } } });
    expect((resolveScene(source, p, 'short').short![0] as { dur: number }).dur).toBe(0.5);
  });
  it('темп переносит и маркеры, и клипы, и повороты вместе', () => {
    const s: CineTrack = { id: 'scene', dur: 6, steps: [
      { t: 1, do: 'actor', who: 'hero', moveTo: [0, 0, 0], dur: 2, turn: 1 },
      { t: 1, do: 'clip', who: 'hero', clip: 'x', speed: 0.5, dur: 3 },
      { t: 5, do: 'call', fn: 'end' },
    ] };
    const out = resolveScene(s, project({ rate: 0.5 }), 'full');
    expect(out.steps[0]).toMatchObject({ t: 2, dur: 4, turn: 2 });
    expect(out.steps[1]).toMatchObject({ t: 2, dur: 6, speed: 0.25 });
    expect(out.steps[2].t).toBe(10); expect(out.dur).toBe(12);
  });
  it('новое движение переводится из локальных координат в мировые', () => {
    const p = project({ added: [{ t: 2, do: 'actor', who: 'boss', moveTo: [1, 2, 3], dur: 1 }] });
    expect(resolveScene(source, p, 'full').steps.at(-1)).toMatchObject({ do: 'actor', moveTo: [11, 2, -4] });
  });
  it.each([
    { rate: 0 }, { rate: 10 }, { steps: { 'actor:hero:0': { moveOffset: [0, null, 0] } } },
    { steps: { 'cam:0': { ease: 'constructor' } } },
    { steps: { 'clip:hero:0': { definition: { id: 'bad', dur: 1, keys: [{ t: 1, pose: {} }, { t: 0, pose: {} }] } } } },
    { added: [{ t: 0, do: 'call', fn: 'reward' }] },
    { placements: JSON.parse('{"__proto__":{"offset":[1,2,3],"yaw":0}}') },
  ])('отклоняет некорректный импорт: %j', (edit) => { expect(() => project(edit)).toThrow(); });
  it('добавленный клип не может навязать сюжетные callbacks', () => {
    const p = project({ added: [{ t: 0, do: 'clip', who: 'hero', clip: 'own', markers: { contact: 'reward' }, definition: { id: 'own', dur: 1, keys: [{ t: 0, pose: {} }] } }] });
    expect(p.scenes.scene.full!.added![0]).not.toHaveProperty('markers');
  });
  it('отключённый проект хранится, но не применяется игровым Director', () => {
    const p = project({ steps: { 'actor:hero:0': { moveOffset: [0, 0, 50] } } }); p.enabled = false; storage(p);
    const { h, hero } = host(), d = new Director(h); d.play(source); d.update(2, new CameraRig()); expect(hero.x).toBe(12);
    expect(readProject().scenes.scene).toBeDefined();
  });
});

describe('студия и Director используют одну траекторию и маркеры', () => {
  it('новое движение перехватывает корень до конца прежнего движения', () => {
    storage(emptyProject());
    const { h, hero } = host(), d = new Director(h), cam = new CameraRig();
    d.play({ id: 'overlap', dur: 12, steps: [
      { t: 0, do: 'actor', who: 'hero', moveTo: [18, 0, -3], dur: 10, ease: 'linear' },
      { t: 1, do: 'actor', who: 'hero', moveTo: [99, 0, -3], dur: 1, ease: 'linear' },
    ] });
    d.update(0, cam); d.update(1, cam); d.update(1, cam); expect(hero.x).toBe(99);
    d.update(1, cam); expect(hero.x).toBe(99);
  });
  it('камера не выходит за сплайн с кривой скорости, имеющей выброс', () => {
    storage(emptyProject());
    const { h } = host(), d = new Director(h), cam = new CameraRig();
    d.play({ id: 'overshoot', dur: 2, steps: [{ t: 0, do: 'cam', path: [[0, 1, 2], [3, 4, 5]], look: [[0, 0, 0]], dur: 1, ease: 'outBack' }] });
    d.update(0.7, cam); expect(cam.cine!.pos.toArray().every(Number.isFinite)).toBe(true);
    expect(cam.cine!.pos.x).toBeLessThanOrEqual(3);
  });
  it('кривой путь проходит контрольную точку; пропуск даёт ту же конечную позицию', () => {
    storage(emptyProject());
    const s: CineTrack = { id: 'arc', dur: 3, steps: [{ t: 0, do: 'actor', who: 'hero', moveTo: [12, 0, -3], bends: [[0, 2, 0]], dur: 2, ease: 'linear' }] };
    const a = host(), b = host(), d = new Director(a.h), skip = new Director(b.h), cam = new CameraRig();
    d.play(s); d.update(0, cam); d.update(1, cam); expect(a.hero.y).toBeCloseTo(2); expect(a.hero.x).toBeCloseTo(10);
    d.update(1, cam); skip.play(s); skip.skip(); expect(a.hero).toEqual(b.hero); expect(a.hero.y).toBe(0);
  });
  it('редакторный клип сохраняет точный callback контакта при другом темпе', () => {
    const definition: ClipDef = { id: 'strike', dur: 2, keys: [{ t: 0, pose: {} }, { t: 1, pose: { root: [1, 0, 0] } }], events: [{ t: 1, name: 'contact' }] };
    const p = project({ rate: 0.5, steps: { 'clip:hero:0': { definition } } }); storage(p);
    const s: CineTrack = { id: 'scene', dur: 4, steps: [
      { t: 0, do: 'actor', who: 'hero', moveTo: [12, 0, -3], dur: 2, ease: 'linear' },
      { t: 0, do: 'clip', who: 'hero', clip: 'original', markers: { contact: 'strike' } },
    ] };
    const { h, hero } = host(), clips = new Map<string, Clip>();
    const layout = new RigLayout({ id: 'test', joints: [{ name: 'root', pos: [0, 0, 0] }] });
    let clipTime = -1, x = -1;
    h.defineClip = (_who, id, def) => clips.set(id, new Clip({ ...def, id }, layout));
    h.clipEvents = (_who, id) => clips.get(id)?.events ?? [];
    h.clipDuration = (_who, id) => clips.get(id)?.dur ?? 0;
    h.sampleClip = (_who, _id, time) => { clipTime = time; };
    h.call = () => { x = hero.x; expect(clipTime).toBeCloseTo(1); };
    const d = new Director(h), cam = new CameraRig(); d.play(s); d.update(0, cam); d.update(2.1, cam);
    expect(x).toBeCloseTo(10); expect(clips.size).toBe(1);
  });
  it('разворот и расстановка применяются до захвата начала движения', () => {
    const p = project({ placements: { hero: { offset: [0, 0, 2], yaw: 0.4 } } }); storage(p);
    const { h, hero } = host(), d = new Director(h); d.play(source); d.update(0, new CameraRig());
    expect(hero.x).toBeCloseTo(10); expect(hero.facing).toBeCloseTo(0.4);
  });
  it('вся библиотека имеет уникальные id, концовку, обе версии и вставки арен', () => {
    expect(SCENES).toHaveLength(24); expect(new Set(SCENES.map((s) => s.id)).size).toBe(24);
    for (const spec of SCENES) { expect(spec.track.id).toBe(spec.id); expect(spec.track.dur).toBeGreaterThan(0); }
    expect(SCENES.find((s) => s.id === 'hierophantEnd')!.track.short).toBeDefined();
    expect(SCENES.some((s) => s.id === 'arenaIntro:1-9')).toBe(true);
  });
  it('короткая вставка меняет камеру и темп, сохраняя однократные события', () => {
    const hero = { x: 0, y: 0, z: 0, facing: 0, locked: false }, banners: string[] = [];
    const h = { world: { hero }, letterbox: () => {}, slow: () => {}, banner: (text: string) => banners.push(text), say: () => {}, flash: () => {}, musicPhase: () => {}, stinger: () => {}, skipRequested: () => false, once: () => false } as unknown as CineHost;
    const base = new Cinematics(h); base.studio = true; base.victory(); const cam = new CameraRig(); base.update(0.5, cam); const before = cam.cine!.pos.y;
    storage({ version: 1, enabled: true, scenes: { arenaVictory: { full: { rate: 0.5, steps: { 'cam:0': { pathOffsets: Array.from({ length: 25 }, () => [0, 2, 0] as [number, number, number]) } } } } } });
    const edited = new Cinematics(h); edited.victory(); const after = new CameraRig(); edited.update(1, after);
    expect(after.cine!.pos.y).toBeCloseTo(before + 2);
    edited.update(0.3, after); edited.update(0.3, after); expect(banners).toEqual(['ЭТАП ПРОЙДЕН']);
  });
});
