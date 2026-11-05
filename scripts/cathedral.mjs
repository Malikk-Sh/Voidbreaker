/** Непрерывный проход двух этапов обычным вводом; ускоренное снятие врагов проверяет состояния, не баланс. */
import { preview } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { launchChromium } from './browser.mjs';
import {driveHeart} from './heartBot.mjs';
const out=process.env.CATHEDRAL_OUT??'work/cathedral';mkdirSync(out,{recursive:true});
const qualities=(process.env.CATHEDRAL_Q??'medium,high').split(',');
const [width,height]=(process.env.CATHEDRAL_VIEW??'844x390').split('x').map(Number);
if(!Number.isFinite(width)||!Number.isFinite(height)||width<320||height<240)throw new Error('Invalid CATHEDRAL_VIEW');
const server=await preview({preview:{port:4189,strictPort:true},logLevel:'warn'}), browser=await launchChromium();
const report=[];let failed=false;
try{for(const q of qualities){
 const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript({content:`window.__driveHeart=${driveHeart.toString()}`});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;for(const k of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,k,{value:undefined,configurable:true});});
 await page.goto(`http://localhost:4189/?stage=1-3&god&q=${q}`);await page.waitForFunction(()=>!!window.__vb?.battle);
 await page.evaluate(()=>{
  const b=window.__vb.battle,inp=b.ctx.input,w=b.world;
  const s=window.__cat={frames:0,mx:0,mz:0,held:false,aim:false,ax:0,az:-1,born:new Map(),checkpoints:0,ends:0,rootError:0,positionJump:0,peak:{calls:0,tris:0},stages:new Set(),shots:new Set(),hints:[],collapseSample:null};
  const update=inp.update.bind(inp);inp.update=(now)=>{update(now);inp.moveX=s.mx;inp.moveZ=s.mz;inp.attackHeld=s.held;inp.aimActive=s.aim;inp.aimX=s.ax;inp.aimZ=s.az;};
  const checkpoint=b.onSectionEnd;b.onSectionEnd=o=>{s.checkpoints++;s.checkpointHero=[w.hero.x,w.hero.z];checkpoint?.(o);s.saved=!!b.ctx.save.stages['1-3']?.clears;};
  const hint=b.ctx.hud.showHint.bind(b.ctx.hud);b.ctx.hud.showHint=(text,font)=>{s.hints.push(text);hint(text,font);};
  const end=b.onEnd;b.onEnd=o=>{s.ends++;end?.(o);};
  s.world=w;s.hero=w.hero;s.camera=b.cam;b.ctx.renderer.gl.info.autoReset=false;
 });
 let state;
 for(let batch=0;batch<350;batch++){
  state=await page.evaluate(()=>{
   const b=window.__vb.battle,w=b.world,h=w.hero,s=window.__cat,inp=b.ctx.input;
   let shot=null;
   for(let i=0;i<120&&!s.ends;i++){
    const phase=b.journey.phase,free=!b.director.active&&!b.cine.active&&!h.locked;
    s.mx=s.mz=0;s.held=false;s.aim=false;h.hp=h.maxHp;
    if(free){
     if(b.heart?.active)window.__driveHeart(b,s);
     else if(b.heartPassage?.phase==='released'){
      const fore=-55,side=h.x<0?-7:7;let tx=0,tz=fore-18;
      if(h.z>fore-5&&Math.abs(h.x)<6){tx=side;tz=h.z;}
      else if(h.z>fore-8){tx=side;tz=fore-8;}
      else if(Math.abs(h.x)>.3){tx=0;tz=fore-10;}
      const dx=tx-h.x,dz=tz-h.z,d=Math.hypot(dx,dz)||1;s.mx=dx/d;s.mz=dz/d;
     }
     else if(phase==='bridge'||(phase==='gate'&&['approach','reveal'].includes(b.gatePath.phase)))s.mz=-1;
     else if(phase==='gate'&&b.gatePath.phase==='passage') {const dx=-h.x,dz=-30-h.z,d=Math.hypot(dx,dz)||1;s.mx=dx/d;s.mz=dz/d;}
     else {const e=w.enemies.filter(e=>e.targetable).sort((a,c)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(c.x-h.x,c.z-h.z))[0];if(e){const d=Math.hypot(e.x-h.x,e.z-h.z);if(d>2){s.mx=(e.x-h.x)/d;s.mz=(e.z-h.z)/d;}if(s.frames%14===0)inp.buffer.push('attack',inp.now);}}
    }
    const z=h.z,previousStage=b.stage.id;
    b.frame(1/60);s.frames++;b.ctx.hud.draw(1/60,b.hudFrame());s.stages.add(b.stage.id);
    if(previousStage!==b.stage.id){s.positionJump=Math.abs(h.z-z);s.continuous=s.world===w&&s.hero===h&&s.camera===b.cam&&!h.locked&&window.__app.current==='battle';}
    if(b.director.id==='gateEntrance'){const e=b.runner.guardian;if(e)s.rootError=Math.max(s.rootError,Math.abs(e.x-e.puppet.skel.x),Math.abs(e.z-e.puppet.skel.z));}
    if(!b.director.active&&!b.cine.active)for(const e of w.enemies){if(e.dead)continue;if(!s.born.has(e))s.born.set(e,w.time);if(w.time-s.born.get(e)>3.5){e.hp=Math.min(e.hp,1);w.damageEnemy(e,{mult:1,stun:b.heart?.active?0:1e6,knockback:0,feel:'light',dirX:0,dirZ:1,source:'blade'});}}
    if(s.frames%120===0){const r=b.ctx.renderer;r.gl.info.reset();r.render(b.ctx.time.world);s.peak.calls=Math.max(s.peak.calls,r.gl.info.render.calls);s.peak.tris=Math.max(s.peak.tris,r.gl.info.render.triangles);}
    if(b.director.id==='gateEntrance'&&b.director.time>2.6&&!s.shots.has('entrance'))shot='entrance';
    if(b.journey.phase==='bridge'&&h.z<-33&&!s.shots.has('bridge'))shot='bridge';
    if(b.journey.collapseTime>1.1&&b.journey.collapseTime<2.5&&!s.shots.has('collapse'))shot='collapse';
    if(b.journey.collapseTime>=2.5){s.collapseSample={gap:!b.arena.walkable(0,-36),safe:b.arena.walkable(0,-47),nav:!w.nav.reachable(0,-36,false)};}
    if(b.stage.id==='1-4'&&b.runner.waveIdx>=1&&!s.shots.has('hall'))shot='hall';
    if(b.director.id==='heartAwakening'&&b.director.time>2&&!s.shots.has('awakening'))shot='awakening';
    if(b.heart?.phase===3&&!s.shots.has('heart-phase-3'))shot='heart-phase-3';
    if(shot){s.shots.add(shot);break;}
   }
   b.ctx.renderer.render(b.ctx.time.world);
   return {shot,phase:b.journey.phase,stage:b.stage.id,wave:b.runner.waveIdx,z:h.z,ends:s.ends,checkpoints:s.checkpoints,saved:s.saved,continuous:s.continuous,positionJump:s.positionJump,rootError:s.rootError,peak:s.peak,stages:[...s.stages],screen:window.__app.current,clears:b.ctx.save.stages['1-4']?.clears,collapse:s.collapseSample,hints:s.hints,heartDead:b.heart?.dead,heartMetrics:{...b.heart?.metrics},bridgeStillGone:!b.arena.walkable(0,-36),bridgeFlamesMax:Math.max(0,...b.flames.points.map((p,i)=>Math.abs(p[0])<=3.4&&p[2]>=-43.5&&p[2]<-28.5?b.flames.mesh.geometry.getAttribute('iLit').getX(i):0))};
  });
  if(state.shot)await page.screenshot({path:`${out}/${q}-${state.shot}.png`,timeout:60000});
  if(state.ends)break;
 }
 const check=(ok,msg)=>{if(!ok)throw new Error(`${q}: ${msg}: ${JSON.stringify(state)}`);};
 check(state.ends===1&&state.heartDead&&state.stage==='1-4'&&state.screen==='results'&&state.clears===1,'полный проход и результат второго этапа');
 check(state.checkpoints===1&&state.saved&&state.continuous&&state.positionJump<0.3,'промежуточная награда и переход без замены мира/героя/камеры');
 check(state.collapse?.gap&&state.collapse?.safe&&state.collapse?.nav&&state.bridgeStillGone&&state.bridgeFlamesMax<0.001,'мост обрушился навсегда, навигация учитывает разрыв, герой на безопасном полу');
 check(!state.hints.some(h=>h.includes('Врата открыты. Пройди')),'удалённая подсказка не появляется');
 check(state.rootError<1e-5,'видимый скелет следует корню Стража');
 check(state.peak.calls<=160&&state.peak.tris<=260000,'мобильный бюджет');
 check(errors.length===0,'ошибки браузера');
 report.push({q,viewport:{width,height},...state,errors});console.log(`✓ ${q}: 1-3 → мост → 1-4; награды сохранены; ${state.peak.calls} calls / ${state.peak.tris} tris`);
 await page.close();
}}catch(e){failed=true;report.push({error:String(e)});console.error(e);}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();await server.close();}
if(failed)process.exitCode=1;
