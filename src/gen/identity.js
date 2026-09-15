// Club visual identity: a pixel crest and a pixel kit, generated from the world
// seed and committed to nothing.
//
// Everything here renders to SVG rather than a canvas. That is a deliberate
// choice and not just a stylistic one: SVG needs no browser to produce, so the
// generator is an ordinary pure function that the test suite can call and read
// back, and one string serves every size a screen asks for because the viewBox
// scales. A canvas would have meant a rendering context in the tests and a
// re-render per size.
//
// The pixel look is real, not a filter: shapes are laid out on a 16x16 integer
// grid and emitted as merged runs of rects with crisp edges.

import { clamp } from '../core/util.js';

const GRID = 16;

// --- Colour -----------------------------------------------------------------

function hsl(h, s, l) {
  // h 0-360, s and l 0-1. Returns #rrggbb.
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Perceived lightness, used to decide what will read against a colour. */
function luma(h, s, l) {
  // Yellows and greens read far lighter than blues at the same HSL lightness,
  // so a plain lightness test puts black text on navy and white on gold.
  const weight = 0.85 + 0.35 * Math.cos(((h - 80) * Math.PI) / 180);
  return clamp(l * weight, 0, 1);
}

/**
 * A club's three colours. Primary carries the identity, secondary has to read
 * against it at 18 pixels, and trim is a related accent for crest detail.
 */
export function paletteFor(identity) {
  const { hue, sat, light, scheme } = identity;
  const primary = hsl(hue, sat, light);
  const dark = luma(hue, sat, light) > 0.52;
  // Scheme decides what the contrasting colour actually is. A white-on-claret
  // club and a gold-on-claret club are recognisably different sides.
  let secondary;
  if (scheme === 0) secondary = dark ? hsl(hue, 0.35, 0.12) : hsl(hue, 0.18, 0.96);
  else if (scheme === 1) secondary = dark ? hsl((hue + 200) % 360, 0.5, 0.16) : hsl((hue + 40) % 360, 0.85, 0.62);
  else secondary = dark ? hsl(hue, 0.6, 0.18) : hsl(hue, 0.5, 0.9);
  const trim = dark ? hsl((hue + 25) % 360, 0.55, 0.26) : hsl((hue + 25) % 360, 0.7, 0.78);
  return { primary, secondary, trim };
}

// --- Shapes -----------------------------------------------------------------

/** Half-width of a shield outline at row y, as a fraction of the grid. */
const SHIELD_SHAPES = {
  // A classic heater: square shoulders falling to a point.
  heater: (t) => (t < 0.62 ? 1 : 1 - Math.pow((t - 0.62) / 0.38, 1.5)),
  // A rounded disc, the continental style.
  round: (t) => Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.5) / 0.5, 2))),
  // Narrow shoulders, long point.
  pointed: (t) => (t < 0.3 ? 0.9 : 0.9 * (1 - Math.pow((t - 0.3) / 0.7, 1.25))),
  // A banner with a swallowtail notch.
  banner: (t) => (t < 0.78 ? 0.92 : (t < 0.9 ? 0.92 : 0.5)),
};
const SHIELD_KEYS = Object.keys(SHIELD_SHAPES);

/**
 * Charges, as pixel sprites. '.' is empty, 'x' the charge colour.
 *
 * These are 7x7 rather than the 5x5 they started as. A league table draws a
 * crest at eighteen pixels, and at that size a five-cell charge inside a
 * sixteen-cell shield is three or four screen pixels of detail - it turned to
 * mush, and every crest in a division read as a coloured blob. The charge has to
 * be a large fraction of the shield to survive being shrunk.
 */
const CHARGES = {
  star:   ['...x...', '...x...', '.xxxxx.', '..xxx..', '..xxx..', '.xx.xx.', '.x...x.'],
  ball:   ['.xxxxx.', 'xx...xx', 'x..x..x', 'x.xxx.x', 'x..x..x', 'xx...xx', '.xxxxx.'],
  crown:  ['x..x..x', 'x.xxx.x', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '.xxxxx.', '..xxx..'],
  tower:  ['x.x.x.x', 'xxxxxxx', '.xxxxx.', '.xxxxx.', '.xxxxx.', 'xxxxxxx', 'xxxxxxx'],
  bird:   ['..x.x..', '.xxxxx.', 'xxxxxxx', 'xxxxxxx', '.xx.xx.', '.x...x.', 'x.....x'],
  anchor: ['..xxx..', '..x.x..', '.xxxxx.', '..xxx..', 'x.xxx.x', 'xx.x.xx', '.xxxxx.'],
  oak:    ['..xxx..', '.xxxxx.', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...', '..xxx..'],
  bolt:   ['....xx.', '...xx..', '..xxxx.', '.xxxx..', '..xx...', '.xx....', 'xx.....'],
  hammer: ['xxxxx..', 'xxxxx..', 'xxxxx..', '..x....', '..x....', '..x....', '..x....'],
  rose:   ['.x...x.', 'xxx.xxx', '.xxxxx.', 'xxxxxxx', '.xxxxx.', 'xxx.xxx', '.x...x.'],
};
const CHARGE_KEYS = Object.keys(CHARGES);

/** How the crest field is divided behind the charge. */
const FIELDS = ['solid', 'pale', 'fess', 'quarters', 'chevron', 'bend'];

/** Kit patterns. */
export const KIT_PATTERNS = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'quarters', 'chevron'];

// --- Identity ---------------------------------------------------------------

/** Cheap deterministic hash, so an identity can be rebuilt from an id alone. */
function hashId(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Give every club in a division a visual identity, with hues spread around the
 * wheel so no two sides in the same table look alike. Assigning these per
 * division rather than per club is the whole point: picking twenty colour pairs
 * independently at random collides constantly, which is what the game did
 * before - roughly seven clubs in a twenty-team league shared a pair.
 */
export function assignIdentities(rng, clubs) {
  const n = clubs.length;
  if (!n) return;
  // Evenly spaced hue slots, shuffled so the order is not the table order, with
  // jitter small enough that the guaranteed separation survives it.
  const step = 360 / n;
  const jitter = step * 0.24;
  const slots = rng.shuffle(clubs.map((_, i) => i));
  clubs.forEach((club, i) => {
    const h = hashId(club.id);
    const hue = (slots[i] * step + rng.range(-jitter, jitter) + 360) % 360;
    // Deep, saturated colours read better at badge size than pastels.
    const sat = 0.42 + ((h >>> 3) % 45) / 100;
    const light = 0.28 + ((h >>> 9) % 34) / 100;
    club.identity = {
      hue: +hue.toFixed(2),
      sat: +sat.toFixed(3),
      light: +light.toFixed(3),
      scheme: h % 3,
      shield: SHIELD_KEYS[(h >>> 5) % SHIELD_KEYS.length],
      field: FIELDS[(h >>> 11) % FIELDS.length],
      charge: CHARGE_KEYS[(h >>> 15) % CHARGE_KEYS.length],
      kit: KIT_PATTERNS[(h >>> 19) % KIT_PATTERNS.length],
    };
    const pal = paletteFor(club.identity);
    // Kept in step so the tactics pitch and the save's summary card, which read
    // colours directly, never disagree with the crest.
    club.colours = { primary: pal.primary, secondary: pal.secondary };
  });
}

/** Rebuild an identity for a club that predates identities, from its id alone. */
export function fallbackIdentity(club) {
  const h = hashId(club?.id || 'c0');
  return {
    hue: h % 360,
    sat: 0.42 + ((h >>> 3) % 45) / 100,
    light: 0.28 + ((h >>> 9) % 34) / 100,
    scheme: h % 3,
    shield: SHIELD_KEYS[(h >>> 5) % SHIELD_KEYS.length],
    field: FIELDS[(h >>> 11) % FIELDS.length],
    charge: CHARGE_KEYS[(h >>> 15) % CHARGE_KEYS.length],
    kit: KIT_PATTERNS[(h >>> 19) % KIT_PATTERNS.length],
  };
}

// --- Rendering --------------------------------------------------------------

/**
 * Merge each row's equal-coloured cells into runs, then collect the runs of one
 * colour into a single path. A crest is four or five colours over 256 cells, so
 * this is a handful of elements rather than the sixty-odd rects a naive emit
 * produces - which matters because these strings are inlined into a fixture
 * list forty times over.
 */
function cellsToPaths(cells) {
  const byColour = new Map();
  for (let y = 0; y < GRID; y++) {
    let x = 0;
    while (x < GRID) {
      const c = cells[y][x];
      if (!c) { x++; continue; }
      let w = 1;
      while (x + w < GRID && cells[y][x + w] === c) w++;
      const d = byColour.get(c) || [];
      d.push(`M${x} ${y}h${w}v1h-${w}z`);
      byColour.set(c, d);
      x += w;
    }
  }
  let out = '';
  for (const [colour, parts] of byColour) out += `<path fill="${colour}" d="${parts.join('')}"/>`;
  return out;
}

function blankGrid() {
  return Array.from({ length: GRID }, () => new Array(GRID).fill(null));
}

function svgWrap(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges">${body}</svg>`;
}

/**
 * Which field colour a crest cell takes, before the charge is stamped on.
 *
 * Divisions are held below `solidTo` so the charge always sits on one colour.
 * A charge drawn in a single colour over a split field loses whichever half
 * matches it - a white bird on a half-white shield is half a bird - and
 * counterchanging it cell by cell reads as noise rather than as a shape. A plain
 * band above a divided base is both the legible answer and an ordinary heraldic
 * one: a chief over a per-pale base.
 */
function fieldColour(field, x, y, pal, solidTo) {
  if (y < solidTo) return pal.primary;
  const half = GRID / 2;
  switch (field) {
    case 'pale': return x < half ? pal.primary : pal.secondary;
    case 'fess': return pal.secondary;
    case 'quarters': return x < half ? pal.primary : pal.secondary;
    case 'chevron': return Math.abs(x - half + 0.5) + y > GRID * 0.82 ? pal.secondary : pal.primary;
    case 'bend': return x + y > GRID ? pal.secondary : pal.primary;
    default: return pal.primary;
  }
}

/** The crest as an SVG string. */
export function crestSvg(club) {
  const id = club?.identity || fallbackIdentity(club);
  const pal = paletteFor(id);
  const shape = SHIELD_SHAPES[id.shield] || SHIELD_SHAPES.heater;
  const cells = blankGrid();
  const mid = (GRID - 1) / 2;

  // Where the charge goes is decided first, because the field is drawn solid
  // behind it.
  const sprite = CHARGES[id.charge] || CHARGES.star;
  const sh = sprite.length;
  const sw = sprite[0].length;
  const ox = Math.round(mid - (sw - 1) / 2);
  // Rows where the shield is genuinely wide enough to hold the sprite. A fixed
  // row looked right on a heater and broke on everything else: a round or
  // pointed shield narrows underneath, so the bottom of the charge was clipped
  // and what survived read as a blob rather than a tower or a bird.
  const fits = [];
  for (let y = 1; y < GRID - 1; y++) {
    const inner = shape((y + 0.5) / GRID) * (GRID / 2) - 1;
    if (inner * 2 >= sw - 0.5) fits.push(y);
  }
  let oy = 3;
  if (fits.length) {
    const first = fits[0];
    const last = fits[fits.length - 1];
    oy = Math.max(first, Math.min(last - sh + 1, Math.round((first + last - sh) / 2)));
  }
  const solidTo = oy + sh;

  for (let y = 0; y < GRID; y++) {
    const halfW = shape((y + 0.5) / GRID) * (GRID / 2);
    for (let x = 0; x < GRID; x++) {
      if (Math.abs(x - mid) > halfW) continue;
      // Only the actual outline, not a bar across the top and bottom as well:
      // that cost two of sixteen rows and squeezed the field badly.
      const edge = Math.abs(x - mid) > halfW - 1;
      cells[y][x] = edge ? pal.trim : fieldColour(id.field, x, y, pal, solidTo);
    }
  }

  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      if (sprite[sy][sx] !== 'x') continue;
      const x = ox + sx;
      const y = oy + sy;
      if (x < 0 || x >= GRID || y < 0 || y >= GRID || !cells[y][x]) continue;
      if (cells[y][x] === pal.trim) continue; // never punch through the outline
      cells[y][x] = pal.secondary;
    }
  }
  return svgWrap(cellsToPaths(cells));
}

/** The kit as an SVG string: a shirt silhouette carrying the club's pattern. */
export function kitSvg(club) {
  const id = club?.identity || fallbackIdentity(club);
  const pal = paletteFor(id);
  const cells = blankGrid();

  // Shirt silhouette on the grid: sleeves at the shoulders, body below.
  const bodyL = 4;
  const bodyR = 11;
  for (let y = 2; y < GRID - 1; y++) {
    const sleeve = y >= 3 && y <= 7;
    const left = sleeve ? 1 : bodyL;
    const right = sleeve ? GRID - 2 : bodyR;
    for (let x = left; x <= right; x++) {
      // The collar notch.
      if (y <= 3 && x >= 7 && x <= 8) continue;
      cells[y][x] = patternColour(id.kit, x, y, pal);
    }
  }
  return svgWrap(cellsToPaths(cells));
}

function patternColour(kit, x, y, pal) {
  switch (kit) {
    case 'stripes': return x % 4 < 2 ? pal.primary : pal.secondary;
    case 'hoops': return y % 4 < 2 ? pal.primary : pal.secondary;
    case 'halves': return x < GRID / 2 ? pal.primary : pal.secondary;
    case 'sash': return Math.abs(x + y - GRID) < 2 ? pal.secondary : pal.primary;
    case 'quarters': return (x < GRID / 2) === (y < GRID / 2) ? pal.primary : pal.secondary;
    case 'chevron': return Math.abs(x - GRID / 2 + 0.5) + 6 > y && y > 5 ? pal.secondary : pal.primary;
    default: return pal.primary;
  }
}

// --- Data URIs, memoised ----------------------------------------------------

// A league table draws twenty badges and a fixture list forty, several times a
// session. The rendered string does not depend on the size it is drawn at, so
// one entry per club serves every call site. Runtime only; never persisted.
const crestCache = new Map();
const kitCache = new Map();

function toUri(svg) {
  // Not base64, and not encodeURIComponent either: only the handful of
  // characters that actually break a data URI in an attribute need escaping, and
  // every colour in the markup starts with a '#', so a blanket encoder inflates
  // these strings badly. Readable output is a side benefit when a crest needs
  // debugging.
  const escaped = svg
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/&/g, '%26')
    // Percent-encoded, not swapped for a single quote: the result has to survive
    // both src="..." in HTML and url('...') in a style attribute, and a bare
    // quote of either kind closes one of them. Swapping for "'" silently blanked
    // every kit on the tactics pitch while the crests kept working.
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${escaped}`;
}

export function crestUri(club) {
  if (!club?.id) return toUri(crestSvg(club));
  let v = crestCache.get(club.id);
  if (!v) { v = toUri(crestSvg(club)); crestCache.set(club.id, v); }
  return v;
}

export function kitUri(club) {
  if (!club?.id) return toUri(kitSvg(club));
  let v = kitCache.get(club.id);
  if (!v) { v = toUri(kitSvg(club)); kitCache.set(club.id, v); }
  return v;
}

/** Drop a club's cached art — used when an identity is deliberately changed. */
export function invalidateIdentity(clubId) {
  crestCache.delete(clubId);
  kitCache.delete(clubId);
}
