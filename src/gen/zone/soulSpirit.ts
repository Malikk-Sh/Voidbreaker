import * as THREE from 'three';

/**
 * Свет павшей элиты — огненный дух, а не шар. Раскалённое ядро в золотой оболочке; языки пламени
 * отогнуты назад по ходу полёта, два крайних машут как крылья; нимб поперёк пути; две перекрещенные
 * ленты шлейфа и тлеющие искры. Всё аддитивное: в тёмном зале дух читается как живой огонь.
 *
 * core / shell — радиусы ядра и оболочки (м); flames — языков пламени, flameLen — их длина; wing — длина крыла;
 * ribbon — точек шлейфа, ribbonWidth — его ширина у головы; sparks — искр; halo — радиус нимба.
 */
export const SOUL_LOOK = { core: 0.2, shell: 0.46, flames: 7, flameLen: 1.05, wing: 1.5, ribbon: 16, ribbonWidth: 0.2, sparks: 20, halo: 0.72 };

const WHITE = new THREE.Color('#fff8e2'), GOLD = new THREE.Color('#ffcf6e'), EMBER = new THREE.Color('#ff7a2e');
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Детерминированный шум для искр: визуальные эффекты не трогают Math.random. */
const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class SoulSpirit {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  private readonly core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly shell: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly flames: THREE.InstancedMesh;
  private readonly halo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly ribbon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly sparks: THREE.InstancedMesh;
  private readonly history: THREE.Vector3[] = [];
  private readonly dir = new THREE.Vector3(0, 0, -1);
  private readonly pool: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private time = 0;
  private spawnAcc = 0;
  private sparkSeed = 0;
  visible = false;

  constructor() {
    this.group.name = 'heart-soul-spirit';
    this.body.name = 'heart-soul-body';
    const add = (color: THREE.Color | string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), add(WHITE, 1));
    this.core.name = 'heart-soul-core';
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), add(GOLD, 0.42));
    this.shell.name = 'heart-soul-shell';
    // Язык пламени — конус остриём назад: основание у ядра, кончик позади.
    const tongue = new THREE.ConeGeometry(0.17, 1, 6, 1, true);
    tongue.rotateX(-Math.PI / 2); tongue.translate(0, 0, -0.5);
    const flameMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flames = new THREE.InstancedMesh(tongue, flameMaterial, SOUL_LOOK.flames);
    this.flames.name = 'heart-soul-flames';
    const halo = new THREE.TorusGeometry(1, 0.035, 6, 40);
    this.halo = new THREE.Mesh(halo, add(GOLD, 0.6));
    this.halo.name = 'heart-soul-halo';
    for (const o of [this.core, this.shell, this.flames, this.halo]) { o.frustumCulled = false; this.body.add(o); }

    // Две перекрещенные ленты: каждая точка шлейфа даёт по две вершины на ленту.
    const n = SOUL_LOOK.ribbon, geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    const index: number[] = [];
    for (let k = 0; k < 2; k++) for (let i = 0; i < n - 1; i++) {
      const a = k * n * 2 + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    this.ribbon = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.ribbon.name = 'heart-soul-ribbon';
    this.sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.06, 0), add('#ffffff', 0.95), SOUL_LOOK.sparks);
    this.sparks.name = 'heart-soul-sparks';
    this.sparks.count = 0;
    for (let i = 0; i < SOUL_LOOK.sparks; i++) this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
    for (const o of [this.ribbon, this.sparks]) { o.frustumCulled = false; this.group.add(o); }
    this.group.add(this.body);
    this.setVisible(false);
  }

  get trailPoints(): number { return this.history.length; }
  get liveSparks(): number { return this.sparks.count; }

  private setVisible(v: boolean): void {
    this.visible = v; this.body.visible = v; this.ribbon.visible = v; this.sparks.visible = v;
  }

  /** Новая точка полёта. Направление тела — по последнему заметному движению. */
  set(x: number, y: number, z: number, visible: boolean): void {
    if (!visible) {
      if (this.visible) { this.history.length = 0; this.ribbon.geometry.setDrawRange(0, 0); for (const p of this.pool) p.life = 0; this.sparks.count = 0; }
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    const last = this.history[0];
    this.v.set(x, y, z);
    if (last) {
      const d = this.v.distanceTo(last);
      if (d > 0.02) this.dir.lerp(this.s.copy(this.v).sub(last).divideScalar(d), Math.min(1, d * 2.5)).normalize();
      if (d < 0.08) { last.copy(this.v); }
      else { this.history.unshift(this.v.clone()); if (this.history.length > SOUL_LOOK.ribbon) this.history.pop(); }
    } else this.history.unshift(this.v.clone());
    this.body.position.copy(this.v);
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.time += dt;
    const t = this.time;
    // Тело смотрит по ходу полёта; ядро вытянуто вперёд, оболочка дышит.
    this.q.setFromUnitVectors(FORWARD, this.dir);
    this.body.quaternion.copy(this.q);
    const breathe = 1 + Math.sin(t * 7.5) * 0.07;
    this.core.scale.set(SOUL_LOOK.core, SOUL_LOOK.core, SOUL_LOOK.core * 1.55);
    this.shell.scale.set(SOUL_LOOK.shell * breathe, SOUL_LOOK.shell * breathe, SOUL_LOOK.shell * 1.45 * breathe);
    this.shell.material.opacity = 0.34 + Math.sin(t * 11) * 0.06;
    this.halo.scale.setScalar(SOUL_LOOK.halo * (1 + Math.sin(t * 4.2) * 0.08));
    this.halo.rotation.set(0, 0, t * 1.7);
    this.halo.material.opacity = 0.45 + Math.sin(t * 6.5) * 0.15;

    // Языки пламени: пять — хвостом за ядром, два крайних — крылья, машут вверх-вниз.
    for (let i = 0; i < SOUL_LOOK.flames; i++) {
      const wing = i < 2, sideSign = i === 0 ? 1 : -1;
      const a = (i - 2) / (SOUL_LOOK.flames - 2) * Math.PI * 2 + t * 0.9;
      const flicker = 0.85 + Math.sin(t * (13 + i * 1.7) + i * 2.1) * 0.15;
      if (wing) {
        const flap = Math.sin(t * 8.5) * 0.45;
        this.e.set(-0.25 + flap * 0.6, sideSign * 1.05, sideSign * (0.4 + flap));
        this.s.set(1.25 * flicker, 0.9, SOUL_LOOK.wing * flicker);
        this.v.set(sideSign * 0.14, 0.04, 0.02);
      } else {
        this.e.set(Math.sin(a) * 0.38, Math.cos(a) * 0.38, 0);
        this.s.set(1, 1, SOUL_LOOK.flameLen * flicker * (i % 2 ? 0.8 : 1.05));
        this.v.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.08);
      }
      this.q2.setFromEuler(this.e);
      this.m.compose(this.v, this.q2, this.s);
      this.flames.setMatrixAt(i, this.m);
      this.tmpColor.copy(wing ? GOLD : i % 2 ? EMBER : GOLD).multiplyScalar(0.75 + flicker * 0.25);
      this.flames.setColorAt(i, this.tmpColor);
    }
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;

    this.updateRibbon();
    this.updateSparks(dt);
  }

  private updateRibbon(): void {
    const h = this.history, n = h.length, geometry = this.ribbon.geometry;
    if (n < 2) { geometry.setDrawRange(0, 0); return; }
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute, col = geometry.getAttribute('color') as THREE.BufferAttribute;
    const N = SOUL_LOOK.ribbon, wave = this.time * 9;
    for (let i = 0; i < N; i++) {
      // Хвост короче полной длины: лишние вершины стянуты в последнюю точку и погашены.
      const live = i < n, p = h[Math.min(n - 1, i)], q = h[Math.min(n - 1, i + 1)], r = h[Math.max(0, Math.min(n - 1, i - 1))];
      this.v.copy(r).sub(q); if (this.v.lengthSq() < 1e-8) this.v.copy(this.dir); this.v.normalize();
      // Горизонтальная и вертикальная лента; ширина сходит на нет к хвосту, лента слегка вьётся.
      this.side.set(0, 1, 0).cross(this.v); if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0); this.side.normalize();
      this.up.copy(this.v).cross(this.side).normalize();
      const k = i / (N - 1), w = live ? SOUL_LOOK.ribbonWidth * (1 - k) * (1 - k * 0.35) * (1 + Math.sin(wave - i * 0.6) * 0.18) : 0;
      // У головы лента прозрачнее: сзади камера смотрит вдоль неё, и яркий клин закрыл бы сам дух.
      const fade = live ? (1 - k) * (1 - k) * Math.min(1, 0.35 + k * 4) * 0.62 : 0, heat = Math.max(0, 1 - k * 1.8);
      this.tmpColor.copy(EMBER).lerp(GOLD, Math.min(1, (1 - k) * 1.4)).lerp(WHITE, heat * 0.4).multiplyScalar(fade);
      for (let strip = 0; strip < 2; strip++) {
        const axis = strip === 0 ? this.side : this.up, base = strip * N * 2 + i * 2;
        pos.setXYZ(base, p.x + axis.x * w, p.y + axis.y * w, p.z + axis.z * w);
        pos.setXYZ(base + 1, p.x - axis.x * w, p.y - axis.y * w, p.z - axis.z * w);
        col.setXYZ(base, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
        col.setXYZ(base + 1, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      }
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    geometry.setDrawRange(0, Infinity);
  }

  private updateSparks(dt: number): void {
    // Искры срываются с духа и, остывая, поднимаются: дым свечи, а не пыль.
    this.spawnAcc += dt * 34;
    const head = this.history[0];
    while (head && this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      const p = this.pool.find(s => s.life <= 0);
      if (!p) break;
      const r1 = hash(++this.sparkSeed), r2 = hash(this.sparkSeed + 0.37), r3 = hash(this.sparkSeed + 0.71);
      p.x = head.x + (r1 - 0.5) * 0.4; p.y = head.y + (r2 - 0.5) * 0.4; p.z = head.z + (r3 - 0.5) * 0.4;
      p.vx = -this.dir.x * 1.6 + (r2 - 0.5) * 1.6; p.vy = 0.4 + r3 * 0.9; p.vz = -this.dir.z * 1.6 + (r1 - 0.5) * 1.6;
      p.life = 0.45 + r1 * 0.35;
    }
    let count = 0;
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vx *= 1 - dt * 2.5; p.vz *= 1 - dt * 2.5; p.vy += dt * 0.8;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = Math.min(1, p.life / 0.6);
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q2.identity(), this.s.setScalar(0.5 + k));
      this.sparks.setMatrixAt(count, this.m);
      this.tmpColor.copy(EMBER).lerp(GOLD, k).multiplyScalar(0.5 + k * 0.5);
      this.sparks.setColorAt(count, this.tmpColor);
      count++;
    }
    this.sparks.count = count;
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
  }
}
