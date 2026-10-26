// Is every touchline call best somewhere, and does repeating one get punished?
//
//   node tools/touchline.js [matches]
//
// Two questions, and a feature that fails either is decoration:
//
//   1. Does each call measurably change the match? A button that moves nothing
//      is the failure this project keeps catching in its own work.
//   2. Is each one best in some situation and worst in another? If one call
//      wins everywhere, the rest are scenery and the decision is a formality.
//
// Situations are the thing a manager is actually in: chasing a goal, holding a
// lead, and outmatched. Each arm plays the same fixtures from the same seeds
// with one call made at kick-off and nothing else changed.

import { generateWorld } from '../src/gen/worldgen.js';
import { Rng } from '../src/core/rng.js';
import { beginMatch, runMatch, touchlineCall } from '../src/engine/match.js';
import { CALL_IDS, TOUCHLINE_CALLS } from '../src/engine/touchline.js';

const N = Number(process.argv[2] || 220);
const world = generateWorld({ seed: 4242, size: 'small' });
const top = world.leagues.find((l) => l.tier === 1);
const clubs = top.clubIds.map((id) => world.clubs[id]).sort((a, b) => b.rep - a.rep);

const SITUATIONS = [
  { id: 'even', us: clubs[7], them: clubs[8] },
  { id: 'favourite', us: clubs[0], them: clubs[15] },
  { id: 'outmatched', us: clubs[15], them: clubs[0] },
];

function reset(a, b) {
  for (const c of [a, b]) {
    for (const id of c.squad) {
      Object.assign(world.players[id],
        { condition: 96, matchCondition: 96, morale: 70, form: 0, sharpness: 85 });
    }
  }
}

/**
 * Play a match, optionally making one call at the hour mark.
 *
 * The call goes in at minute 60 rather than at kick-off, and that is the whole
 * design of this tool. The first version made every call in the tunnel and
 * concluded that none of them beat doing nothing - which is true and useless,
 * because nobody shouts "take your time" in the first minute. A call is a
 * response to a situation, so it has to be measured against the situation.
 *
 * Because the engine is deterministic and the call changes nothing before the
 * hour, the two arms are the same match up to the branch point: a true A/B with
 * no sampling difference at all before the decision.
 */
function play(us, them, call, seed) {
  reset(us, them);
  const state = beginMatch(world, {
    homeClub: us, awayClub: them, homeTactic: us.tactic, awayTactic: them.tactic,
    importance: 0.4, rng: new Rng(seed),
  });
  state.autoManageUser = false;
  state.home.isUser = true;
  runMatch(state, AT_TICK);
  const situation = state.home.goals - state.away.goals;
  if (call) touchlineCall(state, state.home, call);
  runMatch(state);
  return { state, situation };
}

/** Minute 60 of 90, in ticks. */
const AT_TICK = 120;

const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const se = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)) / Math.sqrt(a.length);
};

// Grouped by the state of the match at the hour, because that is the question a
// manager is answering when he stands up.
const AT_HOUR = [
  { id: 'behind at the hour', ok: (d) => d < 0 },
  { id: 'level at the hour', ok: (d) => d === 0 },
  { id: 'ahead at the hour', ok: (d) => d > 0 },
];

console.log(`\n${N} matches per cell, the call made at minute 60.`);
console.log('Both arms are the same match up to the hour, so the only difference is the call.\n');

for (const sit of SITUATIONS) {
  console.log(`  ${sit.us.short} v ${sit.them.short} (${sit.id})`);
  // One pass per arm; group afterwards by what the situation turned out to be.
  const byCall = new Map();
  for (const call of [null, ...CALL_IDS]) {
    const runs = [];
    for (let i = 0; i < N; i++) {
      const { state, situation } = play(sit.us, sit.them, call, 300000 + i);
      const g = state.result;
      runs.push({
        situation,
        pts: g.homeGoals > g.awayGoals ? 3 : g.homeGoals === g.awayGoals ? 1 : 0,
        xgF: state.home.stats.xg,
        xgA: state.away.stats.xg,
        cards: state.home.stats.yellow + state.home.stats.red,
      });
    }
    byCall.set(call, runs);
  }

  for (const band of AT_HOUR) {
    const base = byCall.get(null).filter((r) => band.ok(r.situation));
    if (base.length < 25) continue;
    console.log(`    ${band.id} (${base.length} matches)`);
    const basePts = mean(base.map((r) => r.pts));
    const baseSe = se(base.map((r) => r.pts));
    console.log(`      ${'no call'.padEnd(18)} ${basePts.toFixed(2)} ppg`
      + `   xG ${mean(base.map((r) => r.xgF)).toFixed(2)} v ${mean(base.map((r) => r.xgA)).toFixed(2)}`
      + `   cards ${mean(base.map((r) => r.cards)).toFixed(2)}`);
    for (const call of CALL_IDS) {
      const arm = byCall.get(call).filter((r) => band.ok(r.situation));
      if (!arm.length) continue;
      const pts = mean(arm.map((r) => r.pts));
      const gap = pts - basePts;
      const noise = (se(arm.map((r) => r.pts)) + baseSe) * 1.96;
      const mark = Math.abs(gap) > noise ? (gap > 0 ? 'better' : 'worse') : '—';
      console.log(`      ${TOUCHLINE_CALLS[call].label.padEnd(18)} ${pts.toFixed(2)} ppg`
        + `   xG ${mean(arm.map((r) => r.xgF)).toFixed(2)} v ${mean(arm.map((r) => r.xgA)).toFixed(2)}`
        + `   cards ${mean(arm.map((r) => r.cards)).toFixed(2)}`
        + `   ${gap >= 0 ? '+' : ''}${gap.toFixed(2)} ±${noise.toFixed(2)} ${mark}`);
    }
    console.log('');
  }
}

console.log('  A call that is never best in any situation is decoration; one that is best');
console.log('  in every situation is the only call worth making. Both are failures.\n');
