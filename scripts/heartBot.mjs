/** Native movement/aim/attack/hold input shared by the browser encounter checks. */
export function driveHeart(b,s){
 const w=b.world,h=w.hero,r=b.heart,inp=b.ctx.input;
 s.mx=s.mz=0;s.held=false;s.aim=false;
 if(!r?.active||r.dead||b.director.active||b.cine.active||h.locked)return;
 const aim=(x,z)=>{const d=Math.hypot(x-h.x,z-h.z)||1;s.aim=true;s.ax=(x-h.x)/d;s.az=(z-h.z)/d;};
 const toward=(x,z,stop=1.4)=>{
  aim(x,z);let dx=x-h.x,dz=z-h.z,d=Math.hypot(dx,dz);
  if(d<=stop)return true;
  // Stay on the ring when a direct path would cross the central well.
  const cz=r.centerZ-0.5,px=h.x,pz=h.z-cz,qx=x,qz=z-cz;
  const vx=(qx-px)/5.8,vz=(qz-pz)/4.8,ax=px/5.8,az=pz/4.8;
  const t=Math.max(0,Math.min(1,-(ax*vx+az*vz)/(vx*vx+vz*vz||1)));
  if(Math.hypot(ax+vx*t,az+vz*t)<1.08){
   const a=Math.atan2(h.x,h.z-cz),ta=Math.atan2(x,z-cz);let diff=((ta-a+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
   const next=a+Math.sign(diff)*Math.min(0.4,Math.abs(diff));
   const rr=Math.max(8.2,Math.min(11,Math.hypot(h.x,h.z-cz)));dx=Math.sin(next)*rr-h.x;dz=cz+Math.cos(next)*rr-h.z;d=Math.hypot(dx,dz)||1;
  }
  s.mx=dx/d;s.mz=dz/d;return false;
 };
 const attack=()=>{if(s.frames%12===0)inp.buffer.push('attack',inp.now);};
 const orb=r.shots.filter(p=>p.alive&&!p.reflected).sort((a,c)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(c.x-h.x,c.z-h.z))[0];
 if(orb&&r.metrics.reflectedHits<1){
  const d=Math.hypot(orb.x-h.x,orb.z-h.z);aim(orb.x,orb.z);
  if(d>3.1)toward(orb.x,orb.z,3.1);else attack();
  return;
 }
 if(s.chargingUntil&&w.time<s.chargingUntil){s.held=true;aim(s.chargeAt.x,s.chargeAt.z);return;}
 if(s.chargingUntil){s.chargingUntil=0;aim(s.chargeAt.x,s.chargeAt.z);return;}
 if(r.metrics.reflectedHits>0&&(r.exposed>0.5||r.phase===3)){
  if(toward(r.body.x,r.body.z,2.2))attack();return;
 }
 const fields=r.fields.filter(f=>f.kind==='wax'&&f.life>2).sort((a,c)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(c.x-h.x,c.z-h.z));
 const warm=r.braziers.map((p,i)=>({...p,i})).filter(p=>!r.lit[p.i]&&r.heat[p.i]>=0.75).sort((a,c)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(c.x-h.x,c.z-h.z));
 const target=warm[0]??fields[0];
 if(target){
  if(toward(target.x,target.z,1.55)){
   s.chargeAt={x:target.x,z:target.z};s.chargingUntil=w.time+1.1;s.held=true;inp.attackHeldSince=inp.now;
  }
  return;
 }
 // The first blast deliberately heats this shrine; wait there for a readable counter opportunity.
 const bowl=r.braziers[0];toward(bowl.x,bowl.z+1.4,1);
 if(orb){aim(orb.x,orb.z);if(Math.hypot(orb.x-h.x,orb.z-h.z)<3.3)attack();}
}
