import * as THREE from 'three';
import { Clip, type ClipDef } from '../anim/clip';
import { RigLayout, Skeleton } from '../anim/skeleton';
import { hierophantRig } from '../gen/chars/hierophant';
import { HIEROPHANT_POSES } from '../world/boss/hierophantPoses';
import { collapseTrack, crackTrack, executionTrack, hierophantIntroTrack } from '../world/boss/hierophantScenes';
import { killBellTrack, killGateTrack } from '../world/boss/guardianScenes';
import { landingTrack, prologueTrack, SpaceBasis } from '../game/prologueTracks';
import type { CineTrack, V3 } from '../game/director';
import { Cinematics, type CineHost } from '../game/cinematics';
import { ZONE1 } from '../data/stages';
import type { Enemy } from '../world/enemy';

export const STAR = new THREE.Vector3(0.42, -0.5, -0.76).normalize();
export const BASIS = new SpaceBasis(STAR);
export const BOSS_CLIPS: ClipDef[] = Object.entries(HIEROPHANT_POSES).map(([id, pose]) => ({ id, dur: 1, mask: 'full', keys: [{ t: 0, pose }] }));
export interface SceneSpec {
  id: string; title: string; group: string; note: string;
  model: 'hierophant' | 'gate' | 'bell' | 'landing' | 'space';
  track: CineTrack;
  actors: Record<string, { x: number; y: number; z: number; facing: number }>;
}
const hero = { x: 0, y: 0, z: 6, facing: Math.PI };
const boss = { x: 0, y: 0, z: 0, facing: 0 };
const layout = new RigLayout(hierophantRig()), skel = new Skeleton(layout);
new Clip(BOSS_CLIPS.find((c) => c.id === 'executionBrace')!, layout).sample(0, skel.rot, { x: 0, y: 0, z: 0, stretch: 1, spin: 0 });
skel.off[layout.idx('body') * 3 + 1] = -1.6; skel.update();
const m = skel.jointPoint(layout.idx('bell'), 0, 0.32, 0.18, new THREE.Vector3());
export const MASK: V3 = [m.x, m.y, m.z];
const spots = { hx: hero.x, hz: hero.z, bx: boss.x, bz: boss.z };
const star: V3 = [STAR.x, STAR.y, STAR.z];
export const SCENES: SceneSpec[] = [
  { id: 'hierophantEnd', title: 'Добивание Иерофанта', group: 'Финал', model: 'hierophant', note: 'Рывок → цепь → замах → контакт → приземление', actors: { hero, boss }, track: executionTrack({ ...spots, cx: 0, cz: 2.6, bellY: MASK[1], lx: 0, lz: -3.2, star, mask: MASK }) },
  { id: 'prologueLanding', title: 'Пролог · Клинок', group: 'Пролог', model: 'landing', note: 'Приземление и извлечение клинка', actors: { hero: { ...hero, x: 0, z: 0, y: 2 }, shard: { ...boss, x: 1.8, z: -2.1 } }, track: landingTrack({ x: 0, z: 0, shardX: 1.8, shardZ: -2.1, huskX: 0, huskZ: -7 }) },
  { id: 'prologue', title: 'Пролог · Падение', group: 'Пролог', model: 'space', note: 'Полёт корабля и падение. Стик игрока добавляется в игре.', actors: { hero: { ...hero, z: 0, facing: 0 }, ship: { ...boss } }, track: prologueTrack(BASIS) },
  { id: 'hierophantIntro', title: 'Иерофант · Появление', group: 'Иерофант', model: 'hierophant', note: 'Вход героя, колокол и спуск босса', actors: { hero, boss: { ...boss, y: 16 } }, track: hierophantIntroTrack(spots) },
  { id: 'hierophantCollapse', title: 'Иерофант · Обрушение', group: 'Иерофант', model: 'hierophant', note: 'Переход во вторую фазу', actors: { hero, boss }, track: collapseTrack(spots) },
  { id: 'hierophantCrack', title: 'Иерофант · Последний звон', group: 'Иерофант', model: 'hierophant', note: 'Переход в третью фазу', actors: { hero, boss }, track: crackTrack(spots, star) },
  { id: 'killGate', title: 'Страж Врат · Добивание', group: 'Стражи', model: 'gate', note: 'Подсечка, бег по древку и удар в шлем', actors: { hero, gateGuardian: boss }, track: killGateTrack({ gx: 0, gz: 0, hx: 0, hz: 6 }) },
  { id: 'killBell', title: 'Звонарь · Добивание', group: 'Стражи', model: 'bell', note: 'Обход за спину и удар в колокол', actors: { hero, bellRinger: boss }, track: killBellTrack({ gx: 0, gz: 0, hx: 0, hz: 6 }) },
];

// Короткие игровые вставки берут постановку из того же Cinematics, что ведёт бой.
const noOp = () => {};
const cineHost = {
  world: { hero: { ...hero, clock: 0, invulnUntil: 0 }, bus: { emit: noOp } },
  letterbox: noOp, slow: noOp, banner: noOp, say: noOp, flash: noOp, musicPhase: noOp, stinger: noOp, skipRequested: () => false, once: () => false,
} as unknown as CineHost;
const cine = new Cinematics(cineHost); cine.studio = true;
const append = (title: string, model: SceneSpec['model'], actors: SceneSpec['actors']) => {
  const track = cine.describe(); if (!track) return;
  SCENES.push({ id: track.id, title, group: 'Игровые вставки', note: 'Камера и дополнительные движения персонажей', model, actors, track });
};
for (const stage of ZONE1.filter((s) => !s.boss)) {
  cine.stageIntro(stage, { x: 0, z: 0 }, 18);
  append(`${stage.id} · Пролёт арены`, 'landing', { hero });
}
for (const kind of ['gateGuardian', 'bellRinger'] as const) {
  const title = kind === 'gateGuardian' ? 'Страж Врат' : 'Звонарь';
  const e = { ...boss, kind, height: kind === 'gateGuardian' ? 4 : 4.5, def: { name: title } } as Enemy;
  const model = kind === 'gateGuardian' ? 'gate' : 'bell';
  cine.guardianIntro(e); append(`${title} · Появление`, model, { hero, [kind]: boss });
  cine.guardianRage(e); append(`${title} · Ярость`, model, { hero, [kind]: boss });
  cine.guardianDown(e); append(`${title} · Падение`, model, { hero, [kind]: boss });
}
// victory() ставит очередь, если идёт down: очищаем предыдущую вставку перед снимком.
cine.clear({ cine: null } as never); cine.victory(); append('Арена · Победа', 'landing', { hero });

export const CLIP_NAMES: Record<string, string> = {
  lowerBlade: 'Опустить клинок', chainBrace: 'Опора у цепи', chainRun: 'Бег по цепи', chainApex: 'Замах в прыжке', maskStrike: 'Удар в маску', chainExit: 'Отталкивание и посадка',
  pullBlade: 'Извлечь клинок', extractBlade: 'Извлечь клинок', extraction: 'Извлечь клинок', shaftRun: 'Бег по древку', land: 'Приземление', dash: 'Рывок', atk1: 'Первый удар', atk2: 'Второй удар',
};
export const ACTOR_NAMES: Record<string, string> = { hero: 'Пилот', boss: 'Иерофант', gateGuardian: 'Страж Врат', bellRinger: 'Звонарь', shard: 'Клинок в полу', ship: 'Иней' };
