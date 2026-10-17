# VOIDBREAKER — Технический документ

Версия 1.2 · Мобильный веб · TypeScript + Three.js · **100 % процедурный контент**

---

## Содержание

1. [Цели и ограничения](#1-цели-и-ограничения)
2. [Стек](#2-стек)
3. [Принцип «всё из кода»](#3-принцип-всё-из-кода)
4. [Рендеринг](#4-рендеринг)
5. [Генераторы геометрии](#5-генераторы-геометрии)
6. [Процедурные текстуры и материалы](#6-процедурные-текстуры-и-материалы)
7. [Персонажи: шарнирные куклы](#7-персонажи-шарнирные-куклы)
8. [Процедурная анимация](#8-процедурная-анимация)
9. [Архитектура](#9-архитектура)
10. [Структура проекта](#10-структура-проекта)
11. [Игровой цикл и время](#11-игровой-цикл-и-время)
12. [ECS и пулы](#12-ecs-и-пулы)
13. [Ввод](#13-ввод)
14. [Движение и коллизии](#14-движение-и-коллизии)
15. [Боевая система](#15-боевая-система)
16. [ИИ врагов и директор волн](#16-ии-врагов-и-директор-волн)
17. [Система паттернов боссов](#17-система-паттернов-боссов)
18. [Камера, hitstop, тряска](#18-камера-hitstop-тряска)
19. [VFX и пост-обработка](#19-vfx-и-пост-обработка)
20. [Небо, фон и глубина](#20-небо-фон-и-глубина)
21. [Процедурный звук и музыка](#21-процедурный-звук-и-музыка)
22. [Процедурный UI](#22-процедурный-ui)
23. [Данные и конфиги](#23-данные-и-конфиги)
24. [Сохранения](#24-сохранения)
25. [Производительность](#25-производительность)
26. [Мобильная специфика](#26-мобильная-специфика)
27. [PWA, сборка, деплой](#27-pwa-сборка-деплой)
28. [Инструменты, тесты, телеметрия](#28-инструменты-тесты-телеметрия)
29. [Роадмап](#29-роадмап)
30. [Риски](#30-риски)

---

## 1. Цели и ограничения

| Требование | Значение |
|---|---|
| Внешние ассеты | **0 файлов**: ни картинок, ни моделей, ни звуков, ни шрифтов, ни анимаций |
| FPS | 60 на средних Android (2021+), iPhone 11+; режим 30 FPS с логикой 60 Гц на слабых |
| Размер сборки | ≤ 2 МБ (gzip/brotli ~600–800 КБ) — весь код + данные |
| До меню | ≤ 2 с на 4G |
| Генерация зоны | ≤ 400 мс на среднем телефоне (геометрия + текстуры + запекание звука), в Web Worker |
| До первого боя | ≤ 5 с |
| Треугольники в кадре | ≤ 250 тыс. (высокое), ≤ 120 тыс. (низкое) |
| Draw calls | ≤ 120 (цель), ≤ 180 (пик) |
| GPU-память | ≤ 150 МБ (процедурные текстуры небольшие) |
| Активные частицы | ≤ 4 000 (GPU, высокое), ≤ 1 500 (низкое) |
| Офлайн | да, после первой загрузки (PWA) |

---

## 2. Стек

| Слой | Выбор | Почему |
|---|---|---|
| Язык | **TypeScript** (strict) | типы для данных боя, генераторов и конфигов |
| Сборка | **Vite** | быстрый dev, HMR для шейдеров и данных |
| Рендер | **Three.js** (WebGL2) | процедурная 3D-геометрия, инстансинг, свои шейдеры, зрелая мобильная поддержка |
| Утилиты геометрии | `BufferGeometryUtils` (из three/examples) | слияние мешей в один draw call |
| ECS | **bitECS** или собственный лёгкий ECS | кэш-дружелюбные массивы |
| Аудио | **Web Audio API**, собственный синтезатор и секвенсор | весь звук синтезируется |
| Сохранения | IndexedDB (`idb-keyval`) + резерв localStorage | надёжность |
| Валидация данных | `zod` | понятные ошибки в конфигах |
| Dev-панели | `lil-gui` (только dev-сборка) | крутилки генераторов, поз, синтезаторов |
| PWA | `vite-plugin-pwa` (Workbox) | офлайн, установка на главный экран |
| Тесты | Vitest + Playwright | логика + смоук в браузере |

Почему 3D, а не 2D: процедурно нарисовать 2D-персонажа в 8 направлениях так, чтобы он выглядел как на концептах, почти невозможно. Процедурная **3D**-геометрия даёт бесплатно повороты, свет, глубину, параллакс и разрушение на части — а огранённый стиль делает простую геометрию красивой.

---

## 3. Принцип «всё из кода»

| Что | Как создаётся |
|---|---|
| Модели персонажей, врагов, боссов | генераторы деталей (призмы, октаэдры, осколки, профили вращения) на скелете суставов |
| Окружение | кит генераторов: колонны, шпили, арки, мосты, свечи, статуи, цепи, руины, плиты |
| Текстуры | шум, градиенты, маски, matcap — рендерятся при запуске (Canvas 2D / рендер в текстуру шейдером) |
| Небо, туманность, солнце | полноэкранные шейдеры |
| Анимации | ключевые позы в данных + процедурная походка, IK, пружины, Верле |
| VFX | GPU-частицы, ленты, кольца, молнии — всё параметрически |
| UI, иконки, шрифт заголовков | векторные пути в коде → Canvas 2D / SVG в рантайме |
| Музыка, SFX, голоса | синтез Web Audio, реверберация из сгенерированного импульса |

**Детерминизм.** Один генератор псевдослучайных чисел с сидом (`mulberry32` / `sfc32`): сид этапа → одна и та же арена, сид врага → одинаковая модель. Это нужно для воспроизведения багов и для того, чтобы элита «того же вида» выглядела узнаваемо.

```ts
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashSeed = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
```

**Кэширование.** Сгенерированная геометрия хранится в памяти по ключу `генератор + параметры + сид`. Тяжёлые результаты (слитые меши зоны, запечённые звуки) создаются в Web Worker и передаются как `ArrayBuffer` (transferable) — главный поток не фризится.

---

## 4. Рендеринг

### 4.1 Камера и пространство
- Логика — в плоскости пола `(x, z)` в метрах, высота `y`.
- **Перспективная камера с узким углом** (FOV ≈ 30°), наклон ≈ 55°, дистанция ~28 м. Картинка почти изометрическая, но далёкий фон движется медленнее — **настоящий параллакс без хитростей**.
- Ось сортировки не нужна — работает Z-буфер.

### 4.2 Освещение
На мобильных реальных источников мало, «красота» достигается иначе:
- 1 направленный «лунный» свет (холодный, сверху-сбоку) + `HemisphereLight` (тёмно-фиолетовое небо / почти чёрный пол).
- **До 4 точечных источников** на динамику (клинок героя, ульта, взрыв, горнило босса) — пул, отдаются самым ярким событиям.
- Всё остальное свечение — **эмиссия в материале + bloom** и **световые пятна** (аддитивные квадраты на полу с радиальным градиентом, инстансами).
- Тени: **blob-тени** (тёмные эллипсы под персонажами). Карта теней только на высоком качестве и только от «лунного» света для героя и босса.

### 4.3 Мокрый обсидиановый пол
- Пол — инстансы плит со швами; материал пола получает **процедурный matcap** глянцевого обсидиана + шум неровностей.
- **Отражения (высокое качество):** эмиссивные объекты (клинок, снаряды, свечи, ядра врагов) дублируются отражённой копией (`scale.y = -1`) под полом; пол полупрозрачный (α 0.85) с лёгким размытием — дешёвая и очень эффектная иллюзия зеркала.
- На среднем/низком — только световые пятна.

### 4.4 Порядок отрисовки
```
1. Небо (полноэкранный шейдер, depthWrite off)
2. Дальний фон: шпили, руины (слитые меши, туман сильный)
3. Отражения (high)
4. Пол арены + декали (телеграфы, руны, трещины лавы, световые пятна)
5. Непрозрачные: окружение арены, персонажи (инстансы деталей)
6. Прозрачные/аддитивные: шлейфы, частицы, снаряды, кольца
7. Передний план (затемнённый, с отсечением рядом с героем)
8. Пост: bloom + uber-шейдер (цвет, виньетка, аберрация, искажения)
9. UI (отдельный Canvas 2D поверх)
```

---

## 5. Генераторы геометрии

### 5.1 Базовые примитивы
Все генераторы возвращают `BufferGeometry` с **плоскими нормалями** (`toNonIndexed()` + `computeVertexNormals()`), чтобы каждая грань ловила свет отдельно.

**Огранённый осколок** — основа обсидиана, врагов, обломков:
```ts
import * as THREE from 'three';

const hash3 = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

export function shardGeometry(len = 1, radius = 0.25, sides = 5, jitter = 0.25, seed = 0) {
  const g = new THREE.CylinderGeometry(radius * 0.08, radius, len, sides, 2).toNonIndexed();
  g.translate(0, len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // смещение зависит от исходной позиции → совпадающие вершины смещаются одинаково, швов нет
    const k = hash3(Math.round(x * 100) + seed, Math.round(y * 100), Math.round(z * 100));
    const s = 1 + (k - 0.5) * 2 * jitter;
    p.setXYZ(i, x * s, y * (1 + (k - 0.5) * jitter * 0.5), z * s);
  }
  g.computeVertexNormals();
  return g;
}
```

**Стрельчатая (готическая) арка** — две дуги радиусом в пролёт, выдавленные в толщину:
```ts
export function gothicArch(span = 3, springH = 3, wall = 0.6, depth = 0.8) {
  const outer = new THREE.Shape();
  const W = span / 2 + wall, top = springH + span * 0.87 + wall;
  outer.moveTo(-W, 0); outer.lineTo(W, 0); outer.lineTo(W, springH);
  outer.lineTo(0, top); outer.lineTo(-W, springH); outer.closePath();

  const hole = new THREE.Path();
  const w = span / 2;
  hole.moveTo(-w, 0); hole.lineTo(-w, springH);
  hole.absarc(w, springH, span, Math.PI, (2 * Math.PI) / 3, true);   // левая дуга к вершине
  hole.absarc(-w, springH, span, Math.PI / 3, 0, true);              // правая дуга вниз
  hole.lineTo(w, 0); hole.closePath();
  outer.holes.push(hole);

  return new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 })
    .toNonIndexed();
}
```

### 5.2 Кит окружения

| Генератор | Сборка | Ключевые параметры |
|---|---|---|
| `column()` | база (призма) + ствол (N-гранная призма с каннелюрами-гранями) + капитель (усечённая пирамида) | высота, грани, сколы (срез случайной плоскостью), трещины (эмиссивная маска) |
| `spire()` | ярусы-конусы с убывающим радиусом + кольцо пинаклей на каждом ярусе | ярусов, острота, обломан ли верх |
| `gothicArch()` | см. выше | пролёт, толщина |
| `buttress()` | дуга из выдавленного профиля | радиус, толщина |
| `bridge()` | ряд арок + плиты сверху + перила-призмы | длина, разрушения |
| `roseWindow()` | кольцо + спицы + эмиссивные «стёкла»-сектора | лепестки, цвет |
| `candelabra()` | стойка + чаши + 3–7 свечей (цилиндры с оплывом) + огонь-billboard | свечей, высота |
| `hoodedStatue()` | `LatheGeometry` по профилю мантии + конус капюшона + тёмная впадина лица | поза, наклон |
| `chain()` | инстансы торов, ориентация чередуется на 90° | длина, провис |
| `banner()` | плоская сетка 4 × 8 под ткань (Верле), руны в шейдере | рваный край |
| `floatingRuin()` | кусок пола (призма) + перевёрнутый «сталактит» из осколков снизу | размер |
| `floorTiles()` | `InstancedMesh` плит с микро-поворотами и высотой ±2 см | сетка, швы |
| `rubble()` | 20–200 инстансов `shardGeometry` разных размеров | плотность |

### 5.3 Сборка зоны
1. Загружается раскладка арены (данные): контур пола, ямы, укрытия, точки спавна, «запретные» зоны для декора.
2. Генератор декора проходит по периметру и фону с правилами (симметрия собора, шаг колонн, плотность, мин. расстояние до игровой зоны).
3. Статичная геометрия **сливается** по материалам (`mergeGeometries`) в 5–15 мешей на зону; повторяющиеся объекты (свечи, плиты, обломки) — `InstancedMesh`.
4. Всё выполняется в Web Worker: на выходе массивы `position/normal/color`, которые главный поток превращает в `BufferGeometry`.

### 5.4 Цвет в вершинах
Вместо текстур — **цвет и эмиссия в атрибутах вершин**: генератор пишет `color` (оттенок обсидиана с вариацией) и собственный атрибут `aEmissive` (0..1, где светятся прожилки, руны, трещины). Шейдер умножает `aEmissive` на цвет фракции и время — прожилки пульсируют без текстур.

---

## 6. Процедурные текстуры и материалы

### 6.1 Текстуры, создаваемые при запуске
| Текстура | Размер | Как |
|---|---|---|
| Matcap «обсидиан» | 256² | Canvas 2D: тёмная сфера + узкий яркий блик + цветной рим |
| Matcap «лёд», «металл», «лава» | 256² | то же с другими параметрами |
| Шум (value / fbm) | 256² | рендер шейдером в `WebGLRenderTarget`, тайлится |
| Вороной | 256² | шейдер — для трещин лавы и льда |
| Спрайты частиц | 64² × 6 в атласе | Canvas 2D: мягкая точка, искра, кольцо, звезда, дым, осколок |
| Глифы цифр урона | атлас 512 × 64 | Canvas 2D `fillText` системным шрифтом при старте |

```ts
export function makeMatcap(c0: string, highlight: string, rim: string, size = 256) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d')!, r = size / 2;
  const base = g.createRadialGradient(r * 0.7, r * 0.6, 0, r, r, r);
  base.addColorStop(0, c0); base.addColorStop(1, '#000');
  g.fillStyle = base; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  const hl = g.createRadialGradient(r * 0.62, r * 0.45, 0, r * 0.62, r * 0.45, r * 0.22);
  hl.addColorStop(0, highlight); hl.addColorStop(1, 'transparent');
  g.fillStyle = hl; g.fill();
  g.globalCompositeOperation = 'lighter';
  const rm = g.createRadialGradient(r, r, r * 0.8, r, r, r);
  rm.addColorStop(0, 'transparent'); rm.addColorStop(1, rim);
  g.fillStyle = rm; g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
```

### 6.2 Главный материал «Обсидиан»
Один `ShaderMaterial` (или `MeshMatcapMaterial` + `onBeforeCompile`) для всех персонажей и окружения:
- matcap-освещение (дёшево, выглядит как глянцевое стекло);
- **rim-свет** по цвету фракции (фиолетовый герой / красные враги);
- **эмиссия** из `aEmissive` × цвет × пульс;
- униформы: `uFlash` (белая вспышка попадания), `uDissolve` (растворение по шуму с яркой кромкой), `uCrack` (рост трещин при сломе стойки), `uGhost` (режим остаточного изображения).
- Для инстансов эти параметры идут через `InstancedBufferAttribute`, чтобы каждый враг мигал отдельно, оставаясь в одном draw call.

```glsl
// фрагмент (сокращённо)
vec3 base = texture2D(uMatcap, vMatcapUv).rgb * vColor;
float rim = pow(1.0 - max(dot(vNormalV, vec3(0,0,1)), 0.0), 3.0);
vec3 col = base + uRimColor * rim * 0.8;
col += uEmissiveColor * vEmissive * (0.7 + 0.3 * sin(uTime * 3.0 + vSeed * 6.28));
float n = texture2D(uNoise, vUvW * 0.5).r;
if (n < uDissolve) discard;
col += uEmissiveColor * smoothstep(uDissolve + 0.06, uDissolve, n) * step(0.001, uDissolve) * 4.0;
col = mix(col, vec3(1.0), uFlash);
gl_FragColor = vec4(col, 1.0);
```

### 6.3 Особые материалы
| Материал | Где | Суть |
|---|---|---|
| Пол | арены | matcap + швы + руны (SDF-кольца и глифы) + лава/иней по зоне |
| Плазма горнила | Молох | fbm-шум, анимированный по времени, яркость > 1 для bloom |
| Огонь свечи | свечи, кадила | billboard, вытянутый шум вверх, градиент белый→оранжевый→прозрачный |
| Зеркало | лицо Сестры, арена Каэлис | рендер героя в низкое разрешение + отражение по вектору вида |
| Глитч | Каэлис | смещение вершин по полосам шума, RGB-разделение |
| Планеты | Ткач | шум-полосы + атмосферный рим |
| Призрак | остаточные изображения | только рим и эмиссия, аддитивно, α по времени |

---

## 7. Персонажи: шарнирные куклы

### 7.1 Модель
- **Скелет** — дерево `THREE.Object3D` (суставы). **Детали** — меши из генераторов, прикреплённые к суставам.
- Скиннинга нет → нет затрат на скиннинг-шейдеры, проще разрушение и призраки.
- **Инстансинг рядовых врагов:** все Шипники на экране используют общий `InstancedMesh` на каждую деталь; матрицы деталей считаются на CPU (ECS-система «RigPose»), один draw call на тип детали.

### 7.2 Описание рига в коде
```ts
type Part = { joint: string; gen: GeomRef; offset?: V3; rot?: V3; scale?: V3; emissive?: number };
type RigDef = { joints: { name: string; parent?: string; pos: V3 }[]; parts: Part[] };

export const HERO_RIG: RigDef = {
  joints: [
    { name: 'root',   pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root',   pos: [0, 0.95, 0] },
    { name: 'spine',  parent: 'pelvis', pos: [0, 0.25, 0] },
    { name: 'chest',  parent: 'spine',  pos: [0, 0.3, 0] },
    { name: 'head',   parent: 'chest',  pos: [0, 0.38, 0] },
    { name: 'shL',    parent: 'chest',  pos: [-0.26, 0.26, 0] },
    { name: 'elbL',   parent: 'shL',    pos: [0, -0.3, 0] },
    { name: 'handL',  parent: 'elbL',   pos: [0, -0.28, 0] },
    // ... правая рука, бёдра, колени, стопы
    { name: 'blade',  parent: 'handR',  pos: [0, -0.05, 0.08] },
  ],
  parts: [
    { joint: 'head',  gen: { fn: 'helmet', p: { h: 0.32 } } },
    { joint: 'chest', gen: { fn: 'torso', p: { wTop: 0.52, wBot: 0.34, h: 0.55 } }, emissive: 1 }, // шрам на груди
    { joint: 'blade', gen: { fn: 'voidBlade', p: { len: 1.25, curve: 0.18 } }, emissive: 1 },
    // ...
  ],
};
```

### 7.3 Генераторы персонажей
| Генератор | Персонаж | Ключевые параметры |
|---|---|---|
| `hero()` | Кассиан | рост, ширина плеч, форма шлема, длина плаща, оружие (4 вида), облик (палитра, рисунок шрама) |
| `crawler()` | Шипник, Искра | радиус тела, число шипов, ног, длина ног |
| `mantis()` | Жнец, Призрачный рыцарь | длина кос, сутулость, число ног |
| `floater()` | Око, Гравитон, Аколит | число лучей звезды, кольца, размер ядра |
| `brute()` | Голем, Щитоносец, Ледяной рыцарь | масса плеч, число глыб, щит/меч |
| `veiled()` | Плакальщица, Сестра | размер вуали, рукава-клинки |
| `bossX()` | боссы | отдельные сборщики, см. GDD §15.7 |

Элита = тот же генератор с другим сидом, масштабом ×1.25, шипами ×1.5 и аурой.

### 7.4 Разрушение
При смерти деталь отсоединяется: её мировая матрица фиксируется, ей выдаются скорость (от направления удара), вращение и гравитация; через 0.3–0.6 с она раскалывается на 3–8 мелких осколков (`shardGeometry`, инстансы) и растворяется (`uDissolve`). Боссы распадаются слоями по сценарию.

---

## 8. Процедурная анимация

### 8.1 Клипы — ключевые позы в данных
```ts
type Key = { t: number; pose: Record<string, [number, number, number]>; ease?: Ease; rootOffset?: V3; stretch?: number };
type Clip = { id: string; dur: number; mask?: 'upper' | 'full'; keys: Key[]; events?: { t: number; name: string }[] };

export const ATK1: Clip = {
  id: 'atk1', dur: 0.26, mask: 'upper',
  keys: [
    { t: 0.00, pose: { chest: [0, 0.6, 0], shR: [-1.9, 0.4, 0.3], elbR: [-0.4, 0, 0] } },
    { t: 0.05, pose: { chest: [0, 0.8, 0], shR: [-2.2, 0.9, 0.5] }, ease: 'inBack' },          // замах
    { t: 0.08, pose: { chest: [0, -0.7, 0], shR: [-1.2, -1.4, -0.2] }, ease: 'outExpo', stretch: 1.08 }, // разрез
    { t: 0.26, pose: { chest: [0, -0.3, 0], shR: [-1.0, -0.8, 0] }, ease: 'outQuart' },         // возврат
  ],
  events: [{ t: 0.05, name: 'hitOn' }, { t: 0.13, name: 'hitOff' }, { t: 0.05, name: 'trailOn' }],
};
```
- Интерполяция кватернионами (`slerp`) с эйзингом на сегмент.
- События клипа включают/выключают хитбокс, шлейф, звук — **кадровые данные боя привязаны к таймингам клипа**.

### 8.2 Смешивание слоёв
```
итоговая поза = локомоция
              ⊕ клип действия (по маске, вес с кроссфейдом 40–80 мс)
              ⊕ аддитивные (дыхание, отдача от удара, взгляд)
              → IK (стопы к полу)
              → вторичная физика (плащ, цепи)
              → масштаб корня (squash/stretch)
```

### 8.3 Процедурная локомоция
```ts
// фаза шага растёт от пройденного пути, а не от времени → ноги не «скользят»
gait.phase += dist / strideLen;
const s = Math.sin(gait.phase * Math.PI * 2), amp = clamp(speed / runSpeed, 0, 1);
pose.hipL.x =  0.7 * s * amp;  pose.hipR.x = -0.7 * s * amp;
pose.kneeL.x = Math.max(0, -s) * 1.1 * amp; pose.kneeR.x = Math.max(0, s) * 1.1 * amp;
pose.chest.x = 0.21 * amp + accel * 0.03;                 // наклон вперёд (~12°) + от ускорения
root.y = Math.abs(Math.cos(gait.phase * Math.PI * 2)) * 0.05 * amp;  // покачивание
```
Многоногие враги — походка группами ног: нога переставляется, когда её «желаемая» точка отходит от текущей опоры дальше порога; шаг — дуга по кривой за 0.12 с.

### 8.4 Инверсная кинематика
Двухзвенная IK (ноги людей и големов) по теореме косинусов:
```ts
export function twoBoneIK(a: number, b: number, dist: number) {
  const d = Math.min(dist, a + b - 1e-4);
  const angA = Math.acos((a * a + d * d - b * b) / (2 * a * d));   // угол в бедре от направления к цели
  const angK = Math.PI - Math.acos((a * a + b * b - d * d) / (2 * a * b)); // сгиб колена
  return { hip: angA, knee: angK };
}
```
Многосуставные конечности (ноги Ткача, руки Колосса) — **FABRIK**, 4–8 итераций.

### 8.5 Вторичная физика (Верле)
```ts
export function verletStep(pts: P[], prev: P[], g: V3, dt: number, damping = 0.98) {
  for (let i = 1; i < pts.length; i++) {             // точка 0 прикреплена к суставу
    const p = pts[i], q = prev[i];
    const vx = (p.x - q.x) * damping, vy = (p.y - q.y) * damping, vz = (p.z - q.z) * damping;
    q.x = p.x; q.y = p.y; q.z = p.z;
    p.x += vx + g.x * dt * dt; p.y += vy + g.y * dt * dt; p.z += vz + g.z * dt * dt;
  }
}
// затем 2–4 итерации ограничений длины между соседними точками + коллизия с полом (y ≥ 0)
```
Плащ (3 × 7), шарф (8), цепи боссов (до 40 звеньев), вуали (12 × 8) — всё на этом. Ткань рендерится сеткой, вершины которой — точки Верле.

### 8.6 Пружины и «сочность»
- **Затухающая пружина** на позвоночнике: удар по персонажу = импульс в направлении удара → корпус отклоняется и возвращается (≈ 0.25 с).
- **Squash & stretch** корня: рывок ×1.35 вдоль движения (объём сохраняется: остальные оси ×1/√1.35), приземление финишера — 0.85/1.15.
- **Остаточные изображения:** раз в 30 мс копируем мировые матрицы всех деталей героя в кольцевой буфер; призраки рисуются теми же `InstancedMesh` деталей с материалом `uGhost`.

---

## 9. Архитектура

```
                ┌──────────────────────────────┐
                │            Game              │
                │  (FSM экранов, загрузка)     │
                └──────┬────────────┬──────────┘
                       │            │
            ┌──────────▼───┐   ┌────▼──────────┐       ┌──────────────┐
            │  MetaLayer   │   │  BattleScene  │◄──────│ GenWorker    │
            │ хаб, прокачка│   │  (World)      │       │ генерация    │
            │ сохранения   │   └────┬──────────┘       │ зон и звука  │
            └──────────────┘        │                  └──────────────┘
     ┌──────────┬──────────┬────────┼─────────┬──────────┬─────────┬─────────┐
     ▼          ▼          ▼        ▼         ▼          ▼         ▼         ▼
  Input   Simulation   AI/Boss   Combat   Animation   Camera     VFX     Synth
          (движение,              (хиты,   (позы, IK,  (follow,   (части-  (музыка,
          коллизии)               урон)    Верле)      shake)     цы,пост)  SFX)
                       \          |          /
                        ▼         ▼         ▼
                         EventBus (типизированный)
                                  │
                                  ▼
                      Renderer (Three.js сцена)  +  UI (Canvas 2D)
```

**Принципы:**
- Симуляция не знает о Three.js; системы рендера читают компоненты.
- Все «сочные» реакции (звук, частицы, тряска, вибрация) — подписчики на события. Game feel настраивается без правки боевой логики.
- Все числа — в конфигах (§23), горячая перезагрузка в dev.

```ts
export type GameEvent =
  | { type: 'hit'; attacker: number; target: number; dmg: number; crit: boolean; feel: FeelId; dir: Vec2; pos: Vec3 }
  | { type: 'kill'; target: number; kind: EnemyKind; pos: Vec3; dir: Vec2 }
  | { type: 'postureBreak'; target: number }
  | { type: 'perfectDodge'; pos: Vec3 }
  | { type: 'playerHurt'; dmg: number; hpLeft: number }
  | { type: 'bossPhase'; boss: number; phase: number }
  | { type: 'waveStart'; index: number }
  | { type: 'waveClear'; index: number }
  | { type: 'beat'; bar: number; beat: number };          // от секвенсора: синхронизация фона с музыкой
```

---

## 10. Структура проекта

```
voidbreaker/
├─ index.html
├─ vite.config.ts
├─ public/
│  └─ manifest.webmanifest       # иконки PWA генерируются скриптом сборки из того же кода
├─ data/                         # JSON-конфиги (баланс, волны, боссы, клипы, пресеты)
│  ├─ player.json  weapons/  abilities/  enemies/  stages/  bosses/
│  ├─ clips/                     # ключевые позы (экспорт из редактора поз)
│  ├─ zones/                     # пресеты генераторов и палитры зон
│  ├─ music/                     # паттерны: ноты, ритмы, слои
│  └─ feel.json
├─ src/
│  ├─ core/        # loop, time, events, rng, pool, math, tween
│  ├─ ecs/
│  ├─ gen/         # ГЕНЕРАТОРЫ
│  │  ├─ geom/     # shard, prism, arch, lathe, column, spire, bridge...
│  │  ├─ chars/    # hero, crawler, mantis, floater, brute, veiled, bosses/
│  │  ├─ zone/     # раскладка декора по сиду, слияние, инстансы
│  │  ├─ tex/      # matcap, noise, voronoi, particle atlas, glyph atlas
│  │  └─ worker.ts # генерация в Web Worker
│  ├─ anim/        # клипы, смешивание, locomotion, ik, verlet, springs
│  ├─ systems/     # input, movement, collision, combat, ai, boss, projectile, spawn, camera
│  ├─ render/      # сцена, материалы, шейдеры, отражения, пост
│  ├─ vfx/         # частицы, ленты, кольца, молнии, декали
│  ├─ audio/       # synth (инструменты), sequencer, mixer, sfx-рецепты, reverb
│  ├─ ui/          # HUD, экраны, векторные иконки, процедурный шрифт
│  ├─ meta/        # прогрессия, экономика, сохранения
│  ├─ content/     # загрузка и валидация данных
│  └─ debug/       # оверлеи, читы, галерея генераторов, редактор поз, синт-лаборатория
└─ tests/
```

---

## 11. Игровой цикл и время

Фиксированный шаг симуляции **60 Гц**, рендер с интерполяцией. Три шкалы времени: `real` (UI, тряска камеры), `world` (замедления, hitstop), `hero` (в «Мгновении Пустоты» герой замедлен меньше мира).

```ts
const STEP = 1 / 60, MAX_FRAME = 0.1;

export class Time {
  worldScale = 1; hitstop = 0;
  slowmo: { scale: number; left: number } | null = null;
  update(realDt: number) {
    if (this.hitstop > 0) this.hitstop = Math.max(0, this.hitstop - realDt);
    if (this.slowmo && (this.slowmo.left -= realDt) <= 0) this.slowmo = null;
    const base = this.slowmo ? this.slowmo.scale : 1;
    this.worldScale = this.hitstop > 0 ? 0.08 : base;   // не 0: частицы «дышат»
  }
  addHitstop(sec: number) { this.hitstop = Math.min(this.hitstop + sec, 0.12); }
}

let acc = 0, last = performance.now();
function frame(now: number) {
  const realDt = Math.min((now - last) / 1000, MAX_FRAME); last = now;
  time.update(realDt);
  acc += realDt * time.worldScale;
  while (acc >= STEP) { world.step(STEP); acc -= STEP; }
  anim.update(realDt * time.worldScale);   // позы, IK, Верле
  renderer.render(acc / STEP);
  ui.update(realDt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```
Длинные замирания (казнь, смерть босса) — `time.cinematic(sec, scale)` без лимита 0.12 с.

---

## 12. ECS и пулы

| Компонент | Поля |
|---|---|
| `Transform` | x, y, z, prev*, facing |
| `Velocity` | vx, vy, vz |
| `Body` | radius, mass, layer, mask |
| `Health` | hp, maxHp, armor, invulnUntil |
| `Posture` | value, max, regenDelay, brokenUntil |
| `Faction` | hero / enemy / neutral |
| `Rig` | rigId, instance slot, позы суставов (Float32Array кватернионов) |
| `Animator` | clip, t, weight, layers, events |
| `AttackState` | moveId, phase, t, hitList |
| `Hitbox` / `Hurtbox` | shape, параметры |
| `AI` / `BossController` | мозг, таймеры, паттерны |
| `Projectile`, `Telegraph`, `Pickup` | — |
| `MaterialFx` | flash, dissolve, crack, ghost — уходят в инстанс-атрибуты |

Всё, что часто создаётся (снаряды, частицы, цифры урона, осколки, телеграфы, рядовые враги, отвалившиеся детали), — через пулы с преаллокацией; в бою ноль `new` в горячем цикле.

```ts
export class Pool<T> {
  private free: T[] = [];
  constructor(private make: () => T, private reset: (o: T) => void, prealloc = 0) {
    for (let i = 0; i < prealloc; i++) this.free.push(make());
  }
  get(): T { return this.free.pop() ?? this.make(); }
  release(o: T) { this.reset(o); this.free.push(o); }
}
```

---

## 13. Ввод

- Pointer Events на canvas, `touch-action: none`, мультитач по `pointerId`.
- Левая половина — **плавающий стик** (радиус 60 px, мёртвая зона 12 %). Правая — кнопки + **свайп-рывок** (> 40 px за < 180 мс вне кнопок).
- Клавиатура/мышь и Gamepad API → те же действия.
- Haptics: `navigator.vibrate?.(ms)` (Android; на iOS Safari недоступно — игнорируем).

```ts
type Action = 'attack' | 'attackRelease' | 'dash' | 'q' | 'e' | 'r';
const BUFFER = 0.15;
export class InputBuffer {
  private q: { a: Action; t: number }[] = [];
  push(a: Action, now: number) { this.q.push({ a, t: now }); }
  consume(a: Action, now: number) {
    const i = this.q.findIndex(e => e.a === a && now - e.t <= BUFFER);
    if (i < 0) return false; this.q.splice(i, 1); return true;
  }
}
```

**Автоприцел:** конус 70° по направлению стика, радиус 6 м (без стика — 4 м); оценка = выравнивание × 2 − дистанция/R − доля HP × 0.3 + бонус элиты.

---

## 14. Движение и коллизии

- Тела — круги (персонажи), капсулы/полигоны (стены, обломки).
- Широкая фаза — **spatial hash** (ячейка 2 м), перестраивается каждый шаг.
- Мягкое расталкивание врагов — рой красиво обтекает героя.
- Ямы: coyote 0.1 с → падение (анимация + урон + возврат на безопасную точку).
- Навигация толп — **flow field** (BFS по сетке 0.5 м раз в 0.25 с).
- Динамические арены (лёд, вращающиеся сегменты, разрушающиеся плиты) меняют навигационную маску по событию `arena`.

---

## 15. Боевая система

### 15.1 Мувсет в данных
```jsonc
// data/weapons/void_blade.json
{
  "id": "void_blade",
  "gen": { "fn": "voidBlade", "p": { "len": 1.25, "curve": 0.18 } },
  "combo": [
    { "id": "slash1", "clip": "atk1", "chainWindow": [0.10, 0.40], "dashCancelFrom": 0.13,
      "lunge": { "dist": 0.6, "magnetRange": 2.5 },
      "hitbox": { "shape": "arc", "radius": 2.2, "angle": 120 },
      "dmg": 1.0, "posture": 4, "knockback": 1.5, "feel": "light" },
    { "id": "slash2", "clip": "atk2", "...": "..." },
    { "id": "spin", "clip": "atk3", "hitbox": { "shape": "circle", "radius": 2.4 }, "dmg": 1.3, "posture": 6, "feel": "medium" },
    { "id": "rift", "clip": "atk4", "hitbox": { "shape": "circle", "radius": 3.0 }, "dmg": 2.2, "posture": 14,
      "knockback": 5, "feel": "heavy", "spawn": [{ "fx": "shockwave_void", "on": "hitOn" }] }
  ],
  "charged": { "minHold": 0.45, "fullHold": 0.9, "dmg": [3.0, 4.5], "posture": [20, 35],
               "hitbox": { "shape": "line", "length": 6, "width": 0.9 } }
}
```
Окно активного хитбокса берётся из событий клипа `hitOn/hitOff` — поза и урон всегда синхронны.

### 15.2 Стейт-машина атаки
```
Idle/Run ──attack──► Anticipation ──► Active (хитбокс) ──► Recovery ──► Idle
                         │                  │                  │
                         └──dash (≤60мс)────┴─dash (после hitOff)┘──► Dash
Recovery: 'attack' в буфере внутри chainWindow → следующий удар комбо
```

### 15.3 Попадания и урон
- Формы: `circle`, `arc`, `line` (OBB), `ring` (внутренний/внешний радиус + «разрывы» по углу).
- `hitList` — одна цель получает урон один раз за взмах.
- Идеальное уклонение: вражеский хитбокс пересёк героя, а рывок начался ≤ 0.15 с назад → событие `perfectDodge` вместо урона.

```ts
function computeDamage(atk: Stats, move: MoveData, target: Defender, rng: () => number) {
  const crit = rng() < atk.critChance || atk.forceCrit;
  let dmg = atk.attack * move.dmg * (1 + atk.dmgBonus);
  if (crit) dmg *= atk.critMul;
  if (target.postureBroken) dmg *= 1.5;
  dmg *= 1 - target.armor / (target.armor + 100);
  dmg *= 0.95 + rng() * 0.1;
  return { dmg: Math.round(dmg), crit };
}
```

### 15.4 Профили ощущения (`data/feel.json`)
```json
{
  "light":  { "hitstop": 0.035, "trauma": 0.08, "kick": 0.05, "flash": 0.06, "vibrate": 10, "sfx": "hit_light",  "spring": 0.6 },
  "medium": { "hitstop": 0.05,  "trauma": 0.15, "kick": 0.08, "flash": 0.08, "vibrate": 15, "sfx": "hit_medium", "spring": 0.9 },
  "heavy":  { "hitstop": 0.09,  "trauma": 0.30, "kick": 0.15, "flash": 0.10, "vibrate": 35, "sfx": "hit_heavy",  "spring": 1.4, "zoomPunch": 0.04 },
  "break":  { "hitstop": 0.16,  "trauma": 0.45, "kick": 0.2,  "flash": 0.14, "vibrate": 80, "sfx": "posture_break", "spring": 2.0, "chroma": 0.4, "shockwave": true, "crack": true }
}
```

---

## 16. ИИ врагов и директор волн

- Иерархическая FSM: `Spawn → Approach → Position → Telegraph → Attack → Recover → (Broken) → Dead`; выбор атаки по весам × дистанция × готовность × токен.
- **Токены атаки:** ≤ 3 врагов в замахе в радиусе 4 м, ≤ 2 одновременных выстрела; элита и стражи токены не тратят. Враг без токена кружит на дистанции.
- Мозг обновляется 15–20 раз/с, движение — каждый шаг.

```jsonc
// data/stages/z1/1-4.json
{
  "id": "1-4", "zone": 0, "arena": "candle_hall", "seed": "1-4",
  "waves": [
    { "spawns": [ { "enemy": "spiker", "count": 10, "pattern": "ring" },
                  { "enemy": "reaper", "count": 2, "pattern": "edges", "delay": 1.5 } ] },
    { "spawns": [ { "enemy": "eye", "count": 2, "at": ["left", "right"] },
                  { "enemy": "spiker", "count": 6 }, { "enemy": "acolyte", "count": 1, "delay": 2 } ] },
    { "spawns": [ { "enemy": "golem", "count": 1 }, { "enemy": "reaper", "count": 3 }, { "enemy": "eye", "count": 2 } ] },
    { "spawns": [ { "enemy": "golem", "elite": ["hasted"], "count": 1 } ],
      "triggers": [ { "when": "eliteHp<0.5", "spawn": { "enemy": "spiker", "count": 8 } } ] }
  ],
  "rewards": { "shards": 288 }
}
```
Спаун — через портал-разлом 0.8 с (шейдер растворения в обратную сторону), вне радиуса 3 м от героя.

---

## 17. Система паттернов боссов

Атаки боссов — **таймлайны** в данных: шаги синхронизируют позы, телеграфы, хитбоксы, эффекты, звук и камеру.

```ts
type Step =
  | { t: number; do: 'clip'; id: string; speed?: number }
  | { t: number; do: 'telegraph'; shape: Shape; at: Anchor; dur: number; unblockable?: boolean }
  | { t: number; do: 'hitbox'; shape: Shape; at: Anchor; dmg: number; posture?: number; dur?: number }
  | { t: number; do: 'projectiles'; pattern: 'radial' | 'fan' | 'aimed' | 'rain' | 'spiral'; count: number; speed: number; kind: string }
  | { t: number; do: 'fx'; id: string; at: Anchor }
  | { t: number; do: 'sfx'; id: string }
  | { t: number; do: 'shake'; trauma: number }
  | { t: number; do: 'vulnerable'; dur: number }
  | { t: number; do: 'move'; to: Anchor; dur: number; ease?: string }
  | { t: number; do: 'summon'; enemy: string; count: number; at: Anchor[] }
  | { t: number; do: 'arena'; action: string }
  | { t: number; do: 'light'; preset: string; dur: number };   // смена освещения (Молох гасит звезду)

interface Pattern { id: string; weight: number; cooldown: number; range?: [number, number]; phases: number[]; steps: Step[] }
```

```jsonc
// Молох — «Молот кулака»
{
  "id": "fist_slam", "weight": 3, "cooldown": 5, "range": [0, 7], "phases": [1, 2, 3],
  "steps": [
    { "t": 0.00, "do": "clip", "id": "moloch_raise_fist" },
    { "t": 0.00, "do": "sfx", "id": "moloch_growl" },
    { "t": 0.00, "do": "telegraph", "shape": { "circle": 4 }, "at": "player_snapshot", "dur": 1.0 },
    { "t": 1.00, "do": "clip", "id": "moloch_slam" },
    { "t": 1.00, "do": "hitbox", "shape": { "circle": 4 }, "at": "player_snapshot", "dmg": 0.30 },
    { "t": 1.00, "do": "fx", "id": "lava_crater", "at": "player_snapshot" },
    { "t": 1.00, "do": "shake", "trauma": 0.6 },
    { "t": 1.00, "do": "sfx", "id": "slam_heavy" },
    { "t": 1.05, "do": "projectiles", "pattern": "radial", "count": 8, "speed": 7, "kind": "molten_rock" },
    { "t": 1.10, "do": "vulnerable", "dur": 1.6 }
  ]
}
```
- `dmg` боссов — в долях HP героя при ожидаемой прокачке, пересчитывается по формуле зоны.
- Выбор паттерна: взвешенный рандом без повторов подряд + «колода».
- Сигнатурные механики (Сверхновая, Зеркала, Инверсия, Каэлис) — скриптовые модули поверх таймлайнов.
- **Каэлис:** собирается генератором `hero()` с инвертированной палитрой и материалом «глитч»; управляется тем же контроллером, что и герой, ввод генерирует ИИ, реагирующий на последние приёмы игрока.
- Unit-тест: в каждом паттерне телеграф начинается раньше хитбокса и длится не меньше минимума зоны.

---

## 18. Камера, hitstop, тряска

```ts
export class CameraRig {
  focus = new THREE.Vector3(); trauma = 0; kick = new THREE.Vector2(); zoomPunch = 0;
  private seed = Math.random() * 1000;

  update(dt: number, target: THREE.Vector3, lead: THREE.Vector2, t: number, shakeScale: number, cam: THREE.PerspectiveCamera) {
    const k = 1 - Math.exp(-dt / 0.12);
    this.focus.x += (target.x + lead.x * 1.2 - this.focus.x) * k;
    this.focus.z += (target.z + lead.y * 1.2 - this.focus.z) * k;

    this.trauma = Math.max(0, this.trauma - 1.6 * dt);
    this.kick.multiplyScalar(Math.exp(-dt * 18));
    this.zoomPunch *= Math.exp(-dt * 10);

    const s = this.trauma * this.trauma * shakeScale;
    const ox = 0.35 * s * noise1(this.seed, t * 25) + this.kick.x;
    const oz = 0.35 * s * noise1(this.seed + 100, t * 25) + this.kick.y;

    const dist = 28 / (1 + this.zoomPunch);
    cam.position.set(this.focus.x + ox, dist * Math.sin(0.96), this.focus.z + dist * Math.cos(0.96) + oz);
    cam.lookAt(this.focus.x + ox, 0, this.focus.z + oz);
    cam.rotation.z += 0.02 * s * noise1(this.seed + 200, t * 25);
  }
  addTrauma(v: number) { this.trauma = Math.min(1, this.trauma + v); }
}
```
- Тряска и кик идут в **реальном** времени — при hitstop камера продолжает вздрагивать.
- Босс: фокус = `lerp(герой, босс, 0.35)`, дистанция подбирается, чтобы оба были в 80 % кадра.
- Кат-сцены (появление босса, казни) — сплайновые пролёты камеры, описанные в данных (точки + длительности + эйзинги).

---

## 19. VFX и пост-обработка

### 19.1 GPU-частицы
- Один `InstancedMesh` квадратов на тип смешивания (аддитивный / обычный); атрибуты экземпляра: позиция старта, скорость, время рождения, жизнь, размер, цвет, кадр атласа.
- **Вся симуляция в вершинном шейдере** по формуле от времени (`p = p0 + v·t + ½·g·t²`, затухание, вращение) — CPU только пишет новые частицы в кольцевой буфер.
- Вытягивание по скорости — ориентация квадрата вдоль экранной проекции скорости.
- Эмиттеры описаны данными (`data/vfx/*.json`).

### 19.2 Ленты (шлейф клинка, хвосты снарядов, рывок)
- Кольцевой буфер 12–16 сэмплов пары точек (рукоять, кончик) → сглаживание Катмулла–Рома → лента-меш с UV по длине.
- Шейдер: градиент белая кромка → фиолетовый → прозрачный, аддитивное смешивание, α по возрасту сэмпла.

### 19.3 Прочие эффекты
| Эффект | Техника |
|---|---|
| Ударная волна | плоское кольцо-меш с шейдером + запись кольца в буфер искажений для поста |
| Молния | ломаная midpoint displacement (5–6 уровней), ветвления, рендер лентами, перегенерация каждые 50 мс |
| Телеграфы | декаль-квад на полу, SDF-форма (круг/конус/линия/кольцо/дуга) в шейдере, `uProgress` заполняет от центра |
| Световое пятно | аддитивный квад с радиальным градиентом, инстансы |
| Сингулярность | диск-шейдер (чёрный центр, кольцо аккреции из шума) + частицы по спирали + сильное локальное искажение |
| Портал | обратное растворение + кольцо красных молний |

```glsl
// телеграф-круг (фрагмент)
uniform float uProgress, uTime; uniform vec3 uColor; varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  if (r > 1.0) discard;
  float edge = smoothstep(0.93, 0.97, r) * (0.6 + 0.4 * sin(uTime * 20.0));
  float fill = step(r, uProgress) * 0.35 + smoothstep(uProgress - 0.04, uProgress, r) * step(r, uProgress) * 0.6;
  float a = edge + fill;
  gl_FragColor = vec4(uColor * a, a);
}
```

### 19.4 Пост-обработка
- **Bloom:** порог яркости → даунсемпл ½ → ¼ → размытие (Kawase/dual-filter) → сложение. Свой лёгкий вариант вместо `UnrealBloomPass` (он тяжёл для мобильных).
- **Uber-шейдер** (один полноэкранный проход): искажения волн, хроматическая аберрация (по событию), обесцвечивание «Мгновения Пустоты» (сохраняет фиолетовый и красный оттенок), цветокоррекция кривыми по зоне, виньетка, зерно.
- **Туман по высоте и дистанции** — в материалах (не в посте): фон тонет в цвете тумана зоны, арена чёткая.
- Цветокоррекция без LUT-текстур: параметрические кривые (lift/gamma/gain + насыщенность + сдвиг оттенка) в униформах; смена пресета плавная (Молох «гасит звезду»).

---

## 20. Небо, фон и глубина

### 20.1 Небо
Полноэкранный квад на дальней плоскости, шейдер:
- туманность: fbm-шум 5 октав по направлению взгляда, два цвета зоны, домен-варпинг для «клубов»;
- звёзды: хэш по ячейкам сетки + мерцание;
- чёрное солнце / луна: диск + корона (радиальный шум, анимированный), в зоне 5 занимает полнеба и пульсирует по событию `beat`;
- молнии в туманности: вспышка яркости в случайной точке + ветвистая маска.

```glsl
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
vec3 sky(vec3 dir) {
  vec2 uv = dir.xy / (dir.z + 1.2);
  vec2 w = uv + 0.6 * vec2(fbm(uv * 2.0 + uTime * 0.01), fbm(uv * 2.0 - 3.1));
  float n = fbm(w * 1.6);
  vec3 col = mix(uDeep, uNebula, smoothstep(0.35, 0.8, n)) + uNebula2 * pow(n, 4.0);
  col += starField(uv * 120.0);
  col = blackSun(uv, col);
  return col;
}
```

### 20.2 Слои глубины
| Слой | Дистанция | Что | Оптимизация |
|---|---|---|---|
| Небо | ∞ | шейдер | 1 проход |
| Дальние шпили | 300–600 м | `spire()` низкой детализации | 1 слитый меш, только силуэт + туман |
| Парящие руины | 80–200 м | `floatingRuin()`, мосты | инстансы, дрейф в вершинном шейдере |
| Туман | 20–60 м | 3–4 полупрозрачных плоскости с шумом | дешёвый скролл |
| Края арены | 0–15 м | колонны, свечи, статуи, стены | слитые меши + инстансы |
| Передний план | между камерой и ареной | цепи, шпили, решётки | затемнены; рядом с героем — дизеринг-прозрачность |
| Атмосфера | экран | пепел, пыль, снег | GPU-частицы в объёме вокруг камеры |

---

## 21. Процедурный звук и музыка

### 21.1 Граф
```
Инструменты/SFX-голоса ─► sfxBus ──┐
Голос Каэлис/боссов    ─► voiceBus ├─► master ─► compressor ─► destination
Секвенсор (слои A–E)   ─► musicBus(lowpass, gain) ─┘
                             ▲            ▲
             sidechain-ducking│            └── reverbSend ─► Convolver (импульс из кода)
```

### 21.2 Строительные блоки
```ts
export function noiseBuffer(ctx: BaseAudioContext, sec = 1) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export function makeImpulse(ctx: BaseAudioContext, sec = 3, decay = 2.6) {
  const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;   // «соборная» реверберация без единого файла
}

export function impact(ctx: AudioContext, out: AudioNode, t: number, heavy: boolean) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(heavy ? 130 : 240, t);
  o.frequency.exponentialRampToValueAtTime(42, t + (heavy ? 0.35 : 0.14));
  g.gain.setValueAtTime(heavy ? 1 : 0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.5 : 0.2));
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.6);
  noiseHit(ctx, out, t, 0.02, 3500, heavy ? 0.8 : 0.5);   // транзиент-щелчок
  glassTail(ctx, out, t + 0.01, heavy ? 5 : 3);           // «осколки»: короткие высокие синусы
}

const BELL = [0.56, 0.92, 1.19, 1.71, 2.0, 2.74, 3.0, 3.76, 4.07];
export function bell(ctx: AudioContext, out: AudioNode, t: number, f0: number) {
  BELL.forEach((r, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f0 * r;
    g.gain.setValueAtTime(0.25 / (i + 1), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4 / (1 + i * 0.4));
    o.connect(g).connect(out); o.start(t); o.stop(t + 4.5);
  });
}
```

**Хор (формантный синтез):** 4–6 голосов аккорда, каждый — пила + лёгкое вибрато (5 Гц, ±12 центов) → три параллельных `BiquadFilter` типа bandpass на формантах гласной (например, «а»: 800 / 1150 / 2900 Гц, Q ≈ 8–12) → медленная смена гласных а→о→у.

**Орган:** сумма синусов на гармониках 1, 2, 3, 4, 6, 8 с весами «регистров» + тремоло 6 Гц.

### 21.3 Запекание
На мобильных одновременное число узлов Web Audio ограничивает производительность. Поэтому:
- ударные, колокола, удары, хоровые аккорды каждой зоны рендерятся в `AudioBuffer` через **`OfflineAudioContext`** при загрузке зоны (в фоне, ~100–200 мс);
- в бою эти звуки — дешёвое воспроизведение буферов с вариацией высоты (`playbackRate`) и фильтра;
- «живыми» остаются только модулируемые вещи: фильтр музыки, pitch-down «Мгновения Пустоты», сердцебиение.

### 21.4 Секвенсор
Классическая схема «двух часов»: таймер JS планирует ноты чуть вперёд по точному времени `AudioContext`.
```ts
const LOOKAHEAD = 0.12, TICK_MS = 25;
let next = ctx.currentTime + 0.05, step = 0;
setInterval(() => {
  while (next < ctx.currentTime + LOOKAHEAD) {
    song.schedule(step, next);                 // все слои; громкость слоя = интенсивность боя
    if (step % 4 === 0) bus.emit({ type: 'beat', bar: (step / 16) | 0, beat: (step / 4) % 4 });
    next += 60 / song.bpm / 4; step++;
  }
}, TICK_MS);
```
- Паттерны (ноты, ритмы, аккорды, вариации) — в `data/music/*.json`; слои A–E включаются кроссфейдом по интенсивности (GDD §18.3).
- Переход фаз босса — на ближайшем такте.
- Событие `beat` синхронизирует фон (пульс чёрного солнца, вспышки разломов) с музыкой.

### 21.5 Ограничения браузера
- `AudioContext` создаётся/возобновляется по первому касанию (экран «Нажмите, чтобы начать»).
- `visibilitychange` → `suspend()`, возврат → `resume()`; секвенсор при этом пересинхронизирует `next`.
- iOS: в беззвучном режиме Web Audio может молчать — подсказка в настройках звука.

---

## 22. Процедурный UI

- **HUD** — отдельный `<canvas>` с Canvas 2D поверх WebGL (учёт DPR), перерисовка только изменившихся областей; полосы, ромбы, рамки, КД-сектора рисуются примитивами.
- **Иконки способностей** — векторные пути в коде (Path2D-описания): полумесяц, спираль, око, звезда, разлом, коса, клинки. Рисуются с золотой обводкой и фиолетовым свечением (`shadowBlur`), кэшируются в offscreen-канвасы.
- **Заголовочный шрифт** — процедурный штриховой: каждый глиф (А–Я, A–Z, 0–9, знаки) задан массивом отрезков/дуг в единичном квадрате; рендер — гранёными «клинковыми» штрихами (каждый штрих — вытянутый ромб) с градиентом. Анимация появления — штрихи прорисовываются по очереди.
- **Обычный текст** — системный шрифт с засечками: `Georgia, "Noto Serif", "Times New Roman", serif`.
- **Цифры урона** — в WebGL: атлас глифов, сгенерированный при старте через `fillText`, инстанс-квады (пул 64).
- **Меню и хаб** — DOM + SVG, сгенерированные кодом (карта созвездий: звёзды-узлы, линии, свечение через SVG-фильтры); фон меню — та же 3D-сцена с медленным пролётом камеры.
- **Иконки PWA** — рендерятся скриптом сборки из того же кода (ромб с клинком), так что даже они не являются «внешним ассетом».
- Настройка раскладки кнопок — перетаскивание в режиме редактирования, сохранение в профиль.

---

## 23. Данные и конфиги

- JSON-конфиги, валидация `zod`, горячая перезагрузка через Vite HMR.
- Пресеты генераторов зон (`data/zones/z1.json`): палитра, параметры колонн/шпилей, плотность декора, цвет тумана, пресет неба, частицы атмосферы.
- Клипы анимаций (`data/clips/*.json`) — экспорт из встроенного редактора поз.
- Музыка (`data/music/*.json`) — паттерны и параметры инструментов.
- Баланс: CSV → `tools/sheets-to-json.ts` → `data/`.

```ts
export const ZonePresetSchema = z.object({
  id: z.string(),
  palette: z.object({ fog: z.string(), nebula: z.tuple([z.string(), z.string()]), veins: z.string() }),
  sky: z.object({ preset: z.enum(['nebula_moon', 'red_star', 'pale_snow', 'orbits', 'black_sun']) }),
  kit: z.object({
    column: z.object({ height: z.tuple([z.number(), z.number()]), sides: z.number().int(), chip: z.number() }),
    spire:  z.object({ tiers: z.tuple([z.number(), z.number()]), ruin: z.number() }),
    density: z.number(),
  }),
  atmosphere: z.object({ particles: z.enum(['dust', 'embers', 'snow', 'stardust', 'void_flakes']), count: z.number() }),
});
```

---

## 24. Сохранения

```ts
interface SaveV1 {
  version: 1;
  createdAt: number; updatedAt: number;
  currencies: { shards: number; ether: number };
  stats: { power: number; agility: number; fortitude: number; resonance: number };
  abilities: Record<string, { level: 1 | 2 | 3; mutation?: 'A' | 'B' }>;
  loadout: { weapon: string; q: string; e: string; r: string; relics: string[] };
  weapons: Record<string, { unlocked: boolean; level: number }>;
  cosmetics: { skin: string; unlocked: string[] };       // процедурные пресеты облика
  relics: string[];
  stages: Record<string, { stars: 0 | 1 | 2 | 3; bestRank: string; bestTime: number; clears: number }>;
  bosses: Record<string, { defeated: boolean; awakened?: boolean; attempts: number }>;
  settings: Settings;
  flags: Record<string, boolean>;
}
```
- IndexedDB + резерв в localStorage, запись после этапа и покупки (дебаунс 1 с), миграции по `version`, запись через временный ключ + контрольная сумма.
- Экспорт/импорт строкой (base64) для переноса между устройствами.

---

## 25. Производительность

### 25.1 Уровни качества
| Параметр | Низкое | Среднее | Высокое |
|---|---|---|---|
| Разрешение рендера | 0.6× DPR (макс 1.0) | 0.8× | 1.0× (макс DPR 2) |
| Bloom | нет (усиленная эмиссия) | ½, 1 уровень | ½ + ¼ |
| Отражения на полу | нет | нет | да |
| Карта теней | нет | нет | герой + босс |
| Декор (плотность) | 40 % | 70 % | 100 % |
| Дальние слои | шпили + небо | + руины | все |
| Частицы | 1 500 | 2 500 | 4 000 |
| Верле (итерации) | 2 | 3 | 4 |
| Цель FPS | 30 | 60 | 60 |

### 25.2 Авто-подстройка
- Замер первых 5 с боя; затем скользящее среднее каждые 2 с.
- p90 кадра > 20 мс → динамическое разрешение −0.1 (мин 0.5), затем уровень качества вниз; стабильно < 12 мс 10 с → вверх.

### 25.3 Практики
- Слияние статики по материалам, инстансинг повторяющегося, один материал «Обсидиан» с униформами вместо десятков материалов.
- Матрицы инстансов обновляются только у видимых и движущихся объектов (`frustum` + флаг «спит»).
- Генерация в Web Worker; на главном потоке — только создание `BufferGeometry` из готовых массивов.
- Ноль аллокаций в горячем цикле; переиспользуемые `Vector3/Quaternion`.
- Освобождение ресурсов зоны (`geometry.dispose()`, `texture.dispose()`) при выходе; в памяти не больше 2 зон.
- Профилирование на реальных устройствах: Chrome Remote DevTools, Safari Web Inspector, `renderer.info` в dev-оверлее.

---

## 26. Мобильная специфика

| Задача | Решение |
|---|---|
| Ландшафт | Android — `screen.orientation.lock('landscape')` после fullscreen; iOS — оверлей «Поверните устройство» |
| Полный экран | Fullscreen API (Android); iOS — установка PWA на главный экран |
| Вырезы экрана | `viewport-fit=cover` + `env(safe-area-inset-*)` для HUD |
| Жесты браузера | `touch-action: none`, `overscroll-behavior: none`, без выделения и контекстного меню |
| Пауза | `visibilitychange` / `pagehide` → пауза, сохранение, `audioCtx.suspend()` |
| Сон экрана | Screen Wake Lock API во время боя |
| Нагрев/батарея | режим 30 FPS, авто-снижение качества в долгих сессиях |
| Потеря WebGL-контекста | `webglcontextlost/restored` → **перегенерация** геометрии и текстур по тем же сидам (внешних файлов нет, перезагружать нечего), возврат в паузу |
| Память iOS | ≤ 2 зоны в памяти, `dispose()` при выходе |

---

## 27. PWA, сборка, деплой

- `vite build` → чанки: `core` (меню + бой + общие генераторы), `zone-1..5` (пресеты, генераторы, музыка), `bosses-*` — подгружаются лениво, но всё вместе ≤ 2 МБ.
- Service Worker (Workbox): precache всего бандла — после первого запуска игра полностью офлайн.
- Хостинг: любой статический CDN (Vercel, Netlify, Cloudflare Pages), `immutable` для хэшированных файлов, Brotli.
- CI: lint → typecheck → unit-тесты → сборка → Playwright-смоук (загрузка, этап 1-1, 30 с бота, скриншот сцены для визуального регресса) → превью-деплой.

---

## 28. Инструменты, тесты, телеметрия

### 28.1 Встроенные инструменты (dev-сборка)
| Инструмент | Что делает |
|---|---|
| **Галерея генераторов** | любой генератор с крутилками параметров и сидом, кнопка «сохранить пресет» |
| **Редактор поз** | персонаж, суставы-ручки, таймлайн ключей, эйзинги, предпросмотр с хитбоксами и шлейфом, экспорт клипа |
| **Синт-лаборатория** | рецепты SFX и инструментов с крутилками, прослушивание, экспорт пресета |
| **Секвенсор-превью** | слои музыки зоны, ползунок интенсивности |
| **Босс-таймлайн** | шкала текущей атаки, принудительный паттерн, переход к фазе |
| **Оверлей** (`~`) | FPS, кадр, draw calls, треугольники, частицы, тела, хитбоксы, токены, flow field |
| **Читы** | бессмертие, ×10 урон, валюта, выбор этапа, замедление |

### 28.2 Тесты
- Unit: формулы урона, экономика, миграции, буфер ввода, IK, Верле (стабильность), детерминизм генераторов (сид → хэш геометрии не меняется без умысла), таймлайны боссов.
- Автобаланс: headless-бой «бот vs этап» → время и потерянное HP в отчёт.
- E2E (Playwright): загрузка, меню, этап, сохранение; скриншот-сравнение арены по фиксированному сиду.

### 28.3 Телеметрия
События пачками раз в 30 с и на `pagehide` (`sendBeacon`): `stage_start`, `stage_end`, `death{source,x,z}`, `boss_phase_reached`, `perf_sample{fps,quality,device}`.

---

## 29. Роадмап

| Этап | Длительность (2–4 чел.) | Результат |
|---|---|---|
| **0. Прототип ощущений** | 3–4 нед. | герой из призм (простой риг), рывок, комбо, hitstop, тряска, шлейф, Жнец и Голем, синт-заглушки звуков |
| **1. Процедурные киты** | 4–5 нед. | материал «Обсидиан», генераторы героя и 5 врагов, кит окружения зоны 1, небо, пол, bloom, редактор поз, синтезаторы зоны 1 |
| **2. Вертикальный срез** | 6–8 нед. | зона 1 целиком: 6 этапов, Иерофант, 4 способности, прокачка, генеративная музыка, PWA |
| **3. Альфа** | 10–12 нед. | зоны 2–3, Молох, Сестра, оружие, реликвии |
| **4. Бета** | 8–10 нед. | зоны 4–5, Ткач, Архонт/Каэлис, Кошмар, оптимизация под слабые устройства |
| **5. Релиз 1.0** | 4 нед. | полировка, RU/EN, телеметрия |
| **6. Пост-релиз** | — | Пробуждённые, Ненасытный, Бездна, процедурная косметика |

**Порядок внутри прототипа:**
1. Цикл + время + hitstop.
2. Движение + рывок + буфер ввода.
3. Комбо с клипами-позами + шлейф.
4. Профили ощущений (тряска, кик, вспышка, частицы, синт-удар).
5. Жнец с телеграфом → идеальное уклонение.
6. Голем со стойкой → казнь.
7. Плейтест на телефоне — только после этого полировка генераторов.

---

## 30. Риски

| Риск | Вероятность | Митигирование |
|---|---|---|
| Процедурный арт выглядит как «программистская заглушка» | высокая | жёсткие правила стиля (GDD §17.2), ранний упор на свет, bloom, туман и эмиссию; галерея генераторов для итераций; сравнение со скриншотами-референсами |
| Производительность на слабых Android | высокая | инстансинг, слияние, свой лёгкий bloom, авто-качество, ранний профайлинг на устройстве |
| Синтезированная музыка звучит «дёшево» | средняя | реверберация, слои, сатурация, запекание с обработкой; мастер-компрессор; итерации в синт-лаборатории |
| Процедурные анимации выглядят «деревянно» | средняя | сильные эйзинги, squash/stretch, пружины, остаточные изображения, шлейфы; редактор поз для ручной полировки |
| iOS Safari: аудио, fullscreen, память | высокая | PWA, экран-старт для аудио, ≤ 2 зоны в памяти, перегенерация при потере контекста |
| Время генерации на слабых устройствах | средняя | Web Worker, кэш в памяти, снижение плотности декора на низком качестве |
| Разрастание скоупа | высокая | вертикальный срез = контрольная точка «go/no-go» |
