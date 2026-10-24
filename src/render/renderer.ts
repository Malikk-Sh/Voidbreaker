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
  // высокое: DPR 1.75 и MSAA 2× — на 6–7" экране разница с 2.0/4× почти не видна, а пикселей и сэмплов на ~40 % меньше
  high: { scale: 1.0, maxDpr: 1.75, bloomLevels: 4, msaa: 2, particles: 4000, decor: 1.0, verlet: 4, farLayers: 3 },
};

/** Игровой угол обзора камеры (вертикальный, °). */
export const CAM_FOV = 30;

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
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 1, 900);
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

  /**
   * Прогреть шейдеры всей сцены (включая скрытые пулы эффектов и батчи врагов) заранее — без фриза на первом
   * появлении эффекта или Стража посреди боя. Компиляция — под тот же целевой буфер, что и кадр (иначе ключ
   * программы другой), асинхронно там, где есть KHR_parallel_shader_compile.
   */
  warmShaders(): Promise<unknown> {
    this.camera.updateMatrixWorld();
    this.gl.setRenderTarget(this.post.sceneRT);
    let p: Promise<unknown>;
    try {
      // без расширения compileAsync всё равно компилирует синхронно (и предупреждает) — тогда сразу compile
      if (this.gl.extensions.has('KHR_parallel_shader_compile')) p = this.gl.compileAsync(this.scene, this.camera);
      else { this.gl.compile(this.scene, this.camera); p = Promise.resolve(); }
    } catch { p = Promise.resolve(); }
    this.gl.setRenderTarget(null);
    return p.catch(() => undefined);
  }

  /**
   * Пробный кадр 8×8 по всем объектам root — и скрытым, и пустым батчам (на миг видимы, по экземпляру): буферы
   * геометрии и текстуры заливаются, драйвер собирает состояние отрисовки заранее. Без этого первое появление
   * объекта (корабль пролога, лучи, шрамы на полу) — рывок даже с прогретыми шейдерами. Тот же целевой буфер,
   * что и у кадра (иначе программы другие); следующий кадр его перезапишет.
   */
  prewarm(root: THREE.Object3D = this.scene): void {
    const vis: [THREE.Object3D, boolean, boolean][] = [];
    const inst: [{ count: number } | { instanceCount: number }, number][] = [];
    root.traverse((o) => {
      vis.push([o, o.visible, o.frustumCulled]);
      o.visible = true; o.frustumCulled = false;
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh && im.count === 0) { inst.push([im, 0]); im.count = 1; }
      const g = (o as THREE.Mesh).geometry as THREE.InstancedBufferGeometry | undefined;
      if (g?.isInstancedBufferGeometry && g.instanceCount === 0) { inst.push([g, 0]); g.instanceCount = 1; }
    });
    const rt = this.post.sceneRT;
    _vp.copy(rt.viewport); _sc.copy(rt.scissor);
    const st = rt.scissorTest;
    rt.viewport.set(0, 0, 8, 8); rt.scissor.set(0, 0, 8, 8); rt.scissorTest = true;
    this.camera.updateMatrixWorld();
    this.gl.setRenderTarget(rt);
    try { this.gl.render(this.scene, this.camera); } catch { /* пробный кадр — не критично */ }
    this.gl.setRenderTarget(null);
    rt.viewport.copy(_vp); rt.scissor.copy(_sc); rt.scissorTest = st;
    for (const [o, v, f] of vis) { o.visible = v; o.frustumCulled = f; }
    for (const [x, n] of inst) { if ('count' in x) x.count = n; else x.instanceCount = n; }
  }

  /** Прогреть всё: шейдеры (параллельно, где можно), затем пробный кадр. alive — объект ещё нужен. */
  warmAll(root: THREE.Object3D, alive: () => boolean = () => true): Promise<void> {
    return this.warmShaders().then(() => { if (alive()) this.prewarm(root); });
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

  /** Точка пола (y = 0) под экранной точкой (CSS-пиксели); null — луч не пересекает пол. */
  screenToFloor(sx: number, sy: number, out: { x: number; z: number }): { x: number; z: number } | null {
    const cam = this.camera;
    _v.set((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1, 0.5).unproject(cam).sub(cam.position);
    if (_v.y > -1e-4) return null;
    const k = -cam.position.y / _v.y;
    out.x = cam.position.x + _v.x * k; out.z = cam.position.z + _v.z * k;
    return out;
  }

  get width(): number { return this.cssW; }
  get height(): number { return this.cssH; }
}

const _v = new THREE.Vector3();
const _vp = new THREE.Vector4(), _sc = new THREE.Vector4();
