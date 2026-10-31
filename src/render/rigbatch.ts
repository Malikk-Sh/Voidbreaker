import * as THREE from 'three';
import { casterMaterial, CASTER_ORDER } from './keyShadow';
import { obsidianMaterial, type ObsidianMaterial, type ObsidianOpts } from './materials';

/**
 * Батч шарнирных кукол (Tech §7.1): вся геометрия типа персонажа слита в один меш с индексом сустава в вершине;
 * мировые матрицы суставов всех экземпляров — в float-текстуре (строка = экземпляр).
 * Итог: все Шипники на экране — один draw call; остаточные изображения — тот же батч с «призрачным» материалом.
 */
export class RigBatch {
  readonly mesh: THREE.Mesh;
  readonly material: ObsidianMaterial;
  readonly joints: number;
  readonly max: number;
  private readonly bones: Float32Array;
  private readonly tex: THREE.DataTexture;
  private readonly fx: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;
  count = 0;

  constructor(source: THREE.BufferGeometry, joints: number, max: number, opts: ObsidianOpts) {
    this.joints = joints;
    this.max = max;
    this.geo = new THREE.InstancedBufferGeometry();
    for (const name of Object.keys(source.attributes)) this.geo.setAttribute(name, source.attributes[name]);
    this.bones = new Float32Array(joints * 4 * max * 4);
    this.tex = new THREE.DataTexture(this.bones, joints * 4, max, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.fx = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.fx.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iFx', this.fx);
    this.geo.instanceCount = 0;
    this.material = obsidianMaterial({ ...opts, rigged: true });
    this.material.uniforms.uBones.value = this.tex;
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  begin(): void { this.count = 0; }

  /** world — мировые матрицы суставов подряд (16 × joints). Возвращает false, если батч переполнен. */
  push(world: Float32Array, flash: number, dissolve: number, boost: number, crack: number): boolean {
    if (this.count >= this.max) return false;
    const row = this.count++;
    this.bones.set(world.subarray(0, this.joints * 16), row * this.joints * 16);
    const f = this.fx.array as Float32Array, o = row * 4;
    f[o] = flash; f[o + 1] = dissolve; f[o + 2] = boost; f[o + 3] = crack;
    return true;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.tex.needsUpdate = true;
      this.fx.needsUpdate = true;
    }
  }

  /**
   * Тень батча для буфера света (план ×100, A2): тот же меш и те же матрицы суставов, материал заслонителя проецирует
   * кукол на пол вдоль ключевого света. Видимость и число экземпляров — общие с батчем.
   */
  casterMesh(): THREE.Mesh {
    const m = new THREE.Mesh(this.geo, casterMaterial(true, this.tex));
    m.frustumCulled = false;
    m.renderOrder = CASTER_ORDER;
    return m;
  }

  /** Батч с другим материалом (призраки) поверх тех же вершин. */
  static sibling(src: RigBatch, max: number, opts: ObsidianOpts): RigBatch {
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(src.geo.attributes)) if (name !== 'iFx') g.setAttribute(name, src.geo.attributes[name]);
    return new RigBatch(g, src.joints, max, opts);
  }

  dispose(): void {
    this.geo.dispose(); this.tex.dispose(); this.material.dispose();
  }
}
