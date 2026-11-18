import * as THREE from 'three';
import { BELL_STANDS } from '../../data/echoBells';
import { GeomBuilder, mat, matAlong, SURF } from '../geom/build';
import { box, lathe, prism, rock } from '../geom/prims';
import { obsidianMaterial } from '../../render/materials';
import type { Devourer } from '../../world/boss/devourer';

const iron = '#495665',
  bronze = '#a97d4f',
  lip = '#ddb577',
  stone = '#394751';
/** Gantries, wear marks and salvage winches are baked into the arena's static shadow geometry. */
export function quarryFrames(g: GeomBuilder): void {
  const girder = (x: number, y: number, z: number, dx: number, dy: number, dz: number, r: number, color: string) => {
    g.add(prism(6, r, r, Math.hypot(dx, dy, dz)), {
      matrix: matAlong(x, y, z, dx, dy, dz),
      color,
      surface: SURF.metal,
    });
  };
  for (const { x, z } of BELL_STANDS) {
    for (const side of [-1, 1]) {
      const xx = x + side * 1.3;
      g.add(box(0.68, 0.28, 1.0), { matrix: mat(xx, 0.14, z), color: stone });
      girder(xx, 0.25, z, 0, 2.9, 0, 0.145, iron);
      girder(xx, 2.12, z, -side * 0.85, 0.91, 0, 0.105, bronze);
      for (const k of [-1, 1]) girder(xx, 0.24, z + k * 0.42, 0, 0.78, -k * 0.42, 0.085, iron);
    }
    g.add(box(2.99, 0.23, 0.31), { matrix: mat(x, 3.13, z), color: iron, surface: SURF.metal });
    for (const r of [1.13, 1.35]) {
      g.add(new THREE.TorusGeometry(r, 0.025, 4, 32), {
        matrix: mat(x, 0.05, z, Math.PI / 2),
        color: bronze,
        emissive: -0.18,
      });
    }
  }
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 3.2,
      h = 3.4 + ((i * 5) % 4) * 0.95,
      z = -12.7 - Math.abs(i - 3) * 0.45;
    g.add(box(2.8, h, 1.25), { matrix: mat(x, h * 0.48, z, -0.06, 0, ((i % 3) - 1) * 0.06), color: stone });
    girder(x - 1.12, 0.3, z + 0.66, 2.15, h - 0.3, 0, 0.12, iron);
    g.add(box(1.5, 0.12, 0.12), { matrix: mat(x, h - 0.48, z + 0.72), color: lip, emissive: -0.8 });
  }
  for (const s of [-1, 1]) {
    const x = s * 9.8,
      z = -6.5;
    g.add(prism(12, 1.1, 1.1, 2.1), {
      matrix: mat(x - 1.05, 1.4, z, 0, 0, -Math.PI / 2),
      color: iron,
      surface: SURF.metal,
    });
    for (let n = 0; n < 6; n++)
      g.add(new THREE.TorusGeometry(1.07, 0.065, 4, 16), {
        matrix: mat(x - 0.86 + n * 0.34, 1.4, z, 0, Math.PI / 2),
        color: bronze,
        surface: SURF.metal,
      });
  }
}

type QuarryFrame = Pick<Devourer, 'bells' | 'loose' | 'dead' | 'stone' | 'motion'> &
  ({ invulnerable: true } | Pick<Devourer, 'invulnerable' | 'bellReady' | 'echoes' | 'attack' | 'elapsed' | 'x' | 'z' | 'facing'>);

export class EchoQuarryView {
  readonly root = new THREE.Group();
  private readonly material = obsidianMaterial({
    rim: '#add3d7',
    rimStrength: 0.52,
    rimPower: 2.4,
    emissive: '#51cad1',
    emissive2: '#f3b354',
    emissiveStrength: 1.8,
  });
  private readonly bells: THREE.Mesh[];
  private readonly tethers: THREE.InstancedMesh;
  private readonly ready: THREE.InstancedMesh;
  private readonly pebble: THREE.Mesh;
  private readonly hearing = new THREE.Group();
  private readonly earArc = new THREE.TorusGeometry(1.05, 0.044, 4, 18, 1.9);
  private readonly earLight = new THREE.MeshBasicMaterial({ color: '#ffcf82', transparent: true, depthWrite: false });
  private readonly matrix = new THREE.Matrix4();
  private readonly ringScale = new THREE.Vector3();
  private readonly readyColor = new THREE.Color('#9bd7cd');
  private readonly callColor = new THREE.Color('#ffc158');
  constructor() {
    const g = new GeomBuilder();
    g.add(
      lathe(
        [
          [0.05, 0.86],
          [0.23, 0.82],
          [0.41, 0.69],
          [0.46, 0.38],
          [0.55, 0.05],
          [0.67, -0.32],
          [0.85, -0.5],
          [0.87, -0.59],
          [0.77, -0.61],
          [0.62, -0.41],
          [0.42, 0.05],
          [0.27, 0.5],
          [0.04, 0.58],
        ],
        24
      ),
      { color: bronze, surface: SURF.metal, shade: 0.08 }
    );
    for (const [y, r] of [
      [-0.51, 0.84],
      [-0.37, 0.7],
      [0.36, 0.46],
      [0.71, 0.35],
    ]) {
      g.add(new THREE.TorusGeometry(r, 0.035, 5, 24), {
        matrix: mat(0, y, 0, Math.PI / 2),
        color: lip,
        surface: SURF.metal,
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      g.add(box(0.078, 0.25, 0.035), {
        matrix: mat(Math.sin(a) * 0.526, 0.11, Math.cos(a) * 0.526, -0.2, a, 0.18),
        color: lip,
        emissive: -0.38,
      });
    }
    g.add(prism(6, 0.065, 0.065, 0.89), { matrix: mat(0, -0.64, 0), color: iron });
    g.add(rock(0.16, 0, 0.05, 2), { matrix: mat(0, -0.66, 0), color: lip });
    const geometry = g.build();
    this.bells = BELL_STANDS.map(({ x, z }) => {
      const m = new THREE.Mesh(geometry, this.material);
      m.position.set(x, 1.37, z);
      m.rotation.order = 'ZXY';
      m.frustumCulled = false;
      this.root.add(m);
      return m;
    });
    this.ready = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1.05, 0.035, 4, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      3
    );
    this.ready.frustumCulled = false;
    this.root.add(this.ready);
    const chains = new GeomBuilder();
    for (let i = 0; i < 5; i++)
      chains.add(new THREE.TorusGeometry(0.09, 0.025, 4, 10), {
        matrix: mat(0, i * 0.17, 0, 0, ((i % 2) * Math.PI) / 2, 0, 1, 1.35, 1),
        color: lip,
        surface: SURF.metal,
      });
    this.tethers = new THREE.InstancedMesh(chains.build(), this.material, 3);
    this.ready.count = 0;
    this.tethers.count = 0;
    this.tethers.frustumCulled = false;
    this.root.add(this.tethers);
    this.earArc.rotateX(-Math.PI / 2);
    for (const angle of [-0.95, Math.PI - 0.95]) {
      const arc = new THREE.Mesh(this.earArc, this.earLight);
      arc.rotation.y = angle;
      this.hearing.add(arc);
    }
    this.hearing.visible = false;
    this.root.add(this.hearing);
    const pebble = new GeomBuilder();
    pebble.add(rock(0.31, 0, 0.17, 11), { color: '#aaafa0' });
    this.pebble = new THREE.Mesh(pebble.build(), this.material);
    this.root.add(this.pebble);
  }
  sync(b: QuarryFrame, time: number): void {
    let n = 0,
      lit = 0;
    this.bells.forEach((m, i) => {
      const bell = b.bells[i],
        loose = i === 2 && b.loose;
      m.position.set(bell.x, loose ? 0.87 : 1.37, bell.z);
      m.rotation.x = loose ? Math.PI / 2 : 0;
      m.rotation.z = loose ? bell.roll - bell.x * 0.55 : Math.sin(time * 17) * bell.pulse * 0.25;
      if (!b.invulnerable && !b.dead && b.bellReady(i)) {
        const calling = b.echoes.isCalling(i);
        const radius = calling ? 1.23 + Math.sin(time * 18) * 0.13 : 1;
        this.matrix.makeRotationX(Math.PI / 2).scale(this.ringScale.setScalar(radius)).setPosition(bell.x, 0.075, bell.z);
        this.ready.setMatrixAt(lit, this.matrix);
        this.ready.setColorAt(lit++, calling ? this.callColor : this.readyColor);
      }
      if (!loose) {
        this.matrix.makeTranslation(bell.x, 2.35, bell.z);
        this.tethers.setMatrixAt(n++, this.matrix);
      }
    });
    this.hearing.visible = false;
    if (!b.invulnerable && !b.dead && b.motion === 'aim' && b.attack === 'listen') {
      this.hearing.visible = true;
      const beat = ((b.elapsed + 0.35) % 0.5) / 0.5;
      this.hearing.position.set(b.x + Math.sin(b.facing) * 1.25, 2.7, b.z + Math.cos(b.facing) * 1.25);
      this.hearing.rotation.y = b.facing;
      this.hearing.scale.setScalar(0.8 + beat * 0.95);
      this.earLight.opacity = 0.95 - beat * 0.7;
    }
    this.ready.count = lit;
    if (this.ready.instanceColor) this.ready.instanceColor.needsUpdate = true;
    this.ready.instanceMatrix.needsUpdate = true;
    this.tethers.count = n;
    this.tethers.instanceMatrix.needsUpdate = true;
    this.pebble.visible = b.motion === 'intro';
    this.pebble.position.set(b.stone.x, b.stone.y, b.stone.z);
    this.pebble.rotation.z = b.stone.y * 1.8;
  }
  dispose(): void {
    this.earArc.dispose();
    this.earLight.dispose();
    this.ready.geometry.dispose();
    (this.ready.material as THREE.Material).dispose();
    this.ready.dispose();
    this.bells[0].geometry.dispose();
    this.tethers.geometry.dispose();
    this.tethers.dispose();
    this.pebble.geometry.dispose();
    this.material.dispose();
  }
}
