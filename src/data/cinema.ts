/** Сцены режиссёра (план §8.1): открытые (увиденные хотя бы раз) можно пересмотреть в Кинозале Архива. */
export interface CineScene { id: string; title: string; sub: string; previous?: string }

export const CINEMA: CineScene[] = [
  { id: 'prologue', title: 'Пролог: Падение', sub: 'Разведкорабль «Иней» у погасшей звезды' },
  { id: 'prologueLanding', title: 'Пролог: Клинок', sub: 'Приземление и пробуждение оружия' },
  { id: 'devourerIntro', previous: 'hierophantIntro', title: 'Пожиратель', sub: 'Шорох в каменоломне' },
  { id: 'devourerFrenzy', previous: 'hierophantCollapse', title: 'Исступление', sub: 'Переход во вторую фазу' },
  { id: 'devourerEcho', previous: 'hierophantCrack', title: 'Последнее эхо', sub: 'Переход в третью фазу' },
  { id: 'devourerEnd', previous: 'hierophantEnd', title: 'Тишина', sub: 'Погасшая звезда загорается' },
  { id: 'killGate', title: 'Страж Врат', sub: 'Удар в шлем' },
  { id: 'killBell', title: 'Жакемар', sub: 'Трещина в горбе-колоколе' },
];
