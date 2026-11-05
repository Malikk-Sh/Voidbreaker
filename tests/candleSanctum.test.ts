import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CandleSanctum } from '../src/gen/zone/candleSanctum';
import { inArenaShape } from '../src/data/arenas';
import { buildArenaView, ZONE1_LOOK } from '../src/gen/zone/arenaView';
import { Arena } from '../src/world/arena';
import { heartArena, heartEncounter } from '../src/world/heartPassage';

const created: CandleSanctum[] = [];
const make = () => { const s = new CandleSanctum(); created.push(s); return s; };
afterEach(() => { for (const s of created.splice(0)) s.root.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } }); });
const scaleAt = (mesh: THREE.InstancedMesh, i: number) => {
  const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
  return new THREE.Vector3().setFromMatrixScale(matrix).length();
};

describe('Погребальное сердце: видимое состояние ритуала', () => {
  it('создаёт свечи на полу и корректные цветовые данные для стандартного материала проводников', () => {
    const s = make();
    expect(s.flames.length).toBeGreaterThan(80);
    for (const [x,y,z] of s.flames) { expect(inArenaShape({id:'heart-test',tile:1.5,edge:'wall',decor:'candles',parts:[heartEncounter(27)],holes:[{kind:'circle',x:0,z:-.5,w:10,h:8}]},x,z)).toBe(true); expect(y).toBeGreaterThan(0); }
    const guides = s.root.getObjectByName('ritual-sector-traces') as THREE.Mesh;
    const color = guides.geometry.getAttribute('color');
    expect(color.count).toBe(guides.geometry.getAttribute('position').count);
    expect(Array.from(color.array).every(Number.isFinite)).toBe(true);
  });
  it('держит незажжённые чаши без огня; показывает только горящие жаровни и переносимые искры', () => {
    const s = make(), fire = s.root.getObjectByName('brazier-flames') as THREE.InstancedMesh;
    const embers = s.root.getObjectByName('carried-embers') as THREE.InstancedMesh;
    expect([0,1,2].map(i => scaleAt(fire,i))).toEqual([0,0,0]);
    s.update(0.2, { drain: 1, lit: [false,true,false], broken: false, carried: 2, chargingIndex: 0, charge: 0.5, warning: 0.7, hero: {x:1,z:3} });
    expect(scaleAt(fire,0)).toBe(0); expect(scaleAt(fire,1)).toBeGreaterThan(0); expect(scaleAt(fire,2)).toBe(0);
    expect(scaleAt(embers,0)).toBeGreaterThan(0); expect(scaleAt(embers,1)).toBeGreaterThan(0); expect(scaleAt(embers,2)).toBe(0);
    s.update(1, { drain: 0, lit: [true,true,true], broken: true, carried: 2, chargingIndex: -1, charge: 0, hero: {x:1,z:3} });
    expect([0,1,2].map(i => scaleAt(embers,i))).toEqual([0,0,0]);
    s.root.traverse(o => { if (o instanceof THREE.InstancedMesh) expect(Array.from(o.instanceMatrix.array).every(Number.isFinite)).toBe(true); });
  });
  it('просыпается, открывает броню и следует телу; три огня не означают смерть босса', () => {
    const s=make(),core=s.root.getObjectByName('heart-core') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
    const boss={centerZ:-82,body:{x:2,y:3.8,z:-85},phase:1,hp:900,maxHp:900,exposed:0,beat:.5,active:false,dead:false,awakening:0};
    const state={drain:1,lit:[true,true,true],broken:true,carried:0,chargingIndex:-1,charge:0,boss};
    s.update(1,state);expect(core.position.toArray()).toEqual([2,3.8,-3]);expect(core.material.opacity).toBeLessThan(.2);
    boss.active=true;boss.awakening=1;s.update(1,state);expect(core.material.opacity).toBeGreaterThan(.7);
    boss.phase=3;boss.exposed=2;boss.body={x:-7,y:1.35,z:-82};s.update(.5,state);
    expect(core.position.toArray()).toEqual([-7,1.35,0]);expect(core.material.opacity).toBeGreaterThan(.7);
    boss.dead=true;s.update(1,state);expect(core.material.opacity).toBeLessThan(.1);
  });
  it('нагретая чаша становится золотой и пульсирует до розжига, оставаясь без пламени', () => {
    const s=make(), rings=s.root.getObjectByName('brazier-heat-rings') as THREE.InstancedMesh;
    const fire=s.root.getObjectByName('brazier-flames') as THREE.InstancedMesh;
    const cold=new THREE.Color(),hot=new THREE.Color();rings.getColorAt(0,cold);
    const boss={centerZ:0,body:{x:0,y:3.8,z:0},phase:1,hp:720,maxHp:720,exposed:0,beat:.5,active:true,dead:false,heat:[1,0,0]};
    s.update(.1,{drain:1,lit:[false,false,false],broken:false,carried:0,chargingIndex:-1,charge:0,boss});
    rings.getColorAt(0,hot);expect(hot.r).toBeGreaterThan(cold.r*3);
    expect(scaleAt(rings,0)).toBeGreaterThan(scaleAt(rings,1));
    expect(scaleAt(fire,0)).toBe(0);
  });
  it('выход из зала освобождает отдельные ресурсы экземпляров пола и ритуала', () => {
    const view = buildArenaView(new Arena(heartArena({id:'heart-cleanup',tile:1.5,edge:'wall',decor:'candles',parts:[heartEncounter(27)]},27)), 'sanctum:cleanup', ZONE1_LOOK, 0.65, true);
    const instances = new Set<THREE.InstancedMesh>(), disposed = new Set<THREE.InstancedMesh>();
    view.root.traverse(o => { if (o instanceof THREE.InstancedMesh) { instances.add(o); o.addEventListener('dispose', () => disposed.add(o)); } });
    expect(instances.size).toBeGreaterThan(4); // четыре динамических батча ритуала и плитки общего пола
    for (const floor of view.floor) expect(instances.has(floor)).toBe(true);
    view.dispose();
    expect(disposed).toEqual(instances);
  });
});
