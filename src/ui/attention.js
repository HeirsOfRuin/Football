// What actually needs the manager, derived in one place.
//
// Home used to be a report: seven panels and 109 numbers, and the thing you had
// to do about any of it was left as an exercise. This module answers the one
// question a management screen owes its reader - "what needs me, and what fixes
// it" - and every item carries the screen that fixes it, because naming a
// problem without naming the lever is the silent-state failure in a nicer coat.
//
// It lives in one module so the list cannot disagree with itself between the
// Home screen and anywhere else that asks.

import { userClub } from '../state/game.js';
import { buildLineup, registrationLimit, refreshRegistration } from '../engine/lineup.js';
import { trainingSlots } from '../engine/training.js';
import { wageBudgetUsage } from '../engine/finance.js';

/**
 * How fit the eleven that would actually start is.
 *
 * Built from `buildLineup`, the same function the match uses to pick the side,
 * so this cannot report on an eleven that is not the one that takes the field.
 */
export function xiReadiness(world, club) {
  const lineup = buildLineup(world, club, club.tactic);
  const picked = lineup.starters.map((s) => s.player).filter(Boolean);
  return {
    lineup,
    picked,
    tired: picked.filter((p) => p.condition < 70),
    short: picked.filter((p) => p.condition >= 70 && p.condition < 85),
    missing: lineup.missing,
  };
}

/** A plural-safe count: "1 player", "3 players". */
function n(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Everything that wants a decision, worst first.
 *
 * Each item is `{ id, pill, cls, what, go, label }`: a tag, a sentence, and the
 * screen that deals with it. Nothing is included that the manager cannot act on
 * from here - a problem with no lever belongs in the inbox, not on a to-do list.
 */
export function attentionItems(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return [];
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const items = [];

  const offers = (game.offers || []).filter((o) => world.players[o.playerId]?.clubId === club.id);
  if (offers.length) {
    items.push({
      id: 'offers', pill: 'Bids', cls: 'warn',
      what: `${n(offers.length, 'club')} ${offers.length === 1 ? 'has' : 'have'} bid for your players`,
      go: 'transfers', label: 'Review',
    });
  }

  const ready = xiReadiness(world, club);
  if (ready.missing) {
    items.push({
      id: 'missing', pill: 'Team', cls: 'bad',
      what: `${n(ready.missing, 'position')} cannot be filled — not enough fit, registered players`,
      go: 'tactics', label: 'Team sheet',
    });
  } else if (ready.tired.length) {
    items.push({
      id: 'tired', pill: 'Fitness', cls: 'warn',
      what: `${n(ready.tired.length, 'starter')} below 70% — ${ready.tired.map((p) => p.short).join(', ')}`,
      go: 'tactics', label: 'Team sheet',
    });
  }

  // Unregistered players know they cannot be picked, and the answer is usually
  // the reserve side rather than a sale - which is a decision, so it belongs here.
  const reg = club._registered || refreshRegistration(world, club);
  const unregistered = squad.filter((p) => !reg.has(p.id) && !p.injury);
  if (unregistered.length) {
    items.push({
      id: 'unregistered', pill: 'Registration', cls: 'warn',
      what: `${n(unregistered.length, 'player')} outside your ${registrationLimit(club)}-man registration and unable to play`,
      go: 'squads', label: 'Squads',
    });
  }

  const unhappy = squad.filter((p) => p.unhappy);
  if (unhappy.length) {
    items.push({
      id: 'unhappy', pill: 'Morale', cls: 'warn',
      what: `${n(unhappy.length, 'player')} unhappy — ${unhappy.slice(0, 3).map((p) => p.short).join(', ')}${unhappy.length > 3 ? ` +${unhappy.length - 3}` : ''}`,
      go: 'squad', label: 'Players',
    });
  }

  const expiring = squad.filter((p) => p.contract && p.contract.expiresYear <= world.year);
  if (expiring.length) {
    items.push({
      id: 'expiring', pill: 'Contracts', cls: 'warn',
      what: `${n(expiring.length, 'contract')} ${expiring.length === 1 ? 'expires' : 'expire'} this summer`,
      go: 'squad', label: 'Players',
    });
  }

  const used = (club.training?.slots || []).filter((s) => s?.playerId && s.type).length;
  const allowed = trainingSlots(club);
  if (used < allowed) {
    items.push({
      id: 'slots', pill: 'Training', cls: '',
      what: `${n(allowed - used, 'individual training slot')} unused of ${allowed}`,
      go: 'training', label: 'Training',
    });
  }

  if ((club.youthSquad || []).length) {
    const scholars = club.youthSquad.filter((id) => (world.players[id]?.age ?? 0) >= 17).length;
    if (scholars) {
      items.push({
        id: 'academy', pill: 'Academy', cls: '',
        what: `${n(scholars, 'scholar')} old enough for professional terms`,
        go: 'squads', label: 'Academy',
      });
    }
  }

  const wage = wageBudgetUsage(world, club);
  if (wage.pct > 1) {
    items.push({
      id: 'wages', pill: 'Wages', cls: 'bad',
      what: `Wage bill is ${Math.round(wage.pct * 100)}% of the budget the board set`,
      go: 'finances', label: 'Finances',
    });
  }

  if (club.board && club.board.confidence < 30) {
    items.push({
      id: 'board', pill: 'Board', cls: 'bad',
      what: `The board's confidence in you is ${Math.round(club.board.confidence)} of 100`,
      go: 'club', label: 'Board',
    });
  }

  const unread = game.inbox.filter((x) => !x.read).length;
  if (unread) {
    items.push({
      id: 'inbox', pill: 'Inbox', cls: '',
      what: `${n(unread, 'unread message')}`,
      go: 'inbox', label: 'Read',
    });
  }

  const order = { bad: 0, warn: 1, '': 2 };
  return items.sort((a, b) => order[a.cls] - order[b.cls]);
}
