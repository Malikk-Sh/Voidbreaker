/**
 * Реальный App: элита притвора → побег души → ожидание героя → пробуждение Сердца.
 * Ввод движения обычный; снятие врага после 3.5 с проверяет историю, а не баланс боя.
 * npm run build && node scripts/heartStory.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const OUT = process.env.HEART_STORY_OUT ?? 'work/heart-story';
const QUALITY = process.env.HEART_STORY_Q ?? 'medium';
const [width, height] = (process.env.HEART_STORY_VIEW ?? '844x390').split('x').map(Number);
if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240) throw new Error('Invalid HEART_STORY_VIEW');
mkdirSync(OUT, { recursive: true });
const report = {
  conditions: 'Chromium / SwiftShader; touch; manual 1/60; audio and RAF disabled; actual App; accelerated final-elite kill',
  viewport: { width, height }, quality: QUALITY, assertions: 0, errors: [], screenshots: [],
};
let server, browser, page, failed = false;
function check(ok, message) {
  report.assertions++;
  if (!ok) throw new Error(`${message}: ${JSON.stringify(report.lastState)}`);
}

async function shot(name) {
  const path = join(OUT, `${QUALITY}-${width}x${height}-${name}.png`);
  await page.screenshot({ path, timeout: 60000 });
  report.screenshots.push(path);
}

async function advance(frames, mode) {
  const state = await page.evaluate(([frames, mode]) => {
    const b = window.__vb.battle, w = b.world, h = w.hero, soul = b.heartSoul;
    const s = window.__heartStory, input = b.ctx.input;
    const isStory = () => b.director.id === 'heartSoulEscape' || b.director.id === 'heartAwakening';
    const timerSnapshot = () => w.enemies.map(e => ({
      kind: e.kind, time: e.time, state: e.state, stateT: e.stateT,
      cooldown: e.cooldown, brainT: e.brainT, deathT: e.deathT, airT: e.airT, lagT: e.lagT,
    }));
    let capture = null;
    for (let i = 0; i < frames && !s.finished; i++) {
      s.mx = s.mz = 0;
      const free = !b.director.active && !b.cine.active && !h.locked;
      if (mode === 'walk' && free && s.waypoint < s.route.length) {
        const [tx, tz] = s.route[s.waypoint];
        const d = Math.hypot(tx - h.x, tz - h.z);
        if (d < 0.3) s.waypoint++;
        else { s.mx = (tx - h.x) / d; s.mz = (tz - h.z) / d; }
      }
      b.frame(1 / 60);
      s.frames++;
      b.ctx.hud.draw(1 / 60, b.hudFrame());

      if (isStory()) {
        const id = b.director.id, time = b.director.time;
        const timers = JSON.stringify(timerSnapshot());
        if (s.freeze?.id === id) {
          if ((Math.abs(w.time - s.freeze.worldTime) > 1e-8 || timers !== s.freeze.timers) && s.freezeBad.length < 5) {
            s.freezeBad.push({ id, time, worldTime: w.time, expectedWorldTime: s.freeze.worldTime, timers: timerSnapshot() });
          }
        } else s.freeze = { id, worldTime: w.time, timers };
        s.freezeSamples[id] = (s.freezeSamples[id] ?? 0) + 1;
        if (b.heart.active && s.earlyActive.length < 5) s.earlyActive.push({ id, time, frame: s.frames });
        if (id === 'heartSoulEscape' && time >= 0.8 && !s.escapeMid) {
          s.escapeMid = { time, phase: soul.phase, visible: soul.visible, position: { ...soul.position } };
        }
        if (id === 'heartSoulEscape' && time >= 1.7 && !s.shots.has('late-escape')) capture = 'late-escape';
        if (id === 'heartAwakening' && time >= 1.3 && !s.shots.has('arrival-1.3')) capture = 'arrival-1.3';
        if (id === 'heartAwakening' && time >= 2.25 && !s.shots.has('arrival-2.25')) {
          s.beforeAbsorb = { time, phase: soul.phase, visible: soul.visible, awakened: soul.awakened, position: { ...soul.position } };
          capture = 'arrival-2.25';
        }
        if (id === 'heartAwakening' && time >= 4.6 && !s.shots.has('awakened-4.6')) capture = 'awakened-4.6';
      } else s.freeze = null;

      if (mode === 'fight' && !b.director.active && !b.cine.active && soul.phase === 'idle') {
        for (const e of w.enemies) {
          if (e.dead) continue;
          if (!s.born.has(e)) s.born.set(e, w.time);
          if (w.time - s.born.get(e) > 3.5) {
            // Начатое до сцены удержание не должно случайно пропускать её.
            s.attackHeld = true;
            e.hp = Math.min(e.hp, 1);
            w.damageEnemy(e, { mult: 1, stun: 1e6, knockback: 0, feel: 'light', dirX: 0, dirZ: 1, source: 'blade' });
          }
        }
      }
      if (mode === 'walk' && h.z <= -11.5 && soul.phase === 'hidden' && !s.shots.has('gate-approach')) capture = 'gate-approach';
      if (s.frames % 120 === 0 || capture || s.finished) window.__heartStoryDraw();
      if (capture) {
        s.shots.add(capture);
        s.shotStates[capture] = structuredClone(window.__heartStoryState());
        break;
      }
    }
    window.__heartStoryDraw();
    return { ...window.__heartStoryState(), capture };
  }, [frames, mode]);
  report.lastState = state;
  if (state.capture) await shot(state.capture);
  check(state.freezeBad.length === 0, 'Мир или таймеры врагов продвинулись во время Director');
  check(state.earlyActive.length === 0, 'Босс начал бой до конца сцены');
  check(state.clears === 0 && state.ends === 0 && state.screen === 'battle', 'Результаты или награда появились до победы над Сердцем');
  check(state.savedCurrencies.shards === 0 && state.savedCurrencies.ether === 0, 'Валюта за этап сохранена до победы над Сердцем');
  return state;
}

try {
  server = await preview({ preview: { port: 4194, strictPort: true }, logLevel: 'warn' });
  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    for (const key of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) {
      Object.defineProperty(window, key, { value: undefined, configurable: true });
    }
    let seed = 0x2545f491;
    Math.random = () => {
      seed |= 0; seed = seed + 0x6d2b79f5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    Date.now = () => 1767225600000;
  });
  await page.goto(`http://localhost:4194/?stage=1-4&wave=3&god&q=${encodeURIComponent(QUALITY)}`);
  await page.waitForFunction(() => !!window.__vb?.battle?.heart && !!window.__app, null, { timeout: 60000 });
  await page.evaluate(() => {
    const b = window.__vb.battle, w = b.world, soul = b.heartSoul, input = b.ctx.input;
    const s = window.__heartStory = {
      frames: 0, mx: 0, mz: 0, attackHeld: false, born: new Map(),
      route: [[7, 3], [7, -8], [0, -10], [0, -12], [0, -18]], waypoint: 0,
      freeze: null, freezeBad: [], freezeSamples: {}, earlyActive: [],
      starts: [], sceneEnds: [], sourceKills: [], escapes: [], absorptions: [], heartStarts: [],
      shots: new Set(), shotStates: {}, peak: { calls: 0, tris: 0 },
      initialHeartHp: b.heart.hp, ends: 0, finished: false,
    };
    const update = input.update.bind(input);
    input.update = now => {
      update(now);
      input.moveX = s.mx; input.moveZ = s.mz; input.attackHeld = s.attackHeld;
    };
    w.bus.on('kill', ({ target }) => {
      if (target.elite?.length && b.runner.waveIdx === b.stage.waves.length - 1) {
        s.sourceKills.push({ x: target.x, z: target.z, frame: s.frames, worldTime: w.time, kind: target.kind });
      }
    });
    w.bus.on('enemyAttack', () => {
      if (b.director.id === 'heartSoulEscape' || b.director.id === 'heartAwakening') s.earlyActive.push({ enemyAttack: true, scene: b.director.id });
    });
    const escape = soul.escape.bind(soul);
    soul.escape = (x, z) => {
      const ok = escape(x, z);
      s.escapes.push({ x, z, ok, frame: s.frames, position: { ...soul.position } });
      return ok;
    };
    const absorb = soul.absorb.bind(soul);
    soul.absorb = () => {
      if (soul.phase === 'arriving') s.absorptions.push({ time: b.director.time, scene: b.director.id, frame: s.frames });
      absorb();
    };
    const playScene = b.playScene.bind(b);
    b.playScene = (track, onEnd, opts) => {
      if (track.id.startsWith('heart')) s.starts.push({ id: track.id, frame: s.frames, hero: { x: w.hero.x, z: w.hero.z }, worldTime: w.time });
      return playScene(track, skipped => {
        if (track.id.startsWith('heart')) s.sceneEnds.push({ id: track.id, frame: s.frames, time: b.director.time, skipped, active: b.heart.active });
        onEnd?.(skipped);
      }, opts);
    };
    const start = b.heart.start.bind(b.heart);
    b.heart.start = () => {
      s.heartStarts.push({ frame: s.frames, director: b.director.id, time: b.director.time, awakened: soul.awakened });
      start();
      s.finished = true;
    };
    const end = b.onEnd;
    b.onEnd = outcome => { s.ends++; end?.(outcome); };
    b.ctx.renderer.gl.info.autoReset = false;
    window.__heartStoryDraw = () => {
      const r = b.ctx.renderer;
      r.gl.info.reset(); r.render(b.ctx.time.world);
      s.peak.calls = Math.max(s.peak.calls, r.gl.info.render.calls);
      s.peak.tris = Math.max(s.peak.tris, r.gl.info.render.triangles);
    };
    window.__heartStoryState = () => ({
      frames: s.frames, realTime: s.frames / 60, worldTime: w.time,
      hero: { x: w.hero.x, y: w.hero.y, z: w.hero.z, state: w.hero.state, locked: w.hero.locked },
      passage: b.heartPassage.phase, gateOpen: b.heartPassage.gateOpen,
      soul: { phase: soul.phase, visible: soul.visible, position: { ...soul.position }, awakened: soul.awakened },
      director: b.director.id, sceneTime: b.director.time, wave: b.runner.waveIdx,
      heart: { active: b.heart.active, hp: b.heart.hp, initialHp: s.initialHeartHp },
      framing: (() => {
        const c=b.ctx.renderer.camera, body=b.heart.body, h=w.hero;
        const project=(x,y,z)=>c.position.clone().set(x,y,z).project(c).toArray();
        return { heroFeet:project(h.x,h.y+.2,h.z), heroHead:project(h.x,h.y+1.9,h.z),
          core:project(body.x,body.y,body.z), crown:project(body.x,body.y+1.6,body.z) };
      })(),
      screen: window.__app.current, clears: b.ctx.save.stages['1-4']?.clears ?? 0, ends: s.ends,
      savedCurrencies: { ...b.ctx.save.currencies },
      freezeBad: s.freezeBad, freezeSamples: s.freezeSamples, earlyActive: s.earlyActive,
      starts: s.starts, sceneEnds: s.sceneEnds, sourceKills: s.sourceKills, escapes: s.escapes,
      absorptions: s.absorptions, heartStarts: s.heartStarts, escapeMid: s.escapeMid, beforeAbsorb: s.beforeAbsorb,
      waypoint: s.waypoint, peak: s.peak, finished: s.finished,
    });
  });

  let state;
  for (let batch = 0; batch < 100; batch++) {
    state = await advance(120, 'fight');
    if (state.sceneEnds.some(e => e.id === 'heartSoulEscape')) break;
  }
  check(state.sceneEnds.some(e => e.id === 'heartSoulEscape' && !e.skipped && e.time >= 2.35), 'Удержание атаки преждевременно пропустило побег');
  check(state.sourceKills.length === 1 && state.escapes.length === 1 && state.escapes[0].ok, 'Нет единственного источника души финальной элиты');
  const source = state.sourceKills[0], escaped = state.escapes[0];
  check(Math.hypot(source.x - escaped.x, source.z - escaped.z) < 1e-6, 'Душа возникла не у павшей элиты');
  check(state.escapeMid?.visible && state.escapeMid.phase === 'escaping' && state.escapeMid.position.y > 2, 'В середине побега душа не видна над источником');
  check(state.passage === 'released' && state.soul.phase === 'hidden' && !state.heart.active, 'Побег не оставил открытый путь и скрытую душу');
  check(state.heart.hp === state.heart.initialHp, 'Сердце потеряло HP до начала боя');
  await page.evaluate(() => { window.__heartStory.attackHeld = false; });
  const waitFrom = state.realTime;
  while (state.realTime - waitFrom < 20) state = await advance(120, 'idle');
  report.waitedInOldHall = { duration: state.realTime - waitFrom, hero: state.hero, soul: state.soul, heart: state.heart };
  check(state.soul.phase === 'hidden' && !state.soul.visible && state.soul.awakened === 0 && !state.heart.active, 'Душа прилетела в Сердце во время ожидания в старом зале');
  check(!state.starts.some(e => e.id === 'heartAwakening'), 'Пробуждение началось до прихода героя');

  for (let batch = 0; batch < 100 && !state.finished; batch++) state = await advance(120, 'walk');
  check(state.finished && state.heart.active, 'Герой не прошёл в новый зал или босс не запущен после сцены');
  check(state.starts.filter(e => e.id === 'heartAwakening').length === 1, 'Пробуждение запущено не ровно один раз');
  check(state.absorptions.length === 1 && state.absorptions[0].time >= 2.3 - 1e-8 && state.absorptions[0].scene === 'heartAwakening', 'Поглощение произошло до нужного маркера');
  check(state.beforeAbsorb?.phase === 'arriving' && state.beforeAbsorb.visible && state.beforeAbsorb.awakened === 0, 'Душа поглощена до 2.3 с');
  check(state.soul.phase === 'absorbed' && !state.soul.visible && state.soul.awakened === 1, 'Пробуждение не доведено до конечного состояния');
  check(state.heartStarts.length === 1 && state.heartStarts[0].director === null && state.heartStarts[0].awakened === 1, 'Босс начал атаки до завершения Director');
  check(state.heart.hp === state.heart.initialHp, 'HP Сердца изменился до игрового боя');
  check(state.freezeSamples.heartSoulEscape >= 100 && state.freezeSamples.heartAwakening >= 300, 'Полные сцены не прошли проверку остановки мира');
  check(state.peak.calls <= 160 && state.peak.tris <= 260000, 'Превышен мобильный бюджет рендера');
  check(report.errors.length === 0, 'В браузере появились ошибки');
  await shot('boss-ready');
  report.final = state;
  report.shotStates = await page.evaluate(() => window.__heartStory.shotStates);
  const awake=report.shotStates['awakened-4.6'];
  for(const point of Object.values(awake.framing))check(Math.abs(point[0])<.95&&Math.abs(point[1])<.8,'Общий план обрезает героя или венец Сердца');
  report.settled = await page.evaluate(() => {
    const b=window.__vb.battle;
    for(let i=0;i<100;i++){b.frame(1/60);b.ctx.hud.draw(1/60,b.hudFrame());}
    window.__heartStoryDraw();return window.__heartStoryState();
  });
  for(const point of Object.values(report.settled.framing))check(Math.abs(point[0])<.95&&Math.abs(point[1])<.85,'Боевая камера обрезает героя или венец Сердца');
  await shot('combat-frame');
  console.log(`✓ ${QUALITY} ${width}×${height}: элита → скрытая душа → 20 с ожидания → вход → пробуждение; ${state.peak.calls} calls / ${state.peak.tris} tris`);
} catch (error) {
  failed = true;
  report.error = String(error);
  if (page) {
    try { report.lastState = await page.evaluate(() => window.__heartStoryState?.()); } catch { /* состояние уже недоступно */ }
  }
  console.error(error);
} finally {
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await server?.close();
}
if (failed) process.exitCode = 1;
