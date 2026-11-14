/**
 * Small seeded random-number tools.
 * The simulation never calls Math.random(): the same seed always gives the same
 * mission, so missions can be replayed, shared and tested.
 */

/** FNV-1a hash of any mix of numbers and strings -> unsigned 32-bit integer. */
export function hash32(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, good-enough generator. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly gen: () => number;

  constructor(seed: number) {
    this.gen = mulberry32(seed);
  }

  /** Float in [0, 1). */
  next(): number {
    return this.gen();
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.gen();
  }

  /** Integer in [min, max], both ends included. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(probability: number): boolean {
    return this.gen() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.gen() * items.length))];
  }

  /** Pick one item, where bigger weights are picked more often. Returns null for an empty list. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | null {
    let total = 0;
    for (const item of items) total += Math.max(0, weight(item));
    if (total <= 0) return items.length ? items[0] : null;
    let roll = this.gen() * total;
    for (const item of items) {
      roll -= Math.max(0, weight(item));
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.gen() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/** A separate, repeatable random stream for one purpose (e.g. "event" in week 4). */
export function stream(seed: number, purpose: string, index = 0): Rng {
  return new Rng(hash32(seed, purpose, index));
}
