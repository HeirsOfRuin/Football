// Deterministic pseudo-random number generation.
// Every stochastic system in the game draws from an Rng instance so that a
// campaign started from the same seed reproduces exactly.

/** Hash an arbitrary string into a 32-bit seed. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed = Date.now()) {
    this.state = (typeof seed === 'number' ? seed >>> 0 : hashSeed(seed)) || 1;
  }

  /** mulberry32 — small, fast, good enough distribution for a game. */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Pick with weights: items [{...}], weightFn -> number. */
  weighted(items, weightFn) {
    let total = 0;
    const weights = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const w = Math.max(0, weightFn(items[i], i));
      weights[i] = w;
      total += w;
    }
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Fisher-Yates, in place. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Box-Muller normal deviate. */
  normal(mean = 0, sd = 1) {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Normal deviate clamped to a range — the workhorse for attributes. */
  normalClamped(mean, sd, min, max) {
    let n = this.normal(mean, sd);
    let guard = 0;
    while ((n < min || n > max) && guard++ < 12) n = this.normal(mean, sd);
    return Math.min(max, Math.max(min, n));
  }

  /** Serialise so a save file resumes the exact stream. */
  save() {
    return this.state;
  }

  static restore(state) {
    const r = new Rng(1);
    r.state = state >>> 0;
    return r;
  }
}

/** A throwaway stream derived from a parent — used to keep subsystems independent. */
export function subRng(rng, label) {
  return new Rng((rng.save() ^ hashSeed(label)) >>> 0);
}
