import type { App } from '../../game/app';
import { h } from '../dom';
import { titleCanvas } from '../font';
import { iconCanvas } from '../icons';
import { logoCanvas } from '../logo';
import { enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen } from '../fullscreen';

/** Титул (GDD §19.2): логотип собственными глифами, медленный пролёт по руинам, «НАЖМИТЕ, ЧТОБЫ НАЧАТЬ» (заодно разблокирует аудио). */
export function titleScreen(app: App): HTMLElement {
  const lh = Math.max(30, Math.min(88, innerWidth / 15));
  const logo = logoCanvas('VOIDBREAKER', lh);
  logo.el.style.marginBottom = `${-lh * 0.45}px`;
  const start = () => {
    app.ctx.audio.unlock();
    if (app.ctx.settings.fullscreen) void enterFullscreen();
    app.sfx('ui_confirm');
    if (!app.ctx.flag('prologue')) app.go('prologue');
    else app.go('hub');
  };
  const corner = (icon: 'gear' | 'fullscreen', label: string, fn: () => void) => h('button', { class: 'vb-iconbtn', 'aria-label': label,
    onPointerdown: (e: Event) => { e.stopPropagation(); app.ctx.audio.unlock(); app.sfx('ui_click'); fn(); } }, iconCanvas(icon, 22, '#f0d9a0', 'rgba(240,200,120,.5)'));
  const el = h('div', { class: 'vb-screen', style: { display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(5,7,10,.78) 100%)' }, onPointerdown: start },
    h('div', { class: 'vb-col', style: { alignItems: 'center', gap: '6px', marginTop: '-8vh' } },
      logo.el,
      titleCanvas('Разрушитель Пустоты', Math.max(12, lh * 0.2), { color: 'steel', glow: 0.5, spacing: 0.35 }),
      h('div', { class: 'vb-rule', style: { width: `${Math.min(420, innerWidth * 0.5)}px` } }),
      h('div', { class: 'vb-caps vb-pulse', style: { marginTop: '15vh', fontSize: '13px', color: '#f0d9a0', letterSpacing: '.4em' } }, 'Нажмите, чтобы начать'),
    ),
    h('div', { class: 'vb-row', style: { position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', right: 'max(16px, env(safe-area-inset-right))', gap: '14px' } },
      fullscreenSupported() ? corner('fullscreen', 'Полный экран', () => { void (isFullscreen() ? exitFullscreen() : enterFullscreen()); app.ctx.settings.fullscreen = !isFullscreen(); app.save(); }) : null,
      corner('gear', 'Настройки', () => app.openSettings('title'))),
    h('div', { class: 'vb-dim vb-tech', style: { position: 'absolute', bottom: 'max(12px, env(safe-area-inset-bottom))', right: '20px', fontSize: '10px', letterSpacing: '.18em' } }, 'v0.2 · вся графика и звук созданы кодом'),
  );
  // анимация: разрез раскрывается, по металлу бежит блик
  const t0 = performance.now();
  const tick = () => {
    if (!el.isConnected && performance.now() - t0 > 500) return;
    const t = (performance.now() - t0) / 1000;
    logo.draw(Math.min(1, Math.max(0, (t - 0.3) / 0.6)), t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  const box = h('div', { class: 'vb-col', style: { maxWidth: '660px', gap: '18px', fontSize: '18px', lineHeight: '1.65', color: '#ede6d6' } });
  const el = h('div', { class: 'vb-screen', style: { display: 'grid', placeItems: 'center', background: 'radial-gradient(ellipse at 50% 45%, rgba(10,15,22,.82), rgba(5,7,10,.96))', cursor: 'pointer' } },
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
    if (!cur) { cur = h('div', { class: 'vb-type' }); box.appendChild(cur); if (li === 2) { cur.style.color = '#d6c4ff'; cur.style.fontWeight = '700'; } }
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
