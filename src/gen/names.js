// Name generation. Cities and clubs are assembled from per-nation syllable
// pools; people are drawn from per-nation pools with occasional compounding
// so large worlds do not feel repetitive.

import { NATION_BY_ID } from '../data/nations.js';

function syllableCity(rng, nation) {
  const s = nation.citySyl;
  const start = rng.pick(s.start);
  const mid = rng.chance(0.45) ? rng.pick(s.mid) : '';
  const end = rng.pick(s.end);
  let name = `${start}${mid}${end}`;
  // Tidy up awkward joins.
  name = name.replace(/([a-z])\1\1+/g, '$1$1');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function makeCityNamer(rng, nationId) {
  const nation = NATION_BY_ID[nationId];
  const used = new Set();
  const signature = rng.shuffle([...nation.signatureCities]);
  let sigIndex = 0;
  return () => {
    if (sigIndex < signature.length) {
      const s = signature[sigIndex++];
      used.add(s);
      return s;
    }
    for (let i = 0; i < 60; i++) {
      const n = syllableCity(rng, nation);
      if (!used.has(n) && n.length > 3) {
        used.add(n);
        return n;
      }
    }
    let n = syllableCity(rng, nation);
    let suffix = 2;
    while (used.has(n)) n = `${syllableCity(rng, nation)} ${suffix++}`;
    used.add(n);
    return n;
  };
}

/**
 * Club namer with affix decks so a nation's clubs vary instead of clustering
 * on whichever suffix the RNG happens to favour.
 */
export function makeClubNamer(rng, nationId) {
  const nation = NATION_BY_ID[nationId];
  let preDeck = [];
  let postDeck = [];
  const draw = (deck, source) => {
    if (deck.length === 0) deck.push(...rng.shuffle([...source]));
    return deck.pop();
  };
  const used = new Set();
  return (city) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const pre = draw(preDeck, nation.clubAffix.pre);
      let post = draw(postDeck, nation.clubAffix.post);
      // A prefix and a suffix together reads clumsily in most cultures.
      if (pre && post && !rng.chance(0.15)) post = '';
      let name = `${pre}${city}${post ? ` ${post}` : ''}`.trim();
      if (!pre && !post) name = `${city} FC`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    const fallback = `${city} FC`;
    used.add(fallback);
    return fallback;
  };
}

export function makeClubName(rng, nationId, city) {
  return makeClubNamer(rng, nationId)(city);
}

/** Short name for tables: strips common affixes, caps at ~12 chars. */
export function shortenClubName(name) {
  const stripped = name
    .replace(/^(Real|Atlético|Deportivo|Sporting|Racing|CD|UD|CF|AC|US|AS|FC|SC|VV|AZ|PSV|IF|IK|FK|BK|CA|Club|EC|CR|SV|VfB|TSV|1\. FC|RC|Royal)\s+/i, '')
    .replace(/\s+(FC|CF|SAD|Calcio|IL|BK|1908|1919|04|96|1900|'34)$/i, '')
    .trim();
  const base = stripped || name;
  return base.length <= 14 ? base : base.slice(0, 13) + '.';
}

/** Three-letter code for compact tables. */
export function clubCode(name, taken) {
  const words = name.replace(/[^A-Za-zÀ-ſ ]/g, '').split(/\s+/).filter(Boolean);
  const candidates = [];
  if (words.length >= 3) candidates.push(words.slice(0, 3).map((w) => w[0]).join('').toUpperCase());
  if (words.length >= 2) candidates.push((words[0].slice(0, 2) + words[1][0]).toUpperCase());
  const main = words[words.length - 1] || name;
  candidates.push(main.slice(0, 3).toUpperCase());
  candidates.push(words[0].slice(0, 3).toUpperCase());
  for (const c of candidates) {
    if (c.length === 3 && !taken.has(c)) {
      taken.add(c);
      return c;
    }
  }
  let base = (words[0] || 'CLB').slice(0, 2).toUpperCase();
  for (let i = 0; i < 26; i++) {
    const c = base + String.fromCharCode(65 + i);
    if (!taken.has(c)) {
      taken.add(c);
      return c;
    }
  }
  const fallback = `C${taken.size % 100}`.padEnd(3, 'X');
  taken.add(fallback);
  return fallback;
}

export function makePersonName(rng, nationId) {
  const nation = NATION_BY_ID[nationId];
  const first = rng.pick(nation.firstNames);
  let last = rng.pick(nation.surnames);
  // Double-barrelled surnames in Iberian/Latin cultures.
  if (['CAS', 'LUS', 'PLA', 'VER'].includes(nationId) && rng.chance(0.14)) {
    last = `${last} ${rng.pick(nation.surnames)}`;
  }
  // Verdenian players often go by a single name.
  if (nationId === 'VER' && rng.chance(0.22)) {
    return { first: '', last: first, display: first, full: `${first} ${last}` };
  }
  return { first, last, display: `${first[0]}. ${last}`, full: `${first} ${last}` };
}

const MANAGER_STYLES = [
  'Tactician', 'Motivator', 'Disciplinarian', 'Youth Developer', 'Tinkerman', 'Pragmatist', 'Idealist',
];

export function makeManagerName(rng, nationId) {
  const n = makePersonName(rng, nationId);
  return { ...n, style: rng.pick(MANAGER_STYLES) };
}

const STADIUM_SUFFIX = {
  ALB: ['Park', 'Road', 'Stadium', 'Lane', 'Ground', 'Arena'],
  CAS: ['Estadio', 'Coliseo', 'Campo'],
  LOM: ['Stadio', 'Arena'],
  ALE: ['Arena', 'Stadion', 'Park'],
  GAL: ['Stade', 'Parc'],
  BAT: ['Stadion', 'Arena'],
  LUS: ['Estádio', 'Parque'],
  NOR: ['Stadion', 'Arena', 'Park'],
  PLA: ['Estadio', 'Coliseo'],
  VER: ['Arena', 'Estádio'],
};

const STADIUM_QUALIFIER = ['Old', 'New', 'North', 'Victory', 'Union', 'Central', 'Riverside', 'Highfield', 'Memorial'];

export function makeStadiumName(rng, nationId, city) {
  const suffixes = STADIUM_SUFFIX[nationId] || ['Stadium'];
  const suffix = rng.pick(suffixes);
  if (['Estadio', 'Stadio', 'Stade', 'Estádio', 'Parc', 'Parque'].includes(suffix)) {
    return `${suffix} ${city}`;
  }
  if (rng.chance(0.35)) return `${rng.pick(STADIUM_QUALIFIER)} ${suffix}`;
  return `${city} ${suffix}`;
}
