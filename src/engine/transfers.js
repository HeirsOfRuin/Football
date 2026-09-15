// The transfer market: valuations, offers, contracts, loans and AI activity.

import { clamp, remap, sortBy } from '../core/util.js';
import { currentAbility, abilityForPosition, positionEffectiveness } from '../data/attributes.js';
import { estimateValue, estimateWage } from '../gen/playergen.js';
import { squadDepth, registrationLimit, refreshRegistration } from './lineup.js';
import { weeklyWageBill, ledgerEntry } from './finance.js';
import { abilityForReputation } from '../data/nations.js';
import { expectedRole } from './training.js';

/**
 * What a player is worth, from ability, age, form and recent performances.
 *
 * This is the single derivation of a player's worth in the game: every screen
 * that shows a value and every decision that acts on one comes through here.
 * Keeping a second, stored figure alongside it is how a squad list ends up
 * disagreeing with the transfer market.
 */
export function marketValue(world, player) {
  const club = player.clubId ? world.clubs[player.clubId] : null;
  const league = club ? world.leagues.find((l) => l.id === club.leagueId) : null;
  const base = estimateValue(currentAbility(player), player.pa, player.age, league?.rep ?? 55);
  const form = clamp(1 + (player.form ?? 0) * 0.05, 0.85, 1.2);
  const seasonBoost = player.season?.apps > 8
    ? clamp(1 + ((player.season.ratingSum / Math.max(1, player.season.ratingCount)) - 6.7) * 0.14, 0.85, 1.25)
    : 1;
  return Math.max(0, Math.round(base * form * seasonBoost / 5000) * 5000);
}

/**
 * What the selling club wants for him — the player's worth, discounted by how
 * little contract is left to run and adjusted for how badly they want to keep
 * him. A free agent costs nothing, however much he is worth.
 */
export function askingPrice(world, player) {
  const club = player.clubId ? world.clubs[player.clubId] : null;
  const value = marketValue(world, player);
  if (!club) return 0;
  const left = player.contract ? player.contract.expiresYear - world.year : 0;
  const contractMult = left <= 0 ? 0.28 : left === 1 ? 0.62 : left === 2 ? 0.9 : 1;
  const role = expectedRole(world, club, player);
  const premium = { key: 1.85, rotation: 1.4, squad: 1.15, fringe: 0.92 }[role] ?? 1.2;
  const listed = player.transferStatus === 'listed' ? 0.8 : 1;
  const unhappy = player.unhappy ? 0.85 : 1;
  const youth = player.age <= 21 && player.pa - currentAbility(player) > 25 ? 1.25 : 1;
  return Math.round(value * contractMult * premium * listed * unhappy * youth / 5000) * 5000;
}

/** Does the selling club accept this fee? */
export function evaluateOffer(world, player, fee, buyerClub) {
  const seller = world.clubs[player.clubId];
  if (!seller) return { accepted: fee >= 0, reason: 'free agent' };
  if (player.contract?.releaseClause && fee >= player.contract.releaseClause) {
    return { accepted: true, reason: 'release clause met' };
  }
  const ask = askingPrice(world, player);
  const desperation = seller.finances.balance < 0 ? 0.85 : 1;
  const depth = seller.squad.filter((id) => {
    const p = world.players[id];
    return p && p.id !== player.id && positionEffectiveness(p, player.positions[0]) > 0.9;
  }).length;
  const depthFactor = depth >= 3 ? 0.9 : depth >= 2 ? 1 : 1.15;
  const threshold = ask * desperation * depthFactor;
  if (fee >= threshold) return { accepted: true, reason: 'fee accepted', threshold };
  if (fee >= threshold * 0.88) return { accepted: false, reason: 'close', counter: Math.round(threshold / 5000) * 5000, threshold };
  return { accepted: false, reason: 'rejected', counter: Math.round(threshold / 5000) * 5000, threshold };
}

/** What the player wants to sign for. */
export function contractDemand(world, player, club) {
  const league = world.leagues.find((l) => l.id === club.leagueId);
  const ca = currentAbility(player);
  const base = estimateWage(ca, player.age, club.rep, world.nations.find((n) => n.id === club.nation)?.wealth ?? 0.7);
  const ambition = remap(player.hidden?.ambition ?? 10, 1, 20, 0.92, 1.18);
  const potential = clamp(1 + (player.pa - ca) / 260, 1, 1.2);
  const current = player.contract?.wage ?? 0;
  const wage = Math.max(base * ambition * potential, current * 1.12);
  const years = player.age >= 32 ? 2 : player.age <= 21 ? 4 : 3;
  return {
    wage: Math.round(wage / 50) * 50,
    years,
    signingBonus: Math.round(wage * 12 * remap(player.hidden?.loyalty ?? 10, 1, 20, 1.4, 0.6)),
    releaseClauseExpected: (player.hidden?.ambition ?? 10) > 15,
  };
}

const ROLE_RANK = { key: 3, rotation: 2, squad: 1, fringe: 0 };

/**
 * Will the player agree to join? Money, ambition and playing time are the
 * three levers; loyalty only bites on players who are settled and playing.
 */
export function evaluateContract(world, player, club, offer) {
  const demand = contractDemand(world, player, club);
  const currentClub = player.clubId ? world.clubs[player.clubId] : null;
  let score = 6; // a genuine offer starts with the benefit of the doubt

  // The money term used to be clamp((ratio - 1) * 120, -60, 45). The floor was
  // the defect: a shortfall could never cost more than 60 points while the
  // bonuses below - a step up in reputation, a promised role, being listed or
  // unhappy - are not bounded at all and routinely sum past it. Measured across
  // 1,187 players, 43% would sign for under a tenth of the wage they had just
  // asked for, and the median signed for 55% of it. Above the demand this is
  // arithmetically identical to what it replaces, so the AI clubs - which only
  // ever offer 1.02 to 1.2 times the demand - are unaffected; below it, the cost
  // of a cut now grows until it cannot be outvoted.
  const ratio = offer.wage / Math.max(1, demand.wage);
  score += ratio >= 1
    ? Math.min(45, (ratio - 1) * 120)
    : -((1 - ratio) ** 1.4) * 420;

  const repGain = club.rep - (currentClub?.rep ?? 30);
  score += repGain * remap(player.hidden?.ambition ?? 10, 1, 20, 0.5, 1.6);

  const expected = currentClub ? expectedRole(world, currentClub, player) : 'fringe';
  const role = offer.promisedRole || 'rotation';
  score += ((ROLE_RANK[role] ?? 1) - (ROLE_RANK[expected] ?? 1)) * 11;

  // Settled players who are playing take more persuading.
  if (currentClub) {
    const settled = expected === 'key' ? 1 : expected === 'rotation' ? 0.7 : 0.3;
    score -= remap(player.hidden?.loyalty ?? 10, 1, 20, 2, 20) * settled;
  }

  if (player.transferStatus === 'listed') score += 20;
  if (player.unhappy) score += 16;
  if ((player.morale ?? 60) < 40) score += 8;
  if (player.contract && player.contract.expiresYear - world.year <= 1) score += 10;
  if (player.nat === club.nation) score += 7;
  else score += remap(player.hidden?.adaptability ?? 10, 1, 20, -9, 6);

  const accepted = score > 0;
  return {
    accepted,
    score,
    demand,
    reason: accepted ? 'agreed'
      : offer.wage < demand.wage * 0.95 ? 'wants more money'
        : repGain < -10 ? 'sees it as a step down'
          : (ROLE_RANK[role] ?? 1) < (ROLE_RANK[expected] ?? 1) ? 'wants regular football'
            : 'not convinced by the project',
  };
}

export function completeTransfer(game, player, fromClubId, toClubId, fee, contract, extra = {}) {
  const world = game.world;
  const from = fromClubId ? world.clubs[fromClubId] : null;
  const to = world.clubs[toClubId];
  if (!to) return false;

  if (from) {
    // Both lists: a player leaving a club must leave whichever one he was in.
    from.squad = from.squad.filter((id) => id !== player.id);
    if (from.youthSquad) from.youthSquad = from.youthSquad.filter((id) => id !== player.id);
    if (fee > 0) {
      from.finances.balance += fee;
      from.finances.seasonIncome += fee;
      from.finances.ledger.push({ day: game.day, label: `Sold ${player.name} to ${to.short}`, amount: fee, category: 'transfer' });
      from.finances.transferBudget += Math.round(fee * 0.75);
    }
  } else {
    world.freeAgents = world.freeAgents.filter((id) => id !== player.id);
  }

  if (fee > 0) {
    to.finances.balance -= fee;
    to.finances.seasonSpend += fee;
    to.finances.transferBudget = Math.max(0, to.finances.transferBudget - fee);
    to.finances.ledger.push({ day: game.day, label: `Signed ${player.name}${from ? ` from ${from.short}` : ''}`, amount: -fee, category: 'transfer' });
  }

  // An old sell-on clause falls due. This is what makes conceding one a real
  // cost rather than a discount with no consequence: the club he came from
  // takes their share of this sale before the selling club sees it.
  const owed = player.contract?.sellOn && player.contract.sellOnClub && fee > 0
    ? world.clubs[player.contract.sellOnClub] : null;
  if (owed && from && owed.id !== from.id) {
    const share = Math.round(fee * (player.contract.sellOn / 100));
    if (share > 0) {
      from.finances.balance -= share;
      from.finances.ledger.push({ day: game.day, label: `Sell-on clause: ${player.name}`, amount: -share, category: 'transfer' });
      owed.finances.balance += share;
      owed.finances.seasonIncome += share;
      owed.finances.ledger.push({ day: game.day, label: `Sell-on clause: ${player.name}`, amount: share, category: 'transfer' });
    }
  }

  player.clubId = to.id;
  player.contract = {
    wage: contract.wage,
    expiresYear: world.year + contract.years,
    signedYear: world.year,
    releaseClause: contract.releaseClause || 0,
    goalBonus: contract.goalBonus || 0,
    appearanceFee: contract.appearanceFee || 0,
    loanedFrom: extra.loanFrom || null,
    loanUntilYear: extra.loanUntil || null,
    wageShare: extra.wageShare ?? null,
    // A sell-on concession follows the player, not the deal that created it.
    sellOn: extra.sellOn || 0,
    sellOnClub: extra.sellOn && from ? from.id : null,
  };
  player.transferStatus = 'none';
  player.unhappy = null;
  player.morale = clamp(player.morale + 12, 0, 100);
  to.squad.push(player.id);
  // Both squads changed, so both registration caches are stale. Leaving them
  // is how a sold player keeps turning out for his old club.
  refreshRegistration(world, to);
  if (from) refreshRegistration(world, from);
  assignFreeNumber(world, to, player);

  game.transferLog.push({
    day: game.day, season: game.season, playerId: player.id, name: player.name,
    from: from ? from.short : 'Free agent', to: to.short, fee, loan: !!extra.loanFrom,
  });
  return true;
}

/**
 * Send a player out on loan.
 *
 * Deliberately not `completeTransfer` with a flag: a loan leaves ownership
 * where it is, and every one of the things a transfer does to the selling club -
 * banking a fee, topping up the transfer budget, writing a line in the transfer
 * log as a sale - would be wrong here.
 */
export function completeLoan(game, player, fromId, toId, terms) {
  const world = game.world;
  const from = world.clubs[fromId];
  const to = world.clubs[toId];
  if (!from || !to || !player.contract) return false;

  from.squad = from.squad.filter((id) => id !== player.id);
  from.loanedOut = [...(from.loanedOut || []), player.id];
  to.squad.push(player.id);
  player.clubId = to.id;
  player.contract.loanedFrom = from.id;
  player.contract.loanUntilYear = world.year + 1;
  player.contract.loanUntilDay = terms.until ?? null;
  player.contract.wageShare = clamp(terms.wageShare ?? 0.5, 0, 1);

  const fee = Math.max(0, terms.fee || 0);
  if (fee > 0) {
    to.finances.balance -= fee;
    to.finances.seasonSpend += fee;
    ledgerEntry(to, game.day, `Loan fee: ${player.name}`, -fee, 'transfer');
    from.finances.balance += fee;
    from.finances.seasonIncome += fee;
    ledgerEntry(from, game.day, `Loan fee: ${player.name}`, fee, 'transfer');
  }

  refreshRegistration(world, to);
  refreshRegistration(world, from);
  assignFreeNumber(world, to, player);
  game.transferLog.push({
    day: game.day, season: game.season, playerId: player.id, name: player.name,
    from: from.short, to: to.short, fee, loan: true,
  });
  return true;
}

/** A loan ends: he goes back, on the contract he never stopped being on. */
export function returnFromLoan(game, player) {
  const world = game.world;
  const parent = player.contract?.loanedFrom ? world.clubs[player.contract.loanedFrom] : null;
  const borrower = player.clubId ? world.clubs[player.clubId] : null;
  if (!parent) return false;
  if (borrower) borrower.squad = borrower.squad.filter((id) => id !== player.id);
  parent.loanedOut = (parent.loanedOut || []).filter((id) => id !== player.id);
  if (!parent.squad.includes(player.id)) parent.squad.push(player.id);
  player.clubId = parent.id;
  player.contract.loanedFrom = null;
  player.contract.loanUntilYear = null;
  player.contract.loanUntilDay = null;
  player.contract.wageShare = null;
  refreshRegistration(world, parent);
  if (borrower) refreshRegistration(world, borrower);
  assignFreeNumber(world, parent, player);
  return true;
}

function assignFreeNumber(world, club, player) {
  const taken = new Set(club.squad.map((id) => world.players[id]?.squadNumber).filter(Boolean));
  for (let n = 1; n <= 60; n++) {
    if (!taken.has(n)) { player.squadNumber = n; return; }
  }
  player.squadNumber = 99;
}

// --- AI transfer behaviour --------------------------------------------------

/**
 * Where a club would most like to strengthen. Clubs act on outright gaps in
 * the squad, on positions weaker than their level demands, and on thin depth —
 * so a well-stocked side still looks to upgrade rather than sitting still.
 */
export function identifyNeed(world, club) {
  const depth = squadDepth(world, club);
  const targetLevel = abilityForReputation(club.rep);
  const needs = [];
  const required = { GK: 2, DC: 3, DL: 2, DR: 2, DM: 2, MC: 3, ML: 1, MR: 1, AML: 1, AMR: 1, AMC: 1, ST: 2 };
  for (const pos in required) {
    const d = depth[pos];
    const shortfall = Math.max(0, required[pos] - d.count) * 25;
    const qualityGap = Math.max(0, targetLevel - d.best) * 1.2;
    const depthGap = Math.max(0, targetLevel * 0.88 - d.avg) * 0.7;
    needs.push({ pos, score: shortfall + qualityGap + depthGap, depth: d, targetLevel });
  }
  return sortBy(needs, { key: (n) => n.score, desc: true });
}

function affordable(world, club, player, fee, wageRoom) {
  const demand = contractDemand(world, player, club);
  return fee <= club.finances.transferBudget && demand.wage <= wageRoom * 0.92;
}

/**
 * Ability-banded index of everyone who could plausibly move, rebuilt once a
 * day. The AI used to allocate an array of every player in the world on every
 * single attempt, sample 650 of them, and then throw almost all of them away on
 * an ability test it could have made before looking. Banding by ability means a
 * club only ever sees players somewhere near its own level, which is both far
 * cheaper and the reason an amateur side no longer window-shops in the top
 * flight.
 */
const BAND_SIZE = 12;

function transferIndex(game) {
  const world = game.world;
  const cached = game._transferIndex;
  // Keyed on the user's club too: it is baked into the index below, and a
  // takeover mid-day would otherwise leave the new user club's players on the
  // market for the rest of it.
  if (cached && cached.day === game.day && cached.season === game.season
      && cached.userClubId === game.userClubId) return cached;
  const bands = new Map();
  for (const id in world.players) {
    const p = world.players[id];
    if (!p) continue;
    if (p.contract?.loanedFrom) continue;
    if (p.clubId && world.clubs[p.clubId]?.isUserClub) continue; // the user handles their own sales
    // Scholars are not on the open market. Without this a club could "sign" a
    // player out of another club's academy: completeTransfer would filter him
    // from a first-team squad he was never in, and he would end up listed by two
    // clubs at once - which is exactly what happened, four players a season,
    // compounding every year.
    if (p.clubId && world.clubs[p.clubId]?.youthSquad?.includes(p.id)) continue;
    const b = Math.floor(currentAbility(p) / BAND_SIZE);
    const list = bands.get(b);
    if (list) list.push(p);
    else bands.set(b, [p]);
  }
  const idx = { day: game.day, season: game.season, userClubId: game.userClubId, bands };
  game._transferIndex = idx;
  return idx;
}

/**
 * Sample players around a club's level. The window is deliberately wider than
 * the ability test that follows: the index bands on a player's ability in his
 * natural position, while the caller tests his ability in the position actually
 * being filled, and the two differ. Sampling walks the bands by offset rather
 * than concatenating them, because at the bottom of the pyramid the window
 * holds most of the world and concatenating would reintroduce the allocation
 * this exists to avoid.
 */
function sampleNearLevel(game, targetLevel, rng, want) {
  const { bands } = transferIndex(game);
  const lo = Math.floor((targetLevel - 42) / BAND_SIZE);
  const hi = Math.floor((targetLevel + 30) / BAND_SIZE);
  const lists = [];
  let total = 0;
  for (let b = lo; b <= hi; b++) {
    const list = bands.get(b);
    if (!list || !list.length) continue;
    lists.push(list);
    total += list.length;
  }
  if (!total) return [];
  const out = [];
  const n = Math.min(total, want);
  for (let i = 0; i < n; i++) {
    let k = rng.int(0, total - 1);
    for (const list of lists) {
      if (k < list.length) { out.push(list[k]); break; }
      k -= list.length;
    }
  }
  return out;
}

/** How the buying club would rank a signing inside its own squad. */
function promisedRoleFor(world, club, ability) {
  const abilities = club.squad.map((id) => currentAbility(world.players[id])).sort((a, b) => b - a);
  const rank = abilities.filter((a) => a > ability).length;
  if (rank < 6) return 'key';
  if (rank < 13) return 'rotation';
  if (rank < 19) return 'squad';
  return 'fringe';
}

/** One AI club's attempt to improve itself. Returns a completed deal or null. */
export function aiTransferAttempt(game, club, rng) {
  const world = game.world;
  // Sized from the club's own status rather than a flat 32: an amateur side does
  // not carry a Premier League squad, and until now every function had its own
  // idea of how big a squad was.
  if (club.squad.length >= registrationLimit(club) + 6) return null;
  const needs = identifyNeed(world, club);
  const top = needs.filter((n) => n.score > 2).slice(0, 4);
  if (!top.length) return null;
  const need = rng.weighted(top, (n) => n.score);
  const targetLevel = need.targetLevel;

  // Computed once: it depends on the buying club, not on the player being
  // looked at, and recomputing it per candidate walked the whole squad 650
  // times an attempt.
  const wageRoom = club.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, club);

  const candidates = [];
  for (const p of sampleNearLevel(game, targetLevel, rng, 260)) {
    if (p.clubId === club.id) continue;
    if (positionEffectiveness(p, need.pos) < 0.88) continue;
    const ability = abilityForPosition(p.attrs, need.pos);
    // Must improve the position, or add depth behind a thin first choice.
    const improves = ability > need.depth.best - 3 || (need.depth.count < 2 && ability > need.depth.avg * 0.9);
    if (!improves) continue;
    if (ability > targetLevel + 24) continue;
    const fee = p.clubId ? askingPrice(world, p) : 0;
    if (!affordable(world, club, p, fee, wageRoom)) continue;
    candidates.push({ p, ability, fee });
  }
  if (!candidates.length) return null;

  const shortlist = sortBy(candidates, { key: (c) => c.ability - c.fee / 6e6, desc: true }).slice(0, 5);
  const best = rng.weighted(shortlist, (c) => Math.max(1, c.ability));
  const player = best.p;

  const demand = contractDemand(world, player, club);
  const contractOffer = {
    wage: Math.round(demand.wage * rng.range(1.02, 1.2)),
    years: demand.years,
    promisedRole: promisedRoleFor(world, club, best.ability),
  };

  if (player.clubId) {
    const seller = world.clubs[player.clubId];
    if (!seller) return null;
    // Don't leave the selling club without cover.
    const sellerDepth = seller.squad.filter((id) => {
      const q = world.players[id];
      return q && q.id !== player.id && positionEffectiveness(q, player.positions[0]) > 0.9;
    }).length;
    if (sellerDepth < 1 && player.transferStatus !== 'listed') return null;

    let offer = Math.round(best.fee * rng.range(0.96, 1.15) / 5000) * 5000;
    let verdict = evaluateOffer(world, player, offer, club);
    if (!verdict.accepted && verdict.counter && verdict.counter <= club.finances.transferBudget && rng.chance(0.6)) {
      offer = verdict.counter;
      verdict = evaluateOffer(world, player, offer, club);
    }
    if (!verdict.accepted) return null;

    const agree = evaluateContract(world, player, club, contractOffer);
    if (!agree.accepted) return null;
    completeTransfer(game, player, player.clubId, club.id, offer, contractOffer);
    return { player, fee: offer, from: seller, to: club };
  }

  const agree = evaluateContract(world, player, club, contractOffer);
  if (!agree.accepted) return null;
  completeTransfer(game, player, null, club.id, 0, contractOffer);
  return { player, fee: 0, from: null, to: club };
}

/**
 * A club sends a young player out for a season's football.
 *
 * Without this, loans exist only for the user, and a mechanic that only one
 * club in the world uses is not part of the world. The test is the real one:
 * a promising player who is not getting a game, lent to a smaller club that
 * needs the position.
 */
export function aiLoanAttempt(game, club, rng) {
  const world = game.world;
  const candidates = club.squad.map((id) => world.players[id]).filter((p) => {
    if (!p?.contract || p.contract.loanedFrom) return false;
    if (p.age > 23 || p.age < 17) return false;
    // Worth developing, and not currently developing here.
    if (p.pa - currentAbility(p) < 12) return false;
    return expectedRole(world, club, p) === 'fringe';
  });
  if (!candidates.length) return null;
  const player = rng.pick(candidates);

  // Somewhere smaller, that needs this position, and can carry a share.
  const suitors = Object.values(world.clubs).filter((c) => {
    if (c.id === club.id || c.affiliateOf || c.isUserClub) return false;
    if (c.rep >= club.rep - 4) return false;
    if (c.squad.length >= registrationLimit(c)) return false;
    return currentAbility(player) > abilityForReputation(c.rep) - 10;
  });
  if (!suitors.length) return null;
  const to = rng.weighted(suitors.slice(0, 40), (c) => Math.max(1, c.rep));
  const need = identifyNeed(world, to).slice(0, 4);
  if (!need.some((n) => positionEffectiveness(player, n.pos) > 0.88)) return null;

  const share = rng.pick([0.25, 0.5, 0.75]);
  const room = to.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, to);
  if (player.contract.wage * share > room) return null;
  if (!completeLoan(game, player, club.id, to.id, { wageShare: share, fee: 0 })) return null;
  return { player, from: club, to, share };
}

/** AI clubs offload players they do not need. */
export function aiSquadTrim(game, club, rng) {
  const world = game.world;
  if (club.squad.length <= registrationLimit(club)) return null;
  const players = club.squad.map((id) => world.players[id]).filter(Boolean);
  const surplus = players.filter((p) => {
    const role = expectedRole(world, club, p);
    return role === 'fringe' && p.age >= 22 && !p.contract?.loanedFrom && p.transferStatus !== 'listed';
  });
  if (!surplus.length) return null;
  const p = sortBy(surplus, { key: (x) => currentAbility(x) })[0];
  p.transferStatus = 'listed';
  return p;
}

/**
 * Between seasons, clubs carrying too many bodies let the weakest go rather
 * than accumulating an endless academy backlog.
 */
export function aiReleaseSurplus(game, club, rng, maxSquad = null) {
  const world = game.world;
  const cap = maxSquad ?? registrationLimit(club) + 4;
  if (club.squad.length <= cap) return [];
  const players = club.squad.map((id) => world.players[id]).filter(Boolean);
  const ranked = sortBy(players, { key: (p) => currentAbility(p) + (p.pa - currentAbility(p)) * 0.7 });
  const released = [];
  for (const p of ranked) {
    if (club.squad.length <= cap) break;
    if (p.age <= 18 && p.pa > currentAbility(p) + 35) continue; // keep the real prospects
    releasePlayer(game, p);
    released.push(p);
  }
  return released;
}

/** Contracts that expire this summer. */
export function expiringContracts(world, club) {
  return club.squad
    .map((id) => world.players[id])
    .filter((p) => p?.contract && p.contract.expiresYear <= world.year);
}

export function renewContract(world, player, offer) {
  player.contract = {
    ...player.contract,
    wage: offer.wage,
    expiresYear: world.year + offer.years,
    signedYear: world.year,
    releaseClause: offer.releaseClause ?? player.contract.releaseClause ?? 0,
  };
  player.morale = clamp(player.morale + 8, 0, 100);
  player.unhappy = null;
  return player.contract;
}

/** Release a player to the free agent pool. */
export function releasePlayer(game, player) {
  const world = game.world;
  const club = world.clubs[player.clubId];
  if (club) {
    club.squad = club.squad.filter((id) => id !== player.id);
    if (club.youthSquad) club.youthSquad = club.youthSquad.filter((id) => id !== player.id);
    refreshRegistration(world, club);
  }
  player.clubId = null;
  player.contract = null;
  player.squadNumber = null;
  player.transferStatus = 'none';
  if (!world.freeAgents.includes(player.id)) world.freeAgents.push(player.id);
}

/** Scout report accuracy depends on the club's scouting network. */
export function scoutReport(world, club, player, rng) {
  const accuracy = remap(club.facilities?.scouting ?? 10, 1, 20, 0.32, 0.94);
  const ca = currentAbility(player);
  const noise = (1 - accuracy) * 40;
  return {
    abilityLow: Math.round(clamp(ca - rng.range(0, noise), 1, 200)),
    abilityHigh: Math.round(clamp(ca + rng.range(0, noise), 1, 200)),
    potentialLow: Math.round(clamp(player.pa - rng.range(0, noise * 1.6), 1, 200)),
    potentialHigh: Math.round(clamp(player.pa + rng.range(0, noise * 1.6), 1, 200)),
    accuracy,
    knownPersonality: accuracy > 0.55 ? player.personality : 'Unknown',
  };
}
