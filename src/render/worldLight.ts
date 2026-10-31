import * as THREE from 'three';
import { parseFx } from './fx';
import { G } from './materials';
import type { QualityLevel } from './renderer';

/**
 * Буфер света в мире (план ×100, A1): ортографическая камера сверху на арену рисует аддитивные пятна света —
 * свечи, трещины, клинок, ядра врагов, снаряды, вспышки — в текстуру. Пол и тела берут из неё одну выборку: пол —
 * цвет плиты × свет + блик × глянец, тела и декор — отсвет снизу. Источников сотни, пиксель платит одну выборку.
 * size — сторона текстуры по уровню качества (план: low 256², medium и high 512²); margin — запас за краем арены (м);
 * height — высота камеры над полом (м).
 */
export const LIGHT_BUF = { size: { low: 256, medium: 512, high: 512 } as Record<QualityLevel, number>, margin: 6, height: 30 };

/** Настройка «Новый свет»: авто — только на высоком качестве, пока нет замера на телефонах (протокол плана). */
export type LightMode = 'auto' | 'on' | 'off';

/**
 * Включён ли буфер света. Адрес ?light=on|off перекрывает всё (разработка, стенд кадров); ?fx=light и ?fx=off
 * выключают его, как и остальные эффекты апгрейда; иначе решает настройка.
 */
export function lightEnabled(mode: LightMode | undefined, quality: QualityLevel, search = typeof location !== 'undefined' ? location.search : ''): boolean {
  const q = new URLSearchParams(search).get('light');
  const m = q === 'on' || q === 'off' ? q : !parseFx(search).light ? 'off' : mode ?? 'auto';
  return m === 'on' || (m === 'auto' && quality === 'high');
}

/** Прямоугольник буфера по границам арены с запасом: левый и ближний край (м), 1/ширина, 1/глубина. */
export function lightRect(b: { minX: number; maxX: number; minZ: number; maxZ: number }, margin = LIGHT_BUF.margin, out = new THREE.Vector4()): THREE.Vector4 {
  const minX = b.minX - margin, minZ = b.minZ - margin;
  return out.set(minX, minZ, 1 / Math.max(1, b.maxX + margin - minX), 1 / Math.max(1, b.maxZ + margin - minZ));
}

/** UV буфера для точки пола — та же формула, что в шейдере материалов (camera.up = −Z: верх текстуры — ближний край). */
export function lightUv(x: number, z: number, r: THREE.Vector4): [number, number] {
  return [(x - r.x) * r.z, 1 - (z - r.y) * r.w];
}

/**
 * Камера, цель и сцена буфера. Сцена принадлежит буферу: в неё переносятся пятна света (LightPools) — их API не
 * меняется, меняется только то, куда они рисуются.
 */
export class WorldLight {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, LIGHT_BUF.height + 60);
  readonly rt: THREE.WebGLRenderTarget;

  constructor(size: number) {
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
  }

  /** Накрыть арену: камера над центром, пол — во весь кадр; униформа uLightRect — для выборки в материалах. */
  fit(b: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    const r = lightRect(b, LIGHT_BUF.margin, G.uLightRect.value);
    const w = 1 / r.z, d = 1 / r.w, cx = r.x + w / 2, cz = r.y + d / 2, c = this.camera;
    c.left = -w / 2; c.right = w / 2; c.top = d / 2; c.bottom = -d / 2;
    c.position.set(cx, LIGHT_BUF.height, cz);
    c.up.set(0, 0, -1);
    c.lookAt(cx, 0, cz);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  render(gl: THREE.WebGLRenderer): void {
    const prev = gl.getRenderTarget(), alpha = gl.getClearAlpha();
    gl.getClearColor(_clear);
    gl.setRenderTarget(this.rt);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, false, false);
    gl.render(this.scene, this.camera);
    gl.setRenderTarget(prev);
    gl.setClearColor(_clear, alpha);
  }

  dispose(): void { this.rt.dispose(); }
}

const _clear = new THREE.Color();
