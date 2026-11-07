import { inPart } from '../../data/arenas';
import { overlaps, type Shape } from '../combat';
import type { Telegraph } from '../entities';
import type { GameEvents } from '../events';
import type { AimTarget, World } from '../world';
import { slashShape } from './funeralHeart';

/**
 * Великий колокол Колокольни (Звонарь, «Маятник: срежь опоры»). Колокол висит на четырёх верёвках над провалами:
 * каждая верёвка идёт от колокола к блоку над провалом и вниз — к железной тумбе у кромки. Натянутая верёвка
 * светится золотом, и только её можно рубить у тумбы. В верёвке четыре пряди: лёгкий удар рвёт одну, тяжёлый (Разлом,
 * Звездопад, Крест, Контрудар, заряд) — две. Каждая порванная прядь отдаётся в колокол: он звонит, и от него по залу
 * идёт волна звона, её проходят рывком. Верёвка натягивается, когда колокол дальше всего от её блока: на краю
 * качания и на противоположной стороне круга.
 *
 * r — радиус колокола (м); height — от кромки до маковки; lipRest — высота кромки в нижней точке; rise — насколько
 * кромка поднимается на краю качания (там колокол над головой и не бьёт); pulleyY — высота блоков (выше камеры: в кадре верёвки уходят вверх).
 * swing — маятник I фазы: размах до и после первой срезанной верёвки (м), пауза на краю (метка прохода видна всю
 * паузу), время прохода, разгон с центра в первый край; turn — после calm проходов каждая новая линия качания
 * поворачивается на столько радиан (от и до, в случайную сторону): безопасного места «сбоку» нет; kick — Звонарь
 * на маковке пинает колокол обратно той же линией: шанс до и после первой срезанной верёвки и короткая белая метка;
 * snap — срезанная верёвка дёргает колокол: через столько секунд он идёт через зал к её тумбе (белая метка).
 * orbit — круг II фазы: радиус кольца (по очереди ближнее и дальнее), время раскрутки (1–2 оборота: колокол встаёт
 * напротив целой верёвки, направление меняется каждый раз), остановка, метка кольца; again — с этим шансом колокол
 * без остановки идёт на второй круг после короткой метки. taut — расстояние колокол — блок (м), с которого верёвка
 * натянута полностью (за 1.5 м до него — 0); tautMin — с какой натянутости её можно рубить. strands — пряди в верёвке.
 * toll — волна звона от порванной пряди: не чаще cd, скорость, ширина, предел (м), урон (доля). dmg — доля HP героя
 * за удар колоколом, kb — отброс, again — через сколько секунд колокол на круге может ударить снова; enemyMult —
 * удар колоколом по врагам (множитель клинка). fall — падение в III фазе: время, радиус удара, урон, радиус
 * обломка-укрытия. descend/startY — колокол опускается из темноты, когда появляется Звонарь. cleatR — радиус тумбы
 * для удара клинком. settle — сколько секунд после перерубленной верёвки остальные провисают.
 */
export const GREAT_BELL = {
  r: 1.7, height: 2.6, lipRest: 0.9, rise: 1.9, pulleyY: 22,
  swing: { amp: [7.4, 6.4] as const, pause: 0.9, travel: 0.85, wind: 1.1, turn: [0.3, 0.75] as const, calm: 2, kick: { chance: [0.3, 0.5] as const, warn: 0.5 }, snap: 0.6 },
  orbit: { r: [6.4, 4.2] as const, spin: 2.1, hold: 1.7, warn: 0.95, again: { chance: 0.35, warn: 0.65 } },
  taut: 12, tautMin: 0.6,
  strands: 4,
  toll: { cd: 0.55, speed: 10, width: 1.2, maxR: 17, dmg: 0.1 },
  dmg: 0.2, kb: 11, again: 0.9, enemyMult: 6,
  fall: { dur: 1.25, r: 3.0, dmg: 0.26, obstacle: 2.2 },
  descend: 1.6, startY: 9,
  cleatR: 0.9,
  settle: 4.5,
};

/** Приёмы, которые рвут сразу две пряди верёвки. */
export const HEAVY_CUTS: ReadonlySet<string> = new Set(['rift', 'skyfall', 'cross', 'counter', 'charged']);
/** Хозяин волны звона: не Звонарь — уход от неё не копит ему оглушение. */
export const TOLL_OWNER = -942;

export type GreatBellMode = 'descend' | 'idle' | 'swing' | 'orbit' | 'fall' | 'fallen';

export interface BellRope {
  readonly pulley: { x: number; z: number };
  readonly cleat: { x: number; z: number };
  cut: boolean;
  /** Натянутость 0…1 (для вида и правила удара). */
  taut: number;
  /** Секунд после обрыва (хлыст оборванной верёвки). */
  cutT: number;
  /** Удар по ненатянутой тумбе: искры и звон (вспышка 1 → 0). */
  clank: number;
  /** Сколько прядей осталось (0 — перерублена). */
  strands: number;
  /** Порвана прядь: вспышка верёвки 1 → 0. */
  fray: number;
}

/** Что нужно колоколу от Звонаря: он — источник удара, и колокол сообщает ему о срезанной верёвке. */
export interface BellOwner {
  readonly id: number;
  readonly kind: string;
  /** Звонарь едет на маковке: только тогда колокол пинают обратно. */
  readonly riding: boolean;
  lastTeleDur: number;
  dmgUnit: number;
  onRopeCut(w: World, index: number, left: number): void;
  /** Звонарь пнул колокол обратно той же линией (поза, звук). */
  onBellKick?(w: World): void;
}

type V2 = { x: number; z: number };
const TAU = Math.PI * 2;
const smooth = (u: number) => u * u * (3 - 2 * u);
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** Блоки и тумбы по четырём провалам Колокольни (без провалов — четыре угла вокруг центра). */
export function bellRig(w: World, cx: number, cz: number): { pulley: V2; cleat: V2 }[] {
  const holes = (w.arena.def.holes ?? []).filter(h => Math.hypot(h.x - cx, h.z - cz) > 4).slice(0, 4);
  if (holes.length < 4) {
    return [[-6.8, -4.2], [6.8, -4.2], [-6.8, 4.6], [6.8, 4.6]].map(([x, z]) => {
      const l = Math.hypot(x, z);
      return { pulley: { x: cx + x, z: cz + z }, cleat: { x: cx + x - x / l * 2.6, z: cz + z - z / l * 2.6 } };
    });
  }
  return holes.map(h => {
    const dx = cx - h.x, dz = cz - h.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    // кромка провала по направлению к центру, ещё 0.75 м к центру и дальше — до целой плитки пола
    let rim = 0;
    while (rim < 8 && inPart(h, h.x + ux * rim, h.z + uz * rim)) rim += 0.05;
    let d = rim + 0.75;
    while (d < l - 1 && !w.arena.walkable(h.x + ux * d, h.z + uz * d)) d += 0.05;
    return { pulley: { x: h.x, z: h.z }, cleat: { x: h.x + ux * d, z: h.z + uz * d } };
  });
}

export class GreatBell {
  mode: GreatBellMode = 'descend';
  x: number; z: number;
  /** Высота кромки над полом. */
  y: number = GREAT_BELL.startY;
  /** Скорость по полу (м/с): отброс, крен, звук прохода. */
  vx = 0; vz = 0;
  /** Крен от рывка срезанной верёвки (рад), затухает. */
  lurch = 0;
  readonly ropes: BellRope[];
  readonly cx: number; readonly cz: number;
  /**
   * Маятник: колокол стоит в крае at (смещение от центра), потом идёт в край next. Каждая новая линия поворачивается
   * (после первых calm проходов); kick — пауза короткая, колокол пнули обратно той же линией (белая метка);
   * pending — куда колокол пойдёт после текущего прохода (верёвку срезали в пути).
   */
  readonly swing = { at: { x: 0, z: 0 } as V2, next: { x: 0, z: 0 } as V2, stage: 'wind' as 'wind' | 'pause' | 'travel', t: 0, hold: 0, amp: GREAT_BELL.swing.amp[0] as number, kick: false, pending: null as V2 | null };
  /**
   * Круг: угол и радиус колокола, раскрутка от a0 к a1; rT — радиус кольца этой раскрутки (ближнее и дальнее по
   * очереди), dir — направление (меняется каждый раз), warnDur — длина текущей метки, again — идёт второй круг подряд.
   */
  readonly orbit = { a: 0, a0: 0, a1: 0, r: GREAT_BELL.orbit.r[0] as number, r0: GREAT_BELL.orbit.r[0] as number, rT: GREAT_BELL.orbit.r[0] as number, stage: 'warn' as 'warn' | 'spin' | 'hold', t: 0, n: 0, k: 0, dir: 1, warnDur: GREAT_BELL.orbit.warn as number, again: false };
  readonly fall = { t: 0, fx: 0, fz: 0, fy: 0 };
  /** Кого колокол уже ударил (герой — id −1) и когда. */
  private readonly struck = new Map<number, number>();
  private t = 0;
  /** До какого времени верёвки провисают после рывка срезанной. */
  private slackUntil = 0;
  private tele: Telegraph | null = null;
  private cover: { x: number; z: number; r: number } | null = null;
  private readonly aims: AimTarget[] = [];
  private readonly offs: (() => void)[] = [];
  private swingId = 0; private lastSwing = -1;
  private lastToll = -99;
  readonly metrics = { passes: 0, spins: 0, heroHits: 0, enemyHits: 0, cuts: 0, clanks: 0, frays: 0, tolls: 0, kicks: 0, snaps: 0, doubles: 0 };

  constructor(private readonly w: World, private readonly owner: BellOwner, cx: number, cz: number) {
    this.cx = cx; this.cz = cz; this.x = cx; this.z = cz;
    this.ropes = bellRig(w, cx, cz).map(r => ({ ...r, cut: false, taut: 0, cutT: 0, clank: 0, strands: GREAT_BELL.strands, fray: 0 }));
    const bell = this;
    for (const rope of this.ropes) {
      const aim: AimTarget = {
        x: rope.cleat.x, z: rope.cleat.z, radius: 0.6,
        get targetable() { return bell.cuttable(rope) && Math.hypot(w.hero.x - rope.cleat.x, w.hero.z - rope.cleat.z) < 4.5; },
      };
      this.aims.push(aim); w.aimTargets.add(aim);
    }
    this.offs.push(
      w.bus.on('swing', () => { this.swingId++; }),
      w.bus.on('slash', e => this.slash(e)),
      w.bus.on('ability', e => this.ability(e)),
    );
  }

  /** Сколько верёвок цело. */
  get intact(): number { let n = 0; for (const r of this.ropes) if (!r.cut) n++; return n; }
  /** Маковка колокола — сюда встаёт Звонарь. */
  get topY(): number { return this.y + GREAT_BELL.height; }
  /** Колокол висит (на нём можно ехать, верёвки можно рубить). */
  get hanging(): boolean { return this.mode === 'idle' || this.mode === 'swing' || this.mode === 'orbit'; }
  /** Пауза на краю качания (удобный момент вскочить на колокол или спрыгнуть). */
  get paused(): boolean { return this.mode === 'swing' && this.swing.stage === 'pause'; }
  /** Сколько секунд осталось до движения колокола (пауза маятника), 0 — в пути. */
  get pauseLeft(): number { return this.paused ? Math.max(0, GREAT_BELL.swing.pause + this.swing.hold - this.swing.t) : 0; }
  /** Верёвку можно перерубить: цела, натянута, колокол висит. */
  cuttable(r: BellRope): boolean { return !r.cut && r.taut >= GREAT_BELL.tautMin && this.hanging; }

  /** Начать качание (Звонарь вскочил на колокол): разгон из центра в первый край. */
  startSwing(): void {
    if (this.mode !== 'idle') return;
    const S = this.swing;
    this.mode = 'swing';
    S.at = { x: S.amp, z: 0 }; S.next = { x: -S.amp, z: 0 };
    S.stage = 'wind'; S.t = 0; S.hold = 0;
    this.w.bus.emit('bellPass', { x: this.x, z: this.z, dirX: 1, dirZ: 0 });
  }

  /** Подержать колокол на краю (Звонарь прыгает на него): метка прохода продлевается. */
  holdFor(sec: number): void {
    if (!this.paused) return;
    const S = this.swing, left = GREAT_BELL.swing.pause + S.hold - S.t;
    if (left >= sec) return;
    S.hold += sec - left;
    this.announcePass();
  }

  /** Две верёвки: с этого места колокол уходит на круг вокруг центра. */
  toOrbit(): void {
    if (this.mode !== 'swing' && this.mode !== 'idle') return;
    this.mode = 'orbit';
    this.killTele();
    const O = this.orbit;
    O.a0 = O.a = Math.atan2(this.x - this.cx, this.z - this.cz);
    O.r0 = O.r = Math.hypot(this.x - this.cx, this.z - this.cz);
    O.stage = 'warn'; O.t = 0; O.k = 0; O.dir = 1; O.again = false;
    O.rT = GREAT_BELL.orbit.r[0]; O.warnDur = GREAT_BELL.orbit.warn;
    this.announceSpin();
  }

  /** Сразу к упавшему колоколу (пересмотр добивания, стенды): все верёвки срезаны, колокол лежит в центре. */
  settleFallen(): void {
    for (const r of this.ropes) { r.cut = true; r.taut = 0; r.cutT = 9; }
    if (this.mode === 'fallen') return;
    this.killTele();
    this.mode = 'fallen'; this.x = this.cx; this.z = this.cz; this.y = 0; this.vx = this.vz = 0;
    this.addObstacle();
  }

  step(dt: number): void {
    this.t += dt;
    for (const r of this.ropes) { if (r.cut) r.cutT += dt; r.clank = Math.max(0, r.clank - dt * 3); r.fray = Math.max(0, r.fray - dt * 3.5); }
    this.lurch *= Math.exp(-dt * 2.2);
    const px = this.x, pz = this.z;
    switch (this.mode) {
      case 'descend': {
        this.y = Math.max(GREAT_BELL.lipRest, this.y - dt * (GREAT_BELL.startY - GREAT_BELL.lipRest) / GREAT_BELL.descend);
        if (this.y <= GREAT_BELL.lipRest + 1e-6) this.mode = 'idle';
        break;
      }
      case 'idle': this.y = GREAT_BELL.lipRest + Math.sin(this.t * 1.1) * 0.04; break;
      case 'swing': this.stepSwing(dt); break;
      case 'orbit': this.stepOrbit(dt); break;
      case 'fall': this.stepFall(dt); break;
      case 'fallen': break;
    }
    if (dt > 0) { this.vx = (this.x - px) / dt; this.vz = (this.z - pz) / dt; }
    this.updateTaut(dt);
    if ((this.mode === 'swing' && this.swing.stage === 'travel') || (this.mode === 'orbit' && this.orbit.stage === 'spin')) this.strike();
  }

  private stepSwing(dt: number): void {
    const S = this.swing, C = GREAT_BELL.swing;
    S.t += dt;
    let ox: number, oz: number;
    if (S.stage === 'wind') {
      // разгон из центра в первый край — без удара: Звонарь только что вскочил, метки ещё не было
      const e = smooth(Math.min(1, S.t / C.wind));
      ox = S.at.x * e; oz = S.at.z * e;
      if (S.t >= C.wind) { S.stage = 'pause'; S.t = 0; this.announcePass(); }
    } else if (S.stage === 'pause') {
      ox = S.at.x; oz = S.at.z;
      if (S.t >= C.pause + S.hold) {
        S.stage = 'travel'; S.t = 0; S.hold = 0; this.struck.clear(); this.tele = null;
        const dx = S.next.x - S.at.x, dz = S.next.z - S.at.z, l = Math.hypot(dx, dz) || 1;
        // полоса горит и пока колокол идёт через зал
        this.markPath(GREAT_BELL.swing.travel);
        this.w.bus.emit('bellPass', { x: this.x, z: this.z, dirX: dx / l, dirZ: dz / l });
      }
    } else {
      const u = Math.min(1, S.t / C.travel), k = (1 - Math.cos(Math.PI * u)) / 2;
      ox = S.at.x + (S.next.x - S.at.x) * k; oz = S.at.z + (S.next.z - S.at.z) * k;
      if (u >= 1) this.arrive();
    }
    this.x = this.cx + ox; this.z = this.cz + oz;
    const k = Math.min(1, Math.hypot(ox, oz) / S.amp);
    this.y = GREAT_BELL.lipRest + GREAT_BELL.rise * k * k;
  }

  /**
   * Колокол дошёл до края: следующая линия — срезанная верёвка (pending), пинок Звонаря обратно той же линией или
   * новая линия, повёрнутая на случайный угол (первые calm проходов — прямо через центр).
   */
  private arrive(): void {
    const S = this.swing, C = GREAT_BELL.swing, from = S.at;
    S.at = S.next;
    this.metrics.passes++;
    S.kick = false; S.hold = 0;
    const kick = C.kick.chance[this.metrics.cuts > 0 ? 1 : 0];
    if (S.pending) { S.next = S.pending; S.pending = null; }
    else if (this.owner.riding && this.metrics.passes >= C.calm && this.w.rng.next() < kick) {
      // Звонарь пинает колокол обратно: пауза короче, метка белая
      S.next = from; S.kick = true; S.hold = C.kick.warn - C.pause;
      this.metrics.kicks++;
      this.owner.onBellKick?.(this.w);
      this.w.bus.emit('bellKick', { x: this.x, z: this.z });
    } else S.next = this.nextEdge(S.at);
    S.stage = 'pause'; S.t = 0;
    this.announcePass();
  }

  /** Противоположный край, повёрнутый на случайный угол turn (после первых calm проходов). */
  private nextEdge(at: V2): V2 {
    const S = this.swing, C = GREAT_BELL.swing, a0 = Math.atan2(-at.x, -at.z);
    const turn = this.metrics.passes < C.calm ? 0 : (C.turn[0] + (C.turn[1] - C.turn[0]) * this.w.rng.next()) * (this.w.rng.next() < 0.5 ? -1 : 1);
    return { x: Math.sin(a0 + turn) * S.amp, z: Math.cos(a0 + turn) * S.amp };
  }

  /** Метка следующего прохода: полоса от края до края на всю оставшуюся паузу (пинок — белая и короткая). */
  private announcePass(): void {
    this.killTele();
    const S = this.swing;
    const dur = Math.max(S.kick ? 0.4 : 0.8, GREAT_BELL.swing.pause + S.hold - S.t);
    this.tele = this.markPath(dur);
    this.owner.lastTeleDur = dur;
  }

  private markPath(dur: number): Telegraph {
    const S = this.swing, ax = this.cx + S.at.x, az = this.cz + S.at.z;
    const dx = S.next.x - S.at.x, dz = S.next.z - S.at.z, len = Math.hypot(dx, dz) || 1;
    const pad = GREAT_BELL.r + 0.35;
    return this.w.addTelegraph({ k: 'line', x: ax - dx / len * pad, z: az - dz / len * pad, dx: dx / len, dz: dz / len, len: len + pad * 2, w: pad * 2 }, dur, S.kick);
  }

  private killTele(): void { if (this.tele) { this.tele.alive = false; this.tele = null; } }

  private stepOrbit(dt: number): void {
    const O = this.orbit, C = GREAT_BELL.orbit;
    O.t += dt;
    if (O.stage === 'warn') {
      const u = Math.min(1, O.t / O.warnDur);
      O.r = O.r0 + (O.rT - O.r0) * smooth(u);
      // замах: колокол оттягивается против будущей раскрутки
      O.a = O.a0 - O.dir * Math.sin(u * Math.PI) * 0.22;
      if (u >= 1) {
        O.stage = 'spin'; O.t = 0; O.a0 = O.a; this.struck.clear(); this.tele = null;
        O.a1 = this.spinTarget(O.a0, O.dir);
        // кольцо горит всю раскрутку: колокол идёт по нему
        this.markRing(C.spin);
        this.w.bus.emit('bellSpin', { x: this.cx, z: this.cz });
      }
    } else if (O.stage === 'spin') {
      const u = Math.min(1, O.t / C.spin);
      O.a = O.a0 + (O.a1 - O.a0) * smooth(u);
      if (u >= 1) {
        this.metrics.spins++;
        O.t = 0; O.a0 = O.a; O.r0 = O.r;
        // иногда — второй круг подряд: короткая метка, без остановки (по одному разу)
        if (!O.again && this.ropes.some(r => !r.cut) && this.w.rng.next() < C.again.chance) {
          O.again = true; this.metrics.doubles++;
          this.nextSpin(C.again.warn);
        } else { O.again = false; O.stage = 'hold'; }
      }
    } else {
      O.a = O.a0 + Math.sin(O.t * 2.4) * 0.04;
      if (O.t >= C.hold) { O.t = 0; O.a0 = O.a; O.r0 = O.r; this.nextSpin(C.warn); }
    }
    this.x = this.cx + Math.sin(O.a) * O.r; this.z = this.cz + Math.cos(O.a) * O.r;
    const spinning = O.stage === 'spin' ? Math.sin(Math.min(1, O.t / C.spin) * Math.PI) : 0;
    this.y = GREAT_BELL.lipRest + 0.35 * spinning;
  }

  /** Следующая раскрутка: другое кольцо (ближнее ↔ дальнее) и другое направление; метка warn секунд. */
  private nextSpin(warn: number): void {
    const O = this.orbit, R = GREAT_BELL.orbit.r;
    O.k++; O.dir = -O.dir;
    O.rT = R[O.k % R.length];
    O.stage = 'warn'; O.t = 0; O.warnDur = warn;
    this.announceSpin();
  }

  /**
   * Куда встанет колокол после раскрутки: напротив одной из целых верёвок (по очереди), чтобы на каждой остановке
   * одна верёвка была натянута. Раскрутка — от одного до двух оборотов в сторону dir.
   */
  private spinTarget(a0: number, dir: number): number {
    const live = this.ropes.filter(r => !r.cut);
    if (!live.length) return a0 + dir * TAU;
    const r = live[this.orbit.n++ % live.length];
    const target = Math.atan2(this.cx - r.pulley.x, this.cz - r.pulley.z);
    return a0 + dir * (TAU + wrap(dir * (target - a0)));
  }

  /** Метка раскрутки: кольцо, по которому пройдёт колокол. */
  private announceSpin(): void {
    this.killTele();
    this.tele = this.markRing(this.orbit.warnDur);
    this.owner.lastTeleDur = this.orbit.warnDur;
  }

  private markRing(dur: number): Telegraph {
    const pad = GREAT_BELL.r + 0.35, r = this.orbit.rT;
    return this.w.addTelegraph({ k: 'ring', x: this.cx, z: this.cz, r0: Math.max(0, r - pad), r1: r + pad }, dur, false);
  }

  /** Все верёвки срезаны: колокол срывается и падает в центр зала. */
  private startFall(): void {
    this.killTele();
    this.mode = 'fall';
    this.fall.t = 0; this.fall.fx = this.x; this.fall.fz = this.z; this.fall.fy = this.y;
    this.tele = this.w.addTelegraph({ k: 'circle', x: this.cx, z: this.cz, r: GREAT_BELL.fall.r }, GREAT_BELL.fall.dur, true);
    this.owner.lastTeleDur = GREAT_BELL.fall.dur;
    this.w.bus.emit('bellDrop', { x: this.cx, z: this.cz, dur: GREAT_BELL.fall.dur });
  }

  private stepFall(dt: number): void {
    const F = this.fall, C = GREAT_BELL.fall;
    F.t += dt;
    const u = Math.min(1, F.t / C.dur), e = smooth(u);
    this.x = F.fx + (this.cx - F.fx) * e; this.z = F.fz + (this.cz - F.fz) * e;
    // рывок вверх и падение: кромка ложится на пол
    this.y = Math.max(0, F.fy * (1 - u) + Math.sin(u * Math.PI) * 2.4);
    if (u < 1) return;
    this.mode = 'fallen'; this.y = 0; this.x = this.cx; this.z = this.cz; this.tele = null;
    this.owner.lastTeleDur = C.dur;
    this.w.enemyStrike({ x: this.cx, z: this.cz, id: this.owner.id, kind: this.owner.kind, noStun: true }, { k: 'circle', x: this.cx, z: this.cz, r: C.r }, C.dmg * this.owner.dmgUnit, 12);
    for (const e of this.w.enemies) {
      if (e.dead || e.id === this.owner.id || !e.targetable || Math.hypot(e.x - this.cx, e.z - this.cz) > C.r + e.radius) continue;
      this.w.damageEnemy(e, { mult: GREAT_BELL.enemyMult * 2, stun: 30, stunKind: 'other', knockback: 12, feel: 'heavy', dirX: 0, dirZ: 0, source: 'env', noResonance: true });
    }
    this.addObstacle();
    this.w.bus.emit('bellFall', { x: this.cx, z: this.cz });
    this.w.bus.emit('impact', { x: this.cx, z: this.cz, r: C.r + 1, kind: 'bell' });
    this.w.bus.emit('shake', { trauma: 0.85 });
  }

  private addObstacle(): void {
    if (this.cover) return;
    this.cover = { x: this.cx, z: this.cz, r: GREAT_BELL.fall.obstacle };
    this.w.arena.covers.push(this.cover);
    this.w.arena.version++;
  }

  /** Удар колоколом: по герою и по врагам на пути — по разу за проход (на круге — не чаще again). */
  private strike(): void {
    const speed = Math.hypot(this.vx, this.vz);
    if (speed < 2.5 || this.y > GREAT_BELL.lipRest + GREAT_BELL.rise * 0.75) return;
    const shape: Shape = { k: 'circle', x: this.x, z: this.z, r: GREAT_BELL.r };
    const again = this.mode === 'orbit' ? GREAT_BELL.again : 99;
    const h = this.w.hero, last = this.struck.get(-1);
    if (!h.dead && (last === undefined || this.t - last > again) && overlaps(shape, h.x, h.z, h.radius)) {
      this.struck.set(-1, this.t);
      this.owner.lastTeleDur = Math.max(this.owner.lastTeleDur, 1);
      // источник удара — позади колокола по ходу: отброс по направлению качания
      // уход от колокола не копит Звонарю оглушение: колокол — не его удар
      const src = { x: this.x - this.vx / speed * 3, z: this.z - this.vz / speed * 3, id: this.owner.id, kind: this.owner.kind, noStun: true };
      if (this.w.enemyStrike(src, shape, GREAT_BELL.dmg * this.owner.dmgUnit, GREAT_BELL.kb) === 'hit') {
        this.metrics.heroHits++;
        this.w.bus.emit('bellHit', { x: h.x, z: h.z });
      }
    }
    for (const e of this.w.enemies) {
      if (e.dead || e.id === this.owner.id || !e.targetable) continue;
      const lastE = this.struck.get(e.id);
      if (lastE !== undefined && this.t - lastE <= again) continue;
      if (!overlaps(shape, e.x, e.z, e.radius)) continue;
      this.struck.set(e.id, this.t);
      this.w.damageEnemy(e, { mult: GREAT_BELL.enemyMult, stun: 20, stunKind: 'other', knockback: 9, feel: 'heavy', dirX: this.vx / speed, dirZ: this.vz / speed, source: 'env', noResonance: true });
      this.metrics.enemyHits++;
    }
  }

  private updateTaut(dt: number): void {
    const hang = this.hanging && this.t >= this.slackUntil, full = GREAT_BELL.taut;
    for (const r of this.ropes) {
      if (r.cut) { r.taut = 0; continue; }
      // рывок срезанной верёвки: остальные провисают за ~0.2 с
      if (!hang) { r.taut = Math.max(0, r.taut - dt * 5); continue; }
      const d = Math.hypot(this.x - r.pulley.x, this.z - r.pulley.z);
      r.taut = Math.max(0, Math.min(1, (d - (full - 1.5)) / 1.5));
    }
  }

  /** Удар клинка: у натянутой верёвки рвётся прядь (тяжёлый приём — две), у ненатянутой — звон и искры. */
  private slash(event: GameEvents['slash']): void {
    if (!this.hanging || this.w.hero.dead) return;
    const key = this.swingId * 2 + (event.second ? 1 : 0);
    if (key === this.lastSwing) return;
    if (this.hitCleats(slashShape(event), HEAVY_CUTS.has(event.move) ? 2 : 1)) this.lastSwing = key;
  }

  private ability(event: GameEvents['ability']): void {
    if (!this.hanging) return;
    const h = this.w.hero;
    const shape: Shape = event.id === 'crescent'
      ? { k: 'line', x: event.x, z: event.z, dx: Math.sin(h.facing), dz: Math.cos(h.facing), len: 8, w: 2.5 }
      : { k: 'circle', x: event.x, z: event.z, r: event.id === 'well' ? 4.5 : 3.5 };
    this.hitCleats(shape, 1);
  }

  private hitCleats(shape: Shape, strands: number): boolean {
    let any = false;
    this.ropes.forEach((r, i) => {
      if (r.cut || !overlaps(shape, r.cleat.x, r.cleat.z, GREAT_BELL.cleatR)) return;
      any = true;
      if (this.cuttable(r)) this.fray(i, strands);
      else if (this.hanging) {
        r.clank = 1; this.metrics.clanks++;
        this.w.bus.emit('bellClank', { x: r.cleat.x, z: r.cleat.z });
      }
    });
    return any;
  }

  /** Порвать n прядей верёвки i: последняя — верёвка перерублена, иначе колокол звонит волной. */
  fray(i: number, n = 1): void {
    const r = this.ropes[i];
    if (r.cut) return;
    r.strands = Math.max(0, r.strands - n); r.fray = 1;
    this.metrics.frays++;
    this.w.bus.emit('bellFray', { x: r.cleat.x, z: r.cleat.z, index: i, left: r.strands });
    if (r.strands <= 0) this.cut(i);
    else this.toll();
  }

  /** Колокол отзывается на порванную прядь: волна звона от колокола по всему залу (не чаще toll.cd). */
  private toll(): void {
    const T = GREAT_BELL.toll;
    if (this.t - this.lastToll < T.cd) return;
    this.lastToll = this.t;
    this.metrics.tolls++;
    this.w.addRingWave(this.x, this.z, T.speed, T.width, T.maxR, [], T.dmg * this.owner.dmgUnit, TOLL_OWNER);
    this.w.bus.emit('bellToll', { x: this.x, z: this.z });
  }

  /** Перерубить верёвку i: рывок колокола, урон Звонарю, колокол идёт к её тумбе; после последней колокол падает. */
  cut(i: number): void {
    const r = this.ropes[i];
    if (r.cut) return;
    r.cut = true; r.taut = 0; r.cutT = 0; r.strands = 0;
    this.metrics.cuts++;
    this.slackUntil = this.t + GREAT_BELL.settle;
    for (const o of this.ropes) o.taut = Math.min(o.taut, GREAT_BELL.tautMin - 0.01);
    this.lurch = 0.35 * (r.pulley.x < this.cx ? 1 : -1);
    const left = this.intact;
    this.w.bus.emit('bellRope', { x: r.cleat.x, z: r.cleat.z, index: i, left });
    if (this.mode === 'swing' && left >= 3) this.snapToward(r);
    this.owner.onRopeCut(this.w, i, left);
    if (left === 0 && this.hanging) this.startFall();
  }

  /**
   * Рывок срезанной верёвки: колокол идёт через зал к её тумбе — туда, где стоит рубивший. На паузе — через snap
   * секунд по белой метке, в пути — следующим проходом.
   */
  private snapToward(r: BellRope): void {
    const S = this.swing, C = GREAT_BELL.swing;
    S.amp = C.amp[1];
    let dx = r.cleat.x - this.cx, dz = r.cleat.z - this.cz;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const next = { x: dx * S.amp, z: dz * S.amp };
    this.metrics.snaps++;
    if (S.stage === 'pause') {
      S.next = next; S.kick = true; S.hold = Math.min(S.hold, S.t + C.snap - C.pause);
      this.announcePass();
    } else S.pending = next;
  }

  dispose(): void {
    this.killTele();
    for (const a of this.aims) this.w.aimTargets.delete(a);
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.cover) {
      const k = this.w.arena.covers.indexOf(this.cover);
      if (k >= 0) { this.w.arena.covers.splice(k, 1); this.w.arena.version++; }
      this.cover = null;
    }
  }
}
