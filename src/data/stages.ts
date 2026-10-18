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

export const ZONE1: StageDef[] = [
  {
    id: '1-1', zone: 0, index: 0, name: 'Падение', arena: 'fall', tutorial: 'basics',
    waves: [
      { spawns: [{ enemy: 'spiker', count: 3, pattern: 'far', stagger: 0.4 }, { enemy: 'husk', count: 5, pattern: 'far', delay: 2.5, stagger: 0.15 }] },
      { spawns: [{ enemy: 'husk', count: 10, pattern: 'ring', stagger: 0.1 }, { enemy: 'spiker', count: 4, pattern: 'ring', delay: 1.5 }, { enemy: 'reaper', count: 1, pattern: 'far', delay: 3 }] },
      { spawns: [{ enemy: 'husk', count: 14, pattern: 'ring', stagger: 0.08 }, { enemy: 'spiker', count: 5, pattern: 'ring', delay: 1.2 }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 2.5 }] },
    ],
  },
  {
    id: '1-2', zone: 0, index: 1, name: 'Нефы', arena: 'naves', tutorial: 'charged',
    waves: [
      { spawns: [{ enemy: 'husk', count: 12, pattern: 'ring', stagger: 0.1 }, { enemy: 'spiker', count: 4, pattern: 'ring', delay: 1.5 }, { enemy: 'eye', count: 1, at: ['top'], delay: 2 }] },
      { spawns: [{ enemy: 'golem', count: 1, pattern: 'far' }, { enemy: 'husk', count: 10, pattern: 'edges', delay: 1, stagger: 0.1 }, { enemy: 'spiker', count: 4, pattern: 'ring', delay: 3 }] },
      { spawns: [{ enemy: 'reaper', count: 2, pattern: 'edges' }, { enemy: 'eye', count: 2, at: ['left', 'right'], delay: 1 }, { enemy: 'husk', count: 14, pattern: 'ring', delay: 2.5, stagger: 0.08 }] },
    ],
  },
  {
    id: '1-3', zone: 0, index: 2, name: 'Врата', arena: 'gate', tutorial: 'shatter',
    waves: [
      { spawns: [{ enemy: 'husk', count: 14, pattern: 'ring', stagger: 0.08 }, { enemy: 'spiker', count: 6, pattern: 'ring', delay: 1.2 }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 2.5 }] },
      { spawns: [{ enemy: 'golem', count: 1, pattern: 'far' }, { enemy: 'eye', count: 2, at: ['left', 'right'], delay: 0.8 }, { enemy: 'acolyte', count: 1, at: ['top'], delay: 2 }, { enemy: 'husk', count: 8, pattern: 'edges', delay: 3 }] },
      { guardian: true, spawns: [{ enemy: 'gateGuardian', count: 1, at: ['top'] }],
        triggers: [{ when: 'guardianHp<0.5', spawn: { enemy: 'husk', count: 12, pattern: 'ring', stagger: 0.12 } }] },
    ],
  },
  {
    id: '1-4', zone: 0, index: 3, name: 'Свечной зал', arena: 'candles', tutorial: 'upgrade', unlocks: ['phase'],
    waves: [
      { spawns: [{ enemy: 'husk', count: 16, pattern: 'ring', stagger: 0.07 }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 1.5 }, { enemy: 'spiker', count: 4, pattern: 'ring', delay: 3 }] },
      { spawns: [{ enemy: 'eye', count: 2, at: ['left', 'right'] }, { enemy: 'acolyte', count: 1, at: ['top'], delay: 1 }, { enemy: 'husk', count: 10, pattern: 'ring', delay: 1.5 }, { enemy: 'spiker', count: 6, pattern: 'ring', delay: 3 }] },
      { spawns: [{ enemy: 'golem', count: 1, pattern: 'far' }, { enemy: 'reaper', count: 3, pattern: 'edges', delay: 1 }, { enemy: 'eye', count: 2, at: ['left', 'right'], delay: 2 }, { enemy: 'husk', count: 12, pattern: 'edges', delay: 3.5 }] },
      { spawns: [{ enemy: 'golem', count: 1, at: ['top'], elite: ['hasted'] }, { enemy: 'husk', count: 8, pattern: 'ring', delay: 1.5 }],
        triggers: [{ when: 'eliteHp<0.5', spawn: { enemy: 'husk', count: 16, pattern: 'ring', stagger: 0.07 } }] },
    ],
  },
  {
    id: '1-5', zone: 0, index: 4, name: 'Мост над бездной', arena: 'bridge',
    waves: [
      { spawns: [{ enemy: 'husk', count: 14, pattern: 'ring', stagger: 0.08 }, { enemy: 'spiker', count: 6, pattern: 'ring', delay: 1 }, { enemy: 'eye', count: 2, at: ['left', 'right'], delay: 2 }] },
      { spawns: [{ enemy: 'reaper', count: 3, pattern: 'edges' }, { enemy: 'acolyte', count: 1, at: ['top'], delay: 1 }, { enemy: 'husk', count: 12, pattern: 'ring', delay: 2.5 }, { enemy: 'spiker', count: 4, pattern: 'ring', delay: 3.5 }] },
      { spawns: [{ enemy: 'reaper', count: 1, at: ['left'], elite: ['explosive', 'hasted'] }, { enemy: 'golem', count: 2, at: ['right', 'center'], delay: 1.5 }, { enemy: 'husk', count: 10, pattern: 'edges', delay: 3 }],
        triggers: [{ when: 'eliteHp<0.5', spawn: { enemy: 'husk', count: 14, pattern: 'ring', stagger: 0.08 } }] },
    ],
  },
  {
    id: '1-6', zone: 0, index: 5, name: 'Колокольня', arena: 'belfry', tutorial: 'ult', unlocks: ['eclipse'],
    waves: [
      { spawns: [{ enemy: 'husk', count: 18, pattern: 'ring', stagger: 0.06 }, { enemy: 'spiker', count: 8, pattern: 'ring', delay: 1 }, { enemy: 'acolyte', count: 2, at: ['left', 'right'], delay: 2 }] },
      { spawns: [{ enemy: 'golem', count: 2, pattern: 'far' }, { enemy: 'eye', count: 2, at: ['left', 'right'], delay: 1 }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 2.5 }, { enemy: 'husk', count: 14, pattern: 'ring', delay: 4 }] },
      { guardian: true, spawns: [{ enemy: 'bellRinger', count: 1, at: ['top'] }],
        triggers: [
          { when: 'guardianHp<0.5', spawn: { enemy: 'reaper', count: 2, pattern: 'edges' } },
          { when: 'guardianHp<0.5', spawn: { enemy: 'husk', count: 12, pattern: 'ring', stagger: 0.1 } },
        ] },
    ],
  },
  {
    id: 'boss1', zone: 0, index: 6, name: 'Иерофант Скорби', arena: 'hierophant', boss: true, unlocks: ['well'],
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
