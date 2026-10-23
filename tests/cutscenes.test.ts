import { describe, expect, it } from 'vitest';
import { Director, type DirectorActor, type DirectorHost } from '../src/game/director';
import { LANDING_FROM, LANDING_T, landingTrack } from '../src/game/prologueTracks';
import { GUARD_FOV } from '../src/game/cinematics';
import { KILL_FOV, killBellTrack, killGateTrack } from '../src/world/boss/guardianScenes';
import { CAM_FOV } from '../src/render/renderer';
import { REPLAY } from '../src/game/battle';
import { CINEMA } from '../src/data/cinema';
import { stageById } from '../src/data/stages';
import { CameraRig } from '../src/world/camera';
import { replayContext, type GameContext } from '../src/game/context';
import { FLAWLESS_TITLE, awardExecution } from '../src/meta/progression';
import { newSave, type SaveData } from '../src/meta/save';

const DT = 1 / 60;
const SPOTS = { x: 0, z: 0.5, shardX: 0.9, shardZ: 2.1, huskX: -1.2, huskZ: -6 };

function hostWith(actor: DirectorActor): DirectorHost {
  return { actor: () => actor, holding: () => false, tapped: () => false, seen: () => 0, markSeen: () => {} };
}

describe('кат-сцены: приземление, ракурсы, Кинозал', () => {
  it('приземление: Пилот падает с высоты в кадре, удар — в замедлении, клинок — после хвата', () => {
    const land = landingTrack(SPOTS);
    const fall = land.steps.find((s) => s.do === 'actor' && s.moveTo && s.t === 0);
    expect(fall && fall.do === 'actor' ? fall.dur : 0).toBeCloseTo(LANDING_T.impact);
    expect(LANDING_FROM).toBeGreaterThanOrEqual(10);
    // удар снят в замедлении, со склейкой камеры
    expect(land.steps.some((s) => s.do === 'time' && s.t === LANDING_T.impact && s.scale < 0.5)).toBe(true);
    expect(land.steps.some((s) => s.do === 'cam' && s.t === LANDING_T.impact)).toBe(true);
    const at = (fn: string) => land.steps.find((s) => s.do === 'call' && s.fn === fn)!.t;
    expect(at('grip')).toBeLessThan(at('ignite'));
    expect(at('visor')).toBeGreaterThan(LANDING_T.impact);
    // все планы — шире игрового угла (крупные и низкие ракурсы)
    for (const s of land.steps) if (s.do === 'cam') expect(s.fov ?? CAM_FOV).toBeGreaterThan(CAM_FOV);
  });

  it('приземление: Пилот оборачивается к Шелухе плавно, а не рывком', () => {
    const land = landingTrack(SPOTS);
    const a: DirectorActor = { x: SPOTS.x, z: SPOTS.z, y: 0, facing: 0 };
    const d = new Director(hostWith(a)), cam = new CameraRig();
    d.play(land);
    const facingAt: number[] = [];
    for (let t = 0; t < LANDING_T.title; t += DT) { d.update(DT, cam); if (t > LANDING_T.turn - 0.02 && t < LANDING_T.turn + 0.6) facingAt.push(a.facing); }
    // смотрит на Шелуху
    const want = Math.atan2(SPOTS.huskX - a.x, SPOTS.huskZ - a.z);
    expect(Math.abs(Math.atan2(Math.sin(a.facing - want), Math.cos(a.facing - want)))).toBeLessThan(0.02);
    // разворот растянут: ни один кадр не поворачивает больше чем на 0.35 рад
    for (let i = 1; i < facingAt.length; i++) {
      const step = Math.abs(Math.atan2(Math.sin(facingAt[i] - facingAt[i - 1]), Math.cos(facingAt[i] - facingAt[i - 1])));
      expect(step).toBeLessThan(0.35);
    }
  });

  it('стражи и kill-cam снимаются шире игрового угла — Страж в кадре со шлемом', () => {
    for (const v of Object.values(GUARD_FOV)) expect(v).toBeGreaterThan(CAM_FOV + 8);
    const k = { gx: 0, gz: -4, hx: 0, hz: 2 };
    for (const tr of [killGateTrack(k), killBellTrack(k)]) {
      const cams = tr.steps.filter((s) => s.do === 'cam');
      expect(cams.length).toBeGreaterThan(1);
      for (const s of cams) expect(s.do === 'cam' && s.fov).toBe(KILL_FOV);
    }
  });

  it('Кинозал: kill-cam и интро Иерофанта пересматриваются на своих этапах', () => {
    const ids = new Set(CINEMA.map((c) => c.id));
    for (const [id, r] of Object.entries(REPLAY)) {
      expect(ids.has(id)).toBe(true);
      expect(stageById(r.stage)).toBeTruthy();
    }
    expect(REPLAY.killGate.guardian).toBe('gateGuardian');
    expect(REPLAY.killBell.guardian).toBe('bellRinger');
  });

  it('пересмотр играет полную версию сцены, даже если её видели много раз', () => {
    const a: DirectorActor = { x: 0, z: 0, facing: 0 };
    const host = { ...hostWith(a), seen: () => 9 };
    const tr = { id: 'x', steps: [{ t: 0, do: 'call' as const, fn: 'a' }], short: [{ t: 0, do: 'call' as const, fn: 'b' }] };
    const d = new Director(host);
    d.play(tr);
    expect(d.short).toBe(true);
    d.full = true;
    d.play(tr);
    expect(d.short).toBe(false);
  });

  it('Кинозал: пересмотр казни не выдаёт звезду, титул и запись — меняется только счётчик сцен', () => {
    const real = newSave();
    real.stars.z1 = 1;
    let writes = 0;
    const ctx = { save: real, settings: real.settings, persist: () => { writes++; }, flag: (id: string) => !!real.flags[id], setFlag: (id: string) => { real.flags[id] = true; } } as unknown as GameContext;
    const before = structuredClone(real);
    const rc = replayContext(ctx);
    // всё, что бой пишет в сохранение на казни: звезда, подсказки, отметка просмотра (как Director.markSeen)
    awardExecution(rc.save, 0, true);
    rc.persist();
    rc.setFlag('tut_shatter');
    expect(rc.flag('tut_shatter')).toBe(true);
    rc.save.cine.hierophantEnd = (rc.save.cine.hierophantEnd ?? 0) + 1;
    rc.persist();
    const strip = (s: SaveData) => { const { cine, updatedAt, ...rest } = s; void cine; void updatedAt; return rest; };
    expect(strip(real)).toEqual(strip(before));
    expect(real.stars.z1).toBe(1);
    expect(real.titles).not.toContain(FLAWLESS_TITLE);
    expect(real.lore).not.toContain('execution_z1');
    expect(real.cine.hierophantEnd).toBe(1);
    expect(writes).toBeGreaterThan(0);
    // в настоящем бою та же казнь награждает
    awardExecution(real, 0, true);
    expect(real.stars.z1).toBe(2);
    expect(real.titles).toContain(FLAWLESS_TITLE);
  });
});
