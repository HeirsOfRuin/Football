// Player generation.
//
// The approach: build an attribute *shape* appropriate to the position, nation
// and age, then solve for a single scaling parameter that lands the player on a
// target Current Ability. This keeps generated players internally coherent — a
// 34-year-old centre back has the mentals of a veteran and the legs of one —
// while still hitting the quality level a club deserves.

import { ALL_ATTRS, ATTR_GROUPS, POSITION_WEIGHTS, abilityForPosition, POSITION_GROUP } from '../data/attributes.js';
import { NATION_BY_ID } from '../data/nations.js';
import { makePersonName } from './names.js';
import { clamp, remap } from '../core/util.js';

const GK_ATTRS = new Set(ATTR_GROUPS.goalkeeping);
const OUTFIELD_ONLY = new Set(['finishing', 'longShots', 'crossing', 'dribbling', 'marking', 'tackling', 'heading', 'offTheBall', 'setPieces']);

export const PERSONALITIES = [
  { id: 'model', name: 'Model Professional', req: { professionalism: 18, determination: 15 } },
  { id: 'perfectionist', name: 'Perfectionist', req: { professionalism: 19, ambition: 15 } },
  { id: 'resolute', name: 'Resolute', req: { determination: 18, professionalism: 12 } },
  { id: 'driven', name: 'Driven', req: { determination: 16, ambition: 16 } },
  { id: 'ambitious', name: 'Ambitious', req: { ambition: 16 } },
  { id: 'loyal', name: 'Loyal', req: { loyalty: 17 } },
  { id: 'spirited', name: 'Spirited', req: { determination: 14, pressureHandling: 14 } },
  { id: 'professional', name: 'Fairly Professional', req: { professionalism: 14 } },
  { id: 'balanced', name: 'Balanced', req: {} },
  { id: 'casual', name: 'Casual', req: { professionalism: -8 } },
  { id: 'temperamental', name: 'Temperamental', req: { pressureHandling: -7, dirtiness: 13 } },
  { id: 'mercenary', name: 'Mercenary', req: { loyalty: -6, ambition: 14 } },
  { id: 'unambitious', name: 'Unambitious', req: { ambition: -7 } },
  { id: 'lowdet', name: 'Low Determination', req: { determination: -7 } },
];

export const TRAITS = [
  { id: 'places_shots', name: 'Places Shots', pos: ['ST', 'AMC', 'AML', 'AMR'], effect: { finishAcc: 0.05 } },
  { id: 'shoots_distance', name: 'Shoots From Distance', pos: ['MC', 'AMC', 'DM', 'ML', 'MR'], effect: { longShot: 0.35 } },
  { id: 'killer_balls', name: 'Tries Killer Balls Often', pos: ['MC', 'AMC', 'DM'], effect: { create: 0.07, turnover: 0.05 } },
  { id: 'runs_centre', name: 'Runs With Ball Through Centre', pos: ['AMC', 'MC', 'ST'], effect: { drive: 0.08 } },
  { id: 'runs_flanks', name: 'Runs With Ball Down Flanks', pos: ['AML', 'AMR', 'ML', 'MR', 'DL', 'DR'], effect: { drive: 0.09 } },
  { id: 'cuts_inside', name: 'Cuts Inside From Wing', pos: ['AML', 'AMR'], effect: { finish: 0.08, cross: -0.05 } },
  { id: 'gets_forward', name: 'Gets Forward Whenever Possible', pos: ['DL', 'DR', 'MC', 'DM'], effect: { drive: 0.1, defend: -0.05 } },
  { id: 'stays_back', name: 'Stays Back At All Times', pos: ['DL', 'DR', 'MC', 'DM', 'DC'], effect: { defend: 0.07, drive: -0.12 } },
  { id: 'dives_tackles', name: 'Dives Into Tackles', pos: ['DC', 'DM', 'MC', 'DL', 'DR'], effect: { press: 0.06, foul: 0.3 } },
  { id: 'marks_tight', name: 'Marks Opponent Tightly', pos: ['DC', 'DM', 'DL', 'DR'], effect: { defend: 0.06, foul: 0.1 } },
  { id: 'plays_offside', name: 'Plays Offside Trap', pos: ['DC'], effect: { offside: 0.2 } },
  { id: 'long_throws', name: 'Takes Long Throws', pos: ['DL', 'DR', 'ML', 'MR'], effect: { setPiece: 0.05 } },
  { id: 'rounds_keeper', name: 'Rounds Keeper', pos: ['ST', 'AMC'], effect: { oneOnOne: 0.1 } },
  { id: 'early_cross', name: 'Crosses Early', pos: ['DL', 'DR', 'ML', 'MR', 'AML', 'AMR'], effect: { cross: 0.08 } },
  { id: 'holds_up', name: 'Likes To Hold Up Ball', pos: ['ST'], effect: { build: 0.1, finish: -0.04 } },
  { id: 'first_time', name: 'Tries First Time Shots', pos: ['ST', 'AMC'], effect: { finish: 0.06, finishAcc: -0.04 } },
  { id: 'dictates', name: 'Dictates Tempo', pos: ['MC', 'DM', 'AMC'], effect: { build: 0.09, possession: 0.04 } },
  { id: 'comes_deep', name: 'Comes Deep To Get Ball', pos: ['ST', 'AMC'], effect: { build: 0.08, finish: -0.05 } },
];

/** Ability fraction of PA typically reached at a given age. */
export function abilityFractionForAge(age) {
  const pts = [[15, 0.34], [16, 0.40], [17, 0.47], [18, 0.55], [19, 0.62], [20, 0.69], [21, 0.76],
    [22, 0.82], [23, 0.88], [24, 0.93], [25, 0.97], [26, 0.99], [27, 1.0], [28, 1.0], [29, 0.995],
    [30, 0.985], [31, 0.965], [32, 0.94], [33, 0.905], [34, 0.86], [35, 0.8], [36, 0.73], [37, 0.65],
    [38, 0.57], [39, 0.5], [40, 0.44]];
  if (age <= pts[0][0]) return pts[0][1];
  if (age >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    if (age >= pts[i][0] && age <= pts[i + 1][0]) {
      const t = (age - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
    }
  }
  return 1;
}

/** Physical/mental age curve multipliers applied to the attribute shape. */
function ageShapeMods(age) {
  // Physical peaks around 25; mental keeps climbing into the 30s.
  const physical = remap(age, 17, 34, 1.06, 0.78) * (age < 21 ? remap(age, 15, 21, 0.9, 1.0) : 1);
  const mental = remap(age, 17, 33, 0.82, 1.14);
  const technical = remap(age, 17, 30, 0.9, 1.05);
  return { physical, mental, technical, goalkeeping: technical };
}

function attrGroupOf(attr) {
  for (const g in ATTR_GROUPS) if (ATTR_GROUPS[g].includes(attr)) return g;
  return 'mental';
}

/** Relevance of each attribute to a position, used when scaling to target CA. */
function relevanceMap(pos) {
  const weights = POSITION_WEIGHTS[pos] || {};
  const maxW = Math.max(...Object.values(weights), 1);
  const isGk = pos === 'GK';
  const map = {};
  for (const attr of ALL_ATTRS) {
    if (isGk && OUTFIELD_ONLY.has(attr)) { map[attr] = 0.12; continue; }
    if (!isGk && GK_ATTRS.has(attr)) { map[attr] = 0; continue; }
    const w = weights[attr] || 0;
    map[attr] = w > 0 ? 0.55 + 0.45 * (w / maxW) : 0.4;
  }
  return map;
}

function baseShape(rng, pos, nation, age) {
  const weights = POSITION_WEIGHTS[pos] || {};
  const maxW = Math.max(...Object.values(weights), 1);
  const ageMods = ageShapeMods(age);
  const style = nation.style;
  const isGk = pos === 'GK';
  const attrs = {};
  for (const attr of ALL_ATTRS) {
    const group = attrGroupOf(attr);
    if (isGk && OUTFIELD_ONLY.has(attr)) {
      attrs[attr] = rng.normalClamped(4.5, 2, 1, 12);
      continue;
    }
    if (!isGk && GK_ATTRS.has(attr)) {
      attrs[attr] = rng.normalClamped(3, 1.6, 1, 9);
      continue;
    }
    const w = weights[attr] || 0;
    const importance = w / maxW;
    // Core attributes start higher; peripheral ones start around average.
    let mean = 7.5 + importance * 4.5;
    // Nation flavour.
    if (group === 'technical') mean += style.technique * 0.28;
    if (group === 'physical') mean += style.physical * 0.28;
    if (group === 'mental') mean += style.mental * 0.28;
    if (attr === 'pace' || attr === 'acceleration') mean += style.pace * 0.35;
    mean *= ageMods[group] ?? 1;
    // Personal variation — this is what makes two strikers of equal CA feel different.
    attrs[attr] = rng.normalClamped(mean, 2.9, 1, 20);
  }
  return attrs;
}

/** Apply scaling parameter p to a shape (monotone in p). */
function applyScale(shape, relevance, p) {
  const out = {};
  for (const attr in shape) {
    const r = relevance[attr];
    const v = shape[attr];
    if (p >= 0) out[attr] = v + (20 - v) * p * r;
    else out[attr] = v + (v - 1) * p * r;
  }
  return out;
}

/** Solve for the scale that lands the shape on targetCA at the given position. */
function solveToTarget(shape, pos, targetCA) {
  const relevance = relevanceMap(pos);
  let lo = -0.98;
  let hi = 0.98;
  let best = shape;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const cand = applyScale(shape, relevance, mid);
    const ca = abilityForPosition(cand, pos);
    best = cand;
    if (ca < targetCA) lo = mid;
    else hi = mid;
  }
  const rounded = {};
  for (const attr in best) rounded[attr] = clamp(Math.round(best[attr]), 1, 20);
  return rounded;
}

function rollHidden(rng, nation, clubRep) {
  const repBias = remap(clubRep, 30, 95, -1.2, 1.6);
  return {
    consistency: Math.round(rng.normalClamped(11 + repBias, 3.4, 1, 20)),
    importantMatches: Math.round(rng.normalClamped(11 + repBias * 0.8, 3.6, 1, 20)),
    injuryProneness: Math.round(rng.normalClamped(10, 4, 1, 20)),
    professionalism: Math.round(rng.normalClamped(11 + repBias * 0.7, 3.8, 1, 20)),
    ambition: Math.round(rng.normalClamped(12, 4, 1, 20)),
    loyalty: Math.round(rng.normalClamped(10, 4, 1, 20)),
    adaptability: Math.round(rng.normalClamped(11, 3.6, 1, 20)),
    versatility: Math.round(rng.normalClamped(9, 4, 1, 20)),
    dirtiness: Math.round(rng.normalClamped(9, 3.8, 1, 20)),
    pressureHandling: Math.round(rng.normalClamped(11 + repBias * 0.6, 3.6, 1, 20)),
  };
}

export function personalityFor(hidden) {
  for (const p of PERSONALITIES) {
    let ok = true;
    for (const key in p.req) {
      const req = p.req[key];
      if (req >= 0 ? hidden[key] < req : hidden[key] > -req) { ok = false; break; }
    }
    if (ok) return p.name;
  }
  return 'Balanced';
}

function rollTraits(rng, pos, ca) {
  const eligible = TRAITS.filter((t) => t.pos.includes(pos));
  const count = ca > 150 ? rng.int(1, 3) : ca > 120 ? rng.int(0, 2) : rng.int(0, 1);
  const chosen = [];
  const pool = rng.shuffle([...eligible]);
  for (let i = 0; i < Math.min(count, pool.length); i++) chosen.push(pool[i].id);
  return chosen;
}

const HEIGHT_BY_POS = {
  GK: [188, 5], DC: [187, 5], DL: [179, 5], DR: [179, 5], DM: [182, 5], MC: [180, 6],
  ML: [177, 6], MR: [177, 6], AML: [176, 6], AMR: [176, 6], AMC: [177, 6], ST: [183, 7],
};

/** Estimated transfer value in the club's currency-neutral base unit. */
export function estimateValue(ca, pa, age, leagueRep = 70) {
  if (ca <= 0) return 0;
  let base = 42000 * Math.pow(1.069, ca - 60);
  const ageMult = age <= 19 ? 1.55 : age <= 22 ? 1.42 : age <= 25 ? 1.18 : age <= 28 ? 1.0
    : age <= 30 ? 0.72 : age <= 32 ? 0.46 : age <= 34 ? 0.26 : 0.12;
  const potentialMult = 1 + clamp((pa - ca) / 200, 0, 0.5) * (age <= 23 ? 2.2 : age <= 26 ? 0.9 : 0.25);
  const repMult = remap(leagueRep, 40, 95, 0.72, 1.22);
  const value = base * ageMult * potentialMult * repMult;
  return Math.round(value / 5000) * 5000;
}

/**
 * Weekly wage a player of this ability expects at a club of this reputation.
 * Two-slope curve: wages climb steeply through the professional range and then
 * flatten at the elite end, which keeps superstar wage bills survivable.
 */
export function estimateWage(ca, age, clubRep, nationWealth = 0.8) {
  const KNEE = 135;
  const below = Math.min(ca, KNEE);
  const above = Math.max(0, ca - KNEE);
  const base = 210 * Math.pow(1.058, Math.max(0, below - 45)) * Math.pow(1.032, above);
  const repMult = remap(clubRep, 25, 95, 0.35, 1.9);
  const ageMult = age <= 19 ? 0.45 : age <= 21 ? 0.68 : age <= 24 ? 0.9 : age <= 31 ? 1.0 : 0.86;
  const wage = base * repMult * ageMult * (0.55 + nationWealth * 0.75);
  return Math.max(120, Math.round(wage / 50) * 50);
}

let playerCounter = 0;
export function resetPlayerCounter() { playerCounter = 0; }

/**
 * @param {Rng} rng
 * @param {object} opts { nationId, pos, age, targetCA, targetPA, clubRep, leagueRep, year }
 */
export function generatePlayer(rng, opts) {
  const {
    nationId, pos, age, targetCA, targetPA, clubRep = 60, leagueRep = 60, year = 2025,
  } = opts;
  const nation = NATION_BY_ID[nationId];
  const ca = clamp(Math.round(targetCA), 8, 200);
  const pa = clamp(Math.round(Math.max(targetPA, ca)), ca, 200);

  const shape = baseShape(rng, pos, nation, age);
  const attrs = solveToTarget(shape, pos, ca);
  const hidden = rollHidden(rng, nation, clubRep);
  const name = makePersonName(rng, nationId);

  // Secondary natural positions.
  const positions = [pos];
  if (pos !== 'GK') {
    if (rng.chance(0.3 + hidden.versatility / 60)) {
      const neighbours = SECONDARY_POS[pos] || [];
      if (neighbours.length) {
        const extra = rng.pick(neighbours);
        if (!positions.includes(extra)) positions.push(extra);
      }
    }
  }

  const [hMean, hSd] = HEIGHT_BY_POS[pos] || [180, 6];
  const height = Math.round(rng.normalClamped(hMean, hSd, 160, 208));
  const bmi = rng.normalClamped(22.6, 1.1, 19.5, 26.5);
  const weight = Math.round(bmi * Math.pow(height / 100, 2));

  const foot = rng.chance(pos === 'DL' || pos === 'AML' || pos === 'ML' ? 0.55 : 0.22)
    ? 'Left' : rng.chance(0.06) ? 'Both' : 'Right';

  const id = `p${(++playerCounter).toString(36)}`;
  const birthYear = year - age;
  return {
    id,
    first: name.first,
    last: name.last,
    name: name.full,
    short: name.display,
    nat: nationId,
    secondNat: rng.chance(0.07) ? null : null,
    birthYear,
    birthDay: rng.int(0, 364),
    age,
    positions,
    attrs,
    hidden,
    personality: personalityFor(hidden),
    traits: rollTraits(rng, pos, ca),
    pa,
    height,
    weight,
    foot,
    clubId: null,
    squadNumber: null,
    // Dynamic state
    condition: 100,
    sharpness: rng.int(70, 95),
    morale: rng.int(55, 85),
    form: 0,
    injury: null,
    suspension: 0,
    yellowCards: 0,
    unhappy: null,
    contract: null,
    value: estimateValue(ca, pa, age, leagueRep),
    // Season + career records
    season: emptyStats(),
    career: { apps: 0, goals: 0, assists: 0, cleanSheets: 0, motm: 0, seasons: [] },
    transferStatus: 'none', // none | listed | loanListed | unavailable
    interestFrom: [],
    custom: false,
  };
}

export function emptyStats() {
  return {
    apps: 0, subApps: 0, minutes: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0,
    keyPasses: 0, tackles: 0, interceptions: 0, saves: 0, conceded: 0, cleanSheets: 0,
    yellow: 0, red: 0, motm: 0, ratingSum: 0, ratingCount: 0,
  };
}

export const SECONDARY_POS = {
  DC: ['DM', 'DL', 'DR'], DL: ['ML', 'DC', 'DR'], DR: ['MR', 'DC', 'DL'],
  DM: ['MC', 'DC'], MC: ['DM', 'AMC', 'ML', 'MR'], ML: ['AML', 'MC', 'DL'],
  MR: ['AMR', 'MC', 'DR'], AML: ['ML', 'AMC', 'ST'], AMR: ['MR', 'AMC', 'ST'],
  AMC: ['MC', 'ST', 'AML', 'AMR'], ST: ['AMC', 'AML', 'AMR'],
};

export function playerAge(player, currentYear, dayOfYear = 200) {
  const had = dayOfYear >= player.birthDay ? 1 : 0;
  return currentYear - player.birthYear - 1 + had;
}

export function avgRating(stats) {
  return stats.ratingCount > 0 ? stats.ratingSum / stats.ratingCount : 0;
}

export { POSITION_GROUP };
