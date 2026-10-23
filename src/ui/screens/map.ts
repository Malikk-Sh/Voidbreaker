import type { App } from '../../game/app';
import { ENEMIES, type EnemyKind } from '../../data/enemies';
import { stageShards, ZONE1, ZONE1_INFO, type StageDef } from '../../data/stages';
import { globalIndex, stageUnlocked, zoneStars } from '../../meta/progression';
import { fmtNum, fmtTime, h, svg } from '../dom';
import { titleCanvas } from '../font';
import { iconCanvas } from '../icons';
import { currencyBar } from './hub';
import { emblemSvg, litRays, starPoints } from '../emblem';

/** Позиции звёзд созвездия Зоны 01 (доли «рамки» 16:9). */
const POS: Record<string, [number, number]> = {
  '1-1': [0.06, 0.78], '1-2': [0.15, 0.44], '1-3': [0.25, 0.72], '1-4': [0.34, 0.32], '1-5': [0.44, 0.64], '1-6': [0.53, 0.24],
  '1-7': [0.63, 0.56], '1-8': [0.72, 0.2], '1-9': [0.81, 0.5], boss1: [0.92, 0.7],
};

/** Всего звёзд Зоны: по три за каждый этап, кроме босса. */
const STAR_TOTAL = ZONE1.filter((d) => !d.boss).length * 3;

/** Карта Созвездий (GDD §3.1, §19.2): этапы — звёзды с ★-рейтингом, врата босса с замком и счётчиком звёзд. */
export function mapScreen(app: App): HTMLElement {
  const s = app.ctx.save;
  const W = 640, H = 480;
  const stars = zoneStars(s);
  const map = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', style: 'width:100%;height:100%;overflow:visible' });
  const defs = svg('defs', {},
    svg('filter', { id: 'vbGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, svg('feGaussianBlur', { stdDeviation: '4', result: 'b' }), svg('feMerge', {}, svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' }))),
    svg('radialGradient', { id: 'vbCorona' }, svg('stop', { offset: '0.5', 'stop-color': '#000' }), svg('stop', { offset: '0.62', 'stop-color': '#ffd29a' }), svg('stop', { offset: '1', 'stop-color': 'rgba(255,190,110,0)' })),
  );
  map.appendChild(defs);
  // фоновые звёзды
  for (let i = 0; i < 90; i++) {
    const x = (i * 197.3) % W, y = (i * 113.7 + (i % 7) * 31) % H;
    map.appendChild(svg('circle', { cx: x, cy: y, r: (i % 3) * 0.5 + 0.4, fill: i % 4 ? '#cfe6f2' : '#ffe2b0', opacity: 0.15 + (i % 5) * 0.08 }));
  }
  // линии созвездия
  for (let i = 0; i < ZONE1.length - 1; i++) {
    const a = POS[ZONE1[i].id], b = POS[ZONE1[i + 1].id];
    const lit = (s.stages[ZONE1[i].id]?.clears ?? 0) > 0;
    map.appendChild(svg('line', { x1: a[0] * W, y1: a[1] * H, x2: b[0] * W, y2: b[1] * H, stroke: lit ? '#f0d9a0' : 'rgba(143,216,239,.3)', 'stroke-width': lit ? 2 : 1, 'stroke-dasharray': lit ? '' : '6 6', filter: lit ? 'url(#vbGlow)' : '' }));
  }
  let selected: StageDef = ZONE1.find((d) => stageUnlocked(s, d) && !(s.stages[d.id]?.clears)) ?? ZONE1[0];
  const info = h('div', { class: 'vb-panel vb-col vb-scroll', style: { position: 'absolute', right: 'max(18px, env(safe-area-inset-right))', bottom: 'max(14px, env(safe-area-inset-bottom))', width: 'min(360px, 42vw)', maxHeight: 'calc(100% - 80px)', gap: '6px' } });
  const nodes: { def: StageDef; g: SVGElement }[] = [];

  const renderNodes = () => {
    for (const n of nodes) n.g.remove();
    nodes.length = 0;
    for (const d of ZONE1) {
      const [px, py] = POS[d.id];
      const x = px * W, y = py * H;
      const unlocked = stageUnlocked(s, d);
      const st = s.stages[d.id];
      const cleared = (st?.clears ?? 0) > 0;
      const sel = selected.id === d.id;
      const g = svg('g', { style: 'cursor:pointer', transform: `translate(${x},${y})` });
      if (d.boss) {
        // чёрная звезда: диск + фиолетовая корона
        g.appendChild(svg('circle', { r: 44, fill: 'url(#vbCorona)', opacity: unlocked ? 0.9 : 0.4 }));
        g.appendChild(svg('circle', { r: 24, fill: '#020305', stroke: sel ? '#fff' : '#f0d9a0', 'stroke-width': sel ? 2 : 1 }));
        if (!unlocked) {
          const t = svg('text', { y: 64, 'text-anchor': 'middle', fill: '#f0d9a0', 'font-size': 16, 'font-family': 'Tektur, sans-serif', 'letter-spacing': 1 });
          t.textContent = `${stars} / ${ZONE1_INFO.bossGate}`;
          g.appendChild(t);
          g.appendChild(svg('path', { d: 'M-7 -2 h14 v12 h-14 z M-5 -2 v-5 a5 5 0 0 1 10 0 v5', fill: 'none', stroke: '#f0d9a0', 'stroke-width': 1.5 }));
        } else if (cleared) g.appendChild(svg('circle', { r: 9, fill: '#fff6dc', filter: 'url(#vbGlow)' }));
      } else {
        // узел — семиконечная звезда (план §8.8): загорается по числу ★ (0 — тёмная, 3 — сияет)
        const r = sel ? 24 : 19;
        const n0 = st?.stars ?? 0;
        if (sel) g.appendChild(svg('circle', { r: 36, fill: 'none', stroke: 'rgba(240,217,160,.7)', 'stroke-width': 1, 'stroke-dasharray': '3 5' }));
        const fill = !unlocked ? 'rgba(16,20,26,.8)' : ['rgba(22,32,44,.95)', '#6e5a34', '#c9ac6c', '#fff0c8'][n0];
        g.appendChild(svg('polygon', { points: starPoints(r, 0.48), fill, stroke: unlocked ? '#f0d9a0' : 'rgba(110,120,130,.5)', 'stroke-width': 1.5, filter: n0 >= 2 ? 'url(#vbGlow)' : '', 'data-stars': n0 }));
        const lbl = svg('text', { y: -32, 'text-anchor': 'middle', fill: unlocked ? '#ede6d6' : '#5b6470', 'font-size': 17, 'font-family': 'Tektur, sans-serif', 'letter-spacing': 1 });
        lbl.textContent = d.id;
        g.appendChild(lbl);
        const sl = svg('text', { y: 44, 'text-anchor': 'middle', 'font-size': 18, 'font-family': 'Georgia,serif', fill: '#f0d9a0' });
        const n = st?.stars ?? 0;
        sl.textContent = unlocked ? '★'.repeat(n) + '☆'.repeat(3 - n) : '';
        g.appendChild(sl);
      }
      g.addEventListener('pointerdown', () => { selected = d; app.sfx('ui_click', 0.5); renderNodes(); renderInfo(); });
      map.appendChild(g);
      nodes.push({ def: d, g });
    }
  };

  const renderInfo = () => {
    const d = selected;
    const unlocked = stageUnlocked(s, d);
    const st = s.stages[d.id];
    const kinds = new Set<EnemyKind>();
    for (const w of d.waves) for (const sp of w.spawns) kinds.add(sp.enemy);
    const first = !(st?.clears);
    const base = stageShards(globalIndex(d)) * (d.boss ? 5 : 1);
    info.replaceChildren(...([
      h('div', { class: 'vb-row', style: { justifyContent: 'space-between' } },
        h('span', { class: 'vb-caps vb-gold' }, d.boss ? 'Чёрная звезда' : `Этап ${d.id}`),
        st ? h('span', { class: 'vb-tech', style: { fontSize: '12px', color: '#8fd8ef' } }, `ранг ${st.bestRank} · ${fmtTime(st.bestTime)}`) : null),
      titleCanvas(d.name, d.name.length > 14 ? 20 : 24, { color: d.boss ? 'hunger' : 'gold', glow: 0.6, spacing: 0.06 }),
      h('div', { style: { fontSize: '12px', lineHeight: '1.5', color: '#d9d3c7' } }, h('span', { class: 'vb-caps', style: { fontSize: '9px', color: '#8b95a3' } }, 'Враги  '), [...kinds].map((k) => ENEMIES[k].name).join(', ')),
      d.boss ? null : h('div', { style: { fontSize: '12px', lineHeight: '1.7' } },
        h('div', {}, '★ Пройти этап'), h('div', {}, '★★ Закончить с ≥ 50 % HP'), h('div', {}, '★★★ Ранг этапа A или выше')),
      h('div', { class: 'vb-row', style: { fontSize: '13px', gap: '8px' } }, h('span', { class: 'vb-caps', style: { fontSize: '9px', color: '#8b95a3' } }, 'Награда'), h('span', { class: 'vb-cur', style: { color: '#8fd8ef' } }, iconCanvas('shard', 16, '#8fd8ef', 'rgba(0,0,0,0)'), fmtNum(first ? base : base * 0.6)), first ? h('span', { class: 'vb-gold', style: { fontSize: '11px' } }, 'первое прохождение') : h('span', { class: 'vb-dim', style: { fontSize: '11px' } }, 'повтор ×0.6')),
      d.unlocks?.length && first ? h('div', { class: 'vb-gold', style: { fontSize: '12px' } }, '◆ Откроет новую способность') : null,
      unlocked
        ? h('button', { class: 'vb-btn primary', style: { marginTop: '8px' }, onClick: () => { app.sfx('ui_confirm'); app.startStage(d.id); } }, d.boss ? 'Бросить вызов' : 'В бой')
        : h('div', { class: 'vb-red', style: { fontSize: '12px' } }, d.boss ? `Врата босса закрыты: нужно ${ZONE1_INFO.bossGate} звёзд из ${STAR_TOTAL} (у вас ${stars}) и пройденные «Хоры». Перепройдите этапы с прокачкой.` : 'Пройдите предыдущий этап.'),
    ].filter(Boolean) as Node[]));
  };

  renderNodes();
  renderInfo();

  const intro = h('div', { class: 'vb-type', style: { fontSize: '12px', color: '#b9c2cc', maxWidth: 'min(460px, 50vw)', lineHeight: '1.55' } });
  if (!app.ctx.flag('zone1intro')) {
    let i = 0;
    const tick = () => { i += 1; intro.textContent = ZONE1_INFO.intro.slice(0, i); if (i < ZONE1_INFO.intro.length) setTimeout(tick, 22); else app.ctx.setFlag('zone1intro'); };
    setTimeout(tick, 500);
  } else intro.textContent = ZONE1_INFO.intro;

  return h('div', { class: 'vb-screen vb-fade', style: { background: 'radial-gradient(ellipse at 40% 50%, rgba(5,7,10,.2), rgba(5,7,10,.75))' } },
    h('div', { style: { position: 'absolute', left: 'max(10px, env(safe-area-inset-left))', right: 'calc(min(360px, 42vw) + 30px)', top: '96px', bottom: '14px' } }, map),
    h('div', { class: 'vb-row', style: { position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', left: 'max(18px, env(safe-area-inset-left))', right: 'max(18px, env(safe-area-inset-right))', justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('div', { class: 'vb-row', style: { alignItems: 'flex-start' } },
        h('button', { class: 'vb-iconbtn', 'aria-label': 'Назад', onClick: () => { app.sfx('ui_back'); app.go('hub'); } }, iconCanvas('back', 22, '#f0d9a0', 'rgba(240,200,120,.5)')),
        h('div', { class: 'vb-col', style: { gap: '0' } },
          h('div', { class: 'vb-row', style: { gap: '2px', alignItems: 'center' } }, h('div', { style: { lineHeight: '0', marginRight: '4px' } }, emblemSvg(40, litRays(s))), titleCanvas(ZONE1_INFO.num, 24, { color: 'steel', face: 'tech' }), titleCanvas(ZONE1_INFO.name, 22, { color: 'gold', glow: 0.5, spacing: 0.06 })),
          h('div', { class: 'vb-caps', style: { marginTop: '-12px', marginLeft: '14px', color: '#8b95a3' } }, `«${ZONE1_INFO.subtitle}» · звёзды ${stars} / ${STAR_TOTAL}`),
          h('div', { style: { marginLeft: '14px', marginTop: '6px' } }, intro))),
      currencyBar(app)),
    info,
  );
}
