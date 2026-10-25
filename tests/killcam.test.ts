import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { Abilities } from '../src/world/abilities';
import { BellRinger, GateGuardian } from '../src/world/boss/guardians';
import { killBellTrack, killGateTrack } from '../src/world/boss/guardianScenes';
import type { ScriptedEnemy } from '../src/world/boss/scripted';

function setup(make: () => ScriptedEnemy, arena: string) {
  const w = new World(new Arena(ARENAS[arena]), 'kc');
  w.abilities = new Abilities(w);
  w.hero.spawn(0, 5, Math.PI);
  w.hero.invulnUntil = 1e9;
  const e = make();
  e.x = 0; e.z = 0;
  w.addEnemy(e);
  e.setState('idle');
  const cams: unknown[] = [];
  w.bus.on('killcam', (ev) => cams.push(ev.target));
  return { w, e, cams };
}
const heavy = { mult: 50, stun: 0, knockback: 2, feel: 'heavy' as const, dirX: 0, dirZ: -1, source: 'blade' as const };

describe('kill-cam Стражей (план §8.4)', () => {
  for (const [name, make, arena] of [['Страж Врат', () => new GateGuardian({ zone: 0, stage: 2 }), 'gate'], ['Звонарь', () => new BellRinger({ zone: 0, stage: 4 }), 'belfry']] as const) {
    it(`${name}: последний удар по оглушённому — kill-cam, Страж на колене и неуязвим; потом умирает`, () => {
      const { w, e, cams } = setup(make, arena);
      e.hp = 5;
      w.stunEnemy(e);
      w.damageEnemy(e, heavy);
      expect(e.dead).toBe(false);
      expect(e.killcam).toBe(true);
      expect(cams).toEqual([e]);
      expect(e.invulnerable).toBe(true);
      // сцена кончилась — добивают
      e.killcamDone = true; e.killcam = false;
      w.killEnemy(e, 0, -1, 7);
      expect(e.dead).toBe(true);
    });

    it(`${name}: добит не оглушённым — обычная смерть без kill-cam`, () => {
      const { w, e, cams } = setup(make, arena);
      e.hp = 5;
      w.damageEnemy(e, heavy);
      expect(e.dead).toBe(true);
      expect(cams.length).toBe(0);
    });
  }

  it('сцены около 6 с: после распада остаётся две секунды без второго облёта', () => {
    for (const tr of [killGateTrack({ gx: 0, gz: 0, hx: 0, hz: 5 }), killBellTrack({ gx: 0, gz: 0, hx: 0, hz: 5 })]) {
      expect(tr.dur).toBeGreaterThanOrEqual(4.5);
      expect(tr.dur).toBeLessThanOrEqual(6.5);
      const crumbleClip = tr.steps.find(s => s.do === 'clip' && s.markers?.crumble === 'crumble');
      if (!crumbleClip || crumbleClip.do !== 'clip') throw new Error('нет маркера распада');
      const event = crumbleClip.definition?.events?.find(e => e.name === 'crumble');
      expect(event).toBeDefined();
      const crumble = crumbleClip.t + event!.t / (crumbleClip.speed ?? 1);
      expect(tr.dur! - crumble).toBeGreaterThanOrEqual(2);
      expect(tr.steps.some((s) => s.do === 'letterbox')).toBe(false);
      expect(crumbleClip.who).not.toBe('hero');
      expect(tr.skippable).not.toBe(false);
    }
  });
});
