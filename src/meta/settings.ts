import type { QualityLevel } from '../render/renderer';
import type { CamMode } from '../world/camera';
import type { LightMode } from '../render/worldLight';

/** Доступность и настройки (GDD §21). */
export interface Settings {
  /** Интенсивность тряски 0..1. */
  shake: number;
  /** Вспышки (выкл — заменяются на мягкое затемнение). */
  flashes: boolean;
  /** Режим без вспышек для фоточувствительных: белые кадры выключены, мерцание < 3 Гц. */
  photosensitive: boolean;
  aberration: boolean;
  distortion: boolean;
  /** Сила автоприцела: 0 — выкл, 1 — слабый, 2 — стандарт, 3 — сильный. */
  autoAim: number;
  vibration: boolean;
  volMaster: number; volMusic: number; volSfx: number; volVoice: number;
  quality: 'auto' | QualityLevel;
  /** Режим «История» (−40 % урона по игроку) — не даёт ★★★. */
  story: boolean;
  showFps: boolean;
  /** Штриховка телеграфов для дальтоников 0..1. */
  hatch: number;
  subtitleSize: number;
  buttonScale: number;
  buttonOffsetX: number;
  buttonOffsetY: number;
  /** Дистанция камеры в бою (множитель): меньше — ближе к Пилоту. */
  camDist: number;
  /** Боевая камера (план ×100, C1): «Кино» — по умолчанию, и для старых сохранений; «Тактическая» — прежний обзор сверху. */
  camMode: CamMode;
  /** Новый свет — буфер света в мире (план ×100, A1): «Авто» — только на высоком качестве, пока нет замера на телефонах. */
  light: LightMode;
  /** Полноэкранный режим: включается по первому касанию на титуле. */
  fullscreen: boolean;
  /** «Короткие казни»: Раскол элиты и Стражей всегда в короткой версии (план §5.6). */
  shortExec: boolean;
  /** Сцены без нажатий: необязательные действия в сценах (поднять клинок) продолжаются сами (ТЗ §14). */
  autoScenes: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  shake: 1, flashes: true, photosensitive: false, aberration: true, distortion: true, autoAim: 2, vibration: true,
  volMaster: 0.9, volMusic: 0.6, volSfx: 0.9, volVoice: 0.8, quality: 'auto', story: false, showFps: false,
  hatch: 0.35, subtitleSize: 1, buttonScale: 1, buttonOffsetX: 0, buttonOffsetY: 0, camDist: 1, camMode: 'cinema', light: 'auto', fullscreen: false, shortExec: false, autoScenes: false,
};

export function effectiveFlashes(s: Settings): boolean { return s.flashes && !s.photosensitive; }
