/**
 * Баланс боя с Погребальным сердцем, без бессмертия: наивный игрок (идёт к ближайшей цели и жмёт атаку, меток не
 * видит) должен проиграть; игрок, который уходит из-под падения и пользуется механиками (heartBot), — победить.
 * Печатает длительность боя, HP героя и сердца, падения, сбивания и контратаки. Нужен `npm run build`.
 */
import { preview } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChromium } from './browser.mjs';
import { driveHeart } from './heartBot.mjs';
const out = process.env.HEART_BALANCE_OUT ?? 'work/heart-balance'; mkdirSync(out, { recursive: true });
const Q = process.env.HEART_BALANCE_Q ?? 'medium', LIMIT = 240;
const naive = function (b, s) {
  const w = b.world, h = w.hero, r = b.heart, inp = b.ctx.input;
  s.mx = s.mz = 0; s.held = false; s.aim = false;
  if (!r?.active || r.dead || b.director.active || b.cine.active || h.locked) return;
  const targets = [...w.enemies.filter((e) => !e.dead).map((e) => ({ x: e.x, z: e.z })), ...(r.exposed > 0 ? [{ x: r.body.x, z: r.body.z }] : [])];
  const t = targets.sort((a, c) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(c.x - h.x, c.z - h.z))[0] ?? { x: r.body.x, z: r.body.z };
  const dx = t.x - h.x, dz = t.z - h.z, d = Math.hypot(dx, dz) || 1;
  s.aim = true; s.ax = dx / d; s.az = dz / d;
  if (d > 2) { s.mx = dx / d; s.mz = dz / d; }
  if (s.frames % 12 === 0) inp.buffer.push('attack', inp.now);
};
const server = await preview({ preview: { port: 4194, strictPort: true }, logLevel: 'warn' }), browser = await launchChromium();
const report = []; let failed = false;
try {
  const only = process.env.HEART_BALANCE_ONLY;
  for (const [name, bot] of [['naive', naive], ['skilled', driveHeart]].filter(([n]) => !only || n === only)) {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }); const errors = [];
    page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript({ content: `window.__drive=${bot.toString()};window.requestAnimationFrame=()=>0;for(const k of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,k,{value:undefined,configurable:true});` });
    await page.goto(`http://localhost:4194/?stage=1-4&wave=4&q=${Q}`); await page.waitForFunction(() => !!window.__vb?.battle?.heart);
    await page.evaluate(() => {
      const b = window.__vb.battle, inp = b.ctx.input;
      const s = window.__run = { frames: 0, start: -1, mx: 0, mz: -1, held: false, aim: false, ax: 0, az: -1, hurt: {} };
      // Откуда урон: сердце (по позе в момент удара), носильщики, волны.
      b.world.bus.on('playerHurt', (e) => { const r = b.heart, k = e.source === 'Погребальное Сердце' ? `сердце:${r.attack?.kind ?? r.pose}` : e.source; s.hurt[k] = (s.hurt[k] ?? 0) + e.dmg; });
      const update = inp.update.bind(inp); inp.update = (now) => { update(now); inp.moveX = s.mx; inp.moveZ = s.mz; inp.attackHeld = s.held; inp.aimActive = s.aim; inp.aimX = s.ax; inp.aimZ = s.az; };
    });
    let st;
    for (let batch = 0; batch < 400; batch++) {
      st = await page.evaluate((LIMIT) => {
        const b = window.__vb.battle, h = b.world.hero, r = b.heart, s = window.__run;
        for (let i = 0; i < 300; i++) {
          if (!r.active && !r.dead) { s.mx = 0; s.mz = -1; s.held = false; s.aim = false; } else { if (s.start < 0) s.start = s.frames; window.__drive(b, s); }
          b.frame(1 / 60); s.frames++;
          if (r.dead || h.dead || (s.start >= 0 && s.frames - s.start > LIMIT * 60)) break;
        }
        return { fight: s.start < 0 ? 0 : +((s.frames - s.start) / 60).toFixed(1), heartDead: r.dead, heroDead: h.dead, heartHp: r.hp, heroHp: Math.round(h.hp), phase: r.phase, metrics: { ...r.metrics }, hurt: s.hurt };
      }, LIMIT);
      if (st.heartDead || st.heroDead || st.fight > LIMIT) break;
    }
    report.push({ name, ...st, errors });
    console.log(`${name}: ${st.heartDead ? 'победа' : st.heroDead ? 'поражение' : 'не закончен'} за ${st.fight} с; герой ${st.heroHp} HP, сердце ${st.heartHp} HP (фаза ${st.phase}); ${JSON.stringify(st.metrics)}; урон по герою ${JSON.stringify(st.hurt)}`);
    if (errors.length) { failed = true; console.error(errors.slice(0, 3)); }
    await page.close();
  }
  const n = report.find((r) => r.name === 'naive'), k = report.find((r) => r.name === 'skilled');
  if (n?.heartDead) { failed = true; console.error('✗ наивный игрок, не глядя на метки, победил сердце'); }
  if (k && !k.heartDead) { failed = true; console.error('✗ игрок, пользующийся механиками, не победил сердце'); }
  if (!failed) console.log('✓ баланс: без механик бой проигран, с механиками — выигран');
} catch (e) { failed = true; console.error(e); } finally { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
if (failed) process.exitCode = 1;
