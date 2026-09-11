// The match engine.
//
// Matches are simulated as a chain of possession ticks (one tick = 30 seconds
// of action). The team in possession tries to progress through three zones;
// the defending team tries to win the ball back. Chances are generated when a
// side works the ball into the final third, and every chance carries a quality
// (an xG value) that is then resolved against the finisher and the keeper.
//
// The engine is steppable so the UI can stop at half time — or any minute — for
// substitutions, team talks and tactical changes, then resume.

import { Rng } from '../core/rng.js';
import { clamp, remap, weightedAttrs } from '../core/util.js';
import { teamStrength, keeperRating, computeMatchRating, traitEffects } from './ratings.js';
import { buildLineup } from './lineup.js';
import { instrIndex, ROLES } from '../data/tactics.js';
import { POSITION_GROUP } from '../data/attributes.js';

export const TICKS_PER_HALF = 90; // 90 ticks = 45 minutes
export const WEATHER = ['Clear', 'Overcast', 'Light Rain', 'Heavy Rain', 'Windy', 'Snow'];

// Tunables. Kept in one place so the engine can be calibrated against real
// football's shot, possession and scoring rates.
export const P = {
  loseZone: [0.100, 0.140, 0.140],
  advZone: [0.430, 0.360, 0],
  shotZone2: 0.525,
  longShot: 0.034,
  cornerFromFail: 0.720,
  cornerFromMiss: 0.360,
  foulPerTick: 0.082,
  attackFoulPerTick: 0.021,
  foulOnTurnover: 0.090,
  yellowPerFoul: 0.155,
  secondYellowDamping: 0.22,
  straightRed: 0.0007,
  penaltyPerChance: 0.011,
  injuryPerTick: 0.00032,
  offsidePerShot: 0.075,
  chanceQualityBase: 0.0555,
  chanceQualitySpan: 0.133,
  cornerQuality: 0.062,
  freeKickDirectQuality: 0.082,
  longShotQuality: 0.042,
  penaltyQuality: 0.78,
  fatiguePerTick: 0.152,
  clockRunningWhenAhead: 0.075,
};

function emptyMatchStats() {
  return {
    possessionTicks: 0, shots: 0, onTarget: 0, blocked: 0, offTarget: 0, woodwork: 0,
    corners: 0, fouls: 0, yellow: 0, red: 0, offsides: 0, xg: 0, bigChances: 0, saves: 0,
    passesAttempted: 0, passesCompleted: 0,
  };
}

function newRecord(player, isStarter) {
  return {
    playerId: player.id,
    name: player.name,
    short: player.short,
    minutes: 0,
    onPitch: isStarter,
    goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, keyPasses: 0,
    tackles: 0, interceptions: 0, saves: 0, conceded: 0, duelsWon: 0, duelsLost: 0,
    bigChancesMissed: 0, errors: 0, yellow: 0, red: 0, cleanSheet: false,
    isKeeper: false, isDefender: false, subbedOnAt: null, subbedOffAt: null,
    startCondition: player.condition,
  };
}

function buildSide(world, club, tactic, opts) {
  const lu = buildLineup(world, club, tactic, { benchSize: opts.benchSize ?? 7 });
  const side = {
    club,
    clubId: club.id,
    tactic: JSON.parse(JSON.stringify(tactic)),
    starters: lu.starters,
    bench: lu.bench,
    onPitch: lu.starters.filter((s) => s.player),
    subsUsed: 0,
    subsAllowed: opts.subsAllowed ?? 5,
    records: {},
    stats: emptyMatchStats(),
    momentum: 0,
    teamTalkBoost: 0,
    isUser: !!club.isUserClub,
    strength: null,
    goals: 0,
  };
  for (const e of side.onPitch) {
    const r = newRecord(e.player, true);
    r.isKeeper = e.slot.pos === 'GK';
    r.isDefender = POSITION_GROUP[e.slot.pos] === 'DEF';
    side.records[e.player.id] = r;
  }
  for (const p of side.bench) side.records[p.id] = newRecord(p, false);
  return side;
}

/** Recompute a side's phase totals — called at kick-off and after any change. */
export function refreshStrength(state, side) {
  const talkMult = 1 + side.teamTalkBoost * 0.05;
  side.strength = teamStrength(side.onPitch, side.tactic, { multiplier: talkMult });
  side.strength.totals = { ...side.strength.totals };
  const homeFactor = side === state.home ? state.homeAdvantage : 1 / Math.max(0.8, state.homeAdvantage);
  for (const k in side.strength.totals) side.strength.totals[k] *= homeFactor;
}

/** Per-player big-match factor: some players shrink under pressure. */
function pressureMultiplier(player, importance) {
  if (importance <= 0.15) return 1;
  const temperament = ((player.hidden?.importantMatches ?? 10) + (player.hidden?.pressureHandling ?? 10)) / 2;
  return 1 + importance * remap(temperament, 4, 18, -0.09, 0.07);
}

export function beginMatch(world, ctx) {
  const {
    homeClub, awayClub, homeTactic, awayTactic, competition = 'League',
    neutral = false, importance = 0.3, seed, legInfo = null, subsAllowed = 5,
  } = ctx;
  const rng = ctx.rng || new Rng(seed ?? Date.now());

  const weather = rng.weighted(WEATHER, (w) => ({
    Clear: 34, Overcast: 30, 'Light Rain': 18, 'Heavy Rain': 8, Windy: 8, Snow: 2,
  })[w]);

  const crowdPull = remap(homeClub.rep, 25, 95, 0.55, 1.0);
  const attendance = neutral
    ? Math.round(Math.min(homeClub.stadium.capacity, 45000) * rng.range(0.8, 0.98))
    : Math.round(homeClub.stadium.capacity * clamp(homeClub.finances.capacityUse * rng.range(0.9, 1.05) * (1 + importance * 0.08), 0.35, 1));

  const state = {
    rng,
    world,
    competition,
    neutral,
    importance,
    legInfo,
    weather,
    attendance,
    tick: 0,
    minute: 0,
    half: 1,
    stoppage: 0,
    homeAdvantage: neutral ? 1.0 : 1 + 0.040 * crowdPull,
    possession: rng.chance(0.5) ? 'home' : 'away',
    zone: 0,
    onCounter: false,
    events: [],
    finished: false,
    result: null,
    paused: false,
    momentum: 0,
  };
  state.home = buildSide(world, homeClub, homeTactic, { subsAllowed });
  state.away = buildSide(world, awayClub, awayTactic, { subsAllowed });
  state.home.side = 'home';
  state.away.side = 'away';

  // Cache per-player pressure multipliers for the whole match.
  for (const side of [state.home, state.away]) {
    for (const e of side.onPitch) e.pressure = pressureMultiplier(e.player, importance);
    refreshStrength(state, side);
  }

  pushEvent(state, 'kickoff', `Kick-off at ${homeClub.stadium.name}. ${weather}, ${attendance.toLocaleString()} in attendance.`);
  return state;
}

function pushEvent(state, type, text, extra = {}) {
  state.events.push({ minute: state.minute, half: state.half, type, text, ...extra });
}

function rec(side, playerId) {
  return side.records[playerId];
}

function opponentOf(state, side) {
  return side === state.home ? state.away : state.home;
}

/** Weighted pick of an on-pitch player using a phase contribution. */
function pickByPhase(state, side, phase, exclude = null, posBias = null) {
  const pool = side.onPitch.filter((e) => e.slot.pos !== 'GK' && (!exclude || e.player.id !== exclude));
  if (!pool.length) return null;
  return state.rng.weighted(pool, (e) => {
    const ph = side.strength.perPlayer.find((pp) => pp.entry === e);
    let w = ph ? ph.phases[phase] : 1;
    if (posBias) w *= posBias(e.slot.pos);
    // Soften the weighting so chances spread across a side rather than
    // funnelling almost everything through one player.
    return Math.max(0.5, Math.pow(Math.max(0.5, w), 0.82));
  });
}

function advantage(a, b) {
  return a / Math.max(1e-6, a + b);
}

function fatigueTick(state, side) {
  const tempoI = instrIndex(side.tactic.instructions, 'tempo');
  const pressI = instrIndex(side.tactic.instructions, 'pressing');
  const intensity = 1 + tempoI * 0.07 + pressI * 0.09;
  for (const e of side.onPitch) {
    const p = e.player;
    const role = ROLES[e.role];
    const roleWork = e.slot.pos === 'GK' ? 0.18 : 0.7 + (role?.w.press ?? 0.5) * 0.45 + (role?.w.drive ?? 0.4) * 0.3;
    const stamina = remap(p.attrs.stamina || 10, 4, 19, 1.35, 0.72);
    const fitness = remap(p.attrs.naturalFitness || 10, 4, 19, 1.2, 0.85);
    const drain = P.fatiguePerTick * intensity * roleWork * stamina * fitness;
    p.matchCondition = clamp((p.matchCondition ?? p.condition) - drain, 1, 100);
  }
}

/** Live condition used by the engine (does not mutate the saved condition yet). */
function liveMultiplier(entry, state) {
  const p = entry.player;
  const cond = remap(p.matchCondition ?? p.condition, 25, 100, 0.62, 1.0);
  return cond * (entry.pressure ?? 1);
}

/** Team totals adjusted for in-match fatigue and momentum. */
function liveTotals(state, side) {
  const totals = { ...side.strength.totals };
  let fatigueAvg = 0;
  let n = 0;
  for (const e of side.onPitch) {
    if (e.slot.pos === 'GK') continue;
    fatigueAvg += liveMultiplier(e, state);
    n++;
  }
  const f = n ? fatigueAvg / n : 1;
  const mom = side === state.home ? state.momentum : -state.momentum;
  const momMult = 1 + clamp(mom, -1, 1) * 0.06;
  const weatherMult = state.weather === 'Heavy Rain' || state.weather === 'Snow' ? 0.96 : 1;

  // Game state: a side sitting on a comfortable lead eases off, and a side
  // chasing the game throws men forward at the cost of shape.
  const opp = side === state.home ? state.away : state.home;
  const lead = side.goals - opp.goals;
  let attackMult = 1;
  let defendMult = 1;
  if (state.minute >= 50) {
    const urgency = clamp((state.minute - 50) / 40, 0, 1);
    if (lead >= 2) {
      attackMult = 1 - 0.09 * Math.min(3, lead - 1) * urgency;
      defendMult = 1 + 0.06 * urgency;
    } else if (lead <= -2) {
      attackMult = 1 + 0.07 * urgency;
      defendMult = 1 - 0.10 * urgency;
    }
  }

  for (const k in totals) totals[k] *= f * momMult;
  totals.create *= attackMult;
  totals.finish *= attackMult;
  totals.drive *= attackMult;
  totals.defend *= defendMult;
  totals.create *= weatherMult;
  totals.build *= weatherMult;
  // Missing men (red cards) hurt hard.
  const men = side.onPitch.filter((e) => e.slot.pos !== 'GK').length;
  if (men < 10) {
    const penalty = Math.pow(men / 10, 0.85);
    for (const k in totals) totals[k] *= k === 'defend' ? Math.pow(penalty, 0.6) : penalty;
  }
  return totals;
}

function chanceQuality(state, atk, defTot, gkRating, type, opts = {}) {
  if (type === 'penalty') return P.penaltyQuality;
  if (type === 'corner') return P.cornerQuality * state.rng.range(0.6, 1.7);
  if (type === 'freekick') return P.freeKickDirectQuality * state.rng.range(0.5, 1.6);
  if (type === 'longshot') return P.longShotQuality * state.rng.range(0.5, 1.8);
  const adv = advantage(atk.create + atk.finish * 0.5, defTot.defend + gkRating * 0.9);
  const base = P.chanceQualityBase + P.chanceQualitySpan * Math.pow(clamp(adv, 0, 1), 1.25);
  const mine = opts.attacking || {};
  const theirs = opts.defending || {};
  // Every term here is neutral at its default setting, so the engine's overall
  // calibration is untouched by making these instructions matter.
  const shape = 1
    - (mine.width ?? 0) * 0.055
    - (mine.pass ?? 0) * 0.05
    + (mine.focus === 'Through the Middle' ? 0.1 : 0)
    - (mine.focus === 'Left Flank' || mine.focus === 'Right Flank' ? 0.05 : 0)
    + (theirs.line ?? 0) * 0.055
    + (opts.beatTheTrap ? 0.14 : 0)
    + (opts.counter ? 0.4 : 0);
  return clamp(base * shape * state.rng.range(0.35, 2.3), 0.015, 0.82);
}

function resolveShot(state, side, opp, chance) {
  const shooter = chance.shooter;
  const p = shooter.player;
  const r = rec(side, p.id);
  const gk = opp.strength.keeper;
  const gkRec = gk ? rec(opp, gk.id) : null;
  const traits = traitEffects(p);

  const finishAttr = chance.type === 'longshot'
    ? weightedAttrs(p.attrs, { longShots: 4, technique: 2, composure: 2 })
    : chance.type === 'corner'
      ? weightedAttrs(p.attrs, { heading: 4, jumping: 2, bravery: 1, anticipation: 1 })
      : chance.type === 'freekick'
        ? weightedAttrs(p.attrs, { setPieces: 4, technique: 2, longShots: 1 })
        : chance.type === 'penalty'
          ? weightedAttrs(p.attrs, { finishing: 3, composure: 4, technique: 2, pressureHandling: 1 })
          : weightedAttrs(p.attrs, { finishing: 4, composure: 3, technique: 2, firstTouch: 1, offTheBall: 1 });

  const gkR = keeperRating(gk) * (gk ? (gkRec ? liveMultiplier({ player: gk, pressure: 1 }, state) : 1) : 1);
  const skillMult = remap(finishAttr, 4, 19, 0.58, 1.5) * (1 + (traits.finishAcc || 0)) * (chance.oneOnOne ? 1 + (traits.oneOnOne || 0) : 1);
  const gkMult = chance.type === 'penalty'
    ? remap(gkR, 40, 170, 1.06, 0.9)
    : remap(gkR, 40, 170, 1.26, 0.7);
  const weatherMult = state.weather === 'Heavy Rain' ? 0.96 : state.weather === 'Snow' ? 0.93 : state.weather === 'Windy' ? 0.97 : 1;

  const goalP = clamp(chance.quality * skillMult * gkMult * weatherMult * liveMultiplier(shooter, state), 0.008, 0.95);

  side.stats.shots++;
  side.stats.xg += chance.quality;
  r.shots++;
  const isBig = chance.quality >= 0.3;
  if (isBig) side.stats.bigChances++;

  // Offside — wipes the chance out before anything else.
  const trapFactor = (1 + opp.strength.idx.line * 0.2) * (opp.strength.idx.offsideTrap ? 2.2 : 1);
  if (chance.type === 'open' && state.rng.chance(P.offsidePerShot * trapFactor)) {
    side.stats.shots--;
    side.stats.xg -= chance.quality;
    r.shots--;
    side.stats.offsides++;
    pushEvent(state, 'offside', `${p.short} is flagged offside.`, { side: side.side, playerId: p.id });
    return 'offside';
  }

  if (state.rng.chance(goalP)) {
    scoreGoal(state, side, opp, chance);
    return 'goal';
  }

  // Not a goal: blocked, saved, off target or woodwork.
  const onTargetShare = clamp(remap(finishAttr, 4, 19, 0.19, 0.36) + (chance.type === 'penalty' ? 0.35 : 0), 0.14, 0.8);
  const roll = state.rng.next();
  if (isBig) r.bigChancesMissed++;
  if (roll < 0.035) {
    side.stats.woodwork++;
    pushEvent(state, 'woodwork', `${p.short} strikes the woodwork!`, { side: side.side, playerId: p.id, quality: chance.quality });
    return 'woodwork';
  }
  if (roll < 0.035 + onTargetShare) {
    side.stats.onTarget++;
    r.shotsOnTarget++;
    opp.stats.saves++;
    if (gkRec) gkRec.saves++;
    pushEvent(state, 'save', `${p.short} forces a save${gk ? ` from ${gk.short}` : ''}.`, { side: side.side, playerId: p.id, quality: chance.quality });
    return 'saved';
  }
  if (roll < 0.035 + onTargetShare + 0.28) {
    side.stats.blocked++;
    pushEvent(state, 'blocked', `${p.short}'s effort is blocked.`, { side: side.side, playerId: p.id, quality: chance.quality });
    return 'blocked';
  }
  side.stats.offTarget++;
  pushEvent(state, 'miss', isBig ? `${p.short} should have scored — dragged wide!` : `${p.short} fires off target.`, { side: side.side, playerId: p.id, quality: chance.quality });
  return 'miss';
}

function scoreGoal(state, side, opp, chance) {
  const shooter = chance.shooter;
  const p = shooter.player;
  const r = rec(side, p.id);
  r.goals++;
  r.shotsOnTarget++;
  side.stats.onTarget++;
  side.goals++;

  let assistText = '';
  if (chance.assister && chance.type !== 'penalty' && state.rng.chance(chance.type === 'longshot' ? 0.35 : 0.78)) {
    const ar = rec(side, chance.assister.player.id);
    if (ar) { ar.assists++; ar.keyPasses++; }
    assistText = `, set up by ${chance.assister.player.short}`;
  }

  const gk = opp.strength.keeper;
  if (gk && rec(opp, gk.id)) rec(opp, gk.id).conceded++;
  for (const e of opp.onPitch) {
    const orr = rec(opp, e.player.id);
    if (orr && POSITION_GROUP[e.slot.pos] === 'DEF') orr.conceded++;
  }

  const label = {
    penalty: 'converts from the spot', corner: 'heads home from the corner',
    freekick: 'curls in a free kick', longshot: 'lashes one in from distance', open: 'finishes',
  }[chance.type] || 'scores';

  const score = `${state.home.goals}-${state.away.goals}`;
  pushEvent(state, 'goal', `GOAL! ${p.short} ${label}${assistText}. ${state.home.club.short} ${score} ${state.away.club.short}`, {
    side: side.side, playerId: p.id, assistId: chance.assister?.player.id || null,
    quality: chance.quality, goalType: chance.type, score,
  });

  // Scoring lifts a side; conceding stings.
  state.momentum = clamp((side === state.home ? 1 : -1) * 0.55 + state.momentum * 0.3, -1, 1);
  for (const e of side.onPitch) e.player.matchMorale = clamp((e.player.matchMorale ?? 0) + 0.08, -1, 1);
  for (const e of opp.onPitch) e.player.matchMorale = clamp((e.player.matchMorale ?? 0) - 0.06, -1, 1);
  state.possession = opp.side;
  state.zone = 0;
}

function makeChance(state, side, opp, type, forcedShooter = null) {
  const atk = liveTotals(state, side);
  const defTot = liveTotals(state, opp);
  const gkR = keeperRating(opp.strength.keeper);
  const beatTheTrap = type === 'open' && opp.strength.idx.offsideTrap === 1;
  const quality = chanceQuality(state, atk, defTot, gkR, type, {
    attacking: side.strength.idx, defending: opp.strength.idx, beatTheTrap,
    counter: type === 'open' && state.onCounter,
  });

  let shooter = forcedShooter;
  if (!shooter) {
    if (type === 'corner') {
      shooter = pickByPhase(state, side, 'aerial', null, (pos) => (POSITION_GROUP[pos] === 'DEF' ? 1.5 : POSITION_GROUP[pos] === 'ATT' ? 1.2 : 1));
    } else if (type === 'longshot') {
      shooter = pickByPhase(state, side, 'create', null, (pos) => (POSITION_GROUP[pos] === 'MID' ? 1.6 : 1));
    } else {
      shooter = pickByPhase(state, side, 'finish');
    }
  }
  if (!shooter) return null;

  let assister = null;
  if (type === 'open' || type === 'corner') {
    assister = pickByPhase(state, side, type === 'corner' ? 'build' : 'create', shooter.player.id);
    if (assister) {
      const ar = rec(side, assister.player.id);
      if (ar && quality >= 0.12) ar.keyPasses++;
    }
  }

  const chance = { type, quality, shooter, assister, oneOnOne: type === 'open' && quality > 0.35 };

  // Chances in the box can be upgraded into penalties.
  if (type === 'open' && state.rng.chance(P.penaltyPerChance * (1 + quality))) {
    // The designated taker usually steps up, but not always.
    const taker = side.tactic.penaltyTaker && state.rng.chance(0.8)
      ? side.onPitch.find((e) => e.player.id === side.tactic.penaltyTaker)
      : null;
    const pen = { type: 'penalty', quality: P.penaltyQuality, shooter: taker || shooter, assister: null };
    pushEvent(state, 'penalty', `PENALTY to ${side.club.short}!`, { side: side.side });
    const conceder = pickByPhase(state, opp, 'defend');
    if (conceder) registerFoul(state, opp, side, conceder, true);
    return resolveShot(state, side, opp, pen);
  }

  return resolveShot(state, side, opp, chance);
}

function registerFoul(state, foulingSide, victimSide, offender, dangerous = false) {
  foulingSide.stats.fouls++;
  const p = offender.player;
  const r = rec(foulingSide, p.id);
  const dirt = (p.hidden?.dirtiness ?? 10);
  const tackleI = instrIndex(foulingSide.tactic.instructions, 'tackling');
  let yellowP = P.yellowPerFoul * remap(dirt, 3, 18, 0.7, 1.5) * (1 + tackleI * 0.25) * (dangerous ? 2.4 : 1);
  if (r.yellow >= 1) yellowP *= P.secondYellowDamping;
  if (state.rng.chance(clamp(yellowP, 0, 0.85))) {
    if (r.yellow >= 1) {
      r.red = 1;
      r.yellow++;
      foulingSide.stats.yellow++;
      foulingSide.stats.red++;
      sendOff(state, foulingSide, offender, 'second yellow');
    } else {
      r.yellow++;
      foulingSide.stats.yellow++;
      pushEvent(state, 'yellow', `Yellow card for ${p.short}.`, { side: foulingSide.side, playerId: p.id });
    }
  } else if (state.rng.chance(P.straightRed * remap(dirt, 3, 18, 0.5, 2))) {
    r.red = 1;
    foulingSide.stats.red++;
    sendOff(state, foulingSide, offender, 'straight red');
  }
}

function sendOff(state, side, entry, reason) {
  const p = entry.player;
  pushEvent(state, 'red', `RED CARD! ${p.short} is sent off (${reason}). ${side.club.short} down to ${side.onPitch.length - 1} men.`, {
    side: side.side, playerId: p.id,
  });
  side.onPitch = side.onPitch.filter((e) => e !== entry);
  rec(side, p.id).onPitch = false;
  // If the keeper went, an outfielder goes in goal.
  if (entry.slot.pos === 'GK' && side.onPitch.length) {
    const sub = findKeeperSub(state, side);
    if (sub) {
      makeSubstitution(state, side, sub.offId, sub.onId, true);
    } else {
      const outfielder = side.onPitch[side.onPitch.length - 1];
      outfielder.slot = { ...outfielder.slot, pos: 'GK' };
      outfielder.role = 'GK_KEEPER';
      pushEvent(state, 'info', `${outfielder.player.short} goes in goal.`, { side: side.side });
    }
  }
  refreshStrength(state, side);
}

function findKeeperSub(state, side) {
  if (side.subsUsed >= side.subsAllowed) return null;
  const benchGk = side.bench.find((p) => p.positions.includes('GK') && !rec(side, p.id).subbedOnAt);
  if (!benchGk) return null;
  const outfield = side.onPitch.filter((e) => e.slot.pos !== 'GK');
  if (!outfield.length) return null;
  const worst = outfield.reduce((a, b) => (rec(side, a.player.id).minutes > 0 && a.phases < b.phases ? a : b));
  return { offId: worst.player.id, onId: benchGk.id };
}

/** Substitute a player. Returns true if it happened. */
export function makeSubstitution(state, side, offPlayerId, onPlayerId, forced = false) {
  if (!forced && side.subsUsed >= side.subsAllowed) return false;
  const offEntry = side.onPitch.find((e) => e.player.id === offPlayerId);
  const onPlayer = side.bench.find((p) => p.id === onPlayerId);
  if (!offEntry || !onPlayer) return false;
  if (rec(side, onPlayerId).subbedOnAt !== null) return false;

  offEntry.player.matchCondition = offEntry.player.matchCondition ?? offEntry.player.condition;
  rec(side, offPlayerId).onPitch = false;
  rec(side, offPlayerId).subbedOffAt = state.minute;

  const newEntry = {
    slot: offEntry.slot,
    slotIndex: offEntry.slotIndex,
    player: onPlayer,
    role: offEntry.role,
    duty: offEntry.duty,
    pressure: pressureMultiplier(onPlayer, state.importance),
  };
  onPlayer.matchCondition = onPlayer.condition;
  const r = rec(side, onPlayerId);
  r.onPitch = true;
  r.subbedOnAt = state.minute;
  r.isKeeper = newEntry.slot.pos === 'GK';
  r.isDefender = POSITION_GROUP[newEntry.slot.pos] === 'DEF';

  side.onPitch = side.onPitch.map((e) => (e === offEntry ? newEntry : e));
  side.bench = side.bench.filter((p) => p.id !== onPlayerId);
  if (!forced) side.subsUsed++;
  refreshStrength(state, side);
  pushEvent(state, 'sub', `${side.club.short}: ${onPlayer.short} replaces ${offEntry.player.short}.`, {
    side: side.side, playerId: onPlayerId, offId: offPlayerId,
  });
  return true;
}

export function changeMentality(state, side, mentality) {
  side.tactic.mentality = mentality;
  refreshStrength(state, side);
  pushEvent(state, 'tactic', `${side.club.short} switch to a ${mentality.toLowerCase()} approach.`, { side: side.side });
}

export function changeInstruction(state, side, key, value) {
  side.tactic.instructions = { ...side.tactic.instructions, [key]: value };
  refreshStrength(state, side);
}

export function applyTeamTalk(state, side, boost, text) {
  side.teamTalkBoost = clamp(boost, -2, 2);
  refreshStrength(state, side);
  if (text) pushEvent(state, 'talk', text, { side: side.side });
}

// --- AI in-match management -------------------------------------------------

function aiManage(state, side) {
  if (side.isUser && !state.autoManageUser) return;
  const opp = opponentOf(state, side);
  const diff = side.goals - opp.goals;
  const m = state.minute;

  // Chase or protect a result.
  const mgr = side.club.manager;
  const aggression = remap(mgr?.attacking ?? 10, 4, 19, 0.7, 1.3);
  if (m >= 60) {
    const order = MENTALITY_ORDER;
    const cur = order.indexOf(side.tactic.mentality);
    let target = cur;
    if (diff < 0) target = Math.min(order.length - 1, cur + (m >= 78 ? 2 : 1) * (aggression > 1 ? 1 : 1));
    else if (diff > 1 && m >= 75) target = Math.max(0, cur - 1);
    if (target !== cur && !side.mentalityShifted) {
      side.mentalityShifted = true;
      changeMentality(state, side, order[target]);
    }
  }

  // Substitutions: tired legs, then impact changes.
  if (side.subsUsed >= side.subsAllowed || !side.bench.length) return;
  const windows = [46, 58, 66, 72, 80, 86];
  if (!windows.includes(Math.round(m))) return;
  if (!state.rng.chance(0.55)) return;

  const candidates = side.onPitch
    .filter((e) => e.slot.pos !== 'GK')
    .map((e) => ({ e, cond: e.player.matchCondition ?? e.player.condition, r: rec(side, e.player.id) }))
    .sort((a, b) => a.cond - b.cond);

  const tired = candidates.find((c) => c.cond < 62);
  const bookedRisk = candidates.find((c) => c.r.yellow >= 1 && (c.e.player.hidden?.dirtiness ?? 10) > 13 && m > 60);
  const target = tired || (diff < 0 && m >= 70 ? candidates.find((c) => c.r.rating === undefined) : null) || bookedRisk;
  if (!target) return;

  // Pick a replacement suited to that slot.
  const pos = target.e.slot.pos;
  let best = null;
  let bestScore = -1;
  for (const p of side.bench) {
    if (p.positions.includes('GK')) continue;
    const score = scoreBenchOption(p, pos, diff);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (best) makeSubstitution(state, side, target.e.player.id, best.id);
}

const MENTALITY_ORDER = ['Very Defensive', 'Defensive', 'Cautious', 'Balanced', 'Positive', 'Attacking', 'Very Attacking'];

function scoreBenchOption(player, pos, goalDiff) {
  const { abilityForPosition, positionEffectiveness } = ATTR_FNS;
  let s = abilityForPosition(player.attrs, pos) * positionEffectiveness(player, pos);
  if (goalDiff < 0 && ['ST', 'AMC', 'AML', 'AMR'].includes(player.positions[0])) s *= 1.15;
  if (goalDiff > 0 && ['DC', 'DM', 'DL', 'DR'].includes(player.positions[0])) s *= 1.1;
  return s * (player.condition / 100);
}

import { abilityForPosition, positionEffectiveness } from '../data/attributes.js';
const ATTR_FNS = { abilityForPosition, positionEffectiveness };

// --- Core tick -------------------------------------------------------------

function maybeInjury(state, side) {
  const medical = side.club.facilities?.medical ?? 10;
  for (const e of side.onPitch) {
    const p = e.player;
    const prone = remap(p.hidden?.injuryProneness ?? 10, 2, 19, 0.55, 1.9);
    const tiredness = remap(p.matchCondition ?? 100, 30, 100, 1.8, 1.0);
    const care = remap(medical, 3, 19, 1.15, 0.85);
    if (state.rng.chance(P.injuryPerTick * prone * tiredness * care)) {
      const severity = state.rng.next();
      const days = severity < 0.5 ? state.rng.int(3, 10) : severity < 0.82 ? state.rng.int(11, 35) : severity < 0.96 ? state.rng.int(36, 90) : state.rng.int(91, 240);
      const kind = pickInjuryType(state.rng, days);
      p.pendingInjury = { type: kind, days };
      pushEvent(state, 'injury', `${p.short} is down injured — ${kind}.`, { side: side.side, playerId: p.id, days });
      // Force a substitution where possible.
      if (side.bench.length && side.subsUsed < side.subsAllowed) {
        const pos = e.slot.pos;
        let best = null;
        let bestScore = -1;
        for (const b of side.bench) {
          if (pos === 'GK' && !b.positions.includes('GK')) continue;
          if (pos !== 'GK' && b.positions.includes('GK')) continue;
          const sc = scoreBenchOption(b, pos, side.goals - opponentOf(state, side).goals);
          if (sc > bestScore) { bestScore = sc; best = b; }
        }
        if (best) makeSubstitution(state, side, p.id, best.id);
      } else {
        // Plays on, badly.
        e.pressure = (e.pressure ?? 1) * 0.75;
      }
      return;
    }
  }
}

const INJURY_TYPES_LIGHT = ['a knock', 'bruised ribs', 'a dead leg', 'a tight hamstring', 'a sprained ankle'];
const INJURY_TYPES_MED = ['a hamstring strain', 'a groin strain', 'a calf tear', 'ankle ligament damage', 'a shoulder injury'];
const INJURY_TYPES_BAD = ['a broken metatarsal', 'a fractured leg', 'cruciate ligament damage', 'a ruptured achilles', 'a broken collarbone'];

function pickInjuryType(rng, days) {
  if (days <= 10) return rng.pick(INJURY_TYPES_LIGHT);
  if (days <= 45) return rng.pick(INJURY_TYPES_MED);
  return rng.pick(INJURY_TYPES_BAD);
}

/**
 * Fouls happen throughout a match, not only when the ball changes hands, so
 * they are rolled as their own event stream. A defending foul restarts play
 * with the attacking side; an attacking foul concedes possession.
 */
function rollFouls(state, side, opp, zone) {
  const tackleI = instrIndex(opp.tactic.instructions, 'tackling');
  const pressI = instrIndex(opp.tactic.instructions, 'pressing');
  const pDef = P.foulPerTick * (1 + tackleI * 0.28 + pressI * 0.12);
  if (state.rng.chance(pDef)) {
    const offender = pickByPhase(state, opp, state.rng.chance(0.6) ? 'defend' : 'press');
    if (offender) registerFoul(state, opp, side, offender, zone === 2 && state.rng.chance(0.2));
    // A free kick in a dangerous area is a chance in itself.
    if (zone === 2 && state.rng.chance(0.2)) {
      makeChance(state, side, opp, 'freekick');
      if (state.events[state.events.length - 1]?.type === 'goal') return 'goal';
      state.possession = opp.side;
      state.zone = 0;
      return 'converted';
    }
    return 'freekick';
  }
  if (state.rng.chance(P.attackFoulPerTick)) {
    const offender = pickByPhase(state, side, 'drive');
    if (offender) registerFoul(state, side, opp, offender, false);
    state.possession = opp.side;
    state.zone = 2 - zone;
    return 'lost';
  }
  return null;
}

export function stepMatch(state) {
  if (state.finished) return null;
  const startEvents = state.events.length;

  const side = state.possession === 'home' ? state.home : state.away;
  const opp = opponentOf(state, side);
  const atk = liveTotals(state, side);
  const def = liveTotals(state, opp);
  const z = state.zone;

  side.stats.possessionTicks++;
  state.momentum *= 0.985;

  // A side in front naturally slows the game down: possession is kept but
  // nothing is done with it, taking chances out of the match for both teams.
  // The instruction scales that tendency in both directions — a side told never
  // to waste time keeps playing, which is riskier at both ends.
  const lead = side.goals - opponentOf(state, side).goals;
  if (lead > 0 && state.minute >= 55) {
    const slowdown = P.clockRunningWhenAhead * (1 + side.strength.idx.timeWasting * 0.5);
    if (slowdown > 0 && state.rng.chance(slowdown)) {
      if (state.zone > 0 && state.rng.chance(0.5)) state.zone -= 1;
      return endTick(state, side, opp, startEvents);
    }
  }

  const foulOutcome = rollFouls(state, side, opp, z);
  if (foulOutcome === 'goal' || foulOutcome === 'converted' || foulOutcome === 'lost') {
    return endTick(state, side, opp, startEvents);
  }

  if (z < 2) {
    const progressAdv = z === 0
      ? advantage(atk.build * 1.1, def.press)
      : advantage(atk.create + atk.build * 0.5, def.defend * 0.8 + def.press * 0.6);
    const keepAdv = advantage(atk.build + atk.create * 0.35, def.press + def.defend * 0.3);
    const mine = side.strength.idx;
    const theirs = opp.strength.idx;
    // Short passing and a slower tempo protect the ball; a high line from the
    // opposition squeezes the space to play out into.
    const style = (1 - mine.pass * 0.05 - mine.tempo * 0.045) * (1 + theirs.line * 0.055);
    const pLose = P.loseZone[z] * (4.3 - 6.6 * keepAdv) * style;
    const pAdv = P.advZone[z] * (0.74 + 0.42 * progressAdv) * (1 + mine.tempo * 0.085 + mine.pass * 0.075);

    side.stats.passesAttempted += 3;
    const roll = state.rng.next();
    if (roll < pLose) {
      turnover(state, side, opp, z);
    } else if (roll < pLose + pAdv) {
      side.stats.passesCompleted += 3;
      state.zone = z + 1;
    } else if (z === 1 && state.rng.chance(P.longShot * (1 + (atk.create / Math.max(1, def.defend) - 1) * 0.3))) {
      side.stats.passesCompleted += 2;
      makeChance(state, side, opp, 'longshot');
      afterShot(state, side, opp);
    } else {
      side.stats.passesCompleted += 2;
    }
  } else {
    const shotAdv = advantage(atk.create + atk.finish * 0.6 + atk.drive * 0.3, def.defend * 1.15 + keeperRating(opp.strength.keeper) * 0.5);
    const mine = side.strength.idx;
    const theirs = opp.strength.idx;
    const focusCentral = mine.focus === 'Through the Middle';
    const focusFlank = mine.focus === 'Left Flank' || mine.focus === 'Right Flank';
    // Width and attacking focus trade the volume of chances against their quality.
    const volume = 1 + mine.width * 0.075 + (focusFlank ? 0.09 : 0) - (focusCentral ? 0.09 : 0)
      - theirs.line * 0.05 + mine.tempo * 0.04;
    const pShot = P.shotZone2 * (0.5 + 1.0 * shotAdv) * volume;
    const pLose = P.loseZone[2] * (4.3 - 6.6 * advantage(atk.create + atk.build * 0.3, def.defend + def.press * 0.3))
      * (1 + mine.tempo * 0.05);
    const roll = state.rng.next();
    side.stats.passesAttempted += 2;
    if (roll < pShot) {
      side.stats.passesCompleted += 2;
      makeChance(state, side, opp, 'open');
      afterShot(state, side, opp);
    } else if (roll < pShot + pLose) {
      turnover(state, side, opp, 2);
    } else {
      side.stats.passesCompleted++;
      if (state.rng.chance(0.72)) state.zone = 1;
    }
  }

  return endTick(state, side, opp, startEvents);
}

function endTick(state, side, opp, startEvents) {
  fatigueTick(state, side);
  fatigueTick(state, opp);
  if (state.rng.chance(0.5)) maybeInjury(state, state.rng.chance(0.5) ? side : opp);

  state.tick++;
  state.minute = Math.floor(state.tick / 2);

  aiManage(state, state.home);
  aiManage(state, state.away);

  if (state.tick === TICKS_PER_HALF) {
    halfTime(state);
  } else if (state.tick >= TICKS_PER_HALF * 2 + state.stoppage * 2) {
    fullTime(state);
  }

  return state.events.slice(startEvents);
}

function afterShot(state, side, opp) {
  const last = state.events[state.events.length - 1];
  const type = last?.type;
  if (type === 'goal') return;
  const cornerChance = (type === 'blocked' || type === 'save' || type === 'woodwork')
    ? P.cornerFromFail : type === 'miss' ? P.cornerFromMiss : 0;
  if (cornerChance && state.rng.chance(cornerChance)) {
    side.stats.corners++;
    pushEvent(state, 'corner', `Corner for ${side.club.short}.`, { side: side.side });
    if (state.rng.chance(0.42)) {
      makeChance(state, side, opp, 'corner');
      if (state.events[state.events.length - 1]?.type === 'goal') return;
    }
  }
  state.onCounter = false;
  if (type === 'blocked' && state.rng.chance(0.42)) {
    state.zone = 2; // rebound falls to the attacking side
    return;
  }
  state.possession = opp.side;
  state.zone = 0;
}

function turnover(state, side, opp, zone) {
  // Credit the defensive action.
  const winner = pickByPhase(state, opp, state.rng.chance(0.5) ? 'defend' : 'press');
  if (winner) {
    const r = rec(opp, winner.player.id);
    if (r) {
      if (state.rng.chance(0.5)) r.tackles++; else r.interceptions++;
      r.duelsWon++;
    }
  }
  const loser = pickByPhase(state, side, 'build');
  if (loser) {
    const r = rec(side, loser.player.id);
    if (r) {
      r.duelsLost++;
      // Costly errors near your own goal.
      if (zone === 0 && state.rng.chance(0.035)) {
        r.errors++;
        pushEvent(state, 'error', `${loser.player.short} gives it away cheaply in a dangerous area.`, { side: side.side, playerId: loser.player.id });
        state.possession = opp.side;
        state.zone = 2;
        return;
      }
    }
  }

  // A cynical foul stops the break and keeps the ball with the side that had it.
  if (winner && state.rng.chance(P.foulOnTurnover * (1 + instrIndex(opp.tactic.instructions, 'tackling') * 0.3))) {
    registerFoul(state, opp, side, winner, zone >= 1 && state.rng.chance(0.3));
    state.zone = zone;
    return;
  }

  state.possession = opp.side;
  let newZone = 2 - zone;
  const oppTotals = liveTotals(state, opp);
  const counterOn = opp.strength.idx.counter === 1;
  // A high line is what makes a counter-attack worth playing against you.
  const counterChance = (counterOn ? 0.34 : 0.09)
    * (1 + side.strength.idx.line * 0.22)
    * clamp(oppTotals.drive / Math.max(1, liveTotals(state, side).defend), 0.4, 2.2);
  state.onCounter = false;
  if (newZone < 2 && state.rng.chance(counterChance)) {
    newZone += 1;
    // Breaking from deep at pace can carry a side straight into the final third.
    if (newZone < 2 && counterOn && state.rng.chance(0.3)) newZone += 1;
    state.onCounter = true;
    if (state.rng.chance(0.4)) {
      pushEvent(state, 'counter', `${opp.club.short} break at pace.`, { side: opp.side });
    }
  }
  state.zone = newZone;
}

function halfTime(state) {
  state.stoppage = state.rng.int(1, 4);
  state.half = 2;
  state.paused = true;
  pushEvent(state, 'halftime', `Half time: ${state.home.club.short} ${state.home.goals}-${state.away.goals} ${state.away.club.short}`, {
    score: `${state.home.goals}-${state.away.goals}`,
  });
  // Recovery during the break.
  for (const side of [state.home, state.away]) {
    for (const e of side.onPitch) {
      e.player.matchCondition = clamp((e.player.matchCondition ?? e.player.condition) + 4.5, 1, 100);
    }
  }
  state.possession = state.kickedOffFirst === 'home' ? 'away' : 'home';
  state.zone = 0;
}

function fullTime(state) {
  state.finished = true;
  pushEvent(state, 'fulltime', `Full time: ${state.home.club.short} ${state.home.goals}-${state.away.goals} ${state.away.club.short}`, {
    score: `${state.home.goals}-${state.away.goals}`,
  });
  finaliseMatch(state);
}

/** Run the match (or a part of it) without UI interaction. */
export function runMatch(state, untilTick = Infinity) {
  let guard = 0;
  while (!state.finished && state.tick < untilTick && guard++ < 1000) {
    if (state.paused && state.tick >= TICKS_PER_HALF) {
      // Half-time pause is only honoured by the interactive UI.
      state.paused = false;
    }
    stepMatch(state);
  }
  return state;
}

function finaliseMatch(state) {
  const home = state.home;
  const away = state.away;
  const totalTicks = Math.max(1, home.stats.possessionTicks + away.stats.possessionTicks);
  home.stats.possession = Math.round((home.stats.possessionTicks / totalTicks) * 100);
  away.stats.possession = 100 - home.stats.possession;

  for (const [side, opp] of [[home, away], [away, home]]) {
    const cleanSheet = opp.goals === 0;
    for (const id in side.records) {
      const r = side.records[id];
      const entry = side.onPitch.find((e) => e.player.id === id);
      if (r.onPitch) r.minutes = state.minute - (r.subbedOnAt ?? 0);
      else if (r.subbedOffAt !== null) r.minutes = r.subbedOffAt - (r.subbedOnAt ?? 0);
      else if (r.subbedOnAt === null && !r.onPitch && r.red) r.minutes = r.minutes || 0;
      if (r.minutes <= 0 && r.subbedOnAt === null && !r.onPitch && !r.red) r.minutes = 0;
      if (r.red && r.minutes === 0) r.minutes = state.minute;
      r.cleanSheet = cleanSheet && r.minutes >= 45;
      if (r.minutes > 0) r.rating = computeMatchRating(r);
    }
  }

  // Man of the match: best rating, weighted slightly toward the winning side.
  let best = null;
  for (const [side, bonus] of [[home, home.goals >= away.goals ? 0.25 : 0], [away, away.goals >= home.goals ? 0.25 : 0]]) {
    for (const id in side.records) {
      const r = side.records[id];
      if (!r.rating || r.minutes < 25) continue;
      const score = r.rating + bonus;
      if (!best || score > best.score) best = { score, record: r, side };
    }
  }
  if (best) {
    best.record.motm = 1;
    state.motm = { playerId: best.record.playerId, name: best.record.name, rating: best.record.rating, side: best.side.side };
    pushEvent(state, 'motm', `Man of the match: ${best.record.name} (${best.record.rating.toFixed(1)}).`, { playerId: best.record.playerId });
  }

  state.result = {
    homeClubId: home.clubId,
    awayClubId: away.clubId,
    homeGoals: home.goals,
    awayGoals: away.goals,
    homeStats: home.stats,
    awayStats: away.stats,
    attendance: state.attendance,
    weather: state.weather,
    motm: state.motm || null,
    scorers: state.events.filter((e) => e.type === 'goal').map((e) => ({
      minute: e.minute, side: e.side, playerId: e.playerId, type: e.goalType,
    })),
    events: state.events,
    records: { home: home.records, away: away.records },
  };
}

/** Penalty shoot-out for knockout ties. */
export function penaltyShootout(state) {
  const rng = state.rng;
  const takers = (side) => {
    const pool = side.onPitch.filter((e) => e.slot.pos !== 'GK');
    return pool
      .map((e) => ({ e, s: weightedAttrs(e.player.attrs, { finishing: 3, composure: 4, technique: 2, pressureHandling: 2 }) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e);
  };
  const homeTakers = takers(state.home);
  const awayTakers = takers(state.away);
  const score = { home: 0, away: 0 };
  const log = [];

  const take = (side, taker, oppSide) => {
    const gk = oppSide.strength.keeper;
    const skill = weightedAttrs(taker.player.attrs, { finishing: 3, composure: 4, technique: 2, pressureHandling: 2 });
    const gkR = keeperRating(gk);
    const p = clamp(remap(skill, 5, 19, 0.62, 0.9) * remap(gkR, 40, 170, 1.08, 0.9), 0.35, 0.95);
    const scored = rng.chance(p);
    if (scored) score[side.side]++;
    log.push({ side: side.side, playerId: taker.player.id, name: taker.player.short, scored });
    return scored;
  };

  for (let i = 0; i < 5; i++) {
    if (homeTakers[i % homeTakers.length]) take(state.home, homeTakers[i % homeTakers.length], state.away);
    if (awayTakers[i % awayTakers.length]) take(state.away, awayTakers[i % awayTakers.length], state.home);
    const remainingHome = 5 - i - 1;
    const remainingAway = 5 - i - 1;
    if (score.home > score.away + remainingAway || score.away > score.home + remainingHome) break;
  }
  let round = 5;
  while (score.home === score.away && round < 20) {
    take(state.home, homeTakers[round % homeTakers.length], state.away);
    take(state.away, awayTakers[round % awayTakers.length], state.home);
    round++;
  }
  pushEvent(state, 'shootout', `Shoot-out: ${state.home.club.short} ${score.home}-${score.away} ${state.away.club.short}`, { score });
  return { score, log, winner: score.home > score.away ? 'home' : 'away' };
}

/** Extra time: 30 minutes of additional play. */
export function playExtraTime(state) {
  state.finished = false;
  state.half = 3;
  state.stoppage = 0;
  pushEvent(state, 'et', 'We go to extra time.');
  const target = state.tick + 60;
  let guard = 0;
  while (!state.finished && state.tick < target && guard++ < 200) {
    stepMatch(state);
    if (state.tick >= target) break;
  }
  state.finished = true;
  pushEvent(state, 'aet', `After extra time: ${state.home.club.short} ${state.home.goals}-${state.away.goals} ${state.away.club.short}`);
  finaliseMatch(state);
  return state;
}

/** One-call simulation for AI matches. */
export function simulateMatch(world, ctx) {
  const state = beginMatch(world, ctx);
  state.autoManageUser = true;
  runMatch(state);
  return state;
}
