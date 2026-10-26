// Touchline calls: the things a manager actually shouts during a match.
//
// Before this, the whole of in-match management was a mentality dropdown, five
// substitutions and a half-time team talk. The mentality dropdown is a blunt
// instrument - it moves eleven men at once along one axis - and the rest of the
// tactical surface, the ten instructions that genuinely decide how a side
// plays, was frozen the moment the whistle went.
//
// Three rules shape this, taken from a build that got it wrong twice before
// getting it right:
//
//   - **A call says what it DOES and what it COSTS, never what it WILL DO.**
//     Showing the projected outcome turns the decision into picking the biggest
//     number; hiding everything turns it into guessing. Saying "higher line,
//     more pressing — and your legs will feel it" is a decision.
//   - **State carries.** A call lasts for the rest of the match. Holding one
//     back is therefore a real choice, and spending them all by the hour mark
//     leaves you with nothing when the game changes.
//   - **The opponent adapts to repetition.** Make the same call twice and the
//     manager in the other technical area counters it. Without this, one call
//     would be the answer to every match.

import { clamp } from '../core/util.js';

/**
 * The calls, and what each one moves.
 *
 * `set` is applied over the side's instructions and stays applied. `does` and
 * `costs` are shown to the manager verbatim - they are the contract the button
 * makes, so they must describe the mechanism rather than promise a result.
 */
export const TOUCHLINE_CALLS = {
  press: {
    label: 'Press them high',
    set: { pressing: 'Much More', defensiveLine: 'Higher', tempo: 'Higher' },
    does: 'Squeeze the pitch: much more pressing, a higher line, quicker tempo.',
    costs: 'Your legs. Fatigue climbs and the space in behind is real.',
    counter: 'direct',
  },
  retreat: {
    label: 'Drop and hold',
    set: { pressing: 'Less', defensiveLine: 'Deeper', tempo: 'Slow', counter: 'Yes' },
    does: 'Sit deeper, press less, break when the ball turns over.',
    costs: 'You will see much less of the ball and create less with it.',
    counter: 'width',
  },
  direct: {
    label: 'Get it forward',
    set: { passing: 'More Direct', tempo: 'Higher' },
    does: 'Skip the build-up — longer, faster, straight at them.',
    costs: 'You give the ball away more often doing it.',
    counter: 'tighten',
  },
  width: {
    label: 'Stretch them wide',
    set: { width: 'Very Wide', focus: 'Mixed' },
    does: 'Push the play to the touchlines and get round the back of them.',
    costs: 'Less through the middle, and the crosses have to find someone.',
    counter: 'retreat',
  },
  tighten: {
    label: 'Tighten up',
    set: { tackling: 'Get Stuck In', pressing: 'More' },
    does: 'Harder in the tackle, closer to your man.',
    costs: 'Cards. The referee has already got his book out.',
    counter: 'press',
  },
  waste: {
    label: 'Take your time',
    set: { timeWasting: 'Always', tempo: 'Very Slow', passing: 'Shorter' },
    does: 'Slow everything down and keep hold of it.',
    costs: 'Nothing, if you are ahead. If you are not, you are helping them.',
    counter: 'press',
  },
};

export const CALL_IDS = Object.keys(TOUCHLINE_CALLS);

/**
 * Make a call. Returns what happened, so the interface can say it.
 *
 * Repeating a call does nothing the second time, which is deliberate: the point
 * is not to stop you, it is that the instructions are already set that way, and
 * a button that appears to do something while doing nothing is worse than one
 * that says so.
 */
export function makeCall(state, side, id) {
  const call = TOUCHLINE_CALLS[id];
  if (!call) return { ok: false, reason: 'No such call.' };
  side.calls = side.calls || [];
  const already = side.calls.filter((c) => c.id === id).length;
  side.tactic.instructions = { ...side.tactic.instructions, ...call.set };
  side.calls.push({ id, minute: state.minute });
  return {
    ok: true,
    repeated: already > 0,
    label: call.label,
    text: `${side.club.short}: ${call.does}`,
  };
}

/**
 * Has the other manager worked out what you are doing?
 *
 * Two of the same call is a pattern, and a pattern is readable. How quickly he
 * reads it depends on the man: a sharp manager spots it the second time, a
 * limited one may never. Returns the counter to apply, or null.
 *
 * This is what stops one call being the answer to every match - without it the
 * best strategy is to find the strongest call and hold it down.
 */
export function readOpponent(state, side) {
  const opp = side === state.home ? state.away : state.home;
  const calls = opp.calls || [];
  if (calls.length < 2) return null;
  const counts = new Map();
  for (const c of calls) counts.set(c.id, (counts.get(c.id) || 0) + 1);
  let worst = null;
  for (const [id, n] of counts) if (n >= 2 && (!worst || n > worst.n)) worst = { id, n };
  if (!worst) return null;
  side.countered = side.countered || [];
  if (side.countered.includes(worst.id)) return null;

  // A manager's tactical reading. The average man gets there eventually; the
  // best spot it straight away and the worst never do.
  const wit = clamp(((side.club.manager?.tactical ?? 10) + (side.club.manager?.attacking ?? 10)) / 2, 1, 20);
  const chance = clamp(0.12 + wit * 0.035, 0.1, 0.75);
  if (!state.rng.chance(chance)) return null;

  side.countered.push(worst.id);
  return TOUCHLINE_CALLS[worst.id].counter;
}
