/** Полноэкранный режим (Fullscreen API + альбомная блокировка ориентации там, где она есть). */
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void>; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = (): FsDoc => document as FsDoc;

export function fullscreenSupported(): boolean {
  return !!(doc().fullscreenEnabled || doc().webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return !!(doc().fullscreenElement || doc().webkitFullscreenElement);
}

/** Войти в полноэкранный режим. Вызывать только из обработчика жеста (касание, клик, клавиша). */
export async function enterFullscreen(): Promise<boolean> {
  if (isFullscreen()) return true;
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
  } catch { return false; }
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  try { await o.lock?.('landscape'); } catch { /* блокировка ориентации доступна не везде */ }
  return true;
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  try { await (document.exitFullscreen ? document.exitFullscreen() : doc().webkitExitFullscreen?.()); } catch { /* */ }
}

export function onFullscreenChange(fn: () => void): () => void {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
  return () => { document.removeEventListener('fullscreenchange', fn); document.removeEventListener('webkitfullscreenchange', fn); };
}
