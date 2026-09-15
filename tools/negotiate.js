// Can a negotiation still be won by grinding?
//
//   node tools/negotiate.js [trials]
//
// This exists because the thing Stage 6 is fixing is a negotiation that was not
// one. `evaluateOffer` and `evaluateContract` are pure functions of the world,
// and the bid dialog re-ran them on every click, so the same offer always came
// back with the same answer and a patient player could walk any number to the
// exact threshold at no cost. Measured on the old model, the same offer made
// fifty times returned one distinct answer, and 43% of players in the world
// would sign for under a tenth of the wage they had just asked for.
//
// So every arm below is an attempt to cheat the new model, not an assertion
// that it ran. A green line here means an exploit was tried and failed.

import { generateWorld } from '../src/gen/worldgen.js';
import { newGame } from '../src/state/game.js';
import { serialiseGame, deserialiseGame } from '../src/state/codec.js';
import { askingPrice, marketValue, evaluateContract, contractDemand } from '../src/engine/transfers.js';
import {
  openTransferTalks, transferOffer, termsOffer, cashEquivalent, termsEquivalent,
  COOLING_OFF_DAYS,
} from '../src/engine/negotiation.js';
import { currentAbility } from '../src/data/attributes.js';

const TRIALS = Number(process.argv[2] || 120);

const rows = [];
function line(label, ok, detail = '') {
  rows.push({ label, ok });
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
}

function fresh(seed = 4242) {
  const game = newGame({ seed, size: 'small', managerName: 'Probe', clubId: null });
  const top = game.world.leagues.find((l) => l.tier === 1);
  const buyer = game.world.clubs[top.clubIds[3]];
  buyer.isUserClub = true;
  game.userClubId = buyer.id;
  return { game, buyer };
}

/** Players worth buying, spread across the price range rather than one outlier. */
function targets(game, buyer, n) {
  const world = game.world;
  const all = Object.values(world.players)
    .filter((p) => p.clubId && p.clubId !== buyer.id && !world.clubs[p.clubId]?.affiliateOf && p.contract);
  const sorted = all.map((p) => ({ p, ask: askingPrice(world, p) }))
    .filter((x) => x.ask > 0)
    .sort((a, b) => b.ask - a.ask);
  // Distinct players: the index formula repeats for large n, and a repeated
  // player reuses the negotiation already opened for him, which makes an arm
  // look like it found an exploit when it only found its own duplicate.
  const seen = new Set();
  const out = [];
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const row = sorted[Math.floor((i / (n * 3)) * sorted.length * 0.6)];
    if (!row || seen.has(row.p.id)) continue;
    seen.add(row.p.id);
    out.push(row);
  }
  return out;
}

console.log(`\n${TRIALS} negotiations per arm.\n`);

// --- 1. The regression that defines the stage --------------------------------
// Make the same offer over and over. Under the old model this was free; it has
// to end in a walk-away now, never in a signature.
{
  const { game, buyer } = fresh();
  let won = 0; let collapsed = 0; let rounds = 0; let accepted = 0;
  for (const { p, ask } of targets(game, buyer, TRIALS)) {
    const { negotiation } = openTransferTalks(game, p, buyer);
    if (!negotiation) continue;
    const offer = { fee: Math.round(ask * 0.75), sellOn: 0, instalments: 1 };
    let refusedOnce = false;
    let firstTime = 0;
    for (let i = 0; i < 40; i++) {
      const r = transferOffer(game, negotiation, offer);
      rounds++;
      // An offer accepted straight away is a fair offer, not an exploit. What
      // must never happen is the SAME offer being refused and then, through
      // nothing but repetition, accepted.
      if (r.outcome === 'accepted') { if (refusedOnce) won++; else firstTime++; break; }
      if (r.outcome === 'collapsed') { collapsed++; break; }
      refusedOnce = true;
    }
    accepted += firstTime;
  }
  line('an offer once refused is never accepted by repeating it', won === 0,
    `${won} ground out, ${accepted} fair offers taken first time, ${collapsed} walked away`);
  line('repeating a refused offer ends in a walk-away', collapsed >= TRIALS - accepted,
    `${collapsed} of the ${TRIALS - accepted} that were refused`);
}

// --- 2. Nor does creeping up in tiny steps -----------------------------------
// The old exploit precisely: raise the number by a sliver and click again.
{
  const { game, buyer } = fresh(77);
  let won = 0; let collapsed = 0; const paid = [];
  for (const { p, ask } of targets(game, buyer, TRIALS)) {
    const { negotiation } = openTransferTalks(game, p, buyer);
    if (!negotiation) continue;
    let fee = Math.round(ask * 0.6);
    for (let i = 0; i < 40; i++) {
      const r = transferOffer(game, negotiation, { fee, sellOn: 0, instalments: 1 });
      if (r.outcome === 'accepted') { won++; paid.push(fee / ask); break; }
      if (r.outcome === 'collapsed') { collapsed++; break; }
      fee = Math.round(fee * 1.02);
    }
  }
  const mean = paid.length ? paid.reduce((a, b) => a + b, 0) / paid.length : 0;
  // Creeping is allowed to work sometimes - a patient bidder should be able to
  // find a price - but it must not find a discount, and it must cost talks.
  line('creeping up in 2% steps runs out of patience more often than not',
    collapsed > won, `${won} signed, ${collapsed} walked away`);
  line('a creeper does not win a discount', mean === 0 || mean > 0.85,
    paid.length ? `paid ${(mean * 100).toFixed(0)}% of the asking price on average` : 'never got there');
}

// --- 3. Negotiating properly still works -------------------------------------
// The fix must not make the market unusable. Open sensibly, listen to the
// counter, meet it.
{
  const { game, buyer } = fresh(918);
  let won = 0; let collapsed = 0; const rounds = [];
  for (const { p, ask } of targets(game, buyer, TRIALS)) {
    const { negotiation } = openTransferTalks(game, p, buyer);
    if (!negotiation) continue;
    let fee = Math.round(ask * 0.9);
    for (let i = 0; i < 10; i++) {
      const r = transferOffer(game, negotiation, { fee, sellOn: 0, instalments: 1 });
      if (r.outcome === 'accepted') { won++; rounds.push(i + 1); break; }
      if (r.outcome === 'collapsed') { collapsed++; break; }
      if (r.counter) fee = r.counter;
    }
  }
  line('meeting their counter gets the deal done', won > TRIALS * 0.8,
    `${won}/${TRIALS} signed in ${(rounds.reduce((a, b) => a + b, 0) / Math.max(1, rounds.length)).toFixed(1)} rounds`);
}

// --- 4. Clauses are currency -------------------------------------------------
// Conceding a sell-on has to buy a lower cash fee, by a measurable amount, or
// the clause is decoration.
{
  const { game, buyer } = fresh(3131);
  const plain = []; const withClause = [];
  for (const { p, ask } of targets(game, buyer, TRIALS)) {
    // Same seller, same player, same seed: the only difference is the clause.
    const lowest = (clause) => {
      let lo = 0; let hi = ask * 2.2;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const g2 = { ...game, negotiations: {} };
        const { negotiation } = openTransferTalks(g2, p, buyer);
        if (!negotiation) return null;
        const r = transferOffer(g2, negotiation, { fee: mid, ...clause });
        if (r.outcome === 'accepted') hi = mid; else lo = mid;
      }
      return hi;
    };
    const a = lowest({ sellOn: 0, instalments: 1 });
    const b = lowest({ sellOn: 25, instalments: 1 });
    if (a && b) { plain.push(a); withClause.push(b); }
  }
  const mA = plain.reduce((a, b) => a + b, 0) / Math.max(1, plain.length);
  const mB = withClause.reduce((a, b) => a + b, 0) / Math.max(1, withClause.length);
  line('a 25% sell-on buys a lower cash fee', mB < mA * 0.98,
    `${fmt(mA)} -> ${fmt(mB)} (${((1 - mB / mA) * 100).toFixed(0)}% less cash)`);

  // ...and paying in instalments costs you, because the seller wants the money
  // now. A clause that only ever helps the buyer is a free lunch, not a lever.
  const inst = [];
  for (const { p, ask } of targets(game, buyer, 40)) {
    const lowest = (clause) => {
      let lo = 0; let hi = ask * 2.6;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const g2 = { ...game, negotiations: {} };
        const { negotiation } = openTransferTalks(g2, p, buyer);
        if (!negotiation) return null;
        if (transferOffer(g2, negotiation, { fee: mid, ...clause }).outcome === 'accepted') hi = mid; else lo = mid;
      }
      return hi;
    };
    const a = lowest({ sellOn: 0, instalments: 1 });
    const b = lowest({ sellOn: 0, instalments: 4 });
    if (a && b) inst.push(b / a);
  }
  const mI = inst.reduce((a, b) => a + b, 0) / Math.max(1, inst.length);
  line('spreading the fee over four years costs more overall', mI > 1.02,
    `${((mI - 1) * 100).toFixed(0)}% more face value`);
}

// --- 5. Personal terms are no longer free ------------------------------------
// The measured defect: 43% of players would sign for under a tenth of their
// demand because the money term was floored while its opposition was not.
{
  const world = generateWorld({ seed: 4242, size: 'small' });
  const top = world.leagues.find((l) => l.tier === 1);
  const club = world.clubs[top.clubIds[3]];
  const sample = Object.values(world.players).filter((p) => p.clubId && p.clubId !== club.id).slice(0, 1200);
  const shares = [];
  for (const p of sample) {
    const demand = contractDemand(world, p, club);
    const offer = { wage: demand.wage, years: demand.years, promisedRole: 'key' };
    if (!evaluateContract(world, p, club, offer).accepted) continue;
    let lo = 0; let hi = demand.wage;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (evaluateContract(world, p, club, { ...offer, wage: mid }).accepted) hi = mid; else lo = mid;
    }
    shares.push(hi / demand.wage);
  }
  shares.sort((a, b) => a - b);
  const under = (f) => shares.filter((s) => s < f).length / shares.length;
  line('nobody signs for under a tenth of what he asked for', under(0.1) === 0,
    `${(under(0.1) * 100).toFixed(0)}% would`);
  line('the median player will not take less than two thirds',
    shares[Math.floor(shares.length / 2)] > 0.66,
    `median floor ${(shares[Math.floor(shares.length / 2)] * 100).toFixed(0)}% of demand, `
    + `p10 ${(shares[Math.floor(shares.length * 0.1)] * 100).toFixed(0)}%`);
}

// --- 6. Quitting to the menu is not a reset ----------------------------------
// The reserve price persists, so it has to survive a save. If it did not, every
// exploit above would come back by way of the load button.
{
  const { game, buyer } = fresh(5150);
  const { p, ask } = targets(game, buyer, 1)[0];
  const { negotiation } = openTransferTalks(game, p, buyer);
  transferOffer(game, negotiation, { fee: Math.round(ask * 0.4), sellOn: 0, instalments: 1 });
  const hardened = negotiation.reserve;
  const patience = negotiation.patience;
  const restored = deserialiseGame(JSON.parse(JSON.stringify(serialiseGame(game))));
  const back = restored.negotiations[negotiation.id];
  line('a saved negotiation remembers the hardened reserve',
    !!back && back.reserve === hardened && back.patience === patience,
    back ? `reserve ${fmt(back.reserve)}, patience ${back.patience}` : 'lost on save');
}

// --- 7. Walking away means something -----------------------------------------
{
  const { game, buyer } = fresh(6161);
  const { p } = targets(game, buyer, 1)[0];
  const { negotiation } = openTransferTalks(game, p, buyer);
  for (let i = 0; i < 20 && negotiation.status === 'open'; i++) {
    transferOffer(game, negotiation, { fee: 1000, sellOn: 0, instalments: 1 });
  }
  const collapsed = negotiation.status === 'collapsed';
  const blocked = openTransferTalks(game, p, buyer);
  line('after a walk-away they refuse to reopen', collapsed && !!blocked.error,
    blocked.error || 'reopened immediately');
  game.day += COOLING_OFF_DAYS;
  const later = openTransferTalks(game, p, buyer);
  line(`talks can be reopened after ${COOLING_OFF_DAYS} days`, !!later.negotiation && !later.error,
    later.error || 'reopened');
}

// --- Summary -----------------------------------------------------------------
const failed = rows.filter((r) => !r.ok);
console.log('\n--- Summary ---');
if (failed.length) {
  console.log('Exploits that still work, or behaviour that broke:');
  for (const f of failed) console.log(`  ${f.label}`);
  process.exitCode = 1;
} else {
  console.log(`${rows.length} checks: every grinding strategy tried above fails, `
    + 'and negotiating in good faith still gets deals done.');
}

function fmt(n) {
  if (n >= 1e6) return `£${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `£${Math.round(n / 1e3)}K`;
  return `£${Math.round(n)}`;
}
