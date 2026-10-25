/** Хоры в настоящем бою: метки, приманка для врагов и возврат сенсорной кнопкой рывка. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { launchChromium } from './browser.mjs';
const out='work/choir'; mkdirSync(out,{recursive:true});
const report=[]; let failed=false;
const check=(ok,msg)=>{console.log(`${ok?'✓':'✗'} ${msg}`);if(!ok)failed=true;};
const server=await preview({preview:{port:4190,strictPort:true},logLevel:'warn'}), browser=await launchChromium();
try {
for(const viewport of [{width:844,height:390},{width:740,height:360}])for(const mode of ['bait','return']) {
  const context=await browser.newContext({viewport,hasTouch:true,isMobile:true,deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],stem=`${viewport.width}x${viewport.height}-${mode}`;
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const r={stem,errors};report.push(r);
  try {
    await page.goto('http://localhost:4190/?stage=1-9&wave=3&q=medium');await page.waitForFunction(()=>!!window.__app?.game.battle);
    await page.evaluate(()=>{
      const a=window.__app,b=a.game.battle,w=b.world,h=w.hero;a.game.running=false;b.ctx.settings.shake=0;
      b.cine.clear(b.cam);h.locked=false;h.scripted=false;h.x=0;h.z=0;h.facing=Math.PI/2;h.invulnUntil=0;b.ctx.input.reset();
      const d=window.__choir={b,w,h,events:[]};w.bus.on('choir',e=>d.events.push({...e,time:w.time}));
      d.step=()=>{for(const e of w.enemies)if(!e.dead)e.lagT=999;b.frame(1/60);b.ctx.hud.draw(1/60,b.hudFrame());};
      for(let i=0;i<900&&!b.events.choir.notes.length;i++)d.step();
      d.note={...b.events.choir.notes[0]};d.target=w.enemies.find(e=>e.kind==='golem'&&!e.dead);
      if(!d.note.tele||!d.target)throw new Error('No live psalm/target');
      d.target.x=d.note.x+0.5;d.target.z=d.note.z;d.target.setState('idle');d.target.vx=d.target.vz=0;
      d.hp=h.hp;d.enemyHP=d.target.hp;
      for(let i=0;i<6;i++)d.step();b.ctx.renderer.render(b.ctx.time.world);
    });
    r.mark=await page.evaluate(()=>{
      const d=window.__choir,c=d.b.ctx.renderer.camera,p=c.position.clone().set(d.note.x,0.1,d.note.z).project(c);
      return{warning:d.note.left,ground:d.w.arena.walkable(d.note.x,d.note.z),screen:{x:(p.x+1)/2,y:(1-p.y)/2,z:p.z}};
    });
    await page.screenshot({path:`${out}/${stem}-mark.png`});
    check(r.mark.warning>1.2&&r.mark.ground&&r.mark.screen.x>0.05&&r.mark.screen.x<0.95&&r.mark.screen.y>0.08&&r.mark.screen.y<0.92,`${stem}: метка видна на полу, предупреждение 1.3 с`);
    if(mode==='bait') {
      r.result=await page.evaluate(()=>{const d=window.__choir;d.h.x=5;for(let i=0;i<180&&!d.events.some(e=>e.kind==='impact');i++)d.step();return{heroHP:d.h.hp,before:d.hp,enemyHP:d.target.hp,enemyBefore:d.enemyHP,impact:d.events.find(e=>e.kind==='impact')};});
      check(r.result.heroHP===r.result.before&&r.result.enemyHP<r.result.enemyBefore,`${stem}: псалом бьёт заманенного врага, ушедший Пилот цел`);
      check(r.result.impact?.x===0&&r.result.impact?.z===0,`${stem}: удар остаётся на запомненном месте`);
    } else {
      await page.evaluate(()=>{const d=window.__choir;d.target.x=4;while(d.b.events.choir.notes[0]?.left>0.05+1e-7)d.step();});
      const dash=await page.evaluate(()=>window.__choir.b.ctx.input.buttons.find(b=>b.id==='dash'));
      check(dash&&dash.r*2>=48&&dash.x>0&&dash.x<viewport.width&&dash.y>0&&dash.y<viewport.height,`${stem}: кнопка рывка доступна пальцу`);
      await page.touchscreen.tap(dash.x,dash.y);
      r.result=await page.evaluate(()=>{const d=window.__choir;for(let i=0;i<12&&!d.events.some(e=>e.kind==='return');i++)d.step();for(let i=0;i<40;i++)d.step();return{heroHP:d.h.hp,before:d.hp,returned:d.events.some(e=>e.kind==='return'),notes:d.b.events.choir.notes.length,silenced:d.b.events.choir.silenced,enemyHP:d.target.hp,enemyBefore:d.enemyHP,stun:d.target.stun?.stunned,choirMuted:d.b.ambience?.choirMuted,light:d.b.events.assembly.material.uniforms.uEmissiveStrength.value,baseLight:d.b.events.assembly.light};});
      check(r.result.returned&&r.result.heroHP===r.result.before&&r.result.notes===0&&r.result.silenced,`${stem}: касание рывка возвращает псалом и отменяет остальные метки`);
      check(r.result.enemyHP<r.result.enemyBefore&&r.result.stun>0,`${stem}: ответная волна ранит и оглушает врага`);
      check(r.result.choirMuted&&r.result.light<r.result.baseLight*0.2,`${stem}: певец гаснет и замолкает`);
    }
    await page.evaluate(()=>{const b=window.__choir.b;b.ctx.renderer.render(b.ctx.time.world);});
    await page.screenshot({path:`${out}/${stem}-result.png`});
    check(errors.length===0,`${stem}: без ошибок браузера`);
  }catch(e){r.error=String(e);check(false,`${stem}: ${e}`);}
  finally{await context.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));}
}
}finally{await browser.close();await server.close();}
if(failed)process.exitCode=1;
