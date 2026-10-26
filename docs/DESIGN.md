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
| `npm run rivalry` | Does a derby play differently from an ordinary fixture |
| `npm run scout` | How wrong are you about a stranger, and does watching him help |
| `npm run touchline` | Is each in-match call best somewhere, and is any of them best everywhere |
| `npm run phase-gain` | What a phase total is actually worth in points — the exchange rate |
| `npm run season-ablate <instr>` | Is a setting worth choosing *over a season*, with its noise floor |
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

One mechanism carries the folding — `fold`, `foldTable` and `hint` in
`components.js`, bound once in the shell rather than per screen — because seven
hand-rolled disclosure widgets is how a codebase ends up with seven behaviours.
Open folds are remembered for the page but deliberately not saved: which
sections you had open is not worth a save migration.

After:

```
screen        scrolls  panels  rows  numbers  btns     was
transfers        2.2x       2    25      135    57     11x / 1006 / 405
fixtures        1.3x       1    10       59     5     4.4x /  243
finances        1.5x       6    90       16     3     2.5x /  271
inbox           1.5x       2     0      119    12     1.3x /  338 / 1893 words
dashboard       1.9x       5    16       69     5     2.7x /  109
tactics         3.1x       5     7       82    12     3.5x /   89
```

`rows` counts the DOM; `numbers` and `words` count what is actually visible, so
a folded table still has its rows and none of its numbers. Home is now a to-do
list: each item names what is wrong and carries the button that fixes it, which
is the one thing a management screen owes its reader. Squad stays dense at 207
numbers and that is correct — a squad list is supposed to be a squad list, and
it has filters.

### 2026-10 — Tactics: one dead phase, and a premise that did not survive

Set out to strengthen the tactical instruction weights, on the strength of the
touchline finding that no in-match call moved points. Measured first, and most
of the premise turned out to be wrong.

**What the phases are actually worth.** New `tools/phase-gain.js` multiplies one
phase total by a known factor and reads off the result, because outcomes resolve
through `advantage(a, b) = a / (a + b)` — a ratio between two near-equal numbers,
where a 3% nudge to one side moves the advantage by well under 1%. Per ±15% of a
phase, 400 matches, noise ±0.10 ppg:

```
create  ±0.06     press  -0.13 / +0.05     defend  -0.15 / +0.00
build    noise    drive   0.00             finish   0.00
aerial   0.00 — identical to the baseline on every metric, to two decimals
```

**`aerial` was dead, and that one is fixed.** It was computed for every player,
summed into a team total, and read in exactly one place: choosing *which* player
attacked a corner. A team-wide multiplier leaves that choice identical, so a
side of six-footers had no edge at a corner and a dominant centre-half defended
one no better than anybody. Corners now scale with the two boxes against each
other — exactly 1.0 at parity, so the calibration is untouched for an average
tie. Goals from corners across the aerial range: **0.073 → 0.155 a match**, and
at parity corners are 9.6% of goals, which is where real football sits.

`finish` and `drive` measure near zero too, but both have narrow legitimate
roles — individual finishing already dominates `resolveShot`, and drive feeds
counters — so neither is dead and neither was touched.

**The dominance finding did not survive its own sample size.** `tools/ablate.js`
said "Very High" tempo was worth +0.18 ppg over Standard with no visible cost,
which reads as a dominant setting that has to be given a price. But every match
in that tool is played by two rested sides with no fixture behind or ahead, and
tempo is paid for in fatigue. New `tools/setting-season.js` plays whole seasons:

```
Tempo, 12 seasons per option (456 league games each), noise ±0.14 ppg
  Very Slow 1.21   Slow 1.39   Standard 1.30   Higher 1.40   Very High 1.38
  0 options beat the default by more than the noise. 0 lose to it by more.
```

An earlier three-season run of the same tool put Standard top at 1.51 and
everything else behind it — the opposite ordering, from the same code. That run
had a noise floor of ±0.19 and I had not printed it. Printing it is now part of
the tool.

**Decided: no weight changes.** Tactical settings in this game are worth roughly
0.1 ppg each, and a full season's outcome noise is ±0.14. Raising the weights
would make a single dropdown more decisive than a manager is in real football,
on the basis of an effect I have not shown to be wrong. The honest position is
that the premise came from a tool answering a different question than the one
asked of it, and the fix was to build the tool that answers this one and to
write that limitation into the old one's header.

### 2026-10 — The touchline, and an honest result

In-match management was a mentality dropdown, five substitutions and a half-time
team talk. The dropdown moves eleven men at once along one axis; the ten
instructions that actually decide how a side plays were frozen at kick-off.

Six touchline calls now change the instructions for the rest of the match. Each
states **what it does and what it costs, never what it will achieve** — the
third version of a lesson another build learned twice: showing the projected
outcome makes the decision "pick the biggest number", and hiding everything
makes it guesswork. Repeat a call and the opposing manager reads it and answers
with its counter, the chance scaling with his tactical rating; without that, one
call would be the answer to every match.

**The measurement, and what it does not show.** `npm run touchline` makes the
call at minute 60 and compares against the identical match with no call — the
engine is deterministic, so both arms are the same match up to the branch point.
The first version of the tool made every call in the tunnel and found nothing,
which was true and useless: nobody shouts "take your time" in the first minute.

Over 400 matches per cell, the calls move the shape of a match clearly and in
the directions they claim:

```
even, level at the hour     xG for   xG against   cards
no call                      1.41       1.23       1.46
Press them high              1.61       1.21       1.90
Tighten up                   1.36       1.21       2.51
Take your time               1.10       1.31       1.53
```

**They do not move points reliably.** Every cell is inside the noise at n=400.
Thirty minutes of a changed shape is worth roughly a tenth of a goal of xG,
which scaled over a full match is about a quarter of a goal — real, but far
below what a 0/1/3 outcome will show at that sample size.

Stated rather than tuned away. The honest reading is that the whole instruction
layer has weak levers, which is a finding about the game as it already was and
not about these buttons: they are a surface over `changeInstruction`. Buffing
the tactical weights at the end of a session would move the calibration and
every balance number in the game with it. That belongs in its own pass with its
own measurement, and it is in the backlog.

### 2026-10 — Scouting, and a fog you could walk around

The parts were all here and none were joined up. `scoutReport` fogged a
stranger's ability by the club's scouting facility; the board would sell you an
upgrade to that facility; and `game.scouted` had been created on every new game,
written into every save and carried through four migrations while being read by
nothing. The fourth dead field this project has found.

**The fog was not load-bearing.** The player profile showed a stranger's ability
as a range. The transfer search, one screen earlier, printed the exact ability
and the exact potential of all five thousand players in the world. So the fog
was a formality, and the facility bought nothing.

**Decided: knowledge is a resource, and the estimate is wrong rather than
vague.** A band drawn symmetrically around the truth is not fog — its midpoint
is the answer, so a search sorted by it ranks the world perfectly. The estimate
now carries a bias hashed from the (player, club) pair: stable, different for
every club, consuming no randomness, and shrinking to nothing as the scouts
learn. `fogBand` is the single place a fogged number is made, so the list and
the profile cannot disagree again.

Two measurements changed the design before anyone played it (`npm run scout`,
one scout on a second-tier division of 567 players):

```
                        all 567      top 100
before any scouting     7.0          6.8      ability points of error
after 46 weeks          6.1          3.1
after 92 weeks          5.7          1.5
one player, watched directly: exact in six weeks
```

The first version produced a flat line — error 6.0 at week 0 and week 92. Two
causes, both found by the tool rather than by reading the code. A same-nation
baseline of 18 was already most of what a scout could add, so he had nothing
left to contribute; and he watched the division uniformly at random, spreading
six observations a week across five hundred players. Real scouts watch the ones
worth watching, so he now ranks the division by ability, potential, youth and
contract length and works the top hundred-odd. The baseline fell to 8 for the
same nation and 3 for abroad; your own division stays at 40, because you play
those men twice a year.

### 2026-10 — Rivalries, and a word the engine was not reading

Rivalries are derived from the world rather than drawn from it: who shares a
city, who the two biggest clubs in a nation are, who you finish beside every
year. No randomness at all, which is what lets an existing save be given them
without becoming a different save.

**The instrument found the feature was decoration before anyone played it.**
`tools/rivalry.js` plays the same fixtures with and without the rivalry on the
same seeds. First run:

```
attendance  derby 71532  ordinary 68622  gap +2911  noise ±1159  real
cards       derby  3.70  ordinary  3.73  gap -0.03  noise ±0.24  INSIDE THE NOISE
fouls       derby 21.64  ordinary 21.65  gap -0.01  noise ±0.58  INSIDE THE NOISE
```

The cause was not the rivalry. `importance` — the engine's one word for how big
a match is — reached only the attendance and a per-player temperament nudge of
±9% that averages out across a squad. So a continental final already played like
a Tuesday in November, and had done all along.

**Decided: heat is its own quantity, not a second reading of importance.** They
are different questions. A continental final matters enormously and is usually
played between two sides with no history; a fourth-tier derby matters to nobody
outside the town and is vicious. `importance` feeds the players' nerves and the
crowd; `heat` feeds the fouls and the cards. Heat defaults to zero, so every
match that is not a derby is byte-identical to before — asserted, because the
alternative is moving the calibration underneath the whole game.

```
attendance  derby 42411  ordinary 37880  gap +4532  noise ±2264  real
cards       derby  5.19  ordinary  3.72  gap +1.48  noise ±0.25  real
fouls       derby 25.40  ordinary 21.59  gap +3.81  noise ±0.57  real
goals       derby  2.01  ordinary  2.08  gap -0.07  noise ±0.18  inside the noise (the control)
```

Goals are the control: a derby changes the temperature and the crowd, not how
well anyone finishes. A gap there would have been a bug.

**Also decided: two clubs may share a city.** Measured across four worlds, there
were exactly zero city derbies — every club had a city of its own, which quietly
removed the oldest fixture in football. One club in five now reuses the previous
one's city. This shifts the city namer's stream, so **a given seed now builds a
different world from the one it built before**. Saves already made carry their
own world and are unaffected.

Calibration after the change, on the top flight: goals 2.77 (target 2.75), fouls
10.85 (10.8), yellows 1.77 (1.9), home wins 45.9% (44). The two long-standing
outliers remain and remain pre-existing: possession spread is too narrow (-38%)
and four-goal margins too common. The latter measures 5.07-6.73% across three
worlds against a 3.5% target, so seed 2024's +92% is where that world sits in a
range that has always run +45% to +92%, not a regression from this work.

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
