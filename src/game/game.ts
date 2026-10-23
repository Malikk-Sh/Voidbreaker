import { AudioEngine } from '../audio/engine';
import { Sequencer } from '../audio/music';
import { Time } from '../core/time';
import { Input } from '../input/input';
import { Renderer, type QualityLevel } from '../render/renderer';
import { Hud } from '../ui/hud';
import { loadSave, writeSave, type SaveData } from '../meta/save';
import { computeStats } from '../meta/progression';
import { stageById, type StageDef } from '../data/stages';
import type { Loadout } from '../world/abilities';
import { Battle, type BattleOpts, type BattleOutcome } from './battle';
import type { GameContext } from './context';

export type Screen = 'title' | 'hub' | 'map' | 'battle' | 'results';

/**
 * Игра (Tech §9): FSM экранов, загрузка, общий цикл. Бой — свой мир; меню и хаб — DOM поверх живой 3D-сцены.
 */
export class Game {
  readonly ctx: GameContext;
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  battle: Battle | null = null;
  screen: Screen = 'title';
  private last = performance.now();
  private running = true;
  /** Экраны DOM подписываются сюда (рисуют фон сцены в меню). */
  onFrame: ((dt: number) => void) | null = null;
  onBattleEnd: ((o: BattleOutcome) => void) | null = null;
  private autoQ = newAutoQ();

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;display:block;touch-action:none;';
    root.appendChild(this.canvas);
    const save = loadSave();
    const q = this.initialQuality(save);
    const renderer = new Renderer(this.canvas, q);
    const input = new Input(this.canvas);
    const audio = new AudioEngine();
    const hud = new Hud(root);
    const time = new Time();
    this.ctx = {
      renderer, input, audio, music: new Sequencer(audio), hud, time, settings: save.settings, save,
      persist: () => writeSave(this.ctx.save),
      flag: (id) => !!this.ctx.save.flags[id],
      setFlag: (id) => { this.ctx.save.flags[id] = true; writeSave(this.ctx.save); },
    };
    this.applySettings();
    const floorPt = { x: 0, z: 0 };
    input.screenToFloor = (sx, sy) => renderer.screenToFloor(sx, sy, floorPt);
    input.heroWorld = () => this.battle?.world.hero ?? null;
    input.heroScreen = () => {
      const h = this.battle?.world.hero;
      const out = { x: innerWidth / 2, y: innerHeight / 2, visible: true };
      if (h) renderer.project(h.x, 1, h.z, out);
      return out;
    };
    addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => this.onVisibility());
    addEventListener('pagehide', () => { writeSave(this.ctx.save, true); });
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.pause(true); });
    requestAnimationFrame(this.loop);
  }

  private initialQuality(s: SaveData): QualityLevel {
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
    if (s.settings.quality !== 'auto') return s.settings.quality;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return mobile ? 'medium' : 'high';
  }

  applySettings(): void {
    const s = this.ctx.settings, a = this.ctx.audio;
    a.volumes = { master: s.volMaster, music: s.volMusic, sfx: s.volSfx, voice: s.volVoice };
    a.applyVolumes();
    this.ctx.input.vibration = s.vibration;
    this.ctx.input.layout = { scale: s.buttonScale, offsetX: s.buttonOffsetX, offsetY: s.buttonOffsetY };
    if (s.quality !== 'auto' && s.quality !== this.ctx.renderer.quality) this.ctx.renderer.setQuality(s.quality);
    this.battle?.applySettings();
    this.resize();
  }

  /** Учёт safe-area (вырезы экрана): зонд с env(safe-area-inset-*). */
  private safeArea(): { l: number; r: number; t: number; b: number } {
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(p);
    const cs = getComputedStyle(p);
    const r = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    p.remove();
    return r;
  }

  resize(): void {
    const w = innerWidth, h = innerHeight;
    this.ctx.renderer.resize(w, h);
    this.ctx.hud.resize(w, h);
    const sa = this.safeArea();
    this.ctx.hud.safe = sa;
    this.ctx.input.layoutButtons(w, h, sa.r, sa.b);
  }

  private onVisibility(): void {
    if (document.hidden) {
      this.ctx.audio.suspend();
      writeSave(this.ctx.save, true);
      if (this.screen === 'battle') this.pause(true);
    } else {
      this.ctx.audio.resume();
      this.ctx.music.resync();
      this.last = performance.now();
    }
  }

  /** Пауза боя (экран паузы вешает Game UI). */
  onPauseRequest: (() => void) | null = null;
  pause(on: boolean): void {
    this.ctx.time.paused = on;
    if (on) this.onPauseRequest?.();
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.running) {
      try {
        if (this.battle) {
          this.battle.frame(dt);
          this.ctx.hud.draw(dt, this.battle.hudFrame());
        } else {
          this.ctx.input.update(this.ctx.time.real);
          this.ctx.time.update(dt);
        }
        this.onFrame?.(dt);
        this.ctx.renderer.render(this.ctx.time.world);
        this.autoQuality(dt);
      } catch (e) {
        console.error(e);
      }
    }
    requestAnimationFrame(this.loop);
  };

  /**
   * Авто-подстройка (Tech §25.2): см. autoQualityStep — устойчивая перегрузка → разрешение −0.1 (мин 0.5),
   * затем качество вниз; долго ровно → разрешение вверх.
   */
  private autoQuality(dt: number): void {
    if (this.ctx.settings.quality !== 'auto' || !this.battle) return;
    const step = autoQualityStep(this.autoQ, dt);
    if (!step) return;
    const r = this.ctx.renderer;
    if (step === 'down') {
      if (r.dynScale > 0.55) r.dynScale -= 0.1;
      else if (r.quality !== 'low') { r.setQuality(r.quality === 'high' ? 'medium' : 'low'); r.dynScale = 1; }
      this.resize();
    } else if (r.dynScale < 1) { r.dynScale = Math.min(1, r.dynScale + 0.1); this.resize(); }
  }

  loadout(): Loadout {
    const s = this.ctx.save;
    return { q: s.loadout.q, e: s.loadout.e, r: s.loadout.r, levels: { ...s.abilities } };
  }

  startBattle(def: StageDef, opts: BattleOpts = {}): void {
    this.endBattle();
    this.ctx.audio.unlock();
    const stats = computeStats(this.ctx.save, this.ctx.settings.autoAim);
    // HUD виден по умолчанию; сцена в конструкторе боя (пролог) может его скрыть
    this.ctx.hud.visible = true;
    const b = new Battle(this.ctx, def, stats, this.loadout(), opts);
    b.onEnd = (o) => this.onBattleEnd?.(o);
    this.battle = b;
    this.screen = 'battle';
    this.ctx.input.enabled = true;
    this.ctx.input.reset();
    (window as unknown as { __vb: unknown }).__vb = { game: this, battle: b, world: b.world };
  }

  startStageById(id: string): void {
    const def = stageById(id);
    if (def) this.startBattle(def);
  }

  endBattle(): void {
    if (this.battle) { this.battle.dispose(); this.battle = null; }
    this.ctx.hud.visible = false;
    this.ctx.hud.draw(0, null as never);
  }
}

/** Окно замера автокачества (с), сколько окон подряд с перегрузкой — вниз, сколько ровных — вверх. */
export const AUTO_Q = { window: 2, slowFrac: 0.1, downAfter: 3, upAfter: 10, slowDt: 0.021 };

export interface AutoQState { t: number; frames: number; slow: number; badRuns: number; goodRuns: number }
export const newAutoQ = (): AutoQState => ({ t: 0, frames: 0, slow: 0, badRuns: 0, goodRuns: 0 });

/**
 * Шаг автокачества: кадры копятся в окна по AUTO_Q.window с; окно «плохое», если медленных кадров (> 21 мс)
 * больше 10 %. downAfter плохих окон подряд → 'down'; upAfter ровных (< 1 % медленных) подряд → 'up'.
 * (Раньше окно сбрасывалось через 2 с, а снижение ждало 5 с — и никогда не срабатывало.)
 */
export function autoQualityStep(a: AutoQState, dt: number): 'down' | 'up' | null {
  a.t += dt; a.frames++;
  if (dt > AUTO_Q.slowDt) a.slow++;
  if (a.t < AUTO_Q.window) return null;
  const frac = a.slow / Math.max(1, a.frames);
  a.t = 0; a.frames = 0; a.slow = 0;
  if (frac > AUTO_Q.slowFrac) { a.goodRuns = 0; if (++a.badRuns >= AUTO_Q.downAfter) { a.badRuns = 0; return 'down'; } return null; }
  a.badRuns = 0;
  if (frac < 0.01 && ++a.goodRuns >= AUTO_Q.upAfter) { a.goodRuns = 0; return 'up'; }
  if (frac >= 0.01) a.goodRuns = 0;
  return null;
}
