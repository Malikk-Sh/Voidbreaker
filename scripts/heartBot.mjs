/**
 * Native movement/aim/attack/hold input shared by the browser encounter checks. Plays the Heart the intended way:
 * step out of the locked dive mark and the get-up ring, strike the core while it lies open, return orbs, relight a
 * break the millstones that shield the core, step off the lanes of their rolling discs, shelter in the light during
 * the dark wave and, in the Funeral Flood, cut down a fire-bearer and stand under its golden dome.
 */
export function driveHeart(b,s){
 const w=b.world,h=w.hero,r=b.heart,inp=b.ctx.input;
 s.mx=s.mz=0;s.held=false;s.aim=false;
 if(!r?.active||r.dead||r.dying>0||b.director.active||b.cine.active||h.locked)return;
 const cz=r.centerZ-0.5,dist=(x,z)=>Math.hypot(x-h.x,z-h.z);
 const aim=(x,z)=>{const d=Math.hypot(x-h.x,z-h.z)||1;s.aim=true;s.ax=(x-h.x)/d;s.az=(z-h.z)/d;};
 const toward=(x,z,stop=1.4)=>{
  aim(x,z);let dx=x-h.x,dz=z-h.z,d=Math.hypot(dx,dz);
  if(d<=stop)return true;
  // Stay on the ring when a direct path would cross the central well.
  const px=h.x,pz=h.z-cz,qx=x,qz=z-cz;
  const vx=(qx-px)/5.8,vz=(qz-pz)/4.8,ax=px/5.8,az=pz/4.8;
  const t=Math.max(0,Math.min(1,-(ax*vx+az*vz)/(vx*vx+vz*vz||1)));
  if(Math.hypot(ax+vx*t,az+vz*t)<1.08){
   const a=Math.atan2(h.x,h.z-cz),ta=Math.atan2(x,z-cz);let diff=((ta-a+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
   const next=a+Math.sign(diff)*Math.min(0.4,Math.abs(diff));
   const rr=Math.max(8.2,Math.min(11,Math.hypot(h.x,h.z-cz)));dx=Math.sin(next)*rr-h.x;dz=cz+Math.cos(next)*rr-h.z;d=Math.hypot(dx,dz)||1;
  }
  s.mx=dx/d;s.mz=dz/d;return false;
 };
 // Leave a danger circle along the ring (tangentially), never into the well.
 const leave=(x,z)=>{
  const a=Math.atan2(h.x,h.z-cz),rr=Math.max(8.5,Math.min(12,Math.hypot(h.x,h.z-cz))),side=Math.atan2(x,z-cz)>a?-1:1;
  const tx=Math.sin(a+side*0.9)*rr,tz=cz+Math.cos(a+side*0.9)*rr;
  const dx=tx-h.x,dz=tz-h.z,d=Math.hypot(dx,dz)||1;s.mx=dx/d;s.mz=dz/d;
 };
 const attack=()=>{if(s.frames%12===0)inp.buffer.push('attack',inp.now);};
 const inside=(t)=>{const g=t.shape;if(g.k==='circle')return Math.hypot(h.x-g.x,h.z-g.z)<g.r+0.6;
  if(g.k==='line'){const ox=h.x-g.x,oz=h.z-g.z,tt=ox*g.dx+oz*g.dz;return tt>-0.6&&tt<g.len+0.6&&Math.abs(ox*g.dz-oz*g.dx)<g.w/2+0.6;}
  if(g.k==='arc'){const d=Math.hypot(h.x-g.x,h.z-g.z);if(d>g.r+0.6)return false;let a=Math.atan2(h.x-g.x,h.z-g.z)-g.dir;a=((a+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;return Math.abs(a)<g.half+0.2;}
  return false;};
 // 0. Волна близко и не в проходе — рывок сквозь неё; любая метка под ногами — шаг в сторону.
 for(const rw of w.ringWaves){const d=Math.hypot(h.x-rw.x,h.z-rw.z),ahead=d-rw.r;
  const a=Math.atan2(h.x-rw.x,h.z-rw.z),gap=rw.gaps.some(g=>{let x=a-g.a;x=((x+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;return Math.abs(x)<g.w/2-0.05;});
  if(!rw.hit&&!gap&&ahead>0&&ahead<rw.speed*0.16+rw.width/2){s.mx=Math.sin(a+Math.PI);s.mz=Math.cos(a+Math.PI);inp.buffer.push('dash',inp.now);return;}}
 // Катящийся диск жернова: шаг поперёк его хода, если он идёт на героя.
 for(const d of r.discs??[]){if(!d.alive)continue;const ox=h.x-d.x,oz=h.z-d.z,ahead=ox*d.dx+oz*d.dz,side=ox*d.dz-oz*d.dx;
  if(ahead>-0.5&&ahead<6&&Math.abs(side)<d.r+1.1){const sgn=side>=0?1:-1;s.mx=d.dz*sgn;s.mz=-d.dx*sgn;if(ahead<2.2)inp.buffer.push('dash',inp.now);return;}}
 // Под куполом в приливе удар огненосца терпят: выйти из света хуже.
 const sheltered=!!r.flood&&r.fields.some(f=>f.kind==='wax'&&f.life>0&&Math.hypot(h.x-f.x,h.z-f.z)<f.r-0.35);
 const danger=!sheltered&&w.telegraphs.find(t=>t.alive&&t.t<t.dur&&t.dur-t.t<0.9&&inside(t));
 if(danger&&danger.shape.k!=='ring'){const g=danger.shape,cx=g.k==='line'?g.x+g.dx*Math.max(0,Math.min(g.len,(h.x-g.x)*g.dx+(h.z-g.z)*g.dz)):g.x,cz2=g.k==='line'?g.z+g.dz*Math.max(0,Math.min(g.len,(h.x-g.x)*g.dx+(h.z-g.z)*g.dz)):g.z;
  if(danger.dur-danger.t<0.22)inp.buffer.push('dash',inp.now);leave(cx,cz2);return;}
 // Прилив: под золотым куполом безопасно. Нет купола — срубить ближнего огненосца, его пламя станет куполом.
 if(r.flood){
  const dome=r.fields.filter(f=>f.kind==='wax'&&f.life>2).sort((a,c)=>dist(a.x,a.z)-dist(c.x,c.z))[0];
  const bearer=[...r.carriers.values()].filter(e=>!e.dead).sort((a,c)=>dist(a.x,a.z)-dist(c.x,c.z))[0];
  if(dome){
   // Под куполом — рубить подошедшего огненосца, не выходя из света.
   if(sheltered&&bearer&&dist(bearer.x,bearer.z)<2.4){aim(bearer.x,bearer.z);attack();return;}
   toward(dome.x,dome.z,0.45);return;
  }
  if(bearer){if(toward(bearer.x,bearer.z,1.8))attack();return;}
 }
 // 1. Под меткой падения и под встающим Сердцем не стоять.
 if((r.pose==='lock'||r.pose==='fall')&&dist(r.target.x,r.target.z)<3.8){leave(r.target.x,r.target.z);return;}
 if(r.pose==='stuck'&&r.exposed<1.35&&dist(r.body.x,r.body.z)<4.2){leave(r.body.x,r.body.z);return;}
 // 2. Летящая сфера: встретить клинком — она вернётся и собьёт Сердце.
 const orb=r.shots.filter(p=>p.alive&&!p.reflected).sort((a,c)=>dist(a.x,a.z)-dist(c.x,c.z))[0];
 if(orb&&dist(orb.x,orb.z)<6){aim(orb.x,orb.z);if(dist(orb.x,orb.z)<3.1)attack();return;}
 if(s.chargingUntil&&w.time<s.chargingUntil){s.held=true;aim(s.chargeAt.x,s.chargeAt.z);return;}
 if(s.chargingUntil){s.chargingUntil=0;aim(s.chargeAt.x,s.chargeAt.z);return;}
 // 3. Лежит открытым — бить ядро.
 if(r.exposed>0.4&&(r.pose==='stuck'||r.pose==='knock')){if(toward(r.body.x,r.body.z,2.2))attack();return;}
 // Носильщик рядом — срубить: их удары копятся быстрее, чем кажется.
 const foe=w.enemies.filter(e=>!e.dead&&e.targetable!==false).sort((a,c)=>dist(a.x,a.z)-dist(c.x,c.z))[0];
 if(foe&&dist(foe.x,foe.z)<3.6&&!(r.attack&&(r.attack.kind==='pulse'||r.attack.kind==='double'))){if(toward(foe.x,foe.z,1.8))attack();return;}
 // 4. Тёмная волна: встать в проход — у горящей чаши или в воске.
 if(r.attack&&(r.attack.kind==='pulse'||r.attack.kind==='double')){
  const lit=r.braziers.map((p,i)=>({...p,i})).filter(p=>r.lit[p.i]);
  const wax=r.fields.filter(f=>f.kind==='wax'&&f.life>1.5);
  const safe=[...lit.map(p=>({x:p.x*1.08,z:cz+(p.z-cz)*1.08})),...wax].sort((a,c)=>dist(a.x,a.z)-dist(c.x,c.z))[0];
  if(safe){toward(safe.x,safe.z,0.6);return;}
 }
 // 5. Жернова держат щит над ядром: разбить ближний — Сердце рухнет к нему.
 const stone=(r.stones??[]).filter(st=>!st.broken).sort((a,c)=>dist(a.x,a.z)-dist(c.x,c.z))[0];
 if(stone){if(toward(stone.x,stone.z,1.5))attack();return;}
 // 6. Все жернова разбиты — ждать на кольце у колодца.
 toward(0,cz+9,1);
}
