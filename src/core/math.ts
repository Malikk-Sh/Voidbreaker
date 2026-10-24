export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const remap = (a: number, b: number, c: number, d: number, v: number): number => lerp(c, d, clamp01(invLerp(a, b, v)));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Экспоненциальное сглаживание, не зависящее от частоты кадров: tau — постоянная времени. */
export const damp = (a: number, b: number, tau: number, dt: number): number => lerp(a, b, 1 - Math.exp(-dt / Math.max(1e-5, tau)));

export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleDiff = (a: number, b: number): number => wrapAngle(b - a);
export const dampAngle = (a: number, b: number, tau: number, dt: number): number =>
  a + angleDiff(a, b) * (1 - Math.exp(-dt / Math.max(1e-5, tau)));
/** Угол направления в плоскости пола: dir = (sin θ, cos θ) по (x, z). Совпадает с rotation.y в Three.js. */
export const angleOf = (x: number, z: number): number => Math.atan2(x, z);

export const len2 = (x: number, z: number): number => Math.sqrt(x * x + z * z);
export const dist2 = (ax: number, az: number, bx: number, bz: number): number => len2(bx - ax, bz - az);

export interface V2 { x: number; z: number }
export const v2 = (x = 0, z = 0): V2 => ({ x, z });

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToLinear(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}
