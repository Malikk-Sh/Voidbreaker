import type { App } from '../../game/app';
import { ABILITIES, ABILITY_LEVEL, type AbilityId } from '../../data/abilities';
import { LORE } from '../../data/lore';
import { CINEMA } from '../../data/cinema';
import {
  abilityUpgradeCost, BRANCHES, buyStat, canBuyStat, computeStats, MAX_STAT, RELICS, statCost, swapMutation, upgradeAbility, upgradeWeapon, weaponCost, WEAPON_MAX,
  type Branch,
} from '../../meta/progression';
import { fmtNum, h } from '../dom';
import { titleCanvas } from '../font';
import { enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen } from '../fullscreen';
import { iconCanvas, type IconId } from '../icons';
import { UI } from '../theme';
import { emblemSvg, litRays } from '../emblem';

type Tab = 'stats' | 'altar' | 'forge' | 'relics' | 'lore';

/** Валюты: Осколки — звёздная бирюза, Эфир — слоновая кость. */
export function currencyBar(app: App): HTMLElement {
  const s = app.ctx.save.currencies;
  return h('div', { class: 'vb-row', style: { gap: '10px' } },
    h('span', { class: 'vb-pill vb-cur', style: { color: UI.star } }, iconCanvas('shard', 18, UI.star, UI.glowStar), fmtNum(s.shards)),
    h('span', { class: 'vb-pill vb-cur', style: { color: UI.ivory } }, iconCanvas('ether', 18, UI.ivory, 'rgba(255,255,255,.6)'), fmtNum(s.ether)),
  );
}

const shardCost = (n: number, ok: boolean) => h('span', { class: 'vb-cur', style: { color: ok ? 'inherit' : '#6b7480', fontSize: '13px' } }, iconCanvas('shard', 14, ok ? '#1b1408' : '#6b7480', UI.none), fmtNum(n));
const etherCost = (n: number, ok: boolean) => h('span', { class: 'vb-cur', style: { color: ok ? 'inherit' : '#6b7480', fontSize: '13px' } }, iconCanvas('ether', 14, ok ? '#1b1408' : '#6b7480', UI.none), String(n));

/** Медальон-иконка: ромб с двойной рамкой. */
function medallion(icon: IconId, size: number, on = true, glow: string = UI.glowGold): HTMLElement {
  return h('div', { style: { position: 'relative', width: `${size}px`, height: `${size}px`, flex: 'none', display: 'grid', placeItems: 'center' } },
    h('div', { style: { position: 'absolute', inset: `${size * 0.14}px`, transform: 'rotate(45deg)', border: `1px solid ${on ? 'rgba(240,217,160,.75)' : 'rgba(120,130,140,.4)'}`, background: 'linear-gradient(135deg, rgba(36,46,60,.9), rgba(7,10,14,.9))', boxShadow: on ? '0 0 14px rgba(240,200,120,.18)' : 'none' } }),
    h('div', { style: { position: 'absolute', inset: `${size * 0.24}px`, transform: 'rotate(45deg)', border: '1px solid rgba(227,195,126,.25)' } }),
    h('div', { style: { position: 'relative' } }, iconCanvas(icon, size * 0.5, on ? UI.ivory : '#6b7480', on ? glow : UI.none)));
}

/** Шкала уровня с делениями-вехами. */
function meter(frac: number, marks: number[] = []): HTMLElement {
  return h('div', { class: 'vb-meter' }, h('i', { style: { width: `${Math.max(0, Math.min(1, frac)) * 100}%` } }), ...marks.map((m) => h('b', { style: { left: `${m * 100}%` } })));
}

/** Святилище (GDD §19.2): герой у алтаря; Созвездие статов, Алтарь способностей, Кузня, Реликварий, Записи; «В БОЙ». */
export function hubScreen(app: App, initial: Tab = 'stats'): HTMLElement {
  let tab: Tab = initial;
  const content = h('div', { class: 'vb-scroll', style: { flex: '1', minHeight: '0', paddingRight: '6px' } });
  const tabsRow = h('div', { class: 'vb-tabs' });
  const curSlot = h('div', {});
  const plaque = h('div', {});
  const save = app.ctx.save;

  const refresh = () => {
    curSlot.replaceChildren(currencyBar(app));
    plaque.replaceChildren(heroPlaque(app));
    tabsRow.replaceChildren(...([
      ['stats', 'Созвездие', 'power'], ['altar', 'Алтарь', 'altar'], ['forge', 'Кузня', 'forge'], ['relics', 'Реликварий', 'relic'], ['lore', 'Записи', 'eye'],
    ] as [Tab, string, IconId][]).map(([id, label, icon]) => {
      const dot = id === 'stats' && (['power', 'agility', 'fortitude', 'resonance'] as Branch[]).some((b) => canBuyStat(save, b));
      return h('div', { class: `vb-tab${tab === id ? ' on' : ''}`, onClick: () => { tab = id; app.sfx('ui_click', 0.5); refresh(); } },
        iconCanvas(icon, 18, tab === id ? UI.goldHi : UI.dim, UI.none), h('span', {}, label), dot ? h('span', { class: 'dot' }) : null);
    }));
    content.replaceChildren(
      tab === 'stats' ? statsTab(app, refresh) : tab === 'altar' ? altarTab(app, refresh) : tab === 'forge' ? forgeTab(app, refresh) : tab === 'relics' ? relicsTab(app, refresh) : loreTab(app),
    );
  };
  refresh();

  const iconBtn = (icon: IconId, label: string, fn: () => void) => h('button', { class: 'vb-iconbtn', 'aria-label': label, onClick: () => { app.sfx('ui_click'); fn(); } }, iconCanvas(icon, 20, UI.goldHi, UI.glowGold));
  const panelW = 'min(600px, 58vw)';
  const el = h('div', { class: 'vb-screen vb-fade' },
    h('div', { class: 'vb-row', style: { position: 'absolute', top: 'max(10px, env(safe-area-inset-top))', left: 'max(18px, env(safe-area-inset-left))', right: 'max(18px, env(safe-area-inset-right))', justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('div', { class: 'vb-row', style: { gap: '6px', alignItems: 'center' } },
        // эмблема прогресса (план §8.8): луч за каждого побеждённого босса
        h('div', { title: `Лучей звезды: ${litRays(save)} из 7`, style: { lineHeight: '0' } }, emblemSvg(54, litRays(save))),
        h('div', { class: 'vb-col', style: { gap: '0' } },
          titleCanvas('Святилище', 26, { color: 'gold', glow: 0.6, spacing: 0.08 }),
          h('div', { class: 'vb-caps', style: { marginTop: '-12px', marginLeft: '14px', fontSize: '9px', color: UI.dim } }, 'Обсидиановый собор · убежище Пилота'))),
      h('div', { class: 'vb-row', style: { gap: '14px' } }, curSlot,
        fullscreenSupported() ? iconBtn('fullscreen', 'Полный экран', () => { void (isFullscreen() ? exitFullscreen() : enterFullscreen()); }) : null,
        iconBtn('gear', 'Настройки', () => app.openSettings('hub'))),
    ),
    h('div', { class: 'vb-panel vb-col', style: { position: 'absolute', right: 'max(18px, env(safe-area-inset-right))', top: '64px', bottom: '84px', width: panelW, gap: '4px' } },
      tabsRow, h('div', { class: 'vb-rule', style: { margin: '4px 0 8px' } }), content),
    h('div', { style: { position: 'absolute', right: 'max(18px, env(safe-area-inset-right))', bottom: 'max(14px, env(safe-area-inset-bottom))' } },
      h('button', { class: 'vb-btn primary big', style: { minWidth: '240px' }, onClick: () => { app.sfx('ui_confirm'); app.go('map'); } }, 'В бой')),
    h('div', { style: { position: 'absolute', left: 'max(18px, env(safe-area-inset-left))', bottom: 'max(14px, env(safe-area-inset-bottom))' } }, plaque),
  );
  return el;
}

/** Табличка Пилота: ключевые характеристики крупно и читаемо. */
function heroPlaque(app: App): HTMLElement {
  const st = computeStats(app.ctx.save, app.ctx.settings.autoAim);
  const s = app.ctx.save.stats;
  const power = Math.round(st.atk * 10 + st.maxHp + st.armor * 3 + (s.power + s.agility + s.fortitude + s.resonance) * 20);
  const row = (icon: IconId, label: string, val: string) => h('div', { class: 'vb-row', style: { gap: '8px' } },
    iconCanvas(icon, 16, UI.goldHi, UI.none), h('span', { class: 'vb-caps', style: { fontSize: '9px', color: UI.dim, width: '58px' } }, label), h('span', { class: 'vb-tech', style: { color: UI.ivory, fontSize: '13px' } }, val));
  return h('div', { class: 'vb-panel', style: { padding: '10px 16px', minWidth: '210px' } },
    h('div', { class: 'vb-row', style: { justifyContent: 'space-between', marginBottom: '4px' } },
      h('span', { class: 'vb-name', style: { fontSize: '14px' } }, 'Пилот «Инея»'),
      h('span', { class: 'vb-tech', style: { color: UI.goldHi, fontSize: '13px' } }, `◆ ${fmtNum(power)}`)),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px' } },
      row('heart', 'Здоровье', String(st.maxHp)), row('power', 'Атака', st.atk.toFixed(1)),
      row('crit', 'Крит', `${(st.critChance * 100).toFixed(0)}% ×${st.critMul.toFixed(2)}`), row('armor', 'Броня', String(st.armor)),
      row('dash', 'Рывок', `${st.dashCharges} заряд.`), row('resonance', 'Сила ПУ', `+${Math.round(st.abilityDmg * 100)}%`)));
}

function statsTab(app: App, refresh: () => void): HTMLElement {
  const s = app.ctx.save;
  return h('div', { class: 'vb-col vb-rise' }, ...(['power', 'agility', 'fortitude', 'resonance'] as Branch[]).map((b) => {
    const B = BRANCHES[b], lvl = s.stats[b], cost = statCost(lvl), can = canBuyStat(s, b);
    const next = B.milestones.find(([m]) => m > lvl);
    return h('div', { class: 'vb-card vb-row', style: { alignItems: 'center', gap: '14px' } },
      medallion(B.icon, 52, lvl > 0),
      h('div', { class: 'vb-col vb-grow', style: { gap: '4px' } },
        h('div', { class: 'vb-row', style: { justifyContent: 'space-between' } },
          h('span', { class: 'vb-name' }, B.name),
          h('span', { class: 'vb-tech', style: { color: UI.goldHi, fontSize: '13px' } }, `${lvl} / ${MAX_STAT}`)),
        h('span', { style: { fontSize: '12px', color: UI.text } }, `За уровень: ${B.per}`),
        meter(lvl / MAX_STAT, B.milestones.map(([m]) => m / MAX_STAT)),
        next ? h('span', { style: { fontSize: '12px', color: UI.star } }, `◆ Ур. ${next[0]}: ${next[1]}`) : h('span', { class: 'vb-gold', style: { fontSize: '12px' } }, 'Все вехи достигнуты')),
      h('button', { class: `vb-btn small${can ? ' primary' : ''}`, disabled: !can, style: { minWidth: '104px' }, onClick: () => { if (buyStat(s, b)) { app.sfx('ui_upgrade'); app.save(); refresh(); } } },
        lvl >= MAX_STAT ? 'макс.' : shardCost(cost, can)),
    );
  }), h('div', { style: { fontSize: '11px', lineHeight: '1.5', color: UI.dim } }, 'Каждый уровень дорог, но ощутим. Перепрохождение — не гринд, а «отомстить уровню».'));
}

function altarTab(app: App, refresh: () => void): HTMLElement {
  const s = app.ctx.save;
  const slots = h('div', { class: 'vb-row', style: { gap: '10px', marginBottom: '4px' } }, ...(['q', 'e', 'r'] as const).map((slot) => {
    const id = s.loadout[slot];
    return h('div', { class: 'vb-card vb-row', style: { flex: '1', gap: '8px', padding: '8px 10px' } },
      h('span', { class: 'vb-tech', style: { fontSize: '15px', width: '16px', color: UI.goldHi } }, slot.toUpperCase()),
      id ? iconCanvas(ABILITIES[id].icon, 28, UI.ivory, UI.glowVoid) : iconCanvas('lock', 22, '#5b6470', UI.none),
      h('span', { style: { fontSize: '11px', letterSpacing: '.06em' } }, id ? ABILITIES[id].name : 'пусто'));
  }));
  const cards = (Object.keys(ABILITIES) as AbilityId[]).map((id) => {
    const A = ABILITIES[id], st = s.abilities[id];
    if (!st) {
      const where = A.unlock === 'boss1' ? 'Иерофант Скорби' : `этап ${A.unlock}`;
      return h('div', { class: 'vb-card vb-row locked' }, medallion('lock', 46, false),
        h('div', { class: 'vb-col', style: { gap: '2px' } }, h('span', { class: 'vb-name' }, A.name), h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, `Откроется: ${where}`)));
    }
    const equipped = s.loadout[A.slot] === id;
    const cost = abilityUpgradeCost(s, id);
    const can = !!cost && s.currencies.shards >= cost.shards && s.currencies.ether >= cost.ether;
    const lvlPips = h('span', {}, ...[1, 2, 3].map((i) => h('span', { class: `vb-diamond${i <= st.level ? '' : ' off'}`, style: { width: '7px', height: '7px' } })));
    const actions = h('div', { class: 'vb-row', style: { gap: '8px', flexWrap: 'wrap', marginTop: '6px' } });
    if (!equipped) actions.appendChild(h('button', { class: 'vb-btn small', onClick: () => { s.loadout[A.slot] = id; app.sfx('ui_confirm'); app.save(); refresh(); } }, `Экипировать (${A.slot.toUpperCase()})`));
    if (cost && st.level < 2) actions.appendChild(h('button', { class: `vb-btn small${can ? ' primary' : ''}`, disabled: !can, onClick: () => { if (upgradeAbility(s, id)) { app.sfx('ui_upgrade'); app.save(); refresh(); } } }, 'Ур. II ', shardCost(cost.shards, can)));
    if (cost && st.level === 2) {
      for (const m of ['A', 'B'] as const) {
        actions.appendChild(h('button', { class: `vb-btn small${can ? ' primary' : ''}`, disabled: !can, title: m === 'A' ? A.mutA.desc : A.mutB.desc, onClick: () => { if (upgradeAbility(s, id, m)) { app.sfx('ui_upgrade'); app.save(); refresh(); } } },
          `III: ${m === 'A' ? A.mutA.name : A.mutB.name} `, shardCost(cost.shards, can), etherCost(cost.ether, can)));
      }
    }
    if (st.level === 3) actions.appendChild(h('button', { class: 'vb-btn small', disabled: s.currencies.ether < ABILITY_LEVEL.mutationSwap, onClick: () => { if (swapMutation(s, id)) { app.sfx('ui_upgrade'); app.save(); refresh(); } } }, 'Сменить мутацию ', etherCost(ABILITY_LEVEL.mutationSwap, s.currencies.ether >= 2)));
    const mut = st.level === 3 ? (st.mutation === 'B' ? A.mutB : A.mutA) : null;
    return h('div', { class: `vb-card vb-row${equipped ? ' sel' : ''}`, style: { alignItems: 'flex-start', gap: '14px' } },
      medallion(A.icon, 52, true, UI.glowVoid),
      h('div', { class: 'vb-col vb-grow', style: { gap: '3px' } },
        h('div', { class: 'vb-row', style: { justifyContent: 'space-between' } },
          h('span', { class: 'vb-name' }, A.name, h('span', { class: 'vb-tech', style: { fontSize: '11px', marginLeft: '8px', color: UI.dim } }, A.slot.toUpperCase())), lvlPips),
        h('span', { style: { fontSize: '12px', lineHeight: '1.45', color: UI.text } }, A.desc),
        mut ? h('span', { style: { fontSize: '12px', color: UI.void } }, `◆ ${mut.name}: ${mut.desc}`) : null,
        actions));
  });
  return h('div', { class: 'vb-col vb-rise' }, slots, ...cards);
}

function forgeTab(app: App, refresh: () => void): HTMLElement {
  const s = app.ctx.save;
  const w = s.weapons.void_blade;
  const cost = weaponCost(w.level), can = w.level < WEAPON_MAX && s.currencies.shards >= cost;
  const locked: [string, string, string][] = [
    ['Парные Кинжалы «Близнецы»', 'Скорость, криты: 6 ударов по 0.55×, финишер крест-накрест', 'Откроется за Иерофантом — в следующем обновлении'],
    ['Глефа «Орбита»', 'Дальность, толпы: широкие вращения 3.2 м', 'Откроется: Молох (Зона 02)'],
    ['Коса «Жатва»', 'Тяжёлая: ×1.5 оглушения, удары подтягивают врагов', 'Откроется: Сестра Безмолвия (Зона 03)'],
  ];
  return h('div', { class: 'vb-col vb-rise' },
    h('div', { class: 'vb-card vb-row sel', style: { alignItems: 'flex-start', gap: '14px' } },
      medallion('blade', 60, true, UI.glowVoid),
      h('div', { class: 'vb-col vb-grow', style: { gap: '4px' } },
        h('div', { class: 'vb-row', style: { justifyContent: 'space-between' } },
          h('span', { class: 'vb-name' }, 'Клинок Пустоты'), h('span', { class: 'vb-tech', style: { color: UI.goldHi } }, `ур. ${w.level} / ${WEAPON_MAX}`)),
        meter(w.level / WEAPON_MAX, [0.5]),
        h('span', { style: { fontSize: '12px', lineHeight: '1.45', color: UI.text } }, 'Универсал: разрезы, вращение, «Нисходящий разлом», ветки комбо. Выкован из обломка обшивки «Инея».'),
        h('span', { style: { fontSize: '12px', color: w.level >= 5 ? UI.goldHi : UI.dim } }, '◆ Ур. 5: +6 % шанса крита'),
        h('span', { style: { fontSize: '12px', color: w.level >= 10 ? UI.goldHi : UI.dim } }, '◆ Ур. 10: финишер оставляет разлом'),
        h('div', { class: 'vb-row', style: { marginTop: '6px' } },
          h('button', { class: `vb-btn small${can ? ' primary' : ''}`, disabled: !can, onClick: () => { if (upgradeWeapon(s, 'void_blade')) { app.sfx('ui_upgrade'); app.save(); refresh(); } } },
            w.level >= WEAPON_MAX ? 'максимум' : h('span', { class: 'vb-row', style: { gap: '8px' } }, '+12 % урона', shardCost(cost, can)))))),
    ...locked.map(([n, d, u]) => h('div', { class: 'vb-card vb-row locked', style: { gap: '14px' } }, medallion('lock', 46, false),
      h('div', { class: 'vb-col', style: { gap: '2px' } }, h('span', { class: 'vb-name' }, n), h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, d), h('span', { style: { fontSize: '11px', color: UI.star } }, u)))),
  );
}

function relicsTab(app: App, refresh: () => void): HTMLElement {
  const s = app.ctx.save;
  const slot = s.loadout.relics[0];
  return h('div', { class: 'vb-col vb-rise' },
    h('div', { class: 'vb-caps', style: { color: UI.dim } }, 'Слоты реликвий: 1 · второй — за Молоха, третий — за Ткача Орбит'),
    h('div', { class: 'vb-card vb-row sel', style: { gap: '14px' } }, medallion('relic', 48, !!slot),
      h('span', {}, slot ? `${RELICS[slot]?.name ?? slot} — ${RELICS[slot]?.desc ?? ''}` : 'Пустой слот')),
    s.relics.length ? null : h('div', { class: 'vb-dim', style: { fontSize: '12px', lineHeight: '1.5' } }, 'Реликвии выпадают из сундуков стражей и боссов. Первая ждёт за Иерофантом Скорби.'),
    ...s.relics.map((id) => h('div', { class: `vb-card vb-row${slot === id ? ' sel' : ''}`, style: { gap: '14px' } }, medallion('relic', 44),
      h('div', { class: 'vb-col vb-grow', style: { gap: '2px' } }, h('span', { class: 'vb-name' }, RELICS[id]?.name ?? id), h('span', { class: 'vb-dim', style: { fontSize: '12px' } }, RELICS[id]?.desc ?? '')),
      h('button', { class: 'vb-btn small', onClick: () => { s.loadout.relics = slot === id ? [] : [id]; app.sfx('ui_confirm'); app.save(); refresh(); } }, slot === id ? 'Снять' : 'Надеть'))),
  );
}

/** Кинозал (план §8.1): увиденные сцены можно пересмотреть. */
function cinemaSection(app: App): HTMLElement {
  const s = app.ctx.save;
  // пролог открыт и тем, кто прошёл прежний текстовый пролог: новую сцену можно посмотреть здесь
  const open = CINEMA.filter((c) => (s.cine[c.id] ?? 0) > 0 || (c.id === 'prologue' && !!s.flags.prologue));
  return h('div', { class: 'vb-card' },
    h('div', { class: 'vb-name', style: { color: UI.goldHi, fontSize: '14px' } }, 'Кинозал'),
    open.length
      ? h('div', { class: 'vb-col', style: { gap: '6px', marginTop: '8px' } }, ...open.map((c) => h('div', { class: 'vb-row', style: { justifyContent: 'space-between', gap: '10px' } },
        h('div', {}, h('div', { style: { fontSize: '13px', color: UI.text } }, c.title), h('div', { style: { fontSize: '11px', color: UI.dim } }, c.sub)),
        app.canWatch(c.id) ? h('button', { class: 'vb-btn small', onClick: () => { app.sfx('ui_confirm', 0.6); app.watchScene(c.id); } }, 'Смотреть') : null)))
      : h('div', { style: { fontSize: '12px', color: UI.dim, marginTop: '6px' } }, 'Сцены откроются по ходу похода.'));
}

function loreTab(app: App): HTMLElement {
  const s = app.ctx.save;
  const ids = Object.keys(LORE);
  return h('div', { class: 'vb-col vb-rise' }, cinemaSection(app), ...ids.map((id) => {
    const open = s.lore.includes(id);
    return h('div', { class: `vb-card${open ? '' : ' locked'}` },
      h('div', { class: 'vb-name', style: { color: open ? UI.goldHi : '#5b6470', fontSize: '14px' } }, open ? LORE[id].title : '— запись не найдена —'),
      open ? h('div', { style: { fontSize: '13px', lineHeight: '1.65', marginTop: '6px', color: UI.text } }, LORE[id].text) : null);
  }));
}
