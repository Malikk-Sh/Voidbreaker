import './studio.css';
import * as THREE from 'three';
import { Clip, type ClipDef, type Key } from '../anim/clip';
import { HERO_CLIPS } from '../anim/clips/hero';
import { Ease, type EaseId } from '../core/ease';
import type { CineStep, V3 } from '../game/director';
import { offsetWorld, parseProject, readProject, saveProject, stepKeys, type StepEdit, type Variant, type VariantEdit } from '../game/sceneEdits';
import { ACTOR_NAMES, BOSS_CLIPS, CLIP_NAMES, SCENES, type SceneSpec } from './catalog';
import { StudioPreview } from './preview';

const $ = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag); el.className = cls; el.textContent = text; return el;
};
const button = (label: string, fn: () => void, cls = '') => { const b = $('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };
const line = (label: string, content: HTMLElement) => { const div = $('div', 'form-row'); div.append($('label', 'form-label', label), content); return div; };
const fmt = (v: number) => v.toFixed(2);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeNames: Record<EaseId, string> = { linear: 'Равномерно', inOutSine: 'Мягкий разгон и остановка', inOutQuad: 'Разгон и торможение', inCubic: 'Нарастающее ускорение', inOutCubic: 'Плавно с акцентом', outCubic: 'Быстро → мягкая остановка', outQuad: 'Мягкое торможение', inQuad: 'Ускорение / падение', outQuart: 'Сильное торможение', inQuart: 'Сильное ускорение', outExpo: 'Резкий рывок', inExpo: 'Резкое ускорение', inBack: 'С предварительным замахом', outBack: 'С инерцией в конце', outElastic: 'Пружинящий выход' };
const names = (s: CineStep) => {
  if (s.do === 'actor') return `${ACTOR_NAMES[s.who] ?? s.who} · ${s.clip ? CLIP_NAMES[s.clip] ?? s.clip : s.moveTo ? 'Движение' : 'Разворот'}`;
  if (s.do === 'clip') return CLIP_NAMES[s.clip] ?? (s.definition ? `Своя поза · ${ACTOR_NAMES[s.who] ?? s.who}` : s.clip);
  if (s.do === 'cam') return 'Камера';
  if (s.do === 'call') return ({ strike: 'Контакт', cut: 'Разрез', beam: 'Луч к звезде', freeze: 'Замирание', end: 'Конец', flare: 'Толчок', fracture: 'Раскол маски', calm: 'Тишина', grip: 'Хват', releaseFromGround: 'Клинок из пола', weaponAwake: 'Пробуждение клинка', quiet: 'Тишина', silence: 'Тишина', runes: 'Руны', douse: 'Свечи гаснут', descend: 'Спуск', ignite: 'Пробуждение', mask: 'Маска', slam: 'Удар посоха', begin: 'Начало боя', land: 'На мост', collapse: 'Обрушение', braam: 'Акцент', tocsin: 'Набат', phase: 'Смена фазы', crack: 'Трещина', raise: 'Подъём', dash: 'Рывок', ghostsOff: 'След гаснет', brace: 'Опора', chainStep: 'Шаг по цепи', star2: 'Вторая звезда', toll: 'Последний звон', dark: 'Тьма', space: 'Полёт', beams: 'Лучи', hit: 'Попадание', blackout: 'Затемнение', fall: 'Падение', hint: 'Подсказка', dome: 'Купол', landStart: 'Приземление', impact: 'Касание пола', visor: 'Визор', idle: 'Стойка', title: 'Титр', music: 'Музыка', husk: 'Шелуха', knee: 'Подсечка', helmet: 'Удар в шлем', crumble: 'Распад', bell: 'Удар в колокол' } as Record<string, string>)[s.fn] ?? s.fn;
  return ({ say: 'Реплика', sfx: 'Звук', time: 'Замедление', tap: 'Касание', wait: 'Ожидание', sky: 'Небо', crack: 'Трещины', dissolve: 'Исчезновение', music: 'Музыка', flash: 'Вспышка', letterbox: 'Рамка', banner: 'Титр' } as Record<string, string>)[s.do] ?? s.do;
};

class Studio {
  project = readProject();
  spec: SceneSpec = SCENES[0];
  variant: Variant = 'full';
  private selected = 'actor:hero:1';
  private tab: 'move' | 'pose' | 'scene' = 'move';
  private actor = 'hero';
  private keyIndex = 0;
  private joint = 'chest';
  private cameraPoint = 0;
  private cameraLookPoint = 0;
  private playing = false;
  private speed = 1;
  private loop = true;
  private before = new Array<string>();
  private after = new Array<string>();
  private raf = 0;
  private prev = 0;
  private seekTarget: number | null = null;
  private toastTimer = 0;
  readonly preview: StudioPreview;
  private root = $('main', 'app');
  private content = $('div', 'inspector-content');
  private timeline = $('div', 'timeline');
  private playhead = $('div', 'playhead');
  private timeLabel = $('span', 'time');
  private scrub = $('input');
  private playButton = button('▶', () => this.togglePlay(), 'primary');
  private status = $('span', '', 'Сохранено на устройстве');
  private toastEl = $('div', 'toast');
  private undoButton = button('↶', () => this.undo(), 'quiet');
  private redoButton = button('↷', () => this.redo(), 'quiet');
  private sceneSelect = $('select');
  private variantButton = button('Полная', () => this.setVariant(this.variant === 'full' ? 'short' : 'full'));
  private sceneNote = $('span', 'scene-note');
  private frameMeta = $('span', 'frame-meta');
  private applied = button('Применить в игре', () => this.toggleApplied(), 'primary');
  private menu = $('div', 'menu-panel');
  private cameraButtons = new Map<string, HTMLButtonElement>();
  private tabs = new Map<string, HTMLButtonElement>();

  constructor() {
    const mount = document.getElementById('studio')!; mount.replaceChildren(this.root);
    const head = $('header', 'masthead'), brand = $('div', 'wordmark', 'VOIDBREAKER'); brand.append($('span', '', 'СТУДИЯ СЦЕН / 01'));
    const toolbar = $('div', 'toolbar'), saved = $('div', 'save-label'); saved.append($('i', 'save-dot'), this.status);
    this.undoButton.title = 'Отменить'; this.undoButton.setAttribute('aria-label', 'Отменить');
    this.redoButton.title = 'Повторить'; this.redoButton.setAttribute('aria-label', 'Повторить');
    const menuButton = button('⋯', () => { this.menu.hidden = !this.menu.hidden; }); menuButton.setAttribute('aria-label', 'Файл и помощь');
    toolbar.append(saved, this.undoButton, this.redoButton, menuButton); head.append(brand, toolbar);
    const bar = $('div', 'scene-bar'); this.sceneSelect.setAttribute('aria-label', 'Сцена');
    for (const s of SCENES) { const option = $('option', '', s.title); option.value = s.id; this.sceneSelect.append(option); }
    this.sceneSelect.onchange = () => this.open(this.sceneSelect.value);
    bar.append(this.sceneSelect, this.variantButton, this.sceneNote);
    const workspace = $('section', 'workspace'), view = $('div', 'viewport'), canvas = $('canvas');
    canvas.setAttribute('aria-label', 'Трёхмерный предпросмотр кат-сцены');
    const cameraTools = $('div', 'camera-tools');
    for (const [mode, label] of [['shot', 'Кадр'], ['orbit', 'Облёт'], ['side', 'Сбоку'], ['top', 'Сверху']] as const) {
      const b = button(label, () => { this.preview.setCamera(mode); this.syncCamera(); }); this.cameraButtons.set(mode, b); cameraTools.append(b);
    }
    view.append(canvas, $('span', 'frame-title', 'МОНТАЖНАЯ ПЛОЩАДКА'), cameraTools, this.frameMeta, $('span', 'view-hint', 'Облёт: палец · масштаб: два пальца'));
    const transport = $('div', 'transport'), buttons = $('div', 'buttons');
    const back = button('‹', () => this.seek(this.preview.time - 1 / 30)); back.setAttribute('aria-label', 'Предыдущий кадр');
    const forward = button('›', () => this.seek(this.preview.time + 1 / 30)); forward.setAttribute('aria-label', 'Следующий кадр');
    this.playButton.setAttribute('aria-label', 'Воспроизвести'); buttons.append(back, this.playButton, forward);
    this.scrub.type = 'range'; this.scrub.min = '0'; this.scrub.step = '0.001'; this.scrub.setAttribute('aria-label', 'Время сцены');
    this.scrub.oninput = () => { this.playing = false; this.seekTarget = Number(this.scrub.value); this.updatePlay(); };
    const speedSelect = $('select'); speedSelect.setAttribute('aria-label', 'Скорость просмотра');
    for (const k of [0.1, 0.25, 0.5, 1, 1.5]) { const o = $('option', '', `${k}×`); o.value = String(k); o.selected = k === 1; speedSelect.append(o); }
    speedSelect.onchange = () => { this.speed = Number(speedSelect.value); };
    transport.append(buttons, this.timeLabel, this.scrub, speedSelect);
    const timelineSection = $('section', 'timeline-section'), timelineHead = $('div', 'timeline-head');
    timelineHead.append($('span', '', 'ТАЙМЛАЙН · НАЖМИТЕ НА ФРАГМЕНТ'), button('↻', () => { this.loop = !this.loop; this.toast(this.loop ? 'Повтор включён' : 'Повтор выключен'); }, 'quiet'));
    const scroll = $('div', 'timeline-scroll'); scroll.append(this.timeline); timelineSection.append(timelineHead, scroll);
    workspace.append(view, transport, timelineSection);
    const inspector = $('aside', 'inspector'), tabs = $('nav', 'tabs');
    for (const [id, label] of [['move', 'Движение'], ['pose', 'Поза'], ['scene', 'Сцена']] as const) {
      const b = button(label, () => { this.tab = id; this.renderInspector(); }); this.tabs.set(id, b); tabs.append(b);
    }
    inspector.append(tabs, this.content);
    const footer = $('footer', 'footer'); footer.append($('small', '', 'Черновик хранится в этом браузере. Экспортируйте файл для резервной копии.'), this.applied);
    this.root.append(head, bar, workspace, inspector, footer);
    this.buildMenu(); this.toastEl.hidden = true; this.toastEl.setAttribute('role', 'status'); this.root.append(this.menu, this.toastEl);
    this.preview = new StudioPreview(canvas, view);
    const id = new URLSearchParams(location.search).get('scene'); this.open(SCENES.some((s) => s.id === id) ? id! : this.spec.id);
    this.animate = this.animate.bind(this); this.raf = requestAnimationFrame(this.animate);
    document.addEventListener('visibilitychange', () => { this.prev = 0; if (document.hidden) { this.playing = false; this.updatePlay(); } });
    window.addEventListener('pagehide', () => this.persist());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.matches('input,select,textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
    });
    window.addEventListener('storage', (e) => { if (e.key === 'voidbreaker.scene-studio.v1') this.toast('Проект изменён в другой вкладке. Экспортируйте свой черновик перед обновлением.'); });
    (window as unknown as { __studio: Studio }).__studio = this;
  }

  private buildMenu(): void {
    this.menu.hidden = true;
    this.menu.append($('h2', '', 'Проект постановки'), $('p', 'muted', 'Работает на Android в портретном и альбомном режимах. Всё управление доступно касанием.'));
    this.menu.append(button('Экспорт проекта · JSON', () => this.export()));
    const file = $('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    file.onchange = async () => {
      try {
        const f = file.files?.[0]; if (!f) return;
        if (f.size > 2_000_000) throw new Error('Файл больше 2 МБ');
        const next = parseProject(await f.text()); this.change(() => { this.project = next; }); this.toast('Проект импортирован'); this.menu.hidden = true;
      } catch (e) { this.toast(`Не удалось импортировать: ${(e as Error).message}`); }
      file.value = '';
    };
    this.menu.append(button('Импорт проекта', () => file.click()), file);
    const game = $('a', '', 'Открыть игру ↗'); game.href = './'; game.target = '_blank'; game.rel = 'noopener'; this.menu.append(game);
    this.menu.append($('p', 'muted', '1. Выберите сцену и фрагмент. 2. Настройте путь, скорость и позы. 3. Нажмите «Применить в игре». Правки действуют на этом адресе в этом браузере; экспорт переносит их на другое устройство.'));
    this.menu.append($('p', 'muted', 'На площадке показаны риги и камера. Боевые эффекты, разрушение и звук смотрите через «Просмотр в игре». Сохранение прохождения не меняется.'));
    this.menu.append(button('Закрыть', () => { this.menu.hidden = true; }, 'quiet'));
  }

  open(id: string): void {
    this.playing = false; this.spec = SCENES.find((s) => s.id === id) ?? SCENES[0]; this.variant = 'full';
    this.sceneSelect.value = this.spec.id; this.sceneNote.textContent = this.spec.note;
    this.selected = this.spec.track.steps.some((s) => s.do === 'actor') ? stepKeys(this.spec.track.steps)[this.spec.track.steps.findIndex((s) => s.do === 'actor')] : 'cam:0';
    this.actor = 'hero'; this.keyIndex = 0; this.preview.load(this.spec, this.project, this.variant);
    this.update(); this.syncCamera();
    const u = new URL(location.href); u.searchParams.set('scene', this.spec.id); history.replaceState(null, '', u);
  }
  private currentEdit(create = false): VariantEdit {
    const scene = this.project.scenes[this.spec.id] ?? (create ? this.project.scenes[this.spec.id] = {} : {});
    return scene[this.variant] ?? (create ? scene[this.variant] = { steps: {} } : { steps: {} });
  }
  private rate(): number { return this.currentEdit().rate ?? 1; }
  private entries(): { s: CineStep; key: string; added: boolean }[] {
    const steps = this.variant === 'short' ? this.spec.track.short ?? this.spec.track.steps : this.spec.track.steps;
    const keys = stepKeys(steps);
    return [...steps.map((s, i) => ({ s, key: keys[i], added: false })), ...(this.currentEdit().added ?? []).map((s, i) => ({ s, key: `added:${i}`, added: true }))];
  }
  private entry() { return this.entries().find((x) => x.key === this.selected); }
  private patch(): StepEdit { return this.currentEdit().steps[this.selected] ?? {}; }
  private setPatch(v: Partial<StepEdit>): void {
    const entry = this.entry(); if (!entry) return;
    this.change(() => {
      if (entry.added) Object.assign(this.currentEdit(true).added![Number(entry.key.split(':')[1])], v);
      else { const e = this.currentEdit(true); e.steps[this.selected] = { ...this.patch(), ...v }; }
    });
  }
  private change(fn: () => void): void {
    const old = JSON.stringify(this.project); fn();
    const next = JSON.stringify(this.project); if (next === old) return;
    try { this.project = parseProject(next); } catch (e) { this.project = parseProject(old); this.toast((e as Error).message); return; }
    this.before.push(old); if (this.before.length > 60) this.before.shift(); this.after.length = 0;
    this.playing = false; this.persist(); this.preview.refresh(this.project, this.variant); this.update();
  }
  private undo(): void {
    const p = this.before.pop(); if (!p) return; this.after.push(JSON.stringify(this.project)); this.project = parseProject(p); this.restore();
  }
  private redo(): void {
    const p = this.after.pop(); if (!p) return; this.before.push(JSON.stringify(this.project)); this.project = parseProject(p); this.restore();
  }
  private restore(): void { this.playing = false; this.persist(); this.preview.refresh(this.project, this.variant); this.update(); }
  private persist(): void {
    try { saveProject(this.project); this.status.textContent = this.project.enabled ? 'Сохранено · действует в игре' : 'Черновик на устройстве'; }
    catch { this.status.textContent = 'Нет доступа к хранилищу'; this.toast('Браузер не сохранил проект. Сделайте экспорт файла.'); }
  }
  private toggleApplied(): void { this.change(() => { this.project.enabled = !this.project.enabled; }); this.toast(this.project.enabled ? 'Правки включены в игре на этом устройстве' : 'Правки в игре выключены. Черновик сохранён.'); }
  private setVariant(v: Variant): void {
    if (v === 'short' && !this.spec.track.short) return;
    this.variant = v;
    this.selected = (this.entries().find((e) => e.s.do === 'actor') ?? this.entries().find((e) => e.s.do === 'cam') ?? this.entries()[0])?.key ?? '';
    this.tab = 'move'; this.playing = false; this.preview.load(this.spec, this.project, v); this.update();
  }
  private update(): void {
    this.variantButton.textContent = this.variant === 'full' ? 'Полная' : 'Короткая'; this.variantButton.disabled = !this.spec.track.short;
    this.undoButton.disabled = !this.before.length; this.redoButton.disabled = !this.after.length;
    this.applied.textContent = this.project.enabled ? 'В игре: включено ✓' : 'Применить в игре'; this.applied.classList.toggle('primary', !this.project.enabled);
    this.renderTimeline(); this.renderInspector(); this.updateTime(); this.updatePlay();
  }
  private renderTimeline(): void {
    this.timeline.replaceChildren(); const width = Math.max(600, this.preview.duration * 60); this.timeline.style.width = `${width}px`;
    for (let sec = 0; sec <= this.preview.duration; sec++) { const r = $('span', 'ruler', `${sec}с`); r.style.left = `${sec * 60 + 4}px`; this.timeline.append(r); }
    const lanes = ['ДВИЖЕНИЯ', 'ПОЗЫ', 'КАМЕРА', 'СОБЫТИЯ'].map((name) => { const l = $('div', 'lane'); l.append($('span', 'lane-label', name)); this.timeline.append(l); return l; });
    for (const e of this.entries()) {
      const d = this.currentEdit().steps[e.key], s = e.s, t = (d?.t ?? s.t) / this.rate();
      const dur = ((d?.dur ?? ('dur' in s ? s.dur : undefined)) ?? (s.do === 'clip' ? this.clipDefinition(s, d)?.dur ?? 0.5 : 0.1)) / this.rate();
      const lane = s.do === 'actor' ? 0 : s.do === 'clip' ? 1 : s.do === 'cam' ? 2 : 3;
      const b = button(names(s), () => {
        this.selected = e.key; if ('who' in s) this.actor = s.who; this.keyIndex = 0;
        this.tab = s.do === 'clip' ? 'pose' : 'move'; this.seek(t); this.renderTimeline(); this.renderInspector();
      }, `clip ${s.do === 'actor' ? 'actor' : s.do === 'cam' ? 'cam' : lane === 3 ? 'event' : ''}${e.key === this.selected ? ' selected' : ''}`);
      b.style.left = `${t * 60}px`; b.style.width = `${Math.max(lane === 3 ? 22 : 48, dur * 60 - 3)}px`;
      b.title = `${fmt(t)} с · ${names(s)}`; b.setAttribute('aria-label', b.title); lanes[lane].append(b);
    }
    this.timeline.append(this.playhead);
  }
  private updateTime(): void {
    this.scrub.max = String(this.preview.duration); this.scrub.value = String(this.preview.time);
    this.timeLabel.textContent = `${fmt(this.preview.time)} / ${fmt(this.preview.duration)} с`;
    this.playhead.style.left = `${this.preview.time * 60}px`;
    this.frameMeta.textContent = `${this.variant === 'full' ? 'FULL' : 'SHORT'} / ${String(Math.round(this.preview.time * 30)).padStart(4, '0')} · 30 К/С`;
  }
  private seek(t: number): void { this.playing = false; this.preview.seek(clamp(t, 0, this.preview.duration)); this.updateTime(); this.updatePlay(); }
  private togglePlay(): void { if (this.preview.time >= this.preview.duration - 0.02) this.preview.seek(0); this.playing = !this.playing; this.updatePlay(); }
  private updatePlay(): void { this.playButton.textContent = this.playing ? 'Ⅱ' : '▶'; this.playButton.setAttribute('aria-label', this.playing ? 'Пауза' : 'Воспроизвести'); }
  private syncCamera(): void { for (const [id, b] of this.cameraButtons) b.classList.toggle('active', id === this.preview.cameraMode); }
  private animate(t: number): void {
    const dt = this.prev ? Math.min(0.05, (t - this.prev) / 1000) : 0; this.prev = t;
    if (this.seekTarget !== null) { this.seek(this.seekTarget); this.seekTarget = null; }
    if (this.playing) {
      this.preview.advance(dt * this.speed);
      if (this.preview.time >= this.preview.duration) { if (this.loop) this.preview.seek(0); else { this.playing = false; this.updatePlay(); } }
      this.updateTime();
    }
    this.raf = requestAnimationFrame(this.animate);
  }

  private number(value: number, change: (n: number) => void, step = 0.05, min = -1000, max = 1000, label = ''): HTMLElement {
    const wrap = $('div', 'stepper'), input = $('input'); input.type = 'number'; input.inputMode = 'decimal'; input.step = String(step); input.min = String(min); input.max = String(max); input.value = String(Number(value.toFixed(3))); input.setAttribute('aria-label', label || 'Значение');
    const commit = () => { const n = Number(input.value.replace(',', '.')); if (!Number.isFinite(n) || input.value.trim() === '') { input.value = String(value); return; } change(clamp(n, min, max)); };
    input.onchange = commit;
    const minus = button('−', () => change(clamp(value - step, min, max))), plus = button('+', () => change(clamp(value + step, min, max)));
    minus.setAttribute('aria-label', `Уменьшить ${label}`); plus.setAttribute('aria-label', `Увеличить ${label}`); wrap.append(minus, input, plus); return wrap;
  }
  private vector(label: string, value: V3, change: (v: V3) => void, degrees = false): HTMLElement {
    const div = $('div', 'vector');
    for (let i = 0; i < 3; i++) {
      const name = degrees ? ['X · наклон', 'Y · поворот', 'Z · крен'][i] : ['Вбок · м', 'Высота · м', 'Вперёд · м'][i];
      div.append(line(name, this.number(degrees ? value[i] * 180 / Math.PI : value[i], (n) => { const v = [...value] as V3; v[i] = degrees ? n * Math.PI / 180 : n; change(v); }, degrees ? 5 : 0.05, degrees ? -720 : -1000, degrees ? 720 : 1000, `${label} ${name}`)));
    }
    const group = $('div'); group.append($('h3', '', label), div); return group;
  }
  private select<T extends string>(value: T, choices: { value: T; label: string }[], fn: (v: T) => void, label: string): HTMLSelectElement {
    const s = $('select'); s.setAttribute('aria-label', label);
    for (const choice of choices) { const o = $('option', '', choice.label); o.value = choice.value; o.selected = choice.value === value; s.append(o); }
    s.onchange = () => fn(s.value as T); return s;
  }
  private curve(ease: EaseId): HTMLElement {
    const div = $('div', 'curve-card');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 260 70');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', Array.from({ length: 61 }, (_, i) => `${i ? 'L' : 'M'}${10 + i * 4},${60 - Ease[ease](i / 60) * 50}`).join(' ')); path.setAttribute('stroke', '#bfa8ff'); path.setAttribute('fill', 'none'); path.setAttribute('stroke-width', '2'); svg.append(path); div.append(svg); return div;
  }
  private renderInspector(): void {
    this.content.replaceChildren(); for (const [id, b] of this.tabs) b.classList.toggle('active', id === this.tab);
    if (this.tab === 'scene') return this.renderScene();
    if (this.tab === 'pose') return this.renderPose();
    const e = this.entry();
    if (!e) { this.content.append($('p', 'help', 'Нажмите на движение или камеру в таймлайне.')); return; }
    const { s, added } = e, d = this.patch();
    this.content.append($('span', 'tag', s.do === 'cam' ? 'КАМЕРА' : 'who' in s ? ACTOR_NAMES[s.who] ?? s.who : 'СОБЫТИЕ'), $('h2', 'inspector-title', names(s)));
    if (s.do !== 'actor' && s.do !== 'cam' && s.do !== 'clip') {
      this.content.append($('p', 'help', 'Сюжетное событие. Его время меняется вместе с общим темпом сцены. Чтобы настроить персонажа, выберите движение или добавьте его на вкладке «Сцена».')); return;
    }
    this.content.append(line('Начало · с сцены', this.number(d.t ?? s.t, (t) => this.setPatch({ t }), 0.05, 0, 300, 'Начало')));
    if (s.do === 'clip') { this.content.append(button('Редактировать ключевые позы', () => { this.tab = 'pose'; this.renderInspector(); }, 'wide')); return; }
    this.content.append(line('Длительность · с', this.number(d.dur ?? s.dur ?? 0, (dur) => this.setPatch({ dur }), 0.05, 0, 60, 'Длительность')));
    const ease = d.ease ?? s.ease ?? (s.do === 'actor' ? 'inOutQuad' : 'inOutSine');
    this.content.append(line('Характер движения', this.select(ease, Object.keys(Ease).map((v) => ({ value: v as EaseId, label: easeNames[v as EaseId] ?? v })), (v) => this.setPatch({ ease: v }), 'Характер движения')), this.curve(ease));
    if (s.do === 'actor') {
      if (s.moveTo) {
        if (added) this.content.append(this.vector('Конечная точка · оси сцены', s.moveTo, (moveTo) => this.change(() => { if (s.do === 'actor') s.moveTo = moveTo; })));
        else this.content.append(this.vector('Смещение конечной точки', d.moveOffset ?? [0, 0, 0], (moveOffset) => this.setPatch({ moveOffset })));
        if (!added) {
          this.content.append($('h3', '', 'Траектория'), $('p', 'muted', 'Промежуточные точки отклоняют путь от прямой. Начало и конец сохраняются.'));
          for (const [i, bend] of (d.bends ?? []).entries()) {
            this.content.append(this.vector(`Точка ${i + 1}`, bend, (v) => { const bends = structuredClone(d.bends!); bends[i] = v; this.setPatch({ bends }); }), button(`Удалить точку ${i + 1}`, () => this.setPatch({ bends: d.bends!.filter((_, j) => i !== j) }), 'wide quiet'));
          }
          this.content.append(button('+ Точка траектории', () => this.setPatch({ bends: [...d.bends ?? [], [0, 0, 0]] }), 'wide'));
        }
      }
      if (s.lookAt) {
        this.content.append(line('Плавный разворот · с', this.number(d.turn ?? s.turn ?? 0, (turn) => this.setPatch({ turn }), 0.05, 0, 10, 'Разворот')));
        if (added) this.content.append(this.vector('Смотреть на · оси сцены', s.lookAt, (lookAt) => this.change(() => { if (s.do === 'actor') s.lookAt = lookAt; })));
        else this.content.append(this.vector('Смещение точки взгляда', d.lookOffset ?? [0, 0, 0], (lookOffset) => this.setPatch({ lookOffset })));
      }
      if (this.spec.id === 'hierophantEnd' && s.t >= 4.4 && s.t <= 4.6) this.content.append($('p', 'pose-warning', 'Конец этого движения определяет контакт клинка с маской. После правки проверьте момент контакта на вкладке «Поза».'));
      this.content.append(button('Сделать движение мягче', () => this.setPatch({ ease: 'inOutSine', turn: 0.3 }), 'wide'));
    } else if (s.do === 'cam') {
      this.content.append(line('Угол обзора · °', this.number(d.fov ?? s.fov ?? 48, (fov) => this.setPatch({ fov }), 1, 10, 120, 'Угол обзора')), line('Наклон кадра · °', this.number((d.roll ?? s.roll ?? 0) * 180 / Math.PI, (v) => this.setPatch({ roll: v * Math.PI / 180 }), 1, -180, 180, 'Наклон')));
      this.cameraPoint = clamp(this.cameraPoint, 0, s.path.length - 1); this.cameraLookPoint = clamp(this.cameraLookPoint, 0, s.look.length - 1);
      this.content.append(line('Точка пути камеры', this.select(String(this.cameraPoint), s.path.map((_, i) => ({ value: String(i), label: `Точка ${i + 1} · ${Math.round(i / Math.max(1, s.path.length - 1) * 100)} % плана` })), (v) => { this.cameraPoint = Number(v); this.renderInspector(); }, 'Точка пути камеры')));
      this.content.append(this.vector('Смещение камеры', d.pathOffsets?.[this.cameraPoint] ?? [0, 0, 0], (v) => { const offsets = s.path.map((_, j) => d.pathOffsets?.[j] ?? [0, 0, 0] as V3); offsets[this.cameraPoint] = v; this.setPatch({ pathOffsets: offsets }); }));
      this.content.append(line('Точка взгляда камеры', this.select(String(this.cameraLookPoint), s.look.map((_, i) => ({ value: String(i), label: `Точка ${i + 1}` })), (v) => { this.cameraLookPoint = Number(v); this.renderInspector(); }, 'Точка взгляда камеры')));
      this.content.append(this.vector('Смещение цели камеры', d.lookOffsets?.[this.cameraLookPoint] ?? [0, 0, 0], (v) => { const offsets = s.look.map((_, j) => d.lookOffsets?.[j] ?? [0, 0, 0] as V3); offsets[this.cameraLookPoint] = v; this.setPatch({ lookOffsets: offsets }); }));
    }
    this.content.append($('div', 'divider'), button(added ? 'Удалить движение' : 'Сбросить этот фрагмент', () => this.change(() => {
      const edit = this.currentEdit(true); if (added) edit.added!.splice(Number(e.key.split(':')[1]), 1); else delete edit.steps[e.key];
    }), 'wide quiet danger'));
  }

  private clipDefinition(s: CineStep, d?: StepEdit): ClipDef | undefined {
    if (s.do !== 'clip') return undefined;
    return d?.definition ?? s.definition ?? (s.who === 'hero' ? HERO_CLIPS : BOSS_CLIPS).find((c) => c.id === (d?.clip ?? s.clip));
  }
  private writeDefinition(def: ClipDef): void { this.setPatch({ definition: def }); }
  private renderPose(): void {
    const e = this.entry(), s = e?.s, d = this.patch();
    this.content.append($('span', 'tag', 'КЛЮЧЕВЫЕ ПОЗЫ'), $('h2', '', s?.do === 'clip' ? names(s) : 'Поза персонажа'));
    const clips = this.entries().filter((x) => x.s.do === 'clip');
    if (clips.length) this.content.append(line('Фрагмент анимации', this.select(s?.do === 'clip' ? this.selected : '', [{ value: '', label: 'Выберите фрагмент' }, ...clips.map((x) => ({ value: x.key, label: `${fmt(x.s.t / this.rate())} с · ${names(x.s)}` }))], (key) => { if (!key) return; this.selected = key; this.keyIndex = 0; this.renderInspector(); this.renderTimeline(); }, 'Фрагмент анимации')));
    if (s?.do !== 'clip') {
      this.content.append($('p', 'help', 'Выберите клип в таймлайне. Можно добавить свою позу любого персонажа в текущем кадре.'));
      this.actorSelect(); this.content.append(button('+ Поза в текущем кадре', () => this.addPose(), 'wide')); return;
    }
    const def = this.clipDefinition(s, d); if (!def) { this.content.append($('p', 'help', 'Клип не найден.')); return; }
    this.actor = s.who; this.keyIndex = clamp(this.keyIndex, 0, def.keys.length - 1);
    const key = def.keys[this.keyIndex], speed = d.speed ?? s.speed ?? 1;
    const editDef = (fn: (v: ClipDef) => void) => { const v = structuredClone(def); fn(v); this.writeDefinition(v); };
    this.content.append(line('Скорость клипа', this.number(speed, (v) => this.setPatch({ speed: v }), 0.05, 0.1, 4, 'Скорость клипа')), line('Смешивание на входе · с', this.number(d.blend ?? s.blend ?? 0.12, (blend) => this.setPatch({ blend }), 0.02, 0, 5, 'Смешивание')));
    this.content.append(line('Длина клипа · с', this.number(def.dur, (dur) => editDef((v) => {
      const k = dur / v.dur; v.keys.forEach((key) => { key.t *= k; }); v.events?.forEach((ev) => { ev.t *= k; }); v.dur = dur;
    }), 0.05, 0.05, 60, 'Длина клипа')));
    const keyList = $('div', 'key-list');
    def.keys.forEach((k, i) => keyList.append(button(`${fmt(k.t)} с`, () => { this.keyIndex = i; this.seek(((d.t ?? s.t) + k.t / speed) / this.rate()); this.renderInspector(); }, i === this.keyIndex ? 'active' : '')));
    this.content.append($('h3', '', 'Ключевые кадры'), keyList);
    this.content.append(line('Время ключа · с клипа', this.number(key.t, (t) => editDef((v) => { v.keys[this.keyIndex].t = t; v.keys.sort((a, b) => a.t - b.t); this.keyIndex = v.keys.findIndex((k) => k.t === t); }), 0.02, this.keyIndex ? def.keys[this.keyIndex - 1].t + 0.001 : 0, this.keyIndex < def.keys.length - 1 ? def.keys[this.keyIndex + 1].t - 0.001 : def.dur, 'Время ключа')));
    this.content.append(line('Переход к этой позе', this.select(key.ease ?? 'inOutQuad', Object.keys(Ease).map((v) => ({ value: v as EaseId, label: easeNames[v as EaseId] ?? v })), (ease) => editDef((v) => { v.keys[this.keyIndex].ease = ease; }), 'Переход позы')));
    const joints = this.preview.joints(s.who).filter((n) => !n.startsWith('halo') && !n.startsWith('c1') && !n.startsWith('c2') && !n.startsWith('censer'));
    if (!joints.includes(this.joint)) this.joint = joints.includes('chest') ? 'chest' : joints[0];
    const jointNames: Record<string, string> = { chest: 'Грудь', pelvis: 'Таз', spine: 'Поясница', head: 'Голова', neck: 'Шея', shR: 'Правое плечо', shL: 'Левое плечо', elbR: 'Правый локоть', elbL: 'Левый локоть', handR: 'Правая кисть', handL: 'Левая кисть', hipL: 'Левое бедро', hipR: 'Правое бедро', kneeL: 'Левое колено', kneeR: 'Правое колено', footL: 'Левая стопа', footR: 'Правая стопа', blade: 'Клинок', body: 'Корпус', bell: 'Маска / голова' };
    this.content.append(line('Сустав', this.select(this.joint, joints.map((value) => ({ value, label: jointNames[value] ?? value })), (n) => { this.joint = n; this.renderInspector(); }, 'Сустав')));
    let angles: V3 = [0, 0, 0];
    for (let i = 0; i <= this.keyIndex; i++) if (def.keys[i].pose[this.joint]) angles = def.keys[i].pose[this.joint];
    this.content.append(this.vector('Поворот сустава · градусы', angles, (v) => editDef((c) => { c.keys[this.keyIndex].pose[this.joint] = v; }), true));
    this.content.append(this.vector('Смещение корня позы', key.rootOffset ?? [0, 0, 0], (v) => editDef((c) => { c.keys[this.keyIndex].rootOffset = v; })));
    this.content.append($('p', 'field-note', 'В сценических клипах X/Z корня и spin подавлены движком. Путь персонажа задаётся на вкладке «Движение»; высота позы Y применяется.'));
    this.content.append(button('+ Ключ в текущем кадре', () => this.addKey(def, s, d), 'wide'));
    if (def.keys.length > 1) this.content.append(button('Удалить выбранный ключ', () => editDef((v) => { v.keys.splice(this.keyIndex, 1); this.keyIndex = Math.max(0, this.keyIndex - 1); }), 'wide quiet'));
    if (def.events?.length) {
      this.content.append($('h3', '', 'Маркеры контакта'));
      def.events.forEach((ev) => this.content.append(line(ev.name, this.number(ev.t, (t) => editDef((v) => { v.events!.find((x) => x.name === ev.name)!.t = t; }), 0.01, 0, def.dur, `Маркер ${ev.name}`))));
      this.content.append($('p', 'pose-warning', 'Маркеры запускают эффект после расчёта скелета. Если меняете удар, проверьте клинок у цели в кадре маркера.'));
      if (s.markers?.contact === 'strike') this.content.append(button('Показать контакт с маской', () => { const contact = def.events?.find((v) => v.name === 'contact'); if (contact) { this.seek(((d.t ?? s.t) + contact.t / speed) / this.rate()); const i = def.keys.findIndex((k) => Math.abs(k.t - contact.t) < 0.001); if (i >= 0) { this.keyIndex = i; this.renderInspector(); } this.toast(`Расстояние от клинка до маски: ${(this.preview.contactError * 100).toFixed(1)} см`); } }, 'wide'));
      if (s.markers?.contact === 'strike') this.content.append(button('Совместить клинок с маской', () => this.alignContact(s, d, def), 'wide'));
    }
    this.content.append(button(e?.added ? 'Удалить свою позу' : 'Сбросить правки клипа', () => this.change(() => { const v = this.currentEdit(true); if (e?.added) v.added!.splice(Number(e.key.split(':')[1]), 1); else delete v.steps[this.selected]; }), 'wide quiet danger'));
  }
  private addKey(def: ClipDef, s: Extract<CineStep, { do: 'clip' }>, d: StepEdit): void {
    const t = clamp((this.preview.time * this.rate() - (d.t ?? s.t)) * (d.speed ?? s.speed ?? 1), 0, def.dur);
    if (def.keys.some((k) => Math.abs(k.t - t) < 0.001)) { this.toast('В этом времени уже есть ключ. Переместите таймлайн.'); return; }
    const layout = s.who === 'hero' ? this.preview.hero.puppet.layout : undefined;
    const k: Key = { t, pose: {}, ease: 'inOutSine' };
    if (layout) {
      const clip = new Clip(def, layout), out = new Float32Array(layout.restRot), root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
      clip.sample(t, out, root);
      const rest = new THREE.Quaternion(), q = new THREE.Quaternion(), euler = new THREE.Euler();
      for (const n of Object.keys(Object.assign({}, ...def.keys.map((v) => v.pose)))) {
        const i = layout.idx(n); rest.fromArray(layout.restRot, i * 4).invert(); q.fromArray(out, i * 4).premultiply(rest); euler.setFromQuaternion(q); k.pose[n] = [euler.x, euler.y, euler.z];
      }
      k.rootOffset = [root.x, root.y, root.z]; k.stretch = root.stretch;
    } else k.pose = this.preview.snapshotPose(s.who).keys[0].pose;
    const next = structuredClone(def); next.keys.push(k); next.keys.sort((a, b) => a.t - b.t); this.keyIndex = next.keys.findIndex((v) => v.t === t); this.writeDefinition(next);
  }
  private actorSelect(): void {
    this.content.append(line('Персонаж', this.select(this.actor, Object.keys(this.spec.actors).map((value) => ({ value, label: ACTOR_NAMES[value] ?? value })), (v) => { this.actor = v; this.renderInspector(); }, 'Персонаж')));
  }
  private addPose(): void {
    if (!this.preview.joints(this.actor).length || (this.spec.model === 'space' && this.actor === 'ship')) { this.toast('У этого предмета настраивается движение. Выберите Пилота для настройки позы.'); return; }
    const definition = this.preview.snapshotPose(this.actor), id = `studio:pose:${this.spec.id}:${Date.now()}`;
    definition.id = id;
    this.change(() => { const e = this.currentEdit(true); e.added ??= []; this.selected = `added:${e.added.length}`; e.added.push({ t: this.preview.time * this.rate(), do: 'clip', who: this.actor, clip: id, definition, blend: 0.25, dur: 1 }); });
    this.tab = 'pose'; this.renderInspector();
  }
  private renderScene(): void {
    this.content.append($('span', 'tag', `${SCENES.indexOf(this.spec) + 1} / ${SCENES.length} · ${this.spec.group}`), $('h2', '', this.spec.title), $('p', 'muted', this.spec.note));
    this.content.append(line('Темп всей сцены', this.number(this.rate(), (rate) => this.change(() => { this.currentEdit(true).rate = rate; }), 0.05, 0.25, 4, 'Темп сцены')));
    this.content.append($('p', 'field-note', 'Меняет движения, камеры, клипы и сюжетные маркеры вместе. 0.8× — медленнее, 1.2× — быстрее. Скорость просмотра сверху не меняет проект.'));
    this.actorSelect();
    const p = this.currentEdit().placements?.[this.actor] ?? { offset: [0, 0, 0] as V3, yaw: 0 };
    const place = (offset: V3, yaw: number) => this.change(() => { const e = this.currentEdit(true); e.placements ??= {}; e.placements[this.actor] = { offset, yaw }; });
    this.content.append(this.vector('Начальная расстановка · смещение', p.offset, (v) => place(v, p.yaw)), line('Начальный поворот · °', this.number(p.yaw * 180 / Math.PI, (v) => place(p.offset, v * Math.PI / 180), 5, -720, 720, 'Начальный поворот')));
    this.content.append($('p', 'field-note', 'Сдвигает стартовую позицию. Концы последующих движений и контакты настраиваются отдельно.'));
    this.content.append(button('+ Движение в текущем кадре', () => {
      const a = this.preview.actors[this.actor]; if (!a) return;
      const o = this.spec.track.origin ?? [0, 0, 0], heading = this.spec.track.heading ?? 0;
      const moveTo = offsetWorld([a.x - o[0], a.y - o[1], a.z - o[2]], -heading);
      this.change(() => { const e = this.currentEdit(true); e.added ??= []; this.selected = `added:${e.added.length}`; e.added.push({ t: this.preview.time * this.rate(), do: 'actor', who: this.actor, moveTo, dur: 1, ease: 'inOutSine' }); });
      this.tab = 'move'; this.renderInspector();
    }, 'wide'), button('+ Поза в текущем кадре', () => this.addPose(), 'wide'));
    this.content.append(button('+ Разворот в текущем кадре', () => {
      const a = this.preview.actors[this.actor]; if (!a) return;
      const o = this.spec.track.origin ?? [0, 0, 0], heading = this.spec.track.heading ?? 0;
      const lookAt = offsetWorld([a.x + Math.sin(a.facing) * 4 - o[0], a.y - o[1], a.z + Math.cos(a.facing) * 4 - o[2]], -heading);
      this.change(() => { const e = this.currentEdit(true); e.added ??= []; this.selected = `added:${e.added.length}`; e.added.push({ t: this.preview.time * this.rate(), do: 'actor', who: this.actor, lookAt, turn: 0.4, dur: 0.4 }); });
      this.tab = 'move'; this.renderInspector();
    }, 'wide'));
    const replayIds = ['prologue', 'prologueLanding', 'hierophantIntro', 'hierophantEnd', 'hierophantCollapse', 'hierophantCrack', 'killGate', 'killBell'];
    if (replayIds.includes(this.spec.id)) this.content.append(button('Просмотр в игре ↗', () => {
      this.change(() => { this.project.enabled = true; }); this.persist();
      const url = new URL('./', location.href); url.searchParams.set('scene', this.spec.id); url.searchParams.set('studioPreview', '1'); url.searchParams.set('variant', this.variant);
      window.open(url, '_blank', 'noopener');
    }, 'wide primary'));
    this.content.append(button('Плавная постановка · пресет', () => this.smoothPreset(), 'wide'));
    this.content.append($('p', 'help', 'Предпросмотр использует оригинальные риги и Director. Площадка не воспроизводит бой, звук и физику обломков. Полный результат проверяется в игре.'));
    this.content.append(button('Сбросить эту версию сцены', () => this.change(() => { if (this.project.scenes[this.spec.id]) delete this.project.scenes[this.spec.id][this.variant]; }), 'wide quiet danger'));
    this.content.append(button('Экспортировать весь проект', () => this.export(), 'wide quiet'));
  }
  private smoothPreset(): void {
    this.change(() => {
      const e = this.currentEdit(true);
      for (const { s, key, added } of this.entries()) if (!added && s.do === 'actor') {
        // Контакт и падение сохраняют ускорение и прежние тайминги.
        const contact = this.spec.id === 'hierophantEnd' && s.t >= 4.4 && s.t <= 4.6;
        const falling = s.moveTo?.[1] === 0 && (s.ease === 'inQuad' || s.ease === 'inExpo');
        e.steps[key] = { ...e.steps[key], ...(!contact && !falling ? { ease: 'inOutSine' as EaseId } : {}), ...(s.lookAt ? { turn: 0.3 } : {}) };
      }
      for (const { s, key, added } of this.entries()) if (!added && s.do === 'clip' && s.clip !== 'maskStrike') e.steps[key] = { ...e.steps[key], blend: s.clip === 'chainApex' ? 0.3 : 0.18 };
    }); this.toast('Пресет применён. Контакт удара и сюжетные маркеры сохранены.');
  }
  private alignContact(s: Extract<CineStep, { do: 'clip' }>, d: StepEdit, def: ClipDef): void {
    const contact = def.events?.find((ev) => ev.name === 'contact'); if (!contact) return;
    const localTime = contact.t / (d.speed ?? s.speed ?? 1), t = (d.t ?? s.t) + localTime;
    this.seek(t / this.rate());
    const entry = this.entries().find((e) => !e.added && e.s.do === 'actor' && e.s.who === s.who && Math.abs(e.s.t - s.t) < 0.001 && e.s.moveTo);
    if (!entry || entry.s.do !== 'actor' || !entry.s.moveTo) { this.toast('Не найдено движение удара'); return; }
    const h = this.preview.actors.hero, delta = this.preview.contactDelta(), original = entry.s.moveTo;
    const moveOffset = offsetWorld([h.x + delta[0] - original[0], h.y + delta[1] - original[1], h.z + delta[2] - original[2]], -(this.spec.track.heading ?? 0));
    this.change(() => { const e = this.currentEdit(true); e.steps[entry.key] = { ...e.steps[entry.key], moveOffset, t: d.t ?? s.t, dur: localTime }; });
    this.seek(t / this.rate()); this.toast(`Контакт совмещён · ошибка ${(this.preview.contactError * 100).toFixed(1)} см`);
  }
  private export(): void {
    const blob = new Blob([JSON.stringify(this.project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = $('a'); a.href = url; a.download = 'voidbreaker-scenes.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    this.toast('Файл проекта передан в загрузки Android / браузера');
  }
  private toast(message: string): void { clearTimeout(this.toastTimer); this.toastEl.textContent = message; this.toastEl.hidden = false; this.toastTimer = window.setTimeout(() => { this.toastEl.hidden = true; }, 5000); }
  dispose(): void { cancelAnimationFrame(this.raf); this.preview.dispose(); }
}

try { new Studio(); } catch (e) {
  const mount = document.getElementById('studio')!; const p = $('p', 'loading', `Студия не запустилась: ${(e as Error).message}. Включите WebGL в браузере и обновите страницу. Сохранённый проект остаётся на устройстве.`); mount.replaceChildren(p);
  console.error(e);
}
