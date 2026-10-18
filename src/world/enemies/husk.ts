import { Ease } from '../../core/ease';
import { angleOf, clamp, lerp } from '../../core/math';
import { BipedGait, bipedJoints, setJoint, type BipedJoints } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { huskRig } from '../../gen/chars/enemies';
import { Enemy, type SpawnOpts } from '../enemy';
import type { World } from '../world';

const layout = () => layoutOf(huskRig());
const SWIPE_TELE = 0.42;
const LEAP_TELE = 0.5;
const LEAP_DUR = 0.42;

/**
 * Шелуха: рой. Бежит толпой, рвёт когтями (замах 0.42 с) и иногда прыгает с 4–6 м
 * (тень приземления 0.5 с). Падает от одного-двух ударов — топливо для ульты и ранга.
 */
export class Husk extends Enemy {
  private gait = new BipedGait(0.95, 4.6);
  private J: BipedJoints;
  private ang = Math.random() * Math.PI * 2;
  private mode: 'swipe' | 'leap' = 'swipe';
  private fromX = 0; private fromZ = 0; private toX = 0; private toZ = 0;
  private swipeSide = 1;

  constructor(o: SpawnOpts) {
    super(ENEMIES.husk, layout(), [], o);
    this.J = bipedJoints(layout());
    this.speed *= 0.88 + Math.random() * 0.3;
    this.cooldown = 0.4 + Math.random() * 1.2;
  }

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    const d = this.distTo(h);
    switch (this.state) {
      case 'idle': case 'chase': case 'recover': {
        if (this.state === 'recover' && this.stateT < 0.45) { this.vx *= 0.85; this.vz *= 0.85; break; }
        if (this.state !== 'chase') this.setState('chase');
        const ox = Math.sin(this.ang) * 1.6, oz = Math.cos(this.ang) * 1.6;
        this.steer(h.x + (d > 3 ? ox : 0), h.z + (d > 3 ? oz : 0), this.speed, dt, 0.85);
        this.faceTo(h.x, h.z, 0.08, dt);
        if (!tick || h.dead || this.cooldown > 0) break;
        if (d > 3.8 && d < 6.2 && Math.random() < 0.05 && w.requestToken(this, 'swarm')) {
          // прыжок: точка приземления — где герой сейчас (с недолётом)
          this.mode = 'leap';
          const k = Math.max(0, d - 0.8) / d;
          this.fromX = this.x; this.fromZ = this.z;
          this.toX = this.x + (h.x - this.x) * k; this.toZ = this.z + (h.z - this.z) * k;
          this.facing = angleOf(h.x - this.x, h.z - this.z);
          this.telegraph(w, { k: 'circle', x: this.toX, z: this.toZ, r: 1.1 }, LEAP_TELE, false, 'hum');
          this.setState('telegraph');
        } else if (d < 1.6 && w.requestToken(this, 'swarm')) {
          this.mode = 'swipe';
          this.swipeSide = Math.random() < 0.5 ? 1 : -1;
          this.facing = angleOf(h.x - this.x, h.z - this.z);
          this.telegraph(w, { k: 'arc', x: this.x, z: this.z, r: 1.5, dir: this.facing, half: 0.8 }, SWIPE_TELE, false, 'hum');
          this.setState('telegraph');
        }
        break;
      }
      case 'telegraph': {
        const tele = (this.mode === 'leap' ? LEAP_TELE : SWIPE_TELE) * this.teleMul;
        this.vx *= 0.7; this.vz *= 0.7;
        this.coreGlow = Math.min(1, this.coreGlow + dt * 3.5);
        if (this.mode === 'swipe' && this.tele && this.tele.shape.k === 'arc') { this.tele.shape.x = this.x; this.tele.shape.z = this.z; }
        if (this.stateT >= tele) {
          this.attackDone = false;
          this.setState('attack');
          w.bus.emit('enemyAttack', { kind: this.mode === 'leap' ? 'bite' : 'slash', x: this.x, z: this.z });
          if (this.mode === 'leap') { this.fromX = this.x; this.fromZ = this.z; }
        }
        break;
      }
      case 'attack':
        if (this.mode === 'leap') {
          const u = clamp(this.stateT / LEAP_DUR, 0, 1);
          const e = Ease.inOutQuad(u);
          this.x = lerp(this.fromX, this.toX, e); this.z = lerp(this.fromZ, this.toZ, e);
          this.y = Math.sin(u * Math.PI) * 1.4;
          this.vx = this.vz = 0;
          if (u >= 1 && !this.attackDone) {
            this.attackDone = true; this.y = 0;
            w.enemyStrike(this, { k: 'circle', x: this.x, z: this.z, r: 1.1 }, this.dmg * 1.3, 3);
            w.bus.emit('impact', { x: this.x, z: this.z, r: 1.1, kind: 'land' });
            this.endAttack(0.9);
          }
        } else {
          this.vx = Math.sin(this.facing) * 3 * (1 - this.stateT / 0.14); this.vz = Math.cos(this.facing) * 3 * (1 - this.stateT / 0.14);
          if (!this.attackDone && this.stateT >= 0.05) {
            this.attackDone = true;
            w.enemyStrike(this, { k: 'arc', x: this.x, z: this.z, r: 1.4, dir: this.facing, half: 0.8 }, this.dmg, 2);
          }
          if (this.stateT >= 0.16) this.endAttack(0.6 + Math.random() * 0.8);
        }
        break;
      default: break;
    }
  }

  private endAttack(cd: number): void {
    this.cancelTelegraph();
    this.token = null;
    this.cooldown = cd;
    this.setState('recover');
  }

  protected animate(dt: number): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot, J = this.J;
    const sp = Math.hypot(this.vx, this.vz);
    const run = this.state === 'chase' || this.state === 'idle';
    this.gait.update(sp * dt, run ? sp : 0, 0, dt);
    this.gait.write(out, L, J, false);
    let wind = 0, swipe = 0, air = 0;
    if (this.state === 'telegraph') wind = Ease.inBack(clamp(this.stateT / ((this.mode === 'leap' ? LEAP_TELE : SWIPE_TELE) * this.teleMul), 0, 1));
    else if (this.state === 'attack') { if (this.mode === 'swipe') swipe = Ease.outExpo(clamp(this.stateT / 0.07, 0, 1)); else air = 1; }
    else if (this.state === 'recover') swipe = 1 - Ease.outQuart(clamp(this.stateT / 0.45, 0, 1));
    const sd = this.swipeSide;
    // замах: корпус скручивается, рука с когтями за голову; удар — наискосок вниз
    if (this.mode === 'swipe' && (wind > 0 || swipe > 0)) {
      const w0 = clamp(wind, -0.2, 1.2) * (1 - swipe);
      setJoint(out, L, J.chest, 0.3 * w0 + 0.5 * swipe, sd * (0.6 * w0 - 0.7 * swipe), 0);
      setJoint(out, L, sd > 0 ? J.shL : J.shR, lerp(-0.4, -2.8, w0) + swipe * 1.2, 0, sd * (0.2 + 0.5 * w0 - 0.6 * swipe));
      setJoint(out, L, sd > 0 ? J.elbL : J.elbR, -1.2 * w0, 0, 0);
    }
    if (this.mode === 'leap' && (wind > 0 || air > 0)) {
      const crouch = clamp(wind, 0, 1.2) * (1 - air);
      setJoint(out, L, J.hipL, -1.0 * crouch + 0.6 * air, 0, 0.1); setJoint(out, L, J.kneeL, 1.4 * crouch + 0.3 * air, 0, 0);
      setJoint(out, L, J.hipR, -1.0 * crouch + 0.6 * air, 0, -0.1); setJoint(out, L, J.kneeR, 1.4 * crouch + 0.3 * air, 0, 0);
      setJoint(out, L, J.shL, -2.4 * air - 0.6 * crouch, 0, 0.4); setJoint(out, L, J.shR, -2.4 * air - 0.6 * crouch, 0, -0.4);
      setJoint(out, L, J.chest, 0.4 * crouch - 0.3 * air, 0, 0);
    }
    if (this.state === 'stagger') setJoint(out, L, J.chest, -0.5, 0, this.puppet.springX * 0.8);
    s.x = this.x; s.z = this.z; s.facing = this.facing;
    s.y = this.y + this.gait.bob - (this.mode === 'leap' ? clamp(wind, 0, 1) * 0.18 : 0);
    s.tiltX = this.puppet.springZ * 0.2; s.tiltZ = -this.puppet.springX * 0.2;
    s.update();
    this.puppet.boost = this.coreGlow * 1.4;
  }
}
