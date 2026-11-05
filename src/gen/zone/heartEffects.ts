import * as THREE from 'three';
import { mat, matAlong } from '../geom/build';
import { octa } from '../geom/prims';
import type { Shape } from '../../world/combat';

export interface HeartEffectsView {
  centerZ: number;
  active: boolean;
  dead: boolean;
  body: { x: number; y: number; z: number; r?: number };
  beat: number;
  lit: readonly boolean[];
  heat: readonly number[];
  braziers: readonly {x:number;z:number}[];
  shots: readonly {id:number;x:number;y:number;z:number;r:number;vx:number;vz:number;alive:boolean;reflected:boolean;life:number}[];
  fields: readonly {id:number;x:number;z:number;r:number;life:number;dur:number;kind:'wax'|'counter'}[];
  carriers: ReadonlyMap<number, {x:number;z:number;dead:boolean;state?:string;stateT?:number}>;
  attack: {kind:string;x:number;z:number;t:number;dur:number;shapes:readonly Shape[];targetIndex?:number}|null;
  /** Поза боя, точка падения, раскрытие ядра (с) и гибель 0…1 — для тени, столба и золотых искр. */
  pose?: string;
  target?: {x:number;z:number};
  exposed?: number;
  dying?: number;
}

/**
 * Тень падения: shadow — радиус тени под Сердцем (м, как у удара), dark — её плотность при выслеживании и на
 * метке; motes — искр вокруг раскрытого ядра; pillar — толщина столба от Сердца к метке (м).
 */
export const DIVE_LOOK = { shadow: 2.6, dark: [0.32, 0.6] as const, motes: 14, pillar: 0.09 };

const HOT = new THREE.Color('#ff6e2b'), REFLECT = new THREE.Color('#d7a1ff');
const GOLD = new THREE.Color('#ffdb8a'), DANGER = new THREE.Color('#98243b');
const MAX_SHOTS=48, MAX_FIELDS=24, MAX_CARRIERS=16, MAX_LINKS=32;

/** Все координаты мировые; точные предупреждения атак рисует общая система телеграфов. */
export class HeartEffects {
  readonly group = new THREE.Group();
  readonly soul: THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private readonly shots: THREE.InstancedMesh;
  private readonly halos: THREE.InstancedMesh;
  private readonly carriers: THREE.InstancedMesh;
  private readonly fields: THREE.InstancedMesh;
  private readonly links: THREE.InstancedMesh;
  private readonly trail: THREE.InstancedMesh;
  private readonly shadow: THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private readonly lockRing: THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private readonly pillar: THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private readonly motes: THREE.InstancedMesh;
  private readonly soulHistory: THREE.Vector3[]=[];
  private readonly tempColor = new THREE.Color();
  private time=0;
  private disposed=false;

  constructor() {
    this.group.name='Funeral Heart effects';
    const bright = new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.95,blending:THREE.AdditiveBlending,depthWrite:false});
    const halo = new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.25,blending:THREE.AdditiveBlending,depthWrite:false});
    this.shots=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),bright,MAX_SHOTS);
    this.shots.name='heart-projectiles';
    this.halos=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),halo,MAX_SHOTS);
    this.carriers=new THREE.InstancedMesh(new THREE.TorusGeometry(0.4,0.1,4,12),bright,MAX_CARRIERS);
    this.carriers.name='votive-carriers';
    const floorRing=new THREE.RingGeometry(0.82,1,40); floorRing.rotateX(-Math.PI/2);
    this.fields=new THREE.InstancedMesh(floorRing,new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.42,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}),MAX_FIELDS);
    this.fields.name='heart-firefields';
    this.links=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.72,blending:THREE.AdditiveBlending,depthWrite:false}),MAX_LINKS);
    this.links.name='heart-arteries';
    this.soul=new THREE.Mesh(new THREE.IcosahedronGeometry(0.65,2),new THREE.MeshBasicMaterial({color:'#fff0bd',transparent:true,opacity:0.92,blending:THREE.AdditiveBlending,depthWrite:false}));
    this.soul.name='escaping-soul'; this.soul.visible=false;
    this.trail=new THREE.InstancedMesh(octa(0.3,0.3,0.3),halo,10);
    this.trail.name='soul-trail';
    for(const mesh of [this.shots,this.halos,this.carriers,this.fields,this.links,this.trail]) {mesh.count=0;mesh.frustumCulled=false;this.group.add(mesh);}
    this.group.add(this.soul);
    // Тень падения — тёмный диск на полу, а не ещё одно свечение: где будет Сердце, видно сразу.
    const disk=new THREE.CircleGeometry(1,40); disk.rotateX(-Math.PI/2);
    this.shadow=new THREE.Mesh(disk,new THREE.MeshBasicMaterial({color:'#05010a',transparent:true,opacity:0,depthWrite:false}));
    this.shadow.name='heart-dive-shadow'; this.shadow.renderOrder=3;
    const ring=new THREE.RingGeometry(0.9,1,48); ring.rotateX(-Math.PI/2);
    this.lockRing=new THREE.Mesh(ring,new THREE.MeshBasicMaterial({color:HOT,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    this.lockRing.name='heart-dive-lock';
    this.pillar=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:HOT,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
    this.pillar.name='heart-dive-pillar';
    this.motes=new THREE.InstancedMesh(octa(0.09,0.16,0.09),bright,DIVE_LOOK.motes);
    this.motes.name='heart-core-motes';
    for(const mesh of [this.shadow,this.lockRing,this.pillar,this.motes]){mesh.frustumCulled=false;mesh.visible=false;this.group.add(mesh);}
    this.motes.count=0;
  }

  update(dt:number,v:HeartEffectsView):void {
    if(this.disposed)return;
    this.time+=dt;
    const visible=v.active&&!v.dead;
    let shots=0;
    if(visible)for(const p of v.shots){
      if(!p.alive||shots>=MAX_SHOTS)continue;
      const r=Math.max(0.55,p.r), color=p.reflected?REFLECT:HOT;
      this.shots.setMatrixAt(shots,mat(p.x,p.y,p.z,0,this.time*2+p.id,0,r,r,r));
      this.shots.setColorAt(shots,color);
      this.halos.setMatrixAt(shots,mat(p.x,p.y,p.z,0,-this.time+p.id,0,r*1.52,r*1.52,r*1.52));
      this.halos.setColorAt(shots,color);shots++;
    }
    this.shots.count=this.halos.count=shots;
    let carriers=0;
    if(visible)for(const [id,e] of v.carriers){
      if(e.dead||carriers>=MAX_CARRIERS)continue;
      this.carriers.setMatrixAt(carriers,mat(e.x,2.1+Math.sin(this.time*3+id)*0.1,e.z,0,this.time*1.8,Math.sin(this.time+id)*0.25));
      this.carriers.setColorAt(carriers,GOLD);carriers++;
    }
    this.carriers.count=carriers;
    let fields=0;
    if(visible)for(const f of v.fields){
      if(f.life<=0||fields>=MAX_FIELDS)continue;
      const r=f.r*(0.97+Math.sin(this.time*3+f.id)*0.025), remaining=Math.min(1,f.life/Math.min(1,f.dur));
      this.fields.setMatrixAt(fields,mat(f.x,0.055,f.z,0,0,0,r,1,r));
      this.tempColor.copy(f.kind==='counter'?REFLECT:GOLD).multiplyScalar(remaining);
      this.fields.setColorAt(fields,this.tempColor);fields++;
    }
    this.fields.count=fields;
    let links=0;
    if(visible)for(let i=0;i<v.braziers.length&&i<3;i++) {
      const b=v.braziers[i], heat=Math.max(0,Math.min(1,v.heat[i]??0));
      const active=v.lit[i]||heat>0;
      const draining=v.attack?.kind==='drain'&&v.attack.targetIndex===i;
      for(let j=0;j<8&&links<MAX_LINKS;j++){
        const t0=j/8,t1=(j+0.82)/8;
        const ax=b.x+(v.body.x-b.x)*t0, ay=1.35+(v.body.y-1.35)*t0+Math.sin(t0*Math.PI)*0.25, az=b.z+(v.body.z-b.z)*t0;
        const cx=b.x+(v.body.x-b.x)*t1, cy=1.35+(v.body.y-1.35)*t1+Math.sin(t1*Math.PI)*0.25, cz=b.z+(v.body.z-b.z)*t1;
        const dx=cx-ax,dy=cy-ay,dz=cz-az, length=Math.hypot(dx,dy,dz);
        const pulse=0.45+0.55*Math.max(0,Math.sin(this.time*5-j*0.7));
        const thickness=active?0.045+heat*0.055:0.025;
        this.links.setMatrixAt(links,matAlong((ax+cx)/2,(ay+cy)/2,(az+cz)/2,dx,dy,dz,thickness,length,thickness));
        this.tempColor.copy(draining?HOT:active?GOLD:DANGER).multiplyScalar(draining?0.75+pulse*0.6:active?0.3+heat*0.5+pulse*0.4:0.22);
        this.links.setColorAt(links,this.tempColor);links++;
      }
    }
    // Новая оболочка вырастает из огня Сердца: нить и бегущая искра направлены к рождающемуся врагу.
    if(visible)for(const e of v.carriers.values()) {
      if(e.dead||e.state!=='spawn'||(e.stateT??0)>.8||links+1>=MAX_LINKS)continue;
      const dx=e.x-v.body.x,dy=1.4-v.body.y,dz=e.z-v.body.z,length=Math.hypot(dx,dy,dz);
      this.links.setMatrixAt(links,matAlong(v.body.x+dx*.5,v.body.y+dy*.5,v.body.z+dz*.5,dx,dy,dz,.045,length,.045));
      this.links.setColorAt(links,GOLD);links++;
      const t=Math.max(0,Math.min(1,(e.stateT??0)/.8)),r=.2+Math.sin(t*Math.PI)*.07;
      this.links.setMatrixAt(links,mat(v.body.x+dx*t,v.body.y+dy*t,v.body.z+dz*t,0,this.time*2,0,r,r,r));
      this.links.setColorAt(links,GOLD);links++;
    }
    this.links.count=links;
    this.updateDive(v,visible);
    for(const mesh of [this.shots,this.halos,this.carriers,this.fields,this.links,this.motes]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    if(this.soul.visible)this.soul.scale.setScalar(1+Math.sin(this.time*5)*0.08);
  }

  /** Тень и столб над меткой падения; золотые искры над раскрытым ядром. */
  private updateDive(v:HeartEffectsView,visible:boolean):void {
    const pose=v.pose??'', airborne=visible&&(pose==='track'||pose==='lock'||pose==='fall');
    const t=v.target??{x:v.body.x,z:v.body.z};
    this.shadow.visible=airborne; this.lockRing.visible=this.pillar.visible=airborne&&pose!=='track';
    if(airborne){
      // Чем ниже Сердце, тем гуще и мельче тень: падение читается по полу.
      const h=Math.max(0,Math.min(1,(v.body.y-1)/6.4)), r=DIVE_LOOK.shadow*(0.75+h*0.35);
      this.shadow.position.set(t.x,0.06,t.z); this.shadow.scale.set(r,1,r);
      this.shadow.material.opacity=pose==='track'?DIVE_LOOK.dark[0]:DIVE_LOOK.dark[1]*(0.85+Math.sin(this.time*18)*0.15);
      const pulse=0.55+0.45*Math.sin(this.time*14);
      this.lockRing.position.set(t.x,0.08,t.z); this.lockRing.scale.set(DIVE_LOOK.shadow,1,DIVE_LOOK.shadow);
      this.lockRing.material.opacity=0.5+pulse*0.4;
      const top=Math.max(0.5,v.body.y-0.6);
      this.pillar.position.set(t.x,top/2,t.z); this.pillar.scale.set(DIVE_LOOK.pillar,top,DIVE_LOOK.pillar);
      this.pillar.material.opacity=0.35+pulse*0.35;
    }
    const open=visible&&(v.exposed??0)>0&&(pose==='stuck'||pose==='knock');
    const dying=visible&&(v.dying??0)>0;
    let motes=0;
    if(open||dying)for(let i=0;i<DIVE_LOOK.motes;i++){
      // Искры поднимаются из раскрытого ядра: открытое место видно и издалека.
      const u=(this.time*0.7+i/DIVE_LOOK.motes)%1, a=i*2.4+this.time*(dying?3:1.1), r=(dying?0.8:1.4)+u*(dying?0.4:1.2);
      this.motes.setMatrixAt(motes,mat(v.body.x+Math.sin(a)*r,v.body.y+u*2.6-0.4,v.body.z+Math.cos(a)*r,0,a,0,1-u*0.6,1-u*0.6,1-u*0.6));
      this.motes.setColorAt(motes,dying?REFLECT:GOLD);motes++;
    }
    this.motes.count=motes; this.motes.visible=motes>0;
  }

  setSoul(x:number,y:number,z:number,visible:boolean):void {
    if(this.disposed)return;
    this.soul.visible=visible;this.soul.position.set(x,y,z);
    if(!visible){this.soulHistory.length=0;this.trail.count=0;return;}
    const point=new THREE.Vector3(x,y,z),last=this.soulHistory[0];
    if(!last||last.distanceToSquared(point)>0.012){this.soulHistory.unshift(point);if(this.soulHistory.length>10)this.soulHistory.pop();}
    this.trail.count=this.soulHistory.length;
    this.soulHistory.forEach((p,i)=>{const k=1-i/10;this.trail.setMatrixAt(i,mat(p.x,p.y,p.z,0,this.time+i,0,k,k,k));this.trail.setColorAt(i,GOLD);});
    this.trail.instanceMatrix.needsUpdate=true;if(this.trail.instanceColor)this.trail.instanceColor.needsUpdate=true;
  }

  dispose():void {
    if(this.disposed)return;this.disposed=true;
    const materials=new Set<THREE.Material>();
    this.group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    for(const m of materials)m.dispose();
    this.group.removeFromParent();this.group.clear();
  }
}
