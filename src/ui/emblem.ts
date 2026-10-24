import type { SaveData } from '../meta/save';
import { svg } from './dom';

/** Эмблема прогресса (план §8.8): лучей — по числу зон; два последних тёмные до эндгейма. */
export const EMBLEM = { rays: 7, dark: 2 };

/** Сколько лучей горит: по одному за каждую зону, где побеждён босс (звезда зоны зажжена). */
export function litRays(save: Pick<SaveData, 'stars'>): number {
  let n = 0;
  for (let z = 1; z <= EMBLEM.rays; z++) if ((save.stars[`z${z}`] ?? 0) > 0) n++;
  return n;
}

/** Вершины семиконечной звезды (луч вверх): внешний радиус r, внутренний k·r. */
export function starPoints(r: number, k = 0.45, points = 7): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * k : r, a = (i / (points * 2)) * Math.PI * 2;
    out.push(`${(Math.sin(a) * rr).toFixed(2)},${(-Math.cos(a) * rr).toFixed(2)}`);
  }
  return out.join(' ');
}

/**
 * Эмблема прогресса — семиконечная звезда, лучи по часовой от верхнего: горящий — золото со свечением,
 * ещё не зажжённый — тёмный с золотой кромкой, последние EMBLEM.dark — обсидиан без кромки (до эндгейма).
 */
export function emblemSvg(size: number, lit: number): SVGElement {
  const R = 46, k = 0.42;
  const root = svg('svg', { viewBox: '-50 -50 100 100', width: size, height: size, style: 'overflow:visible' },
    svg('defs', {}, svg('filter', { id: 'vbEmbGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, svg('feGaussianBlur', { stdDeviation: '2.4', result: 'b' }), svg('feMerge', {}, svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })))));
  root.appendChild(svg('polygon', { points: starPoints(R + 2, k), fill: 'rgba(5,7,10,.75)', stroke: 'rgba(240,217,160,.25)', 'stroke-width': 0.8 }));
  for (let i = 0; i < EMBLEM.rays; i++) {
    // луч — треугольник от центра к вершине между соседними внутренними точками
    const a = (i / EMBLEM.rays) * Math.PI * 2, da = Math.PI / EMBLEM.rays;
    const p = (ang: number, r: number) => `${(Math.sin(ang) * r).toFixed(2)},${(-Math.cos(ang) * r).toFixed(2)}`;
    const pts = `0,0 ${p(a - da, R * k)} ${p(a, R)} ${p(a + da, R * k)}`;
    const on = i < lit, dark = i >= EMBLEM.rays - EMBLEM.dark && !on;
    root.appendChild(svg('polygon', {
      points: pts,
      fill: on ? '#f0d9a0' : dark ? '#07080b' : 'rgba(22,28,38,.95)',
      stroke: on ? '#fff6dc' : dark ? 'rgba(80,70,60,.35)' : 'rgba(240,217,160,.55)',
      'stroke-width': on ? 1 : 0.8,
      filter: on ? 'url(#vbEmbGlow)' : '',
      'data-ray': on ? 'lit' : dark ? 'dark' : 'off',
    }));
  }
  root.appendChild(svg('circle', { r: 5, fill: lit > 0 ? '#fff6dc' : '#1a1f28', stroke: '#f0d9a0', 'stroke-width': 0.8 }));
  return root;
}
