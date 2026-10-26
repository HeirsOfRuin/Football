# Backlog

Two lines each. Ideas written here survive the session; ideas left in a
conversation do not.

## Agreed, not yet built

- **Named staff with contracts.** `club.coaching` is four integers that nothing
  hires or fires. Coaches as people with specialisms, wages and reputations would
  give training slots, facility upgrades and board requests something concrete
  behind them. Offered 2026-10 and declined for now.

- ~~Strengthen the tactical instruction weights, and recalibrate.~~ **Measured
  and withdrawn.** The premise came from a single-match ablation that cannot see
  a cost paid in fatigue. Over 456 league games per option, no tempo setting
  beats the default by more than the noise floor of ±0.14 ppg. One real defect
  came out of it — `aerial` was read nowhere that mattered — and that is fixed.
  See the decisions log.
- **Set-piece quality beyond corners.** Free kicks and long shots still take no
  team input at all: `chanceQuality` returns a constant times a random range for
  both. Corners now read the two boxes against each other; the same argument
  applies to a wall and a dead-ball specialist.

## Not yet proposed

- **Press conferences and player conversations.** Morale moves on results,
  minutes, contracts and team talks only. A conversation system is the obvious
  missing lever, and the one most likely to feel like filler if done carelessly.
- **International management.** A second job running a national side, with a
  calendar that interleaves rather than replaces the club season.
- **Set-piece designer.** Roles already carry attribute profiles; corners and
  free kicks currently resolve from team totals.
- **A second visual layer for the match.** The commentary feed is the whole of
  it; a pitch with movement is a large piece of work with no simulation value.
- **Youth intake preview earlier in the season**, so the crop is something to
  anticipate rather than a message that arrives.
- **Fan culture.** Attendance already responds to price, form and importance;
  nothing models what a support expects of a manager over years.
