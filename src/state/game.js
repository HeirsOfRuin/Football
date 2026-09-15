// Game state and the day-by-day simulation loop.

import { Rng, subRng } from '../core/rng.js';
import { clamp, remap, sortBy, money } from '../core/util.js';
import { SEASON_DAYS, KEY_DAYS, transferWindowOpen, dayToDate } from '../core/calendar.js';
import { generateWorld, squadStrength } from '../gen/worldgen.js';
import { abilityForReputation } from '../data/nations.js';
import { generatePlayer, emptyStats, estimateValue } from '../gen/playergen.js';
import { currentAbility } from '../data/attributes.js';
import { beginMatch, runMatch, playExtraTime, penaltyShootout } from '../engine/match.js';
import { autoPick, autoAssignSpecialists } from '../engine/lineup.js';
import {
  buildLeagueSchedule, scheduleDomesticCup, openNextCupRound, scheduleContinental,
  seedContinental, continentalKnockout, openContinentalRound, sortTable, applyResultToTable,
  emptyTableRow, resolveTie, resetFixtureCounter, leagueZones,
} from '../engine/season.js';
import { applyMatchdayIncome, applyMonthlyIncome, payWeeklyWages, setSeasonBudgets, payLeaguePrize, payCompetitionPrize } from '../engine/finance.js';
import { trainPlayer, dailyPlayerTick, applyMatchEffects, processDisciplinary, generateYouthIntake, refreshSquadThresholds } from '../engine/training.js';
import { aiTransferAttempt, aiSquadTrim, aiReleaseSurplus, marketValue, contractDemand, renewContract, releasePlayer } from '../engine/transfers.js';
import { prepareAiClub, updateBoardConfidence, considerSacking, seasonVerdict, aiSquadHousekeeping } from '../engine/ai.js';
import { news, matchHeadline } from '../engine/news.js';

// Bump whenever the shape written by the save codec changes, and add a
// migration in codec.js. Version 2 dropped the stored player `value` field in
// favour of deriving worth in one place.
export const GAME_VERSION = 2;

export function newGame(opts = {}) {
  const {
    seed = Math.floor(Math.random() * 2 ** 31), size = 'medium', year = 2025,
    managerName = 'Manager', managerNat = 'ALB', clubId = null,
    customPlayers = [], customPlacement = 'free',
  } = opts;

  resetFixtureCounter();
  const world = generateWorld({ seed, size, year, customPlayers, customPlacement });
  const game = {
    version: GAME_VERSION,
    world,
    seed,
    season: 1,
    day: 0,
    userClubId: clubId,
    manager: {
      name: managerName,
      nat: managerNat,
      reputation: 25,
      history: [],
      trophies: [],
      matches: 0, wins: 0, draws: 0, losses: 0,
    },
    fixtures: {},
    fixturesByDay: {},
    inbox: [],
    transferLog: [],
    shortlist: [],
    scouted: {},
    status: 'idle',
    pendingMatchId: null,
    lastResults: [],
    rng: new Rng(seed ^ 0x9e3779b9),
    settings: { matchSpeed: 'normal', autoPickOnMatchday: false, confirmContinue: true },
  };

  if (clubId && world.clubs[clubId]) {
    const club = world.clubs[clubId];
    club.isUserClub = true;
    club.manager = { name: managerName, nat: managerNat, style: 'Manager', attacking: 12, defending: 12, tactical: 12, manManagement: 12, youthDev: 12, discipline: 12, reputation: 25, yearsAtClub: 0 };
    club.tactic = autoAssignSpecialists(world, club, autoPick(world, club, club.tactic));
  }

  startSeason(game, true);
  return game;
}

/**
 * Hand a club to the player after the world has been generated. Kept separate
 * from newGame so the setup screen can build a world, let the manager browse
 * the clubs in it, and then take one over without regenerating everything.
 */
export function takeOverClub(game, clubId, managerName, managerNat) {
  const world = game.world;
  const club = world.clubs[clubId];
  if (!club) return false;
  for (const c of Object.values(world.clubs)) c.isUserClub = false;
  club.isUserClub = true;
  game.userClubId = clubId;
  if (managerName) game.manager.name = managerName;
  if (managerNat) game.manager.nat = managerNat;
  // Taking a job at a big club lifts your standing in the game; it does not
  // drop it if you move down, since the record you built stays with you.
  game.manager.reputation = clamp(
    Math.max(game.manager.reputation, remap(club.rep, 20, 99, 12, 86) * 0.7), 1, 100,
  );
  club.manager = {
    name: game.manager.name, nat: game.manager.nat, style: 'Manager',
    attacking: 12, defending: 12, tactical: 12, manManagement: 12,
    youthDev: 12, discipline: 12, reputation: game.manager.reputation, yearsAtClub: 0,
  };
  club.tactic = autoAssignSpecialists(world, club, autoPick(world, club, club.tactic));

  const league = world.leagues.find((l) => l.id === club.leagueId);
  news(game, 'media', 'Welcome to the hot seat',
    `${game.manager.name} takes charge of ${club.name}. The local press are keen to see what direction the new manager takes.`);
  news(game, 'board', `${world.year}/${String(world.year + 1).slice(2)} season underway`,
    `The board expect you to ${club.board.expectation.label.toLowerCase()} in the ${league.name}. `
    + `You have a transfer budget of ${money(club.finances.transferBudget)} and a wage budget of `
    + `${money(club.finances.wageBudgetAnnual / 52)} per week.`);
  return true;
}

export function userClub(game) {
  return game.userClubId ? game.world.clubs[game.userClubId] : null;
}

// --- Season setup -----------------------------------------------------------

export function startSeason(game, isFirst = false) {
  const world = game.world;
  game.day = 0;
  game.fixtures = {};
  game.fixturesByDay = {};

  for (const league of world.leagues) {
    league.table = league.clubIds.map(emptyTableRow);
    league.season = world.year;
    const fixtures = buildLeagueSchedule(game, league);
    addFixtures(game, fixtures);
  }

  for (const comp of Object.values(world.competitions)) {
    if (comp.type === 'cup') {
      comp.entrants = Object.values(world.clubs).filter((c) => c.nation === comp.nation).map((c) => c.id);
      addFixtures(game, scheduleDomesticCup(game, comp));
    }
  }

  const seeds = seedContinental(game);
  const primary = world.competitions.CONT_CUP;
  const secondary = world.competitions.CONT_SHIELD;
  if (primary) addFixtures(game, scheduleContinental(game, primary, seeds.primary));
  if (secondary) addFixtures(game, scheduleContinental(game, secondary, seeds.secondary));

  const budgetRng = subRng(game.rng, `budgets:${game.season}`);
  for (const club of Object.values(world.clubs)) {
    setSeasonBudgets(game, club, budgetRng);
    club.form = [];
    club.seasonRecord = { w: 0, d: 0, l: 0 };
  }

  for (const p of Object.values(world.players)) {
    p.season = emptyStats();
    p.yellowCards = 0;
    p.suspension = 0;
    p.condition = clamp(80 + (game.rng.next() * 15), 60, 100);
    p.sharpness = 35;
  }

  const club = userClub(game);
  if (club) {
    const league = world.leagues.find((l) => l.id === club.leagueId);
    news(game, 'board', `${world.year}/${String(world.year + 1).slice(2)} season underway`,
      `The board expect you to ${club.board.expectation.label.toLowerCase()} in the ${league.name}. `
      + `You have a transfer budget of ${money(club.finances.transferBudget)} and a wage budget of `
      + `${money(club.finances.wageBudgetAnnual / 52)} per week.`);
    if (isFirst) {
      news(game, 'media', 'Welcome to the hot seat',
        `${game.manager.name} takes charge of ${club.name}. The local press are keen to see what direction the new manager takes.`);
    }
  }
  game.status = 'idle';
}

function addFixtures(game, fixtures) {
  for (const f of fixtures) {
    game.fixtures[f.id] = f;
    if (!game.fixturesByDay[f.day]) game.fixturesByDay[f.day] = [];
    game.fixturesByDay[f.day].push(f.id);
  }
}

export function fixturesOn(game, day) {
  return (game.fixturesByDay[day] || []).map((id) => game.fixtures[id]).filter(Boolean);
}

export function clubFixtures(game, clubId) {
  return sortBy(Object.values(game.fixtures).filter((f) => f.homeId === clubId || f.awayId === clubId),
    (f) => f.day);
}

export function nextFixtureFor(game, clubId) {
  return clubFixtures(game, clubId).find((f) => !f.played) || null;
}

// --- Match handling ---------------------------------------------------------

function competitionImportance(game, fixture) {
  if (fixture.continental) return fixture.round === 'Final' ? 1 : 0.7;
  if (fixture.knockout) return fixture.round === 'Final' ? 0.95 : 0.5;
  const league = game.world.leagues.find((l) => l.id === fixture.comp);
  if (!league) return 0.3;
  return remap(league.rep, 50, 95, 0.2, 0.5);
}

export function prepareFixture(game, fixture) {
  const world = game.world;
  const home = world.clubs[fixture.homeId];
  const away = world.clubs[fixture.awayId];
  const rng = subRng(game.rng, `prep:${fixture.id}`);
  if (!home.isUserClub) prepareAiClub(world, home, away, true, rng);
  if (!away.isUserClub) prepareAiClub(world, away, home, false, rng);
  return { home, away };
}

export function createMatchState(game, fixture) {
  const { home, away } = prepareFixture(game, fixture);
  const rng = subRng(game.rng, `match:${fixture.id}:${game.season}`);
  const state = beginMatch(game.world, {
    homeClub: home,
    awayClub: away,
    homeTactic: home.tactic,
    awayTactic: away.tactic,
    competition: fixture.compName,
    neutral: fixture.neutral,
    importance: competitionImportance(game, fixture),
    rng,
  });
  state.fixtureId = fixture.id;
  return state;
}

/** Simulate a fixture end to end (used for every match the user is not at). */
export function playFixture(game, fixture) {
  const state = createMatchState(game, fixture);
  state.autoManageUser = true;
  runMatch(state);
  finishFixture(game, fixture, state);
  return state;
}

/** Apply a completed match state to the world. */
export function finishFixture(game, fixture, state) {
  const world = game.world;
  const home = world.clubs[fixture.homeId];
  const away = world.clubs[fixture.awayId];

  // Knockout ties that are level need extra time and penalties.
  if (fixture.extraTime && !fixture.settledByAggregate) {
    const needsWinner = decideNeedsWinner(game, fixture, state);
    if (needsWinner && state.home.goals === state.away.goals) {
      playExtraTime(state);
      if (state.home.goals === state.away.goals) {
        const shootout = penaltyShootout(state);
        state.result.shootoutWinner = shootout.winner;
        state.result.shootout = shootout;
      }
    }
  }

  fixture.played = true;
  fixture.result = state.result;

  const league = world.leagues.find((l) => l.id === fixture.comp);
  if (league && league.table) applyResultToTable(league.table, state.result);

  // Club form + record.
  const outcome = state.result.homeGoals > state.result.awayGoals ? ['W', 'L']
    : state.result.homeGoals < state.result.awayGoals ? ['L', 'W'] : ['D', 'D'];
  [home, away].forEach((c, i) => {
    c.form.push(outcome[i]);
    if (c.form.length > 6) c.form.shift();
    if (league) {
      c.seasonRecord = c.seasonRecord || { w: 0, d: 0, l: 0 };
      if (outcome[i] === 'W') c.seasonRecord.w++;
      else if (outcome[i] === 'D') c.seasonRecord.d++;
      else c.seasonRecord.l++;
    }
  });

  // Player effects.
  applyMatchEffects(world, state.home, state.away.goals, state.home.goals);
  applyMatchEffects(world, state.away, state.home.goals, state.away.goals);
  const bansHome = processDisciplinary(world, state.home);
  const bansAway = processDisciplinary(world, state.away);

  // Serve suspensions for players who were not involved.
  for (const club of [home, away]) {
    for (const id of club.squad) {
      const p = world.players[id];
      if (p && p.suspension > 0 && !state.home.records[id] && !state.away.records[id]) p.suspension--;
    }
  }

  // Money.
  const compKind = fixture.continental ? 'continental' : fixture.knockout ? 'cup' : 'league';
  if (!fixture.neutral) applyMatchdayIncome(game, home, away, state.attendance, compKind);
  payAppearanceBonuses(game, state.home, home);
  payAppearanceBonuses(game, state.away, away);

  const userId = game.userClubId;
  if (fixture.homeId === userId || fixture.awayId === userId) {
    game.manager.matches++;
    const isHome = fixture.homeId === userId;
    const res = isHome ? outcome[0] : outcome[1];
    if (res === 'W') game.manager.wins++;
    else if (res === 'D') game.manager.draws++;
    else game.manager.losses++;
    reportUserMatch(game, fixture, state, isHome, isHome ? bansHome : bansAway);
  }

  // Full event logs are only worth keeping for the user's own matches; for the
  // rest of the world the summary is enough, and dropping them keeps both
  // memory and save files small.
  const isUserFixture = fixture.homeId === game.userClubId || fixture.awayId === game.userClubId;
  if (!isUserFixture) {
    fixture.result.events = null;
    fixture.result.records = null;
  } else {
    game.detailedFixtures = game.detailedFixtures || [];
    game.detailedFixtures.push(fixture.id);
    while (game.detailedFixtures.length > 12) {
      const old = game.fixtures[game.detailedFixtures.shift()];
      if (old?.result) { old.result.events = null; old.result.records = null; }
    }
  }

  reportNotableResult(game, fixture, state, home, away);

  // Resolve any competition round this result completed. This has to happen
  // here rather than once per day: the user's own match is played after the
  // day has advanced, so a round they finish themselves — a cup final they win
  // — would otherwise never be settled, paid out or awarded.
  advanceCompetitions(game, subRng(game.rng, `comp:${fixture.id}`));

  game.lastResults.unshift({
    day: game.day, comp: fixture.compName, round: fixture.round,
    home: home.short, away: away.short, hg: state.result.homeGoals, ag: state.result.awayGoals,
    fixtureId: fixture.id,
  });
  if (game.lastResults.length > 60) game.lastResults.length = 60;

  return state;
}

/**
 * The press cover results in the manager's own division: thrashings, and any
 * time a smaller side turns one over.
 */
function reportNotableResult(game, fixture, state, home, away) {
  const user = userClub(game);
  if (!user || user.leagueId !== home.leagueId) return;
  if (fixture.homeId === user.id || fixture.awayId === user.id) return;
  const hg = state.result.homeGoals;
  const ag = state.result.awayGoals;
  const margin = Math.abs(hg - ag);
  const winner = hg > ag ? home : ag > hg ? away : null;
  const loser = winner === home ? away : home;
  const upset = winner ? winner.rep < loser.rep - 14 : false;
  if (margin < 4 && !upset) return;
  if (!game.rng.chance(0.5)) return;
  const rng = subRng(game.rng, `headline:${fixture.id}`);
  news(game, 'media', matchHeadline(rng, home, away, hg, ag, upset),
    `${home.name} ${hg}-${ag} ${away.name} at ${home.stadium.name}, in front of ${state.result.attendance.toLocaleString()}.`,
    { fixtureId: fixture.id });
}

function decideNeedsWinner(game, fixture, state) {
  if (!fixture.tieId) return fixture.knockout;
  const comp = game.world.competitions[fixture.comp];
  if (!comp) return true;
  const round = comp.rounds[comp.rounds.length - 1];
  if (!round || !round.twoLegged) return true;
  // Second leg: extra time only if the aggregate is level.
  const tie = round.ties.find((t) => t.id === fixture.tieId);
  if (!tie) return true;
  const legs = Object.values(game.fixtures).filter((f) => f.tieId === fixture.tieId && f.played && f.id !== fixture.id);
  if (!legs.length) return false; // first leg: draws stand
  let a = 0;
  let b = 0;
  for (const f of [...legs]) {
    if (f.homeId === tie.home) { a += f.result.homeGoals; b += f.result.awayGoals; }
    else { b += f.result.homeGoals; a += f.result.awayGoals; }
  }
  if (fixture.homeId === tie.home) { a += state.home.goals; b += state.away.goals; }
  else { b += state.home.goals; a += state.away.goals; }
  return a === b;
}

function payAppearanceBonuses(game, side, club) {
  const world = game.world;
  let total = 0;
  for (const id in side.records) {
    const r = side.records[id];
    if (r.minutes < 45) continue;
    const p = world.players[id];
    if (!p?.contract) continue;
    total += p.contract.appearanceFee || 0;
    total += (p.contract.goalBonus || 0) * r.goals;
  }
  if (total > 0) {
    club.finances.balance -= total;
    club.finances.seasonSpend += total;
  }
}

function reportUserMatch(game, fixture, state, isHome, bans) {
  const club = userClub(game);
  const opp = game.world.clubs[isHome ? fixture.awayId : fixture.homeId];
  const gf = isHome ? state.result.homeGoals : state.result.awayGoals;
  const ga = isHome ? state.result.awayGoals : state.result.homeGoals;
  const verdict = gf > ga ? 'Win' : gf === ga ? 'Draw' : 'Defeat';
  const body = `${club.name} ${gf}-${ga} ${opp.name} (${isHome ? 'home' : 'away'}, ${fixture.compName}). `
    + (state.motm ? `Man of the match: ${state.motm.name} (${state.motm.rating.toFixed(1)}).` : '');
  news(game, 'match', `${verdict}: ${club.short} ${gf}-${ga} ${opp.short}`, body, { fixtureId: fixture.id });
  for (const b of bans) {
    news(game, 'squad', `${b.player.name} suspended`,
      `${b.player.name} misses the next ${b.games} match${b.games > 1 ? 'es' : ''} (${b.reason}).`);
  }
  for (const ev of state.events.filter((e) => e.type === 'injury')) {
    const p = game.world.players[ev.playerId];
    if (p && p.clubId === club.id) {
      news(game, 'squad', `${p.name} injured`, `${p.name} picked up ${ev.text.split('— ')[1] || 'an injury'} and is expected to be out for around ${ev.days} days.`);
    }
  }
}

// --- Daily loop -------------------------------------------------------------

/**
 * Advance one day. Returns a status object telling the UI what happened and
 * whether it needs to stop (user match, season end, board news).
 */
export function advanceDay(game) {
  if (game.status === 'userMatch') return { stopped: true, reason: 'userMatch' };
  const world = game.world;
  game.day += 1;

  if (game.day >= SEASON_DAYS) {
    return { stopped: true, reason: 'seasonRollover' };
  }

  const dayRng = subRng(game.rng, `day:${game.season}:${game.day}`);

  // Recovery, injuries and morale for everyone.
  tickPlayers(game, dayRng);

  // Weekly training and wages.
  if (game.day % 7 === 3) runWeeklyTraining(game, dayRng);
  if (game.day % 7 === 6) publishTransferDigest(game);
  if (game.day % 7 === 5) {
    for (const club of Object.values(world.clubs)) payWeeklyWages(game, club);
  }
  const date = dayToDate(game.day);
  if (date.dayOfMonth === 1) {
    for (const club of Object.values(world.clubs)) applyMonthlyIncome(game, club);
  }

  // Transfer market.
  if (transferWindowOpen(game.day)) runTransferDay(game, dayRng);
  else if (game.day === KEY_DAYS.summerWindowEnd + 1 || game.day === KEY_DAYS.winterWindowEnd + 1) {
    news(game, 'transfer', 'Transfer window closed', 'The transfer window has closed. No further permanent signings can be made until it reopens.');
  }

  // Fixtures.
  const todays = fixturesOn(game, game.day).filter((f) => !f.played);
  const userFixture = todays.find((f) => f.homeId === game.userClubId || f.awayId === game.userClubId);
  for (const f of todays) {
    if (f === userFixture) continue;
    playFixture(game, f);
  }

  if (userFixture) {
    game.status = 'userMatch';
    game.pendingMatchId = userFixture.id;
    return { stopped: true, reason: 'userMatch', fixture: userFixture };
  }

  // A monthly read on where the manager stands with the board.
  if (date.dayOfMonth === 2 && game.day > 90) checkBoardMood(game);

  // Youth intake and end-of-season milestones.
  if (game.day === 268) runYouthIntake(game, dayRng);
  if (game.day === KEY_DAYS.boardReview) return { stopped: true, reason: 'seasonReview' };

  return { stopped: false };
}

function checkBoardMood(game) {
  const club = userClub(game);
  if (!club) return;
  const league = game.world.leagues.find((l) => l.id === club.leagueId);
  if (!league) return;
  const table = sortTable(league.table);
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  if (!pos) return;
  updateBoardConfidence(game, club, pos, league.teams);
  if (club.board.confidence < 26 && !club.board.warned) {
    club.board.warned = true;
    news(game, 'board', 'The board are losing patience',
      `You were asked to ${club.board.expectation.label.toLowerCase()}. Sitting ${pos} of ${league.teams}, `
      + 'the board have made clear they expect a marked improvement before the end of the season.');
  } else if (club.board.confidence > 45) {
    club.board.warned = false;
  }
}

function tickPlayers(game, rng) {
  const world = game.world;
  for (const club of Object.values(world.clubs)) refreshSquadThresholds(world, club);
  const playedYesterday = new Set();
  for (const f of fixturesOn(game, game.day - 1)) {
    if (!f.played) continue;
    for (const rec of [f.result?.records?.home, f.result?.records?.away]) {
      if (!rec) continue;
      for (const id in rec) if (rec[id].minutes > 0) playedYesterday.add(id);
    }
  }
  for (const id in world.players) {
    const p = world.players[id];
    const club = p.clubId ? world.clubs[p.clubId] : null;
    const before = p.injury;
    const status = dailyPlayerTick(rng, world, club, p, playedYesterday.has(id));
    if (status === 'recovered' && club?.isUserClub) {
      news(game, 'squad', `${p.name} is fit again`, `${p.name} has recovered from ${before?.type || 'injury'} and is available for selection.`);
    }
  }
}

function runWeeklyTraining(game, rng) {
  const world = game.world;
  for (const id in world.players) {
    const p = world.players[id];
    const club = p.clubId ? world.clubs[p.clubId] : null;
    const before = club?.isUserClub ? currentAbility(p) : 0;
    const changed = trainPlayer(rng, world, club, p);
    if (changed && club?.isUserClub) {
      const after = currentAbility(p);
      if (after - before >= 4) {
        news(game, 'squad', `${p.name} is progressing well`,
          `The coaching staff report notable improvement from ${p.name} in training.`);
      }
    }
  }
}

function runTransferDay(game, rng) {
  const world = game.world;
  const clubs = Object.values(world.clubs).filter((c) => !c.isUserClub);
  // A handful of clubs act each day so the market moves gradually.
  const actors = Math.max(4, Math.round(clubs.length * 0.14));
  for (let i = 0; i < actors; i++) {
    const club = rng.pick(clubs);
    if (rng.chance(0.7)) {
      const deal = aiTransferAttempt(game, club, rng);
      if (deal) reportTransfer(game, deal);
    } else {
      aiSquadTrim(game, club, rng);
    }
  }
  // Clubs also chase the user's listed players.
  const user = userClub(game);
  if (user && rng.chance(0.25)) {
    const listed = user.squad.map((id) => world.players[id]).filter((p) => p?.transferStatus === 'listed');
    if (listed.length) {
      const target = rng.pick(listed);
      const suitor = rng.weighted(clubs, (c) => Math.max(0.01, 1 / (1 + Math.abs(c.rep - user.rep) / 8)));
      const offer = Math.round(marketValue(world, target) * rng.range(0.8, 1.25) / 5000) * 5000;
      if (offer > 0 && offer <= suitor.finances.transferBudget) {
        const existing = (game.offers || []).find((o) => o.playerId === target.id && o.clubId === suitor.id);
        if (!existing) {
          game.offers = game.offers || [];
          game.offers.push({ id: `o${Object.keys(game.fixtures).length}_${target.id}_${suitor.id}`, playerId: target.id, clubId: suitor.id, fee: offer, day: game.day });
          news(game, 'transfer', `Offer received for ${target.name}`,
            `${suitor.name} have offered ${money(offer)} for ${target.name}. Review it on the Transfers screen.`,
            { playerId: target.id, offerClub: suitor.id, fee: offer });
        }
      }
    }
  }
}

/**
 * Only a fraction of the world's transfers are worth telling the manager
 * about: marquee moves, business inside their own division, and anyone they
 * were tracking themselves. Reporting every deal buries the inbox.
 */
function reportTransfer(game, deal) {
  const user = userClub(game);
  if (!user) return;
  const body = `${deal.to.name} have signed ${deal.player.name}${deal.from ? ` from ${deal.from.name}` : ' on a free transfer'}`
    + `${deal.fee > 0 ? ` for a reported ${money(deal.fee)}` : ''}.`;

  // A player the manager was tracking is worth interrupting them for.
  if (game.shortlist.includes(deal.player.id)) {
    news(game, 'transfer', `Shortlisted player signs elsewhere: ${deal.player.name}`, body, { playerId: deal.player.id });
    return;
  }
  const sameDivision = deal.to.leagueId === user.leagueId || deal.from?.leagueId === user.leagueId;
  if (deal.fee < 8e6 && !sameDivision) return;
  game.pendingTransferNews = game.pendingTransferNews || [];
  game.pendingTransferNews.push({ line: body, fee: deal.fee, sameDivision });
}

/** Everything else goes out as one weekly round-up. */
function publishTransferDigest(game) {
  const pending = game.pendingTransferNews || [];
  game.pendingTransferNews = [];
  if (pending.length < 2) return;
  const top = sortBy(pending, { key: (d) => d.fee + (d.sameDivision ? 5e6 : 0), desc: true }).slice(0, 6);
  news(game, 'transfer', `Transfer round-up (${pending.length} deals)`,
    top.map((d) => `• ${d.line}`).join('\n')
    + (pending.length > top.length ? `\n\nPlus ${pending.length - top.length} other completed moves.` : ''));
}

function runYouthIntake(game, rng) {
  const world = game.world;
  for (const club of Object.values(world.clubs)) {
    const all = generateYouthIntake(rng, world, club, world.year, generatePlayer, null);
    // Only as many scholars as there is room for — otherwise squads grow without
    // bound, season after season, until the list is unmanageable.
    const room = Math.max(0, 32 - club.squad.length);
    const intake = all.slice(0, room);
    const turnedAway = all.length - intake.length;
    for (const p of intake) {
      world.players[p.id] = p;
      club.squad.push(p.id);
      const taken = new Set(club.squad.map((id) => world.players[id]?.squadNumber).filter(Boolean));
      for (let n = 30; n <= 70; n++) if (!taken.has(n)) { p.squadNumber = n; break; }
    }
    if (club.isUserClub) {
      if (intake.length) {
        const best = sortBy(intake, { key: (p) => p.pa, desc: true })[0];
        news(game, 'youth', 'Youth intake arrives',
          `${intake.length} young players have joined the academy. The staff are most excited about ${best.name}, `
          + `a ${best.age}-year-old ${best.positions[0]}.`
          + (turnedAway ? ` ${turnedAway} more were not offered scholarships — there is no room in the squad for them.` : ''));
      } else if (turnedAway) {
        news(game, 'youth', 'No youth intake this year',
          `The academy produced ${turnedAway} candidates, but with ${club.squad.length} players already registered there was no room `
          + 'for any of them. Trim the squad if you want next year\'s crop.');
      }
    }
  }
}

// --- Competition progression ------------------------------------------------

function advanceCompetitions(game, rng) {
  const world = game.world;
  for (const comp of Object.values(world.competitions)) {
    if (comp.type === 'cup') advanceCup(game, comp, rng);
    else if (comp.type === 'continental') advanceContinental(game, comp, rng);
  }
}

function advanceCup(game, comp, rng) {
  const round = comp.rounds[comp.rounds.length - 1];
  if (!round || round.complete) return;
  const fixtures = round.fixtureIds.map((id) => game.fixtures[id]).filter(Boolean);
  if (!fixtures.length || fixtures.some((f) => !f.played)) return;
  round.complete = true;

  const winners = [...round.byes];
  for (const f of fixtures) {
    const w = f.result.shootoutWinner
      ? (f.result.shootoutWinner === 'home' ? f.homeId : f.awayId)
      : f.result.homeGoals > f.result.awayGoals ? f.homeId : f.awayId;
    winners.push(w);
    const club = game.world.clubs[w];
    payCompetitionPrize(game, club, `${comp.name} ${round.name} prize`, comp.prizePerRound);
  }
  comp.remaining = winners;

  const user = game.userClubId;
  if (user && fixtures.some((f) => f.homeId === user || f.awayId === user)) {
    const through = winners.includes(user);
    news(game, 'competition', `${comp.name}: ${through ? 'through to the next round' : 'knocked out'}`,
      through ? `${game.world.clubs[user].name} progress in the ${comp.name}.`
        : `${game.world.clubs[user].name} are out of the ${comp.name} at the ${round.name} stage.`);
  }

  if (winners.length <= 1) {
    comp.winner = winners[0];
    announceTrophy(game, comp, winners[0]);
    return;
  }
  addFixtures(game, openNextCupRound(game, comp, subRng(rng, comp.id)));
}

function advanceContinental(game, comp, rng) {
  if (!comp.groups?.length) return;
  if (comp.stage === 'group') {
    // Scanning every fixture in the world here, once a day per competition, was
    // the single most expensive thing in a season once the pyramid grew: over a
    // fifth of the total. Saves drawn before the ids were recorded rebuild them
    // once, so no migration is needed.
    if (!comp.groupFixtureIds) {
      comp.groupFixtureIds = Object.values(game.fixtures)
        .filter((f) => f.comp === comp.id && !f.knockout).map((f) => f.id);
    }
    const groupFixtures = comp.groupFixtureIds.map((id) => game.fixtures[id]).filter(Boolean);
    // Keep group tables current.
    for (const f of groupFixtures) {
      if (!f.played || f.counted) continue;
      const group = comp.groups.find((g) => g.name === f.group);
      if (group) applyResultToTable(group.table, f.result);
      f.counted = true;
    }
    if (groupFixtures.every((f) => f.played)) {
      for (const g of comp.groups) {
        for (const row of sortTable(g.table).slice(0, 2)) {
          payCompetitionPrize(game, game.world.clubs[row.clubId], `${comp.name} group stage`, comp.def.prizeGroup);
        }
      }
      addFixtures(game, continentalKnockout(game, comp));
      const user = game.userClubId;
      if (user && comp.entrants.includes(user)) {
        const through = (comp.remaining || []).includes(user);
        news(game, 'competition', `${comp.name} group stage complete`,
          through ? 'You have qualified for the knockout rounds.' : 'You have been eliminated at the group stage.');
      }
    }
    return;
  }

  const round = comp.rounds[comp.rounds.length - 1];
  if (!round || round.complete) return;
  const fixtures = round.fixtureIds.map((id) => game.fixtures[id]).filter(Boolean);
  if (!fixtures.length || fixtures.some((f) => !f.played)) return;
  round.complete = true;

  const winners = [];
  for (const tie of round.ties) {
    const w = round.twoLegged
      ? resolveTie(game, comp, tie, fixtures)
      : (() => {
        const f = fixtures.find((x) => x.tieId === tie.id);
        if (!f) return tie.home;
        if (f.result.shootoutWinner) return f.result.shootoutWinner === 'home' ? f.homeId : f.awayId;
        return f.result.homeGoals >= f.result.awayGoals ? f.homeId : f.awayId;
      })();
    winners.push(w);
    payCompetitionPrize(game, game.world.clubs[w], `${comp.name} ${round.name}`, comp.def.prizePerRound);
  }
  comp.remaining = winners;

  if (winners.length <= 1) {
    comp.winner = winners[0];
    payCompetitionPrize(game, game.world.clubs[winners[0]], `${comp.name} winners`, comp.def.prizeWin);
    announceTrophy(game, comp, winners[0]);
    return;
  }
  addFixtures(game, openContinentalRound(game, comp));
}

function announceTrophy(game, comp, clubId) {
  const club = game.world.clubs[clubId];
  if (!club) return;
  comp.history.push({ season: game.season, year: game.world.year, winner: clubId, name: club.name });
  club.history.push({ season: game.season, year: game.world.year, achievement: `Won the ${comp.name}` });
  news(game, 'competition', `${club.name} win the ${comp.name}`,
    `${club.name} have lifted the ${comp.name}.`);
  if (clubId === game.userClubId) {
    game.manager.trophies.push({ season: game.season, year: game.world.year, name: comp.name, club: club.name });
    news(game, 'board', `Champions: ${comp.name}`, 'The board and supporters are ecstatic. A trophy for the cabinet.');
    club.board.confidence = clamp(club.board.confidence + 22, 0, 100);
  }
}

// --- Season rollover --------------------------------------------------------

export function endSeason(game) {
  const world = game.world;
  const rng = subRng(game.rng, `endseason:${game.season}`);
  const summary = { promoted: [], relegated: [], champions: [], userVerdict: null };

  for (const league of world.leagues) {
    const table = sortTable(league.table);
    league.lastTable = table.map((r) => ({ ...r }));
    league.history.push({
      season: game.season, year: world.year,
      champion: table[0]?.clubId,
      table: table.slice(0, 6).map((r) => ({ clubId: r.clubId, pts: r.pts })),
    });
    table.forEach((row, i) => {
      const club = world.clubs[row.clubId];
      if (!club) return;
      club.lastFinish = i + 1;
      payLeaguePrize(game, club, league, i + 1);
      updateBoardConfidence(game, club, i + 1, league.teams);
      club.history.push({ season: game.season, year: world.year, achievement: `${i + 1} in ${league.name} (${row.pts} pts)` });
    });
    if (table[0]) {
      summary.champions.push({ league: league.name, clubId: table[0].clubId });
      const champ = world.clubs[table[0].clubId];
      if (champ) {
        champ.history.push({ season: game.season, year: world.year, achievement: `Won the ${league.name}` });
        if (champ.id === game.userClubId) {
          game.manager.trophies.push({ season: game.season, year: world.year, name: league.name, club: champ.name });
        }
      }
    }
  }

  applyPromotionRelegation(game, summary, rng);

  // Reputation drifts toward recent performance.
  for (const club of Object.values(world.clubs)) {
    const league = world.leagues.find((l) => l.id === club.leagueId);
    if (!league) continue;
    // Centred on the spread the division was generated with, so reputations
    // stay stable over a long save instead of inflating season on season.
    const target = league.rep + remap(club.lastFinish ?? league.teams / 2, 1, league.teams, 8, -22);
    club.rep = clamp(Math.round(club.rep + (target - club.rep) * 0.25), 12, 99);
  }

  const user = userClub(game);
  if (user) {
    const league = world.leagues.find((l) => l.id === user.leagueId);
    const verdict = seasonVerdict(game, user, user.lastFinish, league?.teams ?? 20);
    summary.userVerdict = verdict;
    // The board's patience is finite. Miss their expectation badly enough and
    // the job goes to someone else.
    if (user.board.confidence < 18) {
      summary.sacked = true;
      summary.sackedFrom = user.name;
    }
    game.manager.history.push({
      season: game.season, year: world.year, club: user.name,
      league: league?.name, position: user.lastFinish,
      w: user.seasonRecord?.w ?? 0, d: user.seasonRecord?.d ?? 0, l: user.seasonRecord?.l ?? 0,
    });
    game.manager.reputation = clamp(game.manager.reputation + (verdict.tone === 'delighted' ? 8 : verdict.tone === 'pleased' ? 4 : verdict.tone === 'satisfied' ? 1 : -5), 1, 100);
    news(game, 'board', 'End of season review', verdict.text);
  }

  // Manager churn at AI clubs.
  for (const club of Object.values(world.clubs)) {
    if (considerSacking(game, club, rng)) {
      if (club.leagueId === user?.leagueId) {
        news(game, 'media', `${club.name} appoint a new manager`, `${club.manager.name} takes charge at ${club.name}.`);
      }
    }
  }

  return summary;
}

function applyPromotionRelegation(game, summary, rng) {
  const world = game.world;
  const byNation = new Map();
  for (const league of world.leagues) {
    if (!byNation.has(league.nation)) byNation.set(league.nation, []);
    byNation.get(league.nation).push(league);
  }
  for (const [nation, leagues] of byNation) {
    const ordered = sortBy(leagues, (l) => l.tier);
    for (let i = 0; i < ordered.length - 1; i++) {
      const upper = ordered[i];
      const lower = ordered[i + 1];
      const upperTable = sortTable(upper.table);
      const lowerTable = sortTable(lower.table);
      const goingDown = upperTable.slice(-upper.relegated).map((r) => r.clubId);
      // Automatic promotion, then a play-off for the final place.
      const autoUp = lowerTable.slice(0, Math.max(0, lower.promoted - 1)).map((r) => r.clubId);
      const playoffPool = lowerTable.slice(Math.max(0, lower.promoted - 1), Math.max(0, lower.promoted - 1) + 4).map((r) => r.clubId);
      const playoffWinner = resolvePlayoff(game, playoffPool, rng);
      const goingUp = [...autoUp, playoffWinner].filter(Boolean).slice(0, upper.relegated);

      for (const id of goingDown) {
        const c = world.clubs[id];
        if (!c) continue;
        c.leagueId = lower.id;
        upper.clubIds = upper.clubIds.filter((x) => x !== id);
        lower.clubIds.push(id);
        summary.relegated.push({ clubId: id, from: upper.name, to: lower.name });
        c.history.push({ season: game.season, year: world.year, achievement: `Relegated to ${lower.name}` });
      }
      for (const id of goingUp) {
        const c = world.clubs[id];
        if (!c) continue;
        c.leagueId = upper.id;
        lower.clubIds = lower.clubIds.filter((x) => x !== id);
        upper.clubIds.push(id);
        summary.promoted.push({ clubId: id, from: lower.name, to: upper.name });
        c.history.push({ season: game.season, year: world.year, achievement: `Promoted to ${upper.name}` });
      }
    }
  }
}

function resolvePlayoff(game, poolIds, rng) {
  if (poolIds.length < 2) return poolIds[0] || null;
  const world = game.world;
  let remaining = [...poolIds];
  while (remaining.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < remaining.length; i += 2) {
      const a = world.clubs[remaining[i]];
      const b = world.clubs[remaining[i + 1]];
      const sa = squadStrength(world, a);
      const sb = squadStrength(world, b);
      const pa = sa / (sa + sb);
      next.push(rng.chance(clamp(pa, 0.15, 0.85)) ? a.id : b.id);
    }
    if (remaining.length % 2 === 1) next.push(remaining[remaining.length - 1]);
    remaining = next;
  }
  const winner = world.clubs[remaining[0]];
  if (winner) winner.history.push({ season: game.season, year: world.year, achievement: 'Won the promotion play-offs' });
  return remaining[0];
}

/**
 * The board dismisses the manager. The club carries on under someone new and
 * the manager is left looking for work.
 */
export function sackManager(game) {
  const world = game.world;
  const club = userClub(game);
  if (!club) return;
  const rng = subRng(game.rng, `sack:${game.season}`);
  club.isUserClub = false;
  club.board.confidence = 52;
  club.board.warned = false;
  const { makeManagerName } = MANAGER_NAME_MODULE;
  const n = makeManagerName(rng, club.nation);
  club.manager = {
    name: n.full, nat: club.nation, style: n.style,
    attacking: 12, defending: 12, tactical: 12, manManagement: 12,
    youthDev: 12, discipline: 12, reputation: club.rep - 10, yearsAtClub: 0,
  };
  game.userClubId = null;
  game.manager.reputation = clamp(game.manager.reputation - 8, 1, 100);
  news(game, 'board', 'You have been dismissed',
    `${club.name} have terminated your contract. The board thanked you for your efforts but felt a change was needed.`);
}

/** Clubs that would consider hiring this manager, best first. */
export function availableJobs(game) {
  const world = game.world;
  const rep = game.manager.reputation;
  const jobs = [];
  for (const club of Object.values(world.clubs)) {
    if (club.isUserClub) continue;
    const league = world.leagues.find((l) => l.id === club.leagueId);
    if (!league) continue;
    // A club will look at a manager whose standing is near their own.
    const ceiling = rep + 22;
    const clubStanding = remap(club.rep, 20, 99, 8, 95);
    if (clubStanding > ceiling) continue;
    jobs.push({ club, league, standing: clubStanding });
  }
  return sortBy(jobs, { key: (j) => j.standing, desc: true }).slice(0, 40);
}

import * as MANAGER_NAME_MODULE from '../gen/names.js';

/** Move the world on a year: ages, contracts, retirements, new schedules. */
export function rolloverSeason(game) {
  const world = game.world;
  const rng = subRng(game.rng, `rollover:${game.season}`);
  world.year += 1;
  game.season += 1;

  const retirements = [];
  for (const id of Object.keys(world.players)) {
    const p = world.players[id];
    p.age += 1;
    // Archive the season.
    if (p.season.apps + p.season.subApps > 0) {
      p.career.apps += p.season.apps + p.season.subApps;
      p.career.goals += p.season.goals;
      p.career.assists += p.season.assists;
      p.career.cleanSheets += p.season.cleanSheets;
      p.career.motm += p.season.motm;
      p.career.seasons.push({
        year: world.year - 1,
        clubId: p.clubId,
        apps: p.season.apps + p.season.subApps,
        goals: p.season.goals,
        assists: p.season.assists,
        rating: p.season.ratingCount ? Math.round((p.season.ratingSum / p.season.ratingCount) * 10) / 10 : 0,
      });
      if (p.career.seasons.length > 25) p.career.seasons.shift();
    }
    p.season = emptyStats();

    // Retirement.
    const ca = currentAbility(p);
    const retireChance = p.age >= 39 ? 1 : p.age >= 36 ? 0.45 : p.age >= 34 ? 0.18 : p.age >= 32 ? 0.05 : 0;
    const lowLevel = ca < 45 && p.age >= 30 ? 0.4 : 0;
    if (rng.chance(Math.max(retireChance, lowLevel))) {
      retirements.push(p);
      const club = p.clubId ? world.clubs[p.clubId] : null;
      if (club) club.squad = club.squad.filter((x) => x !== p.id);
      world.freeAgents = world.freeAgents.filter((x) => x !== p.id);
      delete world.players[p.id];
      continue;
    }
  }

  // Contracts: AI clubs renew or release; the user is prompted separately.
  const helpers = { renewContract, releasePlayer, contractDemand };
  for (const club of Object.values(world.clubs)) {
    if (club.isUserClub) continue;
    aiSquadHousekeeping(game, club, rng, helpers);
    aiReleaseSurplus(game, club, rng, 28);
    // Fill gaps left by retirements and releases.
    let guard = 0;
    while (club.squad.length < 20 && guard++ < 14) {
      const league = world.leagues.find((l) => l.id === club.leagueId);
      const pos = rng.pick(['GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'ML', 'MR', 'AMC', 'AML', 'AMR', 'ST']);
      const age = rng.int(18, 28);
      // Centred on the squad quality curve a club is generated with. Filling
      // gaps with players below that band erodes every division a little each
      // season, and eight seasons of it makes the whole world visibly worse.
      const targetCA = clamp(Math.round(abilityForReputation(club.rep) * rng.range(0.72, 1.0)), 18, 180);
      const p = generatePlayer(rng, {
        nationId: rng.chance(0.75) ? club.nation : rng.pick(world.nations).id,
        pos, age, targetCA, targetPA: clamp(targetCA + rng.int(0, 30), targetCA, 195),
        clubRep: club.rep, leagueRep: league?.rep ?? 55, year: world.year,
      });
      p.clubId = club.id;
      const demand = contractDemand(world, p, club);
      p.contract = { wage: demand.wage, expiresYear: world.year + demand.years, signedYear: world.year, releaseClause: 0, goalBonus: 0, appearanceFee: 0, loanedFrom: null, loanUntilYear: null };
      world.players[p.id] = p;
      club.squad.push(p.id);
      const taken = new Set(club.squad.map((x) => world.players[x]?.squadNumber).filter(Boolean));
      for (let n = 2; n <= 70; n++) if (!taken.has(n)) { p.squadNumber = n; break; }
    }
    // Board expectations follow last season's finish.
    const league = world.leagues.find((l) => l.id === club.leagueId);
    if (league) club.board.expectation = expectationFor(club, league);
  }

  pruneFreeAgents(game, rng);

  const user = userClub(game);
  if (user) {
    const league = world.leagues.find((l) => l.id === user.leagueId);
    if (league) user.board.expectation = expectationFor(user, league);
    const expiring = user.squad.map((id) => world.players[id]).filter((p) => p?.contract && p.contract.expiresYear <= world.year);
    if (expiring.length) {
      news(game, 'squad', `${expiring.length} contracts expiring`,
        `The following players are out of contract: ${expiring.map((p) => p.name).join(', ')}. Renew them or let them go.`);
    }
    if (retirements.some((p) => p.clubId === user.id)) {
      const mine = retirements.filter((p) => p.clubId === user.id);
      news(game, 'squad', 'Retirements', `${mine.map((p) => p.name).join(', ')} ${mine.length > 1 ? 'have' : 'has'} announced retirement.`);
    }
    user.manager.yearsAtClub++;
  }

  startSeason(game);
  return { retirements: retirements.length };
}

/**
 * Players who go a full season unattached drift out of the game. Without this
 * the free agent pool grows without bound as clubs trim their squads.
 */
function pruneFreeAgents(game, rng, keep = 160) {
  const world = game.world;
  const agents = world.freeAgents.map((id) => world.players[id]).filter(Boolean);
  const ranked = sortBy(agents, { key: (p) => currentAbility(p) - (p.age - 24) * 2, desc: true });
  const survivors = [];
  for (let i = 0; i < ranked.length; i++) {
    const p = ranked[i];
    const keepIt = i < keep && (p.age < 34 || rng.chance(0.4));
    if (keepIt) { survivors.push(p.id); continue; }
    delete world.players[p.id];
  }
  world.freeAgents = survivors;
}

function expectationFor(club, league) {
  const finish = club.lastFinish ?? Math.ceil(league.teams / 2);
  const bottomAsk = league.hasDivisionBelow !== false
    ? { type: 'survive', target: league.teams - league.relegated, label: 'Avoid relegation' }
    : { type: 'mid', target: league.teams - 2, label: 'Improve on last season' };
  const canPromote = league.hasDivisionAbove !== false && league.tier > 1;
  const t = (finish - 1) / Math.max(1, league.teams - 1);
  if (league.tier === 1) {
    if (t < 0.1) return { type: 'title', label: 'Win the league' };
    if (t < 0.25) return { type: 'top', target: 4, label: 'Qualify for the Continental Cup' };
    if (t < 0.5) return { type: 'top', target: Math.ceil(league.teams * 0.4), label: 'Challenge for a continental place' };
    if (t < 0.78) return { type: 'mid', target: Math.ceil(league.teams * 0.65), label: 'Finish in mid-table' };
    return bottomAsk;
  }
  if (canPromote && t < 0.15) return { type: 'top', target: league.promoted, label: 'Win promotion' };
  if (canPromote && t < 0.4) return { type: 'top', target: league.promoted + 4, label: 'Reach the promotion play-offs' };
  if (t < 0.78) return { type: 'mid', target: Math.ceil(league.teams * 0.6), label: 'Finish in mid-table' };
  return bottomAsk;
}

export { sortTable, leagueZones };
