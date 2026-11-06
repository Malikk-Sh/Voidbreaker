/**
 * Бот боя со Звонарём («Маятник»): играет задуманным способом. Уходит с метки прохода колокола и кольца
 * раскрутки, из меток Звонаря; на паузе колокола бежит к тумбе натянутой верёвки и рубит её; бьёт Звонаря, когда
 * тот на полу (особенно в окне наказания и оглушённым); в III фазе — обычный бой со Стражем.
 * Сериализуется в страницу (toString) — без замыканий снаружи функции.
 */
export function driveBell(b,s){
 const w=b.world,h=w.hero,inp=b.ctx.input,bell=w.greatBell;
 s.mx=s.mz=0;s.held=false;s.aim=false;
 const g=w.enemies.find(e=>e.kind==='bellRinger'&&!e.dead);
 if(!g||!bell||b.director.active||b.cine?.active||h.locked)return;
 const aim=(x,z)=>{const d=Math.hypot(x-h.x,z-h.z)||1;s.aim=true;s.ax=(x-h.x)/d;s.az=(z-h.z)/d;};
 const go=(x,z,stop=1)=>{const dx=x-h.x,dz=z-h.z,d=Math.hypot(dx,dz);if(d<=stop)return true;s.mx=dx/d;s.mz=dz/d;return false;};
 const attack=()=>{if(s.frames%10===0)inp.buffer.push('attack',inp.now);};
 const inside=(t,pad=0.6)=>{const q=t.shape;if(q.k==='circle')return Math.hypot(h.x-q.x,h.z-q.z)<q.r+pad;
  if(q.k==='ring'){const d=Math.hypot(h.x-q.x,h.z-q.z);return d>q.r0-pad&&d<q.r1+pad;}
  if(q.k==='line'){const ox=h.x-q.x,oz=h.z-q.z,tt=ox*q.dx+oz*q.dz;return tt>-pad&&tt<q.len+pad&&Math.abs(ox*q.dz-oz*q.dx)<q.w/2+pad;}
  if(q.k==='arc'){const d=Math.hypot(h.x-q.x,h.z-q.z);if(d>q.r+pad)return false;let a=Math.atan2(h.x-q.x,h.z-q.z)-q.dir;a=((a+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;return Math.abs(a)<q.half+0.25;}
  return false;};
 // выход из метки: перпендикулярно полосе, от центра круга/кольца
 const escape=(t)=>{const q=t.shape;let dx,dz;
  if(q.k==='line'){const ox=h.x-q.x,oz=h.z-q.z,side=Math.sign(ox*q.dz-oz*q.dx)||1;dx=q.dz*side;dz=-q.dx*side;}
  else if(q.k==='ring'){const d=Math.hypot(h.x-q.x,h.z-q.z)||1,mid=(q.r0+q.r1)/2,out=d>mid?1:-1;dx=(h.x-q.x)/d*out;dz=(h.z-q.z)/d*out;}
  else{const d=Math.hypot(h.x-q.x,h.z-q.z)||1;dx=(h.x-q.x)/d;dz=(h.z-q.z)/d;}
  // у стены — вдоль неё
  const nx=h.x+dx*1.5,nz=h.z+dz*1.5;if(!w.arena.walkable(nx,nz)){const t2=dx;dx=-dz;dz=t2;}
  s.mx=dx;s.mz=dz;if(s.dashy&&s.frames%40===0)inp.buffer.push('dash',inp.now);};
 const danger=w.telegraphs.filter(t=>t.alive&&t.t<t.dur);
 const hot=danger.find(t=>inside(t));
 // 1. Под меткой — выйти (кроме метки прохода, если до удара ещё долго и мы рубим верёвку рядом)
 const cut=bell.ropes.map((r,i)=>({r,i})).filter(o=>bell.cuttable(o.r)).sort((a,c)=>Math.hypot(a.r.cleat.x-h.x,a.r.cleat.z-h.z)-Math.hypot(c.r.cleat.x-h.x,c.r.cleat.z-h.z))[0];
 if(hot){const left=hot.dur-hot.t;const atCleat=cut&&Math.hypot(cut.r.cleat.x-h.x,cut.r.cleat.z-h.z)<1.7;
  if(!(atCleat&&left>0.45)){escape(hot);return;}}
 // 2. Натянутая верёвка — к тумбе и рубить
 if(cut){const c=cut.r.cleat;aim(c.x,c.z);if(go(c.x,c.z,1.3))attack();return;}
 // 3. Звонарь на полу — бить; на колоколе — держаться в стороне от пути
 if(g.targetable){aim(g.x,g.z);const near=go(g.x,g.z,g.radius+h.radius+0.5);
  if(near&&(g.inWindow||g.stunned||s.frames%20<10))attack();return;}
 // ждать у тумбы, которая натянется следующей (дальняя от колокола сторона)
 const far=bell.ropes.filter(r=>!r.cut).sort((a,c)=>Math.hypot(c.pulley.x-bell.x,c.pulley.z-bell.z)-Math.hypot(a.pulley.x-bell.x,a.pulley.z-bell.z))[0];
 if(far)go(far.cleat.x+(bell.cx-far.cleat.x)*0.15,far.cleat.z+(bell.cz-far.cleat.z)*0.15,0.8);
}
