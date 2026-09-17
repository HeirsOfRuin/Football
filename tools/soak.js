// Play a lot of careers, in a lot of situations, and report anything that throws.
//
//   node tools/soak.js [seeds] [seasons]
//
// This exists because of a bug that a green 1,500-assertion suite could not
// have caught: a ReferenceError on a line that only runs when the user's club
// wins a promotion play-off. It threw inside endSeason, and the interface
// turned that into a permanently greyed-out Continue button with no message.
// A playtester lost a career to it.
//
// The lesson is that rare branches need volume, not more unit tests: play
// enough careers, from enough starting points, and the rare branch happens.

import * as G from './../src/state/game.js';
import { SEASON_DAYS } from '../src/core/calendar.js';

const SEEDS = Number(process.argv[2] || 30);
const SEASONS = Number(process.argv[3] || 4);

const failures = [];
let careers = 0;
let seasonsPlayed = 0;
const t0 = Date.now();

for (let i = 0; i < SEEDS; i++) {
  const seed = 1000 + i * 137;
  // Start from every tier in turn: promotion, relegation, play-offs, reserve
  // sides and the job market are all reachable from some of them and not others.
  const tier = 1 + (i % 5);
  let where = 'newGame';
  let game;
  try {
    game = G.newGame({ seed, size: 'small', managerName: 'Soak', clubId: null });
    const leagues = game.world.leagues.filter((l) => l.nation === 'ALB');
    const league = leagues.find((l) => l.tier === tier) || leagues[0];
    G.takeOverClub(game, league.clubIds[i % league.clubIds.length], 'Soak', 'ALB');
    careers++;

    for (let s = 1; s <= SEASONS; s++) {
      where = `season ${s}: playing`;
      let guard = 0;
      while (game.day < SEASON_DAYS - 1 && guard++ < 420) {
        const r = G.advanceDay(game);
        if (r.stopped && r.reason === 'userMatch') {
          G.playFixture(game, game.fixtures[game.pendingMatchId]);
          game.status = 'idle';
          game.pendingMatchId = null;
        }
        if (r.stopped && r.reason === 'seasonRollover') break;
      }
      where = `season ${s}: endSeason`;
      const summary = G.endSeason(game);
      seasonsPlayed++;
      where = `season ${s}: rollover`;
      if (summary.sacked) {
        G.sackManager(game);
        G.rolloverSeason(game);
        where = `season ${s}: job market`;
        const jobs = G.availableJobs(game);
        if (!jobs.length) break;
        G.takeOverClub(game, jobs[0].club.id, 'Soak', 'ALB',
          { style: 'balanced', youth: 'balance', transfers: 'balance' });
      } else {
        G.rolloverSeason(game);
      }
      // The symptom a player actually sees, which is not an exception: a new
      // season that has no games in it.
      const club = G.userClub(game);
      if (club && !Object.values(game.fixtures).some((f) => f.homeId === club.id || f.awayId === club.id)) {
        failures.push({ seed, tier, where: `season ${s + 1}: no fixtures`, message: 'the new season has no games for the user' });
      }
    }
  } catch (err) {
    failures.push({
      seed, tier, where, message: err.message,
      at: (err.stack || '').split('\n')[1]?.trim() || '',
    });
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n${careers} careers, ${seasonsPlayed} seasons, ${secs}s\n`);
if (failures.length) {
  for (const f of failures) {
    console.log(`  seed ${f.seed} (started tier ${f.tier}) — ${f.where}`);
    console.log(`    ${f.message}`);
    if (f.at) console.log(`    ${f.at}`);
  }
  console.log(`\n${failures.length} failure(s).`);
  process.exitCode = 1;
} else {
  console.log('No career hit an exception or lost its fixture list.');
}
