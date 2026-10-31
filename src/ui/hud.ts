import { clamp } from '../core/math';
import { fxRng } from '../core/rng';
import { Ease } from '../core/ease';
import { RANKS } from '../data/player';
import { ABILITIES, type AbilityId } from '../data/abilities';
import type { Input } from '../input/input';
import type { Abilities } from '../world/abilities';
import type { Enemy } from '../world/enemy';
import { STUN_IMMUNE } from '../world/actor';
import type { World } from '../world/world';
import { drawTitle, measureTitle, type TitleOpts } from './font';
import { FX } from '../render/fx';
import { FONT_BODY, FONT_TECH } from './fonts';
import { drawIcon, type IconId } from './icons';
import { UI } from './theme';

interface DmgNum { x: number; y: number; z: number; v: number; crit: boolean; shield: boolean; t: number; dx: number; key: number; big: boolean }
/** fold — титр этапа: уходя, сворачивается в подпись внизу слева; строка — её подстрочник. */
interface Banner { text: string; sub?: string; t: number; dur: number; color: NonNullable<TitleOpts['color']>; size: number; fold?: string }

/**
 * Подпись этапа внизу слева (план ×100, H; флаг title): титр этапа на «вдохе» перед первой волной сворачивается
 * сюда за fold с; волны пишут строку сюда же, а не титром над боем — центр экрана принадлежит бою. Держится hold с,
 * гаснет за out с. name, sub — кегль названия и строк (×масштаб HUD, не меньше min px).
 */
export const CAPTION = { fold: 0.55, hold: 5, out: 0.8, name: 17, sub: 11, min: [11, 9] as const, glow: 0.6 };
/** Короткая надпись в мире у цели («РАСКОЛ», «В БЕЗДНУ»), над героем — не дольше 0.5 с. */
interface WorldText { text: string; color: string; x: number; y: number; z: number; t: number; dur: number }

/**
 * Карточка тренировки (этап 4.5, A3): на небольшом экране — только активное упражнение и его текущий шаг;
 * полный список — в паузе. performed — серия выполнена, но не попала.
 */
export interface TrainingCard {
  index: number; total: number; done: number; name: string; step: string; stepIdx: number; steps: number;
  stepDone: boolean[]; performed: boolean; allDone: boolean; rules: string;
}

export interface HudFrame {
  world: World;
  abilities: Abilities;
  input: Input;
  project: (x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }) => void;
  wave: { index: number; total: number } | null;
  boss: Enemy | null;
  bossName: string;
  bossPhases: number[];
  bossPhase: number;
  guardian: Enemy | null;
  stageLabel: string;
  stageName: string;
  showTouch: boolean;
  /** Казнь босса доступна: кнопка атаки горит «ДОБИТЬ» (план §8.3.2). */
  execute?: boolean;
  fps: number;
  showFps: boolean;
  /** Отладка навигации (?nav): стрелки поля потоков и непроходимые клетки вокруг героя. */
  debugNav?: boolean;
  /** Тренировочный зал: памятка приёмов слева. */
  /** Тренировочный зал: активное упражнение и шаг. */
  training?: TrainingCard;
}

/** Кто целится издалека — им шевроны у края экрана. */
const CHEVRON_KINDS = new Set(['eye', 'spiker', 'acolyte']);
const RANK_COLOR: Record<string, NonNullable<TitleOpts['color']>> = { D: 'steel', C: 'white', B: 'gold', A: 'gold', S: 'ether', SS: 'void' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/**
 * Боевой HUD — отдельный Canvas 2D поверх WebGL (Tech §22): тонкая золотая филигрань, ромбы и медальоны,
 * цифры — техно-гротеском, заголовки — антиквой. Весь UI рисуется кодом.
 */
/** Подсказка действия в сцене: at — место действия в NDC (−1..1), t — сколько уже ждёт (с). */
export interface ScenePrompt { text: string; sub?: string; at: { x: number; y: number } | null; t: number }

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private w = 1; private h = 1; private dpr = 1;
  private nums: DmgNum[] = [];
  /** Где этим кадром нарисованы звёзды оглушения босса (откуда они срываются к голове). */
  private starSlots: { x: number; y: number }[] = [];
  /** Звёзды, летящие с HUD к голове оглушённого (план §5.5). */
  private starFly: { t: number; e: Enemy; from: { x: number; y: number }[]; r: number }[] = [];
  private readonly headTmp = { x: 0, y: 0, z: 0 };
  /** Очередь титулов: следующий ждёт ухода текущего (план §5.7). */
  private banners: Banner[] = [];
  /** Подпись этапа внизу слева: подстрочник, строка волны, время с появления. */
  private caption: { sub: string; wave: string; t: number } | null = null;
  /** Где этим кадром стоит название в подписи (цель сворачивания титра). */
  private capName = { x: 0, y: 0, size: 12 };
  private worldTexts: WorldText[] = [];
  /** Нижняя граница верхнего HUD этого кадра — титулы ниже неё. */
  private topEdge = 0;
  /** Кольцо готовности способности: время с момента готовности по слотам. */
  private readyT: Record<'q' | 'e' | 'r', number> = { q: 9, e: 9, r: 9 };
  /** Руны Резонанса: время с момента, как зажглась каждая. */
  private runeLit = [9, 9, 9, 9, 9];
  private lastRes = 0;
  private sub: { text: string; t: number; speaker: string } | null = null;
  private hint: { text: string; t: number; minFont: number } | null = null;
  /** Поверх сцены режиссёра: заполнение пропуска и кольцо касания-тайминга. */
  private cine: { skip: number; tap: { k: number; hit: boolean } | null; prompt: ScenePrompt | null } = { skip: 0, tap: null, prompt: null };
  private hpTrail = 1; private hpTrailDelay = 0; private lastHp = 1;
  private bossTrail = 1; private bossTrailDelay = 0; private lastBossHp = 1;
  private rankStamp = 0; private rankLast = 'D';
  private ultPulse = 0;
  private hurtFlash = 0;
  private time = 0;
  safe = { l: 0, r: 0, t: 0, b: 0 };
  scale = 1;
  visible = true;
  subtitleScale = 1;
  private tmp = { x: 0, y: 0, visible: false };

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    this.scale = clamp(Math.min(w / 1100, h / 620), 0.62, 1.25);
  }

  // ------------------------------------------------------------------ события
  /**
   * Цифра урона. key ≥ 0 — сливать попадания по одной цели за взмах (0.3 с) в одну цифру; big — крупно (Страж, босс).
   */
  damageNumber(x: number, y: number, z: number, v: number, crit: boolean, shield: boolean, key = -1, big = false): void {
    if (v <= 0 && !shield) return;
    if (key >= 0) {
      const prev = this.nums.find((n) => n.key === key && n.t < 0.3);
      if (prev) { prev.v += v; prev.crit ||= crit; prev.t = Math.min(prev.t, 0.05); prev.x = x; prev.z = z; return; }
    }
    this.nums.push({ x, y, z, v, crit, shield, t: 0, dx: fxRng.spread(15), key, big });
    if (this.nums.length > 48) this.nums.shift();
  }
  /** Надпись в мире у цели, мелко (план §5.7, п. 3). hero — над героем: 0.5 с. */
  flashText(text: string, color: string, x: number, y: number, z: number, hero = false): void {
    this.worldTexts.push({ text, color, x, y, z, t: 0, dur: hero ? 0.5 : 0.8 });
    if (this.worldTexts.length > 6) this.worldTexts.shift();
  }
  subtitle(text: string, speaker: string): void { this.sub = { text, t: 0, speaker }; }
  showHint(text: string, minFont = 0): void { this.hint = { text, t: 0, minFont }; }
  cineOverlay(skip: number, tap: { k: number; hit: boolean } | null, prompt: ScenePrompt | null = null): void { this.cine.skip = skip; this.cine.tap = tap; this.cine.prompt = prompt; }
  pulseUlt(): void { this.ultPulse = 1; this.readyT.r = 0; }
  /** Способность снова готова: вокруг иконки за 0.25 с замыкается кольцо. */
  abilityReady(slot: 'q' | 'e' | 'r'): void { this.readyT[slot] = 0; }
  waveBanner(index: number, total: number): void {
    const text = `Волна ${ROMAN[index] ?? index + 1}`, sub = index + 1 === total ? 'финальная' : undefined;
    if (FX.title) { this.caption = { sub: this.caption?.sub ?? '', wave: `${text} из ${ROMAN[total - 1] ?? total}${sub ? ` · ${sub}` : ''}`, t: this.caption ? Math.min(this.caption.t, 0.25) : 0 }; return; }
    this.pushBanner({ text, sub, t: 0, dur: 1.6, color: 'gold', size: 30 });
  }
  /**
   * Титр этапа (план ×100, H): как bigBanner, но, уходя, сворачивается в подпись внизу слева (caption — её
   * подстрочник). Без флага title — обычный титр.
   */
  stageTitle(text: string, sub: string | undefined, caption: string, dur = 2.6, size = 58): void {
    this.pushBanner({ text, sub, t: 0, dur, color: 'gold', size: size * 0.75, fold: FX.title ? caption : undefined });
  }
  /** Начать сворачивание титра этапа сейчас (интро пропущено — волна вот-вот). */
  foldTitle(): void {
    const b = this.banners[0];
    if (b?.fold !== undefined) b.t = Math.max(b.t, b.dur - CAPTION.fold);
  }
  /** Титул: на 25 % меньше прежнего и выше боя (0.12–0.16 высоты, под верхним HUD). */
  bigBanner(text: string, sub: string | undefined, color: Banner['color'], dur = 2.4, size = 56): void {
    this.pushBanner({ text, sub, t: 0, dur, color, size: size * 0.75 });
  }
  /** Очередь: новый титул ждёт ухода текущего; текущий, если за ним очередь, сразу начинает уходить. */
  private pushBanner(b: Banner): void {
    const cur = this.banners[0];
    if (cur) cur.t = Math.max(cur.t, cur.dur - (cur.fold !== undefined ? CAPTION.fold : 0.3));
    this.banners.push(b);
    if (this.banners.length > 3) this.banners.splice(1, 1);
  }
  clear(): void { this.nums = []; this.banners = []; this.caption = null; this.worldTexts = []; this.sub = null; this.hint = null; this.hpTrail = 1; this.lastHp = 1; }

  // ------------------------------------------------------------------ кадр
  draw(dt: number, f: HudFrame): void {
    this.time += dt;
    this.readyT.q += dt; this.readyT.e += dt; this.readyT.r += dt;
    for (let i = 0; i < 5; i++) this.runeLit[i] += dt;
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    this.drawCineOverlay();
    if (!f) return;
    const s = this.scale;
    const L = 20 * s + this.safe.l, R = this.w - 20 * s - this.safe.r, T = 14 * s + this.safe.t, B = this.h - 16 * s - this.safe.b;
    // сцена со скрытым HUD: остаются только титры и реплики
    // подсказки ждут конца сцены — не висят поверх kill-cam
    if (!this.visible) { this.drawCaption(dt, f, L, B); this.drawBanners(dt); this.drawSubtitle(dt, s, L, T, false); return; }
    g.globalAlpha = 0.95;
    this.drawWorldMarks(f);
    this.drawChevrons(f);
    if (f.debugNav) this.drawNav(f);
    this.drawHeroPanel(f, L, T, s);
    if (f.boss) this.drawBossBar(s, T, f.boss, f.bossName, f.bossPhases, f.bossPhase);
    else if (f.guardian && !f.guardian.dead) this.drawBossBar(s, T, f.guardian, f.guardian.def.name, [], 0);
    else this.drawStageTop(f, s, T);
    this.topEdge = T + (f.boss || (f.guardian && !f.guardian.dead) ? 92 : 52) * s;
    this.drawPause(R, T, s);
    this.drawRank(f, R, s);
    this.drawAbilities(f, R, B, s);
    if (f.showTouch) this.drawTouch(f.input, s);
    if (f.execute) this.drawExecute(f, s);
    this.drawBranchHint(dt, f, s);
    if (f.training) this.drawTraining(f.training, L, s);
    this.drawNums(dt, f);
    this.drawWorldTexts(dt, f);
    this.drawStarFly(dt, f);
    this.drawCaption(dt, f, L, B);
    this.drawBanners(dt);
    this.drawSubtitle(dt, s, L, T);
    if (f.showFps) { g.fillStyle = UI.dim; g.font = `600 ${Math.round(11 * s)}px ${FONT_TECH}`; g.textAlign = 'left'; g.fillText(`${f.fps.toFixed(0)} FPS`, L, B - 70 * s); }
    g.globalAlpha = 1;
  }

  /** Кадр вне боя (пролог, план §8.2): реплики, подсказки, баннеры, пропуск; input — показать сенсорное управление. */
  drawScene(dt: number, input: Input | null, touchAlpha = 0.95): void {
    this.time += dt;
    const g = this.g, s = this.scale;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    this.drawCineOverlay();
    const L = 20 * s + this.safe.l, T = 14 * s + this.safe.t;
    g.globalAlpha = touchAlpha;
    if (input) this.drawTouch(input, s);
    g.globalAlpha = 0.95;
    this.drawBanners(dt);
    this.drawSubtitle(dt, s, L, T);
    g.globalAlpha = 1;
  }

  /** «ДОБИТЬ»: пульсирующая надпись и фиолетовое кольцо вокруг кнопки атаки. */
  private drawExecute(f: HudFrame, s: number): void {
    const g = this.g, a = 0.75 + 0.25 * Math.sin(this.time * 8);
    g.save();
    g.globalAlpha = a;
    g.shadowColor = '#B794FF'; g.shadowBlur = 18 * s;
    this.text('ДОБИТЬ', this.w / 2, this.h * 0.7, 30 * s, '#F1E8FF', 'bodyBold', 'center');
    g.shadowBlur = 0;
    this.text(f.showTouch ? 'кнопка атаки' : 'ЛКМ / J', this.w / 2, this.h * 0.7 + 26 * s, 12 * s, UI.void, 'tech', 'center');
    const btn = f.showTouch ? f.input.buttons.find((b) => b.id === 'attack') : undefined;
    if (btn) {
      g.strokeStyle = '#B794FF'; g.lineWidth = 3 * s; g.shadowColor = '#8B5CF6'; g.shadowBlur = 14 * s;
      g.beginPath(); g.arc(btn.x, btn.y, btn.r * (1.18 + 0.06 * Math.sin(this.time * 8)), 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }

  /** Пропуск сцены удержанием атаки — кольцо заполняется; касание-тайминг — сходящееся кольцо. */
  private drawCineOverlay(): void {
    const g = this.g, s = this.scale, c = this.cine;
    if (c.skip > 0.02) {
      const x = this.w - 40 * s - this.safe.r, y = this.h - 34 * s - this.safe.b, r = 11 * s;
      g.save();
      g.lineWidth = 2 * s;
      g.strokeStyle = 'rgba(227,195,126,0.3)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = UI.goldHi;
      g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, c.skip)); g.stroke();
      g.fillStyle = UI.text; g.font = `600 ${Math.round(11 * s)}px ${FONT_TECH}`; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText('ПРОПУСК', x - r - 8 * s, y);
      g.restore();
    }
    if (c.prompt) this.drawScenePrompt(c.prompt);
    if (c.tap) {
      const x = this.w / 2, y = this.h * 0.42, r0 = 26 * s, r = r0 * (1 + 2.2 * (1 - c.tap.k));
      g.save();
      g.lineWidth = 2.5 * s;
      g.strokeStyle = c.tap.hit ? '#F1E8FF' : 'rgba(183,148,255,0.9)';
      g.shadowColor = '#8B5CF6'; g.shadowBlur = 12 * s;
      g.beginPath(); g.arc(x, y, r0, 0, Math.PI * 2); g.stroke();
      if (!c.tap.hit) { g.globalAlpha = 0.5 + 0.5 * c.tap.k; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
      g.restore();
    }
  }

  /**
   * Подсказка необязательного действия в сцене (ТЗ §14): кольцо Пустоты на месте действия (рукоять клинка)
   * дышит и расходится волной; под ним — что сделать и как. Появляется за 0.3 с, не закрывает предмет.
   */
  private drawScenePrompt(p: ScenePrompt): void {
    const g = this.g, s = this.scale, a = Math.min(1, p.t / 0.3);
    const x = p.at ? (p.at.x * 0.5 + 0.5) * this.w : this.w / 2, y = p.at ? (0.5 - p.at.y * 0.5) * this.h : this.h * 0.6;
    const r0 = 15 * s, beat = 0.5 + 0.5 * Math.sin(p.t * 5);
    g.save();
    g.globalAlpha = a;
    g.lineWidth = 2 * s;
    g.strokeStyle = 'rgba(183,148,255,0.95)';
    g.shadowColor = '#8B5CF6'; g.shadowBlur = 10 * s;
    g.beginPath(); g.arc(x, y, r0 * (1 + 0.12 * beat), 0, Math.PI * 2); g.stroke();
    // волна раз в 1.2 с: место действия видно и боковым зрением
    const wave = (p.t % 1.2) / 1.2;
    g.globalAlpha = a * (1 - wave) * 0.8;
    g.beginPath(); g.arc(x, y, r0 * (1 + 1.6 * wave), 0, Math.PI * 2); g.stroke();
    g.globalAlpha = a; g.shadowBlur = 0;
    // подпись — сбоку, в сторону от центра кадра: не закрывает клинок и героя рядом с ним
    const side = x < this.w / 2 ? -1 : 1, tx = x + side * (r0 + 12 * s);
    g.textAlign = side < 0 ? 'right' : 'left'; g.textBaseline = 'middle';
    g.fillStyle = UI.goldHi; g.font = `600 ${Math.round(16 * s)}px ${FONT_TECH}`;
    g.fillText(p.text.toUpperCase(), tx, y - 7 * s);
    if (p.sub) { g.fillStyle = UI.text; g.font = `500 ${Math.round(13 * s)}px ${FONT_BODY}`; g.fillText(p.sub, tx, y + 11 * s); }
    g.restore();
  }

  // ------------------------------------------------------------------ примитивы
  private diamond(cx: number, cy: number, r: number, fill?: string | CanvasGradient, stroke?: string, lw = 1.2): void {
    const g = this.g;
    g.beginPath();
    g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
  }

  /** Острая семиконечная звезда Литургии (как печати на полу). */
  private star7(cx: number, cy: number, r: number, fill?: string, stroke?: string, lw = 1, rot = 0): void {
    const g = this.g;
    g.beginPath();
    for (let i = 0; i < 14; i++) {
      const rr = i % 2 ? r * 0.45 : r, a = (i / 14) * Math.PI * 2 + rot;
      const x = cx + Math.sin(a) * rr, y = cy - Math.cos(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
  }

  /**
   * Шкала оглушения (план §5.5): семь звёзд загораются по мере заполнения. Пробуждение — серые в золотом
   * кольце-замке (кольцо тает к концу 5 с); очередь за неудержимой атакой — все горят и пульсируют;
   * оглушён — пустые гнёзда (звёзды кружат над головой).
   */
  private stunStars(cx: number, cy: number, r: number, gap: number, e: Enemy, slots?: { x: number; y: number }[]): void {
    const st = e.stun!, g = this.g;
    const x0 = cx - gap * 3;
    const lit = st.stunned > 0 ? 0 : (st.value / st.max) * 7;
    const locked = st.immune > 0 && st.stunned <= 0;
    const pulse = e.stunQueued ? 0.75 + 0.25 * Math.sin(this.time * 14) : 1;
    for (let i = 0; i < 7; i++) {
      const x = x0 + i * gap;
      slots?.push({ x, y: cy });
      if (locked) { this.star7(x, cy, r, '#3d424b', 'rgba(140,148,160,0.8)', 1); continue; }
      const f = clamp(lit - i, 0, 1);
      this.star7(x, cy, r, 'rgba(10,13,18,0.85)', 'rgba(227,195,126,0.6)', 1);
      if (f <= 0) continue;
      g.save();
      g.globalAlpha *= (0.3 + 0.7 * f) * pulse;
      if (f >= 1) { g.shadowColor = UI.glowGold; g.shadowBlur = r * 1.6; }
      this.star7(x, cy, r * (0.7 + 0.3 * f), f >= 1 ? '#fff1cc' : UI.goldHi);
      g.restore();
    }
    if (!locked) return;
    // кольцо-замок вокруг ряда: золотая часть тает вместе с пробуждением
    const rad = r * 1.45, x1 = x0 - gap * 0.55, x2 = x0 + gap * 6.55;
    const ring = (): void => {
      g.beginPath();
      g.moveTo(cx, cy - rad); g.lineTo(x2 - rad, cy - rad); g.arc(x2 - rad, cy, rad, -Math.PI / 2, Math.PI / 2);
      g.lineTo(x1 + rad, cy + rad); g.arc(x1 + rad, cy, rad, Math.PI / 2, Math.PI * 1.5); g.closePath();
    };
    const len = 2 * (x2 - x1 - 2 * rad) + 2 * Math.PI * rad;
    g.save();
    g.lineWidth = Math.max(1, r * 0.25);
    g.strokeStyle = 'rgba(227,195,126,0.25)'; ring(); g.stroke();
    g.strokeStyle = UI.goldHi; g.setLineDash([len * (st.immune / STUN_IMMUNE), len]); ring(); g.stroke();
    g.restore();
    this.diamond(x1 - r * 0.2, cy, r * 0.75, '#10151c', UI.goldHi, 1);
  }

  /** Оглушение Стража или босса: звёзды срываются с HUD и улетают к голове. */
  launchStunStars(e: Enemy): void {
    if (!this.starSlots.length) return;
    this.starFly.push({ t: 0, e, from: this.starSlots.map((p) => ({ ...p })), r: 7.5 * this.scale });
  }

  private drawStarFly(dt: number, f: HudFrame): void {
    if (!this.starFly.length) return;
    const g = this.g, t = this.tmp, s = this.scale, DUR = 0.45;
    for (const fl of this.starFly) {
      fl.t += dt;
      fl.e.headPoint(this.headTmp);
      f.project(this.headTmp.x, this.headTmp.y, this.headTmp.z, t);
      if (!t.visible) continue;
      fl.from.forEach((p, i) => {
        const u = clamp((fl.t - i * 0.025) / DUR, 0, 1);
        if (u <= 0 || u >= 1) return;
        const e = Ease.inOutQuad(u);
        const x = p.x + (t.x - p.x) * e, y = p.y + (t.y - p.y) * e - Math.sin(u * Math.PI) * 50 * s;
        g.save();
        g.globalAlpha = u > 0.8 ? (1 - u) / 0.2 : 1;
        g.shadowColor = UI.glowGold; g.shadowBlur = 10 * s;
        this.star7(x, y, fl.r * (1 + Math.sin(u * Math.PI) * 0.5), '#fff1cc', undefined, 1, u * 6);
        g.restore();
      });
    }
    this.starFly = this.starFly.filter((fl) => fl.t < DUR + 0.2);
  }

  private text(t: string, x: number, y: number, size: number, color: string, font: 'tech' | 'body' | 'bodyBold' = 'tech', align: CanvasTextAlign = 'left'): number {
    const g = this.g;
    g.font = font === 'tech' ? `600 ${Math.round(size)}px ${FONT_TECH}` : `${font === 'bodyBold' ? 700 : 400} ${Math.round(size)}px ${FONT_BODY}`;
    g.textAlign = align;
    g.lineWidth = Math.max(2, size * 0.18); g.strokeStyle = 'rgba(3,5,8,0.85)'; g.lineJoin = 'round';
    g.strokeText(t, x, y);
    g.fillStyle = color; g.fillText(t, x, y);
    return g.measureText(t).width;
  }

  /**
   * Готическая полоса: скошенные концы, тёмное стекло, градиент заливки, «след», засечки-деления,
   * тонкая золотая рамка с ромбами-заклёпками на концах.
   */
  private gothicBar(x: number, y: number, w: number, h: number, frac: number, c0: string, c1: string, trail = -1, ticks = 0, frame = true, shimmer = false): void {
    const g = this.g, k = h * 0.9;
    const path = (ww: number) => { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + k, y); g.lineTo(x + ww, y); g.lineTo(x + ww - k, y + h); g.closePath(); };
    g.fillStyle = 'rgba(4,7,11,0.82)'; path(w); g.fill();
    if (trail > frac) { g.fillStyle = 'rgba(240,226,200,0.55)'; path(Math.max(k, w * trail)); g.fill(); }
    if (frac > 0) {
      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.16, c1); grad.addColorStop(0.55, c0); grad.addColorStop(1, c0);
      g.fillStyle = grad; path(Math.max(k, w * frac)); g.fill();
      if (shimmer) {
        const sx = x + ((this.time * 0.45) % 1.4 - 0.2) * w;
        const sg = g.createLinearGradient(sx - 30, 0, sx + 30, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.35)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        g.save(); path(Math.max(k, w * frac)); g.clip(); g.fillStyle = sg; g.fillRect(x, y, w, h); g.restore();
      }
    }
    if (ticks > 0) {
      g.strokeStyle = 'rgba(3,5,8,0.7)'; g.lineWidth = 1;
      for (let i = 1; i < ticks; i++) { const tx = x + (w - k) * (i / ticks) + k * 0.5; g.beginPath(); g.moveTo(tx + k * 0.25, y + 1); g.lineTo(tx - k * 0.25, y + h - 1); g.stroke(); }
    }
    if (frame) {
      g.strokeStyle = 'rgba(227,195,126,0.85)'; g.lineWidth = 1; path(w); g.stroke();
      g.strokeStyle = 'rgba(227,195,126,0.25)'; g.beginPath(); g.moveTo(x + k - 2, y - 3); g.lineTo(x + w + 6, y - 3); g.stroke();
      this.diamond(x + w + 6, y - 3, 2.2, UI.goldHi);
    }
  }

  // ------------------------------------------------------------------ герой
  private drawHeroPanel(f: HudFrame, L: number, T: number, s: number): void {
    const g = this.g, h = f.world.hero;
    const er = 25 * s, ex = L + er, ey = T + er + 2 * s;
    // медальон: двойная золотая рамка, тёмное стекло, визор Пилота
    const glass = g.createRadialGradient(ex, ey - er * 0.3, 0, ex, ey, er);
    glass.addColorStop(0, 'rgba(36,46,60,0.95)'); glass.addColorStop(1, 'rgba(6,9,13,0.95)');
    this.diamond(ex, ey, er, glass, UI.gold, 1.6);
    this.diamond(ex, ey, er * 0.8, undefined, 'rgba(227,195,126,0.45)', 1);
    g.save();
    g.translate(ex, ey);
    g.fillStyle = '#10151c';
    g.beginPath(); g.moveTo(0, -er * 0.55); g.lineTo(er * 0.33, -er * 0.05); g.lineTo(er * 0.2, er * 0.45); g.lineTo(-er * 0.2, er * 0.45); g.lineTo(-er * 0.33, -er * 0.05); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(227,195,126,0.7)'; g.lineWidth = 1; g.stroke();
    const glow = 0.55 + h.resonance / 220 + (h.eclipse ? 0.4 : 0);
    g.shadowColor = UI.glowVoid; g.shadowBlur = 8 * s;
    g.fillStyle = `rgba(225,210,255,${Math.min(1, glow)})`;
    g.beginPath(); g.moveTo(-er * 0.24, -er * 0.02); g.lineTo(er * 0.24, -er * 0.02); g.lineTo(er * 0.14, er * 0.08); g.lineTo(-er * 0.14, er * 0.08); g.closePath(); g.fill();
    g.restore();

    // HP: основная падает сразу, «след» догоняет через 0.4 с (GDD §15.9)
    const frac = clamp(h.hp / h.maxHp, 0, 1);
    if (frac < this.lastHp) { this.hpTrailDelay = 0.4; this.hurtFlash = 1; }
    this.lastHp = frac;
    if (this.hpTrailDelay > 0) this.hpTrailDelay -= 1 / 60; else this.hpTrail += (frac - this.hpTrail) * 0.12;
    if (this.hpTrail < frac) this.hpTrail = frac;
    this.hurtFlash = Math.max(0, this.hurtFlash - 1 / 20);
    const bx = ex + er + 10 * s, bw = 236 * s, bh = 13 * s, by = ey - bh - 4 * s;
    const lowPulse = frac < 0.25 ? 0.65 + 0.35 * Math.sin(this.time * 8) : 1;
    g.globalAlpha = 0.95 * lowPulse;
    this.gothicBar(bx, by, bw, bh, frac, '#9e1420', this.hurtFlash > 0 ? '#ffffff' : '#ff5a64', this.hpTrail, 10);
    g.globalAlpha = 0.95;
    drawIcon(g, 'heart', bx + bw + 20 * s, by + bh * 0.5, 5.5 * s, UI.redHi, 'rgba(255,60,70,0.5)', true);
    this.text(`${Math.ceil(h.hp)}`, bx + bw + 30 * s, by + bh * 0.85, 13 * s, UI.ivory);

    // Резонанс (сила Пустоты — фиолетовая)
    const res = h.eclipse ? (h.eclipseUntil - h.clock) / 6 : h.resonance / 100;
    const full = h.resonance >= 100 || h.eclipse;
    this.gothicBar(bx - 5 * s, ey + 3 * s, bw * 0.82, 7 * s, clamp(res, 0, 1), '#5b3fb8', full ? '#e8dcff' : '#b794ff', -1, 4, true, full);
    // руны на кромке полосы загораются каждые 20 % (план §5.7, п. 7) — вспыхивают в момент зажигания
    const resNow = clamp(h.resonance / 100, 0, 1);
    for (let i = 0; i < 5; i++) {
      const at = (i + 1) / 5 - 1e-6, lit = resNow >= at || h.eclipse;
      if (resNow >= at && this.lastRes < at) this.runeLit[i] = 0;
      const pop = Math.max(0, 1 - this.runeLit[i] / 0.3);
      const rx = bx - 5 * s + bw * 0.82 * ((i + 0.5) / 5), ry = ey + 3 * s;
      g.save();
      if (lit) { g.shadowColor = UI.glowVoid; g.shadowBlur = (4 + pop * 8) * s; }
      this.diamond(rx, ry, (2.3 + pop * 1.6) * s, lit ? '#e8dcff' : '#1b1530', lit ? '#b794ff' : 'rgba(139,92,246,0.45)', 1);
      g.restore();
    }
    this.lastRes = resNow;
    if (full && !h.eclipse) {
      g.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 6);
      this.text('R', bx + bw * 0.82 + 4 * s, ey + 10.5 * s, 11 * s, '#e8dcff', 'bodyBold');
      g.globalAlpha = 0.95;
    }
    // заряды рывка — звёздная бирюза
    for (let i = 0; i < h.stats.dashCharges; i++) {
      const cx = bx + 7 * s + i * 15 * s, cy = ey + 22 * s;
      const has = i < h.dashCharges;
      this.diamond(cx, cy, 5 * s, has ? UI.star : 'rgba(20,28,38,0.85)', UI.gold, 1);
      if (has) { g.save(); g.shadowColor = UI.glowStar; g.shadowBlur = 8 * s; this.diamond(cx, cy, 2.2 * s, '#ffffff'); g.restore(); }
    }
  }

  // ------------------------------------------------------------------ верх
  private drawStageTop(f: HudFrame, s: number, T: number): void {
    const g = this.g, cx = this.w / 2;
    g.save();
    g.globalAlpha = 0.85;
    const label = `${f.stageLabel} · ${f.stageName}`;
    const size = 13 * s;
    const w = measureTitle(label, size, 0.1);
    drawTitle(g, label, cx, T + 2 * s, size, { align: 'center', color: 'gold', glow: 0.35, spacing: 0.1 });
    // орнамент: линии с ромбами
    g.strokeStyle = 'rgba(227,195,126,0.55)'; g.lineWidth = 1;
    const ly = T + 9 * s;
    for (const sgn of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + sgn * (w / 2 + 10 * s), ly); g.lineTo(cx + sgn * (w / 2 + 46 * s), ly); g.stroke();
      this.diamond(cx + sgn * (w / 2 + 50 * s), ly, 2.5 * s, UI.goldHi);
    }
    if (f.wave) {
      const n = f.wave.total, gap = 14 * s, y = T + 27 * s;
      const x0 = cx - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        const done = i < f.wave.index, cur = i === f.wave.index;
        this.diamond(x0 + i * gap, y, (cur ? 5 : 4) * s, done ? UI.goldHi : cur ? UI.star : 'rgba(20,28,38,0.85)', UI.gold, 1);
      }
      this.text(`ВОЛНА ${f.wave.index + 1}/${n}`, cx, y + 17 * s, 10 * s, UI.dim, 'tech', 'center');
    }
    g.restore();
  }

  private drawPause(R: number, T: number, s: number): void {
    const cx = R - 16 * s, cy = T + 16 * s;
    this.diamond(cx, cy, 16 * s, 'rgba(8,11,16,0.7)', UI.gold, 1.2);
    this.diamond(cx, cy, 12.5 * s, undefined, 'rgba(227,195,126,0.35)', 1);
    drawIcon(this.g, 'pause', cx, cy, 6 * s, UI.goldHi, UI.none, true);
  }

  private drawBossBar(s: number, T: number, boss: Enemy, name: string, phases: number[], phase: number): void {
    const g = this.g;
    const w = Math.min(600 * s, this.w * 0.52), x = this.w / 2 - w / 2, y = T + 30 * s;
    drawTitle(g, name, this.w / 2, T, 16 * s, { align: 'center', color: 'hunger', glow: 0.5, spacing: 0.14 });
    const frac = clamp(boss.hp / boss.maxHp, 0, 1);
    if (frac < this.lastBossHp) this.bossTrailDelay = 0.4;
    this.lastBossHp = frac;
    if (this.bossTrailDelay > 0) this.bossTrailDelay -= 1 / 60; else this.bossTrail += (frac - this.bossTrail) * 0.08;
    if (this.bossTrail < frac) this.bossTrail = frac;
    this.gothicBar(x, y, w, 13 * s, frac, '#8a111c', '#ff4a57', this.bossTrail, 20, false);
    // филигрань: золотые кронштейны и ромбы на концах
    g.strokeStyle = UI.gold; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x - 12 * s, y + 6.5 * s); g.lineTo(x + 2 * s, y - 4 * s); g.lineTo(x + w + 6 * s, y - 4 * s); g.stroke();
    g.beginPath(); g.moveTo(x + w + 12 * s, y + 6.5 * s); g.lineTo(x + w - 2 * s, y + 17 * s); g.lineTo(x - 6 * s, y + 17 * s); g.stroke();
    this.diamond(x - 14 * s, y + 6.5 * s, 5 * s, '#10151c', UI.goldHi, 1.2);
    this.diamond(x + w + 14 * s, y + 6.5 * s, 5 * s, '#10151c', UI.goldHi, 1.2);
    for (const p of phases) this.diamond(x + w * p, y + 6.5 * s, 5 * s, '#0b0f15', UI.goldHi, 1.2);
    this.starSlots.length = 0;
    if (boss.stun) {
      // семь звёзд оглушения под полосой HP (план §5.5)
      const sy = y + 31 * s;
      this.stunStars(this.w / 2, sy, 7.5 * s, 21 * s, boss, this.starSlots);
      if (boss.shatterable) { g.globalAlpha = 0.7 + 0.3 * Math.sin(this.time * 12); this.text('ОГЛУШЁН — РАСКОЛ!', this.w / 2, sy + 25 * s, 11 * s, UI.goldHi, 'bodyBold', 'center'); g.globalAlpha = 0.95; }
    }
    if (phase > 0) this.text(`ФАЗА ${ROMAN[phase - 1] ?? ''}`, x + w, y - 8 * s, 10 * s, UI.goldHi, 'bodyBold', 'right');
  }

  // ------------------------------------------------------------------ ранг комбо
  private drawRank(f: HudFrame, R: number, s: number): void {
    const g = this.g, rk = f.world.rank;
    if (rk.rank !== this.rankLast) { if (RANKS.findIndex((r) => r.id === rk.rank) > RANKS.findIndex((r) => r.id === this.rankLast)) this.rankStamp = 1; this.rankLast = rk.rank; }
    this.rankStamp = Math.max(0, this.rankStamp - 1 / 60 * 3);
    if (rk.points <= 0) return;
    const cx = R - 46 * s, cy = this.h * 0.34;
    const fade = rk.timer > 2.2 ? 1 - (rk.timer - 2.2) / 0.8 : 1;
    g.save();
    g.globalAlpha = 0.95 * clamp(fade, 0, 1);
    // подложка: вертикальный ромб-щит
    const back = g.createLinearGradient(0, cy - 40 * s, 0, cy + 40 * s);
    back.addColorStop(0, 'rgba(14,19,26,0.75)'); back.addColorStop(1, 'rgba(6,9,13,0.4)');
    g.beginPath(); g.moveTo(cx, cy - 42 * s); g.lineTo(cx + 30 * s, cy - 8 * s); g.lineTo(cx, cy + 40 * s); g.lineTo(cx - 30 * s, cy - 8 * s); g.closePath();
    g.fillStyle = back; g.fill(); g.strokeStyle = 'rgba(227,195,126,0.5)'; g.lineWidth = 1; g.stroke();
    const st = this.rankStamp;
    const k = 1 + st * 0.6;
    g.translate(cx, cy - 8 * s); g.rotate(st * 0.35); g.scale(k, k);
    const size = (rk.rankIdx >= 5 ? 34 : 30) * s;
    drawTitle(g, rk.rank, 0, -size / 2, size, { align: 'center', color: RANK_COLOR[rk.rank] ?? 'gold', glow: 0.6 + rk.rankIdx * 0.12, shake: rk.rankIdx >= 5 ? 0.2 : 0, spacing: 0.02 });
    g.restore();
    g.save();
    g.globalAlpha = 0.95 * clamp(fade, 0, 1);
    this.gothicBar(cx - 30 * s, cy + 46 * s, 60 * s, 4 * s, clamp(rk.progress, 0, 1), '#8e6a2c', UI.goldHi, -1, 0, false);
    this.gothicBar(cx - 30 * s, cy + 53 * s, 60 * s, 2 * s, clamp(1 - rk.timer / 3, 0, 1), '#3f93b8', UI.star, -1, 0, false);
    this.text(`×${rk.hits}`, cx, cy + 72 * s, 15 * s, UI.ivory, 'tech', 'center');
    if (rk.rankIdx >= 5) this.text('ЗАТМЕНИЕ', cx, cy + 86 * s, 9 * s, UI.void, 'bodyBold', 'center');
    g.restore();
  }

  // ------------------------------------------------------------------ способности
  private abilityPos(f: HudFrame, slot: 'q' | 'e' | 'r', R: number, B: number, s: number): { x: number; y: number; r: number } {
    if (f.showTouch) {
      const b = f.input.buttons.find((bb) => bb.id === slot);
      if (b) return { x: b.x, y: b.y, r: b.r };
    }
    const i = slot === 'q' ? 0 : slot === 'e' ? 1 : 2;
    return { x: R - 158 * s + i * 60 * s, y: B - 30 * s, r: (slot === 'r' ? 27 : 24) * s };
  }

  private drawAbilities(f: HudFrame, R: number, B: number, s: number): void {
    const g = this.g, ab = f.abilities;
    this.ultPulse = Math.max(0, this.ultPulse - 1 / 60);
    for (const slot of ['q', 'e', 'r'] as const) {
      const id = ab.loadout[slot] as AbilityId | null;
      const p = this.abilityPos(f, slot, R, B, s);
      const ready = ab.ready(slot);
      const full = ready >= 1;
      const ult = slot === 'r';
      const r = p.r;
      const pulse = ult && full ? 0.5 + 0.5 * Math.sin(this.time * 6) : 0;
      // медальон: внешний ромб-рамка, внутренний круг тёмного стекла
      this.diamond(p.x, p.y, r * 1.08, 'rgba(6,9,13,0.55)', full ? (ult ? UI.void : UI.goldHi) : 'rgba(201,162,83,0.6)', full ? 1.8 : 1.1);
      const glass = g.createRadialGradient(p.x, p.y - r * 0.35, 0, p.x, p.y, r * 0.78);
      glass.addColorStop(0, 'rgba(38,48,62,0.95)'); glass.addColorStop(1, 'rgba(7,10,14,0.95)');
      g.beginPath(); g.arc(p.x, p.y, r * 0.72, 0, Math.PI * 2); g.fillStyle = glass; g.fill();
      g.strokeStyle = 'rgba(227,195,126,0.45)'; g.lineWidth = 1; g.stroke();
      if (!id) {
        drawIcon(g, 'lock', p.x, p.y, r * 0.3, 'rgba(201,162,83,0.45)', UI.none);
        continue;
      }
      // КД: затемнение по часовой стрелке; ульта — заполнение снизу силой Пустоты
      if (!full) {
        g.save();
        g.beginPath(); g.arc(p.x, p.y, r * 0.72, 0, Math.PI * 2); g.clip();
        if (ult) {
          const fill = g.createLinearGradient(0, p.y + r, 0, p.y - r);
          fill.addColorStop(0, 'rgba(139,92,246,0.55)'); fill.addColorStop(1, 'rgba(183,148,255,0.25)');
          g.fillStyle = fill; g.fillRect(p.x - r, p.y + r * 0.72 - 1.44 * r * ready, 2 * r, 1.44 * r * ready);
        } else {
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.beginPath(); g.moveTo(p.x, p.y); g.arc(p.x, p.y, r, -Math.PI / 2 + ready * Math.PI * 2, Math.PI * 1.5); g.closePath(); g.fill();
          g.strokeStyle = UI.goldHi; g.lineWidth = 2;
          g.beginPath(); g.arc(p.x, p.y, r * 0.72, -Math.PI / 2, -Math.PI / 2 + ready * Math.PI * 2); g.stroke();
        }
        g.restore();
      }
      const icon = ABILITIES[id].icon as IconId;
      drawIcon(g, icon, p.x, p.y, r * 0.44, full ? UI.ivory : 'rgba(201,162,83,0.55)', full ? (ult ? `rgba(150,100,255,${0.7 + pulse * 0.3})` : UI.glowGold) : UI.none);
      if (!full && !ult) {
        const left = ab.cd[slot];
        if (left > 0) this.text(left.toFixed(left < 1 ? 1 : 0), p.x, p.y + r * 0.22, r * 0.62, '#ffffff', 'tech', 'center');
      }
      // готова: вокруг иконки за 0.25 с замыкается тонкое кольцо и гаснет
      const rt = this.readyT[slot];
      if (full && rt < 0.6) {
        const close = clamp(rt / 0.25, 0, 1), fade = rt > 0.25 ? 1 - (rt - 0.25) / 0.35 : 1;
        g.save(); g.globalAlpha = 0.95 * fade;
        g.strokeStyle = ult ? '#e8dcff' : '#fff1cc'; g.lineWidth = 1.8 * s;
        g.shadowColor = ult ? UI.glowVoid : UI.glowGold; g.shadowBlur = 6 * s;
        g.beginPath(); g.arc(p.x, p.y, r * 0.88, -Math.PI / 2, -Math.PI / 2 + close * Math.PI * 2); g.stroke();
        g.restore();
      }
      if (ult && full) {
        g.save(); g.globalAlpha = 0.45 * pulse + this.ultPulse * 0.6;
        this.diamond(p.x, p.y, r * (1.3 + this.ultPulse * 0.6), undefined, UI.void, 2);
        g.restore();
      }
      // ромбы-уровни
      const lvl = ab.state(id).level;
      for (let i = 0; i < 3; i++) this.diamond(p.x - 8 * s + i * 8 * s, p.y + r * 1.08 + 7 * s, 2.6 * s, i < lvl ? UI.goldHi : 'rgba(20,28,38,0.85)');
      if (!f.showTouch) this.text(slot.toUpperCase(), p.x, p.y - r * 1.08 - 5 * s, 10 * s, 'rgba(237,230,214,0.75)', 'tech', 'center');
    }
  }

  private drawTouch(input: Input, s: number): void {
    const g = this.g;
    for (const b of input.buttons) {
      if (b.id === 'q' || b.id === 'e' || b.id === 'r') continue;
      const press = b.pressed ? 1 : 0;
      const atk = b.id === 'attack';
      const r = b.r * (1 - press * 0.06);
      const glass = g.createRadialGradient(b.x, b.y - r * 0.4, 0, b.x, b.y, r);
      glass.addColorStop(0, `rgba(36,46,60,${0.6 + press * 0.2})`); glass.addColorStop(1, `rgba(6,9,13,${0.55 + press * 0.2})`);
      g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.fillStyle = glass; g.fill();
      g.strokeStyle = atk ? UI.goldHi : UI.star; g.lineWidth = 1.6; g.stroke();
      g.strokeStyle = 'rgba(227,195,126,0.3)'; g.lineWidth = 1;
      g.beginPath(); g.arc(b.x, b.y, r * 0.82, 0, Math.PI * 2); g.stroke();
      drawIcon(g, atk ? 'blade' : 'dash', b.x, b.y, r * 0.42, UI.ivory, atk ? UI.glowGold : UI.glowStar);
      if (atk && input.attackHeld) {
        const t = clamp((input.now - input.attackHeldSince) / 0.9, 0, 1);
        g.strokeStyle = t >= 1 ? '#ffffff' : UI.goldHi; g.lineWidth = 3 * s;
        g.beginPath(); g.arc(b.x, b.y, r * 1.14, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2); g.stroke();
      }
    }
    const st = input.stick;
    if (st.active) {
      g.strokeStyle = 'rgba(227,195,126,0.55)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(st.ox, st.oy, st.radius, 0, Math.PI * 2); g.stroke();
      const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), k = d > st.radius ? st.radius / d : 1;
      const kx = st.ox + dx * k, ky = st.oy + dy * k;
      g.beginPath(); g.arc(kx, ky, 18 * s, 0, Math.PI * 2); g.fillStyle = 'rgba(227,195,126,0.25)'; g.fill();
      g.strokeStyle = UI.goldHi; g.lineWidth = 1.5; g.stroke();
      this.diamond(kx, ky, 5 * s, UI.goldHi);
    } else {
      g.globalAlpha = 0.25;
      g.strokeStyle = 'rgba(227,195,126,0.7)'; g.lineWidth = 1;
      g.beginPath(); g.arc(110 * s + this.safe.l, this.h - 110 * s - this.safe.b, st.radius, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.95;
    }
  }

  /** Значки над врагами: Раскол по оглушённому, шкалы элиты (HP и звёзды оглушения). */
  private drawWorldMarks(f: HudFrame): void {
    const g = this.g, t = this.tmp, s = this.scale;
    for (const e of f.world.enemies) {
      if (e.dead || !e.spawned || e.isBoss) continue;
      if (e.shatterable) {
        f.project(e.x, e.height + 1.3, e.z, t);
        if (!t.visible) continue;
        const k = 1 + 0.12 * Math.sin(this.time * 10);
        g.save();
        g.globalAlpha = 0.9;
        this.diamond(t.x, t.y, 13 * s * k, 'rgba(240,217,160,0.18)', UI.goldHi, 1.6);
        drawIcon(g, 'shatter', t.x, t.y, 9 * s * k, '#ffffff', UI.glowGold);
        g.restore();
      } else if ((e.elite.length || e.isGuardian || (e.maxHp >= 200 && !e.isGuardian)) && e.hp < e.maxHp && !e.isGuardian) {
        f.project(e.x, e.height + 0.4, e.z, t);
        if (!t.visible) continue;
        const w = 48 * s;
        this.gothicBar(t.x - w / 2, t.y, w, 4 * s, e.hp / e.maxHp, '#9e1420', '#ff5a64', -1, 0, false);
        if (e.stun) this.stunStars(t.x, t.y + 10 * s, 2.8 * s, 6.6 * s, e);
      }
    }
  }

  private drawNums(dt: number, f: HudFrame): void {
    const g = this.g, t = this.tmp, s = this.scale;
    g.textAlign = 'center';
    for (const n of this.nums) {
      n.t += dt;
      f.project(n.x, n.y, n.z, t);
      if (!t.visible) continue;
      const life = n.crit ? 0.9 : 0.7;
      if (n.t > life) continue;
      // «прыжок» с overshoot: 1.4 → 1.0 за 120 мс
      const pop = n.t < 0.12 ? 1.4 - Ease.outBack(n.t / 0.12) * 0.4 : 1;
      const a = n.t > life - 0.25 ? (life - n.t) / 0.25 : 1;
      const size = (n.crit ? 22 : 15) * (n.big ? 1.35 : 1) * s * pop;
      const y = t.y - n.t * 40 * s - (n.crit ? 10 : 0) * s;
      g.globalAlpha = a;
      g.font = `600 ${Math.round(size)}px ${FONT_TECH}`;
      g.lineWidth = n.crit ? 4 : 3;
      g.lineJoin = 'round';
      g.strokeStyle = n.crit ? 'rgba(60,36,8,0.95)' : 'rgba(4,6,10,0.9)';
      const txt = n.shield && n.v <= 0 ? 'ЩИТ' : String(Math.round(n.v));
      g.strokeText(txt, t.x + n.dx * n.t, y);
      g.fillStyle = n.shield ? '#9aa6b5' : n.crit ? UI.goldHi : UI.ivory;
      g.fillText(txt, t.x + n.dx * n.t, y);
    }
    this.nums = this.nums.filter((n) => n.t < (n.crit ? 0.9 : 0.7));
    g.globalAlpha = 0.95;
  }

  /** Баннеры: въезжают с разрезом (маска-полоса), висят, уходят (GDD §15.9). */
  /**
   * Шевроны у края экрана (план §5.3, п. 5): целящиеся враги вне кадра (Око, Шипник, Аколит);
   * во время их замаха шеврон пульсирует.
   */
  private drawChevrons(f: HudFrame): void {
    const g = this.g, t = this.tmp, s = this.scale;
    const m = 30 * s, cx = this.w / 2, cy = this.h / 2;
    for (const e of f.world.enemies) {
      if (e.dead || !e.spawned || !CHEVRON_KINDS.has(e.kind)) continue;
      f.project(e.x, e.height * 0.5, e.z, t);
      if (t.visible && t.x > m * 0.5 && t.x < this.w - m * 0.5 && t.y > m * 0.5 && t.y < this.h - m * 0.5) continue;
      let dx = t.x - cx, dy = t.y - cy;
      if (!t.visible) { dx = -dx; dy = -dy; }
      const k = Math.min((this.w / 2 - m) / Math.max(1e-3, Math.abs(dx)), (this.h / 2 - m) / Math.max(1e-3, Math.abs(dy)));
      const px = cx + dx * k, py = cy + dy * k, ang = Math.atan2(dy, dx);
      const wu = e.windup;
      const pulse = wu > 0 ? 1 + 0.35 * Math.sin(this.time * 18) * (0.4 + wu) : 1;
      const sz = 11 * s * pulse;
      g.save();
      g.translate(px, py); g.rotate(ang);
      g.globalAlpha = wu > 0 ? 0.95 : 0.6;
      g.fillStyle = wu > 0 ? '#ff4a57' : '#c0303c';
      g.strokeStyle = 'rgba(10,4,6,0.85)'; g.lineWidth = 2 * s;
      g.beginPath(); g.moveTo(sz, 0); g.lineTo(-sz * 0.7, -sz * 0.75); g.lineTo(-sz * 0.25, 0); g.lineTo(-sz * 0.7, sz * 0.75); g.closePath();
      g.stroke(); g.fill();
      g.restore();
    }
    g.globalAlpha = 0.95;
  }

  private readonly navA = { x: 0, y: 0, visible: false };
  private readonly navB = { x: 0, y: 0, visible: false };
  private readonly navO = { x: 0, z: 0 };
  /** Поле потоков: стрелки к герою по клеткам (каждая вторая), красные точки — стены, жёлтые — узко для крупных. */
  private drawNav(f: HudFrame): void {
    const g = this.g, nav = f.world.nav, h = f.world.hero;
    g.save();
    g.lineWidth = 1;
    for (let id = 0; id < nav.blocked.length; id++) {
      const i = id % nav.nx, j = (id / nav.nx) | 0;
      if (i % 2 || j % 2) continue;
      const x = nav.cx(id), z = nav.cz(id);
      if (Math.abs(x - h.x) > 13 || Math.abs(z - h.z) > 9) continue;
      f.project(x, 0.05, z, this.navA);
      if (!this.navA.visible) continue;
      if (nav.blocked[id]) { g.fillStyle = 'rgba(255,60,80,0.5)'; g.fillRect(this.navA.x - 1.5, this.navA.y - 1.5, 3, 3); continue; }
      if (!nav.descend(x, z, false, this.navO)) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(this.navA.x - 1, this.navA.y - 1, 2, 2); continue; }
      f.project(x + (this.navO.x - x) * 0.4, 0.05, z + (this.navO.z - z) * 0.4, this.navB);
      g.strokeStyle = nav.clearance[id] < 0.9 ? 'rgba(255,210,90,0.55)' : 'rgba(143,216,239,0.55)';
      g.beginPath(); g.moveTo(this.navA.x, this.navA.y); g.lineTo(this.navB.x, this.navB.y); g.stroke();
    }
    g.restore();
  }

  private drawBanners(dt: number): void {
    const g = this.g, s = this.scale;
    const b = this.banners[0];
    if (!b) return;
    b.t += dt;
    const inT = 0.22, outT = 0.3;
    let size = b.size * s;
    let y = Math.max(this.h * 0.13, this.topEdge + 6 * s);
    let prog = 1, alpha = 1, slide = 0, fold = 0;
    if (b.t < inT) { prog = Ease.outCubic(b.t / inT); slide = (1 - prog) * 60 * s; }
    else if (b.fold !== undefined && b.t > b.dur - CAPTION.fold) fold = Ease.inOutCubic(clamp((b.t - (b.dur - CAPTION.fold)) / CAPTION.fold, 0, 1));
    else if (b.t > b.dur - outT) { const k = (b.t - (b.dur - outT)) / outT; alpha = 1 - k; slide = -k * 40 * s; }
    let cx = this.w / 2 + slide;
    if (fold > 0) {
      // сворачивание: название уменьшается и уходит туда, где оно стоит в подписи; орнамент и строка гаснут
      const c = this.capName, to = Math.round(size + (c.size - size) * fold);
      cx += (c.x + measureTitle(b.text, c.size) / 2 - cx) * fold;
      y += (c.y - y) * fold;
      size = to;
      if (b.t >= b.dur) { this.caption = { sub: b.fold!, wave: '', t: 0.25 }; this.banners.shift(); return; }
    }
    g.save();
    g.globalAlpha = clamp(alpha, 0, 1) * (1 - fold);
    const w = measureTitle(b.text, size) + 70 * s;
    // орнаментальная линия под заголовком
    const ly = y + size * 1.35;
    const lg = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    lg.addColorStop(0, 'rgba(201,162,83,0)'); lg.addColorStop(0.5, 'rgba(240,217,160,0.9)'); lg.addColorStop(1, 'rgba(201,162,83,0)');
    g.strokeStyle = lg; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - w / 2 * prog, ly); g.lineTo(cx + w / 2 * prog, ly); g.stroke();
    this.diamond(cx, ly, 3 * s, UI.goldHi);
    g.globalAlpha = clamp(alpha, 0, 1);
    drawTitle(g, b.text, cx, y, size, { align: 'center', color: b.color, glow: fold > 0.5 ? CAPTION.glow : 0.8, progress: Math.min(1, b.t / (inT * 1.6)), spacing: 0.1 });
    g.globalAlpha = clamp(alpha, 0, 1) * (1 - fold);
    if (b.sub) this.text(b.sub.toUpperCase(), cx, ly + size * 0.42, Math.max(10, size * 0.26), UI.text, 'bodyBold', 'center');
    g.restore();
    if (b.t >= b.dur) this.banners.shift();
  }

  /**
   * Подпись этапа внизу слева (план ×100, H): «1-1 · ПАДЕНИЕ», подстрочник и строка волны. Место названия
   * считается каждый кадр — туда сворачивается титр, даже пока подписи ещё нет.
   */
  private drawCaption(dt: number, f: HudFrame, L: number, B: number): void {
    if (!FX.title) return;
    const g = this.g, s = this.scale, C = CAPTION;
    const ns = Math.max(C.min[0], C.name * s), ss = Math.max(C.min[1], C.sub * s);
    const cap = this.caption, prefix = `${f.stageLabel} · `;
    const lines = cap ? (cap.sub ? 1 : 0) + (cap.wave ? 1 : 0) : 1;
    const yName = B - lines * ss * 1.45 - ns * 1.05;
    const px = L + 10 * s, nx = px + measureTitle(prefix, ns, 0.1);
    this.capName.x = nx; this.capName.y = yName; this.capName.size = Math.round(ns);
    if (!cap) return;
    cap.t += dt;
    if (cap.t > C.hold + C.out) { this.caption = null; return; }
    const a = Math.min(1, cap.t / 0.25) * (cap.t > C.hold ? 1 - (cap.t - C.hold) / C.out : 1);
    g.save();
    g.globalAlpha = clamp(a, 0, 1) * 0.92;
    g.textBaseline = 'alphabetic';
    this.diamond(L + 2 * s, yName + ns * 0.45, 3 * s, UI.goldHi);
    drawTitle(g, prefix, px, yName, ns, { color: 'gold', glow: C.glow, spacing: 0.1 });
    drawTitle(g, f.stageName.toUpperCase(), nx, yName, ns, { color: 'gold', glow: C.glow, spacing: 0.1 });
    let y = yName + ns * 1.05 + ss * 1.15;
    if (cap.sub) { this.text(cap.sub, px, y, ss, UI.text, 'body', 'left'); y += ss * 1.45; }
    if (cap.wave) this.text(cap.wave.toUpperCase(), px, y, ss * 0.95, UI.goldHi, 'tech', 'left');
    g.restore();
  }

  /** Надписи у целей: всплывают на 30 px и гаснут; над героем — не дольше 0.5 с. */
  private drawWorldTexts(dt: number, f: HudFrame): void {
    const g = this.g, t = this.tmp, s = this.scale;
    for (const wt of this.worldTexts) {
      wt.t += dt;
      f.project(wt.x, wt.y, wt.z, t);
      if (!t.visible || wt.t >= wt.dur) continue;
      const u = wt.t / wt.dur;
      const pop = wt.t < 0.1 ? 1.3 - Ease.outBack(wt.t / 0.1) * 0.3 : 1;
      g.save();
      g.globalAlpha = u > 0.6 ? (1 - u) / 0.4 : 1;
      this.text(wt.text, t.x, t.y - u * 30 * s, 15 * s * pop, wt.color, 'bodyBold', 'center');
      g.restore();
    }
    this.worldTexts = this.worldTexts.filter((wt) => wt.t < wt.dur);
  }

  /**
   * Карточка тренировки: слева посередине, компактно (на 844×390 — около четверти ширины). Крупно — упражнение
   * и текущий шаг, ромбы шагов, мелко — правила и где полный список.
   */
  private drawTraining(c: TrainingCard, L: number, s: number): void {
    const g = this.g, pad = 10 * s;
    const title = c.allDone ? 'ЗАЛ ПРОЙДЕН' : `УПРАЖНЕНИЕ ${c.index} ИЗ ${c.total} · ЗАСЧИТАНО ${c.done}`;
    const stepLine = c.allDone ? 'Все связки засчитаны' : `Шаг ${c.stepIdx + 1}/${c.steps}: ${c.step}`;
    g.save();
    g.font = `700 ${Math.round(16 * s)}px ${FONT_BODY}`;
    let tw = g.measureText(c.name).width;
    g.font = `600 ${Math.round(13 * s)}px ${FONT_BODY}`;
    tw = Math.max(tw, g.measureText(stepLine).width);
    g.font = `600 ${Math.round(10 * s)}px ${FONT_BODY}`;
    tw = Math.max(tw, g.measureText(c.rules).width, g.measureText(title).width * 1.08);
    const w = Math.min(Math.max(tw, 170 * s) + pad * 2, this.w * 0.46);
    const h = (c.performed ? 104 : 90) * s;
    const x0 = L, y0 = Math.max(this.topEdge + 8 * s, this.h * 0.42 - h / 2);
    g.globalAlpha = 0.85;
    g.fillStyle = 'rgba(10,8,18,0.82)';
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = UI.gold; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    g.globalAlpha = 1;
    this.text(title, x0 + pad, y0 + pad + 8 * s, 10 * s, UI.goldHi, 'bodyBold', 'left');
    if (!c.allDone) this.text(c.name, x0 + pad, y0 + pad + 27 * s, 16 * s, UI.ivory, 'bodyBold', 'left');
    this.text(stepLine, x0 + pad, y0 + pad + 46 * s, 13 * s, UI.goldHi, 'body', 'left');
    // ромбы шагов: пройден — золото, текущий — светлый контур, впереди — тусклый
    if (!c.allDone) for (let i = 0; i < c.steps; i++) {
      const cx = x0 + pad + 5 * s + i * 14 * s, cy = y0 + pad + 58 * s;
      if (c.stepDone[i]) this.diamond(cx, cy, 4 * s, UI.gold);
      else this.diamond(cx, cy, 4 * s, undefined, i === c.stepIdx ? UI.goldHi : UI.dim, i === c.stepIdx ? 1.6 : 1);
    }
    let y = y0 + pad + 72 * s;
    if (c.performed) { this.text('Серия есть — теперь попади по цели', x0 + pad, y, 12 * s, UI.star, 'body', 'left'); y += 14 * s; }
    this.text(c.rules, x0 + pad, y, 10 * s, UI.dim, 'body', 'left');
    g.restore();
  }

  private hintText = ''; private hintT = 0;
  /**
   * Подсказка ветки (план §6.4): маленький глиф следующего приёма — над кнопкой атаки (тач)
   * или у курсора (клавиатура и мышь), иначе над героем.
   */
  private drawBranchHint(dt: number, f: HudFrame, s: number): void {
    const text = f.world.hero.branchHint;
    if (text !== this.hintText) { this.hintText = text ?? ''; this.hintT = 0; }
    if (!text) return;
    this.hintT += dt;
    const g = this.g;
    let x: number, y: number;
    const btn = f.showTouch ? f.input.buttons.find((b) => b.id === 'attack') : undefined;
    const m = f.input.mouse;
    if (btn) { x = btn.x; y = btn.y - btn.r * 1.45; }
    else if (m) { x = m.x + 20 * s; y = m.y - 22 * s; }
    else {
      const h = f.world.hero;
      f.project(h.x, 2.6, h.z, this.tmp);
      x = this.tmp.x; y = this.tmp.y;
    }
    const pop = this.hintT < 0.12 ? 1.25 - Ease.outBack(this.hintT / 0.12) * 0.25 : 1;
    const size = 12 * s * pop;
    g.save();
    g.globalAlpha = Math.min(1, this.hintT / 0.08) * (0.85 + 0.15 * Math.sin(this.time * 8));
    g.font = `700 ${Math.round(size)}px ${FONT_BODY}`;
    const tw = g.measureText(text).width, pad = 9 * s;
    const x0 = x - tw / 2 - pad, x1 = x + tw / 2 + pad, h2 = 10 * s * pop;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 6 * s, y - h2); g.lineTo(x1 - 6 * s, y - h2); g.lineTo(x1, y); g.lineTo(x1 - 6 * s, y + h2); g.lineTo(x0 + 6 * s, y + h2); g.closePath();
    g.fillStyle = 'rgba(10,8,18,0.85)'; g.fill();
    g.strokeStyle = UI.void; g.lineWidth = 1.2; g.stroke();
    this.text(text, x, y + size * 0.36, size, '#e8dcff', 'bodyBold', 'center');
    g.restore();
  }

  /** Перенос строки по ширине (реплики Каэлис). */
  private wrap(text: string, maxW: number): string[] {
    const g = this.g, out: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && g.measureText(next).width > maxW) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
    return out;
  }

  /**
   * Реплики — в левом верхнем углу под HP, с портретом-ромбом (Каэлис — фиолетовый, голос из тьмы — багровый);
   * подсказки обучения — в левом нижнем углу над стиком (план §5.7, п. 4–5).
   */
  private drawSubtitle(dt: number, s: number, L: number, T: number, hints = true): void {
    const g = this.g;
    const k = s * this.subtitleScale;
    if (this.sub) {
      this.sub.t += dt;
      const dur = 1.6 + this.sub.text.length * 0.045;
      const a = this.sub.t < 0.15 ? this.sub.t / 0.15 : this.sub.t > dur - 0.4 ? (dur - this.sub.t) / 0.4 : 1;
      if (this.sub.t > dur) this.sub = null;
      else {
        g.save();
        g.globalAlpha = clamp(a, 0, 1) * 0.96;
        const boss = this.sub.speaker === 'boss';
        const pr = 15 * k, px = L + pr, py = T + 74 * s + pr;
        const tx = px + pr + 10 * k, maxW = Math.min(this.w * 0.36, 380 * s);
        g.font = `400 ${Math.round(14 * k)}px ${FONT_BODY}`;
        const lines = this.wrap(this.sub.text, maxW);
        const lh = 17 * k, bh = 18 * k + lines.length * lh;
        let tw = 0;
        for (const l of lines) tw = Math.max(tw, g.measureText(l).width);
        const bg = g.createLinearGradient(px, 0, tx + tw + 30 * k, 0);
        bg.addColorStop(0, 'rgba(6,9,13,0.8)'); bg.addColorStop(0.85, 'rgba(6,9,13,0.6)'); bg.addColorStop(1, 'rgba(6,9,13,0)');
        g.fillStyle = bg; g.fillRect(px - pr * 0.4, py - pr, tx - px + tw + 30 * k, Math.max(bh, pr * 2));
        // портрет-ромб: двойная рамка, глиф говорящего
        const glow = boss ? UI.redHi : UI.void;
        this.diamond(px, py, pr * 1.15, 'rgba(8,11,16,0.95)', boss ? UI.redHi : UI.gold, 1.4);
        this.diamond(px, py, pr * 0.85, undefined, 'rgba(227,195,126,0.4)', 1);
        g.save(); g.shadowColor = glow; g.shadowBlur = 8 * k;
        if (boss) this.diamond(px, py, pr * 0.35, UI.redHi);
        else this.star7(px, py, pr * 0.5, '#d9c8ff');
        g.restore();
        this.text(boss ? 'ГОЛОС ИЗ ТЬМЫ' : 'КАЭЛИС', tx, py - pr + 10 * k, 9 * k, boss ? UI.redHi : UI.void, 'bodyBold', 'left');
        lines.forEach((l, i) => this.text(l, tx, py - pr + 10 * k + 14 * k + i * lh, 14 * k, boss ? '#ffc9cc' : UI.ivory, 'body', 'left'));
        g.restore();
      }
    }
    if (this.hint && hints) {
      this.hint.t += dt;
      if (this.hint.t > 4.5) this.hint = null;
      else {
        const a = this.hint.t < 0.3 ? this.hint.t / 0.3 : this.hint.t > 4 ? (4.5 - this.hint.t) / 0.5 : 1;
        const hs = Math.max(s, this.hint.minFont / 13);
        g.save();
        g.globalAlpha = a;
        g.font = `700 ${Math.round(13 * hs)}px ${FONT_BODY}`;
        const lines = this.wrap(this.hint.text, Math.min(this.w * 0.4, 400 * hs));
        let tw = 0;
        for (const l of lines) tw = Math.max(tw, g.measureText(l).width);
        const lh = 17 * hs, x0 = L, y1 = this.h - Math.max(150 * s, this.hint.minFont > 0 ? 130 : 0) - this.safe.b, y0 = y1 - 12 * hs - lines.length * lh;
        const x1 = x0 + tw + 34 * hs;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(x1 - 10 * s, y1); g.lineTo(x0, y1); g.closePath();
        g.fillStyle = 'rgba(8,11,16,0.82)'; g.fill();
        g.strokeStyle = UI.gold; g.lineWidth = 1; g.stroke();
        this.diamond(x0 + 9 * hs, y0 + (y1 - y0) / 2, 3 * hs, UI.goldHi);
        lines.forEach((l, i) => this.text(l, x0 + 18 * hs, y0 + 6 * hs + (i + 0.85) * lh, 13 * hs, UI.goldHi, 'bodyBold', 'left'));
        g.restore();
      }
    }
  }
}
