import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const target = process.env.DEVOURER_URL;
const server = target ? null : await preview({ preview: { host: '127.0.0.1', port: 4195, strictPort: true }, logLevel: 'warn' });
const cases = [
  { name: 'three-notes', style: 'conductor', build: 'finalist', delay: 0.27 },
  { name: 'frontal', style: 'attack', build: 'veteran', delay: 0 },
  { name: 'one-bell', style: 'camp', build: 'veteran', delay: 0.25 },
  { name: 'old-bells', style: 'legacy', build: 'veteran', delay: 0 },
  { name: 'finalist', style: 'adaptive', build: 'finalist', delay: 0.32 },
  { name: 'late-reader', style: 'adaptive', build: 'finalist', delay: 0.46 },
  { name: 'veteran', style: 'adaptive', build: 'veteran', delay: 0.23 },
  { name: 'string-cutter', style: 'cutter', build: 'finalist', delay: 0.32 },
  { name: 'duelist', style: 'duelist', build: 'veteran', delay: 0.24 },
  { name: 'base-sword', style: 'adaptive', build: 'starter', delay: 0.18 },
];
const report = [];
const browser = await launchChromium();
try {
  for (const run of cases.filter(c => !process.env.DEVOURER_CASE || c.name === process.env.DEVOURER_CASE)) {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
      for (const key of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext'])
        Object.defineProperty(window, key, { value: undefined, configurable: true });
    });
    await page.goto(new URL('/?stage=boss1&q=low', target || 'http://127.0.0.1:4195').href);
    await page.waitForFunction(() => !!window.__vb?.battle, undefined, { polling: 70 });
    if (run.build !== 'starter') await page.evaluate(build => {
      const g = window.__vb.game, s = g.ctx.save;
      const veteran = build === 'veteran';
      Object.assign(s.stats, veteran ? { power: 7, agility: 6, fortitude: 5, resonance: 4 } : { power: 4, agility: 3, fortitude: 3, resonance: 2 });
      s.weapons.void_blade.level = veteran ? 5 : 3;
      Object.assign(s.abilities, { crescent: { level: 2 }, well: { level: veteran ? 2 : 1 }, eclipse: { level: 1 } });
      Object.assign(s.loadout, { q: 'crescent', e: 'well', r: 'eclipse' });
      g.startStageById('boss1');
    }, run.build);
    const result = await page.evaluate(({name, style, delay}) => {
      const adaptive = ['adaptive', 'duelist', 'conductor', 'cutter'].includes(style);
      const playsBells = adaptive && style !== 'duelist' && style !== 'cutter';
      const b = window.__vb.battle,
        w = b.world,
        h = w.hero,
        inp = b.ctx.input;
      let mx = 0,
        mz = 0,
        frame = 0,
        exposures = 0,
        wasOpen = false,
        tag = '',
        bellHits = 0,
        dodgeAt = -1,
        started = -1;
      const signatureMoves = new Set(['fault', 'caveIn', 'inhale']);
      const openings = {}, hurt = {}, casts = {}, severed = new Set();
      const bellStuns = [];
      const bellOpenings = new Set(['bell', 'downbeat', 'chord']);
      const isBellStun = e => e?.inWindow && bellOpenings.has(e.opening);
      let aimX = 0, aimZ = 0, aim = false;
      const phases = {},
        moves = new Set(),
        impacts = new Set(),
        next = inp.update.bind(inp);
      w.bus.on('bellPulse', (e) => {
        if (!e.big) return;
        bellHits++;
        const boss = b.runner.boss;
        const bell = boss.bells.findIndex(q => Math.hypot(q.x-e.x, q.z-e.z) < 0.15);
        bellStuns.push({ frame, bell, attack: boss.attack, motion: boss.motion, damage: 0 });
      });
      w.bus.on('bellResonance', event => {
        const boss = b.runner.boss;
        const last = bellStuns.at(-1);
        if (!last || last.frame !== frame || last.bell !== event.bell) throw Error('Bell strike and resonance disagree');
        last.opening = event.kind;
        last.phase = boss.phase;
        last.notes = event.notes;
        last.immediate = boss.inWindow && boss.opening === event.kind;
        last.range = Number(Math.hypot(event.tx - event.x, event.tz - event.z).toFixed(1));
        // A chord's own damage can trigger the next phase before the next input frame.
        exposures++;
        openings[event.kind] = (openings[event.kind] || 0) + 1;
      });
      w.bus.on('hit', event => {
        const boss = b.runner.boss;
        if (event.target === boss && isBellStun(boss) && bellStuns.length)
          bellStuns.at(-1).damage += event.dmg;
      });
      w.bus.on('playerHurt', ({dmg}) => { const key = b.runner.boss?.attack; hurt[key] = (hurt[key] || 0) + dmg; });
      const countCast = ({id}) => { casts[id] = (casts[id] || 0) + 1; };
      w.bus.on('ability', countCast);
      w.bus.on('ultimate', countCast);
      inp.update = (now) => {
        next(now);
        inp.moveX = mx;
        inp.moveZ = mz;
        inp.aimActive = aim;
        inp.aimX = aimX;
        inp.aimZ = aimZ;
        inp.attackHeld = false;
      };
      const go = (x, z) => {
        const d = Math.hypot(x, z) || 1;
        mx = x / d;
        mz = z / d;
      };
      const free = (x, z) => w.arena.walkable(h.x + x * 2.8, h.z + z * 2.8);
      const steerTo = (x, z) => {
        go(x - h.x, z - h.z);
        aimX = mx; aimZ = mz; aim = true;
      };
      const clearance = (s, x, z) => {
        const dx = x - s.x, dz = z - s.z, dist = Math.hypot(dx, dz);
        const delta = a => Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - a), Math.cos(Math.atan2(dx, dz) - a)));
        if (s.k === 'circle') return dist - s.r - h.radius;
        if (s.k === 'ring') {
          const angular = Math.max(-Infinity, ...(s.gaps ?? []).map(g => (g.w / 2 - delta(g.a)) * dist));
          return Math.max(s.r0 - dist, dist - s.r1, angular) - h.radius;
        }
        if (s.k === 'arc') return Math.max(dist - s.r, (delta(s.dir) - s.half) * dist) - h.radius;
        const along = dx * s.dx + dz * s.dz;
        return Math.max(-along, along - s.len, Math.abs(dx * s.dz - dz * s.dx) - s.w / 2) - h.radius;
      };
      for (; frame < 60 * 330; frame++) {
        aim = false;
        mx = mz = 0;
        const e = b.runner.boss;
        if (e && !b.director.active && !h.locked && !e.dead) {
          if (started < 0) started = frame;
          phases[e.phase] ??= Math.round((frame - started) / 60);
          const d = Math.hypot(e.x - h.x, e.z - h.z);
          let attack = false,
            dodge = false;
          if (e.motion === 'aim' || e.motion === 'active') moves.add(e.attack);
          if (e.patterns.kind && e.patterns.marks.some(m => m.struck)) impacts.add(e.patterns.kind);
          if (e.strings.lines.some(l => l.flight !== null)) impacts.add('strings');
          if (e.opening === 'sever') severed.add(e.phase);
          if (e.inWindow && !wasOpen && !isBellStun(e)) {
            exposures++;
            openings[e.opening] = (openings[e.opening] || 0) + 1;
          }
          wasOpen = e.inWindow;
          if (style === 'attack') {
            if (d > 2.1) go(e.x - h.x, e.z - h.z);
            attack = d < 3;
          } else {
            let avoid = false;
            const reacted = e.motion !== 'aim' || e.elapsed >= delay;
            if (reacted && (e.motion === 'aim' || e.motion === 'active') && (e.attack === 'rush' || (adaptive && e.attack === 'snap'))) {
              const sx = Math.sin(e.facing),
                sz = Math.cos(e.facing),
                dx = h.x - e.x,
                dz = h.z - e.z;
              const side = dx * sz - dz * sx,
                along = dx * sx + dz * sz;
              if (Math.abs(side) < 2.0 && along > -1.5 && along < Math.hypot(e.targetX - e.x, e.targetZ - e.z) + 1.7) {
                let sign = side < 0 ? -1 : 1;
                if (!free(sz * sign, -sx * sign)) sign = -sign;
                go(sz * sign, -sx * sign);
                avoid = true;
                dodge = e.motion === 'active' || e.elapsed / e.duration > 0.73;
              }
            } else if (reacted && e.motion === 'aim' && e.attack === 'rake' && d < 5) {
              go(h.x - e.x, h.z - e.z);
              if (!free(mx, mz)) go(-mz, mx);
              avoid = true;
              dodge = e.elapsed / e.duration > 0.5;
            } else if (
              reacted &&
              (e.motion === 'aim' || e.motion === 'active') &&
              e.attack === 'pounce' &&
              Math.hypot(h.x - e.targetX, h.z - e.targetZ) < 3.5
            ) {
              const ax = h.x - e.targetX,
                az = h.z - e.targetZ;
              if (Math.hypot(ax, az) < 0.5) go(h.x > 0 ? -1 : 1, 0);
              else go(ax, az);
              if (!free(mx, mz)) go(-mz, mx);
              avoid = true;
              dodge = e.motion === 'active';
            } else if (e.motion === 'aim' && e.attack === 'howl' && d < 3.3) {
              go(h.x - e.x, h.z - e.z);
              avoid = true;
            }
            for (const ring of w.ringWaves) {
              const rx = ring.x - h.x,
                rz = ring.z - h.z,
                rd = Math.hypot(rx, rz);
              if (rd - ring.r > 0 && rd - ring.r < 1.22 && !ring.hit) {
                go(rx, rz);
                avoid = true;
                dodge = true;
              }
            }
            if (adaptive && reacted && e.attack === 'sweep' && (e.motion === 'aim' || e.motion === 'active') && d < 7.1) {
              if (d < 5.2) {
                const fx = Math.sin(e.facing), fz = Math.cos(e.facing);
                const side = (h.x-e.x) * fz - (h.z-e.z) * fx >= 0 ? 1 : -1;
                const tx = e.x + fz * side * 1.95 - fx * 0.65, tz = e.z - fx * side * 1.95 - fz * 0.65;
                if (Math.hypot(tx-h.x,tz-h.z) > 0.48) steerTo(tx,tz);
                else { mx = mz = 0; attack = true; }
              } else go(h.x - e.x, h.z - e.z);
              avoid = true;
              dodge = d >= 2.8 && e.motion === 'aim' && e.duration - e.elapsed < 0.15;
            }
            if (adaptive && reacted && e.motion === 'aim' && e.attack === 'listen') {
              mx = mz = 0; dodge = attack = false; avoid = true;
            }
            if (playsBells && reacted && e.motion === 'aim' && e.attack === 'crosscall') {
              const ringing = e.bells.find((q, i) => e.echoes.isCalling(i) && Math.hypot(q.x-h.x,q.z-h.z) < 4.6);
              if (ringing) {
                steerTo(ringing.x, ringing.z); attack = Math.hypot(ringing.x-h.x,ringing.z-h.z) < 2.8;
                dodge = false; avoid = true;
              }
            }
            if (adaptive && !attack) {
              const signals = w.telegraphs.filter(t => t.alive && (t.echo || signatureMoves.has(e.attack)) &&
                t.t >= delay && t.t < t.dur);
              const threatened = signals.some(t => clearance(t.shape, h.x, h.z) < 0.42);
              if (threatened) {
                let best = -Infinity;
                for (let j = 0; j < 16; j++) {
                  const x = Math.sin(j * Math.PI / 8), z = Math.cos(j * Math.PI / 8);
                  if (!free(x,z)) continue;
                  const margin = Math.min(...signals.map(t => clearance(t.shape, h.x + x * 2.8, h.z + z * 2.8)));
                  const score = Math.min(1.7, margin) + 0.08 * (x * mx + z * mz);
                  if (score > best) { best = score; go(x,z); }
                }
                avoid = true; dodge = signals.some(t => t.dur - t.t < 0.16 && clearance(t.shape, h.x, h.z) < 0.15);
              }
            }
            if (!avoid) {
              if (e.inWindow || (e.motion === 'recover' && e.duration - e.elapsed > 0.43 && d < 3.8)) {
                if (d > 1.95) go(e.x - h.x, e.z - h.z);
                attack = d < 3.25;
                if (playsBells && isBellStun(e) && d > 5.2 && e.duration - e.elapsed > 0.4) dodge = true;
              } else {
                const ready = e.bells
                  .filter((q, i) => adaptive ? playsBells && e.bellReady(i) : q.cooldown <= 0)
                  .sort((a, c) => {
                    if (adaptive) {
                      const usedA = Number(!!(e.chordMask & (1 << e.bells.indexOf(a))));
                      const usedC = Number(!!(e.chordMask & (1 << e.bells.indexOf(c))));
                      if (usedA !== usedC) return usedA - usedC;
                    }
                    return Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(c.x - h.x, c.z - h.z);
                  });
                const bell = style === 'camp' ? e.bells[0] : ready[0];
                if (bell) {
                  const r = Math.hypot(bell.x - h.x, bell.z - h.z);
                  if (adaptive) steerTo(bell.x, bell.z);
                  else go(bell.x - h.x, bell.z - h.z);
                  attack = r < 2.45;
                } else if (d > 3.2) go(e.x - h.x, e.z - h.z);
                else attack = true;
              }
            }
          }
          if (playsBells && e.motion === 'aim' && e.elapsed >= delay && !e.inWindow) {
            const nearby = e.bells.find((q, i) => e.bellReady(i) && Math.hypot(q.x-h.x,q.z-h.z) < 2.45);
            if (nearby && e.duration-e.elapsed > 0.10) {
              steerTo(nearby.x, nearby.z);
              attack = true;
              dodge = false;
            }
          }
          // A first-time relay player follows the unlit notes while the boss is down.
          if (style === 'conductor' && !openings.chord && e.chordMask && e.chordLeft > 0 && e.inWindow) {
            const next = e.bells.filter((q,i) => !(e.chordMask & (1 << i)))
              .sort((a,c) => Math.hypot(h.x-a.x,h.z-a.z) - Math.hypot(h.x-c.x,h.z-c.z))[0];
            if (next) {
              const distance = Math.hypot(h.x-next.x,h.z-next.z);
              if (distance > 1.9) steerTo(next.x,next.z); else mx = mz = 0;
              dodge = distance > 6.5 && h.dashCharges >= 2;
              attack = false;
            }
          }
          // Leave room for a full sword arc. The melee-only pilot must not ring a bell by accident.
          if (style === 'duelist' && e.bells.some((q, i) => e.bellReady(i) && Math.hypot(h.x - q.x, h.z - q.z) < 5.1)) {
            attack = false;
            if (!dodge && (e.motion === 'hunt' || e.motion === 'recover')) go(-h.x, -h.z);
          }
          const readsStrings = style === 'cutter' || style === 'duelist' || name === 'base-sword';
          const knot = readsStrings && e.strings.lines.find(l => e.strings.available(l) && e.elapsed - l.show >= delay &&
            (style !== 'duelist' || !e.bells.some(q => Math.hypot(q.x - l.knot.x, q.z - l.knot.z) < 3.75)));
          // The cutter baits both plucks before committing to an attack chain or a spell.
          // Keep using normal movement and dodges while waiting for the next mark.
          if (style === 'cutter' && !severed.has(e.phase)) {
            attack = false;
            if (e.motion === 'hunt' || e.motion === 'recover' || (e.strings.active && !knot)) {
              if (d < 4.8) go(h.x - e.x, h.z - e.z);
              else if (d > 6.5) go(e.x - h.x, e.z - h.z);
              else mx = mz = 0;
              if (!free(mx, mz)) go(-h.x, -h.z);
            }
          }
          if (knot) {
            steerTo(knot.knot.x, knot.knot.z);
            const range = Math.hypot(knot.knot.x - h.x, knot.knot.z - h.z);
            if (range < 1.3) mx = mz = 0;
            attack = range < 2.6;
            dodge = false;
          }
          if (attack && !knot && frame % 70 === 0) inp.buffer.push('q', inp.now);
          if (attack && !knot && frame % 100 === 0) inp.buffer.push('e', inp.now);
          if (attack && !knot && h.resonance >= 100 && frame % 5 === 0) inp.buffer.push('r', inp.now);
          if (attack && frame % 10 === 0) inp.buffer.push('attack', inp.now);
          if (dodge && frame > dodgeAt + 23 && h.dashCharges >= 1) {
            inp.buffer.push('dash', inp.now, mx, mz);
            dodgeAt = frame;
          }
          tag = e.motion;
        }
        b.frame(1 / 60);
        if (h.dead || e?.dead) break;
      }
      if (b.runner.boss?.dead) for (let n = 0; n < 330 && b.outcome !== 'won'; n++) b.frame(1 / 60);
      return {
        name, style, openings, hurt, casts,
        outcome: b.outcome,
        win: !!b.runner.boss?.dead,
        dead: h.dead,
        seconds: Math.round((frame - started) / 60),
        hp: Math.round(h.hp),
        maxHp: h.maxHp,
        atk: h.stats.atk,
        bossHp: Math.round(b.runner.boss?.hp ?? 0),
        bellHits,
        stuns: bellStuns.filter(x => x.opening),
        exposures,
        phases,
        moves: [...moves], severed: [...severed],
        impacts: [...impacts],
        dodges: w.run.perfectDodges,
        hits: w.run.hitsTaken,
        damageScale: w.damageTakenMul,
        last: tag,
      };
    }, run);
    report.push(result);
    console.log(JSON.stringify(result));
    if (errors.length) throw Error(errors.join('\n'));
    if (result.damageScale !== 1 || (result.win && result.outcome !== 'won')) process.exitCode = 1;
    if (run.name === 'frontal' && !result.dead) process.exitCode = 1;
    if (run.name === 'one-bell' && result.win && result.hp > result.maxHp * 0.65) process.exitCode = 1;
    if (run.name === 'string-cutter' && (!result.win || result.severed.length !== 3)) process.exitCode = 1;
    if (run.name === 'duelist' && result.bellHits) process.exitCode = 1;
    if (['veteran', 'finalist', 'duelist', 'base-sword'].includes(run.name) &&
      (!result.win || !result.phases[3] || Object.keys(result.openings).length < 2)) process.exitCode = 1;
    if (['adaptive', 'conductor'].includes(run.style) && result.win && !result.stuns.some(x => x.damage > 0)) process.exitCode = 1;
    if (result.stuns.some(x => !x.immediate)) process.exitCode = 1;
    if (run.name === 'three-notes' && !result.stuns.some(x => x.opening === 'chord' && x.notes === 3)) process.exitCode = 1;
    await page.close();
  }
  if (!process.env.DEVOURER_CASE) {
    for (const id of ['fault', 'caveIn', 'inhale', 'strings']) {
      if (!report.some(run => run.impacts.includes(id))) {
        console.error('Signature never reached its impact in the balance suite:', id);
        process.exitCode = 1;
      }
    }
  }
} finally {
  await browser.close();
  await server?.close();
}
