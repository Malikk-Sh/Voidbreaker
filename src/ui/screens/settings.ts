import type { App } from '../../game/app';
import type { Settings } from '../../meta/settings';
import { exportSave, importSave, newSave, writeSave } from '../../meta/save';
import { h } from '../dom';
import { titleCanvas } from '../font';
import { iconCanvas } from '../icons';
import { enterFullscreen, exitFullscreen, fullscreenSupported } from '../fullscreen';

/** Доступность и настройки (GDD §21). */
export function settingsScreen(app: App, back: () => void): HTMLElement {
  const S = app.ctx.settings;
  const apply = () => { app.game.applySettings(); writeSave(app.ctx.save); };

  const slider = (label: string, key: keyof Settings, min = 0, max = 1, step = 0.05) => {
    const val = h('span', { class: 'vb-gold', style: { width: '44px', textAlign: 'right', fontSize: '12px' } }, `${Math.round((S[key] as number) * 100)}%`);
    const inp = h('input', { type: 'range', class: 'vb-slider', min, max, step, value: S[key] as number }) as HTMLInputElement;
    inp.addEventListener('input', () => { (S as unknown as Record<string, number>)[key] = Number(inp.value); val.textContent = `${Math.round(Number(inp.value) * 100)}%`; apply(); });
    return h('div', { class: 'vb-row' }, h('span', { style: { width: '42%', fontSize: '13px' } }, label), inp, val);
  };
  const toggle = <K extends keyof Settings>(label: string, key: K, opts: [Settings[K], string][], onChange?: () => void) => {
    const box = h('div', { class: 'vb-toggle' });
    const render = () => box.replaceChildren(...opts.map(([v, t]) => h('button', { class: S[key] === v ? 'on' : '', onClick: () => { S[key] = v; app.sfx('ui_click', 0.4); apply(); onChange?.(); render(); } }, t)));
    render();
    return h('div', { class: 'vb-row', style: { justifyContent: 'space-between', flexWrap: 'wrap' } }, h('span', { style: { fontSize: '13px' } }, label), box);
  };
  const section = (t: string) => h('div', { class: 'vb-caps vb-gold', style: { marginTop: '10px' } }, t);

  const io = h('textarea', { rows: 2, style: { width: '100%', background: 'rgba(10,8,16,.8)', color: '#cbbfe0', border: '1px solid rgba(184,149,78,.4)', fontSize: '10px', fontFamily: 'monospace' } }) as HTMLTextAreaElement;
  let resetConfirm = false;
  const resetBtn = h('button', { class: 'vb-btn small', onClick: () => {
    if (!resetConfirm) { resetConfirm = true; resetBtn.textContent = 'Стереть всё?'; return; }
    const fresh = newSave();
    fresh.settings = app.ctx.save.settings;
    Object.assign(app.ctx.save, fresh);
    writeSave(app.ctx.save, true);
    app.go('title');
  } }, 'Сбросить прогресс');

  const content = h('div', { class: 'vb-col vb-scroll', style: { flex: '1', minHeight: '0', paddingRight: '8px', gap: '8px' } },
    section('Экран'),
    fullscreenSupported()
      ? toggle('Полноэкранный режим', 'fullscreen', [[false, 'Выкл'], [true, 'Вкл']], () => { if (S.fullscreen) void enterFullscreen(); else void exitFullscreen(); })
      : h('div', { class: 'vb-dim', style: { fontSize: '12px' } }, 'Полноэкранный режим: добавьте игру на главный экран («Поделиться» → «На экран Домой»).'),
    slider('Дистанция камеры', 'camDist', 0.75, 1.3, 0.05),
    section('Звук'),
    slider('Общая громкость', 'volMaster'), slider('Музыка', 'volMusic'), slider('Эффекты', 'volSfx'), slider('Голос', 'volVoice'),
    h('div', { class: 'vb-dim', style: { fontSize: '11px' } }, 'iOS: в беззвучном режиме Web Audio может молчать — выключите беззвучный режим.'),
    section('Изображение'),
    toggle('Качество', 'quality', [['auto', 'Авто'], ['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']]),
    slider('Тряска камеры', 'shake'),
    toggle('Вспышки', 'flashes', [[true, 'Вкл'], [false, 'Выкл']]),
    toggle('Режим без вспышек', 'photosensitive', [[false, 'Выкл'], [true, 'Вкл']]),
    toggle('Хроматическая аберрация', 'aberration', [[true, 'Вкл'], [false, 'Выкл']]),
    toggle('Искажения волн', 'distortion', [[true, 'Вкл'], [false, 'Выкл']]),
    slider('Штриховка телеграфов (дальтонизм)', 'hatch'),
    toggle('Счётчик FPS', 'showFps', [[false, 'Выкл'], [true, 'Вкл']]),
    section('Управление'),
    toggle('Автоприцел', 'autoAim', [[0, 'Выкл'], [1, 'Слабый'], [2, 'Стандарт'], [3, 'Сильный']]),
    toggle('Вибрация', 'vibration', [[true, 'Вкл'], [false, 'Выкл']]),
    slider('Размер кнопок', 'buttonScale', 0.7, 1.4, 0.05),
    slider('Размер субтитров', 'subtitleSize', 0.8, 1.6, 0.05),
    section('Сложность'),
    toggle('Режим «История» (−40 % урона по Пилоту, без ★★★)', 'story', [[false, 'Выкл'], [true, 'Вкл']]),
    section('Сохранение'),
    h('div', { class: 'vb-row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'vb-btn small', onClick: () => { io.value = exportSave(app.ctx.save); io.select(); app.sfx('ui_click'); } }, 'Экспорт'),
      h('button', { class: 'vb-btn small', onClick: () => {
        const s = importSave(io.value);
        if (!s) { io.value = 'Строка повреждена'; return; }
        Object.assign(app.ctx.save, s);
        app.ctx.settings = app.ctx.save.settings;
        app.game.applySettings();
        writeSave(app.ctx.save, true);
        app.sfx('ui_upgrade');
        app.go('hub');
      } }, 'Импорт'),
      resetBtn),
    io,
  );

  return h('div', { class: 'vb-screen vb-fade', style: { display: 'grid', placeItems: 'center', background: 'rgba(7,6,11,.7)' } },
    h('div', { class: 'vb-panel vb-col', style: { width: 'min(640px, 94vw)', height: 'min(560px, 92vh)', gap: '6px' } },
      h('div', { class: 'vb-row', style: { justifyContent: 'space-between' } },
        titleCanvas('НАСТРОЙКИ', 22, { color: 'gold', glow: 0.6 }),
        h('button', { class: 'vb-iconbtn', 'aria-label': 'Назад', onClick: () => { app.sfx('ui_back'); back(); } }, iconCanvas('back', 26, '#e2c27a', 'rgba(139,92,246,.6)'))),
      content,
    ),
  );
}
