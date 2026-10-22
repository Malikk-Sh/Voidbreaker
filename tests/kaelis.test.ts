import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KAELIS, KaelisDrone } from '../src/vfx/kaelis';

const cam = new THREE.PerspectiveCamera();
cam.position.set(0, 18, 12);
const pos = new THREE.Vector3(0.6, 2, 0), hero = new THREE.Vector3();
const run = (k: KaelisDrone, sec: number, hp = 1, ult = false) => { for (let t = 0; t < sec; t += 1 / 60) k.update(1 / 60, pos, hp, ult, hero, cam); };

describe('Каэлис живая (план §8.6)', () => {
  it('грани пульсируют в такт слогам речи и затихают после реплики', () => {
    const k = new KaelisDrone();
    run(k, 0.2);
    expect(k.speech).toBe(0);
    k.speak([[0.05, 0.08], [0.2, 0.08], [0.35, 0.08]]);
    let peaks = 0, was = 0;
    for (let t = 0; t < 0.6; t += 1 / 120) {
      k.update(1 / 120, pos, 1, false, hero, cam);
      if (k.speech > 0.9 && was <= 0.9) peaks++;
      was = k.speech;
    }
    expect(peaks).toBe(3);
    run(k, 1);
    expect(k.speech).toBe(0);
  });

  it('луч-указатель живёт 0.5 с', () => {
    const k = new KaelisDrone();
    k.point(5, 1, -3);
    run(k, 0.1);
    expect(k.beamMesh.visible).toBe(true);
    run(k, KAELIS.beam);
    expect(k.beamMesh.visible).toBe(false);
  });

  it('при низком HP мерцает красным, на ульте кольцо раскрывается вокруг Пилота', () => {
    const k = new KaelisDrone();
    const shell = k.group.children[0] as THREE.Mesh, ring = k.group.children[2] as THREE.Mesh;
    const col = () => (shell.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color;
    run(k, 0.5, 1);
    expect(col().r).toBeLessThan(0.8);
    let red = 0;
    for (let t = 0; t < 1; t += 1 / 60) { k.update(1 / 60, pos, 0.1, false, hero, cam); red = Math.max(red, col().r - col().b); }
    expect(red).toBeGreaterThan(0.3);
    run(k, 1, 1, true);
    expect(ring.scale.x).toBeGreaterThan(KAELIS.ringOpen * 0.9);
    run(k, 2, 1, false);
    expect(ring.scale.x).toBeLessThan(1.2);
  });
});
