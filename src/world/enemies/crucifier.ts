import * as THREE from 'three';
import { Ease } from '../../core/ease';
import { angleDiff, angleOf, clamp, lerp } from '../../core/math';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { ENEMIES } from '../../data/enemies';
import { CRUCIFIER_BLADE, CRUCIFIER_BLADE2, crucifierRig } from '../../gen/chars/enemies';
import type { Shape } from '../combat';
import type { Telegraph } from '../entities';
import { Enemy, type SpawnOpts } from '../enemy';
import type { World } from '../world';

const _p = new THREE.Vector3();

/** Веер клинков: телеграф, длина и ширина полос, окно после удара. */
export const FAN_TELE = 0.8;
/**
 * Полосы веера к направлению на героя. В плане ±10° / ±30° при ширине 1 м: просвет между полосами для героя
 * (радиус 0.45) открывался бы только за 5.5 м из 6 — читать было бы нечего. ±12° / ±36° и 0.7 м открывают
 * просветы с 3.9 м.
 */
export const FAN_ANG = [-36, -12, 12, 36].map((d) => (d * Math.PI) / 180);
export const FAN_LEN = 6;
export const FAN_W = 0.7;
const FAN_WINDOW = 0.7;
/** Гвоздь: телеграф, радиус круга, досягаемость, застревание при промахе. */
export const NAIL_TELE = 0.6;
export const NAIL_R = 1.1;
const NAIL_REACH = 2.6;
export const NAIL_STUCK = 1.4;
/** Погребальный ряд: полосы 2.5 × 1 м на 2, 4, 6 м с шагом 0.3 с, шипы через 0.7 с после появления. */
export const ROW_STEP = 0.3;
export const ROW_TELE = 0.7;
export const ROW_D = [2, 4, 6];
export const ROW_W = 2.5;
const ROW_WINDOW = 0.9;

type Mode = 'fan' | 'nail' | 'row';

/** Поза: наклоны рук — «мировые» (0 — вниз, −π/2 — вперёд, −π — над головой), клинки — относительно руки. */
interface Pose {
  lean: number; crouch: number; headX: number; ribs: number;
  aLx: number; aLz: number; bLx: number; bLz: number;
  aRx: number; aRz: number; bRx: number; bRz: number;
  a2x: number; a2z: number; b2x: number;
}
const BASE: Pose = {
  lean: 0.25, crouch: 0.1, headX: 0, ribs: 0,
  aLx: -1.9, aLz: 0.2, bLx: 1.65, bLz: 0,
  aRx: -1.9, aRz: 0.2, bRx: 1.65, bRz: 0,
  a2x: 0.3, a2z: 0.12, b2x: 0.1,
};

/**
 * Распинатель (план §7.2): полутяжёлый дуэлянт Зоны 01 с этапа 1-4. Вопрос игроку — «ты читаешь направление удара?»
 * Четыре руки: верхние клинки 1.8 м, нижние короткие волочатся по полу. Суперброня только во время атаки —
 * лёгкие удары её не прерывают, тяжёлые прерывают. Атаки: Веер клинков (четыре полосы), Гвоздь (застревает при
 * промахе — окно 1.4 с), Погребальный ряд (три полосы шипов «та-та-ТА»).
 */
export class Crucifier extends Enemy {
  private J: Record<string, number> = {};
  private mode: Mode = 'fan';
  private lastMode: Mode | null = null;
  private dirX = 0; private dirZ = 1;
  /** Остальные полосы веера (первая — this.tele). */
  private extra: Telegraph[] = [];
  private rows: { tele: Telegraph | null; done: boolean }[] = [];
  private nailX = 0; private nailZ = 0;
  /** Клинок застрял в камне после промаха Гвоздём (с). */
  stuck = 0;
  /** Сколько секунд стоять после атаки (окно уязвимости). */
  private hold = 0;
  /** Выпад к точке Гвоздя: обычная скорость, не отбрасывание — края и провалы держат (с, м/с). */
  private lungeT = 0; private lungeVX = 0; private lungeVZ = 0;
  private orbitDir = 1;
  private gait = 0;
  private scrapeT = 0; private scrapeSide = 0;
  private headYaw = 0;
  private readonly pose: Pose = { ...BASE };
  private readonly stick: Map<number, number>;
  private readonly pop: Set<number>;

  constructor(o: SpawnOpts) {
    super(ENEMIES.crucifier, layoutOf(crucifierRig()), [], o);
    const L = this.puppet.layout;
    for (const n of L.names) this.J[n] = L.idx(n);
    const J = this.J;
    this.cooldown = 1.0 + Math.random() * 0.8;
    this.orbitDir = this.id % 2 ? 1 : -1;
    // смерть: рёбра лопаются, четыре клинка втыкаются в пол на 1 с, затем всё растворяется
    this.dissolveDelay = 1.25;
    const k = this.scale;
    this.stick = new Map([[J.bladeL, CRUCIFIER_BLADE * 0.72 * k], [J.bladeR, CRUCIFIER_BLADE * 0.72 * k], [J.blade2L, CRUCIFIER_BLADE2 * 0.7 * k], [J.blade2R, CRUCIFIER_BLADE2 * 0.7 * k]]);
    this.pop = new Set([J.ribsL, J.ribsR]);
  }

  /** Суперброня — только пока замах и удар. */
  override get superArmor(): boolean { return this.state === 'telegraph' || this.state === 'attack'; }
  /** Клинок застрял — окно уязвимости. */
  override get inWindow(): boolean { return this.stuck > 0; }
  get attackMode(): Mode { return this.mode; }

  override windupPoint(out: { x: number; y: number; z: number }): void {
    const s = this.puppet.skel;
    const p = this.mode === 'nail' ? s.jointPoint(this.J.bladeR, 0, -CRUCIFIER_BLADE, 0, _p) : s.jointPoint(this.J.chest, 0, 0.24, 0.14, _p);
    out.x = p.x; out.y = p.y; out.z = p.z;
  }

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    const d = this.distTo(h);
    if (this.stuck > 0) this.stuck = Math.max(0, this.stuck - dt);
    switch (this.state) {
      case 'idle': case 'chase': case 'orbit': case 'recover': {
        if (this.state === 'recover' && this.stateT < this.hold) {
          if (this.lungeT > 0) { this.lungeT -= dt; this.vx = this.lungeVX; this.vz = this.lungeVZ; break; }
          this.vx *= 0.8; this.vz *= 0.8;
          if (this.stuck <= 0) this.faceTo(h.x, h.z, 0.6, dt);
          break;
        }
        if (d > 5.4) { this.seek(w, h.x, h.z, this.speed, dt, 4); if (this.state !== 'chase') this.setState('chase'); }
        else {
          if (this.state !== 'orbit') this.setState('orbit');
          if (tick && w.rng.next() < 0.008) this.orbitDir *= -1;
          this.standOff(w, 4.2, this.speed * 0.5, dt, this.orbitDir);
        }
        this.faceTo(h.x, h.z, 0.3, dt);
        if (!tick || h.dead || this.cooldown > 0) break;
        this.pickAttack(w, d);
        break;
      }
      case 'telegraph':
        this.vx *= 0.8; this.vz *= 0.8;
        this.coreGlow = Math.min(1, this.coreGlow + dt * 2.5);
        if (this.mode === 'fan') this.stepFanTele(w);
        else if (this.mode === 'nail') this.stepNailTele(w, dt);
        else this.stepRow(w);
        break;
      case 'attack':
        this.vx *= 0.6; this.vz *= 0.6;
        if (this.stateT >= 0.14) this.finish(FAN_WINDOW, 1.0 + w.rng.next() * 0.8);
        break;
      default: break;
    }
  }

  private pickAttack(w: World, d: number): void {
    let m: Mode | null = null;
    if (d < 3.0) m = 'nail';
    else if (d < 5.6) m = this.lastMode === 'fan' && d > 4 ? 'row' : 'fan';
    else if (d < 7.5) m = 'row';
    if (!m || !w.requestToken(this, m === 'row' ? 'ranged' : 'melee')) return;
    this.mode = m; this.lastMode = m;
    const h = w.hero;
    this.aim(h.x, h.z);
    if (m === 'fan') {
      for (let k = 0; k < FAN_ANG.length; k++) {
        const sh = this.fanShape(k);
        if (k === 0) this.telegraph(w, sh, FAN_TELE, false, 'whistle');
        else this.extra.push(w.addTelegraph(sh, FAN_TELE * this.teleMul));
      }
    } else if (m === 'nail') {
      this.nailTarget(h.x, h.z);
      this.telegraph(w, { k: 'circle', x: this.nailX, z: this.nailZ, r: NAIL_R }, NAIL_TELE, false, 'whistle');
    } else this.rows.length = 0;
    this.setState('telegraph');
  }

  /** Полоса веера k: от тела, под углом FAN_ANG[k] к направлению на героя. */
  private fanShape(k: number): Shape {
    const a = this.facing + FAN_ANG[k];
    return { k: 'line', x: this.x, z: this.z, dx: Math.sin(a), dz: Math.cos(a), len: FAN_LEN, w: FAN_W };
  }

  private stepFanTele(w: World): void {
    if (this.stateT < FAN_TELE * this.teleMul) return;
    // удар по меткам на полу: что видно — то и бьёт; герой получает урон один раз
    const shapes = [this.tele, ...this.extra].filter((t): t is Telegraph => !!t).map((t) => t.shape);
    for (const sh of shapes) if (w.enemyStrike(this, sh, this.dmg, 4) !== 'miss') break;
    w.bus.emit('enemyAttack', { kind: 'fan', x: this.x, z: this.z, dir: this.facing, angles: FAN_ANG, len: FAN_LEN });
    this.cancelTelegraph();
    this.attackDone = true;
    this.setState('attack');
  }

  private stepNailTele(w: World, dt: number): void {
    const T = NAIL_TELE * this.teleMul, h = w.hero;
    // круг следует за героем первые 50 % телеграфа, затем фиксируется
    if (this.stateT < T * 0.5) {
      this.nailTarget(h.x, h.z);
      if (this.tele && this.tele.shape.k === 'circle') { this.tele.shape.x = this.nailX; this.tele.shape.z = this.nailZ; }
    }
    this.faceTo(this.nailX, this.nailZ, 0.08, dt);
    if (this.stateT < T) return;
    const res = w.enemyStrike(this, { k: 'circle', x: this.nailX, z: this.nailZ, r: NAIL_R }, this.dmg * 1.15, 5);
    w.bus.emit('enemyAttack', { kind: 'nail', x: this.nailX, z: this.nailZ, r: NAIL_R });
    // выпад к точке удара: клинок должен дотянуться до пола
    const dx = this.nailX - this.x, dz = this.nailZ - this.z, l = Math.hypot(dx, dz) || 1;
    const lunge = Math.max(0, l - 1.5);
    this.lungeT = 0.1; this.lungeVX = (dx / l) * lunge / 0.1; this.lungeVZ = (dz / l) * lunge / 0.1;
    this.puppet.kickSpring(dx / l, dz / l, 0.8);
    if (res === 'hit' || res === 'immune') this.finish(0.5, 1.2);
    else {
      // промах: клинок застрял в камне — 1.4 с окно уязвимости
      this.stuck = NAIL_STUCK;
      w.bus.emit('stuck', { x: this.nailX, z: this.nailZ, dur: NAIL_STUCK });
      this.finish(NAIL_STUCK, 0.6);
    }
  }

  private stepRow(w: World): void {
    const tm = this.teleMul;
    // полосы появляются с шагом 0.3 с от тела к герою
    while (this.rows.length < ROW_D.length && this.stateT >= this.rows.length * ROW_STEP * tm) {
      const D = ROW_D[this.rows.length];
      const sh: Shape = { k: 'line', x: this.x + this.dirX * (D - 0.5), z: this.z + this.dirZ * (D - 0.5), dx: this.dirX, dz: this.dirZ, len: 1, w: ROW_W };
      const t = this.rows.length === 0 ? this.telegraph(w, sh, ROW_TELE, false, 'hum') : w.addTelegraph(sh, ROW_TELE * tm);
      this.rows.push({ tele: t, done: false });
      // нижние клинки бьют в пол — искры у острия
      const tip = this.puppet.skel.jointPoint(this.rows.length % 2 ? this.J.blade2L : this.J.blade2R, 0, -CRUCIFIER_BLADE2, 0, _p);
      w.bus.emit('scrape', { x: tip.x, y: Math.max(0.05, tip.y), z: tip.z });
    }
    // каждая взрывается шипами через 0.7 с после появления: «та-та-ТА»
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (r.done || !r.tele || r.tele.t < r.tele.dur) continue;
      r.done = true;
      const big = i === ROW_D.length - 1;
      const sh = r.tele.shape;
      w.enemyStrike(this, sh, this.dmg * (big ? 1.25 : 0.8), big ? 5 : 3);
      if (sh.k === 'line') w.bus.emit('spikes', { x: sh.x + sh.dx * 0.5, z: sh.z + sh.dz * 0.5, dirX: sh.dx, dirZ: sh.dz, w: ROW_W, big });
      this.puppet.kickSpring(this.dirX, this.dirZ, big ? 0.6 : 0.3);
    }
    if (this.rows.length === ROW_D.length && this.rows.every((r) => r.done)) this.finish(ROW_WINDOW, 1.2 + w.rng.next() * 0.8);
  }

  private nailTarget(x: number, z: number): void {
    const dx = x - this.x, dz = z - this.z, l = Math.hypot(dx, dz);
    const k = l > NAIL_REACH ? NAIL_REACH / l : 1;
    this.nailX = this.x + dx * k; this.nailZ = this.z + dz * k;
  }

  private finish(hold: number, cd: number): void {
    this.cancelTelegraph();
    this.token = null;
    this.hold = hold;
    this.cooldown = hold + cd;
    this.setState('recover');
  }

  private aim(x: number, z: number): void {
    const dx = x - this.x, dz = z - this.z, l = Math.hypot(dx, dz) || 1;
    this.dirX = dx / l; this.dirZ = dz / l;
    this.facing = angleOf(this.dirX, this.dirZ);
  }

  override cancelTelegraph(): void {
    super.cancelTelegraph();
    for (const t of this.extra) t.alive = false;
    this.extra.length = 0;
    for (const r of this.rows) if (r.tele && !r.done) r.tele.alive = false;
    this.rows.length = 0;
  }

  /** Застрявший и так беззащитен: лёгкие удары не сбивают позу, урон проходит полностью. */
  override interrupt(dur: number, heavy = false): void {
    if (this.stuck > 0) return;
    super.interrupt(dur, heavy);
    if (this.state === 'stagger') this.hold = 0;
  }

  override onStun(): void {
    super.onStun();
    this.stuck = 0; this.hold = 0; this.lungeT = 0;
  }

  protected override shatterBody(w: World, dirX: number, dirZ: number, power: number): void {
    this.puppet.skel.shatter(dirX, dirZ, power, w.fxRng, { stick: this.stick, pop: this.pop });
  }

  protected animate(dt: number, w: World): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot, J = this.J;
    const sp = Math.hypot(this.vx, this.vz);
    this.gait += (sp * dt) / 1.6;
    out.set(L.restRot);
    const free = this.state === 'idle' || this.state === 'chase' || this.state === 'orbit' || (this.state === 'recover' && this.stateT >= this.hold);
    const amp = free ? clamp(sp / 2.5, 0, 1) : 0;
    const ph = this.gait * Math.PI * 2;
    const t: Pose = { ...BASE };
    let rate = 14;
    // голова следит за героем — перед атакой резко
    const h = w.hero;
    const yawT = clamp(angleDiff(this.facing, angleOf(h.x - this.x, h.z - this.z)), -0.9, 0.9);
    this.headYaw += (yawT - this.headYaw) * Math.min(1, dt * (this.state === 'telegraph' ? 20 : 6));
    const T = (dur: number) => clamp(this.stateT / (dur * this.teleMul), 0, 1);
    if (this.state === 'telegraph') {
      // корпус резко выпрямляется
      const st = Ease.outBack(clamp(this.stateT / 0.15, 0, 1));
      t.lean = lerp(BASE.lean, -0.12, st); t.crouch = 0.2;
      t.ribs = 0.15;
      rate = 22;
      if (this.mode === 'fan') {
        // верхние клинки расходятся
        const k = Ease.inOutQuad(T(FAN_TELE));
        t.aLx = t.aRx = lerp(-1.9, -1.0, k); t.aLz = t.aRz = lerp(0.2, 1.35, k);
        t.bLx = t.bRx = lerp(1.65, 0.3, k); t.bLz = t.bRz = lerp(0, 0.5, k);
      } else if (this.mode === 'nail') {
        const k = Ease.outCubic(T(NAIL_TELE));
        t.aRx = lerp(-1.9, -3.0, k); t.aRz = 0.15; t.bRx = lerp(1.65, 0.1, k);
        t.lean = lerp(t.lean, -0.25, k);
      } else {
        // крест: верхние руки вверх и в стороны, нижние вонзаются в пол
        const k = Ease.outExpo(clamp(this.stateT / 0.15, 0, 1));
        t.aLx = t.aRx = -2.5; t.aLz = t.aRz = 0.7; t.bLx = t.bRx = 0.2;
        t.a2x = lerp(0.3, -0.55, k); t.b2x = lerp(0.1, -0.15, k); t.a2z = 0.25;
        t.lean = 0.3; t.crouch = 0.35;
        rate = 30;
      }
    } else if (this.state === 'attack') {
      // веер: удар вперёд-вниз, клинки ложатся вдоль полос
      t.aLx = t.aRx = -1.35; t.aLz = t.aRz = 0.55; t.bLx = t.bRx = -0.15; t.bLz = t.bRz = 0.2;
      t.lean = 0.4; t.crouch = 0.35;
      rate = 60;
    } else if (this.state === 'recover' && this.stateT < this.hold) {
      if (this.mode === 'nail') {
        // клинок в полу; застрял — рвётся, корпус дрожит
        t.aRx = -1.15; t.aRz = 0.1; t.bRx = -0.25; t.lean = 0.5; t.crouch = 0.35; t.headX = 0.25;
        if (this.stuck > 0) t.lean += Math.sin(this.time * 38) * 0.03;
        rate = this.stateT < 0.1 ? 60 : 14;
      } else if (this.mode === 'fan') {
        t.aLx = t.aRx = -1.4; t.aLz = t.aRz = 0.5; t.bLx = t.bRx = 0.1; t.lean = 0.4; t.crouch = 0.3;
        rate = 6;
      } else {
        t.a2x = -0.5; t.b2x = -0.15; t.lean = 0.35; t.crouch = 0.3; t.aLx = t.aRx = -2.2; t.aLz = t.aRz = 0.6;
        rate = 6;
      }
    } else if (this.state === 'stunned') {
      // все четыре руки распахнуты, рёбра раскрыты — видно ядро; голова запрокинута
      t.aLx = t.aRx = -0.35; t.aLz = t.aRz = 1.45; t.bLx = t.bRx = 0.15; t.bLz = t.bRz = 0.35;
      t.a2x = 0; t.a2z = 1.0; t.b2x = 0.2;
      t.ribs = 1.25; t.headX = -0.75; t.lean = -0.2; t.crouch = 0.3;
      rate = 10;
    } else if (this.state === 'stagger') {
      t.lean = 0.45; t.crouch = 0.3; t.headX = 0.3; t.aLz = t.aRz = 0.5;
      rate = 25;
    }
    const P = this.pose, kk = 1 - Math.exp(-dt * rate);
    for (const key of Object.keys(P) as (keyof Pose)[]) P[key] += (t[key] - P[key]) * kk;

    // ноги «обратным коленом»: шаг от пройденного пути, приседание опускает таз
    for (const [side, off] of [['L', 0], ['R', Math.PI]] as const) {
      const sn = Math.sin(ph + off), lift = Math.max(0, Math.cos(ph + off)) * amp;
      const hip = -sn * 0.38 * amp - P.crouch * 0.5;
      const knee = P.crouch * 1.1 + lift * 0.7;
      setJoint(out, L, J['hip' + side], hip, 0, 0);
      setJoint(out, L, J['knee' + side], knee, 0, 0);
      setJoint(out, L, J['ankle' + side], -(hip + knee) * 0.6 - lift * 0.4, 0, 0);
      setJoint(out, L, J['foot' + side], -(hip + knee) * 0.4 + lift * 0.3, 0, 0);
    }
    const breathe = Math.sin(this.time * 2.1) * 0.03;
    setJoint(out, L, J.pelvis, 0, Math.sin(ph) * 0.08 * amp, 0);
    setJoint(out, L, J.spine, P.lean * 0.6 + breathe + this.puppet.springZ * 0.4, this.headYaw * 0.15, this.puppet.springX * 0.4);
    setJoint(out, L, J.chest, P.lean * 0.4 + breathe * 0.5, this.headYaw * 0.15, 0);
    setJoint(out, L, J.head, P.headX - P.lean * 0.5, this.headYaw * 0.7, 0);
    setJoint(out, L, J.ribsL, 0, P.ribs + this.coreGlow * 0.1, 0);
    setJoint(out, L, J.ribsR, 0, -P.ribs - this.coreGlow * 0.1, 0);
    // руки: наклоны в позе — относительно вертикали мира, вычитаем наклон груди
    const cp = 0.45 + P.lean;
    const sway = Math.sin(ph) * 0.15 * amp;
    setJoint(out, L, J.armL, P.aLx - cp, 0, P.aLz);
    setJoint(out, L, J.bladeL, P.bLx, 0, P.bLz);
    setJoint(out, L, J.armR, P.aRx - cp, 0, -P.aRz);
    setJoint(out, L, J.bladeR, P.bRx, 0, -P.bRz);
    setJoint(out, L, J.arm2L, P.a2x - cp + sway, 0, P.a2z);
    setJoint(out, L, J.blade2L, P.b2x, 0, 0);
    setJoint(out, L, J.arm2R, P.a2x - cp - sway, 0, -P.a2z);
    setJoint(out, L, J.blade2R, P.b2x, 0, 0);
    s.off[J.pelvis * 3 + 1] = -P.crouch * 0.28 + Math.abs(Math.sin(ph)) * 0.05 * amp;
    s.x = this.x; s.z = this.z; s.y = this.y; s.facing = this.facing;
    s.sx = s.sy = s.sz = 1;
    s.update();
    this.puppet.boost = this.coreGlow * 1.5 + P.ribs * 0.6;

    // в покое нижние клинки волочатся по полу и высекают искры
    if (free && sp > 0.6 && (this.scrapeT -= dt) <= 0) {
      this.scrapeT = 0.08;
      this.scrapeSide ^= 1;
      const tip = s.jointPoint(this.scrapeSide ? J.blade2L : J.blade2R, 0, -CRUCIFIER_BLADE2, 0, _p);
      if (tip.y < 0.25) w.bus.emit('scrape', { x: tip.x, y: Math.max(0.03, tip.y), z: tip.z });
    }
  }
}
