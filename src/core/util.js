// Small shared helpers. Deliberately dependency-free.

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Map v from [inMin,inMax] onto [outMin,outMax], clamped. */
export function remap(v, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const t = clamp((v - inMin) / (inMax - inMin), 0, 1);
  return outMin + t * (outMax - outMin);
}

export const sum = (arr, fn = (x) => x) => arr.reduce((a, b) => a + fn(b), 0);
export const mean = (arr, fn = (x) => x) => (arr.length ? sum(arr, fn) / arr.length : 0);

export function sortBy(arr, ...keyFns) {
  return [...arr].sort((a, b) => {
    for (const fn of keyFns) {
      const desc = typeof fn === 'object';
      const f = desc ? fn.key : fn;
      const dir = desc && fn.desc ? -1 : 1;
      const av = f(a);
      const bv = f(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });
}

export function groupBy(arr, keyFn) {
  const out = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

/** Logistic curve — used constantly for "strength A vs strength B" comparisons. */
export function logistic(x, steepness = 1) {
  return 1 / (1 + Math.exp(-x * steepness));
}

/** Probability that A beats B given two strengths and a scale factor. */
export function contest(a, b, scale = 10) {
  return logistic((a - b) / scale);
}

export function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONEY_UNITS = [
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

export function money(amount, currency = '£') {
  const neg = amount < 0;
  let v = Math.abs(Math.round(amount));
  let out = `${v}`;
  for (const [size, suffix] of MONEY_UNITS) {
    if (v >= size) {
      const n = v / size;
      out = `${n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2)}${suffix}`;
      break;
    }
  }
  return `${neg ? '-' : ''}${currency}${out}`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Stable id factory for generated entities. */
export function makeIdFactory(prefix) {
  let n = 0;
  return () => `${prefix}${(++n).toString(36)}`;
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Weighted average of an attribute map given a weight map. */
export function weightedAttrs(attrs, weights) {
  let total = 0;
  let acc = 0;
  for (const key in weights) {
    const w = weights[key];
    total += w;
    acc += (attrs[key] || 1) * w;
  }
  return total > 0 ? acc / total : 1;
}

export function pad(str, len, char = ' ') {
  str = String(str);
  return str.length >= len ? str : str + char.repeat(len - str.length);
}

export function padStart(str, len, char = ' ') {
  str = String(str);
  return str.length >= len ? str : char.repeat(len - str.length) + str;
}
