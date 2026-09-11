// Turning a player + a role + a context into the numbers the match engine uses.

import { abilityForPosition, positionEffectiveness, currentAbility } from '../data/attributes.js';
import { ROLES, DUTY_SHIFT, PHASES, MENTALITY_EFFECT, instrIndex } from '../data/tactics.js';
import { clamp, remap, weightedAttrs } from '../core/util.js';
import { TRAITS } from '../gen/playergen.js';

const TRAIT_BY_ID = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

export function traitEffects(player) {
  const out = {};
  for (const id of player.traits || []) {
    const t = TRAIT_BY_ID[id];
    if (!t) continue;
    for (const k in t.effect) out[k] = (out[k] || 0) + t.effect[k];
  }
  return out;
}

/** Condition, morale, sharpness and form roll up into one availability multiplier. */
export function conditionMultiplier(player) {
  const cond = remap(player.condition ?? 100, 25, 100, 0.62, 1.0);
  const sharp = remap(player.sharpness ?? 80, 20, 100, 0.88, 1.03);
  const morale = remap(player.morale ?? 70, 0, 100, 0.93, 1.06);
  const form = clamp(1 + (player.form ?? 0) * 0.04, 0.94, 1.06);
  return cond * sharp * morale * form;
}

/** How well a player's attributes fit a role's emphasis (0.9 - 1.1). */
export function roleSuitability(player, role) {
  if (!role) return 1;
  const emphasis = role.attrs || [];
  if (!emphasis.length) return 1;
  const avg = emphasis.reduce((s, a) => s + (player.attrs[a] || 1), 0) / emphasis.length;
  const overall = currentAbility(player);
  const expected = remap(overall, 40, 190, 7, 17.5);
  return clamp(1 + (avg - expected) * 0.022, 0.88, 1.12);
}

/**
 * Per-phase contributions for one player in one tactical slot.
 * Returns { defend, press, build, create, finish, aerial, drive } on an
 * absolute scale (a top-flight starter contributes roughly 60-160 per phase
 * before role weights are applied).
 */
export function playerPhases(player, slotPos, roleId, duty, opts = {}) {
  const role = ROLES[roleId] || ROLES.CM_DEFEND;
  const shift = DUTY_SHIFT[duty] || DUTY_SHIFT.Support;
  const base = abilityForPosition(player.attrs, slotPos);
  const posEff = positionEffectiveness(player, slotPos);
  const cond = opts.ignoreCondition ? 1 : conditionMultiplier(player);
  const suit = roleSuitability(player, role);
  const scale = base * posEff * cond * suit * (opts.multiplier ?? 1);

  const traits = traitEffects(player);
  const out = {};
  for (const phase of PHASES) {
    const w = role.w[phase] ?? 0;
    const d = shift[phase] ?? 1;
    let v = scale * w * d;
    if (traits[phase]) v *= 1 + traits[phase];
    out[phase] = v;
  }
  // Aerial ability is much more attribute-specific than role-specific.
  const aerialAttr = slotPos === 'GK'
    ? weightedAttrs(player.attrs, { aerialReach: 3, command: 2, jumping: 1 })
    : weightedAttrs(player.attrs, { heading: 3, jumping: 3, strength: 2, bravery: 1, anticipation: 1 });
  out.aerial *= remap(aerialAttr, 5, 18, 0.7, 1.35);
  out.base = base;
  out.posEff = posEff;
  out.cond = cond;
  return out;
}

/** Goalkeeper shot-stopping rating, independent of the phase system. */
export function keeperRating(player) {
  if (!player) return 55;
  const a = weightedAttrs(player.attrs, {
    reflexes: 10, handling: 6, oneOnOnes: 5, positioning: 6, concentration: 5,
    anticipation: 4, agility: 4, decisions: 3, command: 2, bravery: 2,
  });
  return remap(a, 3, 19, 30, 175) * conditionMultiplier(player);
}

/**
 * Roll the whole starting XI into team-level phase totals plus derived
 * tactical characteristics. `side` is { players: [{player, slot, role, duty}], tactic }.
 */
export function teamStrength(lineup, tactic, opts = {}) {
  const totals = { defend: 0, press: 0, build: 0, create: 0, finish: 0, aerial: 0, drive: 0 };
  const perPlayer = [];
  for (const entry of lineup) {
    if (!entry.player) continue;
    const ph = playerPhases(entry.player, entry.slot.pos, entry.role, entry.duty, opts);
    perPlayer.push({ entry, phases: ph });
    if (entry.slot.pos === 'GK') continue; // keeper handled separately
    for (const p in totals) totals[p] += ph[p];
  }

  const mentality = MENTALITY_EFFECT[tactic.mentality] || MENTALITY_EFFECT.Balanced;
  const instr = tactic.instructions || {};
  const iTempo = instrIndex(instr, 'tempo');
  const iWidth = instrIndex(instr, 'width');
  const iPress = instrIndex(instr, 'pressing');
  const iLine = instrIndex(instr, 'defensiveLine');
  const iPass = instrIndex(instr, 'passing');

  // Instructions trade one quality for another rather than granting free value.
  totals.press *= 1 + iPress * 0.11;
  totals.defend *= 1 - Math.abs(iLine) * 0.015 + (iLine < 0 ? 0.045 * -iLine : -0.02 * iLine);
  totals.create *= 1 + iTempo * 0.035 + iWidth * 0.012;
  totals.build *= 1 - Math.abs(iPass) * 0.02 + (iPass < 0 ? 0.035 * -iPass : 0);
  totals.drive *= 1 + iTempo * 0.03 + (iPass > 0 ? iPass * 0.04 : 0);

  totals.create *= mentality.attack;
  totals.finish *= mentality.attack;
  totals.drive *= mentality.attack;
  totals.defend *= mentality.defend;
  totals.build *= 1 + (mentality.attack - 1) * 0.25;

  // Team cohesion: leadership and teamwork lift the whole side slightly.
  const outfield = perPlayer.filter((p) => p.entry.slot.pos !== 'GK');
  const teamwork = outfield.reduce((s, p) => s + (p.entry.player.attrs.teamwork || 10), 0) / Math.max(1, outfield.length);
  const leadership = Math.max(...outfield.map((p) => p.entry.player.attrs.leadership || 1), 1);
  const cohesion = remap(teamwork, 6, 17, 0.95, 1.05) * remap(leadership, 8, 19, 0.99, 1.03);
  for (const p in totals) totals[p] *= cohesion;

  const gkEntry = lineup.find((e) => e.slot.pos === 'GK');
  return {
    totals,
    perPlayer,
    keeper: gkEntry ? gkEntry.player : null,
    keeperRating: keeperRating(gkEntry ? gkEntry.player : null),
    mentality,
    instr,
    idx: { tempo: iTempo, width: iWidth, press: iPress, line: iLine, pass: iPass },
    cohesion,
  };
}

/** Post-match style rating 1-10 built from contributions and events. */
export function computeMatchRating(record) {
  let r = 6.4;
  r += record.goals * 1.05;
  r += record.assists * 0.6;
  r += record.keyPasses * 0.12;
  r += record.shotsOnTarget * 0.07;
  r += record.tackles * 0.055;
  r += record.interceptions * 0.045;
  r += record.saves * 0.18;
  r += record.duelsWon * 0.03;
  r -= record.duelsLost * 0.028;
  r -= record.bigChancesMissed * 0.35;
  r -= record.errors * 0.85;
  r -= record.yellow * 0.25;
  r -= record.red * 1.6;
  r -= record.conceded * (record.isKeeper ? 0.28 : record.isDefender ? 0.16 : 0.05);
  if (record.isKeeper && record.cleanSheet) r += 0.55;
  if (record.isDefender && record.cleanSheet) r += 0.38;
  if (record.minutes < 25) r = 6.3 + (r - 6.4) * 0.45;
  return clamp(Math.round(r * 10) / 10, 1, 10);
}
