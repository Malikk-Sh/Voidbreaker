import type { AbilityId } from '../data/abilities';
import { DEFAULT_SETTINGS, type Settings } from './settings';

/** Сохранение (Tech §24). */
export interface SaveData {
  /** 2 — ветки статов по 20 уровней (старые уровни пересчитаны: ⌈n/2⌉). */
  version: 2;
  createdAt: number;
  updatedAt: number;
  currencies: { shards: number; ether: number };
  stats: { power: number; agility: number; fortitude: number; resonance: number };
  abilities: Partial<Record<AbilityId, { level: 1 | 2 | 3; mutation?: 'A' | 'B' }>>;
  loadout: { weapon: string; q: AbilityId | null; e: AbilityId | null; r: AbilityId | null; relics: string[] };
  weapons: Record<string, { unlocked: boolean; level: number }>;
  relics: string[];
  stages: Record<string, { stars: 0 | 1 | 2 | 3; bestRank: string; bestTime: number; clears: number }>;
  bosses: Record<string, { defeated: boolean; attempts: number; losses: number }>;
  settings: Settings;
  flags: Record<string, boolean>;
  lore: string[];
  /** Сколько раз видена каждая сцена (план §8.1): дважды — укороченная версия; открытые — в Кинозале. */
  cine: Record<string, number>;
  /** Звёзды зон, загоревшиеся после боссов (план §8.3.2): 1 — горит, 2 — и вторая малая (безупречная казнь). */
  stars: Record<string, number>;
  /** Титулы (безупречная казнь и т.п.). */
  titles: string[];
}

const KEY = 'voidbreaker.save.v1';
const TMP = 'voidbreaker.save.tmp';

export function newSave(): SaveData {
  const now = Date.now();
  return {
    version: 2, createdAt: now, updatedAt: now,
    currencies: { shards: 0, ether: 0 },
    stats: { power: 0, agility: 0, fortitude: 0, resonance: 0 },
    abilities: { crescent: { level: 1 } },
    loadout: { weapon: 'void_blade', q: 'crescent', e: null, r: null, relics: [] },
    weapons: { void_blade: { unlocked: true, level: 1 } },
    relics: [],
    stages: {},
    bosses: {},
    settings: { ...DEFAULT_SETTINGS },
    flags: {},
    lore: [],
    cine: {},
    stars: {},
    titles: [],
  };
}

/** Контрольная сумма FNV-1a по JSON — защита от повреждённой записи. */
function checksum(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function parse(raw: string | null): SaveData | null {
  if (!raw) return null;
  try {
    const { sum, data } = JSON.parse(raw) as { sum: string; data: string };
    if (checksum(data) !== sum) return null;
    return migrate(JSON.parse(data));
  } catch { return null; }
}

/** Миграции по version + заполнение новых полей значениями по умолчанию. */
export function migrate(d: Partial<SaveData>): SaveData {
  const base = newSave();
  const from = (d as { version?: number }).version ?? 1;
  const s: SaveData = { ...base, ...d, version: 2 } as SaveData;
  s.currencies = { ...base.currencies, ...d.currencies };
  s.stats = { ...base.stats, ...d.stats };
  // v1 → v2: уровень статов стал вдвое сильнее, а ветка — вдвое короче
  if (from < 2) for (const k of Object.keys(s.stats) as (keyof SaveData['stats'])[]) s.stats[k] = Math.min(20, Math.ceil(s.stats[k] / 2));
  s.loadout = { ...base.loadout, ...d.loadout };
  s.settings = { ...DEFAULT_SETTINGS, ...d.settings };
  s.abilities = { ...base.abilities, ...d.abilities };
  s.weapons = { ...base.weapons, ...d.weapons };
  s.flags = { ...d.flags };
  s.stages = { ...d.stages };
  s.bosses = { ...d.bosses };
  s.lore = d.lore ?? [];
  s.cine = { ...d.cine };
  s.stars = { ...d.stars };
  s.titles = d.titles ?? [];
  s.relics = d.relics ?? [];
  return s;
}

export function loadSave(): SaveData {
  try {
    return parse(localStorage.getItem(KEY)) ?? parse(localStorage.getItem(TMP)) ?? newSave();
  } catch { return newSave(); }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Запись с дебаунсом 1 с: через временный ключ + контрольная сумма. */
export function writeSave(s: SaveData, immediate = false): void {
  const run = () => {
    timer = null;
    s.updatedAt = Date.now();
    const data = JSON.stringify(s);
    const payload = JSON.stringify({ sum: checksum(data), data });
    try {
      localStorage.setItem(TMP, payload);
      localStorage.setItem(KEY, payload);
      localStorage.removeItem(TMP);
    } catch { /* хранилище недоступно (приватный режим) — игра продолжается */ }
  };
  if (timer) clearTimeout(timer);
  if (immediate) run(); else timer = setTimeout(run, 1000);
}

/** Экспорт/импорт строкой (base64) для переноса между устройствами. */
export function exportSave(s: SaveData): string {
  const data = JSON.stringify(s);
  return btoa(unescape(encodeURIComponent(JSON.stringify({ sum: checksum(data), data }))));
}
export function importSave(str: string): SaveData | null {
  try { return parse(decodeURIComponent(escape(atob(str.trim())))); } catch { return null; }
}

export function resetSave(): SaveData {
  try { localStorage.removeItem(KEY); localStorage.removeItem(TMP); } catch { /* */ }
  return newSave();
}
