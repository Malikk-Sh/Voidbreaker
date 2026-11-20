import assert from 'node:assert/strict';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

// Exercise the actual map handoff. Direct stage URLs never start the sanctuary score.
const target = process.env.DEVOURER_URL;
const server = target ? null : await preview({ preview: { host: '127.0.0.1', port: 4206, strictPort: true }, logLevel: 'warn' });
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  await page.goto(new URL('/?q=low', target || 'http://127.0.0.1:4206').href);
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { polling: 80, timeout: 60000 });
  await wait(() => !!window.__vbApp);
  await page.evaluate(() => {
    const save = window.__vbApp.ctx.save;
    save.flags.prologue = true;
    save.stages.boss1 = { clears: 1, stars: 3, bestRank: 'A', bestTime: 90 };
  });
  await page.getByText('Нажмите, чтобы начать').tap({ force: true });
  await wait(() => window.__vbApp.current === 'hub' && window.__vbApp.ctx.music.step >= 2);
  await page.evaluate(() => {
    const { audio, music } = window.__vbApp.ctx, analyser = audio.ctx.createAnalyser();
    window.cues = [];
    const play = music.buf.bind(music);
    music.buf = (id, ...args) => {
      if (['arrival', 'split', 'recall'].includes(id)) window.cues.push(id);
      return play(id, ...args);
    };
    analyser.fftSize = 4096;
    // Includes both direct sound and reverb. Effects have their own output.
    audio.musicBus.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    window.musicPeak = () => {
      analyser.getFloatTimeDomainData(samples);
      return samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    };
  });
  await wait(() => window.musicPeak() > 0.0002);
  await page.getByRole('button', { name: 'В бой', exact: true }).tap({ force: true });
  await wait(() => window.__vbApp.current === 'map');
  await page.locator('g:has(> circle[fill="url(#vbCorona)"])').dispatchEvent('pointerdown');
  await page.getByRole('button', { name: 'Бросить вызов' }).tap({ force: true });
  await wait(() => window.__vbApp.current === 'battle');
  assert.equal(await page.evaluate(() => window.__vbApp.ctx.music.song?.id ?? null), null);
  await wait(() => window.musicPeak() < 0.00001);
  await page.evaluate(() => {
    const b = window.__vb.battle;
    for (let i = 0; !b.director.active && i < 420; i++) b.frame(1 / 60);
    if (b.director.id !== 'devourerIntro') throw Error('Finale did not enter its intro');
    b.director.skip();
  });
  await wait(() => window.__vbApp.ctx.music.song?.id === 'devourer' && window.musicPeak() > 0.0004);
  const sections = [];
  for (const phase of [1, 2, 3]) {
    if (phase > 1) await page.evaluate(phase => {
      const b = window.__vb.battle;
      b.boss.transition(phase);
      for (let i = 0; b.director.active && i < 420; i++) b.frame(1 / 60);
    }, phase);
    await wait(phase => window.__vbApp.ctx.music.phase === phase - 1 && window.cues.includes(['arrival','split','recall'][phase - 1]) && window.musicPeak() > 0.0004, phase);
    sections.push(await page.evaluate(() => {
      const music = window.__vbApp.ctx.music;
      return { phase: music.phase + 1, song: music.song.id, output: Number(window.musicPeak().toFixed(4)) };
    }));
  }
  await page.evaluate(() => window.__vbApp.go('hub', false));
  await wait(() => window.__vbApp.ctx.music.song?.id === 'hub' && window.__vbApp.ctx.music.step > 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ route: 'title/hub/map/finale/hub', sections }));
} finally { await browser.close(); await server?.close(); }
