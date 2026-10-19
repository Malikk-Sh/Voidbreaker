import { Ease } from '../../core/ease';
import { angleOf, clamp } from '../../core/math';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { acolyteRig } from '../../gen/chars/enemies';
import { Enemy, type SpawnOpts } from '../enemy';
import type { Telegraph } from '../entities';
import type { World } from '../world';
import { Husk } from './husk';

const layout = () => layoutOf(acolyteRig());
const SHIELD_TELE = 0.8;
const SHOT_TELE = 0.6;
const SUMMON_TELE = 1.0;
/** Потолок живой Шелухи на арене: призыв не должен превращаться в бесконечный поток. */
const HUSK_CAP = 14;
export const SHIELD_MUL = 0.4;

/**
 * Аколит Хора (GDD §9.2): поддержка. Вешает багровый щит на союзников (−60 % урона), пока жив.
 * Телеграф — луч к союзнику. Раз в ~10 с поднимает из пола Шелуху (две багровые метки у героя, 1 с).
 * Приоритетная цель.
 */
export class Acolyte extends Enemy {
  private J: Record<string, number> = {};
  private castTarget: Enemy | null = null;
  shielding: Enemy[] = [];
  private shieldCd = 1.5;
  private mode: 'shield' | 'shot' | 'summon' = 'shield';
  private summonCd = 4 + Math.random() * 3;
  private summonPts: { x: number; z: number }[] = [];
  private extraTele: Telegraph[] = [];
  private strafe = Math.random() < 0.5 ? 1 : -1;

  constructor(o: SpawnOpts) {
    super(ENEMIES.acolyte, layout(), [], o);
    const L = layout();
    for (const n of L.names) this.J[n] = L.idx(n);
    this.cooldown = 2.5;
  }

  /** Луч телеграфа щита: от аколита к цели (для рендера). */
  get beamTarget(): Enemy | null { return this.state === 'telegraph' && this.mode === 'shield' ? this.castTarget : null; }

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    const d = this.distTo(h);
    this.shieldCd -= dt;
    this.summonCd -= dt;
    this.shielding = this.shielding.filter((e) => !e.dead && e.shieldFrom === this);
    switch (this.state) {
      case 'idle': case 'chase': case 'orbit': case 'recover': {
        if (d < 4) {
          const dx = this.x - h.x, dz = this.z - h.z, l = d || 1;
          this.steer(this.x + (dx / l) * 3, this.z + (dz / l) * 3, this.speed * 1.15, dt);
        } else this.standOff(w, 7.5, this.speed * 0.5, dt, this.strafe);
        this.faceTo(h.x, h.z, 0.3, dt);
        if (!tick || h.dead) break;
        if (this.shieldCd <= 0) {
          const t = this.pickAlly(w);
          if (t) {
            this.castTarget = t; this.mode = 'shield';
            this.telegraph(w, { k: 'circle', x: t.x, z: t.z, r: t.radius + 0.6 }, SHIELD_TELE, false, 'chime').buff = true;
            this.setState('telegraph');
            break;
          }
        }
        // в бою с Иерофантом хор занят щитом — Шелуху поднимает сам босс
        if (this.summonCd <= 0 && d < 14 && this.huskCount(w) < HUSK_CAP - 2 && !w.enemies.some((e) => e.isBoss && !e.dead)) {
          this.startSummon(w);
          break;
        }
        if (this.cooldown <= 0 && d < 11 && w.requestToken(this, 'ranged')) {
          this.mode = 'shot';
          this.telegraph(w, { k: 'circle', x: this.x, z: this.z, r: 0.9 }, SHOT_TELE, false, 'chime');
          this.setState('telegraph');
        }
        break;
      }
      case 'telegraph': {
        this.vx *= 0.8; this.vz *= 0.8;
        this.coreGlow = Math.min(1.5, this.coreGlow + dt * 2.5);
        const tele = this.mode === 'shield' ? SHIELD_TELE : this.mode === 'summon' ? SUMMON_TELE : SHOT_TELE;
        if (this.mode === 'shield' && this.castTarget) {
          this.faceTo(this.castTarget.x, this.castTarget.z, 0.1, dt);
          if (this.tele && this.tele.shape.k === 'circle') { this.tele.shape.x = this.castTarget.x; this.tele.shape.z = this.castTarget.z; }
          if (this.castTarget.dead) { this.cancelTelegraph(); this.setState('recover'); break; }
        } else if (this.mode === 'shot' && this.tele && this.tele.shape.k === 'circle') { this.tele.shape.x = this.x; this.tele.shape.z = this.z; }
        if (this.stateT >= tele * this.teleMul) {
          if (this.mode === 'summon') {
            this.summonPts.forEach((p, i) => {
              for (let k = 0; k < (i === 0 ? 2 : 1); k++) {
                const o = { x: 0, z: 0 };
                w.arena.nearestWalkable(p.x + w.rng.spread(0.7), p.z + w.rng.spread(0.7), o);
                const e = new Husk({ zone: w.zone, stage: w.stage, mode: w.mode });
                e.x = o.x; e.z = o.z;
                e.facing = angleOf(h.x - e.x, h.z - e.z);
                w.addEnemy(e);
              }
              w.bus.emit('portal', { x: p.x, z: p.z });
            });
            w.bus.emit('enemyAttack', { kind: 'beam', x: this.x, z: this.z });
            this.summonCd = 9 + Math.random() * 3;
          } else if (this.mode === 'shield' && this.castTarget) {
            this.castTarget.shieldFrom = this;
            this.castTarget.shieldMul = SHIELD_MUL;
            this.shielding.push(this.castTarget);
            this.shieldCd = 6;
            w.bus.emit('enemyAttack', { kind: 'beam', x: this.castTarget.x, z: this.castTarget.z });
          } else {
            const a = angleOf(h.x - this.x, h.z - this.z);
            const p = w.spawnProjectile('acolyteOrb', this.x + Math.sin(a) * 0.7, this.z + Math.cos(a) * 0.7, Math.sin(a) * 5.5, Math.cos(a) * 5.5, this.dmg, this.id, 0.38, 4.5, 2.2);
            p.homing = 1.4;
            this.token = null;
            this.cooldown = 3.5 + Math.random() * 1.5;
          }
          this.cancelTelegraph();
          this.setState('recover');
        }
        break;
      }
      default: break;
    }
  }

  private huskCount(w: World): number {
    let n = 0;
    for (const e of w.enemies) if (!e.dead && e.kind === 'husk') n++;
    return n;
  }

  /** Призыв: две метки в 4–5 м от героя со стороны аколита — Шелуха вылезет там, отрезая отход. */
  private startSummon(w: World): void {
    const h = w.hero;
    const base = angleOf(this.x - h.x, this.z - h.z);
    this.summonPts = [];
    for (const da of [-0.75, 0.75]) {
      const a = base + da + w.rng.spread(0.25), r = 4 + w.rng.next();
      const o = { x: 0, z: 0 };
      w.arena.nearestWalkable(h.x + Math.sin(a) * r, h.z + Math.cos(a) * r, o);
      this.summonPts.push(o);
    }
    this.mode = 'summon';
    const [a, b] = this.summonPts;
    this.telegraph(w, { k: 'circle', x: a.x, z: a.z, r: 1.3 }, SUMMON_TELE, false, 'chime');
    this.extraTele = [w.addTelegraph({ k: 'circle', x: b.x, z: b.z, r: 1.0 }, SUMMON_TELE * this.teleMul)];
    this.setState('telegraph');
  }

  override cancelTelegraph(): void {
    super.cancelTelegraph();
    for (const t of this.extraTele) t.alive = false;
    this.extraTele = [];
  }

  private pickAlly(w: World): Enemy | null {
    let best: Enemy | null = null, bd = Infinity;
    for (const e of w.enemies) {
      if (e === this || e.dead || !e.spawned || e.shieldFrom || e instanceof Acolyte || e.isBoss) continue;
      const d = this.distTo(e) - (e.elite.length ? 4 : 0) - (e.maxHp > 100 ? 2 : 0);
      if (d < bd && d < 12) { bd = d; best = e; }
    }
    return best;
  }

  override kill(w: World, dirX: number, dirZ: number, power: number): void {
    for (const e of this.shielding) if (e.shieldFrom === this) { e.shieldFrom = null; e.shieldMul = 1; }
    this.shielding = [];
    super.kill(w, dirX, dirZ, power);
  }

  protected animate(dt: number): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot, J = this.J;
    void dt;
    out.set(L.restRot);
    let cast = 0;
    if (this.state === 'telegraph') cast = Ease.outCubic(clamp(this.stateT / 0.3, 0, 1)) * (this.mode === 'summon' ? 1.25 : 1);
    else if (this.state === 'recover') cast = 1 - Ease.outQuart(clamp(this.stateT / 0.4, 0, 1));
    const bob = Math.sin(this.time * 1.8) * 0.1;
    s.off[J.body * 3 + 1] = bob + 0.15;
    setJoint(out, L, J.body, this.puppet.springZ * 0.3, 0, this.puppet.springX * 0.3);
    setJoint(out, L, J.halo, 0, 0, this.time * 0.8);
    const both = this.mode === 'summon' ? 1 : 0;
    setJoint(out, L, J.armL, -0.3 - cast * (1.2 + both * 1.0), 0, 0.25 + cast * 0.3);
    setJoint(out, L, J.armR, -0.2 - cast * 2.2, 0, -0.15);
    setJoint(out, L, J.head, -0.15 + cast * 0.2, 0, 0);
    s.x = this.x; s.z = this.z; s.y = this.y; s.facing = this.facing;
    s.update();
    this.puppet.boost = this.coreGlow;
  }
}
