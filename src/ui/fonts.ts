/**
 * Шрифты (открытые, SIL OFL 1.1, поставляются вместе с игрой — работают офлайн):
 *  - Cormorant SC — заголовки: готическая антиква в капителях;
 *  - Philosopher — основной текст: читаемый гуманистический гротеск с «космическим» характером;
 *  - Tektur — цифры и технические подписи HUD.
 * Подключаются только кириллица и латиница (≈150 КБ). Логотип рисуется собственными глифами (ui/logo.ts).
 */
import cormorantCyr700 from '@fontsource/cormorant-sc/files/cormorant-sc-cyrillic-700-normal.woff2?url';
import cormorantLat700 from '@fontsource/cormorant-sc/files/cormorant-sc-latin-700-normal.woff2?url';
import philosopherCyr400 from '@fontsource/philosopher/files/philosopher-cyrillic-400-normal.woff2?url';
import philosopherLat400 from '@fontsource/philosopher/files/philosopher-latin-400-normal.woff2?url';
import philosopherCyr700 from '@fontsource/philosopher/files/philosopher-cyrillic-700-normal.woff2?url';
import philosopherLat700 from '@fontsource/philosopher/files/philosopher-latin-700-normal.woff2?url';
import tekturCyr600 from '@fontsource/tektur/files/tektur-cyrillic-600-normal.woff2?url';
import tekturLat600 from '@fontsource/tektur/files/tektur-latin-600-normal.woff2?url';

export const FONT_DISPLAY = '"Cormorant SC", "Cormorant Garamond", Georgia, serif';
export const FONT_BODY = 'Philosopher, "Segoe UI", Roboto, sans-serif';
export const FONT_TECH = 'Tektur, Philosopher, "Segoe UI", sans-serif';

const CYR = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const LAT = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

const FACES: [string, number, string, string][] = [
  ['Cormorant SC', 700, cormorantCyr700, CYR], ['Cormorant SC', 700, cormorantLat700, LAT],
  ['Philosopher', 400, philosopherCyr400, CYR], ['Philosopher', 400, philosopherLat400, LAT],
  ['Philosopher', 700, philosopherCyr700, CYR], ['Philosopher', 700, philosopherLat700, LAT],
  ['Tektur', 600, tekturCyr600, CYR], ['Tektur', 600, tekturLat600, LAT],
];

let injected = false;

/** Зарегистрировать @font-face и дождаться загрузки (не дольше timeout) — канвас-заголовки кэшируются, им нужен готовый шрифт. */
export async function loadFonts(timeout = 2500): Promise<void> {
  if (!injected) {
    injected = true;
    const css = FACES.map(([fam, w, url, range]) =>
      `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(${url}) format('woff2');unicode-range:${range};}`).join('\n');
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }
  if (!document.fonts?.load) return;
  const jobs = Promise.all([
    document.fonts.load(`700 32px "Cormorant SC"`, 'АЯ AZ'),
    document.fonts.load(`400 16px Philosopher`, 'АЯ AZ'),
    document.fonts.load(`700 16px Philosopher`, 'АЯ AZ'),
    document.fonts.load(`600 16px Tektur`, 'АЯ AZ 09'),
  ]).then(() => undefined).catch(() => undefined);
  await Promise.race([jobs, new Promise<void>((r) => setTimeout(r, timeout))]);
}
