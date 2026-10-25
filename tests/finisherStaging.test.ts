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
import { BELL_CONTACT } from '../src/gen/chars/enemies';
import { Skeleton } from '../src/anim/skeleton';

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
    const contacts: { name: string; error: number; at: number }[] = [], rings: number[] = [];
    let crumblePose: Float32Array | undefined, crumbleWorld: Float32Array | undefined, ringAnchor: THREE.Vector3 | undefined;
    let deaths = 0, minimumSupport = Infinity, maximumSupport = -Infinity, lowestHeroFoot = Infinity, minimumAt = 0;
    let framedSamples = 0, widestX = 0, tallestY = 0, nearestZ = Infinity, furthestZ = -Infinity, leastFront = Infinity;
    let chestAtContact: THREE.Quaternion | undefined;
    const bellResponse: { t: number; angle: number; chest: number }[] = [];
    const camera = new THREE.PerspectiveCamera(44, 640 / 360, 0.05, 200);
    const T = bell ? BELL_KILL_T : GATE_KILL_T;
    const cam = new CameraRig(), d = new Director({
      actor: (who) => who === 'hero' ? hero : e,
      defineClip: (who, id, def) => { const p = who === 'hero' ? w.hero.avatar.puppet : e.puppet; p.clips.set(id, new Clip({ ...def, id }, p.layout)); },
      clipEvents: (who, id) => (who === 'hero' ? w.hero.avatar.puppet : e.puppet).clips.get(id)?.events ?? [],
      clipDuration: (who, id) => (who === 'hero' ? w.hero.avatar.puppet : e.puppet).clips.get(id)?.dur ?? 0,
      sampleClip: (who, id, t, reset, blend) => { if (who === 'hero') w.hero.sampleSceneClip(id, t, reset, blend); else { const p = e.puppet; if (reset && !p.anim.sceneDriven) { p.anim.out.set(p.skel.rot); p.base.set(p.skel.rot); } p.anim.sampleScene(p.clips.get(id)!, t, reset, blend); p.anim.compose(p.base); p.skel.rot.set(p.anim.out); p.skel.off[p.layout.idx('root') * 3 + 1] = p.anim.root.y; p.skel.update(); } },
      releaseClip: (who) => { if (who === 'hero') w.hero.releaseSceneClip(); else { e.puppet.anim.releaseScene(); e.puppet.skel.off[e.puppet.layout.idx('root') * 3 + 1] = 0; } },
      call: (name) => {
        if (name === 'crumble') {
          deaths++; crumblePose = Float32Array.from(e.puppet.skel.rot);
          e.killcamDone = true; e.killcam = false; w.killEnemy(e, 0, -1, 4.5);
          crumbleWorld = Float32Array.from(e.puppet.skel.world); return;
        }
        if (name === 'bellRing') { rings.push(d.time); ringAnchor = e.puppet.skel.jointPoint(e.puppet.layout.idx('bell'), BELL_CONTACT[0] * size, BELL_CONTACT[1] * size, BELL_CONTACT[2] * size, new THREE.Vector3()); return; }
        if (!['knee', 'helmet', 'bell'].includes(name)) return;
        const pos = name === 'knee' ? e.puppet.skel.jointPoint(e.puppet.layout.idx('kneeL'), 0, 0.25 * size, 0.08 * size, new THREE.Vector3())
          : name === 'helmet' ? e.puppet.skel.jointPoint(e.puppet.layout.idx('head'), 0, 0.18 * size, 0.18 * size, new THREE.Vector3())
          : e.puppet.skel.jointPoint(e.puppet.layout.idx('bell'), BELL_CONTACT[0] * size, BELL_CONTACT[1] * size, BELL_CONTACT[2] * size, new THREE.Vector3());
        const blade = w.hero.avatar.sceneAnchor(name === 'knee' ? 'bladeTip' : 'edgeContact', new THREE.Vector3());
        contacts.push({ name, error: pos.distanceTo(blade), at: d.time });
        if (name === 'bell') chestAtContact = new THREE.Quaternion().fromArray(e.puppet.skel.rot, e.puppet.layout.idx('chest') * 4);
        e.setKillcamStage(name === 'knee' ? 'kneel' : 'hit');
      }, holding: () => false, tapped: () => false, seen: () => 0, markSeen: () => {},
    });
    d.play(track);
    for (let i = 0; i < Math.ceil((track.dur! + 1) * 120); i++) {
      e.step(w, 1 / 120); d.update(1 / 120, cam);
      if (d.active && d.time > 0.22 && d.time < T.crumble) {
        const feet = ['footL', 'footR'].map(name => e.puppet.skel.jointPos(e.puppet.layout.idx(name), new THREE.Vector3()).y), support = Math.min(...feet);
        if (support < minimumSupport) { minimumSupport = support; minimumAt = d.time; } maximumSupport = Math.max(maximumSupport, support);
      }
      if (d.active && d.time > T.land + 0.15 && d.time < T.end) {
        const y = Math.min(...(['footL', 'footR'] as const).map(name => w.hero.avatar.sceneAnchor(name, new THREE.Vector3()).y));
        lowestHeroFoot = Math.min(lowestHeroFoot, y);
      }
      if (bell && chestAtContact && d.time <= T.contact + 0.3) {
        const q = new THREE.Quaternion().fromArray(e.puppet.skel.rot, e.puppet.layout.idx('bell') * 4);
        const chest = new THREE.Quaternion().fromArray(e.puppet.skel.rot, e.puppet.layout.idx('chest') * 4).angleTo(chestAtContact);
        bellResponse.push({ t: d.time - T.contact, angle: new THREE.Euler().setFromQuaternion(q).x, chest });
      }
      if (d.time >= T.strike && d.time <= T.contact + 0.18) {
        const c = d.cameraSample!;
        camera.fov = c.fov ?? 44; camera.updateProjectionMatrix(); camera.position.copy(c.pos); camera.lookAt(c.look); camera.updateMatrixWorld();
        const bossTarget = bell
          ? e.puppet.skel.jointPoint(e.puppet.layout.idx('bell'), BELL_CONTACT[0] * size, BELL_CONTACT[1] * size, BELL_CONTACT[2] * size, new THREE.Vector3())
          : e.puppet.skel.jointPoint(e.puppet.layout.idx('head'), 0, 0.18 * size, 0.18 * size, new THREE.Vector3());
        const points = [bossTarget, ...(['head', 'handL', 'handR', 'bladeTip', 'edgeContact'] as const).map(name => w.hero.avatar.sceneAnchor(name, new THREE.Vector3()))];
        for (const p of points) {
          const q = p.project(camera); widestX = Math.max(widestX, Math.abs(q.x)); tallestY = Math.max(tallestY, Math.abs(q.y)); nearestZ = Math.min(nearestZ, q.z); furthestZ = Math.max(furthestZ, q.z);
        }
        leastFront = Math.min(leastFront, (c.pos.x - w.hero.x) * Math.sin(w.hero.facing) + (c.pos.z - w.hero.z) * Math.cos(w.hero.facing));
        framedSamples++;
      }
    }
    expect(contacts.map((c) => c.name)).toEqual(bell ? ['bell'] : ['knee', 'helmet']);
    for (const c of contacts) expect(c.error, `${c.name}: ${c.error.toFixed(4)} м`).toBeLessThan(0.01);
    expect(minimumSupport, `опорная ступня босса остаётся над полом (${minimumAt.toFixed(3)} с)`).toBeGreaterThan(0);
    expect(maximumSupport, 'босс не зависает над полом при сгибании ног').toBeLessThan(0.12);
    expect(lowestHeroFoot, 'после посадки ступни героя не проходят сквозь пол').toBeGreaterThan(0.02);
    expect(rings).toEqual(bell ? [T.contact + 0.09] : []);
    // Распад снимает именно позу реакции в момент маркера, после того как World.animate сбросил риг в начале кадра.
    const reaction = track.steps.find(s => s.do === 'clip' && s.who !== 'hero')!;
    if (reaction.do !== 'clip' || !reaction.definition) throw new Error('нет реакции босса');
    const expected = new Skeleton(e.puppet.layout), root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 }, clip = new Clip(reaction.definition, e.puppet.layout);
    clip.sample(T.crumble, expected.rot, root); expected.y = -0.7; expected.off[expected.layout.idx('root') * 3 + 1] = root.y; expected.update();
    expect(crumblePose).toBeDefined();
    for (const joint of ['chest', 'head', 'pelvis', ...(bell ? ['bell'] : [])]) {
      const offset = e.puppet.layout.idx(joint) * 4;
      expect(new THREE.Quaternion().fromArray(crumblePose!, offset).angleTo(new THREE.Quaternion().fromArray(expected.rot, offset)), `${joint}: осколки наследуют согнутый корпус`).toBeLessThan(0.001);
      const actual = new THREE.Matrix4().fromArray(crumbleWorld!, offset * 4), goal = new THREE.Matrix4().fromArray(expected.world, offset * 4);
      const position = new THREE.Vector3(), target = new THREE.Vector3(), rotation = new THREE.Quaternion(), targetRotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      actual.decompose(position, rotation, scale); goal.decompose(target, targetRotation, scale);
      expect(position.distanceTo(target), `${joint}: распад начинается из положения реакции`).toBeLessThan(0.001);
      expect(rotation.angleTo(targetRotation), `${joint}: ориентация обломков сохраняет реакцию`).toBeLessThan(0.001);
    }
    if (bell) {
      clip.sample(T.contact + 0.09, expected.rot, root); expected.y = -0.7; expected.off[expected.layout.idx('root') * 3 + 1] = root.y; expected.update();
      expect(ringAnchor!.distanceTo(expected.jointPoint(expected.layout.idx('bell'), BELL_CONTACT[0] * size, BELL_CONTACT[1] * size, BELL_CONTACT[2] * size, new THREE.Vector3())), 'звон исходит от уже отклонившейся чашки').toBeLessThan(0.001);
      const early = bellResponse.find(r => r.t >= 0.05)!, cup = bellResponse.find(r => r.t >= 0.12)!, body = bellResponse.find(r => r.t >= 0.24)!;
      expect(early.angle).toBeLessThan(-0.02); expect(early.angle).toBeGreaterThan(-0.08);
      expect(early.chest, 'подвесная чашка получает импульс раньше тяжёлого корпуса').toBeLessThan(0.01);
      expect(cup.angle, 'колокол действительно отклоняется на подвесе').toBeLessThan(-0.3);
      expect(cup.chest).toBeLessThan(0.08); expect(body.chest).toBeGreaterThan(0.1);
    }
    expect(framedSamples).toBeGreaterThan(90);
    expect(widestX, 'кисти, полный клинок и цель не выходят из кадра').toBeLessThan(0.9);
    expect(tallestY, 'замах не закрыт леттербоксом').toBeLessThan(0.76);
    expect(nearestZ).toBeGreaterThan(-1); expect(furthestZ).toBeLessThan(1);
    expect(leastFront, 'замах снят с передней четверти героя').toBeGreaterThan(0.5);
    expect(T.crumble - contacts.at(-1)!.at).toBeGreaterThan(1.2);
    expect(deaths).toBe(1); expect(w.hero.y).toBe(0); expect(d.active).toBe(false);
    w.hero.avatar.dispose();
  });
});
