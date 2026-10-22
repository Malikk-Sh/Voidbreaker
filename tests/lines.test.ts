import { describe, expect, it } from 'vitest';
import { FeelSystem } from '../src/game/feel';
import { KAELIS_LINES } from '../src/data/lines';

describe('реплики Каэлис выключены до переписывания сюжета', () => {
  it('голос Каэлис молчит (ни субтитра, ни блипов), реплики босса — звучат', () => {
    expect(KAELIS_LINES).toBe(false);
    const subs: string[] = [], spoken: string[] = [];
    const fake = { time: { real: 100 }, lastVoice: -99, hud: { subtitle: (t: string) => subs.push(t) }, audio: { speak: (t: string) => spoken.push(t) } };
    const voice = FeelSystem.prototype.voice;
    voice.call(fake as never, 'Пилот… Пилот!', 0, 'kaelis');
    voice.call(fake as never, 'Мост рушится!', 0);
    expect(subs).toEqual([]);
    expect(spoken).toEqual([]);
    voice.call(fake as never, 'Звон…', 0, 'boss');
    expect(subs).toEqual(['Звон…']);
  });
});
