/**
 * Сколько кадров в секунду игра рисует в каждом состоянии (часть `npm run perf`): цикл игры вызывается с метками
 * времени экрана 60 и 120 Гц, кадры считаются по вызовам рендера (сам рендер заглушён — считаем, а не рисуем).
 * Состояния: Святилище, бой, пауза, бой с настройкой «Частота кадров — 30».
 *
 *   npm run build && node scripts/perfPace.mjs
 */
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const PORT = 4191, SECONDS = 2;
const STATES = [
  { id: 'Святилище', url: '?screen=hub' },
  { id: 'бой', url: '?stage=1-2&god' },
  { id: 'пауза', url: '?stage=1-2&god', pause: true },
  { id: 'бой, 30 кадров', url: '?stage=1-2&god', cap: 30 },
];
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' }), browser = await launchChromium();
const rows = [];
try {
  for (const st of STATES) {
    const row = { state: st.id };
    for (const hz of [60, 120]) {
      const page = await browser.newPage({ viewport: { width: 891, height: 412 } });
      await page.addInitScript({ content: `window.requestAnimationFrame=()=>0;for(const k of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,k,{value:undefined,configurable:true});` });
      await page.goto(`http://localhost:${PORT}/${st.url}`);
      await page.waitForFunction(() => !!window.__vbApp, null, { timeout: 30000 });
      row[`${hz} Гц`] = await page.evaluate(({ hz, sec, pause, cap }) => {
        const game = window.__vbApp.game, r = game.ctx.renderer;
        if (cap) game.ctx.settings.fpsCap = cap;
        let frames = 0; r.render = () => { frames++; };
        let now = performance.now();
        const tick = () => { now += 1000 / hz; game.loop(now); };
        for (let i = 0; i < hz; i++) tick();
        if (pause) game.pause(true);
        for (let i = 0; i < hz; i++) tick();
        frames = 0;
        for (let i = 0; i < hz * sec; i++) tick();
        return Math.round(frames / sec);
      }, { hz, sec: SECONDS, pause: !!st.pause, cap: st.cap ?? 0 });
      await page.close();
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
} finally { await browser.close(); await server.close(); }
