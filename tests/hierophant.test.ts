import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { EXEC_HP, Hierophant, HierophantController, INTERCEPT_WINDOW, ORBIT, PHASE2_AT, PHASE3_AT, RETURN_CALM, SATS, SERMON_SHIELD, type BossHost } from '../src/world/boss/hierophant';
import { Obelisk, OBELISK_HITS } from '../src/world/enemies/obelisk';
import { CENSER_RETURN_STUN, type StrikeParams } from '../src/world/world';
import { VOID_BLADE } from '../src/data/weapons';
import { COLLAPSE_BLEND, COLLAPSE_T, collapseTrack, CONTACT_SHOT, DESCEND_FROM, EXEC_FLASH, EXEC_T, EXEC_SHORT_T, MASK_Y, executionTrack, hierophantIntroTrack, INTRO_T } from '../src/world/boss/hierophantScenes';
import { Director, type CineTrack, type DirectorActor } from '../src/game/director';
import { CameraRig } from '../src/world/camera';
import { InputBuffer, type Input } from '../src/input/input';
import { EXECUTION_CLIPS, MASK_CONTACT, maskContactRoot } from '../src/anim/clips/execution';

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
function fakeHost(w: World, b: Hierophant, hold = () => false, tap = () => false, seen = () => 0) {
  const log: string[] = [];
  let calls: Record<string, (arg?: number) => void> = {};
  let onEnd: ((s: boolean) => void) | null = null;
  const hero: DirectorActor = { get x() { return w.hero.x; }, set x(v) { w.hero.x = v; }, get y() { return w.hero.y; }, set y(v) { w.hero.y = v; }, get z() { return w.hero.z; }, set z(v) { w.hero.z = v; }, get facing() { return w.hero.facing; }, set facing(v) { w.hero.facing = v; } };
  const director = new Director({
    actor: (who) => (who === 'hero' ? hero : who === 'boss' ? b : null),
    clipEvents: (_who, id) => w.hero.avatar.puppet.clips.get(id)?.events ?? [],
    clipDuration: (_who, id) => w.hero.avatar.puppet.clips.get(id)?.dur ?? 0,
    sampleClip: (_who, id, time, reset, blend) => w.hero.sampleSceneClip(id, time, reset, blend),
    releaseClip: () => w.hero.releaseSceneClip(),
    call: (fn, arg) => { log.push(fn); calls[fn]?.(arg); },
    holding: hold, tapped: tap, seen, markSeen: () => {},
  });
  const host: BossHost = {
    world: w, say: () => {}, banner: () => {}, letterbox: () => {}, slow: () => {}, flash: () => {}, starFlare: () => {}, musicPhase: () => {},
    emitFire: () => {}, skipRequested: () => false, light: (_x, _y, _z, rgb) => log.push(`light:${rgb}`),
    scene: (track: CineTrack, c, end) => { calls = c; onEnd = end; director.play(track, (s) => onEnd?.(s)); },
    music: (cue) => log.push(`music:${cue}`), startSong: () => log.push('song'), quench: (_x, _z, r) => log.push(`quench:${r}`),
    runes: () => {}, chains: () => {}, dust: () => {}, sky: (pp, v) => log.push(`sky:${pp}:${v}`), transpose: (c) => log.push(`transpose:${c}`), duck: () => log.push('duck'), starDir: () => [0.42, -0.5, -0.76],
    sceneHit: (id) => director.hits.has(id), pages: () => log.push('pages'), beam: () => log.push('beam'), starLight: (d) => log.push(`starLight:${d}`), saveStar: (f) => log.push(`star:${f}`), finishFight: () => log.push('finish'),
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
  function fight(hx = 0, hz = 8, seen = 0) {
    const { w, b } = setup(hx, hz);
    let held = false, tapNow = false;
    const fh = fakeHost(w, b, () => held, () => { const t = tapNow; tapNow = false; return t; }, () => seen);
    const ctrl = new HierophantController(fh.host, b);
    const cam = new CameraRig(), input = idle();
    const tick = (sec: number, each?: () => void) => {
      for (let t = 0; t < sec; t += DT) { fh.director.update(DT, cam); ctrl.step(DT); w.step(DT, DT, input, DT); each?.(); }
    };
    held = true; tick(1.2); held = false;
    expect(ctrl.phase).toBe(1);
    return { w, b, ctrl, tick, host: fh.host, log: fh.log, director: fh.director, hold: (v: boolean) => { held = v; }, tap: () => { tapNow = true; } };
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

  it('этап 4.5 C2: удар, переводящий в фазу II, — отшатывается от Пилота, хватается за маску, маска вспыхивает', () => {
    const { w, b, log } = fight();
    b.hp = b.maxHp * PHASE2_AT + 1; light(w, b);
    expect((b as unknown as { poseId: string }).poseId).toBe('grief');
    // пружина толкает корпус от Пилота (Пилот на +z)
    expect(b.puppet.springVZ).toBeLessThan(0);
    expect(log).toContain('light:gold');
  });

  it('этап 4.5 C2: сцена перехода — крупно маска и руки, затем общий план обрушения', () => {
    const mask: [number, number, number] = [0.3, 3.9, -5.8];
    const tr = collapseTrack({ hx: 0, hz: 8, bx: 0, bz: -6, mask });
    const cams = tr.steps.filter((s) => s.do === 'cam');
    const close = cams[0];
    if (close.do !== 'cam') return;
    expect(close.t).toBe(0);
    // крупный план: камера в 3–4.5 м от настоящей маски, взгляд — на неё
    const end = close.path[close.path.length - 1], look = close.look[close.look.length - 1];
    const d = Math.hypot(end[0] - mask[0], end[1] - mask[1], end[2] - mask[2]);
    expect(d).toBeGreaterThan(3); expect(d).toBeLessThan(4.5);
    expect(Math.hypot(look[0] - mask[0], look[1] - mask[1], look[2] - mask[2])).toBeLessThan(0.4);
    // со стороны Пилота: его удар и вызвал жест
    expect(end[2]).toBeGreaterThan(mask[2]);
    // дальше — общий план сверху: видно, как меняется пространство
    const wide = cams[1];
    expect(wide.t).toBe(COLLAPSE_T.close);
    if (wide.do === 'cam') expect(Math.max(...wide.path.map((q) => q[1]))).toBeGreaterThan(20);
    expect(COLLAPSE_T.collapse).toBeGreaterThanOrEqual(COLLAPSE_T.close);
  });

  for (const mode of ['полный просмотр', 'пропуск', 'короткая версия (третий раз)'] as const) {
    it(`этап 4.5 C2: ${mode} — бой в верном состоянии, первый телеграф после возврата камеры и паузы`, () => {
      const { w, b, ctrl, tick, director, hold } = fight(4, 8, mode.startsWith('короткая') ? 2 : 0);
      const tele: number[] = [];
      let t = 0, back = -1, entered = -1;
      w.bus.on('telegraph', () => tele.push(t));
      b.hp = b.maxHp * PHASE2_AT + 1; light(w, b);
      tick(INTERCEPT_WINDOW + 0.1, () => { t += DT; });
      expect(director.active).toBe(true);
      if (mode === 'пропуск') hold(true);
      tick(8, () => { t += DT; if (entered < 0 && ctrl.phase === 2) entered = t; if (back < 0 && !director.active) { back = t; hold(false); } });
      // состояние: фаза II, пол обрушен, Пилот на мосту, босс над средокрестием, переход закончен
      expect(ctrl.phase).toBe(2);
      expect(b.transitioning).toBe(0);
      expect(w.arena.edge).toBe('abyss');
      expect(w.arena.tileAt(w.hero.x, w.hero.z)?.cross).toBe(true);
      expect(Math.hypot(b.x, b.z)).toBeLessThan(0.5);
      expect(w.hero.dead).toBe(false);
      // первый опасный сигнал — не раньше, чем камера вернулась (COLLAPSE_BLEND после конца дорожки) и прошла пауза
      // RETURN_CALM; короткая версия камеру не берёт — отсчёт от входа в фазу
      const camBack = mode.startsWith('короткая') ? entered : back + COLLAPSE_BLEND;
      const first = tele.find((x) => x > entered)!;
      expect(first).toBeDefined();
      expect(first - camBack).toBeGreaterThanOrEqual(RETURN_CALM - 0.05);
      expect(tele.filter((x) => x <= entered)).toHaveLength(0);
    });
  }

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

  /** До фазы III через сцены переходов. */
  function toPhase3(seen = 0) {
    const f = fight(0, 8, seen);
    const { w, b, tick } = f;
    b.hp = b.maxHp * PHASE2_AT + 1; light(w, b);
    tick(INTERCEPT_WINDOW + 5);
    b.hp = b.maxHp * PHASE3_AT + 1; light(w, b);
    tick(INTERCEPT_WINDOW + 4);
    expect(f.ctrl.phase).toBe(3);
    return f;
  }

  it('казнь: «ДОБИТЬ» только в фазе III при ≤ 6 % HP и оглушении; без казни не умирает', () => {
    const { w, b, ctrl, tick } = toPhase3();
    b.hp = b.maxHp * 0.1;
    w.stunEnemy(b);
    expect(ctrl.executable).toBe(false);
    b.hp = b.maxHp * EXEC_HP - 1;
    expect(ctrl.executable).toBe(true);
    expect(b.canShatter).toBe(false);
    // урон не убивает: только казнь
    for (let i = 0; i < 30; i++) full(w, b);
    expect(b.dead).toBe(false);
    expect(b.hp).toBeGreaterThanOrEqual(1);
    tick(5);
    expect(b.stunned).toBe(false);
    expect(ctrl.executable).toBe(false);
  });

  it('казнь целиком: босс взрывается до посадки, безупречность берётся из боя', () => {
    const { w, b, ctrl, tick, log, director } = toPhase3();
    b.hp = b.maxHp * EXEC_HP - 1;
    w.stunEnemy(b);
    ctrl.execute();
    expect(ctrl.executing).toBe(true);
    expect(director.id).toBe('hierophantEnd');
    let t = 0, diedAt = -1;
    tick(EXEC_T.end + 1, () => {
      t += DT;
      if (diedAt < 0 && b.dead) diedAt = t;
    });
    // умирает отложенным разрезом, а не раньше; бой закрывается после сцены
    expect(diedAt).toBeGreaterThan(EXEC_T.cut - 0.1);
    expect(diedAt).toBeLessThan(EXEC_T.cut + 0.3);
    expect(log).toContain('star:true');
    expect(log).toContain('sky:star2:1');
    expect(log[log.length - 1]).toBe('finish');
  });

  it('пропуск казни удержанием: логика и звезда применяются сразу', () => {
    const { w, b, ctrl, tick, log, hold } = toPhase3();
    w.hero.receiveAttack(10, 0, 1, 'test', 0);
    b.hp = b.maxHp * EXEC_HP - 1;
    w.stunEnemy(b);
    ctrl.execute();
    tick(0.5); hold(true); tick(1); hold(false);
    expect(b.dead).toBe(true);
    expect(log).toContain('finish');
    expect(log.some((l) => l.startsWith('star:'))).toBe(true);
  });

  it('казнь: контакт снят крупно — шлем и маска на ≥ 45 % высоты кадра, камера со стороны Пилота', () => {
    const mask: [number, number, number] = [0, 3.1, 0.9];
    const root = maskContactRoot(mask, Math.PI);
    for (const short of [false, true]) {
      const tr = executionTrack({ bx: 0, bz: 0, hx: 0, hz: 8, cx: 0, cz: 3, bellY: mask[1], lx: 3, lz: 5, star: [0.42, -0.5, -0.76], mask });
      const steps = short ? tr.short! : tr.steps;
      const cam = steps.find((s) => s.do === 'cam' && Math.abs(s.t - (short ? EXEC_SHORT_T.contact : EXEC_T.contact)) < 1e-9);
      if (!cam || cam.do !== 'cam') throw new Error('нет плана контакта');
      const c = new THREE.PerspectiveCamera(cam.fov, 844 / 390, 0.1, 200);
      c.position.set(...cam.path[0]); c.lookAt(...cam.look[0]); c.updateMatrixWorld();
      const head = new THREE.Vector3(root[0], root[1] + CONTACT_SHOT.head, root[2]).project(c);
      const m = new THREE.Vector3(...mask).project(c);
      // было 37 % (неподвижная камера в ~6.8 м, fov 50)
      expect(Math.abs(head.y - m.y) / 2).toBeGreaterThan(0.45);
      // оба — внутри кадра с леттербоксом (12–88 % высоты)
      for (const p of [head, m]) expect(Math.abs(p.y)).toBeLessThan(0.76);
      // со стороны Пилота (z > маски), не сквозь тело босса; после контакта — наезд
      expect(cam.path[0][2]).toBeGreaterThan(mask[2]);
      const d = (p: number[]) => Math.hypot(p[0] - mask[0], p[1] - mask[1], p[2] - mask[2]);
      expect(d(cam.path.at(-1)!)).toBeLessThan(d(cam.path[0]));
    }
  });

  it('казнь — прямой прыжок: ни бега по цепи, ни дополнительного касания; взрыв раньше посадки', () => {
    const tr = executionTrack({ bx: 0, bz: 0, hx: 0, hz: 8, bellY: 3, lx: 0, lz: -3, star: [0.42, -0.5, -0.76] });
    for (const steps of [tr.steps, tr.short!]) {
      expect(steps.some((s) => s.do === 'tap' || s.do === 'wait')).toBe(false);
      expect(steps.some((s) => (s.do === 'clip' || s.do === 'actor') && s.clip?.startsWith('chain'))).toBe(false);
      expect(steps.some((s) => s.do === 'clip' && s.clip === 'executionLeap')).toBe(true);
    }
    expect(EXEC_T.cut).toBeLessThan(EXEC_T.touchdown);
    expect(EXEC_SHORT_T.cut).toBeLessThan(EXEC_SHORT_T.touchdown);
    expect(tr.steps.filter((s) => s.do === 'time' && s.scale <= 0.2).length).toBeGreaterThanOrEqual(2);
  });

  it('казнь: в финале свет звезды доходит до Пилота — один раз, со стороны звезды, и при пропуске', () => {
    for (const mode of ['full', 'short', 'skip'] as const) {
      const { w, b, ctrl, tick, log, director } = toPhase3(mode === 'short' ? 2 : 0);
      b.hp = b.maxHp * EXEC_HP - 1; w.stunEnemy(b); ctrl.execute();
      if (mode === 'skip') { tick(1); director.skip(); }
      tick(EXEC_T.end + 1);
      const lit = log.filter((x) => x.startsWith('starLight:'));
      expect(lit).toEqual(['starLight:0.42,-0.5,-0.76']);
      // свет — после луча к звезде: сначала звезда, потом её свет на герое
      expect(log.indexOf('beam')).toBeLessThan(log.indexOf(lit[0]));
      w.hero.avatar.dispose();
    }
  });

  it('казнь: стыки сценических клипов без скачка позы — смена клипа смешивается во времени сцены', () => {
    const { w, b, ctrl, tick, director } = toPhase3();
    b.hp = b.maxHp * EXEC_HP - 1; w.stunEnemy(b); ctrl.execute();
    const rot = w.hero.avatar.puppet.skel.rot, n = w.hero.avatar.puppet.layout.n;
    // Стыки подготовки прыжка, удара, полёта после контакта и восстановления.
    const starts = [0, EXEC_T.strike, EXEC_T.land, EXEC_T.calm];
    let prev = Float32Array.from(rot), worst = 0, worstSeam = 0, seamAt = -1;
    tick(EXEC_T.end, () => {
      const t = director.time;
      let m = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(prev[i * 4] * rot[i * 4] + prev[i * 4 + 1] * rot[i * 4 + 1] + prev[i * 4 + 2] * rot[i * 4 + 2] + prev[i * 4 + 3] * rot[i * 4 + 3]);
        m = Math.max(m, 2 * Math.acos(Math.min(1, d)));
      }
      prev.set(rot);
      worst = Math.max(worst, m);
      if (starts.some((s) => t >= s && t < s + 3 * DT) && m > worstSeam) { worstSeam = m; seamAt = t; }
    });
    // на стыке — не больше 20° за кадр (было 168° у плеча на прыжке: клинок за кадр оказывался над головой);
    // быстрее всего — авторский удар в маску (inExpo, ~38°/кадр)
    expect(worstSeam, `стык в ${seamAt.toFixed(3)} с`).toBeLessThan(0.35);
    expect(worst).toBeLessThan(0.75);
    w.hero.avatar.dispose();
  });

  it('казнь: пропуск каждого крупного плана не дублирует смерть/награду и освобождает героя', () => {
    for (const skipAt of [0.2, EXEC_T.jump + 0.1, EXEC_T.contact + 0.1, EXEC_T.land + 0.1, EXEC_T.cut + 0.1, EXEC_T.beam + 0.1]) {
      const { w, b, ctrl, tick, log, director } = toPhase3();
      let kills = 0;
      w.bus.on('kill', (e) => { if (e.kind === 'hierophant') kills++; });
      b.hp = b.maxHp * EXEC_HP - 1; w.stunEnemy(b); ctrl.execute();
      tick(skipAt); director.skip(); tick(0.3); director.skip();
      expect(kills).toBe(1);
      expect(log.filter((s) => s.startsWith('star:'))).toHaveLength(1);
      expect(log.filter((s) => s === 'finish')).toHaveLength(1);
      expect(w.hero.scripted).toBe(false);
      expect(w.hero.avatar.puppet.anim.sceneDriven).toBe(false);
      w.hero.avatar.dispose();
    }
  });

  it('короткая казнь сохраняет точный контакт и тот же финал без второй сцены победы', () => {
    const { w, b, ctrl, tick, log, director } = toPhase3(2);
    b.hp = b.maxHp * EXEC_HP - 1; w.stunEnemy(b); ctrl.execute();
    expect(director.short).toBe(true);
    tick(EXEC_SHORT_T.end + 0.5);
    expect(b.dead).toBe(true);
    expect(director.active).toBe(false);
    expect(log.filter((s) => s === 'strike')).toHaveLength(1);
    expect(log.filter((s) => s === 'finish')).toHaveLength(1);
    expect(w.hero.scripted).toBe(false);
    w.hero.avatar.dispose();
  });

  it('контакт привязан к маске и действительному кончику оружия при разных сторонах подхода', () => {
    for (const facing of [0, 0.8, Math.PI, -1.2]) {
      const { w, b, ctrl, tick, host } = toPhase3();
      w.hero.x = b.x - Math.sin(facing) * 5; w.hero.z = b.z - Math.cos(facing) * 5;
      b.hp = b.maxHp * EXEC_HP - 1; w.stunEnemy(b);
      let distance = Infinity;
      host.flash = (v) => {
        if (v !== EXEC_FLASH) return;
        const tip = w.hero.avatar.sceneAnchor('bladeTip', new THREE.Vector3());
        distance = tip.distanceTo(b.bellPos(new THREE.Vector3()));
      };
      ctrl.execute(); tick(EXEC_T.contact + 0.1);
      expect(distance).toBeLessThan(0.001);
      w.hero.avatar.dispose();
    }
  });

  it('дорожка казни: 7–9 с, контакт задан специальным клипом, замедления имеют плавный вход', () => {
    const tr = executionTrack({ bx: 0, bz: 0, hx: 0, hz: 6, cx: 0, cz: 2.6, bellY: 6, lx: 0, lz: -3.2, star: [0.42, -0.5, -0.76] });
    expect(tr.dur).toBeGreaterThanOrEqual(7);
    expect(tr.dur).toBeLessThanOrEqual(9);
    const actions = tr.steps.flatMap((s) => s.do === 'call' ? [{ t: s.t, fn: s.fn }]
      : s.do === 'clip' ? (EXECUTION_CLIPS.find((c) => c.id === s.clip)?.events ?? []).filter((e) => s.markers?.[e.name]).map((e) => ({ t: s.t + e.t / (s.speed ?? 1), fn: s.markers![e.name] })) : []);
    const order = actions.sort((a, b) => a.t - b.t).map((s) => s.fn).filter((fn) => fn !== 'brace' && fn !== 'chainStep');
    expect(order).toEqual(['freeze', 'flare', 'strike', 'toll', 'fracture', 'cut', 'beam', 'star2', 'calm', 'end']);
    expect(actions.find((s) => s.fn === 'strike')!.t).toBeCloseTo(EXEC_T.strike + MASK_CONTACT);
    expect(tr.steps.some((s) => (s.do === 'actor' || s.do === 'clip') && (s.clip === 'dash' || s.clip === 'skyfall'))).toBe(false);
    expect(tr.steps.filter((s) => s.do === 'time').every((s) => s.do === 'time' && s.rampIn !== undefined && s.rampOut !== undefined)).toBe(true);
    expect(tr.steps.some((s) => s.do === 'say' && s.line === 'Одна звезда. Осталось четыре.')).toBe(true);
    expect(tr.steps.some((s) => s.do === 'sky' && s.param === 'starLit' && s.to === 1)).toBe(true);
  });

  it('ревью: в интро маска и руки видны крупно — благословение под голос', () => {
    const tr = hierophantIntroTrack({ hx: 0, hz: 8, bx: 0, bz: -6 });
    const cam = tr.steps.find((s) => s.do === 'cam' && s.t === INTRO_T.mask);
    expect(cam && cam.do === 'cam').toBeTruthy();
    if (!cam || cam.do !== 'cam') return;
    const end = cam.path[cam.path.length - 1], look = cam.look[cam.look.length - 1];
    expect(Math.hypot(end[0] - 0, end[1] - MASK_Y, end[2] + 6)).toBeLessThan(4.5);
    expect(Math.abs(look[1] - MASK_Y)).toBeLessThan(0.4);
    expect(tr.steps.some((s) => s.do === 'call' && s.fn === 'bless' && s.t === INTRO_T.mask)).toBe(true);
    const say = tr.steps.find((s) => s.do === 'say')!;
    expect(say.t).toBeGreaterThanOrEqual(INTRO_T.mask);
    expect(say.t).toBeLessThan(INTRO_T.slam);
  });

  it('казнь: корень учитывает настоящий вынос клинка к маске; вспышка принадлежит маркеру', () => {
    const mask: [number, number, number] = [0.2, 2.8, 0.85];
    const tr = executionTrack({ bx: 0, bz: 0, hx: 0, hz: 6, cx: 0, cz: 2.6, bellY: 4, lx: 0, lz: -3.2, star: [0.42, -0.5, -0.76], mask });
    const strike = tr.steps.find((s) => s.do === 'actor' && s.t === EXEC_T.strike);
    expect(strike && strike.do === 'actor' ? strike.moveTo : null).toEqual(maskContactRoot(mask, Math.PI));
    expect(strike && strike.do === 'actor' ? strike.dur : null).toBe(MASK_CONTACT);
    const strikeClip = tr.steps.find((s) => s.do === 'clip' && s.t === EXEC_T.strike);
    expect(strikeClip && strikeClip.do === 'clip' ? strikeClip.markers?.contact : null).toBe('strike');
    const flashes = tr.steps.filter((s) => s.do === 'flash');
    expect(flashes).toHaveLength(0);
    expect(EXEC_FLASH).toBeLessThanOrEqual(0.15);
  });
});
