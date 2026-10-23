import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { GateGuardian } from '../src/world/boss/guardians';
import { InputBuffer, type Input } from '../src/input/input';

/**
 * Этап 4.5, C1: эталонная дуэль со Стражем Врат (мастер-план §4.0) обычным вводом — нажатия через буфер, удержание
 * атаки, движение к цели. Страж сам выбирает серию; ни скрытых бонусов, ни принудительных состояний.
 */
const DT = 1 / 60;
type Ev = { t: number; name: string; e: Record<string, unknown> };
interface Bot { dodgeAt: number; finish: boolean }

function duel(bot: Bot, maxT = 40): { w: World; g: GateGuardian; ev: Ev[]; at: (n: string) => Ev | undefined; kneel: number } {
  const w = new World(new Arena(ARENAS.gate), 'duel');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 4, Math.PI);
  const g = new GateGuardian({ zone: 0, stage: 2 });
  g.x = 0; g.z = 0; w.addEnemy(g); g.setState('idle');
  const inp = { moveX: 0, moveZ: 0, aimActive: false, aimX: 0, aimZ: 0, attackHeld: false, attackHeldSince: 0, now: 0, buffer: new InputBuffer() } as unknown as Input;
  const ev: Ev[] = [];
  let t = 0;
  for (const n of ['perfectDodge', 'dodge', 'playerHurt', 'stun', 'shatterStart', 'shatter', 'guardianRage', 'chargeReady', 'moveStart', 'strike'] as const) {
    w.bus.on(n, (e) => ev.push({ t, name: n, e: e as unknown as Record<string, unknown> }));
  }
  // вторая фаза (серия из трёх ударов — её приём): Страж ниже 50 % здоровья, рёв ярости
  g.hp = g.maxHp * 0.495;
  w.damageEnemy(g, { mult: 1, stun: 0, knockback: 0, feel: 'light', dirX: 0, dirZ: -1, source: 'blade' });
  let phase = 0, rel = 0, kneel = 0;
  const thrustT = g.patterns.find((p) => p.id === 'combo')!.steps.filter((s) => s.do === 'hitbox').at(-1)!.t;
  while (t < maxT) {
    t += DT; (inp as { now: number }).now = t;
    w.hero.hp = w.hero.maxHp;
    const c = g.cur?.id, mi = inp as { moveX: number; moveZ: number };
    // 1–2. серия; рывок вбок на третьем, самом тяжёлом ударе
    if (phase === 0 && c === 'combo' && g.ct >= thrustT - bot.dodgeAt) {
      inp.buffer.push('dash', t, Math.cos(g.facing), -Math.sin(g.facing)); phase = 1; rel = t;
    }
    // 4. атака с удержанием: Контрудар, затем мгновенный полный заряд
    if (phase === 1 && t - rel > 0.12) { inp.buffer.push('attack', t); inp.attackHeld = true; inp.attackHeldSince = t; phase = 2; rel = t; }
    if (phase === 2 && t - rel > 0.5) { inp.attackHeld = false; phase = 3; rel = t; }
    // 6. добивание серией (Разлом — финишер); отказ — стоит в стороне
    if (phase === 3) {
      const dx = g.x - w.hero.x, dz = g.z - w.hero.z, d = Math.hypot(dx, dz), go = bot.finish && d > 2.6;
      mi.moveX = go ? dx / d : 0; mi.moveZ = go ? dz / d : 0;
      if (bot.finish && t - rel > 0.27 && g.stunned) { inp.buffer.push('attack', t); rel = t; }
      if (!g.stunned && ev.some((x) => x.name === 'stun') && !w.shatterSeq) { phase = 4; rel = t; }
    }
    if (phase === 4 && t - rel > 1.5) break;
    const sh = !!w.shatterSeq;
    w.step(sh ? DT * 0.05 : DT, sh ? DT * 0.05 : DT, inp, DT);
    if (ev.some((x) => x.name === 'shatter')) kneel = Math.max(kneel, g.kneelT);
  }
  return { w, g, ev, at: (n) => ev.find((x) => x.name === n), kneel };
}

describe('этап 4.5 C1: эталонная дуэль со Стражем Врат (§4.0)', () => {
  it('серия → идеальное уклонение на третьем ударе → Контрудар и полный заряд → оглушение → Раскол → Страж на колене', () => {
    const { w, ev, at, kneel } = duel({ dodgeAt: 0.07, finish: true });
    const pd = at('perfectDodge')!;
    // 2–3. «Мгновение Пустоты»: от тяжёлого удара, силуэт на старом месте расколот
    expect(pd).toBeDefined();
    expect(pd.e.heavy).toBe(true);
    expect(Math.hypot((pd.e.sx as number) - (pd.e.x as number), (pd.e.sz as number) - (pd.e.z as number))).toBeGreaterThan(1);
    expect(ev.filter((x) => x.name === 'playerHurt' && x.t > pd.t - 0.1 && x.t < pd.t + 0.1)).toHaveLength(0);
    // 4. Контрудар, мгновенный полный заряд (без накопления), заряженный удар
    const moves = ev.filter((x) => x.name === 'moveStart' && x.t > pd.t).map((x) => x.e.id);
    expect(moves.slice(0, 2)).toEqual(['counter', 'charged']);
    const ready = ev.find((x) => x.name === 'chargeReady' && x.t > pd.t)!;
    expect(ready.e.level).toBe(2);
    expect(ready.t - ev.find((x) => x.name === 'moveStart' && x.e.id === 'counter')!.t).toBeLessThan(0.3);
    // 5. шкала заполнена заряженным ударом — оглушение сразу, в окне застрявшей алебарды (не через 2.4 с)
    const charged = ev.find((x) => x.name === 'strike' && x.e.moveId === 'charged')!;
    const stun = at('stun')!;
    expect(stun.t - charged.t).toBeLessThan(0.05);
    // 6. финишер по оглушённому — Раскол 2.0
    const sh = at('shatterStart')!;
    expect(sh.t).toBeGreaterThan(stun.t);
    expect(at('shatter')).toBeDefined();
    // 7. Страж оседает на колено после разлёта
    expect(kneel).toBeGreaterThan(0.5);
    expect(ev.some((x) => x.name === 'shatter' && (x.e.dmg as number) > 0)).toBe(true);
    expect(w.hero.dead).toBe(false);
  });

  it('раннее уклонение — обычный рывок: без «Мгновения Пустоты», Контрудара и оглушения', () => {
    const { ev, at } = duel({ dodgeAt: 0.45, finish: true }, 22);
    expect(at('perfectDodge')).toBeUndefined();
    expect(ev.some((x) => x.name === 'moveStart' && x.e.id === 'counter')).toBe(false);
    expect(at('stun')).toBeUndefined();
  });

  it('отказ от добивания: оглушение проходит, Страж встаёт и бой продолжается', () => {
    const { g, at } = duel({ dodgeAt: 0.07, finish: false });
    expect(at('stun')).toBeDefined();
    expect(at('shatterStart')).toBeUndefined();
    expect(g.dead).toBe(false);
    expect(g.stunned).toBe(false);
  });
});
