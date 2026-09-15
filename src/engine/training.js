// Player development, conditioning, injuries and morale.
//
// Current Ability is derived from attributes, so development works by moving
// attributes. Each player banks fractional development points every week and
// spends them on a single attribute once a whole point has accumulated. Which
// attribute gets the point depends on position, training focus and headroom.

import {
  ALL_ATTRS, ATTR_GROUPS, POSITION_WEIGHTS, currentAbility, invalidateAbility,
  familiarityFromAffinity,
} from '../data/attributes.js';
import { clamp, remap } from '../core/util.js';
import { ROLES } from '../data/tactics.js';

const PHYSICAL = new Set(ATTR_GROUPS.physical);
const MENTAL = new Set(ATTR_GROUPS.mental);
const GK_SET = new Set(ATTR_GROUPS.goalkeeping);

export const TRAINING_FOCUSES = [
  { id: 'Balanced', label: 'Balanced', emphasis: {} },
  { id: 'Attacking', label: 'Attacking Movement', emphasis: { finishing: 2.2, offTheBall: 2, composure: 1.6, longShots: 1.4 } },
  { id: 'Defending', label: 'Defensive Shape', emphasis: { marking: 2.2, tackling: 2, positioning: 2, concentration: 1.6 } },
  { id: 'Possession', label: 'Possession Play', emphasis: { passing: 2.2, firstTouch: 2, vision: 1.8, technique: 1.6, composure: 1.4 } },
  { id: 'Fitness', label: 'Physical Conditioning', emphasis: { stamina: 2.2, strength: 2, naturalFitness: 1.8, pace: 1.4, acceleration: 1.4 } },
  { id: 'SetPieces', label: 'Set Pieces', emphasis: { setPieces: 2.6, crossing: 1.8, heading: 1.6, technique: 1.2 } },
  { id: 'Transition', label: 'Attacking Transitions', emphasis: { pace: 1.8, acceleration: 1.8, dribbling: 1.8, anticipation: 1.6, workRate: 1.4 } },
  { id: 'TeamCohesion', label: 'Team Cohesion', emphasis: { teamwork: 2.4, workRate: 2, decisions: 1.6, positioning: 1.4 } },
];

export const TRAINING_INTENSITY = ['Light', 'Normal', 'Intense'];

/**
 * Individual training programmes. A slot assigns one player one of these.
 *
 * The first two deliberately work *through* the team focus rather than beside
 * it: they contribute a second, stronger emphasis into the same weighting
 * pickGrowthAttr() already applies. So a programme mostly decides **where the
 * development points land**, not how many there are, and there is one code path
 * deciding development instead of two that can drift apart.
 */
export const PROGRAMME_TYPES = {
  group: { id: 'group', label: 'Attribute group', help: 'Concentrate on one side of his game.' },
  role: { id: 'role', label: 'Role', help: 'Train toward everything a specific role asks for.' },
  position: { id: 'position', label: 'Position retraining', help: 'Learn a new position. Slow, and slower the older he is.' },
  mentor: { id: 'mentor', label: 'Mentoring', help: 'Pair him with a senior professional to shape his temperament.' },
};

export const PROGRAMME_GROUPS = ['technical', 'mental', 'physical', 'goalkeeping'];

/**
 * How many players can be given individual attention, 2 to 6.
 *
 * Scarcity is what makes a slot a decision rather than a checkbox, and tying the
 * count to the staff is the first thing in the game that makes coaching quality
 * concrete - it also gives the bottom of the pyramid one more real disadvantage
 * to climb out of.
 */
export function trainingSlots(club) {
  if (!club) return 0;
  const c = club.coaching || {};
  const avgCoach = ((c.attacking ?? 10) + (c.defending ?? 10) + (c.fitness ?? 10) + (c.gk ?? 10)) / 4;
  const blend = avgCoach * 0.7 + (club.facilities?.training ?? 10) * 0.3;
  return clamp(Math.round(1 + blend / 4), 2, 6);
}

/** The attribute weighting a programme contributes, or null if it moves no attributes. */
function programmeEmphasis(prog) {
  if (!prog) return null;
  if (prog.type === 'group') {
    const attrs = ATTR_GROUPS[prog.target];
    if (!attrs) return null;
    const m = {};
    for (const a of attrs) m[a] = 3.2;
    return m;
  }
  if (prog.type === 'role') {
    const role = ROLES[prog.target];
    if (!role?.attrs) return null;
    const m = {};
    for (const a of role.attrs) m[a] = 4.2;
    return m;
  }
  return null;
}

/**
 * Weekly progress toward a new position, on the 0-20 familiarity scale.
 *
 * Paced so a dedicated slot moves a player about one familiarity band a season -
 * Awkward to Unconvincing to Competent - which makes converting a full-back into
 * a centre-back a multi-year project rather than an answer to this month's
 * injury crisis. The young and the naturally versatile learn faster.
 */
export function retrainingStep(player, pos) {
  const age = remap(player.age, 17, 32, 1.45, 0.35);
  const vers = remap(player.hidden?.versatility ?? 10, 1, 20, 0.7, 1.4);
  const prof = remap(player.hidden?.professionalism ?? 10, 1, 20, 0.85, 1.15);
  // Learning is easier toward a position the player already half-understands.
  const related = remap(familiarityFromAffinity(player, pos), 0, 20, 0.8, 1.6);
  return 0.105 * age * vers * prof * related;
}

function coachFor(club, pos) {
  const c = club?.coaching || {};
  if (pos === 'GK') return c.gk ?? 10;
  if (['DC', 'DL', 'DR', 'DM'].includes(pos)) return (c.defending ?? 10) * 0.7 + (c.fitness ?? 10) * 0.3;
  if (['ST', 'AMC', 'AML', 'AMR'].includes(pos)) return (c.attacking ?? 10) * 0.7 + (c.fitness ?? 10) * 0.3;
  return ((c.attacking ?? 10) + (c.defending ?? 10)) * 0.35 + (c.fitness ?? 10) * 0.3;
}

/** Weekly development rate in attribute points. Negative means decline. */
export function developmentRate(world, club, player) {
  const ca = currentAbility(player);
  const gap = player.pa - ca;
  const age = player.age;
  const ageFactor = age <= 19 ? 1.0 : age <= 21 ? 0.92 : age <= 23 ? 0.78 : age <= 25 ? 0.52
    : age <= 27 ? 0.3 : age <= 29 ? 0.14 : age <= 30 ? 0.05 : 0;
  // Diminishing returns as a player nears his ceiling, but with a floor: this
  // decays alongside the age factor, and without a floor the two together stall
  // a prospect at three-quarter speed exactly as he turns 24.
  const potentialFactor = gap <= 0 ? 0 : clamp(gap / 34, 0.32, 1.3);
  const facility = remap(club?.facilities?.training ?? 10, 1, 20, 0.58, 1.42);
  const coach = remap(coachFor(club, player.positions[0]), 1, 20, 0.72, 1.3);
  const prof = remap(player.hidden?.professionalism ?? 10, 1, 20, 0.6, 1.4);
  // The manager's youth coaching. Set in five places across the codebase and,
  // until now, read in none. It bites only on players young enough for it to
  // mean anything, which is also what keeps it from disturbing senior squads.
  const youthCoaching = player.age <= 21
    ? remap(club?.manager?.youthDev ?? 10, 1, 20, 0.84, 1.22)
    : 1;
  const determination = remap(player.hidden?.determination ?? player.attrs?.determination ?? 10, 1, 20, 0.82, 1.18);
  // Under-21s play youth and reserve football that never shows in the first
  // team's minutes, so they keep developing without being picked.
  const minutes = (player.season?.minutes ?? 0) + (player.age <= 21 ? 850 : 0);
  const playingTime = remap(minutes, 0, 2200, 0.62, 1.28);
  const intensity = club?.trainingIntensity === 'Intense' ? 1.12 : club?.trainingIntensity === 'Light' ? 0.88 : 1;

  let rate = 0.118 * potentialFactor * ageFactor * facility * coach * prof * determination
    * playingTime * intensity * youthCoaching;

  // Decline sets in after the peak, and hits the unprofessional hardest.
  if (age >= 30) {
    const declineAge = age - 29;
    const fitness = remap(player.attrs.naturalFitness || 10, 4, 19, 1.3, 0.72);
    rate -= 0.017 * declineAge * fitness / prof;
  }
  if (ca >= player.pa) rate = Math.min(rate, 0.01);
  return rate;
}

function pickGrowthAttr(rng, player, club, prog) {
  const pos = player.positions[0];
  const weights = POSITION_WEIGHTS[pos] || {};
  const focus = TRAINING_FOCUSES.find((f) => f.id === (club?.trainingFocus || 'Balanced'));
  const emphasis = focus?.emphasis || {};
  // An individual programme is a second emphasis layered onto the team's, not a
  // parallel mechanism: one calculation still decides where the point goes.
  const indiv = programmeEmphasis(prog);
  const isGk = pos === 'GK';
  const candidates = ALL_ATTRS.filter((a) => {
    if (isGk) return !['finishing', 'crossing', 'dribbling', 'marking', 'tackling', 'heading', 'longShots', 'offTheBall'].includes(a);
    return !GK_SET.has(a);
  });
  const maxW = Math.max(...Object.values(weights), 1);
  return rng.weighted(candidates, (a) => {
    const headroom = (20 - player.attrs[a]) / 19;
    if (headroom <= 0.01) return 0.01;
    // Weight hard toward what the position actually uses. The development rate
    // is calculated as if every point earned makes the player better, so points
    // spent on attributes his position ignores are points that quietly vanish —
    // a player can train for years and barely improve. Some spread is still
    // wanted, so a peripheral attribute keeps a small share.
    const importance = 0.12 + ((weights[a] || 0) / maxW) * 1.5;
    const focused = (emphasis[a] || 1) * (indiv?.[a] || 1);
    // Older players can still add mental attributes long after the legs go.
    const ageBias = player.age >= 28 && MENTAL.has(a) ? 1.5 : player.age >= 28 && PHYSICAL.has(a) ? 0.4 : 1;
    return headroom * importance * focused * ageBias;
  });
}

function pickDeclineAttr(rng, player) {
  return rng.weighted(ALL_ATTRS, (a) => {
    if (player.attrs[a] <= 1) return 0;
    if (PHYSICAL.has(a)) return player.age >= 31 ? 4 : 2;
    if (MENTAL.has(a)) return 0.25;
    return 1;
  });
}

/**
 * A week of intense training can cost you a player.
 *
 * This is a new source, not an adjustment: injuries have only ever been created
 * in the match engine. It is also the reason Intense is a trade rather than a
 * free +12%. Normal and Light return before touching the rng, so their world is
 * bit-for-bit the one they had before individual training existed.
 */
function rollTrainingInjury(rng, club, player) {
  if (club?.trainingIntensity !== 'Intense') return false;
  if (player.injury || player.pendingInjury) return false;
  const fit = remap(player.attrs.naturalFitness || 10, 4, 19, 1.4, 0.68);
  const age = remap(player.age, 18, 36, 0.8, 1.6);
  const med = remap(club?.facilities?.medical ?? 10, 3, 19, 1.25, 0.78);
  if (!rng.chance(0.0075 * fit * age * med)) return false;
  const days = Math.round(rng.range(4, 26) * remap(player.age, 18, 36, 0.85, 1.35));
  player.injury = { type: 'a training-ground strain', daysLeft: days, totalDays: days };
  player.condition = Math.min(player.condition, 55);
  return true;
}

/** Weekly training tick for one player. `prog` is his individual programme, if any. */
export function trainPlayer(rng, world, club, player, prog = null) {
  // Position retraining and mentoring spend no development points; they move
  // their own state and leave the attribute budget alone.
  if (prog?.type === 'position' && prog.target) {
    player.learned = player.learned || {};
    const now = player.learned[prog.target] ?? familiarityFromAffinity(player, prog.target);
    player.learned[prog.target] = Math.min(19.4, now + retrainingStep(player, prog.target));
  } else if (prog?.type === 'mentor' && prog.target) {
    applyMentoring(player, world?.players?.[prog.target]);
  }

  // A programme aimed at attributes also lifts the rate a little. Most of its
  // value is in aim, not speed.
  const focusBonus = (prog?.type === 'group' || prog?.type === 'role') ? 1.12 : 1;
  const rate = developmentRate(world, club, player) * focusBonus;
  player.devBank = (player.devBank || 0) + rate + rng.range(-0.02, 0.02);
  let changed = false;
  while (player.devBank >= 1) {
    const attr = pickGrowthAttr(rng, player, club, prog);
    if (player.attrs[attr] < 20) { player.attrs[attr]++; changed = true; }
    player.devBank -= 1;
  }
  while (player.devBank <= -1) {
    const attr = pickDeclineAttr(rng, player);
    if (player.attrs[attr] > 1) { player.attrs[attr]--; changed = true; }
    player.devBank += 1;
  }
  if (changed) invalidateAbility(player);
  rollTrainingInjury(rng, club, player);
  return changed;
}

/**
 * A senior professional's temperament rubs off on a young one. Moves hidden
 * personality attributes, which nothing else in the game can shift - a player's
 * professionalism and determination are otherwise fixed at birth.
 */
const MENTORED = ['professionalism', 'determination', 'ambition'];

export function applyMentoring(player, mentor) {
  if (!mentor || !player.hidden || !mentor.hidden) return false;
  if (mentor.age - player.age < 4) return false; // has to be a senior figure
  let moved = false;
  for (const a of MENTORED) {
    const from = player.hidden[a] ?? 10;
    const to = mentor.hidden[a] ?? 10;
    if (to <= from) continue;
    // Deliberately slow: a season of mentoring is worth a point or so.
    player.hidden[a] = Math.min(20, from + 0.035 * (to - from));
    moved = true;
  }
  return moved;
}

/** Daily recovery, injury countdown and sharpness drift. */
export function dailyPlayerTick(rng, world, club, player, playedYesterday) {
  const medical = club?.facilities?.medical ?? 10;
  const fitness = remap(player.attrs.naturalFitness || 10, 4, 19, 0.75, 1.3);
  const age = remap(player.age, 18, 36, 1.12, 0.8);

  if (player.injury) {
    player.injury.daysLeft -= 1;
    if (player.injury.daysLeft <= 0) {
      player.injury = null;
      player.condition = clamp(player.condition, 45, 72);
      player.sharpness = clamp(player.sharpness - 22, 10, 70);
      return 'recovered';
    }
    player.condition = clamp(player.condition + 1.2, 0, 82);
    player.sharpness = clamp(player.sharpness - 0.55, 5, 100);
    return null;
  }

  // Training intensity is paid for here. Normal is exactly 1, so a club that
  // never touches the setting behaves precisely as it did before.
  const intensity = club?.trainingIntensity === 'Intense' ? 0.90
    : club?.trainingIntensity === 'Light' ? 1.16 : 1;
  const recovery = (playedYesterday ? 3.2 : 6.5) * intensity;
  player.condition = clamp(player.condition + recovery * fitness * age * remap(medical, 3, 19, 0.85, 1.15), 0, 100);
  // Sharpness climbs with minutes and decays without them.
  player.sharpness = clamp(player.sharpness - 0.35, 5, 100);

  // Morale drifts toward a baseline set by playing time and results.
  const target = moraleTarget(world, club, player);
  player.morale = clamp(player.morale + (target - player.morale) * 0.06, 0, 100);
  return null;
}

function moraleTarget(world, club, player) {
  let t = 60;
  if (club) {
    const wins = (club.form || []).filter((f) => f === 'W').length;
    const losses = (club.form || []).filter((f) => f === 'L').length;
    t += wins * 5 - losses * 5;
  }
  const apps = player.season?.apps ?? 0;
  const expected = expectedRole(world, club, player);
  if (expected === 'key' && apps < 4) t -= 18;
  else if (expected === 'fringe' && apps > 12) t += 10;
  if (player.injury) t -= 12;
  if (player.contract && player.contract.expiresYear - (world.year ?? 2025) <= 0) t -= 8;
  if (player.unhappy) t -= 15;
  return clamp(t, 5, 95);
}

/**
 * Ability cut-offs for the squad's pecking order. Cached on the club because
 * every player asks for it every day; call refreshSquadThresholds when the
 * squad changes.
 */
export function refreshSquadThresholds(world, club) {
  const abilities = club.squad
    .map((id) => world.players[id])
    .filter(Boolean)
    .map((p) => currentAbility(p))
    .sort((a, b) => b - a);
  club._roleThresholds = {
    key: abilities[5] ?? 0,
    rotation: abilities[12] ?? 0,
    squad: abilities[18] ?? 0,
  };
  return club._roleThresholds;
}

/** Where a player sits in the pecking order, by ability relative to the squad. */
export function expectedRole(world, club, player) {
  if (!club) return 'fringe';
  const t = club._roleThresholds || refreshSquadThresholds(world, club);
  const ca = currentAbility(player);
  if (ca >= t.key) return 'key';
  if (ca >= t.rotation) return 'rotation';
  if (ca >= t.squad) return 'squad';
  return 'fringe';
}

export const ROLE_LABELS = {
  key: 'Key Player', rotation: 'First Team', squad: 'Squad Player', fringe: 'Fringe Player',
};

/** Post-match effects: minutes, sharpness, condition and morale. */
export function applyMatchEffects(world, side, opponentGoals, ownGoals) {
  const result = ownGoals > opponentGoals ? 'W' : ownGoals === opponentGoals ? 'D' : 'L';
  for (const id in side.records) {
    const r = side.records[id];
    const p = world.players[id];
    if (!p) continue;
    if (r.minutes <= 0) continue;
    p.condition = clamp(p.matchCondition ?? p.condition, 1, 100);
    p.sharpness = clamp(p.sharpness + r.minutes * 0.085, 5, 100);
    const s = p.season;
    s.minutes += r.minutes;
    if (r.subbedOnAt !== null && r.subbedOnAt > 0) s.subApps++; else s.apps++;
    s.goals += r.goals;
    s.assists += r.assists;
    s.shots += r.shots;
    s.shotsOnTarget += r.shotsOnTarget;
    s.keyPasses += r.keyPasses;
    s.tackles += r.tackles;
    s.interceptions += r.interceptions;
    s.saves += r.saves;
    s.conceded += r.conceded;
    if (r.cleanSheet) s.cleanSheets++;
    s.yellow += r.yellow;
    s.red += r.red;
    s.motm += r.motm;
    if (r.rating) { s.ratingSum += r.rating; s.ratingCount++; }

    // Form is a rolling view of recent ratings.
    if (r.rating) p.form = clamp((p.form ?? 0) * 0.7 + (r.rating - 6.6) * 0.55, -3, 3);
    const moraleShift = (result === 'W' ? 6 : result === 'D' ? 0 : -5) + (r.rating ? (r.rating - 6.6) * 2.4 : 0);
    p.morale = clamp(p.morale + moraleShift, 0, 100);

    if (p.pendingInjury) {
      p.injury = { type: p.pendingInjury.type, daysLeft: p.pendingInjury.days, totalDays: p.pendingInjury.days };
      p.pendingInjury = null;
    }
    if (r.red) p.pendingSuspension = (p.pendingSuspension || 0) + (r.yellow >= 2 ? 1 : 3);
    if (r.yellow === 1) p.yellowCards = (p.yellowCards || 0) + 1;
    delete p.matchCondition;
    delete p.matchMorale;
  }
}

/** Yellow-card accumulation bans, applied after each match. */
export function processDisciplinary(world, side, threshold = 5) {
  const banned = [];
  for (const id in side.records) {
    const p = world.players[id];
    if (!p) continue;
    if (p.pendingSuspension) {
      p.suspension = (p.suspension || 0) + p.pendingSuspension;
      banned.push({ player: p, games: p.pendingSuspension, reason: 'sent off' });
      p.pendingSuspension = 0;
    } else if ((p.yellowCards || 0) >= threshold) {
      p.suspension = (p.suspension || 0) + 1;
      p.yellowCards = 0;
      banned.push({ player: p, games: 1, reason: 'card accumulation' });
    }
  }
  return banned;
}

/** Youth intake: a new crop of academy players once a season. */
export function generateYouthIntake(rng, world, club, year, generatePlayer, rollPotential) {
  const league = world.leagues.find((l) => l.id === club.leagueId);
  const nation = world.nations.find((n) => n.id === club.nation);
  const quality = club.facilities.youth;
  const count = clamp(Math.round(rng.normalClamped(remap(quality, 1, 20, 3, 7), 1.4, 2, 9)), 2, 9);
  const intake = [];
  const positions = ['GK', 'DC', 'DC', 'DL', 'DR', 'DM', 'MC', 'MC', 'ML', 'MR', 'AMC', 'AML', 'AMR', 'ST', 'ST'];
  for (let i = 0; i < count; i++) {
    const pos = rng.pick(positions);
    const age = rng.int(15, 17);
    const paCeiling = remap(quality, 1, 20, 105, 175) + remap(nation?.youthRep ?? 80, 60, 98, -8, 14);
    const pa = clamp(Math.round(rng.normalClamped(paCeiling - 22, 22, 45, 195)), 45, 195);
    const ca = clamp(Math.round(pa * rng.range(0.3, 0.52)), 25, pa);
    const p = generatePlayer(rng, {
      nationId: nation?.id ?? club.nation, pos, age, targetCA: ca, targetPA: pa,
      clubRep: club.rep, leagueRep: league?.rep ?? 55, year,
    });
    p.clubId = club.id;
    p.youthProduct = club.id;
    p.contract = {
      wage: Math.max(120, Math.round(remap(club.rep, 25, 95, 180, 2400))),
      expiresYear: year + rng.int(2, 4),
      signedYear: year,
      releaseClause: 0, goalBonus: 0, appearanceFee: 0, loanedFrom: null, loanUntilYear: null,
    };
    intake.push(p);
  }
  return intake;
}
