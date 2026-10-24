/**
 * Дымовой e2e-тест собранной игры (CI): титул без ошибок, затем бой 1-1 —
 * мир идёт, враги появляются, удары по ним проходят; пересмотр в Кинозале не трогает сохранение. Запуск: npm run build && npm run smoke.
 */
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
const base = 'http://localhost:4174/';
let browser;
let page;
const errors = [];
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed = true; };

try {
  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${base}?q=low`);
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForSelector('.vb-screen', { timeout: 15000 });
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
  check(await readSave() === saveBefore, 'пересмотр казни в Кинозале не меняет сохранение');

  // тренировочный зал: Жнец-спарринг встаёт, упражнение засчитывается настоящим приёмом
  await page.goto(`${base}?q=low&stage=training`);
  await page.waitForFunction(() => !!window.__vb?.battle, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const w = window.__vb.world;
    return w.enemies.some((e) => e.kind === 'reaper' && e.targetable)
      && w.enemies.some((e) => e.kind === 'husk' && e.targetable);
  }, null, { timeout: 30000 });
  // взмах в пустоту — не зачёт; Разлом по манекену — зачёт
  const airAt = await page.evaluate(() => {
    const bt = window.__vb.battle, h = bt.world.hero;
    // Упражнение проверяет попадание: удар спарринг-партнёра не должен прервать диагностический приём.
    h.invulnUntil = 1e9;
    const safe = { x: h.x, z: h.z };
    bt.world.arena.nearestWalkable(h.x, h.z + 6, safe);
    h.x = safe.x; h.z = safe.z; h.facing = 0;
    h.beginMove(h.weapon.combo[3], 0, 0.02);
    return bt.world.time;
  });
  await page.waitForFunction((at) => {
    const w = window.__vb.world;
    return w.time > at + 0.8 && w.hero.state === 'move' && !w.hero.move;
  }, airAt, { timeout: 30000 });
  const air = await page.evaluate(() => window.__vb.battle.drills.tracker.state.get('rift'));
  const hit = await page.evaluate(() => {
    const bt = window.__vb.battle, h = bt.world.hero, e = bt.world.enemies.find((x) => x.kind === 'husk' && x.targetable);
    if (!e) return 'нет манекена';
    h.x = e.x; h.z = e.z + 1.2; h.facing = Math.PI;
    h.beginMove(h.weapon.combo[3], 0, 0.02);
    return 'ok';
  });
  await page.waitForFunction(() => window.__vb.battle.drills.tracker.state.get('rift') === 'done', null, { timeout: 30000 });
  const rift = await page.evaluate(() => window.__vb.battle.drills.tracker.state.get('rift'));
  check(air === 'performed' && hit === 'ok' && rift === 'done', `тренировка: Жнец на месте, взмах мимо не засчитан, Разлом по манекену — засчитан (${air} → ${rift})`);
  check(errors.length === 0, `без ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  check(false, String(e));
  if (page) console.log('Состояние при сбое:', await page.evaluate(() => {
    const b = window.__vb?.battle, w = b?.world, h = w?.hero;
    return { screen: window.__app?.current, time: w?.time, cine: b?.cine.busy, director: b?.director.id,
      hero: h && { state: h.state, move: h.move?.id, stateT: h.stateT, clip: h.avatar.puppet.anim.clip?.id, clipTime: h.avatar.puppet.anim.t, scene: h.avatar.puppet.anim.sceneDriven },
      drill: b?.drills?.tracker.state.get('rift'), enemies: w?.enemies.map((x) => ({ kind: x.kind, state: x.state, dead: x.dead, targetable: x.targetable })) };
  }).catch(() => null));
} finally {
  await browser?.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
