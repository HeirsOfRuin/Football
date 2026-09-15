// What the board asks of you, and how it is judged.
//
// This lives in its own module with no dependencies because two different places
// need it and they cannot import each other: the world generator sets a club's
// first objective before any season has been played, and the season rollover
// sets every later one. Those were previously two near-identical functions that
// had drifted apart - different thresholds (0.75 against 0.78), different
// targets (a hardcoded 2 and 6 against the division's real promotion places),
// and one of them did not know whether promotion was possible at all. A club's
// objective therefore depended on whether it had ever finished a season.

/**
 * The league objective, from where a club finished last time.
 *
 * `finish` is a position (1-based). At world generation there is no last season,
 * so the caller passes the club's rank in the division's reputation order, which
 * is the same question asked a different way.
 */
export function leagueObjective(league, finish) {
  const teams = league.teams;
  const t = (finish - 1) / Math.max(1, teams - 1);
  const canRelegate = league.hasDivisionBelow !== false;
  const canPromote = league.hasDivisionAbove !== false && league.tier > 1;
  const promoted = league.promoted || 2;

  // A division with nothing below it cannot ask you to avoid relegation.
  const bottomAsk = canRelegate
    ? { type: 'survive', target: teams - (league.relegated || 3), label: 'Avoid relegation' }
    : { type: 'mid', target: teams - 2, label: 'Improve on last season' };

  if (league.tier === 1) {
    if (t < 0.1) return { type: 'title', target: 1, label: 'Win the league' };
    if (t < 0.25) return { type: 'top', target: 4, label: 'Qualify for the Continental Cup' };
    if (t < 0.5) return { type: 'top', target: Math.ceil(teams * 0.4), label: 'Challenge for a continental place' };
    if (t < 0.78) return { type: 'mid', target: Math.ceil(teams * 0.65), label: 'Finish in mid-table' };
    return bottomAsk;
  }
  if (canPromote && t < 0.15) return { type: 'top', target: promoted, label: 'Win promotion' };
  if (canPromote && t < 0.4) return { type: 'top', target: promoted + 4, label: 'Reach the promotion play-offs' };
  if (t < 0.78) return { type: 'mid', target: Math.ceil(teams * 0.6), label: 'Finish in mid-table' };
  return bottomAsk;
}

/** How well a league finish met the objective, on a -26 to +22 scale. */
export function objectiveScore(objective, position) {
  if (!objective) return 0;
  switch (objective.type) {
    case 'title': return position === 1 ? 22 : position <= 3 ? 6 : position <= 6 ? -10 : -26;
    case 'top': return position <= objective.target ? 16 : position <= objective.target + 3 ? 0 : -18;
    case 'mid': return position <= objective.target ? 12 : position <= objective.target + 4 ? -3 : -16;
    case 'survive': return position <= objective.target ? 12 : -20;
    default: return 0;
  }
}

/** How far the board expect you to go in the cup, by club standing. */
export function cupObjective(league, finish) {
  const t = (finish - 1) / Math.max(1, league.teams - 1);
  const big = league.tier === 1 && t < 0.3;
  if (big) return { id: 'cup', type: 'cup', target: 2, label: 'Reach the cup final' };
  if (league.tier === 1 || t < 0.4) return { id: 'cup', type: 'cup', target: 8, label: 'Reach the cup quarter-finals' };
  return { id: 'cup', type: 'cup', target: 32, label: 'Make a run in the cup' };
}

/**
 * The third ask: how the board want the club run, not just where it finishes.
 *
 * `wantsYouth` and `wantsAttacking` have been on every club since the world was
 * first generated. This is what turns them into something scored rather than a
 * pair of labels on a screen.
 */
export function remitObjective(club, ctx = {}) {
  if (club.board?.wantsYouth) {
    return { id: 'remit', type: 'youth', target: 3, label: 'Give three young players regular football' };
  }
  if (club.board?.wantsAttacking) {
    return { id: 'remit', type: 'attacking', target: 1.45, label: 'Play attacking football' };
  }
  // "Stay inside the wage budget" was measured and turned out to be free: every
  // club in a fresh world sits at a median 40% of its budget and 100% of them
  // are under it, so 88% of these were met without the manager doing anything.
  // The ask is therefore set from where the club actually stands - you may grow
  // the bill, but not without limit - and the number is put in the label so it
  // is a target rather than a vague instruction.
  // A flat floor was tried first and rejected: clubs generated with a budget
  // many times their wage bill were handed 54 points of headroom, which is the
  // free pass again by another route. A constant margin above wherever the club
  // stands gives every board the same ask - roughly one or two big signings'
  // worth of room - whatever the club's books look like.
  const usage = typeof ctx.wageUsage === 'number' ? ctx.wageUsage : 0.85;
  const target = Math.min(1, Math.round((usage + 0.12) * 100) / 100);
  return {
    id: 'remit', type: 'wages', target,
    label: `Keep the wage bill under ${Math.round(target * 100)}% of its budget`,
  };
}

/**
 * The full set of objectives for a season.
 *
 * `ctx` carries the few numbers a remit needs that this module deliberately
 * cannot work out for itself - it has no dependencies so that worldgen and the
 * season rollover can both call it without an import cycle.
 */
export function seasonObjectives(club, league, finish, ctx = {}) {
  const lg = leagueObjective(league, finish);
  return [
    { id: 'league', ...lg, met: null },
    { ...cupObjective(league, finish), met: null },
    { ...remitObjective(club, ctx), met: null },
  ];
}

export const OBJECTIVE_WEIGHT = { league: 1, cup: 0.35, remit: 0.4 };
