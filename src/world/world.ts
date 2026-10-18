import { EventBus } from '../core/events';
import { Rng, fxRng } from '../core/rng';
import { clamp } from '../core/math';
import { swapRemove } from '../core/pool';
import { FEEL, type FeelId } from '../data/feel';
import { RESONANCE } from '../data/player';
import type { Input } from '../input/input';
import { hitPosture, POSTURE_IMMUNE, type Actor } from './actor';
import type { Arena } from './arena';
import { computeDamage, overlaps, type Shape } from './combat';
import type { Enemy } from './enemy';
import type { Hazard, Pickup, Projectile, ProjectileKind, RingWave, Telegraph } from './entities';
import type { GameEvents } from './events';
import { Hero } from './hero';
import { RankTracker } from './rank';
import type { AbilityHost } from './abilityHost';

export interface StrikeParams {
  mult: number;
  posture: number;
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
}

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
  /** Бонус урона по сломанным (Сердце Молоха и т.п.). */
  brokenBonus = 0;
  /** Элита опустилась до 50 % HP (подкрепления, Зеркальный аффикс). */
  onEliteHalf: ((e: Enemy) => void) | null = null;

  constructor(public arena: Arena, seed: string) {
    this.rng = new Rng(seed);
    this.hero = new Hero(this);
    this.bus.on('playerHurt', () => this.rank.hurt());
    this.bus.on('perfectDodge', () => { this.rank.perfectDodge(); this.run.perfectDodges++; });
  }

  addEnemy(e: Enemy): void {
    this.enemies.push(e);
    e.onAdded(this);
    this.bus.emit('spawned', { actor: e });
  }

  get aliveEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  // ------------------------------------------------------------------ шаг
  step(dtW: number, dtH: number, input: Input): void {
    this.time += dtW;
    this.run.time += dtW;
    this.hero.update(dtH, input);
    for (const e of this.enemies) e.step(this, dtW);
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
    const heroSolid = h.state !== 'dash' && !h.dead && h.state !== 'fall';
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
    for (const e of this.enemies) {
      if (!e.targetable || hitList.has(e.id)) continue;
      if (!overlaps(shape, e.x, e.z, e.radius)) continue;
      hitList.add(e.id);
      this.damageEnemy(e, p);
      n++;
    }
    // отражённые снаряды и Искры можно отбивать — проверка снарядов
    if (p.source === 'blade') {
      for (const pr of this.projectiles) {
        if (!pr.alive || pr.reflected || pr.kind === 'ring' || pr.kind === 'wave') continue;
        if (overlaps(shape, pr.x, pr.z, pr.r) && this.abilities.canDeflect()) {
          pr.reflected = true; pr.vx = -pr.vx * 1.3; pr.vz = -pr.vz * 1.3; pr.life = 2;
        }
      }
    }
    return n;
  }

  damageEnemy(e: Enemy, p: StrikeParams): void {
    if (e.dead || !e.targetable) return;
    const h = this.hero;
    if (e.invulnerable) {
      this.bus.emit('hit', { target: e, dmg: 0, crit: false, feel: 'light', dirX: p.dirX, dirZ: p.dirZ, x: e.x, y: e.height * 0.6, z: e.z, source: p.source, shielded: true });
      return;
    }
    const perfect = (p.source === 'blade' || p.source === 'ability') && h.consumePerfectBuff();
    // Раскол: финишер/заряженный удар по уже треснувшему врагу
    const shatter = e.cracked && (!!p.finisher || p.feel === 'heavy') && p.abilityId !== 'shatter';
    const S = h.stats;
    const res = computeDamage(
      { atk: S.atk, critChance: S.critChance, critMul: S.critMul, dmgBonus: S.dmgBonus + (p.source === 'ability' ? S.abilityDmg : 0) + (e.broken ? this.brokenBonus : 0), forceCrit: perfect },
      p.mult, e.armor, e.broken, () => this.rng.next(), (perfect ? 1.3 : 1) * e.shieldMul * (p.extra ?? 1) * this.abilities.damageMulOn(e),
    );
    const before = e.hp;
    e.hp -= res.dmg;
    this.run.dmgDealt += res.dmg;
    e.onDamaged(this, res.dmg, before);
    let feel: FeelId = res.crit && p.feel === 'light' ? 'medium' : p.feel;
    let broke = false;
    if (e.posture && !e.dead) {
      // Стражи и боссы вне окна уязвимости почти не теряют стойку: ломают её окна, а не спам
      const heavy = (e.isGuardian || e.isBoss) && e.postureMul <= 1 ? 0.2 : 1;
      const pm = (perfect ? 2 : 1) * (e.shieldMul < 1 ? 0.5 : 1) * e.postureMul * heavy;
      if (hitPosture(e.posture, p.posture * pm)) {
        if (e.canBreakNow()) {
          broke = true;
          feel = 'break';
          this.breakEnemy(e, false);
        } else {
          // неудержимая атака: слом ждёт её конца
          e.posture.broken = 0; e.posture.value = 0;
          e.breakQueued = true;
        }
      }
    }
    // реакция на попадание: вспышка, пружина, отбрасывание, хитстан рядовых
    e.puppet.flash = 1;
    e.puppet.kickSpring(p.dirX, p.dirZ, FEEL[feel].spring);
    if (!e.isBoss) {
      const kb = p.knockback / Math.max(0.5, e.mass) * (e.isGuardian ? 0.1 : 1);
      e.kbX += p.dirX * kb * 2.2; e.kbZ += p.dirZ * kb * 2.2;
      if (p.launch) e.launch(p.launch);
      else if (!p.noStagger) e.interrupt(p.feel === 'light' ? 0.22 : 0.35);
    }
    if (!p.noResonance) h.addResonance(RESONANCE.perHit + (p.finisher ? RESONANCE.perFinisher - RESONANCE.perHit : 0));
    this.rank.hit(!!p.finisher);
    if (p.abilityId) this.rank.used(p.abilityId);
    else this.rank.used('blade');
    this.bus.emit('hit', { target: e, dmg: res.dmg, crit: res.crit || perfect, feel, dirX: p.dirX, dirZ: p.dirZ, x: e.x, y: e.height * 0.55, z: e.z, source: p.source, shielded: e.shieldMul < 1 });
    if (e.hp <= 0) this.killEnemy(e, p.dirX, p.dirZ, broke || p.feel === 'heavy' ? 6 : 3.5);
    else if (shatter && !broke) this.shatterEnemy(e, p.dirX, p.dirZ);
  }

  /** Слом стойки: оглушение врага и событие для реакций. Из очереди — после неудержимой атаки. */
  breakEnemy(e: Enemy, fromQueue = true): void {
    if (e.dead || !e.posture) return;
    e.breakQueued = false;
    if (fromQueue) { e.posture.value = 0; e.posture.broken = e.posture.breakDur; }
    e.onBreak();
    this.bus.emit('postureBreak', { target: e, x: e.x, z: e.z, boss: e.isBoss });
  }

  /**
   * Раскол (замена казни): трещины взрываются — доля HP цели (элита 14 %, стражи 5 %, босс 3.5 %),
   * волна осколков по соседям, Резонанс; цель выходит из слома. Мгновенных убийств нет.
   */
  shatterEnemy(e: Enemy, dirX: number, dirZ: number): void {
    if (e.dead || !e.posture) return;
    const h = this.hero, S = h.stats;
    const frac = e.isBoss ? 0.035 : e.isGuardian ? 0.05 : 0.14;
    const dmg = Math.max(1, Math.round(e.maxHp * frac * (1 + S.dmgBonus) * e.shieldMul));
    const before = e.hp;
    e.hp -= dmg;
    this.run.dmgDealt += dmg;
    this.run.shatters++;
    // стойка восстанавливается полностью и 5 с неуязвима — следующий слом надо заработать заново
    e.posture.broken = 0;
    e.posture.value = e.posture.max;
    e.posture.immune = POSTURE_IMMUNE;
    e.onDamaged(this, dmg, before);
    e.onShattered(this);
    this.rank.shatter();
    h.addResonance(RESONANCE.perShatter);
    if (S.shatterHeal > 0) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * S.shatterHeal);
    this.bus.emit('shatter', { target: e, x: e.x, y: e.height * 0.55, z: e.z, boss: e.isBoss, dmg });
    this.bus.emit('hit', { target: e, dmg, crit: true, feel: 'break', dirX, dirZ, x: e.x, y: e.height * 0.7, z: e.z, source: 'blade' });
    // осколки ранят соседей
    for (const o of this.enemies) {
      if (o === e || !o.targetable) continue;
      const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot(dx, dz);
      if (d > 3.4 + o.radius) continue;
      this.damageEnemy(o, { mult: 1.6, posture: 6, knockback: 4, feel: 'medium', dirX: dx / (d || 1), dirZ: dz / (d || 1), source: 'ability', noResonance: true, abilityId: 'shatter' });
    }
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
    const res = h.receiveAttack(dmg, dx, dz, src.kind, kb);
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
    const t: Telegraph = { shape, t: 0, dur: Math.max(0.05, dur), white, alive: true, fade: 0, shadow };
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

  private stepProjectiles(dt: number): void {
    const h = this.hero;
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
      } else if (p.reflected) {
        for (const e of this.enemies) {
          if (!e.targetable || Math.hypot(e.x - p.x, e.z - p.z) > e.radius + p.r) continue;
          const l = Math.hypot(p.vx, p.vz) || 1;
          this.damageEnemy(e, { mult: 2.0, posture: 10, knockback: 2, feel: 'medium', dirX: p.vx / l, dirZ: p.vz / l, source: 'proj', abilityId: 'reflect' });
          p.alive = false;
          this.bus.emit('projectileHit', { x: p.x, z: p.z, kind: p.kind });
          break;
        }
      } else if (!p.spent && !h.dead && Math.hypot(h.x - p.x, h.z - p.z) < h.radius + p.r) {
        const res = h.receiveAttack(p.dmg, p.vx / (Math.hypot(p.vx, p.vz) || 1), p.vz / (Math.hypot(p.vx, p.vz) || 1), 'projectile', 1.5);
        if (res === 'hit') {
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
            this.damageEnemy(e, { mult: hz.dmg, posture: 1, knockback: 0, feel: 'light', dirX: 0, dirZ: 0, source: 'ability', noResonance: true, noStagger: true, abilityId: hz.kind });
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

  clear(): void {
    this.enemies.length = 0; this.projectiles.length = 0; this.telegraphs.length = 0; this.hazards.length = 0; this.pickups.length = 0; this.ringWaves.length = 0;
    this.stepHooks.length = 0;
  }
}
