import { afterEach, describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { ChoirPsalm, CHOIR } from '../src/world/choir';
import { InputBuffer, type Input } from '../src/input/input';
import { createEnemy } from '../src/world/enemies/factory';
import type { GameEvents } from '../src/world/events';

const DT = 1 / 60;
const worlds: World[] = [];
afterEach(() => { for (const w of worlds.splice(0)) { w.clear(); w.hero.avatar.dispose(); } });
function setup(wave = 0) {
  const w = new World(new Arena(ARENAS.choir), 'psalm'); worlds.push(w);
  w.abilities = new Abilities(w); w.hero.spawn(0, 0, Math.PI);
  const input = { moveX: 0, moveZ: 0, aimActive: false, attackHeld: false, now: 0, buffer: new InputBuffer() } as unknown as Input;
  const psalm = new ChoirPsalm(w), events: GameEvents['choir'][] = [];
  w.bus.on('choir', e => events.push(e));
  const run = (sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) { input.now += DT; w.step(DT, DT, input, DT); } };
  w.bus.emit('waveStart', { index: wave, total: 4 });
  return { w, psalm, input, events, run };
}

describe('Хоры: ответный псалом', () => {
  it('запоминает проходимую точку заранее, не преследует игрока и даёт полные 1.3 с на уход', () => {
    const { w, psalm, run, events } = setup();
    run(CHOIR.first); expect(psalm.notes).toHaveLength(1);
    const n = psalm.notes[0]; expect(w.arena.walkable(n.x, n.z)).toBe(true);
    const hp = w.hero.hp;
    run(CHOIR.warning - DT); expect(w.hero.hp).toBe(hp);
    w.hero.x = 5; run(DT);
    expect(w.hero.hp).toBe(hp); expect(n.x).toBe(0); expect(n.z).toBe(0);
    expect(events.map(e => e.kind)).toEqual(['mark', 'impact']);
    expect(psalm.notes).toHaveLength(0);
  });

  it('попадает в оставшегося на метке игрока и учитывается в статистике боя', () => {
    const { w, run } = setup(), hp = w.hero.hp;
    run(CHOIR.first + CHOIR.warning);
    expect(w.hero.hp).toBeLessThan(hp); expect(w.run.hitsTaken).toBe(1);
    expect(w.run.dmgTaken).toBeGreaterThan(0);
  });

  it('метку можно увести во врага: один удар по толпе, ушедший герой цел', () => {
    const { w, run } = setup(); run(CHOIR.first);
    const e = createEnemy('golem', { zone: 0, stage: 8 }); e.x = 0; e.z = 0; w.addEnemy(e); e.setState('idle'); e.lagT = 99;
    const hp = e.hp, heroHP = w.hero.hp; w.hero.x = 5;
    run(CHOIR.warning); expect(e.hp).toBeLessThan(hp); expect(w.hero.hp).toBe(heroHP);
    const after = e.hp; run(0.5); expect(e.hp).toBe(after);
  });

  it('идеальный рывок из метки возвращает псалом, отменяет остальные ноты и даёт девять секунд тишины', () => {
    const { w, psalm, input, run, events } = setup(3);
    run(CHOIR.first + CHOIR.warning - 0.05);
    expect(psalm.notes.length).toBeGreaterThan(1);
    const hp = w.hero.hp; input.moveX = 1; input.buffer.push('dash', input.now); run(0.05); input.moveX = 0;
    expect(events.some(e => e.kind === 'return')).toBe(true);
    expect(w.hero.hp).toBe(hp); expect(psalm.silenced).toBe(true); expect(psalm.notes).toHaveLength(0);
    expect(w.hero.resonance).toBeGreaterThanOrEqual(CHOIR.resonance);
    const e = createEnemy('golem', { zone: 0, stage: 8 }); e.x = 4; e.z = 0; w.addEnemy(e); e.setState('idle'); e.lagT = 99;
    const hpEnemy = e.hp; run(0.4); expect(e.hp).toBeLessThan(hpEnemy); expect(e.stun!.stunned).toBeGreaterThan(0);
    const count = events.length; run(CHOIR.quiet - 0.6); expect(events).toHaveLength(count);
    run(0.3); expect(psalm.silenced).toBe(false); expect(events.at(-1)?.kind).toBe('mark');
  });

  for (const [wave, count] of [[0, 1], [1, 2], [3, 3]]) it(`волна ${wave + 1}: ${count} запомненных нот, не больше трёх меток`, () => {
    const { w, psalm, run, events } = setup(wave);
    w.hero.invulnUntil = 999;
    run(CHOIR.first + CHOIR.spacing * 2 + DT);
    expect(events.filter(e => e.kind === 'mark')).toHaveLength(count);
    expect(events.filter(e => e.kind === 'mark').map(e => e.note)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(psalm.notes.length).toBeLessThanOrEqual(3);
  });

  it('нет ударов под кат-сценой, между волнами, после победы и после удаления арены', () => {
    const { w, psalm, run, events } = setup(); run(CHOIR.first);
    w.hero.scripted = true; run(2); expect(events.map(e => e.kind)).toEqual(['mark']); expect(psalm.notes).toHaveLength(0);
    w.hero.scripted = false; w.bus.emit('waveClear', { index: 0, total: 4 }); run(15); expect(events).toHaveLength(1);
    w.bus.emit('waveStart', { index: 1, total: 4 }); run(CHOIR.first); expect(psalm.notes.length).toBeGreaterThan(0);
    w.bus.emit('stageClear', {}); const n = events.length; run(15); expect(events).toHaveLength(n);
    psalm.dispose(); expect(w.stepHooks).toHaveLength(0);
    w.bus.emit('waveStart', { index: 3, total: 4 }); run(15); expect(events).toHaveLength(n);
  });
});
