/**
 * Дымовой e2e-тест собранной игры (CI): титул без ошибок, затем бой 1-1 —
 * мир идёт, враги появляются, удары по ним проходят; пересмотр в Кинозале не трогает сохранение. Запуск: npm run build && npm run smoke.
 */
import { preview } from 'vite';
import { chromium } from 'playwright';

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
const base = 'http://localhost:4174/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed = true; };

try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${base}?q=low`);
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2000);
  check(await page.evaluate(() => !!document.querySelector('.vb-screen')), 'титульный экран отрисован');

  await page.goto(`${base}?q=low&stage=1-1&god`);
  await page.waitForFunction(() => !!window.__vb?.world, null, { timeout: 15000 });
  const t0 = await page.evaluate(() => window.__vb.world.time);
  // бот: идти к ближайшему врагу и бить
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const w = window.__vb.world, h = w.hero;
      const e = w.enemies.filter((x) => !x.dead).sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
      return { kills: w.run.kills, dx: e ? e.x - h.x : 0, dz: e ? e.z - h.z : 0, has: !!e };
    });
    if (s.kills >= 2) break;
    const keys = [];
    if (s.has && Math.hypot(s.dx, s.dz) > 1.8) {
      if (s.dx > 0.5) keys.push('KeyD'); if (s.dx < -0.5) keys.push('KeyA');
      if (s.dz > 0.5) keys.push('KeyS'); if (s.dz < -0.5) keys.push('KeyW');
    }
    for (const k of keys) await page.keyboard.down(k);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(160);
    for (const k of keys) await page.keyboard.up(k);
  }
  const st = await page.evaluate(() => ({ t: window.__vb.world.time, kills: window.__vb.world.run.kills, dmg: window.__vb.world.run.dmgDealt }));
  check(st.t > t0 + 1, `мировое время идёт (${st.t.toFixed(1)} с)`);
  check(st.dmg > 0, `урон по врагам нанесён (${Math.round(st.dmg)})`);
  check(st.kills >= 1, `враги побеждены (${st.kills})`);
  if (process.env.SMOKE_SHOT) await page.screenshot({ path: process.env.SMOKE_SHOT });

  // Кинозал: пересмотр казни Иерофанта не меняет сохранение (кроме счётчика просмотров сцен)
  await page.goto(`${base}?q=low&screen=hub`);
  await page.waitForFunction(() => window.__app?.current === 'hub', null, { timeout: 15000 });
  const readSave = () => page.evaluate(() => {
    const raw = localStorage.getItem('voidbreaker.save.v1');
    const s = raw ? JSON.parse(JSON.parse(raw).data) : {};
    delete s.cine; delete s.updatedAt;
    return JSON.stringify(s);
  });
  const saveBefore = await readSave();
  await page.evaluate(() => window.__app.watchScene('hierophantEnd'));
  await page.waitForFunction(() => window.__app.current === 'battle', null, { timeout: 15000 });
  await page.waitForFunction(() => window.__app.current === 'hub', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  check(await readSave() === saveBefore, 'пересмотр казни в Кинозале не меняет сохранение');

  // тренировочный зал: Жнец-спарринг встаёт, упражнение засчитывается настоящим приёмом
  await page.goto(`${base}?q=low&stage=training`);
  await page.waitForFunction(() => !!window.__vb?.battle, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__vb.world.enemies.some((e) => e.kind === 'reaper' && !e.dead), null, { timeout: 15000 });
  const drill = await page.evaluate(() => {
    const bt = window.__vb.battle, h = bt.world.hero;
    h.beginMove(h.weapon.combo[3], 0, 0.02);
    return bt.drills.done.has('rift') && bt.drills.lines[0].done === true;
  });
  check(drill, 'тренировка: спарринг-Жнец на месте, упражнение засчитано');
  check(errors.length === 0, `без ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  check(false, String(e));
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
