// Game state and the day-by-day simulation loop.

import { Rng, subRng } from '../core/rng.js';
import { clamp, remap, sortBy, money } from '../core/util.js';
import { SEASON_DAYS, KEY_DAYS, transferWindowOpen, dayToDate } from '../core/calendar.js';
import { generateWorld, squadStrength, makeReserveSide } from '../gen/worldgen.js';
import { abilityForReputation } from '../data/nations.js';
import { generatePlayer, emptyStats, estimateValue, estimateWage } from '../gen/playergen.js';
import { currentAbility } from '../data/attributes.js';
import { beginMatch, runMatch, playExtraTime, penaltyShootout } from '../engine/match.js';
import { autoPick, autoAssignSpecialists, refreshRegistration, registrationLimit } from '../engine/lineup.js';
import {
  buildLeagueSchedule, scheduleDomesticCup, openNextCupRound, scheduleContinental,
  seedContinental, continentalKnockout, openContinentalRound, sortTable, applyResultToTable,
  emptyTableRow, resolveTie, resetFixtureCounter, leagueZones,
} from '../engine/season.js';
import { applyMatchdayIncome, applyMonthlyIncome, payWeeklyWages, setSeasonBudgets, payLeaguePrize, payCompetitionPrize, ledgerEntry, wageBudgetUsage } from '../engine/finance.js';
import {
  trainPlayer, dailyPlayerTick, applyMatchEffects, processDisciplinary, generateYouthIntake, refreshSquadThresholds, trainingSlots, expectedRole,
} from '../engine/training.js';
import { aiTransferAttempt, aiSquadTrim, aiReleaseSurplus, marketValue, contractDemand, renewContract, releasePlayer, completeLoan, returnFromLoan, aiLoanAttempt } from '../engine/transfers.js';
import { seasonObjectives, objectiveScore, OBJECTIVE_WEIGHT } from '../data/objectives.js';
import { interviewOutcome, ambitionShift } from '../data/interview.js';
import {
  emptyCareer, recordMatchResult, recordSeason, resetSeasonRecord, addHonour,
  trackNotable, noteDeparture, retirePlayer, beginSpell, endSpell,
} from './career.js';
import { prepareAiClub, updateBoardConfidence, considerSacking, seasonVerdict, aiSquadHousekeeping, aiTrainingPlan } from '../engine/ai.js';
import { pruneNegotiations } from '../engine/negotiation.js';
import { news, matchHeadline } from '../engine/news.js';

// Bump whenever the shape written by the save codec changes, and add a
// migration in codec.js. Version 2 dropped the stored player `value` field in
// favour of deriving worth in one place.
export const GAME_VERSION = 9;

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
    manager: { name: managerName, nat: managerNat, reputation: 25, ...emptyCareer() },
    fixtures: {},
    fixturesByDay: {},
    inbox: [],
    transferLog: [],
    shortlist: [],
    scouted: {},
    negotiations: {},
    vacancies: [],
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
    // Starting a career is an appointment like any other, and comes with terms.
    // takeOverClub sets these for a mid-career move; this is the other entry
    // point, and without it a manager who never changed club had no contract at
    // all - so dismissal cost the club nothing.
    game.manager.contract = managerContract(club, world.year);
    beginSpell(game, club);
  }

  startSeason(game, true);
  return game;
}

/**
 * Hand a club to the player after the world has been generated. Kept separate
 * from newGame so the setup screen can build a world, let the manager browse
 * the clubs in it, and then take one over without regenerating everything.
 */
export function takeOverClub(game, clubId, managerName, managerNat, answers = null) {
  const world = game.world;
  const club = world.clubs[clubId];
  if (!club) return false;
  // The interview comes first: its answers decide the remit and the budget the
  // welcome message below then reports, so applying it afterwards would print
  // the old numbers and quietly change them behind the screen.
  const interview = answers ? applyInterview(game, club, answers) : null;
  // The club you are leaving needs somebody real in charge. Without this it
  // keeps the manager object carrying your name and your attributes, and goes on
  // picking its team with them.
  const previous = game.userClubId ? world.clubs[game.userClubId] : null;
  if (previous && previous.id !== clubId) {
    const rng = subRng(game.rng, `leave:${previous.id}:${game.season}:${game.day}`);
    const n = MANAGER_NAME_MODULE.makeManagerName(rng, previous.nation);
    previous.manager = {
      name: n.full, nat: previous.nation, style: n.style,
      attacking: 12, defending: 12, tactical: 12, manManagement: 12,
      youthDev: 12, discipline: 12, reputation: previous.rep - 8, yearsAtClub: 0,
    };
    news(game, 'media', `You leave ${previous.name}`,
      `${game.manager.name} departs ${previous.name} for ${club.name}. ${n.full} takes over.`);
  }
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
  // Every appointment comes with terms. Until now the manager worked for nothing
  // and could be dismissed for nothing.
  game.manager.contract = managerContract(club, world.year);
  club.manager = {
    name: game.manager.name, nat: game.manager.nat, style: 'Manager',
    attacking: 12, defending: 12, tactical: 12, manManagement: 12,
    youthDev: 12, discipline: 12, reputation: game.manager.reputation, yearsAtClub: 0,
  };
  club.tactic = autoAssignSpecialists(world, club, autoPick(world, club, club.tactic));

  // Taking the job closes the vacancy, and the caretaker steps aside.
  game.vacancies = (game.vacancies || []).filter((v) => v.clubId !== clubId);
  beginSpell(game, club);

  const league = world.leagues.find((l) => l.id === club.leagueId);
  news(game, 'media', 'Welcome to the hot seat',
    `${game.manager.name} takes charge of ${club.name}. The local press are keen to see what direction the new manager takes.`);
  news(game, 'board', `${world.year}/${String(world.year + 1).slice(2)} season underway`,
    `The board expect you to ${club.board.expectation.label.toLowerCase()} in the ${league.name}. `
    + `You have a transfer budget of ${money(club.finances.transferBudget)} and a wage budget of `
    + `${money(club.finances.wageBudgetAnnual / 52)} per week.`
    + (interview ? ` ${interview.summary}` : ''));
  return true;
}

/**
 * Apply what you told the board at the interview.
 *
 * `wantsAttacking` and `wantsYouth` have been on every club since the world was
 * generated and nothing has ever written to them after that, so what the board
 * judged you on was decided before you walked in the door. This is where they
 * become your answer rather than a coin flip, and where an ambitious answer buys
 * money at the price of a harder objective.
 */
export function applyInterview(game, club, answers) {
  const world = game.world;
  const out = interviewOutcome(answers);
  if (out.wantsAttacking !== null) club.board.wantsAttacking = out.wantsAttacking;
  if (out.wantsYouth !== null) club.board.wantsYouth = out.wantsYouth;
  club.board.patience = clamp(club.board.patience + out.patienceDelta, 10, 95);
  club.board.interview = { ...answers, ambition: out.ambition };

  const budgetBefore = club.finances.transferBudget;
  club.finances.transferBudget = Math.max(0, Math.round(budgetBefore * out.budgetMultiplier));
  if (out.youthFacilities) {
    club.facilities.youth = Math.min(20, club.facilities.youth + out.youthFacilities);
  }

  // The objectives are regenerated so the new remit is the one you are judged
  // against this season, not next - and ambition moves the league finish.
  const league = world.leagues.find((l) => l.id === club.leagueId);
  if (league) {
    club.board.ambitionShift = ambitionShift(out.ambition);
    const finish = clamp((club.lastFinish ?? Math.ceil(league.teams / 2)) + club.board.ambitionShift, 1, league.teams);
    club.board.objectives = seasonObjectives(club, league, finish, {
      wageUsage: wageBudgetUsage(world, club).pct,
    });
    club.board.expectation = club.board.objectives[0];
  }

  const parts = [];
  if (out.budgetMultiplier !== 1) {
    parts.push(`${out.budgetMultiplier > 1 ? 'They have added to' : 'They have trimmed'} the transfer budget`
      + ` — ${money(budgetBefore)} to ${money(club.finances.transferBudget)}`);
  }
  if (out.ambition > 0) parts.push('and they will hold you to what you promised');
  else if (out.ambition < 0) parts.push('and they will give you time');
  return { ...out, summary: parts.length ? `${parts.join(', ')}.` : '' };
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
      comp.entrants = Object.values(world.clubs)
        .filter((c) => c.nation === comp.nation && !c.affiliateOf).map((c) => c.id);
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
    club.training = club.training || { slots: [] };
    club.youthSquad = club.youthSquad || [];
    refreshRegistration(world, club);
    if (club.affiliateOf) applyReserveRemit(world, club);
    else if (!club.isUserClub) aiManageReserves(world, club);
    // AI clubs set their own programme each summer. The user's club keeps
    // whatever the user chose.
    if (!club.isUserClub) {
      const plan = aiTrainingPlan(world, club);
      club.trainingFocus = plan.focus;
      club.trainingIntensity = plan.intensity;
    } else {
      club.trainingIntensity = club.trainingIntensity || 'Normal';
    }
  }

  resetSeasonRecord(game.manager);
  // Anyone tracked who moved since the last check now has somewhere to have
  // gone. The watermark matters: the transfer log grows for the life of the
  // save, and rescanning it from zero every season is a cost that compounds.
  noteUserDepartures(game, game.manager.departuresSeen || 0);
  game.manager.departuresSeen = game.transferLog.length;
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
    const isHome = fixture.homeId === userId;
    const res = isHome ? outcome[0] : outcome[1];
    recordMatchResult(game.manager, res);
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

  // Before the user-match return below, not after it. A user fixture landing on
  // the intake day used to skip the intake for every club in the world, for that
  // year, permanently - and nothing would have said so.
  if (game.day === KEY_DAYS.youthIntake) runYouthIntake(game, dayRng);
  // Before the early return as well: talks that have gone cold should not be
  // held open by the accident of a fixture landing on a Monday.
  if (game.day % 7 === 0) {
    pruneNegotiations(game);
    closeExpiredVacancies(game);
  }

  if (userFixture) {
    game.status = 'userMatch';
    game.pendingMatchId = userFixture.id;
    return { stopped: true, reason: 'userMatch', fixture: userFixture };
  }

  // A monthly read on where the manager stands with the board.
  if (date.dayOfMonth === 2 && game.day > 90) checkBoardMood(game);
  // ...and on whether anyone else has run out of road. Without this every post
  // in the world came open in the same week of the summer and closed 28 days
  // later, which is a job market that exists for a month a year.
  if (date.dayOfMonth === 2 && game.day > 60) runManagerChurn(game, dayRng);

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
  // Individual programmes are looked up per player inside a loop that walks
  // every player in the world, so the lookup has to be O(1). Building the map
  // once a week costs one pass over the clubs; doing it per player would undo
  // the season time Stage 1 bought back.
  const programmes = new Map();
  for (const club of Object.values(world.clubs)) {
    const slots = club.training?.slots;
    if (!slots?.length) continue;
    const allowed = trainingSlots(club);
    for (let i = 0; i < Math.min(slots.length, allowed); i++) {
      const slot = slots[i];
      if (slot?.playerId && slot.type) programmes.set(slot.playerId, slot);
    }
  }

  for (const id in world.players) {
    const p = world.players[id];
    const club = p.clubId ? world.clubs[p.clubId] : null;
    const before = club?.isUserClub ? currentAbility(p) : 0;
    const changed = trainPlayer(rng, world, club, p, programmes.get(id) || null);
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
  // Reserve sides have no transfer budget and do no business of their own; the
  // parent signs players, and sends them down.
  const clubs = Object.values(world.clubs).filter((c) => !c.isUserClub && !c.affiliateOf);
  // A handful of clubs act each day so the market moves gradually.
  const actors = Math.max(4, Math.round(clubs.length * 0.14));
  for (let i = 0; i < actors; i++) {
    const club = rng.pick(clubs);
    if (rng.chance(0.7)) {
      const deal = aiTransferAttempt(game, club, rng);
      if (deal) reportTransfer(game, deal);
    } else if (rng.chance(0.4)) {
      aiLoanAttempt(game, club, rng);
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
/**
 * A player who played for you leaving, recorded on the career page.
 *
 * Hooked here rather than inside completeTransfer because the engine has no
 * business knowing about the manager's scrapbook, and the transfer log is
 * already the one place every completed move passes through.
 */
function noteUserDepartures(game, sinceIndex) {
  const world = game.world;
  for (let i = sinceIndex; i < game.transferLog.length; i++) {
    const t = game.transferLog[i];
    const p = world.players[t.playerId];
    if (!p) continue;
    noteDeparture(game, p, t.loan ? `On loan at ${t.to}` : t.to);
  }
}

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
    club.youthSquad = club.youthSquad || [];
    const intake = generateYouthIntake(rng, world, club, world.year, generatePlayer, null);
    // Scholars join the academy, not the first team. The old code took only as
    // many as the first team had room for under a hardcoded cap of 32 - so a
    // club with a full squad silently forfeited the entire year's crop, and the
    // only warning came after it had already happened.
    for (const p of intake) {
      world.players[p.id] = p;
      club.youthSquad.push(p.id);
    }
    // Academy graduates age out: a scholar who is not promoted by 20 leaves.
    const leaving = club.youthSquad.filter((id) => (world.players[id]?.age ?? 0) >= 20);
    for (const id of leaving) {
      const p = world.players[id];
      club.youthSquad = club.youthSquad.filter((x) => x !== id);
      if (p) { p.clubId = null; p.contract = null; world.freeAgents.push(id); }
    }

    if (club.isUserClub && intake.length) {
      const best = sortBy(intake, { key: (p) => p.pa, desc: true })[0];
      news(game, 'youth', 'Youth intake arrives',
        `${intake.length} young players have joined the academy. The staff are most excited about ${best.name}, `
        + `a ${best.age}-year-old ${best.positions[0]}. Review them on the Squads screen.`
        + (leaving.length ? `\n\n${leaving.length} scholar${leaving.length === 1 ? '' : 's'} aged out of the academy without being offered terms.` : ''));
    }
  }
}

/** Move a scholar up to the first team. Returns why not, or null on success. */
export function promoteFromAcademy(game, playerId) {
  const world = game.world;
  const club = userClub(game);
  if (!club) return 'You are not managing a club.';
  if (!club.youthSquad?.includes(playerId)) return 'He is not in your academy.';
  const p = world.players[playerId];
  if (!p) return 'Player not found.';
  club.youthSquad = club.youthSquad.filter((x) => x !== playerId);
  club.squad.push(playerId);
  p.clubId = club.id;
  const taken = new Set(club.squad.map((id) => world.players[id]?.squadNumber).filter(Boolean));
  for (let n = 12; n <= 70; n++) if (!taken.has(n)) { p.squadNumber = n; break; }
  refreshRegistration(world, club);
  refreshSquadThresholds(world, club);
  return null;
}

/** Release a scholar. */
export function releaseFromAcademy(game, playerId) {
  const world = game.world;
  const club = userClub(game);
  if (!club?.youthSquad?.includes(playerId)) return 'He is not in your academy.';
  club.youthSquad = club.youthSquad.filter((x) => x !== playerId);
  const p = world.players[playerId];
  if (p) { p.clubId = null; p.contract = null; world.freeAgents.push(playerId); }
  return null;
}

// --- The reserve side -------------------------------------------------------

/**
 * An AI club's own send-downs, run once a summer.
 *
 * Without this only the user would use reserve football and every AI club would
 * carry a bloated first team - the asymmetry would show up as the user's rivals
 * developing their prospects far more slowly than the user does.
 */
export function aiManageReserves(world, club) {
  const reserve = club.reserveClubId ? world.clubs[club.reserveClubId] : null;
  if (!reserve) return;
  const limit = registrationLimit(club);
  const ranked = sortBy(club.squad.map((id) => world.players[id]).filter(Boolean),
    { key: (p) => currentAbility(p), desc: true });

  // Anyone outside the registered group who is young enough to gain from playing
  // goes down; anyone the reserve side has outgrown comes back up.
  for (const p of ranked.slice(limit)) {
    if (p.age > 23) continue;
    if (club.squad.length <= 18) break;
    club.squad = club.squad.filter((x) => x !== p.id);
    reserve.squad.push(p.id);
    p.clubId = reserve.id;
    if (p.contract && !p.contract.wageReserve) p.contract.wageReserve = Math.round(p.contract.wage * 0.45);
  }
  const resRanked = sortBy(reserve.squad.map((id) => world.players[id]).filter(Boolean),
    { key: (p) => currentAbility(p), desc: true });
  // Recall only players who are genuinely first-team quality, not merely better
  // than the last man on a 26-man list. Measuring against the bottom of the
  // registered group promoted almost every prospect immediately and stripped one
  // reserve side down to a single player - a division cannot field that.
  const benchmark = ranked[Math.min(Math.floor(limit * 0.7), ranked.length - 1)];
  const RESERVE_FLOOR = 16;
  for (const p of resRanked) {
    if (reserve.squad.length <= RESERVE_FLOOR) break;
    if (!benchmark || currentAbility(p) <= currentAbility(benchmark)) break;
    reserve.squad = reserve.squad.filter((x) => x !== p.id);
    club.squad.push(p.id);
    p.clubId = club.id;
  }
  refreshRegistration(world, club);
  refreshRegistration(world, reserve);
  applyReserveRemit(world, reserve);
}

/**
 * What it would take for the board to fund a reserve side, and whether they will.
 *
 * Only the biggest clubs are given one at world generation, so without this a
 * club promoted up through the pyramid would have no route to one at all - and
 * the whole point of the feature is that it is there for the club you built.
 */
export function reserveProposal(game) {
  const world = game.world;
  const club = userClub(game);
  if (!club) return { ok: false, reason: 'You are not managing a club.' };
  if (club.affiliateOf) return { ok: false, reason: 'A reserve side cannot have one of its own.' };
  if (club.reserveClubId && world.clubs[club.reserveClubId]) {
    return { ok: false, reason: 'You already run a reserve side.' };
  }
  const leagues = world.leagues.filter((l) => l.nation === club.nation).sort((a, b) => a.tier - b.tier);
  const ownLeague = leagues.find((l) => l.id === club.leagueId);
  if (!ownLeague) return { ok: false, reason: 'No league found.' };
  // It has to go at least one division below you, and there must be one.
  const host = leagues.find((l) => l.tier === ownLeague.tier + 2) || leagues.find((l) => l.tier === ownLeague.tier + 1);
  if (!host) return { ok: false, reason: 'There is no division below you to enter a reserve side into.' };

  const cost = Math.round(120000 + club.rep * 14000);
  const confident = club.board.confidence >= 55;
  const afford = club.finances.balance > cost * 3;
  const reason = !confident
    ? 'The board are not convinced enough by your work to fund a second squad.'
    : !afford ? 'The club cannot afford to set up and run a second squad.' : null;
  return { ok: !reason, reason, cost, host, league: host.name };
}

/** Accept the proposal: the reserve side joins next season. */
export function foundReserveSide(game) {
  const world = game.world;
  const club = userClub(game);
  const proposal = reserveProposal(game);
  if (!proposal.ok) return proposal.reason;

  const rng = subRng(game.rng, `foundreserve:${club.id}:${game.season}`);
  const nation = world.nations.find((n) => n.id === club.nation);
  const reserve = makeReserveSide(world, rng, club, proposal.host, nation, world.year);
  world.clubs[reserve.id] = reserve;
  proposal.host.clubIds.push(reserve.id);
  // The division grows by one. Everything that divides by team count - prize
  // money, TV shares, board targets - reads this, so it has to move with it.
  proposal.host.teams = proposal.host.clubIds.length;
  club.reserveClubId = reserve.id;
  club.finances.balance -= proposal.cost;
  ledgerEntry(club, game.day, `Establishing ${reserve.name}`, -proposal.cost, 'upkeep');
  applyReserveRemit(world, reserve);

  news(game, 'squad', 'The board approve a reserve side',
    `${reserve.name} will enter ${proposal.host.name} from next season. Fringe and younger players can now be `
    + 'sent down for regular football at a reduced wage, rather than sitting in the stands.');
  return null;
}

/** The club a player is really owned by: a reserve side's players are the parent's. */
export function ownerClubOf(world, player) {
  const club = player.clubId ? world.clubs[player.clubId] : null;
  if (!club) return null;
  return club.affiliateOf ? (world.clubs[club.affiliateOf] || club) : club;
}

export function reserveSideOf(world, club) {
  return club?.reserveClubId ? world.clubs[club.reserveClubId] || null : null;
}

/**
 * Whether a player will accept reserve terms.
 *
 * This is the whole balance guard. A young or fringe player signs a two-way
 * deal without complaint; an established professional refuses one, is paid in
 * full wherever he plays, and resents being sent down - so parking a big earner
 * in the reserves saves nothing and costs morale, which is exactly what stops
 * this being a wage exploit.
 */
export function acceptsReserveTerms(world, club, player) {
  if (player.age <= 21) return true;
  if (player.contract?.wageReserve) return true;
  return expectedRole(world, club, player) === 'fringe';
}

/** Send a player down to the reserve side. Returns an error string, or null. */
export function sendToReserves(game, playerId) {
  const world = game.world;
  const club = userClub(game);
  const reserve = reserveSideOf(world, club);
  if (!reserve) return 'Your club has no reserve side.';
  if (!club.squad.includes(playerId)) return 'He is not in your first-team squad.';
  const p = world.players[playerId];
  if (!p) return 'Player not found.';

  const willing = acceptsReserveTerms(world, club, p);
  club.squad = club.squad.filter((x) => x !== playerId);
  reserve.squad.push(playerId);
  p.clubId = reserve.id;
  if (willing && p.contract && !p.contract.wageReserve) {
    p.contract.wageReserve = Math.round(p.contract.wage * 0.45);
  }
  if (!willing) {
    // He goes, because the manager picks the squad - but he is not happy and he
    // is still on his full wage.
    p.unhappy = 'demoted';
    p.morale = clamp(p.morale - 22, 0, 100);
  } else {
    p.unhappy = p.unhappy === 'unregistered' ? null : p.unhappy;
  }
  refreshRegistration(world, club);
  refreshRegistration(world, reserve);
  refreshSquadThresholds(world, club);
  refreshSquadThresholds(world, reserve);
  return null;
}

/** Bring a player back up to the first team. */
export function recallFromReserves(game, playerId) {
  const world = game.world;
  const club = userClub(game);
  const reserve = reserveSideOf(world, club);
  if (!reserve?.squad.includes(playerId)) return 'He is not with your reserve side.';
  const p = world.players[playerId];
  reserve.squad = reserve.squad.filter((x) => x !== playerId);
  club.squad.push(playerId);
  p.clubId = club.id;
  if (p.unhappy === 'demoted') p.unhappy = null;
  refreshRegistration(world, club);
  refreshRegistration(world, reserve);
  refreshSquadThresholds(world, club);
  refreshSquadThresholds(world, reserve);
  return null;
}

/**
 * The reserve coach picks his own side, steered by the remit.
 *
 * Deliberately not the manager's job: the whole point of a reserve side is that
 * it takes players off your list rather than adding a second team sheet.
 */
export function applyReserveRemit(world, reserve) {
  if (!reserve) return;
  const remit = reserve.reserveRemit || 'balanced';
  const squad = reserve.squad.map((id) => world.players[id]).filter(Boolean);
  const score = (p) => {
    const ca = currentAbility(p);
    if (remit === 'youth') return ca + Math.max(0, 24 - p.age) * 9;
    if (remit === 'compete') return ca;
    return ca + Math.max(0, 22 - p.age) * 4;
  };
  reserve.registration = sortBy(squad, { key: score, desc: true })
    .slice(0, registrationLimit(reserve)).map((p) => p.id);
  reserve.registrationManual = true;
  refreshRegistration(world, reserve);
}

/**
 * Set which players are registered for matches. The list is trimmed to the
 * club's limit and anyone left out becomes unhappy - which is the pressure that
 * makes a second squad worth having rather than a list to ignore.
 */
export function setRegistration(game, ids) {
  const world = game.world;
  const club = userClub(game);
  if (!club) return;
  club.registration = ids.filter((id) => club.squad.includes(id)).slice(0, registrationLimit(club));
  // From here the list is the manager's, and refreshRegistration stops
  // second-guessing it.
  club.registrationManual = true;
  refreshRegistration(world, club);
  for (const id of club.squad) {
    const p = world.players[id];
    if (!p) continue;
    // Only a player good enough to expect a game resents being left out; a
    // fringe player knows where he stands.
    const snubbed = !club._registered.has(id) && expectedRole(world, club, p) !== 'fringe';
    p.unhappy = snubbed ? 'unregistered' : (p.unhappy === 'unregistered' ? null : p.unhappy);
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
    addHonour(game, { kind: 'cup', name: comp.name, club: club.name });
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
          addHonour(game, { kind: 'league', name: league.name, club: champ.name });
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

  // Score the season's objectives. The league one has always been judged; the
  // cup run and the board's remit were printed on a screen and never checked.
  for (const club of Object.values(world.clubs)) {
    if (club.affiliateOf) continue;
    scoreObjectives(game, club);
  }

  const user = userClub(game);
  if (user) {
    const league = world.leagues.find((l) => l.id === user.leagueId);
    const verdict = seasonVerdict(game, user, user.lastFinish, league?.teams ?? 20);
    summary.userVerdict = verdict;
    // The board's patience is finite. This used to be a bare threshold - under
    // eighteen confidence and you were gone, every time, regardless of the board
    // you were working for. It now runs the same patience roll the AI clubs have
    // always used, so a patient board gives you another year and an impatient one
    // does not, and the `patience` figure on the Club screen finally means
    // something for the user too.
    const sackRng = subRng(game.rng, `usersack:${game.season}`);
    if (userSackRisk(user) > 0 && (user.board.confidence < SACK_CERTAIN
      || sackRng.chance(userSackRisk(user)))) {
      summary.sacked = true;
      summary.sackedFrom = user.name;
      summary.compensation = dismissalCompensation(game);
    }
    recordSeason(game, user, league);
    trackNotable(game, user);
    game.manager.reputation = clamp(game.manager.reputation + (verdict.tone === 'delighted' ? 8 : verdict.tone === 'pleased' ? 4 : verdict.tone === 'satisfied' ? 1 : -5), 1, 100);
    news(game, 'board', 'End of season review', verdict.text);
  }

  // Manager churn at AI clubs. Each one is a post that was genuinely open, and
  // an unemployed manager can go for it before the caretaker is confirmed.
  for (const club of Object.values(world.clubs)) {
    if (considerSacking(game, club, rng)) {
      openVacancy(game, club, 'The board dismissed their manager.');
      if (club.leagueId === user?.leagueId) {
        news(game, 'media', `${club.name} part company with their manager`,
          `${club.manager.name} takes temporary charge at ${club.name} while the board look for a replacement.`);
      }
    }
  }

  // A handful of managers leave of their own accord each summer. Without this,
  // a manager sacked in a quiet year could find no job going anywhere and the
  // career would simply stop - which is a dead end, not a difficulty.
  const settled = Object.values(world.clubs)
    .filter((c) => !c.affiliateOf && !c.isUserClub && !(game.vacancies || []).some((v) => v.clubId === c.id));
  const wanted = Math.max(6, Math.round(settled.length * 0.05));
  for (let i = 0; i < wanted && settled.length; i++) {
    const club = rng.weighted(settled, (c) => Math.max(0.05, 1 - c.board.confidence / 110));
    openVacancy(game, club, 'Their manager left by mutual consent.');
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

      // A reserve side cannot be promoted into the division its parent plays in,
      // or above it - so it is passed over and the next club in the table goes
      // up instead. Skipping it without promoting a replacement would shrink the
      // division every time a B team finished well.
      const eligibleUp = lowerTable.filter((r) => {
        const c = world.clubs[r.clubId];
        if (!c?.affiliateOf) return true;
        const parent = world.clubs[c.affiliateOf];
        const parentLeague = parent && world.leagues.find((l) => l.id === parent.leagueId);
        return parentLeague ? parentLeague.tier < upper.tier : true;
      });

      // Automatic promotion, then a play-off for the final place.
      const autoUp = eligibleUp.slice(0, Math.max(0, lower.promoted - 1)).map((r) => r.clubId);
      const playoffPool = eligibleUp.slice(Math.max(0, lower.promoted - 1), Math.max(0, lower.promoted - 1) + 4).map((r) => r.clubId);
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
        // A career built in the lower divisions is built on these. They were
        // free text on the club and nothing else, so a manager who had gone up
        // four times had an empty trophy cabinet.
        if (c.isUserClub) addHonour(game, { kind: 'promotion', name: `Promotion to ${upper.name}`, club: c.name });
      }
    }
    enforceReserveSeparation(game, ordered, summary);
  }
}

/**
 * A reserve side must always sit at least one division below its parent.
 *
 * Promotion is already blocked from closing the gap upward, but the parent can
 * close it downward by being relegated - and then the two would share a table,
 * play each other twice, and the cup guard would not help because this is the
 * league. Push the reserve side down a tier; if there is no tier below, dissolve
 * it and send its players back to the parent.
 */
function enforceReserveSeparation(game, ordered, summary) {
  const world = game.world;
  for (const league of ordered) {
    for (const id of [...league.clubIds]) {
      const c = world.clubs[id];
      if (!c?.affiliateOf) continue;
      const parent = world.clubs[c.affiliateOf];
      if (!parent) continue;
      const parentLeague = ordered.find((l) => l.id === parent.leagueId);
      if (!parentLeague || parentLeague.tier < league.tier) continue;

      const below = ordered.find((l) => l.tier === league.tier + 1);
      if (below) {
        league.clubIds = league.clubIds.filter((x) => x !== id);
        below.clubIds.push(id);
        c.leagueId = below.id;
        summary.relegated.push({ clubId: id, from: league.name, to: below.name });
        c.history.push({ season: game.season, year: world.year, achievement: `Moved down to ${below.name}` });
      } else {
        // Nowhere left to go: the reserve side folds and its players go home.
        league.clubIds = league.clubIds.filter((x) => x !== id);
        for (const pid of [...c.squad]) {
          const p = world.players[pid];
          if (!p) continue;
          p.clubId = parent.id;
          parent.squad.push(pid);
        }
        delete parent.reserveClubId;
        delete world.clubs[id];
        if (parent.isUserClub) {
          news(game, 'squad', 'Reserve side disbanded',
            `${c.name} has been wound up — with ${parent.name} in the same division there was nowhere for them to play. `
            + 'Their players have returned to the first-team squad.');
        }
      }
    }
    // Whatever moved, the division's size and its fixture list must still agree.
    if (league.clubIds.length !== league.teams) league.teams = league.clubIds.length;
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
  if (winner) {
    winner.history.push({ season: game.season, year: world.year, achievement: 'Won the promotion play-offs' });
    if (winner.isUserClub) {
      addHonour(game, { kind: 'playoff', name: `${league.name} play-offs`, club: winner.name });
    }
  }
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
  // Dismissal costs the club and pays the manager. A sacking that costs nothing
  // is a sacking the board has no reason to think twice about.
  const payoff = dismissalCompensation(game);
  if (payoff > 0) {
    club.finances.balance -= payoff;
    ledgerEntry(club, game.day, 'Manager compensation', -payoff, 'wages');
    game.manager.severance = (game.manager.severance || 0) + payoff;
  }
  endSpell(game, 'sacked');
  game.userClubId = null;
  game.manager.contract = null;
  game.manager.reputation = clamp(game.manager.reputation - 8, 1, 100);
  news(game, 'board', 'You have been dismissed',
    `${club.name} have terminated your contract. The board thanked you for your efforts but felt a change was needed.`
    + (payoff > 0 ? ` Your contract had time left to run, and the club settled it at ${money(payoff)}.` : ''));
  return payoff;
}

/** Clubs that would consider hiring this manager, best first. */
/**
 * Clubs that part with their manager during the season.
 *
 * Gated harder than the season-end review - a board that sacks somebody in
 * November has really lost faith - so this adds a trickle of posts rather than
 * multiplying the churn by twelve.
 */
function runManagerChurn(game, rng) {
  const world = game.world;
  const user = userClub(game);
  // Board confidence at an AI club was only ever recomputed at the end of a
  // season, so every board in the world sat on its generated figure from August
  // to May - a measured median of 72 and a minimum of 55, which no in-season
  // sacking rule could ever fire on. One sorted table per division a month is
  // enough to make the number mean something while the season is running.
  for (const league of world.leagues) {
    const table = sortTable(league.table);
    for (let i = 0; i < table.length; i++) {
      const club = world.clubs[table[i].clubId];
      if (!club || club.isUserClub || club.affiliateOf) continue;
      updateBoardConfidence(game, club, i + 1, league.teams);
      // Picked from the distribution, not guessed: with confidence now moving
      // through the season the bottom of the table lands in the high twenties by
      // May, so a threshold in the teens - the first attempt - never fired once.
      if (club.board.confidence >= 38) continue;
      if ((game.vacancies || []).some((v) => v.clubId === club.id)) continue;
      // Gated harder than the season-end review - a board that sacks somebody in
      // November has really lost faith - so this is a trickle of posts rather
      // than twelve times the annual churn. The threshold is passed through
      // rather than left to considerSacking's own, which is tuned for the
      // end-of-season review and would veto every club this rule selects.
      if (!considerSacking(game, club, rng, 38, 0.1)) continue;
      openVacancy(game, club, 'The board lost patience mid-season.');
      // Worth telling the manager about a job better than the one he has.
      if (user && club.rep > user.rep + 4) {
        news(game, 'media', `${club.name} sack their manager`,
          `${club.name} have parted company with their manager. The post is open for the next `
          + `${VACANCY_DAYS} days, and a club of their standing will not be short of applicants.`);
      }
    }
  }
}

/** How long a post stays open before the caretaker is confirmed. */
export const VACANCY_DAYS = 28;

/**
 * Record that a club is looking for a manager.
 *
 * The club is not left without one in the meantime - a caretaker takes charge,
 * so every AI path that reads `club.manager` keeps working - but the post is
 * genuinely open until it closes, and taking it displaces him.
 */
/**
 * A day count that keeps running across a rollover.
 *
 * Most vacancies open in the last week of a season and the calendar resets to
 * day zero a moment later, so a window measured in `game.day` alone would either
 * never close or close instantly.
 */
function absoluteDay(game) {
  return game.season * SEASON_DAYS + game.day;
}

export function openVacancy(game, club, reason) {
  if (!club || club.affiliateOf || club.isUserClub) return null;
  game.vacancies = game.vacancies || [];
  if (game.vacancies.some((v) => v.clubId === club.id)) return null;
  if (club.manager) club.manager.caretaker = true;
  const vacancy = {
    clubId: club.id, reason, openedSeason: game.season, openedDay: game.day,
    closesAt: absoluteDay(game) + VACANCY_DAYS,
  };
  game.vacancies.push(vacancy);
  return vacancy;
}

/** Posts whose window has run out: the caretaker gets the job for good. */
export function closeExpiredVacancies(game) {
  if (!game.vacancies?.length) return;
  const now = absoluteDay(game);
  game.vacancies = game.vacancies.filter((v) => {
    const club = game.world.clubs[v.clubId];
    if (!club || club.isUserClub) return false;
    if (v.closesAt > now) return true;
    if (club.manager) club.manager.caretaker = false;
    return false;
  });
}

/**
 * Jobs actually going.
 *
 * This used to list every club in the world under a reputation ceiling,
 * including clubs with a perfectly happy manager in post - so "looking for
 * work" meant picking whichever of two hundred clubs you fancied. A job is now
 * a job: somebody has to have left it.
 */
export function availableJobs(game) {
  const world = game.world;
  const rep = game.manager.reputation;
  closeExpiredVacancies(game);
  const jobs = [];
  for (const v of game.vacancies || []) {
    const club = world.clubs[v.clubId];
    if (!club || club.isUserClub || club.affiliateOf) continue;
    const league = world.leagues.find((l) => l.id === club.leagueId);
    if (!league) continue;
    // A club will look at a manager whose standing is near their own.
    const clubStanding = remap(club.rep, 20, 99, 8, 95);
    if (clubStanding > rep + 22) continue;
    jobs.push({ club, league, standing: clubStanding, vacancy: v });
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

  // Loans run out at the end of the season and the player goes home. This runs
  // before the age tick and before retirements so that a loaned-out player is
  // back on his own club's books when anything else looks at him - a retirement
  // processed while he was away would have taken him off the wrong squad list.
  const returning = [];
  for (const club of Object.values(world.clubs)) {
    for (const id of [...(club.loanedOut || [])]) {
      const p = world.players[id];
      if (!p) { club.loanedOut = club.loanedOut.filter((x) => x !== id); continue; }
      const borrower = p.clubId ? world.clubs[p.clubId] : null;
      returnFromLoan(game, p);
      if (club.isUserClub) returning.push({ p, borrower });
    }
  }
  if (returning.length) {
    news(game, 'squad', `${returning.length} player${returning.length === 1 ? '' : 's'} back from loan`,
      returning.map(({ p, borrower }) => `${p.name}${borrower ? ` (${borrower.short})` : ''}`).join(', ')
      + '. They are back in your squad and back on your full wage.');
  }

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
      // Before the delete, not after: everything worth keeping about him is on
      // the object that is about to stop existing.
      retirePlayer(game, p);
      const club = p.clubId ? world.clubs[p.clubId] : null;
      if (club) {
        club.squad = club.squad.filter((x) => x !== p.id);
        if (club.youthSquad) club.youthSquad = club.youthSquad.filter((x) => x !== p.id);
        if (club.loanedOut) club.loanedOut = club.loanedOut.filter((x) => x !== p.id);
      }
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
    aiReleaseSurplus(game, club, rng, club.affiliateOf ? 24 : 28);
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
    if (league) club.board.expectation = expectationFor(world, club, league);
  }

  // A first team that cannot field eleven is promoted to from its own academy
  // first. Scholars used to land straight in club.squad, which quietly padded
  // every squad in the world; now that they have their own list, a club thinned
  // by retirements has to be topped up deliberately - and its own youngsters are
  // both the cheapest and the most sensible answer.
  for (const club of Object.values(world.clubs)) {
    // One bar for every club, reserve sides included: sixteen is an XI plus a
    // full bench, and a division where any side cannot name one is broken.
    const floor = 16;
    if (club.squad.length >= floor) continue;
    const ready = sortBy((club.youthSquad || []).map((id) => world.players[id]).filter(Boolean),
      { key: (p) => currentAbility(p), desc: true });
    const promoted = [];
    const emergency = [];
    for (const p of ready) {
      if (club.squad.length >= floor) break;
      club.youthSquad = club.youthSquad.filter((x) => x !== p.id);
      club.squad.push(p.id);
      p.clubId = club.id;
      promoted.push(p);
    }
    if (promoted.length && club.isUserClub) {
      news(game, 'youth', 'Academy players promoted',
        `Your first-team squad had fallen to ${club.squad.length - promoted.length} players, so `
        + `${promoted.map((p) => p.name).join(', ')} ${promoted.length === 1 ? 'has' : 'have'} been moved up `
        + 'from the academy to make up the numbers. Sign replacements if you want them back in the youth side.');
    }

    // If the academy could not cover it, sign whoever is available. A squad too
    // small to field eleven fit players is a broken game rather than a hard one,
    // and the user's club is not exempt: it is skipped by the ordinary gap-fill
    // below, so without this it is the one club that can end up unable to play.
    let guard = 0;
    while (club.squad.length < floor && guard++ < 12) {
      const league = world.leagues.find((l) => l.id === club.leagueId);
      const pos = rng.pick(['GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'ML', 'MR', 'AMC', 'AML', 'AMR', 'ST']);
      const targetCA = clamp(Math.round(abilityForReputation(club.rep) * rng.range(0.62, 0.9)), 18, 180);
      const p = generatePlayer(rng, {
        nationId: rng.chance(0.75) ? club.nation : rng.pick(world.nations).id,
        pos, age: rng.int(19, 30), targetCA, targetPA: clamp(targetCA + rng.int(0, 20), targetCA, 195),
        clubRep: club.rep, leagueRep: league?.rep ?? 55, year: world.year,
      });
      p.clubId = club.id;
      p.contract = {
        wage: Math.max(60, Math.round(estimateWage(targetCA, p.age, club.rep, 0.7) * 0.85)),
        expiresYear: world.year + rng.int(1, 2), signedYear: world.year,
        releaseClause: 0, goalBonus: 0, appearanceFee: 0, loanedFrom: null, loanUntilYear: null,
      };
      world.players[p.id] = p;
      club.squad.push(p.id);
      emergency.push(p);
    }
    if (emergency.length && club.isUserClub) {
      news(game, 'squad', 'Emergency signings',
        `With the squad below the minimum needed to fulfil fixtures, the club has signed `
        + `${emergency.map((p) => p.name).join(', ')} on short contracts. They are stopgaps, not solutions.`);
    }
    refreshRegistration(world, club);
  }

  pruneFreeAgents(game, rng);

  const user = userClub(game);
  if (user) {
    const league = world.leagues.find((l) => l.id === user.leagueId);
    if (league) user.board.expectation = expectationFor(world, user, league);
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

/**
 * Judge each of a club's objectives against what actually happened.
 *
 * Every one of these was previously either unscored or unrepresented: the cup
 * run had no objective at all, and wantsYouth / wantsAttacking were labels on
 * the Club screen that nothing ever read as a target.
 */
function scoreObjectives(game, club) {
  const world = game.world;
  const objectives = club.board?.objectives;
  if (!objectives?.length) return;
  const league = world.leagues.find((l) => l.id === club.leagueId);
  const finish = club.lastFinish ?? league?.teams ?? 20;

  for (const o of objectives) {
    if (o.id === 'league') {
      o.met = objectiveScore(o, finish) >= 0;
      o.detail = `Finished ${finish}`;
    } else if (o.id === 'cup') {
      // How far they actually went: the smallest round size they reached.
      const cup = world.competitions[`${club.nation}_CUP`];
      const reached = cupReachedBy(cup, club.id);
      o.met = reached !== null && reached <= o.target;
      o.detail = reached === null ? 'Did not enter' : `Reached the last ${reached}`;
    } else if (o.type === 'youth') {
      // Reserve football counts - it is the whole point of having a reserve side
      // - but it counts at a higher bar, because a season in the fourth tier is
      // an easier place to reach a thousand minutes than a top-flight bench.
      const reserve = reserveSideOf(world, club);
      const blooded = club.squad
        .map((id) => world.players[id])
        .filter((p) => p && p.age <= 21 && (p.season?.minutes ?? 0) >= 900).length
        + (reserve?.squad || [])
          .map((id) => world.players[id])
          .filter((p) => p && p.age <= 21 && (p.season?.minutes ?? 0) >= 1800).length;
      o.met = blooded >= o.target;
      o.detail = `${blooded} under-21s with regular football`;
    } else if (o.type === 'attacking') {
      const row = league?.table?.find((r) => r.clubId === club.id);
      const perGame = row && row.p ? row.gf / row.p : 0;
      o.met = perGame >= o.target;
      o.detail = `${perGame.toFixed(2)} goals a game`;
    } else if (o.type === 'wages') {
      const usage = wageBudgetUsage(world, club);
      o.met = usage.pct <= o.target;
      o.detail = `${Math.round(usage.pct * 100)}% of the wage budget`;
    }
  }

  // The secondary objectives move confidence, but less than the league does.
  let bonus = 0;
  for (const o of objectives) {
    if (o.id === 'league' || o.met === null) continue;
    bonus += (o.met ? 10 : -10) * (OBJECTIVE_WEIGHT[o.id] ?? 0.35);
  }
  club.board.confidence = clamp(club.board.confidence + bonus, 0, 100);
}

/** The smallest round a club reached in a cup, or null if they never entered. */
function cupReachedBy(comp, clubId) {
  if (!comp?.rounds?.length) return null;
  let best = null;
  for (const round of comp.rounds) {
    const inIt = (round.ties || []).some((t) => t.home === clubId || t.away === clubId)
      || (round.byes || []).includes(clubId);
    if (!inIt) continue;
    const size = (round.ties?.length || 0) * 2 + (round.byes?.length || 0);
    if (best === null || size < best) best = size;
  }
  if (comp.winner === clubId) best = 1;
  return best;
}

// --- Asking the board for something ------------------------------------------

/**
 * Things a manager can ask the board for.
 *
 * This is the first code in the game that ever writes to club.facilities or
 * club.stadium: both were fixed at world generation and stayed fixed for the
 * whole save, however well the club did. Upgrades feed straight into things that
 * already read them - training facilities set development rate and how many
 * individual training slots you get, youth facilities set intake quality and how
 * precisely you can read a scholar's potential, medical shortens injuries.
 */
export const BOARD_REQUESTS = {
  budget: { id: 'budget', label: 'More transfer money', help: 'Release funds for the current window.' },
  training: { id: 'training', label: 'Upgrade the training ground', help: 'Faster development, and more individual training slots.' },
  youth: { id: 'youth', label: 'Upgrade the youth academy', help: 'A better intake, and a clearer read on their potential.' },
  medical: { id: 'medical', label: 'Upgrade the medical department', help: 'Shorter injuries and quicker recovery.' },
  scouting: { id: 'scouting', label: 'Upgrade the scouting network', help: 'More accurate reports on players you do not know.' },
  stadium: { id: 'stadium', label: 'Expand the stadium', help: 'A bigger ground, and more gate money every home game.' },
  reserve: { id: 'reserve', label: 'Fund a reserve side', help: 'A second squad in a lower division, so fringe players get real football.' },
};

const FACILITY_KEYS = ['training', 'youth', 'medical', 'scouting'];

/** What a request would cost and whether the board would say yes. */
export function evaluateRequest(game, type) {
  const world = game.world;
  const club = userClub(game);
  const def = BOARD_REQUESTS[type];
  if (!club || !def) return { ok: false, reason: 'Unknown request.' };

  const board = club.board;
  const since = game.season - (board.lastRequestSeason ?? -99);
  if (since < 1) {
    return { ok: false, reason: 'You have already asked the board for something this season.', cost: 0 };
  }

  // The reserve side has its own placement rules - which division it can enter,
  // whether the club already has one - so it keeps its own evaluator and only
  // borrows the once-a-season limit and the shared screen.
  if (type === 'reserve') {
    const proposal = reserveProposal(game);
    return {
      ok: proposal.ok, cost: proposal.cost || 0, reason: proposal.reason,
      detail: proposal.league ? `a second squad entering ${proposal.league}` : '',
    };
  }

  let cost = 0;
  let detail = '';
  if (type === 'budget') {
    cost = Math.round(club.finances.incomeEstimate * 0.12);
    detail = `${money(cost)} added to the transfer budget`;
  } else if (type === 'stadium') {
    const add = Math.max(1500, Math.round(club.stadium.capacity * 0.18));
    cost = Math.round(add * 2600);
    detail = `${add.toLocaleString()} more seats`;
  } else {
    const level = club.facilities[type] ?? 10;
    if (level >= 20) return { ok: false, reason: 'These facilities are already the best available.', cost: 0 };
    cost = Math.round(380000 + level * level * 5200);
    detail = `facilities from ${level} to ${level + 1}`;
  }

  // Three independent gates, so a refusal always has a reason you can act on.
  if (board.confidence < 45) {
    return { ok: false, cost, detail, reason: 'The board do not rate your work highly enough to commit money to it.' };
  }
  if (club.finances.balance < cost * 1.6) {
    return { ok: false, cost, detail, reason: 'The club cannot afford it.' };
  }
  return { ok: true, cost, detail, reason: null };
}

/** Make the request. Returns null on success, or why it was refused. */
export function makeRequest(game, type) {
  const world = game.world;
  const club = userClub(game);
  const verdict = evaluateRequest(game, type);
  if (!verdict.ok) return verdict.reason;

  if (type === 'reserve') {
    // foundReserveSide takes the money and writes its own inbox item.
    const err = foundReserveSide(game);
    if (err) return err;
    club.board.lastRequestSeason = game.season;
    club.board.confidence = clamp(club.board.confidence - 4, 0, 100);
    return null;
  }

  club.board.lastRequestSeason = game.season;
  club.finances.balance -= verdict.cost;
  ledgerEntry(club, game.day, BOARD_REQUESTS[type].label, -verdict.cost, 'upkeep');

  if (type === 'budget') {
    club.finances.transferBudget += verdict.cost;
  } else if (type === 'stadium') {
    const add = Math.max(1500, Math.round(club.stadium.capacity * 0.18));
    club.stadium.capacity += add;
  } else {
    club.facilities[type] = Math.min(20, (club.facilities[type] ?? 10) + 1);
  }
  // Asking for money is not free: the board expect a return on it.
  club.board.confidence = clamp(club.board.confidence - 4, 0, 100);
  news(game, 'board', 'The board agree to your request',
    `${BOARD_REQUESTS[type].label}: ${verdict.detail}, at a cost of ${money(verdict.cost)}. `
    + 'The board will expect to see the benefit.');
  return null;
}

// --- Losing the job ----------------------------------------------------------

/** Below this the board have stopped weighing it up. */
const SACK_CERTAIN = 6;
/** Above this you are safe for another year whatever the board think of you. */
const SACK_WINDOW = 24;

/**
 * The chance the board dismiss the user at this season's review.
 *
 * This replaces a bare `confidence < 18`, which sacked you with certainty on one
 * side of a line and never on the other, and ignored `board.patience` entirely -
 * a figure printed on the Club screen that did nothing for the user. The AI
 * clubs have always run a patience roll; this is the same idea, with the
 * confidence scaling the flat AI version lacks, so the difference between a
 * patient board and an impatient one is roughly three to four times the risk.
 */
export function userSackRisk(club) {
  const conf = club?.board?.confidence ?? 100;
  if (conf >= SACK_WINDOW) return 0;
  if (conf < SACK_CERTAIN) return 1;
  const odds = remap(club.board.patience, 20, 90, 0.85, 0.25) * remap(conf, 0, SACK_WINDOW, 1.2, 0.5);
  return clamp(odds, 0.05, 0.97);
}

// --- The manager's own contract ----------------------------------------------

/** A manager's contract at a club, sized to what the club can pay. */
export function managerContract(club, year, years = 3) {
  // Sized against what clubs in this world actually earn: a giant on GBP 379M of
  // income pays about GBP 114k a week, a mid-table top-flight club around GBP
  // 48k, a fourth-tier club about GBP 2k. The first attempt keyed off income too
  // steeply and paid a manager GBP 659k a week, which made the compensation
  // below a GBP 67M liability on a club with GBP 86M in the bank.
  const wage = Math.max(700, Math.round(club.finances.incomeEstimate * 0.00029 + club.rep * 40));
  return { wage, signedYear: year, expiresYear: year + years };
}

/** What the club owes if it dismisses the manager with time left to run. */
export function dismissalCompensation(game) {
  const c = game.manager?.contract;
  if (!c) return 0;
  const yearsLeft = Math.max(0, c.expiresYear - game.world.year);
  // Half the remaining money: a real settlement rather than a token, and a few
  // per cent of a club's annual income rather than a crippling one.
  return Math.round(yearsLeft * c.wage * 52 * 0.5);
}

/**
 * A club's objectives for the coming season. One generator, shared with world
 * generation, so a club's ask no longer depends on whether it has ever played.
 */
function expectationFor(world, club, league) {
  const finish = club.lastFinish ?? Math.ceil(league.teams / 2);
  club.board.objectives = seasonObjectives(club, league, finish, {
    wageUsage: wageBudgetUsage(world, club).pct,
  });
  return club.board.objectives[0];
}

export { sortTable, leagueZones };
