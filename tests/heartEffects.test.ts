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
      expect((fx.group.getObjectByName('votive-carriers') as THREE.InstancedMesh).count).toBe(1);
      expect((fx.group.getObjectByName('heart-firefields') as THREE.InstancedMesh).count).toBe(1);
      const arteries=fx.group.getObjectByName('heart-arteries') as THREE.InstancedMesh;
      expect(arteries.count).toBe(26); // 24 участка трёх артерий, нить рождения и движущаяся искра
      v.carriers.get(4)!.state='idle';fx.update(.1,v);expect(arteries.count).toBe(24);
      v.dead=true;fx.update(.1,v);
      for(const name of ['heart-projectiles','votive-carriers','heart-firefields','heart-arteries'])expect((fx.group.getObjectByName(name) as THREE.InstancedMesh).count).toBe(0);
    }finally{fx.dispose();}
  });
  it('ведёт отдельную душу со следом и освобождает все instance buffers один раз',()=>{
    const fx=new HeartEffects(),disposed=new Set<THREE.InstancedMesh>(),instances=new Set<THREE.InstancedMesh>();
    fx.group.traverse(o=>{if(o instanceof THREE.InstancedMesh){instances.add(o);o.addEventListener('dispose',()=>disposed.add(o));}});
    fx.setSoul(0,2,-58,true);fx.setSoul(0,3,-60,true);
    expect(fx.soul.visible).toBe(true);expect(fx.soul.position.toArray()).toEqual([0,3,-60]);
    expect((fx.group.getObjectByName('soul-trail') as THREE.InstancedMesh).count).toBe(2);
    fx.setSoul(0,0,0,false);expect(fx.soul.visible).toBe(false);expect((fx.group.getObjectByName('soul-trail') as THREE.InstancedMesh).count).toBe(0);
    fx.dispose();fx.dispose();expect(disposed).toEqual(instances);expect(fx.group.children).toHaveLength(0);
  });
});
