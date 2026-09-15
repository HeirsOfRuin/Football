// Club finances: gate receipts, commercial income, wages, prize money.

import { clamp, remap } from '../core/util.js';
import { commercialIncome } from '../data/nations.js';

/** Where a club's money actually lands: a reserve side's books are its parent's. */
export function bookkeeper(world, club) {
  return club?.affiliateOf ? (world.clubs[club.affiliateOf] || club) : club;
}

export function ledgerEntry(club, day, label, amount, category) {
  club.finances.balance += amount;
  if (amount > 0) club.finances.seasonIncome += amount;
  else club.finances.seasonSpend -= amount;
  club.finances.ledger.push({ day, label, amount, category });
  if (club.finances.ledger.length > 220) club.finances.ledger.shift();
}

/** Attendance for a home fixture. */
export function matchdayAttendance(rng, club, opponent, importance) {
  const base = club.finances.capacityUse;
  const draw = remap(opponent.rep - club.rep, -35, 35, -0.07, 0.13);
  const form = clamp(club.form.filter((f) => f === 'W').length / Math.max(1, club.form.length), 0, 1);
  const pct = clamp(base + draw + (form - 0.4) * 0.1 + importance * 0.06 + rng.range(-0.05, 0.05), 0.3, 1);
  return Math.round(club.stadium.capacity * pct);
}

export function applyMatchdayIncome(game, club, opponent, attendance, comp) {
  const price = club.finances.ticketPrice * (comp === 'cup' ? 0.85 : comp === 'continental' ? 1.5 : 1);
  const gate = attendance * price;
  const extras = gate * 0.38; // concessions, hospitality, programmes
  ledgerEntry(bookkeeper(game.world, club), game.day,
    `Gate receipts vs ${opponent.short}`, Math.round(gate + extras), 'matchday');
}

/** Monthly commercial and sponsorship income. */
export function applyMonthlyIncome(game, club) {
  // A reserve side has no sponsors and no facilities of its own - it uses the
  // parent's, which are already being paid for once.
  if (club.affiliateOf) return;
  const nation = game.world.nations.find((n) => n.id === club.nation);
  const commercial = commercialIncome(club.rep, nation?.wealth ?? 0.7) / 12;
  const success = club.lastFinish ? remap(club.lastFinish, 1, 20, 1.18, 0.88) : 1;
  ledgerEntry(club, game.day, 'Sponsorship & commercial', Math.round(commercial * success), 'commercial');
  const upkeep = -(club.stadium.capacity * 2.4 + club.facilities.training * 26000 + club.facilities.youth * 17000
    + club.facilities.medical * 13000 + club.facilities.scouting * 11000);
  ledgerEntry(club, game.day, 'Stadium & facility upkeep', Math.round(upkeep / 12), 'upkeep');
}

export function payWeeklyWages(game, club) {
  const world = game.world;
  let total = 0;
  // Scholars are on the books too. They live in a separate list so they do not
  // count against registration, but they are still paid.
  for (const id of [...club.squad, ...(club.youthSquad || [])]) {
    const p = world.players[id];
    if (!p?.contract) continue;
    if (p.contract.loanedFrom && p.contract.wageShare != null) total += p.contract.wage * p.contract.wageShare;
    // A two-way contract pays the reserve rate while he is at the reserve side.
    // Players who refused one have no wageReserve and are paid in full wherever
    // they play, which is the whole reason a star cannot be stashed.
    else if (club.affiliateOf && p.contract.wageReserve) total += p.contract.wageReserve;
    else total += p.contract.wage;
  }
  // Staff wages scale with facilities and reputation.
  // A reserve side carries no separate staff bill: it shares the parent's.
  const staff = club.affiliateOf ? 0
    : (club.rep * 900) + (club.facilities.training + club.facilities.youth + club.facilities.scouting + club.facilities.medical) * 700;
  const amount = -(total + staff);
  const books = bookkeeper(world, club);
  ledgerEntry(books, game.day, club.affiliateOf ? `Wages — ${club.short}` : 'Wages', Math.round(amount), 'wages');
  return -amount;
}

/**
 * The club's weekly wage bill, including its reserve side.
 *
 * The reserve wages count against the parent's budget - at the reduced rate - so
 * sending a player down is a visible saving rather than a way of hiding him off
 * the books entirely.
 */
export function weeklyWageBill(world, club) {
  // Asked about a reserve side directly, answer for the parent: the two share a
  // budget, and adding them separately would count the same wages twice.
  if (club.affiliateOf) return weeklyWageBill(world, bookkeeper(world, club));
  let total = 0;
  for (const id of club.squad) {
    const p = world.players[id];
    if (p?.contract) total += p.contract.wage;
  }
  for (const id of club.youthSquad || []) {
    const p = world.players[id];
    if (p?.contract) total += p.contract.wage;
  }
  const reserve = club.reserveClubId ? world.clubs[club.reserveClubId] : null;
  if (reserve) {
    for (const id of reserve.squad) {
      const p = world.players[id];
      if (p?.contract) total += p.contract.wageReserve || p.contract.wage;
    }
  }
  return total;
}

export function wageBudgetUsage(world, club) {
  const weekly = weeklyWageBill(world, club);
  const budgetWeekly = club.finances.wageBudgetAnnual / 52;
  return { weekly, budgetWeekly, pct: budgetWeekly > 0 ? weekly / budgetWeekly : 1 };
}

/** End-of-season prize money and TV distribution. */
export function payLeaguePrize(game, club, league, position) {
  const perPlace = league.prize;
  const places = league.teams;
  const merit = perPlace * (places - position + 1);
  const tv = league.tvMoney / places;
  ledgerEntry(bookkeeper(game.world, club), game.day,
    `${league.name} prize money (${position})`, Math.round(merit + tv), 'prize');
}

export function payCompetitionPrize(game, club, label, amount) {
  ledgerEntry(bookkeeper(game.world, club), game.day, label, Math.round(amount), 'prize');
}

/**
 * The board sets budgets for a new season based on projected income, the
 * existing wage commitment and how much cash is in the bank.
 */
export function setSeasonBudgets(game, club, rng) {
  const world = game.world;
  const league = world.leagues.find((l) => l.id === club.leagueId);
  const nation = world.nations.find((n) => n.id === club.nation);
  const capacity = club.stadium.capacity;
  const matchday = capacity * club.finances.capacityUse * club.finances.ticketPrice * 1.38 * (league.teams - 1);
  const tv = league ? league.tvMoney / league.teams + league.prize * (league.teams / 2) : 2e6;
  const commercial = commercialIncome(club.rep, nation?.wealth ?? 0.7);
  const projected = matchday + tv + commercial;
  club.finances.incomeEstimate = Math.round(projected);

  const ambition = club.board.wantsYouth ? 0.52 : 0.6;
  club.finances.wageBudgetAnnual = Math.round(projected * (ambition + rng.range(-0.04, 0.08)));

  const currentWages = weeklyWageBill(world, club) * 52;
  const spare = projected - currentWages - projected * 0.18; // running costs
  const cashAvailable = Math.max(0, club.finances.balance * 0.55);
  club.finances.transferBudget = Math.max(0, Math.round(spare * rng.range(0.25, 0.55) + cashAvailable * rng.range(0.2, 0.5)));
  club.finances.seasonIncome = 0;
  club.finances.seasonSpend = 0;
}

/**
 * Move money between the transfer and wage budgets. Positive amounts shift
 * transfer funds into wages; negative amounts do the reverse, and can never
 * take the wage budget below what the current squad already costs.
 */
export function adjustBudgets(world, club, amountToWages) {
  const f = club.finances;
  if (amountToWages > 0) {
    const move = Math.min(amountToWages, f.transferBudget);
    f.transferBudget -= move;
    f.wageBudgetAnnual += move;
    return move;
  }
  const committed = weeklyWageBill(world, club) * 52;
  const move = Math.min(-amountToWages, Math.max(0, f.wageBudgetAnnual - committed));
  f.wageBudgetAnnual -= move;
  f.transferBudget += move;
  return -move;
}

export function financialHealth(club) {
  const f = club.finances;
  if (f.balance < -f.incomeEstimate * 0.35) return { label: 'Insecure', level: 0 };
  if (f.balance < 0) return { label: 'Struggling', level: 1 };
  if (f.balance < f.incomeEstimate * 0.1) return { label: 'Okay', level: 2 };
  if (f.balance < f.incomeEstimate * 0.4) return { label: 'Secure', level: 3 };
  return { label: 'Rich', level: 4 };
}
