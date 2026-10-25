/** Настоящие игровые добивания: контакты, порядок действий, кадрирование и пропуск. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';
const out = process.env.FINISHERS_OUT ?? 'work/finishers'; mkdirSync(out, { recursive: true });
const sizes = [{ width: 844, height: 390 }, { width: 740, height: 360 }, { width: 1280, height: 720 }].filter(s => !process.env.FINISHERS_VIEWPORT || process.env.FINISHERS_VIEWPORT === `${s.width}x${s.height}`);
const ids = process.env.FINISHERS_SCENES?.split(',') ?? ['hierophantEnd', 'killGate', 'killBell'];
if (ids.some(id => !['hierophantEnd', 'killGate', 'killBell'].includes(id))) throw new Error('Unknown FINISHERS_SCENES');
const modes = process.env.FINISHERS_MODES?.split(',') ?? ['full', 'skip'];
const report = []; let failed = false;
const check = (ok, message) => { console.log(`${ok ? '✓' : '✗'} ${message}`); if (!ok) failed = true; };
const server = await preview({ preview: { port: 4187, strictPort: true }, logLevel: 'warn' });
const browser = await launchChromium();
try {
for (const viewport of sizes) for (const id of ids) for (const mode of modes) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 1000, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [], stem = `${viewport.width}x${viewport.height}-${id}-${mode}`;
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const result = { stem, errors, shots: [] }; report.push(result);
  try {
    await page.goto('http://localhost:4187/?q=medium'); await page.waitForFunction(() => !!window.__app);
    await page.evaluate(id => {
      const a = window.__app; a.game.running = false; a.ctx.settings.shake = 0; a.ctx.save.currencies.shards = 1234; a.ctx.save.flags.finisherFixture = true; a.save();
      const stable = () => { const s = structuredClone(a.ctx.save); delete s.cine; delete s.updatedAt; return JSON.stringify(s); };
      window.__finisher = { stable, before: stable() }; a.watchScene(id);
    }, id);
    await page.waitForFunction(() => !!window.__vb?.battle);
    await page.evaluate(({ id, mode }) => {
      const diag = window.__finisher, b = diag.battle = window.__vb.battle, h = b.world.hero;
      diag.calls = []; diag.kills = []; diag.minScale = 1; diag.minY = 0; diag.flight = []; diag.strokeScales = []; diag.cameras = [];
      b.ctx.hud.canvas.style.visibility = 'hidden'; b.world.bus.on('kill', e => diag.kills.push({ kind: e.kind, time: b.director.time, y: h.y }));
      diag.capture = (name = '') => {
        const e = b.runner.boss ?? b.replay?.target, cam = b.ctx.renderer.camera, v = cam.position.clone();
        const project = p => { const q = p.clone().project(cam); return { x: (q.x + 1)/2, y: (1-q.y)/2, depth: q.z }; };
        cam.updateMatrixWorld(true);
        const tip = h.avatar.sceneAnchor('bladeTip', v.clone()), edge = h.avatar.sceneAnchor('edgeContact', v.clone()), head = h.avatar.sceneAnchor('head', v.clone());
        const hands = ['handL', 'handR'].map(n => h.avatar.sceneAnchor(n, v.clone()));
        const heroRig = h.avatar.puppet, palm = heroRig.skel.jointPoint(heroRig.layout.idx('handL'), 0, -0.07, 0.03, v.clone());
        const lowerGrip = v.clone().set(0, 0.09, 0).applyMatrix4(h.avatar.weaponMatrix(cam.matrix.clone()));
        const feet = ['footL', 'footR'].map(n => h.avatar.sceneAnchor(n, v.clone()));
        let target;
        if (e?.bellPos) target = e.bellPos(v.clone());
        else if (e) {
          const s = e.kind === 'gateGuardian' ? 1.65 : 1.45, sk = e.puppet.skel;
          if (name === 'knee') target = sk.jointPoint(e.puppet.layout.idx('kneeL'), 0, 0.25*s, 0.08*s, v.clone());
          else if (e.kind === 'gateGuardian') target = sk.jointPoint(e.puppet.layout.idx('head'), 0, 0.18*s, 0.18*s, v.clone());
          else { target = v.clone(); e.bellPoint(target); }
        }
        const jointRotation = joint => { if(!e?.puppet.layout.has(joint)) return null; const i=e.puppet.layout.idx(joint); return Array.from(e.puppet.skel.rot.slice(i*4,i*4+4)); };
        const dx = cam.position.x - h.x, dz = cam.position.z - h.z;
        return { time: b.director.time, heroY: h.y, clip: h.avatar.puppet.anim.clip?.id, scale: b.ctx.time.worldScale, front: (dx*Math.sin(h.facing)+dz*Math.cos(h.facing))/(Math.hypot(dx,dz)||1), error: target ? (name === 'knee' ? tip : edge).distanceTo(target) : null, target: target?.toArray(), bellRotation: jointRotation('bell'), chestRotation: jointRotation('chest'), gripError: palm.distanceTo(lowerGrip), camera: cam.position.toArray(), screenHands: hands.map(project), screenEdge: project(edge), screenHead: project(head), screenFeet: feet.map(project), screenTip: project(tip), screenHilt: project(h.avatar.sceneAnchor('hilt', v.clone())), screenTarget: target ? project(target) : null, feetY: feet.map(p => p.y) };
      };
      const wrap = (name, fn) => (...args) => { diag.calls.push({ name, ...diag.capture(name) }); const value=fn(...args); if(name==='crumble') b.world.bus.emit('stageClear',{}); return value; };
      const set = b.sceneCalls.set;
      b.sceneCalls.set = function(name, fn) { return set.call(this, name, wrap(name,fn)); };
      for (const [name, fn] of b.sceneCalls) set.call(b.sceneCalls, name, wrap(name, fn));
      diag.step = () => {
        b.frame(1/60);
        if (b.director.id === id) {
          diag.started = true; diag.minScale = Math.min(diag.minScale, b.ctx.time.worldScale); diag.minY = Math.min(diag.minY, h.y);
          if(b.cine.busy)diag.cameras.push(b.cine.busy);
          const strike=b.director.track.steps.find(s=>s.do==='clip'&&s.who==='hero'&&['strike','helmet','bell'].includes(s.markers?.contact));
          if(strike&&b.director.time>strike.t+0.6&&b.director.time<strike.t+0.7)diag.strokeScales.push(b.ctx.time.worldScale);
          if (h.avatar.puppet.anim.clip?.id === 'executionLand') diag.flight.push(diag.capture());
        }
      };
      for (let i = 0; i < 300 && b.director.id !== id; i++) diag.step();
      if (mode === 'skip') { for (let i=0;i<15;i++) diag.step(); b.director.skip(); }
    }, { id, mode });
    const plan = await page.evaluate(() => {
      const b = window.__finisher.battle, t = b.director.track;
      const steps = (b.director.short ? t?.short : t?.steps) ?? [];
      return steps.flatMap(s => {
        if (s.do === 'clip') return (s.definition?.events ?? (s.who==='hero' ? b.world.hero.avatar.puppet.clips.get(s.clip)?.events : []) ?? []).filter(e => s.markers?.[e.name]).map(e => {
          const name=s.markers[e.name];
          return { name, time: s.t + e.t/(s.speed ?? 1) + (['cut','crumble'].includes(name) ? 0.15 : 0) };
        });
        if (s.do === 'call' && ['cut','crumble'].includes(s.fn)) return [{ name: s.fn, time: s.t + 0.15 }];
        return [];
      });
    });
    if(mode==='full'&&!plan.some(p=>p.name===(id==='hierophantEnd'?'cut':'crumble'))) throw new Error('Не найден маркер разрушения босса');
    const points = mode === 'full' ? [{ name: 'wide', time: 0.3 }, ...plan.flatMap(p => ['strike','helmet','bell'].includes(p.name) ? [{ name:'windup',time:p.time-0.28 }, { name:'before-contact',time:p.time-0.12 }, p, {name:'after-contact',time:p.time+0.12}] : [p])] : [];
    const landingTime = await page.evaluate(() => window.__finisher.battle.director.track?.steps.find(s=>s.do==='clip'&&s.clip==='executionLand')?.t);
    if (landingTime !== undefined) points.push({ name:'landing',time:landingTime+1.05 });
    points.sort((a,b)=>a.time-b.time);
    for (const point of points) {
      await page.evaluate(t => { const d=window.__finisher; for(let i=0;i<900&&d.battle.director.active&&d.battle.director.time<t-1e-7;i++)d.step(); d.battle.ctx.renderer.render(d.battle.ctx.time.world); },point.time);
      const state=await page.evaluate(()=>window.__finisher.capture()); state.name=point.name; result.shots.push(state);
      await page.screenshot({path:`${out}/${stem}-${point.name}.png`});
    }
    await page.evaluate(() => { const d=window.__finisher; for(let i=0;i<900&&d.battle.director.active;i++)d.step(); });
    result.final=await page.evaluate(()=>{const d=window.__finisher;return {calls:d.calls,kills:d.kills,minScale:d.minScale,minY:d.minY,flight:d.flight,strokeScales:d.strokeScales,cameras:d.cameras,active:d.battle.director.active,scripted:d.battle.world.hero.scripted};});
    const f=result.final, contacts=f.calls.filter(c=>['knee','helmet','bell','strike'].includes(c.name));
    check(!f.active&&!f.scripted,`${stem}: сцена завершена, управление возвращено`);
    check(f.kills.filter(k=>k.kind===(id==='hierophantEnd'?'hierophant':id==='killGate'?'gateGuardian':'bellRinger')).length===1,`${stem}: одна смерть`);
    if(mode==='full') {
      check(contacts.length===(id==='killGate'?2:1)&&contacts.every(c=>typeof c.error==='number'&&Number.isFinite(c.error)&&c.error<0.01),`${stem}: настоящие контакты клинка (${contacts.map(c=>`${c.name} ${c.error?.toFixed(4)}м`).join(', ')})`);
      const inside=p=>p&&p.depth>-1&&p.depth<1&&p.x>0.02&&p.x<0.98&&p.y>0.12&&p.y<0.88;
      const hits=result.shots.filter(s=>['strike','helmet','bell'].includes(s.name));
      check(hits.length===1&&hits.every(s=>[s.screenHead,...s.screenHands,s.screenTip,s.screenHilt,s.screenEdge,s.screenTarget].every(inside)),`${stem}: голова, обе кисти, клинок и цель видны на контакте`);
      const windup=result.shots.find(s=>s.name==='windup');
      check(windup&&windup.front>0.05&&[windup.screenHead,...windup.screenHands,windup.screenTip,windup.screenHilt].every(inside),`${stem}: замах целиком виден спереди`);
      const strikeFrames=result.shots.filter(s=>['windup','before-contact','strike','helmet','bell','after-contact'].includes(s.name));
      check(strikeFrames.length===4&&strikeFrames.every(s=>s.gripError<0.005),`${stem}: левая ладонь удерживает рукоять весь удар (≤5мм)`);
      const steady=result.shots.filter(s=>['before-contact','strike','helmet','bell','after-contact'].includes(s.name));
      check(steady.length===3&&steady.every(s=>Math.hypot(...s.camera.map((v,i)=>v-steady[0].camera[i]))<0.025),`${stem}: камера удерживает удар без наезда`);
      check(f.strokeScales.length>0&&Math.min(...f.strokeScales)>0.95,`${stem}: быстрый разрез идёт без slow motion`);
      check(!f.cameras.includes('victory'),`${stem}: обычный облёт победы не перебивает добивание`);
      check(f.minScale<=0.25,`${stem}: slow motion включается у контакта`);
      if(id==='hierophantEnd')check(f.kills.find(k=>k.kind==='hierophant').y>0.3,`${stem}: взрыв происходит до приземления`);
      else check(f.calls.find(c=>c.name==='crumble').time-contacts.at(-1).time>1.2,`${stem}: результат удара виден до распада`);
      if(id==='killBell') {
        const contact=contacts.find(c=>c.name==='bell'), ring=f.calls.find(c=>c.name==='bellRing');
        const angle=(a,b)=>[a,b].every(q=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite))?2*Math.acos(Math.min(1,Math.abs(a.reduce((sum,v,i)=>sum+v*b[i],0)))):NaN;
        const bellAngle=angle(contact?.bellRotation,ring?.bellRotation), bodyAngle=angle(contact?.chestRotation,ring?.chestRotation);
        const validTarget=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
        const bellTravel=validTarget(contact?.target)&&validTarget(ring?.target)?Math.hypot(...ring.target.map((v,i)=>v-contact.target[i])):null;
        check(ring&&ring.time-contact.time>=0.08&&ring.time-contact.time<=0.11,`${stem}: звон следует за контактом с задержкой90мс`);
        check(typeof bellTravel==='number'&&Number.isFinite(bellTravel)&&bellTravel>0.10&&bellAngle>0.08&&bellAngle>bodyAngle*2,`${stem}: колокол сначала отклоняется независимо от корпуса (${bellAngle.toFixed(2)}/${bodyAngle.toFixed(2)}рад)`);
      }
      const knee=result.shots.find(s=>s.name==='knee');
      if(knee)check(Math.abs(knee.heroY)<0.02&&Math.min(...knee.feetY)>-0.02&&Math.min(...knee.feetY)<0.12,`${stem}: стопа остаётся на полу при подсечке`);
      const landing=result.shots.find(s=>s.name==='landing');
      check(landing&&Math.abs(landing.heroY)<0.02&&[landing.screenHead,...landing.screenFeet].every(inside),`${stem}: приземление целиком в кадре`);
    }
    // Выход пересмотра исполняется микрозадачей; сцена не может менять прогресс.
    for(let n=0;n<4;n++)await page.evaluate(()=>{const d=window.__finisher;for(let i=0;i<60&&window.__vb?.battle===d.battle;i++)d.step();});
    check(await page.evaluate(()=>window.__finisher.before===window.__finisher.stable()),`${stem}: прогресс сохранён`);
    check(errors.length===0,`${stem}: без ошибок браузера`);
  } catch(e) { result.error=String(e);check(false,`${stem}: ${e}`); }
  finally { await context.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)); }
}
} finally { await browser.close(); await server.close(); }
if(failed)process.exitCode=1;
