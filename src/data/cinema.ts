/** Сцены режиссёра (план §8.1): открытые (увиденные хотя бы раз) можно пересмотреть в Кинозале Архива. */
export interface CineScene { id: string; title: string; sub: string }

export const CINEMA: CineScene[] = [
  { id: 'prologue', title: 'Пролог: Падение', sub: 'Разведкорабль «Иней» у погасшей звезды' },
  { id: 'hierophantIntro', title: 'Иерофант Скорби', sub: 'Колокол бьёт трижды' },
  { id: 'hierophantEnd', title: 'Последний звон', sub: 'Погасшая звезда загорается' },
  { id: 'killGate', title: 'Страж Врат', sub: 'Удар в шлем' },
  { id: 'killBell', title: 'Звонарь', sub: 'Колокол на спине' },
];
