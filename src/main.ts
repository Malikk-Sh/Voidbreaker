import { App } from './game/app';
import { loadFonts } from './ui/fonts';

const root = document.getElementById('app')!;
// заголовки рисуются в канвас и кэшируются — сначала дожидаемся шрифтов (не дольше 2.5 с)
void loadFonts().then(() => {
  document.getElementById('boot')?.remove();
  const app = new App(root);
  app.start();
});

// PWA: офлайн после первой загрузки (service worker генерируется при сборке)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* офлайн-кэш недоступен — игра работает и так */ }); });
}
