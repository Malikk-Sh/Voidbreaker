import type { EnemyKind } from '../../data/enemies';
import type { Enemy, SpawnOpts } from '../enemy';
import { Spiker } from './spiker';
import { Reaper } from './reaper';
import { Crucifier } from './crucifier';
import { Psalmist } from './psalmist';
import { Eye } from './eye';
import { Golem } from './golem';
import { Acolyte } from './acolyte';
import { Husk } from './husk';

type Ctor = new (o: SpawnOpts) => Enemy;
const REGISTRY: Partial<Record<EnemyKind, Ctor>> = {
  husk: Husk, spiker: Spiker, reaper: Reaper, crucifier: Crucifier, eye: Eye, golem: Golem, acolyte: Acolyte, psalmist: Psalmist,
};

/** Регистрация конструкторов стражей и боссов (подключаются своими модулями). */
export function registerEnemy(kind: EnemyKind, ctor: Ctor): void { REGISTRY[kind] = ctor; }

export function createEnemy(kind: EnemyKind, o: SpawnOpts): Enemy {
  const C = REGISTRY[kind];
  if (!C) throw new Error(`no enemy ${kind}`);
  return new C(o);
}
