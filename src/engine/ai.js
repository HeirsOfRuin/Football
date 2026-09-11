// AI club management: matchday preparation, board confidence and manager churn.

import { autoPick, autoAssignSpecialists } from './lineup.js';
import { squadStrength } from '../gen/worldgen.js';
import { clamp, remap } from '../core/util.js';
import { currentAbility } from '../data/attributes.js';
import { FORMATION_NAMES, MENTALITIES, defaultTactic } from '../data/tactics.js';
import { makeManagerName } from '../gen/names.js';

const MENTALITY_INDEX = Object.fromEntries(MENTALITIES.map((m, i) => [m, i]));

/** Pick a mentality from relative strength, venue and the manager's instincts. */
export function aiChooseMentality(world, club, opponent, isHome, rng) {
  const mine = squadStrength(world, club);
  const theirs = squadStrength(world, opponent);
  const edge = (mine - theirs) / 14 + (isHome ? 0.6 : -0.3);
  const mgr = club.manager || {};
  const bias = ((mgr.attacking ?? 10) - (mgr.defending ?? 10)) / 9;
  let idx = 3 + Math.round(clamp(edge + bias, -2.6, 2.6));
  idx = clamp(idx + (rng.chance(0.2) ? (rng.chance(0.5) ? 1 : -1) : 0), 0, MENTALITIES.length - 1);
  return MENTALITIES[idx];
}

/** AI clubs occasionally re-think their shape between matches. */
export function aiChooseFormation(world, club, rng) {
  if (!rng.chance(0.12)) return club.tactic.formation;
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const count = (pos) => squad.filter((p) => p.positions.includes(pos)).length;
  const wide = count('AML') + count('AMR') + count('ML') + count('MR');
  const strikers = count('ST');
  const centreBacks = count('DC');
  const candidates = [];
  if (strikers >= 4) candidates.push('4-4-2', '3-5-2', '4-3-1-2');
  if (wide >= 4) candidates.push('4-2-3-1', '4-3-3', '4-4-2');
  if (centreBacks >= 5) candidates.push('3-5-2', '5-3-2', '3-4-3');
  if (!candidates.length) candidates.push(...FORMATION_NAMES);
  return rng.pick(candidates);
}

export function prepareAiClub(world, club, opponent, isHome, rng) {
  const formation = aiChooseFormation(world, club, rng);
  let tactic = { ...club.tactic, formation };
  if (formation !== club.tactic.formation) tactic = { ...defaultTactic(formation), mentality: club.tactic.mentality, instructions: club.tactic.instructions };
  tactic.mentality = aiChooseMentality(world, club, opponent, isHome, rng);
  tactic = autoPick(world, club, tactic);
  tactic = autoAssignSpecialists(world, club, tactic);
  club.tactic = tactic;
  return tactic;
}

// --- Board confidence -------------------------------------------------------

/** How the board reads a league position against its expectation. */
export function expectationScore(expectation, position, teams) {
  if (!expectation) return 0;
  switch (expectation.type) {
    case 'title': return position === 1 ? 22 : position <= 3 ? 6 : position <= 6 ? -10 : -26;
    case 'top': return position <= expectation.target ? 16 : position <= expectation.target + 3 ? 0 : -18;
    case 'mid': return position <= expectation.target ? 12 : position <= expectation.target + 4 ? -3 : -16;
    case 'survive': return position <= expectation.target ? 12 : -20;
    default: return 0;
  }
}

export function updateBoardConfidence(game, club, position, teams) {
  const board = club.board;
  const target = 55 + expectationScore(board.expectation, position, teams) * 1.6;
  const financial = club.finances.balance < -club.finances.incomeEstimate * 0.3 ? -12 : club.finances.balance > 0 ? 3 : -4;
  const form = (club.form || []).reduce((a, f) => a + (f === 'W' ? 3 : f === 'D' ? 0 : -3), 0);
  const drift = (target + financial + form - board.confidence) * 0.14;
  board.confidence = clamp(board.confidence + drift, 0, 100);
  return board.confidence;
}

/** Sack the manager if confidence collapses. Returns true if a change happened. */
export function considerSacking(game, club, rng) {
  if (club.isUserClub) return false;
  const board = club.board;
  if (board.confidence > 22) return false;
  const patience = remap(board.patience, 20, 90, 0.35, 0.08);
  if (!rng.chance(patience)) return false;
  const nation = club.nation;
  const n = makeManagerName(rng, nation);
  const rep = clamp(Math.round(remap(club.rep, 25, 95, 22, 88) + rng.normalClamped(0, 7, -15, 15)), 10, 95);
  const roll = (bias = 0) => clamp(Math.round(rng.normalClamped(remap(club.rep, 25, 95, 6, 17) + bias, 3, 1, 20)), 1, 20);
  club.manager = {
    name: n.full, nat: nation, style: n.style,
    attacking: roll(), defending: roll(), tactical: roll(2), manManagement: roll(2),
    youthDev: roll(), discipline: roll(), reputation: rep, yearsAtClub: 0,
  };
  board.confidence = 52;
  return true;
}

/** Board verdict on the user at the end of a season. */
export function seasonVerdict(game, club, position, teams) {
  const score = expectationScore(club.board.expectation, position, teams);
  if (score >= 16) return { tone: 'delighted', text: 'The board are delighted with the campaign.' };
  if (score >= 6) return { tone: 'pleased', text: 'The board are pleased with how the season went.' };
  if (score >= -3) return { tone: 'satisfied', text: 'The board consider the season acceptable.' };
  if (score >= -16) return { tone: 'concerned', text: 'The board expected more and want to see improvement.' };
  return { tone: 'furious', text: 'The board are deeply unhappy with the season.' };
}

/** AI squad housekeeping between seasons: renew, release, promote youth. */
export function aiSquadHousekeeping(game, club, rng, helpers) {
  const world = game.world;
  const { renewContract, releasePlayer, contractDemand } = helpers;
  const expiring = club.squad.map((id) => world.players[id]).filter((p) => p?.contract && p.contract.expiresYear <= world.year);
  for (const p of expiring) {
    const ca = currentAbility(p);
    const keep = ca >= remap(club.rep, 20, 99, 42, 130) || p.age <= 21;
    if (keep && rng.chance(0.82)) {
      const demand = contractDemand(world, p, club);
      renewContract(world, p, { wage: demand.wage, years: demand.years });
    } else {
      releasePlayer(game, p);
    }
  }
}
