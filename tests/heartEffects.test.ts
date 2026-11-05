import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeartEffects, type HeartEffectsView } from '../src/gen/zone/heartEffects';

function view():HeartEffectsView {
  return {centerZ:-82,active:true,dead:false,body:{x:0,y:3.8,z:-82},beat:.5,lit:[true,false,false],heat:[.6,0,0],braziers:[{x:-11,z:-79},{x:11,z:-79},{x:0,z:-92.5}],shots:[{id:1,x:4,y:1.2,z:-76,r:.82,vx:1,vz:1,alive:true,reflected:false,life:3}],fields:[{id:2,x:-8,z:-80,r:3,life:2,dur:3,kind:'wax'}],carriers:new Map([[4,{x:-5,z:-83,dead:false,state:'spawn',stateT:.3}]]),attack:null};
}

describe('отдельные эффекты Погребального сердца',()=>{
  it('показывает крупный снаряд и меняет его цвет при настоящем отражении',()=>{
    const fx=new HeartEffects(),v=view();
    try {
      fx.update(.1,v);
      const shots=fx.group.getObjectByName('heart-projectiles') as THREE.InstancedMesh;
      expect(shots.count).toBe(1);
      const m=new THREE.Matrix4(),color=new THREE.Color();shots.getMatrixAt(0,m);
      expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(.82);
      shots.getColorAt(0,color);expect(color.r).toBeGreaterThan(color.b);
      v.shots[0].reflected=true;fx.update(.1,v);shots.getColorAt(0,color);expect(color.b).toBeGreaterThan(color.r);
      // Огненосец несёт пламя над головой: золотой язык и белое ядро.
      expect((fx.group.getObjectByName('votive-carriers') as THREE.InstancedMesh).count).toBe(2);
      expect((fx.group.getObjectByName('heart-firefields') as THREE.InstancedMesh).count).toBe(1);
      // Воск павшего огненосца — золотой купол; прилив закрывает пол, оставляя окно под куполом.
      expect((fx.group.getObjectByName('heart-wax-domes') as THREE.InstancedMesh).count).toBe(1);
      const tide=fx.group.getObjectByName('heart-flood-tide') as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
      expect(tide.visible).toBe(false);
      fx.update(.1,{...v,flood:{front:12,inner:4.6,outer:21,level:1,crash:0,hold:false},drops:[{id:9,x:2,z:-80,r:1.5,t:1.1,dur:1.2},{id:10,x:3,z:-80,r:1.5,t:0.2,dur:1.2}]});
      expect(tide.visible).toBe(true);expect(tide.material.uniforms.uFront.value).toBe(12);
      const slots=tide.material.uniforms.uDomes.value as THREE.Vector3[];
      expect(slots[0].x).toBe(-8);expect(slots[0].y).toBe(-80);expect(slots[0].z).toBeGreaterThan(0);expect(slots[1].z).toBeLessThan(0);
      // Падает только капля, которой до удара меньше 0.45 с.
      expect((fx.group.getObjectByName('heart-wax-drops') as THREE.InstancedMesh).count).toBe(1);
      const arteries=fx.group.getObjectByName('heart-arteries') as THREE.InstancedMesh;
      expect(arteries.count).toBe(26); // 24 участка трёх артерий, нить рождения и движущаяся искра
      v.carriers.get(4)!.state='idle';fx.update(.1,v);expect(arteries.count).toBe(24);
      v.dead=true;fx.update(.1,v);
      for(const name of ['heart-projectiles','votive-carriers','heart-firefields','heart-arteries','heart-wax-domes','heart-wax-drops'])expect((fx.group.getObjectByName(name) as THREE.InstancedMesh).count).toBe(0);
      expect(tide.visible).toBe(false);
    }finally{fx.dispose();}
  });
  it('ведёт огненный дух по ходу полёта со шлейфом и искрами и освобождает все instance buffers один раз',()=>{
    const fx=new HeartEffects(),disposed=new Set<THREE.InstancedMesh>(),instances=new Set<THREE.InstancedMesh>();
    fx.group.traverse(o=>{if(o instanceof THREE.InstancedMesh){instances.add(o);o.addEventListener('dispose',()=>disposed.add(o));}});
    const v={...view(),active:false};
    fx.setSoul(0,2,-58,true);fx.update(1/60,v);fx.setSoul(0,2.1,-58.5,true);fx.setSoul(0,2.2,-60,true);fx.update(1/60,v);
    expect(fx.soul.visible).toBe(true);expect(fx.soul.body.position.toArray()).toEqual([0,2.2,-60]);
    expect(fx.soul.trailPoints).toBe(3);
    // Тело и языки пламени смотрят по ходу полёта, а не стоят шаром.
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(fx.soul.body.quaternion);expect(forward.z).toBeLessThan(-0.8);
    for(const name of ['heart-soul-core','heart-soul-flames','heart-soul-halo','heart-soul-ribbon'])expect(fx.group.getObjectByName(name)?.visible,name).toBe(true);
    for(let i=0;i<12;i++){fx.setSoul(0,2.2,-60-i*0.25,true);fx.update(1/60,v);}
    expect(fx.soul.liveSparks).toBeGreaterThan(0);
    fx.setSoul(0,0,0,false);
    expect(fx.soul.visible).toBe(false);expect(fx.soul.trailPoints).toBe(0);expect(fx.soul.liveSparks).toBe(0);
    expect(fx.group.getObjectByName('heart-soul-ribbon')?.visible).toBe(false);
    fx.dispose();fx.dispose();expect(disposed).toEqual(instances);expect(fx.group.children).toHaveLength(0);
  });
});
