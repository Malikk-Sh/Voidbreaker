import { describe, expect, it } from 'vitest';
import { Ambience, AMBIENCE, AMB_LEVEL } from '../src/audio/ambience';
import type { LoopHandle, PlayOpts } from '../src/audio/engine';

/** Заглушка аудио: считает запуски петель и одиночные звуки, громкость петель — по последней цели. */
function fakeAudio(ready = true) {
  const played: { id: string; o?: PlayOpts }[] = [];
  const loops: { id: string; gain: number; stopped: boolean }[] = [];
  return {
    played, loops, ready,
    time: 0,
    startLoop(id: string): LoopHandle | null {
      if (!this.ready) return null;
      const l = { id, gain: 0, stopped: false };
      loops.push(l);
      const gain = { gain: { setTargetAtTime: (v: number) => { l.gain = v; } } } as unknown as GainNode;
      return { gain, stop: () => { l.stopped = true; } };
    },
    play(id: string, o?: PlayOpts) { played.push({ id, o }); },
  };
}

describe('тихий фон арены (план §8.5)', () => {
  it('у каждого этапа зоны 01 и у босса свой фон', () => {
    for (const id of ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', 'boss1']) expect(AMBIENCE[id], id).toBeTruthy();
  });

  it('петли ждут запечённых звуков, между волнами громче, чем в бою; stop глушит', () => {
    const a = fakeAudio(false);
    const amb = new Ambience(a, AMBIENCE['1-1'], () => 0.5);
    amb.set(AMB_LEVEL.calm);
    amb.update(0.1);
    expect(a.loops.length).toBe(0);
    a.ready = true;
    for (let i = 0; i < 300; i++) amb.update(1 / 30);
    const wind = a.loops.find((l) => l.id === 'amb_wind')!;
    expect(wind).toBeTruthy();
    const calm = wind.gain;
    amb.set(AMB_LEVEL.fight);
    for (let i = 0; i < 300; i++) amb.update(1 / 30);
    expect(wind.gain).toBeLessThan(calm * 0.5);
    amb.stop();
    expect(a.loops.every((l) => l.stopped)).toBe(true);
  });

  it('капли и колокол — редкие, с частотой около заданной; без колокола на арене — ни одного', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const a = fakeAudio();
    const amb = new Ambience(a, AMBIENCE['1-6'], rnd);
    amb.set(1);
    for (let i = 0; i < 600 * 30; i++) amb.update(1 / 30); // 10 минут
    const bells = a.played.filter((p) => p.id === 'amb_bell').length;
    const drops = a.played.filter((p) => p.id === 'amb_drop').length;
    expect(bells).toBeGreaterThan(AMBIENCE['1-6'].bell * 10 * 0.5);
    expect(bells).toBeLessThan(AMBIENCE['1-6'].bell * 10 * 1.6);
    expect(drops).toBeGreaterThan(AMBIENCE['1-6'].drops * 10 * 0.5);
    const b = fakeAudio();
    const amb2 = new Ambience(b, AMBIENCE['1-4'], rnd);
    amb2.set(1);
    for (let i = 0; i < 300 * 30; i++) amb2.update(1 / 30);
    expect(b.played.some((p) => p.id === 'amb_bell')).toBe(false);
  });
});
