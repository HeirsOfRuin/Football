// Runs whole seasons headlessly and prints the state of the world, so the
// simulation can be checked end to end without the UI.
import { newGame, advanceDay, endSeason, rolloverSeason, userClub, sortTable } from '../src/state/game.js';
import { SEASON_DAYS } from '../src/core/calendar.js';
import { currentAbility } from '../src/data/attributes.js';
import { sortBy, money } from '../src/core/util.js';
import { squadStrength } from '../src/gen/worldgen.js';
import { simulateMatch } from '../src/engine/match.js';

const seasons = Number(process.argv[2] || 1);
const size = process.argv[3] || 'small';
const t0 = Date.now();
const world0 = newGame({ seed: 4242, size, managerName: 'J. Rose', managerNat: 'ALB' });
// Pick a mid-table top-flight club to manage.
const topLeague = world0.world.leagues.find((l) => l.tier === 1);
const ranked = sortBy(topLeague.clubIds, { key: (id) => world0.world.clubs[id].rep, desc: true });
const game = newGame({ seed: 4242, size, managerName: 'J. Rose', managerNat: 'ALB', clubId: ranked[Math.floor(ranked.length / 2)] });
console.log(`world built in ${Date.now() - t0}ms — managing ${userClub(game).name} (rep ${userClub(game).rep})\n`);

for (let s = 0; s < seasons; s++) {
  const st = Date.now();
  let guard = 0;
  while (game.day < SEASON_DAYS - 1 && guard++ < 500) {
    const r = advanceDay(game);
    if (r.stopped && r.reason === 'userMatch') {
      const fixture = game.fixtures[game.pendingMatchId];
      const { playFixture } = await import('../src/state/game.js');
      playFixture(game, fixture);
      game.status = 'idle';
      game.pendingMatchId = null;
    } else if (r.stopped && r.reason === 'seasonRollover') break;
  }
  const summary = endSeason(game);
  const league = game.world.leagues.find((l) => l.id === userClub(game).leagueId);
  const table = sortTable(league.table);

  console.log(`=== Season ${game.season} (${game.world.year}/${String(game.world.year + 1).slice(2)}) — ${league.name} — ${Date.now() - st}ms ===`);
  console.log('Pos Club                    P  W  D  L  GF GA  GD Pts');
  table.slice(0, 8).forEach((r, i) => {
    const c = game.world.clubs[r.clubId];
    const mark = c.isUserClub ? '*' : ' ';
    console.log(`${String(i + 1).padStart(2)}${mark} ${c.name.slice(0, 22).padEnd(22)} ${String(r.p).padStart(2)} ${String(r.w).padStart(2)} ${String(r.d).padStart(2)} ${String(r.l).padStart(2)} ${String(r.gf).padStart(3)}${String(r.ga).padStart(3)} ${String(r.gd).padStart(3)} ${String(r.pts).padStart(3)}`);
  });
  const userRow = table.findIndex((r) => r.clubId === game.userClubId);
  if (userRow >= 7) {
    const r = table[userRow];
    const c = game.world.clubs[r.clubId];
    console.log(`${String(userRow + 1).padStart(2)}* ${c.name.slice(0, 22).padEnd(22)} ${String(r.p).padStart(2)} ${String(r.w).padStart(2)} ${String(r.d).padStart(2)} ${String(r.l).padStart(2)} ${String(r.gf).padStart(3)}${String(r.ga).padStart(3)} ${String(r.gd).padStart(3)} ${String(r.pts).padStart(3)}`);
  }

  const leaguePlayers = league.clubIds.flatMap((id) => game.world.clubs[id].squad.map((p) => game.world.players[p])).filter(Boolean);
  const scorers = sortBy(leaguePlayers, { key: (p) => p.season.goals, desc: true }).slice(0, 5);
  console.log('\nTop scorers:', scorers.map((p) => `${p.name} (${game.world.clubs[p.clubId].short}) ${p.season.goals}`).join(', '));
  const rated = sortBy(leaguePlayers.filter((p) => p.season.ratingCount >= 15), { key: (p) => p.season.ratingSum / p.season.ratingCount, desc: true }).slice(0, 3);
  console.log('Best rated:', rated.map((p) => `${p.name} ${(p.season.ratingSum / p.season.ratingCount).toFixed(2)}`).join(', '));

  const cup = game.world.competitions[`${userClub(game).nation}_CUP`];
  const cc = game.world.competitions.CONT_CUP;
  console.log(`Cup winner: ${cup.winner ? game.world.clubs[cup.winner]?.name : 'n/a'} | Continental Cup: ${cc.winner ? game.world.clubs[cc.winner]?.name : 'n/a'}`);
  console.log(`Transfers completed: ${game.transferLog.filter((t) => t.season === game.season).length}, biggest: ${sortBy(game.transferLog.filter((t) => t.season === game.season), { key: (t) => t.fee, desc: true })[0]?.name || 'none'} ${money(sortBy(game.transferLog.filter((t) => t.season === game.season), { key: (t) => t.fee, desc: true })[0]?.fee || 0)}`);
  const u = userClub(game);
  console.log(`Your finances: balance ${money(u.finances.balance)}, income ${money(u.finances.seasonIncome)}, spend ${money(u.finances.seasonSpend)}, board confidence ${Math.round(u.board.confidence)}`);
  console.log(`Board verdict: ${summary.userVerdict?.text || 'n/a'}`);
  console.log(`Promotions: ${summary.promoted.length}, Relegations: ${summary.relegated.length}, Inbox: ${game.inbox.length}\n`);

  if (s < seasons - 1) {
    rolloverSeason(game);
    const squad = userClub(game).squad.map((id) => game.world.players[id]);
    console.log(`After rollover: squad ${squad.length}, avg age ${(squad.reduce((a, p) => a + p.age, 0) / squad.length).toFixed(1)}, avg CA ${(squad.reduce((a, p) => a + currentAbility(p), 0) / squad.length).toFixed(0)}, world players ${Object.keys(game.world.players).length}\n`);
  }
}
console.log(`total ${Date.now() - t0}ms`);
