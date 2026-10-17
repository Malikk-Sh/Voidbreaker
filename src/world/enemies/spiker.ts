import { Ease } from '../../core/ease';
import { angleOf, clamp } from '../../core/math';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { CRAWLER_LEGS, crawlerRig } from '../../gen/chars/enemies';
import { Enemy, type SpawnOpts } from '../enemy';
import type { World } from '../world';

const layout = () => layoutOf(crawlerRig());
/** Группы «треноги»: передняя левая, средняя правая, задняя левая — и наоборот. */
const TRIPOD = [1, 0, 1, 0, 1, 0];

/** Шипник (GDD §9.2): рой, бежит толпой и кусает; телеграф — присед 0.4 с. Вращение косит пачками. */
export class Spiker extends Enemy {
  private gait = 0;
  private lungeDX = 0; private lungeDZ = 0;
  private jI: number[];
  private ang = Math.random() * Math.PI * 2;

  constructor(o: SpawnOpts) {
    super(ENEMIES.spiker, layout(), [], o);
    const L = layout();
    this.jI = [L.idx('body'), L.idx('jaw')];
    this.speed *= 0.9 + Math.random() * 0.25;
  }

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    const d = this.distTo(h);
    switch (this.state) {
      case 'idle': case 'chase': case 'recover': {
        if (this.state === 'recover' && this.stateT < 0.55) { this.vx *= 0.85; this.vz *= 0.85; break; }
        if (this.state !== 'chase') this.setState('chase');
        // рой: заход с разных сторон
        const ox = Math.sin(this.ang) * 1.2, oz = Math.cos(this.ang) * 1.2;
        this.steer(h.x + (d > 3 ? ox : 0), h.z + (d > 3 ? oz : 0), this.speed, dt, 0.9);
        this.faceTo(h.x, h.z, 0.1, dt);
        if (tick && d < 1.7 && this.cooldown <= 0 && !h.dead && w.requestToken(this, 'melee')) {
          this.facing = angleOf(h.x - this.x, h.z - this.z);
          this.telegraph(w, { k: 'arc', x: this.x, z: this.z, r: 1.65, dir: this.facing, half: 0.7 }, 0.4, false, 'hum');
          this.setState('telegraph');
        }
        break;
      }
      case 'telegraph':
        this.vx *= 0.7; this.vz *= 0.7;
        this.coreGlow = Math.min(1, this.coreGlow + dt * 4);
        if (this.tele) { const s = this.tele.shape; if (s.k === 'arc') { s.x = this.x; s.z = this.z; } }
        if (this.stateT >= 0.4 * this.teleMul) {
          this.lungeDX = Math.sin(this.facing); this.lungeDZ = Math.cos(this.facing);
          this.attackDone = false;
          this.setState('attack');
          w.bus.emit('enemyAttack', { kind: 'bite', x: this.x, z: this.z });
        }
        break;
      case 'attack':
        this.vx = this.lungeDX * 9 * (1 - this.stateT / 0.14); this.vz = this.lungeDZ * 9 * (1 - this.stateT / 0.14);
        if (!this.attackDone && this.stateT >= 0.06) {
          this.attackDone = true;
          w.enemyStrike(this, { k: 'arc', x: this.x, z: this.z, r: 1.4, dir: this.facing, half: 0.75 }, this.dmg, 2);
        }
        if (this.stateT >= 0.16) {
          this.cancelTelegraph();
          this.token = null;
          this.cooldown = 0.9 + Math.random() * 0.8;
          this.setState('recover');
        }
        break;
      default: break;
    }
  }

  protected animate(dt: number): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot;
    const sp = Math.hypot(this.vx, this.vz);
    this.gait += sp * dt / 0.55;
    out.set(L.restRot);
    const amp = clamp(sp / 3, 0, 1);
    let crouch = 0, jaw = 0.1;
    if (this.state === 'telegraph') { crouch = Ease.inBack(clamp(this.stateT / (0.4 * this.teleMul), 0, 1)) * 0.8 + 0.2; jaw = 0.5 * crouch; }
    else if (this.state === 'attack') { crouch = -0.4; jaw = 0.8; }
    else if (this.state === 'stagger') { crouch = 0.4; jaw = 0.4; }
    for (let i = 0; i < CRAWLER_LEGS; i++) {
      const ph = this.gait * Math.PI * 2 + (TRIPOD[i] ? Math.PI : 0);
      const lift = Math.max(0, Math.sin(ph)) * 0.55 * amp;
      const sweep = Math.cos(ph) * 0.4 * amp;
      setJoint(out, L, L.idx(`hip${i}`), -lift + crouch * 0.35, sweep * (i < 3 ? 1 : -1), 0);
      setJoint(out, L, L.idx(`knee${i}`), lift * 0.5 - crouch * 0.25, 0, 0);
    }
    const bob = Math.abs(Math.sin(this.gait * Math.PI * 2)) * 0.05 * amp;
    setJoint(out, L, this.jI[0], 0.15 * amp + crouch * 0.3 + this.puppet.springZ * 0.4, Math.sin(this.time * 9) * 0.05, this.puppet.springX * 0.4);
    setJoint(out, L, this.jI[1], jaw, 0, 0);
    s.off[this.jI[0] * 3 + 1] = bob - crouch * 0.2;
    s.x = this.x; s.z = this.z; s.y = this.y; s.facing = this.facing;
    s.sx = s.sy = s.sz = 1;
    if (this.state === 'attack') s.sz = 1.25;
    s.update();
    this.puppet.boost = this.coreGlow * 1.5;
  }
}
