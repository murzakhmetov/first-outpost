/**
 * 2D simplex noise (after Stefan Gustavson's public-domain reference code),
 * with a seeded permutation table so terrain is the same on every device.
 */
import { mulberry32 } from '../sim/rng';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class Noise2D {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const random = mulberry32(seed);
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) table[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const swap = table[i];
      table[i] = table[j];
      table[j] = swap;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = table[i & 255];
  }

  /** Smooth noise in about [-1, 1]. */
  get(x: number, y: number): number {
    const perm = this.perm;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    let n = 0;
    let a = 0.5 - x0 * x0 - y0 * y0;
    if (a > 0) {
      const g = GRAD[perm[ii + perm[jj]] & 7];
      a *= a;
      n += a * a * (g[0] * x0 + g[1] * y0);
    }
    a = 0.5 - x1 * x1 - y1 * y1;
    if (a > 0) {
      const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
      a *= a;
      n += a * a * (g[0] * x1 + g[1] * y1);
    }
    a = 0.5 - x2 * x2 - y2 * y2;
    if (a > 0) {
      const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7];
      a *= a;
      n += a * a * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  }

  /** Several layers of noise added together ("fractal Brownian motion"). */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amplitude * this.get(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  /** Sharp-crested noise, good for dunes and ridges. In [0, 1]. */
  ridged(x: number, y: number, octaves = 3): number {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.get(x * frequency, y * frequency));
      sum += amplitude * n * n;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / norm;
  }
}

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
