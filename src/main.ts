import { App } from './game/app';

const root = document.getElementById('app')!;
document.getElementById('boot')?.remove();
const app = new App(root);
app.start();

// PWA: офлайн после первой загрузки (service worker генерируется при сборке)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* офлайн-кэш недоступен — игра работает и так */ }); });
}
