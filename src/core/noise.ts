/** Дешёвый градиентный 1D-шум для тряски камеры и «живых» колебаний. */
const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

export function noise1(seed: number, t: number): number {
  const i = Math.floor(t), f = t - i;
  const g0 = hash1(i + seed * 17.13) * 2 - 1, g1 = hash1(i + 1 + seed * 17.13) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return (g0 * f * (1 - u) + g1 * (f - 1) * u) * 2.2;
}

export const hash3 = (x: number, y: number, z: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

export const hash2 = (x: number, y: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
