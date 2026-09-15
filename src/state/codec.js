// Compact serialisation for save files.
//
// A medium world holds ~6,000 players, each with 38 visible attributes and 10
// hidden ones. Written as plain JSON objects that is tens of megabytes; packed
// into fixed-length strings it is a small fraction of that, which keeps saves
// well inside browser storage limits and makes them quick to write.

import { ALL_ATTRS, HIDDEN_ATTRS } from '../data/attributes.js';
import { GAME_VERSION } from './game.js';
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
    ] : null,
    ss: packStats(p.season),
    ca: p.career,
    ts: p.transferStatus === 'none' ? 0 : p.transferStatus,
    yp: p.youthProduct || null,
    cu: p.custom ? 1 : 0,
  };
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
    contract: d.ct ? {
      wage: d.ct[0], expiresYear: d.ct[1], signedYear: d.ct[2], releaseClause: d.ct[3],
      goalBonus: d.ct[4], appearanceFee: d.ct[5], loanedFrom: d.ct[6] || null,
      loanUntilYear: d.ct[7] || null, wageShare: d.ct[8],
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
  const { _roleThresholds, ...rest } = club;
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
import { personalityFor } from '../gen/playergen.js';
import { Rng } from '../core/rng.js';

const PERSONALITY_FN = personalityFor;
const RNG_RESTORE = (state) => Rng.restore(state);
