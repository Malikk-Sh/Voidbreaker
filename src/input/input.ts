/**
 * Ввод (GDD §4.1, Tech §13): Pointer Events с мультитачем по pointerId, клавиатура/мышь, Gamepad API → одни действия.
 * Левая половина — плавающий стик (радиус 60 px, мёртвая зона 12 %). Правая — кнопки и свайп-рывок (> 40 px за < 180 мс).
 * Буфер ввода 150 мс для атаки, рывка, способностей.
 */
export type Action = 'attack' | 'attackRelease' | 'dash' | 'q' | 'e' | 'r' | 'pause';
export const BUFFER = 0.15;

export class InputBuffer {
  private q: { a: Action; t: number; dx: number; dz: number }[] = [];
  push(a: Action, now: number, dx = 0, dz = 0): void { this.q.push({ a, t: now, dx, dz }); if (this.q.length > 16) this.q.shift(); }
  /** Извлечь действие, если оно было нажато не раньше чем BUFFER назад. */
  consume(a: Action, now: number): { dx: number; dz: number } | null {
    const i = this.q.findIndex((e) => e.a === a && now - e.t <= BUFFER);
    if (i < 0) return null;
    const e = this.q[i];
    this.q.splice(i, 1);
    return { dx: e.dx, dz: e.dz };
  }
  peek(a: Action, now: number): boolean { return this.q.some((e) => e.a === a && now - e.t <= BUFFER); }
  prune(now: number): void { this.q = this.q.filter((e) => now - e.t <= BUFFER); }
  clear(): void { this.q.length = 0; }
}

export interface TouchButton { id: Action; x: number; y: number; r: number; pressed: boolean; pointer: number }

export interface TouchLayout { scale: number; offsetX: number; offsetY: number }

export class Input {
  readonly buffer = new InputBuffer();
  /** Направление движения в плоскости пола (экран: x вправо, z вниз), длина 0..1. */
  moveX = 0; moveZ = 0;
  /** Направление прицеливания (мышь/стик способности), если активно. */
  aimX = 0; aimZ = 0; aimActive = false;
  attackHeld = false;
  attackHeldSince = 0;
  now = 0;
  lastDevice: 'kbd' | 'touch' | 'pad' = 'kbd';
  enabled = true;
  /** Обработчик пауз/меню (экраны DOM перехватывают Esc сами). */
  onPause: (() => void) | null = null;
  /** Касание экрана где угодно или нажатие атаки (с): для действий в сценах, где кнопки боя скрыты. */
  private sceneTapAt = -1;

  private keys = new Set<string>();
  private mouseX = 0; private mouseY = 0; private mouseSeen = false;
  /** Курсор мыши (экранные px), если мышь использовалась. */
  get mouse(): { x: number; y: number } | null { return this.mouseSeen ? { x: this.mouseX, y: this.mouseY } : null; }
  // тач
  stick = { active: false, pointer: -1, ox: 0, oy: 0, x: 0, y: 0, radius: 60 };
  buttons: TouchButton[] = [];
  private swipes = new Map<number, { x: number; y: number; t: number }>();
  touchUi = false;
  private padPrev: boolean[] = [];
  private padIndex = -1;
  layout: TouchLayout = { scale: 1, offsetX: 0, offsetY: 0 };
  screenToFloor: ((sx: number, sy: number) => { x: number; z: number } | null) | null = null;
  heroScreen: (() => { x: number; y: number }) | null = null;
  /** Положение героя в мире (для прицела мышью через проекцию на пол). */
  heroWorld: (() => { x: number; z: number } | null) | null = null;

  constructor(readonly el: HTMLElement) {
    // сенсорный экран — тач-раскладка с первого кадра
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) { this.lastDevice = 'touch'; this.touchUi = true; }
    addEventListener('keydown', this.onKey, { passive: false });
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; });
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    addEventListener('pointermove', this.onMove, { passive: false });
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('gamepadconnected', (e) => { this.padIndex = (e as GamepadEvent).gamepad.index; });
  }

  /** Раскладка кнопок (GDD §19.3): атака 96 px, рывок 72 px, Q/E/R ≥ 48 px, дугой над ними. */
  layoutButtons(w: number, h: number, safeR = 0, safeB = 0): void {
    const s = this.layout.scale;
    const bx = w - safeR - 92 * s + this.layout.offsetX, by = h - safeB - 86 * s + this.layout.offsetY;
    const mk = (id: Action, dx: number, dy: number, r: number): TouchButton => {
      const old = this.buttons.find((b) => b.id === id);
      return { id, x: bx + dx * s, y: by + dy * s, r: r * s, pressed: old?.pressed ?? false, pointer: old?.pointer ?? -1 };
    };
    this.buttons = [
      mk('attack', 0, 0, 48),
      mk('dash', -112, 18, 36),
      mk('q', -96, -84, 27),
      mk('e', -30, -128, 27),
      mk('r', 46, -132, 27),
    ];
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.repeat) { if (['Space', 'Tab'].includes(e.code)) e.preventDefault(); return; }
    this.lastDevice = 'kbd';
    this.keys.add(e.code);
    if (e.code === 'Escape' || e.code === 'KeyP') { this.onPause?.(); return; }
    if (!this.enabled) return;
    switch (e.code) {
      case 'KeyJ': case 'Enter': this.pressAttack(); break;
      case 'Space': case 'ShiftLeft': case 'ShiftRight': case 'KeyK': e.preventDefault(); this.push('dash'); break;
      case 'KeyQ': case 'KeyU': this.push('q'); break;
      case 'KeyE': case 'KeyI': this.push('e'); break;
      case 'KeyR': case 'KeyO': this.push('r'); break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === 'KeyJ' || e.code === 'Enter') this.releaseAttack();
  };

  private push(a: Action, dx = 0, dz = 0): void { this.buffer.push(a, this.now, dx, dz); }

  /**
   * Действие в сцене (план §4.3): касание экрана где угодно, клик или атака не раньше BUFFER назад. Забирает
   * и атаку из буфера — после сцены она не станет случайным ударом.
   */
  consumeSceneTap(): boolean {
    const touched = this.sceneTapAt >= 0 && this.now - this.sceneTapAt <= BUFFER;
    this.sceneTapAt = -1;
    return !!this.buffer.consume('attack', this.now) || touched;
  }

  private pressAttack(): void {
    if (this.attackHeld) return;
    this.attackHeld = true;
    this.attackHeldSince = this.now;
    this.push('attack');
  }
  private releaseAttack(): void {
    if (!this.attackHeld) return;
    this.attackHeld = false;
    this.push('attackRelease');
  }

  private hitButton(x: number, y: number): TouchButton | undefined {
    let best: TouchButton | undefined, bd = Infinity;
    for (const b of this.buttons) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.r * 1.25 && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      this.lastDevice = 'kbd';
      this.mouseSeen = true;
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      if (e.button === 0) this.pressAttack();
      else if (e.button === 2) this.push('dash', ...this.mouseDir());
      e.preventDefault();
      return;
    }
    e.preventDefault();
    this.lastDevice = 'touch';
    this.touchUi = true;
    this.sceneTapAt = this.now;
    const x = e.clientX, y = e.clientY;
    const btn = this.hitButton(x, y);
    if (btn) {
      btn.pressed = true; btn.pointer = e.pointerId;
      if (btn.id === 'attack') this.pressAttack();
      else this.push(btn.id);
      return;
    }
    if (x < innerWidth * 0.5 && !this.stick.active) {
      this.stick.active = true; this.stick.pointer = e.pointerId;
      this.stick.ox = x; this.stick.oy = y; this.stick.x = x; this.stick.y = y;
      return;
    }
    this.swipes.set(e.pointerId, { x, y, t: performance.now() });
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.mouseX = e.clientX; this.mouseY = e.clientY; this.mouseSeen = true;
      return;
    }
    if (this.stick.active && e.pointerId === this.stick.pointer) {
      e.preventDefault();
      this.stick.x = e.clientX; this.stick.y = e.clientY;
      // стик «тянется» за пальцем, если тот ушёл далеко
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy, d = Math.hypot(dx, dy), R = this.stick.radius * 1.4;
      if (d > R) { this.stick.ox += (dx / d) * (d - R); this.stick.oy += (dy / d) * (d - R); }
      return;
    }
    const sw = this.swipes.get(e.pointerId);
    if (sw) {
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y, d = Math.hypot(dx, dy);
      if (d > 40 && performance.now() - sw.t < 180) {
        this.push('dash', dx / d, dy / d);
        this.swipes.delete(e.pointerId);
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.releaseAttack();
      return;
    }
    if (e.pointerId === this.stick.pointer) { this.stick.active = false; this.stick.pointer = -1; }
    for (const b of this.buttons) {
      if (b.pointer === e.pointerId) {
        b.pressed = false; b.pointer = -1;
        if (b.id === 'attack') this.releaseAttack();
      }
    }
    this.swipes.delete(e.pointerId);
  };

  /** Направление от героя к курсору на полу (мир, x/z); без проекции — по экрану от героя. */
  private mouseDir(): [number, number] {
    if (this.screenToFloor && this.heroWorld) {
      const p = this.screenToFloor(this.mouseX, this.mouseY), h = this.heroWorld();
      if (p && h) {
        const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz);
        return d > 0.3 ? [dx / d, dz / d] : [0, 0];
      }
    }
    if (!this.heroScreen) return [0, 0];
    const h = this.heroScreen();
    const dx = this.mouseX - h.x, dy = this.mouseY - h.y, d = Math.hypot(dx, dy);
    return d > 4 ? [dx / d, dy / d] : [0, 0];
  }

  update(now: number): void {
    this.now = now;
    let mx = 0, mz = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
    if (this.stick.active) {
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const d = Math.hypot(dx, dy), R = this.stick.radius;
      const m = Math.min(1, d / R);
      if (m > 0.12) { mx = (dx / d) * ((m - 0.12) / 0.88); mz = (dy / d) * ((m - 0.12) / 0.88); }
    }
    this.pollPad();
    if (this.padMove) { mx = this.padMove[0]; mz = this.padMove[1]; }
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    this.moveX = mx; this.moveZ = mz;
    // прицел мышью: направление от героя к курсору
    this.aimActive = false;
    if (this.mouseSeen && this.lastDevice === 'kbd') {
      const [ax, az] = this.mouseDir();
      if (ax || az) { this.aimX = ax; this.aimZ = az; this.aimActive = true; }
    }
    this.buffer.prune(now);
  }

  private padMove: [number, number] | null = null;
  private pollPad(): void {
    this.padMove = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = (this.padIndex >= 0 ? pads[this.padIndex] : null) ?? [...pads].find((p) => p) ?? null;
    if (!pad) return;
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    const m = Math.hypot(ax, ay);
    if (m > 0.18) { this.padMove = [(ax / m) * ((m - 0.18) / 0.82), (ay / m) * ((m - 0.18) / 0.82)]; this.lastDevice = 'pad'; }
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number) => btn(i) && !this.padPrev[i];
    if (!this.enabled) { this.padPrev = pad.buttons.map((b) => b.pressed); return; }
    if (edge(2)) { this.pressAttack(); this.lastDevice = 'pad'; }
    if (!btn(2) && this.padPrev[2]) this.releaseAttack();
    if (edge(0)) this.push('dash');
    if (edge(4)) this.push('q');
    if (edge(5)) this.push('e');
    if (edge(7) || edge(6)) this.push('r');
    if (edge(9)) this.onPause?.();
    this.padPrev = pad.buttons.map((b) => b.pressed);
  }

  vibrate(ms: number): void {
    if (this.lastDevice === 'touch' && this.vibration) navigator.vibrate?.(ms);
  }
  vibration = true;

  reset(): void {
    this.buffer.clear();
    this.attackHeld = false;
    this.stick.active = false;
    for (const b of this.buttons) { b.pressed = false; b.pointer = -1; }
  }
}
