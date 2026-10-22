import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { Hierophant, HierophantController, INTERCEPT_WINDOW, ORBIT, PHASE2_AT, PHASE3_AT, SATS, SERMON_SHIELD, type BossHost } from '../src/world/boss/hierophant';
import { Obelisk, OBELISK_HITS } from '../src/world/enemies/obelisk';
import { CENSER_RETURN_STUN, type StrikeParams } from '../src/world/world';
import { VOID_BLADE } from '../src/data/weapons';
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
    runes: () => {}, chains: () => {}, dust: () => {}, sky: (pp, v) => log.push(`sky:${pp}:${v}`), transpose: (c) => log.push(`transpose:${c}`), duck: () => log.push('duck'), starDir: () => [0.42, -0.5, -0.76],
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

  /** Удар клинком прямоугольником перед героем (как заряженный удар). */
  const chargedStrike = (w: World, full: boolean) => {
    const C = VOID_BLADE.charged, h = w.hero;
    const p: StrikeParams = { mult: C.dmg[full ? 1 : 0], stun: C.stun[full ? 1 : 0], stunKind: 'charged', knockback: 3, feel: full ? 'heavy' : 'medium', dirX: 0, dirZ: -1, source: 'blade', finisher: true };
    return w.heroStrike({ k: 'line', x: h.x, z: h.z, dx: 0, dz: -1, len: C.length, w: C.width }, new Set(), p);
  };

  it('Проповедь: два обелиска — щит −70 %, разбит один — вдвое слабее; 3 удара или 1 полный заряд', () => {
    const { w, b } = setup(0, 8);
    b.phase = 1; b.idleT = 50;
    const sermon = b.patterns.find((p) => p.id === 'sermon')!;
    b.startPattern(sermon);
    const input = idle();
    for (let i = 0; i < 160; i++) w.step(DT, DT, input, DT);
    const obs = b.summoned.filter((e): e is Obelisk => e instanceof Obelisk);
    expect(obs.length).toBe(2);
    for (let i = 0; i < 70; i++) { b.idleT = 50; w.step(DT, DT, input, DT); }
    expect(b.shieldMul).toBeCloseTo(1 - SERMON_SHIELD);
    // первый — тремя лёгкими ударами
    const [a, c] = obs;
    for (let k = 0; k < OBELISK_HITS; k++) {
      expect(a.dead).toBe(false);
      w.damageEnemy(a, { mult: 1, stun: 0, knockback: 1, feel: 'light', dirX: 0, dirZ: -1, source: 'blade' });
    }
    expect(a.dead).toBe(true);
    b.idleT = 50; w.step(DT, DT, input, DT);
    expect(b.shieldMul).toBeCloseTo(1 - SERMON_SHIELD / 2);
    // второй — одним полным зарядом (частичный не ломает)
    w.damageEnemy(c, { mult: 3, stun: 12, stunKind: 'charged', knockback: 3, feel: 'medium', dirX: 0, dirZ: -1, source: 'blade', finisher: true });
    expect(c.dead).toBe(false);
    w.damageEnemy(c, { mult: 4.5, stun: 30, stunKind: 'charged', knockback: 3, feel: 'heavy', dirX: 0, dirZ: -1, source: 'blade', finisher: true });
    expect(c.dead).toBe(true);
    b.idleT = 50; w.step(DT, DT, input, DT);
    expect(b.shieldMul).toBe(1);
  });

  it('кадило: полный заряд отбивает его в колокол (+40 оглушения), неполный — нет', () => {
    for (const full of [true, false]) {
      const { w, b } = setup(0, 4);
      b.phase = 1; b.idleT = 50; b.x = 0; b.z = -6;
      const input = idle();
      const hurl = b.patterns.find((p) => p.id === 'hurl')!;
      b.startPattern(hurl);
      const stun0 = b.stun!.value;
      let returned = 0, deflected = false;
      w.bus.on('censer', (e) => { if (e.kind === 'return') returned++; });
      for (let i = 0; i < 300 && !returned; i++) {
        b.idleT = 50;
        w.step(DT, DT, input, DT);
        const cz = w.projectiles.find((pr) => pr.kind === 'censer' && !pr.reflected);
        // кадило подлетело к герою — удар
        if (cz && !deflected && Math.abs(cz.z - w.hero.z) < 2.5) { chargedStrike(w, full); deflected = true; }
      }
      expect(deflected).toBe(true);
      if (full) {
        expect(returned).toBe(1);
        expect(b.stun!.value - stun0).toBeGreaterThanOrEqual(CENSER_RETURN_STUN - 0.5);
      } else expect(returned).toBe(0);
    }
  });

  /** Бой с контроллером после интро (пропущено). */
  function fight(hx = 0, hz = 8) {
    const { w, b } = setup(hx, hz);
    let held = false;
    const fh = fakeHost(w, b, () => held);
    const ctrl = new HierophantController(fh.host, b);
    const cam = new CameraRig(), input = idle();
    const tick = (sec: number, each?: () => void) => {
      for (let t = 0; t < sec; t += DT) { fh.director.update(DT, cam); ctrl.step(DT); w.step(DT, DT, input, DT); each?.(); }
    };
    held = true; tick(1.2); held = false;
    expect(ctrl.phase).toBe(1);
    return { w, b, ctrl, tick, log: fh.log, hold: (v: boolean) => { held = v; } };
  }
  const full = (w: World, b: Hierophant) => w.damageEnemy(b, { mult: 4.5, stun: 30, stunKind: 'charged', knockback: 3, feel: 'heavy', dirX: 0, dirZ: -1, source: 'blade', finisher: true });
  const light = (w: World, b: Hierophant) => w.damageEnemy(b, { mult: 1, stun: 4, knockback: 1, feel: 'light', dirX: 0, dirZ: -1, source: 'blade' });

  it('фазы: 60 % и 25 % — переходы; HP не проваливается за порог', () => {
    const { w, b, ctrl } = fight();
    b.hp = b.maxHp * PHASE2_AT + 5;
    light(w, b); light(w, b); light(w, b);
    expect(b.hp).toBeGreaterThanOrEqual(Math.round(b.maxHp * PHASE2_AT) - 1);
    expect(ctrl.reached(2)).toBe(true);
    expect(b.invulnerable).toBe(true);
    expect(ctrl.phaseMarks).toEqual([PHASE2_AT, PHASE3_AT]);
  });

  it('перехват: полный заряд в окне 1.2 с — фаза II сразу, с оглушением; пол обрушен; второй раз нельзя', () => {
    const { w, b, ctrl, tick } = fight();
    b.hp = b.maxHp * PHASE2_AT + 1; light(w, b);
    tick(0.3);
    expect(ctrl.interceptOpen).toBe(true);
    // лёгкий удар не перехватывает
    light(w, b);
    expect(ctrl.phase).toBe(1);
    full(w, b);
    expect(ctrl.phase).toBe(2);
    expect(b.stunned).toBe(true);
    expect(w.arena.edge).toBe('abyss');
    expect(ctrl.interceptUsed).toBe(true);
    // фаза III: окно больше не открывается
    tick(5);
    b.hp = b.maxHp * PHASE3_AT + 1; light(w, b);
    tick(0.3);
    expect(ctrl.reached(3)).toBe(true);
    expect(ctrl.interceptOpen).toBe(false);
    full(w, b);
    expect(ctrl.phase).toBe(2);
  });

  it('без перехвата: после окна — сцена перехода, новая фаза без оглушения; III — колокол треснул, +1 полутон', () => {
    const { w, b, ctrl, tick, log } = fight();
    b.hp = b.maxHp * PHASE2_AT + 1; light(w, b);
    tick(INTERCEPT_WINDOW + 0.1);
    expect(ctrl.interceptOpen).toBe(false);
    tick(5);
    expect(ctrl.phase).toBe(2);
    expect(b.stunned).toBe(false);
    expect(w.arena.edge).toBe('abyss');
    b.hp = b.maxHp * PHASE3_AT + 1; light(w, b);
    tick(INTERCEPT_WINDOW + 4);
    expect(ctrl.phase).toBe(3);
    expect(b.bellCracked).toBe(true);
    expect(log).toContain('transpose:100');
    // огонь открыт: урон ×1.5
    tick(0.2);
    expect(b.shieldMul).toBe(1.5);
  });

  it('фаза III: облетает арену на цепях над бездной; три спутника звонят по очереди, каждый с меткой ≥ 0.8 с', () => {
    const { w, b, ctrl, tick } = fight();
    b.hp = b.maxHp * PHASE2_AT + 1; light(w, b);
    tick(INTERCEPT_WINDOW + 5);
    b.hp = b.maxHp * PHASE3_AT + 1; light(w, b);
    tick(INTERCEPT_WINDOW + 4);
    expect(ctrl.phase).toBe(3);
    const rings: number[] = [], teles: { t: number; dur: number }[] = [];
    let t = 0;
    w.bus.on('enemyAttack', (e) => { if (e.kind === 'bell') rings.push(t); });
    const teleSeen = new Set<object>();
    let overAbyss = false;
    tick(12, () => {
      t += DT;
      if (!w.arena.walkable(b.x, b.z)) overAbyss = true;
      b.idleT = 50; // только облёт и спутники
      for (const tl of w.telegraphs) if (!teleSeen.has(tl) && tl.shape.k === 'circle' && (tl.shape as { r: number }).r === 1.6) { teleSeen.add(tl); teles.push({ t, dur: tl.dur }); }
    });
    // над бездной, на радиусе облёта
    expect(Math.hypot(b.x, b.z)).toBeGreaterThan(ORBIT.r - 1.2);
    expect(overAbyss).toBe(true);
    expect(b.flying).toBe(true);
    // звон по очереди: шаг ≈ period / 3
    expect(rings.length).toBeGreaterThanOrEqual(5);
    const gaps = rings.slice(1).map((r, i) => r - rings[i]);
    for (const g of gaps) expect(g).toBeCloseTo(SATS.period / SATS.n, 0);
    for (const tl of teles) expect(tl.dur).toBeGreaterThanOrEqual(0.8);
    expect(w.bellSats.length).toBe(SATS.n);
  });
});
