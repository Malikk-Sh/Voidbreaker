import type { EnemyKind } from '../../data/enemies';
import type { Enemy, SpawnOpts } from '../enemy';
import { Spiker } from './spiker';
import { Reaper } from './reaper';
import { Eye } from './eye';
import { Golem } from './golem';
import { Acolyte } from './acolyte';

type Ctor = new (o: SpawnOpts) => Enemy;
const REGISTRY: Partial<Record<EnemyKind, Ctor>> = {
  spiker: Spiker, reaper: Reaper, eye: Eye, golem: Golem, acolyte: Acolyte,
};

/** Регистрация конструкторов стражей и боссов (подключаются своими модулями). */
export function registerEnemy(kind: EnemyKind, ctor: Ctor): void { REGISTRY[kind] = ctor; }

export function createEnemy(kind: EnemyKind, o: SpawnOpts): Enemy {
  const C = REGISTRY[kind];
  if (!C) throw new Error(`no enemy ${kind}`);
  return new C(o);
}
