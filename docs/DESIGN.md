# Touchline — design and decisions

The repository is the record. Anything agreed in a conversation and not written
here is gone by the next session, which is how two of this project's decisions
had to be re-derived from the code.

## What the game is

You manage a football club. You pick the squad, the shape, the training and the
transfers; the matches play themselves. There is no player-controlled football —
the game is the decisions around it, and a match engine good enough to make
those decisions matter.

- Phone first, installable, plays offline, no accounts.
- One seed. The whole world, every season, is reproducible from it.
- Zero dependencies and no build step. Playwright is the one exception, is not in
  `package.json`, and every tool that needs it says so and exits clean without it.

## Invariants

1. **One derivation per number.** What a screen shows and what the engine resolves
   come from the same function. `currentAbility`, `slotScore`, `wageBudgetUsage`
   and `careerTotals` are the single answer to their question. Caches are fine;
   second formulas are not.
2. **Nothing declared is decoration.** Every setting, option and flag must change
   the game or be deleted. The engine is deterministic, so an ignored knob gives a
   byte-identical season — that makes this an exact test, not a statistical one.
   Three settings have already been caught this way: `trainingIntensity` (never
   set on any club), `manager.youthDev` (written in five places, read in none) and
   `autoPickOnMatchday` (written at game creation, read nowhere).
3. **Ability is derived, never stored.** Memoised as `_ca`, invalidated by
   `invalidateAbility()`. Anything that changes an attribute must invalidate.
4. **Saves are a contract.** `GAME_VERSION` with a case in `migrateSave()` for
   every older version. `STAT_KEYS` derives from `emptyStats()`, so a new stat
   packs itself and reads as 0 in an old save. Never rename a storage key.
5. **Correct but silent is broken.** Every empty, locked or limiting state names
   the reason and the lever that changes it.
6. **The world plays by the player's rules.** AI clubs earn, buy, age, develop and
   get sacked through the same functions.
7. **A harness that cannot prove progress is measuring nothing.** Any loop over
   days asserts the calendar moved.

## Instruments

| Command | Question it answers |
|---|---|
| `npm test` | 1,606 assertions: does anything contradict the invariants above |
| `npm run soak` | Do rare branches throw — careers from every tier, many seeds |
| `npm run fatigue` | What condition is the XI in at kick-off, by training intensity |
| `npm run ux` | How much is on each screen at 390x844 |
| `npm run pwa` | Installable, offline, and does a pushed fix reach an existing player |
| `node tools/calibrate.js` | Are the match numbers football-shaped, every tier |
| `node tools/ablate.js` | Does every tactical setting measurably change play |
| `node tools/pyramid.js` | Is the ladder monotonic in ability, money and crowd |
| `node tools/negotiate.js` | Can the transfer model be ground down by repetition |
| `node tools/train-ablate.js` | Does each training programme move what it claims |

## Decisions log

Newest first. Each entry: what was asked, what was decided, and the measured
numbers behind it.

### 2026-10 — UI flow, density, and depth
**Asked:** "make it more polished with better ui flow, less information all at
once, and more depth in the systems we have in place."

Measured first (`npm run ux`, 390x844, mid-season):

```
screen        scrolls  panels  rows  numbers  btns
transfers        11x       2    200     1006   405
fixtures        4.4x       1     47      243     3
tactics         3.5x       5      7       89    11
dashboard       2.7x       7     16      109     2
finances        2.5x       6     90      271     2
inbox           1.3x       2      0      338    10
```

**Decided — density: fold, do not remove.** Every number stays reachable; screens
open on the few that drive a decision and keep the rest one tap away. Rejected
the aggressive cut: this is a management game and the detail is half of why
someone plays it.

**Decided — depth: scouting and information, rivalries and derbies, match-day
management.** Named staff with contracts was offered and declined; it stays in the
backlog.

### 2026-09 — The pinned XI
`takeOverClub` auto-picked the XI once and nothing re-picked it, so the same
eleven started every match at any condition while every AI club re-picked before
each of its own. `autoPickOnMatchday` existed for this and was read nowhere.
Measured over three seeds, a full season each — starters under 70 at kick-off:
Light 1.9%, Normal 2.9%, Intense 4.1%, Intense with auto-pick 2.2%. Off by
default: overriding an eleven someone chose deliberately is worse than the
fatigue.

### 2026-09 — The play-off crash
`resolvePlayoff` referenced a `league` not in scope, on a line that only runs
when the user's club wins a promotion play-off. 1,597 assertions never took that
branch; a soak of 24 careers found it in 2. Worse than the crash: `app.busy` had
no `finally`, so the throw greyed Continue out permanently with no message. Both
fixed; `tools/soak.js` exists because of it.

### 2026-09 — Free agents follow age
Ability was drawn independently of age, so the best free agent in a new world was
117 — better than the entire first XI at fifteen of twenty-two second-tier clubs,
for nothing. Age-banded now: the best is 86, and the good ones are over thirty.

### 2026-09 — Negotiation cannot be ground down
The acceptance functions had no randomness and no memory, so walking an offer up
£50k at a time won a 36% discount on every deal in the game. Reserve prices are
drawn once and stored; a repeat or a lowball hardens the position. The regression
that defines it: an identical repeated offer must never win.
