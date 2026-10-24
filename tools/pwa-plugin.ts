import { deflateSync } from 'node:zlib';
import type { Plugin } from 'vite';

/**
 * PWA (Tech §27): манифест, иконки и service worker тоже генерируются кодом —
 * в репозитории нет ни одного бинарного ассета.
 * Иконка — обсидиановый ромб с золотой кромкой, рассечённый фиолетовым клинком Пустоты.
 */

const NAME = 'VOIDBREAKER';
const BG = '#07060B';

// ------------------------------------------------------------------ геометрия иконки (доли стороны)
const D = { cx: 0.5, cy: 0.5, hw: 0.27, hh: 0.4 };
const SLASH = { x0: 0.7, y0: 0.16, x1: 0.3, y1: 0.84 };
/** Грани ромба: верх-лево светлее (ключевой свет), низ-право — почти чёрная. */
const FACETS: Record<'tl' | 'tr' | 'bl' | 'br', [number, number, number]> = {
  tl: [58, 47, 84], tr: [34, 26, 51], bl: [28, 21, 41], br: [16, 12, 27],
};
const GOLD: [number, number, number] = [226, 194, 122];
const VIOLET: [number, number, number] = [139, 92, 246];
const CORE: [number, number, number] = [241, 232, 255];

const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Цвет иконки в точке (x, y) ∈ [0,1]²; scale < 1 — для maskable (безопасная зона 80 %). */
function shade(x: number, y: number, scale: number): [number, number, number] {
  x = (x - 0.5) / scale + 0.5;
  y = (y - 0.5) / scale + 0.5;
  const dx = x - D.cx, dy = y - D.cy;
  // фон + фиолетовое свечение за ромбом
  const halo = Math.exp(-(dx * dx + dy * dy) / 0.07) * 0.32;
  let r = 7 + VIOLET[0] * halo, g = 6 + VIOLET[1] * halo, b = 11 + VIOLET[2] * halo;
  const s = Math.abs(dx) / D.hw + Math.abs(dy) / D.hh;
  if (s <= 1) {
    const f = FACETS[(dy < 0 ? 't' : 'b') + (dx < 0 ? 'l' : 'r') as keyof typeof FACETS];
    const k = 0.85 + 0.3 * (1 - s); // к центру грани чуть светлее
    [r, g, b] = [f[0] * k, f[1] * k, f[2] * k];
    // золотая кромка
    const edge = (1 - s) / Math.hypot(1 / D.hw, 1 / D.hh);
    if (edge < 0.011) { const t = 1 - edge / 0.011; r += (GOLD[0] - r) * t; g += (GOLD[1] - g) * t; b += (GOLD[2] - b) * t; }
  }
  // клинок: расстояние до отрезка → свечение + белое ядро
  const sx = SLASH.x1 - SLASH.x0, sy = SLASH.y1 - SLASH.y0;
  const t = Math.max(0, Math.min(1, ((x - SLASH.x0) * sx + (y - SLASH.y0) * sy) / (sx * sx + sy * sy)));
  const d = Math.hypot(x - (SLASH.x0 + sx * t), y - (SLASH.y0 + sy * t));
  const taper = Math.sin(Math.PI * t); // к концам клинок истончается
  const glow = Math.exp(-((d / (0.045 * (0.4 + taper))) ** 2)) * 0.9;
  r += VIOLET[0] * glow; g += VIOLET[1] * glow; b += VIOLET[2] * glow;
  const core = Math.max(0, 1 - d / (0.012 * taper + 1e-4));
  r += (CORE[0] - r) * core; g += (CORE[1] - g) * core; b += (CORE[2] - b) * core;
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
}

// ------------------------------------------------------------------ PNG (RGB, 4× суперсэмплинг)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function iconPng(size: number, scale = 1): Buffer {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0; // фильтр None
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const c = shade((x + 0.25 + sx * 0.5) / size, (y + 0.25 + sy * 0.5) / size, scale);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = y * row + 1 + x * 3;
      raw[o] = Math.round(r / 4); raw[o + 1] = Math.round(g / 4); raw[o + 2] = Math.round(b / 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 бит, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0)),
  ]);
}

// ------------------------------------------------------------------ SVG (та же геометрия)
export function iconSvg(): string {
  const S = 512, p = (x: number, y: number) => `${(x * S).toFixed(1)},${(y * S).toFixed(1)}`;
  const top = [D.cx, D.cy - D.hh], right = [D.cx + D.hw, D.cy], bot = [D.cx, D.cy + D.hh], left = [D.cx - D.hw, D.cy], c = [D.cx, D.cy];
  const tri = (a: number[], b: number[], col: [number, number, number]) => `<polygon points="${p(a[0], a[1])} ${p(b[0], b[1])} ${p(c[0], c[1])}" fill="${hex(col)}"/>`;
  const line = (w: number, col: string, extra = '') =>
    `<line x1="${SLASH.x0 * S}" y1="${SLASH.y0 * S}" x2="${SLASH.x1 * S}" y2="${SLASH.y1 * S}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
<defs><radialGradient id="h"><stop offset="0" stop-color="${hex(VIOLET)}" stop-opacity=".32"/><stop offset="1" stop-color="${hex(VIOLET)}" stop-opacity="0"/></radialGradient>
<filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter></defs>
<rect width="${S}" height="${S}" fill="${BG}"/><circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.42}" fill="url(#h)"/>
${tri(top, left, FACETS.tl)}${tri(top, right, FACETS.tr)}${tri(bot, left, FACETS.bl)}${tri(bot, right, FACETS.br)}
<polygon points="${p(top[0], top[1])} ${p(right[0], right[1])} ${p(bot[0], bot[1])} ${p(left[0], left[1])}" fill="none" stroke="${hex(GOLD)}" stroke-width="${S * 0.012}" stroke-linejoin="miter"/>
${line(S * 0.06, hex(VIOLET), ' filter="url(#g)"')}${line(S * 0.012, hex(CORE))}
</svg>`;
}

// ------------------------------------------------------------------ манифест и service worker
function manifest(): string {
  return JSON.stringify({
    name: NAME, short_name: NAME, lang: 'ru',
    description: 'Стремительный экшен-слэшер в космической готике. Вся графика, анимация и звук создаются кодом.',
    start_url: './', scope: './', display: 'fullscreen', orientation: 'landscape',
    background_color: BG, theme_color: BG,
    icons: [
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2);
}

function serviceWorker(version: string, files: string[]): string {
  return `// Сгенерировано tools/pwa-plugin.ts. Кэш-первым для ассетов с хэшем, сеть-первой для страницы.
const CACHE = 'voidbreaker-${version}';
const PRECACHE = ${JSON.stringify(['./', ...files.map((f) => `./${f}`)])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('voidbreaker-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('./', copy));
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
`;
}

const fnv = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

type Generated = { name: string; type: string; source: () => string | Buffer };
const FILES: Generated[] = [
  { name: 'manifest.webmanifest', type: 'application/manifest+json', source: manifest },
  { name: 'icon.svg', type: 'image/svg+xml', source: iconSvg },
  { name: 'icon-192.png', type: 'image/png', source: () => iconPng(192) },
  { name: 'icon-512.png', type: 'image/png', source: () => iconPng(512) },
  { name: 'icon-maskable-512.png', type: 'image/png', source: () => iconPng(512, 0.8) },
];

export function pwaPlugin(): Plugin {
  return {
    name: 'voidbreaker-pwa',
    enforce: 'post',
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: './icon.svg' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './icon-192.png' }, injectTo: 'head' },
      ];
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const f = FILES.find((g) => req.url === `/${g.name}`);
        if (!f) return next();
        res.setHeader('Content-Type', f.type);
        res.end(f.source());
      });
    },
    generateBundle(_opts, bundle) {
      for (const f of FILES) this.emitFile({ type: 'asset', fileName: f.name, source: f.source() });
      const files = [...new Set([...Object.keys(bundle), 'index.html', ...FILES.map((f) => f.name)])]
        .filter((f) => !f.endsWith('.map') && f !== 'sw.js')
        .sort();
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(fnv(files.join('|')), files) });
    },
  };
}
