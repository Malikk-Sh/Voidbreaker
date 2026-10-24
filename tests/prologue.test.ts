import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Director, type DirectorHost } from '../src/game/director';
import { FALL, FallField } from '../src/game/prologueFall';
import { DOME_IMPACT, LANDING_T, landingTrack, PROLOGUE_T, prologueTrack, SPACE, SpaceBasis } from '../src/game/prologueTracks';
import { CameraRig } from '../src/world/camera';
import { HeroAvatar } from '../src/world/heroAvatar';

const DT = 1 / 60;
/** Направление на погасшую звезду неба (как в render/sky). */
const STAR = new THREE.Vector3(0.42, -0.5, -0.76).normalize();
const steps = (fn: (f: FallField, i: number) => [number, number], seed = 77) => {
  const f = new FallField(seed);
  for (let i = 0; i < 9.2 / DT; i++) { const [mx, mz] = fn(f, i); f.step(DT, mx, mz); }
  return f;
};

describe('пролог «Падение» (план §8.2)', () => {
  it('падение: обломки летят в героя — стоять нельзя, уклонение работает, урона нет', () => {
    const idle = steps(() => [0, 0]);
    expect(idle.hits).toBeGreaterThanOrEqual(3);
    // уклонение: уходить от ближайшего обломка, который ещё внизу
    const dodge = steps((f) => {
      let best: { x: number; z: number } | null = null, bd = Infinity;
      for (const d of f.debris) if (!d.hit && d.y < 0 && -d.y < bd) { bd = -d.y; best = d; }
      if (!best) return [-f.hx * 0.3, -f.hz * 0.3];
      let dx = f.hx - best.x, dz = f.hz - best.z;
      const l = Math.hypot(dx, dz);
      if (l < 1e-3) { dx = 1; dz = 0; } else { dx /= l; dz /= l; }
      // у стенки — вдоль неё
      if (Math.abs(f.hx) > FALL.rangeX - 0.6) dx = -Math.sign(f.hx);
      if (Math.abs(f.hz) > FALL.rangeZ - 0.6) dz = -Math.sign(f.hz);
      return [dx, dz];
    });
    expect(dodge.hits).toBeLessThan(idle.hits);
    // детерминизм и окно стика
    expect(steps(() => [0, 0]).hits).toBe(idle.hits);
    const pushed = steps((_f, i) => (i % 120 < 60 ? [1, 1] : [-1, -1]));
    expect(Math.abs(pushed.hx)).toBeLessThanOrEqual(FALL.rangeX);
    expect(Math.abs(pushed.hz)).toBeLessThanOrEqual(FALL.rangeZ);
  });

  it('касание — толчок прочь от обломка, без повторного удара тем же обломком', () => {
    const f = new FallField(3);
    f.debris.push({ x: 0.3, y: -1, z: 0, r: 0.8, rot: 0, spin: 0, hit: false, kind: 0 });
    let hit = null;
    for (let i = 0; i < 20 && !hit; i++) hit = f.step(DT, 0, 0);
    expect(hit).not.toBeNull();
    expect(f.vx).toBeLessThan(0);
    expect(Math.hypot(f.vx, f.vz)).toBeCloseTo(FALL.push, 0);
    const n = f.hits;
    for (let i = 0; i < 30; i++) f.step(DT, 0, 0);
    expect(f.hits).toBe(n);
  });

  it('обломок виден дольше быстрого телеграфа (0.42 с), последний долетает до купола', () => {
    expect(-FALL.spawnY / FALL.speed).toBeGreaterThan(0.42 * 3);
    expect(FALL.last - FALL.spawnY / FALL.speed).toBeLessThan(DOME_IMPACT);
  });

  it('дорожки: пролог + приземление — 35–45 с; роза бьётся в замедлении до белой вспышки', () => {
    const b = new SpaceBasis(STAR);
    const pro = prologueTrack(b), land = landingTrack({ x: 0, z: 0.5, shardX: 1, shardZ: -1, huskX: -2, huskZ: -10 });
    const total = (pro.dur ?? 0) + (land.dur ?? 0);
    expect(total).toBeGreaterThanOrEqual(35);
    expect(total).toBeLessThanOrEqual(45);
    // падение длится 8–10 с до купола
    expect(PROLOGUE_T.slow - PROLOGUE_T.fall).toBeGreaterThanOrEqual(8);
    // удар о розу: замедление 0.2 с начала PROLOGUE_T.slow
    const slow = pro.steps.find((s) => s.do === 'time' && s.t === PROLOGUE_T.slow);
    expect(slow && slow.do === 'time' ? slow.scale : 0).toBeCloseTo(0.2);
    const impactReal = PROLOGUE_T.slow + (DOME_IMPACT - (PROLOGUE_T.slow - PROLOGUE_T.fall)) / 0.2;
    expect(impactReal).toBeGreaterThan(PROLOGUE_T.slow);
    expect(impactReal).toBeLessThan(PROLOGUE_T.flash);
    // все шаги внутри длительности
    for (const tr of [pro, land]) for (const s of tr.steps) expect(s.t).toBeLessThanOrEqual(tr.dur!);
  });

  it('приземление: реплика Каэлис, клинок из обломка после рывка, лейтмотив — впервые', () => {
    const land = landingTrack({ x: 0, z: 0.5, shardX: 1, shardZ: -1, huskX: -2, huskZ: -10 });
    const at = (fn: string) => land.steps.find((s) => s.do === 'call' && s.fn === fn)!.t;
    expect(land.steps.some((s) => s.do === 'say' && s.line === 'Системы… живы. Пилот?')).toBe(true);
    const pull = land.steps.find((s) => s.do === 'actor' && s.clip === 'pullBlade')!.t;
    expect(at('ignite')).toBeGreaterThan(pull + 1);
    const motif = land.steps.find((s) => s.do === 'music' && s.cue === 'leitmotif')!.t;
    expect(motif).toBeGreaterThanOrEqual(at('ignite'));
    expect(at('husk')).toBeLessThan(at('title'));
    expect(LANDING_T.end).toBe(at('end'));
  });

  it('пропуск удержанием атаки: логика планов выполняется по порядку, сцена завершается', () => {
    const log: string[] = [];
    let hold = false, ended: boolean | null = null;
    const host: DirectorHost = {
      actor: () => null, call: (fn) => log.push(fn), holding: () => hold, tapped: () => false,
      seen: () => 0, markSeen: () => {},
    };
    const d = new Director(host), cam = new CameraRig();
    d.play(prologueTrack(new SpaceBasis(STAR)), (s) => { ended = s; });
    for (let t = 0; t < 1; t += DT) d.update(DT, cam);
    hold = true;
    for (let t = 0; t < 1; t += DT) d.update(DT, cam);
    expect(ended).toBe(true);
    expect(log).toEqual(['dark', 'space', 'beams', 'hit', 'blackout', 'fall', 'hint', 'dome', 'end']);
  });

  it('космос: оси ортонормированы, луч попадает в «Инея», кольцо — вокруг звезды', () => {
    const b = new SpaceBasis(STAR);
    expect(b.F.dot(b.Rt)).toBeCloseTo(0, 5);
    expect(b.F.dot(b.Up)).toBeCloseTo(0, 5);
    expect(b.Up.y).toBeGreaterThan(0);
    expect(b.C.length()).toBeCloseTo(SPACE.ringD, 3);
    const ring = b.ringPoint(1.2);
    expect(ring.distanceTo(b.C)).toBeCloseTo(SPACE.ringR, 3);
    // в момент удара корабль далеко перед кольцом, после — продолжает от той же точки
    expect(b.shipPos(SPACE.hitT).distanceTo(b.C)).toBeGreaterThan(SPACE.ringR);
    expect(b.shipFall(0).distanceTo(b.shipPos(SPACE.hitT))).toBeCloseTo(0, 5);
  });

  it('аватар: высота корня (lift) входит в матрицы рига — падение в провал видно', () => {
    const a = new HeroAvatar();
    a.update(DT, 0, 0, 0, 0, 0, 0, true);
    const y0 = a.puppet.skel.world[13];
    a.lift = -3;
    a.update(DT, 0, 0, 0, 0, 0, 0, true);
    expect(a.puppet.skel.world[13]).toBeCloseTo(y0 - 3, 1);
    a.dispose();
  });
});
