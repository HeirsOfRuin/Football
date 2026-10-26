// Rivalries: the fixtures that mean more than the three points.
//
// Nothing in the game marked one match as different from another. Every
// Saturday was the same Saturday, which is the single least true thing about
// football - a season is remembered for four or five games, and they are nearly
// always the same four or five.
//
// Two rules shape this module:
//
//   - **No randomness.** Rivalries are derived from what the world already is:
//     who shares a city, who the two big clubs in a nation are, who you keep
//     finishing next to. Drawing them from the RNG would shift every later draw
//     in the stream and re-roll the whole world, and it would mean an existing
//     save could not be given rivalries without changing the save.
//   - **Heat is earned.** A fixture starts with a reason to matter and then
//     accumulates one. Beat them and it cools a little; lose to them and it
//     does not.

import { clamp } from '../core/util.js';

/** The most rivals one club carries. Three makes none of them mean anything. */
const MAX_RIVALS = 2;

const KINDS = {
  city: { base: 70, label: 'derby' },
  historic: { base: 58, label: 'the big one' },
  local: { base: 38, label: 'local rivalry' },
};

/** Heat never falls below the reason the rivalry exists in the first place. */
function floorFor(kind) {
  return Math.round(KINDS[kind].base * 0.6);
}

/**
 * Work out who hates whom, from the world as generated.
 *
 * Safe to run on an existing save: it reads only city, nation, reputation and
 * league, consumes no randomness, and any heat already earned is kept.
 */
export function assignRivalries(world) {
  const clubs = Object.values(world.clubs).filter((c) => !c.affiliateOf);
  const existing = new Map();
  for (const c of clubs) for (const r of c.rivals || []) existing.set(`${c.id}:${r.id}`, r.heat);
  for (const c of clubs) c.rivals = [];

  const link = (a, b, kind) => {
    if (!a || !b || a.id === b.id) return;
    if (a.rivals.length >= MAX_RIVALS || b.rivals.length >= MAX_RIVALS) return;
    if (a.rivals.some((r) => r.id === b.id)) return;
    const heat = existing.get(`${a.id}:${b.id}`) ?? KINDS[kind].base;
    a.rivals.push({ id: b.id, kind, heat });
    b.rivals.push({ id: a.id, kind, heat: existing.get(`${b.id}:${a.id}`) ?? KINDS[kind].base });
  };

  // 1. Same city. The strongest reason there is, and it needs no history.
  const byCity = new Map();
  for (const c of clubs) {
    const key = `${c.nation}:${c.city}`;
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push(c);
  }
  for (const group of byCity.values()) {
    const sorted = [...group].sort((a, b) => b.rep - a.rep);
    for (let i = 0; i + 1 < sorted.length; i += 2) link(sorted[i], sorted[i + 1], 'city');
  }

  // 2. The two biggest clubs in a nation, if they are not already paired off.
  const byNation = new Map();
  for (const c of clubs) {
    if (!byNation.has(c.nation)) byNation.set(c.nation, []);
    byNation.get(c.nation).push(c);
  }
  for (const group of byNation.values()) {
    const sorted = [...group].sort((a, b) => b.rep - a.rep);
    link(sorted[0], sorted[1], 'historic');
  }

  // 3. Everyone else gets the club they keep finishing beside: same division,
  //    nearest reputation. A mid-table club with no city rival and no history
  //    still has one fixture a season it would rather not lose.
  const byLeague = new Map();
  for (const c of clubs) {
    if (!byLeague.has(c.leagueId)) byLeague.set(c.leagueId, []);
    byLeague.get(c.leagueId).push(c);
  }
  for (const group of byLeague.values()) {
    const sorted = [...group].sort((a, b) => b.rep - a.rep);
    for (const c of sorted) {
      if (c.rivals.length) continue;
      const near = sorted
        .filter((x) => x.id !== c.id && x.rivals.length < MAX_RIVALS)
        .sort((a, b) => Math.abs(a.rep - c.rep) - Math.abs(b.rep - c.rep))[0];
      link(c, near, 'local');
    }
  }
  return clubs.reduce((n, c) => n + c.rivals.length, 0) / 2;
}

/** The rivalry between two clubs, or null. Reads one side; they are kept in step. */
export function rivalryBetween(world, aId, bId) {
  const a = world.clubs[aId];
  const r = (a?.rivals || []).find((x) => x.id === bId);
  if (!r) return null;
  return { ...r, label: KINDS[r.kind].label, opponent: world.clubs[bId] };
}

/** Every rivalry a club carries, hottest first, with the opponent attached. */
export function rivalsOf(world, club) {
  return (club?.rivals || [])
    .map((r) => ({ ...r, label: KINDS[r.kind].label, opponent: world.clubs[r.id] }))
    .filter((r) => r.opponent)
    .sort((a, b) => b.heat - a.heat);
}

/**
 * What a rivalry adds to a fixture's importance.
 *
 * Importance is already the engine's one word for "how much this match
 * matters": it drives the pressure every player feels, and through that the
 * fouls, the cards and the mistakes. Feeding the rivalry in here rather than
 * inventing a parallel multiplier is what keeps there being one answer to the
 * question. A city derby at full heat lands a league game between a cup
 * semi-final and a final, which is about right.
 */
export function rivalryImportance(world, fixture) {
  const r = rivalryBetween(world, fixture.homeId, fixture.awayId);
  if (!r) return 0;
  return (r.heat / 100) * 0.38;
}

/**
 * How full the ground gets.
 *
 * Deliberately separate from importance: a derby crowd and a derby's nerves are
 * two different quantities, and folding the crowd into the pressure term would
 * have made a sold-out stadium calm the players down.
 */
export function rivalryAttendance(heat) {
  return 1 + (heat / 100) * 0.22;
}

/**
 * Settle up after a derby.
 *
 * Losing one stokes it and winning one cools it slightly, which is the right
 * way round: a rivalry is kept alive by the side that is behind in it. A draw
 * leaves both a little warmer than before, because they have to do it again.
 */
export function recordDerbyResult(world, fixture) {
  const r = rivalryBetween(world, fixture.homeId, fixture.awayId);
  if (!r || !fixture.result) return null;
  const home = world.clubs[fixture.homeId];
  const away = world.clubs[fixture.awayId];
  const { homeGoals, awayGoals } = fixture.result;
  const margin = Math.abs(homeGoals - awayGoals);
  const bump = (club, won, drew) => {
    const row = (club.rivals || []).find((x) => x.id === (club === home ? away.id : home.id));
    if (!row) return;
    const delta = drew ? 1.5 : won ? -1 : 3 + Math.min(4, margin);
    row.heat = clamp(row.heat + delta, floorFor(row.kind), 100);
  };
  const drew = homeGoals === awayGoals;
  bump(home, homeGoals > awayGoals, drew);
  bump(away, awayGoals > homeGoals, drew);
  return { ...r, margin, drew };
}

/**
 * What a derby result does to the people who care about it.
 *
 * A multiplier rather than an addition, applied to the board-confidence and
 * morale moves a result already produces, so a derby cannot invent confidence
 * out of nothing - it only makes the same result count for more.
 */
export function derbyWeight(heat) {
  return 1 + (heat / 100) * 0.9;
}
