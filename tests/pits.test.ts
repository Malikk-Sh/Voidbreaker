import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Arena } from '../src/world/arena';
import { ARENAS } from '../src/data/arenas';
import { ZONE1 } from '../src/data/stages';
import { buildArenaView, ZONE1_LOOK } from '../src/gen/zone/arenaView';

/**
 * Провалы открыты в бездну: верх «корня» острова (диск радиусом до 5 м на глубине ~1.7 м) не затыкает яму.
 * Луч вниз из сетки точек провала: ниже −3 м видна бездна (сталагмиты со дна — не в счёт, их мало).
 */
describe('провалы в полу', () => {
  for (const def of Object.values(ARENAS).filter((a) => a.holes?.length)) {
    // зерна этапов на этой арене (как в бою) и пара случайных
    const seeds = [...ZONE1.filter((s) => s.arena === def.id).map((s) => `stage:${s.id}`), `${def.id}:a`, `${def.id}:b`];
    it.each(seeds)(`${def.id} (%s): под провалом нет пробки на глубине пары метров`, (seed) => {
      const view = buildArenaView(new Arena(def), seed, ZONE1_LOOK);
      view.root.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      view.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o as THREE.Mesh); });
      const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
      for (const h of def.holes!) {
        let n = 0, plugged = 0;
        for (let u = -0.35; u <= 0.351; u += 0.1) for (let v = -0.35; v <= 0.351; v += 0.1) {
          rc.set(new THREE.Vector3(h.x + u * h.w, -0.6, h.z + v * h.h), down);
          rc.far = 2.4;
          n++;
          if (rc.intersectObjects(meshes, false).length) plugged++;
        }
        expect(plugged / n, `${seed} (${h.x}, ${h.z})`).toBeLessThan(0.15);
      }
    });
  }
});
