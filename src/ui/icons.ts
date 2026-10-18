/**
 * Векторные иконки (Tech §22): пути в коде → Canvas 2D, золотая обводка и мягкое свечение, кэш в offscreen-канвасах.
 */
export type IconId = 'crescent' | 'rift' | 'spiral' | 'eclipse' | 'power' | 'agility' | 'fortitude' | 'resonance' | 'shard' | 'ether'
  | 'lock' | 'star' | 'pause' | 'blade' | 'altar' | 'forge' | 'relic' | 'map' | 'skull' | 'shatter' | 'eye' | 'gear' | 'back'
  | 'fullscreen' | 'heart' | 'crit' | 'armor' | 'dash';

type Draw = (g: CanvasRenderingContext2D) => void;

/** Все пути — в квадрате [-1, 1]. */
const ICONS: Record<IconId, Draw> = {
  crescent: (g) => { g.beginPath(); g.arc(0, 0, 0.8, -2.2, 2.2); g.arc(0.38, 0, 0.62, 1.95, -1.95, true); g.closePath(); },
  rift: (g) => { g.beginPath(); g.moveTo(-0.8, 0.8); g.lineTo(-0.2, 0.1); g.lineTo(-0.45, 0); g.lineTo(0.8, -0.8); g.lineTo(0.2, -0.1); g.lineTo(0.45, 0); g.closePath(); },
  spiral: (g) => {
    g.beginPath();
    for (let i = 0; i <= 60; i++) { const a = i * 0.21, r = 0.08 + i * 0.0125; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  },
  eclipse: (g) => { g.beginPath(); g.arc(0, 0, 0.45, 0, Math.PI * 2); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.moveTo(Math.cos(a) * 0.58, Math.sin(a) * 0.58); g.lineTo(Math.cos(a) * (i % 2 ? 0.75 : 0.92), Math.sin(a) * (i % 2 ? 0.75 : 0.92)); } },
  power: (g) => { g.beginPath(); g.moveTo(0, -0.9); g.lineTo(0.14, 0.3); g.lineTo(-0.14, 0.3); g.closePath(); g.moveTo(-0.45, 0.32); g.lineTo(0.45, 0.32); g.moveTo(0, 0.32); g.lineTo(0, 0.85); },
  agility: (g) => { g.beginPath(); g.moveTo(-0.8, 0.5); g.quadraticCurveTo(0, -0.2, 0.8, -0.7); g.moveTo(-0.6, 0.75); g.quadraticCurveTo(0.1, 0.2, 0.75, -0.25); g.moveTo(-0.3, 0.85); g.quadraticCurveTo(0.3, 0.55, 0.7, 0.2); },
  fortitude: (g) => { g.beginPath(); g.moveTo(0, -0.85); g.lineTo(0.7, -0.55); g.lineTo(0.6, 0.25); g.lineTo(0, 0.85); g.lineTo(-0.6, 0.25); g.lineTo(-0.7, -0.55); g.closePath(); g.moveTo(0, -0.5); g.lineTo(0, 0.5); },
  resonance: (g) => { g.beginPath(); g.moveTo(-0.9, 0); for (let i = 0; i <= 40; i++) { const x = -0.9 + i * 0.045; g.lineTo(x, Math.sin(i * 0.5) * 0.45 * Math.sin((i / 40) * Math.PI)); } },
  shard: (g) => { g.beginPath(); g.moveTo(0, -0.9); g.lineTo(0.45, -0.1); g.lineTo(0.2, 0.85); g.lineTo(-0.2, 0.85); g.lineTo(-0.45, -0.1); g.closePath(); g.moveTo(0, -0.9); g.lineTo(0, 0.85); },
  ether: (g) => { g.beginPath(); g.moveTo(0, -0.9); g.bezierCurveTo(0.7, -0.2, 0.55, 0.8, 0, 0.85); g.bezierCurveTo(-0.55, 0.8, -0.7, -0.2, 0, -0.9); g.moveTo(0, -0.2); g.bezierCurveTo(0.25, 0.2, 0.2, 0.6, 0, 0.62); g.bezierCurveTo(-0.2, 0.6, -0.25, 0.2, 0, -0.2); },
  lock: (g) => { g.beginPath(); g.rect(-0.55, -0.1, 1.1, 0.9); g.moveTo(-0.35, -0.1); g.lineTo(-0.35, -0.45); g.arc(0, -0.45, 0.35, Math.PI, 0); g.lineTo(0.35, -0.1); },
  star: (g) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.38 : 0.9; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); },
  pause: (g) => { g.beginPath(); g.rect(-0.5, -0.6, 0.32, 1.2); g.rect(0.18, -0.6, 0.32, 1.2); },
  blade: (g) => { g.beginPath(); g.moveTo(0.85, -0.85); g.lineTo(-0.3, 0.2); g.lineTo(-0.1, 0.35); g.closePath(); g.moveTo(-0.55, 0.05); g.lineTo(0.05, 0.6); g.moveTo(-0.25, 0.35); g.lineTo(-0.75, 0.85); },
  altar: (g) => { g.beginPath(); g.moveTo(-0.8, 0.8); g.lineTo(0.8, 0.8); g.moveTo(-0.6, 0.8); g.lineTo(-0.5, 0.2); g.lineTo(0.5, 0.2); g.lineTo(0.6, 0.8); g.moveTo(0, 0.05); g.lineTo(0.22, -0.4); g.lineTo(0, -0.9); g.lineTo(-0.22, -0.4); g.closePath(); },
  forge: (g) => { g.beginPath(); g.moveTo(-0.8, -0.1); g.lineTo(0.8, -0.1); g.lineTo(0.5, 0.2); g.lineTo(-0.5, 0.2); g.closePath(); g.moveTo(-0.25, 0.2); g.lineTo(-0.35, 0.8); g.lineTo(0.35, 0.8); g.lineTo(0.25, 0.2); g.moveTo(-0.6, -0.4); g.lineTo(0.2, -0.85); },
  relic: (g) => { g.beginPath(); g.moveTo(0, -0.9); g.lineTo(0.6, -0.2); g.lineTo(0.35, 0.8); g.lineTo(-0.35, 0.8); g.lineTo(-0.6, -0.2); g.closePath(); g.moveTo(-0.6, -0.2); g.lineTo(0.6, -0.2); g.moveTo(0, -0.9); g.lineTo(0, 0.8); },
  map: (g) => { g.beginPath(); const p = [[-0.7, 0.5], [-0.2, -0.3], [0.3, 0.1], [0.75, -0.6]]; g.moveTo(p[0][0], p[0][1]); for (const q of p.slice(1)) g.lineTo(q[0], q[1]); for (const q of p) { g.moveTo(q[0] + 0.12, q[1]); g.arc(q[0], q[1], 0.12, 0, Math.PI * 2); } },
  skull: (g) => { g.beginPath(); g.arc(0, -0.15, 0.6, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(0.35, 0.75); g.lineTo(-0.35, 0.75); g.closePath(); g.moveTo(-0.15, -0.1); g.arc(-0.25, -0.1, 0.12, 0, Math.PI * 2); g.moveTo(0.35, -0.1); g.arc(0.25, -0.1, 0.12, 0, Math.PI * 2); },
  shatter: (g) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2, r0 = 0.22, r1 = i % 2 ? 0.62 : 0.92; g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); }
    g.moveTo(0.18, 0); g.lineTo(0, 0.18); g.lineTo(-0.18, 0); g.lineTo(0, -0.18); g.closePath();
  },
  fullscreen: (g) => { g.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(sx * 0.8, sy * 0.3); g.lineTo(sx * 0.8, sy * 0.8); g.lineTo(sx * 0.3, sy * 0.8); } },
  heart: (g) => { g.beginPath(); g.moveTo(0, 0.8); g.bezierCurveTo(-0.95, 0.1, -0.7, -0.85, 0, -0.35); g.bezierCurveTo(0.7, -0.85, 0.95, 0.1, 0, 0.8); g.closePath(); },
  crit: (g) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI * 2, r = i % 2 ? 0.3 : 0.9; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); },
  armor: (g) => { g.beginPath(); g.moveTo(-0.7, -0.6); g.lineTo(0, -0.85); g.lineTo(0.7, -0.6); g.lineTo(0.55, 0.3); g.lineTo(0, 0.85); g.lineTo(-0.55, 0.3); g.closePath(); g.moveTo(-0.35, -0.2); g.lineTo(0.35, -0.2); },
  dash: (g) => { g.beginPath(); g.moveTo(-0.85, -0.5); g.lineTo(0.1, -0.5); g.moveTo(-0.6, 0); g.lineTo(0.35, 0); g.moveTo(-0.85, 0.5); g.lineTo(0.1, 0.5); g.moveTo(0.3, -0.75); g.lineTo(0.85, 0); g.lineTo(0.3, 0.75); },
  eye: (g) => { g.beginPath(); g.moveTo(-0.9, 0); g.quadraticCurveTo(0, -0.75, 0.9, 0); g.quadraticCurveTo(0, 0.75, -0.9, 0); g.moveTo(0.28, 0); g.arc(0, 0, 0.28, 0, Math.PI * 2); },
  gear: (g) => { g.beginPath(); for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 0.62 : 0.85; if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r); else g.moveTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.moveTo(0.3, 0); g.arc(0, 0, 0.3, 0, Math.PI * 2); },
  back: (g) => { g.beginPath(); g.moveTo(0.5, -0.7); g.lineTo(-0.3, 0); g.lineTo(0.5, 0.7); },
};

const cache = new Map<string, HTMLCanvasElement>();

/** Иконка в канвасе size × size (CSS px): обводка золотом/фиолетом + свечение. */
export function iconCanvas(id: IconId, size: number, color = '#e3c37e', glow = 'rgba(240,200,120,0.55)', fill = false): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${id}|${size}|${color}|${glow}|${fill}|${dpr}`;
  let cv = cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(size * dpr);
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    drawIcon(g, id, size / 2, size / 2, size * 0.36, color, glow, fill);
    cache.set(key, cv);
  }
  const out = document.createElement('canvas');
  out.width = cv.width; out.height = cv.height;
  out.style.width = out.style.height = `${size}px`;
  out.getContext('2d')!.drawImage(cv, 0, 0);
  return out;
}

export function drawIcon(g: CanvasRenderingContext2D, id: IconId, cx: number, cy: number, r: number, color = '#e3c37e', glow = 'rgba(240,200,120,0.55)', fill = false): void {
  g.save();
  g.translate(cx, cy);
  g.scale(r, r);
  g.lineWidth = 2.2 / r;
  g.lineJoin = 'miter';
  g.strokeStyle = color;
  g.shadowColor = glow;
  g.shadowBlur = r * 0.5;
  ICONS[id](g);
  if (fill) { g.fillStyle = color; g.fill(); }
  g.stroke();
  g.restore();
}
