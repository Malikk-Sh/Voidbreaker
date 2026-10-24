import { FONT_BODY, FONT_DISPLAY, FONT_TECH } from './fonts';

/** Мини-хелпер DOM: меню и хаб — DOM + SVG, сгенерированные кодом (Tech §22). */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: SVGElement[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.appendChild(c);
  return el;
}

/** Уголок-орнамент рамки (SVG, повёрнутый под каждый угол). */
function corner(rot: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><g transform='rotate(${rot} 13 13)' fill='none' stroke='%23e3c37e' stroke-width='1.2'><path d='M1.5 17 V1.5 H17'/><path d='M5 11 V5 H11' stroke-opacity='.55'/><path d='M1.5 1.5 L6 6' stroke-opacity='.8'/></g><g transform='rotate(${rot} 13 13)'><rect x='-0.4' y='-0.4' width='3.8' height='3.8' fill='%23f0d9a0' transform='rotate(45 1.5 1.5)'/></g></svg>`;
  return `url("data:image/svg+xml;utf8,${svg}")`;
}

const CSS = /* css */ `
:root { --vb-display: ${FONT_DISPLAY}; --vb-body: ${FONT_BODY}; --vb-tech: ${FONT_TECH};
  --vb-gold: #c9a253; --vb-gold-hi: #f0d9a0; --vb-ivory: #ede6d6; --vb-text: #d9d3c7; --vb-dim: #8b95a3; --vb-star: #8fd8ef; --vb-void: #b794ff; --vb-red: #ff6b75; }
.vb-layer { position:absolute; inset:0; z-index:5; pointer-events:none; font-family: var(--vb-body); color: var(--vb-text); -webkit-font-smoothing: antialiased; font-size: 14px; }
.vb-screen { position:absolute; inset:0; pointer-events:auto; padding: max(16px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); box-sizing:border-box; overflow:hidden; }
.vb-title { display:block; }
.vb-fade { animation: vbFade .35s ease-out both; }
@keyframes vbFade { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
.vb-rise > * { animation: vbFade .45s cubic-bezier(.2,.8,.2,1) both; }
.vb-rise > *:nth-child(2) { animation-delay: .05s; } .vb-rise > *:nth-child(3) { animation-delay: .1s; } .vb-rise > *:nth-child(4) { animation-delay: .15s; } .vb-rise > *:nth-child(5) { animation-delay: .2s; } .vb-rise > *:nth-child(6) { animation-delay: .25s; }
.vb-caps { font-family: var(--vb-body); font-weight:700; text-transform: uppercase; letter-spacing: .22em; font-size: 11px; color:#b9ae98; }
.vb-tech { font-family: var(--vb-tech); font-weight:600; letter-spacing:.04em; }
.vb-display { font-family: var(--vb-display); font-weight:700; letter-spacing:.06em; }
.vb-dim { color: var(--vb-dim); }
.vb-gold { color: #e3c37e; }
.vb-void { color: var(--vb-void); }
.vb-star-c { color: var(--vb-star); }
.vb-red { color: var(--vb-red); }
.vb-btn { position:relative; display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:48px; min-width:120px; padding: 0 28px; box-sizing:border-box;
  background: linear-gradient(180deg, rgba(30,38,50,.92), rgba(12,16,22,.92)); color: var(--vb-ivory); border:none; cursor:pointer;
  font: 700 13px var(--vb-body); text-transform: uppercase; letter-spacing:.24em; overflow:hidden;
  clip-path: polygon(14px 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 14px 100%, 0 50%);
  transition: transform .12s, filter .15s; -webkit-tap-highlight-color: transparent; }
.vb-btn::before { content:''; position:absolute; inset:0; clip-path: inherit; padding:1px; background: linear-gradient(90deg, #5d431b, #f0d9a0 50%, #5d431b);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events:none; }
.vb-btn::after { content:''; position:absolute; top:0; bottom:0; width:40%; left:-60%; background: linear-gradient(100deg, transparent, rgba(255,245,220,.22), transparent); transform: skewX(-20deg); pointer-events:none; }
.vb-btn:hover { filter: brightness(1.18); }
.vb-btn:hover::after { animation: vbShine .7s ease-out; }
@keyframes vbShine { to { left: 130%; } }
.vb-btn:active { transform: scale(.97); }
.vb-btn.primary { background: linear-gradient(180deg, #fff1c9 0%, #e9c983 16%, #c9a253 52%, #8e6a2c 100%); color:#1b1408; text-shadow: 0 1px 0 rgba(255,240,200,.45);
  box-shadow: 0 0 28px rgba(240,190,90,.35); }
.vb-btn.primary::before { background: linear-gradient(90deg, #fff6dc, #6e5223 50%, #fff6dc); }
.vb-btn.primary::after { animation: vbShine 3.2s ease-in-out infinite; animation-delay: 1s; }
.vb-btn.big { min-height:58px; font-size:16px; letter-spacing:.32em; padding: 0 40px; }
.vb-btn.small { min-height:40px; min-width:0; padding: 0 18px; font-size:11px; letter-spacing:.16em; }
.vb-btn[disabled] { filter: grayscale(.85) brightness(.55); cursor: default; }
.vb-btn[disabled]::after { display:none; }
.vb-panel { position:relative; background: linear-gradient(180deg, rgba(16,21,29,.93), rgba(8,11,16,.9)); padding:18px 20px; box-sizing:border-box;
  box-shadow: 0 18px 50px rgba(0,0,0,.55), inset 0 1px 0 rgba(240,217,160,.08); }
.vb-panel::before { content:''; position:absolute; inset:0; padding:1px; background: linear-gradient(160deg, rgba(240,217,160,.75), rgba(201,162,83,.18) 30%, rgba(201,162,83,.12) 70%, rgba(240,217,160,.6));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events:none; }
.vb-panel::after { content:''; position:absolute; inset:-5px; pointer-events:none;
  background: ${corner(0)} left top no-repeat, ${corner(90)} right top no-repeat, ${corner(270)} left bottom no-repeat, ${corner(180)} right bottom no-repeat; }
.vb-rule { position:relative; height:1px; background: linear-gradient(90deg, transparent, rgba(201,162,83,.85), transparent); margin: 10px 0; }
.vb-rule::after { content:''; position:absolute; left:50%; top:50%; width:7px; height:7px; background:#f0d9a0; transform: translate(-50%,-50%) rotate(45deg); box-shadow: 0 0 8px rgba(240,200,120,.6); }
.vb-diamond { display:inline-block; width:8px; height:8px; transform: rotate(45deg); background:#e3c37e; box-shadow: 0 0 6px rgba(240,200,120,.6); margin: 0 5px; vertical-align: middle; }
.vb-diamond.star { background: var(--vb-star); box-shadow: 0 0 8px rgba(111,208,230,.7); }
.vb-diamond.void { background: var(--vb-void); box-shadow: 0 0 8px rgba(150,100,255,.7); }
.vb-diamond.off { background: rgba(60,70,84,.8); box-shadow:none; }
.vb-cur { display:inline-flex; align-items:center; gap:7px; font: 600 15px var(--vb-tech); letter-spacing:.03em; }
.vb-pill { display:inline-flex; align-items:center; gap:8px; padding: 4px 14px 4px 8px; border-radius: 999px; background: rgba(10,14,20,.72); border: 1px solid rgba(201,162,83,.35); }
.vb-row { display:flex; align-items:center; gap:12px; }
.vb-col { display:flex; flex-direction:column; gap:10px; }
.vb-grow { flex:1; }
.vb-scroll { overflow-y:auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: #6e5223 transparent; }
.vb-tabs { display:flex; gap:2px; overflow-x:auto; scrollbar-width:none; }
.vb-tab { cursor:pointer; padding:8px 14px 9px; min-height:44px; box-sizing:border-box; display:flex; align-items:center; gap:9px; border-bottom: 2px solid transparent; color: var(--vb-dim);
  font: 700 11px var(--vb-body); text-transform:uppercase; letter-spacing:.2em; white-space:nowrap; transition: color .15s, background .15s; }
.vb-tab:hover { color: var(--vb-text); }
.vb-tab.on { border-bottom-color:#e3c37e; color: var(--vb-ivory); background: linear-gradient(0deg, rgba(201,162,83,.18), transparent); }
.vb-tab .dot { width:7px; height:7px; transform:rotate(45deg); background:#f0d9a0; box-shadow:0 0 8px rgba(240,200,120,.8); margin-left:2px; animation: vbPulse 1.6s ease-in-out infinite; }
.vb-card { position:relative; padding:12px 14px; background: linear-gradient(90deg, rgba(22,29,39,.85), rgba(14,19,26,.7)); border: 1px solid rgba(201,162,83,.18); border-left: 2px solid rgba(201,162,83,.45); }
.vb-card.sel { border-color: rgba(240,217,160,.6); box-shadow: inset 0 0 26px rgba(240,200,120,.10), 0 0 18px rgba(240,200,120,.08); }
.vb-card.locked { opacity:.5; filter: grayscale(.6); }
.vb-name { font: 700 15px var(--vb-display); letter-spacing:.12em; color: var(--vb-ivory); }
.vb-meter { position:relative; height:6px; background: rgba(5,8,12,.8); border:1px solid rgba(201,162,83,.25); overflow:hidden; }
.vb-meter > i { position:absolute; left:0; top:0; bottom:0; background: linear-gradient(90deg, #8e6a2c, #f0d9a0); box-shadow: 0 0 10px rgba(240,200,120,.6); }
.vb-meter > b { position:absolute; top:-1px; bottom:-1px; width:1px; background: rgba(240,217,160,.45); }
.vb-slider { -webkit-appearance:none; appearance:none; width:100%; height:24px; background:transparent; }
.vb-slider::-webkit-slider-runnable-track { height:2px; background: linear-gradient(90deg, #f0d9a0, #6e5223); }
.vb-slider::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; margin-top:-7px; transform: rotate(45deg); background:#f0d9a0; border:1px solid #6e5223; box-shadow:0 0 10px rgba(240,200,120,.7); }
.vb-slider::-moz-range-track { height:2px; background:#c9a253; }
.vb-slider::-moz-range-thumb { width:14px; height:14px; border:none; transform: rotate(45deg); background:#f0d9a0; }
.vb-toggle { display:inline-flex; gap:4px; flex-wrap:wrap; }
.vb-toggle button { min-height:34px; padding: 0 12px; background: rgba(12,16,22,.85); color: var(--vb-dim); border:1px solid rgba(201,162,83,.3); cursor:pointer; font: 700 10px var(--vb-body); letter-spacing:.14em; text-transform:uppercase; }
.vb-toggle button.on { border-color:#f0d9a0; color:#1b1408; background: linear-gradient(180deg, #f0d9a0, #c9a253); }
.vb-wipe { position:absolute; inset:-20%; z-index:20; pointer-events:none; background: linear-gradient(100deg, transparent 38%, rgba(240,217,160,0) 40%, #fff6dc 46.5%, #c9a253 48%, #05070a 51%, #05070a 100%);
  transform: translateX(-120%); animation: vbWipe .7s cubic-bezier(.7,0,.3,1) forwards; }
@keyframes vbWipe { 0% { transform: translateX(-120%) skewX(-12deg); } 50% { transform: translateX(-20%) skewX(-12deg); } 100% { transform: translateX(120%) skewX(-12deg); } }
.vb-pulse { animation: vbPulse 2.2s ease-in-out infinite; }
@keyframes vbPulse { 0%,100% { opacity:.45; } 50% { opacity:1; } }
.vb-type { white-space: pre-wrap; }
.vb-iconbtn { width:46px; height:46px; display:grid; place-items:center; cursor:pointer; background: rgba(10,14,20,.6); border: 1px solid rgba(201,162,83,.3); padding:0; transform: rotate(45deg) scale(.82); transition: border-color .15s, background .15s; }
.vb-iconbtn > * { transform: rotate(-45deg) scale(1.2); }
.vb-iconbtn:hover { border-color:#f0d9a0; background: rgba(30,38,50,.8); }
.vb-stamp { animation: vbStamp .5s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes vbStamp { from { transform: scale(2.4) rotate(-18deg); opacity:0; } to { transform: none; opacity:1; } }
.vb-star { font-size:28px; color: rgba(70,80,95,.85); transition: color .2s, text-shadow .2s; font-family: var(--vb-display); }
.vb-star.lit { color:#f0d9a0; text-shadow: 0 0 14px rgba(240,200,120,.85); animation: vbStamp .4s both; }
.vb-rotate { position:fixed; inset:0; z-index:50; display:none; place-items:center; background:#05070a; color:#e3c37e; text-align:center; font: 700 14px var(--vb-body); letter-spacing:.2em; }
.vb-kv { display:grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 12px; }
.vb-kv > span:nth-child(odd) { color: var(--vb-dim); text-transform: uppercase; letter-spacing: .14em; font-size: 10px; font-weight:700; align-self:center; }
.vb-kv > span:nth-child(even) { font: 600 13px var(--vb-tech); color: var(--vb-ivory); }
.vb-kv.text > span:nth-child(even) { font: 400 12px var(--vb-body); color: var(--vb-text); }
@media (orientation: portrait) and (max-width: 900px) { .vb-rotate { display:grid; } }
@media (max-width: 980px) { .vb-tab:not(.on) span:not(.dot) { display:none; } .vb-tab { padding: 8px 10px; letter-spacing:.12em; } }
@media (max-height: 480px) { .vb-panel { padding: 10px 12px; } .vb-card { padding: 8px 10px; } .vb-btn { min-height:42px; } .vb-btn.big { min-height:50px; } }
`;

let injected = false;
export function injectStyles(): void {
  if (injected) return;
  injected = true;
  document.head.appendChild(h('style', {}, CSS));
}

/** Переход между экранами: диагональный разрез фиолетовым клинком (0.35 с до середины). */
export function wipe(parent: HTMLElement, mid: () => void): void {
  const el = h('div', { class: 'vb-wipe' });
  parent.appendChild(el);
  setTimeout(mid, 330);
  setTimeout(() => el.remove(), 760);
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}
