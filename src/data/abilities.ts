/** Способности (GDD §6): Q — быстрая (КД 3–6 с), E — тактическая (7–12 с), R — ульта (Резонанс 100). */
export type AbilityId = 'crescent' | 'phase' | 'well' | 'eclipse';
export type Slot = 'q' | 'e' | 'r';

export interface AbilityDef {
  id: AbilityId;
  slot: Slot;
  name: string;
  desc: string;
  cd: number;
  dmg: number;
  /** Где открывается (для UI): id этапа или босса. */
  unlock: string;
  icon: 'crescent' | 'rift' | 'spiral' | 'eclipse';
  mutA: { name: string; desc: string };
  mutB: { name: string; desc: string };
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  crescent: {
    id: 'crescent', slot: 'q', name: 'Серп Луны', icon: 'crescent', cd: 4, dmg: 1.6, unlock: 'start',
    desc: 'Метает серп-полумесяц на 7 м, он возвращается. 1.6× туда и обратно.',
    mutA: { name: 'Затмение серпа', desc: '3 серпа веером.' },
    mutB: { name: 'Бумеранг Бездны', desc: 'Серп зависает в конце пути на 1.5 с, вращаясь.' },
  },
  phase: {
    id: 'phase', slot: 'q', name: 'Фазовый шаг', icon: 'rift', cd: 5, dmg: 2.0, unlock: '1-4',
    desc: 'Телепорт на 5 м сквозь врагов, разрез по линии 2.0×, восстанавливает заряд рывка.',
    mutA: { name: 'Двойная фаза', desc: '2 заряда.' },
    mutB: { name: 'Расщепление', desc: 'Оставляет фантома, который повторяет следующий удар.' },
  },
  well: {
    id: 'well', slot: 'e', name: 'Гравитационный колодец', icon: 'spiral', cd: 10, dmg: 2.5, unlock: 'boss1',
    desc: 'Сфера стягивает врагов в радиусе 5 м на 2 с, затем взрыв 2.5×.',
    mutA: { name: 'Горизонт событий', desc: 'Враги внутри получают +30 % урона.' },
    mutB: { name: 'Коллапс', desc: 'Сфера движется за героем.' },
  },
  eclipse: {
    id: 'eclipse', slot: 'r', name: 'Затмение', icon: 'eclipse', cd: 0, dmg: 1.0, unlock: '1-6',
    desc: '6 с трансформации: клинок ×2, каждый удар выпускает волну, скорость +30 %, неуязвимость к станам.',
    mutA: { name: 'Полное затмение', desc: '+2 с, в конце взрыв 8×.' },
    mutB: { name: 'Кровавая луна', desc: 'Вампиризм 4 % от урона.' },
  },
};

/** Уровни способностей (GDD §8.4, пересмотрено): I → II: +45 % урона, −10 % КД; II → III: +45 % урона, открытие мутации. */
export const ABILITY_LEVEL = {
  costs: [0, 900, 3200],
  etherCost: [0, 0, 3],
  mutationSwap: 2,
  dmgPerLevel: 0.45,
  cdLevel2: 0.9,
};
