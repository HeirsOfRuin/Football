// Does a derby actually play differently, or does it just say "derby"?
//
//   node tools/rivalry.js [seeds]
//
// A rivalry that only shows a pill on a fixture list is decoration, and
// decoration is the failure this project keeps finding in its own work: three
// settings have already been caught being written and never read. So this
// measures the two things a derby is supposed to change - the crowd and the
// temperature - against the same clubs playing each other with the rivalry
// stripped out, on the same seeds.
//
// The comparison is a true A/B: identical fixtures, identical squads, identical
// RNG stream. The only difference is whether the clubs know they dislike each
// other.

import { generateWorld } from '../src/gen/worldgen.js';
import { Rng } from '../src/core/rng.js';
import { beginMatch, runMatch } from '../src/engine/match.js';
import { assignRivalries, rivalsOf, rivalryImportance, rivalryAttendance } from '../src/engine/rivalry.js';

const SEEDS = Number(process.argv[2] || 6);
const PER_PAIR = 40;

function mean(a) { return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); }
function se(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) / Math.sqrt(a.length);
}

const counts = { city: 0, historic: 0, local: 0 };
let clubsWithout = 0;
let totalClubs = 0;
const arms = {
  derby: { att: [], cards: [], fouls: [], goals: [] },
  plain: { att: [], cards: [], fouls: [], goals: [] },
};

for (let s = 0; s < SEEDS; s++) {
  const world = generateWorld({ seed: 9000 + s * 71, size: 'small' });
  const clubs = Object.values(world.clubs).filter((c) => !c.affiliateOf);
  totalClubs += clubs.length;
  for (const c of clubs) {
    if (!(c.rivals || []).length) clubsWithout++;
    for (const r of c.rivals || []) counts[r.kind] += 0.5;
  }

  // Take the hottest pairs in this world and play them both ways.
  const pairs = [];
  const seen = new Set();
  for (const c of clubs) {
    for (const r of rivalsOf(world, c)) {
      const key = [c.id, r.id].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.opponent.leagueId === c.leagueId) pairs.push({ home: c, away: r.opponent, heat: r.heat });
    }
  }
  pairs.sort((a, b) => b.heat - a.heat);

  for (const pair of pairs.slice(0, 6)) {
    for (let i = 0; i < PER_PAIR; i++) {
      // The same seed for both arms, so the only difference is the rivalry.
      const base = 50_000 + i * 13;
      const league = world.leagues.find((l) => l.id === pair.home.leagueId);
      const leagueImportance = 0.2 + ((league?.rep ?? 60) - 50) / 45 * 0.3;
      for (const [name, bump, crowd, heat] of [
        ['derby', rivalryImportance(world, { homeId: pair.home.id, awayId: pair.away.id }),
          rivalryAttendance(pair.heat), pair.heat / 100],
        ['plain', 0, 1, 0],
      ]) {
        const st = beginMatch(world, {
          homeClub: pair.home,
          awayClub: pair.away,
          homeTactic: pair.home.tactic,
          awayTactic: pair.away.tactic,
          importance: Math.min(1, leagueImportance + bump),
          crowdBoost: crowd,
          heat,
          rng: new Rng(base),
        });
        runMatch(st);
        const a = arms[name];
        a.att.push(st.attendance);
        a.cards.push(st.home.stats.yellow + st.away.stats.yellow + st.home.stats.red + st.away.stats.red);
        a.fouls.push(st.home.stats.fouls + st.away.stats.fouls);
        a.goals.push(st.result.homeGoals + st.result.awayGoals);
      }
    }
  }
}

const n = arms.derby.att.length;
console.log(`\n${SEEDS} worlds, ${n} matches per arm, same seeds in both\n`);
console.log('  rivalries found     '
  + `city ${Math.round(counts.city)}, historic ${Math.round(counts.historic)}, local ${Math.round(counts.local)}`);
console.log(`  clubs with none     ${clubsWithout} of ${totalClubs} (${(clubsWithout / totalClubs * 100).toFixed(1)}%)\n`);

const row = (label, key, dp = 2) => {
  const d = mean(arms.derby[key]);
  const p = mean(arms.plain[key]);
  const noise = (se(arms.derby[key]) + se(arms.plain[key]));
  const gap = d - p;
  const real = Math.abs(gap) > noise * 1.96;
  console.log(`  ${label.padEnd(20)}derby ${d.toFixed(dp).padStart(9)}   ordinary ${p.toFixed(dp).padStart(9)}`
    + `   gap ${(gap >= 0 ? '+' : '') + gap.toFixed(dp)}   noise ±${(noise * 1.96).toFixed(dp)}`
    + `   ${real ? 'real' : 'INSIDE THE NOISE'}`);
  return real;
};

const attReal = row('attendance', 'att', 0);
const cardsReal = row('cards', 'cards');
const foulsReal = row('fouls', 'fouls');
row('goals', 'goals');
console.log('\n  Goals are not expected to move: a derby changes the temperature and the'
  + '\n  crowd, not how well anyone finishes. A gap there would be a bug.\n');

if (!attReal || !cardsReal || !foulsReal) {
  console.log('  A derby is not measurably different from an ordinary fixture.');
  process.exitCode = 1;
}
