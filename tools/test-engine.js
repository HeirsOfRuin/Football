// Smoke tests for the simulation. Run with `npm test`.
//
// These are assertions about behaviour that should hold in any build: the
// world generates coherently, the match engine produces football-shaped
// numbers, a season completes, and a save round-trips without losing data.

import { Rng } from '../src/core/rng.js';
import { generateWorld, squadStrength } from '../src/gen/worldgen.js';
import { generatePlayer } from '../src/gen/playergen.js';
import { abilityForPosition, currentAbility, ALL_ATTRS } from '../src/data/attributes.js';
import { simulateMatch } from '../src/engine/match.js';
import { autoPick, autoAssignSpecialists, buildLineup } from '../src/engine/lineup.js';
import { roundRobin, drawKnockoutRound, sortTable } from '../src/engine/season.js';
import { newGame, advanceDay, playFixture, endSeason, rolloverSeason, userClub } from '../src/state/game.js';
import { serialiseGame, deserialiseGame } from '../src/state/codec.js';
import { validateCustomPlayer, describeCustomPlayer, blankCustomPlayer } from '../src/state/library.js';
import { SEASON_DAYS } from '../src/core/calendar.js';

let passed = 0;
let failed = 0;
const failures = [];

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

// --- A full season -----------------------------------------------------------
{
  const game = newGame({ seed: 1717, size: 'small', managerName: 'Test', clubId: null });
  const league = game.world.leagues.find((l) => l.tier === 1);
  game.userClubId = league.clubIds[4];
  game.world.clubs[game.userClubId].isUserClub = true;

  let guard = 0;
  while (game.day < SEASON_DAYS - 1 && guard++ < 420) {
    const r = advanceDay(game);
    if (r.stopped && r.reason === 'userMatch') {
      playFixture(game, game.fixtures[game.pendingMatchId]);
      game.status = 'idle';
      game.pendingMatchId = null;
    }
    if (r.stopped && r.reason === 'seasonRollover') break;
  }
  const table = sortTable(league.table);
  check('every club played a full league season', table.every((r) => r.p === league.teams - 1 || r.p === (league.teams - 1) * 2),
    `played counts: ${[...new Set(table.map((r) => r.p))].join(',')}`);
  check('league points reconcile with results', table.every((r) => r.pts === r.w * 3 + r.d));
  check('wins, draws and losses sum to games played', table.every((r) => r.w + r.d + r.l === r.p));
  const goalsFor = table.reduce((a, r) => a + r.gf, 0);
  const goalsAgainst = table.reduce((a, r) => a + r.ga, 0);
  check('goals scored equal goals conceded across the division', goalsFor === goalsAgainst);
  check('the domestic cup produced a winner', !!game.world.competitions[`${game.world.clubs[game.userClubId].nation}_CUP`].winner);
  check('the continental cup produced a winner', !!game.world.competitions.CONT_CUP.winner);
  check('the transfer market was active', game.transferLog.length > 150, `${game.transferLog.length} deals`);

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
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
