import { clamp } from '../core/math';
import { Ease } from '../core/ease';
import { RANKS } from '../data/player';
import { ABILITIES, type AbilityId } from '../data/abilities';
import type { Input } from '../input/input';
import type { Abilities } from '../world/abilities';
import type { Enemy } from '../world/enemy';
import type { World } from '../world/world';
import { drawTitle, measureTitle } from './font';
import { drawIcon, type IconId } from './icons';

const GOLD = '#B8954E', GOLD_HI = '#e2c27a', VOID = '#8B5CF6', VOID_HI = '#B794FF', RED = '#E11D2E', RED_DEEP = '#6B0A13';
const SERIF = 'Georgia, "Noto Serif", "Times New Roman", serif';

interface DmgNum { x: number; y: number; z: number; v: number; crit: boolean; shield: boolean; t: number; dx: number }
interface Banner { text: string; sub?: string; t: number; dur: number; color: 'gold' | 'void' | 'hunger' | 'white'; size: number; y: number }

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
  fps: number;
  showFps: boolean;
}

/**
 * Боевой HUD — отдельный Canvas 2D поверх WebGL (Tech §22): тонкие золотистые линии и ромбы,
 * без тяжёлых рамок, прозрачность 85 %. Весь UI рисуется кодом.
 */
export class Hud {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private w = 1; private h = 1; private dpr = 1;
  private nums: DmgNum[] = [];
  private banners: Banner[] = [];
  private sub: { text: string; t: number; speaker: string } | null = null;
  private hint: { text: string; t: number } | null = null;
  private hpTrail = 1; private hpTrailDelay = 0; private lastHp = 1;
  private bossTrail = 1; private bossTrailDelay = 0; private lastBossHp = 1;
  private rankStamp = 0; private rankLast = 'D';
  private ultPulse = 0;
  private time = 0;
  safe = { l: 0, r: 0, t: 0, b: 0 };
  scale = 1;
  visible = true;
  subtitleScale = 1;
  private tmp = { x: 0, y: 0, visible: false };
  private lastWave = -1;

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
  damageNumber(x: number, y: number, z: number, v: number, crit: boolean, shield: boolean): void {
    if (v <= 0 && !shield) return;
    this.nums.push({ x, y, z, v, crit, shield, t: 0, dx: (Math.random() - 0.5) * 30 });
    if (this.nums.length > 40) this.nums.shift();
  }
  flashText(text: string, color: string): void {
    this.banners.push({ text, t: 0, dur: 0.9, color: color === '#FF4A57' ? 'hunger' : color === '#F1E8FF' ? 'white' : 'void', size: 30, y: 0.36 });
  }
  subtitle(text: string, speaker: string): void { this.sub = { text, t: 0, speaker }; }
  showHint(text: string): void { this.hint = { text, t: 0 }; }
  pulseUlt(): void { this.ultPulse = 1; }
  waveBanner(index: number, total: number): void {
    this.banners.push({ text: `ВОЛНА ${String(index + 1).padStart(2, '0')}`, sub: index + 1 === total ? 'ФИНАЛЬНАЯ' : undefined, t: 0, dur: 1.6, color: 'gold', size: 46, y: 0.3 });
  }
  bigBanner(text: string, sub: string | undefined, color: Banner['color'], dur = 2.4, size = 64): void {
    this.banners.push({ text, sub, t: 0, dur, color, size, y: 0.32 });
  }
  clear(): void { this.nums = []; this.banners = []; this.sub = null; this.hint = null; this.hpTrail = 1; this.lastHp = 1; this.lastWave = -1; }

  // ------------------------------------------------------------------ кадр
  draw(dt: number, f: HudFrame): void {
    this.time += dt;
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (!this.visible) return;
    const s = this.scale;
    const L = 20 * s + this.safe.l, R = this.w - 20 * s - this.safe.r, T = 16 * s + this.safe.t, B = this.h - 16 * s - this.safe.b;
    g.globalAlpha = 0.92;
    this.drawWorldMarks(f);
    this.drawHeroPanel(f, L, T, s);
    if (f.boss) this.drawBossBar(f, s, T, f.boss, f.bossName, f.bossPhases, f.bossPhase);
    else if (f.guardian && !f.guardian.dead) this.drawBossBar(f, s, T, f.guardian, f.guardian.def.name, [], 0);
    else this.drawTitleTop(s, T);
    this.drawWave(f, R, T, s);
    this.drawStageLabel(f, L, B, s);
    this.drawRank(f, R, s);
    this.drawAbilities(f, R, B, s);
    if (f.showTouch) this.drawTouch(f.input, s);
    this.drawNums(dt, f);
    this.drawBanners(dt);
    this.drawSubtitle(dt, s);
    if (f.showFps) { g.fillStyle = '#9a8fb8'; g.font = `12px ${SERIF}`; g.textAlign = 'left'; g.fillText(`${f.fps.toFixed(0)} FPS`, L, B - 60 * s); }
    g.globalAlpha = 1;
  }

  private diamond(cx: number, cy: number, r: number, fill?: string, stroke?: string, lw = 1.2): void {
    const g = this.g;
    g.beginPath();
    g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
  }

  /** Полоса со «скошенными» концами (рамка — тонкая золотая линия). */
  private bar(x: number, y: number, w: number, h: number, frac: number, color: string, trail = -1, trailColor = RED_DEEP, frame = true): void {
    const g = this.g, k = h * 0.8;
    const path = (ww: number) => { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + k, y); g.lineTo(x + ww, y); g.lineTo(x + ww - k, y + h); g.closePath(); };
    g.fillStyle = 'rgba(8,6,14,0.75)'; path(w); g.fill();
    if (trail > frac) { g.fillStyle = trailColor; path(Math.max(k, w * trail)); g.fill(); }
    if (frac > 0) {
      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.18, color); grad.addColorStop(1, color);
      g.fillStyle = grad; path(Math.max(k, w * frac)); g.fill();
    }
    if (frame) { g.strokeStyle = GOLD; g.lineWidth = 1; path(w); g.stroke(); }
  }

  private drawHeroPanel(f: HudFrame, L: number, T: number, s: number): void {
    const g = this.g, h = f.world.hero;
    const er = 26 * s, ex = L + er, ey = T + er;
    // эмблема-портрет: ромб со стилизованным шлемом
    this.diamond(ex, ey, er, 'rgba(12,8,20,0.85)', GOLD, 1.5);
    this.diamond(ex, ey, er * 0.78, undefined, 'rgba(184,149,78,0.5)', 1);
    g.save();
    g.translate(ex, ey);
    g.fillStyle = '#1b1826';
    g.beginPath(); g.moveTo(0, -er * 0.6); g.lineTo(er * 0.32, er * 0.05); g.lineTo(0, er * 0.5); g.lineTo(-er * 0.32, er * 0.05); g.closePath(); g.fill();
    g.strokeStyle = VOID; g.lineWidth = 1; g.stroke();
    const glow = 0.5 + h.resonance / 200;
    g.fillStyle = `rgba(241,232,255,${glow})`;
    g.fillRect(-er * 0.2, -er * 0.05, er * 0.4, er * 0.07);
    g.restore();
    // HP: основная падает сразу, «след» догоняет через 0.4 с (GDD §15.9)
    const frac = clamp(h.hp / h.maxHp, 0, 1);
    if (frac < this.lastHp) this.hpTrailDelay = 0.4;
    this.lastHp = frac;
    if (this.hpTrailDelay > 0) this.hpTrailDelay -= 1 / 60; else this.hpTrail += (frac - this.hpTrail) * 0.12;
    if (this.hpTrail < frac) this.hpTrail = frac;
    const bx = ex + er + 8 * s, bw = 230 * s, bh = 12 * s;
    const lowPulse = frac < 0.25 ? 0.6 + 0.4 * Math.sin(this.time * 8) : 1;
    g.globalAlpha = 0.92 * lowPulse;
    this.bar(bx, ey - bh - 3 * s, bw, bh, frac, RED, this.hpTrail);
    g.globalAlpha = 0.92;
    g.fillStyle = '#e8dff5'; g.font = `${Math.round(11 * s)}px ${SERIF}`; g.textAlign = 'left';
    g.fillText(`${Math.ceil(h.hp)} / ${h.maxHp}`, bx + bw + 8 * s, ey - 5 * s);
    // Резонанс
    const res = h.eclipse ? (h.eclipseUntil - h.clock) / 6 : h.resonance / 100;
    this.bar(bx - 4 * s, ey + 3 * s, bw * 0.86, 7 * s, clamp(res, 0, 1), h.resonance >= 100 || h.eclipse ? VOID_HI : VOID);
    if (h.resonance >= 100 && !h.eclipse) {
      g.fillStyle = `rgba(183,148,255,${0.4 + 0.4 * Math.sin(this.time * 6)})`;
      g.font = `bold ${Math.round(10 * s)}px ${SERIF}`;
      g.fillText('R', bx + bw * 0.86 + 4 * s, ey + 10 * s);
    }
    // ромбы зарядов рывка
    for (let i = 0; i < h.stats.dashCharges; i++) {
      const cx = bx + 6 * s + i * 16 * s, cy = ey + 22 * s;
      const full = i < h.dashCharges;
      this.diamond(cx, cy, 5 * s, full ? VOID_HI : 'rgba(30,20,50,0.8)', GOLD, 1);
    }
  }

  private drawTitleTop(s: number, T: number): void {
    const g = this.g;
    g.globalAlpha = 0.55;
    drawTitle(g, 'VOIDBREAKER', this.w / 2, T + 2 * s, 14 * s, { align: 'center', color: 'gold', glow: 0.4, spacing: 1.6, weight: 0.8 });
    g.globalAlpha = 0.92;
  }

  private drawBossBar(f: HudFrame, s: number, T: number, boss: Enemy, name: string, phases: number[], phase: number): void {
    const g = this.g;
    const w = Math.min(560 * s, this.w * 0.5), x = this.w / 2 - w / 2, y = T + 26 * s;
    drawTitle(g, name, this.w / 2, T - 2 * s, 17 * s, { align: 'center', color: 'hunger', glow: 0.5, spacing: 1.4 });
    const frac = clamp(boss.hp / boss.maxHp, 0, 1);
    if (frac < this.lastBossHp) this.bossTrailDelay = 0.4;
    this.lastBossHp = frac;
    if (this.bossTrailDelay > 0) this.bossTrailDelay -= 1 / 60; else this.bossTrail += (frac - this.bossTrail) * 0.08;
    if (this.bossTrail < frac) this.bossTrail = frac;
    this.bar(x, y, w, 12 * s, frac, RED, this.bossTrail);
    for (const p of phases) { const px = x + w * p; this.diamond(px, y + 6 * s, 5 * s, '#0b0812', GOLD_HI, 1); }
    if (boss.posture) {
      const pf = boss.posture.broken > 0 ? boss.posture.broken / boss.posture.breakDur : boss.posture.value / boss.posture.max;
      this.bar(x + w * 0.15, y + 17 * s, w * 0.7, 5 * s, pf, boss.posture.broken > 0 ? '#ffffff' : '#d9d3e8', -1, RED_DEEP, false);
    }
    if (phase > 0) {
      g.font = `italic ${Math.round(11 * s)}px ${SERIF}`; g.fillStyle = GOLD_HI; g.textAlign = 'center';
      g.fillText(`ФАЗА ${['I', 'II', 'III', 'IV'][phase] ?? ''}`, this.w / 2, y + 36 * s);
    }
    void f;
  }

  private drawWave(f: HudFrame, R: number, T: number, s: number): void {
    const g = this.g;
    // пауза
    this.diamond(R - 14 * s, T + 14 * s, 14 * s, 'rgba(10,8,16,0.6)', GOLD, 1.2);
    drawIcon(g, 'pause', R - 14 * s, T + 14 * s, 6 * s, GOLD_HI, 'rgba(0,0,0,0)');
    if (!f.wave) return;
    if (f.wave.index !== this.lastWave) { this.lastWave = f.wave.index; }
    const label = `ВОЛНА ${String(f.wave.index + 1).padStart(2, '0')}`;
    const size = 15 * s;
    const lw = measureTitle(label, size);
    drawTitle(g, label, R - 40 * s - lw, T + 4 * s, size, { color: 'gold', glow: 0.4 });
    for (let i = 0; i < f.wave.total; i++) {
      const cx = R - 40 * s - lw + i * 13 * s + 5 * s, cy = T + 30 * s;
      this.diamond(cx, cy, 4.5 * s, i < f.wave.index ? GOLD_HI : i === f.wave.index ? VOID_HI : 'rgba(30,20,40,0.8)', GOLD, 1);
    }
  }

  private drawStageLabel(f: HudFrame, L: number, B: number, s: number): void {
    const g = this.g;
    g.globalAlpha = 0.75;
    const y = B - 14 * s;
    drawTitle(g, f.stageLabel, L, y - 8 * s, 13 * s, { color: 'gold', glow: 0.3 });
    const lw = measureTitle(f.stageLabel, 13 * s);
    g.strokeStyle = GOLD; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L + lw + 8 * s, y + 6 * s); g.lineTo(L + lw + 16 * s, y - 8 * s); g.stroke();
    g.font = `${Math.round(12 * s)}px ${SERIF}`; g.fillStyle = '#d8cfe8'; g.textAlign = 'left';
    g.fillText(f.stageName.toUpperCase().split('').join(' '), L + lw + 22 * s, y + 2 * s);
    g.globalAlpha = 0.92;
  }

  private drawRank(f: HudFrame, R: number, s: number): void {
    const g = this.g, rk = f.world.rank;
    if (rk.rank !== this.rankLast) { if (RANKS.findIndex((r) => r.id === rk.rank) > RANKS.findIndex((r) => r.id === this.rankLast)) this.rankStamp = 1; this.rankLast = rk.rank; }
    this.rankStamp = Math.max(0, this.rankStamp - 1 / 60 * 3);
    if (rk.points <= 0) return;
    const cx = R - 48 * s, cy = this.h * 0.36;
    const fade = rk.timer > 2.2 ? 1 - (rk.timer - 2.2) / 0.8 : 1;
    g.save();
    g.globalAlpha = 0.92 * clamp(fade, 0, 1);
    const st = this.rankStamp;
    const k = 1 + Ease.outBack(st) * 0.0 + st * 0.6;
    g.translate(cx, cy); g.rotate(st * 0.4); g.scale(k, k);
    const color = rk.rankIdx >= 5 ? 'void' : rk.rankIdx >= 4 ? 'white' : rk.rankIdx >= 3 ? 'gold' : 'gold';
    const size = (rk.rankIdx >= 5 ? 44 : 38) * s;
    drawTitle(g, rk.rank, 0, -size / 2, size, { align: 'center', color, glow: 0.7 + rk.rankIdx * 0.1, shake: rk.rankIdx >= 5 ? 0.25 : 0 });
    g.restore();
    g.globalAlpha = 0.92 * clamp(fade, 0, 1);
    if (rk.rankIdx >= 5) { g.font = `italic ${Math.round(11 * s)}px ${SERIF}`; g.fillStyle = VOID_HI; g.textAlign = 'center'; g.fillText('ЗАТМЕНИЕ', cx, cy + 34 * s); }
    // таймер сброса и прогресс
    this.bar(cx - 30 * s, cy + 40 * s, 60 * s, 4 * s, clamp(rk.progress, 0, 1), VOID, -1, RED_DEEP, false);
    this.bar(cx - 30 * s, cy + 46 * s, 60 * s, 2 * s, clamp(1 - rk.timer / 3, 0, 1), GOLD, -1, RED_DEEP, false);
    g.font = `${Math.round(13 * s)}px ${SERIF}`; g.fillStyle = '#efe6ff'; g.textAlign = 'center';
    g.fillText(`${rk.hits} ×`, cx, cy + 62 * s);
    g.globalAlpha = 0.92;
  }

  private abilityPos(f: HudFrame, slot: 'q' | 'e' | 'r', R: number, B: number, s: number): { x: number; y: number; r: number } {
    if (f.showTouch) {
      const b = f.input.buttons.find((bb) => bb.id === slot);
      if (b) return { x: b.x, y: b.y, r: b.r };
    }
    const i = slot === 'q' ? 0 : slot === 'e' ? 1 : 2;
    return { x: R - 150 * s + i * 56 * s, y: B - 30 * s, r: 24 * s };
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
      this.diamond(p.x, p.y, r, 'rgba(10,7,18,0.72)', full ? (ult ? VOID_HI : GOLD_HI) : GOLD, full ? 1.8 : 1.1);
      if (!id) {
        drawIcon(g, 'lock', p.x, p.y, r * 0.35, 'rgba(184,149,78,0.4)', 'rgba(0,0,0,0)');
        continue;
      }
      // КД: затемнение по часовой стрелке
      if (!full) {
        g.save();
        g.beginPath(); g.moveTo(p.x, p.y - r); g.lineTo(p.x + r, p.y); g.lineTo(p.x, p.y + r); g.lineTo(p.x - r, p.y); g.closePath(); g.clip();
        g.fillStyle = ult ? 'rgba(139,92,246,0.25)' : 'rgba(0,0,0,0.55)';
        g.beginPath(); g.moveTo(p.x, p.y);
        if (ult) { g.rect(p.x - r, p.y + r - 2 * r * ready, 2 * r, 2 * r * ready); }
        else { g.arc(p.x, p.y, r * 1.5, -Math.PI / 2 + ready * Math.PI * 2, Math.PI * 1.5); }
        g.closePath(); g.fill();
        g.restore();
      }
      const icon = ABILITIES[id].icon as IconId;
      drawIcon(g, icon, p.x, p.y, r * 0.5, full ? '#f3e7c4' : 'rgba(184,149,78,0.6)', full ? `rgba(139,92,246,${0.7 + pulse * 0.3})` : 'rgba(0,0,0,0)');
      if (!full && !ult) {
        const left = ab.cd[slot];
        if (left <= 3 && left > 0) { g.font = `bold ${Math.round(r * 0.55)}px ${SERIF}`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(left.toFixed(left < 1 ? 1 : 0), p.x, p.y + r * 0.2); }
      }
      if (ult && full) {
        g.save(); g.globalAlpha = 0.4 * pulse + this.ultPulse * 0.6;
        this.diamond(p.x, p.y, r * (1.2 + this.ultPulse * 0.6), undefined, VOID_HI, 2);
        g.restore();
      }
      // ромбы-уровни
      const lvl = ab.state(id).level;
      for (let i = 0; i < 3; i++) this.diamond(p.x - 8 * s + i * 8 * s, p.y + r + 7 * s, 2.6 * s, i < lvl ? GOLD_HI : 'rgba(30,20,40,0.8)');
      if (!f.showTouch) {
        g.font = `${Math.round(10 * s)}px ${SERIF}`; g.fillStyle = 'rgba(232,223,245,0.7)'; g.textAlign = 'center';
        g.fillText(slot.toUpperCase(), p.x, p.y - r - 4 * s);
      }
    }
  }

  private drawTouch(input: Input, s: number): void {
    const g = this.g;
    for (const b of input.buttons) {
      if (b.id === 'q' || b.id === 'e' || b.id === 'r') continue;
      const press = b.pressed ? 1 : 0;
      this.diamond(b.x, b.y, b.r * (1 - press * 0.06), `rgba(12,8,20,${0.55 + press * 0.2})`, b.id === 'attack' ? GOLD_HI : VOID_HI, 1.6);
      this.diamond(b.x, b.y, b.r * 0.78, undefined, 'rgba(184,149,78,0.35)', 1);
      drawIcon(g, b.id === 'attack' ? 'blade' : 'agility', b.x, b.y, b.r * 0.42, '#f3e7c4', 'rgba(139,92,246,0.8)');
      if (b.id === 'attack' && input.attackHeld) {
        const t = clamp((input.now - input.attackHeldSince) / 0.9, 0, 1);
        g.strokeStyle = t >= 1 ? '#ffffff' : VOID_HI; g.lineWidth = 3 * s;
        g.beginPath(); g.arc(b.x, b.y, b.r * 1.15, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2); g.stroke();
      }
    }
    const st = input.stick;
    if (st.active) {
      g.strokeStyle = 'rgba(184,149,78,0.6)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(st.ox, st.oy, st.radius, 0, Math.PI * 2); g.stroke();
      const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), k = d > st.radius ? st.radius / d : 1;
      this.diamond(st.ox + dx * k, st.oy + dy * k, 20 * s, 'rgba(139,92,246,0.45)', VOID_HI, 1.5);
    } else {
      g.globalAlpha = 0.25;
      g.strokeStyle = 'rgba(184,149,78,0.7)'; g.lineWidth = 1;
      g.beginPath(); g.arc(110 * s + this.safe.l, this.h - 110 * s - this.safe.b, st.radius, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.92;
    }
  }

  /** Значки над врагами: казнь сломанных, щит Аколита, шкалы элиты. */
  private drawWorldMarks(f: HudFrame): void {
    const g = this.g, t = this.tmp, s = this.scale;
    for (const e of f.world.enemies) {
      if (e.dead || !e.spawned) continue;
      if (e.executable) {
        f.project(e.x, e.height + 0.6, e.z, t);
        if (!t.visible) continue;
        const k = 1 + 0.15 * Math.sin(this.time * 10);
        this.diamond(t.x, t.y, 13 * s * k, 'rgba(241,232,255,0.2)', '#ffffff', 2);
        drawIcon(g, 'execute', t.x, t.y, 9 * s * k, '#ffffff', 'rgba(183,148,255,1)');
      } else if ((e.elite.length || (e.maxHp >= 200 && !e.isBoss && !e.isGuardian)) && e.hp < e.maxHp) {
        f.project(e.x, e.height + 0.4, e.z, t);
        if (!t.visible) continue;
        const w = 46 * s;
        this.bar(t.x - w / 2, t.y, w, 4 * s, e.hp / e.maxHp, RED, -1, RED_DEEP, false);
        if (e.posture) this.bar(t.x - w / 2, t.y + 6 * s, w, 2.5 * s, e.posture.value / e.posture.max, '#e6e0f0', -1, RED_DEEP, false);
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
      const size = (n.crit ? 24 : 16) * s * pop;
      const y = t.y - n.t * 40 * s - (n.crit ? 10 : 0) * s;
      g.globalAlpha = a;
      g.font = `${n.crit ? 'bold ' : ''}${Math.round(size)}px ${SERIF}`;
      g.lineWidth = n.crit ? 4 : 3;
      g.strokeStyle = n.crit ? 'rgba(90,40,200,0.95)' : 'rgba(10,6,16,0.9)';
      const txt = n.shield && n.v <= 0 ? 'ЩИТ' : String(n.v);
      g.strokeText(txt, t.x + n.dx * n.t, y);
      g.fillStyle = n.shield ? '#ff9aa2' : n.crit ? '#ffffff' : '#efe6ff';
      g.fillText(txt, t.x + n.dx * n.t, y);
    }
    this.nums = this.nums.filter((n) => n.t < (n.crit ? 0.9 : 0.7));
    g.globalAlpha = 0.92;
  }

  /** Баннеры: «ВОЛНА 02» въезжает с разрезом (маска-полоса), висит, разлетается на штрихи (GDD §15.9). */
  private drawBanners(dt: number): void {
    const g = this.g, s = this.scale;
    for (const b of this.banners) {
      b.t += dt;
      const inT = 0.22, outT = 0.3;
      const size = b.size * s;
      const y = this.h * b.y;
      let prog = 1, alpha = 1, slide = 0;
      if (b.t < inT) { prog = Ease.outCubic(b.t / inT); slide = (1 - prog) * 60 * s; }
      else if (b.t > b.dur - outT) { const k = (b.t - (b.dur - outT)) / outT; alpha = 1 - k; slide = -k * 40 * s; }
      g.save();
      g.globalAlpha = alpha;
      // маска-разрез: диагональная полоса
      const w = measureTitle(b.text, size) + 60 * s;
      g.beginPath();
      g.moveTo(this.w / 2 - w / 2 + slide, y - size * 0.4); g.lineTo(this.w / 2 + w / 2 * prog + slide + 20 * s, y - size * 0.4);
      g.lineTo(this.w / 2 + w / 2 * prog + slide, y + size * 1.5); g.lineTo(this.w / 2 - w / 2 + slide - 20 * s, y + size * 1.5); g.closePath();
      g.clip();
      g.strokeStyle = GOLD; g.lineWidth = 1;
      g.beginPath(); g.moveTo(this.w / 2 - w / 2 + slide, y + size * 1.25); g.lineTo(this.w / 2 + w / 2 + slide, y + size * 1.25); g.stroke();
      drawTitle(g, b.text, this.w / 2 + slide, y, size, { align: 'center', color: b.color, glow: 0.8, progress: Math.min(1, b.t / (inT * 1.6)) });
      if (b.sub) {
        g.font = `italic ${Math.round(size * 0.3)}px ${SERIF}`; g.fillStyle = '#e8dff5'; g.textAlign = 'center';
        g.fillText(b.sub, this.w / 2 + slide, y + size * 1.6);
      }
      g.restore();
    }
    this.banners = this.banners.filter((b) => b.t < b.dur);
  }

  private drawSubtitle(dt: number, s: number): void {
    const g = this.g;
    const k = s * this.subtitleScale;
    if (this.sub) {
      this.sub.t += dt;
      const dur = 1.6 + this.sub.text.length * 0.045;
      const a = this.sub.t < 0.15 ? this.sub.t / 0.15 : this.sub.t > dur - 0.4 ? (dur - this.sub.t) / 0.4 : 1;
      if (this.sub.t > dur) this.sub = null;
      else {
        g.globalAlpha = clamp(a, 0, 1) * 0.95;
        const y = this.h - 112 * s - this.safe.b;
        g.font = `italic ${Math.round(16 * k)}px ${SERIF}`;
        const tw = g.measureText(this.sub.text).width;
        g.fillStyle = 'rgba(8,6,14,0.6)';
        g.fillRect(this.w / 2 - tw / 2 - 34 * s, y - 18 * k, tw + 54 * s, 28 * k);
        const boss = this.sub.speaker === 'boss';
        this.diamond(this.w / 2 - tw / 2 - 18 * s, y - 4 * k, 7 * s * (1 + 0.15 * Math.sin(this.time * 20)), boss ? RED : VOID_HI);
        g.fillStyle = boss ? '#ffb3b8' : '#efe6ff'; g.textAlign = 'left';
        g.fillText(this.sub.text, this.w / 2 - tw / 2, y);
        g.globalAlpha = 0.92;
      }
    }
    if (this.hint) {
      this.hint.t += dt;
      if (this.hint.t > 4.5) this.hint = null;
      else {
        const a = this.hint.t < 0.3 ? this.hint.t / 0.3 : this.hint.t > 4 ? (4.5 - this.hint.t) / 0.5 : 1;
        g.globalAlpha = a;
        const y = this.h * 0.7;
        g.font = `${Math.round(15 * s)}px ${SERIF}`;
        g.textAlign = 'center';
        const tw = g.measureText(this.hint.text).width;
        g.strokeStyle = GOLD; g.lineWidth = 1;
        g.fillStyle = 'rgba(8,6,14,0.7)';
        g.beginPath(); g.moveTo(this.w / 2 - tw / 2 - 30 * s, y - 14 * s); g.lineTo(this.w / 2 + tw / 2 + 30 * s, y - 14 * s); g.lineTo(this.w / 2 + tw / 2 + 20 * s, y + 10 * s); g.lineTo(this.w / 2 - tw / 2 - 20 * s, y + 10 * s); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#f3e7c4';
        g.fillText(this.hint.text, this.w / 2, y + 2 * s);
        g.globalAlpha = 0.92;
      }
    }
  }
}
