// The manager's record: seasons, honours, the players who played for him, and
// what became of them.
//
// Three things were wrong with what this replaces, and all three are about the
// same thing - the record being scattered rather than kept.
//
//   - The manager panel showed a lifetime W/D/L counted across every
//     competition, and directly beneath it a season table whose W/D/L was
//     league-only. Two definitions of the same word, side by side, with nothing
//     saying which was which.
//   - Promotions and play-off wins were free text pushed onto `club.history`.
//     They are the achievement a career in the lower divisions is built on and
//     they were not trophies.
//   - Retirement did `delete world.players[p.id]`. A player you signed at
//     seventeen, developed for a decade and won a league with simply stopped
//     having existed.
//
// This module is the one place a career event is written, so the screen cannot
// disagree with the engine about what happened.

import { currentAbility } from '../data/attributes.js';

/** How many notable players and hall-of-fame entries to keep. */
const NOTABLE_CAP = 120;
const HALL_CAP = 200;

/** A fresh, empty career record. */
export function emptyCareer() {
  return {
    matches: 0, wins: 0, draws: 0, losses: 0,
    // Counted per season as well as for the lifetime, so a season row and the
    // lifetime total are the same arithmetic rather than two.
    season: { matches: 0, wins: 0, draws: 0, losses: 0 },
    history: [], trophies: [], notable: [], spells: [],
  };
}

/** Record a result for the manager. Called once per user match, nowhere else. */
export function recordMatchResult(manager, result) {
  manager.season = manager.season || { matches: 0, wins: 0, draws: 0, losses: 0 };
  manager.matches++;
  manager.season.matches++;
  if (result === 'W') { manager.wins++; manager.season.wins++; } else if (result === 'D') { manager.draws++; manager.season.draws++; } else { manager.losses++; manager.season.losses++; }
}

/**
 * A spell at a club: when it started, when it ended, and what happened in it.
 *
 * Kept separately from the season rows because a career reads as a list of jobs
 * first and a list of seasons second, and deriving the jobs from the seasons
 * loses the ones that ended mid-season.
 */
export function beginSpell(game, club) {
  const m = game.manager;
  m.spells = m.spells || [];
  const open = m.spells.find((s) => !s.endYear);
  if (open && open.clubId === club.id) return open;
  if (open) endSpell(game, 'left');
  const spell = {
    clubId: club.id, club: club.name, startYear: game.world.year, startSeason: game.season,
    endYear: null, seasons: 0, matches: 0, wins: 0, draws: 0, losses: 0, trophies: 0, reason: null,
  };
  m.spells.push(spell);
  return spell;
}

export function endSpell(game, reason) {
  const m = game.manager;
  const open = (m.spells || []).find((s) => !s.endYear);
  if (!open) return null;
  open.endYear = game.world.year;
  open.reason = reason;
  return open;
}

export function currentSpell(game) {
  return (game.manager.spells || []).find((s) => !s.endYear) || null;
}

/**
 * Write a completed season into the record.
 *
 * Both records go in: the league one, which is what a league table means, and
 * the all-competitions one, which is what "matches managed" means. Having the
 * screen pick a column is fine; having it invent one is not.
 */
export function recordSeason(game, club, league) {
  const m = game.manager;
  const s = m.season || { matches: 0, wins: 0, draws: 0, losses: 0 };
  const row = {
    season: game.season,
    year: game.world.year,
    clubId: club.id,
    club: club.name,
    league: league?.name || '',
    tier: league?.tier ?? null,
    position: club.lastFinish ?? null,
    teams: league?.teams ?? null,
    // League only — the same numbers the division table shows.
    w: club.seasonRecord?.w ?? 0,
    d: club.seasonRecord?.d ?? 0,
    l: club.seasonRecord?.l ?? 0,
    // Every competition — the same numbers the lifetime totals are built from.
    allMatches: s.matches, allW: s.wins, allD: s.draws, allL: s.losses,
    objectives: (club.board?.objectives || []).map((o) => ({ label: o.label, met: o.met })),
  };
  m.history.push(row);

  const spell = currentSpell(game);
  if (spell) {
    spell.seasons++;
    spell.matches += s.matches;
    spell.wins += s.wins;
    spell.draws += s.draws;
    spell.losses += s.losses;
  }
  return row;
}

/** Start the next season's counters. */
export function resetSeasonRecord(manager) {
  manager.season = { matches: 0, wins: 0, draws: 0, losses: 0 };
}

/**
 * Add an honour.
 *
 * `kind` matters because a career in the fourth tier is made of promotions, and
 * a trophy cabinet that only counts cups says such a career won nothing.
 */
export function addHonour(game, { kind, name, club, detail = '' }) {
  const m = game.manager;
  m.trophies = m.trophies || [];
  m.trophies.push({
    kind, name, club, detail,
    season: game.season, year: game.world.year,
  });
  const spell = currentSpell(game);
  if (spell) spell.trophies++;
}

/**
 * Remember the players who played for you.
 *
 * Nothing recorded this. A career is largely the players in it, and without
 * this the only trace of a decade-long captain is a name that vanishes from the
 * squad list the year he retires.
 */
export function trackNotable(game, club) {
  const world = game.world;
  const m = game.manager;
  m.notable = m.notable || [];
  const byId = new Map(m.notable.map((n) => [n.playerId, n]));

  for (const id of [...club.squad, ...(club.loanedOut || [])]) {
    const p = world.players[id];
    if (!p) continue;
    const apps = (p.season?.apps ?? 0) + (p.season?.subApps ?? 0);
    if (apps < 5) continue;
    const ca = currentAbility(p);
    let n = byId.get(p.id);
    if (!n) {
      n = {
        playerId: p.id, name: p.name, pos: p.positions.join('/'),
        firstYear: world.year, lastYear: world.year, seasons: 0,
        apps: 0, goals: 0, assists: 0, peak: 0, signedAge: p.age, club: club.name,
      };
      m.notable.push(n);
      byId.set(p.id, n);
    }
    n.seasons++;
    n.apps += apps;
    n.goals += p.season?.goals ?? 0;
    n.assists += p.season?.assists ?? 0;
    n.peak = Math.max(n.peak, ca);
    n.lastYear = world.year;
  }

  // Keep the ones worth remembering rather than every squad player ever.
  if (m.notable.length > NOTABLE_CAP) {
    m.notable.sort((a, b) => (b.apps + b.peak * 2) - (a.apps + a.peak * 2));
    m.notable.length = NOTABLE_CAP;
  }
}

/** Where a tracked player ended up, noted when he leaves or retires. */
export function noteDeparture(game, player, where) {
  const n = (game.manager.notable || []).find((x) => x.playerId === player.id);
  if (n) n.wentTo = where;
}

/**
 * A retiring player's career, kept instead of thrown away.
 *
 * `delete world.players[p.id]` erased everything: the goals, the seasons, the
 * fact he ever played. The player object is far too big to keep for every
 * retirement in a world of five thousand, so this is a summary - small enough
 * to carry in a save for decades.
 */
export function retirePlayer(game, player) {
  const world = game.world;
  world.hallOfFame = world.hallOfFame || [];
  const club = player.clubId ? world.clubs[player.clubId] : null;
  const career = player.career || {};
  const peak = currentAbility(player);
  const entry = {
    id: player.id, name: player.name, nat: player.nat, pos: player.positions.join('/'),
    retiredYear: world.year, age: player.age, lastClub: club?.short || null,
    apps: career.apps || 0, goals: career.goals || 0, assists: career.assists || 0,
    peak, youthProduct: player.youthProduct || null,
  };
  const managed = (game.manager.notable || []).find((n) => n.playerId === player.id);
  if (managed) {
    entry.managedByYou = true;
    managed.wentTo = 'Retired';
    managed.retiredYear = world.year;
  }
  // Worth keeping: anyone the manager worked with, and the genuine greats.
  //
  // The first bar was peak >= 110, which is roughly every player in the top two
  // divisions: measured, it produced 163 entries in five seasons of a small
  // world, none of whom the manager had ever met, and the cap thrashed from
  // then on. A hall of fame full of strangers is a list, not a record.
  if (entry.managedByYou || peak >= 150 || entry.apps >= 300) {
    world.hallOfFame.push(entry);
    if (world.hallOfFame.length > HALL_CAP) {
      world.hallOfFame.sort((a, b) => Number(!!b.managedByYou) - Number(!!a.managedByYou)
        || (b.peak + b.apps / 8) - (a.peak + a.apps / 8));
      world.hallOfFame.length = HALL_CAP;
    }
  }
  return entry;
}

/**
 * Lifetime totals, derived rather than stored.
 *
 * The one place that answers "what is this manager's record", so a screen
 * cannot answer it differently. `league` and `all` are separate because they
 * are separate questions, and the panel that showed both without labelling
 * either is the reason this function exists.
 */
export function careerTotals(manager) {
  const history = manager.history || [];
  const league = history.reduce((a, h) => ({
    matches: a.matches + h.w + h.d + h.l, w: a.w + h.w, d: a.d + h.d, l: a.l + h.l,
  }), { matches: 0, w: 0, d: 0, l: 0 });
  const all = {
    matches: manager.matches || 0, w: manager.wins || 0,
    d: manager.draws || 0, l: manager.losses || 0,
  };
  const pct = (r) => (r.matches ? (r.w / r.matches) * 100 : 0);
  return {
    league, all, leagueWinPct: pct(league), allWinPct: pct(all),
    seasons: history.length,
    clubs: new Set(history.map((h) => h.clubId)).size,
    honours: (manager.trophies || []).length,
    promotions: (manager.trophies || []).filter((t) => t.kind === 'promotion').length,
  };
}
