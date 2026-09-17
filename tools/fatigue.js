// What does a squad actually look like at kickoff under each training intensity?
//
//   node tools/fatigue.js [seeds]
//
// A playtester reported that anything above Light training left his side
// heavily fatigued at kick-off. The first thing measured in reply was the mean
// condition of the starting eleven, which came back at 96 / 95 / 95 and
// therefore said nothing: a mean over a whole season hides the one drained man
// in an otherwise fresh team, and that man is what a manager notices.
//
// So this reports the distribution rather than the average - the worst starter,
// the count below the 70 the interface labels "Tired", the share of matches
// with anyone below 85, the same for the whole squad on match day, and how
// congested the fixture was - because a complaint about fatigue is always about
// a tail, and an average is the one statistic guaranteed not to show it.

import * as G from '../src/state/game.js';
import { SEASON_DAYS } from '../src/core/calendar.js';
import { runMatch } from '../src/engine/match.js';

const SEEDS = Number(process.argv[2] || 4);
const INTENSITIES = ['Light', 'Normal', 'Intense'];

function pct(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

for (const intensity of INTENSITIES) {
  const kickoffMeans = [];
  const kickoffWorst = [];
  let matches = 0;
  let matchesWithTiredStarter = 0;   // any starter under 70 - the "Tired" label
  let matchesWithSubPar = 0;         // any starter under 85
  let tiredStarters = 0;
  let starters = 0;
  let squadDayMin = 100;
  const fullTimeMeans = [];
  let congested = 0;                 // fixtures 4 days or less after the last one
  let congestedWorst = 100;
  const squadMeans = [];
  let squadUnder70 = 0;
  let squadUnder85 = 0;
  let squadCounted = 0;

  for (let s = 0; s < SEEDS; s++) {
    const game = G.newGame({ seed: 4400 + s * 91, size: 'small', managerName: 'Probe', clubId: null });
    const league = game.world.leagues.find((l) => l.nation === 'ALB' && l.tier === 1);
    G.takeOverClub(game, league.clubIds[s % league.clubIds.length], 'Probe', 'ALB');
    const club = G.userClub(game);
    club.trainingIntensity = intensity;
    let lastFixtureDay = -99;

    let guard = 0;
    while (game.day < SEASON_DAYS - 1 && guard++ < 420) {
      const r = G.advanceDay(game);

      // Whole-squad low-water mark, sampled every day the calendar stops on.
      for (const id of club.squad) {
        const p = game.world.players[id];
        if (p && !p.injury) squadDayMin = Math.min(squadDayMin, p.condition);
      }

      if (r.stopped && r.reason === 'userMatch') {
        const fixture = game.fixtures[game.pendingMatchId];
        const state = G.createMatchState(game, fixture);
        const mine = state.home.club.id === club.id ? state.home : state.away;
        const conds = mine.onPitch.map((e) => e.player.condition);
        const mean = conds.reduce((a, b) => a + b, 0) / conds.length;
        const worst = Math.min(...conds);
        kickoffMeans.push(mean);
        kickoffWorst.push(worst);
        matches++;
        starters += conds.length;
        const tired = conds.filter((c) => c < 70).length;
        tiredStarters += tired;
        if (tired) matchesWithTiredStarter++;
        if (worst < 85) matchesWithSubPar++;
        // What the squad list looks like on match day, which is the screen the
        // complaint is most likely about: the XI is picked to avoid tired men,
        // so the eleven can read fine while the list behind it reads red.
        const squadConds = club.squad.map((id) => game.world.players[id])
          .filter((p) => p && !p.injury).map((p) => p.condition);
        squadMeans.push(squadConds.reduce((a, b) => a + b, 0) / squadConds.length);
        squadUnder70 += squadConds.filter((c) => c < 70).length;
        squadUnder85 += squadConds.filter((c) => c < 85).length;
        squadCounted += squadConds.length;

        const gap = game.day - lastFixtureDay;
        if (gap <= 4) { congested++; congestedWorst = Math.min(congestedWorst, worst); }
        lastFixtureDay = game.day;

        state.autoManageUser = true;
        runMatch(state);
        fullTimeMeans.push(mine.onPitch.reduce((a, e) => a + (e.player.matchCondition ?? e.player.condition), 0) / mine.onPitch.length);
        G.finishFixture(game, fixture, state);
        game.status = 'idle';
        game.pendingMatchId = null;
      }
      if (r.stopped && r.reason === 'seasonRollover') break;
    }
  }

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`${intensity.padEnd(8)} matches ${String(matches).padStart(3)}`
    + ` | kickoff mean ${mean(kickoffMeans).toFixed(1)}`
    + ` worst-starter mean ${mean(kickoffWorst).toFixed(1)}`
    + ` p10 ${pct(kickoffWorst, 0.1).toFixed(1)}`
    + ` min ${Math.min(...kickoffWorst).toFixed(1)}`
    + ` | starters under 70: ${tiredStarters} of ${starters} (${(tiredStarters / starters * 100).toFixed(1)}%)`
    + ` in ${matchesWithTiredStarter} matches`
    + ` | any starter under 85 in ${matchesWithSubPar} matches (${(matchesWithSubPar / matches * 100).toFixed(0)}%)`
    + ` | congested fixtures ${congested}, worst starter there ${congestedWorst.toFixed(1)}`
    + ` | squad daily low ${squadDayMin.toFixed(1)}`
    + ` | full-time mean ${mean(fullTimeMeans).toFixed(1)}`
    + `\n         squad on match day: mean ${mean(squadMeans).toFixed(1)}`
    + `, under 85 ${(squadUnder85 / squadCounted * 100).toFixed(1)}%`
    + `, under 70 ${(squadUnder70 / squadCounted * 100).toFixed(1)}%`
    + ` (${(squadUnder70 / matches).toFixed(1)} players per match day)`);
}
