import * as THREE from 'three';
import { angleOf, clamp, dampAngle } from '../core/math';
import type { Affix, EnemyDef } from '../data/enemies';
import { ELITE, scaleDmg, scaleHp } from '../data/enemies';
import { Puppet } from '../anim/puppet';
import type { RigLayout } from '../anim/skeleton';
import type { ClipDef } from '../anim/clip';
import { makeStun, stepStun, STUN_STAR_SEC, type Actor, type Stun, newId } from './actor';
import type { Shape } from './combat';
import type { Telegraph } from './entities';
import type { World } from './world';
import { BIG_RADIUS } from './nav';

const _nav = { x: 0, z: 0 };
const _head = new THREE.Vector3();

export type EState = 'spawn' | 'idle' | 'chase' | 'orbit' | 'telegraph' | 'attack' | 'recover' | 'stagger' | 'stunned' | 'dead' | 'special' | 'warp';

export interface SpawnOpts { zone: number; stage: number; elite?: Affix[]; mode?: number; hpMul?: number }

/**
 * Враг (Tech §16): иерархическая FSM Spawn → Approach → Position → Telegraph → Attack → Recover → (Stunned) → Dead.
 * Мозг принимает решения 15–20 раз/с, движение — каждый шаг. Каждая атака всегда телеграфирована.
 */
export abstract class Enemy implements Actor {
  readonly id = newId();
  readonly faction = 'enemy' as const;
  x = 0; z = 0; y = 0;
  radius: number;
  mass: number;
  facing = 0;
  hp: number; maxHp: number;
  armor: number;
  dead = false;
  stun: Stun | null = null;
  kbX = 0; kbZ = 0;
  height: number;

  readonly kind: string;
  elite: Affix[];
  isBoss = false;
  isGuardian = false;
  readonly puppet: Puppet;
  state: EState = 'spawn';
  stateT = 0;
  dmg: number;
  speed: number;
  /** Множитель длительности телеграфов (Ускоренный −30 %, Неистовство…). */
  teleMul = 1;
  /** Щит Аколита: множитель входящего урона. */
  shieldMul = 1;
  shieldFrom: Enemy | null = null;
  stagger = 0;
  deathT = 0;
  token: 'melee' | 'ranged' | 'swarm' | null = null;
  tele: Telegraph | null = null;
  attackDone = false;
  vx = 0; vz = 0;
  scale = 1;
  /** Подсветка ядра при телеграфе (0..1) — уходит в буст эмиссии. */
  coreGlow = 0;
  /** Тяжёлый замах: под врагом сходится огненное кольцо (големы, стражи). */
  heavyWindup = false;
  protected brainT = Math.random() * 0.06;
  protected time = 0;
  /** Поедание/подкрепления: элитный порог 50 % HP сработал. */
  halfTriggered = false;
  /** Задержка перед следующей атакой (кулдаун). */
  cooldown = 0.8 + Math.random() * 0.8;
  /** Полёт после подбрасывания (Восходящий месяц). */
  private airT = 0; private airDur = 0; private airH = 0;
  /** Навигация (план §4.4): хотел ли идти в этом шаге, окно застревания, недостижимость, уход порталом. */
  private navWant = false;
  private navWinT = 0; private navX = 0; private navZ = 0;
  private stuckT = 0;
  /** Секунды принудительного следования по полю (после застревания). */
  protected navForceT = 0;
  /** Длительность последнего телеграфа (с) — тяжёлая ли атака для «Мгновения Пустоты». */
  lastTeleDur = 0;
  /** «Запаздывание» после идеального уклонения героя: 0.2 с враг движется вдвое медленнее (видно, что промахнулся). */
  lagT = 0;
  /** Стопкадр после попадания (мировые с): поза и тело стоят, модель дрожит (план §5.1, п. 4). */
  freeze = 0;
  /** Рядовой сбит с ног тяжёлым ударом: две маленькие звезды (с). */
  dazeT = 0;
  /** Звёзд оглушения над головой в прошлом шаге. */
  private starsLeft = 0;
  /** Сколько секунд герой недостижим из клетки врага. */
  unreachT = 0;
  private warpX = 0; private warpZ = 0;
  /** Точка стрельбы (стрелки и поддержка): держится ~1 с. */
  private standX = 0; private standZ = 0; private standT = 0;

  constructor(readonly def: EnemyDef, layout: RigLayout, clips: ClipDef[], o: SpawnOpts) {
    this.kind = def.id;
    this.elite = o.elite ?? [];
    const eliteK = this.elite.length > 0;
    this.maxHp = Math.round(scaleHp(def.hp, o.zone, o.stage, o.mode ?? 1) * (eliteK ? ELITE.hp : 1) * (o.hpMul ?? 1));
    this.hp = this.maxHp;
    this.dmg = scaleDmg(def.dmg, o.zone, o.stage, o.mode ?? 1) * (eliteK ? ELITE.dmg : 1);
    this.speed = def.speed;
    this.radius = def.radius * (eliteK ? ELITE.scale : 1);
    this.mass = def.mass * (eliteK ? 1.6 : 1);
    this.height = def.height * (eliteK ? ELITE.scale : 1);
    this.armor = def.armor ?? 0;
    this.scale = eliteK ? ELITE.scale : 1;
    if (def.stun) this.stun = makeStun(def.stun * (eliteK ? 1.5 : 1), Math.max(def.stunDur ?? 1.8, eliteK ? ELITE.stunDur : 0));
    else if (eliteK) this.stun = makeStun(ELITE.stun, ELITE.stunDur);
    if (this.elite.includes('hasted')) { this.speed *= 1.4; this.teleMul = 0.7; }
    this.puppet = new Puppet(layout, clips);
    this.puppet.skel.size = this.scale;
    this.puppet.dissolve = 1;
  }

  get targetable(): boolean { return !this.dead && this.state !== 'spawn' && this.state !== 'warp'; }
  /** Оглушён (план §5.5): +25 % урона, финишер или полный заряд вызовет Раскол. */
  get stunned(): boolean { return !!this.stun && this.stun.stunned > 0; }
  /** Раскол возможен: оглушён и не в переходе фаз. Раскол заканчивает оглушение — один на оглушение. */
  get shatterable(): boolean { return !this.dead && this.stunned && !this.shatterPending && this.canShatter; }
  /** Идёт отложенный разрез Раскола 2.0 по этой цели. */
  shatterPending = false;
  /** Боссы запрещают Раскол в переходах фаз (переопределяется). */
  get canShatter(): boolean { return true; }
  /** Окно уязвимости после атаки (Стражи и боссы): оглушение копится полностью. */
  get inWindow(): boolean { return false; }
  /** Шкала заполнилась во время неудержимой атаки: оглушение ждёт её конца. */
  stunQueued = false;
  /** Можно ли оглушить прямо сейчас (неудержимые атаки Стражей и боссов — нет). */
  canStunNow(): boolean { return true; }
  get spawned(): boolean { return this.state !== 'spawn'; }

  setState(s: EState): void { this.state = s; this.stateT = 0; }

  /** Общий шаг: спаун через портал, хитстан, оглушение, отбрасывание; затем мозг. */
  step(w: World, dt: number): void {
    if (this.lagT > 0) { this.lagT -= dt; dt *= 0.5; }
    this.time += dt;
    this.stateT += dt;
    this.puppet.stepSpring(dt);
    this.coreGlow = Math.max(0, this.coreGlow - dt * 3);
    if (this.dead) {
      this.deathT += dt;
      this.puppet.skel.stepDebris(dt);
      this.puppet.skel.update();
      this.puppet.dissolve = clamp((this.deathT - 0.35) / 0.6, 0, 1);
      return;
    }
    if (this.state === 'warp') {
      // уход порталом: растворение 0.45 с, затем появление в достижимой точке
      this.vx = this.vz = 0;
      this.puppet.dissolve = clamp(this.stateT / 0.45, 0, 1);
      if (this.stateT >= 0.45) {
        this.x = this.warpX; this.z = this.warpZ;
        this.facing = angleOf(w.hero.x - this.x, w.hero.z - this.z);
        this.unreachT = 0; this.stuckT = 0; this.navForceT = 0;
        this.setState('spawn');
        w.bus.emit('portal', { x: this.x, z: this.z });
      }
      this.animate(dt, w);
      return;
    }
    if (this.state === 'spawn') {
      // портал 0.8 с: обратное растворение
      this.puppet.dissolve = clamp(1 - this.stateT / 0.8, 0, 1);
      if (this.stateT >= 0.8) { this.puppet.dissolve = 0; this.setState('idle'); }
      this.animate(dt, w);
      return;
    }
    if (this.stun) {
      if (stepStun(this.stun, dt)) this.onStunEnd(w);
      // звёзды гаснут по одной — таймер оглушения виден на самом враге
      const left = this.stun.stunned > 0 ? Math.min(7, Math.ceil(this.stun.stunned / STUN_STAR_SEC)) : 0;
      if (left === this.starsLeft - 1) w.bus.emit('stunTick', { target: this, x: this.x, z: this.z, left, boss: this.isBoss || this.isGuardian });
      this.starsLeft = left;
      // ядро мерцает: украденный свет рвётся наружу трещинами
      this.puppet.crack = this.shatterPending ? -1 : this.stun.stunned > 0 ? 0.6 + 0.3 * Math.sin(this.time * 11) : Math.max(0, Math.abs(this.puppet.crack) - dt * 2);
      if (this.stunQueued && this.canStunNow()) w.stunEnemy(this);
    }
    if (this.dazeT > 0) this.dazeT -= dt;
    if (this.shieldFrom && (this.shieldFrom.dead || !this.shieldFrom.spawned)) { this.shieldFrom = null; this.shieldMul = 1; }
    if (this.airDur > 0) {
      this.airT += dt;
      const u = Math.min(1, this.airT / this.airDur);
      this.y = this.airH * Math.sin(u * Math.PI);
      if (u >= 1) { this.airDur = 0; this.y = 0; w.bus.emit('impact', { x: this.x, z: this.z, r: this.radius, kind: 'land' }); }
    }
    if (this.cooldown > 0) this.cooldown -= dt;

    // стопкадр: рядовые вне замаха стоят целиком; у замахов, Стражей и боссов таймлайн идёт — только дрожь,
    // иначе удар отставал бы от заполнившегося телеграфа
    const shiver = this.freeze > 0 && this.state !== 'dead';
    if (shiver) this.freeze -= dt;
    if (shiver && !this.isBoss && !this.isGuardian && this.state !== 'telegraph' && this.state !== 'attack') {
      this.vx = 0; this.vz = 0;
      this.applyShiver();
      return;
    }
    // отбрасывание
    if (this.kbX || this.kbZ) {
      this.vx = this.kbX; this.vz = this.kbZ;
      const k = Math.exp(-dt * 9);
      this.kbX *= k; this.kbZ *= k;
      if (Math.abs(this.kbX) + Math.abs(this.kbZ) < 0.1) this.kbX = this.kbZ = 0;
    }

    if (this.state === 'stunned') {
      this.vx *= 0.8; this.vz *= 0.8;
      if (!this.stunned) this.setState('recover');
    } else if (this.state === 'stagger') {
      if (this.stateT >= this.stagger) this.setState('recover');
    } else {
      this.brainT -= dt;
      this.navWant = false;
      this.think(w, dt, this.brainT <= 0);
      if (this.brainT <= 0) this.brainT = 1 / 18;
      this.stepNav(w, dt);
    }
    this.animate(dt, w);
    if (this.stunned) this.applySway();
    if (shiver) this.applyShiver();
  }

  /** Оглушение: тело «плывёт» — наклон ±9° кружит в такт звёздам (1.6 об/с). */
  private applySway(): void {
    const s = this.puppet.skel, a = this.time * Math.PI * 2 * 1.6;
    s.tiltX += Math.sin(a) * 0.15; s.tiltZ += Math.cos(a) * 0.15;
    s.update();
  }

  /** Точка над головой: там кружат звёзды оглушения. */
  headPoint(out: { x: number; y: number; z: number }): void {
    const L = this.puppet.layout;
    if (L.has('head')) {
      // выше макушки: у крупных шлем и рога тоже по росту
      const p = this.puppet.skel.jointPoint(L.idx('head'), 0, 0, 0, _head);
      p.y += 0.2 + this.height * 0.12;
      out.x = p.x; out.y = p.y; out.z = p.z;
    } else { out.x = this.x; out.y = this.y + this.height + 0.25; out.z = this.z; }
  }

  /** Дрожь ±2.5 см вокруг позиции тела (стопкадр попадания). */
  private applyShiver(): void {
    const s = this.puppet.skel, j = 0.025 * Math.min(1, this.freeze * 20 + 0.3);
    s.x = this.x + Math.sin(this.time * 97 + this.id) * j; s.z = this.z + Math.cos(this.time * 83 + this.id) * j;
    s.update();
  }

  /** Застревание и недостижимость: принудительно по полю, затем — уход порталом (план §4.4, п. 6–7). */
  private stepNav(w: World, dt: number): void {
    if (this.navForceT > 0) this.navForceT -= dt;
    if (!this.navWant) { this.navWinT = 0; this.stuckT = 0; this.navX = this.x; this.navZ = this.z; return; }
    this.navWinT += dt;
    if (this.navWinT >= 1) {
      const moved = Math.hypot(this.x - this.navX, this.z - this.navZ);
      if (moved < 0.2) { this.stuckT += this.navWinT; this.navForceT = 2; } else this.stuckT = 0;
      this.navWinT = 0; this.navX = this.x; this.navZ = this.z;
    }
    if ((this.unreachT > 1.5 || this.stuckT >= 3) && this.state !== 'telegraph' && this.state !== 'attack') this.onUnreachable(w);
  }

  /** Герой недостижим: по умолчанию — уйти порталом в достижимую точку в 6–9 м от него. Шелуха прыгает. */
  protected onUnreachable(w: World): void {
    if (this.isBoss || this.isGuardian) { this.unreachT = 0; this.stuckT = 0; return; }
    const p = w.nav.pointNearHero(w.hero.x, w.hero.z, 6, 9, this.radius > BIG_RADIUS, w.rng);
    if (!p) { this.unreachT = 0; this.stuckT = 0; return; }
    this.cancelTelegraph();
    this.token = null;
    this.warpX = p.x; this.warpZ = p.z;
    this.setState('warp');
    w.bus.emit('portal', { x: this.x, z: this.z });
  }

  /**
   * Идти к точке с обходом провалов и колонн: прямая видимость — рулить прямо (как steer),
   * иначе — вниз по полю потоков к герою.
   */
  seek(w: World, tx: number, tz: number, speed: number, dt: number, stopAt = 0): void {
    const nav = w.nav, big = this.radius > BIG_RADIUS;
    this.navWant = true;
    if (this.navForceT <= 0 && nav.losClear(this.x, this.z, tx, tz, Math.min(this.radius, 0.6) * 0.8)) {
      this.unreachT = 0;
      this.steer(tx, tz, speed, dt, stopAt);
      if (Math.hypot(tx - this.x, tz - this.z) <= stopAt + 0.05) this.navWant = false;
      return;
    }
    if (nav.descend(this.x, this.z, big, _nav)) {
      this.unreachT = 0;
      if (nav.distance(this.x, this.z, big) <= stopAt) { this.steer(this.x, this.z, speed, dt, 0); this.navWant = false; return; }
      this.steer(_nav.x, _nav.z, speed, dt, 0);
    } else {
      this.unreachT += dt;
      this.steer(this.x, this.z, speed, dt, 0);
    }
  }

  /**
   * Стрелки и поддержка: держать дистанцию R с прямой видимостью героя. Видно — кружить как orbit;
   * нет — 8 точек по кругу, ближайшая видящая героя, путь к ней по полю.
   */
  standOff(w: World, R: number, speed: number, dt: number, dir: number): void {
    const h = w.hero, nav = w.nav;
    if (nav.losClear(this.x, this.z, h.x, h.z, 0) && this.navForceT <= 0) { this.orbit(w, R, speed, dt, dir); this.unreachT = 0; return; }
    this.standT -= dt;
    if (this.standT <= 0) {
      this.standT = 1;
      let bd = Infinity;
      this.standX = this.x; this.standZ = this.z;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = h.x + Math.sin(a) * R, z = h.z + Math.cos(a) * R;
        if (!w.arena.walkable(x, z) || !nav.losClear(x, z, h.x, h.z, 0)) continue;
        const d = Math.hypot(x - this.x, z - this.z);
        if (d < bd) { bd = d; this.standX = x; this.standZ = z; }
      }
    }
    this.seek(w, this.standX, this.standZ, speed, dt, 0.3);
  }

  /** Решения ИИ: thinkTick — тик мозга (≈18 Гц), иначе — только движение/таймеры. */
  protected abstract think(w: World, dt: number, thinkTick: boolean): void;
  /** Поза: локомоция + клипы + телеграф в теле (ядро вспыхивает, корпус оттягивается). */
  protected abstract animate(dt: number, w: World): void;

  /** Задать желаемую скорость к точке. */
  steer(tx: number, tz: number, speed: number, dt: number, stopAt = 0): void {
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    let sx = 0, sz = 0;
    if (d > stopAt + 0.05) { sx = (dx / d) * speed; sz = (dz / d) * speed; }
    const k = 1 - Math.exp(-dt / 0.12);
    this.vx += (sx - this.vx) * k; this.vz += (sz - this.vz) * k;
  }

  /** Кружить вокруг героя на дистанции R (держать дистанцию, без токена атаки). */
  orbit(w: World, R: number, speed: number, dt: number, dir: number): void {
    const h = w.hero;
    const dx = this.x - h.x, dz = this.z - h.z, d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;
    const radial = (R - d) * 1.5;
    const tx = nx * radial + -nz * dir * speed * 0.6, tz = nz * radial + nx * dir * speed * 0.6;
    const l = Math.hypot(tx, tz) || 1;
    const sp = Math.min(speed, l);
    const k = 1 - Math.exp(-dt / 0.2);
    this.vx += ((tx / l) * sp - this.vx) * k; this.vz += ((tz / l) * sp - this.vz) * k;
  }

  faceTo(x: number, z: number, tau: number, dt: number): void {
    this.facing = dampAngle(this.facing, angleOf(x - this.x, z - this.z), tau, dt);
  }

  distTo(a: { x: number; z: number }): number { return Math.hypot(a.x - this.x, a.z - this.z); }

  /** Начать телеграф атаки: метка на полу + ядро вспыхивает. */
  telegraph(w: World, shape: Shape, dur: number, white = false, sound: 'hum' | 'whistle' | 'chime' | 'bell' | 'roar' = 'hum'): Telegraph {
    this.tele = w.addTelegraph(shape, dur * this.teleMul, white);
    this.lastTeleDur = dur * this.teleMul;
    w.bus.emit('telegraph', { kind: sound, x: this.x, z: this.z, src: this.kind });
    return this.tele;
  }

  cancelTelegraph(): void {
    if (this.tele) { this.tele.alive = false; this.tele = null; }
  }

  /** Подбросить (рядовые и элита полегче): оглушение на время полёта. */
  launch(h: number): void {
    if (this.isBoss || this.isGuardian || this.mass > 3 || this.dead || this.state === 'spawn') return;
    const k = this.elite.length ? 0.6 : 1;
    this.airDur = 0.55 + 0.1 * k; this.airT = 0; this.airH = h * k;
    this.cancelTelegraph();
    this.token = null;
    this.stagger = this.airDur + 0.15;
    this.setState('stagger');
  }

  /** Прерывание лёгким ударом (хитстан рядовых). */
  interrupt(dur: number): void {
    if (!this.def.staggerable || this.elite.length > 0 || this.state === 'spawn') return;
    this.cancelTelegraph();
    if (this.token) this.token = null;
    this.stagger = dur;
    this.setState('stagger');
  }

  /** Оглушение: атака отменяется, враг «плывёт» (элита 2.5 с, Голем 1.8 с, Страж 3 с, Иерофант 3.5 с). */
  onStun(): void {
    this.cancelTelegraph();
    this.token = null;
    this.setState('stunned');
  }

  /** Оглушение кончилось (таймер или Раскол): пробуждение. */
  onStunEnd(_w: World): void {
    if (this.state === 'stunned') this.setState('recover');
  }

  /** Смерть = распад: детали отрываются и разлетаются (GDD §15.2). */
  kill(w: World, dirX: number, dirZ: number, power: number): void {
    if (this.dead) return;
    this.dead = true;
    this.cancelTelegraph();
    this.token = null;
    this.state = 'dead';
    this.deathT = 0;
    this.puppet.skel.shatter(dirX, dirZ, power, w.fxRng);
  }

  /** Точка, куда стягивается энергия замаха (оружие, ядро). По умолчанию — грудь. */
  windupPoint(out: { x: number; y: number; z: number }): void {
    out.x = this.x + Math.sin(this.facing) * this.radius * 0.6; out.y = this.y + this.height * 0.6; out.z = this.z + Math.cos(this.facing) * this.radius * 0.6;
  }

  /** Прогресс текущего замаха 0..1 (по метке телеграфа). */
  get windup(): number {
    if (this.state !== 'telegraph' || !this.tele) return 0;
    return Math.min(1, this.tele.t / Math.max(0.05, this.tele.dur));
  }

  /** Добавлен в мир. */
  onAdded(_w: World): void {}

  /** Неуязвим (переходы фаз босса, портал). */
  get invulnerable(): boolean { return false; }

  /** Урон получен (после вычитания HP): пороги фаз, элитные триггеры 50 %. */
  onDamaged(w: World, _dmg: number, _before: number): void {
    if (!this.halfTriggered && this.elite.length && this.hp > 0 && this.hp <= this.maxHp / 2) {
      this.halfTriggered = true;
      w.onEliteHalf?.(this);
    }
  }

  /** Смертельный урон: false — враг не умирает (босс ждёт перехода фазы). */
  onLethal(_w: World): boolean { return true; }

  /** Раскол применён: трещины взорваны, оглушение кончилось. */
  onShattered(_w: World): void {}

  /** Сколько кадров удалить после распада. */
  get removable(): boolean { return this.dead && this.deathT > 1.0; }
}
