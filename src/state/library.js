// The custom player library.
//
// Players created here are templates, not live players: they carry no club,
// contract or statistics. When a campaign starts you choose which templates to
// bring in, and each selected template is turned into a real player in that
// world. The library itself is independent of any save, so a player you build
// once can appear in every campaign you ever start.

import { ALL_ATTRS, HIDDEN_ATTRS, POSITIONS, currentAbility, abilityForPosition, invalidateAbility } from '../data/attributes.js';
import { personalityFor, TRAITS, estimateValue } from '../gen/playergen.js';
import { NATIONS, NATION_BY_ID } from '../data/nations.js';
import { clamp } from '../core/util.js';
import { Rng } from '../core/rng.js';
import { generatePlayer, resetPlayerCounter } from '../gen/playergen.js';

const LIBRARY_KEY = 'touchline.library';
export const LIBRARY_VERSION = 1;

export function blankCustomPlayer() {
  const attrs = {};
  for (const a of ALL_ATTRS) attrs[a] = 10;
  const hidden = {};
  for (const h of HIDDEN_ATTRS) hidden[h] = 10;
  const p = {
    id: `lib_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    first: '',
    last: 'New Player',
    nat: 'ALB',
    age: 21,
    birthDay: 120,
    positions: ['MC'],
    attrs,
    hidden,
    pa: 140,
    height: 180,
    weight: 76,
    foot: 'Right',
    traits: [],
    notes: '',
    createdAt: Date.now(),
  };
  p.name = 'New Player';
  p.personality = personalityFor(hidden);
  return p;
}

/** Seed the editor with a generated player of a chosen shape. */
export function randomCustomPlayer(opts = {}) {
  const {
    nat = 'ALB', pos = 'MC', age = 21, ability = 130, potential = 160, seed = Date.now(),
  } = opts;
  resetPlayerCounter();
  const rng = new Rng(seed);
  const generated = generatePlayer(rng, {
    nationId: nat, pos, age,
    targetCA: clamp(ability, 20, 200),
    targetPA: clamp(Math.max(potential, ability), 20, 200),
    clubRep: 75, leagueRep: 80, year: 2025,
  });
  const p = blankCustomPlayer();
  Object.assign(p, {
    first: generated.first,
    last: generated.last,
    name: generated.name,
    nat,
    age,
    positions: generated.positions,
    attrs: generated.attrs,
    hidden: generated.hidden,
    pa: generated.pa,
    height: generated.height,
    weight: generated.weight,
    foot: generated.foot,
    traits: generated.traits,
  });
  p.personality = personalityFor(p.hidden);
  return p;
}

export function validateCustomPlayer(input) {
  const base = blankCustomPlayer();
  const p = { ...base, ...input };
  // Merge attribute maps rather than replacing them, so a partial import or a
  // file from an older version keeps sensible defaults for anything missing.
  p.attrs = { ...base.attrs, ...(input?.attrs || {}) };
  p.hidden = { ...base.hidden, ...(input?.hidden || {}) };
  for (const a of ALL_ATTRS) p.attrs[a] = clamp(Math.round(Number(p.attrs[a]) || 1), 1, 20);
  for (const h of HIDDEN_ATTRS) p.hidden[h] = clamp(Math.round(Number(p.hidden[h]) || 1), 1, 20);
  p.positions = (Array.isArray(p.positions) ? p.positions : ['MC']).filter((x) => POSITIONS.includes(x));
  if (!p.positions.length) p.positions = ['MC'];
  if (p.positions.length > 3) p.positions.length = 3;
  p.age = clamp(Math.round(Number(p.age) || 21), 15, 42);
  p.height = clamp(Math.round(Number(p.height) || 180), 150, 215);
  p.weight = clamp(Math.round(Number(p.weight) || 76), 45, 120);
  p.nat = NATION_BY_ID[p.nat] ? p.nat : 'ALB';
  p.foot = ['Right', 'Left', 'Both'].includes(p.foot) ? p.foot : 'Right';
  p.last = String(p.last || 'Player').slice(0, 30);
  p.first = String(p.first || '').slice(0, 30);
  p.name = `${p.first} ${p.last}`.trim();
  p.traits = (Array.isArray(p.traits) ? p.traits : []).filter((t) => TRAITS.some((x) => x.id === t)).slice(0, 4);
  p.notes = String(p.notes || '').slice(0, 500);
  invalidateAbility(p);
  const ca = currentAbility(p);
  p.pa = clamp(Math.round(Number(p.pa) || ca), ca, 200);
  p.personality = personalityFor(p.hidden);
  return p;
}

/** Summary figures the editor shows live as attributes are changed. */
export function describeCustomPlayer(p) {
  invalidateAbility(p);
  const ca = currentAbility(p);
  const byPosition = {};
  for (const pos of POSITIONS) byPosition[pos] = abilityForPosition(p.attrs, pos);
  return {
    ability: ca,
    potential: p.pa,
    value: estimateValue(ca, p.pa, p.age, 85),
    byPosition,
    tier: abilityTier(ca),
    personality: personalityFor(p.hidden),
  };
}

const TIERS = [
  [175, 'World class'], [155, 'Elite'], [138, 'Top flight starter'],
  [120, 'Solid top flight'], [100, 'Second tier'], [80, 'Lower league'],
  [55, 'Semi-professional'], [0, 'Amateur'],
];

export function abilityTier(ca) {
  for (const [min, label] of TIERS) if (ca >= min) return label;
  return 'Amateur';
}

// --- Storage ---------------------------------------------------------------

export function listLibrary() {
  try {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '{"v":1,"players":[]}');
    if (!Array.isArray(raw.players)) return [];
    // A library written by a newer build may carry fields this one does not
    // understand; validate rather than trusting the shape.
    return (raw.v ?? 1) > LIBRARY_VERSION ? raw.players.map(validateCustomPlayer) : raw.players;
  } catch {
    return [];
  }
}

function writeLibrary(players) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ v: LIBRARY_VERSION, players }));
}

export function saveToLibrary(player) {
  const clean = validateCustomPlayer(player);
  const players = listLibrary();
  const idx = players.findIndex((p) => p.id === clean.id);
  if (idx >= 0) players[idx] = clean;
  else players.push(clean);
  writeLibrary(players);
  return clean;
}

export function deleteFromLibrary(id) {
  writeLibrary(listLibrary().filter((p) => p.id !== id));
}

export function duplicateInLibrary(id) {
  const players = listLibrary();
  const original = players.find((p) => p.id === id);
  if (!original) return null;
  const copy = validateCustomPlayer({
    ...JSON.parse(JSON.stringify(original)),
    id: `lib_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    last: `${original.last} (copy)`,
    createdAt: Date.now(),
  });
  players.push(copy);
  writeLibrary(players);
  return copy;
}

export function clearLibrary() {
  writeLibrary([]);
}

export function exportLibraryFile() {
  const payload = { v: LIBRARY_VERSION, exportedAt: Date.now(), players: listLibrary() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `touchline-players-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Merge an exported file into the library. Players with an id already present
 * are imported as copies so nothing is silently overwritten.
 */
export async function importLibraryFile(file) {
  const data = JSON.parse(await file.text());
  const incoming = Array.isArray(data) ? data : data.players;
  if (!Array.isArray(incoming)) throw new Error('That file does not contain a player library.');
  if (!Array.isArray(data) && (data.v ?? 1) > LIBRARY_VERSION) {
    throw new Error(`That library was exported by a newer version of Touchline (format ${data.v}).`);
  }
  const existing = listLibrary();
  const ids = new Set(existing.map((p) => p.id));
  let added = 0;
  for (const raw of incoming) {
    const clean = validateCustomPlayer(raw);
    if (ids.has(clean.id)) {
      clean.id = `lib_${Date.now().toString(36)}_${added}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    }
    ids.add(clean.id);
    existing.push(clean);
    added++;
  }
  writeLibrary(existing);
  return added;
}

export const NATION_OPTIONS = NATIONS.map((n) => ({ id: n.id, name: n.name }));
