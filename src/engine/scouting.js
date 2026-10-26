// Scouting: knowing things about players you do not own.
//
// The pieces were nearly all here and none of them were connected. There was a
// `scoutReport` that fogged a stranger's ability according to the club's
// scouting facility, a `facilities.scouting` number that the board would let
// you spend money upgrading, and a `game.scouted` map that was created on every
// new game, written into every save, migrated across four versions - and read
// by nothing at all. The fourth dead field this project has found.
//
// Worse, the fog was not even load-bearing. The player profile showed a
// stranger's ability as a range; the transfer search, one screen earlier,
// printed his exact ability and his exact potential for every player in the
// world. So the fog was a formality you could step around by looking at the
// list instead of the man, and the scouting facility bought you nothing.
//
// This module makes knowledge a thing you accumulate, spend scouts to get, and
// lose by neglect - and makes it the single source of how much you are told.

import { clamp, remap } from '../core/util.js';
import { currentAbility } from '../data/attributes.js';

/**
 * How many things a club can watch at once.
 *
 * Two at the bottom of the pyramid, five at the top. The same shape as
 * `trainingSlots`, deliberately: the two facilities you can ask the board to
 * upgrade should buy the same kind of thing - more decisions at once.
 */
export function scoutCount(club) {
  if (!club) return 0;
  return clamp(Math.round(1 + (club.facilities?.scouting ?? 10) / 4.5), 2, 5);
}

/** What the club knows about a player, 0 (a name on a list) to 100 (certainty). */
export function knowledgeOf(game, playerId) {
  return game.scouted?.[playerId]?.k ?? 0;
}

function bumpKnowledge(game, playerId, amount, day) {
  game.scouted = game.scouted || {};
  const row = game.scouted[playerId] || (game.scouted[playerId] = { k: 0, seen: day });
  row.k = clamp(row.k + amount, 0, 100);
  row.seen = day;
  return row.k;
}

/**
 * Players your own club knows for nothing.
 *
 * You watch your own men every day; there is no sense in paying a scout to tell
 * you about the centre-half you pick every Saturday. Also covers anyone who has
 * played against you - a manager who has seen someone twice a season has an
 * opinion about him.
 */
export function baselineKnowledge(world, club, player) {
  if (!club) return 0;
  if (player.clubId === club.id) return 100;
  const theirs = player.clubId ? world.clubs[player.clubId] : null;
  // You play the men in your own division twice a year and have an opinion
  // about them. Beyond that it falls away fast - measured, a same-nation
  // baseline of 18 left a scout with nothing to add, because a season of
  // watching a division never lifted the average above where it started.
  if (theirs && theirs.leagueId === club.leagueId) return 40;
  if (theirs && theirs.nation === club.nation) return 8;
  return 3;
}

/** The knowledge actually used, which is the better of what you know and what you cannot help knowing. */
export function effectiveKnowledge(game, world, club, player) {
  return Math.max(knowledgeOf(game, player.id), baselineKnowledge(world, club, player));
}

export const ASSIGNMENT_TYPES = {
  league: { label: 'Watch a division', help: 'Builds a broad picture of everyone in it, slowly.' },
  player: { label: 'Watch one player', help: 'Certainty about one man, quickly.' },
  position: { label: 'Search for a position', help: 'Finds who is out there in a role you are short of.' },
};

/** Start watching something. Returns the assignment, or null if every scout is busy. */
export function assignScout(game, club, assignment) {
  game.scoutAssignments = game.scoutAssignments || [];
  if (game.scoutAssignments.length >= scoutCount(club)) return null;
  const a = { id: `sc${Date.now().toString(36)}${game.scoutAssignments.length}`, started: game.day, reports: 0, ...assignment };
  game.scoutAssignments.push(a);
  return a;
}

export function clearAssignment(game, id) {
  game.scoutAssignments = (game.scoutAssignments || []).filter((a) => a.id !== id);
}

/**
 * A week of scouting.
 *
 * Deliberately slow. A scout who tells you everything about a division in a
 * month makes the facility worth buying once and then forgetting; one who takes
 * a season makes where you point him a decision you have to keep making. Decay
 * does the same job from the other end - knowledge you stop refreshing goes
 * stale, so a shortlist is a thing you maintain.
 */
export function runWeeklyScouting(game, rng) {
  const world = game.world;
  const club = game.userClubId ? world.clubs[game.userClubId] : null;
  if (!club) return [];
  const found = [];

  for (const a of game.scoutAssignments || []) {
    if (a.type === 'player') {
      const p = world.players[a.target];
      if (!p) { a.done = true; continue; }
      const k = bumpKnowledge(game, p.id, 17, game.day);
      if (k >= 100 && !a.reported) { a.reported = true; found.push({ assignment: a, player: p, kind: 'complete' }); }
      continue;
    }

    // A division or a position: the scout sees a handful of players a week.
    const pool = [];
    for (const id in world.players) {
      const p = world.players[id];
      if (p.clubId === club.id) continue;
      if (a.type === 'league') {
        const c = p.clubId ? world.clubs[p.clubId] : null;
        if (!c || c.leagueId !== a.target) continue;
      } else if (a.type === 'position') {
        if (!p.positions.includes(a.target)) continue;
        const c = p.clubId ? world.clubs[p.clubId] : null;
        if (c && c.nation !== club.nation && rng.chance(0.7)) continue;
      }
      pool.push(p);
    }
    if (!pool.length) continue;

    // A scout does not watch a division at random. He watches the ones worth
    // watching - the good, the young, and the ones whose contracts are nearly
    // up - which is also the only way the work is finishable: a second tier
    // holds five hundred players and a season has forty-six weeks in it.
    // Measured before this: one scout on a division for two seasons moved the
    // average error by nothing at all, because he spread himself over everyone.
    const ranked = pool
      .map((p) => ({
        p,
        worth: currentAbility(p) + (p.pa - currentAbility(p)) * 0.5
          + remap(p.age, 32, 17, 0, 14)
          + (p.contract && p.contract.expiresYear - world.year <= 1 ? 10 : 0),
      }))
      .sort((a, b) => b.worth - a.worth)
      .slice(0, 110)
      .map((x) => x.p);

    const watched = Math.min(ranked.length, 14);
    for (let i = 0; i < watched; i++) {
      const p = rng.pick(ranked);
      const before = knowledgeOf(game, p.id);
      const after = bumpKnowledge(game, p.id, 12, game.day);
      // Worth telling the manager about: someone who has just become legible
      // and turns out to be better than the club he is at.
      if (before < 55 && after >= 55 && currentAbility(p) > club.rep * 1.25 && a.reports < 6) {
        a.reports++;
        found.push({ assignment: a, player: p, kind: 'find' });
      }
    }
  }
  game.scoutAssignments = (game.scoutAssignments || []).filter((a) => !a.done);

  // Everything nobody is watching fades. Slowly: a season of neglect costs
  // about fifteen points, which is a noticeable blur rather than amnesia.
  for (const id in game.scouted || {}) {
    const row = game.scouted[id];
    if (game.day - (row.seen ?? 0) < 28) continue;
    row.k = clamp(row.k - 0.4, 0, 100);
    if (row.k <= 0) delete game.scouted[id];
  }
  return found;
}

/**
 * The one place a fogged number is produced.
 *
 * Every screen that shows a stranger's ability goes through this, so the
 * transfer list and the player profile cannot disagree about what you know -
 * which they did, the list printing the exact figure the profile was carefully
 * hiding.
 *
 * `spread` is in ability points either side. At full knowledge it is zero and
 * the exact number is shown.
 */
export function fogBand(game, world, club, player, value, { potential = false } = {}) {
  const k = effectiveKnowledge(game, world, club, player);
  if (k >= 100) {
    return { estimate: value, low: value, high: value, exact: true, knowledge: k };
  }
  // The facility sets the floor of what a scout can tell you; the knowledge
  // narrows it from there. A poor network watching a man for a season still
  // ends up roughly right, which is the point of watching him.
  const facility = remap(club?.facilities?.scouting ?? 10, 1, 20, 1.0, 0.55);
  const base = (potential ? 46 : 30) * facility;
  const spread = base * (1 - k / 100) ** 1.35;

  // The estimate is WRONG, not merely imprecise, and it is wrong in a
  // direction. A band drawn symmetrically around the truth is no fog at all:
  // its midpoint is the answer, so sorting a search by it ranks every player in
  // the world in exactly the right order and the scouting network buys nothing.
  // The bias is a hash of the pair, so it is stable for this club and this
  // player, differs between clubs, consumes no randomness - and shrinks to
  // nothing as the scouts learn.
  const bias = (hash(`${player.id}:${club?.id ?? ''}:${potential ? 'p' : 'a'}`) - 0.5) * 2 * spread * 0.8;
  const estimate = clamp(value + bias, 1, 200);
  return {
    estimate: Math.round(estimate),
    low: Math.round(clamp(estimate - spread * 0.6, 1, 200)),
    high: Math.round(clamp(estimate + spread * 0.6, 1, 200)),
    exact: false,
    knowledge: k,
  };
}

/** A stable 0..1 from a string. Not random: the same pair must mislead you the same way. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** What to call how well you know someone. */
export function knowledgeLabel(k) {
  if (k >= 100) return 'Known';
  if (k >= 75) return 'Well scouted';
  if (k >= 50) return 'Scouted';
  if (k >= 25) return 'Watched once';
  return 'A name on a list';
}
