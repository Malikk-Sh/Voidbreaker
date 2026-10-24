/**
 * Проход Зоны 01 (этап 4.5, проверки на регрессии): каждый этап и босс от загрузки до победы на экране телефона
 * 844×390. Мир шагает вручную (детерминированно, быстрее реального времени); враги живут HOLD с после
 * появления — успевают показать телеграфы — и снимаются ударом с оглушением (Иерофант — казнью). Пишет по
 * этапу: победу, время мира, ошибки консоли, пик вызовов отрисовки и треугольников за кадр (все проходы,
 * с постобработкой), и кадр боя со второй волны для проверки читаемости (герой, угроза, граница прохода).
 *
 * Время кадра здесь не мерится: SwiftShader рисует на процессоре и не похож на телефон — для этого замеры на
 * устройствах. Запуск: npm run build && npm run sweep [-- 1-3 boss1] (SWEEP_OUT — папка для кадров).
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const ALL = ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '1-9', 'boss1'];
const stages = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const OUT = process.env.SWEEP_OUT ?? 'sweep';
const Q = process.env.SWEEP_Q ?? 'medium';
/** Сколько секунд мира враг живёт до снятия; предел этапа (с мира). */
const HOLD = 3.5, LIMIT = 600;
/**
 * Бюджет кадра (все проходы, medium): пик сейчас — Иерофант, ~80 вызовов и ~130 тыс. треугольников; вдвое больше —
 * повод смотреть, что добавилось.
 */
const BUDGET = { calls: 160, tris: 260_000 };
mkdirSync(OUT, { recursive: true });

const server = await preview({ preview: { port: 4175, strictPort: true }, logLevel: 'warn' });
let browser;
let failed = false;

try {
  browser = await launchChromium();
  for (const id of stages) {
    rmSync(`${OUT}/${id}.png`, { force: true });
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:4175/?q=${Q}&stage=${id}&god`);
    await page.waitForFunction(() => !!window.__vb?.battle, null, { timeout: 30000 });
    await page.evaluate(() => {
      window.__vb.game.running = false;
      const gl = window.__vb.battle.ctx.renderer.gl;
      gl.info.autoReset = false;
      window.__peak = { calls: 0, tris: 0 };
      window.__shot = false;
    });
    let r = { outcome: 'playing' };
    // порциями по 2 с мира: снимок второй волны делает страница, пока враги живы
    while (r.outcome === 'playing') {
      r = await page.evaluate(([HOLD]) => {
        const bt = window.__vb.battle, w = bt.world, R = bt.ctx.renderer;
        const born = (window.__born ??= new Map());
        for (let i = 0; i < 120 && bt.outcome === 'playing'; i++) {
          w.hero.hp = w.hero.maxHp;
          bt.frame(1 / 60);
          // HUD рисует игровой цикл (он стоит): баннеры и подсказки идут по тем же кадрам
          bt.ctx.hud.draw(1 / 60, bt.hudFrame());
          for (const e of w.enemies) {
            if (e.dead) continue;
            if (!born.has(e)) born.set(e, w.time);
            if (w.time - born.get(e) > HOLD) { e.hp = Math.min(e.hp, 1); w.damageEnemy(e, { mult: 1, stun: 1e6, knockback: 0, feel: 'light', dirX: 0, dirZ: 1, source: 'blade' }); }
          }
          // Иерофант в фазе III умирает только от казни: оглушён — «ДОБИТЬ»
          if (bt.boss?.executable && !bt.director.active) bt.boss.execute();
          if (i % 30 === 0) {
            R.gl.info.reset();
            R.render(bt.ctx.time.world);
            const inf = R.gl.info.render;
            window.__peak.calls = Math.max(window.__peak.calls, inf.calls);
            window.__peak.tris = Math.max(window.__peak.tris, inf.triangles);
          }
          // кадр для читаемости: со второй волны (у босса — с первой), бой без постановки, враг в 7 м атакует —
          // на кадре должны читаться герой, эта угроза и граница прохода
          const wi = bt.runner.waveIdx, want = bt.stage.boss ? 0 : Math.min(1, bt.runner.waveTotal - 1), h = w.hero;
          if (!window.__shot && bt.runner.phase === 'wave' && wi >= want && !bt.cine.active && !bt.director.active && !bt.cam.cine
            && w.enemies.some((e) => !e.dead && e.state === 'attack' && Math.hypot(e.x - h.x, e.z - h.z) < 7)) { window.__shot = true; R.render(bt.ctx.time.world); return { outcome: 'shot' }; }
        }
        return { outcome: bt.outcome, t: w.time, peak: window.__peak };
      }, [HOLD]);
      if (r.outcome === 'shot') { await page.screenshot({ path: `${OUT}/${id}.png` }); r = { outcome: 'playing' }; }
      const t = await page.evaluate(() => window.__vb.battle.world.time);
      if (t > LIMIT) { r = { outcome: 'timeout', t, peak: await page.evaluate(() => window.__peak) }; break; }
    }
    const shot = existsSync(`${OUT}/${id}.png`);
    const ok = r.outcome === 'won' && shot && errors.length === 0 && r.peak.calls <= BUDGET.calls && r.peak.tris <= BUDGET.tris;
    if (!ok) failed = true;
    console.log(`${ok ? '✓' : '✗'} ${id.padEnd(5)} ${r.outcome.padEnd(7)} мир ${r.t.toFixed(0).padStart(3)} с · вызовов ${r.peak.calls} · треугольников ${Math.round(r.peak.tris / 1000)} тыс.${shot ? '' : ' · нет кадра угрозы'}${errors.length ? ` · ошибки: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((res) => server.httpServer.close(res));
}
console.log(`кадры читаемости: ${OUT}/<этап>.png`);
process.exit(failed ? 1 : 0);
