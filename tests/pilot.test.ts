import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HERO_RIG, VISOR, buildHeroGeometry } from '../src/gen/chars/hero';
import { GeomBuilder, SURF } from '../src/gen/geom/build';
import { box } from '../src/gen/geom/prims';
import { CONTACT, contactAlpha } from '../src/render/contactShadows';

describe('Пилот 2.0 и контактные тени (разбор)', () => {
  it('профиль поверхности пишется только там, где он не «латы»', () => {
    const a = new GeomBuilder();
    a.add(box(1, 1, 1));
    expect(a.build().getAttribute('aSurf')).toBeUndefined();
    const b = new GeomBuilder();
    b.add(box(1, 1, 1));
    b.add(box(1, 1, 1), { surface: SURF.metal });
    const s = b.build().getAttribute('aSurf');
    expect(s).toBeTruthy();
    const vals = new Set(Array.from(s.array as Float32Array));
    expect(vals.has(SURF.armor) && vals.has(SURF.metal)).toBe(true);
  });

  it('Пилот: золото — металл, визор — фиолетовая щель с тонкой белой сердцевиной, не белое пятно', () => {
    const g = buildHeroGeometry();
    const surf = g.getAttribute('aSurf').array as Float32Array;
    const emi = g.getAttribute('aEmissive').array as Float32Array;
    const metal = surf.filter((v) => v === SURF.metal).length;
    expect(metal / surf.length).toBeGreaterThan(0.02);
    expect(metal / surf.length).toBeLessThan(0.3);
    // ярче 1.6 светится только клинок и Каэлис (у них свой сустав); на голове белеет лишь сердцевина визора
    // (Master Plan §5.3) — тонкая линия, а не вся щель: сплошная белая щель 2.0 читалась белым шаром
    const joint = g.getAttribute('aJoint').array as Float32Array, pos = g.getAttribute('position');
    let headMax = 0;
    const hot = new THREE.Box3();
    for (let i = 0; i < emi.length; i++) {
      if (joint[i] !== 5) continue;
      headMax = Math.max(headMax, emi[i]);
      if (emi[i] > 1.25) hot.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i));
    }
    expect(headMax).toBeGreaterThan(0.5);
    expect(headMax).toBeLessThanOrEqual((VISOR.core || 1.25) + 1e-6);
    expect(headMax).toBeLessThan(2);
    if (VISOR.core) {
      const size = hot.getSize(new THREE.Vector3());
      expect(size.x).toBeLessThan(0.13);
      expect(size.y).toBeLessThan(0.015);
    }
  });

  it('контактная тень: плотная у пола, гаснет с высотой, под полом — нет', () => {
    expect(contactAlpha(0)).toBeCloseTo(CONTACT.alpha);
    expect(contactAlpha(2)).toBeLessThan(contactAlpha(0.5));
    expect(contactAlpha(CONTACT.fadeH + 1)).toBe(0);
    expect(contactAlpha(-1)).toBe(0);
  });

  /** Пилот в позе: каждая вершина — жёстко к своему суставу (как RigBatch); at — мировая точка сустава. */
  function posed(g: THREE.BufferGeometry, pose: Record<string, [number, number, number]>): { mesh: THREE.Mesh; at: (n: string) => THREE.Vector3 } {
    const world: THREE.Matrix4[] = [];
    HERO_RIG.joints.forEach((j, i) => {
      const r = j.rot ?? [0, 0, 0], q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r));
      const p = pose[j.name];
      if (p) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p)));
      const local = new THREE.Matrix4().compose(new THREE.Vector3(...j.pos), q, new THREE.Vector3(1, 1, 1));
      const pi = j.parent ? HERO_RIG.joints.findIndex((k) => k.name === j.parent) : -1;
      world[i] = pi >= 0 ? new THREE.Matrix4().multiplyMatrices(world[pi], local) : local;
    });
    const src = g.getAttribute('position'), jnt = g.getAttribute('aJoint');
    const out = new Float32Array(src.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(world[jnt.getX(i)]);
      out.set([v.x, v.y, v.z], i * 3);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(out, 3));
    if (g.index) pg.setIndex(g.index);
    const at = (n: string) => new THREE.Vector3().setFromMatrixPosition(world[HERO_RIG.joints.findIndex((j) => j.name === n)]);
    return { mesh: new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), at };
  }

  it('Пилот: сквозь талию и суставы не видно фона — в покое, в наклоне, в развороте и в выпаде', () => {
    const g = buildHeroGeometry();
    const poses: Record<string, Record<string, [number, number, number]>> = {
      rest: {},
      lean: { spine: [0.35, 0, 0], chest: [0.25, 0, 0] },
      back: { spine: [-0.25, 0, 0], chest: [-0.2, 0, 0] },
      twist: { spine: [0.1, 0.5, 0], chest: [0, 0.35, 0.1] },
      lunge: { spine: [0.25, -0.1, 0], chest: [0.2, -0.2, 0], hipL: [-1.1, 0, 0], kneeL: [0.6, 0, 0], hipR: [0.8, 0, 0], kneeR: [0.2, 0, 0] },
      arms: { shR: [-1.6, 0, 0], elbR: [-1.5, 0, 0], shL: [0, 0, 1.2], elbL: [-1.2, 0, 0], kneeL: [1.3, 0, 0], kneeR: [0.9, 0, 0] },
    };
    const rc = new THREE.Raycaster();
    for (const [name, pose] of Object.entries(poses)) {
      const { mesh, at } = posed(g, pose);
      // ось корпуса в позе: таз → живот → грудь → шея; лучи спереди, сзади и сбоку поперёк неё
      const axis = ['pelvis', 'spine', 'chest', 'neck'].map(at);
      const miss: string[] = [];
      for (let k = 0; k < axis.length - 1; k++) {
        const a = axis[k], b = axis[k + 1];
        for (let t = 0; t < 1; t += 0.1) {
          const c = a.clone().lerp(b, t);
          for (const [o, d] of [[[0, 0, 3], [0, 0, -1]], [[0.08, 0, 3], [0, 0, -1]], [[-0.08, 0, 3], [0, 0, -1]], [[0, 0, -3], [0, 0, 1]], [[3, 0, 0], [-1, 0, 0]]] as const) {
            rc.set(c.clone().add(new THREE.Vector3(...o)), new THREE.Vector3(...d));
            if (!rc.intersectObject(mesh).length) miss.push(`${o.join('/')}@${c.y.toFixed(2)}`);
          }
        }
      }
      // руки и ноги: лучи поперёк оси «сустав → следующий» с двух сторон
      for (const chain of [['shL', 'elbL', 'handL'], ['shR', 'elbR', 'handR'], ['hipL', 'kneeL', 'footL'], ['hipR', 'kneeR', 'footR']]) {
        const pts = chain.map(at);
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], b = pts[k + 1], ax = b.clone().sub(a).normalize();
          const u = new THREE.Vector3().crossVectors(ax, Math.abs(ax.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)).normalize();
          const v = new THREE.Vector3().crossVectors(ax, u);
          for (let t = 0; t <= 1.001; t += 0.1) {
            const c = a.clone().lerp(b, t);
            for (const d of [u, v, u.clone().negate(), v.clone().negate()]) {
              rc.set(c.clone().addScaledVector(d, 3), d.clone().negate());
              if (!rc.intersectObject(mesh).length) miss.push(`${chain[k]}+${t.toFixed(1)}`);
            }
          }
        }
      }
      expect.soft(miss, name).toEqual([]);
    }
  });
});
