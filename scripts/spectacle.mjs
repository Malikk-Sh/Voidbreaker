/**
 * P0 постановки: точные кадры клиповых маркеров, контакт, пропуск и изоляция пересмотра.
 * Сцена шагает по 1/60 с; это проверка геометрии/состояний, а не замер FPS и не просмотр обычной скорости.
 * npm run build && npm run spectacle [-- execution extraction]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const VIEWPORTS = [{ width: 844, height: 390 }, { width: 740, height: 360 }, { width: 1280, height: 720 }]
  .filter((v) => !process.env.SPECTACLE_VIEWPORT || process.env.SPECTACLE_VIEWPORT === `${v.width}x${v.height}`);
const SCENES = {
  execution: { id: 'hierophantEnd', markers: ['contact'] },
  extraction: { id: 'prologueLanding', markers: ['grip', 'releaseFromGround', 'weaponAwake'] },
};
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
if (!VIEWPORTS.length || scenes.some((s) => !SCENES[s])) throw new Error('Use execution/extraction and SPECTACLE_VIEWPORT=844x390,740x360,1280x720.');
const Q = process.env.SPECTACLE_Q ?? 'medium';
const EFFECTS = process.env.SPECTACLE_EFFECTS ?? 'normal';
if (!['normal', 'reduced', 'off'].includes(EFFECTS)) throw new Error('SPECTACLE_EFFECTS must be normal, reduced or off.');
const TEXT = process.env.SPECTACLE_TEXT === '1';
const MODES = process.env.SPECTACLE_MODES?.split(',') ?? ['full', 'short', 'skip-early', 'skip-late'];
if (MODES.some((m) => !['full', 'short', 'skip-early', 'skip-late'].includes(m))) throw new Error('Use SPECTACLE_MODES=full,short,skip-early,skip-late.');
const OUT = join(process.env.SPECTACLE_OUT ?? 'spectacle', `${Q}-${EFFECTS}-${TEXT ? 'text' : 'no-text'}`);
const PORT = Number(process.env.SPECTACLE_PORT ?? 4176);
mkdirSync(OUT, { recursive: true });
const results = [];
let failed = false;
const check = (ok, message) => {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failed = true;
};

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
let browser;

/** Сохранение сравнивается и в памяти, и на диске; только счётчик пересмотров и дата могут меняться. */
const saveSnapshot = (page) => page.evaluate(() => {
  const stable = (s) => { const copy = structuredClone(s); delete copy.cine; delete copy.updatedAt; return JSON.stringify(copy); };
  const raw = localStorage.getItem('voidbreaker.save.v1');
  return { memory: stable(window.__app.ctx.save), stored: raw ? stable(JSON.parse(JSON.parse(raw).data)) : null };
});

async function prepare(page, scene, mode) {
  await page.goto(`http://localhost:${PORT}/?q=${Q}&screen=hub`);
  await page.waitForFunction(() => window.__app?.current === 'hub', null, { timeout: 30000 });
  await page.evaluate(({ reduced, off }) => {
    const a = window.__app, g = a.game;
    g.running = false;
    // Ненулевой прогресс позволяет заметить случайную перезапись сохранения копией пересмотра.
    a.ctx.save.currencies.shards = 1234;
    a.ctx.save.currencies.ether = 7;
    a.ctx.save.flags.spectacleFixture = true;
    a.ctx.settings.shake = 0;
    if (reduced) { a.ctx.settings.flashes = false; a.ctx.settings.photosensitive = true; }
    if (off) a.ctx.settings.distortion = false;
    a.save();
  }, { reduced: EFFECTS !== 'normal', off: EFFECTS === 'off' });
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('voidbreaker.save.v1');
    return raw && JSON.parse(JSON.parse(raw).data).flags.spectacleFixture;
  }, null, { timeout: 10000 });
  const before = await saveSnapshot(page);
  if (scene === 'execution') await page.evaluate(() => window.__app.watchScene('hierophantEnd'));
  else await page.evaluate(() => window.__app.startStage('1-1', { prologue: true }));
  await page.waitForFunction(() => !!window.__vb?.battle, null, { timeout: 30000 });
  await page.evaluate(({ text, effects, mode }) => {
    const bt = window.__vb.battle;
    const diag = window.__spectacle = { battle: bt, landing: bt.landing, calls: [], kills: [], bossVictories: [], samples: [], flight: [], effects };
    bt.ctx.hud.canvas.style.visibility = text ? 'visible' : 'hidden';
    diag.hideEffects = () => { if (effects === 'off') {
      // Диагностическое отключение добавочных VFX: цепь, тело и ряса остаются видимыми.
      const v = bt.vfx;
      for (const m of [v.add.mesh, v.norm.mesh, v.trail.mesh, v.trail.smearMesh, v.rings.group, v.sprites.mesh, v.slashes.group]) m.visible = false;
      bt.ctx.renderer.post.state.flash = 0;
      bt.ctx.renderer.post.bloomEnabled = false;
    } };
    diag.hideEffects();
    bt.world.bus.on('kill', (e) => diag.kills.push({ kind: e.kind, time: bt.director.time }));
    bt.world.bus.on('bossVictory', e => diag.bossVictories.push({time:bt.director.time,...e}));
    diag.capture = () => {
      const h = bt.world.hero, cam = bt.ctx.renderer.camera, a = cam.position.clone(), b = a.clone();
      // Между диагностическими кадрами render не вызывается; проекции должны видеть текущую камеру.
      cam.updateMatrixWorld(true);
      h.bladePoints(a, b);
      h.avatar.sceneAnchor('hilt', a);
      h.avatar.sceneAnchor('bladeTip', b);
      const project = (p) => { const v = p.clone().project(cam); return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, depth: v.z }; };
      const boss = bt.runner.boss;
      const mask = boss?.bellPos ? boss.bellPos(cam.position.clone()) : null;
      const targetScale = mask ? (() => { const lo=mask.clone(), hi=mask.clone(); lo.y-=0.5; hi.y+=0.5; return Math.hypot(project(hi).x-project(lo).x,project(hi).y-project(lo).y); })() : null;
      const dx=cam.position.x-h.x,dz=cam.position.z-h.z,front=(dx*Math.sin(h.facing)+dz*Math.cos(h.facing))/(Math.hypot(dx,dz)||1);
      const tip = b.clone();
      h.avatar.sceneAnchor('edgeContact', tip);
      const hands = ['handL', 'handR'].map(n => h.avatar.sceneAnchor(n, cam.position.clone()));
      const rig = h.avatar.puppet, palm = rig.skel.jointPoint(rig.layout.idx('handL'), 0, -0.07, 0.03, cam.position.clone());
      const lowerGrip = cam.position.clone().set(0, 0.09, 0).applyMatrix4(h.avatar.weaponMatrix(cam.matrix.clone()));
      const head = h.avatar.sceneAnchor('head', cam.position.clone());
      const footL = h.avatar.sceneAnchor('footL', cam.position.clone()), footR = h.avatar.sceneAnchor('footR', cam.position.clone());
      const matrices = h.avatar.puppet.skel.world, bones = h.avatar.batch.bones;
      let batchGap = 0;
      for (let i = 0; i < matrices.length; i++) batchGap = Math.max(batchGap, Math.abs(matrices[i] - bones[i]));
      const landing = bt.landing ?? diag.landing;
      let weaponGap = null;
      if (landing?.shard && h.avatar.weaponMatrix) {
        const weapon = cam.matrix.clone();
        h.avatar.weaponMatrix(weapon);
        const prop = landing.shard.matrix.elements, rig = weapon.elements;
        weaponGap = Math.hypot(prop[12] - rig[12], prop[13] - rig[13], prop[14] - rig[14]);
      }
      return {
        time: bt.director.time, worldTime: bt.world.time, clip: h.avatar.puppet.anim.clip?.id ?? null,
        clipTime: h.avatar.puppet.anim.t, hero: { x: h.x, y: h.y, z: h.z, scripted: h.scripted },
        blade: { visible: h.avatar.bladeVisible, scale: h.avatar.bladeScale, base: a.toArray(), tip: b.toArray(), screenBase: project(a), screenTip: project(b) },
        targetScale, front, mask: mask?.toArray(), screenMask: mask ? project(mask) : null,
        screenHead: project(head), screenHands: hands.map(project), camera: cam.position.toArray(), gripError: palm.distanceTo(lowerGrip), screenEdge: project(tip), screenFeet: [project(footL), project(footR)], batchGap,
        contactDistance: mask && tip ? tip.distanceTo(mask) : null,
        landing: landing ? { shardVisible: landing.shard?.visible, igniteT: landing.igniteT, phase: landing.attachment?.phase, released: landing.attachment?.released, weaponGap } : null,
        executionStage: boss?.executionStage,
      };
    };
    const wrap = (name, fn) => {
      if (fn.__spectacleWrapped) return fn;
      const wrapped = (...args) => {
        diag.calls.push({ name, ...diag.capture() });
        return fn(...args);
      };
      wrapped.__spectacleWrapped = true;
      return wrapped;
    };
    const originalSet = bt.sceneCalls.set;
    bt.sceneCalls.set = function(name, fn) { return originalSet.call(this, name, wrap(name, fn)); };
    for (const [name, fn] of bt.sceneCalls) bt.sceneCalls.set(name, fn);
    diag.waitFrames = 0;
    diag.step = () => {
      // хват — действие игрока: сцена ждёт; «игрок» касается экрана через 0.8 с ожидания
      if (bt.director.waiting && ++diag.waitFrames === 48) { diag.tappedAt = bt.director.time; bt.ctx.input.buffer.push('attack', bt.ctx.input.now); }
      if (!bt.director.waiting) diag.waitFrames = 0;
      bt.frame(1 / 60);
      bt.ctx.hud.draw(1 / 60, bt.hudFrame());
      diag.hideEffects();
      const anim = bt.world.hero.avatar.puppet.anim;
      if (anim.clip?.id === 'executionLand') {
        diag.flightStart ??= bt.director.time - anim.t;
        if (anim.t >= 0.55 && bt.director.time - diag.flightStart <= anim.clip.dur + 1e-7) {
          const s = diag.capture();
          diag.flight.push({ time: s.time, head: s.screenHead, feet: s.screenFeet });
        }
      }
    };
    if (mode === 'short') {
      bt.director.full = false;
      bt.ctx.save.cine.hierophantEnd = 2;
    }
  }, { text: TEXT, effects: EFFECTS, mode });
  return before;
}

/** Части по 1 с оставляют браузеру возможность выполнить микрозадачу выхода из пересмотра. */
async function advance(page, id, time, { finish = false } = {}) {
  for (let chunk = 0; chunk < 50; chunk++) {
    const state = await page.evaluate(({ id, time, finish }) => {
      const diag = window.__spectacle, bt = diag.battle;
      for (let i = 0; i < 60; i++) {
        if (window.__vb?.battle !== bt) return { done: true, screen: window.__app.current };
        const d = bt.director;
        if (!finish && d.id === id && d.time + 1e-7 >= time) return { done: true, screen: window.__app.current };
        if (finish && !d.active && diag.started) return { done: true, screen: window.__app.current };
        diag.step();
        if (d.id === id) diag.started = true;
      }
      return { done: false, id: bt.director.id, time: bt.director.time, screen: window.__app.current };
    }, { id, time, finish });
    if (state.done) return state;
  }
  throw new Error(`Scene ${id} did not reach ${finish ? 'its end' : time} within 50 simulated seconds.`);
}

async function markerPlan(page, scene) {
  const plan = await page.evaluate((wanted) => {
    const bt = window.__vb.battle, d = bt.director;
    const steps = (d.short ? d.track?.short : d.track?.steps) ?? [];
    const markers = [], calls = steps.filter(s => s.do === 'call').map(s => ({ name: s.fn, time: s.t }));
    for (const s of steps) {
      if (s.do !== 'clip') continue;
      const events = s.definition?.events ?? (s.who === 'hero' ? bt.world.hero.avatar.puppet.clips.get(s.clip)?.events : []) ?? [];
      for (const e of events) {
        const callback = s.markers?.[e.name], time = s.t + e.t / (s.speed ?? 1);
        if (!callback) continue;
        calls.push({ name: callback, time });
        if (s.who === 'hero' && wanted.includes(e.name)) markers.push({ name: e.name, clip: s.clip, time, callback });
      }
    }
    const strike=steps.find(s=>s.do==='clip'&&s.who==='hero'&&s.markers?.contact==='strike');
    const jump=steps.find(s=>s.do==='actor'&&s.who==='hero'&&s.velocityFrom&&s.t<(strike?.t??0));
    return { id: d.id, duration: d.dur, short: d.short, jump:jump?.t, markers,
      clips: steps.filter((s) => s.do === 'clip').map((s) => ({ clip: s.clip, time: s.t })),
      calls };
  }, SCENES[scene].markers);
  for (const name of SCENES[scene].markers) if (!plan.markers.some((m) => m.name === name)) throw new Error(`${scene}: missing clip marker ${name}.`);
  return plan;
}

async function shot(page, stem, name) {
  const sample = await page.evaluate(() => {
    const diag = window.__spectacle, bt = diag.battle;
    if (diag.effects === 'off') bt.ctx.renderer.post.state.flash = 0;
    bt.ctx.renderer.render(bt.ctx.time.world);
    const value = diag.capture();
    diag.samples.push(value);
    return value;
  });
  const file = `${stem}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  return { file, ...sample };
}

async function runCase(viewport, scene, mode) {
  const stem = `${viewport.width}x${viewport.height}-${scene}-${mode}`;
  const context = await browser.newContext({ viewport, reducedMotion: EFFECTS === 'normal' ? 'no-preference' : 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const result = { case: stem, errors, shots: [] };
  results.push(result);
  try {
    const before = await prepare(page, scene, mode);
    await advance(page, SCENES[scene].id, 0);
    const plan = result.plan = await markerPlan(page, scene);
    if (mode === 'full' || mode === 'short') {
      const times = scene === 'execution'
        ? [{ name: 'windup', time: plan.markers[0].time - 0.28 }, { name: 'before-contact', time: plan.markers[0].time - 0.12 }, { name: 'contact', time: plan.markers[0].time }, { name: 'after-contact', time: plan.markers[0].time + 0.16 }]
        : plan.markers.map((m) => ({ name: m.name, time: m.time }));
      if (scene === 'execution') {
        const exit = plan.clips.find((s) => s.clip === 'executionLand');
        if (exit) times.push({ name: 'push-off', time: exit.time + 0.2 }, { name: 'descent', time: exit.time + 0.6 }, { name: 'landing', time: exit.time + 1.05 });
        const victory=plan.clips.find(s=>s.clip==='victory');
        if(plan.jump===undefined||!victory)throw new Error('execution: missing jump/victory plan');
        times.push({name:'jump',time:plan.jump+0.16},{name:'victory',time:victory.time+0.8},{name:'victory-end',time:plan.duration-0.15});
      }
      if (scene === 'extraction') {
        // кадр ожидания: клинок, место хвата и подсказка до действия игрока
        const pull = plan.clips.find((s) => s.clip === 'extractBlade');
        await advance(page, plan.id, pull.time - 0.01);
        const waited = await page.evaluate(() => { const diag = window.__spectacle, bt = diag.battle; for (let i = 0; i < 30; i++) diag.step(); return { waiting: bt.director.waiting, grips: diag.calls.filter((c) => c.name === 'grip').length }; });
        result.shots.push(await shot(page, stem, 'prompt'));
        check(waited.waiting && waited.grips === 0, `${stem}: сцена ждёт действия у клинка, хвата до касания нет`);
      }
      if (scene === 'execution' && mode === 'full') {
        times.push({ name: 'establishing', time: 0.5 });
        for (const [call, name, offset] of [['fracture', 'mask-fragments', 0.15], ['cut', 'body-cut', 0.3], ['beam', 'star', 1.7], ['calm', 'calm', 0.3]]) {
          const step = plan.calls.find((s) => s.name === call);
          if (!step) throw new Error(`execution: missing scene callback ${call}`);
          times.push({ name, time: step.time + offset });
        }
      }
      times.sort((a, b) => a.time - b.time);
      for (const point of times) {
        await advance(page, plan.id, point.time);
        result.shots.push(await shot(page, stem, point.name));
      }
      const inside = (p) => p && p.depth > -1 && p.depth < 1 && p.x > 0.02 && p.x < 0.98 && p.y > 0.12 && p.y < 0.88;
      const key = result.shots.find((s) => s.file === `${stem}-${scene === 'execution' ? 'contact' : 'weaponAwake'}.png`);
      check(key && (scene==='execution' ? [...key.screenHands,key.blade.screenBase,key.screenEdge,key.screenMask] : [key.screenHead,key.blade.screenBase,key.blade.screenTip]).every(inside), `${stem}: рукоять, рабочая кромка и цель внутри кадра с леттербоксом`);
      if (scene === 'execution') {
        const attack = result.shots.filter(s => /-(windup|before-contact|contact|after-contact)\.png$/.test(s.file));
        const windup=attack.find(s=>s.file.endsWith('-windup.png'));
        const impact=attack.filter(s=>!s.file.endsWith('-windup.png'));
        const jump=result.shots.find(s=>s.file.endsWith('-jump.png'));
        check(windup&&windup.front>0.05&&[windup.screenHead,...windup.screenHands,windup.blade.screenBase,windup.blade.screenTip].every(inside), `${stem}: подготовка показывает весь двуручный замах спереди`);
        check(jump&&[jump.screenHead,...jump.screenFeet,jump.screenMask].every(inside), `${stem}: начальный прыжок показан общим планом целиком`);
        check(jump&&typeof jump.targetScale==='number'&&jump.targetScale>0&&impact.length===3&&impact.every(s=>typeof s.targetScale==='number'&&s.targetScale>=jump.targetScale*1.25&&[...s.screenHands,s.blade.screenBase,s.screenMask,...(/-before-contact\.png$/.test(s.file)?[]:[s.screenEdge])].every(inside)), `${stem}: удар и реакция показаны крупнее на боссе`);
        check(attack.length === 4 && attack.every(s => s.gripError < 0.005), `${stem}: две руки держат рукоять весь удар (≤5мм)`);
        check(windup&&impact.length===3&&Math.hypot(...impact[0].camera.map((v,i)=>v-windup.camera[i]))>0.5,`${stem}: перед ударом есть отдельная склейка на босса`);
        check(impact.length === 3 && impact.every(s => Math.hypot(...s.camera.map((v,i) => v - impact[0].camera[i])) < 0.025), `${stem}: камера удерживает крупный план контакта без наезда`);
        const victory=result.shots.filter(s=>/-(victory|victory-end)\.png$/.test(s.file));
        check(victory.length===2&&victory.every(s=>s.clip==='victory'&&[s.screenHead,...s.screenFeet,s.blade.screenBase,s.blade.screenTip].every(inside)),`${stem}: победная поза и клинок целиком видны на спокойном пролёте`);
      }
      const establishing = result.shots.find((s) => s.file.endsWith('-establishing.png'));
      if (establishing) check([establishing.screenHead, establishing.screenMask, ...establishing.screenFeet].every(inside), `${stem}: общий план показывает героя целиком, маску и дистанцию прыжка`);
      const landing = result.shots.find((s) => s.file.endsWith('-landing.png'));
      if (landing) check([landing.screenHead, ...landing.screenFeet].every(inside), `${stem}: приземление показывает героя от шлема до стоп`);
      check(result.shots.every((s) => s.batchGap < 1e-6), `${stem}: батч рисует позу текущего кадра`);
    } else {
      const skipAt = mode === 'skip-early' ? 0.2 : plan.markers.at(-1).time + 0.1;
      await advance(page, plan.id, skipAt);
      await page.evaluate(() => { const diag = window.__spectacle; diag.battle.director.skip(); diag.step(); });
    }
    await advance(page, plan.id, 0, { finish: true });
    result.final = await page.evaluate(() => {
      const diag = window.__spectacle;
      return { ...diag.capture(), calls: diag.calls, kills: diag.kills, bossVictories:diag.bossVictories, flight: diag.flight, active: diag.battle.director.active, outcome: diag.battle.outcome };
    });
    check(!result.final.active && !result.final.hero.scripted, `${stem}: сцена завершена, управление возвращено`);
    if (scene === 'execution') {
      if (mode === 'full' || mode === 'short') {
        const inside = (p) => p.depth > -1 && p.depth < 1 && p.x > 0.02 && p.x < 0.98 && p.y > 0.12 && p.y < 0.88;
        check(result.final.flight.length > 0 && result.final.flight.every((s) => [s.head, ...s.feet].every(inside)), `${stem}: раскрытие к посадке показывает героя целиком (${result.final.flight.length} кадров)`);
      }
      const strikes = result.final.calls.filter((c) => c.name === 'strike');
      const kills = result.final.kills.filter((k) => k.kind === 'hierophant');
      check(strikes.length === 1 && kills.length === 1, `${stem}: один контакт и одна смерть (${strikes.length}/${kills.length})`);
      check(result.final.bossVictories.length===1,`${stem}: один акцент победной позы`);
      if (mode !== 'skip-early') check(typeof strikes[0]?.contactDistance === 'number' && Number.isFinite(strikes[0].contactDistance) && strikes[0].contactDistance <= 0.01, `${stem}: режущая часть клинка у маски (${strikes[0]?.contactDistance?.toFixed(4)} м)`);
      // Досмотреть хвост пересмотра и реальный возврат в Святилище.
      for (let n = 0; n < 15 && await page.evaluate(() => window.__app.current !== 'hub'); n++) {
        await page.evaluate(() => { for (let i = 0; i < 60 && window.__vb?.battle === window.__spectacle.battle; i++) window.__spectacle.step(); });
      }
      await page.waitForFunction(() => window.__app.current === 'hub', null, { timeout: 15000 });
      const after = await saveSnapshot(page);
      if (before.memory !== after.memory || before.stored !== after.stored) result.saves = { before, after };
      check(before.memory === after.memory && before.stored === after.stored, `${stem}: пересмотр сохраняет прогресс и награды`);
    } else {
      check(result.final.blade.visible === true && Math.abs(result.final.blade.scale - 1) < 0.01, `${stem}: клинок видим в полном размере`);
      check(result.final.landing?.shardVisible === false && result.final.landing?.phase === 'awake' && result.final.landing?.released === true, `${stem}: опора отпущена, заготовка передана единственному клинку`);
      if (mode === 'full') {
        const grip = result.final.calls.find((c) => c.name === plan.markers.find((m) => m.name === 'grip')?.callback);
        check(grip?.landing?.weaponGap !== null && grip?.landing?.weaponGap <= 0.02, `${stem}: хват без скачка (${grip?.landing?.weaponGap?.toFixed(4)} м)`);
      }
      result.shots.push(await shot(page, stem, 'finished'));
    }
    check(errors.length === 0, `${stem}: без ошибок консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } catch (error) {
    result.error = String(error);
    check(false, `${stem}: ${error}`);
    try { await page.screenshot({ path: join(OUT, `${stem}-failure.png`) }); } catch { /* Страница могла закрыться при сбое браузера. */ }
  } finally {
    await context.close();
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ quality: Q, effects: EFFECTS, text: TEXT, results }, null, 2));
  }
}

try {
  browser = await launchChromium();
  for (const viewport of VIEWPORTS) for (const scene of scenes) for (const mode of MODES) {
    if (scene === 'extraction' && mode === 'short') continue;
    await runCase(viewport, scene, mode);
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
console.log(`Кадры и диагностический отчёт: ${OUT}/`);
process.exitCode = failed ? 1 : 0;
