import * as THREE from 'three';
import { mat, matAlong } from '../geom/build';
import { octa } from '../geom/prims';
import type { Shape } from '../../world/combat';
import { SoulSpirit } from './soulSpirit';

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
  /** Погребальный прилив: радиус тьмы от колодца, видимость, вспышка удара, вдох перед ударом. */
  flood?: {front:number;inner:number;outer:number;level:number;crash:number;hold:boolean}|null;
  /** Капли воскового дождя: t — с начала метки, dur — до удара. */
  drops?: readonly {id:number;x:number;z:number;r:number;t:number;dur:number}[];
}

/**
 * Тень падения: shadow — радиус тени под Сердцем (м, как у удара), dark — её плотность при выслеживании и на
 * метке; motes — искр вокруг раскрытого ядра; pillar — толщина столба от Сердца к метке (м).
 */
export const DIVE_LOOK = { shadow: 2.6, dark: [0.32, 0.6] as const, motes: 14, pillar: 0.09 };

const HOT = new THREE.Color('#ff6e2b'), REFLECT = new THREE.Color('#d7a1ff'), WHITE = new THREE.Color('#fff6dc');
const GOLD = new THREE.Color('#ffdb8a'), DANGER = new THREE.Color('#98243b');
const MAX_SHOTS=48, MAX_FIELDS=24, MAX_CARRIERS=16, MAX_LINKS=32, MAX_DOMES=6, MAX_DROPS=16;

/**
 * Огненосцы, купола и прилив: flame — высота пламени над головой огненосца (м); domeRise — сколько купол
 * поднимается из упавшего пламени (с); domeFade — сколько гаснет в конце жизни; dropFall — сколько капля падает (с).
 */
export const WAX_LOOK = { flame: 2.05, domeRise: 0.35, domeFade: 1.5, dropFall: 0.45, dropFrom: 9 };

/** Все координаты мировые; точные предупреждения атак рисует общая система телеграфов. */
export class HeartEffects {
  readonly group = new THREE.Group();
  /** Свет павшей элиты по пути к Сердцу: огненный дух со шлейфом. */
  readonly soul = new SoulSpirit();
  private readonly shots: THREE.InstancedMesh;
  private readonly halos: THREE.InstancedMesh;
  /** Пламя над головой огненосца: внешний золотой язык и белое ядро. */
  private readonly carriers: THREE.InstancedMesh;
  private readonly domes: THREE.InstancedMesh;
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly tide: THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  private readonly dropMeshes: THREE.InstancedMesh;
  private readonly fields: THREE.InstancedMesh;
  private readonly links: THREE.InstancedMesh;
  private readonly shadow: THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private readonly lockRing: THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private readonly pillar: THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private readonly motes: THREE.InstancedMesh;
  /** Сердце, принявшее свет: золотое сияние вокруг брони, оно не прячется за лепестками. */
  private readonly aura: THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  private readonly prelude = { x: 0, y: 0, z: 0, glow: 0, pulse: 0 };
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
    this.carriers=new THREE.InstancedMesh(octa(0.22,0.62,0.22).translate(0,0.4,0),bright,MAX_CARRIERS*2);
    this.carriers.name='votive-carriers';
    // Купол — полусфера с ярким краем: силовой щит из света, видный сквозь тьму прилива.
    const dome=new THREE.SphereGeometry(1,28,12,0,Math.PI*2,0,Math.PI/2);
    this.domeMaterial=new THREE.ShaderMaterial({
      uniforms:{boost:{value:0}},
      vertexShader:'varying vec3 vN;varying vec3 vV;varying vec3 vC;varying float vY;void main(){vec4 p=modelViewMatrix*instanceMatrix*vec4(position,1.0);vN=normalize(normalMatrix*mat3(instanceMatrix)*normal);vV=normalize(-p.xyz);vC=instanceColor;vY=position.y;gl_Position=projectionMatrix*p;}',
      fragmentShader:'uniform float boost;varying vec3 vN;varying vec3 vV;varying vec3 vC;varying float vY;void main(){float f=1.0-abs(dot(normalize(vN),normalize(vV)));float rim=pow(f,2.2);float band=0.5+0.5*sin(vY*18.0);gl_FragColor=vec4(vC*(0.1+rim*(0.85+boost)+band*0.05*(1.0+boost)),1.0);}',
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,
    });
    this.domes=new THREE.InstancedMesh(dome,this.domeMaterial,MAX_DOMES);
    this.domes.name='heart-wax-domes';
    this.domes.setColorAt(0,GOLD);
    // Тьма прилива — плоский слой поверх пола зала: от колодца к стенам, с окнами под куполами.
    const domeSlots=Array.from({length:MAX_DOMES},()=>new THREE.Vector3(0,0,-1));
    this.tide=new THREE.Mesh(new THREE.CircleGeometry(1,72).rotateX(-Math.PI/2),new THREE.ShaderMaterial({
      uniforms:{uWell:{value:new THREE.Vector2()},uWellR:{value:new THREE.Vector2(5,4)},uHallC:{value:new THREE.Vector2()},uHallR:{value:new THREE.Vector2(19,15)},
        uFront:{value:0},uLevel:{value:0},uCrash:{value:0},uHold:{value:0},uTime:{value:0},uDomes:{value:domeSlots}},
      vertexShader:'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
      fragmentShader:[
        'uniform vec2 uWell;uniform vec2 uWellR;uniform vec2 uHallC;uniform vec2 uHallR;uniform float uFront;uniform float uLevel;uniform float uCrash;uniform float uHold;uniform float uTime;',
        `uniform vec3 uDomes[${MAX_DOMES}];varying vec3 vW;`,
        'void main(){vec2 p=vW.xz;vec2 h=(p-uHallC)/uHallR;if(dot(h,h)>1.0)discard;vec2 q=(p-uWell)/uWellR;if(dot(q,q)<1.0)discard;',
        'float d=length(p-uWell);float edge=uFront-d;if(edge<0.0)discard;float shelter=1.0;',
        `for(int i=0;i<${MAX_DOMES};i++){if(uDomes[i].z<=0.0)continue;float dd=length(p-uDomes[i].xy)-uDomes[i].z;shelter=min(shelter,smoothstep(0.0,0.6,dd));}`,
        // Тёмная вода с тонкими багровыми прожилками; у фронта — яркая пена; на вдохе прожилки бьются.
        'float n=sin(p.x*0.9+sin(p.y*0.7+uTime*0.5)*1.6+uTime*0.8)+sin(p.y*1.1-uTime*0.6+sin(p.x*0.5)*1.4);float veins=1.0-smoothstep(0.0,0.12,abs(n));',
        'float foam=1.0-smoothstep(0.0,0.7,edge);float pulse=uHold*(0.5+0.5*sin(uTime*14.0));',
        'vec3 col=vec3(0.012,0.004,0.02)+vec3(0.55,0.04,0.1)*(veins*(0.22+pulse*0.45)+foam*0.9+uCrash*0.55);',
        'gl_FragColor=vec4(col,uLevel*shelter*(0.86+foam*0.14));}',
      ].join(''),
      transparent:true,depthWrite:false,
    }));
    this.tide.name='heart-flood-tide'; this.tide.renderOrder=4;
    this.dropMeshes=new THREE.InstancedMesh(octa(0.32,0.8,0.32),bright,MAX_DROPS);
    this.dropMeshes.name='heart-wax-drops';
    const floorRing=new THREE.RingGeometry(0.82,1,40); floorRing.rotateX(-Math.PI/2);
    this.fields=new THREE.InstancedMesh(floorRing,new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.42,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}),MAX_FIELDS);
    this.fields.name='heart-firefields';
    this.links=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.72,blending:THREE.AdditiveBlending,depthWrite:false}),MAX_LINKS);
    this.links.name='heart-arteries';
    for(const mesh of [this.shots,this.halos,this.carriers,this.fields,this.links,this.domes,this.dropMeshes]) {mesh.count=0;mesh.frustumCulled=false;this.group.add(mesh);}
    this.tide.frustumCulled=false;this.tide.visible=false;this.group.add(this.tide);
    this.group.add(this.soul.group);
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
    // Мягкое сияние: яркое в середине, прозрачное к краю — без граней сферы.
    this.aura=new THREE.Mesh(new THREE.IcosahedronGeometry(1,3),new THREE.ShaderMaterial({
      uniforms:{color:{value:GOLD.clone()},opacity:{value:0}},
      vertexShader:'varying vec3 vN;varying vec3 vV;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
      fragmentShader:'uniform vec3 color;uniform float opacity;varying vec3 vN;varying vec3 vV;void main(){float f=max(dot(normalize(vN),normalize(vV)),0.0);gl_FragColor=vec4(color*opacity*f*f*f,1.0);}',
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,
    }));
    this.aura.name='heart-prelude-aura';
    for(const mesh of [this.shadow,this.lockRing,this.pillar,this.motes,this.aura]){mesh.frustumCulled=false;mesh.visible=false;this.group.add(mesh);}
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
      if(e.dead||carriers+1>=MAX_CARRIERS*2)continue;
      // Пламя над головой: живое, качается, а внутри — белое ядро. Его видно в полной тьме прилива.
      const f=0.85+Math.sin(this.time*17+id*3.1)*0.1+Math.sin(this.time*29+id)*0.06, sway=Math.sin(this.time*5+id)*0.12;
      this.carriers.setMatrixAt(carriers,mat(e.x,WAX_LOOK.flame,e.z,sway,this.time*0.6+id,-sway,1.6,f*1.75,1.6));
      this.carriers.setColorAt(carriers,this.tempColor.copy(GOLD).lerp(HOT,0.35));carriers++;
      this.carriers.setMatrixAt(carriers,mat(e.x,WAX_LOOK.flame+0.08,e.z,sway,this.time*0.6+id,-sway,0.75,f*0.95,0.75));
      this.carriers.setColorAt(carriers,WHITE);carriers++;
    }
    this.carriers.count=carriers;
    this.updateWax(v,visible);
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
    for(const mesh of [this.shots,this.halos,this.carriers,this.fields,this.links,this.motes,this.domes,this.dropMeshes]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    this.soul.update(dt);
  }

  /** Золотые купола павших огненосцев, тьма прилива с окнами под ними, капли воскового дождя. */
  private updateWax(v:HeartEffectsView,visible:boolean):void {
    const flood=visible?v.flood??null:null, slots=this.tide.material.uniforms.uDomes.value as THREE.Vector3[];
    let domes=0;
    for(const f of visible?v.fields:[]){
      if(f.kind!=='wax'||f.life<=0||domes>=MAX_DOMES)continue;
      const age=f.dur-f.life, rise=Math.min(1,age/WAX_LOOK.domeRise), fade=Math.min(1,f.life/WAX_LOOK.domeFade);
      const e=1-Math.pow(1-rise,3), r=f.r*(0.6+0.4*e);
      this.domes.setMatrixAt(domes,mat(f.x,0.02,f.z,0,this.time*0.2,0,r,f.r*0.85*e,r));
      // В приливе купол горит ярче: укрытие видно сразу.
      this.domes.setColorAt(domes,this.tempColor.copy(GOLD).multiplyScalar(fade*(flood?1.35:0.85)));
      slots[domes].set(f.x,f.z,f.r*e);domes++;
    }
    for(let i=domes;i<MAX_DOMES;i++)slots[i].set(0,0,-1);
    this.domes.count=domes;
    this.domeMaterial.uniforms.boost.value=flood?0.6+flood.crash*0.8:0;
    const u=this.tide.material.uniforms;
    this.tide.visible=!!flood&&flood.level>0.01;
    if(flood){
      const c=v.centerZ;
      this.tide.position.set(0,0.07,c);this.tide.scale.setScalar(flood.outer+1);
      (u.uWell.value as THREE.Vector2).set(0,c-0.5);(u.uHallC.value as THREE.Vector2).set(0,c);
      u.uFront.value=flood.front;u.uLevel.value=flood.level;u.uCrash.value=flood.crash;u.uHold.value=flood.hold?1:0;u.uTime.value=this.time;
    }
    let drops=0;
    for(const d of visible?v.drops??[]:[]){
      if(drops>=MAX_DROPS)continue;
      // Капля видна в последние доли секунды: падает сверху точно в центр метки.
      const k=(d.t-(d.dur-WAX_LOOK.dropFall))/WAX_LOOK.dropFall;
      if(k<0)continue;
      const y=WAX_LOOK.dropFrom*(1-k*k)+0.3;
      this.dropMeshes.setMatrixAt(drops,mat(d.x,y,d.z,0,this.time*3+d.id,0,1,1.2+k*0.6,1));
      this.dropMeshes.setColorAt(drops,this.tempColor.copy(GOLD).lerp(HOT,0.5));drops++;
    }
    this.dropMeshes.count=drops;
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
    const pre=this.prelude, glowing=!visible&&!v.dead&&pre.glow>0.01;
    this.aura.visible=glowing;
    if(glowing){
      const r=2.3+pre.pulse*0.35;
      this.aura.position.set(pre.x,pre.y,pre.z);this.aura.scale.set(r,r*1.2,r);
      this.aura.material.uniforms.opacity.value=pre.glow*(0.24+pre.pulse*0.32);
    }
    let motes=0;
    if(glowing)for(let i=0;i<DIVE_LOOK.motes;i++){
      // Тлеющие искры поднимаются над Сердцем — оно живое и ждёт.
      const u=(this.time*0.35+i/DIVE_LOOK.motes)%1, a=i*2.4+this.time*0.6, r=1.6+u*0.9;
      this.motes.setMatrixAt(motes,mat(pre.x+Math.sin(a)*r,pre.y-1.2+u*3.4,pre.z+Math.cos(a)*r,0,a,0,(1-u)*pre.glow,(1-u)*pre.glow,(1-u)*pre.glow));
      this.motes.setColorAt(motes,GOLD);motes++;
    }
    else if(open||dying)for(let i=0;i<DIVE_LOOK.motes;i++){
      // Искры поднимаются из раскрытого ядра: открытое место видно и издалека.
      const u=(this.time*0.7+i/DIVE_LOOK.motes)%1, a=i*2.4+this.time*(dying?3:1.1), r=(dying?0.8:1.4)+u*(dying?0.4:1.2);
      this.motes.setMatrixAt(motes,mat(v.body.x+Math.sin(a)*r,v.body.y+u*2.6-0.4,v.body.z+Math.cos(a)*r,0,a,0,1-u*0.6,1-u*0.6,1-u*0.6));
      this.motes.setColorAt(motes,dying?REFLECT:GOLD);motes++;
    }
    this.motes.count=motes; this.motes.visible=motes>0;
  }

  /** До боя: где Сердце, насколько оно светится принятым светом (0…1) и удар его пульса (0…1). */
  setPrelude(x:number,y:number,z:number,glow:number,pulse:number):void {
    const p=this.prelude;p.x=x;p.y=y;p.z=z;p.glow=Math.max(0,Math.min(1,glow));p.pulse=Math.max(0,Math.min(1,pulse));
  }

  setSoul(x:number,y:number,z:number,visible:boolean):void {
    if(this.disposed)return;
    this.soul.set(x,y,z,visible);
  }

  dispose():void {
    if(this.disposed)return;this.disposed=true;
    const materials=new Set<THREE.Material>();
    this.group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    for(const m of materials)m.dispose();
    this.group.removeFromParent();this.group.clear();
  }
}
