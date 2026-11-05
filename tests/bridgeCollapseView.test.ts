import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BridgeCollapseView } from '../src/gen/zone/bridgeCollapse';
import type { ArenaView } from '../src/gen/zone/arenaView';

describe('видимый обвал моста', () => {
  it('роняет перила вместе с рядами пола и гасит их свечи, сохраняя концевые опоры', () => {
    const view = { root: new THREE.Group(), casters: [], flames: [], pools: [] } as unknown as ArenaView;
    const bridge = new BridgeCollapseView(view);
    const fixed = view.casters.map(m => m.position.clone());
    expect(bridge.visibilityAt(2.85,-41)).toBe(1);
    expect(bridge.start()).toBe(true); expect(bridge.start()).toBe(false);
    bridge.step(0);
    expect(bridge.visibilityAt(2.85,-41)).toBe(1);
    bridge.step(2.6);
    expect(bridge.visibilityAt(2.85,-41)).toBe(0);
    expect(bridge.visibilityAt(2.85,-26)).toBe(1);
    expect(bridge.visibilityAt(8,-55)).toBe(1);
    view.casters.forEach((mesh,i) => expect(mesh.position.equals(fixed[i])).toBe(true));
    const fallen = bridge.group.children.filter(o => o instanceof THREE.Mesh && !view.casters.includes(o as THREE.Mesh) && !(o instanceof THREE.InstancedMesh) && !((o as THREE.Mesh).geometry instanceof THREE.InstancedBufferGeometry));
    expect(fallen.length).toBeGreaterThan(0);
    expect(fallen.every(o => o.position.y < 0)).toBe(true);
    const beforePause = fallen.map(o => o.position.y); bridge.step(0);
    expect(fallen.map(o => o.position.y)).toEqual(beforePause);
    let instanceDisposals = 0;
    for (const mesh of bridge.group.children) if (mesh instanceof THREE.InstancedMesh) mesh.addEventListener('dispose', () => instanceDisposals++);
    bridge.dispose();
    expect(instanceDisposals).toBe(1); expect(bridge.group.parent).toBe(null);
  });
});
