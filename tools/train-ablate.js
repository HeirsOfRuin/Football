// Does training actually do anything?
//
//   node tools/train-ablate.js [playersPerArm]
//
// This exists because the thing Stage 3 is fixing is a setting that reads well
// and does nothing: intensity claimed a cost the engine never charged, and every
// club in the world ran on an intensity that was never set. A new set of
// dropdowns is worth nothing unless each one moves a measurable number, so each
// arm below is a real A/B against a noise floor rather than an assertion that
// the code ran.
//
// Method: identical cohorts of generated players, cloned per arm so the only
// difference is the setting, then a full season of weekly training each.

import { generateWorld } from '../src/gen/worldgen.js';
import { generatePlayer } from '../src/gen/playergen.js';
import { Rng } from '../src/core/rng.js';
import {
  trainPlayer, dailyPlayerTick, trainingSlots, retrainingStep, developmentRate,
} from '../src/engine/training.js';
import {
  ALL_ATTRS, ATTR_GROUPS, currentAbility, familiarity, familiarityLabel,
} from '../src/data/attributes.js';
import { ROLES } from '../src/data/tactics.js';

const N = Number(process.argv[2] || 220);
const WEEKS = 38;

const world = generateWorld({ seed: 8123, size: 'small' });

function ordinaryClub(over = {}) {
  return {
    id: 'cTest',
    squad: [],
    facilities: { training: 10, youth: 10, scouting: 10, medical: 10 },
    coaching: { attacking: 10, defending: 10, fitness: 10, gk: 10 },
    manager: { youthDev: 10 },
    trainingFocus: 'Balanced',
    trainingIntensity: 'Normal',
    training: { slots: [] },
    ...over,
  };
}

/** A fresh cohort, identical every time it is asked for. */
function cohort(seed, age = 19, pos = 'MC') {
  const rng = new Rng(seed);
  const out = [];
  for (let i = 0; i < N; i++) {
    const p = generatePlayer(rng, {
      nationId: 'ALB', pos, age, targetCA: 95, targetPA: 155, clubRep: 70, leagueRep: 82,
    });
    p.season.minutes = 1500;
    out.push(p);
  }
  return out;
}

function clone(p) {
  return JSON.parse(JSON.stringify(p));
}

/** Train a cohort for a season and report what moved. */
function season(players, club, prog = null, seed = 99) {
  const rng = new Rng(seed);
  const before = players.map((p) => ({ ...p.attrs }));
  let injuries = 0;
  let condSum = 0;
  for (let w = 0; w < WEEKS; w++) {
    for (const p of players) {
      trainPlayer(rng, world, club, p, typeof prog === 'function' ? prog(p) : prog);
      if (p.injury) injuries++;
    }
    for (let d = 0; d < 7; d++) {
      for (const p of players) {
        if (d === 6) p.condition = Math.max(5, p.condition - 34);
        dailyPlayerTick(rng, world, club, p, d === 6);
      }
    }
  }
  for (const p of players) condSum += p.condition;
  const gain = (attrs) => {
    let g = 0;
    players.forEach((p, i) => { for (const a of attrs) g += p.attrs[a] - before[i][a]; });
    return g / players.length;
  };
  return {
    total: gain(ALL_ATTRS),
    gain,
    injuryWeeks: injuries / players.length,
    condition: condSum / players.length,
    ca: players.reduce((s, p) => s + currentAbility(p), 0) / players.length,
  };
}

const rows = [];
// `expectFlat` marks a row that is *supposed* to stay still, so a small number
// there reads as the design working rather than as a failure.
const line = (label, a, b, unit, floor, expectFlat = false) => {
  const delta = b - a;
  const moved = Math.abs(delta) > floor;
  const verdict = expectFlat ? (moved ? 'MOVED <<<' : 'flat, as intended') : (moved ? 'YES' : 'NO  <<<');
  rows.push({ label, a, b, delta, verdict, expectFlat, moved });
  console.log(`  ${label.padEnd(38)} ${a.toFixed(2).padStart(8)} ${b.toFixed(2).padStart(8)}`
    + ` ${(delta >= 0 ? '+' : '') + delta.toFixed(2)}`.padStart(9) + ` ${unit.padEnd(6)} ${verdict}`);
};

console.log(`\n${N} players per arm, ${WEEKS} weeks each.\n`);

// --- Noise floor -------------------------------------------------------------
// Two identical arms differing only in rng stream. Anything smaller than the gap
// between them is not a finding.
{
  const a = season(cohort(1).map(clone), ordinaryClub(), null, 501);
  const b = season(cohort(1).map(clone), ordinaryClub(), null, 502);
  var FLOOR = Math.abs(b.total - a.total) * 2.5 + 0.2;
  var COND_FLOOR = Math.abs(b.condition - a.condition) * 2.5 + 0.5;
  console.log(`Noise floor: ${FLOOR.toFixed(2)} attribute points, ${COND_FLOOR.toFixed(2)} condition.\n`);
}

console.log('setting'.padEnd(40) + 'off'.padStart(8) + 'on'.padStart(9) + 'delta'.padStart(10) + '  unit   moved?');

// --- Individual programmes ---------------------------------------------------
{
  const plain = season(cohort(2).map(clone), ordinaryClub(), null, 601);
  const phys = season(cohort(2).map(clone), ordinaryClub(), { type: 'group', target: 'physical' }, 601);
  line('physical programme: physical gained', plain.gain(ATTR_GROUPS.physical), phys.gain(ATTR_GROUPS.physical), 'pts', FLOOR);

  const tech = season(cohort(2).map(clone), ordinaryClub(), { type: 'group', target: 'technical' }, 601);
  line('technical programme: technical gained', plain.gain(ATTR_GROUPS.technical), tech.gain(ATTR_GROUPS.technical), 'pts', FLOOR);

  const role = ROLES.MC_BOX_TO_BOX || Object.values(ROLES).find((r) => r.pos.includes('MC'));
  const asRole = season(cohort(2).map(clone), ordinaryClub(), { type: 'role', target: role.id }, 601);
  line(`role "${role.name}": its own attributes`, plain.gain(role.attrs), asRole.gain(role.attrs), 'pts', FLOOR);

  // A programme is mostly aim, not acceleration: it carries a deliberate but
  // small rate bonus, so total gain should rise by roughly a tenth, not double.
  const lift = (phys.total / plain.total - 1) * 100;
  console.log(`  ${'...total gain across all attributes'.padEnd(38)} ${plain.total.toFixed(2).padStart(8)}`
    + ` ${phys.total.toFixed(2).padStart(8)} ${`+${lift.toFixed(0)}%`.padStart(9)} pts    ${lift < 20 ? 'aim, not acceleration' : 'TOO MUCH <<<'}`);
}

// --- Intensity ---------------------------------------------------------------
{
  const normal = season(cohort(3).map(clone), ordinaryClub(), null, 701);
  const intense = season(cohort(3).map(clone), ordinaryClub({ trainingIntensity: 'Intense' }), null, 701);
  const light = season(cohort(3).map(clone), ordinaryClub({ trainingIntensity: 'Light' }), null, 701);

  line('Intense: development', normal.total, intense.total, 'pts', FLOOR);
  line('Intense: condition', normal.condition, intense.condition, 'cond', COND_FLOOR);
  line('Intense: weeks spent injured', normal.injuryWeeks, intense.injuryWeeks, 'wks', 0.5);
  line('Light: development', normal.total, light.total, 'pts', FLOOR);
  line('Light: condition', normal.condition, light.condition, 'cond', COND_FLOOR);
}

// --- Youth coaching ----------------------------------------------------------
{
  const poor = season(cohort(4, 19).map(clone), ordinaryClub({ manager: { youthDev: 3 } }), null, 801);
  const good = season(cohort(4, 19).map(clone), ordinaryClub({ manager: { youthDev: 18 } }), null, 801);
  line('youthDev on a 19-year-old', poor.total, good.total, 'pts', FLOOR);

  const oldPoor = season(cohort(5, 26).map(clone), ordinaryClub({ manager: { youthDev: 3 } }), null, 802);
  const oldGood = season(cohort(5, 26).map(clone), ordinaryClub({ manager: { youthDev: 18 } }), null, 802);
  line('youthDev on a 26-year-old', oldPoor.total, oldGood.total, 'pts', FLOOR, true);
}

// --- Position retraining -----------------------------------------------------
{
  console.log('\nPosition retraining — an MC learning to play DC:');
  for (const age of [18, 22, 27, 31]) {
    const players = cohort(6, age, 'MC').slice(0, 40).map(clone);
    const start = familiarity(players[0], 'DC');
    const club = ordinaryClub();
    const rng = new Rng(901);
    for (let s = 0; s < 3; s++) {
      for (let w = 0; w < WEEKS; w++) {
        for (const p of players) trainPlayer(rng, world, club, p, { type: 'position', target: 'DC' });
      }
      const f = players.reduce((a, p) => a + familiarity(p, 'DC'), 0) / players.length;
      if (s === 0 || s === 2) {
        console.log(`  age ${age}: after season ${s + 1}, familiarity ${start} -> ${f.toFixed(1)}`
          + ` (${familiarityLabel(Math.round(f))})`);
      }
    }
  }
}

// --- Slots across the pyramid ------------------------------------------------
{
  console.log('\nIndividual slots by club standing:');
  const byTier = new Map();
  for (const club of Object.values(world.clubs)) {
    const l = world.leagues.find((x) => x.id === club.leagueId);
    if (!l) continue;
    const k = `${l.name} (tier ${l.tier})`;
    const n = trainingSlots(club);
    const e = byTier.get(k) || { min: 99, max: 0 };
    e.min = Math.min(e.min, n); e.max = Math.max(e.max, n);
    byTier.set(k, e);
  }
  for (const [k, v] of [...byTier].sort()) {
    console.log(`  ${k.padEnd(36)} ${v.min}-${v.max} slots`);
  }
}

// --- Verdict -----------------------------------------------------------------
const failed = rows.filter((r) => (r.expectFlat ? r.moved : !r.moved));
console.log('\n--- Summary ---');
if (failed.length) {
  console.log('Rows that did not behave as designed:');
  for (const f of failed) {
    console.log(`  ${f.label} (delta ${f.delta.toFixed(2)})`
      + (f.expectFlat ? ' — expected to stay flat and did not' : ' — expected to move and did not'));
  }
  process.exitCode = 1;
} else {
  console.log('Every training setting moves development by more than the noise floor.');
}
