import * as THREE from 'three';
import { GeomBuilder } from '../gen/geom/build';
import { starPlate } from '../gen/geom/prims';
import { obsidianMaterial } from '../render/materials';
import { STUN_STAR_SEC } from '../world/actor';
import type { World } from '../world/world';

const MAX = 96;
/** Оборотов в секунду. */
const SPIN = 1.6;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qz = new THREE.Quaternion(), _qt = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1), _X = new THREE.Vector3(1, 0, 0);
const _h = { x: 0, y: 0, z: 0 };

/** Положение звезды для искр и вспышки погасшей звезды. */
export interface StarPos { x: number; y: number; z: number; size: number }

/**
 * Звёзды оглушения (план §5.5): острые семиконечные звёзды Литургии из чёрного обсидиана с золотисто-белой кромкой
 * кружат по наклонному эллипсу над головой (1.6 об/с). Число звёзд — оставшееся время, по звезде на 0.5 с:
 * таймер виден на самом враге. Рядовой, сбитый тяжёлым ударом, — две маленькие звезды на 0.6 с.
 * Все звёзды — инстансы одной геометрии, развёрнутые к камере (читаются на телефоне).
 */
export class StunStars {
  readonly mesh: THREE.InstancedMesh;
  /** Позиции звёзд этого кадра (для шлейфа искр). */
  readonly pos: StarPos[] = [];

  constructor() {
    const b = new GeomBuilder();
    b.color = [0.012, 0.01, 0.016];
    // кромка: тонкая звезда чуть больше тела — светится по краю лучей
    const rim = starPlate(7, 0.5, 0.2, 0.05);
    rim.rotateX(Math.PI / 2);
    b.add(rim, { emissive: 0.9 });
    // тело: толстая обсидиановая звезда поверх кромки, эмиссия слабая
    const body = starPlate(7, 0.4, 0.16, 0.12);
    body.rotateX(Math.PI / 2);
    body.translate(0, 0, -0.035);
    b.add(body, { emissive: 0.04 });
    const mat = obsidianMaterial({ rim: '#e3c37e', rimStrength: 0.9, rimPower: 2.2, emissive: '#FFC870', emissive2: '#FFF4DC', emissiveStrength: 1.7 });
    // индикатор состояния читается всегда: поверх наплечников и шлемов; глубину даёт масштаб дальней половины орбиты
    mat.depthTest = false;
    this.mesh = new THREE.InstancedMesh(b.build(), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** Расставить звёзды над головами оглушённых и сбитых с ног врагов. */
  sync(w: World, cam: THREE.Camera, time: number): void {
    let n = 0;
    this.pos.length = 0;
    const spin = time * Math.PI * 2 * SPIN;
    for (const e of w.enemies) {
      if (e.dead) continue;
      const st = e.stun;
      let count = 0, slots = 0, size = 1, appear = 1;
      if (st && st.stunned > 0) {
        slots = Math.min(7, Math.ceil(st.total / STUN_STAR_SEC));
        count = Math.min(slots, Math.ceil(st.stunned / STUN_STAR_SEC));
        // звёзды «прилетают» с HUD: вырастают за 0.4 с
        appear = Math.min(1, (st.total - st.stunned) / 0.4);
      } else if (e.dazeT > 0) {
        slots = count = 2; size = 0.7;
        appear = Math.min(1, e.dazeT / 0.15);
      }
      if (!count) continue;
      e.headPoint(_h);
      // радиус орбиты — по росту (у Иерофанта ≈ 1.2 м)
      const R = Math.max(0.45, e.height * 0.165) * (size < 1 ? 0.8 : 1);
      const sz = (0.24 + R * 0.26) * size * appear;
      for (let i = 0; i < count && n < MAX; i++) {
        const a = spin + (i / slots) * Math.PI * 2;
        const ox = Math.cos(a) * R, oz = Math.sin(a) * R * 0.55;
        const oy = Math.sin(a + 0.6) * R * 0.2 + Math.sin(time * 3.1 + i * 1.7) * 0.04;
        _p.set(_h.x + ox, _h.y + oy, _h.z + oz);
        // к камере, с вращением в своей плоскости и лёгким наклоном — блик бежит по граням
        _qz.setFromAxisAngle(_Z, a * 1.4 + i);
        _qt.setFromAxisAngle(_X, Math.sin(a) * 0.45);
        _q.copy(cam.quaternion).multiply(_qt).multiply(_qz);
        const k = sz * (0.82 + 0.18 * Math.sin(a));
        _m.compose(_p, _q, _s.setScalar(k));
        this.mesh.setMatrixAt(n++, _m);
        this.pos.push({ x: _p.x, y: _p.y, z: _p.z, size: k });
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void { this.mesh.count = 0; this.pos.length = 0; }
}
