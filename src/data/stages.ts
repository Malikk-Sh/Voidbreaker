import type { AbilityId } from './abilities';
import type { Affix, EnemyKind } from './enemies';

export interface SpawnDef {
  enemy: EnemyKind;
  count: number;
  /** ring — кольцом вокруг героя; edges — у краёв арены; far — дальше от героя; at — именованные точки. */
  pattern?: 'ring' | 'edges' | 'far' | 'random';
  at?: ('left' | 'right' | 'top' | 'bottom' | 'center')[];
  delay?: number;
  elite?: Affix[];
  /** Шаг между появлениями (с). */
  stagger?: number;
}

export interface WaveDef {
  spawns: SpawnDef[];
  triggers?: { when: 'eliteHp<0.5' | 'guardianHp<0.5' | 'alive<3'; spawn: SpawnDef }[];
  /** Музыка/подсказки: волна со Стражем. */
  guardian?: boolean;
}

export interface StageDef {
  id: string;
  zone: number;
  index: number;
  name: string;
  arena: string;
  waves: WaveDef[];
  /** Что открывает первое прохождение (GDD §6). */
  unlocks?: AbilityId[];
  boss?: boolean;
  /** Подсказки онбординга (GDD §20) — показываются один раз. */
  tutorial?: 'basics' | 'charged' | 'shatter' | 'upgrade' | 'ult';
}

/** Награда за этап (GDD §8.5): осколки_первое = 120 × (1 + 0.35 × g). */
export function stageShards(globalIndex: number): number { return Math.round(120 * (1 + 0.35 * globalIndex)); }

/**
 * Волны Зоны 01 (план §6.8): на 40 % меньше врагов, у каждой волны одна главная задача (в комментарии)
 * и не больше двух механик. Шелуха — наполнитель, механикой не считается.
 */
export const ZONE1: StageDef[] = [
  {
    id: '1-1', zone: 0, index: 0, name: 'Падение', arena: 'fall', tutorial: 'basics',
    waves: [
      // удары: Шелуха держит два
      { spawns: [{ enemy: 'spiker', count: 3, pattern: 'far', stagger: 0.4 }, { enemy: 'husk', count: 3, pattern: 'far', delay: 2.5, stagger: 0.2 }] },
      // уклонение от выпада Жнеца
      { spawns: [{ enemy: 'husk', count: 6, pattern: 'ring', stagger: 0.12 }, { enemy: 'reaper', count: 1, pattern: 'far', delay: 2.5 }] },
      // толпа и выпады вместе
      { spawns: [{ enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 }, { enemy: 'spiker', count: 3, pattern: 'ring', delay: 1.2 }, { enemy: 'reaper', count: 1, pattern: 'edges', delay: 2.5 }] },
    ],
  },
  {
    id: '1-2', zone: 0, index: 1, name: 'Нефы', arena: 'naves', tutorial: 'charged', unlocks: ['well'],
    waves: [
      // дальний враг: дотянуться до Ока (Серп Луны)
      { spawns: [{ enemy: 'husk', count: 7, pattern: 'ring', stagger: 0.12 }, { enemy: 'eye', count: 1, at: ['top'], delay: 1.5 }] },
      // заряженный удар оглушает Голема
      { spawns: [{ enemy: 'golem', count: 1, pattern: 'far' }, { enemy: 'husk', count: 5, pattern: 'edges', delay: 1.5, stagger: 0.15 }] },
      // выпады Жнецов в толпе
      { spawns: [{ enemy: 'reaper', count: 2, pattern: 'edges' }, { enemy: 'husk', count: 8, pattern: 'ring', delay: 2, stagger: 0.1 }] },
    ],
  },
  {
    id: '1-3', zone: 0, index: 2, name: 'Врата', arena: 'gate', tutorial: 'shatter', unlocks: ['eclipse'],
    waves: [
      // сбросить толпу в провалы
      { spawns: [{ enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 2 }] },
      // оглушить Голема и Расколоть; Аколит со щитом — приоритет
      { spawns: [{ enemy: 'golem', count: 1, pattern: 'far' }, { enemy: 'acolyte', count: 1, at: ['top'], delay: 2 }, { enemy: 'husk', count: 5, pattern: 'edges', delay: 3 }] },
      // Страж Врат
      { guardian: true, spawns: [{ enemy: 'gateGuardian', count: 1, at: ['top'] }],
        triggers: [{ when: 'guardianHp<0.5', spawn: { enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.12 } }] },
    ],
  },
  {
    id: '1-4', zone: 0, index: 3, name: 'Свечной зал', arena: 'candles', tutorial: 'ult', unlocks: ['phase'],
    waves: [
      // уклонение от выпада Жнеца
      { spawns: [{ enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 1.5 }] },
      // приоритет цели: Аколит со щитом; Ока на краях
      { spawns: [{ enemy: 'eye', count: 2, at: ['left', 'right'] }, { enemy: 'acolyte', count: 1, at: ['top'], delay: 1 }, { enemy: 'husk', count: 6, pattern: 'ring', delay: 1.5, stagger: 0.12 }] },
      // сбросить Голема в колодец заряженным ударом
      { spawns: [{ enemy: 'golem', count: 1, at: ['center'] }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 1 }, { enemy: 'husk', count: 6, pattern: 'edges', delay: 3 }] },
      // Раскол элиты
      { spawns: [{ enemy: 'golem', count: 1, at: ['top'], elite: ['hasted'] }],
        triggers: [{ when: 'eliteHp<0.5', spawn: { enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 } }] },
    ],
  },
  {
    id: '1-5', zone: 0, index: 4, name: 'Мост над бездной', arena: 'bridge', tutorial: 'upgrade',
    waves: [
      // сбросить толпу с мостов в бездну
      { spawns: [{ enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 }, { enemy: 'spiker', count: 4, pattern: 'ring', delay: 1 }] },
      // Ока на концах мостов: снаряды — украсть уклонением и вернуть
      { spawns: [{ enemy: 'eye', count: 2, at: ['left', 'right'] }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 1.5 }, { enemy: 'husk', count: 4, pattern: 'ring', delay: 3 }] },
      // Раскол элиты; Голем на мосту
      { spawns: [{ enemy: 'reaper', count: 1, at: ['left'], elite: ['explosive', 'hasted'] }, { enemy: 'golem', count: 1, at: ['right'], delay: 1.5 }],
        triggers: [{ when: 'eliteHp<0.5', spawn: { enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 } }] },
    ],
  },
  {
    id: '1-6', zone: 0, index: 5, name: 'Колокольня', arena: 'belfry',
    waves: [
      // приоритет цели: два Аколита за толпой
      { spawns: [{ enemy: 'husk', count: 10, pattern: 'ring', stagger: 0.08 }, { enemy: 'acolyte', count: 2, at: ['left', 'right'], delay: 1.5 }] },
      // Големы (оглушение и Раскол) под огнём Ок
      { spawns: [{ enemy: 'golem', count: 2, pattern: 'far' }, { enemy: 'eye', count: 2, at: ['left', 'right'], delay: 1 }, { enemy: 'husk', count: 4, pattern: 'ring', delay: 3 }] },
      // Звонарь
      { guardian: true, spawns: [{ enemy: 'bellRinger', count: 1, at: ['top'] }],
        triggers: [
          { when: 'guardianHp<0.5', spawn: { enemy: 'reaper', count: 2, pattern: 'edges' } },
          { when: 'guardianHp<0.5', spawn: { enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.12 } },
        ] },
    ],
  },
  {
    id: 'boss1', zone: 0, index: 6, name: 'Иерофант Скорби', arena: 'hierophant', boss: true,
    waves: [{ spawns: [{ enemy: 'hierophant', count: 1, at: ['top'] }] }],
  },
];

export const ZONE1_INFO = {
  id: 'z1',
  num: '01',
  name: 'Обсидиановый Собор',
  subtitle: 'Первый контакт',
  intro: 'Чёрный обсидиан помнит молитвы. Где-то под сводами звонит колокол — по спасению, которого не будет.',
  bossGate: 12,
};

export function stageById(id: string): StageDef | undefined { return ZONE1.find((s) => s.id === id); }
