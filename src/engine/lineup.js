// Turning a tactic + a squad into eleven players and a bench.

import { FORMATIONS, defaultRoleFor, defaultDutyFor, ROLES } from '../data/tactics.js';
import { abilityForPosition, positionEffectiveness, currentAbility } from '../data/attributes.js';
import { sortBy } from '../core/util.js';
import { conditionMultiplier, roleSuitability } from './ratings.js';

export function isAvailable(player) {
  return player && !player.injury && (player.suspension || 0) <= 0;
}

/** Score a player for a given slot — used for auto-picking and AI selection. */
export function slotScore(player, pos, roleId) {
  if (!player) return -1;
  const role = ROLES[roleId];
  const base = abilityForPosition(player.attrs, pos);
  return base * positionEffectiveness(player, pos) * conditionMultiplier(player)
    * (role ? roleSuitability(player, role) : 1);
}

/**
 * Resolve a club's tactic into a concrete lineup.
 * Returns { starters: [{slot, player, role, duty, slotIndex}], bench: [player], missing: n }
 */
export function buildLineup(world, club, tactic, opts = {}) {
  const formation = FORMATIONS[tactic.formation] || FORMATIONS['4-4-2'];
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const available = squad.filter((p) => (opts.ignoreAvailability ? true : isAvailable(p)));
  const used = new Set();
  const starters = [];

  // First pass: honour explicit assignments.
  formation.slots.forEach((slot, i) => {
    const a = tactic.assignments[i] || {};
    const p = a.playerId ? available.find((x) => x.id === a.playerId) : null;
    if (p && !used.has(p.id)) {
      used.add(p.id);
      starters[i] = { slot, slotIndex: i, player: p, role: a.role || defaultRoleFor(slot.pos), duty: a.duty || defaultDutyFor(slot.pos) };
    } else {
      starters[i] = { slot, slotIndex: i, player: null, role: a.role || defaultRoleFor(slot.pos), duty: a.duty || defaultDutyFor(slot.pos) };
    }
  });

  // Second pass: fill gaps with the best remaining player, hardest slot first.
  const gaps = starters.map((s, i) => i).filter((i) => !starters[i].player);
  const scarcity = (pos) => available.filter((p) => !used.has(p.id) && positionEffectiveness(p, pos) > 0.85).length;
  gaps.sort((a, b) => scarcity(starters[a].slot.pos) - scarcity(starters[b].slot.pos));
  for (const i of gaps) {
    const s = starters[i];
    let best = null;
    let bestScore = -1;
    for (const p of available) {
      if (used.has(p.id)) continue;
      const sc = slotScore(p, s.slot.pos, s.role);
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    if (best) { used.add(best.id); s.player = best; }
  }

  const missing = starters.filter((s) => !s.player).length;

  // Bench: explicit picks first, then best available covering each position group.
  const bench = [];
  for (const id of tactic.bench || []) {
    const p = available.find((x) => x.id === id);
    if (p && !used.has(p.id)) { used.add(p.id); bench.push(p); }
  }
  const benchSize = opts.benchSize ?? 9;
  if (bench.length < benchSize) {
    const rest = sortBy(available.filter((p) => !used.has(p.id)), { key: (p) => currentAbility(p), desc: true });
    // Always carry a spare keeper.
    if (!bench.some((p) => p.positions.includes('GK'))) {
      const gk = rest.find((p) => p.positions.includes('GK'));
      if (gk) { bench.push(gk); used.add(gk.id); }
    }
    for (const p of rest) {
      if (bench.length >= benchSize) break;
      if (used.has(p.id)) continue;
      bench.push(p);
      used.add(p.id);
    }
  }

  return { starters, bench, missing, formation };
}

/** Auto-pick: assign the strongest available XI into the current formation. */
export function autoPick(world, club, tactic) {
  const formation = FORMATIONS[tactic.formation] || FORMATIONS['4-4-2'];
  const squad = club.squad.map((id) => world.players[id]).filter(isAvailable);
  const used = new Set();
  const assignments = formation.slots.map((slot, i) => {
    const existing = tactic.assignments[i] || {};
    return { playerId: null, role: existing.role || defaultRoleFor(slot.pos), duty: existing.duty || defaultDutyFor(slot.pos) };
  });

  // Hungarian-lite: repeatedly take the best remaining (slot, player) pair.
  const pairs = [];
  formation.slots.forEach((slot, i) => {
    for (const p of squad) {
      pairs.push({ i, p, score: slotScore(p, slot.pos, assignments[i].role) });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const filled = new Set();
  for (const pair of pairs) {
    if (filled.size >= formation.slots.length) break;
    if (filled.has(pair.i) || used.has(pair.p.id)) continue;
    assignments[pair.i].playerId = pair.p.id;
    filled.add(pair.i);
    used.add(pair.p.id);
  }

  const bench = sortBy(squad.filter((p) => !used.has(p.id)), { key: (p) => currentAbility(p), desc: true });
  const benchIds = [];
  const gk = bench.find((p) => p.positions.includes('GK'));
  if (gk) benchIds.push(gk.id);
  for (const p of bench) {
    if (benchIds.length >= 9) break;
    if (!benchIds.includes(p.id)) benchIds.push(p.id);
  }

  return { ...tactic, assignments, bench: benchIds };
}

/** Pick the best set-piece and captain choices from an XI. */
export function autoAssignSpecialists(world, club, tactic) {
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const best = (weights) => {
    let bestP = null;
    let bestV = -1;
    for (const p of squad) {
      if (!isAvailable(p)) continue;
      let v = 0;
      for (const k in weights) v += (p.attrs[k] || 1) * weights[k];
      if (v > bestV) { bestV = v; bestP = p; }
    }
    return bestP ? bestP.id : null;
  };
  return {
    ...tactic,
    captain: best({ leadership: 4, determination: 2, teamwork: 1, decisions: 1, concentration: 1 }),
    penaltyTaker: best({ finishing: 3, composure: 3, technique: 2, pressureHandling: 1 }),
    freeKickTaker: best({ setPieces: 4, technique: 2, longShots: 2, composure: 1 }),
    cornerTaker: best({ setPieces: 3, crossing: 4, technique: 2, vision: 1 }),
  };
}

/** Squad depth report: which positions are thin. */
export function squadDepth(world, club) {
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const out = {};
  for (const pos of ['GK', 'DR', 'DC', 'DL', 'DM', 'MC', 'MR', 'ML', 'AMR', 'AMC', 'AML', 'ST']) {
    const covering = squad.filter((p) => positionEffectiveness(p, pos) >= 0.92);
    out[pos] = {
      count: covering.length,
      best: covering.length ? Math.max(...covering.map((p) => abilityForPosition(p.attrs, pos))) : 0,
      avg: covering.length ? covering.reduce((s, p) => s + abilityForPosition(p.attrs, pos), 0) / covering.length : 0,
    };
  }
  return out;
}
