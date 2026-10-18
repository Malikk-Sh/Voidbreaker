import type { FeelId } from '../data/feel';
import type { Actor } from './actor';

/** Типизированные события боя (Tech §9). Звук, частицы, тряска, вибрация — подписчики. */
export interface GameEvents {
  hit: { target: Actor; dmg: number; crit: boolean; feel: FeelId; dirX: number; dirZ: number; x: number; y: number; z: number; source: 'blade' | 'ability' | 'proj' | 'env'; shielded?: boolean; weak?: boolean };
  /**
   * Один взмах (или один залп способности) — одно событие на все задетые цели (план §5.1):
   * hitstop, тряска, кик, звук и вибрация — только здесь, а не на каждое попадание.
   */
  strike: { n: number; crit: boolean; feel: FeelId; x: number; z: number; dirX: number; dirZ: number; source: 'blade' | 'ability' | 'proj' | 'env'; moveId?: string; boss: boolean };
  kill: { target: Actor; kind: string; x: number; z: number; dirX: number; dirZ: number; big: boolean; elite: boolean };
  /**
   * Оглушение (план §5.5): шкала заполнилась. boss — Страж или босс (стингер, звёзды с HUD, подъезд камеры);
   * dur — длительность (с привыканием).
   */
  stun: { target: Actor; x: number; z: number; boss: boolean; dur: number };
  /** Погасла звезда оглушения (left — сколько осталось; 0 — враг очнулся). */
  stunTick: { target: Actor; x: number; z: number; left: number; boss: boolean };
  /** Детонация меток Пустоты: салют фиолетовых трещин и «хруст» (stacks — сколько стопок взорвано). */
  detonate: { target: Actor; x: number; y: number; z: number; stacks: number };
  /** Рядовой сбит тяжёлым ударом: две маленькие звезды на 0.6 с. */
  daze: { target: Actor; x: number; z: number };
  /**
   * Идеальное уклонение (план §5.4). heavy — атака элиты, Стража или босса с телеграфом ≥ 0.7 с («Мгновение Пустоты»);
   * sx, sz — где начался рывок (там остаётся силуэт).
   */
  perfectDodge: { x: number; z: number; heavy: boolean; sx: number; sz: number };
  dodge: { x: number; z: number };
  playerHurt: { dmg: number; hpLeft: number; dirX: number; dirZ: number; source: string };
  heroDeath: { x: number; z: number };
  secondWind: { x: number; z: number };
  /** Начат взмах; hitAt — через сколько (время героя) кадр удара: туда ставится смазанный кадр. */
  swing: { kind: 'light' | 'spin' | 'heavy' | 'stab' | 'charged'; hitAt?: number };
  /** Начат приём (для подсказок о ветках комбо). */
  moveStart: { id: string };
  dash: { x: number; z: number; dirX: number; dirZ: number };
  /** Украденный импульс: снаряд в окне идеального уклонения стал осколком героя. */
  steal: { x: number; z: number };
  /** Удар клинка отправил украденные осколки. */
  stolenFire: { x: number; z: number };
  /** Рывок пошёл скольжением по трещине. */
  slide: { x: number; z: number; dirX: number; dirZ: number };
  chargeReady: { level: number };
  impact: { x: number; z: number; r: number; kind: 'rift' | 'slam' | 'land' | 'shatter' | 'bell' };
  /** Раскол: финишер или полный заряд по оглушённому врагу — взрыв трещин, оглушение кончается. */
  shatter: { target: Actor; x: number; y: number; z: number; boss: boolean; dmg: number };
  /**
   * Раскол 2.0 (план §5.6), отложенный разрез — в реальных секундах: cut — удар-вспышка, impact — разлёт,
   * dur — конец. Линия разреза — от цели по (dirX, dirZ) на len м. big — Страж или босс.
   */
  shatterStart: { target: Actor; x: number; z: number; dirX: number; dirZ: number; len: number; cut: number; impact: number; dur: number; big: boolean; short: boolean };
  shatterCut: { x: number; z: number; dirX: number; dirZ: number; len: number; silence: number };
  /** Конец Раскола; skipped — пропущен рывком. */
  shatterEnd: { skipped: boolean };
  /** src — вид врага: по нему слышен класс замаха (рой, дуэлянт, тяжёлый, поддержка). */
  telegraph: { kind: 'hum' | 'whistle' | 'chime' | 'bell' | 'roar'; x: number; z: number; src?: string };
  enemyAttack: { kind: 'bite' | 'slash' | 'slam' | 'shot' | 'beam' | 'bell' | 'swing' | 'throw'; x: number; z: number; dir?: number; r?: number };
  projectileHit: { x: number; z: number; kind: string };
  /** Навесной бросок (камень голема): только визуал, урон — по метке приземления. */
  lob: { fx: number; fz: number; tx: number; tz: number; dur: number; size: number };
  portal: { x: number; z: number };
  spawned: { actor: Actor };
  waveStart: { index: number; total: number };
  waveClear: { index: number; total: number };
  stageClear: Record<string, never>;
  bossPhase: { phase: number };
  /** Страж на 50 % HP: рёв, вторая фаза (кинематографичная вставка). */
  guardianRage: { x: number; z: number; kind: string };
  bossIntro: { name: string; title: string };
  bossDeath: { x: number; z: number };
  resonanceFull: Record<string, never>;
  /** Способность снова готова (кольцо вокруг иконки, короткий звук). */
  abilityReady: { slot: 'q' | 'e' };
  pickup: { kind: 'shard' | 'ether' | 'heal'; amount: number; x: number; z: number };
  ability: { id: string; x: number; z: number };
  /** Начат каст способности (замах перед release). */
  castStart: { x: number; z: number };
  /** Серп вернулся и пойман рукой. */
  sickleCatch: { x: number; z: number };
  /** Колодец схлопывается: 0.3 с до взрыва. */
  wellCollapse: { x: number; z: number };
  ultimate: { id: string; x: number; z: number };
  fall: { x: number; z: number; hero: boolean };
  shockwave: { x: number; z: number; r: number; color: 'void' | 'hunger' | 'gold'; strength: number };
  rank: { rank: string; up: boolean };
  /** Уклонение от атаки босса и сразу оглушение: +80 очков ранга, камера и музыка отвечают. */
  rankBurst: { x: number; z: number };
  voice: { line: string; speaker: 'kaelis' | 'boss' };
  sfx: { id: string; x: number; z: number; gain?: number };
  shake: { trauma: number };
  hint: { id: string; text: string };
}
