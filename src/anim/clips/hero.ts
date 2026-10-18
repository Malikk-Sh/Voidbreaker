import type { ClipDef, Key } from '../clip';

/**
 * Клипы героя (GDD §15.5). Углы — Эйлер (рад) поверх позы покоя.
 * Соглашения: герой смотрит в +Z, левая сторона — +X. Плечо x<0 — рука вперёд/вверх; chest y>0 — разворот корпуса влево.
 * Клинок зажат в кулаке и продолжает руку (−Y кисти, с лёгким наклоном вперёд); blade x>0 — отводит клинок назад.
 * Предвкушение 40–80 мс → действие 1–2 кадра → читаемое восстановление (GDD §15.1).
 */
export const HERO_CLIPS: ClipDef[] = [
  {
    // Удар 1: горизонтальный разрез справа налево
    id: 'atk1', dur: 0.26, mask: 'upper',
    keys: [
      { t: 0, pose: { chest: [0.1, -0.5, 0], spine: [0.05, -0.2, 0], shR: [-1.2, 0.3, -0.75], elbR: [-0.35, 0, 0], blade: [0.25, 0, 0], shL: [-0.3, 0, 0.5], elbL: [-0.9, 0, 0], head: [0, 0.3, 0] } },
      { t: 0.045, ease: 'inBack', pose: { chest: [0.1, -0.85, 0.05], spine: [0.05, -0.35, 0], shR: [-1.35, 0.4, -1.05], elbR: [-0.55, 0, 0], blade: [0.5, 0, 0] } },
      { t: 0.085, ease: 'outExpo', stretch: 1.08, pose: { chest: [0.15, 0.85, -0.05], spine: [0.08, 0.35, 0], shR: [-1.5, -0.1, 0.55], elbR: [-0.05, 0, 0], blade: [-0.1, 0, 0], shL: [0.3, 0, 0.6], head: [0, -0.4, 0] } },
      { t: 0.26, ease: 'outQuart', stretch: 1, pose: { chest: [0.1, 0.55, 0], spine: [0.05, 0.2, 0], shR: [-1.2, 0, 0.35], elbR: [-0.3, 0, 0], blade: [0.1, 0, 0], shL: [0.1, 0, 0.4], head: [0, -0.2, 0] } },
    ],
    events: [{ t: 0.04, name: 'trailOn' }, { t: 0.05, name: 'hitOn' }, { t: 0.13, name: 'hitOff' }, { t: 0.16, name: 'trailOff' }, { t: 0.045, name: 'swing' }],
  },
  {
    // Удар 2: обратный разрез слева направо
    id: 'atk2', dur: 0.26, mask: 'upper',
    keys: [
      { t: 0, pose: { chest: [0.1, 0.55, 0], spine: [0.05, 0.2, 0], shR: [-1.2, 0, 0.35], elbR: [-0.3, 0, 0], blade: [0.1, 0, 0], shL: [0.1, 0, 0.4], elbL: [-0.6, 0, 0] } },
      { t: 0.045, ease: 'inBack', pose: { chest: [0.1, 0.95, 0.05], spine: [0.05, 0.35, 0], shR: [-1.3, -0.2, 0.75], elbR: [-0.9, 0, 0], blade: [0.3, 0, 0] } },
      { t: 0.085, ease: 'outExpo', stretch: 1.08, pose: { chest: [0.15, -0.9, -0.05], spine: [0.08, -0.35, 0], shR: [-1.45, 0.5, -1.15], elbR: [-0.05, 0, 0], blade: [-0.15, 0, 0], shL: [-0.5, 0, 0.3], head: [0, 0.4, 0] } },
      { t: 0.26, ease: 'outQuart', stretch: 1, pose: { chest: [0.1, -0.6, 0], spine: [0.05, -0.2, 0], shR: [-1.1, 0.3, -0.8], elbR: [-0.3, 0, 0], blade: [0.15, 0, 0], shL: [-0.2, 0, 0.4], head: [0, 0.2, 0] } },
    ],
    events: [{ t: 0.04, name: 'trailOn' }, { t: 0.05, name: 'hitOn' }, { t: 0.13, name: 'hitOff' }, { t: 0.16, name: 'trailOff' }, { t: 0.045, name: 'swing' }],
  },
  {
    // Удар 3: вращение 360°, плащ раскрывается веером
    id: 'spin', dur: 0.34, mask: 'full',
    keys: [
      { t: 0, spin: 0, pose: { chest: [0.15, -0.6, 0], shR: [-1.3, 0.3, -1.1], elbR: [-0.2, 0, 0], blade: [0.1, 0, 0], shL: [-0.3, 0, 0.9], elbL: [-0.5, 0, 0], hipL: [-0.4, 0, 0.15], kneeL: [0.6, 0, 0], hipR: [0.3, 0, -0.15], kneeR: [0.5, 0, 0], pelvis: [0.05, 0, 0] } },
      { t: 0.05, spin: 0.3, ease: 'inBack', rootOffset: [0, -0.12, 0], pose: { chest: [0.2, -0.9, 0] } },
      { t: 0.22, spin: -Math.PI * 2, ease: 'outCubic', rootOffset: [0, -0.06, 0], stretch: 1.05, pose: { chest: [0.15, -0.2, 0], shR: [-1.5, 0.1, -1.35], elbR: [0, 0, 0], blade: [-0.1, 0, 0], shL: [-0.2, 0, 1.0] } },
      { t: 0.34, spin: -Math.PI * 2, ease: 'outQuart', rootOffset: [0, 0, 0], stretch: 1, pose: { chest: [0.1, 0.1, 0], shR: [-0.8, 0.1, -0.6], elbR: [-0.4, 0, 0], blade: [0.4, 0, 0], shL: [0, 0, 0.5], hipL: [-0.2, 0, 0.1], kneeL: [0.3, 0, 0], hipR: [0.15, 0, -0.1], kneeR: [0.3, 0, 0] } },
    ],
    events: [{ t: 0.04, name: 'trailOn' }, { t: 0.06, name: 'hitOn' }, { t: 0.2, name: 'hitOff' }, { t: 0.24, name: 'trailOff' }, { t: 0.05, name: 'swing' }],
  },
  {
    // Удар 4: финишер «Нисходящий разлом» — прыжок на 0.6 м, удар в землю, присед с «пружиной»
    id: 'rift', dur: 0.48, mask: 'full',
    keys: [
      { t: 0, rootOffset: [0, 0, 0], pose: { chest: [0.1, 0, 0], spine: [0, 0, 0], shR: [-1.0, 0, -0.4], elbR: [-0.5, 0, 0], blade: [0.4, 0, 0], shL: [-0.6, 0, 0.4], elbL: [-0.6, 0, 0], hipL: [-0.3, 0, 0.1], kneeL: [0.5, 0, 0], hipR: [0.1, 0, -0.1], kneeR: [0.5, 0, 0], footL: [-0.2, 0, 0], footR: [-0.3, 0, 0] } },
      { t: 0.06, ease: 'outQuad', rootOffset: [0, -0.2, 0], pose: { chest: [0.3, 0, 0], hipL: [-0.7, 0, 0.1], kneeL: [1.3, 0, 0], hipR: [-0.5, 0, -0.1], kneeR: [1.2, 0, 0], shR: [-0.4, 0, -0.3], shL: [-0.2, 0, 0.3] } },
      { t: 0.17, ease: 'outCubic', rootOffset: [0, 0.6, 0.3], stretch: 0.92, pose: { chest: [-0.35, 0, 0], spine: [-0.15, 0, 0], shR: [-2.9, 0, -0.25], elbR: [-0.4, 0, 0], blade: [0.9, 0, 0], shL: [-2.7, 0, 0.3], elbL: [-0.6, 0, 0], hipL: [-0.9, 0, 0.1], kneeL: [1.0, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.7, 0, 0], head: [0.2, 0, 0] } },
      { t: 0.23, ease: 'inExpo', rootOffset: [0, -0.32, 0.5], stretch: 1.12, pose: { chest: [0.75, 0, 0], spine: [0.35, 0, 0], shR: [-0.75, 0, -0.1], elbR: [0, 0, 0], blade: [-0.35, 0, 0], shL: [-0.7, 0, 0.2], elbL: [-0.3, 0, 0], hipL: [-1.1, 0, 0.15], kneeL: [1.6, 0, 0], hipR: [0.4, 0, -0.15], kneeR: [1.4, 0, 0], footL: [-0.4, 0, 0], footR: [0.4, 0, 0], head: [-0.4, 0, 0] } },
      { t: 0.3, ease: 'outQuad', rootOffset: [0, -0.26, 0.5], stretch: 0.88, pose: {} },
      { t: 0.48, ease: 'outQuart', rootOffset: [0, -0.05, 0.5], stretch: 1, pose: { chest: [0.3, 0, 0], spine: [0.1, 0, 0], shR: [-0.6, 0, -0.3], elbR: [-0.3, 0, 0], blade: [0.2, 0, 0], shL: [-0.3, 0, 0.4], hipL: [-0.5, 0, 0.1], kneeL: [0.8, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.7, 0, 0], footL: [-0.3, 0, 0], footR: [0.2, 0, 0] } },
    ],
    events: [{ t: 0.12, name: 'trailOn' }, { t: 0.15, name: 'swing' }, { t: 0.23, name: 'hitOn' }, { t: 0.23, name: 'impact' }, { t: 0.3, name: 'hitOff' }, { t: 0.32, name: 'trailOff' }],
  },
  {
    // Шквал: 5 быстрых уколов
    id: 'flurry', dur: 0.55, mask: 'upper',
    keys: (() => {
      const k: ClipDef['keys'] = [{ t: 0, pose: { chest: [0.1, -0.3, 0], shR: [-1.0, 0.2, -0.3], elbR: [-1.4, 0, 0], blade: [-0.2, 0, 0], shL: [-0.3, 0, 0.5] } }];
      for (let i = 0; i < 5; i++) {
        const t0 = 0.02 + i * 0.1, side = (i % 2 ? 1 : -1) * 0.25;
        k.push({ t: t0 + 0.035, ease: 'outExpo', stretch: 1.06, pose: { chest: [0.2, -0.1 + side, 0], shR: [-1.55, 0.1, -0.15 + side * 0.6], elbR: [0, 0, 0], blade: [-0.05, 0, 0] } });
        k.push({ t: t0 + 0.09, ease: 'inOutQuad', stretch: 1, pose: { chest: [0.12, -0.3, 0], shR: [-1.1, 0.2, -0.3], elbR: [-1.3, 0, 0], blade: [-0.2, 0, 0] } });
      }
      return k;
    })(),
    events: [0, 1, 2, 3, 4].flatMap((i) => [{ t: 0.02 + i * 0.1 + 0.02, name: 'hitOn' }, { t: 0.02 + i * 0.1 + 0.05, name: 'hitOff' }, { t: 0.02 + i * 0.1, name: 'stab' }]),
  },
  {
    // Заряд: клинок поднят над головой за плечо, присед, левая рука вытянута вперёд — дрожь нарастает
    id: 'charge', dur: 0.4, mask: 'full', loop: true,
    keys: [
      { t: 0, rootOffset: [0, -0.22, 0], pose: { chest: [-0.2, -0.35, 0], spine: [-0.08, -0.15, 0], shR: [-2.75, 0.3, -0.45], elbR: [-0.75, 0, 0], blade: [1.15, 0, 0], shL: [-1.45, 0, 0.35], elbL: [-0.25, 0, 0], hipL: [-0.75, 0, 0.2], kneeL: [1.0, 0, 0], hipR: [0.35, 0, -0.2], kneeR: [0.7, 0, 0], footL: [-0.25, 0, 0], head: [0.15, 0.35, 0] } },
      { t: 0.2, rootOffset: [0, -0.24, 0], pose: { chest: [-0.22, -0.38, 0.02], shR: [-2.8, 0.32, -0.47], blade: [1.2, 0, 0] } },
      { t: 0.4, rootOffset: [0, -0.22, 0], pose: { chest: [-0.2, -0.35, 0], shR: [-2.75, 0.3, -0.45], blade: [1.15, 0, 0] } },
    ],
  },
  {
    // Рассекающий удар (заряд): из-за головы вниз с шагом вперёд, корпус «складывается», клинок врезается в пол
    id: 'cleave', dur: 0.5, mask: 'full',
    keys: [
      { t: 0, rootOffset: [0, -0.22, 0], pose: { chest: [-0.25, -0.35, 0], spine: [-0.1, -0.15, 0], shR: [-2.85, 0.3, -0.45], elbR: [-0.7, 0, 0], blade: [1.25, 0, 0], shL: [-2.6, 0, 0.3], elbL: [-0.6, 0, 0], hipL: [-0.75, 0, 0.2], kneeL: [1.0, 0, 0], hipR: [0.35, 0, -0.2], kneeR: [0.7, 0, 0], head: [0.2, 0.3, 0] } },
      { t: 0.07, ease: 'inExpo', stretch: 1.22, rootOffset: [0, -0.38, 0.35], pose: { chest: [0.85, 0.05, 0], spine: [0.35, 0, 0], shR: [-0.75, 0.05, -0.15], elbR: [0, 0, 0], blade: [-0.45, 0, 0], shL: [-0.8, 0, 0.15], elbL: [-0.2, 0, 0], hipL: [-1.25, 0, 0.15], kneeL: [1.5, 0, 0], hipR: [0.55, 0, -0.15], kneeR: [1.1, 0, 0], footL: [-0.3, 0, 0], footR: [0.45, 0, 0], head: [-0.45, 0, 0] } },
      { t: 0.14, ease: 'outQuad', stretch: 0.88, rootOffset: [0, -0.34, 0.35], pose: {} },
      { t: 0.5, ease: 'outQuart', stretch: 1, rootOffset: [0, -0.04, 0], pose: { chest: [0.25, 0.1, 0], spine: [0.08, 0, 0], shR: [-0.6, 0, -0.3], elbR: [-0.35, 0, 0], blade: [0.25, 0, 0], shL: [-0.3, 0, 0.4], hipL: [-0.45, 0, 0.1], kneeL: [0.7, 0, 0], hipR: [0.25, 0, -0.1], kneeR: [0.5, 0, 0], footL: [-0.2, 0, 0], footR: [0.2, 0, 0] } },
    ],
    events: [{ t: 0.0, name: 'trailOn' }, { t: 0.05, name: 'hitOn' }, { t: 0.07, name: 'impact' }, { t: 0.12, name: 'hitOff' }, { t: 0.18, name: 'trailOff' }],
  },
  {
    // Восходящий месяц: низкая стойка → апперкот снизу справа вверх влево с подскоком
    id: 'rising', dur: 0.4, mask: 'full',
    keys: [
      { t: 0, rootOffset: [0, -0.16, 0], pose: { chest: [0.35, -0.6, 0], spine: [0.15, -0.25, 0], shR: [0.35, 0.2, -0.55], elbR: [-0.35, 0, 0], blade: [0.7, 0, 0], shL: [-0.5, 0, 0.6], elbL: [-0.6, 0, 0], hipL: [-0.8, 0, 0.15], kneeL: [1.1, 0, 0], hipR: [0.3, 0, -0.15], kneeR: [0.8, 0, 0] } },
      { t: 0.05, ease: 'inBack', rootOffset: [0, -0.24, 0], pose: { chest: [0.45, -0.8, 0], shR: [0.5, 0.25, -0.6], blade: [0.85, 0, 0], kneeL: [1.3, 0, 0], kneeR: [1.0, 0, 0] } },
      { t: 0.12, ease: 'outExpo', stretch: 1.14, rootOffset: [0, 0.38, 0.2], pose: { chest: [-0.35, 0.65, 0.1], spine: [-0.15, 0.3, 0], shR: [-2.9, -0.2, 0.25], elbR: [0, 0, 0], blade: [-0.25, 0, 0], shL: [0.4, 0, 0.7], elbL: [-0.3, 0, 0], hipL: [-0.2, 0, 0.1], kneeL: [0.2, 0, 0], hipR: [0.3, 0, -0.1], kneeR: [0.5, 0, 0], footL: [0.4, 0, 0], footR: [0.4, 0, 0], head: [0.35, -0.3, 0] } },
      { t: 0.22, ease: 'outQuad', stretch: 1, rootOffset: [0, 0.3, 0.2], pose: {} },
      { t: 0.4, ease: 'outQuart', rootOffset: [0, 0, 0], pose: { chest: [0.05, 0.3, 0], spine: [0, 0.1, 0], shR: [-1.6, 0, 0.1], elbR: [-0.4, 0, 0], blade: [0.2, 0, 0], shL: [0, 0, 0.4], hipL: [-0.3, 0, 0.1], kneeL: [0.4, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.4, 0, 0] } },
    ],
    events: [{ t: 0.05, name: 'trailOn' }, { t: 0.08, name: 'hitOn' }, { t: 0.16, name: 'hitOff' }, { t: 0.22, name: 'trailOff' }],
  },
  {
    // Крест: два стремительных диагональных разреза крест-накрест
    id: 'cross', dur: 0.42, mask: 'full',
    keys: [
      { t: 0, pose: { chest: [-0.15, -0.45, 0], spine: [-0.05, -0.2, 0], shR: [-2.65, 0.25, -0.6], elbR: [-0.3, 0, 0], blade: [0.35, 0, 0], shL: [-0.4, 0, 0.6], hipL: [-0.5, 0, 0.15], kneeL: [0.7, 0, 0], hipR: [0.25, 0, -0.15], kneeR: [0.5, 0, 0] } },
      { t: 0.06, ease: 'outExpo', stretch: 1.08, rootOffset: [0, -0.08, 0.15], pose: { chest: [0.35, 0.6, 0], spine: [0.15, 0.25, 0], shR: [-0.55, -0.35, 0.65], elbR: [0, 0, 0], blade: [-0.15, 0, 0], shL: [0.3, 0, 0.5] } },
      { t: 0.13, ease: 'inBack', stretch: 1, rootOffset: [0, -0.04, 0.15], pose: { chest: [-0.15, 0.5, 0], spine: [-0.05, 0.2, 0], shR: [-2.65, -0.45, 0.55], elbR: [-0.3, 0, 0], blade: [0.35, 0, 0] } },
      { t: 0.19, ease: 'outExpo', stretch: 1.1, rootOffset: [0, -0.12, 0.3], pose: { chest: [0.4, -0.65, 0], spine: [0.18, -0.25, 0], shR: [-0.55, 0.45, -0.95], elbR: [0, 0, 0], blade: [-0.15, 0, 0], shL: [-0.5, 0, 0.3], hipL: [-0.8, 0, 0.15], kneeL: [1.0, 0, 0], hipR: [0.4, 0, -0.15], kneeR: [0.7, 0, 0] } },
      { t: 0.42, ease: 'outQuart', stretch: 1, rootOffset: [0, 0, 0], pose: { chest: [0.15, -0.3, 0], spine: [0.05, -0.1, 0], shR: [-0.9, 0.2, -0.6], elbR: [-0.3, 0, 0], blade: [0.25, 0, 0], shL: [-0.2, 0, 0.4], hipL: [-0.4, 0, 0.1], kneeL: [0.5, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.4, 0, 0] } },
    ],
    events: [{ t: 0.0, name: 'trailOn' }, { t: 0.03, name: 'hitOn' }, { t: 0.08, name: 'hitOff' }, { t: 0.15, name: 'swing2' }, { t: 0.17, name: 'hitOn' }, { t: 0.2, name: 'impact' }, { t: 0.24, name: 'hitOff' }, { t: 0.27, name: 'trailOff' }],
  },
  {
    // Контрудар: из рывка — разворот на 360° с вытянутой рукой, плащ веером
    id: 'counter', dur: 0.38, mask: 'full',
    keys: [
      { t: 0, spin: 0, rootOffset: [0, -0.2, 0], pose: { chest: [0.45, -0.7, 0], spine: [0.2, -0.3, 0], shR: [0.2, 0.2, -0.9], elbR: [-0.3, 0, 0], blade: [0.5, 0, 0], shL: [-0.6, 0, 0.8], hipL: [-0.9, 0, 0.2], kneeL: [1.2, 0, 0], hipR: [0.4, 0, -0.2], kneeR: [0.9, 0, 0] } },
      { t: 0.18, spin: -Math.PI * 2, ease: 'outCubic', stretch: 1.1, rootOffset: [0, -0.1, 0], pose: { chest: [0.2, 0.3, 0], spine: [0.1, 0.1, 0], shR: [-1.55, 0, -1.45], elbR: [0, 0, 0], blade: [-0.15, 0, 0], shL: [-0.3, 0, 1.1], hipL: [-0.6, 0, 0.2], kneeL: [0.8, 0, 0], hipR: [0.3, 0, -0.2], kneeR: [0.6, 0, 0] } },
      { t: 0.38, spin: -Math.PI * 2, ease: 'outQuart', stretch: 1, rootOffset: [0, 0, 0], pose: { chest: [0.15, 0.1, 0], shR: [-0.9, 0.1, -0.6], elbR: [-0.4, 0, 0], blade: [0.35, 0, 0], shL: [0, 0, 0.5], hipL: [-0.3, 0, 0.1], kneeL: [0.4, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.4, 0, 0] } },
    ],
    events: [{ t: 0.02, name: 'trailOn' }, { t: 0.04, name: 'hitOn' }, { t: 0.18, name: 'hitOff' }, { t: 0.22, name: 'trailOff' }],
  },
  {
    // Заряженный удар: выпад через линию с растяжением ×1.5
    id: 'charged', dur: 0.36, mask: 'full',
    keys: [
      { t: 0, rootOffset: [0, -0.18, 0], pose: { chest: [0.3, -0.9, 0], spine: [0.15, -0.3, 0], shR: [0.6, 0, -0.9], elbR: [-0.3, 0, 0], blade: [0.3, 0, 0], shL: [-1.3, 0, 0.6], elbL: [-0.3, 0, 0], hipL: [-0.7, 0, 0.2], kneeL: [0.9, 0, 0], hipR: [0.35, 0, -0.2], kneeR: [0.6, 0, 0], head: [0, 0.8, 0] } },
      { t: 0.05, ease: 'outExpo', stretch: 1.5, rootOffset: [0, -0.25, 0.8], pose: { chest: [0.45, 0.9, 0], spine: [0.2, 0.4, 0], shR: [-1.5, -0.2, 0.7], elbR: [0, 0, 0], blade: [-0.1, 0, 0], shL: [0.6, 0, 0.6], hipL: [-1.0, 0, 0.2], kneeL: [0.8, 0, 0], hipR: [0.9, 0, -0.2], kneeR: [0.3, 0, 0], head: [-0.2, -0.5, 0] } },
      { t: 0.12, ease: 'outQuad', stretch: 1.0, rootOffset: [0, -0.2, 0.8], pose: {} },
      { t: 0.36, ease: 'outQuart', rootOffset: [0, 0, 0.8], pose: { chest: [0.15, 0.5, 0], spine: [0.05, 0.2, 0], shR: [-1.0, 0, 0.3], elbR: [-0.4, 0, 0], blade: [0.2, 0, 0], shL: [0.2, 0, 0.4], hipL: [-0.4, 0, 0.1], kneeL: [0.4, 0, 0], hipR: [0.3, 0, -0.1], kneeR: [0.2, 0, 0], head: [0, -0.2, 0] } },
    ],
    events: [{ t: 0.0, name: 'trailOn' }, { t: 0.02, name: 'hitOn' }, { t: 0.08, name: 'hitOff' }, { t: 0.16, name: 'trailOff' }],
  },
  {
    // Рывок: тело вытягивается, руки и клинок назад
    id: 'dash', dur: 0.18, mask: 'full',
    keys: [
      { t: 0, pose: { chest: [0.55, 0, 0], spine: [0.25, 0, 0], shR: [0.9, 0, -0.35], elbR: [-0.2, 0, 0], blade: [0.9, 0, 0], shL: [0.9, 0, 0.35], elbL: [-0.2, 0, 0], hipL: [-0.6, 0, 0], kneeL: [0.9, 0, 0], hipR: [0.5, 0, 0], kneeR: [0.6, 0, 0], head: [-0.5, 0, 0] } },
      { t: 0.18, pose: { chest: [0.45, 0, 0], spine: [0.2, 0, 0], shR: [0.7, 0, -0.3], shL: [0.7, 0, 0.3], hipL: [-0.4, 0, 0], kneeL: [0.6, 0, 0], hipR: [0.3, 0, 0], kneeR: [0.5, 0, 0] } },
    ],
  },
  {
    // Рассечение: выпад-укол после рывка, пробивает насквозь
    id: 'lunge', dur: 0.3, mask: 'full',
    keys: [
      { t: 0, pose: { chest: [0.4, 0.3, 0], shR: [0.4, 0, -0.4], elbR: [-1.2, 0, 0], blade: [-0.3, 0, 0], shL: [0.4, 0, 0.4], hipL: [-0.6, 0, 0], kneeL: [0.9, 0, 0], hipR: [0.4, 0, 0], kneeR: [0.5, 0, 0] } },
      { t: 0.05, ease: 'outExpo', stretch: 1.3, pose: { chest: [0.55, -0.3, 0], spine: [0.25, -0.1, 0], shR: [-1.6, 0.1, 0.05], elbR: [0, 0, 0], blade: [0, 0, 0], shL: [0.8, 0, 0.5], hipL: [-1.1, 0, 0], kneeL: [0.6, 0, 0], hipR: [0.8, 0, 0], kneeR: [0.2, 0, 0], head: [-0.4, 0.2, 0] } },
      { t: 0.14, ease: 'outQuad', stretch: 1.0, pose: {} },
      { t: 0.3, ease: 'outQuart', pose: { chest: [0.2, 0, 0], spine: [0.05, 0, 0], shR: [-0.8, 0, -0.3], elbR: [-0.4, 0, 0], blade: [0.3, 0, 0], shL: [0, 0, 0.4], hipL: [-0.3, 0, 0], kneeL: [0.4, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.2, 0, 0], head: [0, 0, 0] } },
    ],
    events: [{ t: 0.0, name: 'trailOn' }, { t: 0.02, name: 'hitOn' }, { t: 0.1, name: 'hitOff' }, { t: 0.14, name: 'trailOff' }, { t: 0.0, name: 'swing' }],
  },
  {
    // Каст левой рукой (Серп Луны, Колодец): взмах вперёд
    id: 'cast', dur: 0.3, mask: 'upper',
    keys: [
      { t: 0, pose: { chest: [0.1, 0.4, 0], shL: [0.3, 0, 0.7], elbL: [-1.4, 0, 0], shR: [0.4, 0, -0.4], elbR: [-0.5, 0, 0], blade: [1.0, 0, 0] } },
      { t: 0.06, ease: 'inBack', pose: { chest: [0.1, 0.7, 0], shL: [0.6, 0, 1.2], elbL: [-1.6, 0, 0] } },
      { t: 0.11, ease: 'outExpo', pose: { chest: [0.2, -0.5, 0], shL: [-1.6, 0, 0.1], elbL: [-0.05, 0, 0], head: [0, -0.2, 0] } },
      { t: 0.3, ease: 'outQuart', pose: { chest: [0.1, -0.2, 0], shL: [-0.8, 0, 0.3], elbL: [-0.6, 0, 0] } },
    ],
    events: [{ t: 0.1, name: 'release' }],
  },
  {
    // Каст двумя руками (ульта, Колодец): руки вверх → удар вниз
    id: 'castBig', dur: 0.5, mask: 'full',
    keys: [
      { t: 0, pose: { chest: [0, 0, 0], shL: [-0.5, 0, 0.6], shR: [-0.5, 0, -0.6], elbL: [-0.5, 0, 0], elbR: [-0.5, 0, 0], blade: [0.5, 0, 0] } },
      { t: 0.18, ease: 'outCubic', rootOffset: [0, 0.15, 0], pose: { chest: [-0.4, 0, 0], spine: [-0.1, 0, 0], shL: [-2.8, 0, 0.5], shR: [-2.8, 0, -0.5], elbL: [-0.2, 0, 0], elbR: [-0.2, 0, 0], blade: [0, 0, 0], head: [0.3, 0, 0], hipL: [0.1, 0, 0.1], hipR: [0.1, 0, -0.1] } },
      { t: 0.28, ease: 'inExpo', rootOffset: [0, -0.25, 0], stretch: 1.1, pose: { chest: [0.6, 0, 0], spine: [0.2, 0, 0], shL: [-0.6, 0, 0.9], shR: [-0.6, 0, -0.9], blade: [-0.2, 0, 0], head: [-0.3, 0, 0], hipL: [-0.8, 0, 0.2], kneeL: [1.2, 0, 0], hipR: [-0.6, 0, -0.2], kneeR: [1.1, 0, 0] } },
      { t: 0.5, ease: 'outQuart', rootOffset: [0, -0.05, 0], stretch: 1, pose: { chest: [0.2, 0, 0], spine: [0.05, 0, 0], shL: [-0.3, 0, 0.5], shR: [-0.4, 0, -0.5], hipL: [-0.3, 0, 0.1], kneeL: [0.4, 0, 0], hipR: [-0.2, 0, -0.1], kneeR: [0.4, 0, 0] } },
    ],
    events: [{ t: 0.28, name: 'release' }],
  },
  {
    // «Небесный разрез»: прыжок к подброшенному врагу, разрез справа налево и обратный — в воздухе (план §6.5)
    id: 'skycut', dur: 0.46, mask: 'full',
    keys: [
      { t: 0, rootOffset: [0, -0.15, 0], pose: { chest: [0.3, -0.4, 0], shR: [-1.0, 0.3, -0.7], elbR: [-0.5, 0, 0], blade: [0.4, 0, 0], shL: [-0.4, 0, 0.5], hipL: [-0.8, 0, 0.1], kneeL: [1.2, 0, 0], hipR: [-0.6, 0, -0.1], kneeR: [1.1, 0, 0] } },
      { t: 0.1, ease: 'outCubic', rootOffset: [0, 1.3, 0.4], stretch: 1.1, pose: { chest: [-0.1, -0.85, 0.05], shR: [-1.35, 0.4, -1.05], elbR: [-0.55, 0, 0], blade: [0.5, 0, 0], hipL: [-1.3, 0, 0.1], kneeL: [1.7, 0, 0], hipR: [-0.4, 0, -0.1], kneeR: [1.5, 0, 0] } },
      { t: 0.16, ease: 'outExpo', rootOffset: [0, 1.45, 0.5], stretch: 1.08, pose: { chest: [0.1, 0.85, -0.05], shR: [-1.5, -0.1, 0.55], elbR: [-0.05, 0, 0], blade: [-0.1, 0, 0], shL: [0.3, 0, 0.6] } },
      { t: 0.24, ease: 'inBack', rootOffset: [0, 1.4, 0.5], stretch: 1, pose: { chest: [0.1, 0.95, 0.05], shR: [-1.3, -0.2, 0.75], elbR: [-0.9, 0, 0], blade: [0.3, 0, 0] } },
      { t: 0.3, ease: 'outExpo', rootOffset: [0, 1.25, 0.5], spin: Math.PI * 0.25, stretch: 1.08, pose: { chest: [0.15, -0.9, -0.05], shR: [-1.45, 0.5, -1.15], elbR: [-0.05, 0, 0], blade: [-0.15, 0, 0], shL: [-0.5, 0, 0.3] } },
      { t: 0.46, ease: 'inQuad', rootOffset: [0, 0, 0.5], spin: 0, stretch: 1, pose: { chest: [0.2, -0.3, 0], shR: [-1.0, 0.3, -0.6], elbR: [-0.3, 0, 0], blade: [0.2, 0, 0], shL: [-0.2, 0, 0.4], hipL: [-0.5, 0, 0.1], kneeL: [0.8, 0, 0], hipR: [0.2, 0, -0.1], kneeR: [0.6, 0, 0] } },
    ],
    events: [{ t: 0.08, name: 'trailOn' }, { t: 0.12, name: 'hitOn' }, { t: 0.18, name: 'hitOff' }, { t: 0.26, name: 'hitOn' }, { t: 0.32, name: 'hitOff' }, { t: 0.36, name: 'trailOff' }],
  },
  {
    // «Звездопад»: взлёт с переворотом и пронзающий удар сверху вниз (финишер ветки рывка)
    id: 'skyfall', dur: 0.62, mask: 'full',
    keys: [
      { t: 0, rootOffset: [0, 0, 0], pose: { chest: [0.2, 0, 0], shR: [-0.6, 0, -0.4], blade: [0.4, 0, 0], hipL: [-0.3, 0, 0], kneeL: [0.5, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.4, 0, 0] } },
      { t: 0.08, ease: 'outQuad', rootOffset: [0, -0.25, 0], pose: { chest: [0.5, 0, 0], hipL: [-0.9, 0, 0.1], kneeL: [1.5, 0, 0], hipR: [-0.8, 0, -0.1], kneeR: [1.4, 0, 0], shR: [0.6, 0, -0.5], shL: [0.6, 0, 0.5] } },
      { t: 0.23, ease: 'outCubic', rootOffset: [0, 1.7, 0.2], spin: -Math.PI, pose: { chest: [-0.3, 0, 0], spine: [-0.2, 0, 0], shR: [-3.0, 0, -0.1], elbR: [-0.2, 0, 0], blade: [0.2, 0, 0], shL: [-3.0, 0, 0.1], elbL: [-0.3, 0, 0], hipL: [-1.2, 0, 0], kneeL: [1.6, 0, 0], hipR: [-0.2, 0, 0], kneeR: [1.5, 0, 0] } },
      { t: 0.34, ease: 'inExpo', rootOffset: [0, 0.15, 0.3], spin: -Math.PI * 2, stretch: 1.25, pose: { chest: [0.9, 0, 0], spine: [0.3, 0, 0], shR: [-0.4, 0, -0.05], elbR: [0, 0, 0], blade: [-0.6, 0, 0], shL: [-0.4, 0, 0.05], hipL: [-1.3, 0, 0], kneeL: [1.8, 0, 0], hipR: [0.5, 0, 0], kneeR: [1.6, 0, 0] } },
      { t: 0.41, ease: 'outQuad', rootOffset: [0, -0.2, 0.3], spin: -Math.PI * 2, stretch: 0.88, pose: {} },
      { t: 0.62, ease: 'outQuart', rootOffset: [0, 0, 0], spin: -Math.PI * 2, stretch: 1, pose: { chest: [0.25, 0, 0], spine: [0.05, 0, 0], shR: [-0.4, 0, -0.4], elbR: [-0.4, 0, 0], blade: [0.6, 0, 0], shL: [-0.2, 0, 0.4], hipL: [-0.3, 0, 0], kneeL: [0.5, 0, 0], hipR: [0.2, 0, 0], kneeR: [0.4, 0, 0] } },
    ],
    events: [{ t: 0.2, name: 'trailOn' }, { t: 0.22, name: 'swing2' }, { t: 0.33, name: 'hitOn' }, { t: 0.34, name: 'impact' }, { t: 0.4, name: 'hitOff' }, { t: 0.44, name: 'trailOff' }],
  },
  {
    // Победа: взмах клинком за спину, плащ взлетает
    id: 'victory', dur: 1.0, mask: 'full',
    keys: [
      { t: 0, pose: {} },
      { t: 0.25, ease: 'outCubic', pose: { chest: [-0.1, 0.6, 0], shR: [-1.6, 0, -1.2], elbR: [0, 0, 0], blade: [0, 0, 0] } },
      { t: 0.5, ease: 'outExpo', pose: { chest: [-0.05, -0.2, 0], shR: [0.2, 1.2, -1.4], elbR: [-1.6, 0, 0], blade: [0.3, 0, 0], shL: [0, 0, 0.3], head: [0.15, 0, 0] } },
      { t: 1.0, ease: 'outQuart', pose: { chest: [-0.08, -0.1, 0], shR: [0.25, 1.1, -1.3], elbR: [-1.7, 0, 0], blade: [0.3, 0, 0], shL: [0.05, 0, 0.25], head: [0.12, 0, 0] } },
    ],
  },
];

/** Вариант клипа: те же события, правка ключей. */
function variant(id: string, newId: string, edit: (k: Key) => Key): ClipDef {
  const base = HERO_CLIPS.find((c) => c.id === id)!;
  return { ...base, id: newId, keys: base.keys.map((k) => edit({ ...k })) };
}

/** Финишеры ранга S (план §6.6): Нисходящий разлом с разворотом в прыжке, Крест с прыжком. */
const RIFT_SPIN: Record<number, number> = { 0: 0, 0.06: 0, 0.17: -Math.PI, 0.23: -Math.PI * 2 };
const CROSS_JUMP: Record<number, number> = { 0: 0, 0.06: 0.4, 0.13: 0.95, 0.19: 0.05, 0.42: 0 };
HERO_CLIPS.push(
  variant('rift', 'riftS', (k) => ({ ...k, spin: RIFT_SPIN[k.t] ?? -Math.PI * 2 })),
  variant('cross', 'crossS', (k) => {
    const r = k.rootOffset ?? [0, 0, 0];
    return { ...k, rootOffset: [r[0], r[1] + (CROSS_JUMP[k.t] ?? 0), r[2]] };
  }),
);

/** На ранге S финишеры берут альтернативный клип. */
export const RANK_S_CLIPS: Record<string, string> = { rift: 'riftS', cross: 'crossS' };
