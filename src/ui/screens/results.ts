import type { App, ResultsData } from '../../game/app';
import { ABILITIES, type AbilityId } from '../../data/abilities';
import { LORE } from '../../data/lore';
import { stageById } from '../../data/stages';
import { grantLevel3, RELICS } from '../../meta/progression';
import { fmtNum, fmtTime, h } from '../dom';
import { titleCanvas } from '../font';
import { iconCanvas } from '../icons';
import { UI } from '../theme';

/** Контекстные советы при поражении (GDD §19.2). */
function tip(src: string | undefined, stageId: string): string {
  if (src === 'ring') return 'Звон: ищи разрыв в кольце — или проскочи сквозь волну рывком в момент касания.';
  if (src === 'projectile') return 'Око и Аколит бьют издалека: подойди вплотную или срежь их Серпом Луны.';
  if (src === 'reaper') return 'Жнец выдаёт выпад красной линией. Рывок вбок в последний миг — идеальное уклонение.';
  if (src === 'crucifier') return 'Распинатель бьёт веером из четырёх полос: стой в просвете или уйди за край веера. Промах Гвоздём — клинок застрял, бей.';
  if (src === 'psalmist') return 'Псаломщик звенит, если подойти вплотную: дождись переноса или ударь тяжёлым — связь погаснет. Его смерть оглушает связанных.';
  if (src === 'golem') return 'Голем медлителен: после удара у него долгое окно. Заряженный удар его оглушает, финишер по оглушённому — Раскол.';
  if (src === 'fall') return 'Над бездной рывок не упирается в край. Следи за плитами под ногами.';
  if (src === 'smoke') return 'Дым кадил ранит, пока в нём стоишь. Уходи из серых облаков.';
  if (stageId === 'boss1') return 'Когда Понтифик рушится сверху (тень на полу), он 2 с уязвим — бей в маску в это окно, и звёзды оглушения загорятся вчетверо быстрее.';
  return 'Ранг комбо растёт, пока тебя не задели. Используй рывок: первые 0.14 с ты неуязвим.';
}

/** Экран результатов (GDD §15.9, §19.2): ранг-штамп, звёзды загораются по очереди, Осколки «высыпаются» в счётчик. */
export function resultsScreen(app: App, d: ResultsData): HTMLElement {
  const def = stageById(d.stageId)!;
  const won = d.cleared;
  const short = innerHeight < 520;
  const rankEl = h('div', { class: 'vb-stamp', style: { animationDelay: '.5s' } }, titleCanvas(d.result.rank, short ? 56 : 84, { color: d.result.rank.startsWith('S') ? (d.result.rank === 'SS' ? 'void' : 'ether') : 'gold', glow: 1.2, spacing: 0.02 }));
  const stars = [1, 2, 3].map(() => h('span', { class: 'vb-star' }, '★'));
  const shardsEl = h('span', {}, '0');
  const conds = ['Пройти этап', 'Закончить с ≥ 50 % HP', 'Финальный ранг A или выше'];
  const next = app.nextStageId(d.stageId);

  const buttons = h('div', { class: 'vb-row', style: { gap: '14px', flexWrap: 'wrap', justifyContent: 'center', position: 'absolute', left: '0', right: '0', bottom: 'max(12px, env(safe-area-inset-bottom))' } },
    h('button', { class: 'vb-btn', onClick: () => { app.sfx('ui_confirm'); app.startStage(d.stageId); } }, 'Повторить'),
    h('button', { class: 'vb-btn', onClick: () => { app.sfx('ui_back'); app.go('hub'); } }, won ? 'Святилище' : 'Улучшиться'),
    won && next ? h('button', { class: 'vb-btn primary', onClick: () => { app.sfx('ui_confirm'); app.go('map'); } }, 'Дальше') : null,
  );

  const extras: HTMLElement[] = [];
  for (const id of d.reward.unlocks) {
    const A = ABILITIES[id];
    extras.push(h('div', { class: 'vb-card vb-row sel' }, iconCanvas(A.icon, 40, UI.ivory, UI.glowVoid),
      h('div', { class: 'vb-col', style: { gap: '2px' } }, h('span', { class: 'vb-caps vb-void' }, 'Новая способность'), h('span', { class: 'vb-name' }, `${A.name} · ${A.slot.toUpperCase()}`), h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, A.desc))));
  }
  if (d.reward.relic) {
    const R = RELICS[d.reward.relic];
    extras.push(h('div', { class: 'vb-card vb-row sel' }, iconCanvas('relic', 36, UI.goldHi, UI.glowGold), h('div', { class: 'vb-col', style: { gap: '2px' } }, h('span', { class: 'vb-caps vb-gold' }, 'Реликвия'), h('span', {}, `${R.name} — ${R.desc}`))));
  }
  // дар босса (план §6.7): бесплатный III уровень одной способности на выбор
  if (d.reward.freeLevel3) {
    const sv = app.ctx.save;
    const pick = h('div', { class: 'vb-row', style: { gap: '8px', flexWrap: 'wrap' } });
    const card = h('div', { class: 'vb-card vb-col sel', style: { gap: '6px' } },
      h('span', { class: 'vb-caps vb-void' }, 'Дар звезды'),
      h('span', { style: { fontSize: '13px' } }, 'Одна способность — сразу на III уровень (мутация А, сменить можно в Святилище).'),
      pick);
    const ids = (Object.keys(sv.abilities) as AbilityId[]).filter((id) => (sv.abilities[id]?.level ?? 3) < 3);
    for (const id of ids) {
      const A = ABILITIES[id];
      pick.appendChild(h('button', { class: 'vb-btn small', onClick: () => {
        if (!grantLevel3(sv, id)) return;
        app.sfx('ui_upgrade'); app.save();
        pick.replaceChildren(h('span', { class: 'vb-gold' }, `${A.name} — III уровень`));
      } }, iconCanvas(A.icon, 18, UI.ivory, UI.none), ` ${A.name}`));
    }
    if (ids.length) extras.push(card);
  }
  if (d.lore) extras.push(h('div', { class: 'vb-card' }, h('span', { class: 'vb-caps vb-gold' }, 'Запись найдена: '), h('span', { class: 'vb-name', style: { fontSize: '13px' } }, LORE[d.lore].title)));
  if (def.tutorial === 'upgrade' && won && app.ctx.flag('freePower')) extras.push(h('div', { class: 'vb-card' }, h('span', { class: 'vb-caps vb-void' }, 'Каэлис: '), h('span', {}, '«Загляни в Святилище — я влила в Созвездие немного силы. Бесплатно. На этот раз».')));

  const kv = (k: string, v: string) => [h('span', {}, k), h('span', {}, v)];
  const body = won
    ? h('div', { class: 'vb-row', style: { gap: '30px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' } },
      h('div', { class: 'vb-col', style: { alignItems: 'center', gap: '0' } }, h('span', { class: 'vb-caps', style: { color: UI.dim } }, 'Ранг этапа'), rankEl),
      h('div', { class: 'vb-panel vb-col', style: { gap: '6px', minWidth: '300px' } },
        h('div', { class: 'vb-row', style: { gap: '10px' } }, ...stars),
        ...conds.map((c, i) => h('div', { style: { fontSize: '12px', color: d.reward.stars > i ? UI.goldHi : '#5b6470' } }, `${'★'.repeat(i + 1)} ${c}`)),
        h('div', { class: 'vb-rule', style: { margin: '6px 0' } }),
        h('div', { class: 'vb-row', style: { gap: '14px' } },
          h('span', { class: 'vb-cur', style: { color: UI.star, fontSize: '20px' } }, iconCanvas('shard', 22, UI.star, UI.glowStar), shardsEl),
          d.reward.ether ? h('span', { class: 'vb-cur', style: { color: UI.ivory, fontSize: '20px' } }, iconCanvas('ether', 22, UI.ivory, 'rgba(255,255,255,.7)'), `+${d.reward.ether}`) : null),
        h('div', { class: 'vb-kv', style: { marginTop: '4px' } },
          ...kv('Время', fmtTime(d.result.time)), ...kv('Лучшее комбо', `×${d.bestCombo}`), ...kv('Повержено', String(d.run.kills)),
          ...kv('Уклонений', String(d.run.perfectDodges)), ...kv('Расколов', String(d.run.shatters))),
        d.result.story ? h('div', { class: 'vb-dim', style: { fontSize: '11px' } }, 'Режим «История»: ★★★ недоступна') : null))
    : h('div', { class: 'vb-panel vb-col', style: { alignItems: 'center', gap: '10px', maxWidth: '540px', textAlign: 'center' } },
      h('div', { class: 'vb-caps', style: { color: UI.goldHi } }, 'Совет Каэлис'),
      h('div', { style: { fontSize: '15px', lineHeight: '1.6', color: UI.ivory } }, tip(d.deathSource, d.stageId)),
      h('div', { class: 'vb-row', style: { fontSize: '14px' } }, 'Собрано:', h('span', { class: 'vb-cur', style: { color: UI.star } }, iconCanvas('shard', 18, UI.star, UI.none), fmtNum(d.reward.shards)), h('span', { class: 'vb-dim', style: { fontSize: '11px' } }, '(половина подобранного)')));

  const el = h('div', { class: 'vb-screen vb-fade', style: { display: 'grid', placeItems: 'center', background: won ? 'radial-gradient(ellipse at center, rgba(10,16,24,.55), rgba(5,7,10,.92))' : 'radial-gradient(ellipse at center, rgba(40,6,12,.55), rgba(5,7,10,.94))' } },
    h('div', { class: 'vb-col vb-scroll', style: { alignItems: 'center', gap: short ? '4px' : '10px', maxWidth: '92vw', maxHeight: 'calc(100% - 74px)', marginBottom: '60px' } },
      titleCanvas(won ? (def.boss ? 'Звезда вспыхнула' : 'Этап пройден') : 'Пустота отступает…', short ? 26 : 36, { color: won ? 'gold' : 'hunger', glow: 1, spacing: 0.08 }),
      h('div', { class: 'vb-caps', style: { color: UI.dim, marginTop: '-10px' } }, `${def.boss ? 'Босс' : `Этап ${def.id}`} · ${def.name}`),
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
