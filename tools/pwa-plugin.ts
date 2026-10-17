import type { Plugin } from 'vite';

/** Заглушка; полная генерация манифеста, иконки и service worker — ниже по роадмапу. */
export function pwaPlugin(): Plugin {
  return { name: 'voidbreaker-pwa' };
}
