/**
 * Стенд кадров «до/после» (план визуального апгрейда, фаза 0): одни и те же моменты каждого этапа и босса на
 * экранах телефона и ноутбука. Случайность засеяна, часы стоят, игровой цикл не идёт — мир шагает вручную по
 * 1/60 с, Пилот идёт к ближайшему врагу и бьёт его. У двух сборок с одной симуляцией кадры совпадают по моменту:
 * время мира каждого кадра пишется в manifest.json, лист сравнения показывает, если оно разошлось.
 *
 * Кадры этапа: intro — пролёт с титром, wave — начало первой волны, hit — удар клинка по врагу, finisher —
 * тяжёлый удар, threat — телеграф врага рядом с Пилотом. Босс: intro, p1, p2, p3 — бой в каждой фазе.
 *
 *   npm run build && npm run beauty [-- 1-1 boss1]   → beauty/<метка>/<экран>/<этап>-<кадр>.png
 *   npm run beauty -- --compare <до> <после>         → beauty/<до>-vs-<после>.html
 *
 * BEAUTY_LABEL — метка набора (по умолчанию короткий хеш коммита, с «-dirty» при правках); BEAUTY_DIST — папка
 * сборки (dist); BEAUTY_VIEWPORTS — экраны (844x390,1280x720); BEAUTY_Q — качество (high); BEAUTY_URL — добавка
 * к адресу игры, например «fx=off» (новые эффекты выключены) или «cam=tactical». Время кадра здесь не мерится:
 * SwiftShader — не телефон.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const ROOT = 'beauty';
const ALL = ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '1-9', 'boss1'];
const SHOTS = { stage: ['intro', 'wave', 'hit', 'finisher', 'threat'], boss: ['intro', 'p1', 'p2', 'p3'] };
const args = process.argv.slice(2);

if (args[0] === '--compare') {
  const [a, b] = args.slice(1);
  if (!a || !b) throw new Error('npm run beauty -- --compare <до> <после>');
  console.log(`лист сравнения: ${compare(a, b)}`);
  process.exit(0);
}

const stages = args.length ? args : ALL;
const VIEWPORTS = (process.env.BEAUTY_VIEWPORTS ?? '844x390,1280x720').split(',').map((s) => {
  const [width, height] = s.split('x').map(Number);
  if (!width || !height) throw new Error(`BEAUTY_VIEWPORTS: «${s}» — нужен формат 844x390`);
  return { width, height };
});
const Q = process.env.BEAUTY_Q ?? 'high';
const EXTRA = process.env.BEAUTY_URL ?? '';
const LABEL = process.env.BEAUTY_LABEL ?? gitLabel();
const PORT = Number(process.env.BEAUTY_PORT ?? 4177);
/** Сколько секунд мира враг живёт до снятия (у босса — с начала фазы) и предел этапа. */
const HOLD = 3.5, BOSS_HOLD = 6, LIMIT = { stage: 150, boss: 420 };

function gitLabel() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain -- src index.html', { encoding: 'utf8' }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch { return 'current'; }
}

/**
 * До загрузки страницы: засеянный Math.random, стоящие часы (fxRng сеется от Date.now при загрузке модуля),
 * задержанный requestAnimationFrame — игровой цикл не делает ни одного кадра сам, всё шагает стенд, — и без
 * Web Audio: синтез и музыка берут Math.random по своим таймерам, и последовательность врагов расходилась бы.
 * Перед первым шагом поток пересевается (__reseed): при загрузке three.js тратит Math.random на UUID каждого
 * материала и геометрии, и новый объект в сцене иначе сдвинул бы поток, из которого берут решения враги.
 */
const SEED = 0x2545f491;
const INIT = (SEED) => {
  for (const k of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) {
    try { Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch { /* нет — и ладно */ }
  }
  let a = SEED;
  window.__reseed = () => { a = SEED; };
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const T0 = 1767225600000;
  Date.now = () => T0;
  window.requestAnimationFrame = () => 0;
};

/** Шаги мира в странице: бот, снятие врагов, условия кадров. Возвращает id кадра, который пора снять. */
const STEP_PAGE = ([frames, HOLD, BOSS_HOLD]) => {
  const B = window.__beauty, bt = window.__vb.battle, w = bt.world, h = w.hero, R = bt.ctx.renderer, inp = bt.ctx.input;
  const want = (id) => B.shots.includes(id) && !B.done.has(id);
  for (let i = 0; i < frames && bt.outcome === 'playing'; i++) {
    h.hp = h.maxHp;
    // бот: к ближайшему врагу, рядом — серия ударов
    B.mx = 0; B.mz = 0;
    const free = !h.locked && !bt.cine.active && !bt.director.active;
    let near = null, nd = 1e9;
    for (const e of w.enemies) {
      if (!e.targetable) continue;
      const d = Math.hypot(e.x - h.x, e.z - h.z);
      if (d < nd) { nd = d; near = e; }
    }
    if (free && near) {
      if (nd > 1.9) { B.mx = (near.x - h.x) / nd; B.mz = (near.z - h.z) / nd; }
      else if (B.frame % 12 === 0) inp.buffer.push('attack', inp.now);
    }
    B.frame++;
    bt.frame(1 / 60);
    bt.ctx.hud.draw(1 / 60, bt.hudFrame());
    // снятие врагов: каждый живёт HOLD с мира (как в sweep); босс — BOSS_HOLD с начала боя в фазе
    const boss = bt.boss;
    if (boss && boss.phase !== B.phase && !bt.director.active) { B.phase = boss.phase; B.phaseAt = w.time; }
    for (const e of w.enemies) {
      if (e.dead) continue;
      if (!B.born.has(e)) B.born.set(e, w.time);
      const isBoss = !!boss && boss.hudBoss?.() === e;
      const due = isBoss ? B.phaseAt >= 0 && boss.phase === B.phase && !bt.director.active && w.time - B.phaseAt > BOSS_HOLD : w.time - B.born.get(e) > HOLD;
      // босс — до порога следующей фазы, а не до 1 HP: иначе вторая фаза проскакивает за секунду
      const mark = isBoss ? boss.phaseMarks?.[boss.phase - 1] : undefined;
      if (due) { e.hp = Math.min(e.hp, mark !== undefined ? e.maxHp * mark : 1); w.damageEnemy(e, { mult: 1, stun: 1e6, knockback: 0, feel: 'light', dirX: 0, dirZ: 1, source: 'blade' }); }
    }
    if (bt.boss?.executable && !bt.director.active) bt.boss.execute();
    // кадры
    const real = bt.ctx.time.real, fight = bt.runner.phase === 'wave' && free;
    if (bt.runner.waveIdx >= 0 && B.waveAt < 0) B.waveAt = w.time;
    let shot = null;
    if (want('intro') && real >= (bt.stage.boss ? 3.0 : 1.8)) shot = 'intro';
    else if (want('wave') && B.waveAt >= 0 && w.time - B.waveAt >= 1.2) shot = 'wave';
    else if (want('hit') && B.hitAt >= 0 && B.frame - B.hitAt === 2) shot = 'hit';
    else if (want('finisher') && B.heavyAt >= 0 && B.frame - B.heavyAt === 2) shot = 'finisher';
    else if (want('threat') && fight && w.telegraphs.some((t) => t.alive && t.t / t.dur > 0.45 && Math.hypot(t.shape.x - h.x, t.shape.z - h.z) < 7)) shot = 'threat';
    else if (boss && B.phaseAt >= 0 && free && w.time - B.phaseAt >= 3.5 && want(`p${boss.phase}`)) shot = `p${boss.phase}`;
    if (shot) {
      B.done.add(shot);
      R.render(bt.ctx.time.world);
      return { shot, t: w.time, real };
    }
    if (B.hitAt >= 0 && B.frame - B.hitAt > 2 && !B.done.has('hit')) B.hitAt = -1;
    if (B.heavyAt >= 0 && B.frame - B.heavyAt > 2 && !B.done.has('finisher')) B.heavyAt = -1;
  }
  return { shot: null, t: w.time, outcome: bt.outcome, left: B.shots.filter((s) => !B.done.has(s)) };
};

/** Подготовить бой к ручному шагу: бот на вводе, отметки ударов, музыка без долей (они идут по часам звука). */
const SETUP_PAGE = (shots) => {
  window.__reseed();
  const bt = window.__vb.battle, inp = bt.ctx.input;
  // и косметический поток (частицы, разлёт осколков): его тоже тратят конструкторы эффектов при загрузке
  let c = 0x9e3779b9 | 0;
  bt.world.fxRng.next = () => {
    c |= 0; c = (c + 0x6d2b79f5) | 0;
    let t = Math.imul(c ^ (c >>> 15), 1 | c);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const B = window.__beauty = { shots, done: new Set(), born: new Map(), frame: 0, mx: 0, mz: 0, waveAt: -1, hitAt: -1, heavyAt: -1, phase: -1, phaseAt: -1 };
  const up = inp.update.bind(inp);
  inp.update = (now) => { up(now); inp.moveX = B.mx; inp.moveZ = B.mz; };
  bt.ctx.music.onBeat = null;
  bt.world.bus.on('strike', (e) => {
    if (e.source !== 'blade' || (bt.runner.waveIdx < 0 && !bt.boss)) return;
    if (B.hitAt < 0 && !B.done.has('hit')) B.hitAt = B.frame;
    if ((e.feel === 'heavy' || e.feel === 'break') && B.heavyAt < 0 && !B.done.has('finisher')) B.heavyAt = B.frame;
  });
};

async function shoot() {
  const out = join(ROOT, LABEL);
  mkdirSync(out, { recursive: true });
  const manifestPath = join(out, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { label: LABEL, shots: {} };
  Object.assign(manifest, { label: LABEL, q: Q, url: EXTRA, date: new Date().toISOString() });
  // BEAUTY_DIST — другая сборка (например, копия dist до правок): «до» и «после» снимаются с одного дерева
  const server = await preview({ ...(process.env.BEAUTY_DIST ? { build: { outDir: process.env.BEAUTY_DIST } } : {}), preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
  let browser, failed = false;
  try {
    browser = await launchChromium();
    for (const vp of VIEWPORTS) {
      const key = `${vp.width}x${vp.height}`;
      mkdirSync(join(out, key), { recursive: true });
      manifest.shots[key] ??= {};
      for (const id of stages) {
        const boss = id.startsWith('boss');
        const page = await browser.newPage({ viewport: vp });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.addInitScript(INIT, SEED);
        await page.goto(`http://localhost:${PORT}/?q=${Q}&stage=${id}&god${EXTRA ? `&${EXTRA}` : ''}`);
        await page.waitForFunction(() => !!window.__vb?.battle, null, { timeout: 30000 });
        const shots = boss ? SHOTS.boss : SHOTS.stage;
        await page.evaluate(SETUP_PAGE, shots);
        const got = {};
        let r = { shot: null, outcome: 'playing' };
        while (true) {
          r = await page.evaluate(STEP_PAGE, [120, HOLD, BOSS_HOLD]);
          if (r.shot) {
            await page.screenshot({ path: join(out, key, `${id}-${r.shot}.png`) });
            got[r.shot] = { t: Number(r.t.toFixed(3)), real: Number(r.real.toFixed(3)) };
            continue;
          }
          if (r.outcome !== 'playing' || !r.left.length || r.t > (boss ? LIMIT.boss : LIMIT.stage)) break;
        }
        manifest.shots[key][id] = got;
        const missing = shots.filter((s) => !got[s]);
        if (errors.length) failed = true;
        console.log(`${errors.length ? '✗' : '✓'} ${key} ${id.padEnd(5)} ${Object.keys(got).join(', ') || '—'}${missing.length ? ` · нет: ${missing.join(', ')}` : ''}${errors.length ? ` · ошибки: ${errors.slice(0, 3).join(' | ')}` : ''}`);
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await new Promise((res) => server.httpServer.close(res));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  console.log(`кадры: ${out}/<экран>/<этап>-<кадр>.png`);
  return failed;
}

/** Лист сравнения двух наборов: по экрану и этапу — кадр «до» слева, «после» справа, время мира под каждым. */
function compare(a, b) {
  const read = (l) => {
    const p = join(ROOT, l, 'manifest.json');
    if (!existsSync(p)) throw new Error(`нет набора ${p} — сначала BEAUTY_LABEL=${l} npm run beauty`);
    return JSON.parse(readFileSync(p, 'utf8'));
  };
  const A = read(a), B = read(b);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cell = (set, label, vp, id, shot) => {
    const m = set.shots[vp]?.[id]?.[shot];
    if (!m) return `<div class="miss">${esc(label)}: нет кадра</div>`;
    return `<figure><img loading="lazy" src="${esc(`${label}/${vp}/${id}-${shot}.png`)}" alt="${esc(`${label} ${id} ${shot}`)}"><figcaption>${esc(label)} · мир ${m.t.toFixed(2)} с</figcaption></figure>`;
  };
  let body = '';
  for (const vp of [...new Set([...Object.keys(A.shots), ...Object.keys(B.shots)])]) {
    body += `<h2>${esc(vp)}</h2>`;
    for (const id of [...new Set([...Object.keys(A.shots[vp] ?? {}), ...Object.keys(B.shots[vp] ?? {})])]) {
      const shots = [...new Set([...Object.keys(A.shots[vp]?.[id] ?? {}), ...Object.keys(B.shots[vp]?.[id] ?? {})])];
      for (const s of shots) {
        const ta = A.shots[vp]?.[id]?.[s]?.t, tb = B.shots[vp]?.[id]?.[s]?.t;
        const drift = ta !== undefined && tb !== undefined && Math.abs(ta - tb) > 0.02 ? ' <span class="warn">момент разошёлся</span>' : '';
        body += `<section><h3>${esc(id)} · ${esc(s)}${drift}</h3><div class="pair">${cell(A, a, vp, id, s)}${cell(B, b, vp, id, s)}</div></section>`;
      }
    }
  }
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(a)} → ${esc(b)}</title><style>
:root { color-scheme: dark; --bg: #07090d; --panel: #10141b; --text: #d9d3c7; --dim: #8a8478; --gold: #e3c37e; --warn: #ff7a7a; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 18px; color: var(--gold); margin: 0 0 4px; } h2 { margin: 28px 0 8px; color: var(--gold); font-size: 16px; }
h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; } .warn { color: var(--warn); font-weight: 400; }
section { background: var(--panel); padding: 10px; border-radius: 8px; margin-bottom: 12px; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
figure { margin: 0; } img { width: 100%; height: auto; display: block; border-radius: 4px; }
figcaption, .miss, .meta { color: var(--dim); font-size: 12px; margin-top: 4px; }
</style></head><body><h1>${esc(a)} → ${esc(b)}</h1>
<div class="meta">«до»: ${esc(A.q ?? '')} ${esc(A.url ?? '')} · «после»: ${esc(B.q ?? '')} ${esc(B.url ?? '')}</div>${body}</body></html>`;
  const path = join(ROOT, `${a}-vs-${b}.html`);
  writeFileSync(path, html);
  return path;
}

process.exit(await shoot() ? 1 : 0);
