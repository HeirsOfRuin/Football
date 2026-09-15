// Season scheduling: league fixtures, domestic cups and continental competition.

import { subRng } from '../core/rng.js';
import { KEY_DAYS } from '../core/calendar.js';
import { sortBy, clamp } from '../core/util.js';

/** Circle-method round robin. Returns rounds of [homeId, awayId] pairs. */
export function roundRobin(teamIds, rng) {
  const teams = rng ? rng.shuffle([...teamIds]) : [...teamIds];
  if (teams.length % 2 === 1) teams.push(null); // bye
  const n = teams.length;
  const rounds = [];
  const list = [...teams];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a === null || b === null) continue;
      // Alternate home advantage so no team gets a lopsided split.
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    // Rotate all but the first.
    list.splice(1, 0, list.pop());
  }
  // Second half of the season: reverse every fixture.
  const second = rounds.map((pairs) => pairs.map(([h, a]) => [a, h]));
  return [...rounds, ...second];
}

let fixtureCounter = 0;
export function resetFixtureCounter() { fixtureCounter = 0; }

export function makeFixture(compId, compName, round, homeId, awayId, day, extra = {}) {
  return {
    id: `f${(++fixtureCounter).toString(36)}`,
    comp: compId,
    compName,
    round,
    homeId,
    awayId,
    day,
    played: false,
    result: null,
    neutral: false,
    leg: null,
    tieId: null,
    ...extra,
  };
}

export function emptyTableRow(clubId) {
  return { clubId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] };
}

/** Spread N rounds across a window, favouring weekends. */
function scheduleDays(count, startDay, endDay, rng, preferWeekend = true) {
  const days = [];
  const span = endDay - startDay;
  const step = span / count;
  for (let i = 0; i < count; i++) {
    let d = Math.round(startDay + i * step);
    if (preferWeekend) {
      // Nudge to the nearest Saturday/Sunday.
      const wd = d % 7;
      if (wd > 1) d += (7 - wd);
    }
    while (days.includes(d)) d += 1;
    days.push(clamp(d, startDay, endDay + 6));
  }
  return days;
}

export function buildLeagueSchedule(game, league) {
  const rng = subRng(game.rng, `sched:${league.id}:${game.season}`);
  const rounds = roundRobin(league.clubIds, rng);
  const days = scheduleDays(rounds.length, KEY_DAYS.seasonStart, KEY_DAYS.seasonEnd, rng);
  const fixtures = [];
  rounds.forEach((pairs, i) => {
    for (const [h, a] of pairs) {
      fixtures.push(makeFixture(league.id, league.name, i + 1, h, a, days[i]));
    }
  });
  league.table = league.clubIds.map(emptyTableRow);
  league.roundDays = days;
  return fixtures;
}

// --- Knockout helpers -------------------------------------------------------

let tieCounter = 0;

/** Pair entrants at random; odd teams receive byes. */
export function drawKnockoutRound(entrants, rng, opts = {}) {
  const pool = rng.shuffle([...entrants]);
  const ties = [];
  const byes = [];
  // Give byes so the round leaves a clean power of two, with the strongest
  // sides drawn out (a 62-team round becomes 30 ties and 2 byes, not 16 ties).
  let target = 1;
  while (target < pool.length) target *= 2;
  const byeCount = pool.length === target ? 0 : target - pool.length;
  if (byeCount > 0 && opts.strength) {
    const ranked = sortBy(pool, { key: opts.strength, desc: true });
    for (let i = 0; i < byeCount; i++) byes.push(ranked[i]);
  } else {
    for (let i = 0; i < byeCount; i++) byes.push(pool[i]);
  }
  const playing = pool.filter((id) => !byes.includes(id));
  for (let i = 0; i + 1 < playing.length; i += 2) {
    ties.push({ id: `t${(++tieCounter).toString(36)}`, home: playing[i], away: playing[i + 1] });
  }
  return { ties, byes };
}

export function cupRoundName(teamsRemaining, compName) {
  if (teamsRemaining <= 2) return 'Final';
  if (teamsRemaining <= 4) return 'Semi-Final';
  if (teamsRemaining <= 8) return 'Quarter-Final';
  if (teamsRemaining <= 16) return 'Round of 16';
  if (teamsRemaining <= 32) return 'Round of 32';
  if (teamsRemaining <= 64) return 'Round of 64';
  return `${compName} Preliminary`;
}

/** Midweek slots available for cup football. */
function midweekDays(from, to) {
  const out = [];
  for (let d = from; d <= to; d++) {
    const wd = d % 7;
    if (wd === 3 || wd === 4) out.push(d); // Tue/Wed
  }
  return out;
}

export function scheduleDomesticCup(game, comp) {
  const rng = subRng(game.rng, `cup:${comp.id}:${game.season}`);
  const world = game.world;
  const entrants = comp.entrants.filter((id) => world.clubs[id]);
  comp.rounds = [];
  comp.remaining = entrants;
  comp.winner = null;
  comp.season = game.season;

  const slots = midweekDays(56, KEY_DAYS.seasonEnd - 14);
  const roundCount = Math.ceil(Math.log2(entrants.length));
  comp.roundDays = [];
  for (let i = 0; i < roundCount; i++) {
    const idx = Math.floor((i + 0.6) * (slots.length / (roundCount + 0.6)));
    comp.roundDays.push(slots[Math.min(idx, slots.length - 1)]);
  }
  // The final gets its own weekend date.
  comp.roundDays[roundCount - 1] = KEY_DAYS.seasonEnd + 6;
  return openNextCupRound(game, comp, rng);
}

export function openNextCupRound(game, comp, rng = subRng(game.rng, `cupdraw:${comp.id}:${comp.rounds.length}`)) {
  const world = game.world;
  const remaining = comp.remaining || [];
  if (remaining.length <= 1) {
    comp.winner = remaining[0] || null;
    return [];
  }
  const roundIndex = comp.rounds.length;
  const day = comp.roundDays[Math.min(roundIndex, comp.roundDays.length - 1)];
  const { ties, byes } = drawKnockoutRound(remaining, rng, {
    strength: (id) => (world.clubs[id] ? world.clubs[id].rep : 0),
  });
  const name = cupRoundName(remaining.length, comp.name);
  const fixtures = ties.map((t) => makeFixture(comp.id, comp.name, name, t.home, t.away, day, {
    tieId: t.id, knockout: true, extraTime: true,
  }));
  comp.rounds.push({ name, day, ties, byes, fixtureIds: fixtures.map((f) => f.id), complete: false });
  return fixtures;
}

// --- Continental competition ------------------------------------------------

/** Seed continental entrants from last season's league positions. */
export function seedContinental(game) {
  const world = game.world;
  const out = { primary: [], secondary: [] };
  const tier1 = world.leagues.filter((l) => l.tier === 1);
  const ranked = sortBy(tier1, { key: (l) => l.rep, desc: true });
  for (const league of ranked) {
    const finishing = league.lastTable
      ? league.lastTable.map((r) => r.clubId)
      : sortBy(league.clubIds, { key: (id) => world.clubs[id].rep, desc: true });
    const strength = league.rep;
    const primarySlots = strength >= 88 ? 4 : strength >= 80 ? 3 : strength >= 70 ? 2 : 1;
    const secondarySlots = strength >= 80 ? 3 : 2;
    out.primary.push(...finishing.slice(0, primarySlots));
    out.secondary.push(...finishing.slice(primarySlots, primarySlots + secondarySlots));
  }
  return out;
}

export function scheduleContinental(game, comp, entrants) {
  const rng = subRng(game.rng, `cont:${comp.id}:${game.season}`);
  const world = game.world;
  const def = comp.def;
  comp.season = game.season;
  comp.groups = [];
  comp.rounds = [];
  comp.winner = null;

  const pool = entrants.filter((id) => world.clubs[id]).slice(0, def.groupTeams);
  comp.entrants = pool;
  if (pool.length < 8) return [];

  // Seed into pots by club reputation, then draw one club per pot per group.
  const ranked = sortBy(pool, { key: (id) => world.clubs[id].rep, desc: true });
  const groupCount = Math.floor(pool.length / def.groupSize);
  const pots = [];
  for (let p = 0; p < def.groupSize; p++) {
    pots.push(rng.shuffle(ranked.slice(p * groupCount, (p + 1) * groupCount)));
  }
  for (let g = 0; g < groupCount; g++) {
    const clubs = pots.map((pot) => pot[g]).filter(Boolean);
    comp.groups.push({
      name: `Group ${String.fromCharCode(65 + g)}`,
      clubIds: clubs,
      table: clubs.map(emptyTableRow),
    });
  }

  const fixtures = [];
  const groupDays = [70, 91, 112, 133, 154, 168];
  comp.groups.forEach((group, gi) => {
    const rounds = roundRobin(group.clubIds, subRng(rng, `g${gi}`));
    rounds.forEach((pairs, ri) => {
      for (const [h, a] of pairs) {
        fixtures.push(makeFixture(comp.id, comp.name, `Group Stage ${ri + 1}`, h, a, groupDays[ri] ?? 168, {
          group: group.name, continental: true,
        }));
      }
    });
  });
  comp.knockoutDays = [[215, 229], [250, 264], [285, 299], [KEY_DAYS.seasonEnd + 13]];
  comp.stage = 'group';
  // Record the group fixtures the same way each knockout round records its own.
  // Without this the daily group-table update has to scan every fixture in the
  // world to find the forty it cares about.
  comp.groupFixtureIds = fixtures.map((f) => f.id);
  return fixtures;
}

/** Called when the group stage finishes: build the knockout bracket. */
export function continentalKnockout(game, comp) {
  const rng = subRng(game.rng, `contko:${comp.id}:${comp.rounds.length}`);
  const qualified = [];
  for (const group of comp.groups) {
    const table = sortTable(group.table);
    qualified.push(table[0].clubId, table[1].clubId);
  }
  comp.remaining = rng.shuffle(qualified);
  comp.stage = 'knockout';
  return openContinentalRound(game, comp);
}

export function openContinentalRound(game, comp) {
  const rng = subRng(game.rng, `contrd:${comp.id}:${comp.rounds.length}:${game.season}`);
  const remaining = comp.remaining || [];
  if (remaining.length <= 1) {
    comp.winner = remaining[0] || null;
    return [];
  }
  const roundIndex = comp.rounds.length;
  const isFinal = remaining.length === 2;
  const days = comp.knockoutDays[Math.min(roundIndex, comp.knockoutDays.length - 1)];
  const { ties } = drawKnockoutRound(remaining, rng);
  const name = cupRoundName(remaining.length, comp.name);
  const fixtures = [];
  for (const t of ties) {
    if (isFinal) {
      fixtures.push(makeFixture(comp.id, comp.name, 'Final', t.home, t.away, days[0], {
        tieId: t.id, knockout: true, extraTime: true, neutral: true, continental: true,
      }));
    } else {
      fixtures.push(makeFixture(comp.id, comp.name, name, t.home, t.away, days[0], {
        tieId: t.id, knockout: true, leg: 1, continental: true,
      }));
      fixtures.push(makeFixture(comp.id, comp.name, name, t.away, t.home, days[1], {
        tieId: t.id, knockout: true, leg: 2, extraTime: true, continental: true,
      }));
    }
  }
  comp.rounds.push({ name, ties, fixtureIds: fixtures.map((f) => f.id), complete: false, twoLegged: !isFinal });
  return fixtures;
}

// --- Tables -----------------------------------------------------------------

export function sortTable(rows) {
  return sortBy(rows,
    { key: (r) => r.pts, desc: true },
    { key: (r) => r.gd, desc: true },
    { key: (r) => r.gf, desc: true },
    { key: (r) => r.clubId });
}

export function applyResultToTable(table, result) {
  const home = table.find((r) => r.clubId === result.homeClubId);
  const away = table.find((r) => r.clubId === result.awayClubId);
  if (!home || !away) return;
  home.p++; away.p++;
  home.gf += result.homeGoals; home.ga += result.awayGoals;
  away.gf += result.awayGoals; away.ga += result.homeGoals;
  home.gd = home.gf - home.ga; away.gd = away.gf - away.ga;
  if (result.homeGoals > result.awayGoals) {
    home.w++; home.pts += 3; away.l++;
    home.form.push('W'); away.form.push('L');
  } else if (result.homeGoals < result.awayGoals) {
    away.w++; away.pts += 3; home.l++;
    home.form.push('L'); away.form.push('W');
  } else {
    home.d++; away.d++; home.pts++; away.pts++;
    home.form.push('D'); away.form.push('D');
  }
  if (home.form.length > 6) home.form.shift();
  if (away.form.length > 6) away.form.shift();
}

/** Resolve a two-legged tie. Returns the winning club id. */
export function resolveTie(game, comp, tie, fixtures) {
  const legs = fixtures.filter((f) => f.tieId === tie.id && f.played);
  if (!legs.length) return null;
  let aGoals = 0;
  let bGoals = 0;
  for (const f of legs) {
    if (f.homeId === tie.home) { aGoals += f.result.homeGoals; bGoals += f.result.awayGoals; }
    else { bGoals += f.result.homeGoals; aGoals += f.result.awayGoals; }
  }
  if (aGoals > bGoals) return tie.home;
  if (bGoals > aGoals) return tie.away;
  const last = legs[legs.length - 1];
  if (last.result.shootoutWinner) {
    return last.result.shootoutWinner === 'home' ? last.homeId : last.awayId;
  }
  return tie.home;
}

/** Positions that earn promotion, relegation or continental football. */
export function leagueZones(league) {
  const teams = league.teams;
  // The bottom division of a pyramid has nowhere to send anyone, and the top
  // has nowhere to promote from. Showing those zones promises something the
  // game will not do.
  const canRelegate = league.hasDivisionBelow !== false;
  const canPromote = league.hasDivisionAbove !== false && league.tier > 1;
  return {
    champion: 1,
    promotion: canPromote ? league.promoted : 0,
    playoff: canPromote ? [league.promoted + 1, Math.min(teams, league.promoted + 4)] : null,
    relegation: canRelegate ? league.relegated : 0,
    continentalPrimary: league.tier === 1 ? (league.rep >= 88 ? 4 : league.rep >= 80 ? 3 : league.rep >= 70 ? 2 : 1) : 0,
    continentalSecondary: league.tier === 1 ? (league.rep >= 80 ? 3 : 2) : 0,
  };
}
