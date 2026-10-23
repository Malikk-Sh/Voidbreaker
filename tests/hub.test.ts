import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HUB_FRAME, hubFraming, type ScreenFrame } from '../src/game/showcase';

/** Экранная точка (доли, y — сверху) мировой точки p для камеры с кадром Святилища. */
function frameCamera(f: ScreenFrame, aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(30, aspect, 0.1, 200);
  const look = new THREE.Vector3(0, HUB_FRAME.cy, 1.6);
  cam.position.set(Math.sin(0.25) * HUB_FRAME.dist, 2.9, 1.6 + Math.cos(0.25) * HUB_FRAME.dist);
  cam.lookAt(look);
  const fr = hubFraming(f, cam.position.distanceTo(look));
  cam.fov = fr.fov;
  const W = 1000 * aspect, H = 1000;
  cam.setViewOffset(W, H, fr.dx * W, fr.dy * H, W, H);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}
const screen = (cam: THREE.Camera, x: number, y: number, z: number) => {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
};

describe('кадр Святилища (этап 4.5, A3)', () => {
  // свободная область слева от панели: телефон 844×390, 740×360, 16:9, 4:3, 20:9 (по замерам экрана Святилища)
  const cases: [string, number, ScreenFrame][] = [
    ['844×390', 844 / 390, { x0: 0.01, y0: 0.2, x1: 0.39, y1: 0.7 }],
    ['740×360', 740 / 360, { x0: 0.01, y0: 0.21, x1: 0.38, y1: 0.69 }],
    ['1280×720', 1280 / 720, { x0: 0.01, y0: 0.12, x1: 0.55, y1: 0.83 }],
    ['1024×768', 1024 / 768, { x0: 0.01, y0: 0.1, x1: 0.38, y1: 0.84 }],
    ['1600×720', 1600 / 720, { x0: 0.01, y0: 0.12, x1: 0.6, y1: 0.83 }],
  ];
  for (const [name, aspect, f] of cases) {
    it(`${name}: Пилот с клинком — в центре свободной области и целиком в ней`, () => {
      const cam = frameCamera(f, aspect);
      const c = screen(cam, 0, HUB_FRAME.cy, 1.6);
      expect(c.x).toBeCloseTo((f.x0 + f.x1) / 2, 2);
      expect(c.y).toBeCloseTo((f.y0 + f.y1) / 2, 2);
      const top = screen(cam, 0, HUB_FRAME.cy + HUB_FRAME.h / 2, 1.6), bottom = screen(cam, 0, HUB_FRAME.cy - HUB_FRAME.h / 2, 1.6);
      expect(top.y).toBeGreaterThan(f.y0);
      expect(bottom.y).toBeLessThan(f.y1);
      // клинок у бедра и плечи — по горизонтали в области
      for (const dx of [-0.6, 0.6]) {
        const p = screen(cam, dx, 1.0, 1.6);
        expect(p.x).toBeGreaterThan(f.x0);
        expect(p.x).toBeLessThan(f.x1);
      }
    });
  }
});
