import type { App, ResultsData } from '../../game/app';
import { ABILITIES } from '../../data/abilities';
import { LORE } from '../../data/lore';
import { stageById } from '../../data/stages';
import { RELICS } from '../../meta/progression';
import { fmtNum, fmtTime, h } from '../dom';
import { titleCanvas } from '../font';
import { iconCanvas } from '../icons';

/** Контекстные советы при поражении (GDD §19.2). */
function tip(src: string | undefined, stageId: string): string {
  if (src === 'ring') return 'Звон: ищи разрыв в кольце — или проскочи сквозь волну рывком в момент касания.';
  if (src === 'projectile') return 'Око и Аколит бьют издалека: подойди вплотную или срежь их Серпом Луны.';
  if (src === 'golem') return 'Голем медлителен: после удара у него долгое окно. Заряженный удар ломает стойку.';
  if (src === 'reaper') return 'Жнец выдаёт выпад красной линией. Рывок вбок в последний миг — идеальное уклонение.';
  if (src === 'fall') return 'Над бездной рывок не упирается в край. Следи за плитами под ногами.';
  if (src === 'smoke') return 'Дым кадил ранит, пока в нём стоишь. Уходи из серых облаков.';
  if (stageId === 'boss1') return 'Падение колокола оставляет Иерофанта уязвимым на 2 с — стойка ломается вдвое быстрее.';
  return 'Ранг комбо растёт, пока тебя не задели. Используй рывок: первые 0.14 с ты неуязвим.';
}

/** Экран результатов (GDD §15.9, §19.2): ранг-штамп, звёзды загораются по очереди, Осколки «высыпаются» в счётчик. */
export function resultsScreen(app: App, d: ResultsData): HTMLElement {
  const def = stageById(d.stageId)!;
  const won = d.cleared;
  const short = innerHeight < 520;
  const rankEl = h('div', { class: 'vb-stamp', style: { animationDelay: '.5s' } }, titleCanvas(d.result.rank, short ? 62 : 92, { color: d.result.rank.startsWith('S') ? 'void' : 'gold', glow: 1.3 }));
  const stars = [1, 2, 3].map(() => h('span', { class: 'vb-star' }, '★'));
  const shardsEl = h('span', {}, '0');
  const conds = ['Пройти этап', 'Закончить с ≥ 50 % HP', 'Финальный ранг A или выше'];
  const next = app.nextStageId(d.stageId);
  const nextOk = won && next && (stageById(next)!.boss ? true : true);

  const buttons = h('div', { class: 'vb-row', style: { gap: '12px', flexWrap: 'wrap', justifyContent: 'center', position: 'absolute', left: '0', right: '0', bottom: 'max(12px, env(safe-area-inset-bottom))' } },
    h('button', { class: 'vb-btn', onClick: () => { app.sfx('ui_confirm'); app.startStage(d.stageId); } }, 'Повторить'),
    h('button', { class: 'vb-btn', onClick: () => { app.sfx('ui_back'); app.go('hub'); } }, won ? 'Святилище' : 'Улучшиться'),
    won && nextOk ? h('button', { class: 'vb-btn primary', onClick: () => { app.sfx('ui_confirm'); app.go('map'); } }, 'Дальше') : null,
  );

  const extras: HTMLElement[] = [];
  for (const id of d.reward.unlocks) {
    const A = ABILITIES[id];
    extras.push(h('div', { class: 'vb-card vb-row sel' }, iconCanvas(A.icon, 40, '#f3e7c4', 'rgba(139,92,246,1)'),
      h('div', { class: 'vb-col', style: { gap: '2px' } }, h('span', { class: 'vb-caps vb-void' }, 'Новая способность'), h('span', { style: { letterSpacing: '.15em', textTransform: 'uppercase' } }, `${A.name} · ${A.slot.toUpperCase()}`), h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, A.desc))));
  }
  if (d.reward.relic) {
    const R = RELICS[d.reward.relic];
    extras.push(h('div', { class: 'vb-card vb-row sel' }, iconCanvas('relic', 36, '#e2c27a', 'rgba(139,92,246,1)'), h('div', { class: 'vb-col', style: { gap: '2px' } }, h('span', { class: 'vb-caps vb-gold' }, 'Реликвия'), h('span', {}, `${R.name} — ${R.desc}`))));
  }
  if (d.lore) extras.push(h('div', { class: 'vb-card' }, h('span', { class: 'vb-caps vb-gold' }, 'Запись найдена: '), h('span', { style: { fontStyle: 'italic' } }, LORE[d.lore].title)));
  if (d.stageId === '1-4' && won && app.ctx.flag('freePower')) extras.push(h('div', { class: 'vb-card' }, h('span', { class: 'vb-caps vb-void' }, 'Каэлис: '), h('span', { style: { fontStyle: 'italic' } }, '«Загляни в Святилище — я влила в Созвездие немного силы. Бесплатно. На этот раз».')));

  const body = won
    ? h('div', { class: 'vb-row', style: { gap: '28px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' } },
      h('div', { class: 'vb-col', style: { alignItems: 'center', gap: '0' } }, h('span', { class: 'vb-caps vb-dim' }, 'Ранг этапа'), rankEl),
      h('div', { class: 'vb-col', style: { gap: '6px', minWidth: '260px' } },
        h('div', { class: 'vb-row', style: { gap: '8px' } }, ...stars),
        ...conds.map((c, i) => h('div', { style: { fontSize: '12px', color: d.reward.stars > i ? '#e2c27a' : '#6a5a7a' } }, `${'★'.repeat(i + 1)} ${c}`)),
        h('div', { class: 'vb-rule' }),
        h('div', { class: 'vb-row', style: { fontSize: '18px' } }, iconCanvas('shard', 22, '#B794FF', 'rgba(139,92,246,.9)'), shardsEl,
          d.reward.ether ? h('span', { class: 'vb-row', style: { gap: '4px', marginLeft: '16px' } }, iconCanvas('ether', 22, '#f4f1ff', 'rgba(255,255,255,.8)'), `+${d.reward.ether}`) : null),
        h('div', { class: 'vb-dim', style: { fontSize: '12px', lineHeight: '1.7' } },
          `Время ${fmtTime(d.result.time)} · лучшее комбо ${d.bestCombo} · убито ${d.run.kills} · идеальных уклонений ${d.run.perfectDodges} · казней ${d.run.executions}`),
        d.result.story ? h('div', { class: 'vb-dim', style: { fontSize: '11px' } }, 'Режим «История»: ★★★ недоступна') : null))
    : h('div', { class: 'vb-col', style: { alignItems: 'center', gap: '10px', maxWidth: '520px', textAlign: 'center' } },
      h('div', { style: { fontSize: '14px', lineHeight: '1.6', fontStyle: 'italic', color: '#e8dff5' } }, tip(d.deathSource, d.stageId)),
      h('div', { class: 'vb-row', style: { fontSize: '14px' } }, 'Собрано:', iconCanvas('shard', 18, '#B794FF', 'rgba(0,0,0,0)'), fmtNum(d.reward.shards), h('span', { class: 'vb-dim', style: { fontSize: '11px' } }, '(половина подобранного)')));

  const el = h('div', { class: 'vb-screen vb-fade', style: { display: 'grid', placeItems: 'center', background: won ? 'radial-gradient(ellipse at center, rgba(14,8,28,.55), rgba(7,6,11,.9))' : 'radial-gradient(ellipse at center, rgba(40,4,10,.55), rgba(7,6,11,.92))' } },
    h('div', { class: 'vb-col vb-scroll', style: { alignItems: 'center', gap: short ? '4px' : '10px', maxWidth: '92vw', maxHeight: 'calc(100% - 70px)', marginBottom: '56px' } },
      titleCanvas(won ? (def.boss ? 'ЗВЕЗДА ВСПЫХНУЛА' : 'ЭТАП ПРОЙДЕН') : 'ПУСТОТА ОТСТУПАЕТ…', short ? 24 : won ? 34 : 38, { color: won ? 'gold' : 'hunger', glow: 1 }),
      h('div', { class: 'vb-caps vb-dim' }, `${def.boss ? 'Босс' : `Этап ${def.id}`} · ${def.name}`),
      body,
      extras.length ? h('div', { class: 'vb-col', style: { width: 'min(560px, 90vw)' } }, ...extras) : null,
    ),
    buttons,
  );

  // звёзды загораются последовательно (0.25 с каждая), Осколки «высыпаются» в счётчик
  if (won) {
    app.ctx.audio.play('victory', { gain: 0.6 });
    for (let i = 0; i < d.reward.stars; i++) setTimeout(() => { stars[i].classList.add('lit'); app.sfx('ui_confirm', 0.5 + i * 0.15); }, 900 + i * 250);
    const total = d.reward.shards;
    const t0 = performance.now() + 1700;
    const tick = () => {
      const k = Math.min(1, Math.max(0, (performance.now() - t0) / 900));
      shardsEl.textContent = fmtNum(total * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(tick);
      if (k > 0 && k < 1 && Math.random() < 0.3) app.ctx.audio.play('pickup', { gain: 0.2 });
    };
    requestAnimationFrame(tick);
  } else app.ctx.audio.play('defeat', { gain: 0.6 });
  return el;
}
