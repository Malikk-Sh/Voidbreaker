import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { Hierophant, HierophantController, type BossHost } from '../src/world/boss/hierophant';
import { DESCEND_FROM, hierophantIntroTrack, INTRO_T } from '../src/world/boss/hierophantScenes';
import { Director, type CineTrack, type DirectorActor } from '../src/game/director';
import { CameraRig } from '../src/world/camera';
import { InputBuffer, type Input } from '../src/input/input';

const DT = 1 / 60;
const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;

function setup(hx = 0, hz = 8): { w: World; b: Hierophant } {
  const w = new World(new Arena(ARENAS.hierophant), 'hiero');
  w.abilities = new Abilities(w);
  w.hero.spawn(hx, hz, Math.PI);
  w.hero.invulnUntil = 1e9;
  const b = new Hierophant({ zone: 0, stage: 6 });
  b.x = 0; b.z = -6;
  w.addEnemy(b);
  b.setState('idle');
  return { w, b };
}

/** Бой-хост без рендера: сцену проигрывает настоящий режиссёр, вызовы — логика шагов 'call'. */
function fakeHost(w: World, b: Hierophant, hold = () => false) {
  const log: string[] = [];
  let calls: Record<string, (arg?: number) => void> = {};
  let onEnd: ((s: boolean) => void) | null = null;
  const hero: DirectorActor = { get x() { return w.hero.x; }, set x(v) { w.hero.x = v; }, get z() { return w.hero.z; }, set z(v) { w.hero.z = v; }, get facing() { return w.hero.facing; }, set facing(v) { w.hero.facing = v; } };
  const director = new Director({
    actor: (who) => (who === 'hero' ? hero : who === 'boss' ? b : null),
    call: (fn, arg) => { log.push(fn); calls[fn]?.(arg); },
    holding: hold, tapped: () => false, seen: () => 0, markSeen: () => {},
  });
  const host: BossHost = {
    world: w, say: () => {}, banner: () => {}, letterbox: () => {}, slow: () => {}, flash: () => {}, starFlare: () => {}, musicPhase: () => {},
    emitFire: () => {}, skipRequested: () => false,
    scene: (track: CineTrack, c, end) => { calls = c; onEnd = end; director.play(track, (s) => onEnd?.(s)); },
    music: (cue) => log.push(`music:${cue}`), startSong: () => log.push('song'), quench: (_x, _z, r) => log.push(`quench:${r}`),
    runes: () => {}, chains: () => {}, dust: () => {},
  };
  return { host, log, director };
}

describe('Иерофант 2.0 (план §8.3)', () => {
  it('интро ≈8 с: три удара — три ряда свечей, имя с первым ударом музыки, управление в конце', () => {
    const tr = hierophantIntroTrack({ hx: 0, hz: 8, bx: 0, bz: -6 });
    expect(tr.dur).toBeGreaterThan(7);
    expect(tr.dur).toBeLessThan(9.5);
    const at = (fn: string) => tr.steps.filter((s) => s.do === 'call' && s.fn === fn).map((s) => s.t);
    expect(at('douse')).toEqual(INTRO_T.tolls);
    expect(tr.steps.filter((s) => s.do === 'sfx' && s.id === 'boss_bell').map((s) => s.t)).toEqual(INTRO_T.tolls);
    expect(at('music')).toEqual(at('slam'));
    expect(tr.steps.find((s) => s.do === 'banner')!.t).toBe(at('music')[0]);
    expect(at('begin')[0]).toBe(Math.max(...tr.steps.map((s) => s.t)));
    // спуск начинается после ударов колокола
    expect(at('descend')[0]).toBeGreaterThan(INTRO_T.tolls[2]);
  });

  it('после интро босс спускается на пол и сразу бьёт Звон; пропуск удержанием даёт то же', () => {
    for (const skip of [false, true]) {
      const { w, b } = setup();
      let held = false;
      const { host, log, director } = fakeHost(w, b, () => held);
      const ctrl = new HierophantController(host, b);
      expect(b.y).toBe(DESCEND_FROM);
      const cam = new CameraRig();
      for (let t = 0; t < 10 && !(ctrl.phase === 1); t += DT) {
        if (skip && t > 0.6) held = true;
        director.update(DT, cam);
        ctrl.step(DT);
        b.step(w, DT);
      }
      expect(ctrl.phase).toBe(1);
      expect(b.y).toBe(0);
      expect(b.cur?.id).toBe('toll');
      expect(log).toContain('music:silence');
      expect(log).toContain('song');
      // свечи зажигаются снова к началу боя
      expect(log[log.length - 1] === 'quench:0' || log.includes('quench:0')).toBe(true);
    }
  });

  it('фаза I: дальше 7 м — скользит к герою, ближе — стоит; вблизи есть «Кадильный взмах» 200°', () => {
    const { w, b } = setup(0, 10);
    b.phase = 1; b.idleT = 50;
    const z0 = b.z, input = idle();
    for (let i = 0; i < 120; i++) { b.idleT = 50; w.step(DT, DT, input, DT); }
    expect(b.z).toBeGreaterThan(z0 + 0.5);
    const near = setup(0, -2);
    near.b.phase = 1; near.b.idleT = 50;
    const z1 = near.b.z;
    for (let i = 0; i < 120; i++) { near.b.idleT = 50; near.w.step(DT, DT, input, DT); }
    expect(Math.abs(near.b.z - z1)).toBeLessThan(0.2);
    const swing = b.patterns.find((p) => p.id === 'swing')!;
    const tele = swing.steps.find((s) => s.do === 'telegraph')!;
    expect(tele.do === 'telegraph' && 'arc' in tele.shape ? tele.shape.arc[1] : 0).toBe(200);
    expect(tele.do === 'telegraph' ? tele.dur : 0).toBeGreaterThanOrEqual(0.8);
    expect(swing.range![1]).toBeLessThanOrEqual(7);
  });

  it('фаза II: висит над средокрестием, не идёт за героем', () => {
    const { w, b } = setup(0, 10);
    b.phase = 2; b.idleT = 50; b.x = 3; b.z = 0;
    const input = idle();
    for (let i = 0; i < 240; i++) { b.idleT = 50; w.step(DT, DT, input, DT); }
    expect(Math.hypot(b.x, b.z)).toBeLessThan(2.6);
  });
});
