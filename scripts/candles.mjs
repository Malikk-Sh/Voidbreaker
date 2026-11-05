/** Real Heart encounter: native input counters/returns/melee, physical phases, then App rewards. */
import {preview} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launchChromium} from './browser.mjs';
import {driveHeart} from './heartBot.mjs';
const out=process.env.CANDLES_OUT??'work/candles';mkdirSync(out,{recursive:true});
const qualities=(process.env.CANDLES_Q??'medium,high').split(',');
const [width,height]=(process.env.CANDLES_VIEW??'844x390').split('x').map(Number);
const server=await preview({preview:{port:4191,strictPort:true},logLevel:'warn'}),browser=await launchChromium();
const report=[];let failed=false;
try{for(const q of qualities){
 const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript({content:`window.__driveHeart=${driveHeart.toString()};window.requestAnimationFrame=()=>0;for(const k of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,k,{value:undefined,configurable:true});`});
 await page.goto(`http://localhost:4191/?stage=1-4&wave=4&god&q=${q}`);await page.waitForFunction(()=>!!window.__vb?.battle?.heart);
 await page.evaluate(()=>{
  const b=window.__vb.battle,inp=b.ctx.input;
  const s=window.__heartRun={frames:0,mx:0,mz:-1,held:false,aim:false,ax:0,az:-1,born:new Map(),shots:new Set(),phases:new Set(),ends:0,peak:{calls:0,tris:0},hints:[],maxDark:1};
  const update=inp.update.bind(inp);inp.update=now=>{update(now);inp.moveX=s.mx;inp.moveZ=s.mz;inp.attackHeld=s.held;inp.aimActive=s.aim;inp.aimX=s.ax;inp.aimZ=s.az;};
  const end=b.onEnd;b.onEnd=o=>{s.ends++;end?.(o);};
  const hint=b.ctx.hud.showHint.bind(b.ctx.hud);b.ctx.hud.showHint=(text,font)=>{s.hints.push(text);hint(text,font);};
  b.ctx.renderer.gl.info.autoReset=false;
 });
 let state;
 for(let batch=0;batch<220;batch++){
  state=await page.evaluate(()=>{
   const b=window.__vb.battle,w=b.world,h=w.hero,r=b.heart,s=window.__heartRun;let shot=null;
   for(let i=0;i<120&&!s.ends;i++){
    h.hp=h.maxHp;
    if(!r.active&&!r.dead){s.mx=0;s.mz=-1;s.held=false;s.aim=false;}
    else window.__driveHeart(b,s);
    b.frame(1/60);s.frames++;b.ctx.hud.draw(1/60,b.hudFrame());
    if(r.active){
     s.phases.add(r.phase);
     // Accelerated carrier deaths verify their fire interaction, not the difficulty of clearing adds.
     for(const e of r.carriers.values()){if(e.dead)continue;if(!s.born.has(e))s.born.set(e,w.time);if(w.time-s.born.get(e)>4){e.hp=1;w.damageEnemy(e,{mult:1,stun:0,knockback:0,feel:'light',dirX:0,dirZ:1,source:'blade'});}}
     // Гибель возвращает огонь волной от ядра: гашение проверяется только в живом бою.
     if(!r.lit.some(Boolean)&&!r.dying&&r.visibilityAt(0,r.centerZ+12)===0)s.maxDark=Math.max(...b.flames.mesh.geometry.getAttribute('iLit').array);
     if(r.phase===1&&r.attack&&!s.shots.has('phase-1'))shot='phase-1';
     if(r.shots.some(p=>p.reflected)&&!s.shots.has('reflection'))shot='reflection';
     if(r.metrics.counters>0&&!s.shots.has('counter'))shot='counter';
     if(r.phase===2&&!s.shots.has('phase-2'))shot='phase-2';
     if(r.phase===3&&!s.shots.has('phase-3'))shot='phase-3';
    }
    if(r.dead&&!s.shots.has('defeated'))shot='defeated';
    if(s.frames%120===0){const rr=b.ctx.renderer;rr.gl.info.reset();rr.render(b.ctx.time.world);s.peak.calls=Math.max(s.peak.calls,rr.gl.info.render.calls);s.peak.tris=Math.max(s.peak.tris,rr.gl.info.render.triangles);}
    if(shot){s.shots.add(shot);break;}
   }
   b.ctx.renderer.render(b.ctx.time.world);
   return {shot,ends:s.ends,active:r.active,dead:r.dead,hp:r.hp,metrics:{...r.metrics},phases:[...s.phases],maxDark:s.maxDark,peak:s.peak,screen:window.__app.current,clear:b.ctx.save.stages['1-4']?.clears,frames:s.frames,hero:[h.x,h.z],attack:r.attack?.kind,heat:[...r.heat],hints:s.hints};
  });
  if(state.shot)await page.screenshot({path:`${out}/${q}-${state.shot}.png`,timeout:60000});
  if(state.ends)break;
 }
 const check=(ok,msg)=>{if(!ok)throw new Error(`${q}: ${msg}: ${JSON.stringify(state)}`);};
 check(state.dead&&state.hp===0&&state.ends===1&&state.screen==='results'&&state.clear===1,'настоящая победа над Сердцем и награда');
 check(state.metrics.counters>0&&state.metrics.reflectedHits>0&&state.metrics.bodyHits>0&&state.metrics.spawnedTotal>=2,'контратака, возврат снаряда, удары по телу и носильщики');
 check(state.phases.length===3,'три физические фазы');
 check(state.maxDark<.001,'всё свечное пламя гаснет');
 check(state.peak.calls<=160&&state.peak.tris<=260000,'бюджет рендера');check(errors.length===0,'ошибки браузера');
 report.push({q,viewport:{width,height},...state,errors});console.log(`✓ ${q}: Heart defeated by native inputs: ${JSON.stringify(state.metrics)}, ${state.peak.calls}/${state.peak.tris}`);await page.close();
}}catch(e){failed=true;report.push({error:String(e)});console.error(e);}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();await server.close();}
if(failed)process.exitCode=1;
