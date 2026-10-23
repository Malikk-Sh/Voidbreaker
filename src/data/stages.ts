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
  /** Тренировочный зал: манекены вместо волн, без наград и прогресса. */
  training?: boolean;
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
      // читать направление удара: Распинатель (веер, гвоздь, ряд шипов)
      { spawns: [{ enemy: 'husk', count: 6, pattern: 'ring', stagger: 0.12 }, { enemy: 'crucifier', count: 1, pattern: 'far', delay: 1.5 }] },
      // приоритет цели: Аколит со щитом; Ока на краях
      { spawns: [{ enemy: 'eye', count: 2, at: ['left', 'right'] }, { enemy: 'acolyte', count: 1, at: ['top'], delay: 1 }, { enemy: 'husk', count: 6, pattern: 'ring', delay: 1.5, stagger: 0.12 }] },
      // сбросить Голема в колодец заряженным ударом
      { spawns: [{ enemy: 'golem', count: 1, at: ['center'] }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 1 }, { enemy: 'husk', count: 6, pattern: 'edges', delay: 3 }] },
      // Раскол элиты; Отдача — заканчивай серию финишером
      { spawns: [{ enemy: 'golem', count: 1, at: ['top'], elite: ['recoil'] }],
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
      // кого бить первым: Псаломщик связывает Распинателя и Жнеца
      { spawns: [{ enemy: 'psalmist', count: 1, at: ['top'] }, { enemy: 'crucifier', count: 1, pattern: 'far', delay: 0.5 }, { enemy: 'reaper', count: 1, pattern: 'edges', delay: 1 }, { enemy: 'husk', count: 4, pattern: 'ring', delay: 2.5, stagger: 0.12 }] },
      // Раскол элиты; Тень повторяет выпад — меняй позицию после уклонения; Голем на мосту
      { spawns: [{ enemy: 'reaper', count: 1, at: ['left'], elite: ['shadow', 'explosive'] }, { enemy: 'golem', count: 1, at: ['right'], delay: 1.5 }],
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
  // новые этапы перед боссом (решение автора: расширить Зону 01 на новых аренах, враги — существующие)
  {
    id: '1-7', zone: 0, index: 6, name: 'Клуатр', arena: 'cloister',
    waves: [
      // сбросить толпу в провал сада; читать веер Распинателя
      { spawns: [{ enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 }, { enemy: 'crucifier', count: 1, pattern: 'far', delay: 1.5 }] },
      // приоритет: Псаломщик связывает Голема — сперва его
      { spawns: [{ enemy: 'psalmist', count: 1, at: ['top'] }, { enemy: 'golem', count: 1, pattern: 'far', delay: 0.8 }, { enemy: 'husk', count: 5, pattern: 'edges', delay: 2.5, stagger: 0.15 }] },
      // колонны укрывают от Ок; выпады Жнецов
      { spawns: [{ enemy: 'eye', count: 2, at: ['left', 'right'] }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 1.5 }, { enemy: 'husk', count: 6, pattern: 'ring', delay: 3, stagger: 0.12 }] },
      // Раскол элиты: Отдача — заканчивай серию финишером
      { spawns: [{ enemy: 'crucifier', count: 1, at: ['top'], elite: ['recoil'] }],
        triggers: [{ when: 'eliteHp<0.5', spawn: { enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 } }] },
    ],
  },
  {
    id: '1-8', zone: 0, index: 7, name: 'Крипта', arena: 'crypt',
    waves: [
      // теснота коридоров: не дать зажать себя с двух сторон
      { spawns: [{ enemy: 'spiker', count: 4, pattern: 'ring', stagger: 0.3 }, { enemy: 'husk', count: 6, pattern: 'edges', delay: 1.5, stagger: 0.15 }] },
      // приоритет: Аколит со щитом за выпадами Жнецов
      { spawns: [{ enemy: 'reaper', count: 2, at: ['left', 'right'] }, { enemy: 'acolyte', count: 1, at: ['top'], delay: 1.2 }, { enemy: 'husk', count: 4, pattern: 'edges', delay: 3 }] },
      // два Голема в коридорах (оглушение, Раскол) под огнём Ока
      { spawns: [{ enemy: 'golem', count: 2, at: ['left', 'right'] }, { enemy: 'eye', count: 1, at: ['top'], delay: 1.5 }] },
      // Тень повторяет выпад — меняй позицию; Псаломщик связывает
      { spawns: [{ enemy: 'reaper', count: 1, at: ['top'], elite: ['shadow'] }, { enemy: 'psalmist', count: 1, at: ['left'], delay: 1 }],
        triggers: [{ when: 'eliteHp<0.5', spawn: { enemy: 'husk', count: 8, pattern: 'ring', stagger: 0.1 } }] },
    ],
  },
  {
    id: '1-9', zone: 0, index: 8, name: 'Хоры', arena: 'choir',
    waves: [
      // сбрасывать с мостика в провалы
      { spawns: [{ enemy: 'husk', count: 10, pattern: 'ring', stagger: 0.08 }, { enemy: 'spiker', count: 3, pattern: 'edges', delay: 1.2 }] },
      // два Распинателя и Аколит: направление ударов под щитом
      { spawns: [{ enemy: 'crucifier', count: 2, at: ['left', 'right'] }, { enemy: 'acolyte', count: 1, at: ['top'], delay: 1 }, { enemy: 'husk', count: 4, pattern: 'ring', delay: 3 }] },
      // Псаломщики связывают Голема на мостике
      { spawns: [{ enemy: 'golem', count: 1, at: ['center'] }, { enemy: 'psalmist', count: 2, at: ['left', 'right'], delay: 1 }, { enemy: 'husk', count: 5, pattern: 'edges', delay: 3 }] },
      // последняя проверка перед Иерофантом: взрывной элитный Голем и Жнецы
      { spawns: [{ enemy: 'golem', count: 1, at: ['top'], elite: ['explosive'] }, { enemy: 'reaper', count: 2, pattern: 'edges', delay: 2 }],
        triggers: [{ when: 'eliteHp<0.5', spawn: { enemy: 'husk', count: 10, pattern: 'ring', stagger: 0.08 } }] },
    ],
  },
  {
    id: 'boss1', zone: 0, index: 9, name: 'Иерофант Скорби', arena: 'hierophant', boss: true,
    waves: [{ spawns: [{ enemy: 'hierophant', count: 1, at: ['top'] }] }],
  },
];

export const ZONE1_INFO = {
  id: 'z1',
  num: '01',
  name: 'Обсидиановый Собор',
  subtitle: 'Первый контакт',
  intro: 'Чёрный обсидиан помнит молитвы. Где-то под сводами звонит колокол — по спасению, которого не будет.',
  /** Звёзд на врата босса: 18 из 27 (было 12 из 18 — та же доля, ⅔, после трёх новых этапов). */
  bossGate: 18,
};

/**
 * Тренировочный зал (разбор): Нефы без волн — манекены стоят и не бьют, разбитые встают снова; памятка веток
 * комбо на экране. Не входит в Зону и карту: ни наград, ни звёзд.
 */
export const TRAINING: StageDef = { id: 'training', zone: 0, index: 0, name: 'Тренировочный зал', arena: 'naves', waves: [], training: true };

/** Манекены зала: два лёгких (серии, подброс) и тяжёлый (оглушение, Раскол); через сколько встаёт разбитый (с). */
export const TRAINING_DUMMIES = { kinds: ['husk', 'golem', 'husk'] as const, dist: 5.5, spread: 3.2, respawn: 1.8 };

/**
 * Спарринг (ревью: «режим активного противника для уклонений»): Жнец в стороне от манекенов бьёт выпадом с красной
 * линией — Пилот получает только толчок и вспышку, здоровье тут же возвращается. Дальше leash м от своего места
 * Жнец не гонится. Где стоит (м вперёд и вбок от входа), через сколько встаёт разбитый (с).
 */
export const TRAINING_SPAR = { kind: 'reaper' as const, dist: 9.5, side: -5.5, leash: 7, respawn: 2.5 };

export type DrillId = 'rift' | 'cross' | 'skyfall' | 'counter' | 'charged' | 'shatter';

/** Упражнения зала (ревью: «короткие упражнения с подтверждением успешной связки»): каждое засчитывается событием боя. */
export const TRAINING_DRILLS: readonly { id: DrillId; text: string }[] = [
  { id: 'rift', text: 'Атака ×4 — финишер «Нисходящий разлом»' },
  { id: 'cross', text: 'Пауза после 2-го удара — Шквал, затем Крест' },
  { id: 'skyfall', text: 'Рывок и атака — Рассечение → Восходящий месяц → Звездопад' },
  { id: 'counter', text: 'Уклонись от Жнеца в последний миг — и атака: Контрудар' },
  { id: 'charged', text: 'Удерживать атаку до полного заряда — волна Пустоты' },
  { id: 'shatter', text: 'Оглушить голема и добить финишером — Раскол' },
];

/** Какой приём (moveStart) засчитывает упражнение; заряд и Раскол — по своим событиям. */
export const DRILL_MOVES: Readonly<Record<string, DrillId>> = { rift: 'rift', cross: 'cross', skyfall: 'skyfall', counter: 'counter' };

/** Памятка зала: упражнения и правила зала. */
export const TRAINING_TIPS = [...TRAINING_DRILLS.map((d) => d.text), 'Манекены стоят, Жнец бьёт без урона. Выход — пауза'];

export function stageById(id: string): StageDef | undefined { return id === TRAINING.id ? TRAINING : ZONE1.find((s) => s.id === id); }
