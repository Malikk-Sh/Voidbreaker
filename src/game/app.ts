import { h, injectStyles, wipe } from '../ui/dom';
import { Game } from './game';
import { Showcase, type ScreenFrame, type ShowcaseView } from './showcase';
import { stageById, ZONE1 } from '../data/stages';
import { applyReward, computeReward, computeStats, type Reward, type StageResult } from '../meta/progression';
import { writeSave } from '../meta/save';
import { hubSong } from '../audio/music';
import { titleScreen } from '../ui/screens/title';
import { hubScreen } from '../ui/screens/hub';
import { mapScreen } from '../ui/screens/map';
import { resultsScreen } from '../ui/screens/results';
import { pauseScreen } from '../ui/screens/pause';
import { settingsScreen } from '../ui/screens/settings';
import { REPLAY, type BattleOpts, type BattleOutcome, type ReplayId } from './battle';
import { Prologue } from './prologue';
import { LORE } from '../data/lore';
import { replayContext } from './context';

export type ScreenId = 'title' | 'hub' | 'map' | 'settings' | 'prologue';

export interface ResultsData {
  stageId: string;
  cleared: boolean;
  result: StageResult;
  reward: Reward;
  lore?: string;
  run: BattleOutcome['world']['run'];
  bestCombo: number;
  deathSource?: string;
}

/**
 * Оболочка приложения: FSM экранов (GDD §19.2) — Титул → Святилище → Карта Созвездий → Бой → Результаты.
 * Меню — DOM поверх живой 3D-сцены; переходы — диагональный разрез клинком.
 */
export class App {
  readonly game: Game;
  readonly layer: HTMLElement;
  private screenEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  showcase: Showcase | null = null;
  /** Пролог «Падение» (план §8.2): сцена на движке вместо экрана меню. */
  prologue: Prologue | null = null;
  current: ScreenId | 'battle' | 'results' = 'title';
  private pauseBtn: HTMLElement;
  lastDeathSource = '';

  constructor(root: HTMLElement) {
    injectStyles();
    this.game = new Game(root);
    this.layer = h('div', { class: 'vb-layer' });
    root.appendChild(this.layer);
    root.appendChild(h('div', { class: 'vb-rotate' }, h('div', {}, 'ПОВЕРНИТЕ УСТРОЙСТВО', h('br'), h('span', { class: 'vb-dim', style: { fontSize: '11px' } }, 'игра в ландшафтном режиме'))));
    this.pauseBtn = h('button', { class: 'vb-iconbtn', style: { position: 'absolute', top: 'max(8px, env(safe-area-inset-top))', right: 'max(12px, env(safe-area-inset-right))', zIndex: '6', pointerEvents: 'auto', display: 'none', opacity: '0' }, 'aria-label': 'Пауза', onClick: () => this.pause() });
    root.appendChild(this.pauseBtn);
    this.game.onFrame = (dt) => { this.showcase?.update(dt); this.prologue?.update(dt); };
    this.cinemaPlayers.set('prologue', () => wipe(this.layer, () => this.playPrologue(true)));
    // kill-cam стражей и интро Иерофанта — в бою без волн; по концу сцены — назад в Архив
    for (const id of Object.keys(REPLAY) as ReplayId[]) this.cinemaPlayers.set(id, () => this.startStage(REPLAY[id].stage, { replay: id, prologue: id === 'prologueLanding' }));
    this.game.onBattleEnd = (o) => this.onBattleEnd(o);
    this.game.onPauseRequest = () => { if (this.current === 'battle' && !this.overlayEl) this.showPause(); };
    this.game.ctx.input.onPause = () => { if (this.current === 'battle') this.togglePause(); };
  }

  get ctx() { return this.game.ctx; }

  sfx(id: string, gain = 0.7): void { this.ctx.audio.play(id, { gain, reverb: 0.25 }); }

  /** Проигрыватели сцен Кинозала (регистрируют пролог, босс, kill-cam). */
  readonly cinemaPlayers = new Map<string, () => void>();
  canWatch(id: string): boolean { return this.cinemaPlayers.has(id); }
  watchScene(id: string, short = false): void {
    const r = REPLAY[id as ReplayId];
    if (short && r) this.startStage(r.stage, { replay: id as ReplayId, prologue: id === 'prologueLanding', previewShort: true });
    else this.cinemaPlayers.get(id)?.();
  }
  save(): void { writeSave(this.ctx.save); }
  /** Свободная от панелей область экрана Святилища — туда ставится Пилот. */
  setHubFrame(f: ScreenFrame): void { if (this.showcase) this.showcase.frame = f; }

  // ------------------------------------------------------------------ экраны
  private ensureShowcase(view: ShowcaseView): void {
    if (!this.showcase) {
      this.showcase = new Showcase(this.ctx.renderer);
      this.showcase.snapCamera();
    }
    this.showcase.mode = view;
    this.showcase.starLit = this.ctx.save.stars.z1 ?? 0;
  }

  private mount(el: HTMLElement): void {
    this.screenEl?.remove();
    this.screenEl = el;
    this.layer.appendChild(el);
  }

  go(id: ScreenId, transition = true): void {
    const run = () => {
      this.closeOverlay();
      if (this.game.battle) { this.game.endBattle(); this.pauseBtn.style.display = 'none'; }
      this.stopPrologue();
      if (id === 'prologue') { this.playPrologue(false); return; }
      this.current = id;
      this.ctx.input.enabled = false;
      this.ctx.time.paused = false;
      switch (id) {
        case 'title': this.ensureShowcase('title'); this.mount(titleScreen(this)); break;
        case 'hub': this.ensureShowcase('hub'); this.mount(hubScreen(this)); break;
        case 'map': this.ensureShowcase('map'); this.mount(mapScreen(this)); break;
        case 'settings': this.ensureShowcase(this.settingsFrom === 'title' ? 'title' : 'hub'); this.mount(settingsScreen(this, () => this.go(this.settingsFrom))); break;
      }
      if (this.ctx.audio.ctx) this.ctx.music.play(hubSong(), 0);
    };
    if (transition && this.screenEl) wipe(this.layer, run); else run();
  }

  /** Откуда открыты настройки (титул или Святилище) — туда же и возврат. */
  settingsFrom: 'title' | 'hub' = 'hub';
  openSettings(from: 'title' | 'hub'): void { this.settingsFrom = from; this.go('settings'); }

  startStage(id: string, opts: BattleOpts = {}): void {
    const def = stageById(id);
    if (!def) return;
    this.ctx.audio.unlock();
    const run = () => {
      this.closeOverlay();
      this.screenEl?.remove(); this.screenEl = null;
      if (this.showcase) { this.showcase.dispose(); this.showcase = null; }
      this.stopPrologue();
      this.game.startBattle(def, opts);
      this.current = 'battle';
      this.pauseBtn.style.display = 'block';
      const b = this.game.battle!;
      b.world.bus.on('playerHurt', (e) => { this.lastDeathSource = e.source; });
      // выход — после кадра боя: закрывать бой изнутри его же frame() нельзя
      if (opts.replay) b.onReplayEnd = () => queueMicrotask(() => { if (this.game.battle === b) this.go('hub'); });
    };
    // после пролога — без разреза: белая вспышка купола переходит во вспышку приземления
    if (opts.prologue) run(); else wipe(this.layer, run);
  }

  /** Пролог: первый запуск — потом бой 1-1 с приземлением; повтор из Кинозала — назад в Святилище. */
  private playPrologue(replay: boolean): void {
    this.closeOverlay();
    this.screenEl?.remove(); this.screenEl = null;
    if (this.showcase) { this.showcase.dispose(); this.showcase = null; }
    this.stopPrologue();
    this.current = 'prologue';
    this.prologue = new Prologue(replay ? replayContext(this.ctx) : this.ctx, this.layer, () => {
      this.stopPrologue();
      if (replay) { this.go('hub', false); return; }
      this.ctx.setFlag('prologue');
      this.startStage('1-1', { prologue: true });
    });
  }

  private stopPrologue(): void {
    if (!this.prologue) return;
    this.prologue.dispose();
    this.prologue = null;
    this.ctx.input.enabled = false;
  }

  // ------------------------------------------------------------------ пауза
  togglePause(): void { if (this.overlayEl) this.resume(); else this.pause(); }

  pause(): void {
    if (this.current !== 'battle' || this.overlayEl) return;
    this.game.pause(true);
  }

  private showPause(): void {
    this.ctx.time.paused = true;
    this.ctx.input.enabled = false;
    const el = pauseScreen(this);
    this.overlayEl = el;
    this.layer.appendChild(el);
  }

  resume(): void {
    this.closeOverlay();
    this.ctx.time.paused = false;
    this.ctx.input.enabled = true;
    this.ctx.input.reset();
  }

  openOverlay(el: HTMLElement): void {
    this.closeOverlay();
    this.overlayEl = el;
    this.layer.appendChild(el);
  }

  closeOverlay(): void { this.overlayEl?.remove(); this.overlayEl = null; }

  // ------------------------------------------------------------------ результаты
  private onBattleEnd(o: BattleOutcome): void {
    const s = this.ctx.save;
    const w = o.world;
    const story = this.ctx.settings.story;
    const result: StageResult = {
      stageId: o.stage.id, cleared: o.cleared, hpFrac: w.hero.hp / w.hero.maxHp, rank: w.rank.stageRank(), rankMul: w.rank.stageRankMul(),
      time: w.run.time, pickedShards: w.run.shards, pickedEther: w.run.ether, bestCombo: w.rank.bestHits, story,
    };
    const stats = computeStats(s, this.ctx.settings.autoAim);
    const reward = o.cleared ? computeReward(s, o.stage, result, stats.shardBonus) : { stars: 0 as const, newStars: 0, shards: Math.round(w.run.shards * 0.5), ether: 0, first: false, unlocks: [], freeLevel3: false };
    const firstClear = o.cleared && !(s.stages[o.stage.id]?.clears);
    applyReward(s, o.stage, result, reward);
    let lore: string | undefined;
    if (firstClear && LORE[o.stage.id] && !s.lore.includes(o.stage.id)) { s.lore.push(o.stage.id); lore = o.stage.id; }
    // онбординг: после этапа с обучением прокачке (1-5) — заход в Святилище с бесплатным уровнем Силы (GDD §20)
    if (o.stage.tutorial === 'upgrade' && firstClear && !s.flags.freePower) { s.flags.freePower = true; s.stats.power++; }
    writeSave(s, true);
    this.ctx.input.enabled = false;
    this.pauseBtn.style.display = 'none';
    this.current = 'results';
    const data: ResultsData = { stageId: o.stage.id, cleared: o.cleared, result, reward, lore, run: w.run, bestCombo: w.rank.bestHits, deathSource: this.lastDeathSource };
    this.openOverlay(resultsScreen(this, data));
  }

  nextStageId(id: string): string | null {
    const i = ZONE1.findIndex((d) => d.id === id);
    return i >= 0 && i + 1 < ZONE1.length ? ZONE1[i + 1].id : null;
  }

  start(): void {
    this.go('title', false);
    // dev: ?stage=1-1 — сразу в бой
    const p = new URLSearchParams(location.search);
    const st = p.get('stage');
    if (st) {
      this.game.startBattle(stageById(st)!);
      this.current = 'battle';
      this.screenEl?.remove(); this.screenEl = null;
      if (this.showcase) { this.showcase.dispose(); this.showcase = null; }
      this.pauseBtn.style.display = 'block';
      if (p.has('wave')) { const b = this.game.battle!; b.runner.skipTo(Number(p.get('wave'))); b.cine.clear(b.cam); }
      this.game.battle!.world.bus.on('playerHurt', (e) => { this.lastDeathSource = e.source; });
      if (p.has('god')) { const hh = this.game.battle!.world.hero; const orig = hh.receiveAttack.bind(hh); hh.receiveAttack = (d, x, z, s2, k) => orig(0 * d, x, z, s2, k); }
      addEventListener('pointerdown', () => this.ctx.audio.unlock(), { once: true });
      addEventListener('keydown', () => this.ctx.audio.unlock(), { once: true });
    }
    if (p.has('screen')) this.go(p.get('screen') as ScreenId, false);
    if (p.has('studioPreview')) {
      const id = p.get('scene');
      if (id) this.watchScene(id, p.get('variant') === 'short');
      const back = h('a', { href: `editor.html?scene=${encodeURIComponent(id ?? 'hierophantEnd')}`, style: { position: 'fixed', zIndex: '100', left: '12px', top: '12px', color: '#ddd2ff', background: '#161320df', border: '1px solid #786493', borderRadius: '10px', padding: '12px 16px', fontSize: '13px', textDecoration: 'none', pointerEvents: 'auto' } }, '← Студия сцен');
      document.body.append(back);
    }
    const watch = p.get('watch');
    if (watch && ['hierophantEnd', 'killGate', 'killBell'].includes(watch)) {
      this.watchScene(watch);
      const choices = h('div', { style: { position: 'fixed', zIndex: '100', left: 'max(10px, env(safe-area-inset-left))', bottom: 'max(10px, env(safe-area-inset-bottom))', display: 'flex', gap: '6px', pointerEvents: 'auto' } });
      for (const [id, label] of [['hierophantEnd', 'Иерофант'], ['killGate', 'Страж Врат'], ['killBell', 'Звонарь']]) {
        const link = h('a', { href: `?watch=${id}`, 'aria-current': watch === id ? 'true' : 'false', style: { display: 'inline-flex', alignItems: 'center', minHeight: '44px', padding: '9px 13px', color: '#e5d9ff', background: watch === id ? '#45345ded' : '#15131fed', border: '1px solid #786493', borderRadius: '10px', fontSize: '12px', textDecoration: 'none' }, onClick: (event: MouseEvent) => {
          event.preventDefault(); event.stopPropagation();
          // Сохраняем AudioContext: перезагрузка по ссылке снова блокировала звук на телефоне.
          this.watchScene(id); history.replaceState(null, '', `?watch=${id}`);
          for (const item of choices.querySelectorAll('a')) { const active = item === link; item.style.background = active ? '#45345ded' : '#15131fed'; item.setAttribute('aria-current', String(active)); }
        } }, label);
        choices.append(link);
      }
      document.body.append(choices);
    }
    (window as unknown as { __app: App }).__app = this;
  }
}
