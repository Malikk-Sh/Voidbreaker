import { describe, expect, it } from 'vitest';
import { Director, SKIP_HOLD, type CineTrack, type DirectorActor, type DirectorHost } from '../src/game/director';
import { CameraRig } from '../src/world/camera';
import { migrate, newSave } from '../src/meta/save';

const DT = 1 / 60;

function fakeHost() {
  const log: string[] = [];
  const hero: DirectorActor = { x: 0, z: 0, y: 0, facing: 0, puppet: { crack: 0, dissolve: 0 } };
  const seen: Record<string, number> = {};
  const state = { hold: false, tap: false };
  const sky: Record<string, number> = {};
  const host: DirectorHost = {
    actor: (who) => (who === 'hero' ? hero : null),
    say: (line) => log.push(`say:${line}`),
    call: (fn) => log.push(`call:${fn}`),
    sfx: (id) => log.push(`sfx:${id}`),
    sky: (p, v) => { sky[p] = v; },
    skyValue: (p) => sky[p] ?? 0,
    holding: () => state.hold,
    tapped: () => { const t = state.tap; state.tap = false; return t; },
    seen: (id) => seen[id] ?? 0,
    markSeen: (id) => { seen[id] = (seen[id] ?? 0) + 1; },
  };
  return { host, log, hero, seen, state, sky };
}
const run = (d: Director, cam: CameraRig, sec: number, each?: () => void): void => { for (let t = 0; t < sec; t += DT) { d.update(DT, cam); each?.(); } };
/** Нажатие атаки — только в этом кадре. */
const press = (d: Director, cam: CameraRig, st: { tap: boolean }): void => { st.tap = true; d.update(DT, cam); st.tap = false; };

const TRACK: CineTrack = {
  id: 'test',
  steps: [
    { t: 0, do: 'cam', path: [[0, 5, 10], [10, 5, 10]], look: [[0, 0, 0]], dur: 2, ease: 'linear' },
    { t: 0.5, do: 'actor', who: 'hero', moveTo: [4, 0, 2], dur: 1, ease: 'linear' },
    { t: 1.0, do: 'say', line: 'привет' },
    { t: 1.5, do: 'crack', who: 'hero', to: 1, dur: 0.5 },
    { t: 2.0, do: 'sky', param: 'starLit', to: 1, dur: 0.5 },
    { t: 2.2, do: 'sfx', id: 'late' },
    { t: 2.4, do: 'call', fn: 'spawn' },
    { t: 2.5, do: 'tap', dur: 0.4, onHit: 'perfect' },
  ],
  short: [{ t: 0, do: 'say', line: 'коротко' }],
};

describe('режиссёр: дорожки актёров (план §8.1)', () => {
  it('шаги по времени, камера по сплайну, актёр и трещины доходят до цели', () => {
    const { host, log, hero, sky } = fakeHost();
    const d = new Director(host), cam = new CameraRig();
    let ended = false;
    d.play(TRACK, (skipped) => { ended = !skipped; });
    run(d, cam, 0.98);
    expect(log).not.toContain('say:привет');
    // камера: линейно по пути, примерно середина первой секунды
    expect(cam.cine).not.toBe(null);
    expect(cam.cine!.pos.x).toBeCloseTo(4.9, 0);
    expect(hero.x).toBeGreaterThan(1.5);
    run(d, cam, 0.1);
    expect(log).toContain('say:привет');
    run(d, cam, 2.2);
    expect(hero.x).toBeCloseTo(4, 5);
    expect(hero.z).toBeCloseTo(2, 5);
    expect(hero.puppet!.crack).toBeCloseTo(1, 5);
    expect(sky.starLit).toBeCloseTo(1, 5);
    expect(log).toContain('call:spawn');
    expect(ended).toBe(true);
    // камера плавно возвращается к бою
    run(d, cam, 1);
    expect(cam.cine).toBe(null);
  });

  it('пропуск удержанием атаки: логика сцены и конечные позиции сразу, подача — нет', () => {
    const { host, log, hero, state, seen } = fakeHost();
    const d = new Director(host), cam = new CameraRig();
    let skipped = false;
    d.play(TRACK, (s) => { skipped = s; });
    run(d, cam, 0.45);
    state.hold = true;
    run(d, cam, SKIP_HOLD - 0.1);
    expect(d.active).toBe(true);
    run(d, cam, 0.15);
    expect(d.active).toBe(false);
    expect(skipped).toBe(true);
    expect(hero.x).toBeCloseTo(4, 5);
    expect(hero.puppet!.crack).toBeCloseTo(1, 5);
    expect(log).toContain('call:spawn');
    expect(log).not.toContain('sfx:late');
    expect(seen.test).toBe(1);
  });

  it('удержание сразу после начала не пропускает сцену (атака с прошлой сцены)', () => {
    const { host, state } = fakeHost();
    const d = new Director(host), cam = new CameraRig();
    state.hold = true;
    d.play(TRACK);
    run(d, cam, 0.35);
    expect(d.active).toBe(true);
  });

  it('увиденная дважды сцена играет укороченную версию', () => {
    const { host, log, seen } = fakeHost();
    seen.test = 2;
    const d = new Director(host), cam = new CameraRig();
    d.play(TRACK);
    expect(d.short).toBe(true);
    run(d, cam, 0.5);
    expect(log).toEqual(['say:коротко']);
    expect(d.active).toBe(false);
  });

  it('касание-тайминг: атака в окне ставит флаг, вне окна — нет', () => {
    const a = fakeHost();
    const d = new Director(a.host), cam = new CameraRig();
    d.play(TRACK);
    run(d, cam, 2.65);
    press(d, cam, a.state);
    expect(d.hits.has('perfect')).toBe(true);
    const b = fakeHost();
    const d2 = new Director(b.host);
    d2.play(TRACK);
    run(d2, cam, 2.2);
    press(d2, cam, b.state);
    run(d2, cam, 1.5);
    expect(d2.hits.has('perfect')).toBe(false);
  });

  it('просмотры сцен хранятся в сохранении', () => {
    const s = newSave();
    s.cine.prologue = 2;
    const m = migrate(JSON.parse(JSON.stringify(s)));
    expect(m.cine.prologue).toBe(2);
    expect(migrate({}).cine).toEqual({});
  });
});
