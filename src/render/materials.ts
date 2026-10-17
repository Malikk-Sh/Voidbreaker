import * as THREE from 'three';
import { hexToLinear } from '../core/math';
import { makeMatcap, makeNoiseTexture } from '../gen/tex/textures';

/** Общие униформы: время, туман, «лунный» свет, пул из 4 точечных источников (Tech §4.2). */
export const MAX_POINT_LIGHTS = 4;

const v3 = (hex: string) => new THREE.Vector3(...hexToLinear(hex));

export const G = {
  uTime: { value: 0 },
  uFogColor: { value: v3('#0d0a18') },
  uFogRange: { value: new THREE.Vector2(40, 260) },
  uFogHeight: { value: new THREE.Vector2(-4, -120) },
  uMoonDir: { value: new THREE.Vector3(-0.4, 0.8, 0.45).normalize() },
  uMoonColor: { value: v3('#5b5480') },
  uHemiTop: { value: v3('#1c1632') },
  uHemiBot: { value: v3('#050308') },
  uPLPos: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Vector4(0, -999, 0, 1)) },
  uPLCol: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uMatcap: { value: null as THREE.Texture | null },
  uNoise: { value: null as THREE.Texture | null },
};

/** Отдельный matcap для пола: тёмное зеркало без жёсткого блика — пол отражает свет, а не «светится». */
export const FLOOR_MATCAP = { value: null as THREE.Texture | null };

export function initSharedTextures(): void {
  G.uMatcap.value = makeMatcap('#2a2440', '#ffffff', 'rgba(140,110,220,0.5)', 256, 0.14);
  FLOOR_MATCAP.value = makeMatcap('#100c1c', 'rgba(170,150,230,0.3)', 'rgba(110,80,200,0.35)', 256, 0.32);
  G.uNoise.value = makeNoiseTexture(256);
}

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aEmissive;
attribute float aJoint;
#ifdef RIGGED
  uniform highp sampler2D uBones;
  attribute vec4 iFx;
#else
  uniform vec4 uFx;
#endif
varying vec3 vColor;
varying float vEmissive;
varying vec3 vWN;
varying vec3 vWP;
varying vec3 vVP;
varying vec4 vFx;
varying float vSeed;
varying vec3 vLocal;

#ifdef RIGGED
mat4 boneMat(int j) {
  int row = gl_InstanceID;
  return mat4(
    texelFetch(uBones, ivec2(j * 4, row), 0),
    texelFetch(uBones, ivec2(j * 4 + 1, row), 0),
    texelFetch(uBones, ivec2(j * 4 + 2, row), 0),
    texelFetch(uBones, ivec2(j * 4 + 3, row), 0));
}
#endif

void main() {
#ifdef RIGGED
  mat4 M = boneMat(int(aJoint + 0.5));
  vFx = iFx;
  vSeed = float(gl_InstanceID) * 0.371;
#else
  mat4 M = modelMatrix;
  #ifdef USE_INSTANCING
    M = modelMatrix * instanceMatrix;
    vSeed = float(gl_InstanceID) * 0.173;
  #else
    vSeed = 0.0;
  #endif
  vFx = uFx;
#endif
  vec4 wp = M * vec4(position, 1.0);
  vWN = normalize(mat3(M) * normal);
  vWP = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vVP = mv.xyz;
  vColor = aColor;
#ifdef USE_INSTANCING_COLOR
  vColor *= instanceColor;
#endif
  vEmissive = aEmissive;
  vLocal = position;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG_COMMON = /* glsl */ `
uniform sampler2D uMatcap;
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
uniform vec3 uEmissiveColor;
uniform vec3 uEmissiveColor2;
uniform float uEmissiveStrength;
uniform float uSpec;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform vec2 uFogHeight;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uHemiTop;
uniform vec3 uHemiBot;
uniform vec4 uPLPos[${MAX_POINT_LIGHTS}];
uniform vec4 uPLCol[${MAX_POINT_LIGHTS}];
varying vec3 vColor;
varying float vEmissive;
varying vec3 vWN;
varying vec3 vWP;
varying vec3 vVP;
varying vec4 vFx;
varying float vSeed;
varying vec3 vLocal;

vec3 emissiveTerm(float e) {
  float a = abs(e);
  vec3 base = e < 0.0 ? uEmissiveColor2 : uEmissiveColor;
  // 0..1 — цветное свечение; 1..2 — сердцевина уходит в белое («раскалённая кромка»)
  vec3 c = mix(base, vec3(1.0) * length(base) * 1.4, smoothstep(1.0, 2.0, a));
  float pulse = 0.78 + 0.22 * sin(uTime * 3.0 + vSeed * 6.28 + vWP.y * 1.7);
  return c * min(a, 2.0) * pulse;
}

float fogAmount() {
  float d = length(vVP);
  float f = smoothstep(uFogRange.x, uFogRange.y, d);
  float h = smoothstep(uFogHeight.x, uFogHeight.y, vWP.y);
  return clamp(max(f, h * 0.92), 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
${FRAG_COMMON}
void main() {
  float flash = vFx.x, dissolve = vFx.y, boost = vFx.z, crack = vFx.w;
  vec3 n = normalize(vWN);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) n = -n;
#endif
  vec3 vn = normalize(mat3(viewMatrix) * n);
  vec3 viewDir = normalize(-vVP);

  // растворение по шуму с яркой кромкой
  float nz = texture2D(uNoise, vLocal.xz * 0.9 + vLocal.y * 0.45 + vSeed).r;
  if (dissolve > 0.001 && nz < dissolve) discard;

  vec3 albedo = vColor;
  // matcap — отражение глянцевого чёрного стекла
  vec3 mx = normalize(vec3(viewDir.z, 0.0, -viewDir.x));
  vec3 my = cross(viewDir, mx);
  vec2 muv = vec2(dot(mx, vn), dot(my, vn)) * 0.495 + 0.5;
  vec3 refl = texture2D(uMatcap, muv).rgb;

  vec3 col = albedo * mix(uHemiBot, uHemiTop, n.y * 0.5 + 0.5);
  col += albedo * uMoonColor * max(dot(n, uMoonDir), 0.0) * 2.2;
  float amax = max(albedo.r, max(albedo.g, albedo.b));
  float metal = smoothstep(0.05, 0.14, amax);
  vec3 specTint = mix(vec3(1.0), albedo / max(amax, 1e-3), metal);
  col += refl * uSpec * specTint * (0.35 + metal * 0.35);

  vec3 camW = cameraPosition - vWP;
  vec3 vdw = normalize(camW);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    vec3 L = uPLPos[i].xyz - vWP;
    float d = length(L);
    float att = clamp(1.0 - d / uPLPos[i].w, 0.0, 1.0);
    att *= att;
    if (att <= 0.0) continue;
    L /= d;
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), vdw), 0.0), 14.0);
    col += uPLCol[i].rgb * att * (diff * (albedo * 3.0 + 0.03) + spec * 0.35);
  }

  float rim = pow(1.0 - max(dot(vn, viewDir), 0.0), uRimPower);
  col += uRimColor * rim * uRimStrength;

  col += emissiveTerm(vEmissive) * uEmissiveStrength * (1.0 + boost);

  // трещины слома стойки — светящиеся швы по ячейкам
  if (crack > 0.001) {
    float edge = texture2D(uNoise, vLocal.xy * 0.7 + vLocal.z * 0.3).g;
    float c = smoothstep(0.12 * crack, 0.0, edge);
    col += uEmissiveColor * c * 3.0 * crack;
  }

  if (dissolve > 0.001) col += uEmissiveColor * smoothstep(dissolve + 0.07, dissolve, nz) * 5.0;

  col = mix(col, vec3(1.6), clamp(flash, 0.0, 1.0));
  col = mix(col, uFogColor, fogAmount());
  gl_FragColor = vec4(col, 1.0);
}
`;

/** «Призрак»: только рим и эмиссия, аддитивно (остаточные изображения, Tech §6.3). */
const FRAG_GHOST = /* glsl */ `
${FRAG_COMMON}
void main() {
  float alpha = vFx.x;
  vec3 n = normalize(vWN);
  vec3 vn = normalize(mat3(viewMatrix) * n);
  vec3 viewDir = normalize(-vVP);
  float rim = pow(1.0 - max(dot(vn, viewDir), 0.0), 1.6);
  vec3 col = uRimColor * (0.25 + rim * 1.6) + emissiveTerm(vEmissive) * 0.5;
  col *= 1.0 - fogAmount();
  gl_FragColor = vec4(col * alpha, 1.0);
}
`;

export interface ObsidianOpts {
  rigged?: boolean;
  ghost?: boolean;
  rim?: string;
  rimStrength?: number;
  rimPower?: number;
  emissive?: string;
  emissive2?: string;
  emissiveStrength?: number;
  spec?: number;
  side?: THREE.Side;
  floor?: boolean;
}

export type ObsidianMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uRimColor: { value: THREE.Vector3 };
    uRimStrength: { value: number };
    uEmissiveColor: { value: THREE.Vector3 };
    uEmissiveColor2: { value: THREE.Vector3 };
    uEmissiveStrength: { value: number };
    uFx: { value: THREE.Vector4 };
    uBones: { value: THREE.Texture | null };
    [k: string]: THREE.IUniform;
  };
};

export function obsidianMaterial(o: ObsidianOpts = {}): ObsidianMaterial {
  const defines: Record<string, string> = {};
  if (o.rigged) defines.RIGGED = '';
  const m = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      ...G,
      uRimColor: { value: v3(o.rim ?? '#6d4bd8') },
      uRimPower: { value: o.rimPower ?? 2.6 },
      uRimStrength: { value: o.rimStrength ?? 0.55 },
      uEmissiveColor: { value: v3(o.emissive ?? '#8B5CF6') },
      uEmissiveColor2: { value: v3(o.emissive2 ?? '#FFB866') },
      uEmissiveStrength: { value: o.emissiveStrength ?? 2.2 },
      uSpec: { value: o.spec ?? 1.0 },
      uFx: { value: new THREE.Vector4(0, 0, 0, 0) },
      uBones: { value: null },
    },
    vertexShader: VERT,
    fragmentShader: o.ghost ? FRAG_GHOST : FRAG,
    side: o.side ?? THREE.FrontSide,
  }) as ObsidianMaterial;
  if (o.floor) m.uniforms.uMatcap = FLOOR_MATCAP;
  if (o.ghost) {
    m.transparent = true;
    m.blending = THREE.AdditiveBlending;
    m.depthWrite = false;
  }
  return m;
}

export function setVec3Hex(v: THREE.Vector3, hex: string, k = 1): void {
  const [r, g, b] = hexToLinear(hex);
  v.set(r * k, g * k, b * k);
}
