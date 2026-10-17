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

const CSS = /* css */ `
.vb-layer { position:absolute; inset:0; z-index:5; pointer-events:none; font-family: Georgia, "Noto Serif", "Times New Roman", serif; color:#e8dff5; -webkit-font-smoothing: antialiased; }
.vb-screen { position:absolute; inset:0; pointer-events:auto; padding: max(16px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); box-sizing:border-box; overflow:hidden; }
.vb-fade { animation: vbFade .35s ease-out both; }
@keyframes vbFade { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
.vb-caps { text-transform: uppercase; letter-spacing: .28em; font-size: 12px; color:#cbbfe0; }
.vb-dim { color:#9a8fb8; }
.vb-gold { color:#e2c27a; }
.vb-void { color:#B794FF; }
.vb-red { color:#ff6b75; }
.vb-btn { position:relative; display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:48px; min-width:120px; padding: 0 26px; box-sizing:border-box;
  background: linear-gradient(180deg, rgba(28,20,44,.88), rgba(12,8,22,.88)); color:#f3e7c4; border:none; cursor:pointer; font: 600 13px Georgia, "Noto Serif", serif;
  text-transform: uppercase; letter-spacing:.3em; clip-path: polygon(12px 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 12px 100%, 0 50%);
  transition: transform .12s, filter .12s; -webkit-tap-highlight-color: transparent; }
.vb-btn::before { content:''; position:absolute; inset:0; clip-path: inherit; padding:1px; background: linear-gradient(90deg, #6b5226, #e2c27a 50%, #6b5226);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events:none; }
.vb-btn:hover { filter: brightness(1.25); }
.vb-btn:active { transform: scale(.97); }
.vb-btn.primary { background: linear-gradient(180deg, rgba(110,70,210,.9), rgba(50,25,110,.92)); color:#fff; box-shadow: 0 0 24px rgba(139,92,246,.45); }
.vb-btn.small { min-height:40px; min-width:0; padding: 0 16px; font-size:11px; }
.vb-btn[disabled] { filter: grayscale(.8) brightness(.6); cursor: default; }
.vb-panel { position:relative; background: linear-gradient(180deg, rgba(14,10,24,.86), rgba(8,6,14,.8)); padding:18px 20px; box-sizing:border-box;
  clip-path: polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px); }
.vb-panel::before { content:''; position:absolute; inset:0; padding:1px; clip-path: inherit; background: linear-gradient(135deg, rgba(226,194,122,.9), rgba(184,149,78,.25) 40%, rgba(184,149,78,.25) 60%, rgba(226,194,122,.9));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events:none; }
.vb-rule { height:1px; background: linear-gradient(90deg, transparent, rgba(184,149,78,.8), transparent); margin: 10px 0; }
.vb-diamond { display:inline-block; width:8px; height:8px; transform: rotate(45deg); background:#B794FF; box-shadow: 0 0 8px #8B5CF6; margin: 0 6px; vertical-align: middle; }
.vb-diamond.gold { background:#e2c27a; box-shadow: 0 0 8px rgba(226,194,122,.6); }
.vb-diamond.off { background: rgba(60,45,80,.9); box-shadow:none; }
.vb-cur { display:inline-flex; align-items:center; gap:6px; font-size:15px; letter-spacing:.08em; }
.vb-row { display:flex; align-items:center; gap:12px; }
.vb-col { display:flex; flex-direction:column; gap:10px; }
.vb-grow { flex:1; }
.vb-scroll { overflow-y:auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: #6b5226 transparent; }
.vb-tab { cursor:pointer; padding:8px 12px; min-height:44px; box-sizing:border-box; display:flex; align-items:center; gap:10px; border-left: 2px solid transparent; color:#cbbfe0; text-transform:uppercase; letter-spacing:.22em; font-size:12px; }
.vb-tab.on { border-left-color:#e2c27a; color:#fff; background: linear-gradient(90deg, rgba(139,92,246,.22), transparent); }
.vb-tab .dot { width:7px; height:7px; transform:rotate(45deg); background:#B794FF; box-shadow:0 0 8px #8B5CF6; margin-left:4px; }
.vb-card { position:relative; padding:12px 14px; background: rgba(20,14,34,.7); border: 1px solid rgba(184,149,78,.35); }
.vb-card.sel { border-color:#e2c27a; box-shadow: inset 0 0 18px rgba(139,92,246,.3); }
.vb-card.locked { opacity:.55; }
.vb-slider { -webkit-appearance:none; appearance:none; width:100%; height:24px; background:transparent; }
.vb-slider::-webkit-slider-runnable-track { height:2px; background: linear-gradient(90deg, #B8954E, #6b5226); }
.vb-slider::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; margin-top:-7px; transform: rotate(45deg); background:#B794FF; box-shadow:0 0 10px #8B5CF6; }
.vb-slider::-moz-range-track { height:2px; background:#B8954E; }
.vb-slider::-moz-range-thumb { width:14px; height:14px; border:none; transform: rotate(45deg); background:#B794FF; }
.vb-toggle { display:inline-flex; gap:6px; }
.vb-toggle button { min-height:36px; padding: 0 12px; background: rgba(20,14,34,.8); color:#cbbfe0; border:1px solid rgba(184,149,78,.4); cursor:pointer; font: 11px Georgia, serif; letter-spacing:.15em; text-transform:uppercase; }
.vb-toggle button.on { border-color:#e2c27a; color:#fff; background: rgba(110,70,210,.5); }
.vb-wipe { position:absolute; inset:-20%; z-index:20; pointer-events:none; background: linear-gradient(100deg, transparent 38%, rgba(183,148,255,.0) 40%, #f1e8ff 47%, #8B5CF6 49%, #07060B 51%, #07060B 100%);
  transform: translateX(-120%); animation: vbWipe .7s cubic-bezier(.7,0,.3,1) forwards; }
@keyframes vbWipe { 0% { transform: translateX(-120%) skewX(-12deg); } 50% { transform: translateX(-20%) skewX(-12deg); } 100% { transform: translateX(120%) skewX(-12deg); } }
.vb-pulse { animation: vbPulse 2.2s ease-in-out infinite; }
@keyframes vbPulse { 0%,100% { opacity:.45; } 50% { opacity:1; } }
.vb-type { white-space: pre-wrap; }
.vb-iconbtn { width:48px; height:48px; display:grid; place-items:center; cursor:pointer; background:none; border:none; padding:0; }
.vb-stamp { animation: vbStamp .5s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes vbStamp { from { transform: scale(2.4) rotate(-18deg); opacity:0; } to { transform: none; opacity:1; } }
.vb-star { font-size:26px; color: rgba(80,60,110,.8); transition: color .2s, text-shadow .2s; }
.vb-star.lit { color:#e2c27a; text-shadow: 0 0 14px rgba(226,194,122,.8); animation: vbStamp .4s both; }
.vb-rotate { position:fixed; inset:0; z-index:50; display:none; place-items:center; background:#07060B; color:#B794FF; text-align:center; font: 14px Georgia, serif; letter-spacing:.2em; }
@media (orientation: portrait) and (max-width: 900px) { .vb-rotate { display:grid; } }
@media (max-width: 980px) { .vb-tab:not(.on) span:not(.dot) { display:none; } .vb-tab { padding: 8px 10px; letter-spacing:.12em; } }
@media (max-height: 480px) { .vb-panel { padding: 10px 12px; } .vb-card { padding: 8px 10px; } .vb-btn { min-height:44px; } }
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
