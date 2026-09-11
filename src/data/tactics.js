// Formations, roles and team instructions.
//
// The match engine works in phases. Every player on the pitch contributes a
// share of their ability to each phase, and a role decides how that share is
// split. A ball-winning midfielder pours ability into pressing and defending;
// an advanced playmaker pours it into creation.

export const PHASES = ['defend', 'press', 'build', 'create', 'finish', 'aerial', 'drive'];

/**
 * Roles. `w` = phase weights (they need not sum to anything in particular; the
 * engine normalises). `attrs` = attributes that matter most for this role, used
 * for role-suitability scoring and post-match ratings.
 */
export const ROLES = {
  // --- Goalkeeper ---
  GK_KEEPER: {
    id: 'GK_KEEPER', name: 'Goalkeeper', pos: ['GK'], duties: ['Defend'],
    w: { defend: 1, press: 0, build: 0.15, create: 0, finish: 0, aerial: 0.4, drive: 0 },
    attrs: ['reflexes', 'handling', 'positioning', 'concentration'],
  },
  GK_SWEEPER: {
    id: 'GK_SWEEPER', name: 'Sweeper Keeper', pos: ['GK'], duties: ['Defend', 'Support'],
    w: { defend: 0.95, press: 0.15, build: 0.45, create: 0.05, finish: 0, aerial: 0.4, drive: 0 },
    attrs: ['reflexes', 'oneOnOnes', 'distribution', 'anticipation', 'decisions'],
  },
  // --- Central defenders ---
  CD_DEFEND: {
    id: 'CD_DEFEND', name: 'Centre Back', pos: ['DC'], duties: ['Defend', 'Stopper', 'Cover'],
    w: { defend: 1, press: 0.3, build: 0.35, create: 0.05, finish: 0.05, aerial: 1, drive: 0 },
    attrs: ['marking', 'tackling', 'positioning', 'heading', 'strength'],
  },
  CD_BALL: {
    id: 'CD_BALL', name: 'Ball Playing Defender', pos: ['DC'], duties: ['Defend', 'Cover'],
    w: { defend: 0.85, press: 0.3, build: 0.8, create: 0.2, finish: 0.05, aerial: 0.9, drive: 0.05 },
    attrs: ['passing', 'composure', 'technique', 'marking', 'positioning'],
  },
  CD_LIBERO: {
    id: 'CD_LIBERO', name: 'Libero', pos: ['DC'], duties: ['Support', 'Attack'],
    w: { defend: 0.75, press: 0.35, build: 0.95, create: 0.35, finish: 0.05, aerial: 0.8, drive: 0.3 },
    attrs: ['passing', 'vision', 'dribbling', 'positioning', 'stamina'],
  },
  // --- Full backs ---
  FB_DEFEND: {
    id: 'FB_DEFEND', name: 'Full Back', pos: ['DL', 'DR'], duties: ['Defend', 'Support', 'Attack'],
    w: { defend: 0.85, press: 0.5, build: 0.4, create: 0.3, finish: 0.05, aerial: 0.3, drive: 0.3 },
    attrs: ['marking', 'tackling', 'positioning', 'stamina', 'crossing'],
  },
  FB_WING: {
    id: 'FB_WING', name: 'Wing Back', pos: ['DL', 'DR'], duties: ['Support', 'Attack'],
    w: { defend: 0.6, press: 0.6, build: 0.45, create: 0.65, finish: 0.1, aerial: 0.25, drive: 0.7 },
    attrs: ['crossing', 'pace', 'stamina', 'workRate', 'dribbling'],
  },
  FB_INVERT: {
    id: 'FB_INVERT', name: 'Inverted Full Back', pos: ['DL', 'DR'], duties: ['Defend', 'Support'],
    w: { defend: 0.8, press: 0.55, build: 0.8, create: 0.35, finish: 0.05, aerial: 0.3, drive: 0.15 },
    attrs: ['passing', 'decisions', 'tackling', 'firstTouch', 'positioning'],
  },
  // --- Defensive midfield ---
  DM_ANCHOR: {
    id: 'DM_ANCHOR', name: 'Anchor Man', pos: ['DM'], duties: ['Defend'],
    w: { defend: 1, press: 0.55, build: 0.5, create: 0.1, finish: 0.02, aerial: 0.6, drive: 0 },
    attrs: ['positioning', 'tackling', 'anticipation', 'concentration', 'marking'],
  },
  DM_BWM: {
    id: 'DM_BWM', name: 'Ball Winning Midfielder', pos: ['DM', 'MC'], duties: ['Defend', 'Support'],
    w: { defend: 0.95, press: 1, build: 0.3, create: 0.15, finish: 0.05, aerial: 0.5, drive: 0.15 },
    attrs: ['tackling', 'workRate', 'aggression', 'stamina', 'anticipation'],
  },
  DM_REG: {
    id: 'DM_REG', name: 'Deep Lying Playmaker', pos: ['DM', 'MC'], duties: ['Defend', 'Support'],
    w: { defend: 0.6, press: 0.4, build: 1, create: 0.7, finish: 0.05, aerial: 0.3, drive: 0.1 },
    attrs: ['passing', 'vision', 'firstTouch', 'composure', 'decisions'],
  },
  // --- Central midfield ---
  CM_DEFEND: {
    id: 'CM_DEFEND', name: 'Central Midfielder', pos: ['MC'], duties: ['Defend', 'Support', 'Attack'],
    w: { defend: 0.7, press: 0.7, build: 0.7, create: 0.5, finish: 0.15, aerial: 0.4, drive: 0.3 },
    attrs: ['passing', 'teamwork', 'stamina', 'decisions', 'tackling'],
  },
  CM_BOX: {
    id: 'CM_BOX', name: 'Box to Box Midfielder', pos: ['MC'], duties: ['Support'],
    w: { defend: 0.65, press: 0.85, build: 0.6, create: 0.55, finish: 0.35, aerial: 0.45, drive: 0.7 },
    attrs: ['stamina', 'workRate', 'offTheBall', 'tackling', 'longShots'],
  },
  CM_MEZZ: {
    id: 'CM_MEZZ', name: 'Mezzala', pos: ['MC'], duties: ['Support', 'Attack'],
    w: { defend: 0.4, press: 0.6, build: 0.6, create: 0.9, finish: 0.35, aerial: 0.2, drive: 0.65 },
    attrs: ['dribbling', 'passing', 'flair', 'offTheBall', 'technique'],
  },
  CM_PLAY: {
    id: 'CM_PLAY', name: 'Advanced Playmaker', pos: ['MC', 'AMC'], duties: ['Support', 'Attack'],
    w: { defend: 0.3, press: 0.4, build: 0.75, create: 1.15, finish: 0.3, aerial: 0.15, drive: 0.3 },
    attrs: ['vision', 'passing', 'technique', 'firstTouch', 'composure'],
  },
  // --- Wide midfield ---
  WM_SUPPORT: {
    id: 'WM_SUPPORT', name: 'Wide Midfielder', pos: ['ML', 'MR'], duties: ['Defend', 'Support', 'Attack'],
    w: { defend: 0.55, press: 0.7, build: 0.45, create: 0.75, finish: 0.2, aerial: 0.25, drive: 0.6 },
    attrs: ['crossing', 'stamina', 'workRate', 'passing', 'tackling'],
  },
  WM_WINGER: {
    id: 'WM_WINGER', name: 'Winger', pos: ['ML', 'MR', 'AML', 'AMR'], duties: ['Support', 'Attack'],
    w: { defend: 0.25, press: 0.5, build: 0.3, create: 1.1, finish: 0.3, aerial: 0.15, drive: 0.95 },
    attrs: ['crossing', 'dribbling', 'pace', 'acceleration', 'technique'],
  },
  WM_INSIDE: {
    id: 'WM_INSIDE', name: 'Inside Forward', pos: ['AML', 'AMR'], duties: ['Support', 'Attack'],
    w: { defend: 0.2, press: 0.55, build: 0.25, create: 0.8, finish: 0.75, aerial: 0.15, drive: 0.85 },
    attrs: ['dribbling', 'finishing', 'acceleration', 'technique', 'offTheBall'],
  },
  WM_RAUM: {
    id: 'WM_RAUM', name: 'Raumdeuter', pos: ['AML', 'AMR'], duties: ['Attack'],
    w: { defend: 0.1, press: 0.4, build: 0.15, create: 0.55, finish: 1, aerial: 0.3, drive: 0.6 },
    attrs: ['offTheBall', 'finishing', 'anticipation', 'composure', 'firstTouch'],
  },
  // --- Attacking midfield ---
  AM_SHADOW: {
    id: 'AM_SHADOW', name: 'Shadow Striker', pos: ['AMC'], duties: ['Attack'],
    w: { defend: 0.15, press: 0.6, build: 0.2, create: 0.6, finish: 1.05, aerial: 0.25, drive: 0.7 },
    attrs: ['offTheBall', 'finishing', 'composure', 'acceleration', 'anticipation'],
  },
  AM_TREQ: {
    id: 'AM_TREQ', name: 'Trequartista', pos: ['AMC', 'ST'], duties: ['Attack'],
    w: { defend: 0.05, press: 0.2, build: 0.35, create: 1.2, finish: 0.6, aerial: 0.15, drive: 0.45 },
    attrs: ['vision', 'flair', 'technique', 'dribbling', 'firstTouch'],
  },
  // --- Strikers ---
  ST_POACHER: {
    id: 'ST_POACHER', name: 'Poacher', pos: ['ST'], duties: ['Attack'],
    w: { defend: 0.05, press: 0.3, build: 0.1, create: 0.25, finish: 1.35, aerial: 0.5, drive: 0.35 },
    attrs: ['finishing', 'offTheBall', 'composure', 'anticipation', 'firstTouch'],
  },
  ST_TARGET: {
    id: 'ST_TARGET', name: 'Target Man', pos: ['ST'], duties: ['Support', 'Attack'],
    w: { defend: 0.2, press: 0.35, build: 0.55, create: 0.45, finish: 0.9, aerial: 1.3, drive: 0.2 },
    attrs: ['heading', 'strength', 'jumping', 'bravery', 'finishing'],
  },
  ST_FALSE: {
    id: 'ST_FALSE', name: 'False Nine', pos: ['ST'], duties: ['Support'],
    w: { defend: 0.15, press: 0.55, build: 0.6, create: 1.05, finish: 0.75, aerial: 0.2, drive: 0.4 },
    attrs: ['passing', 'vision', 'firstTouch', 'technique', 'offTheBall'],
  },
  ST_COMPLETE: {
    id: 'ST_COMPLETE', name: 'Complete Forward', pos: ['ST'], duties: ['Support', 'Attack'],
    w: { defend: 0.15, press: 0.5, build: 0.4, create: 0.7, finish: 1.15, aerial: 0.8, drive: 0.6 },
    attrs: ['finishing', 'dribbling', 'offTheBall', 'firstTouch', 'strength'],
  },
  ST_PRESS: {
    id: 'ST_PRESS', name: 'Pressing Forward', pos: ['ST'], duties: ['Support', 'Defend'],
    w: { defend: 0.35, press: 1.25, build: 0.3, create: 0.45, finish: 0.8, aerial: 0.5, drive: 0.45 },
    attrs: ['workRate', 'stamina', 'aggression', 'finishing', 'bravery'],
  },
};

/** Duty shifts a role's weights toward defending or attacking. */
export const DUTY_SHIFT = {
  Defend: { defend: 1.18, press: 1.05, build: 1.0, create: 0.85, finish: 0.75, drive: 0.7, aerial: 1.05 },
  Cover: { defend: 1.22, press: 0.9, build: 1.0, create: 0.85, finish: 0.7, drive: 0.6, aerial: 1.0 },
  Stopper: { defend: 1.1, press: 1.25, build: 0.95, create: 0.85, finish: 0.9, drive: 0.8, aerial: 1.15 },
  Support: { defend: 1.0, press: 1.0, build: 1.05, create: 1.05, finish: 1.0, drive: 1.0, aerial: 1.0 },
  Attack: { defend: 0.8, press: 1.0, build: 0.9, create: 1.12, finish: 1.2, drive: 1.25, aerial: 1.0 },
};

export function rolesForPosition(pos) {
  return Object.values(ROLES).filter((r) => r.pos.includes(pos));
}

export function defaultRoleFor(pos) {
  const map = {
    GK: 'GK_KEEPER', DC: 'CD_DEFEND', DL: 'FB_DEFEND', DR: 'FB_DEFEND',
    DM: 'DM_ANCHOR', MC: 'CM_DEFEND', ML: 'WM_SUPPORT', MR: 'WM_SUPPORT',
    AML: 'WM_INSIDE', AMR: 'WM_INSIDE', AMC: 'CM_PLAY', ST: 'ST_COMPLETE',
  };
  return map[pos] || 'CM_DEFEND';
}

export function defaultDutyFor(pos) {
  if (pos === 'GK') return 'Defend';
  if (['DC', 'DL', 'DR', 'DM'].includes(pos)) return 'Defend';
  if (['ST', 'AMC', 'AML', 'AMR'].includes(pos)) return 'Attack';
  return 'Support';
}

/**
 * Formations. x: 0 (left touchline) - 100 (right). y: 0 (own goal) - 100 (opp goal).
 */
export const FORMATIONS = {
  '4-4-2': {
    name: '4-4-2', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 82, y: 22 }, { pos: 'DC', x: 62, y: 18 }, { pos: 'DC', x: 38, y: 18 }, { pos: 'DL', x: 18, y: 22 },
      { pos: 'MR', x: 84, y: 50 }, { pos: 'MC', x: 60, y: 46 }, { pos: 'MC', x: 40, y: 46 }, { pos: 'ML', x: 16, y: 50 },
      { pos: 'ST', x: 60, y: 80 }, { pos: 'ST', x: 40, y: 80 },
    ],
  },
  '4-4-2 Diamond': {
    name: '4-4-2 Diamond', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 84, y: 22 }, { pos: 'DC', x: 62, y: 18 }, { pos: 'DC', x: 38, y: 18 }, { pos: 'DL', x: 16, y: 22 },
      { pos: 'DM', x: 50, y: 36 }, { pos: 'MC', x: 74, y: 50 }, { pos: 'MC', x: 26, y: 50 }, { pos: 'AMC', x: 50, y: 66 },
      { pos: 'ST', x: 60, y: 82 }, { pos: 'ST', x: 40, y: 82 },
    ],
  },
  '4-2-3-1': {
    name: '4-2-3-1', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 84, y: 22 }, { pos: 'DC', x: 62, y: 17 }, { pos: 'DC', x: 38, y: 17 }, { pos: 'DL', x: 16, y: 22 },
      { pos: 'DM', x: 62, y: 38 }, { pos: 'DM', x: 38, y: 38 },
      { pos: 'AMR', x: 84, y: 62 }, { pos: 'AMC', x: 50, y: 62 }, { pos: 'AML', x: 16, y: 62 },
      { pos: 'ST', x: 50, y: 84 },
    ],
  },
  '4-3-3': {
    name: '4-3-3', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 84, y: 22 }, { pos: 'DC', x: 62, y: 17 }, { pos: 'DC', x: 38, y: 17 }, { pos: 'DL', x: 16, y: 22 },
      { pos: 'MC', x: 68, y: 45 }, { pos: 'DM', x: 50, y: 38 }, { pos: 'MC', x: 32, y: 45 },
      { pos: 'AMR', x: 82, y: 74 }, { pos: 'ST', x: 50, y: 82 }, { pos: 'AML', x: 18, y: 74 },
    ],
  },
  '4-1-4-1': {
    name: '4-1-4-1', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 84, y: 22 }, { pos: 'DC', x: 62, y: 17 }, { pos: 'DC', x: 38, y: 17 }, { pos: 'DL', x: 16, y: 22 },
      { pos: 'DM', x: 50, y: 36 },
      { pos: 'MR', x: 84, y: 56 }, { pos: 'MC', x: 62, y: 52 }, { pos: 'MC', x: 38, y: 52 }, { pos: 'ML', x: 16, y: 56 },
      { pos: 'ST', x: 50, y: 82 },
    ],
  },
  '4-5-1': {
    name: '4-5-1', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 84, y: 22 }, { pos: 'DC', x: 62, y: 17 }, { pos: 'DC', x: 38, y: 17 }, { pos: 'DL', x: 16, y: 22 },
      { pos: 'MR', x: 85, y: 48 }, { pos: 'MC', x: 66, y: 44 }, { pos: 'DM', x: 50, y: 38 }, { pos: 'MC', x: 34, y: 44 }, { pos: 'ML', x: 15, y: 48 },
      { pos: 'ST', x: 50, y: 80 },
    ],
  },
  '3-5-2': {
    name: '3-5-2', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DC', x: 68, y: 18 }, { pos: 'DC', x: 50, y: 16 }, { pos: 'DC', x: 32, y: 18 },
      { pos: 'DR', x: 88, y: 48 }, { pos: 'MC', x: 64, y: 46 }, { pos: 'DM', x: 50, y: 38 }, { pos: 'MC', x: 36, y: 46 }, { pos: 'DL', x: 12, y: 48 },
      { pos: 'ST', x: 60, y: 80 }, { pos: 'ST', x: 40, y: 80 },
    ],
  },
  '3-4-3': {
    name: '3-4-3', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DC', x: 68, y: 18 }, { pos: 'DC', x: 50, y: 16 }, { pos: 'DC', x: 32, y: 18 },
      { pos: 'DR', x: 88, y: 48 }, { pos: 'MC', x: 62, y: 44 }, { pos: 'MC', x: 38, y: 44 }, { pos: 'DL', x: 12, y: 48 },
      { pos: 'AMR', x: 78, y: 76 }, { pos: 'ST', x: 50, y: 82 }, { pos: 'AML', x: 22, y: 76 },
    ],
  },
  '5-3-2': {
    name: '5-3-2', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 88, y: 30 }, { pos: 'DC', x: 68, y: 16 }, { pos: 'DC', x: 50, y: 14 }, { pos: 'DC', x: 32, y: 16 }, { pos: 'DL', x: 12, y: 30 },
      { pos: 'MC', x: 66, y: 46 }, { pos: 'DM', x: 50, y: 40 }, { pos: 'MC', x: 34, y: 46 },
      { pos: 'ST', x: 60, y: 78 }, { pos: 'ST', x: 40, y: 78 },
    ],
  },
  '5-4-1': {
    name: '5-4-1', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 88, y: 28 }, { pos: 'DC', x: 68, y: 15 }, { pos: 'DC', x: 50, y: 13 }, { pos: 'DC', x: 32, y: 15 }, { pos: 'DL', x: 12, y: 28 },
      { pos: 'MR', x: 82, y: 50 }, { pos: 'MC', x: 60, y: 44 }, { pos: 'MC', x: 40, y: 44 }, { pos: 'ML', x: 18, y: 50 },
      { pos: 'ST', x: 50, y: 78 },
    ],
  },
  '4-3-1-2': {
    name: '4-3-1-2', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 84, y: 22 }, { pos: 'DC', x: 62, y: 17 }, { pos: 'DC', x: 38, y: 17 }, { pos: 'DL', x: 16, y: 22 },
      { pos: 'MC', x: 70, y: 44 }, { pos: 'DM', x: 50, y: 38 }, { pos: 'MC', x: 30, y: 44 },
      { pos: 'AMC', x: 50, y: 64 },
      { pos: 'ST', x: 61, y: 82 }, { pos: 'ST', x: 39, y: 82 },
    ],
  },
  '4-2-2-2': {
    name: '4-2-2-2', slots: [
      { pos: 'GK', x: 50, y: 5 },
      { pos: 'DR', x: 84, y: 22 }, { pos: 'DC', x: 62, y: 17 }, { pos: 'DC', x: 38, y: 17 }, { pos: 'DL', x: 16, y: 22 },
      { pos: 'DM', x: 62, y: 38 }, { pos: 'DM', x: 38, y: 38 },
      { pos: 'AMR', x: 80, y: 62 }, { pos: 'AML', x: 20, y: 62 },
      { pos: 'ST', x: 60, y: 82 }, { pos: 'ST', x: 40, y: 82 },
    ],
  },
};

export const FORMATION_NAMES = Object.keys(FORMATIONS);

export const MENTALITIES = ['Very Defensive', 'Defensive', 'Cautious', 'Balanced', 'Positive', 'Attacking', 'Very Attacking'];

/** Mentality multipliers applied to the team's phase totals and risk profile. */
export const MENTALITY_EFFECT = {
  'Very Defensive': { attack: 0.72, defend: 1.28, risk: 0.6, tempo: -2, line: -2, possessionBias: -0.06 },
  Defensive: { attack: 0.84, defend: 1.18, risk: 0.75, tempo: -1, line: -1, possessionBias: -0.035 },
  Cautious: { attack: 0.93, defend: 1.09, risk: 0.88, tempo: -1, line: -1, possessionBias: -0.015 },
  Balanced: { attack: 1.0, defend: 1.0, risk: 1.0, tempo: 0, line: 0, possessionBias: 0 },
  Positive: { attack: 1.08, defend: 0.93, risk: 1.13, tempo: 1, line: 1, possessionBias: 0.02 },
  Attacking: { attack: 1.17, defend: 0.85, risk: 1.3, tempo: 1, line: 1, possessionBias: 0.04 },
  'Very Attacking': { attack: 1.28, defend: 0.74, risk: 1.5, tempo: 2, line: 2, possessionBias: 0.06 },
};

export const INSTRUCTION_DEFS = {
  tempo: { label: 'Tempo', options: ['Very Slow', 'Slow', 'Standard', 'Higher', 'Very High'], default: 'Standard' },
  width: { label: 'Width', options: ['Very Narrow', 'Narrow', 'Standard', 'Wide', 'Very Wide'], default: 'Standard' },
  pressing: { label: 'Pressing', options: ['Much Less', 'Less', 'Standard', 'More', 'Much More'], default: 'Standard' },
  defensiveLine: { label: 'Defensive Line', options: ['Much Deeper', 'Deeper', 'Standard', 'Higher', 'Much Higher'], default: 'Standard' },
  passing: { label: 'Passing Directness', options: ['Very Short', 'Shorter', 'Standard', 'More Direct', 'Long Ball'], default: 'Standard' },
  tackling: { label: 'Tackling', options: ['Stay on Feet', 'Standard', 'Get Stuck In'], default: 'Standard' },
  timeWasting: { label: 'Time Wasting', options: ['Never', 'Rarely', 'Standard', 'Often', 'Always'], default: 'Standard' },
  counter: { label: 'Counter Attack', options: ['No', 'Yes'], default: 'No' },
  offsideTrap: { label: 'Offside Trap', options: ['No', 'Yes'], default: 'No' },
  focus: { label: 'Attacking Focus', options: ['Left Flank', 'Mixed', 'Through the Middle', 'Right Flank'], default: 'Mixed' },
};

export function defaultInstructions() {
  const out = {};
  for (const key in INSTRUCTION_DEFS) out[key] = INSTRUCTION_DEFS[key].default;
  return out;
}

/** Index of an instruction option, centred on 0 for the standard setting. */
export function instrIndex(instructions, key) {
  const def = INSTRUCTION_DEFS[key];
  const idx = def.options.indexOf(instructions[key] ?? def.default);
  const centre = def.options.indexOf(def.default);
  return idx - centre;
}

export function defaultTactic(formationName = '4-4-2') {
  const f = FORMATIONS[formationName];
  return {
    formation: formationName,
    mentality: 'Balanced',
    instructions: defaultInstructions(),
    // slotIndex -> { playerId, role, duty }
    assignments: f.slots.map((s) => ({
      playerId: null, role: defaultRoleFor(s.pos), duty: defaultDutyFor(s.pos),
    })),
    bench: [],
    captain: null,
    penaltyTaker: null,
    freeKickTaker: null,
    cornerTaker: null,
  };
}
