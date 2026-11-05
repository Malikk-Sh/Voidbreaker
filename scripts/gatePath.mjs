/**
 * «Путь к Вратам»: управляемый подход, три волны, вход/пропуск Стража, добивание, подъём и настоящий выход.
 * Ввод обычный; враги снимаются после 3.5 с жизни, чтобы проверять состояние, а не баланс. Web Audio выключен.
 * SwiftShader проверяет WebGL и бюджеты геометрии; время кадра телефона этим стендом не измеряется.
 * npm run build && npm run gate-path-test
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const OUT = process.env.GATE_PATH_OUT ?? 'work/gate-path';
const QUALITIES = (process.env.GATE_PATH_Q ?? 'low,medium,high').split(',');
const VIEWS = (process.env.GATE_PATH_VIEWS ?? '844x390,740x360,1280x720').split(',').map((s) => {
  const [width, height] = s.split('x').map(Number); return { width, height };
});
mkdirSync(OUT, { recursive: true });
const server = await preview({ preview: { port: 4182, strictPort: true }, logLevel: 'warn' });
const browser = await launchChromium();
const report = { scenarios: [], errors: [], conditions: 'Chromium / SwiftShader; fixed step 1/60; procedural graphics; audio disabled' };
let assertions = 0;
const check = (ok, text) => { assertions++; if (!ok) throw new Error(text); };

async function boot(q, vp, extra = '') {
  const page = await browser.newPage({ viewport: vp, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.addInitScript(() => {
    for (const key of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) Object.defineProperty(window, key, { value: undefined, configurable: true });
    window.requestAnimationFrame = () => 0;
    let a = 0x2545f491;
    Math.random = () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    Date.now = () => 1767225600000;
  });
  await page.goto(`http://localhost:4182/?stage=1-3&single&god&q=${q}${extra}`);
  await page.waitForFunction(() => !!window.__vb?.battle, null, { timeout: 30000 });
  await page.evaluate(() => {
    const b = window.__vb.battle, inp = b.ctx.input;
    const s = window.__route = { mx: 0, mz: 0, frames: 0, ended: 0, born: new Map(), frozen: 0, freezeTime: null, invisibleAttack: false, skip: false, peak: { calls: 0, tris: 0 }, collected: new Set(), freezeBad: false };
    const update = inp.update.bind(inp);
    inp.update = (now) => { update(now); inp.moveX = s.mx; inp.moveZ = s.mz; inp.attackHeld = s.skip; };
    const originalEnd = b.onEnd;
    b.onEnd = (outcome) => { s.ended++; if (s.actualResults) originalEnd?.(outcome); };
    b.world.bus.on('enemyAttack', () => { if (b.director.id === 'gateEntrance') s.invisibleAttack = true; });
    b.ctx.renderer.gl.info.autoReset = false;
    // Отчёт собирает все проходы кадра: цвет, bloom, свет и тени.
    window.__routeDraw = () => {
      const r = b.ctx.renderer; r.gl.info.reset(); r.render(b.ctx.time.world);
      s.peak.calls = Math.max(s.peak.calls, r.gl.info.render.calls);
      s.peak.tris = Math.max(s.peak.tris, r.gl.info.render.triangles);
    };
    window.__routeState = () => ({ phase: b.gatePath.phase, open: b.gatePath.open, wave: b.runner.waveIdx, outcome: b.outcome,
      hero: { x: b.world.hero.x, z: b.world.hero.z, state: b.world.hero.state, locked: b.world.hero.locked },
      ended: s.ended, frozen: s.frozen, freezeBad: s.freezeBad, invisibleAttack: s.invisibleAttack, peak: s.peak,
      camera: b.cam.context, gateWalkable: b.arena.walkable(0, -11.5), director: b.director.id, cine: !!b.cam.cine });
  });
  return page;
}

async function advance(page, n, mode = 'idle') {
  return page.evaluate(([n, mode]) => {
    const b = window.__vb.battle, w = b.world, h = w.hero, s = window.__route, inp = b.ctx.input;
    let shot = null;
    for (let i = 0; i < n; i++) {
      s.mx = 0; s.mz = 0;
      const p = b.gatePath.phase;
      if (mode === 'walk' || (mode === 'fight' && (p === 'approach' || p === 'reveal'))) s.mz = -1;
      if (mode === 'exit' && p === 'passage') {
        const dx = -h.x, dz = -25 - h.z, d = Math.hypot(dx, dz) || 1;
        s.mx = dx / d; s.mz = dz / d;
      }
      const free = !b.director.active && !b.cine.active && !h.locked;
      if (mode === 'fight' && p === 'combat' && free) {
        const near = w.enemies.filter(e => e.targetable).sort((a, c) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(c.x - h.x, c.z - h.z))[0];
        if (near) {
          const d = Math.hypot(near.x - h.x, near.z - h.z);
          if (d > 2) { s.mx = (near.x - h.x) / d; s.mz = (near.z - h.z) / d; }
          if (s.frames % 14 === 0) inp.buffer.push('attack', inp.now);
        }
      }
      h.hp = h.maxHp;
      b.frame(1 / 60); s.frames++;
      b.ctx.hud.draw(1 / 60, b.hudFrame());
      if (b.director.id === 'gateEntrance') {
        if (s.freezeTime === null) s.freezeTime = w.time;
        else if (Math.abs(s.freezeTime - w.time) > 1e-8) s.freezeBad = true;
        s.frozen++;
      }
      if (mode === 'fight' && !b.director.active && !b.cine.active) for (const e of w.enemies) {
        if (e.dead) continue;
        if (!s.born.has(e)) s.born.set(e, w.time);
        if (w.time - s.born.get(e) > 3.5) {
          e.hp = Math.min(1, e.hp);
          w.damageEnemy(e, { mult: 1, stun: 1e6, knockback: 0, feel: 'light', dirX: 0, dirZ: 1, source: 'blade' });
        }
      }
      if (s.frames % 120 === 0) window.__routeDraw();
      if (b.director.id === 'gateEntrance' && b.director.time > 2.5 && !s.collected.has('entrance')) shot = 'entrance';
      if (p === 'combat' && b.runner.guardian && !b.director.active && !b.cine.active && !s.collected.has('combat')) shot = 'combat';
      if (b.gatePath.phase === 'opening' && b.gatePath.open > 0.45 && !s.collected.has('opening')) shot = 'opening';
      if (shot) { s.collected.add(shot); window.__routeDraw(); break; }
      if (mode === 'walk' && b.gatePath.phase === 'reveal') break;
      if (mode === 'exit' && s.ended > 0) break;
    }
    window.__routeDraw();
    return { ...window.__routeState(), shot };
  }, [n, mode]);
}

try {
  for (const q of process.env.GATE_PATH_ONLY_EDGES ? [] : QUALITIES) for (const vp of VIEWS) {
    const label = `${q}-${vp.width}x${vp.height}`;
    const page = await boot(q, vp);
    const shot = async (name) => { await page.screenshot({ path: join(OUT, `${label}-${name}.png`) }); };
    try {
      let st = await advance(page, 120);
      check(st.phase === 'approach' && st.wave === -1 && st.hero.z === 21 && !st.hero.locked, `${label}: управление/ожидание в галерее`);
      await shot('gallery');
      st = await advance(page, 240, 'walk');
      check(st.phase === 'reveal' && st.hero.z < 14 && st.wave === -1, `${label}: раскрытие пространства вводом`);
      await shot('reveal');
      for (let i = 0; i < 75 && st.outcome === 'playing'; i++) {
        st = await advance(page, 120, 'fight');
        if (st.shot) await shot(st.shot);
      }
      check(st.outcome === 'won', `${label}: все три волны и добивание завершены: ${JSON.stringify(st)}`);
      check(st.frozen > 100 && !st.freezeBad && !st.invisibleAttack, `${label}: безопасный вход Стража`);
      // Выдержка финала добивания: Врата не забирают его камеру и позу.
      for (let i = 0; i < 12 && st.phase !== 'passage'; i++) {
        st = await advance(page, 120);
        if (st.shot) await shot(st.shot);
      }
      check(st.phase === 'passage' && st.open === 1 && st.gateWalkable, `${label}: решётка и коллизия открыты`);
      check(st.ended === 0 && !st.hero.locked && st.hero.state === 'move', `${label}: осмотр после победы и возврат управления`);
      await shot('opened');
      const actual = q === 'medium' && vp.width === 844;
      if (actual) await page.evaluate(() => { window.__route.actualResults = true; });
      for (let i = 0; i < 25 && st.ended === 0; i++) st = await advance(page, 120, 'exit');
      check(st.phase === 'complete' && st.ended === 1, `${label}: игрок прошёл в следующее помещение: ${JSON.stringify(st)}`);
      if (actual) {
        const result = await page.evaluate(() => ({ screen: window.__app.current, clear: !!window.__vb.game.ctx.save.stages['1-3']?.clears }));
        check(result.screen === 'results' && result.clear, `${label}: настоящие результаты и сохранённая победа: ${JSON.stringify(result)}`);
      } else await advance(page, 120);
      check((await page.evaluate(() => window.__route.ended)) === 1, `${label}: завершение ровно один раз`);
      check(st.peak.calls <= 160 && st.peak.tris <= 260000, `${label}: бюджет ${JSON.stringify(st.peak)}`);
      report.scenarios.push({ label, ...st });
      console.log(`✓ ${label}: галерея → раскрытие → Страж → открытые Врата → выход; ${st.peak.calls} calls / ${st.peak.tris} tris`);
    } finally { await page.close(); }
  }
  // Пропуск и пауза — на реальном Battle, не только на моках Director.
  const page = await boot('medium', { width: 844, height: 390 }, '&wave=2');
  await page.evaluate(() => {
    window.__route.skip = true;
    // Игрок может встретить Стража прямо у выхода. Вход выбирает точку в стороне от него.
    window.__vb.battle.world.hero.spawn(0, -5.5, Math.PI);
  });
  let st = await advance(page, 180);
  await page.evaluate(() => { window.__route.skip = false; });
  check(!st.director && !st.hero.locked && st.phase === 'combat' && !st.gateWalkable, `пропуск входа возвращает бой при закрытых Вратах: ${JSON.stringify(st)}`);
  const enemy = await page.evaluate(() => { const e = window.__vb.battle.runner.guardian; return { x: e.x, z: e.z, dissolve: e.puppet.dissolve }; });
  check(enemy.dissolve === 0 && enemy.z > -8 && Math.hypot(enemy.x - st.hero.x, enemy.z - st.hero.z) > 3, 'пропуск не оставляет Стража за решёткой, прозрачным или поверх героя');
  const phased = await page.evaluate(() => {
    const b = window.__vb.battle, h = b.world.hero;
    h.spawn(0, -8.8, Math.PI); h.target = null;
    b.abilities.loadout.q = 'phase'; b.abilities.resetCooldowns();
    const cast = b.abilities.tryCast('q', { moveX: 0, moveZ: -1, aimActive: false });
    return { cast, z: h.z, ground: b.arena.walkable(h.x, h.z) };
  });
  check(phased.cast && phased.z > -9.65 && phased.ground, 'Фазовый шаг не обходит закрытые Врата в настоящем Battle');
  await page.evaluate(() => { const b = window.__vb.battle; b.gatePath.win(); b.outcome = 'won'; b.ctx.time.paused = true; });
  st = await advance(page, 120);
  check(st.open === 0 && !st.gateWalkable, 'пауза останавливает подъём и открытие коллизии');
  await page.evaluate(() => { const b = window.__vb.battle; b.ctx.time.paused = false; b.world.hero.die(); });
  st = await advance(page, 1);
  check(st.phase === 'failed' && !st.gateWalkable && st.outcome === 'lost', 'смерть во время перехода не открывает Врата');
  await page.close();
  const shortPage = await boot('medium', { width: 740, height: 360 }, '&wave=2');
  await shortPage.evaluate(() => { window.__vb.battle.ctx.save.cine.gateEntrance = 2; });
  let shortened = await advance(shortPage, 210);
  for (let i = 0; i < 4 && shortened.director; i++) shortened = await advance(shortPage, 120);
  check(shortened.frozen > 120 && shortened.frozen < 200 && !shortened.director, 'повторный вход использует короткую версию');
  check(!shortened.hero.locked && !shortened.gateWalkable && !shortened.freezeBad, 'короткая версия возвращает управление и закрытые Врата');
  await shortPage.close();
  check(report.errors.length === 0, `ошибки браузера: ${report.errors.join(' | ')}`);
  report.assertions = assertions;
  console.log(`✓ ${assertions} проверок; ошибок браузера: ${report.errors.length}`);
} catch (e) {
  report.failure = e.stack;
  console.error(e);
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
