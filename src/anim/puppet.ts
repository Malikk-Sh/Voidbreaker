import { Animator, Clip, type ClipDef } from './clip';
import { RigLayout, Skeleton, type RigDef } from './skeleton';

/** Набор скомпилированных клипов для рига (кэшируется по id рига). */
const clipCache = new Map<string, Map<string, Clip>>();

export function compileClips(layout: RigLayout, defs: ClipDef[]): Map<string, Clip> {
  let m = clipCache.get(layout.def.id);
  if (!m) { m = new Map(); clipCache.set(layout.def.id, m); }
  for (const d of defs) if (!m.has(d.id)) m.set(d.id, new Clip(d, layout));
  return m;
}

const layoutCache = new Map<string, RigLayout>();
export function layoutOf(def: RigDef): RigLayout {
  let l = layoutCache.get(def.id);
  if (!l) { l = new RigLayout(def); layoutCache.set(def.id, l); }
  return l;
}

/**
 * Кукла: скелет + аниматор + базовая поза. Эффекты материала (вспышка, растворение, свечение, трещины)
 * уходят в атрибуты инстанса батча (Tech §12, MaterialFx).
 */
export class Puppet {
  readonly skel: Skeleton;
  readonly anim: Animator;
  readonly base: Float32Array;
  readonly clips: Map<string, Clip>;
  flash = 0;
  dissolve = 0;
  boost = 0;
  crack = 0;
  /** Пружина отдачи корпуса (вздрагивание от удара, Tech §8.6). */
  springX = 0; springZ = 0; springVX = 0; springVZ = 0;

  constructor(readonly layout: RigLayout, clipDefs: ClipDef[]) {
    this.skel = new Skeleton(layout);
    this.anim = new Animator(layout);
    this.base = new Float32Array(layout.n * 4);
    this.base.set(layout.restRot);
    this.clips = compileClips(layout, clipDefs);
  }

  play(id: string, speed = 1, fade = 0.05): boolean {
    const c = this.clips.get(id);
    if (!c) return false;
    this.anim.play(c, speed, fade);
    return true;
  }

  /** Импульс отдачи: направление в мире (x,z). */
  kickSpring(dx: number, dz: number, k: number): void {
    this.springVX += dx * k * 6; this.springVZ += dz * k * 6;
  }

  stepSpring(dt: number): void {
    // затухающая пружина ≈ 0.25 с
    const w = 22, z = 0.45;
    this.springVX += (-w * w * this.springX - 2 * z * w * this.springVX) * dt;
    this.springVZ += (-w * w * this.springZ - 2 * z * w * this.springVZ) * dt;
    this.springX += this.springVX * dt; this.springZ += this.springVZ * dt;
    this.flash = Math.max(0, this.flash - dt * 9);
  }
}
