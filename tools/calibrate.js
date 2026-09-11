// Runs a large batch of matches and reports aggregate rates against the
// real-world targets the engine is tuned to hit.
import { generateWorld } from '../src/gen/worldgen.js';
import { simulateMatch } from '../src/engine/match.js';
import { autoPick, autoAssignSpecialists } from '../src/engine/lineup.js';
import { Rng } from '../src/core/rng.js';

const TARGETS = {
  goalsPerMatch: 2.75, shotsPerTeam: 12.6, onTargetPerTeam: 4.4, cornersPerTeam: 5.0,
  foulsPerTeam: 10.8, yellowPerTeam: 1.9, redPerMatch: 0.08, pensPerMatch: 0.26,
  homeWinPct: 44, drawPct: 25, awayWinPct: 31, xgPerTeam: 1.38, possSpread: 8,
};

const world = generateWorld({ seed: 2024, size: 'small' });
for (const c of Object.values(world.clubs)) {
  c.tactic = autoAssignSpecialists(world, c, autoPick(world, c, c.tactic));
}
const topLeague = world.leagues.find((l) => l.tier === 1);
const clubs = topLeague.clubIds.map((id) => world.clubs[id]);

const N = Number(process.argv[2] || 1200);
const rng = new Rng(777);
const agg = {
  matches: 0, goals: 0, shots: 0, onTarget: 0, corners: 0, fouls: 0, yellow: 0, red: 0,
  pens: 0, xg: 0, homeWin: 0, draw: 0, awayWin: 0, homeGoals: 0, awayGoals: 0, poss: [],
  scorelines: {}, bigWins: 0, injuries: 0, goalMinutes: new Array(10).fill(0),
};

for (let i = 0; i < N; i++) {
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
  if (Math.abs(r.homeGoals - r.awayGoals) >= 4) agg.bigWins++;
  const key = `${r.homeGoals}-${r.awayGoals}`;
  agg.scorelines[key] = (agg.scorelines[key] || 0) + 1;
  for (const g of r.scorers) agg.goalMinutes[Math.min(9, Math.floor(g.minute / 10))]++;
}

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
import { squadStrength } from '../src/gen/worldgen.js';
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
