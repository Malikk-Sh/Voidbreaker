import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CandleSanctum } from '../src/gen/zone/candleSanctum';
import { ARENAS, inArenaShape } from '../src/data/arenas';
import { buildArenaView, ZONE1_LOOK } from '../src/gen/zone/arenaView';
import { Arena } from '../src/world/arena';

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
    for (const [x,y,z] of s.flames) { expect(inArenaShape(ARENAS.candles,x,z)).toBe(true); expect(y).toBeGreaterThan(0); }
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
  it('выход из зала освобождает отдельные ресурсы экземпляров пола и ритуала', () => {
    const view = buildArenaView(new Arena(ARENAS.candles), 'sanctum:cleanup', ZONE1_LOOK, 0.65);
    const instances = new Set<THREE.InstancedMesh>(), disposed = new Set<THREE.InstancedMesh>();
    view.root.traverse(o => { if (o instanceof THREE.InstancedMesh) { instances.add(o); o.addEventListener('dispose', () => disposed.add(o)); } });
    expect(instances.size).toBeGreaterThan(4); // четыре динамических батча ритуала и плитки общего пола
    for (const floor of view.floor) expect(instances.has(floor)).toBe(true);
    view.dispose();
    expect(disposed).toEqual(instances);
  });
});
