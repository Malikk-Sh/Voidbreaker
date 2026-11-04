/** Ритуал в настоящем Battle: тьма → удар Сердца → искры → три жаровни → сохранённая победа. */
import { preview } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { launchChromium } from './browser.mjs';
const out=process.env.CANDLES_OUT??'work/candles';mkdirSync(out,{recursive:true});
const qualities=(process.env.CANDLES_Q??'medium,high').split(',');
const [width,height]=(process.env.CANDLES_VIEW??'844x390').split('x').map(Number);
const server=await preview({preview:{port:4191,strictPort:true},logLevel:'warn'}),browser=await launchChromium();
const report=[];let failed=false;
try{for(const q of qualities){
 const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;for(const key of ['AudioContext','webkitAudioContext','OfflineAudioContext'])Object.defineProperty(window,key,{value:undefined,configurable:true});});
 await page.goto(`http://localhost:4191/?stage=1-4&q=${q}`);await page.waitForFunction(()=>!!window.__vb?.battle);
 await page.evaluate(()=>{
  const b=window.__vb.battle,w=b.world,inp=b.ctx.input;
  const s=window.__candles={frames:0,mx:0,mz:0,startedAt:null,firstPulse:false,protected:false,heartHits:0,firstHits:0,lit:[false,false,false],order:[0,2,1],target:0,shots:new Set(),peak:{calls:0,tris:0},ends:0,seedKills:0,hints:[],maxDark:1,maxDarkPools:1,heartScreen:null};
  const update=inp.update.bind(inp);inp.update=now=>{update(now);inp.moveX=s.mx;inp.moveZ=s.mz;};
  w.bus.on('playerHurt',e=>{if(e.source==='Погребальное сердце')s.heartHits++;});
  const end=b.onEnd;b.onEnd=o=>{s.ends++;end?.(o);};
  const hint=b.ctx.hud.showHint.bind(b.ctx.hud);b.ctx.hud.showHint=(text,font)=>{s.hints.push(text);hint(text,font);};
  b.ctx.renderer.gl.info.autoReset=false;
 });
 let state;
 for(let batch=0;batch<260;batch++){
  state=await page.evaluate(()=>{
   const b=window.__vb.battle,w=b.world,h=w.hero,r=b.ritual,s=window.__candles,inp=b.ctx.input;
   const positions=[[-7.2,2],[7.2,2],[0,-7.7]];let shot=null;
   for(let i=0;i<120&&!s.ends;i++){
    s.mx=s.mz=0;h.hp=h.maxHp;h.invulnUntil=0;
    if(r.started&&s.startedAt===null)s.startedAt=w.time;
    const elapsed=s.startedAt===null?0:w.time-s.startedAt;
    const free=!b.director.active&&!b.cine.active&&!h.locked;
    if(r.pulseCount>=1&&!s.firstPulse){s.firstPulse=true;s.firstHits=s.heartHits;}
    // Сначала пропускаем настоящий удар в темноте; затем переносим три искры из реальных смертей.
    if(s.firstPulse&&s.seedKills<3&&free){
     const e=w.enemies.find(e=>e.kind==='husk'&&e.targetable);if(e){e.hp=1;w.damageEnemy(e,{mult:1,stun:0,knockback:0,feel:'light',dirX:0,dirZ:1,source:'blade'});s.seedKills++;}
    }
    if(s.firstPulse&&free&&!r.broken){
     while(s.target<3&&r.lit[s.order[s.target]])s.target++;
     // После первого огня ждём второй импульс в защищённом секторе.
     const waiting=r.lit[0]&&r.pulseCount<2;
     if(!waiting&&s.target<3){
      const [tx,tz]=positions[s.order[s.target]],dx=tx-h.x,dz=tz-h.z,d=Math.hypot(dx,dz);
      if(d>1.2){
       const dot=h.x*dx+h.z*dz,closest=Math.max(0,Math.min(1,-dot/(d*d))),cx=h.x+dx*closest,cz=h.z+dz*closest;
       if(Math.hypot(cx,cz)<5.4){
        const a=Math.atan2(h.x,h.z),t=Math.atan2(tx,tz);let diff=((t-a+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
        const next=a+Math.sign(diff)*Math.min(0.45,Math.abs(diff));const gx=Math.sin(next)*8,gz=Math.cos(next)*8,gd=Math.hypot(gx-h.x,gz-h.z)||1;s.mx=(gx-h.x)/gd;s.mz=(gz-h.z)/gd;
       }else{s.mx=dx/d;s.mz=dz/d;}
      }
     }
    }
    if(r.pulseCount>=2&&r.lit[0]&&!s.protected){s.protected=s.heartHits===s.firstHits;}
    if(r.broken&&free){
     const e=w.enemies.find(e=>e.targetable);if(e){if(s.frames%14===0)inp.buffer.push('attack',inp.now);e.hp=1;w.damageEnemy(e,{mult:1,stun:1e6,knockback:0,feel:'light',dirX:0,dirZ:1,source:'blade'});}
    }
    b.frame(1/60);s.frames++;b.ctx.hud.draw(1/60,b.hudFrame());
    if(r.drain===1&&!r.lit.some(Boolean)&&elapsed>3){
     const lit=b.flames.mesh.geometry.getAttribute('iLit').array;s.maxDark=Math.max(...lit);
     const colors=b.pools.mesh.geometry.getAttribute('iB');let max=0;for(let i=0;i<b.pools.staticCount;i++)max=Math.max(max,colors.getX(i),colors.getY(i),colors.getZ(i));s.maxDarkPools=max;
     if(!s.shots.has('dark')){const p={x:0,y:0,visible:false};b.ctx.renderer.project(0,2.75,-0.5,p);s.heartScreen=p;shot='dark';}
    }
    if(r.warning>0.65&&!s.shots.has('warning'))shot='warning';
    if(r.lit[0]&&!r.broken&&!s.shots.has('restored-sector'))shot='restored-sector';
    if(r.broken&&!s.shots.has('heart-broken'))shot='heart-broken';
    if(s.frames%120===0){const rr=b.ctx.renderer;rr.gl.info.reset();rr.render(b.ctx.time.world);s.peak.calls=Math.max(s.peak.calls,rr.gl.info.render.calls);s.peak.tris=Math.max(s.peak.tris,rr.gl.info.render.triangles);}
    if(shot){s.shots.add(shot);break;}
   }
   b.ctx.renderer.render(b.ctx.time.world);
   return {shot,ends:s.ends,lit:[...r.lit],broken:r.broken,maxDark:s.maxDark,maxDarkPools:s.maxDarkPools,heartScreen:s.heartScreen,firstHits:s.firstHits,heartHits:s.heartHits,protected:s.protected,pulses:r.pulseCount,peak:s.peak,screen:window.__app.current,clear:b.ctx.save.stages['1-4']?.clears,hints:s.hints,frames:s.frames,hero:[h.x,h.z],carried:r.carried,target:s.target};
  });
  if(state.shot)await page.screenshot({path:`${out}/${q}-${state.shot}.png`,timeout:60000});
  if(state.ends)break;
 }
 const check=(ok,msg)=>{if(!ok)throw new Error(`${q}: ${msg}: ${JSON.stringify(state)}`);};
 check(state.maxDark<0.001&&state.maxDarkPools<0.001,'всё пламя гаснет по полному кругу');
 check(state.firstHits>=1&&state.protected&&state.heartHits===state.firstHits,'импульс ранит в темноте, свет защищает');
 check(state.broken&&state.lit.every(Boolean)&&state.ends===1&&state.screen==='results'&&state.clear===1,'три жаровни и настоящая сохранённая победа');
 check(!state.hints.some(h=>h.includes('Врата открыты. Пройди')),'удалённая подсказка');
 check(state.peak.calls<=160&&state.peak.tris<=260000,'бюджет рендера');check(errors.length===0,'ошибки браузера');
 report.push({q,viewport:{width,height},...state,errors});console.log(`✓ ${q}: полная тьма, импульс, безопасный свет, три жаровни, победа; ${state.peak.calls}/${state.peak.tris}`);await page.close();
}}catch(e){failed=true;report.push({error:String(e)});console.error(e);}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();await server.close();}
if(failed)process.exitCode=1;
