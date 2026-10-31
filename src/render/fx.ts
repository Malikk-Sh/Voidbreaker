/**
 * Флаги визуального апгрейда (план VOIDBREAKER ×100): каждый новый эффект включён по умолчанию и выключается
 * адресом — `?fx=shadow,rays` выключает перечисленные, `?fx=off` — все разом (кадр как до апгрейда). Нужны стенду
 * кадров (npm run beauty) и поиску того, что съело кадр на телефоне. Читаются один раз при загрузке.
 *
 * exposure — дисциплина яркости удара (вспышка тела, ядро следа, искра контакта); tele — новый вид телеграфов;
 * title — титр этапа до волны, подпись внизу слева; herolight — свет Пилота и визор; shadow — тени, вытянутые от
 * ключевого света; rays — мягкие лучи окон.
 */
export const FX_NAMES = ['exposure', 'tele', 'title', 'herolight', 'shadow', 'rays'] as const;
export type FxName = (typeof FX_NAMES)[number];

/** Разбор строки адреса: имена через запятую выключают эффекты, off — все. */
export function parseFx(search: string): Record<FxName, boolean> {
  const off = new Set((new URLSearchParams(search).get('fx') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const all = off.has('off');
  return Object.fromEntries(FX_NAMES.map((n) => [n, !all && !off.has(n)])) as Record<FxName, boolean>;
}

export const FX: Readonly<Record<FxName, boolean>> = parseFx(typeof location !== 'undefined' ? location.search : '');
