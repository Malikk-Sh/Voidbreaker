import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Animator, Clip } from '../src/anim/clip';
import { RigLayout, Skeleton } from '../src/anim/skeleton';
import { GRIP_HANDLE, GRIP_PALM, gripWeight } from '../src/anim/twoHandGrip';
import { HERO_RIG } from '../src/gen/chars/hero';
import { bruteRig } from '../src/gen/chars/enemies';
import { guardianTargets } from '../src/world/boss/guardianStaging';
import { bladeContactRoot, bladeEdgeRoot, EXECUTION_CLIPS, FINISHER_EDGE_Y, MASK_CONTACT } from '../src/anim/clips/execution';

const ids = ['maskStrike', 'gateCrush', 'bellBreak'];
const L = new RigLayout(HERO_RIG);
const root = () => ({ x: 0, y: 0, z: 0, stretch: 1, spin: 0 });
const point = (s: Skeleton, name: string) => s.jointPos(L.idx(name), new THREE.Vector3());
const gap = (s: Skeleton) => s.jointPoint(L.idx('handL'), ...GRIP_PALM, new THREE.Vector3()).distanceTo(s.jointPoint(L.idx('blade'), ...GRIP_HANDLE, new THREE.Vector3()));

describe('двуручные финальные удары', () => {
  it('кисть замыкается на обмотке во всём замахе, контакте и проводке, без растяжения костей', () => {
    for (const id of ids) {
      const def = EXECUTION_CLIPS.find(c => c.id === id)!, clip = new Clip(def, L), s = new Skeleton(L);
      let previous: Float32Array | undefined, frame = 0;
      for (let t = 0; t <= def.twoHanded!.release; t += 1 / 240) {
        s.rot.set(L.restRot); clip.sample(t, s.rot, root()); s.update();
        expect(gap(s), `${id}, ${t.toFixed(3)} с`).toBeLessThan(0.0001);
        for (const side of ['L', 'R']) {
          expect(point(s, `sh${side}`).distanceTo(point(s, `elb${side}`))).toBeCloseTo(0.3, 6);
          expect(point(s, `elb${side}`).distanceTo(point(s, `hand${side}`))).toBeCloseTo(0.27, 6);
        }
        const head = s.jointPoint(L.idx('head'), 0, 0.13, 0.01, new THREE.Vector3());
        for (const side of ['L', 'R']) for (const [a, b] of [['sh', 'elb'], ['elb', 'hand']]) {
          const nearest = new THREE.Line3(point(s, a + side), point(s, b + side)).closestPointToPoint(head, true, new THREE.Vector3());
          expect(nearest.distanceTo(head), `${id}: предплечье не проходит сквозь шлем`).toBeGreaterThan(0.24);
        }
        if (frame++ % 4 === 0) {
          if (previous) for (const joint of ['shL', 'elbL', 'handL']) {
            const q = new THREE.Quaternion().fromArray(s.rot, L.idx(joint) * 4), before = new THREE.Quaternion().fromArray(previous, L.idx(joint) * 4);
            expect(q.angleTo(before), `${id}: IK не переворачивает руку между кадрами`).toBeLessThan(0.5);
          }
          previous = Float32Array.from(s.rot);
        }
      }
    }
  });

  it('переход из прыжка в каждую атаку не размыкает хват при смешивании поз', () => {
    const leap = new Clip(EXECUTION_CLIPS.find(c => c.id === 'executionLeap')!, L);
    for (const id of ids) {
      const clip = new Clip(EXECUTION_CLIPS.find(c => c.id === id)!, L), a = new Animator(L), s = new Skeleton(L);
      a.sampleScene(leap, leap.dur, true); a.compose(L.restRot);
      for (let i = 0; i <= 12; i++) {
        a.sampleScene(clip, i / 60, i === 0, 0.2); a.compose(L.restRot);
        s.rot.set(a.out); s.update();
        expect(gap(s), `${id}: blend ${i}/12`).toBeLessThan(0.0001);
      }
    }
  });

  it('переход из удара в отталкивание не размыкает и не замыкает кисть скачком', () => {
    const land = new Clip(EXECUTION_CLIPS.find(c => c.id === 'executionLand')!, L);
    for (const id of ids) {
      const attack = new Clip(EXECUTION_CLIPS.find(c => c.id === id)!, L), a = new Animator(L), s = new Skeleton(L);
      const cutEnd = id === 'maskStrike' ? 1.15 : 1.0;
      a.sampleScene(attack, cutEnd, true); a.compose(L.restRot);
      let previous = Float32Array.from(a.out);
      for (let i = 0; i <= 12; i++) {
        a.sampleScene(land, i / 60, i === 0, 0.22); a.compose(L.restRot);
        s.rot.set(a.out); s.update();
        expect(gap(s), `${id}: отталкивание ${i}/12`).toBeLessThan(0.0001);
        for (const name of ['shL', 'elbL', 'handL']) {
          const joint = L.idx(name), before = new THREE.Quaternion().fromArray(previous, joint * 4), after = new THREE.Quaternion().fromArray(a.out, joint * 4);
          expect(before.angleTo(after), `${id}: ${name} при отталкивании`).toBeLessThan(0.35);
        }
        previous.set(a.out);
      }
    }
  });

  it('тело начинает передачу веса раньше плеча, после контакта меч продолжает движение', () => {
    for (const id of ids) {
      const c = new Clip(EXECUTION_CLIPS.find(c => c.id === id)!, L), a = new Skeleton(L), b = new Skeleton(L);
      c.sample(0, a.rot, root()); c.sample(0.3, b.rot, root());
      const delta = (joint: string) => new THREE.Quaternion().fromArray(a.rot, L.idx(joint) * 4).angleTo(new THREE.Quaternion().fromArray(b.rot, L.idx(joint) * 4));
      expect(delta('pelvis')).toBeGreaterThan(0.15); expect(delta('shR')).toBeLessThan(0.001);
      c.sample(MASK_CONTACT, a.rot, root()); a.update();
      const edgeAt = a.jointPoint(L.idx('blade'), 0, FINISHER_EDGE_Y, 0, new THREE.Vector3());
      c.sample(MASK_CONTACT + 0.05, b.rot, root()); b.update();
      const compression = b.jointPoint(L.idx('blade'), 0, FINISHER_EDGE_Y, 0, new THREE.Vector3()).sub(edgeAt);
      expect(compression.y).toBeGreaterThan(0.015); expect(compression.y).toBeLessThan(0.05);
      expect(Math.hypot(compression.x, compression.z)).toBeLessThan(0.05);
      c.sample(MASK_CONTACT + 0.18, b.rot, root()); b.update();
      expect(point(a, 'handR').distanceTo(point(b, 'handR'))).toBeGreaterThan(0.04);
      expect(delta('chest')).toBeGreaterThan(0.1);
    }
  });

  it('новый рабочий край точно попадает в цель при любом развороте', () => {
    const target: [number, number, number] = [1.4, 3.1, -2.3];
    for (const id of ids) for (const facing of [-2.3, 0, 1.4]) {
      const c = new Clip(EXECUTION_CLIPS.find(def => def.id === id)!, L), s = new Skeleton(L), r = root();
      const p = bladeEdgeRoot(id, MASK_CONTACT, target, facing);
      c.sample(MASK_CONTACT, s.rot, r); s.x = p[0]; s.y = p[1] + r.y; s.z = p[2]; s.facing = facing; s.update();
      expect(s.jointPoint(L.idx('blade'), 0, FINISHER_EDGE_Y, 0, new THREE.Vector3()).distanceTo(new THREE.Vector3(...target))).toBeLessThan(0.00001);
    }
  });

  it('подсечка достаёт колено стоящего Стража без подъёма героя над полом', () => {
    const target = guardianTargets(new RigLayout(bruteRig('gateGuardian', 1.65)), 0, 0, 0, 1.65).knee;
    const p = bladeContactRoot('guardianSweep', 0.62, target, Math.PI);
    expect(Math.abs(p[1])).toBeLessThan(0.001);
    const c = new Clip(EXECUTION_CLIPS.find(def => def.id === 'guardianSweep')!, L), s = new Skeleton(L), r = root();
    c.sample(0.62, s.rot, r); s.y = p[1] + r.y; s.update();
    expect(Math.min(point(s, 'footL').y, point(s, 'footR').y)).toBeCloseTo(0.06, 3);
  });

  it('подготовка собирает хват постепенно, после отталкивания рука освобождается для баланса', () => {
    const leap = EXECUTION_CLIPS.find(c => c.id === 'executionLeap')!, land = EXECUTION_CLIPS.find(c => c.id === 'executionLand')!;
    expect(gripWeight(0, leap.twoHanded!)).toBe(0); expect(gripWeight(0.75, leap.twoHanded!)).toBe(1);
    expect(gripWeight(0.15, land.twoHanded!)).toBe(1); expect(gripWeight(0.5, land.twoHanded!)).toBe(0);
    const c = new Clip(land, L), s = new Skeleton(L);
    const bend = (t: number, name: string) => { c.sample(t, s.rot, root()); return new THREE.Quaternion().fromArray(s.rot, L.idx(name) * 4).angleTo(new THREE.Quaternion()); };
    expect(bend(0, 'kneeL') - bend(0.12, 'kneeL')).toBeGreaterThan(0.75);
    expect(bend(0.12, 'kneeR')).toBeGreaterThan(bend(0, 'kneeR'));
    for (let t = 1.05; t <= 1.5; t += 1 / 120) {
      const r = root(); c.sample(t, s.rot, r); s.y = r.y; s.update();
      const y = Math.min(point(s, 'footL').y, point(s, 'footR').y);
      expect(y).toBeGreaterThan(0.025); expect(y).toBeLessThan(0.075);
    }
  });
});
