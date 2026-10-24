import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Clip } from '../src/anim/clip';
import { Time } from '../src/core/time';
import { Director, type DirectorActor } from '../src/game/director';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { GateGuardian, BellRinger } from '../src/world/boss/guardians';
import { guardianTargets } from '../src/world/boss/guardianStaging';
import { killGateTrack, killBellTrack, GATE_KILL_T, BELL_KILL_T } from '../src/world/boss/guardianScenes';
import { CameraRig } from '../src/world/camera';
import { emptyProject, resolveScene } from '../src/game/sceneEdits';
import { executionTrack } from '../src/world/boss/hierophantScenes';
import { Cinematics } from '../src/game/cinematics';

afterEach(() => vi.unstubAllGlobals());
describe('читаемая постановка добиваний', () => {
  it('победа над Стражем без казни тоже не ставит второй облёт в очередь', () => {
    const w = new World(new Arena(ARENAS.gate), 'outro'), cam = new CameraRig(), banners: string[] = [];
    const e = new GateGuardian({ zone: 0, stage: 2 });
    const c = new Cinematics({ world: w, letterbox: () => {}, slow: () => {}, banner: text => banners.push(text), say: () => {}, flash: () => {}, musicPhase: () => {}, stinger: () => {}, skipRequested: () => false, once: () => false });
    c.guardianDown(e); c.victory();
    for (let i = 0; i < 180; i++) c.update(1 / 60, cam);
    expect(c.busy).toBe('down');
    for (let i = 0; i < 180; i++) c.update(1 / 60, cam);
    expect(c.busy).toBeNull(); expect(w.hero.locked).toBe(false);
    expect(banners).toEqual(['СТРАЖ ПОВЕРЖЕН']);
    c.victory(); expect(c.busy).toBe('victory'); c.clear(cam);
    w.hero.avatar.dispose();
  });
  it('slow motion плавно входит и выходит, не меняя обычное боевое замедление', () => {
    const t = new Time(); t.cinematicSmooth(1, 0.15, 0.2, 0.25);
    const scales: number[] = [1];
    for (let i = 0; i < 65; i++) { t.update(1 / 60); scales.push(t.worldScale); }
    expect(scales[1]).toBeGreaterThan(0.97);
    expect(Math.min(...scales)).toBe(0.15); expect(scales.at(-1)).toBe(1);
    expect(Math.max(...scales.slice(1).map((v, i) => Math.abs(v - scales[i])))).toBeLessThan(0.12);
    t.slow(0.3, 1); t.update(1 / 60); expect(t.worldScale).toBe(0.3);
  });

  it('старые настройки цепи не подменяют новую готовую казнь', () => {
    const track = executionTrack({ bx: 0, bz: 0, hx: 0, hz: 6, bellY: 3, lx: 0, lz: -3, star: [0.4, -0.5, -0.7] });
    const p = emptyProject(); p.enabled = true; p.scenes.hierophantEnd = { full: { steps: { 'actor:hero:1': { moveOffset: [80, 80, 80] } } } };
    expect(resolveScene(track, p, 'full')).toEqual(track);
  });

  for (const bell of [false, true]) it(`${bell ? 'Звонарь' : 'Страж Врат'}: клинок касается настоящих якорей, результат остаётся до распада`, () => {
    const w = new World(new Arena(ARENAS[bell ? 'belfry' : 'gate']), 'staging'); w.abilities = new Abilities(w);
    w.hero.spawn(0, 5, Math.PI);
    const e = bell ? new BellRinger({ zone: 0, stage: 4 }) : new GateGuardian({ zone: 0, stage: 2 });
    e.x = 0; e.z = 0; e.facing = 0; w.addEnemy(e); e.setState('idle'); e.killcam = true;
    e.setKillcamStage(bell ? 'kneel' : 'stagger');
    const size = bell ? 1.45 : 1.65, targets = guardianTargets(e.puppet.layout, 0, 0, 0, size);
    const track = (bell ? killBellTrack : killGateTrack)({ gx: 0, gz: 0, hx: 0, hz: 5, facing: 0, ...targets });
    const hero: DirectorActor = { get x() { return w.hero.x; }, set x(v) { w.hero.x = v; }, get y() { return w.hero.y; }, set y(v) { w.hero.y = v; }, get z() { return w.hero.z; }, set z(v) { w.hero.z = v; }, get facing() { return w.hero.facing; }, set facing(v) { w.hero.facing = v; } };
    const contacts: { name: string; error: number; at: number }[] = []; let deaths = 0;
    const cam = new CameraRig(), d = new Director({
      actor: (who) => who === 'hero' ? hero : e,
      defineClip: (who, id, def) => { const p = who === 'hero' ? w.hero.avatar.puppet : e.puppet; p.clips.set(id, new Clip({ ...def, id }, p.layout)); },
      clipEvents: (_who, id) => w.hero.avatar.puppet.clips.get(id)?.events ?? [],
      clipDuration: (_who, id) => w.hero.avatar.puppet.clips.get(id)?.dur ?? 0,
      sampleClip: (who, id, t, reset, blend) => { if (who === 'hero') w.hero.sampleSceneClip(id, t, reset, blend); else { const p = e.puppet; p.anim.sampleScene(p.clips.get(id)!, t, reset, blend); p.anim.compose(p.base); p.skel.rot.set(p.anim.out); p.skel.update(); } },
      releaseClip: (who) => { if (who === 'hero') w.hero.releaseSceneClip(); else e.puppet.anim.releaseScene(); },
      call: (name) => {
        if (name === 'crumble') { deaths++; return; }
        if (!['knee', 'helmet', 'bell'].includes(name)) return;
        const pos = name === 'knee' ? e.puppet.skel.jointPoint(e.puppet.layout.idx('kneeL'), 0, 0.25 * size, 0.08 * size, new THREE.Vector3())
          : name === 'helmet' ? e.puppet.skel.jointPoint(e.puppet.layout.idx('head'), 0, 0.18 * size, 0.18 * size, new THREE.Vector3())
          : e.puppet.skel.jointPoint(e.puppet.layout.idx('chest'), 0, size, -1.2 * size, new THREE.Vector3());
        const tip = w.hero.avatar.sceneAnchor('bladeTip', new THREE.Vector3());
        contacts.push({ name, error: pos.distanceTo(tip), at: d.time });
        e.setKillcamStage(name === 'knee' ? 'kneel' : 'hit');
      }, holding: () => false, tapped: () => false, seen: () => 0, markSeen: () => {},
    });
    d.play(track);
    for (let i = 0; i < Math.ceil((track.dur! + 1) * 60); i++) { e.step(w, 1 / 60); d.update(1 / 60, cam); }
    expect(contacts.map((c) => c.name)).toEqual(bell ? ['bell'] : ['knee', 'helmet']);
    for (const c of contacts) expect(c.error, `${c.name}: ${c.error.toFixed(4)} м`).toBeLessThan(0.01);
    const T = bell ? BELL_KILL_T : GATE_KILL_T;
    expect(T.crumble - contacts.at(-1)!.at).toBeGreaterThan(1.2);
    expect(deaths).toBe(1); expect(w.hero.y).toBe(0); expect(d.active).toBe(false);
    w.hero.avatar.dispose();
  });
});
