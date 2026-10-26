// What is a phase actually worth?
//
//   node tools/phase-gain.js [matches]
//
// Every tactical instruction works by nudging a phase total - create, press,
// defend and so on - and the match then resolves those totals through
// `advantage(a, b) = a / (a + b)`. That is a ratio between two near-equal
// numbers, so a 3% nudge to one side of it moves the advantage by well under
// 1%, and that is the structural reason a tactical setting is worth about a
// tenth of a goal: it was never the instruction that was weak, it was what a
// few percent of a phase converts into.
//
// So this measures the exchange rate directly - multiply one phase by a known
// factor and see what comes out - rather than guessing at coefficients. Set the
// weights from this, not from taste.

import { generateWorld, squadStrength } from '../src/gen/worldgen.js';
import { beginMatch, runMatch } from '../src/engine/match.js';
import { autoPick, autoAssignSpecialists } from '../src/engine/lineup.js';
import { Rng } from '../src/core/rng.js';
import { sortBy } from '../src/core/util.js';

const N = Number(process.argv[2] || 500);
const PHASES = ['create', 'finish', 'build', 'press', 'defend', 'drive', 'aerial'];
const FACTORS = [0.85, 0.95, 1.05, 1.15];

const world = generateWorld({ seed: 8080, size: 'small' });
for (const c of Object.values(world.clubs)) c.tactic = autoAssignSpecialists(world, c, autoPick(world, c, c.tactic));

// The two most evenly matched sides in the top flight, so the ratio starts at
// 50/50 and the measured gain is the gain, not a mismatch.
const league = world.leagues.find((l) => l.tier === 1);
const ranked = sortBy(league.clubIds.map((id) => world.clubs[id]), { key: (c) => squadStrength(world, c), desc: true });
let best = null;
for (let i = 0; i < ranked.length - 1; i++) {
  const gap = Math.abs(squadStrength(world, ranked[i]) - squadStrength(world, ranked[i + 1]));
  if (!best || gap < best.gap) best = { gap, a: ranked[i], b: ranked[i + 1] };
}
const { a: teamA, b: teamB } = best;

function run(phase, factor) {
  const agg = { pts: 0, gf: 0, ga: 0, xg: 0, xga: 0, shots: 0 };
  for (let i = 0; i < N; i++) {
    for (const c of [teamA, teamB]) {
      for (const id of c.squad) {
        Object.assign(world.players[id],
          { condition: 96, matchCondition: 96, morale: 70, form: 0, sharpness: 85 });
      }
    }
    const state = beginMatch(world, {
      homeClub: teamA, awayClub: teamB, homeTactic: teamA.tactic, awayTactic: teamB.tactic,
      importance: 0.35, rng: new Rng(90000 + i),
    });
    // No in-match management on either side: aiManage calls refreshStrength,
    // which would rebuild the totals and throw the multiplier away mid-match.
    state.autoManageUser = false;
    state.home.isUser = true;
    state.away.isUser = true;
    if (phase) state.home.strength.totals[phase] *= factor;
    runMatch(state);
    const r = state.result;
    agg.pts += r.homeGoals > r.awayGoals ? 3 : r.homeGoals === r.awayGoals ? 1 : 0;
    agg.gf += r.homeGoals; agg.ga += r.awayGoals;
    agg.xg += state.home.stats.xg; agg.xga += state.away.stats.xg;
    agg.shots += state.home.stats.shots;
  }
  for (const k in agg) agg[k] /= N;
  return agg;
}

const base = run(null, 1);
const noise = 1.96 * Math.sqrt(1.1 / N); // ppg se at ~1.3 mean, 0/1/3 spread
console.log(`\n${N} matches per cell, ${teamA.short} v ${teamB.short} (evenly matched).`);
console.log(`Baseline ${base.pts.toFixed(2)} ppg, ${base.gf.toFixed(2)}-${base.ga.toFixed(2)}, `
  + `xG ${base.xg.toFixed(2)} v ${base.xga.toFixed(2)}. Noise on ppg ±${noise.toFixed(2)}.\n`);
console.log('  phase      factor   ppg    d(ppg)   xG for   xG against   shots');
for (const phase of PHASES) {
  for (const f of FACTORS) {
    const r = run(phase, f);
    const d = r.pts - base.pts;
    console.log(`  ${phase.padEnd(10)} ${f.toFixed(2)}   ${r.pts.toFixed(2)}   ${(d >= 0 ? '+' : '') + d.toFixed(2)}`
      + `${Math.abs(d) > noise ? ' *' : '  '}   ${r.xg.toFixed(2)}     ${r.xga.toFixed(2)}        ${r.shots.toFixed(1)}`);
  }
  console.log('');
}
console.log('  * = outside the noise. The d(ppg) per 10% of a phase is the exchange rate');
console.log('  the instruction weights have to be set against.\n');
