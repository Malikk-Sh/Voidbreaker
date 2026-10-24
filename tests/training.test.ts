import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { Reaper } from '../src/world/enemies/reaper';
import { InputBuffer, type Input } from '../src/input/input';
import { DRILL_T, DrillTracker } from '../src/game/drills';

const DT = 1 / 60;
const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;
const POST = { x: 0, z: -4 }, R = 7;

function setup(): { w: World; e: Reaper; run: (sec: number, until?: () => boolean) => boolean } {
  const w = new World(new Arena(ARENAS.naves), 'spar');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 0, Math.PI);
  w.hero.invulnUntil = 1e9;
  const e = new Reaper({ zone: 0, stage: 0 });
  e.x = POST.x; e.z = POST.z;
  w.addEnemy(e); e.setState('idle');
  e.leash = { ...POST, r: R };
  const inp = idle();
  const run = (sec: number, until?: () => boolean): boolean => {
    for (let t = 0; t < sec; t += DT) { w.step(DT, DT, inp); if (until?.()) return true; }
    return false;
  };
  return { w, e, run };
}

const away = (w: World): void => { w.hero.x = POST.x; w.hero.z = POST.z + R + 6; };
const near = (w: World): void => { w.hero.x = POST.x; w.hero.z = POST.z + 3; };
const liveTeles = (w: World, e: Reaper): number => w.telegraphs.filter((t) => t.alive && t.owner === e).length;

describe('тренировочный Жнец на поводке (этап 4.5, A1)', () => {
  it('ушёл во время замаха: замах отменён, телеграфа нет, Жнец вернулся на пост и не бьёт', () => {
    const { w, e, run } = setup();
    expect(run(8, () => e.state === 'telegraph')).toBe(true);
    away(w);
    run(DT * 2);
    expect(e.state).not.toBe('telegraph');
    expect(e.tele).toBeNull();
    expect(liveTeles(w, e)).toBe(0);
    // пока Пилот далеко — ни одной новой атаки, путь на пост
    let attacked = false;
    run(4, () => { if (e.state === 'telegraph' || e.state === 'attack') attacked = true; return false; });
    expect(attacked).toBe(false);
    expect(Math.hypot(e.x - POST.x, e.z - POST.z)).toBeLessThan(1);
    expect(Math.hypot(e.vx, e.vz)).toBeLessThan(0.5);
  });

  it('ушёл во время удара: удар доводится, серия не продолжается, Жнец не скользит дальше', () => {
    const { w, e, run } = setup();
    expect(run(10, () => e.state === 'attack')).toBe(true);
    away(w);
    run(1.2);
    expect(['recover', 'chase', 'idle']).toContain(e.state);
    expect(liveTeles(w, e)).toBe(0);
    run(4);
    expect(Math.hypot(e.x - POST.x, e.z - POST.z)).toBeLessThan(1);
  });

  it('ушёл во время восстановления и после сбивания ударом — состояния идут дальше; вернулся — снова бьёт', () => {
    const { w, e, run } = setup();
    expect(run(10, () => e.state === 'recover')).toBe(true);
    away(w);
    run(3);
    expect(e.state === 'idle' || e.state === 'chase').toBe(true);
    // рядового Жнеца не оглушить — только сбить ударом; сбитый за поводком приходит в себя как обычно
    near(w);
    e.interrupt(0.6);
    expect(e.state).toBe('stagger');
    away(w);
    run(6);
    expect(e.state).not.toBe('stagger');
    expect(Math.hypot(e.x - POST.x, e.z - POST.z)).toBeLessThan(1);
    // Пилот вернулся — Жнец снова атакует
    near(w);
    expect(run(8, () => e.state === 'telegraph')).toBe(true);
  });

  it('много циклов «подошёл — ушёл» не оставляют зависших состояний и телеграфов', () => {
    const { w, e, run } = setup();
    for (let i = 0; i < 12; i++) {
      near(w); run(0.35 + (i % 4) * 0.4);
      away(w); run(1.5);
      expect(liveTeles(w, e), `цикл ${i}`).toBe(0);
      expect(['telegraph', 'stunned'].includes(e.state), `цикл ${i}: ${e.state}`).toBe(false);
    }
    run(3);
    expect(Math.hypot(e.x - POST.x, e.z - POST.z)).toBeLessThan(1);
  });
});


describe('упражнения зала засчитываются по своему условию (этап 4.5, A3)', () => {
  const series = (t: DrillTracker, moves: string[], t0 = 0): number => { let k = t0; for (const m of moves) { t.move(m, k); k += 0.3; } return k; };

  it('серия до Разлома без попадания — «выполнено», не зачёт; попадание Разломом — зачёт', () => {
    const t = new DrillTracker();
    let performed = 0, done = 0;
    t.onPerformed = () => performed++;
    t.onDone = () => done++;
    const k = series(t, ['slash1', 'slash2', 'spin']);
    expect(t.step).toBe(3);
    t.move('rift', k);
    t.tick(k + DRILL_T.hitWait + 0.05);
    expect(t.state.get('rift')).toBe('performed');
    expect(performed).toBe(1);
    expect(done).toBe(0);
    t.strike('rift', 1, false, k + 1);
    expect(t.state.get('rift')).toBe('done');
    expect(done).toBe(1);
  });

  it('воздушная серия в пустоту не засчитывается; Звездопад по цели — да; Небесный разрез можно пропустить', () => {
    const t = new DrillTracker();
    t.strike('rift', 1, false, 0);
    t.strike('cross', 1, false, 0);
    expect(t.active?.id).toBe('skyfall');
    series(t, ['lunge', 'rising']);
    expect(t.step).toBe(2);
    t.move('skyfall', 1);
    expect(t.step).toBe(3);
    t.strike('skyfall', 0, false, 1.05);
    t.tick(1 + DRILL_T.hitWait + 0.1);
    expect(t.state.get('skyfall')).toBe('performed');
    t.strike('skyfall', 2, false, 3);
    expect(t.state.get('skyfall')).toBe('done');
  });

  it('Контрудар — только попаданием; заряд — только полным; Раскол — своим началом', () => {
    const t = new DrillTracker();
    t.event('perfect', 0);
    t.move('counter', 0.2);
    t.tick(1.5);
    expect(t.state.get('counter')).toBe('performed');
    t.strike('counter', 1, false, 2);
    expect(t.state.get('counter')).toBe('done');
    t.strike('charged', 1, false, 3);
    expect(t.state.get('charged')).toBe('todo');
    t.strike('charged', 1, true, 3.1);
    expect(t.state.get('charged')).toBe('done');
    t.shatter();
    expect(t.state.get('shatter')).toBe('done');
  });

  it('шаги активного упражнения: пауза сбрасывает серию, чужой приём — тоже; зачёт другого упражнения не мешает', () => {
    const t = new DrillTracker();
    series(t, ['slash1', 'slash2']);
    expect(t.step).toBe(2);
    t.tick(0.3 + DRILL_T.gap + 0.1);
    expect(t.step).toBe(0);
    series(t, ['slash1', 'lunge'], 5);
    expect(t.step).toBe(0);
    t.strike('cross', 1, false, 6);
    expect(t.state.get('cross')).toBe('done');
    expect(t.active?.id).toBe('rift');
    for (const id of ['rift', 'skyfall', 'counter']) t.strike(id, 1, false, 7);
    t.strike('charged', 1, true, 7);
    let all = false;
    t.onDone = (_d, a) => { all = a; };
    t.shatter();
    expect(all).toBe(true);
    expect(t.active).toBeNull();
  });
});
