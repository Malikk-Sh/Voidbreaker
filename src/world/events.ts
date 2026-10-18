import type { FeelId } from '../data/feel';
import type { Actor } from './actor';

/** Типизированные события боя (Tech §9). Звук, частицы, тряска, вибрация — подписчики. */
export interface GameEvents {
  hit: { target: Actor; dmg: number; crit: boolean; feel: FeelId; dirX: number; dirZ: number; x: number; y: number; z: number; source: 'blade' | 'ability' | 'proj' | 'env'; shielded?: boolean };
  kill: { target: Actor; kind: string; x: number; z: number; dirX: number; dirZ: number; big: boolean; elite: boolean };
  postureBreak: { target: Actor; x: number; z: number; boss: boolean };
  perfectDodge: { x: number; z: number };
  dodge: { x: number; z: number };
  playerHurt: { dmg: number; hpLeft: number; dirX: number; dirZ: number; source: string };
  heroDeath: { x: number; z: number };
  secondWind: { x: number; z: number };
  swing: { kind: 'light' | 'spin' | 'heavy' | 'stab' | 'charged' };
  /** Начат приём (для подсказок о ветках комбо). */
  moveStart: { id: string };
  dash: { x: number; z: number; dirX: number; dirZ: number };
  chargeReady: { level: number };
  impact: { x: number; z: number; r: number; kind: 'rift' | 'slam' | 'land' | 'shatter' | 'bell' };
  /** Раскол: финишер по треснувшему (сломанная стойка) врагу — взрыв трещин. */
  shatter: { target: Actor; x: number; y: number; z: number; boss: boolean; dmg: number };
  telegraph: { kind: 'hum' | 'whistle' | 'chime' | 'bell' | 'roar'; x: number; z: number };
  enemyAttack: { kind: 'bite' | 'slash' | 'slam' | 'shot' | 'beam' | 'bell' | 'swing'; x: number; z: number };
  projectileHit: { x: number; z: number; kind: string };
  portal: { x: number; z: number };
  spawned: { actor: Actor };
  waveStart: { index: number; total: number };
  waveClear: { index: number; total: number };
  stageClear: Record<string, never>;
  bossPhase: { phase: number };
  bossIntro: { name: string; title: string };
  bossDeath: { x: number; z: number };
  resonanceFull: Record<string, never>;
  pickup: { kind: 'shard' | 'ether' | 'heal'; amount: number; x: number; z: number };
  ability: { id: string; x: number; z: number };
  ultimate: { id: string; x: number; z: number };
  fall: { x: number; z: number; hero: boolean };
  shockwave: { x: number; z: number; r: number; color: 'void' | 'hunger' | 'gold'; strength: number };
  rank: { rank: string; up: boolean };
  voice: { line: string; speaker: 'kaelis' | 'boss' };
  sfx: { id: string; x: number; z: number; gain?: number };
  shake: { trauma: number };
  hint: { id: string; text: string };
}
