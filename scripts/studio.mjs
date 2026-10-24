/** Проверка студии на сенсорных экранах, хранения проекта и игровых пересмотров. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';
const out = process.env.STUDIO_OUT ?? 'work/studio';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4183, strictPort: true }, logLevel: 'warn' });
const browser = await launchChromium();
let failed = false;
const results = [];
const check = (ok, message) => { results.push({ ok: !!ok, message }); console.log(`${ok ? '✓' : '✗'} ${message}`); if (!ok) failed = true; };
const errors = [];
try {
  for (const size of [{ width: 412, height: 915 }, { width: 915, height: 412 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport: size, isMobile: size.width < 1000, hasTouch: true, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://localhost:4183/editor.html');
    await page.waitForFunction(() => !!window.__studio);
    const ui = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, options: document.querySelector('select[aria-label="Сцена"]').options.length, touchTargets: [...document.querySelectorAll('.clip')].every(b => b.getBoundingClientRect().height >= 44) }));
    check(ui.overflow === 0 && ui.options === 24 && ui.touchTargets, `${size.width}×${size.height}: 24 сцены, нет выезда страницы, фрагменты ≥44px`);
    const scenes = await page.getByRole('combobox', { name: 'Сцена', exact: true }).locator('option').evaluateAll(es => es.map(e => e.value));
    for (const id of scenes) {
      await page.getByRole('combobox', { name: 'Сцена', exact: true }).selectOption(id);
      const state = await page.evaluate(() => {
        const s = window.__studio, p = s.preview, d = p.duration;
        let finite = true;
        for (const t of [0, d * 0.45, d - 0.01]) {
          p.seek(t);
          finite &&= Object.values(p.actors).every(a => [a.x, a.y, a.z, a.facing].every(Number.isFinite));
          finite &&= [...p.renderer.camera.matrixWorld.elements].every(Number.isFinite);
        }
        return { finite, duration: d };
      });
      check(state.finite && state.duration > 0, `${size.width}×${size.height}: ${id} — начало, середина и конец`);
    }
    await page.getByRole('combobox', { name: 'Сцена', exact: true }).selectOption('hierophantEnd');
    const seek = await page.evaluate(() => {
      const s = window.__studio, p = s.preview;
      p.seek(5.22); const a = [p.actors.hero.x, p.actors.hero.y, p.actors.hero.z, ...p.hero.puppet.anim.out], error = p.contactError;
      p.seek(10.5); p.seek(5.22); const b = [p.actors.hero.x, p.actors.hero.y, p.actors.hero.z, ...p.hero.puppet.anim.out];
      return { error, difference: Math.max(...a.map((v,i)=>Math.abs(v-b[i]))) };
    });
    check(seek.error < 0.0001 && seek.difference < 1e-6, `${size.width}×${size.height}: контакт точнее 0.1мм; перемотка назад воспроизводима`);
    await page.getByRole('button', { name: 'Короткая', exact: true }).count().then(async count => { if (!count) await page.getByRole('button', { name: 'Полная', exact: true }).tap(); });
    check(await page.evaluate(() => window.__studio.variant === 'short'), `${size.width}×${size.height}: короткая версия`);
    await page.getByRole('button', { name: 'Короткая', exact: true }).tap();
    await page.getByRole('button', { name: 'Воспроизвести', exact: true }).tap();
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: 'Пауза', exact: true }).tap();
    check(await page.evaluate(() => window.__studio.preview.time > 0.03), `${size.width}×${size.height}: воспроизведение касанием`);
    await page.getByRole('combobox', { name: 'Характер движения', exact: true }).selectOption('inOutCubic');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('voidbreaker.scene-studio.v1')));
    check(saved.scenes.hierophantEnd.full.steps['actor:hero:0'].ease === 'inOutCubic', `${size.width}×${size.height}: изменение записано в браузер`);
    await page.getByRole('button', { name: 'Отменить', exact: true }).tap();
    check(await page.getByRole('combobox', { name: 'Характер движения', exact: true }).inputValue() === 'outCubic', `${size.width}×${size.height}: отмена`);
    await page.getByRole('button', { name: 'Повторить', exact: true }).tap();
    check(await page.getByRole('combobox', { name: 'Характер движения', exact: true }).inputValue() === 'inOutCubic', `${size.width}×${size.height}: повтор`);
    await page.reload(); await page.waitForFunction(() => !!window.__studio);
    check(await page.getByRole('combobox', { name: 'Характер движения', exact: true }).inputValue() === 'inOutCubic', `${size.width}×${size.height}: правка пережила обновление страницы`);
    await page.getByRole('button', { name: 'Файл и помощь', exact: true }).tap();
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Экспорт проекта · JSON', exact: true }).tap();
    const download = await downloading, filePath = `${out}/project-${size.width}.json`; await download.saveAs(filePath);
    const exported = JSON.parse(readFileSync(filePath, 'utf8'));
    check(exported.version === 1 && exported.scenes.hierophantEnd.full.steps['actor:hero:0'].ease === 'inOutCubic', `${size.width}×${size.height}: экспорт JSON`);
    const beforeInvalid = await page.evaluate(() => localStorage.getItem('voidbreaker.scene-studio.v1'));
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2}') });
    await page.waitForFunction(() => document.querySelector('.toast').textContent.includes('Не удалось импортировать'));
    check(beforeInvalid === await page.evaluate(() => localStorage.getItem('voidbreaker.scene-studio.v1')), `${size.width}×${size.height}: ошибочный импорт сохранил проект`);
    await page.locator('input[type=file]').setInputFiles(filePath);
    await page.waitForFunction(() => document.querySelector('.toast').textContent.includes('Проект импортирован'));
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('voidbreaker.scene-studio.v1')).version === 1), `${size.width}×${size.height}: импорт проекта`);
    await page.getByRole('button', { name: 'Поза', exact: true }).tap();
    await page.getByRole('combobox', { name: 'Фрагмент анимации', exact: true }).selectOption('clip:hero:4');
    await page.getByRole('button', { name: 'Показать контакт с маской', exact: true }).tap();
    await page.getByRole('combobox', { name: 'Сустав', exact: true }).selectOption('chest');
    await page.getByRole('button', { name: 'Увеличить Поворот сустава · градусы X · наклон', exact: true }).tap();
    check(await page.evaluate(() => !!window.__studio.project.scenes.hierophantEnd.full.steps['clip:hero:4'].definition), `${size.width}×${size.height}: своя ключевая поза`);
    await page.getByRole('button', { name: 'Совместить клинок с маской', exact: true }).tap();
    check(await page.evaluate(() => window.__studio.preview.contactError < 0.005), `${size.width}×${size.height}: повторное совмещение после правки позы`);
    await page.evaluate(() => { const s = window.__studio; s.seek(5.22); });
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({ path: `${out}/studio-${size.width}x${size.height}.png`, fullPage: false });
    if (size.width === 412) {
      // Просмотр в игре использует тот же origin и проект.
      await page.getByRole('button', { name: 'Сцена', exact: true }).tap();
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('button', { name: 'Просмотр в игре ↗', exact: true }).tap();
      const game = await popupPromise;
      game.on('pageerror', e => errors.push(e.message));
      game.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await game.setViewportSize({ width: 915, height: 412 });
      await game.waitForFunction(() => window.__app?.game.battle?.director.id === 'hierophantEnd', null, { timeout: 45000 });
      await game.evaluate(() => { window.__app.game.running = false; });
      const initialSave = await game.evaluate(() => { const s = structuredClone(window.__app.ctx.save); delete s.cine; delete s.updatedAt; return JSON.stringify(s); });
      await game.evaluate(() => { const app = window.__app, battle = app.game.battle; for (let i = 0; i < 1100 && app.game.battle === battle; i++) battle.frame(1 / 60); });
      await game.waitForFunction(() => window.__app?.current === 'hub', null, { timeout: 10000 });
      check(initialSave === await game.evaluate(() => { const s = structuredClone(window.__app.ctx.save); delete s.cine; delete s.updatedAt; return JSON.stringify(s); }), 'Просмотр финала в игре сохранил прогресс');
      for (const id of ['prologueLanding', 'hierophantCollapse', 'hierophantCrack']) {
        await game.goto(`http://localhost:4183/?studioPreview=1&scene=${id}`);
        await game.waitForFunction(id => window.__app?.game.battle?.director.id === id, id, { timeout: 30000 });
        check(true, `Прямой пересмотр: ${id}`);
      }
      await game.close();
    }
    await context.close();
  }
  check(errors.length === 0, `Ошибки браузера: ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
} catch (error) { failed = true; console.error(error); }
finally {
  writeFileSync(`${out}/report.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close(); await server.close();
}
if (failed) process.exitCode = 1;
