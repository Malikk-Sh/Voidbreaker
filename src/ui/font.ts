/**
 * Процедурный «рубленый» шрифт заголовков (GDD §19.1, Tech §22): каждый глиф — набор ломаных в квадрате 4 × 6,
 * рендер — гранёные «клинковые» штрихи (вытянутые шестиугольники с острыми концами) с градиентом.
 * Без файлов шрифтов.
 */
type Glyph = number[][];

const O: number[] = [1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0];
const DOT = (x: number, y: number): number[] => [x, y - 0.25, x, y + 0.25];

const G: Record<string, Glyph> = {
  'А': [[0, 6, 2, 0, 4, 6], [0.8, 3.9, 3.2, 3.9]],
  'Б': [[4, 0, 0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
  'В': [[0, 3, 3, 3, 4, 2, 4, 1, 3, 0, 0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
  'Г': [[4, 0, 0, 0, 0, 6]],
  'Д': [[-0.3, 7, -0.3, 6, 4.3, 6, 4.3, 7], [0.4, 6, 1.2, 0, 3.6, 0, 3.6, 6]],
  'Е': [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  'Ё': [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3], DOT(1.2, -1), DOT(2.8, -1)],
  'Ж': [[0, 0, 2, 3, 0, 6], [4, 0, 2, 3, 4, 6], [2, 0, 2, 6]],
  'З': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1.5, 3], [3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  'И': [[0, 0, 0, 6, 4, 0, 4, 6]],
  'Й': [[0, 0, 0, 6, 4, 0, 4, 6], [1, -1.2, 2, -0.5, 3, -1.2]],
  'К': [[0, 0, 0, 6], [4, 0, 0.6, 3, 4, 6]],
  'Л': [[0, 6, 1.4, 0, 4, 0, 4, 6]],
  'М': [[0, 6, 0, 0, 2, 3.6, 4, 0, 4, 6]],
  'Н': [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  'О': [O],
  'П': [[0, 6, 0, 0, 4, 0, 4, 6]],
  'Р': [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]],
  'С': [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
  'Т': [[0, 0, 4, 0], [2, 0, 2, 6]],
  'У': [[0, 0, 2, 3.6], [4, 0, 1, 6]],
  'Ф': [[2, 0, 2, 6], [2, 1, 0.8, 1, 0, 1.8, 0, 3.2, 0.8, 4, 3.2, 4, 4, 3.2, 4, 1.8, 3.2, 1, 2, 1]],
  'Х': [[0, 0, 4, 6], [4, 0, 0, 6]],
  'Ц': [[0, 0, 0, 6, 4, 6, 4, 0], [4, 6, 4.6, 7.2]],
  'Ч': [[0, 0, 0, 2.5, 1, 3.5, 4, 3.5], [4, 0, 4, 6]],
  'Ш': [[0, 0, 0, 6, 4, 6, 4, 0], [2, 0, 2, 6]],
  'Щ': [[0, 0, 0, 6, 4, 6, 4, 0], [2, 0, 2, 6], [4, 6, 4.6, 7.2]],
  'Ъ': [[-0.6, 0, 0.8, 0, 0.8, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0.8, 3]],
  'Ы': [[0, 0, 0, 6, 2, 6, 2.8, 5.2, 2.8, 3.8, 2, 3, 0, 3], [4, 0, 4, 6]],
  'Ь': [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
  'Э': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5], [1.5, 3, 4, 3]],
  'Ю': [[0, 0, 0, 6], [0, 3, 1.4, 3], [2.3, 0, 3.3, 0, 4.1, 1, 4.1, 5, 3.3, 6, 2.3, 6, 1.5, 5, 1.5, 1, 2.3, 0]],
  'Я': [[4, 6, 4, 0, 1, 0, 0, 1, 0, 2, 1, 3, 4, 3], [2.2, 3, 0, 6]],
  'A': [[0, 6, 2, 0, 4, 6], [0.8, 3.9, 3.2, 3.9]],
  'B': [[0, 3, 3, 3, 4, 2, 4, 1, 3, 0, 0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
  'C': [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
  'D': [[0, 0, 2.5, 0, 4, 1.5, 4, 4.5, 2.5, 6, 0, 6, 0, 0]],
  'E': [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  'F': [[4, 0, 0, 0, 0, 6], [0, 3, 3, 3]],
  'G': [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3.2, 2.2, 3.2]],
  'H': [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  'I': [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
  'J': [[1, 0, 4, 0], [3, 0, 3, 5, 2, 6, 1, 6, 0, 5]],
  'K': [[0, 0, 0, 6], [4, 0, 0.6, 3, 4, 6]],
  'L': [[0, 0, 0, 6, 4, 6]],
  'M': [[0, 6, 0, 0, 2, 3.6, 4, 0, 4, 6]],
  'N': [[0, 6, 0, 0, 4, 6, 4, 0]],
  'O': [O],
  'P': [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]],
  'Q': [O, [2.6, 4.6, 4.4, 6.6]],
  'R': [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [1.8, 3, 4, 6]],
  'S': [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  'T': [[0, 0, 4, 0], [2, 0, 2, 6]],
  'U': [[0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]],
  'V': [[0, 0, 2, 6, 4, 0]],
  'W': [[0, 0, 1, 6, 2, 3, 3, 6, 4, 0]],
  'X': [[0, 0, 4, 6], [4, 0, 0, 6]],
  'Y': [[0, 0, 2, 3], [4, 0, 2, 3, 2, 6]],
  'Z': [[0, 0, 4, 0, 0, 6, 4, 6]],
  '0': [O, [3.3, 0.8, 0.7, 5.2]],
  '1': [[0.9, 1.2, 2.2, 0, 2.2, 6], [1, 6, 3.4, 6]],
  '2': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 0, 6, 4, 6]],
  '3': [[0, 0, 4, 0, 2, 2.6, 3, 2.6, 4, 3.6, 4, 5, 3, 6, 1, 6, 0, 5]],
  '4': [[3, 6, 3, 0, 0, 4, 4, 4]],
  '5': [[4, 0, 0.4, 0, 0, 2.6, 3, 2.6, 4, 3.6, 4, 5, 3, 6, 1, 6, 0, 5]],
  '6': [[3.6, 0, 1.5, 0, 0, 2, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3.6, 3, 2.8, 1, 2.8, 0, 3.6]],
  '7': [[0, 0, 4, 0, 1.5, 6]],
  '8': [[1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
  '9': [[0.4, 6, 2.5, 6, 4, 4, 4, 1, 3, 0, 1, 0, 0, 1, 0, 2.4, 1, 3.2, 3, 3.2, 4, 2.4]],
  '.': [DOT(2, 5.7)],
  ',': [[2.3, 5.3, 1.6, 6.9]],
  ':': [DOT(2, 2), DOT(2, 5.7)],
  '!': [[2, 0, 2, 4.2], DOT(2, 5.7)],
  '?': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 2, 3.4, 2, 4.2], DOT(2, 5.7)],
  '-': [[0.8, 3, 3.2, 3]],
  '—': [[-0.5, 3, 4.5, 3]],
  '/': [[0, 6, 4, 0]],
  '«': [[2, 1.5, 0.5, 3, 2, 4.5], [4, 1.5, 2.5, 3, 4, 4.5]],
  '»': [[0, 1.5, 1.5, 3, 0, 4.5], [2, 1.5, 3.5, 3, 2, 4.5]],
  '(': [[3, 0, 1.5, 1.5, 1.5, 4.5, 3, 6]],
  ')': [[1, 0, 2.5, 1.5, 2.5, 4.5, 1, 6]],
  '+': [[2, 1.5, 2, 4.5], [0.5, 3, 3.5, 3]],
  '×': [[0.8, 1.8, 3.2, 4.2], [3.2, 1.8, 0.8, 4.2]],
  '%': [[0, 6, 4, 0], DOT(0.6, 0.8), DOT(3.4, 5.2)],
  '…': [DOT(0.4, 5.7), DOT(2, 5.7), DOT(3.6, 5.7)],
  '\'': [[2, 0, 2, 1.6]],
  '"': [[1.3, 0, 1.3, 1.6], [2.7, 0, 2.7, 1.6]],
  '★': [[2, 0, 2.6, 2.1, 4.4, 2.2, 3, 3.6, 3.6, 6, 2, 4.6, 0.4, 6, 1, 3.6, -0.4, 2.2, 1.4, 2.1, 2, 0]],
  '◆': [[2, 0.5, 4, 3, 2, 5.5, 0, 3, 2, 0.5]],
};

export const FONT_GLYPHS = G;

export interface TitleOpts {
  color?: 'gold' | 'void' | 'hunger' | 'white' | 'ether';
  align?: 'left' | 'center' | 'right';
  /** 0..1 — штрихи прорисовываются по очереди. */
  progress?: number;
  glow?: number;
  spacing?: number;
  weight?: number;
  /** Дрожание (ранг SS). */
  shake?: number;
  alpha?: number;
}

const PALETTES = {
  gold: ['#fff1c8', '#e2c27a', '#B8954E', '#6b5226', 'rgba(255,190,90,0.55)'],
  void: ['#ffffff', '#d8c4ff', '#B794FF', '#5b3fb8', 'rgba(150,100,255,0.7)'],
  hunger: ['#ffe2e2', '#ff8a8a', '#E11D2E', '#6B0A13', 'rgba(255,60,70,0.7)'],
  white: ['#ffffff', '#f1e8ff', '#cfc3e8', '#8a80a0', 'rgba(220,200,255,0.5)'],
  ether: ['#ffffff', '#ffffff', '#F4F1FF', '#bdb5d6', 'rgba(255,255,255,0.8)'],
} as const;

const ADV = 4, GAP = 1.25, SPACE = 3;

export function measureTitle(text: string, size: number, spacing = GAP): number {
  const u = size / 6;
  let w = 0;
  for (const ch of text.toUpperCase()) w += (ch === ' ' ? SPACE : ADV) + spacing;
  return Math.max(0, w - spacing) * u;
}

/** Нарисовать заголовок процедурным шрифтом. Возвращает ширину. */
export function drawTitle(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, o: TitleOpts = {}): number {
  const u = size / 6;
  const spacing = o.spacing ?? GAP;
  const width = measureTitle(text, size, spacing);
  const align = o.align ?? 'left';
  let cx = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const pal = PALETTES[o.color ?? 'gold'];
  const wgt = (o.weight ?? 1) * u * 0.62;
  const chars = [...text.toUpperCase()];
  // счётчик штрихов для прогрессивной прорисовки
  let total = 0;
  for (const ch of chars) for (const pl of G[ch] ?? []) total += Math.max(1, pl.length / 2 - 1);
  const shown = (o.progress ?? 1) * total;
  let idx = 0;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  const grad = g.createLinearGradient(0, y, 0, y + size);
  grad.addColorStop(0, pal[0]); grad.addColorStop(0.35, pal[1]); grad.addColorStop(0.7, pal[2]); grad.addColorStop(1, pal[3]);
  g.fillStyle = grad;
  g.shadowColor = pal[4];
  g.shadowBlur = (o.glow ?? 1) * size * 0.35;
  for (const ch of chars) {
    if (ch === ' ') { cx += (SPACE + spacing) * u; continue; }
    const glyph = G[ch];
    const sx = o.shake ? (Math.random() - 0.5) * o.shake * u : 0, sy = o.shake ? (Math.random() - 0.5) * o.shake * u : 0;
    if (glyph) {
      for (const pl of glyph) {
        for (let i = 0; i + 3 < pl.length; i += 2) {
          if (idx >= shown) break;
          const part = Math.min(1, shown - idx);
          idx++;
          const x0 = cx + pl[i] * u + sx, y0 = y + pl[i + 1] * u + sy;
          let x1 = cx + pl[i + 2] * u + sx, y1 = y + pl[i + 3] * u + sy;
          if (part < 1) { x1 = x0 + (x1 - x0) * part; y1 = y0 + (y1 - y0) * part; }
          bladeStroke(g, x0, y0, x1, y1, wgt);
        }
      }
    }
    cx += (ADV + spacing) * u;
  }
  g.restore();
  return width;
}

/** Штрих-клинок: вытянутый шестиугольник с острыми концами. */
function bladeStroke(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number): void {
  let dx = x1 - x0, dy = y1 - y0;
  let l = Math.hypot(dx, dy);
  if (l < 1e-3) { dx = 0; dy = 1; l = w * 0.9; x0 -= 0; y0 -= l / 2; x1 = x0; y1 = y0 + l; }
  const tx = dx / l, ty = dy / l, nx = -ty, ny = tx;
  const h = w / 2, tip = Math.min(w * 0.75, l * 0.4);
  // продлеваем концы, чтобы стыки ломаных смыкались остриями
  const ex0 = x0 - tx * h * 0.6, ey0 = y0 - ty * h * 0.6, ex1 = x1 + tx * h * 0.6, ey1 = y1 + ty * h * 0.6;
  g.beginPath();
  g.moveTo(ex0, ey0);
  g.lineTo(ex0 + tx * tip + nx * h, ey0 + ty * tip + ny * h);
  g.lineTo(ex1 - tx * tip + nx * h, ey1 - ty * tip + ny * h);
  g.lineTo(ex1, ey1);
  g.lineTo(ex1 - tx * tip - nx * h, ey1 - ty * tip - ny * h);
  g.lineTo(ex0 + tx * tip - nx * h, ey0 + ty * tip - ny * h);
  g.closePath();
  g.fill();
}

const cache = new Map<string, HTMLCanvasElement>();

/** Отрендерить заголовок в канвас (для DOM-экранов), с кэшем. */
export function titleCanvas(text: string, size: number, o: TitleOpts = {}): HTMLCanvasElement {
  const key = `${text}|${size}|${o.color}|${o.weight}|${o.spacing}|${o.glow}`;
  const hit = cache.get(key);
  if (hit) return copyCanvas(hit);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pad = size * 0.6;
  const w = measureTitle(text, size, o.spacing) + pad * 2, h = size * 1.4 + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  drawTitle(g, text, pad, pad, size, { ...o, align: 'left' });
  cache.set(key, cv);
  return copyCanvas(cv);
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.style.width = src.style.width; c.style.height = src.style.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
