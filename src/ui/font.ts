import { FONT_DISPLAY, FONT_TECH } from './fonts';

/**
 * Заголовки (GDD §19.1, Tech §22): антиква Cormorant SC (или техно-гротеск Tektur для цифр HUD)
 * с металлическим градиентом, тёмной обводкой и свечением. size — высота прописных букв в пикселях.
 */
export interface TitleOpts {
  color?: 'gold' | 'void' | 'hunger' | 'white' | 'ether' | 'steel';
  align?: 'left' | 'center' | 'right';
  /** 0..1 — проявление слева направо (баннеры). */
  progress?: number;
  glow?: number;
  /** Межбуквенный интервал в долях высоты букв. */
  spacing?: number;
  /** Насыщенность обводки (0..2). */
  weight?: number;
  /** Дрожание (ранг SS). */
  shake?: number;
  alpha?: number;
  face?: 'display' | 'tech';
}

/** Градиент сверху вниз: блик → основной → тень → кромка; свечение. */
const PALETTES = {
  gold: ['#fff6dc', '#f0d9a0', '#c9a253', '#6e5223', 'rgba(255,190,90,0.5)'],
  void: ['#ffffff', '#e0d2ff', '#b794ff', '#5b3fb8', 'rgba(150,100,255,0.65)'],
  hunger: ['#fff0ee', '#ff9a8a', '#e11d2e', '#5e0a12', 'rgba(255,60,70,0.6)'],
  white: ['#ffffff', '#f4f0e8', '#d6d0c4', '#7d7768', 'rgba(255,240,220,0.45)'],
  ether: ['#ffffff', '#ffffff', '#f4f1ff', '#b8c3d6', 'rgba(255,255,255,0.75)'],
  steel: ['#f2f8ff', '#c4d6ea', '#7d93b0', '#2f3d50', 'rgba(110,190,230,0.5)'],
} as const;

const DEFAULT_SPACING = 0.12;
/** Отношение высоты прописных к кеглю — измеряется один раз после загрузки шрифта. */
const capRatio = new Map<string, number>();

function fontFor(face: TitleOpts['face'], size: number): { css: string; px: number } {
  const fam = face === 'tech' ? FONT_TECH : FONT_DISPLAY;
  const weight = face === 'tech' ? 600 : 700;
  let k = capRatio.get(fam);
  if (!k) {
    const g = measureCtx();
    g.font = `${weight} 100px ${fam}`;
    const m = g.measureText('НHЕE');
    k = m.actualBoundingBoxAscent > 1 ? m.actualBoundingBoxAscent / 100 : 0.66;
    if (document.fonts?.check?.(`${weight} 20px ${fam}`)) capRatio.set(fam, k);
  }
  const px = size / k;
  return { css: `${weight} ${px.toFixed(1)}px ${fam}`, px };
}

let mctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d')!;
  return mctx;
}

function letters(text: string): string[] { return [...text]; }

export function measureTitle(text: string, size: number, spacing = DEFAULT_SPACING, face: TitleOpts['face'] = 'display'): number {
  const g = measureCtx();
  g.font = fontFor(face, size).css;
  const ch = letters(text);
  let w = 0;
  for (const c of ch) w += g.measureText(c).width;
  return w + Math.max(0, ch.length - 1) * spacing * size;
}

const sprites = new Map<string, { cv: HTMLCanvasElement; w: number; pad: number; scale: number; size: number }>();

/**
 * Нарисовать заголовок; y — верх прописных букв. Возвращает ширину.
 * HUD рисует их каждый кадр: заголовок один раз рендерится в спрайт (свечение shadowBlur по буквам дорого
 * на телефоне) и дальше просто копируется; проявление — маской, дрожь — сдвигом всего спрайта.
 */
export function drawTitle(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, o: TitleOpts = {}): number {
  const t = g.getTransform();
  const scale = Math.hypot(t.a, t.b) || 1;
  const spacing = o.spacing ?? DEFAULT_SPACING, face = o.face ?? 'display';
  const isz = Math.max(4, Math.round(size));
  const key = `${text}|${isz}|${o.color}|${o.weight}|${spacing}|${o.glow}|${face}|${scale.toFixed(2)}`;
  let sp = sprites.get(key);
  if (!sp) {
    if (sprites.size > 128) sprites.clear();
    const w = measureTitle(text, isz, spacing, face), pad = isz * 0.6;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((w + pad * 2) * scale); cv.height = Math.ceil((isz * 1.6 + pad * 2) * scale);
    const c2 = cv.getContext('2d')!;
    c2.scale(scale, scale);
    drawTitleRaw(c2, text, pad, pad, isz, { ...o, align: 'left', progress: undefined, shake: 0, alpha: 1 });
    sp = { cv, w, pad, scale, size: isz };
    sprites.set(key, sp);
  }
  const k = size / sp.size, w = sp.w * k;
  const align = o.align ?? 'left';
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  g.save();
  g.globalAlpha *= o.alpha ?? 1;
  if (o.progress !== undefined && o.progress < 1) {
    g.beginPath();
    g.rect(x0 - size, y - size, (w + size * 2) * Math.max(0, o.progress), size * 3);
    g.clip();
  }
  const jx = o.shake ? (Math.random() - 0.5) * o.shake * size * 0.3 : 0, jy = o.shake ? (Math.random() - 0.5) * o.shake * size * 0.3 : 0;
  g.drawImage(sp.cv, x0 - sp.pad * k + jx, y - sp.pad * k + jy, (sp.cv.width / sp.scale) * k, (sp.cv.height / sp.scale) * k);
  g.restore();
  return w;
}

/** Заголовок напрямую (по буквам): для спрайтов и DOM-экранов. */
function drawTitleRaw(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, o: TitleOpts = {}): number {
  const spacing = o.spacing ?? DEFAULT_SPACING;
  const face = o.face ?? 'display';
  const width = measureTitle(text, size, spacing, face);
  const align = o.align ?? 'left';
  const x0 = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const pal = PALETTES[o.color ?? 'gold'];
  const { css } = fontFor(face, size);
  g.save();
  g.globalAlpha *= o.alpha ?? 1;
  g.font = css;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  const base = y + size;
  if (o.progress !== undefined && o.progress < 1) {
    // проявление: мягкая маска слева направо
    g.beginPath();
    g.rect(x0 - size, y - size, (width + size * 2) * Math.max(0, o.progress), size * 3);
    g.clip();
  }
  const grad = g.createLinearGradient(0, y - size * 0.05, 0, base + size * 0.08);
  grad.addColorStop(0, pal[0]); grad.addColorStop(0.32, pal[1]); grad.addColorStop(0.68, pal[2]); grad.addColorStop(1, pal[3]);
  const glyphs = letters(text);
  const pos: number[] = [];
  let cx = x0;
  for (const c of glyphs) { pos.push(cx); cx += g.measureText(c).width + spacing * size; }
  const jitter = () => (o.shake ? [(Math.random() - 0.5) * o.shake * size * 0.3, (Math.random() - 0.5) * o.shake * size * 0.3] : [0, 0]);
  // 1) свечение
  if ((o.glow ?? 1) > 0) {
    g.shadowColor = pal[4];
    g.shadowBlur = (o.glow ?? 1) * size * 0.45;
    g.fillStyle = pal[3];
    glyphs.forEach((c, i) => { const [sx, sy] = jitter(); g.fillText(c, pos[i] + sx, base + sy); });
    g.shadowBlur = 0;
  }
  // 2) тёмная обводка-кромка и «фаска» снизу
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(4,6,10,0.85)';
  g.lineWidth = Math.max(1, size * 0.09 * (o.weight ?? 1));
  glyphs.forEach((c, i) => g.strokeText(c, pos[i], base + size * 0.03));
  // 3) металл
  g.fillStyle = grad;
  glyphs.forEach((c, i) => { const [sx, sy] = jitter(); g.fillText(c, pos[i] + sx, base + sy); });
  // 4) тонкий светлый блик по верхней кромке
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha *= 0.18;
  g.fillStyle = pal[0];
  glyphs.forEach((c, i) => g.fillText(c, pos[i], base - size * 0.03));
  g.restore();
  return width;
}

const cache = new Map<string, HTMLCanvasElement>();

/** Отрендерить заголовок в канвас (для DOM-экранов), с кэшем. */
export function titleCanvas(text: string, size: number, o: TitleOpts = {}): HTMLCanvasElement {
  const key = `${text}|${size}|${o.color}|${o.weight}|${o.spacing}|${o.glow}|${o.face}`;
  const hit = cache.get(key);
  if (hit) return copyCanvas(hit);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pad = size * 0.55;
  const w = measureTitle(text, size, o.spacing, o.face) + pad * 2, h = size * 1.55 + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  cv.className = 'vb-title';
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  drawTitleRaw(g, text, pad, pad + size * 0.12, size, { ...o, align: 'left' });
  cache.set(key, cv);
  return copyCanvas(cv);
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.style.width = src.style.width; c.style.height = src.style.height;
  c.className = src.className;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
