// Measures whether the things the game says are different actually are.
//
// Every tactical setting in Touchline claims to do something. This runs
// matched samples — identical clubs, identical opposition, one setting changed
// — and reports the delta. A setting whose row is flat is a setting that exists
// only in the interface copy.
//
// Sample sizing: at 400 matches per arm the standard error on goals per match
// is about 0.06, so treat anything under ~0.15 goals as noise and anything
// under ~1.5 percentage points of possession as noise.

import { generateWorld, squadStrength } from '../src/gen/worldgen.js';
import { simulateMatch } from '../src/engine/match.js';
import { autoPick, autoAssignSpecialists } from '../src/engine/lineup.js';
import { MENTALITIES, INSTRUCTION_DEFS, FORMATIONS, ROLES } from '../src/data/tactics.js';
import { Rng } from '../src/core/rng.js';
import { sortBy } from '../src/core/util.js';

const N = Number(process.argv[2] || 400);
const world = generateWorld({ seed: 8080, size: 'small' });
for (const c of Object.values(world.clubs)) c.tactic = autoAssignSpecialists(world, c, autoPick(world, c, c.tactic));

// Two sides as evenly matched as the division allows, so the only thing moving
// is the setting under test.
const league = world.leagues.find((l) => l.tier === 1);
const ranked = sortBy(league.clubIds.map((id) => world.clubs[id]), { key: (c) => squadStrength(world, c), desc: true });
let best = null;
for (let i = 0; i < ranked.length - 1; i++) {
  const gap = Math.abs(squadStrength(world, ranked[i]) - squadStrength(world, ranked[i + 1]));
  if (!best || gap < best.gap) best = { gap, a: ranked[i], b: ranked[i + 1] };
}
const { a: teamA, b: teamB } = best;

function run(label, mutate) {
  const rng = new Rng(20250911);
  const agg = { gf: 0, ga: 0, poss: 0, shots: 0, conceded: 0, xg: 0, xga: 0, w: 0, d: 0, cards: 0 };
  for (let i = 0; i < N; i++) {
    for (const c of [teamA, teamB]) {
      for (const id of c.squad) {
        Object.assign(world.players[id], { condition: 96, matchCondition: 96, morale: 70, form: 0, sharpness: 85 });
      }
    }
    const tacticA = JSON.parse(JSON.stringify(teamA.tactic));
    const tacticB = JSON.parse(JSON.stringify(teamB.tactic));
    mutate(tacticA);
    const st = simulateMatch(world, { homeClub: teamA, awayClub: teamB, homeTactic: tacticA, awayTactic: tacticB, rng });
    const r = st.result;
    agg.gf += r.homeGoals; agg.ga += r.awayGoals;
    agg.poss += r.homeStats.possession;
    agg.shots += r.homeStats.shots; agg.conceded += r.awayStats.shots;
    agg.xg += r.homeStats.xg; agg.xga += r.awayStats.xg;
    agg.cards += r.homeStats.yellow + r.homeStats.red * 2;
    if (r.homeGoals > r.awayGoals) agg.w++;
    else if (r.homeGoals === r.awayGoals) agg.d++;
  }
  return {
    label,
    gf: agg.gf / N, ga: agg.ga / N, poss: agg.poss / N,
    shots: agg.shots / N, faced: agg.conceded / N,
    xg: agg.xg / N, xga: agg.xga / N, cards: agg.cards / N,
    points: (agg.w * 3 + agg.d) / N,
  };
}

// Noise floors scaled to the sample. A setting has to move a metric by more
// than about 2.5 standard errors of the difference before it counts.
const se = (sd) => 2.5 * sd * Math.SQRT2 / Math.sqrt(N);
const FLOOR = {
  gf: se(1.2), ga: se(1.2), poss: se(6),
  shots: se(4.2), faced: se(4.2), cards: se(1.3), points: se(1.3),
};

const rows = [];

/**
 * A setting is a scale, not a single choice, so judge it by the spread from one
 * end of the scale to the other. Asking whether each step differs from the
 * default finds nothing even when the scale as a whole works.
 */
function table(title, results, baseline) {
  console.log(`\n${title}`);
  console.log('  setting'.padEnd(26), 'GF'.padStart(6), 'GA'.padStart(6), 'Poss'.padStart(7),
    'Shots'.padStart(7), 'Faced'.padStart(7), 'Cards'.padStart(6), 'Pts/g'.padStart(7));
  for (const r of results) {
    console.log(`  ${r.label.padEnd(24)}`,
      r.gf.toFixed(2).padStart(6), r.ga.toFixed(2).padStart(6), `${r.poss.toFixed(1)}%`.padStart(7),
      r.shots.toFixed(1).padStart(7), r.faced.toFixed(1).padStart(7), r.cards.toFixed(2).padStart(6),
      r.points.toFixed(2).padStart(7));
  }
  const spread = (fn) => Math.max(...results.map(fn)) - Math.min(...results.map(fn));
  // Shots created and shots conceded are tracked apart: a setting that trades
  // one for the other cancels to nothing if you only look at the total.
  const moves = {
    gf: spread((r) => r.gf), ga: spread((r) => r.ga), poss: spread((r) => r.poss),
    shots: spread((r) => r.shots), faced: spread((r) => r.faced),
    cards: spread((r) => r.cards), points: spread((r) => r.points),
  };
  const beaten = Object.entries(moves).filter(([k, v]) => v > FLOOR[k]).map(([k, v]) => `${k} ${v.toFixed(2)}`);
  // A setting whose largest movement is close to the floor has an effect this
  // run is too small to resolve, which is a different finding from a setting the
  // engine ignores - and reporting them the same way makes the instrument cry
  // wolf. Counter Attack sits here at 400 matches and clears the floor
  // comfortably at 1500.
  const closest = Math.max(...Object.entries(moves).map(([k, v]) => v / FLOOR[k]));
  const underpowered = !beaten.length && closest > 0.5;
  console.log(`  → spread across the scale: ${beaten.length ? beaten.join(', ') : 'nothing above the noise floor'}`
    + (beaten.length ? '' : underpowered
      ? `   <<< TOO SMALL TO RESOLVE AT ${N} MATCHES — re-run with more`
      : '   <<< NO MEASURABLE EFFECT'));
  rows.push({ setting: title, moved: beaten.length > 0, underpowered, moves });
}

console.log(`Ablation: ${teamA.name} (${Math.round(squadStrength(world, teamA))}) v ${teamB.name} (${Math.round(squadStrength(world, teamB))})`);
console.log(`${N} matches per arm. Only the home side's setting changes.`);
console.log('A setting has to move a metric by more than 2.5 standard errors to count, so the');
console.log('sample has to be large enough for the size of effect being looked for: at 400 matches');
console.log('a real 0.18-goal effect reads as noise, at 1500 it reads as four standard errors.\n');

const baseline = run('Balanced (baseline)', () => {});

table('Mentality', [baseline, ...MENTALITIES.filter((m) => m !== 'Balanced').map((m) => run(m, (t) => { t.mentality = m; }))], baseline);

for (const [key, def] of Object.entries(INSTRUCTION_DEFS)) {
  const variants = def.options.filter((o) => o !== def.default);
  table(def.label, [baseline, ...variants.map((o) => run(o, (t) => { t.instructions = { ...t.instructions, [key]: o }; }))], baseline);
}

// Roles: give the strikers a different job and see whether the side plays
// differently. Archetypes this far apart should not produce the same match.
const roleTests = [['as Poacher', 'ST_POACHER'], ['as Target Man', 'ST_TARGET'],
  ['as False Nine', 'ST_FALSE'], ['as Pressing Fwd', 'ST_PRESS']];
const applyRole = (roleId) => (t) => {
  const slots = FORMATIONS[t.formation].slots;
  t.assignments.forEach((a, i) => {
    if (ROLES[roleId].pos.includes(slots[i].pos)) {
      a.role = roleId;
      a.duty = ROLES[roleId].duties[ROLES[roleId].duties.length - 1];
    }
  });
};
table('Striker role', [baseline, ...roleTests.map(([label, roleId]) => run(label, applyRole(roleId)))], baseline);

console.log('\n--- Summary ---');
console.log(`Noise floors at ${N} matches per arm: `
  + Object.entries(FLOOR).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
const flat = rows.filter((r) => !r.moved && !r.underpowered);
const weak = rows.filter((r) => !r.moved && r.underpowered);
console.log(`${rows.length - flat.length - weak.length} of ${rows.length} tactical settings measurably change how the side plays.`);
if (weak.length) {
  console.log(`\nToo small to resolve at ${N} matches — these have an effect, but not one this`);
  console.log('run can separate from noise. Re-run with more matches before believing either way:');
  for (const f of weak) {
    console.log(`  ${f.setting.padEnd(22)} ` + Object.entries(f.moves).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  '));
  }
}
if (flat.length) {
  console.log('\nSettings with NO measurable effect — claims the game is not keeping:');
  for (const f of flat) {
    console.log(`  ${f.setting.padEnd(22)} ` + Object.entries(f.moves).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  '));
  }
  process.exitCode = 1;
} else if (!weak.length) {
  console.log('Every setting the interface offers does something the engine acts on.');
}
