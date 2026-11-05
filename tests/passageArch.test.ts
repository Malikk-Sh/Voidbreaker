import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { passageArch } from '../src/gen/zone/gatePath';

describe('walk-through gallery arches', () => {
  it.each([[6.3, 4.3, 0.5, 0.8], [7, 4.8, 0.75, 1.2]])('keeps a clear floor-level opening in a %s-unit arch', (span, springH, wall, depth) => {
    const geometry = passageArch(span, springH, wall, depth);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const arch = new THREE.Mesh(geometry, material);
    const ray = new THREE.Raycaster();
    const through = (x: number, y: number) => {
      ray.set(new THREE.Vector3(x, y, depth + 1), new THREE.Vector3(0, 0, -1));
      return ray.intersectObject(arch);
    };
    // Камера смотрит через ближнюю арку под углом к полу; даже низкая фаска не должна закрывать весь проход.
    for (const x of [-0.85, -0.4, 0, 0.4, 0.85]) for (const y of [0, 0.025, 0.05, 0.1, 1, springH - 0.1]) {
      expect(through(x * span / 2, y), `opening at x=${x}, y=${y}`).toHaveLength(0);
    }
    expect(through(span / 2 + wall / 2, springH / 2).length).toBeGreaterThan(0);
    expect(through(0, springH + span * 0.87 + wall / 2).length).toBeGreaterThan(0);
    geometry.dispose(); material.dispose();
  });
});
