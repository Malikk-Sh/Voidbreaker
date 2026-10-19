import { EventBus } from '../core/events';
import { Rng, fxRng } from '../core/rng';
import { clamp } from '../core/math';
import { swapRemove } from '../core/pool';
import { FEEL, type FeelId } from '../data/feel';
import type { StunKind } from '../data/weapons';
import { RESONANCE } from '../data/player';
import { RECOIL } from '../data/enemies';
import type { Input } from '../input/input';
import { addStun, endStun, triggerStun, type Actor } from './actor';
import { NavGrid } from './nav';
import type { Arena } from './arena';
import { computeDamage, overlaps, type Shape } from './combat';
import type { Enemy } from './enemy';
import type { Hazard, Pickup, Projectile, ProjectileKind, RingWave, Telegraph } from './entities';
import type { GameEvents } from './events';
import { Hero } from './hero';
import { ShadowCopy } from './shadow';
import { RankTracker } from './rank';
import type { AbilityHost } from './abilityHost';

export interface StrikeParams {
  mult: number;
  /** Наполнение шкалы оглушения (план §5.5). */
  stun: number;
  /** Источник оглушения; по умолчанию клинок: финишер → 'finisher', иначе 'light'; способности — 'other'. */
  stunKind?: StunKind;
  knockback: number;
  feel: FeelId;
  finisher?: boolean;
  dirX: number;
  dirZ: number;
  pierce?: boolean;
  source: 'blade' | 'ability' | 'proj' | 'env';
  /** Доп. множитель урона (Горизонт событий, Возмездие…). */
  extra?: number;
  /** Не начислять Резонанс (способности сами решают). */
  noResonance?: boolean;
  /** Подавить хитстан. */
  noStagger?: boolean;
  abilityId?: string;
  /** Подбросить цель (м). */
  launch?: number;
  /** Приём героя (высота звука по шагу комбо). */
  moveId?: string;
  /** Детонатор меток Пустоты: +доля урона за стопку, стопки снимаются (Серп, Колодец 0.2; линия Раскола 0.1). */
  detonate?: number;
}

const FEEL_ORDER: Record<FeelId, number> = { light: 0, medium: 1, heavy: 2, break: 3 };

/**
 * Множитель оглушения у Стражей и боссов (план §5.5): вне окна уязвимости спам почти не копит шкалу,
 * Контрудар — всегда полностью, украденный снаряд — ×2.5. В окне — как у элиты (украденный снаряд ×2.5).
 */
const STUN_OUT: Record<StunKind, number> = { light: 0.25, finisher: 0.25, charged: 1 / 3, counter: 1, stolen: 2.5, other: 0.25 };
const STUN_IN: Record<StunKind, number> = { light: 1, finisher: 1, charged: 1, counter: 1, stolen: 2.5, other: 1 };
/** Идеальное уклонение от атаки Стража или босса. */
export const STUN_PERFECT_DODGE = 10;

/** Итог попадания для сборки события strike. */
export interface HitResult { crit: boolean; feel: FeelId }

/** Раскол 2.0 (план §5.6): отложенный разрез. Время — реальные секунды, мир почти стоит. */
export interface ShatterSeq {
  target: Enemy;
  dirX: number; dirZ: number;
  /** Линия разреза от цели по направлению удара: 7 × 1.5 м. */
  line: Shape;
  t: number;
  /** Удар-вспышка, разлёт осколков, конец. */
  cut: number; impact: number; dur: number;
  cutDone: boolean; hit: boolean; skipped: boolean;
}

/** Снаряды, которые можно украсть идеальным уклонением (план §6.3): иглы, залпы Ока, Аколита, камни. */
const STEALABLE: ReadonlySet<ProjectileKind> = new Set<ProjectileKind>(['orb', 'acolyteOrb', 'needle', 'stone']);
/** Отбитое кадило Иерофанта: прибавка к оглушению хозяина (план §8.3). */
export const CENSER_RETURN_STUN = 40;
/** Украденный осколок кружит вокруг героя столько секунд. */
export const STOLEN_LIFE = 2;

/** Линия Раскола: длина и ширина (м); урон задетым на ней. */
export const SHATTER_LINE = { len: 7, w: 1.5, mult: 2.5 };

export interface RunStats {
  dmgDealt: number; kills: number; hitsTaken: number; dmgTaken: number; perfectDodges: number; shatters: number;
  shards: number; ether: number; time: number;
}

/**
 * Мир боя (Tech §9): симуляция не знает о Three.js — рендер читает списки сущностей.
 * Все «сочные» реакции — подписчики шины событий.
 */
export class World {
  readonly bus = new EventBus<GameEvents>();
  readonly fxRng = fxRng;
  rng: Rng;
  readonly hero: Hero;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  telegraphs: Telegraph[] = [];
  hazards: Hazard[] = [];
  pickups: Pickup[] = [];
  ringWaves: RingWave[] = [];
  readonly rank = new RankTracker();
  abilities!: AbilityHost;
  time = 0;
  /** Режим «История»: −40 % урона по игроку (GDD §21). */
  damageTakenMul = 1;
  zone = 0;
  stage = 0;
  mode = 1;
  run: RunStats = { dmgDealt: 0, kills: 0, hitsTaken: 0, dmgTaken: 0, perfectDodges: 0, shatters: 0, shards: 0, ether: 0, time: 0 };
  /** Токены атаки (Tech §16): ≤ 3 врагов в замахе рядом, ≤ 2 одновременных выстрела. */
  meleeTokens = 3;
  rangedTokens = 2;
  /** Отдельный пул для роя (Шелуха): толпа не отнимает очередь у «настоящих» бойцов. */
  swarmTokens = 4;
  /** Шардов на единицу «веса дропа» врага (задаёт этап). */
  shardPerDrop = 3;
  /** Магнит подбора (передышка между волнами). */
  magnet = false;
  /** Дополнительные «наблюдатели» шага (босс-скрипты, директор волн). */
  readonly stepHooks: ((dt: number) => void)[] = [];
  /** Копии аффикса «Тень» (план §7.6). */
  readonly shadows: ShadowCopy[] = [];
  /** Враг, чей шаг сейчас идёт: его метки помечаются владельцем. */
  private stepping: Enemy | null = null;
  /** Свечи арены гаснут по кругу, пока Звонарь заряжает сильный удар (план §7.4): доля круга 0..1 и его начало. */
  candlesOut = 0;
  candlesFrom = 0;
  /** Временные стены (цепи Звонаря): укрытия арены с таймером; навигация перестраивается по версии арены. */
  readonly tempWalls: { x: number; z: number; r: number; t: number; dur: number; cover: { x: number; z: number; r: number } }[] = [];
  /** Бонус урона по оглушённым (Сердце Молоха и т.п.). */
  brokenBonus = 0;
  /** Когда герой последний раз идеально ушёл от атаки Стража или босса (время мира). */
  private lastBossPerfect = -99;
  /** Украденный импульс (план §6.3): фиолетовые осколки вокруг героя; следующий удар клинка их отправляет. */
  stolen: { kind: ProjectileKind; t: number; a: number }[] = [];
  /** Идущий Раскол 2.0: герой неуязвим, урон — по таймеру (план §5.6). */
  shatterSeq: ShatterSeq | null = null;
  /** Полных Расколов, оставшихся на сессию: первые два — полная версия, дальше — короткая. */
  fullShatters = 2;
  /** Настройка «Короткие казни». */
  shortShatters = false;
  /** Элита опустилась до 50 % HP (подкрепления, Зеркальный аффикс). */
  onEliteHalf: ((e: Enemy) => void) | null = null;

  /** Навигация врагов: поля потоков к герою (план §4.4). */
  readonly nav: NavGrid;

  constructor(public arena: Arena, seed: string) {
    this.rng = new Rng(seed);
    this.nav = new NavGrid(arena);
    this.hero = new Hero(this);
    this.bus.on('playerHurt', () => this.rank.hurt());
    this.bus.on('perfectDodge', () => { this.rank.perfectDodge(); this.run.perfectDodges++; });
  }

  addEnemy(e: Enemy): void {
    this.enemies.push(e);
    e.onAdded(this);
    if (e.elite.includes('shadow')) this.shadows.push(new ShadowCopy(e, this));
    this.bus.emit('spawned', { actor: e });
  }

  get aliveEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  // ------------------------------------------------------------------ шаг
  /** dtR — реальная длительность шага: по ней идёт Раскол 2.0, когда мир почти стоит. */
  step(dtW: number, dtH: number, input: Input, dtR = dtW): void {
    this.time += dtW;
    this.run.time += dtW;
    if (this.shatterSeq) this.stepShatter(dtR, input);
    this.hero.update(dtH, input);
    this.nav.update(dtW, this.hero.x, this.hero.z);
    // свечи загораются снова, если их никто не гасит (Звонарь держит долю, пока заряжает удар)
    this.candlesOut = Math.max(0, this.candlesOut - dtW * 0.8);
    for (const e of this.enemies) { this.stepping = e; e.step(this, dtW); }
    this.stepping = null;
    for (let i = this.shadows.length - 1; i >= 0; i--) {
      const s = this.shadows[i];
      s.step(this, dtW);
      if (!s.alive && s.vis <= 0) swapRemove(this.shadows, i);
    }
    this.integrate(dtW, dtH);
    this.stepProjectiles(dtW);
    this.stepRingWaves(dtW);
    this.stepHazards(dtW);
    this.stepTelegraphs(dtW);
    this.stepPickups(dtW);
    this.arena.step(dtW);
    this.rank.step(dtH);
    // +1 Резонанс/с на ранге S+
    if (this.rank.rankIdx >= 4) this.hero.addResonance(RESONANCE.perSecondAtS * dtH);
    this.abilities.step(dtW, dtH);
    this.stepTempWalls(dtW);
    for (const h of this.stepHooks) h(dtW);
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].removable) swapRemove(this.enemies, i);
  }

  /** Движение врагов + мягкое расталкивание (рой обтекает героя). */
  private integrate(dtW: number, _dtH: number): void {
    const o = { x: 0, z: 0 };
    for (const e of this.enemies) {
      if (e.dead || e.state === 'spawn') continue;
      this.arena.move(e.x, e.z, e.vx * dtW, e.vz * dtW, e.radius, o);
      // пропасть или провал в полу: враг, сброшенный ударом с края, падает (стражи в ямы не помещаются)
      const nx = e.x + e.vx * dtW, nz = e.z + e.vz * dtW;
      const drop = this.arena.edge === 'abyss' || (this.arena.inPit(nx, nz) && !e.isGuardian);
      if (drop && (e.kbX || e.kbZ) && !e.isBoss && !this.arena.walkable(nx, nz)) {
        e.x += e.vx * dtW; e.z += e.vz * dtW;
        this.bus.emit('fall', { x: e.x, z: e.z, hero: false });
        this.killEnemy(e, e.kbX, e.kbZ, 2);
        continue;
      }
      e.x = o.x; e.z = o.z;
    }
    const h = this.hero;
    const heroSolid = h.state !== 'dash' && !h.dead && h.state !== 'fall' && !h.scripted;
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.state === 'spawn') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || b.state === 'spawn') continue;
        this.separate(a, b, 1);
      }
      if (heroSolid) this.separate(h, a, 1);
    }
  }

  private separate(a: Actor, b: Actor, k: number): void {
    const dx = b.x - a.x, dz = b.z - a.z;
    const rr = a.radius + b.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr || d2 < 1e-8) return;
    const d = Math.sqrt(d2), push = (rr - d) * k;
    const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
    const nx = dx / d, nz = dz / d;
    const o = { x: 0, z: 0 };
    this.arena.move(a.x, a.z, -nx * push * wa, -nz * push * wa, a.radius, o); a.x = o.x; a.z = o.z;
    this.arena.move(b.x, b.z, nx * push * wb, nz * push * wb, b.radius, o); b.x = o.x; b.z = o.z;
  }

  // ------------------------------------------------------------------ удары героя
  /** Хитбокс героя: возвращает число задетых целей. hitList — одна цель получает урон один раз за взмах. */
  heroStrike(shape: Shape, hitList: Set<number>, p: StrikeParams): number {
    let n = 0;
    this.beginStrike();
    for (const e of this.enemies) {
      if (!e.targetable || hitList.has(e.id)) continue;
      if (!overlaps(shape, e.x, e.z, e.radius)) continue;
      hitList.add(e.id);
      this.damageEnemy(e, p);
      n++;
    }
    this.endStrike(p);
    // отражённые снаряды и Искры можно отбивать — проверка снарядов
    if (p.source === 'blade') {
      for (const pr of this.projectiles) {
        if (!pr.alive || pr.reflected || pr.kind === 'ring' || pr.kind === 'wave') continue;
        // кадило Иерофанта (план §8.3): полный заряженный удар шлёт его обратно в колокол
        if (pr.kind === 'censer' && p.stunKind === 'charged' && p.feel === 'heavy' && overlaps(shape, pr.x, pr.z, pr.r + 0.4)) {
          const o = this.enemies.find((e) => e.id === pr.owner && !e.dead);
          if (!o) continue;
          const dx = o.x - pr.x, dz = o.z - pr.z, l = Math.hypot(dx, dz) || 1;
          pr.reflected = true; pr.vx = (dx / l) * 18; pr.vz = (dz / l) * 18; pr.life = 2; pr.age = 0;
          this.bus.emit('censer', { kind: 'deflect', x: pr.x, z: pr.z });
          continue;
        }
        if (overlaps(shape, pr.x, pr.z, pr.r) && this.abilities.canDeflect()) {
          pr.reflected = true; pr.vx = -pr.vx * 1.3; pr.vz = -pr.vz * 1.3; pr.life = 2;
        }
      }
    }
    return n;
  }

  private batch: { n: number; crit: boolean; feel: FeelId; sx: number; sz: number; boss: boolean } | null = null;

  /** Начать сбор попаданий одного взмаха/залпа: все damageEnemy до endStrike дадут одно событие strike. */
  beginStrike(): void { this.batch = { n: 0, crit: false, feel: 'light', sx: 0, sz: 0, boss: false }; }

  endStrike(p: Pick<StrikeParams, 'dirX' | 'dirZ' | 'source' | 'moveId'>): void {
    const b = this.batch;
    this.batch = null;
    if (!b || !b.n) return;
    this.bus.emit('strike', { n: b.n, crit: b.crit, feel: b.feel, x: b.sx / b.n, z: b.sz / b.n, dirX: p.dirX, dirZ: p.dirZ, source: p.source, moveId: p.moveId, boss: b.boss });
  }

  damageEnemy(e: Enemy, p: StrikeParams): HitResult | null {
    if (e.dead || !e.targetable) return null;
    const h = this.hero;
    if (e.invulnerable) {
      this.bus.emit('hit', { target: e, dmg: 0, crit: false, feel: 'light', dirX: p.dirX, dirZ: p.dirZ, x: e.x, y: e.height * 0.6, z: e.z, source: p.source, shielded: true });
      return null;
    }
    const perfect = (p.source === 'blade' || p.source === 'ability') && h.consumePerfectBuff();
    const kind: StunKind = p.stunKind ?? (p.source === 'blade' ? (p.finisher ? 'finisher' : 'light') : 'other');
    // Раскол: финишер, Контрудар или полный заряд по оглушённому врагу — один раз за оглушение
    const shatter = e.shatterable && p.source === 'blade' && !!p.finisher && (kind !== 'charged' || p.feel === 'heavy');
    // слабое место: удар в спину
    const weak = p.source === 'blade' && Math.sin(e.facing) * p.dirX + Math.cos(e.facing) * p.dirZ > 0.5;
    // Звездопад по подброшенному: вбивает в пол (план §6.5)
    let slamMul = 1;
    if (p.moveId === 'skyfall' && e.airborne) { e.slamDown(this); slamMul = 1.4; }
    // детонация меток Пустоты (план §6.1)
    let markMul = 1;
    if (p.detonate && e.marks > 0) {
      markMul = 1 + p.detonate * e.marks;
      this.bus.emit('detonate', { target: e, x: e.x, y: e.height * 0.55, z: e.z, stacks: e.marks });
      e.marks = 0;
    }
    const S = h.stats;
    const res = computeDamage(
      { atk: S.atk, critChance: S.critChance, critMul: S.critMul, dmgBonus: S.dmgBonus + (p.source === 'ability' ? S.abilityDmg : 0) + (e.stunned ? this.brokenBonus : 0), forceCrit: perfect },
      p.mult, e.armor, e.stunned, () => this.rng.next(), (perfect ? 1.3 : 1) * e.shieldMul * (p.extra ?? 1) * markMul * slamMul * this.abilities.damageMulOn(e),
    );
    const before = e.hp;
    e.hp -= res.dmg;
    this.run.dmgDealt += res.dmg;
    e.onDamaged(this, res.dmg, before);
    let feel: FeelId = res.crit && p.feel === 'light' ? 'medium' : p.feel;
    // удар клинка кладёт метку Пустоты
    if (p.source === 'blade' && !e.dead) e.addMark();
    let stunned = false;
    if (e.stun && !e.dead && !shatter) {
      const heavy = e.isGuardian || e.isBoss;
      const k = heavy ? (e.inWindow ? STUN_IN : STUN_OUT)[kind] : 1;
      const amount = p.stun * k * (perfect ? 2 : 1) * (weak ? 1.5 : 1) * (e.shieldMul < 1 ? 0.5 : 1);
      if (addStun(e.stun, amount)) stunned = this.stunOrQueue(e);
      if (stunned) feel = 'break';
    }
    // реакция на попадание: вспышка, пружина, отбрасывание, хитстан рядовых
    e.puppet.flash = 1;
    if (!e.isBoss) {
      const kb = p.knockback / Math.max(0.5, e.mass) * (e.isGuardian ? 0.1 : 1);
      e.kbX += p.dirX * kb * 2.2; e.kbZ += p.dirZ * kb * 2.2;
      if (p.launch) e.launch(p.launch);
      else if (!p.noStagger) {
        // тяжёлый удар сбивает рядового с ног: две маленькие звезды на 0.6 с — тот же язык, что у оглушения
        const knock = p.feel === 'heavy' && !e.stun;
        e.interrupt(knock ? 0.6 : p.feel === 'light' ? 0.22 : 0.35, p.feel === 'heavy');
        if (knock && e.state === 'stagger' && e.dazeT <= 0) { e.dazeT = 0.6; this.bus.emit('daze', { target: e, x: e.x, z: e.z }); }
      }
    }
    // реакция по классу врага (план §7.1)
    e.react(this, p.feel === 'heavy' || feel === 'break', FEEL[feel].spring, p.dirX, p.dirZ);
    if (p.source === 'blade' && !e.dead) e.onBladeHit(this, p, kind);
    if (!shatter) e.recoilHit(this, !!p.finisher);
    if (!p.noResonance) h.addResonance(RESONANCE.perHit + (p.finisher ? RESONANCE.perFinisher - RESONANCE.perHit : 0));
    this.rank.hit(!!p.finisher);
    if (p.abilityId) this.rank.used(p.abilityId);
    else this.rank.used('blade');
    const crit = res.crit || perfect;
    this.bus.emit('hit', { target: e, dmg: res.dmg, crit, feel, dirX: p.dirX, dirZ: p.dirZ, x: e.x, y: e.height * 0.55, z: e.z, source: p.source, shielded: e.shieldMul < 1, weak: weak || e.inWindow });
    // жертва висит в кадре удара чуть дольше героя (стопкадр + дрожь)
    e.freeze = Math.max(e.freeze, (FEEL[feel].hitstop + 0.04) * (e.isBoss || e.isGuardian ? 0.5 : 1));
    const b = this.batch;
    if (b) {
      b.n++; b.crit ||= crit; b.sx += e.x; b.sz += e.z; b.boss ||= e.isBoss || e.isGuardian;
      if (FEEL_ORDER[feel] > FEEL_ORDER[b.feel]) b.feel = feel;
    }
    if (e.hp <= 0) this.killEnemy(e, p.dirX, p.dirZ, stunned || p.feel === 'heavy' ? 6 : 3.5);
    else if (shatter) this.startShatter(e, p.dirX, p.dirZ);
    return { crit, feel };
  }

  /** Шкала заполнилась: оглушить сейчас или, если идёт неудержимая атака, — после неё. true — оглушён. */
  private stunOrQueue(e: Enemy): boolean {
    if (e.canStunNow()) { this.stunEnemy(e); return true; }
    e.stunQueued = true;
    return false;
  }

  /** Добавить оглушение напрямую (идеальное уклонение от Стража или босса). */
  addStunTo(e: Enemy, amount: number): void {
    if (e.dead || !e.stun) return;
    if (addStun(e.stun, amount)) this.stunOrQueue(e);
  }

  /** Оглушение (план §5.5): таймер с привыканием, событие для звёзд, звука и камеры. */
  stunEnemy(e: Enemy): void {
    if (e.dead || !e.stun || e.stun.stunned > 0) return;
    e.stunQueued = false;
    const dur = triggerStun(e.stun);
    e.onStun();
    this.bus.emit('stun', { target: e, x: e.x, z: e.z, boss: e.isBoss || e.isGuardian, dur });
    // уклонение от атаки босса и сразу оглушение — +80 очков ранга (план §6.6)
    if ((e.isBoss || e.isGuardian) && this.time - this.lastBossPerfect < 2.5) {
      this.lastBossPerfect = -99;
      this.rank.bonus(80);
      this.bus.emit('rankBurst', { x: e.x, z: e.z });
    }
  }

  /**
   * Раскол 2.0 (план §5.6): цель и линия разреза застывают, урон — через 0.45 с (короткая версия — быстрее).
   * Элита и Голем 0.6 с (коротко 0.4), Страж 0.8 (0.5), босс 1.0 — всегда полная, пропуск рывком.
   */
  startShatter(e: Enemy, dirX: number, dirZ: number): void {
    if (this.shatterSeq) { this.shatterEnemy(e, dirX, dirZ); return; }
    const boss = e.isBoss, guard = e.isGuardian && !boss;
    const short = !boss && (this.shortShatters || this.fullShatters <= 0);
    if (!short && !boss) this.fullShatters--;
    const dur = boss ? 1.0 : guard ? (short ? 0.5 : 0.8) : short ? 0.4 : 0.6;
    const k = short ? (guard ? 0.83 : 0.67) : 1;
    const l = Math.hypot(dirX, dirZ) || 1;
    dirX /= l; dirZ /= l;
    e.shatterPending = true;
    // вспышка попадания не висит белым пятном, пока мир стоит: видны трещины Раскола
    e.puppet.flash = 0;
    e.puppet.crack = -1;
    const line: Shape = { k: 'line', x: e.x, z: e.z, dx: dirX, dz: dirZ, len: SHATTER_LINE.len, w: SHATTER_LINE.w };
    this.shatterSeq = { target: e, dirX, dirZ, line, t: 0, cut: 0.15 * k, impact: 0.45 * k, dur, cutDone: false, hit: false, skipped: false };
    this.bus.emit('shatterStart', { target: e, x: e.x, z: e.z, dirX, dirZ, len: SHATTER_LINE.len, cut: 0.15 * k, impact: 0.45 * k, dur, big: boss || guard, short });
  }

  private stepShatter(dtR: number, input: Input): void {
    const s = this.shatterSeq!;
    // пропуск рывком: сразу к разлёту и конец
    if (!s.hit && s.t > 0.1 && input.buffer.peek('dash', input.now)) { s.skipped = true; s.t = Math.max(s.t, s.impact); }
    else s.t += dtR;
    if (!s.cutDone && s.t >= s.cut) {
      s.cutDone = true;
      this.bus.emit('shatterCut', { x: s.line.x, z: s.line.z, dirX: s.dirX, dirZ: s.dirZ, len: SHATTER_LINE.len, silence: s.impact - s.cut });
    }
    if (!s.hit && s.t >= s.impact) { s.hit = true; this.shatterImpact(s); }
    if (s.t >= s.dur || (s.skipped && s.hit)) {
      this.shatterSeq = null;
      this.bus.emit('shatterEnd', { skipped: s.skipped });
    }
  }

  /** Разлёт: удар по цели, затем всё по линии — 2.5× и отброс; другие оглушённые на линии раскалываются цепочкой. */
  private shatterImpact(s: ShatterSeq): void {
    const e = s.target;
    e.shatterPending = false;
    if (!e.dead) this.shatterEnemy(e, s.dirX, s.dirZ);
    for (const o of this.enemies) {
      if (o === e || !o.targetable || !overlaps(s.line, o.x, o.z, o.radius)) continue;
      if (o.shatterable) { this.shatterEnemy(o, s.dirX, s.dirZ); continue; }
      // 2.5× и +10 % за каждую метку Пустоты; затем — свежая метка
      this.damageEnemy(o, { mult: SHATTER_LINE.mult, stun: 6, stunKind: 'other', knockback: 7, feel: 'heavy', dirX: s.dirX, dirZ: s.dirZ, source: 'ability', noResonance: true, abilityId: 'shatter', detonate: 0.1 });
      if (!o.dead) o.addMark();
    }
  }

  /**
   * Удар Раскола по цели: доля HP (элита и Голем 14 %, Страж 5 %, босс 4 %), Резонанс, лечение вехой Стойкости;
   * оглушение сразу заканчивается (пробуждение 5 с). Мгновенных убийств нет.
   */
  shatterEnemy(e: Enemy, dirX: number, dirZ: number): void {
    if (e.dead || !e.stun) return;
    const h = this.hero, S = h.stats;
    const frac = e.isBoss ? 0.04 : e.isGuardian ? 0.05 : 0.14;
    const dmg = Math.max(1, Math.round(e.maxHp * frac * (1 + S.dmgBonus) * e.shieldMul));
    const before = e.hp;
    e.hp -= dmg;
    this.run.dmgDealt += dmg;
    this.run.shatters++;
    e.shatterPending = false;
    endStun(e.stun);
    e.onStunEnd(this);
    e.onDamaged(this, dmg, before);
    e.onShattered(this);
    this.rank.shatter();
    h.addResonance(RESONANCE.perShatter);
    if (S.shatterHeal > 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * S.shatterHeal);
    this.bus.emit('shatter', { target: e, x: e.x, y: e.height * 0.55, z: e.z, boss: e.isBoss, dmg });
    this.bus.emit('hit', { target: e, dmg, crit: true, feel: 'break', dirX, dirZ, x: e.x, y: e.height * 0.7, z: e.z, source: 'blade' });
    if (e.hp <= 0) this.killEnemy(e, dirX, dirZ, 7);
  }

  killEnemy(e: Enemy, dirX: number, dirZ: number, power: number): void {
    if (e.dead) return;
    if (!e.onLethal(this)) { e.hp = Math.max(1, e.hp); return; }
    e.hp = 0;
    e.kill(this, dirX, dirZ, power);
    this.run.kills++;
    this.bus.emit('kill', { target: e, kind: e.kind, x: e.x, z: e.z, dirX, dirZ, big: e.radius > 0.9, elite: e.elite.length > 0 });
    this.dropShards(e.x, e.z, e.def.drop * (e.elite.length ? 3 : 1));
    if (e.elite.includes('explosive')) this.radialProjectiles(e.x, e.z, 10, 6.5, e.dmg * 0.6, 'orb', e.id);
    this.abilities.onKill(e);
  }

  // ------------------------------------------------------------------ атаки врагов
  /** Удар врага по герою: учитывает неуязвимость рывка и идеальное уклонение. */
  enemyStrike(src: { x: number; z: number; id: number; kind: string; dead?: boolean; elite?: string[] }, shape: Shape, dmg: number, kb = 3): 'miss' | 'hit' | 'perfect' | 'dodge' | 'immune' {
    const h = this.hero;
    if (h.dead || !overlaps(shape, h.x, h.z, h.radius)) return 'miss';
    let dx = h.x - src.x, dz = h.z - src.z;
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    // тяжёлая атака (элита, Страж, босс, телеграф ≥ 0.7 с) — уклонение от неё даёт «Мгновение Пустоты»
    const atk = this.enemies.find((x) => x.id === src.id);
    const heavy = !!atk && (atk.elite.length > 0 || atk.isGuardian || atk.isBoss) && atk.lastTeleDur >= 0.7;
    // нить Псаломщика: +25 % урона
    if (atk?.psalmLinked) dmg *= 1.25;
    const res = h.receiveAttack(dmg, dx, dz, src.kind, kb, heavy);
    // Отдача: идеальное уклонение сквозь волну — +20 Резонанса
    if (res === 'perfect' && src.kind === 'recoil') { h.addResonance(RECOIL.dodgeResonance); this.bus.emit('recoilDodge', { x: h.x, z: h.z }); }
    if (res === 'perfect' && atk) {
      if (!atk.isGuardian && !atk.isBoss) atk.lagT = 0.2;
      else { this.lastBossPerfect = this.time; this.addStunTo(atk, STUN_PERFECT_DODGE); }
    }
    if (res === 'hit') {
      this.run.hitsTaken++;
      this.run.dmgTaken += dmg;
      if (src.elite?.includes('vampiric')) {
        const e = this.enemies.find((x) => x.id === src.id);
        if (e && !e.dead) e.hp = Math.min(e.maxHp, e.hp + dmg * 2);
      }
    }
    return res;
  }

  addTelegraph(shape: Shape, dur: number, white = false, shadow = false): Telegraph {
    const t: Telegraph = { shape, t: 0, dur: Math.max(0.05, dur), white, alive: true, fade: 0, shadow, owner: this.stepping };
    this.telegraphs.push(t);
    return t;
  }

  private stepTelegraphs(dt: number): void {
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.t += dt;
      if (!t.alive || t.t >= t.dur) {
        t.fade += dt;
        if (t.fade > 0.15) swapRemove(this.telegraphs, i);
      }
    }
  }

  // ------------------------------------------------------------------ снаряды
  spawnProjectile(kind: ProjectileKind, x: number, z: number, vx: number, vz: number, dmg: number, owner: number, r = 0.32, life = 4, y = 1.2): Projectile {
    const p: Projectile = { kind, x, z, y, vx, vz, r, dmg, life, age: 0, alive: true, spent: false, reflected: false, owner };
    this.projectiles.push(p);
    this.bus.emit('enemyAttack', { kind: 'shot', x, z });
    return p;
  }

  radialProjectiles(x: number, z: number, count: number, speed: number, dmg: number, kind: ProjectileKind, owner: number, phase = 0): void {
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      this.spawnProjectile(kind, x + Math.sin(a) * 0.8, z + Math.cos(a) * 0.8, Math.sin(a) * speed, Math.cos(a) * speed, dmg, owner, 0.35, 5);
    }
  }

  /** Удар клинка: украденные осколки летят в цель автоприцела (или в ближайшего врага); 2× и оглушение «украденный». */
  fireStolen(target: Enemy | null): void {
    if (!this.stolen.length) return;
    const h = this.hero;
    let t = target;
    if (!t || !t.targetable) {
      let bd = 14;
      for (const e of this.enemies) { if (!e.targetable) continue; const d = Math.hypot(e.x - h.x, e.z - h.z); if (d < bd) { bd = d; t = e; } }
    }
    for (const s of this.stolen) {
      const sx = h.x + Math.sin(s.a) * 0.9, sz = h.z + Math.cos(s.a) * 0.9;
      const a = t ? Math.atan2(t.x - sx, t.z - sz) : h.facing;
      const p = this.spawnProjectile(s.kind, sx, sz, Math.sin(a) * 24, Math.cos(a) * 24, 0, h.id, 0.4, 1.2);
      p.reflected = true;
    }
    this.stolen.length = 0;
    this.bus.emit('stolenFire', { x: h.x, z: h.z });
  }

  private stepProjectiles(dt: number): void {
    const h = this.hero;
    // украденные осколки кружат 2 с
    for (const s of this.stolen) { s.t += dt; s.a += dt * 5; }
    if (this.stolen.length && this.stolen[0].t > STOLEN_LIFE) this.stolen = this.stolen.filter((s) => s.t <= STOLEN_LIFE);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.homing && !p.reflected && !h.dead) {
        const dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz) || 1;
        const sp = Math.hypot(p.vx, p.vz);
        p.vx += ((dx / d) * sp - p.vx) * clamp(p.homing * dt, 0, 1);
        p.vz += ((dz / d) * sp - p.vz) * clamp(p.homing * dt, 0, 1);
      }
      if (p.accel) { p.vx *= 1 + p.accel * dt; p.vz *= 1 + p.accel * dt; }
      p.x += p.vx * dt; p.z += p.vz * dt;
      if (p.kind === 'censerBall') {
        // Цепи кадил катятся по мостам и рушат плиты (возрождаются через 6 с)
        const t = this.arena.tileAt(p.x, p.z);
        if (t && t.state === 1 && Math.hypot(p.x, p.z) > 3) this.arena.breakTile(t, 6, 0.35);
      }
      if (p.age >= p.life) p.alive = false;
      else if ((p.kind !== 'censerBall' && this.arena.blocked(p.x, p.z, p.r * 0.5)) || Math.abs(p.x) > 80 || Math.abs(p.z) > 80) {
        p.alive = false;
        this.bus.emit('projectileHit', { x: p.x, z: p.z, kind: p.kind });
      } else if (p.reflected && p.kind === 'censer') {
        // отбитое кадило летит в колокол хозяина: урон и +40 к оглушению
        const o = this.enemies.find((e) => e.id === p.owner && !e.dead);
        if (!o) p.alive = false;
        else {
          const dx = o.x - p.x, dz = o.z - p.z, l = Math.hypot(dx, dz) || 1;
          p.vx = (dx / l) * 18; p.vz = (dz / l) * 18;
          if (l < o.radius + p.r) {
            const sp: StrikeParams = { mult: 3, stun: 0, knockback: 0, feel: 'heavy', dirX: dx / l, dirZ: dz / l, source: 'proj', abilityId: 'reflect' };
            this.beginStrike();
            this.damageEnemy(o, sp);
            this.endStrike(sp);
            this.addStunTo(o, CENSER_RETURN_STUN);
            p.alive = false;
            this.bus.emit('censer', { kind: 'return', x: o.x, z: o.z });
          }
        }
      } else if (p.reflected) {
        for (const e of this.enemies) {
          if (!e.targetable || Math.hypot(e.x - p.x, e.z - p.z) > e.radius + p.r) continue;
          const l = Math.hypot(p.vx, p.vz) || 1;
          const sp: StrikeParams = { mult: 2.0, stun: 10, stunKind: 'stolen', knockback: 2, feel: 'medium', dirX: p.vx / l, dirZ: p.vz / l, source: 'proj', abilityId: 'reflect' };
          this.beginStrike();
          this.damageEnemy(e, sp);
          this.endStrike(sp);
          p.alive = false;
          this.bus.emit('projectileHit', { x: p.x, z: p.z, kind: p.kind });
          break;
        }
      } else if (!p.spent && !h.dead && Math.hypot(h.x - p.x, h.z - p.z) < h.radius + p.r) {
        // окно после идеального уклонения: снаряд не бьёт, а становится украденным осколком
        const stealable = STEALABLE.has(p.kind);
        const res = stealable && h.clock < h.counterUntil ? 'steal' : h.receiveAttack(p.dmg, p.vx / (Math.hypot(p.vx, p.vz) || 1), p.vz / (Math.hypot(p.vx, p.vz) || 1), 'projectile', 1.5);
        if (stealable && (res === 'steal' || res === 'perfect' || (res === 'dodge' && h.clock < h.counterUntil))) {
          p.alive = false;
          this.stolen.push({ kind: p.kind, t: 0, a: Math.atan2(p.x - h.x, p.z - h.z) });
          if (this.stolen.length > 6) this.stolen.shift();
          this.bus.emit('steal', { x: p.x, z: p.z });
        } else if (res === 'hit') {
          this.run.hitsTaken++; this.run.dmgTaken += p.dmg;
          p.alive = false;
          this.bus.emit('projectileHit', { x: p.x, z: p.z, kind: p.kind });
        } else if (res === 'perfect' || res === 'dodge') p.spent = true;
      }
      if (!p.alive) swapRemove(this.projectiles, i);
    }
  }

  addRingWave(x: number, z: number, speed: number, width: number, maxR: number, gaps: { a: number; w: number }[], dmg: number, owner: number, accel = 0): RingWave {
    const r: RingWave = { x, z, r: 0.5, speed, accel, width, maxR, gaps, dmg, hit: false, alive: true, owner };
    this.ringWaves.push(r);
    return r;
  }

  private stepRingWaves(dt: number): void {
    for (let i = this.ringWaves.length - 1; i >= 0; i--) {
      const rw = this.ringWaves[i];
      rw.speed += rw.accel * dt;
      rw.r += rw.speed * dt;
      if (!rw.hit) {
        const res = this.enemyStrike({ x: rw.x, z: rw.z, id: rw.owner, kind: 'ring' }, { k: 'ring', x: rw.x, z: rw.z, r0: Math.max(0, rw.r - rw.width / 2), r1: rw.r + rw.width / 2, gaps: rw.gaps }, rw.dmg, 4);
        if (res !== 'miss') rw.hit = true;
      }
      if (rw.r > rw.maxR) { rw.alive = false; swapRemove(this.ringWaves, i); }
    }
  }

  // ------------------------------------------------------------------ зоны урона
  addHazard(hz: Omit<Hazard, 't' | 'tickT' | 'alive'>): Hazard {
    const h: Hazard = { ...hz, t: 0, tickT: 0, alive: true };
    this.hazards.push(h);
    return h;
  }

  private stepHazards(dt: number): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hz = this.hazards[i];
      hz.t += dt;
      hz.tickT -= dt;
      if (hz.tickT <= 0) {
        hz.tickT = hz.tick;
        if (hz.hostile) {
          this.enemyStrike({ x: hz.shape.x, z: hz.shape.z, id: -1, kind: hz.kind }, hz.shape, hz.dmg, 0.5);
        } else {
          for (const e of this.enemies) {
            if (!e.targetable || !overlaps(hz.shape, e.x, e.z, e.radius)) continue;
            this.damageEnemy(e, { mult: hz.dmg, stun: 1, knockback: 0, feel: 'light', dirX: 0, dirZ: 0, source: 'ability', noResonance: true, noStagger: true, abilityId: hz.kind });
          }
        }
      }
      if (hz.t >= hz.dur) { hz.alive = false; swapRemove(this.hazards, i); }
    }
  }

  // ------------------------------------------------------------------ подбор
  dropShards(x: number, z: number, weight: number): void {
    const total = Math.max(1, Math.round(weight * this.shardPerDrop));
    const n = Math.min(8, Math.max(1, Math.round(total / 4)));
    for (let i = 0; i < n; i++) {
      const a = this.fxRng.range(0, Math.PI * 2), sp = this.fxRng.range(1.5, 4);
      this.pickups.push({ kind: 'shard', x, z, y: 0.8, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, vy: this.fxRng.range(3, 6), amount: total / n, age: 0, alive: true, magnet: false });
    }
  }

  dropPickup(kind: 'ether' | 'heal', x: number, z: number, amount: number): void {
    this.pickups.push({ kind, x, z, y: 1, vx: 0, vz: 0, vy: 5, amount, age: 0, alive: true, magnet: false });
  }

  private stepPickups(dt: number): void {
    const h = this.hero;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.age += dt;
      const dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz);
      if ((this.magnet || d < 2.6) && p.age > 0.45 && !h.dead) p.magnet = true;
      if (p.magnet) {
        const sp = 10 + p.age * 6;
        p.vx += ((dx / (d || 1)) * sp - p.vx) * Math.min(1, dt * 8);
        p.vz += ((dz / (d || 1)) * sp - p.vz) * Math.min(1, dt * 8);
        p.y += (1.0 - p.y) * Math.min(1, dt * 6);
      } else {
        p.vy -= 18 * dt;
        p.y += p.vy * dt;
        if (p.y < 0.25) { p.y = 0.25; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7; }
      }
      p.x += p.vx * dt; p.z += p.vz * dt;
      if (p.magnet && d < 0.6) {
        p.alive = false;
        if (p.kind === 'shard') this.run.shards += p.amount;
        else if (p.kind === 'ether') this.run.ether += p.amount;
        else h.hp = Math.min(h.maxHp, h.hp + h.maxHp * p.amount);
        this.bus.emit('pickup', { kind: p.kind, amount: p.amount, x: p.x, z: p.z });
        swapRemove(this.pickups, i);
      }
    }
  }

  /** Токен атаки: ограничивает число одновременных замахов рядом с героем и выстрелов. */
  requestToken(e: Enemy, kind: 'melee' | 'ranged' | 'swarm'): boolean {
    if (e.elite.length || e.isGuardian || e.isBoss) { e.token = kind; return true; }
    let n = 0;
    for (const o of this.enemies) if (o !== e && o.token === kind && !o.dead && !o.elite.length && !o.isGuardian && !o.isBoss) n++;
    const cap = kind === 'melee' ? this.meleeTokens : kind === 'swarm' ? this.swarmTokens : this.rangedTokens;
    if (n >= cap) return false;
    e.token = kind;
    return true;
  }

  /** Временная стена (цепь, колонна): укрытие на dur секунд. */
  addTempWall(x: number, z: number, r: number, dur: number): void {
    const cover = { x, z, r };
    this.arena.covers.push(cover);
    this.arena.version++;
    this.tempWalls.push({ x, z, r, t: 0, dur, cover });
  }

  private stepTempWalls(dt: number): void {
    for (let i = this.tempWalls.length - 1; i >= 0; i--) {
      const tw = this.tempWalls[i];
      tw.t += dt;
      if (tw.t < tw.dur) continue;
      const k = this.arena.covers.indexOf(tw.cover);
      if (k >= 0) this.arena.covers.splice(k, 1);
      this.arena.version++;
      swapRemove(this.tempWalls, i);
    }
  }

  /**
   * Кольцо силы героя (колокол Звонаря, план §7.4): фиолетовая волна от точки, бьёт каждого врага один раз,
   * когда фронт доходит до него.
   */
  heroRing(x: number, z: number, maxR: number, speed: number, mult: number, stun: number): void {
    const hit = new Set<number>();
    let r = 0;
    const hook = (dt: number): void => {
      r += speed * dt;
      this.beginStrike();
      for (const e of this.enemies) {
        if (!e.targetable || hit.has(e.id) || Math.hypot(e.x - x, e.z - z) - e.radius > r) continue;
        hit.add(e.id);
        const d = Math.hypot(e.x - x, e.z - z) || 1;
        this.damageEnemy(e, { mult, stun, stunKind: 'other', knockback: 4, feel: 'heavy', dirX: (e.x - x) / d, dirZ: (e.z - z) / d, source: 'ability', noResonance: true });
      }
      this.endStrike({ dirX: 0, dirZ: 1, source: 'ability' });
      if (r >= maxR) { const i = this.stepHooks.indexOf(hook); if (i >= 0) this.stepHooks.splice(i, 1); }
    };
    this.stepHooks.push(hook);
  }

  clear(): void {
    for (const tw of this.tempWalls) { const k = this.arena.covers.indexOf(tw.cover); if (k >= 0) this.arena.covers.splice(k, 1); }
    if (this.tempWalls.length) this.arena.version++;
    this.tempWalls.length = 0;
    this.candlesOut = 0;
    this.shadows.length = 0;
    this.enemies.length = 0; this.projectiles.length = 0; this.telegraphs.length = 0; this.hazards.length = 0; this.pickups.length = 0; this.ringWaves.length = 0;
    this.stepHooks.length = 0;
  }
}
