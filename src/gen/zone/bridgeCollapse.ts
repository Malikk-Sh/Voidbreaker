import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { BRIDGE_COLLAPSE, bridgeCollapseDelay } from '../../world/cathedralRoute';
import { GeomBuilder, mat, SURF } from '../geom/build';
import { box, shard, starPlate } from '../geom/prims';
import { candelabra, GOLD, OBS } from '../geom/kit';
import { obsidianMaterial } from '../../render/materials';
import type { ArenaView } from './arenaView';

interface Span { mesh: THREE.Mesh; z: number; delay: number; sign: number }
interface Fragment { x: number; z: number; delay: number; vx: number; vz: number; spin: number; scale: number }

/** Мост ломается теми же рядами, что игровая сетка; концы у зала и Врат остаются на месте. */
export class BridgeCollapseView {
  readonly group = new THREE.Group();
  private readonly spans: Span[] = [];
  private readonly fragments: Fragment[] = [];
  private readonly chips: THREE.InstancedMesh;
  private readonly dust: THREE.Mesh;
  private readonly dustData: Float32Array;
  private readonly dustAlpha: Float32Array;
  private started = false;
  private time = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3(0.4, 0.2, 0.8).normalize();

  constructor(view: ArenaView) {
    this.group.name = 'cathedral-bridge-collapse';
    const material = obsidianMaterial({ rim: '#3d6688', rimStrength: 0.14, emissive: '#5cc4e0', emissive2: '#FFB866' });
    const section = (z0: number, z1: number, fixed: boolean) => {
      const z = (z0 + z1) / 2, len = z1 - z0;
      const g = new GeomBuilder(); g.rng = new Rng(`cathedral:bridge:${z}`); g.color = OBS;
      for (const side of [-1, 1]) {
        g.add(box(0.5, 0.75, len), { matrix: mat(side * 2.9, 0.3, 0) });
        g.add(box(0.58, 0.12, len), { matrix: mat(side * 2.9, 0.74, 0), color: GOLD, surface: SURF.metal });
        g.add(box(0.8, 1.5, len), { matrix: mat(side * 2.3, -1.15, 0) });
        for (const pz of [-26, -31, -36, -41]) {
          if (pz < z0 || pz >= z1) continue;
          g.add(box(0.75, 1.2, 0.75), { matrix: mat(side * 2.9, 0.55, pz - z) });
          const c = candelabra(g, side * 2.85, pz - z, 1.3, 3, Math.abs(pz) + side);
          view.flames.push(...c.flames.map(([x, y, localZ]): [number, number, number] => [x, y, localZ + z]));
          view.pools.push({ x: side * 2.85, z: pz, r: 3, color: '#FFB866', intensity: 0.4, flicker: 1 });
        }
      }
      for (const pz of [-27, -32, -37, -42]) if (pz >= z0 && pz < z1) {
        g.add(starPlate(4, 0.28, 0.1, 0.012), { matrix: mat(0, 0.03, pz - z), color: GOLD, surface: SURF.metal });
      }
      const mesh = new THREE.Mesh(g.build(), material); mesh.position.z = z;
      this.group.add(mesh);
      if (fixed) view.casters.push(mesh);
      else this.spans.push({ mesh, z, delay: bridgeCollapseDelay(z), sign: this.spans.length % 2 ? -1 : 1 });
    };
    section(-45.5, -43.5, true);
    for (let i = 0; i < BRIDGE_COLLAPSE.rows; i++) {
      const z = BRIDGE_COLLAPSE.firstRowZ + i * BRIDGE_COLLAPSE.rowSize;
      section(z - BRIDGE_COLLAPSE.rowSize / 2, z + BRIDGE_COLLAPSE.rowSize / 2, false);
    }
    section(-28.5, -24, true);

    const rng = new Rng('cathedral:falling-masonry');
    for (const span of this.spans) for (let i = 0; i < 6; i++) this.fragments.push({
      x: (i % 2 ? -1 : 1) * rng.range(1.6, 3), z: span.z + rng.spread(0.6), delay: span.delay,
      vx: rng.spread(1.1), vz: rng.spread(0.7), spin: rng.spread(5), scale: rng.range(0.35, 0.9),
    });
    const chips = new GeomBuilder(); chips.color = OBS;
    chips.add(shard(0.55, 0.18, 4, 0.3, 428));
    this.chips = new THREE.InstancedMesh(chips.build(), material, this.fragments.length);
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.chips.count = 0; this.chips.frustumCulled = false;
    this.group.add(this.chips);

    const quad = new THREE.PlaneGeometry(1, 1), dustGeometry = new THREE.InstancedBufferGeometry();
    dustGeometry.setAttribute('position', quad.getAttribute('position').clone());
    dustGeometry.setAttribute('uv', quad.getAttribute('uv').clone()); dustGeometry.setIndex(quad.index!.clone()); quad.dispose();
    this.dustData = new Float32Array(this.spans.length * 2 * 4); this.dustAlpha = new Float32Array(this.spans.length * 2);
    dustGeometry.setAttribute('iPuff', new THREE.InstancedBufferAttribute(this.dustData, 4).setUsage(THREE.DynamicDrawUsage));
    dustGeometry.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.dustAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    dustGeometry.instanceCount = 0;
    this.dust = new THREE.Mesh(dustGeometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute vec4 iPuff; attribute float iAlpha; varying vec2 vUv; varying float vAlpha; void main(){vUv=uv;vAlpha=iAlpha;vec4 p=modelViewMatrix*vec4(iPuff.xyz,1.);p.xy+=position.xy*iPuff.w;gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec2 vUv; varying float vAlpha; void main(){float r=length(vUv-.5)*2.;float a=pow(max(0.,1.-r*r),2.)*vAlpha;gl_FragColor=vec4(.24,.26,.29,a);}',
    }));
    this.dust.frustumCulled = false; this.group.add(this.dust);
    view.root.add(this.group);
  }

  start(): boolean {
    if (this.started) return false;
    this.started = true; return true;
  }

  /** Для общей маски свечей и пятен света: огни падающей секции гаснут вместе с опорой. */
  visibilityAt(x: number, z: number): number {
    if (!this.started || Math.abs(x) > 3.4 || z < -43.5 || z >= -28.5) return 1;
    return this.time >= bridgeCollapseDelay(z) ? 0 : 1;
  }

  step(dt: number): void {
    if (!this.started || dt <= 0) return;
    this.time = Math.min(BRIDGE_COLLAPSE.duration + 3, this.time + dt);
    for (const span of this.spans) {
      const age = Math.max(0, this.time - span.delay);
      span.mesh.position.set(span.sign * age * 0.18, -11 * age * age, span.z);
      span.mesh.rotation.set(span.sign * age * 0.12, 0, span.sign * age * 0.16);
      span.mesh.visible = age < 2.3;
    }
    let count = 0;
    for (const fragment of this.fragments) {
      const age = this.time - fragment.delay;
      if (age < 0 || age > 2.3) continue;
      this.position.set(fragment.x + fragment.vx * age, 0.35 + age * 0.8 - 11 * age * age, fragment.z + fragment.vz * age);
      this.rotation.setFromAxisAngle(this.axis, fragment.spin * age); this.scale.setScalar(fragment.scale);
      this.matrix.compose(this.position, this.rotation, this.scale); this.chips.setMatrixAt(count++, this.matrix);
    }
    this.chips.count = count; this.chips.instanceMatrix.needsUpdate = true;
    let puff = 0;
    for (const span of this.spans) for (const side of [-1, 1]) {
      const age = this.time - span.delay;
      if (age < 0 || age > 1.4) continue;
      const p = puff * 4;
      this.dustData[p] = side * (2.4 + age * 0.3); this.dustData[p + 1] = 0.2 + age * 0.65;
      this.dustData[p + 2] = span.z; this.dustData[p + 3] = 0.9 + age * 2.7;
      this.dustAlpha[puff++] = (1 - age / 1.4) * 0.55;
    }
    const dustGeometry = this.dust.geometry as THREE.InstancedBufferGeometry;
    dustGeometry.instanceCount = puff; dustGeometry.attributes.iPuff.needsUpdate = true; dustGeometry.attributes.iAlpha.needsUpdate = true;
  }

  dispose(): void {
    // instanceMatrix живёт на меше, поэтому одного geometry.dispose для него недостаточно.
    this.chips.dispose();
    const materials = new Set<THREE.Material>();
    this.group.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) materials.add(material);
    });
    for (const material of materials) material.dispose();
    this.group.removeFromParent();
  }
}
