import type { App } from '../../game/app';
import { ABILITIES, ABILITY_LEVEL, type AbilityId } from '../../data/abilities';
import { LORE } from '../../data/lore';
import {
  abilityUpgradeCost, BRANCHES, buyStat, canBuyStat, computeStats, MAX_STAT, RELICS, statCost, swapMutation, upgradeAbility, upgradeWeapon, weaponCost, WEAPON_MAX,
  type Branch,
} from '../../meta/progression';
import { fmtNum, h } from '../dom';
import { titleCanvas } from '../font';
import { iconCanvas, type IconId } from '../icons';

type Tab = 'stats' | 'altar' | 'forge' | 'relics' | 'lore';

export function currencyBar(app: App): HTMLElement {
  const s = app.ctx.save.currencies;
  return h('div', { class: 'vb-row', style: { gap: '18px' } },
    h('span', { class: 'vb-cur vb-void' }, iconCanvas('shard', 20, '#B794FF', 'rgba(139,92,246,.9)'), fmtNum(s.shards)),
    h('span', { class: 'vb-cur', style: { color: '#f4f1ff' } }, iconCanvas('ether', 20, '#f4f1ff', 'rgba(255,255,255,.8)'), fmtNum(s.ether)),
  );
}

const shardCost = (n: number, ok: boolean) => h('span', { class: 'vb-cur', style: { color: ok ? '#d8c4ff' : '#7a6a90', fontSize: '12px' } }, iconCanvas('shard', 14, '#B794FF', 'rgba(0,0,0,0)'), fmtNum(n));
const etherCost = (n: number, ok: boolean) => h('span', { class: 'vb-cur', style: { color: ok ? '#fff' : '#7a6a90', fontSize: '12px' } }, iconCanvas('ether', 14, '#f4f1ff', 'rgba(0,0,0,0)'), String(n));

/** Святилище (GDD §19.2): герой у алтаря; Созвездие статов, Алтарь способностей, Кузня, Реликварий, Записи; «В БОЙ». */
export function hubScreen(app: App, initial: Tab = 'stats'): HTMLElement {
  let tab: Tab = initial;
  const content = h('div', { class: 'vb-scroll', style: { flex: '1', minHeight: '0', paddingRight: '6px' } });
  const tabsRow = h('div', { class: 'vb-row', style: { gap: '0', flexWrap: 'nowrap', overflowX: 'auto' } });
  const curSlot = h('div', {});
  const save = app.ctx.save;

  const refresh = () => {
    curSlot.replaceChildren(currencyBar(app));
    tabsRow.replaceChildren(...([
      ['stats', 'Созвездие', 'power'], ['altar', 'Алтарь', 'altar'], ['forge', 'Кузня', 'forge'], ['relics', 'Реликварий', 'relic'], ['lore', 'Записи', 'eye'],
    ] as [Tab, string, IconId][]).map(([id, label, icon]) => {
      const dot = id === 'stats' && (['power', 'agility', 'fortitude', 'resonance'] as Branch[]).some((b) => canBuyStat(save, b));
      return h('div', { class: `vb-tab${tab === id ? ' on' : ''}`, onClick: () => { tab = id; app.sfx('ui_click', 0.5); refresh(); } },
        iconCanvas(icon, 18, tab === id ? '#e2c27a' : '#8a7a9a', 'rgba(0,0,0,0)'), h('span', {}, label), dot ? h('span', { class: 'dot' }) : null);
    }));
    content.replaceChildren(
      tab === 'stats' ? statsTab(app, refresh) : tab === 'altar' ? altarTab(app, refresh) : tab === 'forge' ? forgeTab(app, refresh) : tab === 'relics' ? relicsTab(app, refresh) : loreTab(app),
    );
  };
  refresh();

  const panelW = 'min(620px, 60vw)';
  const el = h('div', { class: 'vb-screen vb-fade' },
    h('div', { class: 'vb-row', style: { position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', left: 'max(18px, env(safe-area-inset-left))', right: 'max(18px, env(safe-area-inset-right))', justifyContent: 'space-between' } },
      h('div', { class: 'vb-col', style: { gap: '0' } }, titleCanvas('СВЯТИЛИЩЕ', 22, { color: 'gold', glow: 0.6 }), h('div', { class: 'vb-caps vb-dim', style: { marginTop: '-10px', marginLeft: '14px', fontSize: '10px' } }, 'Обсидиановый собор · убежище Пилота')),
      h('div', { class: 'vb-row' }, curSlot,
        h('button', { class: 'vb-iconbtn', 'aria-label': 'Настройки', onClick: () => { app.sfx('ui_click'); app.openSettings('hub'); } }, iconCanvas('gear', 26, '#e2c27a', 'rgba(139,92,246,.6)'))),
    ),
    h('div', { class: 'vb-panel vb-col', style: { position: 'absolute', right: 'max(18px, env(safe-area-inset-right))', top: '58px', bottom: '74px', width: panelW, gap: '4px' } },
      tabsRow, h('div', { class: 'vb-rule', style: { margin: '2px 0 6px' } }), content),
    h('div', { style: { position: 'absolute', right: 'max(18px, env(safe-area-inset-right))', bottom: 'max(14px, env(safe-area-inset-bottom))' } },
      h('button', { class: 'vb-btn primary', style: { minWidth: '220px', minHeight: '54px', fontSize: '15px' }, onClick: () => { app.sfx('ui_confirm'); app.go('map'); } }, 'В бой')),
    h('div', { class: 'vb-caps vb-dim', style: { position: 'absolute', left: 'max(22px, env(safe-area-inset-left))', bottom: 'max(18px, env(safe-area-inset-bottom))', fontSize: '10px', maxWidth: '30vw', lineHeight: '1.6' } }, statLine(app)),
  );
  return el;
}

function statLine(app: App): string {
  const st = computeStats(app.ctx.save, app.ctx.settings.autoAim);
  return `HP ${st.maxHp} · ATK ${st.atk.toFixed(1)} · КРИТ ${(st.critChance * 100).toFixed(1)}% ×${st.critMul.toFixed(2)} · РЫВОК ${st.dashCharges} · БРОНЯ ${st.armor}`;
}

function statsTab(app: App, refresh: () => void): HTMLElement {
  const s = app.ctx.save;
  return h('div', { class: 'vb-col' }, ...(['power', 'agility', 'fortitude', 'resonance'] as Branch[]).map((b) => {
    const B = BRANCHES[b], lvl = s.stats[b], cost = statCost(lvl), can = canBuyStat(s, b);
    const next = B.milestones.find(([m]) => m > lvl);
    const pips = h('div', { class: 'vb-row', style: { gap: '2px', flexWrap: 'wrap', marginTop: '4px' } },
      ...Array.from({ length: 20 }, (_, i) => h('span', { class: `vb-diamond${i < Math.min(20, lvl) ? (i % 5 === 4 ? ' gold' : '') : ' off'}`, style: { width: '6px', height: '6px', margin: '0 2px' } })));
    return h('div', { class: 'vb-card vb-row', style: { alignItems: 'flex-start' } },
      iconCanvas(B.icon, 40, '#e2c27a', 'rgba(139,92,246,.9)'),
      h('div', { class: 'vb-col vb-grow', style: { gap: '2px' } },
        h('div', { class: 'vb-row', style: { justifyContent: 'space-between' } },
          h('span', { style: { fontSize: '15px', letterSpacing: '.18em', textTransform: 'uppercase' } }, B.name),
          h('span', { class: 'vb-gold', style: { fontSize: '13px' } }, `${lvl} / ${MAX_STAT}`)),
        h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, B.per),
        next ? h('span', { style: { fontSize: '12px', color: '#B794FF' } }, `◆ Ур. ${next[0]}: ${next[1]}`) : h('span', { class: 'vb-gold', style: { fontSize: '12px' } }, 'Все вехи достигнуты'),
        pips),
      h('button', { class: 'vb-btn small', disabled: !can, style: { alignSelf: 'center', minWidth: '96px' }, onClick: () => { if (buyStat(s, b)) { app.sfx('ui_upgrade'); app.save(); refresh(); } } },
        lvl >= MAX_STAT ? 'макс.' : shardCost(cost, can)),
    );
  }), h('div', { class: 'vb-dim', style: { fontSize: '11px', lineHeight: '1.5' } }, 'Каждое возвращение должно делать Пилота заметно сильнее. Перепрохождение — не гринд, а «отомстить уровню».'));
}

function altarTab(app: App, refresh: () => void): HTMLElement {
  const s = app.ctx.save;
  const slots = h('div', { class: 'vb-row', style: { gap: '10px', marginBottom: '4px' } }, ...(['q', 'e', 'r'] as const).map((slot) => {
    const id = s.loadout[slot];
    return h('div', { class: 'vb-card vb-row', style: { flex: '1', gap: '8px', padding: '8px 10px' } },
      h('span', { class: 'vb-gold', style: { fontSize: '16px', width: '16px' } }, slot.toUpperCase()),
      id ? iconCanvas(ABILITIES[id].icon, 28, '#f3e7c4', 'rgba(139,92,246,.9)') : iconCanvas('lock', 24, '#5a4a6a', 'rgba(0,0,0,0)'),
      h('span', { style: { fontSize: '11px', letterSpacing: '.1em' } }, id ? ABILITIES[id].name : 'пусто'));
  }));
  const cards = (Object.keys(ABILITIES) as AbilityId[]).map((id) => {
    const A = ABILITIES[id], st = s.abilities[id];
    if (!st) {
      const where = A.unlock === 'boss1' ? 'Иерофант Скорби' : `этап ${A.unlock}`;
      return h('div', { class: 'vb-card vb-row locked' }, iconCanvas('lock', 36, '#6a5a7a', 'rgba(0,0,0,0)'),
        h('div', { class: 'vb-col', style: { gap: '2px' } }, h('span', { style: { letterSpacing: '.15em', textTransform: 'uppercase' } }, A.name), h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, `Откроется: ${where}`)));
    }
    const equipped = s.loadout[A.slot] === id;
    const cost = abilityUpgradeCost(s, id);
    const can = !!cost && s.currencies.shards >= cost.shards && s.currencies.ether >= cost.ether;
    const lvlPips = h('span', {}, ...[1, 2, 3].map((i) => h('span', { class: `vb-diamond${i <= st.level ? ' gold' : ' off'}`, style: { width: '7px', height: '7px' } })));
    const actions = h('div', { class: 'vb-row', style: { gap: '8px', flexWrap: 'wrap', marginTop: '6px' } });
    if (!equipped) actions.appendChild(h('button', { class: 'vb-btn small', onClick: () => { s.loadout[A.slot] = id; app.sfx('ui_confirm'); app.save(); refresh(); } }, `Экипировать (${A.slot.toUpperCase()})`));
    if (cost && st.level < 2) actions.appendChild(h('button', { class: 'vb-btn small', disabled: !can, onClick: () => { if (upgradeAbility(s, id)) { app.sfx('ui_upgrade'); app.save(); refresh(); } } }, 'Ур. II ', shardCost(cost.shards, can)));
    if (cost && st.level === 2) {
      for (const m of ['A', 'B'] as const) {
        actions.appendChild(h('button', { class: 'vb-btn small', disabled: !can, title: m === 'A' ? A.mutA.desc : A.mutB.desc, onClick: () => { if (upgradeAbility(s, id, m)) { app.sfx('ui_upgrade'); app.save(); refresh(); } } },
          `III: ${m === 'A' ? A.mutA.name : A.mutB.name} `, shardCost(cost.shards, can), etherCost(cost.ether, can)));
      }
    }
    if (st.level === 3) actions.appendChild(h('button', { class: 'vb-btn small', disabled: s.currencies.ether < ABILITY_LEVEL.mutationSwap, onClick: () => { if (swapMutation(s, id)) { app.sfx('ui_upgrade'); app.save(); refresh(); } } }, 'Сменить мутацию ', etherCost(ABILITY_LEVEL.mutationSwap, s.currencies.ether >= 2)));
    const mut = st.level === 3 ? (st.mutation === 'B' ? A.mutB : A.mutA) : null;
    return h('div', { class: `vb-card vb-row${equipped ? ' sel' : ''}`, style: { alignItems: 'flex-start' } },
      iconCanvas(A.icon, 44, '#f3e7c4', 'rgba(139,92,246,.95)'),
      h('div', { class: 'vb-col vb-grow', style: { gap: '3px' } },
        h('div', { class: 'vb-row', style: { justifyContent: 'space-between' } },
          h('span', { style: { letterSpacing: '.15em', textTransform: 'uppercase', fontSize: '14px' } }, A.name, h('span', { class: 'vb-dim', style: { fontSize: '11px', marginLeft: '8px' } }, A.slot.toUpperCase())), lvlPips),
        h('span', { class: 'vb-dim', style: { fontSize: '12px', lineHeight: '1.45' } }, A.desc),
        mut ? h('span', { style: { fontSize: '12px', color: '#B794FF' } }, `◆ ${mut.name}: ${mut.desc}`) : null,
        actions));
  });
  return h('div', { class: 'vb-col' }, slots, ...cards);
}

function forgeTab(app: App, refresh: () => void): HTMLElement {
  const s = app.ctx.save;
  const w = s.weapons.void_blade;
  const cost = weaponCost(w.level), can = w.level < WEAPON_MAX && s.currencies.shards >= cost;
  const locked: [string, string, string][] = [
    ['Парные Кинжалы «Близнецы»', 'Скорость, криты: 6 ударов по 0.55×, финишер крест-накрест', 'Откроется за Иерофантом — в следующем обновлении'],
    ['Глефа «Орбита»', 'Дальность, толпы: широкие вращения 3.2 м', 'Откроется: Молох (Зона 02)'],
    ['Коса «Жатва»', 'Тяжёлая, стойка: ×1.5 слома, удары подтягивают врагов', 'Откроется: Сестра Безмолвия (Зона 03)'],
  ];
  return h('div', { class: 'vb-col' },
    h('div', { class: 'vb-card vb-row sel', style: { alignItems: 'flex-start' } },
      iconCanvas('blade', 52, '#f3e7c4', 'rgba(139,92,246,.95)'),
      h('div', { class: 'vb-col vb-grow', style: { gap: '3px' } },
        h('div', { class: 'vb-row', style: { justifyContent: 'space-between' } },
          h('span', { style: { letterSpacing: '.15em', textTransform: 'uppercase', fontSize: '14px' } }, 'Клинок Пустоты'), h('span', { class: 'vb-gold' }, `ур. ${w.level} / ${WEAPON_MAX}`)),
        h('span', { class: 'vb-dim', style: { fontSize: '12px', lineHeight: '1.45' } }, 'Универсал: 4 удара — разрез, обратный разрез, вращение, «Нисходящий разлом». Выкован из обломка обшивки «Инея».'),
        h('span', { style: { fontSize: '12px', color: w.level >= 5 ? '#e2c27a' : '#8a7a9a' } }, '◆ Ур. 5: +5 % шанса крита'),
        h('span', { style: { fontSize: '12px', color: w.level >= 10 ? '#e2c27a' : '#8a7a9a' } }, '◆ Ур. 10: финишер оставляет разлом'),
        h('div', { class: 'vb-row', style: { marginTop: '6px' } },
          h('button', { class: 'vb-btn small', disabled: !can, onClick: () => { if (upgradeWeapon(s, 'void_blade')) { app.sfx('ui_upgrade'); app.save(); refresh(); } } },
            w.level >= WEAPON_MAX ? 'максимум' : h('span', {}, `+8 % урона `, shardCost(cost, can)))))),
    ...locked.map(([n, d, u]) => h('div', { class: 'vb-card vb-row locked' }, iconCanvas('lock', 36, '#6a5a7a', 'rgba(0,0,0,0)'),
      h('div', { class: 'vb-col', style: { gap: '2px' } }, h('span', { style: { letterSpacing: '.15em', textTransform: 'uppercase' } }, n), h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, d), h('span', { style: { fontSize: '11px', color: '#9a7ac8' } }, u)))),
  );
}

function relicsTab(app: App, refresh: () => void): HTMLElement {
  const s = app.ctx.save;
  const slot = s.loadout.relics[0];
  return h('div', { class: 'vb-col' },
    h('div', { class: 'vb-caps vb-dim' }, 'Слоты реликвий: 1 · второй — за Молоха, третий — за Ткача Орбит'),
    h('div', { class: 'vb-card vb-row sel' }, iconCanvas('relic', 34, slot ? '#f3e7c4' : '#5a4a6a', 'rgba(139,92,246,.8)'),
      h('span', {}, slot ? `${RELICS[slot]?.name ?? slot} — ${RELICS[slot]?.desc ?? ''}` : 'Пустой слот')),
    s.relics.length ? null : h('div', { class: 'vb-dim', style: { fontSize: '12px', lineHeight: '1.5' } }, 'Реликвии выпадают из сундуков стражей и боссов. Первая ждёт за Иерофантом Скорби.'),
    ...s.relics.map((id) => h('div', { class: `vb-card vb-row${slot === id ? ' sel' : ''}` }, iconCanvas('relic', 32, '#e2c27a', 'rgba(139,92,246,.8)'),
      h('div', { class: 'vb-col vb-grow', style: { gap: '2px' } }, h('span', { style: { textTransform: 'uppercase', letterSpacing: '.12em' } }, RELICS[id]?.name ?? id), h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, RELICS[id]?.desc ?? '')),
      h('button', { class: 'vb-btn small', onClick: () => { s.loadout.relics = slot === id ? [] : [id]; app.sfx('ui_confirm'); app.save(); refresh(); } }, slot === id ? 'Снять' : 'Надеть'))),
  );
}

function loreTab(app: App): HTMLElement {
  const s = app.ctx.save;
  const ids = Object.keys(LORE);
  return h('div', { class: 'vb-col' }, ...ids.map((id) => {
    const open = s.lore.includes(id);
    return h('div', { class: `vb-card${open ? '' : ' locked'}` },
      h('div', { style: { letterSpacing: '.15em', textTransform: 'uppercase', fontSize: '13px', color: open ? '#e2c27a' : '#6a5a7a' } }, open ? LORE[id].title : '— запись не найдена —'),
      open ? h('div', { style: { fontSize: '13px', lineHeight: '1.6', fontStyle: 'italic', marginTop: '6px' } }, LORE[id].text) : null);
  }));
}
