// Attribute definitions, positional weightings and derived-ability maths.
// Attributes are on the familiar 1-20 scale. Current Ability (CA) is *derived*
// from attributes rather than stored, so training that raises an attribute
// automatically raises ability.

export const ATTR_GROUPS = {
  technical: [
    'finishing', 'longShots', 'passing', 'crossing', 'dribbling', 'firstTouch',
    'technique', 'tackling', 'marking', 'heading', 'setPieces',
  ],
  goalkeeping: [
    'reflexes', 'handling', 'aerialReach', 'command', 'oneOnOnes', 'distribution',
  ],
  mental: [
    'vision', 'composure', 'decisions', 'anticipation', 'positioning', 'offTheBall',
    'workRate', 'aggression', 'bravery', 'concentration', 'leadership', 'teamwork',
    'flair', 'determination',
  ],
  physical: [
    'pace', 'acceleration', 'stamina', 'strength', 'agility', 'jumping', 'naturalFitness',
  ],
};

export const ATTR_LABELS = {
  finishing: 'Finishing', longShots: 'Long Shots', passing: 'Passing', crossing: 'Crossing',
  dribbling: 'Dribbling', firstTouch: 'First Touch', technique: 'Technique', tackling: 'Tackling',
  marking: 'Marking', heading: 'Heading', setPieces: 'Set Pieces',
  reflexes: 'Reflexes', handling: 'Handling', aerialReach: 'Aerial Reach', command: 'Command of Area',
  oneOnOnes: 'One on Ones', distribution: 'Distribution',
  vision: 'Vision', composure: 'Composure', decisions: 'Decisions', anticipation: 'Anticipation',
  positioning: 'Positioning', offTheBall: 'Off the Ball', workRate: 'Work Rate', aggression: 'Aggression',
  bravery: 'Bravery', concentration: 'Concentration', leadership: 'Leadership', teamwork: 'Teamwork',
  flair: 'Flair', determination: 'Determination',
  pace: 'Pace', acceleration: 'Acceleration', stamina: 'Stamina', strength: 'Strength',
  agility: 'Agility', jumping: 'Jumping Reach', naturalFitness: 'Natural Fitness',
};

export const ALL_ATTRS = [
  ...ATTR_GROUPS.technical,
  ...ATTR_GROUPS.goalkeeping,
  ...ATTR_GROUPS.mental,
  ...ATTR_GROUPS.physical,
];

export const HIDDEN_ATTRS = [
  'consistency', 'importantMatches', 'injuryProneness', 'professionalism',
  'ambition', 'loyalty', 'adaptability', 'versatility', 'dirtiness', 'pressureHandling',
];

export const POSITIONS = ['GK', 'DR', 'DC', 'DL', 'DM', 'MR', 'MC', 'ML', 'AMR', 'AMC', 'AML', 'ST'];

export const POSITION_LABELS = {
  GK: 'Goalkeeper', DR: 'Right Back', DC: 'Centre Back', DL: 'Left Back',
  DM: 'Defensive Midfielder', MR: 'Right Midfielder', MC: 'Central Midfielder',
  ML: 'Left Midfielder', AMR: 'Right Winger', AMC: 'Attacking Midfielder',
  AML: 'Left Winger', ST: 'Striker',
};

/** Broad grouping used for squad balance, wage scales and transfer valuation. */
export const POSITION_GROUP = {
  GK: 'GK', DR: 'DEF', DC: 'DEF', DL: 'DEF', DM: 'MID', MR: 'MID', MC: 'MID',
  ML: 'MID', AMR: 'ATT', AMC: 'ATT', AML: 'ATT', ST: 'ATT',
};

// Weightings used to turn 1-20 attributes into a position-specific ability score.
// They intentionally overlap so players are useful in adjacent roles.
export const POSITION_WEIGHTS = {
  GK: {
    reflexes: 10, handling: 9, oneOnOnes: 7, aerialReach: 6, command: 6, distribution: 5,
    concentration: 7, decisions: 6, positioning: 6, composure: 4, anticipation: 5,
    agility: 6, jumping: 3, strength: 2, bravery: 3, determination: 2, leadership: 2,
  },
  DC: {
    marking: 10, tackling: 10, heading: 8, positioning: 9, anticipation: 7, concentration: 7,
    decisions: 6, strength: 7, jumping: 7, bravery: 6, composure: 5, passing: 4, firstTouch: 3,
    pace: 5, acceleration: 4, stamina: 4, teamwork: 4, leadership: 3, aggression: 4, technique: 2,
  },
  DL: {
    marking: 7, tackling: 8, crossing: 6, positioning: 6, anticipation: 6, concentration: 5,
    decisions: 5, pace: 8, acceleration: 7, stamina: 8, workRate: 7, teamwork: 5,
    passing: 5, firstTouch: 4, dribbling: 4, technique: 4, strength: 4, agility: 4, bravery: 3,
  },
  DM: {
    tackling: 9, marking: 7, positioning: 8, anticipation: 8, decisions: 8, concentration: 6,
    passing: 7, firstTouch: 6, technique: 5, vision: 5, composure: 6, teamwork: 8, workRate: 8,
    stamina: 7, strength: 6, aggression: 5, heading: 4, leadership: 4, pace: 3,
  },
  MC: {
    passing: 9, firstTouch: 8, technique: 8, vision: 8, decisions: 8, composure: 7,
    teamwork: 7, workRate: 7, stamina: 7, offTheBall: 6, anticipation: 6, dribbling: 5,
    tackling: 5, positioning: 5, longShots: 4, agility: 4, strength: 4, flair: 4, concentration: 5,
  },
  MR: {
    crossing: 8, dribbling: 7, passing: 6, technique: 6, firstTouch: 6, pace: 7, acceleration: 7,
    stamina: 8, workRate: 8, offTheBall: 6, decisions: 5, teamwork: 6, tackling: 4, agility: 5,
    vision: 4, flair: 4, anticipation: 4,
  },
  AMC: {
    passing: 8, vision: 9, technique: 9, firstTouch: 9, dribbling: 7, composure: 7, decisions: 7,
    offTheBall: 8, flair: 6, longShots: 6, finishing: 5, agility: 6, acceleration: 5,
    anticipation: 6, teamwork: 4, setPieces: 4, concentration: 4,
  },
  AMR: {
    dribbling: 9, crossing: 8, technique: 8, pace: 9, acceleration: 9, agility: 7, firstTouch: 7,
    offTheBall: 7, flair: 7, finishing: 5, passing: 5, decisions: 5, stamina: 6, workRate: 5,
    composure: 4, anticipation: 4,
  },
  ST: {
    finishing: 10, offTheBall: 9, composure: 8, firstTouch: 7, technique: 6, anticipation: 7,
    heading: 6, dribbling: 5, pace: 7, acceleration: 7, strength: 6, jumping: 5, decisions: 6,
    longShots: 4, agility: 4, determination: 4, passing: 3, bravery: 3,
  },
};
// Mirror the symmetric flanks.
POSITION_WEIGHTS.DR = POSITION_WEIGHTS.DL;
POSITION_WEIGHTS.ML = POSITION_WEIGHTS.MR;
POSITION_WEIGHTS.AML = POSITION_WEIGHTS.AMR;

/** How naturally positions transfer into one another (0-1). Used for familiarity. */
export const POSITION_AFFINITY = {
  GK: { GK: 1 },
  DC: { DC: 1, DM: 0.55, DL: 0.4, DR: 0.4 },
  DL: { DL: 1, DR: 0.7, ML: 0.65, DC: 0.4, MC: 0.3, AML: 0.4 },
  DR: { DR: 1, DL: 0.7, MR: 0.65, DC: 0.4, MC: 0.3, AMR: 0.4 },
  DM: { DM: 1, MC: 0.75, DC: 0.55, MR: 0.3, ML: 0.3 },
  MC: { MC: 1, DM: 0.75, AMC: 0.7, MR: 0.5, ML: 0.5 },
  MR: { MR: 1, ML: 0.7, AMR: 0.8, MC: 0.5, DR: 0.5 },
  ML: { ML: 1, MR: 0.7, AML: 0.8, MC: 0.5, DL: 0.5 },
  AMC: { AMC: 1, MC: 0.7, ST: 0.6, AMR: 0.55, AML: 0.55 },
  AMR: { AMR: 1, AML: 0.7, MR: 0.8, ST: 0.5, AMC: 0.55 },
  AML: { AML: 1, AMR: 0.7, ML: 0.8, ST: 0.5, AMC: 0.55 },
  ST: { ST: 1, AMC: 0.55, AML: 0.45, AMR: 0.45 },
};

/**
 * Position-specific ability on the 1-200 CA scale.
 * A 20-across-the-board player sits at 200; a 1-across player at ~1.
 */
export function abilityForPosition(attrs, pos) {
  const weights = POSITION_WEIGHTS[pos] || POSITION_WEIGHTS.MC;
  let total = 0;
  let acc = 0;
  for (const key in weights) {
    const w = weights[key];
    total += w;
    acc += (attrs[key] ?? 1) * w;
  }
  const avg = total > 0 ? acc / total : 1;
  // Slight convexity: elite attribute sets are worth more than linear.
  const norm = (avg - 1) / 19;
  return Math.round(1 + Math.pow(norm, 1.18) * 199);
}

/** Current Ability at the player's best natural position. */
export function currentAbility(player) {
  let best = 0;
  for (const pos of player.positions) {
    const a = abilityForPosition(player.attrs, pos);
    if (a > best) best = a;
  }
  return best;
}

/** Familiarity 0-20 with a position, from the player's natural positions. */
export function familiarity(player, pos) {
  let best = 0;
  for (const natural of player.positions) {
    const aff = (POSITION_AFFINITY[natural] || {})[pos] || 0;
    if (aff > best) best = aff;
  }
  // Versatility (hidden) lifts the floor for out-of-position deployment.
  const vers = (player.hidden?.versatility ?? 10) / 20;
  const lifted = best + (1 - best) * vers * 0.35;
  return Math.round(lifted * 20);
}

export const FAMILIARITY_LABELS = [
  [19, 'Natural'], [16, 'Accomplished'], [12, 'Competent'], [8, 'Unconvincing'], [0, 'Awkward'],
];

export function familiarityLabel(f) {
  for (const [min, label] of FAMILIARITY_LABELS) if (f >= min) return label;
  return 'Awkward';
}

/** Effectiveness multiplier when deployed at a position (0.55 - 1.0). */
export function positionEffectiveness(player, pos) {
  const f = familiarity(player, pos) / 20;
  return 0.55 + 0.45 * Math.pow(f, 0.8);
}

/** Star rating 0-5 in half steps, relative to a division's ability ceiling. */
export function starRating(ca, ceiling = 160) {
  return Math.round(Math.min(5, (ca / ceiling) * 5) * 2) / 2;
}
