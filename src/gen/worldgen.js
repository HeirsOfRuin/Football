// World generation: nations -> leagues -> clubs -> squads -> staff -> finances.

import { Rng, subRng } from '../core/rng.js';
import { assignIdentities } from './identity.js';
import { clamp, remap, sortBy } from '../core/util.js';
import {
  NATION_BY_ID, LEAGUE_TEMPLATES, WORLD_SIZES, CONTINENTAL, SECONDARY_CONTINENTAL,
  statusForRep, abilityForReputation, commercialIncome,
} from '../data/nations.js';

export { abilityForReputation, commercialIncome };
import { defaultTactic } from '../data/tactics.js';
import { currentAbility } from '../data/attributes.js';
import { makeCityNamer, makeClubNamer, shortenClubName, clubCode, makeStadiumName, makeManagerName } from './names.js';
import { generatePlayer, estimateWage, estimateValue, resetPlayerCounter, emptyStats } from './playergen.js';

/** Positional make-up of a generated squad. */
const SQUAD_TEMPLATE = [
  'GK', 'GK', 'GK',
  'DC', 'DC', 'DC', 'DC', 'DL', 'DL', 'DR', 'DR',
  'DM', 'DM', 'MC', 'MC', 'MC', 'MC', 'ML', 'MR',
  'AML', 'AMR', 'AMC', 'AMC',
  'ST', 'ST', 'ST',
];

/** Relative ability of each squad slot, best to worst. */
const SQUAD_QUALITY_CURVE = [
  1.07, 1.055, 1.045, 1.035, 1.025, 1.015, 1.005, 0.995, 0.985, 0.975, 0.965,
  0.94, 0.925, 0.91, 0.895, 0.88, 0.865,
  0.835, 0.81, 0.785, 0.755,
  0.71, 0.67, 0.63, 0.58, 0.53,
];

/**
 * An ordered list of positions to fill, sized to the club. Goalkeepers are
 * spread across the quality curve rather than clumped, so a club gets a real
 * number one and a real deputy. Smaller clubs carry fewer bodies, which is both
 * realistic and what keeps a deep pyramid affordable to simulate.
 */
function squadPlan(rng, size) {
  const keepers = size >= 24 ? 3 : 2;
  const outfieldNeeded = size - keepers;
  const pool = SQUAD_TEMPLATE.filter((p) => p !== 'GK');
  const outfield = rng.shuffle([...pool]).slice(0, outfieldNeeded);
  // Top up if the club is bigger than the template's outfield bag.
  while (outfield.length < outfieldNeeded) outfield.push(rng.pick(pool));

  const order = ['GK'];
  outfield.slice(0, 10).forEach((p) => order.push(p));
  order.push('GK');
  outfield.slice(10).forEach((p) => order.push(p));
  if (keepers === 3) order.push('GK');
  return order;
}

function ageForSlot(rng, index) {
  // A realistic age pyramid: prime-age core, a few veterans, a few prospects.
  const roll = rng.next();
  if (index < 11) {
    if (roll < 0.1) return rng.int(19, 21);
    if (roll < 0.75) return rng.int(23, 29);
    if (roll < 0.92) return rng.int(30, 33);
    return rng.int(21, 23);
  }
  if (roll < 0.3) return rng.int(17, 20);
  if (roll < 0.75) return rng.int(21, 27);
  if (roll < 0.92) return rng.int(28, 32);
  return rng.int(33, 36);
}

function pickNationality(rng, homeNationId, clubRep, worldNations) {
  const foreignChance = remap(clubRep, 30, 95, 0.06, 0.55);
  if (!rng.chance(foreignChance)) return homeNationId;
  const others = worldNations.filter((n) => n !== homeNationId);
  if (!others.length) return homeNationId;
  return rng.weighted(others, (id) => {
    const n = NATION_BY_ID[id];
    // Rich leagues import from strong-production, lower-wealth nations.
    return Math.pow(n.youthRep / 100, 2.2) * (1.4 - n.wealth * 0.6) * 10;
  });
}

/** Potential ability for a newly generated player. */
function rollPotential(rng, nationId, clubRep, age, targetCA) {
  const nation = NATION_BY_ID[nationId];
  const ceiling = remap(clubRep, 25, 95, 120, 190) + remap(nation.youthRep, 60, 98, -6, 10);
  let pa = rng.normalClamped(targetCA + remap(age, 16, 30, 34, 2), 16, targetCA, 200);
  pa = Math.min(pa, ceiling + rng.normalClamped(0, 9, -18, 22));
  return clamp(Math.round(Math.max(pa, targetCA)), targetCA, 200);
}

function makeContract(rng, player, club, year, ca, status = null) {
  const st = status || statusForRep(club.rep);
  // Part-time and amateur clubs cannot tie players down for years, and cannot
  // pay them a living: a contract here is a season and a bit of petrol money.
  const [minYears, maxYears] = st.contractYears;
  const years = clamp(
    player.age >= 33 ? rng.int(1, 2) : player.age <= 21 ? rng.int(2, 5) : rng.int(1, 4),
    minYears, maxYears,
  );
  const nation = NATION_BY_ID[club.nation];
  const floor = st.id === 'amateur' ? 40 : st.id === 'part-time' ? 130 : 260;
  const wage = Math.max(floor, estimateWage(ca, player.age, club.rep, nation.wealth) * st.wageMult);
  return {
    wage: Math.round(wage * rng.range(0.85, 1.18)),
    expiresYear: year + years,
    signedYear: year,
    releaseClause: rng.chance(0.16)
      ? Math.round(estimateValue(ca, player.pa, player.age, club.rep) * rng.range(1.6, 3.2))
      : 0,
    goalBonus: rng.chance(0.3) ? Math.round(wage * rng.range(0.3, 1.2)) : 0,
    appearanceFee: rng.chance(0.35) ? Math.round(wage * rng.range(0.05, 0.25)) : 0,
    loanedFrom: null,
    loanUntilYear: null,
  };
}

function generateManager(rng, nationId, clubRep) {
  const n = makeManagerName(rng, nationId);
  const q = remap(clubRep, 25, 95, 6, 17);
  const roll = (bias = 0) => clamp(Math.round(rng.normalClamped(q + bias, 3.2, 1, 20)), 1, 20);
  return {
    name: n.full,
    nat: nationId,
    style: n.style,
    attacking: roll(n.style === 'Idealist' ? 3 : 0),
    defending: roll(n.style === 'Pragmatist' ? 3 : 0),
    tactical: roll(n.style === 'Tactician' ? 4 : 0),
    manManagement: roll(n.style === 'Motivator' ? 4 : 0),
    youthDev: roll(n.style === 'Youth Developer' ? 5 : 0),
    discipline: roll(n.style === 'Disciplinarian' ? 4 : 0),
    reputation: Math.round(remap(clubRep, 25, 95, 20, 92) + rng.normalClamped(0, 6, -14, 14)),
    yearsAtClub: rng.int(0, 6),
  };
}

function financesForClub(rng, club, league, nation) {
  const rep = club.rep;
  const capacity = club.stadium.capacity;
  const ticketPrice = Math.max(5, Math.round(remap(rep, 18, 95, 6, 58) * (0.7 + nation.wealth * 0.5)));
  const attendPct = remap(rep, 18, 95, 0.48, 0.96);
  const homeGames = Math.max(8, Math.round((league.teams - 1)));
  const matchday = capacity * attendPct * ticketPrice * homeGames;
  const tvShare = league.tvMoney * remap(rep, league.rep - 20, league.rep + 8, 0.6, 1.5) / league.teams;
  // Sponsorship is what separates a big club from a small one, and it has to
  // fall away far faster than reputation does. The old curve still paid an
  // amateur side eight million a year in commercial income.
  const commercial = commercialIncome(rep, nation.wealth);
  const income = matchday + tvShare + commercial;

  const wageBudgetAnnual = income * rng.range(0.5, 0.68);
  const balance = Math.round(income * rng.range(0.04, 0.3) - (rng.chance(0.22) ? income * rng.range(0.05, 0.35) : 0));
  return {
    balance,
    ticketPrice,
    capacityUse: attendPct,
    incomeEstimate: Math.round(income),
    wageBudgetAnnual: Math.round(wageBudgetAnnual),
    transferBudget: Math.max(0, Math.round(income * rng.range(0.03, 0.22))),
    seasonSpend: 0,
    seasonIncome: 0,
    debt: balance < 0 ? -balance : 0,
    ledger: [],
  };
}

export function generateWorld(opts = {}) {
  const {
    seed = Date.now(), size = 'medium', year = 2025, customPlayers = [], customPlacement = 'free',
  } = opts;
  const rng = new Rng(seed);
  resetPlayerCounter();

  const preset = WORLD_SIZES[size] || WORLD_SIZES.medium;
  const nationIds = preset.nations;
  const maxTier = preset.maxTier ?? 99;
  const leagues = LEAGUE_TEMPLATES
    .filter((l) => nationIds.includes(l.nation) && l.tier <= maxTier)
    .map((l) => ({
    ...l,
    clubIds: [],
    table: null,
    fixtures: [],
    season: year,
    history: [],
  }));

  // A pyramid only has the divisions the chosen world size includes, so record
  // what each league actually connects to rather than assuming there is always
  // one above and one below.
  for (const l of leagues) {
    l.hasDivisionAbove = leagues.some((x) => x.nation === l.nation && x.tier === l.tier - 1);
    l.hasDivisionBelow = leagues.some((x) => x.nation === l.nation && x.tier === l.tier + 1);
  }

  const world = {
    seed,
    size,
    year,
    nations: nationIds.map((id) => ({ ...NATION_BY_ID[id] })),
    leagues,
    clubs: {},
    players: {},
    freeAgents: [],
    competitions: {},
  };

  const takenCodes = new Set();
  let clubCounter = 0;

  for (const nationId of nationIds) {
    const nation = NATION_BY_ID[nationId];
    const nRng = subRng(rng, `nation:${nationId}`);
    const cityNamer = makeCityNamer(nRng, nationId);
    const clubNamer = makeClubNamer(nRng, nationId);
    const nationLeagues = leagues.filter((l) => l.nation === nationId);

    for (const league of nationLeagues) {
      // Reputation spread inside a division: a couple of giants, a long tail.
      const reps = [];
      for (let i = 0; i < league.teams; i++) {
        const t = i / Math.max(1, league.teams - 1);
        // Spread narrows with the division's own level: a small club cannot be
        // twenty reputation points worse than an already-tiny league.
        const spread = Math.min(28, 8 + league.rep * 0.28);
        const base = league.rep + spread * 0.25 - Math.pow(t, 0.75) * spread;
        reps.push(clamp(base + nRng.normalClamped(0, 3.2, -8, 8), 6, 99));
      }
      reps.sort((a, b) => b - a);

      for (let i = 0; i < league.teams; i++) {
        const city = cityNamer();
        const name = clubNamer(city);
        const rep = Math.round(reps[i]);
        // Non-league grounds hold hundreds, not fifteen thousand.
        const capBase = 400 + Math.pow(clamp((rep - 8) / 91, 0, 1), 2.1) * 73000;
        const capStep = capBase < 4000 ? 50 : 500;
        const capacity = Math.max(250, Math.round(capBase * nRng.range(0.78, 1.3) / capStep) * capStep);
        const club = {
          id: `c${(++clubCounter).toString(36)}`,
          name,
          short: shortenClubName(name),
          code: clubCode(name, takenCodes),
          nation: nationId,
          leagueId: league.id,
          status: statusForRep(rep).id,
          city,
          founded: nRng.int(1878, 1974),
          rep,
          colours: null, // filled by assignIdentities once the division is complete
          stadium: { name: makeStadiumName(nRng, nationId, city), capacity },
          squad: [],
          tactic: defaultTactic(nRng.pick(['4-4-2', '4-2-3-1', '4-3-3', '4-1-4-1', '3-5-2', '4-4-2 Diamond'])),
          manager: generateManager(nRng, nationId, rep),
          facilities: {
            training: clamp(Math.round(remap(rep, 25, 95, 4, 19) + nRng.normalClamped(0, 2.4, -5, 5)), 1, 20),
            youth: clamp(Math.round(remap(rep, 25, 95, 4, 18) + nRng.normalClamped(0, 3, -6, 6)), 1, 20),
            scouting: clamp(Math.round(remap(rep, 25, 95, 3, 18) + nRng.normalClamped(0, 2.8, -6, 6)), 1, 20),
            medical: clamp(Math.round(remap(rep, 25, 95, 4, 19) + nRng.normalClamped(0, 2.4, -5, 5)), 1, 20),
          },
          coaching: {
            attacking: clamp(Math.round(remap(rep, 25, 95, 5, 18) + nRng.normalClamped(0, 2.6, -5, 5)), 1, 20),
            defending: clamp(Math.round(remap(rep, 25, 95, 5, 18) + nRng.normalClamped(0, 2.6, -5, 5)), 1, 20),
            fitness: clamp(Math.round(remap(rep, 25, 95, 5, 18) + nRng.normalClamped(0, 2.6, -5, 5)), 1, 20),
            gk: clamp(Math.round(remap(rep, 25, 95, 5, 18) + nRng.normalClamped(0, 2.6, -5, 5)), 1, 20),
          },
          trainingFocus: 'Balanced',
          // Read by developmentRate and dailyPlayerTick, and until now written by
          // nothing but the Club screen - so every club in the world ran on the
          // undefined branch. Derived per club at season start; this is the floor.
          trainingIntensity: 'Normal',
          training: { slots: [] },
          board: {
            expectation: null,
            confidence: nRng.int(55, 85),
            patience: nRng.int(40, 85),
            wantsYouth: nRng.chance(0.35),
            wantsAttacking: nRng.chance(0.3),
          },
          finances: null,
          form: [],
          history: [],
          morale: 70,
          isUserClub: false,
        };
        const status = statusForRep(rep);
        club.finances = financesForClub(nRng, club, league, nation);
        club.board.expectation = boardExpectation(i, league.teams, league.tier, league.hasDivisionBelow);

        // --- Squad ---
        const baseCA = abilityForReputation(rep);
        const order = squadPlan(nRng, status.squadSize);

        for (let s = 0; s < order.length; s++) {
          const pos = order[s];
          const curve = SQUAD_QUALITY_CURVE[Math.min(s, SQUAD_QUALITY_CURVE.length - 1)];
          const age = ageForSlot(nRng, s);
          let targetCA = baseCA * curve + nRng.normalClamped(0, 5, -13, 13);
          // Young players in the squad are not yet at their level.
          if (age <= 20) targetCA *= remap(age, 16, 21, 0.7, 0.95);
          targetCA = clamp(Math.round(targetCA), 20, 198);
          const natId = pickNationality(nRng, nationId, rep, nationIds);
          const pa = rollPotential(nRng, natId, rep, age, targetCA);
          const player = generatePlayer(nRng, {
            nationId: natId, pos, age, targetCA, targetPA: pa,
            clubRep: rep, leagueRep: league.rep, year,
          });
          player.clubId = club.id;
          player.contract = makeContract(nRng, player, club, year, targetCA, status);
          world.players[player.id] = player;
          club.squad.push(player.id);
        }
        assignSquadNumbers(nRng, club, world);
        club.finances.wageBudgetAnnual = Math.max(
          club.finances.wageBudgetAnnual,
          Math.round(club.squad.reduce((a, id) => a + world.players[id].contract.wage, 0) * 52 * 1.08),
        );

        league.clubIds.push(club.id);
        world.clubs[club.id] = club;
      }

      // Done once the division is full: hues are spread across the clubs in it,
      // which cannot be decided one club at a time.
      assignIdentities(subRng(nRng, `identity:${league.id}`), league.clubIds.map((id) => world.clubs[id]));
    }
  }

  // Free agents — a pool of unattached professionals for emergencies.
  const faRng = subRng(rng, 'freeagents');
  const faCount = Math.round(nationIds.length * 14);
  for (let i = 0; i < faCount; i++) {
    const natId = faRng.pick(nationIds);
    const pos = faRng.pick(SQUAD_TEMPLATE);
    const age = faRng.chance(0.45) ? faRng.int(31, 37) : faRng.int(19, 30);
    const targetCA = clamp(Math.round(faRng.normalClamped(72, 18, 30, 135)), 25, 140);
    const p = generatePlayer(faRng, {
      nationId: natId, pos, age, targetCA, targetPA: rollPotential(faRng, natId, 45, age, targetCA),
      clubRep: 45, leagueRep: 55, year,
    });
    p.contract = null;
    p.transferStatus = 'none';
    world.players[p.id] = p;
    world.freeAgents.push(p.id);
  }

  if (customPlayers.length) injectCustomPlayers(world, customPlayers, customPlacement, subRng(rng, 'custom'), year);

  buildCompetitions(world, rng);
  world.rngState = rng.save();
  return world;
}

function boardExpectation(rankIndex, teams, tier, canRelegate = true) {
  const t = rankIndex / Math.max(1, teams - 1);
  // Nothing below to fall into, so survival is not a thing the board can ask for.
  const bottomAsk = canRelegate
    ? { type: 'survive', target: teams - 3, label: 'Avoid relegation' }
    : { type: 'mid', target: teams - 2, label: 'Improve on last season' };
  if (tier === 1) {
    if (t < 0.1) return { type: 'title', label: 'Win the league' };
    if (t < 0.25) return { type: 'top', target: 4, label: 'Qualify for the Continental Cup' };
    if (t < 0.5) return { type: 'top', target: Math.ceil(teams * 0.4), label: 'Challenge for a continental place' };
    if (t < 0.75) return { type: 'mid', target: Math.ceil(teams * 0.65), label: 'Finish in mid-table' };
    return bottomAsk;
  }
  if (t < 0.2) return { type: 'top', target: 2, label: 'Win promotion' };
  if (t < 0.45) return { type: 'top', target: 6, label: 'Reach the promotion play-offs' };
  if (t < 0.75) return { type: 'mid', target: Math.ceil(teams * 0.6), label: 'Finish in mid-table' };
  return bottomAsk;
}

const NUMBER_PRIORITY = {
  GK: [1, 13, 25, 31], DC: [4, 5, 6, 3, 22, 15], DL: [3, 18, 33], DR: [2, 12, 24],
  DM: [6, 14, 16, 28], MC: [8, 4, 16, 20, 23], ML: [11, 17, 27], MR: [7, 19, 26],
  AML: [11, 10, 17], AMR: [7, 10, 21], AMC: [10, 21, 8], ST: [9, 19, 29, 20],
};

function assignSquadNumbers(rng, club, world) {
  const taken = new Set();
  const squad = club.squad.map((id) => world.players[id]);
  for (const p of squad) {
    const prefs = NUMBER_PRIORITY[p.positions[0]] || [];
    let assigned = null;
    for (const n of prefs) {
      if (!taken.has(n)) { assigned = n; break; }
    }
    if (assigned === null) {
      for (let n = 2; n <= 45; n++) if (!taken.has(n)) { assigned = n; break; }
    }
    taken.add(assigned);
    p.squadNumber = assigned;
  }
}

/**
 * Custom players from the user's library are inserted into a fresh world.
 * placement: 'free' (free agents), 'auto' (matched to a club of fitting level),
 * or a specific clubId.
 */
export function injectCustomPlayers(world, customPlayers, placement, rng, year) {
  const clubs = Object.values(world.clubs);
  for (const template of customPlayers) {
    const player = materialiseCustomPlayer(template, world, year);
    world.players[player.id] = player;
    let club = null;
    if (placement && placement !== 'free' && placement !== 'auto') {
      club = world.clubs[placement] || null;
    } else if (placement === 'auto') {
      const ca = currentAbility(player);
      const candidates = clubs.filter((c) => Math.abs(abilityForReputation(c.rep) - ca) < 18);
      club = candidates.length ? rng.pick(candidates) : rng.pick(clubs);
    }
    if (club) {
      player.clubId = club.id;
      const ca = currentAbility(player);
      player.contract = makeContract(rng, player, club, year, ca);
      club.squad.push(player.id);
      assignSquadNumbers(rng, club, world);
    } else {
      player.clubId = null;
      player.contract = null;
      world.freeAgents.push(player.id);
    }
  }
}

let customCounter = 0;
/** Turn a library template into a live player object. */
export function materialiseCustomPlayer(template, world, year) {
  const age = template.age ?? 22;
  const p = {
    ...JSON.parse(JSON.stringify(template)),
    id: `cu${(++customCounter).toString(36)}_${(template.id || 'x').slice(-4)}`,
    age,
    birthYear: year - age,
    birthDay: template.birthDay ?? 120,
    clubId: null,
    squadNumber: null,
    condition: 100,
    sharpness: 80,
    morale: 75,
    form: 0,
    injury: null,
    suspension: 0,
    yellowCards: 0,
    unhappy: null,
    contract: null,
    season: emptyStats(),
    career: { apps: 0, goals: 0, assists: 0, cleanSheets: 0, motm: 0, seasons: [] },
    transferStatus: 'none',
    interestFrom: [],
    custom: true,
  };
  p.name = template.name || `${template.first || ''} ${template.last || ''}`.trim();
  p.short = template.first ? `${template.first[0]}. ${template.last}` : p.name;
  return p;
}

function buildCompetitions(world, rng) {
  // Domestic cups: every club in a nation's leagues enters.
  for (const nation of world.nations) {
    const clubIds = Object.values(world.clubs).filter((c) => c.nation === nation.id).map((c) => c.id);
    world.competitions[`${nation.id}_CUP`] = {
      id: `${nation.id}_CUP`,
      name: `${nation.name} Cup`,
      type: 'cup',
      nation: nation.id,
      entrants: clubIds,
      rounds: [],
      winner: null,
      prizePerRound: Math.round(remap(nation.rep, 60, 95, 250e3, 2.2e6)),
      history: [],
    };
  }
  // Continental competitions are seeded at the start of each season from the
  // previous campaign's league positions.
  for (const def of [CONTINENTAL, SECONDARY_CONTINENTAL]) {
    world.competitions[def.id] = {
      id: def.id,
      name: def.name,
      shortName: def.shortName,
      type: 'continental',
      def,
      groups: [],
      rounds: [],
      entrants: [],
      winner: null,
      history: [],
    };
  }
}

/** Aggregate squad ability — used by the AI, the board and the UI. */
export function squadStrength(world, club) {
  const players = club.squad.map((id) => world.players[id]).filter(Boolean);
  const ranked = sortBy(players, { key: (p) => currentAbility(p), desc: true });
  const top11 = ranked.slice(0, 11);
  const rest = ranked.slice(11, 20);
  const a = top11.reduce((s, p) => s + currentAbility(p), 0) / Math.max(1, top11.length);
  const b = rest.length ? rest.reduce((s, p) => s + currentAbility(p), 0) / rest.length : a * 0.8;
  return a * 0.82 + b * 0.18;
}
