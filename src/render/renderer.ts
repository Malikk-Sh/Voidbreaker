import * as THREE from 'three';
import { G, initSharedTextures } from './materials';
import { Post } from './post';
import { Sky } from './sky';

export type QualityLevel = 'low' | 'medium' | 'high';

/** Уровни качества (Tech §25.1). */
export const QUALITY: Record<QualityLevel, {
  scale: number; maxDpr: number; bloomLevels: number; msaa: number; particles: number; decor: number; verlet: number; farLayers: number;
}> = {
  low: { scale: 0.6, maxDpr: 1.0, bloomLevels: 0, msaa: 0, particles: 1500, decor: 0.4, verlet: 2, farLayers: 1 },
  medium: { scale: 0.8, maxDpr: 1.5, bloomLevels: 3, msaa: 0, particles: 2500, decor: 0.7, verlet: 3, farLayers: 2 },
  high: { scale: 1.0, maxDpr: 2.0, bloomLevels: 4, msaa: 4, particles: 4000, decor: 1.0, verlet: 4, farLayers: 3 },
};

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly post: Post;
  readonly sky = new Sky();
  quality: QualityLevel;
  /** Динамическое разрешение (авто-подстройка, Tech §25.2). */
  dynScale = 1;
  private cssW = 1; private cssH = 1;
  pixelW = 1; pixelH = 1;

  constructor(readonly canvas: HTMLCanvasElement, quality: QualityLevel) {
    this.quality = quality;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.gl.autoClear = false;
    this.gl.setClearColor(0x05070a, 1);
    initSharedTextures();
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 900);
    this.scene.add(this.sky.mesh);
    this.post = new Post(this.gl, QUALITY[quality].msaa);
    this.applyQuality();
  }

  setQuality(q: QualityLevel): void {
    this.quality = q;
    this.applyQuality();
  }

  private applyQuality(): void {
    const Q = QUALITY[this.quality];
    this.post.bloomLevels = Q.bloomLevels;
    this.post.bloomEnabled = Q.bloomLevels > 0;
    this.resize(this.cssW, this.cssH);
  }

  resize(w: number, h: number): void {
    this.cssW = Math.max(1, w); this.cssH = Math.max(1, h);
    const Q = QUALITY[this.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, Q.maxDpr);
    const s = Q.scale * this.dynScale * dpr;
    this.pixelW = Math.max(1, Math.round(this.cssW * s));
    this.pixelH = Math.max(1, Math.round(this.cssH * s));
    this.gl.setPixelRatio(1);
    this.gl.setSize(this.pixelW, this.pixelH, false);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();
    this.post.setSize(this.pixelW, this.pixelH, Q.msaa);
  }

  render(worldTime: number): void {
    G.uTime.value = worldTime;
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera);
    this.post.render(this.scene, this.camera);
  }

  /** Проекция мировой точки в CSS-пиксели экрана (для HUD: цифры урона, значки казни). */
  project(x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }): void {
    const v = _v.set(x, y, z).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.cssW;
    out.y = (-v.y * 0.5 + 0.5) * this.cssH;
    out.visible = v.z < 1 && v.z > -1;
  }

  get width(): number { return this.cssW; }
  get height(): number { return this.cssH; }
}

const _v = new THREE.Vector3();
