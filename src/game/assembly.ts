import * as THREE from 'three';
import { Ease } from '../core/ease';
import { Rng } from '../core/rng';
import type { SetPiecePart } from '../gen/zone/setPieces';

/**
 * Сборная декорация арены (этап 4.5, C3; пилот — «Хоры» 1-9). Части висят в бездне разобранными; с каждой
 * закрытой волной поднимаются и сходятся, перед последней волной встают в силуэт — кульминация (свет, хор);
 * после последней волны гаснут и уходят вниз. Только подача: правила боя не меняет. Клуатр и Крипта ставят
 * свои части и ступени тем же классом.
 */
export const ASSEMBLY = {
  /** Доля сборки по числу закрытых волн (последняя ступень — силуэт). */
  steps: [0, 0.45, 0.75, 1],
  /**
   * Разобранная часть ниже своего места (м), в стороны (м), наклон (рад). Неглубоко и вразброс по ширине провала:
   * сборка читается как схождение обломков, а не всплытие из темноты (провал темнеет к 6 м).
   */
  depth: 1.6, spread: 3.0, tilt: 0.8,
  /**
   * Боевая камера смотрит под ~55°: на метр глубины ближний к ней край провала закрывает ~0.9 м — разобранная
   * часть держится дальше от него, иначе её с боя не видно.
   */
  view: 0.9,
  /** За сколько сходится на ступень (с): меньше передышки между волнами (2.5 с), силуэт встаёт до последней волны. */
  settle: 2.0,
  /** Разнобой частей: доля settle, на которую часть может опоздать. */
  stagger: 0.3,
  /** Покачивание разобранных (рад), гаснет к сборке. */
  sway: 0.22,
  /** Свечение по ступеням; вспышка кульминации и её спад до последней ступени (с). */
  glow: [0.6, 0.8, 1.0, 1.3], climaxGlow: 3.2, climaxFade: 1.6,
  /** После боя: уходят вниз на fall м (±30 % по частям — все в темноту провала) за fallDur с, свет гаснет. */
  fall: 8, fallDur: 2.6,
};

/** Прямоугольник проёма (провал): разобранные части держатся в нём — их видно с боевой камеры, а не под полом. */
export interface HoleRect { x0: number; x1: number; z0: number; z1: number }

interface Item { m: THREE.Mesh; slot: THREE.Vector3; rot: THREE.Vector3; scat: THREE.Vector3; scatRot: THREE.Vector3; lag: number; ph: number; u: number; from: number }

export class Assembly {
  readonly group = new THREE.Group();
  private readonly items: Item[] = [];
  private step = 0;
  private stepT = 0;
  private target = 0;
  private time = 0;
  private glow = ASSEMBLY.glow[0];
  private climaxT = -1;
  private fallT = -1;
  climaxed = false;
  /** Части встали в силуэт (один раз). */
  onClimax: (() => void) | null = null;

  constructor(parts: SetPiecePart[], readonly material: THREE.ShaderMaterial, holes: HoleRect[], seed = 1) {
    const rng = new Rng(seed), A = ASSEMBLY;
    for (const p of parts) {
      const m = new THREE.Mesh(p.geo, material);
      m.frustumCulled = false;
      this.group.add(m);
      const slot = new THREE.Vector3(...p.slot), rot = new THREE.Vector3(...p.rot);
      const h = holes.find((r) => slot.x >= r.x0 && slot.x <= r.x1 && slot.z >= r.z0 && slot.z <= r.z1);
      const sx = slot.x + rng.range(-A.spread, A.spread), sz = slot.z + rng.range(-A.spread, A.spread) * 0.5;
      const sy = slot.y - A.depth * rng.range(0.85, 1.15);
      const scat = new THREE.Vector3(h ? Math.min(h.x1 - 0.5, Math.max(h.x0 + 0.5, sx)) : sx, sy, h ? Math.max(h.z0 + 0.4, Math.min(h.z1 - 0.4 + sy * A.view, sz)) : sz);
      const scatRot = new THREE.Vector3(rng.range(-A.tilt, A.tilt), rot.y + rng.range(-A.tilt, A.tilt) * 1.5, rng.range(-A.tilt, A.tilt));
      this.items.push({ m, slot, rot, scat, scatRot, lag: rng.range(0, A.stagger), ph: rng.range(0, Math.PI * 2), u: 0, from: 0 });
    }
    this.place();
  }

  /** Средняя доля сборки 0..1. */
  get progress(): number { return this.items.reduce((s, i) => s + i.u, 0) / Math.max(1, this.items.length); }
  get stage(): number { return this.step; }
  get light(): number { return this.glow; }
  get falling(): boolean { return this.fallT >= 0; }

  /** Закрыто n волн из total: ступень сборки; последняя волна закрыта — уходят в бездну. */
  wavesCleared(n: number, total: number): void {
    if (n >= total) { if (this.fallT < 0) this.fallT = 0; return; }
    this.goTo(Math.min(ASSEMBLY.steps.length - 1, Math.round((n / Math.max(1, total - 1)) * (ASSEMBLY.steps.length - 1))));
  }

  /** Бой начат с волны i (проверка ?wave=…): ступень — сразу, без движения и кульминации. */
  jumpTo(i: number, total: number): void {
    const k = Math.min(ASSEMBLY.steps.length - 1, Math.round((i / Math.max(1, total - 1)) * (ASSEMBLY.steps.length - 1)));
    if (k <= this.step) return;
    this.step = k; this.target = ASSEMBLY.steps[k];
    for (const it of this.items) { it.u = this.target; it.from = this.target; }
    this.glow = ASSEMBLY.glow[k];
    this.climaxed = k === ASSEMBLY.steps.length - 1;
    this.stepT = ASSEMBLY.settle * 2;
    this.place();
  }

  private goTo(k: number): void {
    if (k <= this.step) return;
    this.step = k; this.target = ASSEMBLY.steps[k]; this.stepT = 0;
    for (const it of this.items) it.from = it.u;
  }

  update(dt: number): void {
    const A = ASSEMBLY, last = A.steps.length - 1;
    this.time += dt; this.stepT += dt;
    let done = true;
    for (const it of this.items) {
      const k = Math.min(1, Math.max(0, (this.stepT / A.settle - it.lag) / (1 - A.stagger)));
      it.u = it.from + (this.target - it.from) * Ease.inOutCubic(k);
      if (k < 1) done = false;
    }
    if (this.step === last && done && !this.climaxed && this.fallT < 0) {
      this.climaxed = true; this.climaxT = 0;
      this.onClimax?.();
    }
    let g = A.glow[this.step];
    if (this.climaxT >= 0) { this.climaxT += dt; g += (A.climaxGlow - g) * Math.exp(-this.climaxT / A.climaxFade * 3); }
    if (this.fallT >= 0) { this.fallT += dt; g *= Math.max(0, 1 - this.fallT / (A.fallDur * 0.6)); }
    this.glow += (g - this.glow) * Math.min(1, dt * 6);
    this.material.uniforms.uEmissiveStrength.value = this.glow;
    this.place();
  }

  private place(): void {
    const A = ASSEMBLY, f = this.fallT >= 0 ? Ease.inQuad(Math.min(1, this.fallT / A.fallDur)) : 0;
    for (const it of this.items) {
      const u = it.u, s = Math.sin(this.time * 0.7 + it.ph) * A.sway * (1 - u);
      it.m.position.lerpVectors(it.scat, it.slot, u);
      it.m.position.y += Math.sin(this.time * 0.5 + it.ph) * 0.25 * (1 - u) - A.fall * f * (1 + 0.3 * Math.sin(it.ph));
      it.m.rotation.set(
        it.scatRot.x + (it.rot.x - it.scatRot.x) * u + s + f * 0.6 * Math.sin(it.ph),
        it.scatRot.y + (it.rot.y - it.scatRot.y) * u,
        it.scatRot.z + (it.rot.z - it.scatRot.z) * u + s * 0.6 + f * 0.5 * Math.cos(it.ph),
      );
    }
  }

  dispose(): void { for (const it of this.items) it.m.geometry.dispose(); this.material.dispose(); this.group.removeFromParent(); }
}
