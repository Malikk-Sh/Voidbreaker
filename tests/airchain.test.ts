import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { VOID_BLADE } from '../src/data/weapons';
import { Husk } from '../src/world/enemies/husk';
import type { Enemy } from '../src/world/enemy';
import type { GameEvents } from '../src/world/events';
import { InputBuffer, type Input } from '../src/input/input';

/** Этап 4.5, B3: Восходящий месяц → Небесный разрез → Звездопад — одна вертикальная траектория. */
const DT = 1 / 60;
const idle = (): Input => ({ moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() }) as unknown as Input;

interface HeroPriv {
  hitActive: boolean; target: Enemy | null; stateT: number;
  startAttack(i: Input, mx: number, mz: number, stick: boolean): void;
  beginMove(m: unknown, lunge: number): void;
}
interface Frame { t: number; move: string; clip: string; y: number; hit: boolean; tip: THREE.Vector3; ty: number; tSkelY: number; hz: number; ex: number; ez: number }

/** Связка с нажатиями в окнах продолжения; кадр за кадром — высота видимого Пилота, хитбокс, цель. */
function chain(skyAt = 0.32): { w: World; e: Enemy; frames: Frame[]; slashes: GameEvents['slash'][]; impacts: number[] } {
  const w = new World(new Arena(ARENAS.naves), 'airchain');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 1.7, Math.PI);
  w.hero.invulnUntil = 1e9;
  const e = new Husk({ zone: 0, stage: 0 });
  e.x = 0; e.z = 0; e.maxHp *= 50; e.hp = e.maxHp; w.addEnemy(e); e.setState('idle');
  (e as unknown as { think: () => void }).think = () => {};
  const h = w.hero as unknown as HeroPriv;
  h.target = e;
  const slashes: GameEvents['slash'][] = [], impacts: number[] = [], frames: Frame[] = [];
  w.bus.on('slash', (s) => slashes.push(s));
  w.bus.on('impact', (i) => { if (i.kind === 'rift') impacts.push(t); });
  h.beginMove(VOID_BLADE.rising, 0);
  const pressed = [false, false];
  const base = new THREE.Vector3();
  let t = 0;
  for (let i = 0; i < 90; i++) {
    h.target = e;
    const m = w.hero.move?.id;
    if (m === 'rising' && h.stateT >= 0.24 && !pressed[0]) { pressed[0] = true; h.startAttack(idle(), 0, 0, false); }
    if (m === 'skycut' && h.stateT >= skyAt && !pressed[1]) { pressed[1] = true; h.startAttack(idle(), 0, 0, false); }
    w.step(DT, DT, idle()); t += DT;
    const tip = new THREE.Vector3();
    w.hero.avatar.bladePoints(base, tip);
    frames.push({ t, move: w.hero.move?.id ?? '-', clip: w.hero.avatar.puppet.anim.clip?.id ?? '-', y: w.hero.avatar.puppet.skel.y, hit: h.hitActive, tip, ty: e.y, tSkelY: e.puppet.skel.y, hz: w.hero.z, ex: e.x, ez: e.z });
  }
  return { w, e, frames, slashes, impacts };
}

describe('этап 4.5 B3: воздушная связка', () => {
  it('корень не скачет на смене приёмов; Звездопад после Небесного разреза начинается в воздухе', () => {
    const { frames } = chain();
    const starts = frames.map((f, i) => (i && f.move !== frames[i - 1].move && f.move !== '-' ? i : -1)).filter((i) => i > 0);
    expect(starts.map((i) => frames[i].move)).toEqual(['skycut', 'skyfall']);
    for (const s of starts) {
      // смена приёма без скачка: первый кадр продолжает прежнюю высоту (прыжок Небесного разреза — 0.3 м/кадр;
      // Звездопад раньше сбрасывал 1.25 м за 2 кадра, это ловит проверка ниже)
      expect(Math.abs(frames[s].y - frames[s - 1].y)).toBeLessThan(0.35);
    }
    const sf = starts[1];
    expect(frames[sf].clip).toBe('skyfallAir');
    // до пике Пилот не опускается к полу (раньше — присед на полу и второй прыжок)
    const apex = frames.findIndex((f, i) => i > sf && f.y > 1.6);
    expect(apex).toBeGreaterThan(sf);
    for (let i = sf; i < apex; i++) expect(frames[i].y).toBeGreaterThan(0.9);
  });

  it('Звездопад бьёт в кадр касания пола: удар, след и трещина — у пола, цель уже на полу', () => {
    const { frames, slashes, impacts, e } = chain();
    const sf = frames.findIndex((f) => f.move === 'skyfall');
    const hit = frames.findIndex((f, i) => i >= sf && f.hit);
    expect(hit).toBeGreaterThan(sf);
    // корень на полу (было 0.86 м)
    expect(frames[hit].y).toBeLessThan(0.1);
    // один след Звездопада, у пола (раньше второй — в верхней точке прыжка)
    const sky = slashes.filter((s) => s.move === 'skyfall');
    expect(sky.length).toBe(1);
    expect(sky[0].y).toBeLessThan(0.15);
    expect(impacts.length).toBe(1);
    expect(Math.abs(impacts[0] - frames[hit].t)).toBeLessThan(2 * DT);
    // хитбокс бьёт в следующем шаге (performHit до позы): вбитая цель — скелетом на полу в том же кадре
    // (в стопкадре она висела над приземлившимся Пилотом)
    expect(frames[hit - 1].ty).toBeGreaterThan(1);
    expect(frames[hit + 1].ty).toBe(0);
    expect(frames[hit + 1].tSkelY).toBeLessThan(0.05);
    // клинок входит в пол сквозь цель, а не за ней (цель — где она в кадре удара: Восходящий месяц её отбросил)
    const f = frames[hit];
    expect(Math.hypot(f.tip.x - f.ex, f.tip.z - f.ez)).toBeLessThan(e.radius + 0.5);
  });

  it('Небесный разрез проходит через корпус подброшенной цели, а не над головой', () => {
    const { frames, e } = chain();
    const sc = frames.findIndex((f) => f.move === 'skycut');
    const hit = frames.findIndex((f, i) => i >= sc && f.hit);
    const f = frames[hit];
    expect(f.tip.y).toBeGreaterThan(f.ty + 0.3);
    expect(f.tip.y).toBeLessThan(f.ty + e.height + 0.1);
    // Пилот у цели, а не внутри неё
    expect(Math.abs(f.hz - f.ez)).toBeGreaterThan(e.radius + 0.4);
  });

  it('поздний Звездопад у самого пола — с приседа, как раньше', () => {
    const { frames } = chain(0.44);
    const sf = frames.findIndex((f) => f.move === 'skyfall');
    expect(frames[sf].clip).toBe('skyfall');
  });
});
