import { preview } from 'vite';
import { launchChromium } from './browser.mjs';

const server = await preview({ preview: { host: '127.0.0.1', port: 4195, strictPort: true }, logLevel: 'warn' });
const browser = await launchChromium();
try {
  for (const style of ['attack', 'listen', 'delayed']) {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
      for (const key of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext'])
        Object.defineProperty(window, key, { value: undefined, configurable: true });
    });
    await page.goto('http://127.0.0.1:4195/?stage=boss1&q=low');
    await page.waitForFunction(() => !!window.__vb?.battle);
    const result = await page.evaluate((style) => {
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
      const phases = {},
        moves = new Set(),
        next = inp.update.bind(inp);
      w.bus.on('bellPulse', (e) => {
        if (e.big) bellHits++;
      });
      inp.update = (now) => {
        next(now);
        inp.moveX = mx;
        inp.moveZ = mz;
        inp.aimActive = false;
        inp.attackHeld = false;
      };
      const go = (x, z) => {
        const d = Math.hypot(x, z) || 1;
        mx = x / d;
        mz = z / d;
      };
      const free = (x, z) => w.arena.walkable(h.x + x * 2.8, h.z + z * 2.8);
      for (; frame < 60 * 330; frame++) {
        mx = mz = 0;
        const e = b.runner.boss;
        if (e && !b.director.active && !h.locked && !e.dead) {
          if (started < 0) started = frame;
          phases[e.phase] ??= Math.round((frame - started) / 60);
          const d = Math.hypot(e.x - h.x, e.z - h.z);
          let attack = false,
            dodge = false;
          if (e.motion === 'aim') moves.add(e.attack);
          if (e.inWindow && !wasOpen) exposures++;
          wasOpen = e.inWindow;
          if (style === 'attack') {
            if (d > 2.1) go(e.x - h.x, e.z - h.z);
            attack = d < 3;
          } else {
            let avoid = false;
            const reacted = style !== 'delayed' || e.motion !== 'aim' || e.elapsed >= 0.43;
            if (reacted && (e.motion === 'aim' || e.motion === 'active') && e.attack === 'rush') {
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
            if (!avoid) {
              if (e.inWindow || (e.motion === 'recover' && e.duration - e.elapsed > 0.43 && d < 3.8)) {
                if (d > 1.95) go(e.x - h.x, e.z - h.z);
                attack = d < 3.25;
              } else {
                const ready = e.bells
                  .filter((q) => q.cooldown <= 0)
                  .sort((a, c) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(c.x - h.x, c.z - h.z));
                const bell = ready[0];
                if (bell) {
                  const r = Math.hypot(bell.x - h.x, bell.z - h.z);
                  go(bell.x - h.x, bell.z - h.z);
                  attack = r < 2.45;
                } else if (d > 3.2) go(e.x - h.x, e.z - h.z);
                else attack = true;
              }
            }
          }
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
        style,
        outcome: b.outcome,
        win: !!b.runner.boss?.dead,
        dead: h.dead,
        seconds: Math.round((frame - started) / 60),
        hp: Math.round(h.hp),
        maxHp: h.maxHp,
        atk: h.stats.atk,
        bossHp: Math.round(b.runner.boss?.hp ?? 0),
        bellHits,
        exposures,
        phases,
        moves: [...moves],
        dodges: w.run.perfectDodges,
        hits: w.run.hitsTaken,
        damageScale: w.damageTakenMul,
        last: tag,
      };
    }, style);
    console.log(JSON.stringify(result));
    if (errors.length) throw Error(errors.join('\n'));
    if (
      style === 'attack'
        ? !result.dead
        : style === 'listen' &&
          (!result.win || result.outcome !== 'won' || result.exposures < 2 || result.damageScale !== 1)
    )
      process.exitCode = 1;
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
