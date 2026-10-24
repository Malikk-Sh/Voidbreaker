import type { App } from '../../game/app';
import { fmtTime, h } from '../dom';
import { titleCanvas } from '../font';
import { settingsScreen } from './settings';

/** Пауза (GDD §19.2): продолжить, настройки, выйти (с подтверждением). Автопауза на visibilitychange. */
export function pauseScreen(app: App): HTMLElement {
  const b = app.game.battle;
  let confirm = false;
  const exitBtn = h('button', { class: 'vb-btn', onClick: () => {
    if (!confirm) { confirm = true; exitBtn.textContent = 'Точно выйти?'; app.sfx('ui_click'); return; }
    app.sfx('ui_back');
    app.go('hub');
  } }, 'Покинуть этап');
  // низкий экран (телефон в ландшафте, 844×390): кнопки слева, список справа — иначе список уходит за край
  const short = innerHeight < 520;
  const label = b ? `${b.stage.boss ? 'Босс' : b.stage.training ? 'Зал' : `Этап ${b.stage.id}`} · ${b.stage.name} · ${fmtTime(b.world.run.time)}` : '';
  const controls = h('div', { class: 'vb-col', style: { alignItems: 'center', gap: short ? '10px' : '14px' } },
    titleCanvas('Пауза', short ? 30 : 46, { color: 'gold', glow: 0.9, spacing: 0.1 }),
    b ? h('div', { class: 'vb-caps vb-dim' }, label) : null,
    h('button', { class: 'vb-btn primary', style: { minWidth: '240px' }, onClick: () => { app.sfx('ui_confirm'); app.resume(); } }, 'Продолжить'),
    h('button', { class: 'vb-btn', style: { minWidth: '240px' }, onClick: () => {
      app.sfx('ui_click');
      app.openOverlay(settingsScreen(app, () => app.openOverlay(pauseScreen(app))));
    } }, 'Настройки'),
    exitBtn,
  );
  const drills = b?.trainingDrills;
  const panelStyle = { padding: '10px 18px', maxWidth: short ? '440px' : '620px', maxHeight: short ? `${innerHeight - 40}px` : 'none', overflowY: 'auto' as const };
  // тренировочный зал: полный список упражнений с состоянием (на экране боя — только активное)
  const panel = drills
    ? h('div', { class: 'vb-panel', style: panelStyle },
      h('div', { class: 'vb-caps vb-gold', style: { marginBottom: '6px' } }, `Упражнения · засчитано ${drills.filter((d) => d.state === 'done').length} из ${drills.length}`),
      h('div', { class: 'vb-kv text' }, ...drills.flatMap((d) => [
        h('span', { class: d.state === 'done' ? 'vb-gold' : '' }, d.state === 'done' ? '◆ засчитано' : d.state === 'performed' ? '◇ нужно попадание' : '◇'),
        h('span', {}, d.text),
      ])),
      h('div', { class: 'vb-dim', style: { fontSize: '11px', marginTop: '6px' } }, 'Засчитывается попадание нужным приёмом. Жнец бьёт без урона.'))
    : h('div', { class: 'vb-panel', style: panelStyle },
      h('div', { class: 'vb-caps vb-gold', style: { marginBottom: '6px' } }, 'Приёмы'),
      h('div', { class: 'vb-kv text' },
        h('span', {}, 'Атака ×4'), h('span', {}, 'разрезы → вращение → Нисходящий разлом'),
        h('span', {}, 'Рывок + атака'), h('span', {}, 'Рассечение → Восходящий месяц → Звездопад'),
        h('span', {}, 'Пауза после 2-го'), h('span', {}, 'Шквал → Крест'),
        h('span', {}, 'После идеал. уклон.'), h('span', {}, 'атака — Контрудар сквозь врага'),
        h('span', {}, 'Удержание атаки'), h('span', {}, 'рассекающий удар; полный заряд — волна Пустоты'),
        h('span', {}, 'Враг оглушён'), h('span', {}, 'финишер или полный заряд — Раскол')));
  const keys = short ? null : h('div', { class: 'vb-dim', style: { fontSize: '11px', marginTop: '4px', letterSpacing: '.08em', textAlign: 'center' } }, 'Esc / P — пауза · WASD — движение · ЛКМ/J — атака · Пробел/Shift — рывок · Q E R — способности');
  const el = h('div', { class: 'vb-screen vb-fade', style: { display: 'grid', placeItems: 'center', background: 'radial-gradient(ellipse at center, rgba(10,15,22,.7), rgba(5,7,10,.88))' } },
    short
      ? h('div', { class: 'vb-row', style: { alignItems: 'center', gap: '28px' } }, controls, panel)
      : h('div', { class: 'vb-col', style: { alignItems: 'center', gap: '14px' } }, controls, panel, keys),
  );
  return el;
}
