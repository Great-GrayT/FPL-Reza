/**
 * Seeded randomness. Every simulation, bootstrap, and permutation in this
 * package draws from here, because a p value or a fan chart that changes on
 * refresh cannot be cited, and a shared link has to reproduce exactly what its
 * author saw.
 */

export interface Rng {
  /** Uniform on [0, 1). */
  next(): number;
  /** Integer on [0, bound). */
  int(bound: number): number;
  /** Standard normal, Box-Muller with the spare draw cached. */
  normal(): number;
  /** Poisson count with mean lambda. */
  poisson(lambda: number): number;
}

/** xoshiro128\*\*: four words of state, fast, and good enough for Monte Carlo. */
export function createRng(seed: number): Rng {
  // SplitMix32 expands one seed into the four words xoshiro needs, so seed 1
  // and seed 2 start in genuinely different places rather than adjacent ones.
  let s = seed >>> 0;
  const splitmix = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };

  let a = splitmix();
  let b = splitmix();
  let c = splitmix();
  let d = splitmix();

  const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

  const nextUint = (): number => {
    const result = (Math.imul(rotl(Math.imul(b, 5) >>> 0, 7) >>> 0, 9) >>> 0) >>> 0;
    const t = (b << 9) >>> 0;
    c = (c ^ a) >>> 0;
    d = (d ^ b) >>> 0;
    b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0;
    d = rotl(d, 11);
    return result;
  };

  let spare: number | null = null;

  const next = (): number => nextUint() / 4294967296;

  return {
    next,
    int(bound) {
      if (bound <= 0) return 0;
      return Math.floor(next() * bound);
    },
    normal() {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }
      // A zero draw would send the log to negative infinity, so it is redrawn.
      let u = next();
      while (u === 0) u = next();
      const radius = Math.sqrt(-2 * Math.log(u));
      const angle = 2 * Math.PI * next();
      spare = radius * Math.sin(angle);
      return radius * Math.cos(angle);
    },
    poisson(lambda) {
      if (lambda <= 0) return 0;
      // Knuth's product method below 30, where it is exact and cheap; the
      // normal approximation above it, where the product underflows.
      if (lambda < 30) {
        const limit = Math.exp(-lambda);
        let count = 0;
        let product = next();
        while (product > limit) {
          count += 1;
          product *= next();
        }
        return count;
      }
      const value = Math.round(lambda + Math.sqrt(lambda) * this.normal());
      return value < 0 ? 0 : value;
    },
  };
}

/** A seed derived from a string, so a named scenario is reproducible by its name. */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
