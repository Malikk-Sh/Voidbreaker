import * as THREE from 'three';
import { octa } from '../gen/geom/prims';

/** Каэлис (план §8.6): луч-указатель (с), порог «мало HP», раскрытие кольца на ульте (×радиус). */
export const KAELIS = { beam: 0.5, lowHp: 0.3, ringOpen: 4 };

const VIOLET = new THREE.Color('#B794FF');
const RED = new THREE.Color('#E11D2E');
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Живой дрон Каэлис у плеча Пилота (план §8.6) — отдельно от рига героя, чтобы светиться самому:
 * грани пульсируют в такт слогам речи; при оглушении босса и в окне слабого места — луч-указатель 0.5 с;
 * при низком HP мерцает красным; в ульте кольцо раскрывается вокруг Пилота.
 */
export class KaelisDrone {
  readonly group = new THREE.Group();
  private readonly shell: THREE.Mesh;
  private readonly core: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly beamPos: THREE.BufferAttribute;
  private readonly shellU: { uColor: { value: THREE.Color }; uGlow: { value: number } };
  private readonly coreU: { uColor: { value: THREE.Color }; uGlow: { value: number } };
  private readonly ringU: { uColor: { value: THREE.Color }; uGlow: { value: number } };
  private readonly beamU: { uColor: { value: THREE.Color }; uK: { value: number } };
  private clock = 0;
  private syl: [number, number][] = [];
  private beamT = 0;
  private readonly target = new THREE.Vector3();
  private open = 0;
  private red = 0;
  /** Текущая «речь» 0..1 (для тестов и HUD). */
  speech = 0;

  constructor() {
    const mk = (g: THREE.BufferGeometry, add: boolean) => {
      const u = { uColor: { value: VIOLET.clone() }, uGlow: { value: 1 } };
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uGlow; varying vec3 vN; varying vec3 vV;
          void main() {
            // гранёный: плоские грани с разной яркостью, кромка светится
            float f = 0.35 + 0.65 * abs(dot(normalize(vN), normalize(vec3(0.3, 1.0, 0.4))));
            float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
            gl_FragColor = vec4(uColor * (f * 0.5 + rim * 0.8) * uGlow, 1.0);
          }`,
        transparent: add, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !add,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, u };
    };
    const shell = mk(octa(0.085, 0.14, 0.085).toNonIndexed(), false);
    shell.mesh.geometry.computeVertexNormals();
    const core = mk(octa(0.045, 0.075, 0.045).toNonIndexed(), true);
    core.mesh.geometry.computeVertexNormals();
    const ring = mk(new THREE.TorusGeometry(0.12, 0.009, 3, 24), true);
    ring.mesh.rotation.x = Math.PI / 2;
    this.shell = shell.mesh; this.shellU = shell.u;
    this.core = core.mesh; this.coreU = core.u;
    this.ring = ring.mesh; this.ringU = ring.u;
    this.ringU.uColor.value.set('#D9C38A'); // золотое кольцо, как в риге

    // луч-указатель: квад, развёрнутый к камере вокруг своей оси (CPU, 4 вершины)
    const g = new THREE.BufferGeometry();
    this.beamPos = new THREE.BufferAttribute(new Float32Array(12), 3);
    this.beamPos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.beamPos);
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.beamU = { uColor: { value: VIOLET.clone() }, uK: { value: 0 } };
    this.beam = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.beamU,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uK; varying vec2 vUv;
        void main() {
          float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
          float core = pow(across, 6.0), glow = pow(across, 1.5);
          // бегущие вдоль луча блики — «указывает туда»
          float run = 0.75 + 0.25 * sin(vUv.x * 30.0 - uK * 40.0);
          gl_FragColor = vec4((uColor * glow * 0.8 + vec3(1.0) * core) * run * uK, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.beam.renderOrder = 7;
  }

  /** Луч-указатель живёт в сцене отдельно от дрона (в мировых координатах). */
  get beamMesh(): THREE.Mesh { return this.beam; }

  /** Реплика: слоги [начало, длительность] от текущего момента. */
  speak(syllables: [number, number][]): void {
    this.syl = syllables.map(([a, d]) => [this.clock + a, d]);
  }

  /** Луч-указатель на цель (грудь босса, слабое место) на KAELIS.beam с. */
  point(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
    this.beamT = KAELIS.beam;
  }

  /**
   * pos — точка сустава kaelis; hpFrac — доля HP Пилота; ult — идёт «Затмение»; hero — центр Пилота (для кольца);
   * cam — для разворота луча.
   */
  update(dt: number, pos: THREE.Vector3, hpFrac: number, ult: boolean, hero: THREE.Vector3, cam: THREE.Camera): void {
    this.clock += dt;
    const t = this.clock;
    // речь: огибающая слогов (быстрый подъём, спад за слог)
    let sp = 0;
    for (const [a, d] of this.syl) {
      const u = (t - a) / d;
      if (u >= 0 && u <= 1.4) sp = Math.max(sp, u < 0.15 ? u / 0.15 : Math.max(0, 1 - (u - 0.15) / 1.25));
    }
    if (this.syl.length && t > this.syl[this.syl.length - 1][0] + 1) this.syl = [];
    this.speech = sp;
    // мало HP — мерцает красным (неровно, тревожно)
    const low = hpFrac < KAELIS.lowHp ? 1 - hpFrac / KAELIS.lowHp : 0;
    const flick = low > 0 ? (Math.sin(t * 13) > 0.2 - low * 0.6 ? 1 : 0.15) * (0.5 + 0.5 * low) : 0;
    this.red += (flick - this.red) * Math.min(1, dt * 30);
    this.shellU.uColor.value.copy(VIOLET).lerp(RED, this.red);
    this.coreU.uColor.value.copy(VIOLET).lerp(RED, this.red * 0.8);
    this.shellU.uGlow.value = 1 + sp * 1.6;
    this.coreU.uGlow.value = 1.4 + sp * 3.5 + (ult ? 1.5 : 0);
    // грани «дышат» со слогами
    const sc = 1 + sp * 0.22;
    this.shell.scale.set(sc, 1 + sp * 0.1, sc);
    this.shell.position.copy(pos); this.core.position.copy(pos);
    this.shell.rotation.set(Math.sin(t * 0.9) * 0.3, t * (2 + sp * 6), 0);
    this.core.rotation.copy(this.shell.rotation);
    // ульта: кольцо раскрывается и ложится вокруг Пилота на уровне груди
    this.open += ((ult ? 1 : 0) - this.open) * Math.min(1, dt * (ult ? 5 : 3));
    const r = 1 + (KAELIS.ringOpen - 1) * this.open;
    this.ring.position.copy(pos).lerp(_v.set(hero.x, hero.y + 1.25, hero.z), this.open);
    this.ring.scale.setScalar(r);
    this.ring.rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.15 * (1 - this.open), 0, t * (0.6 + this.open * 2.4));
    this.ringU.uGlow.value = 1 + this.open * 2.5 + sp * 0.5;
    // луч-указатель
    if (this.beamT > 0) {
      this.beamT = Math.max(0, this.beamT - dt);
      const age = KAELIS.beam - this.beamT;
      this.beamU.uK.value = Math.min(1, age / 0.06) * Math.min(1, this.beamT / 0.15);
      this.beam.visible = true;
      _a.copy(pos); _b.copy(this.target);
      _d.subVectors(_b, _a);
      _v.subVectors(cam.position, _a);
      _s.crossVectors(_d, _v).normalize().multiplyScalar(0.06);
      const P = this.beamPos.array as Float32Array;
      P.set([_a.x - _s.x, _a.y - _s.y, _a.z - _s.z, _b.x - _s.x, _b.y - _s.y, _b.z - _s.z, _b.x + _s.x, _b.y + _s.y, _b.z + _s.z, _a.x + _s.x, _a.y + _s.y, _a.z + _s.z]);
      this.beamPos.needsUpdate = true;
      this.coreU.uGlow.value += 2 * this.beamU.uK.value;
    } else this.beam.visible = false;
  }

  dispose(): void {
    for (const m of [this.shell, this.core, this.ring, this.beam]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }
}
