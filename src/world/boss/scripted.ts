import { angleOf, clamp } from '../../core/math';
import { Ease } from '../../core/ease';
import type { EnemyDef } from '../../data/enemies';
import type { RigLayout, V3 } from '../../anim/skeleton';
import type { Shape } from '../combat';
import { Enemy, type SpawnOpts } from '../enemy';
import { createEnemy } from '../enemies/factory';
import type { World } from '../world';
import { patternDur, pickPattern, type Anchor, type Pattern, type ShapeSpec, type Step } from './timeline';

export type PoseLib = Record<string, Record<string, V3>>;

/**
 * Скриптовый враг (стражи, боссы): атаки — таймлайны паттернов (Tech §17), позы — библиотека ключевых поз
 * с плавным переходом, прыжки, призывы, окна наказания (уязвимость: оглушение копится полностью).
 */
export abstract class ScriptedEnemy extends Enemy {
  abstract patterns: Pattern[];
  phase = 1;
  cur: Pattern | null = null;
  ct = 0;
  private stepIdx = 0;
  snapX = 0; snapZ = 0;
  private lastId: string | null = null;
  private cds = new Map<string, number>();
  idleT = 1.2;
  restRange: [number, number] = [0.6, 1.3];
  vulnerableT = 0;
  move: { fx: number; fz: number; tx: number; tz: number; t: number; dur: number; arc: number; ease: (t: number) => number } | null = null;
  /** Поза: целевые углы суставов и текущие (смешиваются по tau). */
  protected poseId = 'idle';
  protected poseTau = 0.1;
  protected poseCur = new Map<number, V3>();
  summoned: Enemy[] = [];
  /** Масштаб урона: ожидаемое HP героя зоны (доли → единицы). */
  dmgUnit: number;
  /** Желаемая дистанция подхода между атаками. */
  approach = 3;
  /** Не двигаться между атаками (Иерофант парит). */
  stationary = false;
  frenzy = false;
  private frenzyT = 0;
  /** После Раскола Страж стоит на колене (с). */
  kneelT = 0;
  /** Ещё столько секунд новые атаки медленнее (×0.7, план §5.6). */
  slowT = 0;
  /** Темп текущего паттерна: фиксируется на старте, чтобы удар не обогнал телеграф. */
  private tempo = 1;

  constructor(def: EnemyDef, layout: RigLayout, o: SpawnOpts) {
    super(def, layout, [], o);
    this.dmgUnit = 150 * Math.pow(1.75, o.zone) * (o.mode ?? 1);
    this.isGuardian = true;
    this.heavyWindup = true;
    // у Стражей и боссов шкала оглушения утекает всегда (план §5.5)
    if (this.stun) this.stun.alwaysLeak = true;
  }

  override get inWindow(): boolean { return this.vulnerableT > 0; }

  /** Позы атаки пробуждения: замах и рёв. */
  protected awakenPoses: [string, string] = ['crouch', 'roar'];
  /** Пробуждение после оглушения: следующая атака — отталкивающий рёв. */
  awakenQueued = false;

  /**
   * Пробуждение (план §5.5, анти-абуз 1): быстрая, но телеграфированная (0.8 с — минимум боссов зон 01–02)
   * отталкивающая атака — рёв и кольцо вокруг. Отгоняет героя, который ждал у оглушённой цели.
   */
  awakenPattern(): Pattern {
    const r = this.radius + 2.6;
    return { id: 'awaken', weight: 0, cooldown: 0, phases: [], steps: [
      { t: 0, do: 'pose', id: this.awakenPoses[0], blend: 0.2 },
      { t: 0, do: 'telegraphSound', kind: 'roar' },
      { t: 0, do: 'telegraph', shape: { circle: r }, at: 'self', dur: 0.8 },
      { t: 0.8, do: 'pose', id: this.awakenPoses[1], blend: 0.06 },
      { t: 0.8, do: 'hitbox', shape: { circle: r }, at: 'self', dmg: 0.08, kb: 11 },
      { t: 0.8, do: 'fx', id: 'shockwave', at: 'self', r: r + 2 },
      { t: 0.8, do: 'sfx', id: 'boss_roar' }, { t: 0.8, do: 'shake', trauma: 0.4 },
      { t: 1.3, do: 'pose', id: 'idle', blend: 0.35 },
    ], dur: 1.6 };
  }

  /** Замах: прогресс от телеграфа к ближайшему удару таймлайна (для искр и сходящегося кольца). */
  override get windup(): number {
    const p = this.cur;
    if (!p || this.state === 'stunned') return 0;
    let hit = Infinity;
    for (const s of p.steps) if ((s.do === 'hitbox' || s.do === 'ringwave') && s.t >= this.ct && s.t < hit) hit = s.t;
    if (hit === Infinity) return 0;
    let tele = -1;
    for (const s of p.steps) if ((s.do === 'telegraph' || s.do === 'pose') && s.t <= this.ct && s.t < hit) tele = Math.max(tele, s.t);
    if (tele < 0 || hit - tele < 0.3) return 0;
    return clamp((this.ct - tele) / (hit - tele), 0, 1);
  }

  protected abstract poses(): PoseLib;

  /** Хук скриптов: шаги do: 'call'. */
  protected onCall(_w: World, _fn: string, _arg?: number): void {}

  protected think(w: World, dt: number, tick: boolean): void {
    const h = w.hero;
    // Неистовство: через 6 минут ускорение на 25 % (GDD §11.0)
    this.frenzyT += dt;
    if (!this.frenzy && this.frenzyT > 360) { this.frenzy = true; this.speed *= 1.25; }
    for (const [k, v] of this.cds) this.cds.set(k, v - dt);
    if (this.vulnerableT > 0) this.vulnerableT -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    this.summoned = this.summoned.filter((e) => !e.dead);
    if (this.kneelT > 0) { this.kneelT -= dt; this.vx *= 0.8; this.vz *= 0.8; if (this.kneelT <= 0) this.setPose('idle', 0.35); return; }

    if (this.move) this.stepMove(dt);

    if (this.cur) {
      this.ct += dt * this.tempo;
      const steps = this.cur.steps;
      while (this.stepIdx < steps.length && steps[this.stepIdx].t <= this.ct) {
        this.exec(w, steps[this.stepIdx]);
        this.stepIdx++;
      }
      this.vx *= 0.85; this.vz *= 0.85;
      if (this.ct >= patternDur(this.cur)) {
        this.cds.set(this.cur.id, this.cur.cooldown);
        this.lastId = this.cur.id;
        this.cur = null;
        this.idleT = this.restRange[0] + w.rng.next() * (this.restRange[1] - this.restRange[0]);
        this.setPose('idle', 0.25);
        if (this.state === 'attack') this.setState('chase');
      }
      return;
    }

    // между атаками: подойти/развернуться
    if (this.state !== 'chase') this.setState('chase');
    if (this.poseId === 'broken') this.setPose('idle', 0.3);
    if (this.awakenQueued && !this.move && !h.dead) { this.awakenQueued = false; this.startPattern(this.awakenPattern()); return; }
    const d = this.distTo(h);
    if (!this.stationary && !this.move) this.seek(w, h.x, h.z, this.speed, dt, this.approach);
    else { this.vx *= 0.85; this.vz *= 0.85; }
    this.faceTo(h.x, h.z, 0.35, dt);
    this.idleT -= dt;
    if (tick && this.idleT <= 0 && !h.dead && !this.move) {
      const p = pickPattern(this.patterns, this.phase, d, this.lastId, this.cds, () => w.rng.next());
      if (p) this.startPattern(p);
    }
  }

  startPattern(p: Pattern): void {
    const h = this.w_.hero;
    this.snapX = h.x; this.snapZ = h.z;
    if (p.build) p = { ...p, steps: p.build().sort((a, b) => a.t - b.t) };
    this.cur = p; this.ct = 0; this.stepIdx = 0;
    this.snapX = h.x; this.snapZ = h.z;
    this.tempo = (this.frenzy ? 1.25 : 1) * (this.slowT > 0 ? 0.7 : 1);
    this.setState('attack');
    // фирменная атака: музыка смолкнет перед ударом (момент удара — конец первого белого телеграфа)
    if (p.unstoppable) {
      const tele = p.steps.find((st) => st.do === 'telegraph' && st.white) ?? p.steps.find((st) => st.do === 'telegraph');
      if (tele && tele.do === 'telegraph') this.w_.bus.emit('signature', { x: this.x, z: this.z, impactIn: (tele.t + tele.dur) / this.tempo });
    }
  }

  /** Ссылка на мир (выставляется при добавлении). */
  w_!: World;
  override onAdded(w: World): void { this.w_ = w; }

  protected anchor(a: Anchor): { x: number; z: number } {
    const h = this.w_.hero;
    if (typeof a === 'object') return a;
    switch (a) {
      case 'self': return { x: this.x, z: this.z };
      case 'player': return { x: h.x, z: h.z };
      case 'snapshot': return { x: this.snapX, z: this.snapZ };
      case 'center': { const b = this.w_.arena.bounds; return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }; }
      case 'front': return { x: this.x + Math.sin(this.facing) * (this.radius + 1), z: this.z + Math.cos(this.facing) * (this.radius + 1) };
    }
  }

  protected shapeOf(spec: ShapeSpec, at: Anchor, dirTo: Anchor = 'snapshot'): Shape {
    const p = this.anchor(at);
    const t = this.anchor(dirTo);
    let dir = angleOf(t.x - p.x, t.z - p.z);
    if (Math.hypot(t.x - p.x, t.z - p.z) < 0.2) dir = this.facing;
    if ('circle' in spec) return { k: 'circle', x: p.x, z: p.z, r: spec.circle };
    if ('arc' in spec) return { k: 'arc', x: p.x, z: p.z, r: spec.arc[0], dir, half: (spec.arc[1] * Math.PI) / 360 };
    if ('line' in spec) return { k: 'line', x: p.x, z: p.z, dx: Math.sin(dir), dz: Math.cos(dir), len: spec.line[0], w: spec.line[1] };
    return { k: 'ring', x: p.x, z: p.z, r0: spec.ring[0], r1: spec.ring[1] };
  }

  protected exec(w: World, s: Step): void {
    switch (s.do) {
      case 'pose': this.setPose(s.id, s.blend ?? 0.08); break;
      case 'telegraph': {
        const sh = this.shapeOf(s.shape, s.at, s.dir);
        // метка на полу заполняется в такт паттерну (неистовство быстрее, после Раскола медленнее)
        const td = s.dur / this.tempo;
        w.addTelegraph(sh, td, !!s.white, false);
        this.lastTeleDur = td;
        this.coreGlow = 1.2;
        break;
      }
      case 'telegraphSound': w.bus.emit('telegraph', { kind: s.kind, x: this.x, z: this.z, src: this.kind }); break;
      case 'hitbox': {
        const sh = this.shapeOf(s.shape, s.at, s.dir);
        this.puppet.kickSpring(Math.sin(this.facing), Math.cos(this.facing), 0.5);
        w.enemyStrike(this, sh, s.dmg * this.dmgUnit, s.kb ?? 4);
        break;
      }
      case 'projectiles': {
        const p = this.anchor(s.at ?? 'self');
        const h = w.hero;
        const aim = angleOf(h.x - p.x, h.z - p.z);
        const dmg = s.dmg * this.dmgUnit;
        const kind = s.kind ?? 'stone';
        for (let i = 0; i < s.count; i++) {
          let a = aim;
          if (s.pattern === 'radial') a = (i / s.count) * Math.PI * 2 + this.time;
          else if (s.pattern === 'fan') a = aim + ((i / Math.max(1, s.count - 1)) - 0.5) * (s.spread ?? 1.2);
          else if (s.pattern === 'spiral') a = (i / s.count) * Math.PI * 4 + this.time * 2;
          if (s.pattern === 'rain') {
            const rx = h.x + w.rng.spread(5), rz = h.z + w.rng.spread(4);
            w.addTelegraph({ k: 'circle', x: rx, z: rz, r: 1.1 }, 1.0, false);
            w.stepHooks.push(this.delayed(1.0, () => {
              w.enemyStrike(this, { k: 'circle', x: rx, z: rz, r: 1.1 }, dmg, 2);
              w.bus.emit('impact', { x: rx, z: rz, r: 1.1, kind: 'slam' });
            }));
            continue;
          }
          w.spawnProjectile(kind === 'needle' ? 'needle' : kind === 'orb' ? 'orb' : 'stone', p.x + Math.sin(a) * (this.radius + 0.3), p.z + Math.cos(a) * (this.radius + 0.3), Math.sin(a) * s.speed, Math.cos(a) * s.speed, dmg, this.id, 0.42, 4.5, 1.2);
        }
        break;
      }
      case 'ringwave': {
        const p = this.anchor(s.at);
        const h = w.hero;
        const toHero = angleOf(h.x - p.x, h.z - p.z);
        const gaps: { a: number; w: number }[] = [];
        for (let i = 0; i < s.gaps; i++) gaps.push({ a: toHero + Math.PI + w.rng.spread(1.2) + (i * Math.PI * 2) / Math.max(1, s.gaps) + (s.gaps === 1 ? w.rng.spread(0.8) + Math.PI : 0), w: s.gapW });
        w.addRingWave(p.x, p.z, s.speed, s.width, s.maxR, gaps, s.dmg * this.dmgUnit, this.id, s.accel ?? 0);
        w.bus.emit('enemyAttack', { kind: 'bell', x: p.x, z: p.z });
        break;
      }
      case 'fx': {
        const p = this.anchor(s.at);
        if (s.id === 'impact') w.bus.emit('impact', { x: p.x, z: p.z, r: s.r ?? 3, kind: 'slam' });
        else if (s.id === 'shockwave') w.bus.emit('shockwave', { x: p.x, z: p.z, r: s.r ?? 6, color: 'hunger', strength: 1 });
        else w.bus.emit('impact', { x: p.x, z: p.z, r: s.r ?? 1.5, kind: 'land' });
        break;
      }
      case 'sfx': w.bus.emit('sfx', { id: s.id, x: this.x, z: this.z }); break;
      case 'shake': w.bus.emit('shake', { trauma: s.trauma }); break;
      case 'vulnerable': this.vulnerableT = s.dur; break;
      case 'move': {
        const t = this.anchor(s.to);
        const o = { x: t.x, z: t.z };
        w.arena.nearestWalkable(t.x, t.z, o);
        this.move = { fx: this.x, fz: this.z, tx: o.x, tz: o.z, t: 0, dur: s.dur, arc: s.arc ?? 0, ease: Ease[s.ease ?? 'inOutQuad'] };
        this.facing = angleOf(o.x - this.x, o.z - this.z) || this.facing;
        break;
      }
      case 'turn': { const t = this.anchor(s.to); this.facing = angleOf(t.x - this.x, t.z - this.z); break; }
      case 'summon': {
        const pts = s.at === 'edges' ? this.edgePoints(s.count) : s.at.map((a) => this.anchor(a));
        for (let i = 0; i < s.count; i++) {
          const p = pts[i % pts.length];
          const o = { x: p.x, z: p.z };
          w.arena.nearestWalkable(p.x + w.rng.spread(0.8), p.z + w.rng.spread(0.8), o);
          const e = createEnemy(s.enemy, { zone: w.zone, stage: w.stage, mode: w.mode });
          e.x = o.x; e.z = o.z;
          w.addEnemy(e);
          w.bus.emit('portal', { x: e.x, z: e.z });
          this.summoned.push(e);
        }
        break;
      }
      case 'call': this.onCall(w, s.fn, s.arg); break;
      case 'resnap': this.snapX = w.hero.x; this.snapZ = w.hero.z; this.facing = angleOf(this.snapX - this.x, this.snapZ - this.z); break;
    }
  }

  private delayed(delay: number, fn: () => void): (dt: number) => void {
    let t = 0, done = false;
    const hook = (dt: number) => {
      if (done) return;
      t += dt;
      if (t >= delay) { done = true; fn(); const i = this.w_.stepHooks.indexOf(hook); if (i >= 0) this.w_.stepHooks.splice(i, 1); }
    };
    return hook;
  }

  protected edgePoints(n: number): { x: number; z: number }[] {
    const b = this.w_.arena.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rx = (b.maxX - b.minX) / 2 - 2.5, rz = (b.maxZ - b.minZ) / 2 - 2.5;
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.PI / 4; out.push({ x: cx + Math.sin(a) * rx, z: cz + Math.cos(a) * rz }); }
    return out;
  }

  private stepMove(dt: number): void {
    const m = this.move!;
    m.t += dt;
    const u = clamp(m.t / m.dur, 0, 1), e = m.ease(u);
    this.x = m.fx + (m.tx - m.fx) * e;
    this.z = m.fz + (m.tz - m.fz) * e;
    this.y = m.arc * Math.sin(u * Math.PI);
    this.vx = this.vz = 0;
    if (u >= 1) { this.y = 0; this.move = null; }
  }

  setPose(id: string, tau = 0.1): void { this.poseId = id; this.poseTau = tau; }

  /** Смешать текущую позу к целевой (Эйлер по суставам). */
  protected blendPose(dt: number, base: Record<string, V3> = {}): Map<number, V3> {
    const lib = this.poses();
    const target = { ...base, ...(lib[this.poseId] ?? {}) };
    const L = this.puppet.layout;
    const k = 1 - Math.exp(-dt / Math.max(0.01, this.poseTau));
    const names = new Set([...Object.keys(target), ...[...this.poseCur.keys()].map((i) => L.names[i])]);
    for (const n of names) {
      if (!L.has(n)) continue;
      const i = L.idx(n);
      const tv = target[n] ?? [0, 0, 0];
      const cv = this.poseCur.get(i) ?? [0, 0, 0];
      this.poseCur.set(i, [cv[0] + (tv[0] - cv[0]) * k, cv[1] + (tv[1] - cv[1]) * k, cv[2] + (tv[2] - cv[2]) * k]);
    }
    return this.poseCur;
  }

  override interrupt(): void { /* стражи и боссы не прерываются лёгкими ударами */ }
  /**
   * Неудержимый паттерн оглушение не прерывает — до окна уязвимости (этап 4.5, C1): в нём атака уже кончилась
   * (во всех паттернах окно — после последнего хитбокса), и полная шкала оглушает сразу. Раньше серия Стража
   * Врат с застрявшей алебардой держала полную шкалу ещё 2.4 с, пока Пилот бил в окно наказания.
   */
  override canStunNow(): boolean { return !this.cur?.unstoppable || this.vulnerableT > 0; }
  override onStun(): void {
    super.onStun();
    this.cur = null;
    this.move = null;
    this.y = 0;
    this.vulnerableT = 0;
    this.setPose('broken', 0.12);
  }
  override onStunEnd(w: World): void {
    super.onStunEnd(w);
    this.awakenQueued = true;
  }
  /** Раскол: Страж падает на колено, следующие 2 с его удары медленнее. Боссы переопределяют. */
  override onShattered(_w: World): void {
    if (this.isBoss) return;
    this.cur = null; this.move = null;
    this.kneelT = 0.9;
    this.slowT = 2 + this.kneelT;
    this.setPose('crouch', 0.08);
  }
}
