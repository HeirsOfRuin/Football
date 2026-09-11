// The manager's inbox.

let newsCounter = 0;

export const NEWS_CATEGORIES = {
  board: 'Board', transfer: 'Transfers', match: 'Matches', squad: 'Squad',
  media: 'Media', competition: 'Competitions', finance: 'Finance', youth: 'Youth',
};

export function news(game, category, title, body, extra = {}) {
  const item = {
    id: `n${(++newsCounter).toString(36)}`,
    day: game.day,
    season: game.season,
    category,
    title,
    body,
    read: false,
    pinned: false,
    ...extra,
  };
  game.inbox.unshift(item);
  if (game.inbox.length > 400) game.inbox.length = 400;
  return item;
}

export function unreadCount(game) {
  return game.inbox.filter((n) => !n.read).length;
}

export function markAllRead(game) {
  for (const n of game.inbox) n.read = true;
}

const HEADLINES = {
  bigWin: [
    '{winner} run riot against {loser}',
    '{winner} sweep {loser} aside',
    'Ruthless {winner} dismantle {loser}',
  ],
  upset: [
    '{winner} stun {loser}',
    'Shock at {venue} as {winner} down {loser}',
    '{loser} humbled by {winner}',
  ],
  draw: [
    '{home} and {away} share the spoils',
    'Honours even between {home} and {away}',
  ],
  narrow: [
    '{winner} edge past {loser}',
    'Late drama as {winner} see off {loser}',
    '{winner} grind out a win over {loser}',
  ],
};

export function matchHeadline(rng, home, away, hg, ag, upset) {
  const winner = hg > ag ? home : away;
  const loser = hg > ag ? away : home;
  const margin = Math.abs(hg - ag);
  let pool = HEADLINES.narrow;
  if (hg === ag) pool = HEADLINES.draw;
  else if (upset) pool = HEADLINES.upset;
  else if (margin >= 3) pool = HEADLINES.bigWin;
  return rng.pick(pool)
    .replace('{winner}', winner.name)
    .replace('{loser}', loser.name)
    .replace('{home}', home.name)
    .replace('{away}', away.name)
    .replace('{venue}', home.stadium.name);
}
