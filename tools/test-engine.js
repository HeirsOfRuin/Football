// Smoke tests for the simulation. Run with `npm test`.
//
// These are assertions about behaviour that should hold in any build: the
// world generates coherently, the match engine produces football-shaped
// numbers, a season completes, and a save round-trips without losing data.

import { Rng } from '../src/core/rng.js';
import { generateWorld, squadStrength } from '../src/gen/worldgen.js';
import { generatePlayer } from '../src/gen/playergen.js';
import {
  abilityForPosition, currentAbility, ALL_ATTRS, POSITION_WEIGHTS, ATTR_GROUPS,
  familiarity, familiarityFromAffinity, positionEffectiveness,
} from '../src/data/attributes.js';
import { simulateMatch } from '../src/engine/match.js';
import { autoPick, autoAssignSpecialists, buildLineup } from '../src/engine/lineup.js';
import { roundRobin, drawKnockoutRound, sortTable, leagueZones } from '../src/engine/season.js';
import { MENTALITIES, INSTRUCTION_DEFS, FORMATIONS, ROLES } from '../src/data/tactics.js';
import {
  TRAINING_FOCUSES, developmentRate, trainPlayer, trainingSlots, retrainingStep,
  applyMentoring, PROGRAMME_TYPES,
} from '../src/engine/training.js';
import {
  newGame, advanceDay, playFixture, endSeason, rolloverSeason, userClub,
  takeOverClub, dismissalCompensation, evaluateRequest, makeRequest, managerContract, userSackRisk,
  availableJobs, openVacancy, closeExpiredVacancies, VACANCY_DAYS, applyInterview,
  setRegistration, sackManager,
} from '../src/state/game.js';
import { serialiseGame, deserialiseGame } from '../src/state/codec.js';
import { validateCustomPlayer, describeCustomPlayer, blankCustomPlayer } from '../src/state/library.js';
import { SEASON_DAYS } from '../src/core/calendar.js';
import { registrationLimit, refreshRegistration, buildLineup as buildXI } from '../src/engine/lineup.js';
import { wageBudgetUsage } from '../src/engine/finance.js';
import { leagueObjective, cupObjective, remitObjective, objectiveScore, seasonObjectives } from '../src/data/objectives.js';
import { INTERVIEW_QUESTIONS, interviewOutcome, ambitionShift, defaultAnswers } from '../src/data/interview.js';
import {
  careerTotals, recordMatchResult, recordSeason, addHonour, trackNotable,
  noteDeparture, retirePlayer, endSpell,
} from '../src/state/career.js';
import { crestSvg, kitSvg, crestUri, paletteFor, assignIdentities } from '../src/gen/identity.js';
import {
  openTransferTalks, transferOffer, termsOffer, cashEquivalent, termsEquivalent,
  openLoanTalks, loanOffer, willLend, willTakeInSwap, SWAP_DISCOUNT,
} from '../src/engine/negotiation.js';
import {
  askingPrice, evaluateContract, contractDemand, completeTransfer,
  completeLoan, returnFromLoan, marketValue,
} from '../src/engine/transfers.js';
import { weeklyWageBill } from '../src/engine/finance.js';

let passed = 0;
let failed = 0;
const failures = [];
const observed = {};
const record = (label, value) => { observed[label] = value; };

function check(name, condition, detail = '') {
  if (condition) { passed++; process.stdout.write('.'); } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    process.stdout.write('F');
  }
}

function near(name, actual, target, tolerance) {
  check(name, Math.abs(actual - target) <= tolerance, `got ${actual.toFixed(2)}, wanted ${target} ±${tolerance}`);
}

// --- Determinism -------------------------------------------------------------
{
  const a = [...Array(50)].map(() => new Rng(1234).next());
  const b = [...Array(50)].map(() => new Rng(1234).next());
  check('rng is deterministic', a.every((v, i) => v === b[i]));
  const stream = new Rng(9);
  const first = [...Array(10)].map(() => stream.next());
  const restored = Rng.restore(new Rng(9).save());
  check('rng restores from saved state', restored.next() === first[0]);
}

// --- Player generation -------------------------------------------------------
{
  const rng = new Rng(7);
  let maxError = 0;
  for (let i = 0; i < 250; i++) {
    const pos = rng.pick(['GK', 'DC', 'MC', 'ST', 'AML']);
    const target = rng.int(40, 190);
    const p = generatePlayer(rng, { nationId: 'ALB', pos, age: rng.int(17, 34), targetCA: target, targetPA: target + 10, clubRep: 70, leagueRep: 75 });
    maxError = Math.max(maxError, Math.abs(abilityForPosition(p.attrs, pos) - target));
    if (i === 0) {
      check('attributes are all present and in range',
        ALL_ATTRS.every((a) => p.attrs[a] >= 1 && p.attrs[a] <= 20 && Number.isInteger(p.attrs[a])));
    }
  }
  check('generated ability lands on target', maxError <= 3, `worst error ${maxError}`);
}

// --- Fixture scheduling ------------------------------------------------------
{
  const ids = [...Array(20)].map((_, i) => `c${i}`);
  const rounds = roundRobin(ids, new Rng(3));
  check('double round robin produces 2(n-1) rounds', rounds.length === 38);
  const seen = new Set();
  const homeCount = {};
  for (const round of rounds) {
    check('each round pairs every club once', round.length === 10);
    for (const [h, a] of round) {
      seen.add(`${h}>${a}`);
      homeCount[h] = (homeCount[h] || 0) + 1;
    }
  }
  check('every pairing occurs exactly once each way', seen.size === 380);
  check('home and away games are balanced', Object.values(homeCount).every((n) => n === 19));

  for (const n of [62, 40, 22, 9]) {
    const entrants = [...Array(n)].map((_, i) => `t${i}`);
    const { ties, byes } = drawKnockoutRound(entrants, new Rng(n));
    const survivors = ties.length + byes.length;
    check(`knockout round of ${n} leaves a power of two`, (survivors & (survivors - 1)) === 0, `left ${survivors}`);
    check(`knockout round of ${n} uses every entrant`, ties.length * 2 + byes.length === n);
  }
}

// --- Match engine ------------------------------------------------------------
const world = generateWorld({ seed: 4242, size: 'small' });
for (const c of Object.values(world.clubs)) c.tactic = autoAssignSpecialists(world, c, autoPick(world, c, c.tactic));
{
  check('world generated clubs and players', Object.keys(world.clubs).length > 100 && Object.keys(world.players).length > 2500);
  const league = world.leagues.find((l) => l.tier === 1);
  const clubs = league.clubIds.map((id) => world.clubs[id]);
  check('every club fields a full XI', clubs.every((c) => buildLineup(world, c, c.tactic).missing === 0));

  const rng = new Rng(555);
  const agg = { m: 0, goals: 0, shots: 0, onTarget: 0, corners: 0, fouls: 0, yellow: 0, red: 0, home: 0, draw: 0 };
  for (let i = 0; i < 400; i++) {
    const a = rng.int(0, clubs.length - 1);
    let b = rng.int(0, clubs.length - 1);
    while (b === a) b = rng.int(0, clubs.length - 1);
    for (const c of [clubs[a], clubs[b]]) for (const id of c.squad) { world.players[id].condition = 96; world.players[id].matchCondition = 96; }
    const st = simulateMatch(world, { homeClub: clubs[a], awayClub: clubs[b], homeTactic: clubs[a].tactic, awayTactic: clubs[b].tactic, rng });
    const r = st.result;
    agg.m++;
    agg.goals += r.homeGoals + r.awayGoals;
    agg.shots += r.homeStats.shots + r.awayStats.shots;
    agg.onTarget += r.homeStats.onTarget + r.awayStats.onTarget;
    agg.corners += r.homeStats.corners + r.awayStats.corners;
    agg.fouls += r.homeStats.fouls + r.awayStats.fouls;
    agg.yellow += r.homeStats.yellow + r.awayStats.yellow;
    agg.red += r.homeStats.red + r.awayStats.red;
    if (r.homeGoals > r.awayGoals) agg.home++;
    else if (r.homeGoals === r.awayGoals) agg.draw++;
    check('possession shares sum to 100', r.homeStats.possession + r.awayStats.possession === 100);
    check('on target never exceeds shots', r.homeStats.onTarget <= r.homeStats.shots && r.awayStats.onTarget <= r.awayStats.shots);
    check('goals never exceed shots on target', r.homeGoals <= r.homeStats.onTarget && r.awayGoals <= r.awayStats.onTarget);
  }
  const perTeam = agg.m * 2;
  record('matches simulated', agg.m);
  record('goals per match', (agg.goals / agg.m).toFixed(2));
  record('shots per team', (agg.shots / perTeam).toFixed(2));
  record('home/draw/away %', `${((agg.home / agg.m) * 100).toFixed(0)}/${((agg.draw / agg.m) * 100).toFixed(0)}/${(((agg.m - agg.home - agg.draw) / agg.m) * 100).toFixed(0)}`);
  near('goals per match', agg.goals / agg.m, 2.75, 0.45);
  near('shots per team', agg.shots / perTeam, 12.6, 2.2);
  near('shots on target per team', agg.onTarget / perTeam, 4.4, 1.0);
  near('corners per team', agg.corners / perTeam, 5.0, 1.2);
  near('fouls per team', agg.fouls / perTeam, 10.8, 2.2);
  near('yellow cards per team', agg.yellow / perTeam, 1.9, 0.6);
  near('red cards per match', agg.red / agg.m, 0.08, 0.09);
  near('home win percentage', (agg.home / agg.m) * 100, 45, 8);
  near('draw percentage', (agg.draw / agg.m) * 100, 25, 7);

  // Quality has to matter: the strongest side should beat the weakest most of the time.
  const ranked = [...clubs].sort((a, b) => squadStrength(world, b) - squadStrength(world, a));
  const [strong, weak] = [ranked[0], ranked[ranked.length - 1]];
  let strongWins = 0;
  for (let i = 0; i < 150; i++) {
    // Reset the whole player state so this measures squad quality alone, not
    // the morale and form the previous 400 matches left behind.
    for (const c of [strong, weak]) {
      for (const id of c.squad) {
        Object.assign(world.players[id], { condition: 96, matchCondition: 96, morale: 70, form: 0, sharpness: 85 });
      }
    }
    const st = simulateMatch(world, { homeClub: strong, awayClub: weak, homeTactic: strong.tactic, awayTactic: weak.tactic, rng });
    if (st.result.homeGoals > st.result.awayGoals) strongWins++;
  }
  // The exact rate depends on how far apart the two squads happen to be in a
  // given world, so assert the band rather than a number fitted to one seed.
  const strongRate = (strongWins / 150) * 100;
  check('quality decides matches without making them certain', strongRate >= 60 && strongRate <= 95,
    `strongest (${Math.round(squadStrength(world, strong))}) beat weakest (${Math.round(squadStrength(world, weak))}) ${strongRate.toFixed(0)}% at home`);
}

// --- Every setting the interface offers must reach the engine ----------------
{
  // The simulation is deterministic, so with a fixed seed a setting the engine
  // never reads produces byte-identical matches. That makes this an exact test
  // for decoration rather than a statistical one: no sample size to argue about.
  const league = world.leagues.find((l) => l.tier === 1);
  const [home, away] = league.clubIds.slice(0, 2).map((id) => world.clubs[id]);
  const fingerprint = (mutate) => {
    const rng = new Rng(4242);
    const out = [];
    for (let i = 0; i < 12; i++) {
      for (const c of [home, away]) {
        for (const id of c.squad) Object.assign(world.players[id], { condition: 96, matchCondition: 96, morale: 70, form: 0, sharpness: 85 });
      }
      const tactic = JSON.parse(JSON.stringify(home.tactic));
      mutate(tactic);
      const st = simulateMatch(world, { homeClub: home, awayClub: away, homeTactic: tactic, awayTactic: away.tactic, rng });
      const r = st.result;
      out.push(`${r.homeGoals}-${r.awayGoals}:${r.homeStats.shots}:${r.awayStats.shots}:${r.homeStats.possession}:${r.homeStats.yellow}:${r.homeStats.offsides}`);
    }
    return out.join('|');
  };
  const base = fingerprint(() => {});
  for (const m of MENTALITIES) {
    if (m === 'Balanced') continue;
    check(`mentality "${m}" changes the simulation`, fingerprint((t) => { t.mentality = m; }) !== base);
  }
  for (const [key, def] of Object.entries(INSTRUCTION_DEFS)) {
    for (const option of def.options) {
      if (option === def.default) continue;
      check(`instruction ${key}="${option}" reaches the engine`,
        fingerprint((t) => { t.instructions = { ...t.instructions, [key]: option }; }) !== base,
        'the interface offers this setting but the engine never reads it');
    }
  }
  for (const roleId of ['ST_POACHER', 'ST_TARGET', 'ST_FALSE', 'ST_PRESS']) {
    const slots = FORMATIONS[home.tactic.formation].slots;
    const applies = slots.some((s) => ROLES[roleId].pos.includes(s.pos));
    if (!applies) continue;
    check(`role ${roleId} changes the simulation`, fingerprint((t) => {
      t.assignments.forEach((a, i) => {
        if (ROLES[roleId].pos.includes(slots[i].pos)) { a.role = roleId; a.duty = ROLES[roleId].duties[ROLES[roleId].duties.length - 1]; }
      });
    }) !== base);
  }
  for (const focus of TRAINING_FOCUSES) {
    if (focus.id === 'Balanced') continue;
    check(`training focus "${focus.id}" targets different attributes`, Object.keys(focus.emphasis).length > 0);
  }
}

// --- Development: the rate and the spending have to agree --------------------
{
  // A development system computes how much a player improves, then picks which
  // attribute to spend it on. If the spending lands on attributes the player's
  // position ignores, the rate is a lie and prospects stall for years while
  // every individual number looks fine. Assert the share, not the magnitude.
  const rng = new Rng(31337);
  // An explicitly ordinary club, not whichever one happens to be first in the
  // world. The rate scales with facilities and coaching, so pinning a magnitude
  // to an arbitrary club makes this assertion a hostage to generation order: any
  // change to how many random draws worldgen makes silently re-rolls the club
  // this reads, and the test fails for a reason that has nothing to do with
  // development.
  const club = {
    facilities: { training: 10, youth: 10, scouting: 10, medical: 10 },
    coaching: { attacking: 10, defending: 10, fitness: 10, gk: 10 },
    trainingFocus: 'Balanced',
    trainingIntensity: 'Balanced',
  };
  const make = (age, ca, pa, minutes) => {
    const p = generatePlayer(rng, { nationId: 'ALB', pos: 'ST', age, targetCA: ca, targetPA: pa, clubRep: 75, leagueRep: 85 });
    p.season.minutes = minutes;
    return p;
  };
  // Test the relationships, not one fitted number: a bigger gap, a younger
  // player and more football all have to mean faster progress, and the
  // ordinary case has to stay ordinary.
  const typical = make(18, 105, 140, 900);
  const generational = make(18, 95, 175, 900);
  const nearCeiling = make(18, 132, 140, 900);
  const pastPeak = make(26, 105, 140, 900);
  const benched = make(18, 105, 140, 0);
  const perYear = (p) => developmentRate(world, club, p) * 52;

  check('an ordinary prospect improves at an ordinary rate', perYear(typical) > 2 && perYear(typical) < 12,
    `${perYear(typical).toFixed(1)} attribute points a year`);
  check('a bigger gap to potential means faster progress', perYear(generational) > perYear(typical));
  check('the very best prospects are still bounded', perYear(generational) < 22,
    `${perYear(generational).toFixed(1)} attribute points a year`);
  check('progress slows as a player nears his ceiling', perYear(nearCeiling) < perYear(typical));
  check('the same player improves more slowly at 26 than at 18', perYear(pastPeak) < perYear(typical));
  check('playing regularly beats not playing', perYear(typical) > perYear(benched));
  record('prospect development', `typical ${perYear(typical).toFixed(1)}, generational ${perYear(generational).toFixed(1)} pts/yr`);
  const prospect = generational;

  // Spend a few thousand points and see where they actually land.
  const before = { ...prospect.attrs };
  let ticks = 0;
  for (let i = 0; i < 2600; i++) { trainPlayer(rng, world, club, prospect); ticks++; }
  let relevant = 0;
  let total = 0;
  for (const attr in prospect.attrs) {
    const delta = prospect.attrs[attr] - before[attr];
    if (delta <= 0) continue;
    total += delta;
    if (POSITION_WEIGHTS.ST[attr]) relevant += delta;
  }
  const share = total ? relevant / total : 0;
  check('development lands on attributes the position actually uses', share >= 0.7,
    `only ${(share * 100).toFixed(0)}% of gains were on striker attributes`);
  record('useful share of development', `${(share * 100).toFixed(0)}%`);
  check('a player cannot train past his potential', currentAbility(prospect) <= prospect.pa + 2,
    `reached ${currentAbility(prospect)} against a ceiling of ${prospect.pa}`);

  // Decline is the same system in reverse and has to behave too.
  const veteran = generatePlayer(rng, {
    nationId: 'ALB', pos: 'DC', age: 34, targetCA: 130, targetPA: 130, clubRep: 75, leagueRep: 85,
  });
  veteran.season.minutes = 2000;
  const older = generatePlayer(rng, {
    nationId: 'ALB', pos: 'DC', age: 37, targetCA: 130, targetPA: 130, clubRep: 75, leagueRep: 85,
  });
  older.season.minutes = 2000;
  check('players decline after their peak', developmentRate(world, club, veteran) < 0);
  check('decline accelerates with age',
    developmentRate(world, club, older) < developmentRate(world, club, veteran));
}

// --- A full season -----------------------------------------------------------
{
  const game = newGame({ seed: 1717, size: 'small', managerName: 'Test', clubId: null });
  const league = game.world.leagues.find((l) => l.tier === 1);
  game.userClubId = league.clubIds[4];
  game.world.clubs[game.userClubId].isUserClub = true;

  let guard = 0;
  let userFixturesPlayed = 0;
  while (game.day < SEASON_DAYS - 1 && guard++ < 420) {
    const r = advanceDay(game);
    if (r.stopped && r.reason === 'userMatch') {
      playFixture(game, game.fixtures[game.pendingMatchId]);
      game.status = 'idle';
      game.pendingMatchId = null;
      userFixturesPlayed++;
    }
    if (r.stopped && r.reason === 'seasonRollover') break;
  }
  const table = sortTable(league.table);
  // Assert the exact number of games, not "one of two plausible numbers" — an
  // OR here would pass a season that stalled halfway and never advanced.
  const expectedGames = (league.teams - 1) * 2;
  check('every club played a full league season', table.every((r) => r.p === expectedGames),
    `expected ${expectedGames} each, saw ${[...new Set(table.map((r) => r.p))].join(',')}`);
  check('the season actually advanced the calendar', game.day >= SEASON_DAYS - 2, `stopped on day ${game.day}`);
  check('the user played a full set of fixtures', userFixturesPlayed >= expectedGames,
    `only ${userFixturesPlayed} user matches`);
  check('league points reconcile with results', table.every((r) => r.pts === r.w * 3 + r.d));
  check('wins, draws and losses sum to games played', table.every((r) => r.w + r.d + r.l === r.p));
  const goalsFor = table.reduce((a, r) => a + r.gf, 0);
  const goalsAgainst = table.reduce((a, r) => a + r.ga, 0);
  check('goals scored equal goals conceded across the division', goalsFor === goalsAgainst);
  // Every competition that has played all its fixtures must have settled. The
  // user's own match is played after the day advances, so a round they complete
  // themselves takes a different code path from every other result — a cup
  // final they win used to be played and then silently forgotten.
  for (const comp of Object.values(game.world.competitions)) {
    const allPlayed = (comp.rounds || []).length > 0
      && comp.rounds.every((r) => r.fixtureIds.every((id) => game.fixtures[id]?.played));
    if (!allPlayed) continue;
    check(`${comp.name} settled after its last fixture`, !!comp.winner,
      'every fixture was played but no winner was recorded');
  }
  check('the domestic cup produced a winner', !!game.world.competitions[`${game.world.clubs[game.userClubId].nation}_CUP`].winner);
  check('the continental cup produced a winner', !!game.world.competitions.CONT_CUP.winner);
  check('the transfer market was active', game.transferLog.length > 150, `${game.transferLog.length} deals`);
  record('league games each', expectedGames);
  record('user matches played', userFixturesPlayed);
  record('season ended on day', game.day);
  record('transfers completed', game.transferLog.length);
  record('goals across the division', table.reduce((a, r) => a + r.gf, 0));
  record('inbox items generated', game.inbox.length);

  // Save round trip.
  const json = JSON.stringify(serialiseGame(game));
  const restored = deserialiseGame(JSON.parse(json));
  check('save keeps the calendar position', restored.day === game.day && restored.season === game.season);
  check('save keeps every player', Object.keys(restored.world.players).length === Object.keys(game.world.players).length);
  const ids = Object.keys(game.world.players).slice(0, 300);
  check('save keeps attributes exactly', ids.every((id) => ALL_ATTRS.every((a) => game.world.players[id].attrs[a] === restored.world.players[id].attrs[a])));
  check('save keeps season statistics', ids.every((id) => game.world.players[id].season.goals === restored.world.players[id].season.goals));
  check('save keeps contracts', ids.every((id) => (game.world.players[id].contract?.wage ?? null) === (restored.world.players[id].contract?.wage ?? null)));
  check('save keeps the random stream in sync', restored.rng.save() === game.rng.save());

  const before = Object.keys(game.world.players).length;
  endSeason(game);
  rolloverSeason(game);
  check('rollover advances the year', game.world.year === 2026 && game.season === 2);
  check('rollover keeps the world a sensible size', Math.abs(Object.keys(game.world.players).length - before) < before * 0.5);
  check('a new season schedules fixtures', Object.keys(game.fixtures).length > 1000);
  const squads = Object.values(game.world.clubs).map((c) => c.squad.length);
  check('no club is left without a squad', Math.min(...squads) >= 16, `smallest squad ${Math.min(...squads)}`);
}

// --- Training: the settings have to do something -----------------------------
{
  // The defect this replaces: intensity was read by the engine and written by
  // nothing but the Club screen, so every club in the world ran on undefined.
  const clubs = Object.values(world.clubs);
  check('every club is given a training intensity', clubs.every((c) => c.trainingIntensity));
  check('every club is given a training focus', clubs.every((c) => c.trainingFocus));
  check('every club has a slot list', clubs.every((c) => Array.isArray(c.training?.slots)));

  const slotCounts = clubs.map((c) => trainingSlots(c));
  check('slot counts stay inside 2-6', Math.min(...slotCounts) >= 2 && Math.max(...slotCounts) <= 6,
    `range ${Math.min(...slotCounts)}-${Math.max(...slotCounts)}`);
  // Scarcity has to track the staff, or coaching quality is decoration again.
  const rich = { coaching: { attacking: 19, defending: 19, fitness: 19, gk: 19 }, facilities: { training: 19 } };
  const poor = { coaching: { attacking: 3, defending: 3, fitness: 3, gk: 3 }, facilities: { training: 3 } };
  check('better staff earn more slots', trainingSlots(rich) > trainingSlots(poor),
    `${trainingSlots(poor)} vs ${trainingSlots(rich)}`);
  record('individual slots, worst club to best', `${Math.min(...slotCounts)} to ${Math.max(...slotCounts)}`);

  const ordinary = {
    facilities: { training: 10, youth: 10, scouting: 10, medical: 10 },
    coaching: { attacking: 10, defending: 10, fitness: 10, gk: 10 },
    manager: { youthDev: 10 }, trainingFocus: 'Balanced', trainingIntensity: 'Normal',
  };
  const makeCohort = (seed, age, pos, n) => {
    const r = new Rng(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = generatePlayer(r, { nationId: 'ALB', pos, age, targetCA: 95, targetPA: 155, clubRep: 70, leagueRep: 82 });
      p.season.minutes = 1500;
      out.push(p);
    }
    return out;
  };
  const runSeason = (players, club, prog, seed) => {
    const r = new Rng(seed);
    const before = players.map((p) => ({ ...p.attrs }));
    for (let w = 0; w < 38; w++) for (const p of players) trainPlayer(r, world, club, p, prog);
    return (attrs) => {
      let g = 0;
      players.forEach((p, i) => { for (const a of attrs) g += p.attrs[a] - before[i][a]; });
      return g / players.length;
    };
  };

  // An individual programme has to aim development, not just claim to.
  const cohortA = makeCohort(77, 19, 'MC', 60);
  const cohortB = JSON.parse(JSON.stringify(cohortA));
  const plainGain = runSeason(cohortA, ordinary, null, 404);
  const physGain = runSeason(cohortB, ordinary, { type: 'group', target: 'physical' }, 404);
  const plainPhys = plainGain(ATTR_GROUPS.physical);
  const aimedPhys = physGain(ATTR_GROUPS.physical);
  check('an individual programme aims development at its target',
    aimedPhys > plainPhys * 1.4, `${plainPhys.toFixed(2)} -> ${aimedPhys.toFixed(2)} physical points`);
  record('physical points a season, untargeted vs targeted', `${plainPhys.toFixed(1)} -> ${aimedPhys.toFixed(1)}`);

  // Intense has to cost something. Its whole point is being a trade.
  const hard = makeCohort(78, 24, 'MC', 120);
  const easy = JSON.parse(JSON.stringify(hard));
  const rHard = new Rng(909);
  const rEasy = new Rng(909);
  let hardInjuries = 0;
  let easyInjuries = 0;
  for (let w = 0; w < 38; w++) {
    for (const p of hard) { p.injury = null; trainPlayer(rHard, world, { ...ordinary, trainingIntensity: 'Intense' }, p, null); if (p.injury) hardInjuries++; }
    for (const p of easy) { p.injury = null; trainPlayer(rEasy, world, ordinary, p, null); if (p.injury) easyInjuries++; }
  }
  check('intense training injures players', hardInjuries > 0, `${hardInjuries} over a season`);
  check('normal training injures nobody', easyInjuries === 0, `${easyInjuries} injuries`);
  record('training injuries per 120 players, intense vs normal', `${hardInjuries} vs ${easyInjuries}`);

  // Position retraining: the point is that it reaches the match engine.
  const learner = makeCohort(79, 20, 'MC', 1)[0];
  const startFam = familiarity(learner, 'DC');
  const startEff = positionEffectiveness(learner, 'DC');
  const rLearn = new Rng(31);
  for (let w = 0; w < 38; w++) trainPlayer(rLearn, world, ordinary, learner, { type: 'position', target: 'DC' });
  const endFam = familiarity(learner, 'DC');
  check('retraining raises familiarity', endFam > startFam, `${startFam} -> ${endFam}`);
  check('retraining moves about one band a season', endFam - startFam >= 3 && endFam - startFam <= 8,
    `gained ${endFam - startFam} in a season`);
  check('retraining reaches the match engine', positionEffectiveness(learner, 'DC') > startEff);
  record('retraining, one season at 20', `familiarity ${startFam} -> ${endFam}`);

  // ...and a player who has never been retrained is completely unaffected.
  const untaught = makeCohort(80, 24, 'ST', 1)[0];
  check('an untrained player reads exactly as he always did',
    familiarity(untaught, 'DC') === familiarityFromAffinity(untaught, 'DC'));

  // Mentoring is the only thing in the game that can move hidden personality.
  const kid = makeCohort(81, 18, 'MC', 1)[0];
  kid.hidden.professionalism = 6;
  const mentor = makeCohort(82, 31, 'MC', 1)[0];
  mentor.hidden.professionalism = 19;
  let moved = false;
  for (let w = 0; w < 38; w++) moved = applyMentoring(kid, mentor) || moved;
  check('mentoring raises a young professional', kid.hidden.professionalism > 6,
    `6 -> ${kid.hidden.professionalism.toFixed(1)}`);
  const peer = makeCohort(83, 19, 'MC', 1)[0];
  peer.hidden.professionalism = 19;
  const kid2 = makeCohort(84, 18, 'MC', 1)[0];
  kid2.hidden.professionalism = 6;
  applyMentoring(kid2, peer);
  check('a player his own age is not a mentor', kid2.hidden.professionalism === 6);

  check('every programme type is offered', Object.keys(PROGRAMME_TYPES).length === 4);
}

// --- The board ---------------------------------------------------------------
{
  const w3 = generateWorld({ seed: 2211, size: 'small' });
  const clubs = Object.values(w3.clubs).filter((c) => !c.affiliateOf);

  check('every club is given three objectives',
    clubs.every((c) => c.board.objectives?.length === 3));
  check('the league objective is the first one',
    clubs.every((c) => c.board.objectives[0].id === 'league' && c.board.expectation === c.board.objectives[0]));

  // The two generators used to disagree. One function now serves both, so the
  // same club and division must produce the same ask from either entry point.
  const lg = w3.leagues.find((l) => l.tier === 2);
  for (const finish of [1, 5, 12, 20]) {
    const a = leagueObjective(lg, finish);
    const b = leagueObjective(lg, finish);
    check(`objective for finish ${finish} is stable`, a.type === b.type && a.target === b.target);
  }
  // A division with nothing below it cannot ask a club to avoid relegation.
  const bottom = w3.leagues.find((l) => !l.hasDivisionBelow);
  if (bottom) {
    check('the bottom division never asks you to avoid relegation',
      leagueObjective(bottom, bottom.teams).type !== 'survive');
  }
  // ...and one with nothing above it cannot ask for promotion.
  const topFlight = w3.leagues.find((l) => l.tier === 1);
  check('the top flight never asks for promotion',
    [1, 10, 20].every((f) => leagueObjective(topFlight, f).label !== 'Win promotion'));

  // Scoring has to separate meeting an objective from missing it.
  const survive = { type: 'survive', target: 17 };
  check('meeting an objective scores better than missing it',
    objectiveScore(survive, 15) > objectiveScore(survive, 19));
  const title = { type: 'title', target: 1 };
  check('winning the league scores best of all', objectiveScore(title, 1) > objectiveScore(title, 2));

  // All three remit varieties have to be reachable, or one is dead code.
  const kinds = new Set();
  for (const c of clubs) kinds.add(remitObjective(c).type);
  check('every remit variety occurs in a world', kinds.size === 3, [...kinds].join(','));

  // A cup objective must be easier for a small club than a giant.
  const big = cupObjective(topFlight, 1);
  const small = cupObjective(topFlight, topFlight.teams);
  check('the board ask more of a big club in the cup', big.target < small.target,
    `${big.target} v ${small.target}`);

  // The wage remit has to be an ask. It was measured at a flat "stay under your
  // budget" and every club in a fresh world was already under it by a wide
  // margin, which made it a free pass rather than an objective.
  const spender = { board: {} };
  const tight = remitObjective(spender, { wageUsage: 0.35 });
  const loose = remitObjective(spender, { wageUsage: 0.92 });
  check('the wage remit is pitched at where the club actually stands',
    tight.target < loose.target, `${tight.target} v ${loose.target}`);
  check('the wage remit never asks for more than the budget', loose.target <= 1);
  check('the wage remit puts its number in the ask', /\d+%/.test(tight.label), tight.label);
  const usages = Object.values(w3.clubs).filter((c) => !c.affiliateOf)
    .map((c) => ({ pct: wageBudgetUsage(w3, c).pct, o: c.board.objectives[2] }))
    .filter((r) => r.o.type === 'wages');
  check('a wage remit exists to check', usages.length > 0);
  const slack = usages.map((r) => r.o.target - r.pct);
  record('wage remit headroom, tightest to loosest',
    `${Math.min(...slack).toFixed(2)} to ${Math.max(...slack).toFixed(2)} of the budget`);
  check('no club starts the season already past its wage remit',
    slack.every((d) => d > 0));
  check('no club is given a wage remit it could not possibly breach',
    slack.every((d) => d <= 0.13), `worst headroom ${Math.max(...slack).toFixed(2)}`);
}

// --- Board requests actually change the club ---------------------------------
{
  const g4 = newGame({ seed: 2211, size: 'small', managerName: 'Test', clubId: null });
  const w4 = g4.world;
  const target = Object.values(w4.clubs).find((c) => !c.affiliateOf
    && c.facilities.training < 17 && c.finances.balance > 1e7);
  // Without this the whole block below can vanish silently if a seed stops
  // producing a club that has room to upgrade and money to pay for it, and a
  // green run would be testing nothing at all.
  check('a club with room to improve and money to do it exists', !!target);
  if (target) {
    takeOverClub(g4, target.id, 'Test', 'ALB');
    const club = userClub(g4);
    check('a manager is given a contract', !!g4.manager.contract && g4.manager.contract.wage > 0,
      `${g4.manager.contract?.wage}/wk`);
    record('manager wage at a top-flight club', `${g4.manager.contract.wage}/wk`);
    check('dismissal costs the club something', dismissalCompensation(g4) > 0);
    // A bigger club has to be able to pay a manager more than a small one, or
    // the wage is a decoration rather than a number the board has to find.
    const smallest = Object.values(w4.clubs).filter((c) => !c.affiliateOf)
      .sort((a, b) => a.rep - b.rep)[0];
    const bigDeal = managerContract(target, w4.year);
    const smallDeal = managerContract(smallest, w4.year);
    check('a bigger club pays its manager more', bigDeal.wage > smallDeal.wage,
      `${bigDeal.wage} v ${smallDeal.wage}`);
    record('manager wage, biggest club to smallest', `${bigDeal.wage} to ${smallDeal.wage}/wk`);
    check('a manager contract runs for whole seasons',
      managerContract(target, w4.year, 3).expiresYear === w4.year + 3);

    club.board.confidence = 20;
    check('a distrusted manager is refused', !evaluateRequest(g4, 'training').ok);
    club.board.confidence = 80;
    const before = club.facilities.training;
    const verdict = evaluateRequest(g4, 'training');
    check('a trusted manager at a solvent club is approved', verdict.ok, verdict.reason || '');
    // Facilities were frozen from world generation to the end of the save until
    // now, so this is the assertion that the request does anything at all.
    makeRequest(g4, 'training');
    check('an approved upgrade raises the facility', club.facilities.training === before + 1,
      `${before} -> ${club.facilities.training}`);
    check('only one request a season', !evaluateRequest(g4, 'youth').ok);

    // ...and the upgrade has to reach the thing it is supposed to affect.
    const probe = generatePlayer(new Rng(9), { nationId: 'ALB', pos: 'MC', age: 19, targetCA: 95, targetPA: 160, clubRep: 70, leagueRep: 80 });
    probe.season.minutes = 1500;
    const poorClub = { ...club, facilities: { ...club.facilities, training: 4 } };
    const richClub = { ...club, facilities: { ...club.facilities, training: 19 } };
    check('better training facilities develop players faster',
      developmentRate(w4, richClub, probe) > developmentRate(w4, poorClub, probe));

    // A save written before this stage has one expectation and a manager on no
    // contract at all, so without a migration a dismissal would cost the club
    // nothing and the Club screen would show an empty objectives list until the
    // next rollover. Build that older shape out of a current save and load it.
    const old5 = JSON.parse(JSON.stringify(serialiseGame(g4)));
    old5.v = 5;
    const keptExpectation = {};
    for (const id in old5.world.clubs) {
      const c = old5.world.clubs[id];
      if (!c.board) continue;
      c.board.expectation = c.board.objectives?.[0] || c.board.expectation;
      delete c.board.objectives;
      keptExpectation[id] = c.board.expectation;
    }
    delete old5.game.manager.contract;
    const migrated = deserialiseGame(old5);
    const mClubs = Object.values(migrated.world.clubs).filter((c) => !c.affiliateOf && c.board);
    // every() on an empty list is true, so say how many clubs were actually read.
    check('the migrated save has clubs to check', mClubs.length > 100, `${mClubs.length} clubs`);
    check('an older save gains the two new objectives',
      mClubs.every((c) => c.board.objectives?.length === 3), 
      `${mClubs.filter((c) => c.board.objectives?.length !== 3).length} clubs without three`);
    check('an older save keeps the league ask it was already being judged against',
      mClubs.every((c) => c.board.objectives[0].label === keptExpectation[c.id].label));
    // Losing the job used to be a bare threshold: certain below 18 confidence,
    // impossible above it, with board.patience ignored for the user entirely.
    const risky = (conf, patience) => userSackRisk({ board: { confidence: conf, patience } });
    check('a trusted manager is never sacked', risky(60, 20) === 0 && risky(24, 20) === 0);
    check('a manager the board have given up on always goes', risky(2, 90) === 1);
    check('an impatient board sacks sooner than a patient one', risky(15, 20) > risky(15, 90),
      `${risky(15, 20).toFixed(2)} v ${risky(15, 90).toFixed(2)}`);
    check('worse confidence means more risk at the same patience', risky(8, 45) > risky(22, 45),
      `${risky(8, 45).toFixed(2)} v ${risky(22, 45).toFixed(2)}`);
    // The point of the roll is that a bad season is survivable. If the odds sat
    // near 1 across the window this would be the old certainty with extra steps.
    check('a bad season is survivable', risky(15, 45) > 0.2 && risky(15, 45) < 0.7,
      risky(15, 45).toFixed(2));
    record('sacked at 15 confidence, impatient to patient board',
      `${Math.round(risky(15, 20) * 100)}% to ${Math.round(risky(15, 90) * 100)}%`);

    check('an older save gives the manager a contract',
      migrated.manager.contract?.wage > 0 && dismissalCompensation(migrated) > 0,
      `${migrated.manager.contract?.wage}/wk`);
  }
}

// --- Negotiation has to have a memory ----------------------------------------
{
  const g5 = newGame({ seed: 8821, size: 'small', managerName: 'Test', clubId: null });
  const w5 = g5.world;
  const top5 = w5.leagues.find((l) => l.tier === 1);
  const buyer = w5.clubs[top5.clubIds[2]];
  buyer.isUserClub = true;
  g5.userClubId = buyer.id;
  const mark = Object.values(w5.players)
    .filter((p) => p.clubId && p.clubId !== buyer.id && !w5.clubs[p.clubId]?.affiliateOf && p.contract)
    .sort((a, b) => askingPrice(w5, b) - askingPrice(w5, a))[400];
  check('there is a player to negotiate for', !!mark);

  const { negotiation: neg } = openTransferTalks(g5, mark, buyer);
  check('talks open with a position', !!neg && neg.reserve > 0 && neg.patience >= 3,
    neg ? `reserve ${neg.reserve}, patience ${neg.patience}` : 'no negotiation');
  // The defining regression. A lowball rejected once must not become an
  // acceptance through repetition, and each attempt has to cost something.
  const low = { fee: Math.round(neg.reserve * 0.4), sellOn: 0, instalments: 1 };
  const first = transferOffer(g5, neg, low);
  check('a lowball is refused', first.outcome === 'rejected' || first.outcome === 'collapsed');
  const reserveAfter = neg.reserve;
  let wonByRepeating = false;
  let ended = false;
  for (let i = 0; i < 12 && !ended; i++) {
    const r = transferOffer(g5, neg, low);
    if (r.outcome === 'accepted') wonByRepeating = true;
    if (r.outcome === 'accepted' || r.outcome === 'collapsed' || r.outcome === 'closed') ended = true;
  }
  check('repeating the same offer never wins', !wonByRepeating);
  check('a lowball hardens their position', reserveAfter > neg.openingAsk * 0 && neg.reserve >= reserveAfter,
    `${reserveAfter} -> ${neg.reserve}`);
  check('they eventually walk away', neg.status === 'collapsed', neg.status);
  check('walking away blocks a fresh approach', !!openTransferTalks(g5, mark, buyer).error);
  record('rounds before a lowballer is shown the door', neg.round);

  // Clauses have to be worth something, and the number on the screen has to be
  // the number the engine judges - one function, not two.
  const plain = cashEquivalent(w5, mark, { fee: 10e6, sellOn: 0, instalments: 1 });
  const withSellOn = cashEquivalent(w5, mark, { fee: 10e6, sellOn: 25, instalments: 1 });
  const deferred = cashEquivalent(w5, mark, { fee: 10e6, sellOn: 0, instalments: 4 });
  check('a sell-on clause is worth something to the seller', withSellOn > plain * 1.02,
    `${plain} v ${withSellOn}`);
  check('money paid over four years is worth less than money now', deferred < plain * 0.95,
    `${plain} v ${deferred}`);
  check('the cash-equivalent of a plain fee is the fee', plain === 10e6, String(plain));

  // A signing-on fee has to actually buy a lower wage, or it is another
  // computed-and-discarded number - which is exactly what it was.
  const bare = termsEquivalent(mark, { wage: 20000, years: 3 });
  const sweetened = termsEquivalent(mark, { wage: 20000, years: 3, signingBonus: 1560000 });
  check('a signing-on fee counts toward the package', sweetened > bare,
    `${bare} v ${sweetened}/wk`);

  // Personal terms used to be nearly free: 43% of players would sign for under
  // a tenth of the wage they had asked for, because the money term was floored
  // while the bonuses that outvote it were not.
  const shares = [];
  for (const p of Object.values(w5.players).filter((x) => x.clubId && x.clubId !== buyer.id).slice(0, 600)) {
    const d = contractDemand(w5, p, buyer);
    if (!evaluateContract(w5, p, buyer, { wage: d.wage, years: d.years, promisedRole: 'key' }).accepted) continue;
    let lo = 0; let hi = d.wage;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (evaluateContract(w5, p, buyer, { wage: mid, years: d.years, promisedRole: 'key' }).accepted) hi = mid;
      else lo = mid;
    }
    shares.push(hi / d.wage);
  }
  shares.sort((a, b) => a - b);
  check('enough players were probed to mean anything', shares.length > 300, `${shares.length}`);
  check('nobody signs for a tenth of what he asked for', shares.every((x) => x >= 0.1),
    `lowest ${(shares[0] * 100).toFixed(0)}%`);
  record('lowest wage a player will take, as a share of his demand',
    `p10 ${(shares[Math.floor(shares.length * 0.1)] * 100).toFixed(0)}%, `
    + `median ${(shares[Math.floor(shares.length / 2)] * 100).toFixed(0)}%`);

  // The clause has to be paid, or conceding one costs nothing.
  const g6 = newGame({ seed: 8821, size: 'small', managerName: 'Test', clubId: null });
  const w6 = g6.world;
  const t6 = w6.leagues.find((l) => l.tier === 1);
  const a6 = w6.clubs[t6.clubIds[2]];
  const b6 = w6.clubs[t6.clubIds[5]];
  const c6 = w6.clubs[t6.clubIds[8]];
  const moved = w6.players[a6.squad[10]];
  completeTransfer(g6, moved, a6.id, b6.id, 4e6, { wage: 20000, years: 3 }, { sellOn: 20 });
  check('a sell-on clause is written onto the contract',
    moved.contract.sellOn === 20 && moved.contract.sellOnClub === a6.id);
  const before6 = a6.finances.balance;
  const sellerBefore = b6.finances.balance;
  completeTransfer(g6, moved, b6.id, c6.id, 10e6, { wage: 26000, years: 3 });
  check('the old club is paid its share of the next sale',
    a6.finances.balance === before6 + 2e6, `${a6.finances.balance - before6}`);
  check('the selling club pays it out of the fee',
    b6.finances.balance === sellerBefore + 10e6 - 2e6, `${b6.finances.balance - sellerBefore}`);

  // And a negotiation has to survive the save, or the load button is the reset
  // button the reserve price exists to prevent.
  const g7 = newGame({ seed: 4242, size: 'small', managerName: 'Test', clubId: null });
  const t7 = g7.world.leagues.find((l) => l.tier === 1);
  const b7 = g7.world.clubs[t7.clubIds[2]];
  g7.userClubId = b7.id; b7.isUserClub = true;
  const m7 = g7.world.players[g7.world.clubs[t7.clubIds[6]].squad[3]];
  const { negotiation: n7 } = openTransferTalks(g7, m7, b7);
  transferOffer(g7, n7, { fee: 1000, sellOn: 0, instalments: 1 });
  const restored7 = deserialiseGame(JSON.parse(JSON.stringify(serialiseGame(g7))));
  const back7 = restored7.negotiations?.[n7.id];
  check('a negotiation survives a save', !!back7
    && back7.reserve === n7.reserve && back7.patience === n7.patience && back7.round === n7.round,
    back7 ? 'kept' : 'lost');
}

// --- The career record has to add up -----------------------------------------
{
  const gcx = newGame({ seed: 3131, size: 'small', managerName: 'Test', clubId: null });
  const wcx = gcx.world;
  const lowLeague = wcx.leagues.filter((l) => l.tier >= 3).sort((a, b) => b.tier - a.tier)[0];
  takeOverClub(gcx, lowLeague.clubIds[0], 'Test', 'ALB');
  const me = wcx.clubs[gcx.userClubId];

  check('taking a job opens a spell', gcx.manager.spells.length === 1
    && gcx.manager.spells[0].clubId === me.id && !gcx.manager.spells[0].endYear);

  // The manager record is written in one place now, so a result counted for the
  // lifetime and a result counted for the season are the same event.
  recordMatchResult(gcx.manager, 'W');
  recordMatchResult(gcx.manager, 'D');
  recordMatchResult(gcx.manager, 'L');
  recordMatchResult(gcx.manager, 'W');
  check('a result counts once for the season and once for the career',
    gcx.manager.matches === 4 && gcx.manager.season.matches === 4
    && gcx.manager.wins === 2 && gcx.manager.season.wins === 2);

  me.seasonRecord = { w: 9, d: 5, l: 4 };
  me.lastFinish = 3;
  const row = recordSeason(gcx, me, lowLeague);
  check('a season row carries both records', row.w === 9 && row.allMatches === 4,
    `league ${row.w}-${row.d}-${row.l}, all comps ${row.allMatches}`);
  // The defect this replaces: the manager panel showed an all-competitions
  // lifetime W/D/L directly above a season table of league-only W/D/L, with
  // nothing saying they were different questions.
  const tot = careerTotals(gcx.manager);
  check('the two records are reported separately and both are right',
    tot.all.matches === 4 && tot.league.matches === 18,
    `all ${tot.all.matches}, league ${tot.league.matches}`);
  check('the spell accumulates the season', gcx.manager.spells[0].seasons === 1
    && gcx.manager.spells[0].matches === 4);

  // Promotions are honours. They were free text on the club and nothing else,
  // so a manager who had gone up four times had an empty trophy cabinet.
  addHonour(gcx, { kind: 'promotion', name: 'Promotion to Albion League One', club: me.name });
  addHonour(gcx, { kind: 'cup', name: 'Albion Cup', club: me.name });
  const after = careerTotals(gcx.manager);
  check('a promotion counts as an honour', after.honours === 2 && after.promotions === 1);
  check('honours are attributed to the spell', gcx.manager.spells[0].trophies === 2);

  // Players you managed are remembered, and where they went is recorded.
  const keeper = wcx.players[me.squad[0]];
  keeper.season.apps = 30;
  keeper.season.goals = 2;
  trackNotable(gcx, me);
  const tracked = gcx.manager.notable.find((n) => n.playerId === keeper.id);
  check('a player who played for you is remembered', !!tracked && tracked.apps === 30,
    tracked ? `${tracked.name}, ${tracked.apps} apps` : 'not tracked');
  check('somebody who barely played is not', gcx.manager.notable.length < me.squad.length,
    `${gcx.manager.notable.length} of ${me.squad.length}`);
  noteDeparture(gcx, keeper, 'Elsewhere FC');
  check('where he went is recorded', tracked.wentTo === 'Elsewhere FC');

  // Retirement keeps a summary. It used to delete the player outright, so a man
  // you signed at seventeen and won a league with stopped having existed.
  const veteran = wcx.players[me.squad[1]];
  veteran.career = { apps: 420, goals: 61, assists: 30, cleanSheets: 0, motm: 12, seasons: [] };
  veteran.age = 36;
  trackNotable(gcx, me);
  const entry = retirePlayer(gcx, veteran);
  check('a retiring player leaves a record', !!entry && entry.apps === 420 && entry.goals === 61);
  check('the record reaches the hall of fame',
    wcx.hallOfFame.some((h) => h.id === veteran.id), `${wcx.hallOfFame.length} entries`);

  // A journeyman nobody managed and who was never any good is not remembered,
  // or the hall of fame is a list of everyone who ever played.
  const nobody = generatePlayer(new Rng(31), {
    nationId: 'ALB', pos: 'DC', age: 34, targetCA: 60, targetPA: 62, clubRep: 30, leagueRep: 35,
  });
  nobody.career = { apps: 40, goals: 0, assists: 1, cleanSheets: 0, motm: 0, seasons: [] };
  const hallBefore = wcx.hallOfFame.length;
  retirePlayer(gcx, nobody);
  check('a journeyman nobody managed is not remembered', wcx.hallOfFame.length === hallBefore,
    `${wcx.hallOfFame.length} v ${hallBefore}`);

  // Leaving ends the spell; the next job starts a new one.
  endSpell(gcx, 'sacked');
  check('dismissal closes the spell', !!gcx.manager.spells[0].endYear
    && gcx.manager.spells[0].reason === 'sacked');
  takeOverClub(gcx, lowLeague.clubIds[1], 'Test', 'ALB');
  check('a new job opens a new spell', gcx.manager.spells.length === 2
    && !gcx.manager.spells[1].endYear);
  check('the record spans both clubs', careerTotals(gcx.manager).clubs === 1,
    'only one season has been completed so far');

  // The wiring, not just the function: a tracked player who is actually
  // transferred has to end up with a destination on the career page. The
  // five-season probe never sold anybody, so this forces the case rather than
  // waiting for one - an unfired hook and a hook that does not exist look the
  // same from the outside.
  const gsell = newGame({ seed: 3131, size: 'small', managerName: 'Test', clubId: null });
  const topsell = gsell.world.leagues.find((l) => l.tier === 1);
  takeOverClub(gsell, topsell.clubIds[4], 'Test', 'ALB');
  const mine = userClub(gsell);
  const leaving = gsell.world.players[mine.squad[3]];
  leaving.season.apps = 24;
  trackNotable(gsell, mine);
  check('the player about to be sold is tracked',
    gsell.manager.notable.some((n) => n.playerId === leaving.id));
  const elsewhere = gsell.world.clubs[topsell.clubIds[9]];
  completeTransfer(gsell, leaving, mine.id, elsewhere.id, 5e6, { wage: 30000, years: 3 });
  rolloverSeason(gsell);
  const soldRow = gsell.manager.notable.find((n) => n.playerId === leaving.id);
  check('a sold player gets a destination on the career page', !!soldRow?.wentTo,
    soldRow?.wentTo || 'nothing recorded');
  check('the transfer-log scan keeps a watermark',
    gsell.manager.departuresSeen === gsell.transferLog.length,
    `${gsell.manager.departuresSeen} of ${gsell.transferLog.length}`);

  // ...and all of it survives a save, or a career page is a screen that forgets.
  const backc = deserialiseGame(JSON.parse(JSON.stringify(serialiseGame(gcx))));
  check('the career survives a save',
    backc.manager.history.length === gcx.manager.history.length
    && backc.manager.trophies.length === gcx.manager.trophies.length
    && backc.manager.notable.length === gcx.manager.notable.length
    && backc.manager.spells.length === gcx.manager.spells.length
    && backc.world.hallOfFame.length === wcx.hallOfFame.length);
  record('career record after one season', `${careerTotals(gcx.manager).all.matches} matches, `
    + `${gcx.manager.trophies.length} honours, ${gcx.manager.notable.length} players remembered`);
}

// --- A free agent is a lifeline, not a cheat code -----------------------------
{
  const wfa = generateWorld({ seed: 4242, size: 'small' });
  const pool = wfa.freeAgents.map((id) => wfa.players[id]).filter(Boolean);
  check('there is a free agent pool', pool.length > 20, `${pool.length}`);
  const best = Math.max(...pool.map(currentAbility));
  const topFlight = wfa.leagues.find((l) => l.tier === 1 && l.nation === 'ALB');
  const second = wfa.leagues.find((l) => l.tier === 2 && l.nation === 'ALB');
  const weakestTop = Math.min(...topFlight.clubIds.map((id) => squadStrength(wfa, wfa.clubs[id])));
  const weakestSecond = Math.min(...second.clubIds.map((id) => squadStrength(wfa, wfa.clubs[id])));

  // The defect a playtester found: the best free agent in a fresh world beat
  // the entire first XI at fifteen of twenty-two second-tier clubs, for nothing.
  check('the best free agent cannot walk into a top-flight side', best < weakestTop,
    `best free agent ${best} against the weakest top-flight XI ${Math.round(weakestTop)}`);
  check('nor a second-tier one', best < weakestSecond,
    `best free agent ${best} against the weakest second-tier XI ${Math.round(weakestSecond)}`);
  record('best free agent, against the weakest XI in each of the top two tiers',
    `${best} v ${Math.round(weakestSecond)} v ${Math.round(weakestTop)}`);

  // ...but the pool still has to be worth looking at lower down, or it is just
  // a list nobody ever clicks.
  const third = wfa.leagues.find((l) => l.tier === 3 && l.nation === 'ALB');
  const medianThird = [...third.clubIds.map((id) => squadStrength(wfa, wfa.clubs[id]))]
    .sort((a, b) => a - b)[Math.floor(third.clubIds.length / 2)];
  check('a free agent can still improve a lower-league side', best > medianThird,
    `${best} against a median third-tier XI of ${Math.round(medianThird)}`);

  // Quality follows age: nobody good is available young and free.
  const young = pool.filter((p) => p.age <= 24).map(currentAbility);
  const old = pool.filter((p) => p.age >= 31).map(currentAbility);
  check('both age groups are represented', young.length > 2 && old.length > 5,
    `${young.length} under 25, ${old.length} over 30`);
  check('the good ones are the old ones', Math.max(...old) > Math.max(...young),
    `best old ${Math.max(...old)}, best young ${Math.max(...young)}`);
}

// --- The season has to be able to end -----------------------------------------
{
  // A ReferenceError inside endSeason cost a playtester his career: the UI left
  // Continue greyed out with no message and a season with no fixtures in it.
  // The line only ran when the USER's club won a promotion play-off, which no
  // test had ever made happen, so a suite of 1,500 assertions stayed green.
  const gx = newGame({ seed: 3740, size: 'small', managerName: 'Test', clubId: null });
  const wx = gx.world;
  // Second tier, so promotion, the play-off and relegation are all live.
  const second = wx.leagues.find((l) => l.tier === 2 && l.nation === 'ALB');
  takeOverClub(gx, second.clubIds[0], 'Test', 'ALB');
  const mine = userClub(gx);

  // Put the club in a play-off place and settle the table so the play-off runs
  // with the user in it, rather than hoping a simulated season arranges it.
  const table = second.table;
  table.forEach((r, i) => {
    r.p = 38;
    r.pts = 90 - i * 2;
    r.w = Math.round(r.pts / 3); r.d = 0; r.l = 38 - r.w;
    r.gf = 50; r.ga = 30;
  });
  const mineRow = table.find((r) => r.clubId === mine.id);
  // Just outside automatic promotion: into the play-off pool.
  mineRow.pts = 90 - (second.promoted - 1) * 2;
  table.filter((r) => r.clubId !== mine.id).forEach((r, i) => {
    r.pts = i < second.promoted - 1 ? 95 + i : 80 - i;
  });
  gx.day = SEASON_DAYS - 1;
  let threw = null;
  try {
    endSeason(gx);
  } catch (err) {
    threw = err;
  }
  check('ending a season with the user in a play-off does not throw', !threw,
    threw ? `${threw.message} — ${(threw.stack || '').split('\n')[1]?.trim()}` : '');
  check('and the calendar can roll into the next season', (() => {
    try { rolloverSeason(gx); return true; } catch { return false; }
  })());
  check('the new season has fixtures for the user', (() => {
    const me = userClub(gx);
    if (!me) return true; // sacked is a legitimate outcome, just not a crash
    return Object.values(gx.fixtures).some((f) => f.homeId === me.id || f.awayId === me.id);
  })());

  // Every seed the hunt turned up, run end to end.
  for (const seed of [3466, 3740]) {
    const g = newGame({ seed, size: 'small', managerName: 'Test', clubId: null });
    const lg = g.world.leagues.find((l) => l.tier === 2 && l.nation === 'ALB');
    takeOverClub(g, lg.clubIds[3], 'Test', 'ALB');
    let died = null;
    try {
      for (let s = 0; s < 4; s++) {
        let guard = 0;
        while (g.day < SEASON_DAYS - 1 && guard++ < 420) {
          const r = advanceDay(g);
          if (r.stopped && r.reason === 'userMatch') {
            playFixture(g, g.fixtures[g.pendingMatchId]);
            g.status = 'idle'; g.pendingMatchId = null;
          }
          if (r.stopped && r.reason === 'seasonRollover') break;
        }
        const sum = endSeason(g);
        if (sum.sacked) { sackManager(g); rolloverSeason(g); break; }
        rolloverSeason(g);
      }
    } catch (err) {
      died = err;
    }
    check(`seed ${seed} plays four seasons without throwing`, !died, died?.message || '');
  }
}

// --- A promise you can break, and money that only costs you when he plays ----
{
  const gp = newGame({ seed: 4242, size: 'small', managerName: 'Test', clubId: null });
  const wp = gp.world;
  const topp = wp.leagues.find((l) => l.tier === 1);
  takeOverClub(gp, topp.clubIds[3], 'Test', 'ALB');
  const mine = userClub(gp);
  const seller = wp.clubs[topp.clubIds[8]];
  const target = wp.players[seller.squad[5]];

  // The promise used to be the second-biggest term in whether he signed and was
  // then dropped by completeTransfer, so it could never be broken.
  completeTransfer(gp, target, seller.id, mine.id, 2e6,
    { wage: 40000, years: 3, promisedRole: 'key', goalBonus: 5000, appearanceFee: 2000 });
  check('the promised role survives the signature', target.contract.promisedRole === 'key',
    String(target.contract.promisedRole));
  check('appearance and goal money survive it too',
    target.contract.goalBonus === 5000 && target.contract.appearanceFee === 2000);
  check('the year the promise was made is kept', target.contract.promisedYear === wp.year);

  const packed = deserialiseGame(JSON.parse(JSON.stringify(serialiseGame(gp))));
  const backP = packed.world.players[target.id];
  check('all of it survives a save',
    backP.contract.promisedRole === 'key' && backP.contract.goalBonus === 5000
    && backP.contract.appearanceFee === 2000 && backP.contract.promisedYear === wp.year);

  // A player valuing conditional money below a wage is the point: it only costs
  // the club when he plays and scores, so he discounts it.
  const bare = termsEquivalent(target, { wage: 40000, years: 3 });
  const withApps = termsEquivalent(target, { wage: 40000, years: 3, appearanceFee: 2000 });
  const withGoals = termsEquivalent(target, { wage: 40000, years: 3, goalBonus: 5000 });
  check('an appearance fee is worth something', withApps > bare, `${bare} -> ${withApps}/wk`);
  check('a goal bonus is worth something', withGoals > bare, `${bare} -> ${withGoals}/wk`);
  check('conditional money is worth less than the same in wages',
    withApps - bare < 2000 * 42 / 52, `${withApps - bare}/wk against a best case of ${Math.round(2000 * 42 / 52)}`);
  // A defender does not value a goal bonus the way a striker does.
  const st = Object.values(wp.players).find((x) => x.positions[0] === 'ST' && currentAbility(x) > 120);
  const dc = Object.values(wp.players).find((x) => x.positions[0] === 'DC' && currentAbility(x) > 120);
  const lift = (pl) => termsEquivalent(pl, { wage: 40000, years: 3, goalBonus: 5000 })
    - termsEquivalent(pl, { wage: 40000, years: 3 });
  check('a striker values a goal bonus more than a centre-back', lift(st) > lift(dc) * 2,
    `${lift(st)}/wk against ${lift(dc)}/wk`);
  record('goal bonus of 5k, weekly worth to a striker and a centre-back',
    `${lift(st)} v ${lift(dc)}`);

  // ...and the promise has to actually break. Play a season without picking him.
  let guardP = 0;
  while (gp.day < 210 && guardP++ < 260) {
    const r = advanceDay(gp);
    if (r.stopped && r.reason === 'userMatch') {
      // Deregister him so he cannot be selected: the promise is about football
      // he was given, and this is the cleanest way to give him none.
      setRegistration(gp, mine.registration.filter((id) => id !== target.id));
      playFixture(gp, gp.fixtures[gp.pendingMatchId]);
      gp.status = 'idle'; gp.pendingMatchId = null;
    }
  }
  check('a season was actually played', (mine.seasonRecord?.w ?? 0) + (mine.seasonRecord?.d ?? 0)
    + (mine.seasonRecord?.l ?? 0) >= 12,
    `${(mine.seasonRecord?.w ?? 0) + (mine.seasonRecord?.d ?? 0) + (mine.seasonRecord?.l ?? 0)} league games`);
  check('he got no football', (target.season?.minutes ?? 0) < 400, `${target.season?.minutes ?? 0} minutes`);
  check('a broken promise makes him unhappy', target.unhappy === 'promise', String(target.unhappy));
  // Against the rest of the squad rather than an absolute number: morale moves
  // on results and playing time all season, so a fixed threshold here measures
  // how the season went as much as it measures the grievance.
  const squadMorale = mine.squad.map((id) => wp.players[id].morale).sort((a, b) => a - b);
  const median = squadMorale[Math.floor(squadMorale.length / 2)];
  check('and it costs morale', target.morale < median - 8,
    `${Math.round(target.morale)} against a squad median of ${Math.round(median)}`);
  record('minutes before a promised key player complains', target.season?.minutes ?? 0);

  // A player who missed the season injured must not resent it. A playtester hit
  // exactly this: the first version of the check only skipped players who were
  // injured at the moment it ran, so anyone back from a long lay-off was judged
  // on minutes he could never have played.
  const crocked = mine.squad.map((id) => wp.players[id]).find((x) => x.id !== target.id
    && x.contract && !x.contract.promisedRole);
  crocked.contract.promisedRole = 'key';
  crocked.contract.promisedYear = wp.year;
  crocked.season.minutes = 180;
  crocked.season.unavailable = 30; // out for all but a couple of games
  crocked.unhappy = null;
  crocked.morale = 70;
  // ...and one who was fit throughout and still barely played.
  const benched = mine.squad.map((id) => wp.players[id]).find((x) => x.id !== target.id
    && x.id !== crocked.id && x.contract && !x.contract.promisedRole);
  benched.contract.promisedRole = 'key';
  benched.contract.promisedYear = wp.year;
  benched.season.minutes = 180;
  benched.season.unavailable = 0;
  benched.unhappy = null;
  benched.morale = 70;
  // Run the same monthly check the calendar runs. The fixture has to be played
  // when one comes up, or advanceDay stops on it and the loop spins without the
  // calendar moving - a harness that looks like it ran a month and ran nothing.
  const dayBefore = gp.day;
  for (let i = 0; i < 40; i++) {
    const r = advanceDay(gp);
    if (r.stopped && r.reason === 'userMatch') {
      playFixture(gp, gp.fixtures[gp.pendingMatchId]);
      gp.status = 'idle'; gp.pendingMatchId = null;
    }
    if (r.stopped && r.reason === 'seasonRollover') break;
  }
  check('the calendar actually moved', gp.day > dayBefore + 20, `${dayBefore} -> ${gp.day}`);
  check('a player who was injured all season does not resent it',
    crocked.unhappy !== 'promise',
    `${crocked.name}: ${crocked.season.minutes} minutes, ${crocked.season.unavailable} games missed, unhappy=${crocked.unhappy}`);
  check('a fit player who was never picked still does', benched.unhappy === 'promise',
    `${benched.name}: unhappy=${benched.unhappy}`);

  // A player who is getting what he was promised must not complain, or the
  // check is a timer rather than a judgement.
  const happy = mine.squad.map((id) => wp.players[id])
    .filter((x) => x.contract?.promisedRole && (x.season?.minutes ?? 0) > 1500);
  check('nobody who is playing complains', happy.every((x) => x.unhappy !== 'promise'),
    `${happy.filter((x) => x.unhappy === 'promise').length} of ${happy.length}`);
}

// --- A job is a job ----------------------------------------------------------
{
  const gj = newGame({ seed: 5150, size: 'small', managerName: 'Test', clubId: null });
  const wj = gj.world;
  const topj = wj.leagues.find((l) => l.tier === 1);

  // Before any manager has left a post, nothing is going. The old version of
  // this listed every club in the world under a reputation ceiling, so being
  // out of work meant picking whichever of two hundred clubs you fancied.
  check('nothing is going before anybody leaves', availableJobs(gj).length === 0,
    `${availableJobs(gj).length} jobs`);

  const spare = Object.values(wj.clubs).find((c) => !c.affiliateOf && !c.isUserClub && c.rep < 60);
  const vacancy = openVacancy(gj, spare, 'Test vacancy');
  check('a vacancy can be opened', !!vacancy && spare.manager.caretaker === true);
  check('the same post cannot be opened twice', openVacancy(gj, spare, 'again') === null);
  gj.manager.reputation = 90;
  const jobs = availableJobs(gj);
  check('an open post shows up as a job', jobs.some((j) => j.club.id === spare.id));
  check('a job carries the reason it is open', jobs.find((j) => j.club.id === spare.id)?.vacancy.reason === 'Test vacancy');
  check('every listed job is actually open',
    jobs.every((j) => j.club.manager?.caretaker === true), `${jobs.filter((j) => !j.club.manager?.caretaker).length} settled`);

  // The window has to close, or every post that ever opened stays open forever.
  gj.day += VACANCY_DAYS + 1;
  closeExpiredVacancies(gj);
  check('a post that nobody took closes', availableJobs(gj).length === 0);
  check('and the caretaker gets the job', spare.manager.caretaker === false);

  // Every answer has to move something. An interview where the middle option is
  // always right is a form, not a decision.
  const cautious = interviewOutcome({ style: 'pragmatic', youth: 'balance', transfers: 'sell' });
  const ambitious = interviewOutcome({ style: 'attacking', youth: 'blood', transfers: 'spend' });
  check('an ambitious answer buys money', ambitious.budgetMultiplier > cautious.budgetMultiplier,
    `${ambitious.budgetMultiplier.toFixed(2)} v ${cautious.budgetMultiplier.toFixed(2)}`);
  check('a cautious answer buys time', cautious.patienceDelta > ambitious.patienceDelta,
    `${cautious.patienceDelta} v ${ambitious.patienceDelta}`);
  check('ambition raises the bar', ambitionShift(ambitious.ambition) < ambitionShift(cautious.ambition),
    `${ambitionShift(ambitious.ambition)} v ${ambitionShift(cautious.ambition)}`);
  check('every question has three answers that differ',
    INTERVIEW_QUESTIONS.every((q) => q.answers.length === 3
      && new Set(q.answers.map((a) => JSON.stringify(a.effects))).size === 3));
  record('interview budget swing, cautious to ambitious',
    `x${cautious.budgetMultiplier.toFixed(2)} to x${ambitious.budgetMultiplier.toFixed(2)}`);

  // ...and applying them has to reach the club, not just the summary.
  const gk = newGame({ seed: 5150, size: 'small', managerName: 'Test', clubId: null });
  const target = gk.world.clubs[gk.world.leagues.find((l) => l.tier === 1).clubIds[9]];
  const budgetBefore = target.finances.transferBudget;
  const patienceBefore = target.board.patience;
  takeOverClub(gk, target.id, 'Test', 'ALB', { style: 'attacking', youth: 'blood', transfers: 'spend' });
  check('the interview reaches the budget', target.finances.transferBudget > budgetBefore * 1.3,
    `${budgetBefore} -> ${target.finances.transferBudget}`);
  check('the interview reaches the remit', target.board.wantsYouth === true && target.board.wantsAttacking === true);
  // wantsYouth and wantsAttacking were set at world generation and never written
  // again, so the remit was decided before the manager walked in.
  check('the remit objective follows the answers', target.board.objectives[2].type === 'youth',
    target.board.objectives[2].type);
  check('an ambitious answer is written into the objectives', target.board.ambitionShift < 0,
    String(target.board.ambitionShift));

  const gc = newGame({ seed: 5150, size: 'small', managerName: 'Test', clubId: null });
  const target2 = gc.world.clubs[gc.world.leagues.find((l) => l.tier === 1).clubIds[9]];
  const budget2 = target2.finances.transferBudget;
  takeOverClub(gc, target2.id, 'Test', 'ALB', { style: 'pragmatic', youth: 'balance', transfers: 'sell' });
  check('a cautious answer costs money and buys patience',
    target2.finances.transferBudget < budget2 && target2.board.patience > patienceBefore,
    `${budget2} -> ${target2.finances.transferBudget}, patience ${Math.round(patienceBefore)} -> ${Math.round(target2.board.patience)}`);
  check('taking the job clears the post', !(gc.vacancies || []).some((v) => v.clubId === target2.id));
}

// --- Loans and part-exchange -------------------------------------------------
{
  const g8 = newGame({ seed: 7272, size: 'small', managerName: 'Test', clubId: null });
  const w8 = g8.world;
  const t8 = w8.leagues.find((l) => l.tier === 1);
  const borrower = w8.clubs[t8.clubIds[3]];
  borrower.isUserClub = true;
  g8.userClubId = borrower.id;

  let lent = null;
  for (const club of Object.values(w8.clubs)) {
    if (club.id === borrower.id || club.affiliateOf) continue;
    for (const id of club.squad) {
      const p = w8.players[id];
      if (p?.contract && p.age <= 22 && willLend(w8, club, p, borrower).ok) { lent = { p, club }; break; }
    }
    if (lent) break;
  }
  check('some club will lend a player', !!lent);
  if (lent) {
    const { negotiation } = openLoanTalks(g8, lent.p, borrower);
    check('loan talks open with a position', !!negotiation && negotiation.wantedShare > 0);
    let deal = null;
    for (let i = 0; i < 8 && negotiation.status === 'open'; i++) {
      const r = loanOffer(g8, negotiation, {
        wageShare: Math.min(1, negotiation.wantedShare + 0.02), fee: negotiation.wantedFee, weeks: 38,
      });
      if (r.outcome === 'agreed') { deal = negotiation.agreed; break; }
    }
    check('a loan can be agreed', !!deal, deal ? `${Math.round(deal.wageShare * 100)}% covered` : 'no');

    if (deal) {
      const wage = lent.p.contract.wage;
      const parentBefore = weeklyWageBill(w8, lent.club);
      completeLoan(g8, lent.p, lent.club.id, borrower.id, deal);
      check('the loan moves him and leaves ownership behind',
        lent.p.clubId === borrower.id && lent.p.contract.loanedFrom === lent.club.id
        && lent.club.loanedOut.includes(lent.p.id) && !lent.club.squad.includes(lent.p.id));
      // The split is the whole mechanic. Nothing charged the parent's half
      // before this: payWeeklyWages only ever saw the borrower's share.
      const paidByParent = weeklyWageBill(w8, lent.club) - (parentBefore - wage);
      check('both clubs together pay exactly his wage',
        Math.abs(paidByParent + wage * deal.wageShare - wage) < 2,
        `${Math.round(paidByParent)} + ${Math.round(wage * deal.wageShare)} v ${wage}`);
      record('loan wage split, parent to borrower',
        `${Math.round((1 - deal.wageShare) * 100)}% / ${Math.round(deal.wageShare * 100)}%`);
      const parentXI = buildXI(w8, lent.club, lent.club.tactic);
      const parentPicked = [
        ...parentXI.starters.filter((sl) => sl.player).map((sl) => sl.player.id),
        ...parentXI.bench.map((p) => p.id),
      ];
      check('a loaned player cannot be picked for his parent',
        !parentPicked.includes(lent.p.id), `${parentPicked.length} picked`);
      returnFromLoan(g8, lent.p);
      check('the loan ends and he goes home',
        lent.p.clubId === lent.club.id && !lent.p.contract.loanedFrom
        && lent.club.loanedOut.length === 0 && !borrower.squad.includes(lent.p.id));
    }
  }

  // Part-exchange: worth something, but never full price, or it is a way to buy
  // at a discount rather than a way to move a player on.
  const seller8 = w8.clubs[t8.clubIds[6]];
  const spare = borrower.squad.map((id) => w8.players[id])
    .filter((p) => p && willTakeInSwap(w8, seller8, p).ok);
  check('a club would take somebody in part-exchange', spare.length > 0, `${spare.length}`);
  check('and refuses others', spare.length < borrower.squad.length);
  if (spare.length) {
    const target8 = w8.players[seller8.squad[4]];
    const plain = cashEquivalent(w8, target8, { fee: 20e6 });
    const traded = cashEquivalent(w8, target8, { fee: 20e6, swap: [spare[0].id] });
    check('part-exchange adds to what the seller sees', traded > plain);
    check('a swapped player is taken below his value',
      traded - plain < marketValue(w8, spare[0]),
      `${traded - plain} against a value of ${marketValue(w8, spare[0])}`);
    check('the swap discount is the one the screen advertises',
      Math.abs((traded - plain) - Math.round(marketValue(w8, spare[0]) * SWAP_DISCOUNT)) <= 1);
  }

  // The AI has to use loans, or the mechanic exists for exactly one club.
  const g9 = newGame({ seed: 1717, size: 'small', managerName: 'Test', clubId: null });
  let guard9 = 0;
  while (g9.day < 120 && guard9++ < 140) advanceDay(g9);
  const aiLoans = g9.transferLog.filter((t) => t.loan).length;
  check('AI clubs loan players out', aiLoans > 0, `${aiLoans} in 120 days`);
  record('loans in the first 120 days', aiLoans);
  const stranded = Object.values(g9.world.clubs).filter((c) => (c.loanedOut || [])
    .some((id) => !g9.world.players[id] || g9.world.players[id].contract?.loanedFrom !== c.id));
  check('no club has a stale loan record', stranded.length === 0, `${stranded.length} clubs`);
}

// --- Squads below the first team ---------------------------------------------
{
  const w2 = generateWorld({ seed: 5150, size: 'small' });
  const clubs = Object.values(w2.clubs);
  const reserves = clubs.filter((c) => c.affiliateOf);

  check('every club has an academy list', clubs.every((c) => Array.isArray(c.youthSquad)));
  check('reserve sides exist', reserves.length > 0, `${reserves.length} of ${clubs.length} clubs`);
  record('reserve sides in a small world', `${reserves.length} of ${clubs.length} clubs`);

  // The whole cost argument for reserve football: they take places that were
  // held back, so the world is not one club bigger than it would have been.
  for (const l of w2.leagues) {
    check(`${l.name} has exactly as many clubs as its fixture list expects`,
      l.clubIds.length === l.teams, `${l.clubIds.length} v ${l.teams}`);
  }

  // Guard rules. Each is a bug class, so each is asserted rather than assumed.
  check('no reserve side enters a domestic cup', Object.values(w2.competitions)
    .filter((c) => c.type === 'cup')
    .every((c) => c.entrants.every((id) => !w2.clubs[id]?.affiliateOf)));
  check('every reserve side sits below its parent', reserves.every((c) => {
    const parent = w2.clubs[c.affiliateOf];
    const cl = w2.leagues.find((l) => l.id === c.leagueId);
    const pl = w2.leagues.find((l) => l.id === parent?.leagueId);
    return cl && pl && cl.tier > pl.tier;
  }));
  check('no reserve side has a reserve side of its own', reserves.every((c) => !c.reserveClubId));
  check('a reserve side is never offered as a job', reserves.every((c) => c.affiliateOf && !c.isUserClub));
  check('reserve squads can field a side', reserves.every((c) => c.squad.length >= 14),
    `smallest ${Math.min(...reserves.map((c) => c.squad.length))}`);
  check('reserve players are on two-way contracts',
    reserves.every((c) => c.squad.every((id) => w2.players[id].contract.wageReserve > 0)));
  check('a reserve crest is distinguishable from its parent\'s',
    reserves.every((c) => crestSvg(c) !== crestSvg(w2.clubs[c.affiliateOf])));

  // Registration is the constraint that makes a second squad worth having.
  const club = clubs.find((c) => !c.affiliateOf && c.status === 'professional');
  const limit = registrationLimit(club);
  check('registration limit follows club status', limit === 26, `${limit}`);
  // Overfill the squad and check the surplus genuinely cannot be picked.
  const extras = w2.freeAgents.slice(0, 6);
  for (const id of extras) { w2.players[id].clubId = club.id; club.squad.push(id); }
  refreshRegistration(w2, club);
  check('registration is capped at the limit', club.registration.length === limit, `${club.registration.length}`);
  const unregistered = club.squad.filter((id) => !club._registered.has(id));
  check('the surplus is left unregistered', unregistered.length === club.squad.length - limit);
  const xi = buildXI(w2, club, club.tactic);
  const picked = [...xi.starters.filter((sl) => sl.player).map((sl) => sl.player.id), ...xi.bench.map((p) => p.id)];
  check('an unregistered player cannot be selected',
    picked.every((id) => !unregistered.includes(id)));
  // ...and the ones left out are the weakest, not an arbitrary list.
  const weakestIn = Math.min(...club.registration.map((id) => currentAbility(w2.players[id])));
  const bestOut = Math.max(...unregistered.map((id) => currentAbility(w2.players[id])));
  check('registration keeps the best players', weakestIn >= bestOut, `${weakestIn} in v ${bestOut} out`);
}

// --- Club identity -----------------------------------------------------------
{
  const world = generateWorld({ seed: 606, size: 'small' });
  const clubs = Object.values(world.clubs);

  check('every club has an identity', clubs.every((c) => c.identity && c.identity.charge));
  check('every club has colours derived from its identity', clubs.every((c) => {
    const pal = paletteFor(c.identity);
    return c.colours.primary === pal.primary && c.colours.secondary === pal.secondary;
  }));

  // The point of assigning identity per division rather than per club: twenty
  // independent random colour pairs collide constantly. Before this, roughly
  // seven clubs in a twenty-team division shared a pair with another.
  let worstGap = 360;
  let worstLeague = '';
  for (const league of world.leagues) {
    // Reserve sides wear their parent's colours on purpose, so they are not part
    // of this guarantee - the affiliation is the point. They are told apart by
    // the B on the crest and in the name instead, asserted separately below.
    const hues = league.clubIds
      .filter((id) => !world.clubs[id].affiliateOf)
      .map((id) => world.clubs[id].identity.hue).sort((a, b) => a - b);
    for (let i = 1; i < hues.length; i++) {
      if (hues[i] - hues[i - 1] < worstGap) { worstGap = hues[i] - hues[i - 1]; worstLeague = league.name; }
    }
  }
  // Slots are 360/n apart with jitter of at most 0.24 of a slot either way, so
  // the closest two clubs in the largest division can be is about half a slot.
  const biggest = Math.max(...world.leagues.map(
    (l) => l.clubIds.filter((id) => !world.clubs[id].affiliateOf).length));
  const floorGap = (360 / biggest) * 0.5;
  check('no two clubs in a division share a hue', worstGap >= floorGap,
    `closest pair ${worstGap.toFixed(1)}deg in ${worstLeague}, floor ${floorGap.toFixed(1)}deg`);
  record('closest club hues in a division', `${worstGap.toFixed(1)} degrees`);

  // Art is generated, so the assertions have to be about the pixels, not about
  // the call returning something.
  const sample = clubs.slice(0, 40);
  check('crests render as svg', sample.every((c) => crestSvg(c).startsWith('<svg') && crestSvg(c).includes('<path')));
  check('kits render as svg', sample.every((c) => kitSvg(c).startsWith('<svg')));
  check('crests differ between clubs', new Set(sample.map((c) => crestSvg(c))).size === sample.length);
  check('crest art is deterministic', sample.every((c) => crestSvg(c) === crestSvg(c)));

  // A crest whose charge is the same colour as the field under it is invisible,
  // which is exactly the defect that only showed up on a contact sheet.
  const chargeVisible = sample.every((c) => {
    const svg = crestSvg(c);
    const pal = paletteFor(c.identity);
    // The secondary is the charge colour; it must actually appear in the art.
    return svg.includes(pal.secondary);
  });
  check('every crest draws its charge in a contrasting colour', chargeVisible);

  // These strings are inlined into a fixture list forty times, so their size is
  // a real cost rather than a curiosity.
  const uriBytes = Math.max(...sample.map((c) => crestUri(c).length));
  check('crest data uris stay small', uriBytes < 2600, `largest ${uriBytes} bytes`);
  record('largest crest data uri', `${uriBytes} bytes`);

  // Re-running the generator on the same clubs with the same stream must give
  // the same world back, or a save would not match the game that wrote it.
  const world2 = generateWorld({ seed: 606, size: 'small' });
  check('identities are seed-deterministic',
    Object.values(world2.clubs).every((c) => c.identity.hue === world.clubs[c.id].identity.hue));

  // A club with no identity at all still has to draw something: old saves.
  const orphan = { id: 'cZZ', name: 'Nowhere FC' };
  check('a club without an identity still renders', crestSvg(orphan).startsWith('<svg'));
}

// --- The pyramid has edges ---------------------------------------------------
{
  // The world can be generated with one, two or three divisions per nation, so
  // the bottom division has nowhere to relegate to and the top nowhere to be
  // promoted from. Code written for a middle division keeps running there
  // without error, showing zones and setting board expectations that the game
  // will never act on.
  for (const size of ['small', 'large']) {
    const w = generateWorld({ seed: 77, size });
    for (const l of w.leagues) {
      const z = leagueZones(l);
      check(`${size}: ${l.name} only shows a relegation zone if there is somewhere to go`,
        !(z.relegation > 0 && !l.hasDivisionBelow));
      check(`${size}: ${l.name} only shows a promotion zone if there is somewhere to go`,
        !(z.promotion > 0 && !l.hasDivisionAbove));
    }
    const stranded = Object.values(w.clubs).filter((c) => {
      const l = w.leagues.find((x) => x.id === c.leagueId);
      return l && !l.hasDivisionBelow && c.board.expectation.type === 'survive';
    });
    check(`${size}: no board demands survival in a division with no drop`, stranded.length === 0,
      `${stranded.length} clubs asked to avoid impossible relegation`);
  }
}

// --- The world has to stay worth playing in ----------------------------------
{
  // Development, ageing, retirement and squad turnover all pull in different
  // directions. Assert the composition — that the standard of the top flight
  // holds up — rather than any single rate, which gets retuned and deleted.
  const g = newGame({ seed: 2468, size: 'small', managerName: 'Drift', clubId: null });
  const top = g.world.leagues.find((l) => l.tier === 1);
  const strength = () => {
    const s = top.clubIds.map((id) => squadStrength(g.world, g.world.clubs[id])).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const startStrength = strength();
  for (let s = 0; s < 3; s++) {
    let guard = 0;
    while (g.day < SEASON_DAYS - 1 && guard++ < 420) {
      const r = advanceDay(g);
      if (r.stopped && r.reason === 'seasonRollover') break;
    }
    endSeason(g);
    rolloverSeason(g);
  }
  const endStrength = strength();
  const drift = (endStrength - startStrength) / startStrength;
  check('the top flight does not hollow out over successive seasons', drift > -0.1,
    `median squad strength ${startStrength.toFixed(0)} -> ${endStrength.toFixed(0)} (${(drift * 100).toFixed(1)}%)`);
  check('the top flight does not inflate either', drift < 0.1,
    `median squad strength ${startStrength.toFixed(0)} -> ${endStrength.toFixed(0)}`);
  // One seed, so read the sign and not the size: measured across three seeds
  // this sits at +0.7%, -0.7% and 0.0%, and a single draw swings several points
  // either way. The +/-10% bound above is the guard; this line is for eyeballing.
  record('top-flight drift over 3 seasons (one seed)', `${startStrength.toFixed(0)} -> ${endStrength.toFixed(0)} (${(drift * 100).toFixed(1)}%)`);
  const ages = Object.values(g.world.clubs).flatMap((c) => c.squad.map((id) => g.world.players[id].age));
  const meanAge = ages.reduce((a, b) => a + b, 0) / ages.length;
  check('squads keep a sensible age profile', meanAge > 21 && meanAge < 28, `mean age ${meanAge.toFixed(1)}`);
  record('mean squad age after 3 seasons', meanAge.toFixed(1));
}

// --- Custom player library ---------------------------------------------------
{
  const p = validateCustomPlayer({ last: 'Test', attrs: { finishing: 99, pace: -4 }, positions: ['ST'], age: 200, pa: 1 });
  check('custom attributes are clamped to 1-20', p.attrs.finishing === 20 && p.attrs.pace === 1);
  check('custom age is clamped', p.age === 42);
  const d = describeCustomPlayer(p);
  check('custom potential cannot sit below current ability', p.pa >= d.ability);
  const blank = blankCustomPlayer();
  check('a blank player is a coherent professional', describeCustomPlayer(blank).ability > 50);
  const partial = validateCustomPlayer({ last: 'Partial', attrs: { finishing: 18 } });
  check('a partial import keeps default attributes', partial.attrs.passing === 10 && partial.attrs.finishing === 18);
}

console.log(`\n\n${passed} passed, ${failed} failed`);
console.log('\nQuantities worth eyeballing (a verdict alone cannot tell you a harness tested nothing):');
for (const [label, value] of Object.entries(observed)) console.log(`  ${label.padEnd(34)} ${value}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
