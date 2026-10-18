import * as THREE from 'three';
import { Ease } from '../../core/ease';
import { angleOf, clamp, lerp } from '../../core/math';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { mantisRig } from '../../gen/chars/enemies';
import { Enemy, type SpawnOpts } from '../enemy';
import type { World } from '../world';

const layout = () => layoutOf(mantisRig());
const _p = new THREE.Vector3();
const TELE = 0.7;
const TELE_CHAIN = 0.45;
const TELE_WHIRL = 0.62;
const DASH = 0.2;
const DASH_LEN = 5.5;
const WHIRL_R = 2.5;

/**
 * Жнец (GDD §9.2): дуэлянт. Держит дистанцию 4 м, затем рывок-разрез серпами (красная линия 0.7 с).
 * Может связать второй выпад (короткий телеграф 0.45 с), а если Пилот вплотную — вихрь серпов (круг 0.62 с).
 */
export class Reaper extends Enemy {
  private gait = 0;
  private orbitDir = Math.random() < 0.5 ? 1 : -1;
  private dirX = 0; private dirZ = 1;
  private J: Record<string, number> = {};
  private mode: 'dash' | 'whirl' = 'dash';
  private chainLeft = 0;
  private teleNow = TELE;

  constructor(o: SpawnOpts) {
    super(ENEMIES.reaper, layout(), [], o);
    const L = layout();
    for (const n of L.names) this.J[n] = L.idx(n);
    this.cooldown = 1.2 + Math.random();
  }

  override windupPoint(out: { x: number; y: number; z: number }): void {
    // энергия стягивается к остриям поднятых серпов
    const s = this.puppet.skel;
    const p = s.jointPoint(this.J.scyR, 0, -0.9, 0, _p);
    out.x = p.x; out.y = p.y; out.z = p.z;
  }

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    const d = this.distTo(h);
    switch (this.state) {
      case 'idle': case 'chase': case 'orbit': case 'recover': {
        if (this.state === 'recover' && this.stateT < 0.8) { this.vx *= 0.88; this.vz *= 0.88; this.faceTo(h.x, h.z, 0.4, dt); break; }
        if (d > 6.5) { this.seek(w, h.x, h.z, this.speed, dt, 4); if (this.state !== 'chase') this.setState('chase'); }
        else {
          if (this.state !== 'orbit') this.setState('orbit');
          if (tick && Math.random() < 0.01) this.orbitDir *= -1;
          this.standOff(w, 4.2, this.speed * 0.55, dt, this.orbitDir);
        }
        this.faceTo(h.x, h.z, 0.15, dt);
        if (!tick || h.dead || this.cooldown > 0) break;
        if (d < 2.3 && w.requestToken(this, 'melee')) {
          this.mode = 'whirl';
          this.telegraph(w, { k: 'circle', x: this.x, z: this.z, r: WHIRL_R }, TELE_WHIRL, false, 'whistle');
          this.setState('telegraph');
        } else if (d < 6 && w.requestToken(this, 'melee')) {
          this.mode = 'dash';
          this.chainLeft = (this.elite.length || w.stage >= 2) && Math.random() < 0.5 ? 1 : 0;
          this.startDashTele(w, h.x, h.z, TELE);
        }
        break;
      }
      case 'telegraph': {
        this.vx *= 0.8; this.vz *= 0.8;
        this.coreGlow = Math.min(1, this.coreGlow + dt * 2.5);
        if (this.mode === 'whirl') {
          if (this.tele && this.tele.shape.k === 'circle') { this.tele.shape.x = this.x; this.tele.shape.z = this.z; }
          if (this.stateT >= TELE_WHIRL * this.teleMul) { this.attackDone = false; this.setState('attack'); w.bus.emit('enemyAttack', { kind: 'slash', x: this.x, z: this.z, dir: this.facing, r: WHIRL_R }); }
          break;
        }
        // первые 60 % телеграфа направление следует за героем, затем фиксируется
        if (this.stateT < this.teleNow * this.teleMul * 0.6) this.aim(h.x, h.z);
        if (this.tele && this.tele.shape.k === 'line') {
          const sh = this.tele.shape;
          sh.x = this.x; sh.z = this.z; sh.dx = this.dirX; sh.dz = this.dirZ;
        }
        if (this.stateT >= this.teleNow * this.teleMul) {
          this.attackDone = false;
          this.setState('attack');
          w.bus.emit('enemyAttack', { kind: 'slash', x: this.x, z: this.z, dir: this.facing, r: 1.6 });
        }
        break;
      }
      case 'attack': {
        if (this.mode === 'whirl') {
          this.vx *= 0.6; this.vz *= 0.6;
          if (!this.attackDone && this.stateT >= 0.08) { this.attackDone = true; w.enemyStrike(this, { k: 'circle', x: this.x, z: this.z, r: WHIRL_R }, this.dmg, 5); }
          if (this.stateT >= 0.34) this.finish(1.4);
          break;
        }
        const sp = DASH_LEN / DASH;
        this.vx = this.dirX * sp; this.vz = this.dirZ * sp;
        if (!this.attackDone) {
          const r = w.enemyStrike(this, { k: 'line', x: this.x - this.dirX * 0.6, z: this.z - this.dirZ * 0.6, dx: this.dirX, dz: this.dirZ, len: 2.2, w: 1.5 }, this.dmg, 4);
          if (r !== 'miss') this.attackDone = true;
        }
        if (this.stateT >= DASH) {
          this.vx *= 0.2; this.vz *= 0.2;
          if (this.chainLeft > 0 && !h.dead) {
            // второй выпад: короткий телеграф, разворот к Пилоту
            this.chainLeft--;
            this.cancelTelegraph();
            this.startDashTele(w, h.x, h.z, TELE_CHAIN);
          } else this.finish(1.6 + Math.random() * 1.2);
        }
        break;
      }
      default: break;
    }
  }

  private startDashTele(w: World, tx: number, tz: number, tele: number): void {
    this.aim(tx, tz);
    this.teleNow = tele;
    this.telegraph(w, { k: 'line', x: this.x, z: this.z, dx: this.dirX, dz: this.dirZ, len: DASH_LEN + 1, w: 1.5 }, tele, false, 'whistle');
    this.setState('telegraph');
  }

  private finish(cd: number): void {
    this.cancelTelegraph();
    this.token = null;
    this.cooldown = cd;
    this.setState('recover');
  }

  private aim(x: number, z: number): void {
    const dx = x - this.x, dz = z - this.z, l = Math.hypot(dx, dz) || 1;
    this.dirX = dx / l; this.dirZ = dz / l;
    this.facing = angleOf(this.dirX, this.dirZ);
  }

  protected animate(dt: number): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot, J = this.J;
    const sp = Math.hypot(this.vx, this.vz);
    this.gait += sp * dt / 1.1;
    out.set(L.restRot);
    const amp = clamp(sp / 3, 0, 1) * (this.state === 'attack' ? 0 : 1);
    // переступание с паузами: диагональные пары
    const ph = this.gait * Math.PI * 2;
    const step = (p: number) => { const v = Math.sin(p); return Math.sign(v) * Math.pow(Math.abs(v), 0.5); };
    const lift = (p: number) => Math.max(0, Math.sin(p)) * 0.5 * amp;
    let crouch = 0, armUp = 0.6, armBack = 0, slash = 0;
    let spin = 0;
    if (this.state === 'telegraph') {
      const k = Ease.inBack(clamp(this.stateT / ((this.mode === 'whirl' ? TELE_WHIRL : this.teleNow) * this.teleMul), 0, 1));
      crouch = 0.25 + 0.5 * clamp(k, 0, 1.2); armBack = clamp(k, -0.2, 1.2); armUp = lerp(0.6, 1.8, clamp(k, 0, 1));
      if (this.mode === 'whirl') { armUp = lerp(0.6, 1.2, clamp(k, 0, 1)); spin = -0.6 * clamp(k, 0, 1); }
    } else if (this.state === 'attack') {
      const k = Ease.outExpo(clamp(this.stateT / 0.08, 0, 1));
      crouch = 0.5; slash = k; armUp = lerp(1.8, -0.4, k);
      if (this.mode === 'whirl') { armUp = 1.0; slash = 0.6; spin = Ease.outCubic(clamp(this.stateT / 0.3, 0, 1)) * Math.PI * 2; }
    } else if (this.state === 'recover') {
      const k = clamp(this.stateT / 0.8, 0, 1);
      crouch = 0.4 * (1 - k); armUp = lerp(-0.4, 0.6, Ease.outQuart(k));
    } else if (this.state === 'stagger') crouch = 0.3;
    for (const [leg, p, sgn] of [['FL', ph, 1], ['BR', ph, -1], ['FR', ph + Math.PI, -1], ['BL', ph + Math.PI, 1]] as const) {
      setJoint(out, L, J['leg' + leg], -lift(p) + crouch * 0.4, step(p) * 0.35 * amp * sgn, 0);
      setJoint(out, L, J['shin' + leg], lift(p) * 0.6 - crouch * 0.3, 0, 0);
    }
    const sway = Math.sin(this.time * 2.2) * 0.05;
    setJoint(out, L, J.pelvis, crouch * 0.2, sway, 0);
    setJoint(out, L, J.torso, crouch * 0.5 + armBack * -0.4 + slash * 0.6 + this.puppet.springZ * 0.5, -sway * 2, this.puppet.springX * 0.5);
    setJoint(out, L, J.head, -crouch * 0.6 - slash * 0.4, 0, 0);
    for (const [side, sg] of [['L', 1], ['R', -1]] as const) {
      setJoint(out, L, J['arm' + side], -armUp - armBack * 0.6, 0, sg * (0.35 + slash * 0.5));
      setJoint(out, L, J['scy' + side], -0.4 - armBack * 0.8 + slash * 1.4, 0, 0);
    }
    s.off[J.pelvis * 3 + 1] = -crouch * 0.25 + Math.abs(Math.sin(ph)) * 0.04 * amp;
    s.x = this.x; s.z = this.z; s.y = this.y; s.facing = this.facing + spin;
    s.sx = s.sy = 1; s.sz = this.state === 'attack' && this.mode === 'dash' ? 1.3 : 1;
    s.update();
    this.puppet.boost = this.coreGlow * 1.5;
  }
}
