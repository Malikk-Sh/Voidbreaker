import { describe, expect, it } from 'vitest';
import { ZONE1 } from '../src/data/stages';
import { ARENAS } from '../src/data/arenas';
import { BELL_STANDS } from '../src/data/echoBells';
import { Arena } from '../src/world/arena';
import { overlaps } from '../src/world/combat';
import { World, type StrikeParams } from '../src/world/world';
import { Abilities } from '../src/world/abilities';
import { createEnemy } from '../src/world/enemies/factory';
import { Devourer, HUNT } from '../src/world/boss/devourer';
import { DevourerEncounter } from '../src/world/boss/devourerEncounter';
import type { BossHost } from '../src/world/boss/hierophant';
import { buildDevourer } from '../src/gen/chars/devourer';
import { DEVOURER_CLIPS } from '../src/anim/clips/devourer';
import { devourerIntro, LANDING } from '../src/world/boss/devourerScenes';
import { CameraRig } from '../src/world/camera';
import { Director } from '../src/game/director';

const hit: StrikeParams = { mult: 1, stun: 0, knockback: 0, feel: 'light', dirX: 0, dirZ: 1, source: 'blade' };
const dt = 1 / 60;
function setup() {
  const stage = ZONE1.find((s) => s.id === 'boss1')!;
  const w = new World(new Arena(ARENAS[stage.arena]), 'devourer-test');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 5, Math.PI);
  const b = createEnemy(stage.waves[0].spawns[0].enemy, { zone: 0, stage: 0 }) as Devourer;
  w.addEnemy(b);
  b.x = 0;
  b.z = -1;
  b.beginHunt(1);
  return { b, w };
}
function advance(b: Devourer, w: World, until: () => boolean, limit = 600) {
  for (let i = 0; i < limit && !until(); i++) {
    w.time += dt;
    b.step(w, dt);
  }
  expect(until()).toBe(true);
}
function ring(w: World, i = 0, list = new Set<number>(), source: StrikeParams['source'] = 'blade') {
  const { x, z } = (w.enemies[0] as Devourer).bells[i];
  w.heroStrike({ k: 'circle', x, z, r: 0.55 }, list, { ...hit, source });
}
describe('Пожиратель', () => {
  it('обитает в открытой каменоломне; все три подвеса достижимы с обеих сторон', () => {
    const { b, w } = setup();
    expect(b).toBeInstanceOf(Devourer);
    expect(b.def.name).toBe('Пожиратель');
    expect(w.arena.def.decor).toBe('quarry');
    for (const p of BELL_STANDS) for (const side of [-1, 1]) expect(w.arena.walkable(p.x + 1.2 * side, p.z)).toBe(true);
    expect(w.aimTargets.size).toBe(3);
    w.hero.x = BELL_STANDS[0].x;
    w.hero.z = BELL_STANDS[0].z;
    expect([...w.aimTargets].filter((t) => t.targetable)).toHaveLength(1);
    ring(w);
    expect([...w.aimTargets].every((t) => !t.targetable)).toBe(true);
  });
  it('реагирует на клинок один раз за взмах; способность или удар вдали не звонят', () => {
    const { b, w } = setup();
    const hits = new Set<number>();
    let count = 0;
    w.bus.on('bellPulse', (e) => {
      if (e.big) count++;
    });
    ring(w, 0, hits, 'ability');
    w.heroStrike({ k: 'circle', x: 3, z: 7, r: 0.7 }, hits, hit);
    expect(count).toBe(0);
    ring(w, 0, hits);
    ring(w, 0, hits);
    ring(w, 0);
    expect(count).toBe(1);
    expect(b.inWindow).toBe(true);
    expect(b.opening).toBe('bell');
    expect(b.chordMask).toBe(1);
  });
  it('звон мгновенно валит зверя на месте и обрывает уже начавшийся прыжок', () => {
    const { b, w } = setup();
    b['begin'](w, 'pounce');
    const landing = b.tele!;
    advance(b, w, () => b.motion === 'active' && b.y > 0.5);
    const position = [b.x, b.z];
    const before = b.hp;
    ring(w);
    expect(b.inWindow).toBe(true);
    expect(b.y).toBe(0);
    expect([b.x, b.z]).toEqual(position);
    expect(landing.alive).toBe(false);
    expect(b.hp).toBe(before);
    w.hero.x = 8;
    w.hero.z = -7;
    const hp = b.hp;
    w.damageEnemy(b, hit);
    const open = hp - b.hp;
    const end = b.duration;
    b.step(w, dt);
    const pose = b.puppet.skel.rot.slice();
    w.damageEnemy(b, hit);
    b.step(w, dt * 4);
    expect(b.puppet.skel.rot).not.toEqual(pose);
    expect(b.duration).toBe(end);
    advance(b, w, () => b.motion === 'hunt');
    const shell = b.hp;
    w.damageEnemy(b, hit);
    expect(open).toBeGreaterThan((shell - b.hp) * 2);
  });
  it('промах по герою не открывает шею; в третьей фазе перед повторным броском есть новая метка', () => {
    const { b, w } = setup();
    b['begin'](w, 'rush');
    b.phase = 3;
    expect(b.attack).toBe('rush');
    const first = b.tele;
    advance(b, w, () => b.motion === 'active');
    w.hero.x = 6;
    w.hero.z = 1;
    advance(b, w, () => b.motion === 'aim');
    expect(b.tele).not.toBe(first);
    expect(b.lastTeleDur).toBeGreaterThanOrEqual(0.8);
    expect(b.inWindow).toBe(false);
    advance(b, w, () => b.motion === 'recover');
    expect(b.hp).toBe(b.maxHp);
  });
  it('в Исступлении все три колокола остаются на подвесах во время атак', () => {
    const { b, w } = setup();
    b.phase = 2;
    w.hero.invulnUntil = 1e6;
    for (let i = 0; i < 60 * 24; i++) b.step(w, dt);
    expect(b.bells.map(({ x, z }) => ({ x, z }))).toEqual(BELL_STANDS);
    expect(b.hp).toBe(b.maxHp);
  });

  it('первый ход фиксирует струну по следу Пилота. Узел отвечает только на клинок', () => {
    const { b, w } = setup();
    b.beginHunt(0);
    advance(b, w, () => b.strings.active);
    const [line] = b.strings.lines;
    const { x, z } = line.knot;
    expect(w.aimTargets.has(line.target)).toBe(true);
    expect(w.arena.walkable(x, z)).toBe(true);
    expect(overlaps(line.lane, w.hero.x, w.hero.z, w.hero.radius)).toBe(true);
    const target = { k: 'circle' as const, x, z, r: 0.5 };
    w.heroStrike(target, new Set(), hit);
    expect(line.cut).toBe(false);
    w.hero.x = x; w.hero.z = z;
    w.heroStrike(target, new Set(), { ...hit, source: 'ability' });
    expect(line.cut).toBe(false);
    w.heroStrike(target, new Set(), hit);
    expect(b.opening).toBe('sever');
    expect(line.warning?.alive).toBe(false);
    expect(w.aimTargets.has(line.target)).toBe(false);
  });

  it('две струны помнят разные позиции. Один разрез отменяет только свой удар, два открывают горло', () => {
    const { b, w } = setup();
    b.phase = 2;
    b['begin'](w, 'strings');
    const [first] = b.strings.lines, sweep = new Set<number>();
    const cut = (point: { x: number; z: number }, list: Set<number>) => {
      w.hero.x = point.x; w.hero.z = point.z;
      w.heroStrike({ k: 'circle', ...point, r: 0.3 }, list, hit);
    };
    cut(first.knot, sweep);
    w.hero.x = 4; w.hero.z = -2;
    advance(b, w, () => b.strings.lines.length === 2);
    const second = b.strings.lines[1];
    expect(second.bell).not.toBe(first.bell);
    expect(overlaps(second.lane, 4, -2, w.hero.radius)).toBe(true);
    expect(b.inWindow).toBe(false);
    cut(second.knot, sweep);
    expect(second.cut).toBe(false);
    cut(second.knot, new Set());
    expect(b.opening).toBe('sever');
    expect(b.strings.active).toBe(false);
  });

  it('пропущенная пара в Исступлении заканчивается прыжком с отдельной меткой', () => {
    const { b, w } = setup(); b.phase = 2; w.hero.invulnUntil = 1e6;
    b['begin'](w, 'strings');
    advance(b, w, () => b.attack === 'pounce');
    expect(b.tele?.shape.k).toBe('circle');
    expect(b.lastTeleDur).toBeGreaterThan(0.8);
  });

  it('последняя фаза предупреждает об обратном проходе. Звон гасит его вместе со второй струной', () => {
    const { b, w } = setup(); b.phase = 3; w.hero.invulnUntil = 1e6;
    b['begin'](w, 'strings');
    const [line] = b.strings.lines;
    advance(b, w, () => line.reversing);
    expect(line.warning?.alive).toBe(true);
    expect(line.warning!.dur).toBeGreaterThan(0.9);
    expect(b.strings.available(line)).toBe(false);
    advance(b, w, () => line.reversing && line.flight !== null && line.flight < 0.9);
    const start = line.flight!;
    b.step(w, dt);
    expect(line.flight!).toBeLessThan(start);
    const warnings = b.strings.lines.map(l => l.warning);
    ring(w, 2);
    expect(b.strings.active).toBe(false);
    expect(warnings.every(t => t && !t.alive)).toBe(true);
    expect(w.aimTargets.size).toBe(3);
  });
  it('у повторного звонка есть общая пауза, а три разных колокола складываются в аккорд', () => {
    const { b, w } = setup();
    w.hero.invulnUntil = 1e6;
    ring(w, 0);
    const firstWindow = b.duration;
    ring(w, 1);
    expect(b.chordMask).toBe(0b001);
    advance(b, w, () => !b.inWindow);
    expect(b.bellReady(1)).toBe(false);
    advance(b, w, () => b.bellReady(1));
    expect(b.bellReady(0)).toBe(false);
    ring(w, 1);
    expect(b.chordMask).toBe(0b011);
    advance(b, w, () => b.bellReady(2));
    const hp = b.hp;
    ring(w, 2);
    expect(b.opening).toBe('chord');
    expect(b.duration).toBeGreaterThan(firstWindow);
    expect(hp - b.hp).toBe(Math.round(b.maxHp * HUNT.chordDamage));
    expect(b.chordMask).toBe(0);
  });

  it('без продолжения аккорд затихает, а своевременный удар срывает замах сильнее обычного', () => {
    const { b, w } = setup();
    w.hero.invulnUntil = 1e6;
    ring(w);
    advance(b, w, () => b.chordLeft <= 0, 60 * 60);
    expect(b.chordMask).toBe(0);
    expect(b.bellReady(0)).toBe(true);
    b['begin'](w, 'rake');
    w.hero.dashCharges = 0;
    const warning = b.tele!;
    advance(b, w, () => b.duration - b.elapsed < 0.18);
    ring(w, 1);
    expect(b.opening).toBe('downbeat');
    expect(b.duration).toBeGreaterThanOrEqual(HUNT.bellStun[b.phase - 1] + HUNT.downbeatBonus);
    expect(w.hero.dashCharges).toBe(1);
    expect(warning.alive).toBe(false);
    expect(b.chordMask).toBe(0b010);
  });

  it('в Исступлении серия по неподвижной цели смыкает маску. Фланг и время оглушения сохраняются', () => {
    const { b, w } = setup(); b.phase = 2;
    ring(w);
    const duration = b.duration;
    b.onDamaged(w, Math.ceil(b.maxHp * 0.08));
    expect(b.throatGuard).toBe(true);
    w.hero.x = b.x + Math.sin(b.facing) * 2; w.hero.z = b.z + Math.cos(b.facing) * 2;
    b.preHit(w, hit); expect(b.armor).toBeGreaterThan(150);
    w.hero.x = b.x + Math.cos(b.facing) * 2; w.hero.z = b.z - Math.sin(b.facing) * 2;
    b.preHit(w, hit); expect(b.armor).toBe(0);
    expect(b.duration).toBe(duration);
  });
  it('сильный удар по оглушённому зверю не сокращает оставшееся время для серии', () => {
    const { b, w } = setup();
    ring(w);
    const duration = b.duration;
    w.damageEnemy(b, { ...hit, mult: 25 });
    b.step(w, dt);
    expect(b.maxHp - b.hp).toBeGreaterThan(b.maxHp * 0.085);
    expect(b.inWindow).toBe(true);
    expect(b.duration).toBe(duration);
  });

  it('колокол гасит только волны Пожирателя', () => {
    const { b, w } = setup();
    const other = w.addRingWave(1, 2, 4, 0.5, 7, [], 5, b.id + 1);
    b.phase = 3;
    b['begin'](w, 'howl');
    advance(b, w, () => w.ringWaves.length === 2);
    ring(w);
    expect(w.ringWaves).toEqual([other]);
    advance(b, w, () => b.elapsed > 1);
    expect(w.ringWaves).toEqual([other]);
  });

  it('после одиночной ноты эхо бежит к тому же колоколу и расходится от него волной с проходом', () => {
    const { b, w } = setup();
    ring(w, 2);
    expect(w.ringWaves).toHaveLength(0);
    advance(b, w, () => b.attack === 'reprise');
    const ray = b.tele!.shape, bell = b.bells[2];
    expect(ray.k).toBe('line');
    if (ray.k !== 'line') throw Error('Missing return lane');
    expect([ray.x + ray.dx * ray.len, ray.z + ray.dz * ray.len]).toEqual([bell.x, bell.z]);
    const rim = w.telegraphs.find(t => t.alive && t.shape.k === 'ring')!;
    expect(rim.dur).toBeGreaterThan(1);
    advance(b, w, () => w.ringWaves.length > 0);
    const wave = w.ringWaves[0];
    expect([wave.x, wave.z]).toEqual([bell.x, bell.z]);
    expect(wave.gaps).toEqual(rim.shape.k === 'ring' && rim.shape.gaps);
    expect(wave.owner).toBe(b.id);
  });

  it('точный звон оставляет безопасное окно без обратного эха', () => {
    const { b, w } = setup();
    b['begin'](w, 'fault');
    advance(b, w, () => b.downbeat);
    ring(w, 1);
    expect(b.opening).toBe('downbeat');
    advance(b, w, () => !b.inWindow);
    expect(b.attack).not.toBe('reprise');
    expect(w.ringWaves).toHaveLength(0);
  });

  it('кольцо хвоста оставляет у лап место для контратаки', () => {
    const { b, w } = setup();
    b.x = BELL_STANDS[1].x; b.z = BELL_STANDS[1].z;
    w.hero.x = b.x - 2.1; w.hero.z = b.z;
    b['begin'](w, 'sweep');
    expect(b.tele?.shape.k).toBe('ring');
    expect(w.telegraphs.some(t => t.shape.k === 'arc')).toBe(true);
    const hpAfterSwing = b.hp;
    w.hero.x = b.x; w.hero.z = b.z + 2;
    advance(b, w, () => b.inWindow);
    expect(b.opening).toBe('shoulder');
    expect(w.run.hitsTaken).toBe(0);
    expect(b.hp).toBe(hpAfterSwing);
    const outside = setup();
    outside.b.x = b.x; outside.b.z = b.z;
    outside.w.hero.x = b.x - 4.5; outside.w.hero.z = b.z;
    outside.b['begin'](outside.w, 'sweep');
    advance(outside.b, outside.w, () => outside.b.motion === 'recover');
    expect(outside.w.run.hitsTaken).toBe(1);
  });

  it('охота на слух различает тишину и шум клинка и бьёт по месту звука', () => {
    const quiet = setup();
    quiet.b.phase = 2; quiet.b['begin'](quiet.w, 'listen');
    advance(quiet.b, quiet.w, () => quiet.b.attack === 'listen');
    advance(quiet.b, quiet.w, () => quiet.b.inWindow);
    expect(quiet.b.opening).toBe('silence');
    const { b, w } = setup();
    b.phase = 2; b['begin'](w, 'listen');
    advance(b, w, () => b.attack === 'listen' && b.elapsed > 0.56);
    w.bus.emit('swing', { kind: 'light' });
    advance(b, w, () => w.telegraphs.some(t => t.echo));
    const t = w.telegraphs.find(t => t.echo)!;
    const original = [t.shape.x, t.shape.z];
    expect(t.dur).toBeGreaterThanOrEqual(0.75);
    w.hero.x = 7;
    advance(b, w, () => b.attack === 'pounce');
    expect([b.targetX, b.targetZ]).toEqual(original);
    expect(w.run.hitsTaken).toBe(0);
    expect(b.inWindow).toBe(false);
  });

  it('удар по звучащему колоколу обрывает обе намеченные линии переклички', () => {
    const { b, w } = setup();
    b.phase = 3;
    b['begin'](w, 'crosscall');
    advance(b, w, () => b.bells.filter((_, i) => b.echoes.isCalling(i)).length === 2);
    const lines = w.telegraphs.filter(t => t.alive && t.echo);
    expect(lines.map(t => t.shape.k)).toEqual(['line', 'line']);
    const bell = b.bells.findIndex((_, i) => b.echoes.isCalling(i));
    ring(w, bell);
    expect(b.inWindow).toBe(true);
    expect(lines.every(t => !t.alive)).toBe(true);
    expect(b.bells.some((_, i) => b.echoes.isCalling(i))).toBe(false);
    const hits = w.run.hitsTaken;
    advance(b, w, () => b.elapsed >= 1);
    expect(w.run.hitsTaken).toBe(hits);
  });

  it('переход убирает незавершённые эхо, в броню спереди проходит меньше урона, чем с тыла', () => {
    const { b, w } = setup();
    b.facing = 0;
    w.damageEnemy(b, { ...hit, dirZ: -1, mult: 7 });
    const frontal = b.maxHp - b.hp, before = b.hp;
    w.damageEnemy(b, { ...hit, dirZ: 1, mult: 7 });
    expect(before - b.hp).toBeGreaterThan(frontal * 1.5);
    b.phase = 3; b['begin'](w, 'crosscall');
    advance(b, w, () => b.attack === 'crosscall');
    b.enterScene('shift');
    expect(w.telegraphs.filter(t => t.echo && t.alive)).toHaveLength(0);
    expect(b.bells.some((_, i) => b.bellReady(i))).toBe(false);
  });

  it('при серии после тихой охоты весь завершающий удар проходит, затем зверь предупреждает об ответе', () => {
    const { b, w } = setup();
    b['begin'](w, 'listen');
    advance(b, w, () => b.inWindow);
    w.hero.x = b.x + 2; w.hero.z = b.z;
    const hp = b.hp;
    w.damageEnemy(b, { ...hit, mult: 24 });
    expect(hp - b.hp).toBeGreaterThan(b.maxHp * 0.135);
    b.step(w, dt);
    expect(b.motion).toBe('aim');
    expect(b.attack).toBe('rake');
    expect(b.tele?.shape.k).toBe('arc');
    expect(w.run.hitsTaken).toBe(0);
  });

  it('даже внутри кольца перед пастью опасно, а обе метки гаснут при смене фазы', () => {
    const { b, w } = setup();
    b.x = BELL_STANDS[0].x; b.z = BELL_STANDS[0].z;
    w.hero.x = b.x + 2.1; w.hero.z = b.z;
    b['begin'](w, 'sweep');
    const marks = w.telegraphs.filter(t => t.alive);
    expect(marks.map(t => t.shape.k).sort()).toEqual(['arc', 'ring']);
    advance(b, w, () => b.motion === 'recover');
    expect(w.run.hitsTaken).toBe(1);
    expect(b.inWindow).toBe(false);
    const other = setup();
    other.b.x = BELL_STANDS[0].x; other.b.z = BELL_STANDS[0].z;
    other.b['begin'](other.w, 'sweep');
    other.b.enterScene('shift');
    expect(other.w.telegraphs.some(t => t.alive)).toBe(false);
  });

  it('серия вблизи вызывает отскок с обозначенной траекторией, всплеск от дальней способности — нет', () => {
    const { b, w } = setup();
    w.hero.x = b.x; w.hero.z = b.z + 2.1;
    for (let i = 0; i < 4; i++) w.damageEnemy(b, { ...hit, source: 'ability' });
    b.step(w, dt);
    expect(b.motion).toBe('hunt');
    for (let i = 0; i < 3; i++) w.damageEnemy(b, hit);
    b.step(w, dt);
    expect(b.attack).toBe('snap');
    const tele = b.tele!;
    expect(tele.shape.k).toBe('line');
    expect(tele.dur).toBeGreaterThan(0.7);
    const z = b.z;
    const target = [b.targetX, b.targetZ];
    w.hero.x += 4;
    advance(b, w, () => b.motion === 'active');
    expect(b.z).toBeLessThan(z);
    expect([b.targetX, b.targetZ]).toEqual(target);
    advance(b, w, () => b.motion === 'recover');
    expect(w.run.hitsTaken).toBe(0);
  });

  it('без перехвата за двумя линиями следуют две волны, разрыв второй виден заранее', () => {
    const { b, w } = setup();
    w.hero.invulnUntil = 1e6;
    b.phase = 3; b['begin'](w, 'crosscall');
    advance(b, w, () => b.attack === 'howl' && b.motion === 'active');
    expect(w.ringWaves).toHaveLength(1);
    const next = b.tele!;
    expect(next.shape.k).toBe('ring');
    expect(next.dur).toBeGreaterThan(0.9);
    advance(b, w, () => w.ringWaves.length === 2);
    const [first, second] = w.ringWaves;
    expect(Math.abs(first.gaps[0].a - second.gaps[0].a)).toBeCloseTo(Math.PI / 2);
    expect(next.shape.k === 'ring' && next.shape.gaps).toEqual(second.gaps);
  });

  it.each([[1, 'fault'], [2, 'caveIn'], [3, 'inhale']] as const)(
    'в фазе %s зверь выбирает %s через обычный цикл охоты', (phase, attack) => {
      const { b, w } = setup();
      w.hero.invulnUntil = 1e6;
      b.phase = phase;
      b.beginHunt(0);
      advance(b, w, () => b.attack === attack && b.motion === 'aim', 60 * 40);
      expect(b.invulnerable).toBe(false);
    }
  );

  it.each(['fault', 'caveIn', 'inhale'] as const)('звон обрывает %s вместе с дальнейшими ударами', attack => {
    const { b, w } = setup();
    b.phase = 3;
    b['begin'](w, attack);
    advance(b, w, () => w.telegraphs.some(t => t.alive));
    const marks = [...w.telegraphs];
    ring(w);
    expect(b.inWindow).toBe(true);
    expect(marks.every(t => !t.alive)).toBe(true);
    expect(b.patterns.kind).toBeNull();
    const count = w.telegraphs.length;
    advance(b, w, () => b.elapsed > 0.9);
    expect(w.telegraphs).toHaveLength(count);
    expect(w.run.hitsTaken).toBe(0);
  });

  it('между боковыми разломами можно переждать первый удар, затем выйти из средней полосы пешком', () => {
    const { b, w } = setup();
    b['begin'](w, 'fault');
    const [left, right, middle] = b.patterns.marks;
    const h = w.hero;
    for (const m of [left, right]) expect(overlaps(m.shape, h.x, h.z, h.radius)).toBe(false);
    advance(b, w, () => middle.warning !== null);
    expect(left.struck && right.struck).toBe(true);
    expect(w.run.hitsTaken).toBe(0);
    expect(overlaps(middle.shape, h.x, h.z, h.radius)).toBe(true);
    expect(middle.at - b.elapsed).toBeGreaterThan(0.85);
    h.x += 3;
    advance(b, w, () => middle.struck);
    expect(w.run.hitsTaken).toBe(0);
  });

  it('камни и прыжок обвала падают каждый в свою отмеченную точку', () => {
    const { b, w } = setup();
    b['begin'](w, 'caveIn');
    const [first, second, leap] = b.patterns.marks;
    w.hero.x += 4;
    advance(b, w, () => second.warning !== null);
    expect(second.shape.x - first.shape.x).toBeGreaterThan(3.5);
    w.hero.z -= 4;
    advance(b, w, () => leap.warning !== null);
    expect(leap.shape.z).not.toBe(second.shape.z);
    w.hero.x -= 4;
    advance(b, w, () => b.y > 1);
    advance(b, w, () => leap.struck);
    expect(b.y).toBeCloseTo(0);
    expect([b.x, b.z]).toEqual([leap.shape.x, leap.shape.z]);
    expect(w.run.hitsTaken).toBe(0);
  });

  it('вдох тянет только в секторе, направление выдоха фиксируется при замахе', () => {
    const { b, w } = setup();
    b['begin'](w, 'inhale');
    const [maw, vent] = b.patterns.marks;
    expect(maw.shape.k).toBe('arc');
    const z = w.hero.z;
    advance(b, w, () => b.elapsed > 0.55);
    expect(w.hero.z).toBeLessThan(z - 0.25);
    w.hero.x = 7;
    const safe = [w.hero.x, w.hero.z];
    advance(b, w, () => vent.warning !== null);
    expect([w.hero.x, w.hero.z]).toEqual(safe);
    expect(overlaps(vent.shape, safe[0], safe[1], w.hero.radius)).toBe(false);
    advance(b, w, () => vent.struck);
    expect(w.run.hitsTaken).toBe(0);
  });

  it('ранний повтор той же ноты не добавляет голос и не продлевает срок аккорда', () => {
    const { b, w } = setup();
    w.hero.invulnUntil = 1e6;
    const notes: number[] = [];
    w.bus.on('bellResonance', e => notes.push(e.notes));
    ring(w, 2);
    advance(b, w, () => b.bellReady(2), 60 * 20);
    const remaining = b.chordLeft;
    ring(w, 2);
    expect(notes).toEqual([1, 1]);
    expect(b.chordLeft).toBe(remaining);
    expect(b.opening).not.toBe('chord');
  });

  it.each(['full', 'short', 'skip'] as const)(
    'вступление %s возвращает одного живого босса и безопасный первый замах',
    (variant) => {
      const { w, b } = setup();
      let calls: Record<string, (arg?: number) => void> = {};
      const director = new Director({
        actor: (id) => (id === 'boss' ? b : id === 'echoStone' ? b.stone : id === 'hero' ? w.hero : null),
        call: (fn) => calls[fn]?.(),
        holding: () => false,
        tapped: () => false,
        seen: () => (variant === 'short' ? 2 : 0),
        markSeen: () => {},
      });
      const host = {
        world: w,
        scene: (track, c, end) => {
          calls = c;
          director.play(track, end);
        },
        startSong: () => {},
      } as Pick<BossHost, 'world' | 'scene' | 'startSong'>;
      const encounter = new DevourerEncounter(host as BossHost, b, () => {});
      expect(encounter.hudBoss()).toBeNull();
      const cam = new CameraRig();
      if (variant === 'skip') director.skip();
      for (let i = 0; director.active && i < 800; i++) director.update(dt, cam);
      expect(b.motion).toBe('hunt');
      expect([b.x, b.y, b.z]).toEqual(LANDING);
      expect(encounter.hudBoss()).toBe(b);
      expect(b.duration).toBeGreaterThan(0.7);
    }
  );
  it('один большой удар не пропускает ни фазу, ни смерть; награда выдаётся один раз', () => {
    const { b, w } = setup();
    let ended = 0,
      stars = 0;
    const host = {
      world: w,
      scene: (track, c, end) => {
        for (const s of track.steps) if (s.do === 'call') c[s.fn]?.(s.arg);
        end(true);
      },
      startSong: () => {},
      musicPhase: () => {},
      sky: () => {},
      beam: () => {},
      finishFight: () => ended++,
      saveStar: () => stars++,
    } as Pick<BossHost, 'world' | 'scene' | 'startSong' | 'musicPhase' | 'sky' | 'beam' | 'finishFight' | 'saveStar'>;
    const enc = new DevourerEncounter(host as BossHost, b, () => {});
    for (const phase of [2, 3]) {
      w.damageEnemy(b, { ...hit, mult: 2000 });
      expect(b.invulnerable).toBe(true);
      expect(b.dead).toBe(false);
      enc.step(dt);
      expect(b.phase).toBe(phase);
    }
    w.damageEnemy(b, { ...hit, mult: 2000 });
    enc.step(dt);
    enc.step(dt);
    expect(b.dead).toBe(true);
    expect(w.run.kills).toBe(1);
    expect([ended, stars]).toEqual([1, 1]);
  });
  it('все кости клипов существуют, модель укладывается в мобильный батч, падение камня предшествует броску', () => {
    const { rig, geometry } = buildDevourer();
    const names = new Set(rig.joints.map((j) => j.name));
    for (const c of DEVOURER_CLIPS)
      for (const k of c.keys) for (const n of Object.keys(k.pose)) expect(names.has(n)).toBe(true);
    const count = geometry.attributes.position.count;
    expect(count / 3).toBeLessThan(18000);
    expect(count / 3).toBeGreaterThan(1000);
    expect(geometry.attributes.position.array.every(Number.isFinite)).toBe(true);
    for (const steps of [devourerIntro().steps, devourerIntro().short!]) {
      const tick = steps.find((s) => s.do === 'call' && s.fn === 'stoneTick')!;
      const charge = steps.find((s) => s.do === 'actor' && s.who === 'boss' && s.moveTo)!;
      expect(charge.t).toBeGreaterThan(tick.t);
    }
    geometry.dispose();
  });
});
