// Prints the whole league pyramid as one table.
//
// The point is to read the ladder top to bottom in a single glance and check it
// is monotonic and believable: ability, money, wages, grounds and crowds should
// all fall together, with no step that jumps the wrong way. Reasoning about
// individual formulas does not catch a pyramid that has a hole in the middle.

import { generateWorld, squadStrength, abilityForReputation, commercialIncome } from '../src/gen/worldgen.js';
import { WORLD_SIZES, CLUB_STATUS } from '../src/data/nations.js';
import { money, sortBy } from '../src/core/util.js';
import { currentAbility } from '../src/data/attributes.js';

const size = process.argv[2] || 'small';
const world = generateWorld({ seed: Number(process.argv[3] || 4242), size });

console.log(`\n${WORLD_SIZES[size].label}`);
console.log(`${world.leagues.length} divisions, ${Object.keys(world.clubs).length} clubs, `
  + `${Object.keys(world.players).length.toLocaleString()} players\n`);

const head = ['division', 'tier', 'status', 'XI best/worst', 'wage/wk best/worst', 'income best/worst', 'ground', 'crowd'];
console.log(head[0].padEnd(30) + head[1].padStart(5) + '  ' + head[2].padEnd(13)
  + head[3].padStart(14) + head[4].padStart(20) + head[5].padStart(20) + head[6].padStart(15) + head[7].padStart(14));

const ordered = sortBy(world.leagues, (l) => l.nation, (l) => l.tier);
for (const l of ordered) {
  const clubs = l.clubIds.map((id) => world.clubs[id]);
  const str = clubs.map((c) => squadStrength(world, c));
  const wage = clubs.map((c) => c.finances.wageBudgetAnnual / 52);
  const inc = clubs.map((c) => c.finances.incomeEstimate);
  const cap = clubs.map((c) => c.stadium.capacity);
  const crowd = clubs.map((c) => Math.round(c.stadium.capacity * c.finances.capacityUse));
  const statuses = [...new Set(clubs.map((c) => c.status))].join('/');
  console.log(
    l.name.slice(0, 29).padEnd(30)
    + String(l.tier).padStart(5) + '  '
    + statuses.padEnd(13)
    + `${Math.max(...str).toFixed(0)}/${Math.min(...str).toFixed(0)}`.padStart(14)
    + `${money(Math.max(...wage))}/${money(Math.min(...wage))}`.padStart(20)
    + `${money(Math.max(...inc))}/${money(Math.min(...inc))}`.padStart(20)
    + `${Math.max(...cap).toLocaleString()}/${Math.min(...cap).toLocaleString()}`.padStart(15)
    + `${Math.max(...crowd).toLocaleString()}/${Math.min(...crowd).toLocaleString()}`.padStart(14),
  );
}

// Whole-world ranges: the two numbers this stage exists to fix.
const allStr = ordered.flatMap((l) => l.clubIds.map((id) => squadStrength(world, world.clubs[id])));
const allInc = ordered.flatMap((l) => l.clubIds.map((id) => world.clubs[id].finances.incomeEstimate));
const allWage = Object.values(world.players).filter((p) => p.contract).map((p) => p.contract.wage);
console.log(`\nability  ${Math.max(...allStr).toFixed(0)} -> ${Math.min(...allStr).toFixed(0)}`
  + `  = ${(Math.max(...allStr) / Math.min(...allStr)).toFixed(1)}x`);
console.log(`money    ${money(Math.max(...allInc))} -> ${money(Math.min(...allInc))}`
  + `  = ${(Math.max(...allInc) / Math.min(...allInc)).toFixed(0)}x`);
console.log(`wages    ${money(Math.max(...allWage))}/wk -> ${money(Math.min(...allWage))}/wk`);

// Monotonicity: within a nation, each tier down should be poorer and weaker.
console.log('\nchecks:');
let problems = 0;
for (const nation of world.nations) {
  const tiers = sortBy(ordered.filter((l) => l.nation === nation.id), (l) => l.tier);
  for (let i = 0; i < tiers.length - 1; i++) {
    const a = tiers[i];
    const b = tiers[i + 1];
    const mean = (l, fn) => l.clubIds.reduce((s, id) => s + fn(world.clubs[id]), 0) / l.clubIds.length;
    const sa = mean(a, (c) => squadStrength(world, c));
    const sb = mean(b, (c) => squadStrength(world, c));
    const ia = mean(a, (c) => c.finances.incomeEstimate);
    const ib = mean(b, (c) => c.finances.incomeEstimate);
    if (sb >= sa) { console.log(`  <<< ${b.name} is no weaker than ${a.name} (${sb.toFixed(0)} vs ${sa.toFixed(0)})`); problems++; }
    if (ib >= ia) { console.log(`  <<< ${b.name} is no poorer than ${a.name}`); problems++; }
  }
}
const noStatus = Object.values(world.clubs).filter((c) => !CLUB_STATUS[c.status]).length;
if (noStatus) { console.log(`  <<< ${noStatus} clubs have no valid status`); problems++; }
console.log(problems === 0 ? '  every tier is weaker and poorer than the one above it' : `  ${problems} problems`);
