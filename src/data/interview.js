// The job interview: what the board ask before they hand over the keys.
//
// Taking a job was one click. The board then handed you objectives and a budget
// you had no say in, and `wantsAttacking` and `wantsYouth` - two fields set at
// world generation and never touched again - decided what you would be judged
// on without anyone asking you.
//
// This module is deliberately dependency-free, the same as objectives.js and
// for the same reason: worldgen, the game state and the interview screen all
// need it and two of them cannot import the third.

/**
 * Three questions, each with three answers.
 *
 * Every answer moves something real: the remit you are judged against, the
 * money you are given, and what the board will expect in return. There is no
 * safe answer that costs nothing - an ambitious one buys resources and raises
 * the bar, a cautious one lowers both.
 */
export const INTERVIEW_QUESTIONS = [
  {
    id: 'style',
    question: 'How do you want this side to play?',
    answers: [
      {
        id: 'attacking',
        label: 'On the front foot. I want us scoring.',
        detail: 'The board will judge you on goals as well as points.',
        effects: { wantsAttacking: true, ambition: 1 },
      },
      {
        id: 'balanced',
        label: 'Whatever the players in front of me are best at.',
        detail: 'No style objective either way.',
        effects: { wantsAttacking: false, ambition: 0 },
      },
      {
        id: 'pragmatic',
        label: 'Hard to beat first. Results before entertainment.',
        detail: 'Nothing to prove on style, but the crowd will want convincing.',
        effects: { wantsAttacking: false, ambition: 0, patience: 6 },
      },
    ],
  },
  {
    id: 'youth',
    question: 'What is your position on the academy?',
    answers: [
      {
        id: 'blood',
        label: 'Young players will play. That is how the club grows.',
        detail: 'A youth objective every season, and a bigger academy budget.',
        effects: { wantsYouth: true, youthFacilities: 1, ambition: 0 },
      },
      {
        id: 'balance',
        label: 'They play when they are ready, not before.',
        detail: 'No youth objective.',
        effects: { wantsYouth: false, ambition: 0 },
      },
      {
        id: 'ready',
        label: 'I sign players who can do the job now.',
        detail: 'More money to spend, and no excuses if it does not work.',
        effects: { wantsYouth: false, budget: 0.2, ambition: 1 },
      },
    ],
  },
  {
    id: 'transfers',
    question: 'And how will you go about building it?',
    answers: [
      {
        id: 'spend',
        label: 'Back me and I will bring in what we need.',
        detail: 'A third more to spend, and they will expect a jump in the table.',
        effects: { budget: 0.35, ambition: 2 },
      },
      {
        id: 'balance',
        label: 'Work within what the club can afford.',
        detail: 'The budget as it stands, and the objectives as they stand.',
        effects: { ambition: 0 },
      },
      {
        id: 'sell',
        label: 'Sell to buy. I will trade my way to a better squad.',
        detail: 'Less to spend up front, and a board with more patience.',
        effects: { budget: -0.3, patience: 10, ambition: -1 },
      },
    ],
  },
];

/**
 * Fold a set of answers into the effects they have.
 *
 * Returned as data rather than applied here so that the screen can show the
 * consequences before you commit to them, from the same function that will
 * apply them. A preview computed separately from the thing it previews is how
 * an interface ends up promising something the engine does not deliver.
 */
export function interviewOutcome(answers = {}) {
  const out = {
    wantsAttacking: null, wantsYouth: null,
    budgetMultiplier: 1, patienceDelta: 0, ambition: 0, youthFacilities: 0,
  };
  for (const q of INTERVIEW_QUESTIONS) {
    const chosen = q.answers.find((a) => a.id === answers[q.id]);
    if (!chosen) continue;
    const e = chosen.effects;
    if (e.wantsAttacking !== undefined) out.wantsAttacking = e.wantsAttacking;
    if (e.wantsYouth !== undefined) out.wantsYouth = e.wantsYouth;
    if (e.budget) out.budgetMultiplier += e.budget;
    if (e.patience) out.patienceDelta += e.patience;
    if (e.ambition) out.ambition += e.ambition;
    if (e.youthFacilities) out.youthFacilities += e.youthFacilities;
  }
  return out;
}

/**
 * How much harder the board's league objective gets for an ambitious answer.
 *
 * Ambition is not free: promise more and the finish they set you moves up the
 * table, which is exactly the trade the plan describes - answer ambitiously and
 * the expectations rise with the resources.
 */
export function ambitionShift(ambition) {
  return -Math.round((ambition || 0) * 1.5);
}

/** The full set of answers, defaulted to the middle option. */
export function defaultAnswers() {
  const out = {};
  for (const q of INTERVIEW_QUESTIONS) out[q.id] = q.answers[1].id;
  return out;
}
