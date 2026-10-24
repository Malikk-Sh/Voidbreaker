import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Clip } from '../src/anim/clip';
import { EXTRACTION_CLIPS, EXTRACTION_T } from '../src/anim/clips/extraction';
import { layoutOf } from '../src/anim/puppet';
import { Skeleton } from '../src/anim/skeleton';
import { BLADE_LEN, HERO_RIG } from '../src/gen/chars/hero';
import { buildHullShard } from '../src/gen/zone/space';
import { ExtractionAttachment, extractionGripMatrix, extractionStand } from '../src/game/extraction';
import { Director, type DirectorActor, type DirectorHost } from '../src/game/director';
import { LANDING_T, landingTrack } from '../src/game/prologueTracks';
import { CameraRig } from '../src/world/camera';

const DT = 1 / 60;
const layout = layoutOf(HERO_RIG), clip = new Clip(EXTRACTION_CLIPS[0], layout);
const root = { x: 0, y: 0, z: 0, stretch: 1, spin: 0 };
const skel = new Skeleton(layout);
const pose = (t: number, x = 0, z = 0, facing = 0): THREE.Matrix4 => {
  skel.resetPose(); clip.sample(t, skel.rot, root);
  skel.x = x; skel.z = z; skel.y = root.y; skel.facing = facing;
  skel.update();
  return new THREE.Matrix4().fromArray(skel.world, layout.idx('blade') * 16);
};
const matrixGap = (a: THREE.Matrix4, b: THREE.Matrix4): number => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));

describe('пролог: непрерывное извлечение единственного клинка', () => {
  it('заготовка имеет настоящий клинок, гарду и рукоять того же размера', () => {
    const g = buildHullShard(); g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.max.x - box.min.x).toBeGreaterThan(0.38);
    expect(box.min.y).toBeLessThan(-BLADE_LEN);
    expect(box.max.y).toBeGreaterThan(0.14);
    g.dispose();
  });

  it('посаженный клинок совпадает с будущей кистью, в том числе при другом направлении подхода', () => {
    for (const facing of [0, 0.7, Math.PI, -1.3]) {
      const [x, , z] = extractionStand(2, -3, facing);
      const planted = extractionGripMatrix(x, z, facing, new THREE.Matrix4());
      const grip = pose(EXTRACTION_T.grip, x, z, facing);
      const hilt = new THREE.Vector3().setFromMatrixPosition(planted);
      expect(hilt.x).toBeCloseTo(2, 5);
      expect(hilt.z).toBeCloseTo(-3, 5);
      expect(matrixGap(planted, grip)).toBeLessThan(1e-6);
      const item = new ExtractionAttachment(planted);
      item.grip(grip);
      expect(matrixGap(planted, item.matrix)).toBeLessThan(1e-6);
    }
  });

  it('опора сопротивляется: кисть и клинок стоят до release, затем острие действительно выходит из пола', () => {
    const planted = pose(EXTRACTION_T.grip);
    expect(new THREE.Vector3().setFromMatrixPosition(planted).y).toBeGreaterThan(0.95);
    const tip = new THREE.Vector3(0, -BLADE_LEN - 0.06, 0).applyMatrix4(planted);
    expect(tip.y).toBeLessThan(0.05);
    expect(tip.y).toBeGreaterThan(-0.35);
    for (let t = EXTRACTION_T.grip; t <= EXTRACTION_T.releaseFromGround; t += DT) {
      expect(matrixGap(planted, pose(t))).toBeLessThan(1e-5);
    }
    const free = new THREE.Vector3(0, -BLADE_LEN - 0.06, 0).applyMatrix4(pose(1.8));
    expect(free.y).toBeGreaterThan(0.1);
  });

  it('следование не добавляет второй предмет, передача в риг сохраняет трансформ и единичный масштаб', () => {
    const item = new ExtractionAttachment(pose(EXTRACTION_T.grip));
    expect(Number(item.propVisible) + Number(item.rigVisible)).toBe(1);
    item.grip(pose(EXTRACTION_T.grip)); item.release();
    for (let t = EXTRACTION_T.releaseFromGround; t < EXTRACTION_T.weaponAwake; t += DT) {
      const hand = pose(t); item.follow(hand);
      expect(matrixGap(item.matrix, hand)).toBeLessThan(1e-8);
      expect(item.propVisible && !item.rigVisible).toBe(true);
    }
    const awake = pose(EXTRACTION_T.weaponAwake); item.follow(awake);
    const before = item.matrix.clone(); item.awaken(awake);
    expect(matrixGap(before, item.matrix)).toBeLessThan(1e-8);
    expect(item.propVisible).toBe(false); expect(item.rigVisible).toBe(true);
    expect(new THREE.Vector3().setFromMatrixScale(item.matrix).length()).toBeCloseTo(Math.sqrt(3), 5);
    // Repeated callbacks and a late skip cannot recreate the prop.
    item.grip(pose(0)); item.release(); item.awaken(awake);
    expect(item.phase).toBe('awake');
  });

  it('полный просмотр и пропуск каждого крупного плана дают одинаковый единственный клинок', () => {
    const p = { x: 0, z: 0.5, shardX: 0.9, shardZ: 2.1, huskX: -1.2, huskZ: -6 };
    const facing = Math.atan2(p.shardX - p.x, p.shardZ - p.z);
    const stand = extractionStand(p.shardX, p.shardZ, facing);
    for (const skipAt of [null, 0.2, LANDING_T.grip + 0.1, LANDING_T.releaseFromGround + 0.1, LANDING_T.ignite + 0.1]) {
      const a: DirectorActor = { x: p.x, y: 0, z: p.z, facing };
      const item = new ExtractionAttachment(extractionGripMatrix(stand[0], stand[2], facing, new THREE.Matrix4()));
      let current = item.matrix.clone();
      const events: string[] = [];
      const host: DirectorHost = {
        actor: () => a, holding: () => false, tapped: () => false, seen: () => 0, markSeen: () => {},
        clipEvents: (_who, id) => id === 'extractBlade' ? clip.events : [],
        clipDuration: (_who, id) => id === 'extractBlade' ? clip.dur : 0,
        sampleClip: (_who, id, t) => { if (id === 'extractBlade') current = pose(t, a.x, a.z, a.facing); },
        call: (fn) => {
          if (fn === 'grip') { events.push(fn); item.grip(current); }
          if (fn === 'releaseFromGround') { events.push(fn); item.release(); }
          if (fn === 'ignite') { events.push(fn); item.awaken(current); }
        },
      };
      const d = new Director(host), cam = new CameraRig();
      d.play(landingTrack(p));
      for (let t = 0; d.active && t < 20; t += DT) {
        d.update(DT, cam); item.follow(current);
        if (skipAt !== null && d.time >= skipAt) d.skip();
      }
      expect(d.active).toBe(false);
      expect(events).toEqual(['grip', 'releaseFromGround', 'ignite']);
      expect(item.released).toBe(true);
      expect(item.propVisible).toBe(false); expect(item.rigVisible).toBe(true);
    }
  });
});
