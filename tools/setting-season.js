// Is a tactical setting still the best one over a whole season?
//
//   node tools/setting-season.js [instruction] [seeds]
//
// A single match with fresh legs cannot see what a setting costs. Measured that
// way, "Very High" tempo is worth +0.18 points a game over Balanced and "Long
// Ball" +0.09, with no visible downside - which would make the tactics screen a
// solved puzzle rather than a decision. But tempo's cost is fatigue, and
// fatigue is a season-scale quantity: it shows up in the fourth midweek game of
// a month, not in a friendly between two rested sides.
//
// So this plays whole seasons, one per option, and reports what the season cost
// as well as what it won. A setting that wins on points AND loses nothing here
// is genuinely dominant and needs a cost put back.

import * as G from '../src/state/game.js';
import { SEASON_DAYS } from '../src/core/calendar.js';
import { INSTRUCTION_DEFS } from '../src/data/tactics.js';
import { currentAbility } from '../src/data/attributes.js';

const KEY = process.argv[2] || 'tempo';
const SEEDS = Number(process.argv[3] || 3);
const def = INSTRUCTION_DEFS[KEY];
if (!def) {
  console.error(`No such instruction: ${KEY}. One of: ${Object.keys(INSTRUCTION_DEFS).join(', ')}`);
  process.exit(1);
}

function season(option, seed) {
  const g = G.newGame({ seed, size: 'small', managerName: 'Arm', clubId: null });
  const lg = g.world.leagues.find((l) => l.nation === 'ALB' && l.tier === 1);
  // Mid-table, so there is room to move in both directions.
  G.takeOverClub(g, lg.clubIds[Math.floor(lg.clubIds.length / 2)], 'Arm', 'ALB');
  const club = G.userClub(g);
  club.tactic.instructions = { ...club.tactic.instructions, [KEY]: option };

  let condSum = 0;
  let condN = 0;
  let injuries = 0;
  const squad = () => club.squad.map((id) => g.world.players[id]).filter(Boolean);
  const injuredNow = () => squad().filter((p) => p.injury).length;
  let wasInjured = 0;

  let guard = 0;
  while (g.day < SEASON_DAYS - 1 && guard++ < 420) {
    const r = G.advanceDay(g);
    const nowInj = injuredNow();
    if (nowInj > wasInjured) injuries += nowInj - wasInjured;
    wasInjured = nowInj;
    if (r.stopped && r.reason === 'userMatch') {
      const fx = g.fixtures[g.pendingMatchId];
      // Condition of the eleven that actually starts, at kick-off.
      const st = G.createMatchState(g, fx);
      const mine = st.home.clubId === club.id ? st.home : st.away;
      for (const e of mine.onPitch) { condSum += e.player.condition; condN++; }
      G.playFixture(g, fx);
      g.status = 'idle';
      g.pendingMatchId = null;
    }
    if (r.stopped && r.reason === 'seasonRollover') break;
  }
  const rec = club.seasonRecord || { w: 0, d: 0, l: 0 };
  const played = rec.w + rec.d + rec.l;
  const league = g.world.leagues.find((l) => l.id === club.leagueId);
  const row = (league.table || []).find((x) => x.clubId === club.id) || { gf: 0, ga: 0, pts: 0 };
  return {
    played,
    ppg: played ? (rec.w * 3 + rec.d) / played : 0,
    gf: row.gf, ga: row.ga,
    cond: condN ? condSum / condN : 0,
    injuries,
    ability: Math.round(squad().reduce((a, p) => a + currentAbility(p), 0) / Math.max(1, squad().length)),
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const rows = [];
let games = 0;
for (const option of def.options) {
  const runs = [];
  for (let s = 0; s < SEEDS; s++) runs.push(season(option, 4100 + s * 57));
  games = mean(runs.map((r) => r.played));
  rows.push({
    option,
    ppg: mean(runs.map((r) => r.ppg)),
    gf: mean(runs.map((r) => r.gf)),
    ga: mean(runs.map((r) => r.ga)),
    cond: mean(runs.map((r) => r.cond)),
    injuries: mean(runs.map((r) => r.injuries)),
  });
}

// The noise floor, printed beside the numbers rather than left for the reader
// to assume away. Points per game from a 0/1/3 outcome has a variance near 1.1,
// so at n league games the 95% band on a difference of two means is about
// 1.96 * sqrt(2 * 1.1 / n). The first run of this tool printed five rows whose
// every gap was inside its own noise and read like a result.
const n = Math.max(1, games * SEEDS);
const noise = 1.96 * Math.sqrt(2 * 1.1 / n);

const base = rows.find((r) => r.option === def.default);
console.log(`\n${def.label}: ${SEEDS} full seasons per option (${Math.round(n)} league games each),`
  + ` same seeds, mid-table club.`);
console.log(`A difference under ±${noise.toFixed(2)} ppg is not a result.\n`);
console.log('  setting            ppg    vs default     GF    GA   XI cond   injuries');
for (const r of rows) {
  const d = r.ppg - base.ppg;
  const verdict = r.option === def.default ? '' : Math.abs(d) > noise
    ? `${(d >= 0 ? '+' : '') + d.toFixed(2)} real` : `${(d >= 0 ? '+' : '') + d.toFixed(2)} noise`;
  console.log(`  ${r.option.padEnd(17)} ${r.ppg.toFixed(2)}   ${verdict.padEnd(12)}`
    + ` ${r.gf.toFixed(0).padStart(3)}   ${r.ga.toFixed(0).padStart(3)}`
    + `    ${r.cond.toFixed(1)}      ${r.injuries.toFixed(1)}`);
}
const better = rows.filter((r) => r.option !== def.default && r.ppg - base.ppg > noise);
const worse = rows.filter((r) => r.option !== def.default && base.ppg - r.ppg > noise);
console.log(`\n  ${better.length} option(s) beat the default by more than the noise`
  + `, ${worse.length} lose to it by more.`);
console.log('  An option that gains points and costs nothing is dominant, and the rest');
console.log('  are then scenery. An option that is never worth picking is the same');
console.log('  failure from the other end.\n');
