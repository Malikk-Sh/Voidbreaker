import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { candleVisibility, Flames, LightPools } from '../src/vfx/ambient';

const POINTS: [number, number, number][] = [
  [0, 1, 1], [1, 1, 0], [0, 1, -1], [-1, 1, 0], [-1e-15, 1, 1],
];
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });

function setup() {
  const flames = new Flames(POINTS);
  const pools = new LightPools(80);
  pools.setStatic(POINTS.map(([x, , z]) => ({ x, z, r: 2, color: '#ffffff', intensity: 2, flicker: 1 })));
  cleanup.push(() => {
    flames.dispose();
    pools.mesh.geometry.dispose();
    (pools.mesh.material as THREE.Material).dispose();
  });
  const lit = flames.mesh.geometry.getAttribute('iLit') as THREE.InstancedBufferAttribute;
  const colors = pools.mesh.geometry.getAttribute('iB') as THREE.InstancedBufferAttribute;
  const smoke: [number, number, number][] = [];
  const color = (i: number) => [colors.getX(i), colors.getY(i), colors.getZ(i)];
  const update = (frac = 0, dt = 1, from = 0) => {
    flames.douse(0, 0, from, frac, dt, smoke);
    pools.douse(0, 0, from, frac);
    pools.tintNear(0, 0, 10, [1, 0, 0], 0);
    pools.commit();
  };
  return { flames, pools, lit, colors, color, smoke, update };
}

describe('свечи: угловое гашение и видимость отдельных источников', () => {
  it('полный круг выключает все источники, включая шов угла; нулевая доля зажигает их', () => {
    for (const [x, , z] of POINTS) for (const from of [0, Math.PI, -Math.PI, 9 * Math.PI]) {
      expect(candleVisibility(x, z, 0, 0, from, 0)).toBe(1);
      expect(candleVisibility(x, z, 0, 0, from, 1)).toBe(0);
      expect(candleVisibility(x, z, 0, 0, from, 2)).toBe(0);
    }
    const { lit, colors, color, update } = setup();
    expect(lit).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(colors).toBeInstanceOf(THREE.InstancedBufferAttribute);
    update(1);
    for (let i = 0; i < POINTS.length; i++) {
      expect(lit.getX(i)).toBe(0);
      expect(color(i)).toEqual([0, 0, 0]);
    }
    update(0);
    for (let i = 0; i < POINTS.length; i++) {
      expect(lit.getX(i)).toBe(1);
      expect(color(i)).toEqual([2, 2, 2]);
    }
  });

  it('сохраняет быстрое затухание, медленное зажигание и один дымок на каждое гашение', () => {
    const { lit, smoke, update } = setup();
    update(1, 0.05);
    expect(lit.getX(0)).toBeCloseTo(0.5);
    expect(smoke).toHaveLength(POINTS.length);
    update(1, 0.05);
    update(1, 1);
    expect(lit.getX(0)).toBe(0);
    expect(smoke).toHaveLength(POINTS.length);
    update(0, 0.2);
    expect(lit.getX(0)).toBeCloseTo(0.5);
    update(0, 0.2);
    expect(lit.getX(0)).toBe(1);
    update(1, 0.1);
    expect(smoke).toHaveLength(POINTS.length * 2);
  });

  it('маска использует мировые x/z и умножается на угловой сектор у пламени и света', () => {
    const { flames, pools, lit, color, update } = setup();
    const mask = (x: number, z: number) => x < 0 ? 0 : z < 0 ? 0.25 : 1;
    flames.setVisibility(mask);
    pools.setVisibility(mask);
    update(0.25);
    const expected = [0, 1, 0.25, 0, 0];
    for (let i = 0; i < POINTS.length; i++) {
      expect(lit.getX(i)).toBe(expected[i]);
      expect(color(i)).toEqual([2 * expected[i], 2 * expected[i], 2 * expected[i]]);
    }
  });

  it('читает изменившуюся маску каждый кадр и восстанавливает источники после её снятия', () => {
    const { flames, pools, lit, color, smoke, update } = setup();
    let visibility = 1;
    const mask = () => visibility;
    flames.setVisibility(mask);
    pools.setVisibility(mask);
    update();
    visibility = 0;
    update();
    update();
    expect(smoke).toHaveLength(POINTS.length);
    for (let i = 0; i < POINTS.length; i++) {
      expect(lit.getX(i)).toBe(0);
      expect(color(i)).toEqual([0, 0, 0]);
    }
    flames.setVisibility(null);
    pools.setVisibility(null);
    update(0, 0.2);
    expect(lit.getX(0)).toBeCloseTo(0.5);
    expect(color(0)).toEqual([2, 2, 2]);
    update();
    expect(lit.getX(0)).toBe(1);
  });

  it('нулевая видимость убирает и окрашенный свет, не затрагивая динамические источники', () => {
    const { pools, color } = setup();
    pools.setVisibility(() => 0);
    pools.tintNear(0, 0, 10, [1, 0, 0], 1);
    pools.beginDynamic();
    pools.addDynamic(0, 0, 1, [0.5, 0.25, 1], 2);
    pools.commit();
    for (let i = 0; i < POINTS.length; i++) expect(color(i)).toEqual([0, 0, 0]);
    expect(color(POINTS.length)).toEqual([1, 0.5, 2]);
  });

  it('радиальное quench сохраняет прежний мягкий минимум и восстанавливается', () => {
    const { flames, pools, lit, color, smoke, update } = setup();
    flames.quench(0, 0, 3, 1, smoke);
    pools.quench(0, 0, 3);
    pools.tintNear(0, 0, 10, [1, 0, 0], 0);
    expect(lit.getX(0)).toBe(0);
    for (const v of color(0)) expect(v).toBeCloseTo(0.24);
    pools.quench(0, 0, 0);
    update();
    expect(lit.getX(0)).toBe(1);
    expect(color(0)).toEqual([2, 2, 2]);
  });

  it('нулевой радиус окраски и маски на границах не дают NaN или отрицательную яркость', () => {
    const { flames, pools, lit, colors, color, update } = setup();
    for (const value of [-1, 0, 0.5, 1, 2]) {
      flames.setVisibility(() => value);
      pools.setVisibility(() => value);
      update();
      // Нулевой радиус в самой позиции источника раньше приводил к 0/0.
      pools.tintNear(POINTS[0][0], POINTS[0][2], 0, [1, 0, 0], 1);
      for (let i = 0; i < POINTS.length; i++) {
        expect(Number.isFinite(lit.getX(i))).toBe(true);
        expect(lit.getX(i)).toBeGreaterThanOrEqual(0);
        for (const v of color(i)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
        expect(Number.isFinite(colors.getW(i))).toBe(true);
      }
    }
  });
});
