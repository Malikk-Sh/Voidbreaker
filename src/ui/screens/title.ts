import type { App } from '../../game/app';
import { h } from '../dom';
import { titleCanvas } from '../font';

/** Титул (GDD §19.2): чёрное солнце, медленный пролёт по руинам, «НАЖМИТЕ, ЧТОБЫ НАЧАТЬ» (заодно разблокирует аудио). */
export function titleScreen(app: App): HTMLElement {
  const size = Math.max(34, Math.min(104, innerWidth / 13.5));
  const title = titleCanvas('VOIDBREAKER', size, { color: 'void', glow: 1.2, spacing: 1.4, weight: 1.05 });
  title.className = 'vb-stamp';
  const start = () => {
    app.ctx.audio.unlock();
    app.sfx('ui_confirm');
    if (!app.ctx.flag('prologue')) app.go('prologue');
    else app.go('hub');
  };
  const el = h('div', { class: 'vb-screen', style: { display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'radial-gradient(ellipse at 50% 55%, transparent 30%, rgba(7,6,11,.75) 100%)' }, onPointerdown: start },
    h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '-6vh' } },
      title,
      h('div', { class: 'vb-caps', style: { letterSpacing: '.6em', color: '#cbbfe0' } }, 'Разрушитель Пустоты'),
      h('div', { class: 'vb-rule', style: { width: '240px' } }),
      h('div', { class: 'vb-caps vb-pulse', style: { marginTop: '18vh', fontSize: '13px', color: '#e2c27a' } }, 'Нажмите, чтобы начать'),
    ),
    h('div', { class: 'vb-dim', style: { position: 'absolute', bottom: 'max(12px, env(safe-area-inset-bottom))', right: '20px', fontSize: '10px', letterSpacing: '.2em' } }, 'v0.1 · вся графика и звук созданы кодом'),
  );
  const onKey = (e: KeyboardEvent) => {
    // экран уже снят — слушатель больше не нужен (иначе Пробел в бою «стартует» игру заново)
    if (!el.isConnected) { removeEventListener('keydown', onKey); return; }
    if (e.code === 'Enter' || e.code === 'Space') { removeEventListener('keydown', onKey); start(); }
  };
  addEventListener('keydown', onKey);
  return el;
}

/** Пролог: 2–4 строки бегущим текстом, пропуск тапом — и в бой (GDD §2.3, §20). */
export function prologueScreen(app: App): HTMLElement {
  const lines = [
    'Корабль «Иней» разбился о шпиль собора, построенного вокруг умирающей звезды.',
    'Уцелели клинок из обломка обшивки — и Каэлис, бортовой ИИ, переписавший себя в доспех.',
    '— Пилот. Вставай. Звёзды гаснут, и, кажется, нас уже ждут.',
  ];
  const box = h('div', { class: 'vb-col', style: { maxWidth: '640px', gap: '18px', fontSize: '17px', lineHeight: '1.6', fontStyle: 'italic', color: '#e8dff5' } });
  const el = h('div', { class: 'vb-screen', style: { display: 'grid', placeItems: 'center', background: 'rgba(7,6,11,.92)', cursor: 'pointer' } },
    box,
    h('div', { class: 'vb-caps vb-pulse', style: { position: 'absolute', bottom: '24px', right: '28px', fontSize: '10px' } }, 'тап — пропустить'),
  );
  let li = 0, ci = 0, done = false;
  let cur: HTMLElement | null = null;
  const finish = () => {
    if (done) return;
    done = true;
    app.ctx.setFlag('prologue');
    app.startStage('1-1');
  };
  const tick = () => {
    if (done) return;
    if (li >= lines.length) { setTimeout(finish, 1200); return; }
    if (!cur) { cur = h('div', { class: 'vb-type' }); box.appendChild(cur); if (li === 2) cur.style.color = '#B794FF'; }
    ci++;
    cur.textContent = lines[li].slice(0, ci);
    if (ci % 3 === 0 && li === 2) app.ctx.audio.speak('и', 1.1);
    if (ci >= lines[li].length) { li++; ci = 0; cur = null; setTimeout(tick, 650); return; }
    setTimeout(tick, 28);
  };
  setTimeout(tick, 400);
  el.addEventListener('pointerdown', () => { if (li < lines.length) { li = lines.length; box.innerHTML = lines.map((l) => `<div>${l}</div>`).join(''); setTimeout(finish, 600); } else finish(); });
  return el;
}
