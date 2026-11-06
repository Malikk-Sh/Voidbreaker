/**
 * Цена кадра и нагрев (ревью: «телефон нагревается»). Экран — как у Galaxy S24+ в браузере: 891×412 CSS-пикселей,
 * DPR 3.5, мобильный агент (игра сама выбирает среднее качество). Каждая сцена идёт в реальном времени: меню
 * (титул, Святилище, карта), бой 1-2, бой с Сердцем (бот с механиками), Иерофант, пауза посреди боя.
 *
 * По сцене за окно замера (PERF_SEC, по умолчанию 6 с):
 * - fps — сколько кадров реально отрисовано за секунду;
 * - cpu — процессорное время всех процессов браузера за секунду (ядер): JS, раскладка, Canvas 2D HUD,
 *   композитинг и рендер WebGL — SwiftShader рисует на процессоре, поэтому работа видеокарты тоже здесь;
 * - perFrame — то же на один отрисованный кадр (мс): цена кадра независимо от частоты;
 * - js — сколько из этого — JS кадра игры: симуляция боя, HUD, подача команд отрисовки (мс на кадр);
 * - разрешение 3D-кадра и HUD, вызовы отрисовки и треугольники.
 * Абсолютные числа — не телефон (другой процессор, рендер на процессоре); сравнивать надо сборки между собой.
 *
 *   npm run build && node scripts/perfLive.mjs [heart pause]   → work/perf/<метка>.json
 * SwiftShader рисует на процессоре медленно (несколько кадров в секунду), поэтому частоту кадров здесь не видно — для
 * неё `scripts/perfPace.mjs`, для доли проходов — `scripts/perfPasses.mjs` (оба — `npm run perf`).
 * PERF_LABEL — метка замера; PERF_SEC — длина окна; PERF_PROFILE=1 — ещё и профиль JS сцены боя с Сердцем.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';
import { driveHeart } from './heartBot.mjs';

const OUT = 'work/perf'; mkdirSync(OUT, { recursive: true });
const LABEL = process.env.PERF_LABEL ?? 'current';
const SEC = Number(process.env.PERF_SEC ?? 6), WARM = 3;
const PORT = 4196, DPR = Number(process.env.PERF_DPR ?? 3.5);
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/** Наивный бот: идёт к ближайшему врагу и жмёт атаку — бой идёт, эффекты рисуются. */
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
  title: { url: '' },
  hub: { url: '?screen=hub' },
  map: { url: '?screen=map' },
  stage: { url: '?stage=1-2&god', bot: naive },
  heart: { url: '?stage=1-4b&god', bot: driveHeart, warm: 14 },
  boss: { url: '?stage=boss1&god', bot: naive, warm: 10 },
  pause: { url: '?stage=1-4b&god', bot: driveHeart, warm: 14, pause: true },
};
const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(SCENES);

/** Процессорное время (с) всех потомков этого процесса: браузер, GPU-процесс, рендереры. */
function cpuOfChildren() {
  const parent = new Map(), ticks = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = readFileSync(`/proc/${d}/stat`, 'utf8');
      const rest = st.slice(st.lastIndexOf(')') + 2).split(' ');
      parent.set(Number(d), Number(rest[1]));
      ticks.set(Number(d), Number(rest[11]) + Number(rest[12]));
    } catch { /* процесс уже ушёл */ }
  }
  const mine = new Set([process.pid]);
  let grew = true;
  while (grew) { grew = false; for (const [pid, pp] of parent) if (!mine.has(pid) && mine.has(pp)) { mine.add(pid); grew = true; } }
  mine.delete(process.pid);
  let sum = 0; for (const pid of mine) sum += ticks.get(pid) ?? 0;
  return sum / 100;
}

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' }), browser = await launchChromium();
const results = {};
try {
  for (const id of ids) {
    const sc = SCENES[id];
    if (!sc) throw new Error(`нет сцены ${id}: ${Object.keys(SCENES).join(', ')}`);
    // Страница с DPR 1, а игра видит DPR 3.5: она сама заводит буферы как на телефоне (3D-кадр, HUD), а композитинг
    // страницы, который на телефоне делает видеочип, не съедает процессор стенда.
    const ctx = await browser.newContext({ viewport: { width: 891, height: 412 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript({ content: `Object.defineProperty(window,'devicePixelRatio',{get:()=>${DPR},configurable:true});${sc.bot ? `window.__drive=${sc.bot.toString()};` : ''}for(const k of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,k,{value:undefined,configurable:true});` });
    await page.goto(`http://localhost:${PORT}/${sc.url}`);
    await page.waitForFunction(() => !!window.__vbApp, null, { timeout: 30000 });
    // счётчики: кадры, JS по частям; бот ведёт ввод каждый кадр
    await page.evaluate(() => {
      const app = window.__vbApp, game = app.game, r = game.ctx.renderer;
      const m = window.__m = { frames: 0, sim: 0, hud: 0, render: 0, calls: 0, tris: 0, peakCalls: 0 };
      const wrap = (obj, key, slot) => { const f = obj[key].bind(obj); obj[key] = (...a) => { const t = performance.now(); const v = f(...a); m[slot] += performance.now() - t; return v; }; };
      const origRender = r.render.bind(r);
      r.gl.info.autoReset = false;
      r.render = (t) => {
        r.gl.info.reset();
        const t0 = performance.now(); origRender(t); m.render += performance.now() - t0; m.frames++;
        const info = r.gl.info.render; m.calls += info.calls; m.tris += info.triangles; m.peakCalls = Math.max(m.peakCalls, info.calls);
      };
      wrap(game.ctx.hud, 'draw', 'hud');
      const s = window.__s = { frames: 0, mx: 0, mz: 0, held: false, aim: false, ax: 0, az: -1 };
      const inp = game.ctx.input, update = inp.update.bind(inp);
      inp.update = (now) => {
        update(now);
        const b = game.battle;
        if (b && window.__drive) { s.frames++; window.__drive(b, s); inp.moveX = s.mx; inp.moveZ = s.mz; inp.attackHeld = s.held; inp.aimActive = s.aim; inp.aimX = s.ax; inp.aimZ = s.az; }
      };
      // бой: замер battle.frame — один раз, когда бой появится
      const hook = () => { const b = game.battle; if (b && !b.__timed) { b.__timed = true; wrap(b, 'frame', 'sim'); } };
      setInterval(hook, 50); hook();
      const god = () => { const h = game.battle?.world.hero; if (h) h.hp = h.maxHp; };
      setInterval(god, 100);
    });
    await page.waitForTimeout((sc.warm ?? WARM) * 1000);
    // Опыт: скрыть слой и посмотреть, сколько он стоил (PERF_HIDE=hud | canvas | layer).
    if (process.env.PERF_HIDE) await page.evaluate((what) => {
      const app = window.__vbApp, el = what === 'hud' ? app.game.ctx.hud.canvas : what === 'canvas' ? app.game.canvas : app.layer;
      el.style.display = 'none';
    }, process.env.PERF_HIDE);
    if (sc.pause) await page.evaluate(() => window.__vbApp.game.pause(true));
    if (sc.pause) await page.waitForTimeout(1000);
    const before = await page.evaluate(() => ({ ...window.__m }));
    const c0 = cpuOfChildren(), t0 = Date.now();
    let profile = null;
    const cdp = process.env.PERF_PROFILE && id === 'heart' ? await ctx.newCDPSession(page) : null;
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    await page.waitForTimeout(SEC * 1000);
    if (cdp) profile = (await cdp.send('Profiler.stop')).profile;
    const c1 = cpuOfChildren(), t1 = Date.now();
    const after = await page.evaluate(() => {
      const r = window.__vbApp.game.ctx.renderer, hud = window.__vbApp.game.ctx.hud;
      return { ...window.__m, px: [r.pixelW, r.pixelH], hudPx: [hud.canvas?.width ?? 0, hud.canvas?.height ?? 0], quality: r.quality, scene: window.__vbApp.current, director: window.__vbApp.game.battle?.director?.id ?? null };
    });
    const sec = (t1 - t0) / 1000, frames = after.frames - before.frames, cpu = (c1 - c0) / sec;
    const per = (k) => frames ? +((after[k] - before[k]) / frames).toFixed(2) : 0;
    results[id] = {
      fps: +(frames / sec).toFixed(1), cpu: +cpu.toFixed(2), perFrame: frames ? +((c1 - c0) * 1000 / frames).toFixed(1) : null,
      js: { sim: per('sim'), hud: per('hud'), render: per('render') },
      calls: frames ? Math.round((after.calls - before.calls) / frames) : 0, peakCalls: after.peakCalls, tris: frames ? Math.round((after.tris - before.tris) / frames) : 0,
      px: after.px, hudPx: after.hudPx, quality: after.quality, screen: after.scene, director: after.director, errors: errors.slice(0, 3),
    };
    console.log(id.padEnd(6), JSON.stringify(results[id]));
    if (profile) writeFileSync(`${OUT}/${LABEL}-heart.cpuprofile`, JSON.stringify(profile));
    if (profile) {
      const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const dt = profile.timeDeltas; let total = 0;
      profile.samples.forEach((sid, i) => { const n = byId.get(sid), f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); total += dt[i] ?? 0; });
      const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`);
      console.log('JS-профиль сцены heart (доля времени главного потока):\n' + top.join('\n'));
    }
    await ctx.close();
  }
} finally { await browser.close(); await server.close(); }
writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(results, null, 2));
console.log(`→ ${OUT}/${LABEL}.json`);
