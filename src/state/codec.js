// Compact serialisation for save files.
//
// A medium world holds ~6,000 players, each with 38 visible attributes and 10
// hidden ones. Written as plain JSON objects that is tens of megabytes; packed
// into fixed-length strings it is a small fraction of that, which keeps saves
// well inside browser storage limits and makes them quick to write.

import { ALL_ATTRS, HIDDEN_ATTRS } from '../data/attributes.js';
import { GAME_VERSION, managerContract } from './game.js';
import { emptyStats } from '../gen/playergen.js';

const CHAR_BASE = 48; // '0'

function packScale(values) {
  let out = '';
  for (const v of values) out += String.fromCharCode(CHAR_BASE + Math.max(0, Math.min(99, Math.round(v || 0))));
  return out;
}

function unpackScale(str, keys) {
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = str ? str.charCodeAt(i) - CHAR_BASE : 1;
  }
  return out;
}

export function packPlayer(p) {
  return {
    i: p.id,
    f: p.first,
    l: p.last,
    n: p.nat,
    by: p.birthYear,
    bd: p.birthDay,
    a: p.age,
    po: p.positions.join(','),
    at: packScale(ALL_ATTRS.map((k) => p.attrs[k])),
    hi: packScale(HIDDEN_ATTRS.map((k) => p.hidden[k])),
    pa: p.pa,
    h: p.height,
    w: p.weight,
    ft: p.foot,
    tr: (p.traits || []).join(','),
    c: p.clubId,
    sn: p.squadNumber,
    cd: Math.round(p.condition),
    sh: Math.round(p.sharpness),
    mo: Math.round(p.morale),
    fo: Math.round((p.form || 0) * 100),
    db: Math.round((p.devBank || 0) * 1000),
    inj: p.injury ? [p.injury.type, p.injury.daysLeft, p.injury.totalDays] : null,
    su: p.suspension || 0,
    yc: p.yellowCards || 0,
    un: p.unhappy || null,
    ct: p.contract ? [
      p.contract.wage, p.contract.expiresYear, p.contract.signedYear,
      p.contract.releaseClause || 0, p.contract.goalBonus || 0, p.contract.appearanceFee || 0,
      p.contract.loanedFrom || 0, p.contract.loanUntilYear || 0, p.contract.wageShare ?? null,
      // Appended rather than inserted: a save written before sell-on clauses
      // existed has a nine-element array, and reading past its end gives
      // undefined, which falls back to no clause.
      p.contract.sellOn || 0, p.contract.sellOnClub || 0,
    ] : null,
    ss: packStats(p.season),
    ca: p.career,
    ts: p.transferStatus === 'none' ? 0 : p.transferStatus,
    yp: p.youthProduct || null,
    cu: p.custom ? 1 : 0,
    // Positions taught by retraining. Almost every player has none, so this is
    // omitted rather than stored as an empty object.
    ln: packLearned(p.learned),
  };
}

function packLearned(learned) {
  if (!learned) return null;
  const parts = [];
  for (const pos in learned) {
    const v = learned[pos];
    if (v > 0) parts.push(`${pos}:${Math.round(v * 10)}`);
  }
  return parts.length ? parts.join('|') : null;
}

function unpackLearned(str) {
  if (!str) return null;
  const out = {};
  for (const part of String(str).split('|')) {
    const [pos, v] = part.split(':');
    if (pos && v) out[pos] = Number(v) / 10;
  }
  return Object.keys(out).length ? out : null;
}

const STAT_KEYS = Object.keys(emptyStats());

function packStats(s) {
  return STAT_KEYS.map((k) => Math.round((s?.[k] ?? 0) * (k === 'ratingSum' ? 10 : 1))).join(',');
}

function unpackStats(str) {
  const parts = String(str || '').split(',');
  const out = emptyStats();
  STAT_KEYS.forEach((k, i) => {
    const v = Number(parts[i] || 0);
    out[k] = k === 'ratingSum' ? v / 10 : v;
  });
  return out;
}

export function unpackPlayer(d) {
  const attrs = unpackScale(d.at, ALL_ATTRS);
  const hidden = unpackScale(d.hi, HIDDEN_ATTRS);
  const first = d.f || '';
  const last = d.l || '';
  return {
    id: d.i,
    first,
    last,
    name: `${first} ${last}`.trim(),
    short: first ? `${first[0]}. ${last}` : last,
    nat: d.n,
    birthYear: d.by,
    birthDay: d.bd,
    age: d.a,
    positions: String(d.po).split(','),
    attrs,
    hidden,
    personality: d.pe || undefined,
    traits: d.tr ? String(d.tr).split(',') : [],
    pa: d.pa,
    height: d.h,
    weight: d.w,
    foot: d.ft,
    clubId: d.c || null,
    squadNumber: d.sn ?? null,
    condition: d.cd,
    sharpness: d.sh,
    morale: d.mo,
    form: (d.fo || 0) / 100,
    devBank: (d.db || 0) / 1000,
    injury: d.inj ? { type: d.inj[0], daysLeft: d.inj[1], totalDays: d.inj[2] } : null,
    suspension: d.su || 0,
    yellowCards: d.yc || 0,
    unhappy: d.un || null,
    learned: unpackLearned(d.ln),
    contract: d.ct ? {
      wage: d.ct[0], expiresYear: d.ct[1], signedYear: d.ct[2], releaseClause: d.ct[3],
      goalBonus: d.ct[4], appearanceFee: d.ct[5], loanedFrom: d.ct[6] || null,
      loanUntilYear: d.ct[7] || null, wageShare: d.ct[8],
      sellOn: d.ct[9] || 0, sellOnClub: d.ct[10] || null,
    } : null,
    season: unpackStats(d.ss),
    career: d.ca || { apps: 0, goals: 0, assists: 0, cleanSheets: 0, motm: 0, seasons: [] },
    transferStatus: d.ts || 'none',
    interestFrom: [],
    youthProduct: d.yp || null,
    custom: !!d.cu,
  };
}

/** Strip runtime-only fields that can be recomputed after loading. */
function cleanClub(club) {
  // Both underscore fields are caches derived from the squad; persisting them
  // would let a save disagree with itself after a transfer.
  const { _roleThresholds, _registered, ...rest } = club;
  return rest;
}

export function serialiseGame(game) {
  const world = game.world;
  const players = [];
  for (const id in world.players) players.push(packPlayer(world.players[id]));

  const clubs = {};
  for (const id in world.clubs) clubs[id] = cleanClub(world.clubs[id]);

  return {
    v: GAME_VERSION,
    savedAt: Date.now(),
    meta: saveMeta(game),
    game: {
      version: game.version,
      seed: game.seed,
      season: game.season,
      day: game.day,
      userClubId: game.userClubId,
      manager: game.manager,
      fixtures: game.fixtures,
      fixturesByDay: game.fixturesByDay,
      inbox: game.inbox,
      transferLog: game.transferLog,
      shortlist: game.shortlist,
      scouted: game.scouted,
      negotiations: game.negotiations || {},
      vacancies: game.vacancies || [],
      offers: game.offers || [],
      status: 'idle',
      pendingMatchId: null,
      lastResults: game.lastResults,
      detailedFixtures: game.detailedFixtures || [],
      settings: game.settings,
      rngState: game.rng.save(),
    },
    world: {
      seed: world.seed,
      size: world.size,
      year: world.year,
      nations: world.nations.map((n) => n.id),
      leagues: world.leagues,
      clubs,
      freeAgents: world.freeAgents,
      competitions: world.competitions,
      hallOfFame: world.hallOfFame || [],
    },
    players,
  };
}

export function saveMeta(game) {
  const club = game.userClubId ? game.world.clubs[game.userClubId] : null;
  const league = club ? game.world.leagues.find((l) => l.id === club.leagueId) : null;
  return {
    manager: game.manager.name,
    club: club ? club.name : 'Unemployed',
    clubColours: club ? club.colours : null,
    league: league ? league.name : '',
    season: game.season,
    year: game.world.year,
    day: game.day,
    size: game.world.size,
    trophies: game.manager.trophies?.length ?? 0,
  };
}

/**
 * Saves are a contract with data that already exists on someone's device.
 * A save written by a newer build cannot be guessed at, so it is refused with
 * an explanation rather than loaded into a shape the code no longer expects;
 * an older one is brought forward here.
 */
export function migrateSave(data) {
  const version = data.v ?? data.game?.version ?? 1;
  if (version > GAME_VERSION) {
    throw new Error(
      `This save was made by a newer version of Touchline (save format ${version}, this build reads ${GAME_VERSION}). Update the game to open it.`,
    );
  }
  // v1 -> v2: players carried a stored `value` that is now derived on demand.
  // Nothing reads the old field, so there is nothing to move; the version is
  // stamped forward so the next migration knows where it starts from.

  // v2 -> v3: clubs gained a visual identity. Without this an old save would
  // draw generated crests from the id hash while the tactics pitch kept showing
  // the club's original random colour pair, and the two would not match.
  if (version < 3 && data.world?.clubs) {
    for (const id in data.world.clubs) {
      const club = data.world.clubs[id];
      if (club.identity) continue;
      club.identity = IDENTITY_MODULE.fallbackIdentity(club);
      const pal = IDENTITY_MODULE.paletteFor(club.identity);
      club.colours = { primary: pal.primary, secondary: pal.secondary };
    }
  }
  // v3 -> v4: training gained an intensity that is actually set, and individual
  // slots. Clubs in an older save have neither, and the intensity in particular
  // was read by the engine while never being written by anything but the UI.
  if (version < 4 && data.world?.clubs) {
    for (const id in data.world.clubs) {
      const club = data.world.clubs[id];
      club.trainingIntensity = club.trainingIntensity || 'Normal';
      club.trainingFocus = club.trainingFocus || 'Balanced';
      club.training = club.training || { slots: [] };
    }
  }
  // v4 -> v5: the academy moves out of the first-team squad, and squads gain a
  // registration list. An older save has every scholar mixed into club.squad;
  // splitting them out retroactively would change a squad the manager has been
  // picking from, so they stay where they are and only the new fields appear.
  if (version < 5 && data.world?.clubs) {
    for (const id in data.world.clubs) {
      const club = data.world.clubs[id];
      club.youthSquad = club.youthSquad || [];
      club.registration = club.registration || [];
    }
  }
  // v5 -> v6: the board ask for three things instead of one, and the manager has
  // a contract. An older save has a single `expectation` and a manager working
  // for nothing, so a dismissal would cost the club nothing and the Club screen
  // would show an empty objectives list until the next rollover.
  // v6 -> v7: negotiations persist between rounds, so they have to persist
  // across a save too - the whole point of a reserve price the seller remembers
  // is that quitting to the menu is not a way to reset it.
  if (version < 7 && data.game && !data.game.negotiations) {
    data.game.negotiations = {};
  }
  // v7 -> v8: a job is a job now, so the world keeps a list of the posts that
  // are actually going. An older save simply starts with none; the next season
  // rollover opens a fresh batch, so a career never dead-ends waiting for one.
  if (version < 8 && data.game && !data.game.vacancies) {
    data.game.vacancies = [];
  }
  // v8 -> v9: the career record. An older save keeps the seasons it has, gains
  // the spells and notable players it never collected, and starts a hall of
  // fame from the next retirement - the ones already deleted are gone.
  if (version < 9) {
    if (data.game?.manager) {
      const m = data.game.manager;
      m.season = m.season || { matches: 0, wins: 0, draws: 0, losses: 0 };
      m.notable = m.notable || [];
      m.spells = m.spells || [];
      m.history = m.history || [];
      // The trophies it already has were cups and leagues; nothing else could
      // produce one before this version.
      m.trophies = (m.trophies || []).map((t) => ({ kind: t.kind || 'cup', ...t }));
      m.departuresSeen = m.departuresSeen ?? (data.game.transferLog?.length || 0);
    }
    if (data.world) data.world.hallOfFame = data.world.hallOfFame || [];
  }
  // Loans exist now, so every club needs somewhere to record who it has lent
  // out - the parent's half of a split wage is charged off that list.
  if (version < 7 && data.world?.clubs) {
    for (const id in data.world.clubs) {
      const club = data.world.clubs[id];
      club.loanedOut = club.loanedOut || [];
    }
  }
  if (version < 6) {
    const leagues = data.world?.leagues || [];
    for (const id in data.world?.clubs || {}) {
      const club = data.world.clubs[id];
      if (!club.board || club.board.objectives?.length) continue;
      const league = leagues.find((l) => l.id === club.leagueId);
      if (!league) continue;
      const finish = club.lastFinish ?? Math.ceil(league.teams / 2);
      club.board.objectives = OBJECTIVES_MODULE.seasonObjectives(club, league, finish);
      // The league ask a save is already being judged against stays exactly as
      // it was; only the two new ones are added.
      if (club.board.expectation) club.board.objectives[0] = { id: 'league', ...club.board.expectation, met: null };
      club.board.expectation = club.board.objectives[0];
    }
    const userClub = data.game?.userClubId ? data.world?.clubs?.[data.game.userClubId] : null;
    if (data.game?.manager && !data.game.manager.contract && userClub) {
      data.game.manager.contract = managerContract(userClub, data.world.year);
    }
  }
  return { ...data, v: GAME_VERSION };
}

export function deserialiseGame(raw) {
  const data = migrateSave(raw);
  const { NATION_BY_ID } = NATION_MODULE;
  const world = {
    seed: data.world.seed,
    size: data.world.size,
    year: data.world.year,
    nations: data.world.nations.map((id) => ({ ...NATION_BY_ID[id] })),
    leagues: data.world.leagues,
    clubs: data.world.clubs,
    players: {},
    freeAgents: data.world.freeAgents,
    competitions: data.world.competitions,
    hallOfFame: data.world.hallOfFame || [],
  };
  for (const packed of data.players) {
    const p = unpackPlayer(packed);
    p.personality = PERSONALITY_FN(p.hidden);
    world.players[p.id] = p;
  }
  const g = data.game;
  const game = {
    version: g.version,
    world,
    seed: g.seed,
    season: g.season,
    day: g.day,
    userClubId: g.userClubId,
    manager: g.manager,
    fixtures: g.fixtures,
    fixturesByDay: g.fixturesByDay,
    inbox: g.inbox,
    transferLog: g.transferLog,
    shortlist: g.shortlist || [],
    scouted: g.scouted || {},
    negotiations: g.negotiations || {},
    vacancies: g.vacancies || [],
    offers: g.offers || [],
    status: 'idle',
    pendingMatchId: null,
    lastResults: g.lastResults || [],
    detailedFixtures: g.detailedFixtures || [],
    settings: g.settings,
    rng: RNG_RESTORE(g.rngState),
  };
  return game;
}

// Imported lazily to avoid a cycle between the codec and the data modules.
import * as NATION_MODULE from '../data/nations.js';
import * as IDENTITY_MODULE from '../gen/identity.js';
import * as OBJECTIVES_MODULE from '../data/objectives.js';
import { personalityFor } from '../gen/playergen.js';
import { Rng } from '../core/rng.js';

const PERSONALITY_FN = personalityFor;
const RNG_RESTORE = (state) => Rng.restore(state);
