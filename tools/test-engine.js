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
import { newGame, advanceDay, playFixture, endSeason, rolloverSeason, userClub } from '../src/state/game.js';
import { serialiseGame, deserialiseGame } from '../src/state/codec.js';
import { validateCustomPlayer, describeCustomPlayer, blankCustomPlayer } from '../src/state/library.js';
import { SEASON_DAYS } from '../src/core/calendar.js';
import { registrationLimit, refreshRegistration, buildLineup as buildXI } from '../src/engine/lineup.js';
import { crestSvg, kitSvg, crestUri, paletteFor, assignIdentities } from '../src/gen/identity.js';

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
  record('top-flight drift over 3 seasons', `${startStrength.toFixed(0)} -> ${endStrength.toFixed(0)} (${(drift * 100).toFixed(1)}%)`);
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
