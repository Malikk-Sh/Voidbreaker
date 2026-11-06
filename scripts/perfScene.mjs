/**
 * Что в проходе сцены дорого (дополнение к `npm run perf`): мир стоит на месте, объект за объектом прячется, и видно, сколько
 * миллисекунд кадра он стоил (граница — чтение пикселя из цели сцены; SwiftShader рисует на процессоре, поэтому
 * это доля работы видеочипа). Экран и DPR — как в perf.
 *
 *   npm run build && node scripts/perfScene.mjs [heart hub stage boss]
 */
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';
import { driveHeart } from './heartBot.mjs';

const PORT = 4195, DPR = Number(process.env.PERF_DPR ?? 3.5), REPS = Number(process.env.PERF_REPS ?? 4);
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const SCENES = {
  hub: { url: '?screen=hub', skip: 60 },
  stage: { url: '?stage=1-2&god', skip: 60 * 12 },
  heart: { url: '?stage=1-4b&god', bot: driveHeart, skip: 60 * 30 },
  boss: { url: '?stage=boss1&god', skip: 60 * 20 },
};
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['heart', 'hub'];
const extra = process.env.PERF_URL ? `&${process.env.PERF_URL}` : '';

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' }), browser = await launchChromium();
try {
  for (const id of ids) {
    const sc = SCENES[id];
    const ctx = await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA });
    const page = await ctx.newPage();
    await page.addInitScript({ content: `Object.defineProperty(window,'devicePixelRatio',{get:()=>${DPR},configurable:true});window.requestAnimationFrame=()=>0;${sc.bot ? `window.__drive=${sc.bot.toString()};` : ''}for(const k of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,k,{value:undefined,configurable:true});` });
    await page.goto(`http://localhost:${PORT}/${sc.url}${extra}`);
    await page.waitForFunction(() => !!window.__vbApp, null, { timeout: 30000 });
    const res = await page.evaluate(({ skip, reps }) => {
      const app = window.__vbApp, game = app.game, r = game.ctx.renderer, gl = r.gl;
      const s = { frames: 0, mx: 0, mz: 0, held: false, aim: false, ax: 0, az: -1 };
      const inp = game.ctx.input, update = inp.update.bind(inp);
      inp.update = (now) => { update(now); const b = game.battle; if (b && window.__drive) { s.frames++; window.__drive(b, s); inp.moveX = s.mx; inp.moveZ = s.mz; inp.attackHeld = s.held; inp.aimActive = s.aim; inp.aimX = s.ax; inp.aimZ = s.az; } };
      let now = performance.now();
      const realRender = r.render.bind(r);
      r.render = () => {};
      for (let i = 0; i < skip; i++) { now += 1000 / 60; const h = game.battle?.world.hero; if (h) h.hp = h.maxHp; game.loop(now); }
      r.render = realRender;
      realRender(game.ctx.time.world);
      // Кадр стоит: рисуется только проход сцены в её цель, граница — чтение пикселя.
      const rt = r.post.sceneRT, px = new Uint16Array(4);
      const sceneMs = () => {
        let t = 0;
        for (let i = 0; i < reps; i++) {
          r.gl.setRenderTarget(rt); r.gl.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
          const t0 = performance.now();
          r.gl.setRenderTarget(rt); r.gl.clear(true, true, false); r.gl.render(r.scene, r.camera);
          r.gl.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
          t += performance.now() - t0;
        }
        return t / reps;
      };
      r.camera.updateMatrixWorld(); r.sky.update(r.camera);
      const base = sceneMs();
      // Кандидаты: прямые дети сцены и детей групп боя/вида арены (два уровня).
      const cands = [];
      const matName = (m) => !m ? '' : Array.isArray(m) ? 'multi' : (m.name || (m.isShaderMaterial ? `shader:${(m.fragmentShader || '').length}` : m.type));
      const verts = (o) => o.geometry?.attributes?.position?.count ?? 0;
      const name = (o, path) => `${path}${o.name || o.type}${o.isInstancedMesh ? `[${o.count}]` : ''}${o.isMesh ? ` {${matName(o.material)} v${verts(o)} ro${o.renderOrder}${o.material?.transparent ? ' tr' : ''}}` : ''}`;
      const walk = (o, path, depth) => {
        for (const c of o.children) {
          if (!c.visible) continue;
          cands.push({ o: c, label: name(c, path) });
          if (depth > 0 && c.children.length > 3) walk(c, `${name(c, path)} › `, depth - 1);
        }
      };
      walk(r.scene, '', 2);
      const rows = [];
      for (const c of cands) {
        c.o.visible = false;
        const ms = sceneMs();
        c.o.visible = true;
        rows.push({ label: c.label, ms: +(base - ms).toFixed(1) });
      }
      rows.sort((a, b) => b.ms - a.ms);
      return { base: +base.toFixed(1), px: [r.pixelW, r.pixelH], top: rows.slice(0, 22) };
    }, { skip: sc.skip, reps: REPS });
    console.log(`\n${id}: проход сцены ${res.base} мс (${res.px.join('×')})`);
    for (const row of res.top) console.log(`${String(row.ms).padStart(7)} мс  ${row.label}`);
    await ctx.close();
  }
} finally { await browser.close(); await server.close(); }
