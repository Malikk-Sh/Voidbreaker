import type { AudioEngine } from '../audio/engine';
import type { Sequencer } from '../audio/music';
import type { Time } from '../core/time';
import type { Input } from '../input/input';
import type { Renderer } from '../render/renderer';
import type { Hud } from '../ui/hud';
import type { Settings } from '../meta/settings';
import type { SaveData } from '../meta/save';

/** Общие сервисы игры, которые получают экраны и бой. */
export interface GameContext {
  renderer: Renderer;
  input: Input;
  audio: AudioEngine;
  music: Sequencer;
  hud: Hud;
  time: Time;
  settings: Settings;
  save: SaveData;
  persist: () => void;
  flag: (id: string) => boolean;
  setFlag: (id: string) => void;
}

/**
 * Кинозал (ревью): пересмотр сцены играет на копии сохранения. Казнь, флаги подсказок и прочие записи боя
 * остаются в копии — звёзды, титулы и записи Архива не выдаются; в настоящее сохранение уходит только
 * счётчик просмотров сцен (`cine`).
 */
export function replayContext(ctx: GameContext): GameContext {
  const save = structuredClone(ctx.save);
  return {
    ...ctx,
    save,
    persist: () => { ctx.save.cine = { ...save.cine }; ctx.persist(); },
    flag: (id) => !!save.flags[id],
    setFlag: (id) => { save.flags[id] = true; },
  };
}
