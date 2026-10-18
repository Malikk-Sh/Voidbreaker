/**
 * Логотип VOIDBREAKER — собственные глифы: рубленые «клинковые» буквы с фасками (сетка 10 единиц по высоте),
 * металлическая заливка, тёмная экструзия и диагональный разрез клинком Пустоты через всё слово.
 */
type Poly = number[];
interface Glyph { w: number; polys: Poly[] }

const GLYPHS: Record<string, Glyph> = {
  V: { w: 8, polys: [[0, 0, 2.5, 0, 4, 6.6, 5.5, 0, 8, 0, 5.3, 10, 2.7, 10]] },
  O: { w: 8, polys: [[1.7, 0, 6.3, 0, 8, 1.7, 8, 8.3, 6.3, 10, 1.7, 10, 0, 8.3, 0, 1.7], [2.9, 2.2, 5.1, 2.2, 5.8, 2.9, 5.8, 7.1, 5.1, 7.8, 2.9, 7.8, 2.2, 7.1, 2.2, 2.9]] },
  I: { w: 2.5, polys: [[0, 0, 2.5, 0, 2.5, 8.7, 1.25, 10.9, 0, 8.7]] },
  D: { w: 8, polys: [[0, 0, 5.3, 0, 8, 2.7, 8, 7.3, 5.3, 10, 0, 10], [2.3, 2.2, 4.5, 2.2, 5.8, 3.5, 5.8, 6.5, 4.5, 7.8, 2.3, 7.8]] },
  B: { w: 8, polys: [[0, 0, 6.2, 0, 7.6, 1.4, 7.6, 3.6, 6.5, 4.7, 8, 6.2, 8, 8.6, 6.6, 10, 0, 10], [2.3, 2.0, 4.9, 2.0, 5.4, 2.5, 5.4, 3.4, 4.9, 3.9, 2.3, 3.9], [2.3, 5.8, 5.3, 5.8, 5.8, 6.3, 5.8, 7.5, 5.3, 8.0, 2.3, 8.0]] },
  R: { w: 8.3, polys: [[0, 0, 6.2, 0, 7.8, 1.6, 7.8, 4.2, 6.3, 5.7, 8.3, 10, 5.8, 10, 4.1, 6.0, 2.3, 6.0, 2.3, 10, 0, 10], [2.3, 2.0, 5.0, 2.0, 5.5, 2.5, 5.5, 3.5, 5.0, 4.0, 2.3, 4.0]] },
  E: { w: 7.4, polys: [[0, 0, 7.4, 0, 7.4, 2.1, 2.3, 2.1, 2.3, 3.95, 6.2, 3.95, 7.1, 5.0, 6.2, 6.05, 2.3, 6.05, 2.3, 7.9, 7.4, 7.9, 7.4, 10, 0, 10]] },
  A: { w: 8, polys: [[0, 10, 2.8, 0, 5.2, 0, 8, 10, 5.7, 10, 5.1, 7.7, 2.9, 7.7, 2.3, 10], [3.4, 5.7, 4.6, 5.7, 4.0, 3.0]] },
  K: { w: 8.4, polys: [[0, 0, 2.3, 0, 2.3, 4.0, 5.3, 0, 8.2, 0, 4.4, 4.9, 8.4, 10, 5.5, 10, 2.3, 5.9, 2.3, 10, 0, 10]] },
};

const GAP = 1.05;

function trace(g: CanvasRenderingContext2D, ch: Glyph, x: number, y: number, u: number): void {
  for (const p of ch.polys) {
    g.moveTo(x + p[0] * u, y + p[1] * u);
    for (let i = 2; i < p.length; i += 2) g.lineTo(x + p[i] * u, y + p[i + 1] * u);
    g.closePath();
  }
}

function wordPath(g: CanvasRenderingContext2D, text: string, x: number, y: number, u: number): void {
  g.beginPath();
  let cx = x;
  for (const c of text) {
    const gl = GLYPHS[c];
    if (!gl) { cx += 4 * u; continue; }
    trace(g, gl, cx, y, u);
    cx += (gl.w + GAP) * u;
  }
}

export function logoWidth(text: string, u: number): number {
  let w = 0;
  for (const c of text) w += ((GLYPHS[c]?.w ?? 3) + GAP) * u;
  return w - GAP * u;
}

/** Нарисовать логотип: x, y — левый верхний угол букв, height — высота прописных. cut 0..1 — раскрытие разреза. */
export function drawLogo(g: CanvasRenderingContext2D, text: string, x: number, y: number, height: number, cut = 1, time = 0): void {
  const u = height / 10;
  const W = logoWidth(text, u);
  // линия разреза: от нижнего левого к верхнему правому краю слова
  const ax = x - u * 2, ay = y + height * 0.78, bx = x + W + u * 2, by = y + height * 0.22;
  const nx = -(by - ay), ny = bx - ax; const nl = Math.hypot(nx, ny);
  const off = cut * u * 0.55;
  const parts: [number, number, boolean][] = [[0, 0, false], [off * 0.9, -off * 0.6, true]];
  for (const [dx, dy, upper] of parts) {
    g.save();
    // полуплоскость относительно линии разреза
    g.beginPath();
    const far = W * 4;
    const sx = (nx / nl) * far * (upper ? -1 : 1), sy = (ny / nl) * far * (upper ? -1 : 1);
    g.moveTo(ax - (bx - ax), ay - (by - ay)); g.lineTo(bx + (bx - ax), by + (by - ay));
    g.lineTo(bx + (bx - ax) + sx, by + (by - ay) + sy); g.lineTo(ax - (bx - ax) + sx, ay - (by - ay) + sy);
    g.closePath();
    g.clip();
    g.translate(dx, dy);
    // свечение
    g.shadowColor = 'rgba(120,180,230,0.35)';
    g.shadowBlur = height * 0.5;
    g.fillStyle = '#10161f';
    wordPath(g, text, x, y + u * 0.6, u); g.fill('evenodd');
    g.shadowBlur = 0;
    // экструзия (тёмная толщина снизу)
    for (let k = 4; k >= 1; k--) {
      g.fillStyle = k === 1 ? '#3a2a14' : '#140f0a';
      wordPath(g, text, x, y + u * 0.14 * k, u); g.fill('evenodd');
    }
    // металл
    const grad = g.createLinearGradient(0, y, 0, y + height);
    grad.addColorStop(0, '#fffaf0'); grad.addColorStop(0.18, '#f3dea9'); grad.addColorStop(0.5, '#c9a253');
    grad.addColorStop(0.52, '#8e6a2c'); grad.addColorStop(0.8, '#c39a4c'); grad.addColorStop(1, '#5d431b');
    g.fillStyle = grad;
    wordPath(g, text, x, y, u); g.fill('evenodd');
    // кромка
    g.strokeStyle = 'rgba(255,244,214,0.55)'; g.lineWidth = Math.max(1, u * 0.12); g.lineJoin = 'miter';
    wordPath(g, text, x, y, u); g.stroke();
    // бегущий блик
    const sweep = ((time * 0.18) % 1.6) - 0.3;
    const sg = g.createLinearGradient(x + W * sweep - height, y, x + W * sweep + height, y + height);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.35)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = sg;
    wordPath(g, text, x, y, u); g.fill('evenodd');
    g.restore();
  }
  // свет Пустоты в разрезе
  if (cut > 0) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const lg = g.createLinearGradient(ax, ay, bx, by);
    lg.addColorStop(0, 'rgba(139,92,246,0)'); lg.addColorStop(0.18, 'rgba(183,148,255,0.85)'); lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(0.82, 'rgba(183,148,255,0.85)'); lg.addColorStop(1, 'rgba(139,92,246,0)');
    const sx0 = ax + off * 0.45, sy0 = ay - off * 0.3, sx1 = bx + off * 0.45, sy1 = by - off * 0.3;
    g.strokeStyle = lg;
    g.shadowColor = 'rgba(150,100,255,0.95)'; g.shadowBlur = height * 0.35;
    g.lineWidth = Math.max(1.2, u * 0.34 * cut);
    g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx1, sy1); g.stroke();
    g.shadowBlur = 0;
    g.lineWidth = Math.max(0.6, u * 0.08);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.moveTo(sx0 + (sx1 - sx0) * 0.15, sy0 + (sy1 - sy0) * 0.15); g.lineTo(sx0 + (sx1 - sx0) * 0.85, sy0 + (sy1 - sy0) * 0.85); g.stroke();
    g.restore();
  }
}

/** Канвас с логотипом для DOM (анимируемый блик — через redraw). */
export function logoCanvas(text: string, height: number): { el: HTMLCanvasElement; draw: (cut: number, time: number) => void } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const u = height / 10;
  const pad = height * 0.7;
  const w = logoWidth(text, u) + pad * 2, h = height + pad * 2;
  const el = document.createElement('canvas');
  el.width = Math.ceil(w * dpr); el.height = Math.ceil(h * dpr);
  el.style.width = `${w}px`; el.style.height = `${h}px`;
  const g = el.getContext('2d')!;
  const draw = (cut: number, time: number) => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    drawLogo(g, text, pad, pad, height, cut, time);
  };
  draw(1, 0);
  return { el, draw };
}
