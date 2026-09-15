// Negotiation: talks that remember what you said last time.
//
// What this replaces was not a negotiation. `evaluateOffer` and
// `evaluateContract` are pure functions of the world with no randomness and no
// memory, and the bid dialog re-ran them on every click, so the same offer
// always came back with the same answer and there was no cost to trying. Two
// things were measured on the old model before this was written:
//
//   - the same offer, made fifty times, returned one distinct answer;
//   - 43% of players in the world would sign for under a tenth of the wage they
//     had just asked for, and the median player signed for 55% of it, because
//     the money term in `evaluateContract` was floored at -60 while the bonuses
//     that outvote it were not bounded at all.
//
// So a patient player could walk any number to the exact threshold and stop.
// This module fixes the first by giving the other side a position that persists
// between rounds and hardens when it is insulted, and the second is fixed at
// source in `evaluateContract`.
//
// The acceptance judgement itself is NOT re-derived here. `evaluateOffer` and
// `evaluateContract` remain the one place that decides whether a deal is good
// enough; this adds memory, rounds, clauses and a walk-away around them. Two
// functions deciding the same thing is how a screen ends up disagreeing with
// the engine.

import { clamp, remap } from '../core/util.js';
import { Rng, hashSeed } from '../core/rng.js';
import { currentAbility } from '../data/attributes.js';
import {
  marketValue, askingPrice, evaluateOffer, evaluateContract, contractDemand,
} from './transfers.js';

/** How long talks stay dead after the other side walks away. */
export const COOLING_OFF_DAYS = 24;

/**
 * Clauses the buyer can concede instead of cash, and what each is worth.
 *
 * `sellOn` and `instalments` move the fee; the rest are paid to the player and
 * move personal terms. Every one of these already existed somewhere in the
 * model - `releaseClause`, `goalBonus` and `appearanceFee` are written by
 * `completeTransfer` and paid for real, and `signingBonus` was computed by
 * `contractDemand` and thrown away - they were simply never offered.
 */
export const CLAUSE_LIMITS = {
  sellOn: { min: 0, max: 30, step: 5, label: 'Sell-on clause', unit: '%' },
  instalments: { min: 1, max: 4, step: 1, label: 'Paid over', unit: ' years' },
};

/**
 * What a package is actually worth to the selling club.
 *
 * One function, used both to show the buyer what the seller sees and to decide
 * whether the seller takes it. A second, separate derivation for the display is
 * how a dialog ends up promising a deal the engine then refuses.
 */
export function cashEquivalent(world, player, offer) {
  const fee = Math.max(0, offer.fee || 0);
  // Deferred money is worth less than money now, which is why a club pushing
  // instalments has to put a bigger number on the table.
  const years = clamp(Math.round(offer.instalments || 1), 1, 4);
  const deferred = fee * (1 - 0.045 * (years - 1));

  // A sell-on clause is worth a share of what they think he will go for next,
  // discounted hard because it is years away and conditional on a sale.
  const pct = clamp(offer.sellOn || 0, 0, 30) / 100;
  const resale = marketValue(world, player) * (player.age <= 23 ? 1.35 : player.age <= 27 ? 1 : 0.6);
  const sellOnValue = pct * resale * 0.55;

  return Math.round(deferred + sellOnValue);
}

/** What the player values a personal-terms package at, per week. */
export function termsEquivalent(player, offer) {
  const wage = Math.max(0, offer.wage || 0);
  const years = clamp(Math.round(offer.years || 3), 1, 6);
  // A signing-on fee is real money, just paid up front - spread it across the
  // deal so it can be compared with the wage rather than sitting beside it.
  const bonus = Math.max(0, offer.signingBonus || 0) / (years * 52);
  // Only an ambitious player puts a price on a release clause; a settled one
  // does not care whether there is a way out.
  const wantsClause = (player.hidden?.ambition ?? 10) > 15;
  const clause = offer.releaseClause > 0 && wantsClause ? wage * 0.05 : 0;
  return Math.round(wage + bonus + clause);
}

// --- Opening talks -----------------------------------------------------------

function negRng(neg) {
  return Rng.restore(neg.rngState);
}

function saveRng(neg, rng) {
  neg.rngState = rng.save();
}

function pushLog(neg, tone, text) {
  neg.log.push({ round: neg.round, tone, text });
  if (neg.log.length > 24) neg.log.shift();
}

/**
 * Whether the buyer may approach at all, and why not.
 *
 * Collapsed talks stay collapsed for a while. Without that the walk-away is
 * theatre - you would simply reopen and carry on probing.
 */
export function canOpenTalks(game, player, buyerId) {
  const existing = findNegotiation(game, player.id, buyerId);
  if (existing && existing.status === 'open') return { ok: true, existing };
  if (existing && existing.status === 'collapsed') {
    const wait = existing.reopenDay - game.day;
    if (wait > 0) {
      return {
        ok: false,
        reason: `Talks broke down. They will not take another approach for ${wait} more day${wait === 1 ? '' : 's'}.`,
      };
    }
  }
  if (existing && existing.status === 'agreed') return { ok: true, existing };
  return { ok: true, existing: null };
}

export function findNegotiation(game, playerId, buyerId) {
  for (const id in game.negotiations || {}) {
    const n = game.negotiations[id];
    if (n.playerId === playerId && n.buyerId === buyerId) return n;
  }
  return null;
}

/**
 * Open transfer talks.
 *
 * The reserve price is drawn once, here, from the negotiation's own stream and
 * then stored. That is the whole point: it is not `askingPrice`, so it cannot
 * be computed from outside and probed for, and it is the same number next round
 * as it was this one unless something in the talks moved it.
 */
export function openTransferTalks(game, player, buyer) {
  const world = game.world;
  const gate = canOpenTalks(game, player, buyer.id);
  if (!gate.ok) return { error: gate.reason };
  if (gate.existing && gate.existing.status !== 'collapsed') return { negotiation: gate.existing };

  const seller = player.clubId ? world.clubs[player.clubId] : null;
  const rng = new Rng(hashSeed(`neg:${game.seed}:${player.id}:${buyer.id}:${game.season}:${game.day}`));

  // Anchored on the same threshold the single-shot path uses, so the two cannot
  // drift apart, then moved by how these particular talks are going to go.
  const base = seller ? (evaluateOffer(world, player, 0, buyer).threshold ?? askingPrice(world, player)) : 0;
  const mood = rng.range(0.94, 1.16);
  const reserve = seller ? Math.round(base * mood / 5000) * 5000 : 0;

  // How long they will listen before they stop. A club that needs the money, or
  // that does not want him, gives you more room than one being asked for a
  // player it would rather keep.
  const needy = seller && seller.finances.balance < 0 ? 1 : 0;
  const listed = player.transferStatus === 'listed' ? 1 : 0;
  const patience = clamp(3 + needy + listed + rng.int(0, 1), 3, 6);

  const neg = {
    id: `n${game.season}_${game.day}_${player.id}_${buyer.id}`,
    kind: 'transfer',
    phase: seller ? 'fee' : 'terms',
    playerId: player.id,
    buyerId: buyer.id,
    sellerId: seller ? seller.id : null,
    round: 0,
    status: 'open',
    reserve,
    openingAsk: seller ? Math.round(reserve * rng.range(1.05, 1.22) / 5000) * 5000 : 0,
    patience,
    maxPatience: patience,
    openedDay: game.day,
    lastEquivalent: null,
    rival: null,
    termsPatience: 3,
    demandWage: 0,
    agreed: null,
    log: [],
    rngState: rng.save(),
  };
  if (!seller) startTerms(game, neg, player, buyer);
  else {
    pushLog(neg, 'neutral', `${seller.name} will talk. They want ${fmt(neg.openingAsk)} for him.`);
    maybeRival(game, neg, player, buyer);
  }

  game.negotiations = game.negotiations || {};
  game.negotiations[neg.id] = neg;
  return { negotiation: neg };
}

/**
 * A rival bidder, drawn once when talks open and revealed later.
 *
 * Without one there is no clock on a negotiation but the seller's patience, and
 * no reason to ever offer above the reserve.
 */
function maybeRival(game, neg, player, buyer) {
  const world = game.world;
  const rng = negRng(neg);
  const ca = currentAbility(player);
  // Good players attract company; a squad filler does not.
  const odds = clamp(remap(ca, 70, 150, 0.08, 0.5), 0.05, 0.5);
  if (rng.chance(odds)) {
    const rivals = Object.values(world.clubs).filter((c) => c.id !== buyer.id && c.id !== neg.sellerId
      && !c.affiliateOf && !c.isUserClub && c.rep >= buyer.rep - 14
      && c.finances.transferBudget > neg.reserve * 0.9);
    if (rivals.length) {
      const club = rng.pick(rivals);
      neg.rival = {
        clubId: club.id,
        fee: Math.round(neg.reserve * rng.range(0.9, 1.08) / 5000) * 5000,
        appearsRound: rng.int(1, 2),
      };
    }
  }
  saveRng(neg, rng);
}

// --- The fee ----------------------------------------------------------------

/**
 * Put a package to the selling club.
 *
 * `offer` is `{ fee, sellOn, instalments }`. The outcome is one of accepted,
 * countered, rejected or collapsed, and every path but the first costs
 * something - which is the difference between this and the old dialog.
 */
export function transferOffer(game, neg, offer) {
  const world = game.world;
  const player = world.players[neg.playerId];
  const seller = neg.sellerId ? world.clubs[neg.sellerId] : null;
  if (!player || neg.status !== 'open') return { outcome: 'closed', text: 'These talks are over.' };
  if (neg.phase !== 'fee') return { outcome: 'closed', text: 'The fee is already settled.' };
  // He may have moved since talks opened - the AI market runs every day - and a
  // negotiation with the club that used to own him would otherwise carry on as
  // though nothing had happened.
  if (player.clubId !== neg.sellerId) {
    neg.status = 'collapsed';
    neg.reopenDay = game.day;
    pushLog(neg, 'bad', 'He is no longer their player.');
    return { outcome: 'collapsed', negotiation: neg, text: `${player.name} has already moved on.` };
  }

  neg.round++;
  const rng = negRng(neg);
  const equivalent = cashEquivalent(world, player, offer);

  // The rival's bid arrives, and sets a floor under the reserve.
  if (neg.rival && !neg.rival.revealed && neg.round >= neg.rival.appearsRound) {
    neg.rival.revealed = true;
    neg.reserve = Math.max(neg.reserve, Math.round(neg.rival.fee * 1.02 / 5000) * 5000);
    pushLog(neg, 'warn', `${world.clubs[neg.rival.clubId]?.name} have bid ${fmt(neg.rival.fee)}. `
      + 'You will have to beat it.');
  }

  const previous = neg.lastEquivalent;
  neg.lastEquivalent = equivalent;

  // Repeating yourself. The old dialog let you make the same offer until it
  // passed; here it burns the round and annoys them.
  //
  // This is checked BEFORE the acceptance test, and that ordering is the whole
  // point. It was the other way round at first, and an instrument caught two
  // negotiations in a hundred and twenty being ground out anyway: a near miss
  // softens the reserve, and if it softens past an offer you have already made,
  // putting the identical number back on the table wins. An offer has to
  // improve on your last one to be looked at again.
  const repeated = previous !== null && equivalent <= previous * 1.01;
  if (repeated) {
    neg.patience -= 2;
    neg.reserve = Math.round(neg.reserve * 1.03 / 5000) * 5000;
    pushLog(neg, 'bad', 'You have put the same money on the table twice. They are less inclined than they were.');
    if (neg.patience <= 0) {
      neg.status = 'collapsed';
      neg.reopenDay = game.day + COOLING_OFF_DAYS;
      pushLog(neg, 'bad', 'They have walked away from the table.');
      saveRng(neg, rng);
      return {
        outcome: 'collapsed', negotiation: neg,
        text: `${seller?.name || 'They'} have ended talks. They will not listen again for ${COOLING_OFF_DAYS} days.`,
      };
    }
    const want = Math.round(neg.reserve * rng.range(1.0, 1.09) / 5000) * 5000;
    pushLog(neg, 'neutral', `They are still looking for around ${fmt(want)}.`);
    saveRng(neg, rng);
    return { outcome: 'rejected', counter: want, negotiation: neg, text: 'The same offer gets the same answer, only colder.' };
  }

  const lowball = equivalent < neg.reserve * 0.72;

  if (equivalent >= neg.reserve) {
    neg.phase = 'terms';
    neg.agreed = {
      fee: Math.max(0, offer.fee || 0),
      sellOn: clamp(offer.sellOn || 0, 0, 30),
      instalments: clamp(Math.round(offer.instalments || 1), 1, 4),
      equivalent,
    };
    pushLog(neg, 'good', `${seller ? seller.name : 'They'} accept. Now agree personal terms with him.`);
    startTerms(game, neg, player, world.clubs[neg.buyerId]);
    saveRng(neg, rng);
    return { outcome: 'accepted', text: `${seller?.name || 'They'} have accepted.`, negotiation: neg };
  }

  // Punishment first, so the counter below reflects the new position.
  if (lowball) {
    neg.patience -= 2;
    neg.reserve = Math.round(neg.reserve * 1.04 / 5000) * 5000;
    pushLog(neg, 'bad', 'They took that as an insult and hardened their position.');
  } else {
    neg.patience -= 1;
    // Genuine movement is met with movement: a near miss pulls the reserve down
    // a little, so negotiating properly is a strategy rather than a formality.
    if (equivalent >= neg.reserve * 0.9) {
      neg.reserve = Math.round(neg.reserve * rng.range(0.975, 0.995) / 5000) * 5000;
    }
  }

  if (neg.patience <= 0) {
    neg.status = 'collapsed';
    neg.reopenDay = game.day + COOLING_OFF_DAYS;
    pushLog(neg, 'bad', 'They have walked away from the table.');
    saveRng(neg, rng);
    return {
      outcome: 'collapsed', negotiation: neg,
      text: `${seller?.name || 'They'} have ended talks. They will not listen again for ${COOLING_OFF_DAYS} days.`,
    };
  }

  // What they say they would take. They never name the reserve exactly - a
  // number you can read off the screen is a number you can meet without ever
  // making a judgement.
  const counter = Math.round(neg.reserve * rng.range(1.0, 1.09) / 5000) * 5000;
  const close = equivalent >= neg.reserve * 0.9;
  pushLog(neg, close ? 'warn' : 'neutral',
    close ? `Close. They would want nearer ${fmt(counter)}.` : `Rejected. They are looking for around ${fmt(counter)}.`);
  saveRng(neg, rng);
  return {
    outcome: close ? 'countered' : 'rejected',
    counter,
    negotiation: neg,
    text: close ? `Not far off — they want nearer ${fmt(counter)}.` : `Turned down. They want around ${fmt(counter)}.`,
  };
}

// --- Personal terms ----------------------------------------------------------

function startTerms(game, neg, player, buyer) {
  const world = game.world;
  const rng = negRng(neg);
  const demand = contractDemand(world, player, buyer);
  const mood = rng.range(0.96, 1.12);
  neg.demandWage = Math.round(demand.wage * mood / 50) * 50;
  neg.demandYears = demand.years;
  neg.demandBonus = demand.signingBonus;
  neg.wantsClause = demand.releaseClauseExpected;
  neg.termsPatience = clamp(3 + (player.transferStatus === 'listed' ? 1 : 0) + rng.int(0, 1), 3, 5);
  neg.maxTermsPatience = neg.termsPatience;
  neg.lastTerms = null;
  neg.phase = 'terms';
  pushLog(neg, 'neutral', `${player.name} is asking ${fmt(neg.demandWage)} a week`
    + `${neg.wantsClause ? ', and wants a release clause written in' : ''}.`);
  saveRng(neg, rng);
}

/**
 * Put personal terms to the player.
 *
 * `offer` is `{ wage, years, promisedRole, signingBonus, releaseClause }`.
 * The judgement is still `evaluateContract` - this adds the memory around it.
 */
export function termsOffer(game, neg, offer) {
  const world = game.world;
  const player = world.players[neg.playerId];
  const buyer = world.clubs[neg.buyerId];
  if (!player || !buyer || neg.status !== 'open') return { outcome: 'closed', text: 'These talks are over.' };
  if (neg.phase !== 'terms') return { outcome: 'closed', text: 'Agree a fee first.' };

  neg.round++;
  const rng = negRng(neg);
  const weekly = termsEquivalent(player, offer);
  const previous = neg.lastTerms;
  neg.lastTerms = weekly;

  // The same acceptance judgement the AI clubs use, handed the package value
  // rather than the bare wage so that a signing-on fee is worth something.
  const verdict = evaluateContract(world, player, buyer, {
    ...offer, wage: weekly, promisedRole: offer.promisedRole || 'rotation',
  });

  // Checked before acceptance, for the same reason as the fee above: a demand
  // that has softened must not make a package you already offered suddenly good.
  const repeatedTerms = previous !== null && weekly <= previous * 1.01;
  if (repeatedTerms) {
    neg.termsPatience -= 2;
    neg.demandWage = Math.round(neg.demandWage * 1.02 / 50) * 50;
    pushLog(neg, 'bad', 'His agent points out that is the same offer as last time.');
    if (neg.termsPatience <= 0) {
      neg.status = 'collapsed';
      neg.reopenDay = game.day + COOLING_OFF_DAYS;
      pushLog(neg, 'bad', `${player.name} has broken off talks.`);
      saveRng(neg, rng);
      return {
        outcome: 'collapsed', negotiation: neg,
        text: `${player.name} is no longer interested. He will not talk again for ${COOLING_OFF_DAYS} days.`,
      };
    }
    const again = Math.round(neg.demandWage * rng.range(1.0, 1.07) / 50) * 50;
    saveRng(neg, rng);
    return { outcome: 'rejected', counter: again, negotiation: neg, text: 'His agent is unimpressed by the repetition.' };
  }

  if (verdict.accepted && weekly >= neg.demandWage * 0.9) {
    neg.status = 'agreed';
    neg.terms = {
      wage: Math.max(0, offer.wage || 0),
      years: clamp(Math.round(offer.years || 3), 1, 6),
      promisedRole: offer.promisedRole || 'rotation',
      signingBonus: Math.max(0, offer.signingBonus || 0),
      releaseClause: Math.max(0, offer.releaseClause || 0),
      weekly,
    };
    pushLog(neg, 'good', `${player.name} has agreed terms.`);
    saveRng(neg, rng);
    return { outcome: 'agreed', negotiation: neg, text: `${player.name} will sign.` };
  }

  const lowball = weekly < neg.demandWage * 0.72;
  if (lowball) {
    neg.termsPatience -= 2;
    neg.demandWage = Math.round(neg.demandWage * 1.03 / 50) * 50;
    pushLog(neg, 'bad', 'His agent is offended by the figure and has raised his own.');
  } else {
    neg.termsPatience -= 1;
    if (weekly >= neg.demandWage * 0.92) {
      neg.demandWage = Math.round(neg.demandWage * rng.range(0.97, 0.995) / 50) * 50;
    }
  }

  if (neg.termsPatience <= 0) {
    neg.status = 'collapsed';
    neg.reopenDay = game.day + COOLING_OFF_DAYS;
    pushLog(neg, 'bad', `${player.name} has broken off talks.`);
    saveRng(neg, rng);
    return {
      outcome: 'collapsed', negotiation: neg,
      text: `${player.name} is no longer interested. He will not talk again for ${COOLING_OFF_DAYS} days.`,
    };
  }

  const want = Math.round(neg.demandWage * rng.range(1.0, 1.07) / 50) * 50;
  pushLog(neg, weekly >= neg.demandWage * 0.9 ? 'warn' : 'neutral',
    `${verdict.reason === 'agreed' ? 'He wants more' : `He ${verdict.reason}`} — nearer ${fmt(want)} a week.`);
  saveRng(neg, rng);
  return {
    outcome: weekly >= neg.demandWage * 0.9 ? 'countered' : 'rejected',
    counter: want, negotiation: neg, reason: verdict.reason,
    text: `He is looking for nearer ${fmt(want)} a week.`,
  };
}

/** Drop the talks without a walk-away penalty - your choice, not theirs. */
export function abandonTalks(game, neg) {
  if (!neg) return;
  delete game.negotiations[neg.id];
}

/** Talks that have been settled or have gone cold and can be cleared away. */
export function pruneNegotiations(game) {
  const out = {};
  for (const id in game.negotiations || {}) {
    const n = game.negotiations[id];
    if (n.status === 'collapsed' && n.reopenDay <= game.day) continue;
    if (n.status === 'agreed' && game.day - n.openedDay > 30) continue;
    const player = game.world.players[n.playerId];
    // Talks for a player who has since signed somewhere else, or left the game
    // entirely at a rollover, are not talks.
    if (!player) continue;
    if (n.kind === 'transfer' && n.phase === 'fee' && player.clubId !== n.sellerId) continue;
    out[id] = n;
  }
  game.negotiations = out;
}

function fmt(n) {
  if (n >= 1e6) return `£${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `£${Math.round(n / 1e3)}K`;
  return `£${Math.round(n)}`;
}
