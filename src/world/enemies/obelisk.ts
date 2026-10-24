import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import type { StunKind } from '../../data/weapons';
import { obeliskRig } from '../../gen/chars/enemies';
import { Enemy, type SpawnOpts } from '../enemy';
import type { StrikeParams, World } from '../world';

const layout = () => layoutOf(obeliskRig());
/** Сколько ударов держит обелиск; полный заряженный удар ломает сразу (план §8.3). */
export const OBELISK_HITS = 3;

/**
 * Обелиск Проповеди Иерофанта (план §8.3): питает щит босса — пока стоят оба, щит −70 % урона; разбить один —
 * щит вдвое слабее. Не атакует, не двигается; держит 3 удара (любых) или 1 полный заряд. Нить от ядра к колоколу.
 */
export class Obelisk extends Enemy {
  /** Кого питает (нить к колоколу). */
  boss: Enemy | null = null;
  private spin = Math.random() * 6;

  constructor(o: SpawnOpts) {
    super(ENEMIES.obelisk, layout(), [], o);
    this.hp = this.maxHp = OBELISK_HITS;
  }

  /** Каждое попадание — один удар, сколько бы урона ни было. */
  override onDamaged(w: World, dmg: number, before: number): void {
    super.onDamaged(w, dmg, before);
    this.hp = Math.max(0, Math.round(before) - 1);
    this.puppet.crack = 1 - this.hp / OBELISK_HITS;
  }

  override onBladeHit(_w: World, p: StrikeParams, kind: StunKind): void {
    if (kind === 'charged' && p.feel === 'heavy') this.hp = 0;
  }

  override interrupt(): void {}
  override launch(): void {}

  protected think(_w: World, _dt: number): void { this.vx = 0; this.vz = 0; }

  protected animate(dt: number): void {
    const s = this.puppet.skel, L = s.layout;
    this.spin += dt * 1.6;
    s.rot.set(L.restRot);
    s.setRotEuler(L.idx('core'), 0, this.spin, 0);
    s.off[L.idx('core') * 3 + 1] = Math.sin(this.spin * 1.7) * 0.08;
    s.x = this.x; s.z = this.z; s.y = 0; s.facing = this.facing;
    s.update();
    this.puppet.boost = 0.6 + (this.boss && !this.boss.dead ? 0.5 + Math.sin(this.spin * 3) * 0.3 : 0);
  }

  /** Ядро на вершине: отсюда нить к колоколу. */
  corePoint(out: { x: number; y: number; z: number }): void { out.x = this.x; out.y = 3.6; out.z = this.z; }
}
