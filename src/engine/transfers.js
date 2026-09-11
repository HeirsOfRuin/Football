// The transfer market: valuations, offers, contracts, loans and AI activity.

import { clamp, remap, sortBy } from '../core/util.js';
import { currentAbility, abilityForPosition, positionEffectiveness } from '../data/attributes.js';
import { estimateValue, estimateWage } from '../gen/playergen.js';
import { squadDepth } from './lineup.js';
import { weeklyWageBill } from './finance.js';
import { expectedRole } from './training.js';

/** Current market value, refreshed from ability, age, form and contract. */
export function marketValue(world, player) {
  const club = player.clubId ? world.clubs[player.clubId] : null;
  const league = club ? world.leagues.find((l) => l.id === club.leagueId) : null;
  const base = estimateValue(currentAbility(player), player.pa, player.age, league?.rep ?? 55);
  const form = clamp(1 + (player.form ?? 0) * 0.05, 0.85, 1.2);
  const seasonBoost = player.season?.apps > 8
    ? clamp(1 + ((player.season.ratingSum / Math.max(1, player.season.ratingCount)) - 6.7) * 0.14, 0.85, 1.25)
    : 1;
  let contractMult = 1;
  if (player.contract) {
    const left = player.contract.expiresYear - world.year;
    contractMult = left <= 0 ? 0.28 : left === 1 ? 0.62 : left === 2 ? 0.9 : 1;
  } else {
    contractMult = 0; // free agent
  }
  return Math.max(0, Math.round(base * form * seasonBoost * contractMult / 5000) * 5000);
}

/** What the selling club actually wants — usually above raw market value. */
export function askingPrice(world, player) {
  const club = player.clubId ? world.clubs[player.clubId] : null;
  const value = marketValue(world, player);
  if (!club) return 0;
  const role = expectedRole(world, club, player);
  const premium = { key: 1.85, rotation: 1.4, squad: 1.15, fringe: 0.92 }[role] ?? 1.2;
  const listed = player.transferStatus === 'listed' ? 0.8 : 1;
  const unhappy = player.unhappy ? 0.85 : 1;
  const youth = player.age <= 21 && player.pa - currentAbility(player) > 25 ? 1.25 : 1;
  return Math.round(value * premium * listed * unhappy * youth / 5000) * 5000;
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

  score += clamp((offer.wage / demand.wage - 1) * 120, -60, 45);

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
    from.squad = from.squad.filter((id) => id !== player.id);
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
  };
  player.transferStatus = 'none';
  player.unhappy = null;
  player.morale = clamp(player.morale + 12, 0, 100);
  to.squad.push(player.id);
  assignFreeNumber(world, to, player);

  game.transferLog.push({
    day: game.day, season: game.season, playerId: player.id, name: player.name,
    from: from ? from.short : 'Free agent', to: to.short, fee, loan: !!extra.loanFrom,
  });
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
  const targetLevel = remap(club.rep, 20, 99, 52, 156);
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

function affordable(world, club, player, fee) {
  const wageRoom = club.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, club);
  const demand = contractDemand(world, player, club);
  return fee <= club.finances.transferBudget && demand.wage <= wageRoom * 0.92;
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
  if (club.squad.length >= 32) return null;
  const needs = identifyNeed(world, club);
  const top = needs.filter((n) => n.score > 2).slice(0, 4);
  if (!top.length) return null;
  const need = rng.weighted(top, (n) => n.score);
  const targetLevel = need.targetLevel;

  const candidates = [];
  const pool = Object.values(world.players);
  const sampleSize = Math.min(pool.length, 650);
  for (let i = 0; i < sampleSize; i++) {
    const p = pool[rng.int(0, pool.length - 1)];
    if (!p || p.clubId === club.id) continue;
    if (p.contract?.loanedFrom) continue;
    if (p.clubId && world.clubs[p.clubId]?.isUserClub) continue; // the user handles their own sales
    if (positionEffectiveness(p, need.pos) < 0.88) continue;
    const ability = abilityForPosition(p.attrs, need.pos);
    // Must improve the position, or add depth behind a thin first choice.
    const improves = ability > need.depth.best - 3 || (need.depth.count < 2 && ability > need.depth.avg * 0.9);
    if (!improves) continue;
    if (ability > targetLevel + 24) continue;
    const fee = p.clubId ? askingPrice(world, p) : 0;
    if (!affordable(world, club, p, fee)) continue;
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

/** AI clubs offload players they do not need. */
export function aiSquadTrim(game, club, rng) {
  const world = game.world;
  if (club.squad.length <= 24) return null;
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
export function aiReleaseSurplus(game, club, rng, maxSquad = 28) {
  const world = game.world;
  if (club.squad.length <= maxSquad) return [];
  const players = club.squad.map((id) => world.players[id]).filter(Boolean);
  const ranked = sortBy(players, { key: (p) => currentAbility(p) + (p.pa - currentAbility(p)) * 0.7 });
  const released = [];
  for (const p of ranked) {
    if (club.squad.length <= maxSquad) break;
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
  if (club) club.squad = club.squad.filter((id) => id !== player.id);
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
