import * as THREE from 'three';
import { hash2 } from '../../core/noise';

/** Matcap «обсидиан» (Tech §6.1): тёмная сфера + узкий яркий блик + цветной рим. Здесь matcap — это отражение. */
export function makeMatcap(c0: string, highlight: string, rim: string, size = 256, skySheen = 0.35): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d')!, r = size / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const base = g.createRadialGradient(r * 0.7, r * 0.6, 0, r, r, r);
  base.addColorStop(0, c0); base.addColorStop(1, '#000');
  g.fillStyle = base; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  // широкий мягкий отблеск неба
  const sky = g.createRadialGradient(r, r * 0.35, 0, r, r * 0.35, r * 0.9);
  sky.addColorStop(0, `rgba(105,130,165,${skySheen})`); sky.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sky; g.fill();
  // узкий яркий блик
  const hl = g.createRadialGradient(r * 0.42, r * 0.78, 0, r * 0.42, r * 0.78, r * 0.2);
  hl.addColorStop(0, highlight); hl.addColorStop(0.35, highlight); hl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hl; g.fill();
  // вторичный блик-полоса (стекло)
  g.save();
  g.translate(r * 1.35, r * 1.2); g.rotate(-0.6); g.scale(1, 0.25);
  const hl2 = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.35);
  hl2.addColorStop(0, 'rgba(200,215,240,0.5)'); hl2.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hl2; g.beginPath(); g.arc(0, 0, r * 0.35, 0, Math.PI * 2); g.fill();
  g.restore();
  g.globalCompositeOperation = 'lighter';
  const rm = g.createRadialGradient(r, r, r * 0.78, r, r, r);
  rm.addColorStop(0, 'rgba(0,0,0,0)'); rm.addColorStop(1, rim);
  g.fillStyle = rm; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Тайлящийся value/fbm-шум 256² (R — fbm, G — «трещины» по ячейкам, B — мелкий шум). */
export function makeNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const value = (x: number, y: number, period: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const h = (a: number, b: number) => hash2(((a % period) + period) % period, ((b % period) + period) % period);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // ячейки Вороного для «трещин»
  const cells = 12;
  const feat: [number, number][] = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) feat.push([i + hash2(i * 3.1, j * 1.7), j + hash2(i * 5.3, j * 9.1)]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let f = 0, amp = 0.5, freq = 4;
      for (let o = 0; o < 5; o++) { f += amp * value((x / size) * freq, (y / size) * freq, freq); amp *= 0.5; freq *= 2; }
      const cx = (x / size) * cells, cy = (y / size) * cells;
      let d1 = 9, d2 = 9;
      const ix = Math.floor(cx), iy = Math.floor(cy);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = ix + ox, gy = iy + oy;
        const p = feat[(((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells)];
        const px = p[0] + (gx - (((gx % cells) + cells) % cells)), py = p[1] + (gy - (((gy % cells) + cells) % cells));
        const d = Math.hypot(px - cx, py - cy);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const edge = Math.min(1, (d2 - d1) * 2.2);
      const i = (y * size + x) * 4;
      data[i] = Math.round(f * 255);
      data[i + 1] = Math.round(edge * 255);
      data[i + 2] = Math.round(hash2(x * 0.731, y * 1.317) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Атлас спрайтов частиц 6 × 64² (Tech §6.1): мягкая точка, искра, кольцо, звезда, дым, осколок. */
export const ATLAS_FRAMES = { dot: 0, spark: 1, ring: 2, star: 3, smoke: 4, shard: 5, glyph: 6, flare: 7 } as const;
export type AtlasFrame = keyof typeof ATLAS_FRAMES;

export function makeParticleAtlas(): THREE.CanvasTexture {
  const S = 64, N = 8;
  const cv = document.createElement('canvas'); cv.width = S * N; cv.height = S;
  const g = cv.getContext('2d')!;
  const c = S / 2;
  const cell = (i: number, fn: () => void) => { g.save(); g.translate(i * S, 0); fn(); g.restore(); };
  // 0 мягкая точка
  cell(0, () => {
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
  // 1 искра — вытянутая по горизонтали (вытягивается по скорости в шейдере)
  cell(1, () => {
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.save(); g.translate(c, c); g.scale(1, 0.22); g.translate(-c, -c); g.fillRect(0, 0, S, S); g.restore();
  });
  // 2 кольцо
  cell(2, () => {
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 4; g.shadowColor = '#fff'; g.shadowBlur = 8;
    g.beginPath(); g.arc(c, c, c - 8, 0, Math.PI * 2); g.stroke();
  });
  // 3 звезда-ромб
  cell(3, () => {
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(c, 0); g.lineTo(c + 7, c - 7); g.lineTo(S, c); g.lineTo(c + 7, c + 7); g.lineTo(c, S); g.lineTo(c - 7, c + 7); g.lineTo(0, c); g.lineTo(c - 7, c - 7); g.closePath(); g.fill();
  });
  // 4 дым — несколько мягких клубов
  cell(4, () => {
    for (let i = 0; i < 7; i++) {
      const x = c + Math.cos(i * 2.4) * 10 * (i % 3), y = c + Math.sin(i * 2.4) * 10 * (i % 3), r = 14 + (i % 3) * 4;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    }
  });
  // 5 осколок — острый треугольник
  cell(5, () => {
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath(); g.moveTo(c + 4, 6); g.lineTo(S - 14, S - 12); g.lineTo(12, S - 20); g.closePath(); g.fill();
  });
  // 6 глиф-руна
  cell(6, () => {
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(c, 8); g.lineTo(c, S - 8); g.moveTo(c - 14, 20); g.lineTo(c + 14, 20); g.moveTo(c - 10, S - 18); g.lineTo(c + 10, S - 26); g.stroke();
  });
  // 7 блик-крест (lens flare)
  cell(7, () => {
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.1, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(0, c - 1, S, 2); g.fillRect(c - 1, 0, 2, S);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
