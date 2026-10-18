import { Ease } from '../../core/ease';
import { angleOf, clamp, lerp } from '../../core/math';
import { setJoint } from '../../anim/locomotion';
import { layoutOf } from '../../anim/puppet';
import { VerletCloth } from '../../anim/verlet';
import { ENEMIES } from '../../data/enemies';
import { PSALM_PLATES, psalmistRig } from '../../gen/chars/enemies';
import { makeStun } from '../actor';
import type { Telegraph } from '../entities';
import { Enemy, type SpawnOpts } from '../enemy';
import type { World } from '../world';

/** Красный псалом: телеграф, до скольких союзников, дальность каста и разрыва нити, восстановление. */
export const PSALM_TELE = 0.6;
export const PSALM_LINKS = 2;
const PSALM_RANGE = 13;
export const PSALM_BREAK = 15;
export const PSALM_RELINK = 6;
/** Тяжёлый удар по Псаломщику гасит связь (с). */
export const PSALM_OFF = 2;
/** Перезвон: телеграф, порог дистанции, радиус кольца, перенос, перезарядка. */
export const CHIME_TELE = 0.7;
export const CHIME_TRIGGER = 3.5;
export const CHIME_R = 3;
export const CHIME_JUMP = 6;
export const CHIME_CD = 6;
const HOVER = 0.3;
const ROBE_W = 9, ROBE_H = 6, ROBE_DY = 0.24, ROBE_R = 0.27;
const PLATE_SPEED = [1.1, -0.75, 1.6], PLATE_Y = [-0.05, 0.35, -0.4], PLATE_R = [0.8, 0.95, 0.7];

/**
 * Псаломщик Голода (план §7.3): поддержка, приоритетная цель Зоны 01 с этапа 1-5. «Кого бить первым?»
 * Парит, держит 7–9 м. Красный псалом связывает двух союзников нитью (+25 % урона, лёгкие удары их не прерывают);
 * нить рвётся рывком сквозь неё, смертью союзника или расстоянием и восстанавливается через 6 с. Тяжёлый удар
 * по нему гасит связь на 2 с. Перезвон: герой ближе 3.5 м — кольцо r 3 и перенос на 6 м. Смерть — награда:
 * маска раскалывается, нити лопаются, связанные враги сразу оглушены.
 */
export class Psalmist extends Enemy {
  /** Связанные нитью союзники. */
  links: Enemy[] = [];
  /** Цели псалма во время телеграфа: нити тянутся к ним. */
  casting: Enemy[] = [];
  /** Связь погашена тяжёлым ударом (с). */
  linkOffT = 0;
  /** До следующего псалма (с): после разрыва нити — 6 с. */
  relinkT = 0.5;
  chimeCd = 0;
  mode: 'psalm' | 'chime' = 'psalm';
  private extra: Telegraph[] = [];
  private strafe = 1;
  private J: Record<string, number> = {};
  /** Ряса — ткань Верле: верхний ряд пришит к поясу кольцом. */
  readonly robe = new VerletCloth(ROBE_W, ROBE_H, 0.2, ROBE_DY);
  private robeReady = false;
  private robeX = 0; private robeZ = 0;
  /** Радиус круга плит: < 1 — сходятся (перезвон), > 1 — разлетелись. */
  private plateR = 1;
  private scatterT = 0;
  private jumpX = 0; private jumpZ = 0; private warped = false;
  /** Раскрытие рукавов 0..1. */
  private sleeves = 0;

  constructor(o: SpawnOpts) {
    super(ENEMIES.psalmist, layoutOf(psalmistRig()), [], o);
    const L = this.puppet.layout;
    for (const n of L.names) this.J[n] = L.idx(n);
    this.strafe = this.id % 2 ? 1 : -1;
    this.cooldown = 0;
    this.dissolveDelay = 0.8;
    this.robe.damping = 0.93;
    this.robe.colliders.push({ x: 0, y: 0, z: 0, r: 0.24 }, { x: 0, y: 0, z: 0, r: 0.32 });
  }

  override get linkActive(): boolean { return !this.dead && this.linkOffT <= 0; }

  /** Точка, откуда тянутся нити: между раскрытых рукавов. */
  threadPoint(out: { x: number; y: number; z: number }): void {
    out.x = this.x + Math.sin(this.facing) * 0.25; out.y = this.y + HOVER + 1.45; out.z = this.z + Math.cos(this.facing) * 0.25;
  }

  override windupPoint(out: { x: number; y: number; z: number }): void { this.threadPoint(out); }

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    const d = this.distTo(h);
    switch (this.state) {
      case 'idle': case 'chase': case 'orbit': case 'recover': {
        // держит 7–9 м, ближе 5 м — отступает
        if (d < 5) {
          const dx = this.x - h.x, dz = this.z - h.z, l = d || 1;
          this.seek(w, this.x + (dx / l) * 3, this.z + (dz / l) * 3, this.speed * 1.1, dt);
        } else this.standOff(w, 8, this.speed * 0.55, dt, this.strafe);
        if (this.state !== 'orbit') this.setState('orbit');
        this.faceTo(h.x, h.z, 0.3, dt);
        if (!tick || h.dead) break;
        if (d < CHIME_TRIGGER && this.chimeCd <= 0) { this.startChime(w); break; }
        if (this.links.length < PSALM_LINKS && this.relinkT <= 0 && this.cooldown <= 0) this.startPsalm(w);
        break;
      }
      case 'telegraph':
        this.vx *= 0.85; this.vz *= 0.85;
        this.coreGlow = Math.min(1, this.coreGlow + dt * 2.5);
        if (this.mode === 'psalm') this.stepPsalm(w);
        else if (this.stateT >= CHIME_TELE * this.teleMul) this.strikeChime(w);
        break;
      case 'special': this.stepWarp(w); break;
      default: break;
    }
  }

  private candidates(w: World): Enemy[] {
    const c = w.enemies.filter((e) => e !== this && !e.dead && e.spawned && !e.linkedBy && !(e instanceof Psalmist)
      && !e.isBoss && !e.isGuardian && e.kind !== 'acolyte' && this.distTo(e) < PSALM_RANGE);
    // сильнейших — первыми
    c.sort((a, b) => b.maxHp - a.maxHp || this.distTo(a) - this.distTo(b));
    return c.slice(0, PSALM_LINKS - this.links.length);
  }

  private startPsalm(w: World): void {
    const t = this.candidates(w);
    if (!t.length) { this.relinkT = 1; return; }
    this.mode = 'psalm';
    this.casting = t;
    t.forEach((e, i) => {
      const sh = { k: 'circle' as const, x: e.x, z: e.z, r: e.radius + 0.5 };
      if (i === 0) this.telegraph(w, sh, PSALM_TELE, false, 'chime');
      else this.extra.push(w.addTelegraph(sh, PSALM_TELE * this.teleMul));
    });
    this.setState('telegraph');
  }

  private stepPsalm(w: World): void {
    this.casting = this.casting.filter((e) => !e.dead && !e.linkedBy);
    // метки под целями идут за ними
    const tels = [this.tele, ...this.extra];
    this.casting.forEach((e, i) => { const t = tels[i]; if (t && t.shape.k === 'circle') { t.shape.x = e.x; t.shape.z = e.z; } });
    if (!this.casting.length) { this.finish(1); return; }
    if (this.stateT < PSALM_TELE * this.teleMul) return;
    for (const e of this.casting) { e.linkedBy = this; this.links.push(e); }
    w.bus.emit('psalm', { kind: 'link', x: this.x, z: this.z });
    this.casting = [];
    this.relinkT = PSALM_RELINK;
    this.finish(0.8);
  }

  /** Нить рвётся: союзник погиб или ушёл дальше 15 м, герой проскочил сквозь неё рывком. */
  private checkLinks(w: World): void {
    const h = w.hero;
    for (let i = this.links.length - 1; i >= 0; i--) {
      const e = this.links[i];
      let cut = false;
      let torn = e.dead || e.linkedBy !== this || this.distTo(e) > PSALM_BREAK;
      if (!torn && this.linkActive && h.state === 'dash') {
        // TODO(design): рвать ли нить ударом клинка, а не только рывком
        const ax = this.x, az = this.z, bx = e.x - ax, bz = e.z - az, l2 = bx * bx + bz * bz || 1;
        const u = clamp(((h.x - ax) * bx + (h.z - az) * bz) / l2, 0, 1);
        cut = torn = Math.hypot(ax + bx * u - h.x, az + bz * u - h.z) < h.radius + 0.2;
      }
      if (!torn) continue;
      if (e.linkedBy === this) e.linkedBy = null;
      this.links.splice(i, 1);
      this.relinkT = Math.max(this.relinkT, PSALM_RELINK);
      if (cut || !e.dead) w.bus.emit('psalm', { kind: 'snap', x: this.x, z: this.z, tx: e.x, tz: e.z });
    }
  }

  private startChime(w: World): void {
    this.mode = 'chime';
    this.telegraph(w, { k: 'circle', x: this.x, z: this.z, r: CHIME_R }, CHIME_TELE, false, 'chime');
    this.setState('telegraph');
  }

  private strikeChime(w: World): void {
    const sh = this.tele?.shape ?? { k: 'circle' as const, x: this.x, z: this.z, r: CHIME_R };
    w.enemyStrike(this, sh, this.dmg, 5);
    w.bus.emit('enemyAttack', { kind: 'chime', x: this.x, z: this.z, r: CHIME_R });
    this.cancelTelegraph();
    this.chimeCd = CHIME_CD;
    // перенос на 6 м — от героя, в проходимую точку
    const h = w.hero, base = angleOf(this.x - h.x, this.z - h.z);
    this.jumpX = this.x; this.jumpZ = this.z;
    for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const x = this.x + Math.sin(base + da) * CHIME_JUMP, z = this.z + Math.cos(base + da) * CHIME_JUMP;
      if (w.arena.walkable(x, z) && w.arena.walkable(x + 0.6, z) && w.arena.walkable(x - 0.6, z) && w.arena.walkable(x, z + 0.6) && w.arena.walkable(x, z - 0.6)) { this.jumpX = x; this.jumpZ = z; break; }
    }
    this.warped = false;
    w.bus.emit('portal', { x: this.x, z: this.z });
    this.setState('special');
  }

  /** Перенос: растворение 0.2 с → в новой точке проявление 0.25 с. */
  private stepWarp(w: World): void {
    this.vx = this.vz = 0;
    if (!this.warped && this.stateT >= 0.2) {
      this.warped = true;
      this.robe.teleport(this.jumpX - this.x, 0, this.jumpZ - this.z);
      this.x = this.jumpX; this.z = this.jumpZ;
      this.facing = angleOf(w.hero.x - this.x, w.hero.z - this.z);
      w.bus.emit('portal', { x: this.x, z: this.z });
    }
    this.puppet.dissolve = this.stateT < 0.2 ? this.stateT / 0.2 : clamp(1 - (this.stateT - 0.2) / 0.25, 0, 1);
    if (this.stateT >= 0.45) { this.puppet.dissolve = 0; this.finish(0.6); }
  }

  private finish(cd: number): void {
    this.cancelTelegraph();
    this.cooldown = cd;
    this.setState('recover');
  }

  override cancelTelegraph(): void {
    super.cancelTelegraph();
    for (const t of this.extra) t.alive = false;
    this.extra.length = 0;
    this.casting = [];
  }

  /** Перенос не прерывается: иначе он застрял бы полупрозрачным. */
  override interrupt(dur: number, heavy = false): void {
    if (this.state === 'special') return;
    super.interrupt(dur, heavy);
  }

  /** Тяжёлый удар: плиты разлетаются, связь гаснет на 2 с. */
  override react(w: World, heavy: boolean, spring: number, dirX: number, dirZ: number): void {
    super.react(w, heavy, spring, dirX, dirZ);
    if (!heavy || this.dead) return;
    this.linkOffT = PSALM_OFF; this.scatterT = PSALM_OFF;
    w.bus.emit('psalm', { kind: 'off', x: this.x, z: this.z });
  }

  override onStun(): void {
    super.onStun();
    this.puppet.dissolve = 0;
  }

  /** Смерть: нити лопаются, связанные сразу оглушены — открыт Раскол. */
  override kill(w: World, dirX: number, dirZ: number, power: number): void {
    if (this.dead) return;
    const linked = this.links.filter((e) => !e.dead && e.linkedBy === this);
    for (const e of linked) { w.bus.emit('psalm', { kind: 'snap', x: this.x, z: this.z, tx: e.x, tz: e.z }); e.linkedBy = null; }
    this.links = [];
    super.kill(w, dirX, dirZ, power);
    this.puppet.dissolve = 0;
    // ряса падает на пол: тело сложилось — держать её нечему
    for (let i = 0; i < ROBE_W; i++) this.robe.pinned[i] = 0;
    this.robe.colliders.length = 0;
    this.robe.damping = 0.97;
    for (const e of linked) {
      if (!e.stun) e.stun = makeStun(30, 1.8);
      w.stunEnemy(e);
    }
  }

  /** Маска раскалывается надвое, тело складывается внутрь себя. */
  protected override shatterBody(w: World, dirX: number, dirZ: number, power: number): void {
    this.puppet.skel.shatter(dirX, dirZ, Math.min(power, 3), w.fxRng, { pop: new Set([this.J.maskL, this.J.maskR]), implode: true });
  }

  /** Таймеры связи и нити идут и в хитстане, и в оглушении. */
  override step(w: World, dt: number): void {
    if (!this.dead && this.spawned) {
      if (this.linkOffT > 0) this.linkOffT -= dt;
      if (this.chimeCd > 0) this.chimeCd -= dt;
      if (this.relinkT > 0) this.relinkT -= dt;
      this.checkLinks(w);
    }
    super.step(w, dt);
    if (this.dead) this.robe.step(dt);
  }

  protected animate(dt: number, _w: World): void {
    const s = this.puppet.skel, L = s.layout, out = s.rot, J = this.J;
    out.set(L.restRot);
    const bob = Math.sin(this.time * 1.8) * 0.08;
    // рукава раскрываются на псалме; пока нить держит — приоткрыты
    const open = this.state === 'telegraph' && this.mode === 'psalm' ? 1 : this.links.length && this.linkActive ? 0.3 : 0;
    this.sleeves += (open - this.sleeves) * Math.min(1, dt * 8);
    // плиты: сходятся на перезвоне, разлетаются от тяжёлого удара
    let pr = 1;
    if (this.state === 'telegraph' && this.mode === 'chime') pr = lerp(1, 0.3, Ease.inQuad(clamp(this.stateT / (CHIME_TELE * this.teleMul), 0, 1)));
    else if (this.state === 'special') pr = 1.6;
    if (this.scatterT > 0) { this.scatterT -= dt; pr = 1 + 1.3 * (this.scatterT / PSALM_OFF); }
    this.plateR += (pr - this.plateR) * Math.min(1, dt * (pr < this.plateR ? 7 : 12));
    const sp = Math.hypot(this.vx, this.vz);
    setJoint(out, L, J.body, clamp(sp * 0.05, 0, 0.18) + this.puppet.springZ * 0.4, 0, this.puppet.springX * 0.4);
    setJoint(out, L, J.chest, -this.sleeves * 0.2, 0, 0);
    setJoint(out, L, J.head, -0.1 - this.sleeves * 0.25 + Math.sin(this.time * 0.9) * 0.05, 0, 0);
    setJoint(out, L, J.armL, -0.2 - this.sleeves * 0.6, 0, 0.25 + this.sleeves * 1.05);
    setJoint(out, L, J.armR, -0.2 - this.sleeves * 0.6, 0, -0.25 - this.sleeves * 1.05);
    for (let i = 0; i < PSALM_PLATES; i++) {
      const j = J[`plate${i}`], a = this.time * PLATE_SPEED[i] + i * 2.1, R = PLATE_R[i] * this.plateR;
      s.off[j * 3] = Math.sin(a) * R;
      s.off[j * 3 + 1] = PLATE_Y[i] + Math.sin(this.time * 1.3 + i) * 0.06 + (1 - Math.min(1, this.plateR)) * 0.3;
      s.off[j * 3 + 2] = Math.cos(a) * R;
      setJoint(out, L, j, Math.sin(this.time + i) * 0.15 + (this.scatterT > 0 ? this.scatterT * 1.5 : 0), a, 0);
    }
    s.x = this.x; s.z = this.z; s.y = this.y + HOVER + bob; s.facing = this.facing;
    s.update();
    const linked = this.links.length > 0 && this.linkActive;
    this.puppet.boost = this.coreGlow + (linked ? 0.4 + 0.2 * Math.sin(this.time * 6) : 0);
    this.stepRobe(dt, s.y);
  }

  /** Ряса: верхний ряд — кольцо у пояса (шов сзади), колонны тела держат форму. */
  private stepRobe(dt: number, y: number): void {
    const r = this.robe, waist = y + 1.25;
    const ring = (i: number) => this.facing + Math.PI + (i / (ROBE_W - 1)) * Math.PI * 2;
    if (!this.robeReady) {
      this.robeReady = true;
      for (let j = 0; j < ROBE_H; j++) for (let i = 0; i < ROBE_W; i++) {
        const k = (j * ROBE_W + i) * 3, a = ring(i), rr = ROBE_R + j * 0.035;
        r.p[k] = r.q[k] = this.x + Math.sin(a) * rr;
        r.p[k + 1] = r.q[k + 1] = waist - j * ROBE_DY;
        r.p[k + 2] = r.q[k + 2] = this.z + Math.cos(a) * rr;
      }
    }
    for (let i = 0; i < ROBE_W; i++) {
      const a = ring(i);
      r.setPinned(i, this.x + Math.sin(a) * ROBE_R, waist, this.z + Math.cos(a) * ROBE_R);
    }
    const c = r.colliders;
    c[0].x = c[1].x = this.x; c[0].z = c[1].z = this.z;
    c[0].y = waist - 0.4; c[1].y = waist - 0.85;
    // шаги без телепорта: ветер от движения
    r.wind = Math.hypot(this.x - this.robeX, this.z - this.robeZ) / Math.max(dt, 1e-3) * 0.6 + 0.4;
    this.robeX = this.x; this.robeZ = this.z;
    r.step(dt);
  }
}
