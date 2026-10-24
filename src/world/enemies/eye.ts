import { Ease } from '../../core/ease';
import { angleOf, clamp } from '../../core/math';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { eyeRig } from '../../gen/chars/enemies';
import { Enemy, type SpawnOpts } from '../enemy';
import type { World } from '../world';

const layout = () => layoutOf(eyeRig());
const TELE = 0.6;
const BEAM_TELE = 0.95;
const BEAM_DUR = 0.55;
const BEAM_LEN = 11;

/**
 * Око (GDD §9.2): турель. Висит, стреляет очередью из 3 красных сфер (телеграф 0.6 с: ядро набухает + круг)
 * или прожигает лучом: линия-телеграф 0.95 с, затем луч 0.55 с ведёт веером ±14°. Контрплей — подойти вплотную.
 */
export class Eye extends Enemy {
  private shots = 0;
  private shotT = 0;
  private strafe = Math.random() < 0.5 ? 1 : -1;
  private J: Record<string, number> = {};
  private spin = 0;
  private mode: 'burst' | 'beam' = 'burst';
  /** Луч (для рендера): начало, направление, длина, активен. */
  beam = { x: 0, z: 0, dx: 0, dz: 1, len: BEAM_LEN, on: false };
  private beamA0 = 0; private beamSweep = 1; private beamHit = false;

  constructor(o: SpawnOpts) {
    super(ENEMIES.eye, layout(), [], o);
    const L = layout();
    for (const n of L.names) this.J[n] = L.idx(n);
    this.cooldown = 1.0 + Math.random() * 1.5;
  }

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    const d = this.distTo(h);
    this.faceTo(h.x, h.z, 0.25, dt);
    switch (this.state) {
      case 'idle': case 'chase': case 'orbit': case 'recover': {
        if (d < 3.2) {
          // отступить от героя
          const dx = this.x - h.x, dz = this.z - h.z, l = d || 1;
          this.steer(this.x + (dx / l) * 3, this.z + (dz / l) * 3, this.speed * 1.2, dt);
        } else if (d > 9) this.seek(w, h.x, h.z, this.speed, dt, 7);
        else this.standOff(w, 7, this.speed * 0.5, dt, this.strafe);
        if (tick && this.cooldown <= 0 && d < 12 && !h.dead && w.requestToken(this, 'ranged')) {
          if (d > 4.5 && d < BEAM_LEN - 1 && Math.random() < 0.4) {
            this.mode = 'beam';
            this.beamA0 = angleOf(h.x - this.x, h.z - this.z);
            this.beamSweep = Math.random() < 0.5 ? 1 : -1;
            this.telegraph(w, this.beamShape(this.beamA0 - this.beamSweep * 0.24), BEAM_TELE, false, 'hum');
          } else {
            this.mode = 'burst';
            this.telegraph(w, { k: 'circle', x: this.x, z: this.z, r: 1.3 }, TELE, false, 'hum');
          }
          this.setState('telegraph');
        }
        break;
      }
      case 'telegraph': {
        this.vx *= 0.85; this.vz *= 0.85;
        this.coreGlow = Math.min(1.4, this.coreGlow + dt * 3);
        const tele = (this.mode === 'beam' ? BEAM_TELE : TELE) * this.teleMul;
        if (this.mode === 'beam') {
          // первые 60 % линия следит за Пилотом, затем фиксируется — луч пойдёт веером от неё
          if (this.stateT < tele * 0.6) this.beamA0 = angleOf(h.x - this.x, h.z - this.z);
          if (this.tele) this.tele.shape = this.beamShape(this.beamA0 - this.beamSweep * 0.24);
          this.facing = this.beamA0 - this.beamSweep * 0.24;
        } else if (this.tele && this.tele.shape.k === 'circle') { this.tele.shape.x = this.x; this.tele.shape.z = this.z; }
        if (this.stateT >= tele) {
          this.shots = 0; this.shotT = 0; this.beamHit = false;
          if (this.mode === 'beam') { this.cancelTelegraph(); w.bus.emit('enemyAttack', { kind: 'beam', x: this.x, z: this.z }); }
          this.setState('attack');
        }
        break;
      }
      case 'attack':
        if (this.mode === 'beam') {
          this.vx *= 0.7; this.vz *= 0.7;
          this.coreGlow = 1.5;
          const u = Math.min(1, this.stateT / BEAM_DUR);
          const a = this.beamA0 + this.beamSweep * (-0.24 + 0.48 * u);
          this.facing = a;
          const sh = this.beamShape(a);
          if (sh.k === 'line') { this.beam.x = sh.x; this.beam.z = sh.z; this.beam.dx = sh.dx; this.beam.dz = sh.dz; }
          this.beam.on = true;
          if (!this.beamHit && w.enemyStrike(this, sh, this.dmg * 1.4, 2.5) !== 'miss') this.beamHit = true;
          if (u >= 1) {
            this.beam.on = false;
            this.token = null;
            this.cooldown = 2.6 + Math.random() * 1.2;
            this.setState('recover');
          }
          break;
        }
        this.vx *= 0.85; this.vz *= 0.85;
        this.coreGlow = 1.4;
        this.shotT -= dt;
        if (this.shotT <= 0 && this.shots < 3) {
          this.shots++;
          this.shotT = 0.16;
          // упреждение по скорости героя
          const lead = d / 8.5 * 0.5;
          const tx = h.x + h.vx * lead, tz = h.z + h.vz * lead;
          const a = angleOf(tx - this.x, tz - this.z) + (this.shots - 2) * 0.06;
          const sp = 8.5;
          w.spawnProjectile('orb', this.x + Math.sin(a) * 0.6, this.z + Math.cos(a) * 0.6, Math.sin(a) * sp, Math.cos(a) * sp, this.dmg, this.id, 0.3, 3.5, 1.9);
          this.puppet.kickSpring(-Math.sin(a), -Math.cos(a), 0.6);
        }
        if (this.shots >= 3 && this.shotT <= 0) {
          this.cancelTelegraph();
          this.token = null;
          this.cooldown = 2.2 + Math.random() * 1.2;
          this.setState('recover');
        }
        break;
      default: break;
    }
  }

  private beamShape(a: number) {
    const dx = Math.sin(a), dz = Math.cos(a);
    return { k: 'line' as const, x: this.x + dx * 0.6, z: this.z + dz * 0.6, dx, dz, len: BEAM_LEN, w: 0.9 };
  }

  override kill(w: World, dirX: number, dirZ: number, power: number): void { this.beam.on = false; super.kill(w, dirX, dirZ, power); }
  override interrupt(dur: number, heavy = false): void { this.beam.on = false; super.interrupt(dur, heavy); }

  protected animate(dt: number): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot, J = this.J;
    out.set(L.restRot);
    let open = 0.15, swell = 0;
    if (this.state === 'telegraph') { const k = Ease.inBack(clamp(this.stateT / (TELE * this.teleMul), 0, 1)); open = 0.15 + 0.9 * clamp(k, 0, 1); swell = k; }
    else if (this.state === 'attack') { open = 1.1; swell = 1; }
    else if (this.state === 'stagger') open = -0.1;
    this.spin += dt * (1.5 + swell * 6);
    setJoint(out, L, J.ring, 0, 0, this.spin);
    for (let i = 0; i < 4; i++) setJoint(out, L, J[`petal${i}`], -open * 1.2, 0, 0);
    const bob = Math.sin(this.time * 2.4) * 0.12;
    s.off[J.core * 3 + 1] = bob;
    setJoint(out, L, J.core, this.puppet.springZ * 0.8, 0, this.puppet.springX * 0.8);
    s.scl[J.core * 3] = s.scl[J.core * 3 + 1] = s.scl[J.core * 3 + 2] = 1 + swell * 0.18;
    s.x = this.x; s.z = this.z; s.y = this.y; s.facing = this.facing;
    s.update();
    this.puppet.boost = this.coreGlow * 1.6;
  }
}
