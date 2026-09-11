# The match engine

This is the part of the game everything else serves. If the engine does not reward good
squad building and sensible tactics, no amount of surrounding detail matters.

## Model

A match is 180 ticks. Each tick is roughly thirty seconds of play, and belongs to whichever
side has the ball. Possession moves through three zones:

```
zone 0  own third      build out
zone 1  middle third   progress
zone 2  final third    create and shoot
```

Each tick the side in possession either advances a zone, keeps the ball where it is, loses
it, or (in the final third) works a chance. Probabilities come from contests between the
attacking side's phase totals and the defending side's, so a better team keeps the ball
longer, reaches the final third more often and creates better chances when it gets there.

Possession share is an emergent property of chain length, not a number the engine sets.

## Phases

Every player on the pitch contributes a share of their positional ability to seven phases:

| Phase | What it drives |
|---|---|
| `defend` | Winning the ball back, resisting progression |
| `press` | Forcing turnovers high up |
| `build` | Retaining and playing out from deep |
| `create` | Working the ball into and through the final third |
| `finish` | Converting the chances created |
| `aerial` | Set pieces and crosses, both ends |
| `drive` | Carrying the ball, counter-attacking |

A player's **role** decides how their ability splits across those phases; their **duty**
shifts it toward defending or attacking. A Ball Winning Midfielder pours ability into
pressing and defending, an Advanced Playmaker into creation. Ability is scaled first by
positional familiarity, then by condition, sharpness, morale and form, then by how well
the player's attributes suit the role.

## Chances

Reaching the final third does not produce a shot every tick. When one comes, its quality is
derived from the attacking side's creation and finishing against the defending side's
resistance and the keeper, then spread by a wide random factor — good teams get more
chances *and* better ones, but a poor side still gets its moments.

Chance quality is xG. Conversion multiplies it by the shooter's finishing, composure,
technique and first touch, and divides by the keeper's shot-stopping. Chance types carry
their own base qualities: penalties 0.78, headers from corners around 0.06, direct free
kicks around 0.08, long shots around 0.04.

Non-goals split into saved, blocked, off target and woodwork, with corners following from
some of them and rebounds from blocks.

## Everything else per tick

- **Fatigue** drains against stamina, natural fitness, the role's workload and the tempo
  and pressing the manager asked for. A full match costs a fit player 25-35 condition
  points, and tired players contribute less.
- **Fouls** are their own event stream rather than a by-product of turnovers, so the foul
  count is right without possession changes being distorted. Cards follow from fouls,
  weighted by dirtiness and the tackling instruction, with booked players taking more care.
- **Injuries** roll against injury proneness, current tiredness and the club's medical
  department, and force a substitution where one is available.
- **Game state** matters: a side two goals up after the hour eases off, a side two down
  pushes men forward at the cost of shape.
- **Momentum** swings to the side that just scored and decays over the following minutes.

## Retuning it

All tunables live in one object, `P`, at the top of `src/engine/match.js`.

```bash
node tools/calibrate.js 1500
```

This simulates matches between clubs in a generated top division and prints every rate
against its real-world target, plus a strongest-versus-weakest check so you can see whether
squad quality still decides matches by a believable margin.

Change one parameter at a time and re-run. The rates interact: raising shot frequency
lowers average chance quality for a fixed goal rate, lengthening possession chains reduces
the number of chains and therefore the number of final-third entries, and anything that
changes turnover frequency moves possession spread.

`npm test` asserts the same rates within tolerances, so a retune that breaks realism fails
the suite.
