import type { ClipDef } from '../anim/clip';
import type { EaseId } from '../core/ease';
import { Ease } from '../core/ease';
import type { CineStep, CineTrack, V3 } from './director';
import defaults from '../data/sceneEdits.json';

export const STUDIO_KEY = 'voidbreaker.scene-studio.v1';
export type Variant = 'full' | 'short';
export interface StepEdit {
  t?: number; dur?: number; ease?: EaseId; turn?: number;
  moveOffset?: V3; lookOffset?: V3;
  /** Смещения контрольных точек от прямого пути, в осях сцены. */
  bends?: V3[];
  pathOffsets?: V3[]; lookOffsets?: V3[];
  fov?: number; roll?: number; clip?: string; speed?: number; blend?: number;
  definition?: ClipDef;
}
export interface VariantEdit {
  revision?: number;
  rate?: number;
  steps: Record<string, StepEdit>;
  placements?: Record<string, { offset: V3; yaw: number }>;
  added?: CineStep[];
}
export interface SceneProject {
  version: 1;
  enabled: boolean;
  scenes: Record<string, Partial<Record<Variant, VariantEdit>>>;
}

export function emptyProject(): SceneProject { return { version: 1, enabled: false, scenes: {} }; }
export function stepKeys(steps: CineStep[]): string[] {
  const counts: Record<string, number> = {};
  return steps.map((s) => {
    const prefix = `${s.do}${'who' in s ? `:${s.who}` : ''}`;
    const n = counts[prefix] ?? 0; counts[prefix] = n + 1;
    return `${prefix}:${n}`;
  });
}
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const vec = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every((n) => num(n, -2000, 2000));
const safeName = (s: string) => s.length <= 100 && /^[a-zA-Z0-9:._-]+$/.test(s) && !['__proto__', 'constructor', 'prototype'].includes(s);
function checkClip(v: unknown): void {
  if (!record(v) || typeof v.id !== 'string' || !num(v.dur, 0.01, 300) || !Array.isArray(v.keys) || !v.keys.length || v.keys.length > 200) throw new Error('Некорректный клип');
  if (v.mask !== undefined && v.mask !== 'upper' && v.mask !== 'full') throw new Error('Некорректная маска клипа');
  let prev = -1;
  for (const k of v.keys) {
    if (!record(k) || !num(k.t, 0, v.dur as number) || (k.t as number) <= prev || !record(k.pose)) throw new Error('Ключи позы должны идти по времени');
    prev = k.t as number;
    if (Object.entries(k.pose).some(([n, a]) => n.length > 60 || !vec(a))) throw new Error('Некорректный сустав');
    if (k.ease !== undefined && (typeof k.ease !== 'string' || !own(Ease, k.ease))) throw new Error('Неизвестная кривая');
    if (k.rootOffset !== undefined && !vec(k.rootOffset)) throw new Error('Некорректный корень');
    if (k.stretch !== undefined && !num(k.stretch, 0.1, 5)) throw new Error('Некорректный масштаб');
    if (k.spin !== undefined && !num(k.spin, -100, 100)) throw new Error('Некорректный поворот');
  }
  if (v.events !== undefined && (!Array.isArray(v.events) || v.events.length > 100 || v.events.some((e) => !record(e) || !num(e.t, 0, v.dur as number) || typeof e.name !== 'string'))) throw new Error('Некорректные маркеры');
}

/** Импорт проверяется целиком до замены проекта; произвольная логика игры из файла не исполняется. */
export function parseProject(raw: string): SceneProject {
  if (raw.length > 2_000_000) throw new Error('Файл больше 2 МБ');
  const p: unknown = JSON.parse(raw);
  if (!record(p) || p.version !== 1 || typeof p.enabled !== 'boolean' || !record(p.scenes) || Object.keys(p.scenes).length > 100) throw new Error('Это не проект VOIDBREAKER Studio v1');
  for (const [id, scene] of Object.entries(p.scenes)) {
    if (!safeName(id) || !record(scene)) throw new Error('Некорректная сцена');
    for (const [variant, e] of Object.entries(scene)) {
      if (!['full', 'short'].includes(variant) || !record(e) || !record(e.steps) || Object.keys(e.steps).length > 500) throw new Error('Некорректная дорожка');
      if (e.rate !== undefined && !num(e.rate, 0.25, 4)) throw new Error('Темп вне диапазона 0.25–4');
      if (e.placements !== undefined) {
        if (!record(e.placements)) throw new Error('Некорректная расстановка');
        for (const [who, a] of Object.entries(e.placements)) if (!safeName(who) || !record(a) || !vec(a.offset) || !num(a.yaw, -100, 100)) throw new Error('Некорректная позиция актёра');
      }
      if (e.added !== undefined) {
        if (!Array.isArray(e.added) || e.added.length > 100) throw new Error('Слишком много новых движений');
        for (const s of e.added) {
          if (!record(s) || !['actor', 'clip'].includes(String(s.do)) || typeof s.who !== 'string' || !safeName(s.who) || !num(s.t, 0, 300)) throw new Error('Добавлять можно только движения и позы');
          if (s.dur !== undefined && !num(s.dur, 0, 300)) throw new Error('Некорректная длительность');
          if (s.moveTo !== undefined && !vec(s.moveTo)) throw new Error('Некорректная точка');
          if (s.lookAt !== undefined && !vec(s.lookAt)) throw new Error('Некорректный взгляд');
          if (s.ease !== undefined && !own(Ease, String(s.ease))) throw new Error('Некорректная кривая');
          if (s.turn !== undefined && !num(s.turn, 0, 30)) throw new Error('Некорректный разворот');
          if (s.do === 'clip' && (typeof s.clip !== 'string' || !s.definition)) throw new Error('Нет определения позы');
          if (s.definition) checkClip(s.definition);
          if (s.speed !== undefined && !num(s.speed, 0.1, 4)) throw new Error('Некорректная скорость');
          if (s.blend !== undefined && !num(s.blend, 0, 5)) throw new Error('Некорректное смешивание');
        }
      }
      for (const edit of Object.values(e.steps)) {
        if (!record(edit)) throw new Error('Некорректная правка');
        for (const k of ['t', 'dur', 'turn', 'blend']) if (edit[k] !== undefined && !num(edit[k], 0, 300)) throw new Error(`Некорректное время: ${k}`);
        if (edit.ease !== undefined && (typeof edit.ease !== 'string' || !own(Ease, edit.ease))) throw new Error('Неизвестная кривая');
        for (const k of ['moveOffset', 'lookOffset']) if (edit[k] !== undefined && !vec(edit[k])) throw new Error('Некорректное смещение');
        for (const k of ['bends', 'pathOffsets', 'lookOffsets']) if (edit[k] !== undefined && (!Array.isArray(edit[k]) || (edit[k] as unknown[]).length > 64 || !(edit[k] as unknown[]).every(vec))) throw new Error('Некорректная траектория');
        if (edit.speed !== undefined && !num(edit.speed, 0.1, 4)) throw new Error('Некорректная скорость');
        if (edit.fov !== undefined && !num(edit.fov, 10, 120)) throw new Error('Некорректный угол камеры');
        if (edit.roll !== undefined && !num(edit.roll, -Math.PI, Math.PI)) throw new Error('Некорректный наклон');
        if (edit.clip !== undefined && (typeof edit.clip !== 'string' || edit.clip.length > 100)) throw new Error('Некорректный клип');
        if (edit.definition !== undefined) checkClip(edit.definition);
      }
    }
  }
  // Удаляем неизвестные поля добавленных шагов, чтобы файл не мог подменить служебную логику.
  const result = p as unknown as SceneProject;
  for (const scene of Object.values(result.scenes)) for (const e of Object.values(scene)) if (e?.added) e.added = e.added.map((s) => {
    if (s.do === 'actor') return { t: s.t, do: 'actor', who: s.who, moveTo: s.moveTo, lookAt: s.lookAt, dur: s.dur, ease: s.ease, turn: s.turn };
    if (s.do === 'clip') return { t: s.t, do: 'clip', who: s.who, clip: s.clip, definition: s.definition, dur: s.dur, speed: s.speed, blend: s.blend };
    throw new Error('Неизвестный шаг');
  });
  return result;
}

export function readProject(): SceneProject {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STUDIO_KEY);
    return parseProject(raw ?? JSON.stringify(defaults));
  } catch { return parseProject(JSON.stringify(defaults)); }
}
export function saveProject(p: SceneProject): void { localStorage.setItem(STUDIO_KEY, JSON.stringify(p)); }

export function offsetWorld(v: V3, heading = 0): V3 {
  const c = Math.cos(heading), s = Math.sin(heading);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Те же правки для редактора и игры. Векторы — дельты в осях сцены: живая маска остаётся якорем контакта. */
export function resolveScene(source: CineTrack, project: SceneProject, variant: Variant): CineTrack {
  const track = structuredClone(source), e = project.scenes[source.id]?.[variant];
  if (!e || (source.revision !== undefined && e.revision !== source.revision)) return track;
  const original = variant === 'short' ? track.short ?? track.steps : track.steps;
  const keys = stepKeys(original), heading = source.heading ?? 0;
  const shift = (v: V3, delta?: V3) => delta ? add(v, offsetWorld(delta, heading)) : v;
  const steps = original.map((s, i): CineStep => {
    const d = e.steps[keys[i]];
    if (!d) return s;
    // События сюжета и контакта не подменяются редактором движений.
    if (!['actor', 'cam', 'clip', 'crack', 'dissolve', 'sky'].includes(s.do)) return s;
    if (d.t !== undefined) s.t = d.t;
    if ('dur' in s && d.dur !== undefined) s.dur = d.dur;
    if ('ease' in s && d.ease) s.ease = d.ease;
    if (s.do === 'actor') {
      if (d.dur !== undefined) s.dur = d.dur;
      if (d.ease) s.ease = d.ease;
      if (s.moveTo) s.moveTo = shift(s.moveTo, d.moveOffset);
      if (s.lookAt) s.lookAt = shift(s.lookAt, d.lookOffset);
      if (d.turn !== undefined) s.turn = d.turn;
      if (d.bends) s.bends = d.bends.map((v) => offsetWorld(v, heading));
      if (d.clip) s.clip = d.clip;
    }
    if (s.do === 'cam') {
      if (d.ease) s.ease = d.ease;
      s.path = s.path.map((v, j) => shift(v, d.pathOffsets?.[j]));
      s.look = s.look.map((v, j) => shift(v, d.lookOffsets?.[j]));
      if (d.fov !== undefined) s.fov = d.fov;
      if (d.roll !== undefined) s.roll = d.roll;
    }
    if (s.do === 'clip') {
      if (d.clip) s.clip = d.clip;
      if (d.speed !== undefined) s.speed = d.speed;
      if (d.blend !== undefined) s.blend = d.blend;
      if (d.dur !== undefined) s.dur = d.dur;
      if (d.definition) { s.definition = d.definition; s.clip = `studio:${source.id}:${variant}:${keys[i]}`; }
    }
    return s;
  });
  for (const a of e.added ?? []) {
    const s = structuredClone(a);
    if (s.do === 'actor') {
      if (s.moveTo) s.moveTo = add(source.origin ?? [0, 0, 0], offsetWorld(s.moveTo, heading));
      if (s.lookAt) s.lookAt = add(source.origin ?? [0, 0, 0], offsetWorld(s.lookAt, heading));
    }
    steps.push(s);
  }
  const rate = e.rate ?? 1;
  track.playbackRate = rate;
  for (const s of steps) {
    s.t /= rate;
    if ('dur' in s && s.dur !== undefined) s.dur /= rate;
    if (s.do === 'clip') { s.speed = (s.speed ?? 1) * rate; if (s.blend) s.blend /= rate; }
    if (s.do === 'actor' && s.turn) s.turn /= rate;
  }
  if (variant === 'short') track.short = steps; else track.steps = steps;
  if (track.dur) track.dur /= rate;
  const end = Math.max(0, ...steps.map((s) => s.t + ('dur' in s ? s.dur ?? 0 : 0)));
  track.dur = Math.max(track.dur ?? end + 0.3, end + 0.05);
  track.placements = Object.fromEntries(Object.entries(e.placements ?? {}).map(([who, p]) => [who, { offset: offsetWorld(p.offset, heading), yaw: p.yaw }]));
  return track;
}
