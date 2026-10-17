import { Ease } from '../../core/ease';
import { clamp, lerp } from '../../core/math';
import { BipedGait, bipedJoints, setJoint, type BipedJoints } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { bruteRig } from '../../gen/chars/enemies';
import { Enemy, type SpawnOpts } from '../enemy';
import type { World } from '../world';

const layout = () => layoutOf(bruteRig());
const TELE = 1.0;
const SLAM_R = 3.5;

/**
 * Обсидиановый голем (GDD §9.2): танк. Медленно идёт, удар двумя руками с ударной волной 3.5 м.
 * Телеграф 1.0 с: руки вверх, круг заливается. Контрплей — слом стойки (40) → казнь.
 */
export class Golem extends Enemy {
  private gait = new BipedGait(2.1, 1.7, true);
  private J: BipedJoints;
  private lastStep = 0;

  constructor(o: SpawnOpts) {
    super(ENEMIES.golem, layout(), [], o);
    this.J = bipedJoints(layout());
    this.cooldown = 0.6;
  }

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    const d = this.distTo(h);
    switch (this.state) {
      case 'idle': case 'chase': case 'recover': {
        if (this.state === 'recover' && this.stateT < 1.5) { this.vx *= 0.85; this.vz *= 0.85; break; }
        if (this.state !== 'chase') this.setState('chase');
        this.steer(h.x, h.z, this.speed, dt, 2.2);
        this.faceTo(h.x, h.z, 0.4, dt);
        if (tick && d < 3.4 && this.cooldown <= 0 && !h.dead && w.requestToken(this, 'melee')) {
          this.telegraph(w, { k: 'circle', x: this.x, z: this.z, r: SLAM_R }, TELE, false, 'roar');
          this.setState('telegraph');
        }
        break;
      }
      case 'telegraph':
        this.vx *= 0.8; this.vz *= 0.8;
        this.coreGlow = Math.min(1.5, this.coreGlow + dt * 2);
        this.faceTo(h.x, h.z, 0.5, dt);
        if (this.tele && this.tele.shape.k === 'circle') { this.tele.shape.x = this.x; this.tele.shape.z = this.z; }
        if (this.stateT >= TELE * this.teleMul) {
          w.enemyStrike(this, { k: 'circle', x: this.x, z: this.z, r: SLAM_R }, this.dmg, 6);
          w.bus.emit('impact', { x: this.x + Math.sin(this.facing) * 0.8, z: this.z + Math.cos(this.facing) * 0.8, r: SLAM_R, kind: 'slam' });
          w.bus.emit('enemyAttack', { kind: 'slam', x: this.x, z: this.z });
          this.cancelTelegraph();
          this.setState('attack');
        }
        break;
      case 'attack':
        this.vx = this.vz = 0;
        if (this.stateT >= 0.3) {
          this.token = null;
          this.cooldown = 1.4 + Math.random();
          this.setState('recover');
        }
        break;
      default: break;
    }
  }

  protected animate(dt: number, w: World): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot, J = this.J;
    const sp = Math.hypot(this.vx, this.vz);
    const moving = this.state === 'chase';
    this.gait.update(sp * dt, moving ? sp : 0, 0, dt);
    this.gait.write(out, L, J, false);
    // шаг — микротряска камеры и пыль
    const stepIdx = Math.floor(this.gait.phase * 2);
    if (stepIdx !== this.lastStep && moving && sp > 0.5) { this.lastStep = stepIdx; w.bus.emit('impact', { x: this.x, z: this.z, r: 1.2, kind: 'land' }); }
    let raise = 0, slam = 0, kneel = 0;
    if (this.state === 'telegraph') raise = Ease.inBack(clamp(this.stateT / (TELE * this.teleMul), 0, 1));
    else if (this.state === 'attack') { slam = Ease.outExpo(clamp(this.stateT / 0.08, 0, 1)); raise = 1 - slam; }
    else if (this.state === 'recover' && this.stateT < 1.0) { slam = 1 - Ease.outQuart(clamp(this.stateT / 1.0, 0, 1)); }
    if (this.state === 'broken') kneel = Math.min(1, this.stateT * 4);
    const r = clamp(raise, -0.2, 1.2);
    if (r > 0 || slam > 0) {
      setJoint(out, L, J.shL, lerp(-0.2, -2.9, r) + slam * -1.2, 0, 0.3 - r * 0.1);
      setJoint(out, L, J.shR, lerp(-0.2, -2.9, r) + slam * -1.2, 0, -0.3 + r * 0.1);
      setJoint(out, L, J.elbL, -0.4 * r, 0, 0);
      setJoint(out, L, J.elbR, -0.4 * r, 0, 0);
      setJoint(out, L, J.chest, -0.25 * r + slam * 0.7, 0, 0);
      setJoint(out, L, J.spine, -0.1 * r + slam * 0.3, 0, 0);
      setJoint(out, L, J.hipL, -0.3 * slam, 0, 0.1); setJoint(out, L, J.kneeL, 0.6 * slam, 0, 0);
      setJoint(out, L, J.hipR, -0.3 * slam, 0, -0.1); setJoint(out, L, J.kneeR, 0.6 * slam, 0, 0);
    }
    if (kneel > 0) {
      setJoint(out, L, J.hipL, -1.4 * kneel, 0, 0.2); setJoint(out, L, J.kneeL, 1.5 * kneel, 0, 0);
      setJoint(out, L, J.hipR, 0.1 * kneel, 0, -0.2); setJoint(out, L, J.kneeR, 1.6 * kneel, 0, 0);
      setJoint(out, L, J.chest, 0.6 * kneel, 0, 0.1 * Math.sin(this.time * 9) * kneel);
      setJoint(out, L, J.shL, 0.3 * kneel, 0, 0.5); setJoint(out, L, J.shR, 0.3 * kneel, 0, -0.5);
    }
    setJoint(out, L, J.head, 0, 0, 0);
    s.x = this.x; s.z = this.z; s.facing = this.facing;
    s.y = this.y + this.gait.bob * 1.2 - kneel * 0.55 - slam * 0.2;
    s.tiltX = this.puppet.springZ * 0.12; s.tiltZ = -this.puppet.springX * 0.12;
    s.update();
    this.puppet.boost = this.coreGlow * 1.2;
  }
}
