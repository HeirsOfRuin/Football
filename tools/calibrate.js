// Runs a large batch of matches and reports aggregate rates against the
// real-world targets the engine is tuned to hit.
//
//   node tools/calibrate.js [matches]        detailed report, top flight
//   node tools/calibrate.js [matches] all    every division in the world
//
// The "all" mode exists because the engine had only ever been calibrated on
// tier 1, while the pyramid now runs down to amateur football. A model tuned at
// one ability level is not thereby correct at a third of it, and the only way
// to know is to run the same batch at every level and read the columns.
import { generateWorld, squadStrength } from '../src/gen/worldgen.js';
import { simulateMatch } from '../src/engine/match.js';
import { autoPick, autoAssignSpecialists } from '../src/engine/lineup.js';
import { Rng } from '../src/core/rng.js';
import { sortBy } from '../src/core/util.js';

const TARGETS = {
  goalsPerMatch: 2.75, shotsPerTeam: 12.6, onTargetPerTeam: 4.4, cornersPerTeam: 5.0,
  foulsPerTeam: 10.8, yellowPerTeam: 1.9, redPerMatch: 0.08, pensPerMatch: 0.26,
  homeWinPct: 44, drawPct: 25, awayWinPct: 31, xgPerTeam: 1.38, possSpread: 8,
};

const world = generateWorld({ seed: 2024, size: 'small' });
for (const c of Object.values(world.clubs)) {
  c.tactic = autoAssignSpecialists(world, c, autoPick(world, c, c.tactic));
}

const N = Number(process.argv[2] || 1200);
const mode = process.argv[3] || 'top';

function newAgg() {
  return {
    matches: 0, goals: 0, shots: 0, onTarget: 0, corners: 0, fouls: 0, yellow: 0, red: 0,
    pens: 0, xg: 0, homeWin: 0, draw: 0, awayWin: 0, homeGoals: 0, awayGoals: 0, poss: [],
    scorelines: {}, bigWins: 0, injuries: 0, goalMinutes: new Array(10).fill(0), nils: 0,
  };
}

/** Play `count` random fixtures between `clubs` and aggregate the results. */
function runBatch(clubs, count, rng) {
  const agg = newAgg();
  if (clubs.length < 2) return agg;
  for (let i = 0; i < count; i++) {
    const a = rng.int(0, clubs.length - 1);
    let b = rng.int(0, clubs.length - 1);
    while (b === a) b = rng.int(0, clubs.length - 1);
    const home = clubs[a];
    const away = clubs[b];
    // Reset fatigue between matches.
    for (const c of [home, away]) for (const id of c.squad) { world.players[id].condition = 96; world.players[id].matchCondition = 96; }
    const st = simulateMatch(world, { homeClub: home, awayClub: away, homeTactic: home.tactic, awayTactic: away.tactic, rng });
    const r = st.result;
    agg.matches++;
    agg.goals += r.homeGoals + r.awayGoals;
    agg.homeGoals += r.homeGoals;
    agg.awayGoals += r.awayGoals;
    agg.shots += r.homeStats.shots + r.awayStats.shots;
    agg.onTarget += r.homeStats.onTarget + r.awayStats.onTarget;
    agg.corners += r.homeStats.corners + r.awayStats.corners;
    agg.fouls += r.homeStats.fouls + r.awayStats.fouls;
    agg.yellow += r.homeStats.yellow + r.awayStats.yellow;
    agg.red += r.homeStats.red + r.awayStats.red;
    agg.xg += r.homeStats.xg + r.awayStats.xg;
    agg.pens += st.events.filter((e) => e.type === 'penalty').length;
    agg.injuries += st.events.filter((e) => e.type === 'injury').length;
    agg.poss.push(r.homeStats.possession);
    if (r.homeGoals > r.awayGoals) agg.homeWin++;
    else if (r.homeGoals === r.awayGoals) agg.draw++;
    else agg.awayWin++;
    if (r.homeGoals === 0 && r.awayGoals === 0) agg.nils++;
    if (Math.abs(r.homeGoals - r.awayGoals) >= 4) agg.bigWins++;
    const key = `${r.homeGoals}-${r.awayGoals}`;
    agg.scorelines[key] = (agg.scorelines[key] || 0) + 1;
    for (const g of r.scorers) agg.goalMinutes[Math.min(9, Math.floor(g.minute / 10))]++;
  }
  return agg;
}

// --- Every division, side by side -------------------------------------------

if (mode === 'all') {
  const per = Math.max(150, Math.round(N / world.leagues.length));
  const rng = new Rng(777);
  console.log(`\n${per} matches per division, ${world.leagues.length} divisions\n`);
  console.log('division'.padEnd(30) + 'tier'.padStart(5) + 'XI'.padStart(6) + 'goals'.padStart(8)
    + 'shots'.padStart(7) + 'onTgt'.padStart(7) + 'fouls'.padStart(7) + 'yel'.padStart(6)
    + '0-0 %'.padStart(7) + 'H/D/A'.padStart(14));
  for (const l of sortBy(world.leagues, (x) => x.nation, (x) => x.tier)) {
    const clubs = l.clubIds.map((id) => world.clubs[id]);
    const agg = runBatch(clubs, per, rng);
    const m = Math.max(1, agg.matches);
    const t = m * 2;
    const xi = clubs.reduce((s, c) => s + squadStrength(world, c), 0) / clubs.length;
    console.log(
      l.name.slice(0, 29).padEnd(30)
      + String(l.tier).padStart(5)
      + xi.toFixed(0).padStart(6)
      + (agg.goals / m).toFixed(2).padStart(8)
      + (agg.shots / t).toFixed(1).padStart(7)
      + (agg.onTarget / t).toFixed(1).padStart(7)
      + (agg.fouls / t).toFixed(1).padStart(7)
      + (agg.yellow / t).toFixed(1).padStart(6)
      + ((agg.nils / m) * 100).toFixed(0).padStart(7)
      + `${((agg.homeWin / m) * 100).toFixed(0)}/${((agg.draw / m) * 100).toFixed(0)}/${((agg.awayWin / m) * 100).toFixed(0)}`.padStart(14));
  }
  console.log('\nWhat to look for: goals drift gently downward as ability falls (weaker');
  console.log('finishing, not fewer chances), while shots, fouls and the 0-0 rate stay');
  console.log('roughly flat. A division where shots or fouls move sharply is a sign the');
  console.log('engine has stopped being scale-invariant at that level.\n');
  process.exit(0);
}

// --- The top flight, in detail ----------------------------------------------

const topLeague = world.leagues.find((l) => l.tier === 1);
const clubs = topLeague.clubIds.map((id) => world.clubs[id]);
const rng = new Rng(777);
const agg = runBatch(clubs, N, rng);

const m = agg.matches;
const t = m * 2;
const possMean = agg.poss.reduce((a, b) => a + b, 0) / m;
const possSd = Math.sqrt(agg.poss.reduce((a, b) => a + (b - possMean) ** 2, 0) / m);

const rows = [
  ['goals / match', agg.goals / m, TARGETS.goalsPerMatch],
  ['shots / team', agg.shots / t, TARGETS.shotsPerTeam],
  ['on target / team', agg.onTarget / t, TARGETS.onTargetPerTeam],
  ['xG / team', agg.xg / t, TARGETS.xgPerTeam],
  ['corners / team', agg.corners / t, TARGETS.cornersPerTeam],
  ['fouls / team', agg.fouls / t, TARGETS.foulsPerTeam],
  ['yellows / team', agg.yellow / t, TARGETS.yellowPerTeam],
  ['reds / match', agg.red / m, TARGETS.redPerMatch],
  ['pens / match', agg.pens / m, TARGETS.pensPerMatch],
  ['home win %', (agg.homeWin / m) * 100, TARGETS.homeWinPct],
  ['draw %', (agg.draw / m) * 100, TARGETS.drawPct],
  ['away win %', (agg.awayWin / m) * 100, TARGETS.awayWinPct],
  ['home goals / match', agg.homeGoals / m, 1.55],
  ['away goals / match', agg.awayGoals / m, 1.2],
  ['possession sd', possSd, TARGETS.possSpread],
  ['4+ goal margin %', (agg.bigWins / m) * 100, 3.5],
  ['injuries / match', agg.injuries / m, 0.42],
];

console.log(`\n${m} matches simulated\n`);
console.log('metric'.padEnd(22), 'actual'.padStart(8), 'target'.padStart(8), '  delta');
for (const [label, actual, target] of rows) {
  const delta = ((actual - target) / (target || 1)) * 100;
  const flag = Math.abs(delta) > 18 ? ' <<<' : Math.abs(delta) > 9 ? ' <' : '';
  console.log(label.padEnd(22), actual.toFixed(2).padStart(8), String(target).padStart(8), `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`.padStart(7) + flag);
}

// Quality spread check: strongest vs weakest side in the division.
const ranked = [...clubs].sort((a, b) => squadStrength(world, b) - squadStrength(world, a));
const [strong, weak] = [ranked[0], ranked[ranked.length - 1]];
let sp = 0; let sg = 0; let wg = 0; let ss = 0; let ws = 0; let sw = 0;
const M = 300;
for (let i = 0; i < M; i++) {
  for (const c of [strong, weak]) for (const id of c.squad) { world.players[id].condition = 96; world.players[id].matchCondition = 96; }
  const st = simulateMatch(world, { homeClub: strong, awayClub: weak, homeTactic: strong.tactic, awayTactic: weak.tactic, rng });
  sp += st.result.homeStats.possession; sg += st.result.homeGoals; wg += st.result.awayGoals;
  ss += st.result.homeStats.shots; ws += st.result.awayStats.shots;
  if (st.result.homeGoals > st.result.awayGoals) sw++;
}
console.log(`\nstrongest (${squadStrength(world, strong).toFixed(0)}) at home vs weakest (${squadStrength(world, weak).toFixed(0)}):`);
console.log(`  possession ${(sp / M).toFixed(1)}% (target ~60)  goals ${(sg / M).toFixed(2)}-${(wg / M).toFixed(2)}  shots ${(ss / M).toFixed(1)}-${(ws / M).toFixed(1)}  win rate ${((sw / M) * 100).toFixed(0)}% (target ~72)`);

const top = Object.entries(agg.scorelines).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('\ncommon scores:', top.map(([k, v]) => `${k} (${((v / m) * 100).toFixed(1)}%)`).join('  '));
console.log('goals by 10-min block:', agg.goalMinutes.map((g) => ((g / agg.goals) * 100).toFixed(0) + '%').join(' '));
console.log('\nRun with "all" as the second argument to see every division at once.');
