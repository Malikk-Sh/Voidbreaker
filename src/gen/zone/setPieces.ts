import * as THREE from 'three';
import { hexToLinear } from '../../core/math';
import { Rng } from '../../core/rng';
import { G } from '../../render/materials';
import { GeomBuilder, mat } from '../geom/build';
import { GOLD, OBS, OBS_DEEP, OBS_HI } from '../geom/kit';
import { bipyramid, box, jitter, lathe, octa, prism, shard } from '../geom/prims';

/**
 * Свои события арен (план §8.5): обломки «Инея» над 1-1, ворота-гигант и силуэт Стража за ними на 1-3,
 * огромный колокол над колокольней 1-6. Статичная геометрия — двигает её бой.
 */
const STEEL = hexToLinear('#5a6372'), STEEL_HI = hexToLinear('#8a93a3'), PANEL = hexToLinear('#20252e');

/** Обломки «Инея» в небе 1-1 (высоко над фасадом — их видно из интро): рваные куски корпуса и крыла с тлеющими швами. */
export function buildWreck(seed = 81): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = new GeomBuilder(); b.rng = rng;
  for (let i = 0; i < 9; i++) {
    const x = rng.spread(45) + 8, y = rng.range(42, 92), z = -rng.range(40, 105);
    const s = rng.range(1.5, 4.5);
    const g = new GeomBuilder(); g.rng = new Rng(rng.int(0, 1e6)); g.color = STEEL;
    if (i % 3 === 0) {
      // кусок корпуса: полукольцо обшивки с рёбрами
      g.add(lathe([[0.9, -1], [1.05, 0], [0.95, 1]], 7, 0), { matrix: mat(0, 0, 0, 0, 0, 0, 1, 1, 1) });
      for (const z2 of [-0.6, 0.2]) g.add(prism(7, 1.06, 1.06, 0.12, true), { matrix: mat(0, z2, 0), color: PANEL });
    } else if (i % 3 === 1) {
      // крыло: плита с огнём на кромке
      g.add(box(3, 0.12, 1.2), { matrix: mat(0, 0, 0, 0.1, 0, 0.2) });
      g.add(box(3, 0.08, 0.08), { matrix: mat(0, 0.06, 0.6, 0.1, 0, 0.2), emissive: 1.6, color: STEEL_HI });
    } else {
      g.add(shard(2.2, 0.5, 4, 0.4, i), { color: PANEL });
      g.add(box(0.06, 1.6, 0.06), { matrix: mat(0.2, 0.2, 0.1, 0.3, 0, 0.1), emissive: 1.4, color: STEEL_HI });
    }
    b.append(g, mat(x, y, z, rng.next() * 6, rng.next() * 6, rng.next() * 6, s, s, s));
  }
  return b.build();
}

/** Ворота-гигант (40 м) на фоне 1-3: стрельчатая арка, решётка, контрфорсы. Центр основания — в нуле. */
export function buildGiantGate(seed = 83): THREE.BufferGeometry {
  const b = new GeomBuilder(); b.rng = new Rng(seed); b.color = OBS;
  const W = 14, H = 30;
  const shape = new THREE.Shape();
  shape.moveTo(-W - 4, 0); shape.lineTo(W + 4, 0); shape.lineTo(W + 4, H); shape.lineTo(0, H + 12); shape.lineTo(-W - 4, H); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-W, 0); hole.lineTo(-W, 20); hole.quadraticCurveTo(-W * 0.9, 31, 0, 35); hole.quadraticCurveTo(W * 0.9, 31, W, 20); hole.lineTo(W, 0); hole.closePath();
  shape.holes.push(hole);
  b.add(new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }), { matrix: mat(0, 0, -1.5) });
  // золотая окантовка проёма и карниз: на тёмном небе ворота читаются силуэтом
  b.add(box(0.4, 20, 0.4), { matrix: mat(-W, 10, 1.6), color: GOLD });
  b.add(box(0.4, 20, 0.4), { matrix: mat(W, 10, 1.6), color: GOLD });
  for (let k = 0; k < 12; k++) {
    const t0 = k / 12, t1 = (k + 1) / 12;
    const q = (t: number, s: number): [number, number] => {
      const x0 = s * W, y0 = 20, cxq = s * W * 0.9, cyq = 31, x1 = 0, y1 = 35, u = 1 - t;
      return [u * u * x0 + 2 * u * t * cxq + t * t * x1, u * u * y0 + 2 * u * t * cyq + t * t * y1];
    };
    for (const sd of [-1, 1]) {
      const [ax, ay] = q(t0, sd), [bx, by] = q(t1, sd);
      const len = Math.hypot(bx - ax, by - ay);
      b.add(box(0.4, len + 0.1, 0.4), { matrix: mat((ax + bx) / 2, (ay + by) / 2, 1.6, 0, 0, Math.atan2(-(bx - ax), by - ay)), color: GOLD });
    }
  }
  // карниз — по обе стороны от арки (проём на этой высоте шире 0.8 W)
  for (const sd of [-1, 1]) b.add(box(5.2, 0.6, 0.5), { matrix: mat(sd * (W + 1.4), H, 1.6), color: GOLD });
  // решётка: прутья и перекладины, внизу — зубья
  for (let x = -W + 1.4; x < W; x += 2.2) b.add(box(0.35, 32, 0.35), { matrix: mat(x, 16, 0), color: OBS_DEEP });
  for (let y = 3; y < 30; y += 3.6) b.add(box(W * 2, 0.3, 0.3), { matrix: mat(0, y, 0), color: OBS_DEEP });
  // контрфорсы и шпили
  for (const s of [-1, 1]) {
    b.add(box(4, 40, 5), { matrix: mat(s * (W + 6), 20, 0) });
    b.add(prism(4, 2.6, 0, 12), { matrix: mat(s * (W + 6), 40, 0, 0, Math.PI / 4) });
  }
  // руна-замок в навершии — тлеет багровым (это вход Стража)
  b.add(octa(1.3, 2, 0.6), { matrix: mat(0, H + 7, 1.6), emissive: -1.6, color: OBS_DEEP });
  return b.build();
}

/** Силуэт Стража Врат за решёткой (до его появления): тёмная громада с алебардой и двумя углями глаз. ~14 м. */
export function buildGuardianSilhouette(): THREE.BufferGeometry {
  const b = new GeomBuilder(); b.rng = new Rng(85); b.color = OBS_DEEP;
  b.add(box(2.6, 6, 2.2), { matrix: mat(-1.5, 3, 0, 0, 0, 0.04) });
  b.add(box(2.6, 6, 2.2), { matrix: mat(1.5, 3, 0, 0, 0, -0.04) });
  b.add(box(6.5, 5.5, 3.6), { matrix: mat(0, 8.6, 0) });
  b.add(bipyramid(4, 4.2, 1.6, 0.4), { matrix: mat(0, 11.4, 0, 0, Math.PI / 4, 0) });
  b.add(box(2.2, 2.2, 2.2), { matrix: mat(0, 12.6, 0) });
  for (const s of [-1, 1]) b.add(shard(1.8, 0.35, 4, 0.2, s + 2), { matrix: mat(s * 1.2, 13.6, 0, 0, 0, -s * 0.5) });
  for (const s of [-1, 1]) b.add(box(1.6, 5, 1.6), { matrix: mat(s * 4.2, 7.6, 0, 0, 0, s * 0.15) });
  // алебарда в правой руке
  b.add(box(0.35, 17, 0.35), { matrix: mat(-5, 8.5, 0.4) });
  b.add(shard(3.2, 0.9, 4, 0.25, 7), { matrix: mat(-5, 17.4, 0.4) });
  // угли глаз
  for (const s of [-1, 1]) b.add(octa(0.2, 0.12, 0.1), { matrix: mat(s * 0.5, 12.8, 1.12), emissive: -2.4, color: OBS_DEEP });
  return b.build();
}

/** Огромный колокол над колокольней 1-6 (≈7 м) с ярмом вдоль z: подвешен за верх, качается вокруг оси ярма. */
export function buildGiantBell(): THREE.BufferGeometry {
  const b = new GeomBuilder(); b.rng = new Rng(87); b.color = hexToLinear('#3a2c18');
  // профиль снизу вверх: раструб у пола, корона у ярма
  const bell = lathe([[0.1, 0], [3.4, 0.4], [3.0, 1.6], [2.1, 4.2], [1.95, 5.8], [1.0, 6.6], [0.0, 6.8]], 18);
  b.add(bell, { matrix: mat(0, -7.4, 0) });
  // обод и пояса — тлеющая бронза
  b.add(new THREE.TorusGeometry(3.3, 0.12, 4, 32), { matrix: mat(0, -6.9, 0, Math.PI / 2, 0, 0), emissive: 1.0 });
  b.add(new THREE.TorusGeometry(2.05, 0.08, 4, 28), { matrix: mat(0, -2.6, 0, Math.PI / 2, 0, 0), emissive: 0.8 });
  // язык
  b.add(box(0.2, 4.5, 0.2), { matrix: mat(0, -3.6, 0), color: OBS });
  b.add(octa(0.6, 0.8, 0.6), { matrix: mat(0, -6.2, 0), color: OBS });
  // ярмо
  b.add(box(1.0, 0.8, 9), { matrix: mat(0, 0.6, 0), color: OBS });
  b.add(box(1.4, 1.2, 1.4), { matrix: mat(0, 0, 0), color: OBS });
  return b.build();
}

/**
 * Обсидиановая «молящаяся» фигура (план §8.6): на коленях, голова склонена, руки сложены перед собой. ≈1.05 м,
 * лицом к +z. Рассыпается от ударной волны (game/arenaEvents).
 */
export function buildPrayingFigure(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = new GeomBuilder(); b.rng = rng; b.color = OBS;
  b.add(lathe([[0.4, 0], [0.38, 0.14], [0.3, 0.38], [0.0, 0.46]], 7, rng.next()), { matrix: mat(0, 0, -0.05) });
  const lean = rng.range(0.25, 0.5);
  b.add(box(0.34, 0.5, 0.22), { matrix: mat(0, 0.62, 0.04, lean, 0, 0) });
  b.add(lathe([[0.15, 0], [0.16, 0.12], [0.1, 0.24], [0.0, 0.3]], 6), { matrix: mat(0, 0.86, 0.04 + Math.sin(lean) * 0.32, lean + 0.25, 0, 0) });
  for (const s of [-1, 1]) b.add(box(0.07, 0.3, 0.07), { matrix: mat(s * 0.09, 0.78, 0.2, -1.0 + lean * 0.5, 0, -s * 0.25) });
  b.add(octa(0.06, 0.08, 0.05), { matrix: mat(0, 0.88, 0.33) });
  return b.build();
}

/** Фреска (план §8.6): kind 0 — люди молятся звезде; 1 — звезда с багровой пастью, люди пали ниц. 4:3. */
export function frescoMaterial(kind: 0 | 1, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uNoise: G.uNoise, uTime: G.uTime, uKind: { value: kind }, uSeed: { value: seed } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform float uKind, uSeed, uTime; varying vec2 vUv;
      float n2(vec2 p) { return texture2D(uNoise, p).r; }
      float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
      mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
      // коленопреклонённый силуэт лицом к +x; начало — у колен на земле
      float figure(vec2 p, float s, float lean) {
        p /= s;
        float d = sdBox(p - vec2(0.0, 0.17), vec2(0.27, 0.17));
        vec2 q = rot(-lean) * (p - vec2(0.02, 0.36)); d = min(d, sdBox(q - vec2(0.0, 0.24), vec2(0.12, 0.26)));
        vec2 hp = vec2(0.02, 0.36) + rot(lean) * vec2(0.0, 0.62);
        d = min(d, length(p - hp) - 0.12);
        vec2 a = rot(-0.9 - lean * 0.6) * (p - (vec2(0.02, 0.36) + rot(lean) * vec2(0.08, 0.42)));
        d = min(d, sdBox(a - vec2(0.0, 0.16), vec2(0.045, 0.17)));
        return d * s;
      }
      void main() {
        vec2 uv = vUv, p = (uv - 0.5) * vec2(1.333, 1.0);
        vec3 gold = vec3(0.5, 0.38, 0.16);
        vec3 col = mix(vec3(0.07, 0.052, 0.038), vec3(0.13, 0.098, 0.068), n2(uv * vec2(2.0, 1.5) + uSeed));
        // звезда в нимбе с лучами
        vec2 sp = p - vec2(0.0, 0.17);
        float r = length(sp), ang = atan(sp.y, sp.x);
        col += gold * exp(-r * r * 10.0) * 0.32;
        col += gold * smoothstep(0.55, 1.0, cos(ang * 14.0)) * smoothstep(0.5, 0.12, r) * 0.18 * (1.0 - uKind * 0.5);
        float star = r - 0.13 * (0.55 + 0.45 * (0.5 + 0.5 * cos(ang * 7.0 + 1.5708)));
        col = mix(col, gold * 1.3, smoothstep(0.006, -0.004, star));
        if (uKind > 0.5) {
          // багровая пасть в сердце звезды: зубы по кругу, глотка темнеет к центру
          float mouth = smoothstep(0.092, 0.084, r);
          float tooth = step(abs(fract(ang * 11.0 / 6.2832) - 0.5) * 2.0, (r - 0.05) / 0.035) * step(0.05, r);
          vec3 maw = mix(vec3(0.42, 0.03, 0.05), vec3(0.05, 0.0, 0.01), smoothstep(0.08, 0.0, r)) * (0.85 + 0.15 * sin(uTime * 1.3));
          col = mix(col, maw, mouth);
          col = mix(col, vec3(0.55, 0.5, 0.42), tooth * mouth);
          // потёки вниз из пасти
          float cx = p.x * 7.0 + 0.5;
          float on = step(0.55, n2(vec2(floor(cx) * 0.173, uSeed * 0.31)));
          float len = 0.12 + 0.25 * n2(vec2(floor(cx) * 0.29, 0.7 + uSeed));
          float drip = on * smoothstep(0.12, 0.0, abs(fract(cx) - 0.5)) * step(abs(p.x), 0.22) * step(0.1 - len, p.y) * step(p.y, 0.08);
          col = mix(col, vec3(0.3, 0.01, 0.03), drip * 0.8);
        }
        // люди по обе стороны — к звезде; у пасти — пали ниц
        float lean = mix(0.35, 1.15, uKind);
        float d = 1e3;
        for (int i = 0; i < 3; i++) {
          float fi = float(i), x0 = 0.24 + fi * 0.15, s = 0.2 - fi * 0.025;
          d = min(d, figure(vec2(p.x + x0, p.y + 0.43), s, lean + fi * 0.05));
          d = min(d, figure(vec2(-(p.x - x0), p.y + 0.43), s, lean + fi * 0.04));
        }
        col = mix(col, vec3(0.018, 0.014, 0.012), smoothstep(0.004, -0.003, d));
        // время: отслоения штукатурки, трещины, рамка, затемнение к краям
        float flake = smoothstep(0.63, 0.67, n2(uv * vec2(5.0, 3.6) + uSeed * 3.1));
        col = mix(col, vec3(0.15, 0.135, 0.12), flake * 0.85);
        col *= 1.0 - 0.6 * smoothstep(0.012, 0.0, abs(n2(uv * vec2(1.3, 1.0) + uSeed * 1.7) - 0.5));
        float fr = max(abs(p.x) / 0.666, abs(p.y) / 0.5);
        col = mix(col, gold * 0.7, smoothstep(0.925, 0.935, fr) * (1.0 - smoothstep(0.955, 0.965, fr)));
        col *= 0.6 + 0.4 * (1.0 - smoothstep(0.3, 0.75, length(p)));
        gl_FragColor = vec4(col * 0.8, 1.0);
      }
    `,
  });
}

/** Часть сборной декорации: геометрия с центром в нуле, место и поворот в собранном силуэте (мир, центр арены — 0). */
export interface SetPiecePart { geo: THREE.BufferGeometry; slot: [number, number, number]; rot: [number, number, number] }

/**
 * Хорист из бездны (1-9 «Хоры», этап 4.5, C3): огромная статуя лежит лицом вверх под полом. Лицо в капюшоне —
 * в северном провале (z < 0), руки с раскрытым псалтырём — в южном; с боевой камеры силуэт читается целиком:
 * поющее лицо над мостиком, книга под ним. y — плоскость лица (м, ниже пола: не заслоняет бой и не прячется
 * за краем провала с камеры под 40°). Лицо — тёмный овал в арке капюшона; светятся золотом его кромка, сомкнутые
 * глаза, рот «О» и строки книги: контур читается с высоты, заливка сливалась в плиту.
 */
export const CHORISTER = { faceZ: -3.7, bookZ: 3.55, y: -0.6 };

export function buildChoristerParts(seed = 89): SetPiecePart[] {
  const rng = new Rng(seed), parts: SetPiecePart[] = [];
  const C = CHORISTER;
  // u — вправо (+x), v — «вверх» по лицу (к северу, −z): с камеры с юга лицо стоит прямо
  const part = (u: number, v: number, z0: number, dy: number, ry: number, build: (b: GeomBuilder) => void): void => {
    const b = new GeomBuilder(); b.rng = rng; b.color = OBS;
    build(b);
    parts.push({ geo: b.build(), slot: [u, C.y + dy, z0 - v], rot: [0, ry, 0] });
  };
  const face = (u: number, v: number, dy: number, ry: number, build: (b: GeomBuilder) => void) => part(u, v, C.faceZ, dy, ry, build);
  const book = (u: number, v: number, dy: number, ry: number, build: (b: GeomBuilder) => void) => part(u, v, C.bookZ, dy, ry, build);
  // капюшон: тёмная арка над лицом и два бока до подбородка
  face(0, 0.15, 0.1, 0, (b) => b.add(jitter(new THREE.TorusGeometry(1.75, 0.42, 4, 12, Math.PI), 0.05, 1), { matrix: mat(0, 0, 0, -Math.PI / 2, 0, 0, 1, 1.05, 0.6) }));
  for (const s of [-1, 1]) face(s * 1.75, -0.75, 0.1, s * 0.05, (b) => b.add(jitter(box(0.8, 0.5, 2.3), 0.06, 2 + s)));
  // лицо — пологий овал (свет по рельефу) с золотой кромкой: контур, а не заливка, читается с боевой камеры
  for (const [v, ph, rx] of [[0.02, Math.PI, -Math.PI / 2], [-0.02, 0, Math.PI / 2]] as const) face(0, v, 0, 0, (b) => {
    b.add(new THREE.SphereGeometry(1, 10, 4, ph, Math.PI, 0, Math.PI / 2), { matrix: mat(0, 0, 0, 0, 0, 0, 1.3, 0.32, 1.65), color: OBS_HI });
    b.add(new THREE.TorusGeometry(1, 0.045, 3, 12, Math.PI), { matrix: mat(0, 0.02, 0, rx, 0, 0, 1.3, 1.65, 1), emissive: 0.9, color: GOLD });
  });
  // сомкнутые глаза — дуги вниз, нос — черта, рот «О» — кольцо и свет внутри (поёт)
  for (const s of [-1, 1]) face(s * 0.6, 0.55, 0.3, 0, (b) => b.add(new THREE.TorusGeometry(0.34, 0.055, 3, 8, Math.PI), { matrix: mat(0, 0, 0, -Math.PI / 2, 0, Math.PI), emissive: 1.0, color: GOLD }));
  face(0, 0.05, 0.3, 0, (b) => b.add(box(0.1, 0.06, 0.75), { emissive: 0.5, color: GOLD }));
  face(0, -0.85, 0.28, 0, (b) => {
    b.add(new THREE.TorusGeometry(0.36, 0.08, 4, 14), { matrix: mat(0, 0, 0, Math.PI / 2, 0, 0), emissive: 0.9, color: GOLD });
    b.add(new THREE.CircleGeometry(0.3, 12), { matrix: mat(0, -0.03, 0, -Math.PI / 2, 0, 0), emissive: 1.4, color: GOLD });
  });
  // псалтырь: страницы с золотыми строками, переплёт, две руки по краям
  for (const s of [-1, 1]) book(s * 1.2, 0, 0.05, 0, (b) => {
    b.add(box(2.3, 0.16, 2.7), { matrix: mat(0, 0, 0, 0, 0, s * 0.1), color: OBS_HI });
    for (let k = 0; k < 5; k++) b.add(box(1.6 - (k === 4 ? 0.6 : 0), 0.04, 0.07), { matrix: mat(s * 0.05 - (k === 4 ? s * 0.3 : 0), 0.1, 0.9 - k * 0.42), emissive: 1.3, color: GOLD });
  });
  book(0, 0, -0.14, 0, (b) => { b.add(box(5.0, 0.14, 3.0)); b.add(box(0.2, 0.2, 3.0), { matrix: mat(0, 0.1, 0) }); });
  for (const s of [-1, 1]) book(s * 2.7, -0.15, 0.12, -s * 0.15, (b) => {
    b.add(jitter(box(0.95, 0.38, 1.35), 0.05, 9 + s));
    b.add(box(0.32, 0.26, 0.75), { matrix: mat(-s * 0.55, 0.1, 0.35, 0, s * 0.6, 0) });
    for (let k = 0; k < 3; k++) b.add(box(0.2, 0.2, 0.6), { matrix: mat(-s * 0.5, -0.05, -0.45 + k * 0.32, 0, s * 0.2, 0) });
  });
  return parts;
}
