/**
 * Разбивка цены кадра по проходам (часть `npm run perf`). Мир шагает вручную по 1/60 с, бот ведёт бой; после каждого
 * прохода — gl.finish(): SwiftShader рисует на процессоре по порядку, и время до finish — доля прохода в работе
 * видеочипа. HUD: время JS и растра (getImageData принуждает холст дорисоваться). Экран и DPR — как в perf.
 *
 *   npm run build && node scripts/perfPasses.mjs [heart stage boss hub]   (PERF_FRAMES — кадров на сцену)
 * Абсолютные мс — процессор стенда, не телефон; смысл — какая часть кадра дорогая и что дала правка.
 */
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';
import { driveHeart } from './heartBot.mjs';

const PORT = 4197, DPR = Number(process.env.PERF_DPR ?? 3.5), FRAMES = Number(process.env.PERF_FRAMES ?? 90);
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const naive = function (b, s) {
  const w = b.world, h = w.hero, inp = b.ctx.input;
  s.mx = s.mz = 0; s.held = false; s.aim = false;
  if (b.director.active || b.cine?.active || h.locked) return;
  const e = w.enemies.filter((x) => !x.dead).sort((a, c) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(c.x - h.x, c.z - h.z))[0];
  if (!e) return;
  const dx = e.x - h.x, dz = e.z - h.z, d = Math.hypot(dx, dz) || 1;
  if (d > 2) { s.mx = dx / d; s.mz = dz / d; }
  if (s.frames % 12 === 0) inp.buffer.push('attack', inp.now);
};
const SCENES = {
  hub: { url: '?screen=hub', skip: 60 },
  stage: { url: '?stage=1-2&god', bot: naive, skip: 60 * 12 },
  heart: { url: '?stage=1-4b&god', bot: driveHeart, skip: 60 * 30 },
  boss: { url: '?stage=boss1&god', bot: naive, skip: 60 * 20 },
};
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
const extra = process.env.PERF_URL ? `&${process.env.PERF_URL}` : '';

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' }), browser = await launchChromium();
try {
  for (const id of ids) {
    const sc = SCENES[id];
    const ctx = await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript({ content: `Object.defineProperty(window,'devicePixelRatio',{get:()=>${DPR},configurable:true});window.requestAnimationFrame=()=>0;${sc.bot ? `window.__drive=${sc.bot.toString()};` : ''}for(const k of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,k,{value:undefined,configurable:true});` });
    const url = sc.url ? `${sc.url}${extra}` : (extra ? `?${extra.slice(1)}` : '');
    await page.goto(`http://localhost:${PORT}/${url}`);
    await page.waitForFunction(() => !!window.__vbApp, null, { timeout: 30000 });
    const res = await page.evaluate(({ skip, frames }) => {
      const app = window.__vbApp, game = app.game, r = game.ctx.renderer, hud = game.ctx.hud, gl = r.gl.getContext();
      const s = { frames: 0, mx: 0, mz: 0, held: false, aim: false, ax: 0, az: -1 };
      const inp = game.ctx.input, update = inp.update.bind(inp);
      inp.update = (now) => { update(now); const b = game.battle; if (b && window.__drive) { s.frames++; window.__drive(b, s); inp.moveX = s.mx; inp.moveZ = s.mz; inp.attackHeld = s.held; inp.aimActive = s.aim; inp.aimX = s.ax; inp.aimZ = s.az; } };
      let now = performance.now();
      const step = () => { now += 1000 / 60; const h = game.battle?.world.hero; if (h) h.hp = h.maxHp; game.loop(now); };
      // прогрев без рендера: мир доходит до боя (вступление, первые волны)
      const realRender = r.render.bind(r);
      r.render = () => {};
      for (let i = 0; i < skip; i++) step();
      r.render = realRender;
      for (let i = 0; i < 10; i++) step();
      // замер: проходы с finish
      const T = { light: 0, scene: 0, bloom: 0, comp: 0, hudJs: 0, hudRaster: 0, sim: 0, total: 0 };
      const post = r.post, origPost = post.render.bind(post);
      // Граница прохода — чтение одного пикселя из текущей цели: оно ждёт, пока видеочип дорисует (finish в Chrome не ждёт).
      const px8 = new Uint8Array(4), px16 = new Uint16Array(4);
      const fin = () => {
        const rt = r.gl.getRenderTarget();
        if (!rt) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px8); return; }
        r.gl.readRenderTargetPixels(rt, 0, 0, 1, 1, rt.texture.type === 1016 ? px16 : px8);
      };
      const origPass = post.pass.bind(post);
      let phase = 'scene', t = 0;
      const mark = (k) => { fin(); const n = performance.now(); T[k] += n - t; t = n; };
      post.pass = (mat, target, clear) => { if (phase === 'scene') { mark('scene'); phase = 'bloom'; } if (mat === post.compMat) { mark('bloom'); phase = 'comp'; } origPass(mat, target, clear); };
      r.render = (wt) => {
        fin(); t = performance.now(); phase = 'light';
        // свет мира — до сцены
        const wl = r.worldLight; if (wl) { r.worldLight = null; wl.render(r.gl); mark('light'); }
        phase = 'scene';
        realRender(wt);
        r.worldLight = wl;
        mark('comp');
      };
      const hudDraw = hud.draw.bind(hud), hudScene = hud.drawScene.bind(hud);
      const timedHud = (fn) => (...a) => { const t0 = performance.now(); fn(...a); const t1 = performance.now(); hud.g.getImageData(0, 0, 1, 1); const t2 = performance.now(); T.hudJs += t1 - t0; T.hudRaster += t2 - t1; };
      hud.draw = timedHud(hudDraw); hud.drawScene = timedHud(hudScene);
      const b = game.battle;
      if (b) { const f = b.frame.bind(b); b.frame = (dt) => { const t0 = performance.now(); f(dt); T.sim += performance.now() - t0; }; }
      r.gl.info.autoReset = false; let calls = 0;
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) { r.gl.info.reset(); step(); calls += r.gl.info.render.calls; }
      T.total = performance.now() - t0;
      const out = {}; for (const k in T) out[k] = +(T[k] / frames).toFixed(2);
      return { ms: out, calls: Math.round(calls / frames), px: [r.pixelW, r.pixelH], hudPx: [hud.canvas.width, hud.canvas.height], light: !!r.worldLight, director: game.battle?.director?.id ?? null, quality: r.quality };
    }, { skip: sc.skip, frames: FRAMES });
    console.log(id.padEnd(6), JSON.stringify(res), errors.length ? errors.slice(0, 2) : '');
    await ctx.close();
  }
} finally { await browser.close(); await server.close(); }
