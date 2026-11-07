import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { GeomBuilder, mat, SURF } from '../gen/geom/build';
import { box, lathe } from '../gen/geom/prims';
import { obsidianMaterial } from '../render/materials';
import { GREAT_BELL, type GreatBell } from '../world/boss/greatBell';
import { CLAPPER_REACH } from '../world/boss/guardians';
import { RINGER_CLAPPER_BALL, RINGER_SCALE } from '../gen/chars/ringer';
import type { World } from '../world/world';

/**
 * Вид Великого колокола (Звонарь, «Маятник»): бронзовое тело с золотым поясом надписи, ярмо на маковке, язык внутри,
 * четыре верёвки через блоки над провалами к железным тумбам. Натянутая верёвка и огни у её тумбы горят золотом —
 * это и есть подсказка «руби здесь»; огней у тумбы столько, сколько прядей осталось (тусклые, пока верёвка
 * провисла). Порванная прядь вспыхивает на верёвке. Колокол висит на маковке и наклоняется к точке подвеса над центром зала, как
 * маятник; упавший стоит на полу с трещиной. В III фазе язык — в правой руке Звонаря.
 *
 * look: pivot — высота воображаемой точки подвеса над маковкой (м, наклон маятника); rope — толщина верёвки,
 * sag — провис ослабленной верёвки, glow — цвет натянутой верёвки (линейный, >1 — в свечение), slack — её цвет без
 * натяжения; glowW — толщина свечения (× rope); tail — длина обрывка под колоколом; whip — сколько секунд конец
 * оборванной верёвки взлетает к блоку; ring — непрозрачность огней прядей у тумбы натянутой верёвки (среднее, пульс),
 * dim — огни прядей провисшей верёвки; gap — зазор между огнями (рад);
 * wide — ширина видимого колокола относительно круга удара; clapper — во сколько раз гиря языка в руке Звонаря больше
 * гири в колоколе (накрывает его собственную, сросшуюся с рукой).
 */
export const BELL_LOOK = {
  pivot: 11, rope: 0.05, sag: 1.1, glow: [1.35, 0.9, 0.3] as const, slack: [0.11, 0.075, 0.045] as const, tail: 2.4, whip: 0.35,
  segs: 7, ringR: [0.75, 1.1] as const, glowW: 1.5, ring: [0.32, 0.16] as const, dim: 0.12, gap: 0.32, wide: 1.12, clapper: 2.0,
};

const MAX_ROPE = 4 * (BELL_LOOK.segs + 3) + 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _axis = new THREE.Vector3(), _c = new THREE.Color();
const BRONZE = hexToLinear('#5c4626'), BRONZE_DEEP = hexToLinear('#2e2214'), IRON = hexToLinear('#24222a');

/** Профиль колокола (радиус, высота): кромка на y = 0, маковка на y = height. */
function bellProfile(): [number, number][] {
  const r = GREAT_BELL.r, h = GREAT_BELL.height;
  return [[r * 0.92, -0.02], [r * 1.05, 0.06], [r, 0.2], [r * 0.82, 0.55], [r * 0.7, 1.05], [r * 0.64, 1.6], [r * 0.6, 2.05], [r * 0.5, 2.38], [r * 0.3, h - 0.05], [0.05, h]];
}

export class GreatBellView {
  readonly group = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly bodyMat;
  private readonly clapperIn: THREE.Mesh;
  private readonly clapperHand: THREE.Mesh;
  private readonly ropes: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly cleats: THREE.Mesh;
  private readonly pulleys: THREE.Mesh;
  /** Огни прядей у тумб: по GREAT_BELL.strands дуг на верёвку. */
  private readonly rings: THREE.Mesh[] = [];
  /** Верёвка языка в III фазе (бросок, кистень): от кисти до гири. */
  private clapRope = false;
  private readonly clapA = new THREE.Vector3(); private readonly clapB = new THREE.Vector3();
  private readonly shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private built: GreatBell | null = null;
  private t = 0;
  /** Точки верёвок кадра — без выделения памяти на каждом кадре. */
  private readonly pool = Array.from({ length: 16 }, () => new THREE.Vector3());
  private readonly attach = new THREE.Vector3(); private readonly pul = new THREE.Vector3(); private readonly clt = new THREE.Vector3();

  constructor() {
    const b = new GeomBuilder();
    b.surface = SURF.metal;
    b.color = BRONZE;
    b.add(lathe(bellProfile(), 16));
    // золотой пояс надписи и кромка
    b.add(new THREE.TorusGeometry(GREAT_BELL.r * 0.84, 0.05, 4, 24), { matrix: mat(0, 0.5, 0, Math.PI / 2, 0, 0), emissive: 1.4, color: hexToLinear('#b8954e') });
    b.add(new THREE.TorusGeometry(GREAT_BELL.r * 0.71, 0.035, 4, 24), { matrix: mat(0, 0.95, 0, Math.PI / 2, 0, 0), emissive: 0.9, color: hexToLinear('#b8954e') });
    b.add(new THREE.TorusGeometry(GREAT_BELL.r * 1.0, 0.06, 4, 24), { matrix: mat(0, 0.08, 0, Math.PI / 2, 0, 0), color: BRONZE_DEEP });
    // изнанка: тёмная бронза
    b.color = BRONZE_DEEP;
    b.add(lathe(bellProfile().map(([r, y]) => [Math.max(0.02, r - 0.1), y - 0.04] as [number, number]).reverse(), 16));
    // ярмо и ушки на маковке: на нём стоит Звонарь
    b.color = IRON; b.surface = SURF.armor;
    b.add(box(1.5, 0.28, 0.42), { matrix: mat(0, GREAT_BELL.height + 0.1, 0) });
    b.add(new THREE.TorusGeometry(0.22, 0.06, 4, 10), { matrix: mat(0.45, GREAT_BELL.height + 0.32, 0) });
    b.add(new THREE.TorusGeometry(0.22, 0.06, 4, 10), { matrix: mat(-0.45, GREAT_BELL.height + 0.32, 0) });
    this.bodyMat = obsidianMaterial({ rim: '#c79a52', rimStrength: 0.45, rimPower: 2.4, emissive: '#FFB866', emissive2: '#FF8A3D', emissiveStrength: 1.4 });
    this.body = new THREE.Mesh(b.build(), this.bodyMat);
    this.body.position.y = -GREAT_BELL.height - 0.1;
    // видимый колокол чуть шире круга удара: крупнее колокола на спине Звонаря, удар честнее
    this.body.scale.set(BELL_LOOK.wide, 1, BELL_LOOK.wide);
    this.body.frustumCulled = false;
    this.pivot.add(this.body);

    // язык: стержень и тяжёлый шар
    const k = new GeomBuilder();
    k.color = IRON; k.surface = SURF.metal;
    k.add(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), { matrix: mat(0, -0.8, 0) });
    k.add(new THREE.SphereGeometry(0.32, 8, 6), { matrix: mat(0, -1.75, 0), emissive: 0.25 });
    k.add(new THREE.TorusGeometry(0.12, 0.04, 4, 8), { matrix: mat(0, 0, 0) });
    const kGeo = k.build();
    const kMat = obsidianMaterial({ rim: '#c79a52', rimStrength: 0.4, emissive: '#FF8A3D', emissiveStrength: 1.2 });
    this.clapperIn = new THREE.Mesh(kGeo, kMat);
    this.clapperIn.position.y = -0.55;
    this.clapperIn.frustumCulled = false;
    this.pivot.add(this.clapperIn);
    // III фаза: вырванная гиря языка надета на сросшуюся с рукой гирю Звонаря — та становится огромной и тлеет
    const h = new GeomBuilder();
    h.color = IRON; h.surface = SURF.metal;
    h.add(new THREE.SphereGeometry(0.32, 9, 7), { emissive: 0.03 });
    h.add(new THREE.TorusGeometry(0.2, 0.05, 4, 10), { matrix: mat(0, 0.27, 0, Math.PI / 2, 0, 0), color: hexToLinear('#b8954e') });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      h.add(new THREE.BoxGeometry(0.03, 0.34, 0.02), { matrix: mat(Math.sin(a) * 0.315, -0.02, Math.cos(a) * 0.315, 0.2 * Math.cos(a), a, 0.25), emissive: 1.4 });
    }
    this.clapperHand = new THREE.Mesh(h.build(), kMat);
    this.clapperHand.frustumCulled = false;
    this.clapperHand.visible = false;

    // верёвки: тёмная основа и золотое свечение натянутых поверх
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    cyl.translate(0, 0.5, 0);
    this.ropes = new THREE.InstancedMesh(cyl, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_ROPE);
    this.glow = new THREE.InstancedMesh(cyl, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_ROPE);
    for (const im of [this.ropes, this.glow]) { im.count = 0; im.frustumCulled = false; im.setColorAt(0, _c.setRGB(0, 0, 0)); }

    this.cleats = new THREE.Mesh(new THREE.BufferGeometry(), obsidianMaterial({ rim: '#c79a52', rimStrength: 0.5, emissive: '#FFB866', emissiveStrength: 1.2 }));
    this.pulleys = new THREE.Mesh(new THREE.BufferGeometry(), this.cleats.material);
    for (const m of [this.cleats, this.pulleys]) m.frustumCulled = false;
    const n = GREAT_BELL.strands, arc = (Math.PI * 2) / n;
    const arcGeo = Array.from({ length: n }, (_, k) => {
      const g = new THREE.RingGeometry(BELL_LOOK.ringR[0], BELL_LOOK.ringR[1], 8, 1, k * arc + BELL_LOOK.gap / 2, arc - BELL_LOOK.gap);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    for (let i = 0; i < 4 * n; i++) {
      const r = new THREE.Mesh(arcGeo[i % n], new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      r.renderOrder = 2; r.frustumCulled = false;
      this.rings.push(r);
    }
    const shadowGeo = new THREE.CircleGeometry(GREAT_BELL.r * 1.05, 24);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.renderOrder = 1;
    this.group.add(this.pivot, this.clapperHand, this.ropes, this.glow, this.cleats, this.pulleys, this.shadow, ...this.rings);
    this.group.visible = false;
  }

  /** Тумбы и блоки — по раскладке колокола (строятся один раз на бой). */
  private build(bell: GreatBell): void {
    this.built = bell;
    const c = new GeomBuilder(), p = new GeomBuilder();
    c.color = IRON; p.color = IRON;
    for (const r of bell.ropes) {
      const a = Math.atan2(r.pulley.x - r.cleat.x, r.pulley.z - r.cleat.z);
      c.add(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 6), { matrix: mat(r.cleat.x, 0.25, r.cleat.z) });
      c.add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 6), { matrix: mat(r.cleat.x, 0.55, r.cleat.z, 0, a, Math.PI / 2) });
      c.add(new THREE.TorusGeometry(0.21, 0.035, 4, 12), { matrix: mat(r.cleat.x, 0.5, r.cleat.z, Math.PI / 2, 0, 0), emissive: 1.1, color: hexToLinear('#b8954e') });
      p.add(new THREE.TorusGeometry(0.42, 0.09, 5, 14), { matrix: mat(r.pulley.x, GREAT_BELL.pulleyY, r.pulley.z, 0, a + Math.PI / 2, 0) });
      p.add(box(0.12, 1.2, 0.12), { matrix: mat(r.pulley.x, GREAT_BELL.pulleyY + 0.6, r.pulley.z) });
    }
    this.cleats.geometry.dispose(); this.cleats.geometry = c.build();
    this.pulleys.geometry.dispose(); this.pulleys.geometry = p.build();
    const n = GREAT_BELL.strands;
    bell.ropes.forEach((r, i) => { for (let k = 0; k < n; k++) this.rings[i * n + k].position.set(r.cleat.x, 0.04, r.cleat.z); });
  }

  sync(w: World, dt: number): void {
    const bell = w.greatBell;
    this.group.visible = !!bell;
    if (!bell) { this.built = null; return; }
    if (this.built !== bell) this.build(bell);
    this.t += dt;
    const fallen = bell.mode === 'fallen';
    // маковка — точка подвеса колокола; тело наклоняется к подвесу над центром зала
    const ox = bell.x - bell.cx, oz = bell.z - bell.cz, d = Math.hypot(ox, oz);
    let tilt = bell.hanging ? Math.atan2(d, BELL_LOOK.pivot) : 0;
    if (bell.mode === 'fall') tilt = Math.atan2(d, BELL_LOOK.pivot) * (1 - Math.min(1, bell.fall.t / GREAT_BELL.fall.dur)) + Math.sin(bell.fall.t * 9) * 0.06;
    this.pivot.position.set(bell.x, bell.y + GREAT_BELL.height + 0.1 - (fallen ? 0.12 : 0), bell.z);
    if (d > 1e-3 && tilt > 1e-4) _axis.set(-oz / d, 0, ox / d); else _axis.set(1, 0, 0);
    this.pivot.quaternion.setFromAxisAngle(_axis, tilt);
    if (Math.abs(bell.lurch) > 1e-3) this.pivot.quaternion.multiply(_q.setFromAxisAngle(_a.set(0, 0, 1), bell.lurch * Math.sin(this.t * 7)));
    if (fallen) this.pivot.quaternion.setFromAxisAngle(_a.set(0.6, 0, 0.8), 0.09);
    // язык отстаёт от качания; в III фазе он в руке Звонаря
    const ringer = w.enemies.find((e) => e.kind === 'bellRinger' && !e.dead) as (typeof w.enemies[number] & { clapper?: boolean }) | undefined;
    const inHand = !!ringer?.clapper;
    this.clapperIn.visible = !inHand;
    this.clapperIn.rotation.set(Math.sin(this.t * 2.1) * 0.08 - bell.vz * 0.02, 0, bell.vx * 0.02);
    this.clapperHand.visible = inHand;
    this.clapRope = false;
    if (inHand && ringer) {
      const L = ringer.puppet.layout, hand = L.idx('handR'), k = RINGER_SCALE;
      const reach = (ringer as { reach?: number }).reach ?? 0, flail = (ringer as { flail?: number }).flail ?? 0;
      ringer.puppet.skel.jointPoint(hand, 0, 0, 0, _a);
      ringer.puppet.skel.jointPoint(hand, RINGER_CLAPPER_BALL[0] * k, RINGER_CLAPPER_BALL[1] * k, RINGER_CLAPPER_BALL[2] * k, _b);
      if (reach > 0.02 || flail > 0) {
        // язык на верёвке: бросок по взгляду Звонаря или круг кистеня вокруг него
        const a = flail > 0 ? this.t * 8 : ringer.facing, d = flail > 0 ? 4.3 : reach * CLAPPER_REACH;
        const at = _p.set(ringer.x + Math.sin(a) * d, 1.0, ringer.z + Math.cos(a) * d);
        _b.lerp(at, flail > 0 ? 1 : Math.min(1, reach * 1.4));
        this.clapRope = true; this.clapA.copy(_a); this.clapB.copy(_b);
        this.clapperHand.position.copy(_b);
        this.clapperHand.quaternion.setFromUnitVectors(_up, _s.subVectors(_a, _b).normalize());
      } else {
        this.clapperHand.position.copy(_b);
        _b.sub(_a).normalize().negate();
        this.clapperHand.quaternion.setFromUnitVectors(_up, _b);
      }
      this.clapperHand.scale.setScalar(BELL_LOOK.clapper);
    }
    const fx = this.bodyMat.uniforms.uFx.value as THREE.Vector4;
    fx.set(0, 0, fallen ? 0 : 0.1 + 0.25 * Math.max(0, 1 - Math.abs(Math.hypot(bell.vx, bell.vz)) / 20) * (bell.paused ? 1 : 0), fallen ? 0.55 : 0);
    // тень под висящим колоколом: чем выше, тем бледнее
    this.shadow.visible = bell.hanging || bell.mode === 'fall' || bell.mode === 'descend';
    this.shadow.position.set(bell.x, 0.03, bell.z);
    this.shadow.material.opacity = 0.42 * Math.max(0.25, 1 - bell.y / 6);
    this.syncRopes(bell);
  }

  private seg(im: THREE.InstancedMesh, n: number, a: THREE.Vector3, b: THREE.Vector3, r: number): number {
    if (n >= MAX_ROPE) return n;
    _p.subVectors(b, a);
    const len = _p.length();
    if (len < 1e-4) return n;
    _q.setFromUnitVectors(_up, _p.multiplyScalar(1 / len));
    _m.compose(a, _q, _s.set(r, len, r));
    im.setMatrixAt(n, _m);
    return n + 1;
  }

  private syncRopes(bell: GreatBell): void {
    const L = BELL_LOOK, top = this.pivot.position;
    let n = 0, g = 0;
    const pts: THREE.Vector3[] = [];
    let pi = 0;
    const v = () => this.pool[pi++];
    const S = GREAT_BELL.strands;
    bell.ropes.forEach((r, i) => {
      const live = bell.cuttable(r);
      // огни прядей: горят оставшиеся; у натянутой — ярко и с пульсом, у провисшей — тускло
      for (let k = 0; k < S; k++) {
        const mat = this.rings[i * S + k].material as THREE.MeshBasicMaterial;
        const lit = !r.cut && k < r.strands;
        mat.opacity = !lit ? (k === r.strands && !r.cut ? r.fray * 0.9 : 0) : (live ? L.ring[0] + L.ring[1] * Math.sin(this.t * 9 + i) : L.dim + 0.1 * r.taut) + r.clank * 0.6 + r.fray * 0.5;
      }
      if (bell.mode === 'fallen' && r.cutT > 3) return;
      const dx = r.pulley.x - top.x, dz = r.pulley.z - top.z, dl = Math.hypot(dx, dz) || 1;
      const attach = this.attach.set(top.x + dx / dl * 0.42, top.y + 0.15, top.z + dz / dl * 0.42);
      const pulley = this.pul.set(r.pulley.x, GREAT_BELL.pulleyY - 0.35, r.pulley.z);
      const cleat = this.clt.set(r.cleat.x, 0.55, r.cleat.z);
      const colour = (live ? 0.55 + 0.45 * r.strands / S : r.taut * 0.35) + r.fray * 1.2;
      pts.length = 0; pi = 0;
      if (!r.cut) {
        const sag = (1 - r.taut) * L.sag + 0.04;
        for (let k = 0; k <= L.segs; k++) {
          const u = k / L.segs;
          pts.push(v().lerpVectors(attach, pulley, u).add(_a.set(0, -4 * sag * u * (1 - u), 0)));
        }
        const sag2 = (1 - r.taut) * 0.35;
        pts.push(v().lerpVectors(pulley, cleat, 0.5).add(_a.set(0, -sag2, 0)), cleat);
      } else if (r.cutT < L.whip) {
        // конец верёвки взлетает от тумбы к блоку, сторона колокола провисает
        const u = r.cutT / L.whip;
        for (let k = 0; k <= 3; k++) pts.push(v().lerpVectors(attach, pulley, k / 3).add(_a.set(0, -4 * (0.6 + u) * (k / 3) * (1 - k / 3), 0)));
        pts.push(v().lerpVectors(cleat, pulley, u * u).add(_a.set(Math.sin(u * 9) * 0.6 * (1 - u), 0, Math.cos(u * 7) * 0.6 * (1 - u))));
      } else if (bell.mode !== 'fallen') {
        // обрывок висит под ярмом и болтается
        const sw = Math.sin(this.t * 3 + i * 1.7) * 0.35 * Math.exp(-(r.cutT - L.whip) * 0.4) + 0.08;
        for (let k = 0; k <= 3; k++) pts.push(v().set(attach.x + dx / dl * sw * k, attach.y - L.tail * k / 3, attach.z + dz / dl * sw * k));
      }
      for (let k = 0; k + 1 < pts.length; k++) {
        n = this.seg(this.ropes, n, pts[k], pts[k + 1], L.rope);
        if (colour > 0.02) { this.glow.setColorAt(g, _c.setRGB(L.glow[0] * colour, L.glow[1] * colour, L.glow[2] * colour)); g = this.seg(this.glow, g, pts[k], pts[k + 1], L.rope * L.glowW); }
      }
      // обрывок на тумбе
      if (r.cut) n = this.seg(this.ropes, n, cleat, _b.set(cleat.x + dx / dl * 0.5, 0.08, cleat.z + dz / dl * 0.5), L.rope);
    });
    // III фаза: верёвка от кисти Звонаря к брошенному языку
    if (this.clapRope) n = this.seg(this.ropes, n, this.clapA, this.clapB, L.rope * 1.3);
    for (let k = 0; k < n; k++) this.ropes.setColorAt(k, _c.setRGB(L.slack[0], L.slack[1], L.slack[2]));
    this.ropes.count = n; this.glow.count = g;
    this.ropes.instanceMatrix.needsUpdate = true; this.glow.instanceMatrix.needsUpdate = true;
    if (this.ropes.instanceColor) this.ropes.instanceColor.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  /** Точки света для LightManager: золото натянутых тумб и пояса колокола. */
  lightsOf(bell: GreatBell, out: (x: number, y: number, z: number, k: number) => void): void {
    for (const r of bell.ropes) if (bell.cuttable(r)) out(r.cleat.x, 0.8, r.cleat.z, 0.9 + 0.3 * Math.sin(this.t * 9));
  }

  clear(): void { this.group.visible = false; this.built = null; }
}
