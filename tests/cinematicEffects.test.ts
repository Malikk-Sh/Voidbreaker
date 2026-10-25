import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../src/core/events';
import { Time } from '../src/core/time';
import { FeelSystem } from '../src/game/feel';
import { DEFAULT_SETTINGS } from '../src/meta/settings';
import { CameraRig } from '../src/world/camera';
import type { GameEvents } from '../src/world/events';

function fixture(photosensitive = false) {
  const bus = new EventBus<GameEvents>(), time = new Time(), cam = new CameraRig();
  const trauma = vi.spyOn(cam, 'addTrauma'), hitstop = vi.spyOn(time, 'addHitstop');
  const vfx = { quality: 1, burst: vi.fn(), debris: { burst: vi.fn() }, add: { emit: vi.fn() }, slashes: { spawn: vi.fn() }, lights: { flash: vi.fn() }, rings: { spawn: vi.fn() } };
  const audio = { play: vi.fn() }, input = { vibrate: vi.fn() };
  const args = [{ bus, hero: { x: 0, z: 0 } }, time, cam, {}, vfx, audio, {}, input, {}, { ...DEFAULT_SETTINGS, photosensitive }, new THREE.PerspectiveCamera()] as unknown as ConstructorParameters<typeof FeelSystem>;
  const feel = new FeelSystem(...args);
  return { bus, time, cam, trauma, hitstop, vfx, audio, input, feel };
}

describe('эффекты постановочного удара и победы', () => {
  it('каменный удар выбрасывает сколы и направленные искры из контакта, не меняя крупность камеры', () => {
    const f = fixture();
    f.bus.emit('finisherImpact', { x: 2, y: 3, z: 4, facing: Math.PI / 2, material: 'stone' });
    expect(f.vfx.debris.burst).toHaveBeenCalledOnce();
    expect(f.vfx.debris.burst.mock.calls[0].slice(0, 3)).toEqual([2, 3, 4]);
    const [count, particles, spread] = f.vfx.burst.mock.calls[0];
    expect(count).toBeGreaterThan(10); expect(particles).toMatchObject({ x: 2, y: 3, z: 4, frame: 'spark' });
    expect(spread.dir[0]).toBeCloseTo(1, 8); expect(spread.dir[1]).toBeCloseTo(0, 8); expect(spread.cone).toBeLessThan(0.4);
    expect(f.vfx.slashes.spawn.mock.calls[0][0][0]).toMatchObject({ dir: -1, shape: 'vert' });
    expect(f.cam.zoomPunch).toBe(0); expect(f.hitstop).not.toHaveBeenCalled();
  });

  it('бронза даёт быструю стружку, печать — более медленные светящиеся фрагменты', () => {
    const bronze = fixture(), seal = fixture();
    bronze.bus.emit('finisherImpact', { x: 0, y: 3, z: 0, facing: 0, material: 'bronze' });
    seal.bus.emit('finisherImpact', { x: 0, y: 3, z: 0, facing: 0 });
    expect(bronze.vfx.debris.burst).not.toHaveBeenCalled();
    expect(bronze.vfx.burst.mock.calls[0][1].stretch).toBeGreaterThan(2);
    expect(bronze.vfx.burst.mock.calls[0][2].v).toBeGreaterThan(seal.vfx.burst.mock.calls[0][2].v);
    expect(seal.vfx.burst.mock.calls.some(c => c[1].frame === 'star')).toBe(true);
    expect(bronze.vfx.burst.mock.calls.some(c => c[1].frame === 'star')).toBe(false);
  });

  it('режим уменьшенных вспышек снижает локальный свет и вспышку, сохраняя направление удара', () => {
    const normal = fixture(), subdued = fixture(true);
    for (const f of [normal, subdued]) f.bus.emit('finisherImpact', { x: 0, y: 3, z: 0, facing: 0, material: 'stone' });
    expect(subdued.vfx.lights.flash.mock.calls[0][4]).toBeLessThan(normal.vfx.lights.flash.mock.calls[0][4] * 0.5);
    expect(subdued.vfx.add.emit.mock.calls[0][0].alpha).toBeLessThan(normal.vfx.add.emit.mock.calls[0][0].alpha * 0.5);
    expect(subdued.vfx.burst.mock.calls[0][2].dir).toEqual(normal.vfx.burst.mock.calls[0][2].dir);
    expect(subdued.cam.zoomPunch).toBe(0);
  });

  it('победный акцент остаётся у ног, искры поднимаются медленно и камера не получает отдачу', () => {
    const f = fixture();
    f.bus.emit('bossVictory', { x: 2, y: 0.4, z: 4, facing: 0.3, tone: 'gold' });
    const ring = f.vfx.rings.spawn.mock.calls[0];
    expect(ring[0]).toBe(2); expect(ring[1]).toBe(4); expect(ring[4]).toBeGreaterThan(1); expect(ring[8]).toBeCloseTo(0.435, 8);
    expect(ring[6]).toBeLessThan(0.1); expect(ring[7]).toBeLessThan(0.35);
    expect(f.vfx.add.emit.mock.calls.length).toBeGreaterThan(8);
    for (const [p] of f.vfx.add.emit.mock.calls) { expect(p.vy).toBeGreaterThan(0); expect(p.vy).toBeLessThan(1.2); expect(p.life).toBeGreaterThan(1); }
    expect(f.cam.zoomPunch).toBe(0); expect(f.trauma).not.toHaveBeenCalled(); expect(f.hitstop).not.toHaveBeenCalled();
    expect(f.audio.play).toHaveBeenCalledWith('exhale', expect.objectContaining({ gain: 0.45 }));
  });
});
