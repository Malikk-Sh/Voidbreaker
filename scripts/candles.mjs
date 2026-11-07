/** Real Heart encounter: native input counters/returns/melee, physical phases, then App rewards. */
import {preview} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launchChromium} from './browser.mjs';
import {driveHeart} from './heartBot.mjs';
const out=process.env.CANDLES_OUT??'work/candles';mkdirSync(out,{recursive:true});
const qualities=(process.env.CANDLES_Q??'medium,high').split(',');
const [width,height]=(process.env.CANDLES_VIEW??'844x390').split('x').map(Number);
// Бой шагает фиксированным dt, но Math.random (таймеры врагов, огненосцы) не засеян: без зерна прогон в CI мог
// ни разу не довести восковой дождь до капель (каждый срывало падение Сердца). Зерно делает прогон повторяемым.
const seed=Number(process.env.CANDLES_SEED??1)>>>0;
const seededRandom=`Math.random=(()=>{let a=${seed}||1;return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();`;
const server=await preview({preview:{port:4191,strictPort:true},logLevel:'warn'}),browser=await launchChromium();
const report=[];let failed=false;
try{for(const q of qualities){
 const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript({content:`${seededRandom}window.__driveHeart=${driveHeart.toString()};window.requestAnimationFrame=()=>0;for(const k of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,k,{value:undefined,configurable:true});`});
 await page.goto(`http://localhost:4191/?stage=1-4b&god&q=${q}`);await page.waitForFunction(()=>!!window.__vb?.battle?.heart);
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
     if(r.metrics.stones>0&&!s.shots.has('stone-break'))shot='stone-break';
     if(r.stones.some(st=>!st.broken&&st.charge>0.6)&&!s.shots.has('volley'))shot='volley';
     if(r.lances.length>2&&!s.shots.has('lances'))shot='lances';
     if(r.flood&&r.flood.hold&&!s.shots.has('flood'))shot='flood';
     s.rainPeak=Math.max(s.rainPeak??0,r.drops.length);
     if(r.drops.length>2&&!s.shots.has('rain'))shot='rain';
     if(r.phase===2&&!s.shots.has('phase-2'))shot='phase-2';
     if(r.phase===3&&!s.shots.has('phase-3'))shot='phase-3';
    }
    if(b.director.id==='heartDeath'&&b.director.time>=1.44&&!s.shots.has('death-close'))shot='death-close';
    if(b.director.id==='heartDeath'&&b.director.time>=3.72&&!s.shots.has('death-wide'))shot='death-wide';
    if(r.dead&&!b.director.active&&!s.shots.has('defeated'))shot='defeated';
    if(s.frames%120===0){const rr=b.ctx.renderer;rr.gl.info.reset();rr.render(b.ctx.time.world);s.peak.calls=Math.max(s.peak.calls,rr.gl.info.render.calls);s.peak.tris=Math.max(s.peak.tris,rr.gl.info.render.triangles);}
    if(shot){s.shots.add(shot);break;}
   }
   b.ctx.renderer.render(b.ctx.time.world);
   return {shot,ends:s.ends,active:r.active,dead:r.dead,hp:r.hp,metrics:{...r.metrics},phases:[...s.phases],maxDark:s.maxDark,peak:s.peak,screen:window.__app.current,clear:b.ctx.save.stages['1-4b']?.clears,frames:s.frames,hero:[h.x,h.z],attack:r.attack?.kind,heat:[...r.heat],hints:s.hints,rainPeak:s.rainPeak??0};
  });
  if(state.shot)await page.screenshot({path:`${out}/${q}-${state.shot}.png`,timeout:60000});
  if(state.ends)break;
 }
 const check=(ok,msg)=>{if(!ok)throw new Error(`${q}: ${msg}: ${JSON.stringify(state)}`);};
 check(state.dead&&state.hp===0&&state.ends===1&&state.screen==='results'&&state.clear===1,'настоящая победа над Сердцем и награда');
 check(state.metrics.counters>0&&state.metrics.reflectedHits>0&&state.metrics.bodyHits>0&&state.metrics.spawnedTotal>=2,'разбитый жернов, возврат снаряда, удары по телу и огненосцы');
 check(state.metrics.floods>=2&&state.metrics.domes>=1&&state.metrics.sheltered>=1,'прилив и укрытие под золотым куполом');
 // Падение Сердца по замыслу гасит метки дождя вместе с каплями: в прогоне бот может сорвать каждый дождь до
 // посадки. Посадку капель проверяет tests/funeralHeart.test.ts; здесь — что дождь в бою начинается.
 check((state.metrics.drops>0||state.rainPeak>0)&&state.metrics.echoes>0,'восковой дождь (метки капель) и эхо падений');
 check(state.metrics.stones>=3&&state.metrics.discs>0&&state.metrics.lances>0&&state.metrics.warded>0,'жернова разбиты, диски и копья веера, щит жерновов');
 check(state.phases.length===3,'три физические фазы');
 check(state.maxDark<.001,'всё свечное пламя гаснет');
 check(state.peak.calls<=160&&state.peak.tris<=260000,'бюджет рендера');check(errors.length===0,'ошибки браузера');
 report.push({q,viewport:{width,height},...state,errors});console.log(`✓ ${q}: Heart defeated by native inputs: ${JSON.stringify(state.metrics)}, ${state.peak.calls}/${state.peak.tris}`);await page.close();
}}catch(e){failed=true;report.push({error:String(e)});console.error(e);}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();await server.close();}
if(failed)process.exitCode=1;
