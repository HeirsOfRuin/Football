// Is knowing something worth the scout it costs?
//
//   node tools/scout.js [seasons]
//
// Two questions, both of which decide whether scouting is a system or a screen:
//
//   1. How wrong are you about a stranger, and how fast does watching him fix
//      it? If the error is small to begin with, the network is decoration. If
//      it never closes, pointing a scout anywhere is pointless.
//   2. How much of a division can a scout actually cover in a season? Too much
//      and you buy the facility once and forget it; too little and nobody ever
//      sees the payoff.

import { generateWorld } from '../src/gen/worldgen.js';
import { Rng } from '../src/core/rng.js';
import { currentAbility } from '../src/data/attributes.js';
import {
  fogBand, scoutCount, runWeeklyScouting, assignScout, knowledgeOf, effectiveKnowledge,
} from '../src/engine/scouting.js';

const SEASONS = Number(process.argv[2] || 1);
const WEEKS = SEASONS * 46;

const world = generateWorld({ seed: 5150, size: 'small' });
const leagues = world.leagues.filter((l) => l.nation === 'ALB').sort((a, b) => a.tier - b.tier);
const club = world.clubs[leagues[0].clubIds[2]];
const watched = leagues[1];

// A bare game object: this measures the scouting module, not the calendar.
const game = { world, day: 0, userClubId: club.id, scouted: {}, scoutAssignments: [] };

const all = Object.values(world.players).filter((p) => {
  const c = p.clubId ? world.clubs[p.clubId] : null;
  return c && c.leagueId === watched.id;
});
// Reported two ways. The average over everyone in a division includes four
// hundred teenagers nobody would ever sign, and a scout who ignores them is
// doing his job - so the number that matters is how wrong you are about the
// players you might actually want.
const strangers = all;
const worthKnowing = [...all].sort((a, b) => currentAbility(b) - currentAbility(a)).slice(0, 100);

const err = (p) => Math.abs(fogBand(game, world, club, p, currentAbility(p)).estimate - currentAbility(p));
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

console.log(`\n${club.name} (scouting ${club.facilities.scouting}/20, ${scoutCount(club)} scouts)`);
console.log(`watching ${watched.name} — ${strangers.length} players\n`);
console.log(`  before any scouting    mean error ${mean(strangers.map(err)).toFixed(1)}`
  + `   (top 100: ${mean(worthKnowing.map(err)).toFixed(1)}) ability points`);

assignScout(game, club, { type: 'league', target: watched.id });
const marks = new Set([4, 12, 24, 46, 92].map((w) => Math.min(w, WEEKS)));
for (let w = 1; w <= WEEKS; w++) {
  game.day += 7;
  runWeeklyScouting(game, new Rng(70000 + w));
  if (!marks.has(w)) continue;
  const seen = strangers.filter((p) => knowledgeOf(game, p.id) > 0);
  console.log(`  after ${String(w).padStart(3)} weeks       mean error ${mean(strangers.map(err)).toFixed(1)}`
    + `   (top 100: ${mean(worthKnowing.map(err)).toFixed(1)})`
    + `   seen ${seen.length}/${strangers.length}`
    + `   knowledge ${mean(worthKnowing.map((p) => effectiveKnowledge(game, world, club, p))).toFixed(0)}`);
}

// One man, watched directly: the other half of the trade.
// Three players rather than one: a single hash can land near zero bias and
// report a scout who was right before he left the building.
const target = worthKnowing.filter((p) => knowledgeOf(game, p.id) < 20)[2] || worthKnowing[0];
const g2 = { world, day: 0, userClubId: club.id, scouted: {}, scoutAssignments: [] };
assignScout(g2, club, { type: 'player', target: target.id });
const errOf = (gm) => Math.abs(fogBand(gm, world, club, target, currentAbility(target)).estimate - currentAbility(target));
console.log(`\n  one player, watched directly — ${target.name}`);
console.log(`    week  0   error ${errOf(g2).toFixed(1)}`);
for (let w = 1; w <= 8; w++) {
  g2.day += 7;
  runWeeklyScouting(g2, new Rng(80000 + w));
  if (w % 2 === 0) console.log(`    week ${String(w).padStart(2)}   error ${errOf(g2).toFixed(1)}   knowledge ${knowledgeOf(g2, target.id).toFixed(0)}`);
}
console.log('');
