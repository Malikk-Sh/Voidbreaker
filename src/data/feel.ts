/**
 * Профили ощущения (Tech §15.4, GDD §14): hitstop, травма камеры, кик, вспышка, вибрация, звук, пружина.
 * Game feel настраивается здесь, без правки боевой логики.
 */
export interface FeelProfile {
  hitstop: number;
  trauma: number;
  kick: number;
  flash: number;
  vibrate: number;
  sfx: 'hit_light' | 'hit_medium' | 'hit_heavy' | 'posture_break';
  spring: number;
  zoomPunch?: number;
  chroma?: number;
  shockwave?: boolean;
  crack?: boolean;
  shards: number;
}

export const FEEL: Record<'light' | 'medium' | 'heavy' | 'break', FeelProfile> = {
  light: { hitstop: 0.035, trauma: 0.08, kick: 0.05, flash: 0.06, vibrate: 10, sfx: 'hit_light', spring: 0.6, shards: 4 },
  medium: { hitstop: 0.05, trauma: 0.15, kick: 0.08, flash: 0.08, vibrate: 15, sfx: 'hit_medium', spring: 0.9, shards: 6 },
  heavy: { hitstop: 0.09, trauma: 0.3, kick: 0.15, flash: 0.1, vibrate: 35, sfx: 'hit_heavy', spring: 1.4, zoomPunch: 0.04, shards: 10 },
  break: { hitstop: 0.16, trauma: 0.45, kick: 0.2, flash: 0.14, vibrate: 80, sfx: 'posture_break', spring: 2.0, chroma: 0.4, shockwave: true, crack: true, shards: 16 },
};

export type FeelId = keyof typeof FEEL;

/** Доп. hitstop за крит (GDD §14.1). */
export const CRIT_HITSTOP = 0.02;
