# Touchline

A football management simulation. You pick the squad, the shape and the transfers; the
matches play themselves. No player-controlled gameplay — the game is the decisions around
the football, and a match engine good enough to make those decisions matter.

Runs in a browser with no build step and no dependencies.

---

## Running it

The game is plain ES modules, so it needs to be served over HTTP (not opened as a `file://`
path, which blocks module imports).

```bash
cd Football
python3 -m http.server 8080     # or: npx serve, or any static server
```

Then open <http://localhost:8080>.

```bash
npm test          # 1,287 assertions: generation, scheduling, match rates, a full season, saves
npm run season    # simulate whole seasons headlessly and print tables, scorers, transfers
node tools/calibrate.js 1000   # match engine rates against real-world targets
```

---

## What is simulated

### The world
A seeded procedural world: 10 fictional nations with distinct naming cultures, 16 divisions,
and up to ~300 clubs with ~6,000 players. Nations have their own footballing character —
Verdenian players skew technical, Nordheim physical — which feeds through into the players
their clubs produce. Three size presets trade depth against simulation speed.

Everything derives from a single seed. The same seed rebuilds the same world exactly.

### Players
Thirty-eight attributes on the familiar 1-20 scale, plus ten hidden ones (professionalism,
consistency, injury proneness, ambition, loyalty and so on) that shape development and
behaviour without appearing in the squad list.

Current Ability is **derived from attributes**, not stored alongside them. Training that
raises a player's finishing raises his ability automatically, and a striker with 20
finishing and nothing else still is not a good striker. Generation works the other way
round: build an attribute shape from position, nation and age, then solve for the scale
that lands on a target ability.

### Tactics
Twelve formations, twenty-six roles with duties, seven mentalities and ten team
instructions. Instructions trade one quality for another rather than granting free value —
higher tempo buys chance creation at the cost of retention; a higher line concedes space
behind. Each player on the pitch contributes a share of their ability to seven phases
(defend, press, build, create, finish, aerial, drive), and their role decides how that share
is split.

### The match engine
Possessions are simulated as chains across three zones. The side on the ball tries to
progress; the side without it tries to win it back. Reaching the final third generates
chances, each carrying a quality value (an xG), resolved against the finisher's composure
and technique and the keeper's shot-stopping.

Fatigue accrues per tick against stamina, work rate and the tempo the manager asked for.
Fouls, cards, injuries, penalties, corners, offsides, counter-attacks, momentum, home
advantage, weather and game state all feed in. AI managers change shape when chasing a
game and make substitutions for tired legs.

The engine is **steppable**, so the interface can stop at any minute for a substitution, a
tactical switch or a half-time team talk, then resume.

### Everything around the match
- **Development** — players bank fractional training points weekly and spend them on
  attributes chosen by position, training focus and headroom. Physicals decline after 30;
  mentals keep climbing. Playing time, coaching quality, facilities and professionalism all
  move the rate.
- **Transfers** — valuations, asking prices, offer evaluation and separate contract
  negotiation where money, ambition and promised playing time all matter. AI clubs identify
  their own weaknesses and act on them; a typical season sees around 700 completed deals.
- **Finances** — gate receipts, commercial income, wages, prize money and board-set budgets
  you can shift between transfers and wages.
- **Competitions** — league fixtures, promotion, relegation, play-offs, domestic knockout
  cups and a two-tier continental competition with group stages, two-legged ties, extra
  time and shoot-outs.
- **The board** — an expectation set each season, confidence that tracks results and
  finances, a warning when it sours, and dismissal when it collapses. Sacked managers
  look for work at clubs willing to consider their reputation.
- **Squad life** — morale, form, match sharpness, injuries, suspensions, card
  accumulation, contract expiry, youth intake and retirements.

---

## Your own players

There is a persistent **player library**, independent of any save. Build a player attribute
by attribute with their ability recalculated live, or generate one and edit them. Set
positions, traits, hidden personality attributes and potential.

When you start a new career you choose which of your created players exist in that world,
and whether they begin as free agents you have to sign or already placed at a club matching
their level. The library is stored separately from saves and exports to JSON, so a player
you build once can appear in every campaign you ever start.

---

## Match engine calibration

The engine is tuned against real top-flight rates. Measured over 1,400 simulated matches:

| Metric | Touchline | Real top flight |
|---|---|---|
| Goals per match | 2.79 | ~2.75 |
| Shots per team | 12.2 | ~12.6 |
| Shots on target per team | 4.7 | ~4.4 |
| Corners per team | 5.0 | ~5.0 |
| Fouls per team | 10.9 | ~10.8 |
| Yellow cards per team | 1.8 | ~1.9 |
| Red cards per match | 0.10 | ~0.08 |
| Penalties per match | 0.25 | ~0.26 |
| Home / draw / away | 46 / 23 / 31 | ~44 / 25 / 31 |

Two known divergences, both deliberate trade-offs rather than oversights:

- **Possession spread is narrower than real football.** Match-to-match possession varies
  less than in the real game, because AI clubs all play reasonably similar default tactics.
  Setting short passing and a low tempo yourself widens it considerably.
- **Heavy defeats are somewhat more common** than in a real Premier League season (about
  6% of matches finish with a four-goal margin against a real ~4%). Generated divisions
  have a wider quality spread than a real top flight, so mismatches are more common.

`node tools/calibrate.js` reprints the whole table against its targets at any time.

---

## Project structure

```
index.html                 Shell
styles/main.css            All styling
src/core/                  Seeded RNG, calendar, shared helpers
src/data/                  Attributes, positions, roles, formations, nations, leagues
src/gen/                   Name, player and world generation
src/engine/                ratings, lineup, match, season, training, transfers, finance, ai, news
src/state/                 Game loop and rollover, save codec, IndexedDB store, player library
src/ui/                    App shell, shared components, player profile, negotiation dialogs
src/ui/screens/            One module per screen
tools/                     Test suite, calibration harness, headless season simulator
docs/MATCH_ENGINE.md       How the match engine works, and how to retune it
```

### A note on saves
A medium world is around 6,000 players with 48 attributes each. Saved as plain JSON that
would be tens of megabytes, so attributes are packed into fixed-length strings — a small
world's save is about 3.6 MB. Saves live in IndexedDB; the player library and settings live
in localStorage. Both export to JSON files.

---

## Known limitations

- **Loans are modelled but not exposed.** The data model carries loan fields; neither the
  AI nor the interface uses them yet.
- **No scouting assignments.** Scout accuracy affects how precisely you see an unfamiliar
  player's ability and potential, but you cannot send scouts anywhere.
- **No press conferences or individual player conversations.** Morale responds to results,
  playing time, contract situation and team talks only.
- **One save slot per career by default**, with autosave; export a file to keep more.
- **Simulating a full season takes 15-20 seconds** on a small world. Day-to-day play is
  instant; only skipping a whole season at once is slow.
