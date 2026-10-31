import { fxRng } from '../core/rng';
import type { LoopHandle, PlayOpts } from './engine';

/** Что фону нужно от аудиодвижка (в тестах — заглушка). */
export interface AmbienceAudio {
  startLoop(id: string, reverb?: number): LoopHandle | null;
  play(id: string, o?: PlayOpts): void;
  readonly time: number;
}

/**
 * Тихий фон арены (план §8.5): ветер в проломах и далёкий хор — петли (громкость 0..1),
 * колокол и капли — редкие одиночные звуки (в минуту).
 */
export interface AmbienceDef { wind: number; choir: number; bell: number; drops: number }

export const AMBIENCE: Record<string, AmbienceDef> = {
  '1-1': { wind: 0.9, choir: 0.2, bell: 0, drops: 7 },     // пролом в куполе: сквозняк, капли с обломков
  '1-2': { wind: 0.3, choir: 0.6, bell: 0.6, drops: 9 },   // нефы: хор за стенами
  '1-3': { wind: 0.8, choir: 0.25, bell: 0.4, drops: 3 },  // ворота открыты в бездну
  '1-4': { wind: 0.15, choir: 0.7, bell: 0, drops: 11 },   // свечной зал: тихо, капает воск и вода
  '1-5': { wind: 1, choir: 0.1, bell: 0.4, drops: 0 },     // мост: только ветер бездны
  '1-6': { wind: 0.6, choir: 0.3, bell: 2.2, drops: 4 },   // колокольня
  '1-7': { wind: 0.55, choir: 0.35, bell: 0.3, drops: 6 }, // клуатр: двор под открытым небом
  '1-8': { wind: 0.1, choir: 0.45, bell: 0, drops: 14 },   // крипта: тесно, сыро
  '1-9': { wind: 0.4, choir: 0.95, bell: 0.8, drops: 3 },  // хоры: поют за стенами
  boss1: { wind: 0.4, choir: 0.85, bell: 1, drops: 3 },    // святилище: хор
};

/** Уровень фона: между волнами — полный, в бою — под музыкой. */
export const AMB_LEVEL = { calm: 1, fight: 0.3 };

/** Общая громкость петель (они под всем остальным). */
const LOOP_GAIN = 0.7;

export class Ambience {
  private loops: { h: LoopHandle; base: number; choir?: boolean }[] | null = null;
  private choirMuted = false;
  level = 0;
  private target = 0;
  private applied = -1;
  private nextBell: number;
  private nextDrop: number;
  private stopped = false;

  /** rnd — косметический поток: интервалы капель и колокола не должны сдвигать решения врагов. */
  constructor(private readonly audio: AmbienceAudio, private readonly def: AmbienceDef, private readonly rnd: () => number = () => fxRng.next()) {
    this.nextBell = this.gap(def.bell) * 0.5;
    this.nextDrop = this.gap(def.drops) * 0.5;
  }

  /** Целевой уровень 0..1 (между волнами — AMB_LEVEL.calm, в бою — AMB_LEVEL.fight). */
  set(level: number): void { this.target = level; }
  setChoirMuted(muted: boolean): void { if (muted !== this.choirMuted) { this.choirMuted = muted; this.applied = -1; } }

  update(dt: number): void {
    if (this.stopped) return;
    // петли запускаются, как только звуки запечены и контекст разблокирован
    if (!this.loops) {
      const l: { h: LoopHandle; base: number; choir?: boolean }[] = [];
      const wind = this.def.wind > 0 ? this.audio.startLoop('amb_wind', 0.1) : null;
      const choir = this.def.choir > 0 ? this.audio.startLoop('amb_choir', 0.5) : null;
      if ((this.def.wind > 0 && !wind) || (this.def.choir > 0 && !choir)) { wind?.stop(); choir?.stop(); }
      else {
        if (wind) l.push({ h: wind, base: this.def.wind });
        if (choir) l.push({ h: choir, base: this.def.choir, choir: true });
        this.loops = l;
      }
    }
    this.level += (this.target - this.level) * Math.min(1, dt * 0.8);
    if (this.loops && Math.abs(this.level - this.applied) > 0.01) {
      this.applied = this.level;
      for (const l of this.loops) l.h.gain.gain.setTargetAtTime(l.base * this.level * LOOP_GAIN * (l.choir && this.choirMuted ? 0.06 : 1), this.audio.time, 0.25);
    }
    // одиночные звуки: случайные интервалы (в среднем 60 / частота с), тише в бою
    this.nextBell -= dt;
    if (this.def.bell > 0 && this.nextBell <= 0) {
      this.nextBell = this.gap(this.def.bell);
      this.audio.play('amb_bell', { gain: 0.45 * this.level, pan: (this.rnd() - 0.5) * 1.2, vary: 0.04 });
    }
    this.nextDrop -= dt;
    if (this.def.drops > 0 && this.nextDrop <= 0) {
      this.nextDrop = this.gap(this.def.drops);
      this.audio.play('amb_drop', { gain: 0.9 * this.level, pan: (this.rnd() - 0.5) * 1.6, vary: 0.12 });
    }
  }

  stop(): void {
    this.stopped = true;
    for (const l of this.loops ?? []) l.h.stop();
    this.loops = null;
  }

  /** Интервал до следующего звука: экспоненциальный, со средним 60 / perMin, не короче четверти среднего. */
  private gap(perMin: number): number {
    if (perMin <= 0) return Infinity;
    const mean = 60 / perMin;
    return Math.max(mean * 0.25, -Math.log(1 - this.rnd() * 0.999) * mean);
  }
}
