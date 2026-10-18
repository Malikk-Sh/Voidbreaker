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
const THROW_TELE = 0.75;
const THROW_FLIGHT = 0.6;
const THROW_R = 1.9;

/**
 * Обсидиановый голем (GDD §9.2): танк. Медленно идёт; вблизи — удар двумя руками (круг 3.5 м) и расходящееся
 * кольцо с двумя разрывами; издали — вырывает глыбу из пола и бросает навесом (метка приземления 1.35 с).
 * Контрплей — слом стойки (40) и Раскол.
 */
export class Golem extends Enemy {
  private gait = new BipedGait(2.1, 1.7, true);
  private J: BipedJoints;
  private lastStep = 0;
  private mode: 'slam' | 'throw' = 'slam';
  private throwCd = 2 + Math.random() * 2;
  private tx = 0; private tz = 0;

  constructor(o: SpawnOpts) {
    super(ENEMIES.golem, layout(), [], o);
    this.J = bipedJoints(layout());
    this.cooldown = 0.6;
    this.heavyWindup = true;
  }

  override windupPoint(out: { x: number; y: number; z: number }): void {
    out.x = this.x; out.y = this.height + 0.6; out.z = this.z;
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
        this.throwCd -= dt;
        if (tick && d < 3.4 && this.cooldown <= 0 && !h.dead && w.requestToken(this, 'melee')) {
          this.mode = 'slam';
          this.telegraph(w, { k: 'circle', x: this.x, z: this.z, r: SLAM_R }, TELE, false, 'roar');
          this.setState('telegraph');
        } else if (tick && d > 5.5 && d < 13 && this.throwCd <= 0 && this.cooldown <= 0 && !h.dead && w.requestToken(this, 'ranged')) {
          // бросок глыбы: метка там, где Пилот сейчас (+ упреждение)
          this.mode = 'throw';
          this.tx = h.x + h.vx * 0.35; this.tz = h.z + h.vz * 0.35;
          const o = { x: this.tx, z: this.tz };
          w.arena.nearestWalkable(this.tx, this.tz, o);
          this.tx = o.x; this.tz = o.z;
          this.faceTo(this.tx, this.tz, 0.01, 1);
          this.telegraph(w, { k: 'circle', x: this.tx, z: this.tz, r: THROW_R }, THROW_TELE + THROW_FLIGHT, false, 'roar');
          this.setState('telegraph');
        }
        break;
      }
      case 'telegraph':
        this.vx *= 0.8; this.vz *= 0.8;
        this.coreGlow = Math.min(1.5, this.coreGlow + dt * 2);
        if (this.mode === 'throw') {
          this.faceTo(this.tx, this.tz, 0.2, dt);
          if (this.stateT >= THROW_TELE * this.teleMul) {
            // глыба летит; удар — по метке в момент приземления
            const fx = this.x + Math.sin(this.facing) * 0.6, fz = this.z + Math.cos(this.facing) * 0.6;
            const tx = this.tx, tz = this.tz, dmg = this.dmg * 0.9, id = this.id, tele = this.tele;
            this.tele = null;
            w.bus.emit('lob', { fx, fz, tx, tz, dur: THROW_FLIGHT, size: 1.3 });
            w.bus.emit('enemyAttack', { kind: 'throw', x: this.x, z: this.z });
            let t = 0;
            const hook = (dtw: number) => {
              t += dtw;
              if (t < THROW_FLIGHT) return;
              const i = w.stepHooks.indexOf(hook); if (i >= 0) w.stepHooks.splice(i, 1);
              if (tele) tele.alive = false;
              w.enemyStrike({ x: tx, z: tz, id, kind: 'golem' }, { k: 'circle', x: tx, z: tz, r: THROW_R }, dmg, 5);
              w.bus.emit('impact', { x: tx, z: tz, r: THROW_R, kind: 'slam' });
            };
            w.stepHooks.push(hook);
            this.throwCd = 5 + Math.random() * 3;
            this.setState('attack');
          }
          break;
        }
        this.faceTo(h.x, h.z, 0.5, dt);
        if (this.tele && this.tele.shape.k === 'circle') { this.tele.shape.x = this.x; this.tele.shape.z = this.z; }
        if (this.stateT >= TELE * this.teleMul) {
          w.enemyStrike(this, { k: 'circle', x: this.x, z: this.z, r: SLAM_R }, this.dmg, 6);
          w.bus.emit('impact', { x: this.x + Math.sin(this.facing) * 0.8, z: this.z + Math.cos(this.facing) * 0.8, r: SLAM_R, kind: 'slam' });
          w.bus.emit('enemyAttack', { kind: 'slam', x: this.x, z: this.z });
          // ударная волна: расходящееся кольцо с двумя разрывами
          const g0 = w.rng.next() * Math.PI * 2;
          w.addRingWave(this.x, this.z, 6.5, 0.7, 8, [{ a: g0, w: 1.0 }, { a: g0 + Math.PI, w: 1.0 }], this.dmg * 0.45, this.id);
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
    if (this.state === 'telegraph' && this.mode === 'throw') raise = Ease.inOutQuad(clamp(this.stateT / (THROW_TELE * this.teleMul), 0, 1));
    else if (this.state === 'telegraph') raise = Ease.inBack(clamp(this.stateT / (TELE * this.teleMul), 0, 1));
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
