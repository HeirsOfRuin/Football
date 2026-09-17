// Competitions: league tables, cup brackets and continental groups.

import { esc, panelTight, panel, badge, emptyState, formRun, ratingCell } from '../components.js';
import { userClub, sortTable, nextFixtureFor } from '../../state/game.js';
import { leagueZones } from '../../engine/season.js';
import { sortBy, ordinal } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  // Defaults to your own competitions. The screen used to open on a dropdown of
  // every league and cup in the world with no indication of which ones you were
  // actually in - a playtester could not tell whether he was in a cup, who else
  // was left, or what he had qualified for.
  const state = app.screenState.league || (app.screenState.league = {
    compId: club ? 'mine' : world.leagues[0].id,
  });

  const options = [
    ...world.leagues.map((l) => ({ id: l.id, label: l.name, kind: 'league' })),
    ...Object.values(world.competitions).map((c) => ({ id: c.id, label: c.name, kind: c.type })),
  ];
  const selected = options.find((o) => o.id === state.compId) || options[0];
  const league = world.leagues.find((l) => l.id === selected.id);
  const comp = world.competitions[selected.id];
  const mine = state.compId === 'mine';

  return {
    html: `
      <div class="row" style="margin-bottom:12px">
        <select id="comp-select" style="min-width:280px">
          ${club ? `<option value="mine" ${mine ? 'selected' : ''}>Your competitions</option>` : ''}
          <optgroup label="Leagues">${world.leagues.map((l) => `<option value="${l.id}" ${l.id === selected.id && !mine ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>
          <optgroup label="Cups">${Object.values(world.competitions).map((c) => `<option value="${c.id}" ${c.id === selected.id && !mine ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
        </select>
      </div>
      ${mine && club ? yoursView(app, club)
    : league ? leagueView(app, league) : comp ? cupView(app, comp) : emptyState('Nothing to show.')}`,

    mount(root) {
      root.querySelector('#comp-select').onchange = (e) => {
        state.compId = e.target.value;
        app.refresh();
      };
      root.querySelectorAll('[data-open-comp]').forEach((el) => {
        el.onclick = () => { state.compId = el.dataset.openComp; app.refresh(); };
      });
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
      root.querySelectorAll('[data-club]').forEach((el) => {
        el.onclick = () => app.go('world', { clubId: el.dataset.club });
      });
    },
  };
}

/**
 * Where you stand in everything you are in.
 *
 * The Competitions screen was a dropdown of every league and cup in the world.
 * Nothing said which ones your club was entered in, how far you had got, who
 * was left, or what the board wanted out of them - a playtester said cups were
 * simply difficult to understand, and this is why.
 */
function yoursView(app, club) {
  const game = app.game;
  const world = game.world;
  const league = world.leagues.find((l) => l.id === club.leagueId);
  const table = league ? sortTable(league.table) : [];
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  const row = table[pos - 1];
  const cupObjective = (club.board?.objectives || []).find((o) => o.id === 'cup');

  const cards = [];

  // The league.
  if (league) {
    const zones = leagueZones(league);
    // `playoff` is a [from, to] range, not a count - comparing a number against
    // the array would silently never match.
    const po = zones?.playoff;
    const zone = !pos || !zones ? null
      : pos <= (zones.promotion || 0) ? 'in the promotion places'
        : po && pos >= po[0] && pos <= po[1] ? 'in the play-off places'
          : pos <= (zones.continentalPrimary || 0) ? 'in a continental place'
            : (zones.relegation || 0) > 0 && pos > league.teams - zones.relegation ? 'in the relegation zone'
              : null;
    cards.push({
      id: league.id,
      name: league.name,
      kind: 'League',
      standing: pos ? `${ordinal(pos)} of ${league.teams}${row ? `, ${row.pts} points` : ''}` : 'Not started',
      note: zone,
      tone: zone === 'in the relegation zone' ? 'bad' : zone ? 'good' : '',
      detail: row ? `Played ${row.p} — ${row.w}W ${row.d}D ${row.l}L` : '',
    });
  }

  // Every cup and continental competition the club is entered in.
  for (const comp of Object.values(world.competitions)) {
    const entered = (comp.entrants || []).includes(club.id);
    const inGroups = (comp.groups || []).some((g) => (g.table || []).some((r) => r.clubId === club.id));
    const inRounds = (comp.rounds || []).some((r) => (r.ties || []).some((t) => t.home === club.id || t.away === club.id)
      || (r.byes || []).includes(club.id));
    if (!entered && !inGroups && !inRounds) continue;

    const state = cupStanding(game, comp, club);
    cards.push({
      id: comp.id,
      name: comp.name,
      kind: comp.type === 'continental' ? 'Continental' : 'National cup',
      standing: state.label,
      note: state.out ? 'Knocked out' : state.note,
      tone: state.out ? 'bad' : state.note ? 'good' : '',
      detail: state.detail,
      objective: comp.type === 'cup' && cupObjective ? cupObjective.label : '',
    });
  }

  const next = nextFixtureFor(game, club.id);
  const nextOpp = next ? world.clubs[next.homeId === club.id ? next.awayId : next.homeId] : null;

  return `${panel('Where you stand', `
    <p class="small faint" style="margin-top:0">Everything ${esc(club.name)} is entered in this season. Pick any of
      them from the dropdown above for the full table or bracket.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Competition</th><th>Type</th><th>Standing</th><th>This season</th><th></th></tr></thead>
      <tbody>${cards.map((c) => `<tr>
        <td class="nowrap"><b>${esc(c.name)}</b>${c.objective
    ? `<div class="small faint">Board want: ${esc(c.objective)}</div>` : ''}</td>
        <td class="small faint">${esc(c.kind)}</td>
        <td class="small ${c.tone}">${esc(c.standing)}${c.note ? ` — ${esc(c.note)}` : ''}</td>
        <td class="small faint">${esc(c.detail || '')}</td>
        <td class="right"><button class="ghost small" data-open-comp="${esc(c.id)}">Open</button></td>
      </tr>`).join('')}</tbody></table></div>`)}

    ${next && nextOpp ? panelTight('Next up', `<div class="row" style="gap:12px;align-items:center">
      ${badge(nextOpp, 32)}
      <div><b>${esc(next.homeId === club.id ? 'v' : 'at')} ${esc(nextOpp.name)}</b>
        <div class="small faint">${esc(next.compName)} · ${esc(String(next.round))}</div></div>
    </div>`) : ''}`;
}

/**
 * How far a club has got in a cup, and whether it is still in it.
 *
 * Derived from the rounds themselves rather than stored, so it cannot disagree
 * with the bracket the next tab draws.
 */
function cupStanding(game, comp, club) {
  const world = game.world;
  // Group stage first, where there is one.
  const group = (comp.groups || []).find((g) => (g.table || []).some((r) => r.clubId === club.id));
  if (group && !(comp.rounds || []).length) {
    const sorted = sortTable(group.table);
    const at = sorted.findIndex((r) => r.clubId === club.id) + 1;
    const me = sorted[at - 1];
    return {
      label: `${esc(group.name)}, ${ordinal(at)} of ${sorted.length}`,
      note: at <= 2 ? 'on course to qualify' : null,
      detail: me ? `Played ${me.p} — ${me.pts} points` : '',
      out: false,
    };
  }

  const rounds = comp.rounds || [];
  const inRound = (round) => (round.ties || []).some((t) => t.home === club.id || t.away === club.id)
    || (round.byes || []).includes(club.id);
  let lastRound = null;
  for (const round of rounds) if (inRound(round)) lastRound = round;
  // A tie carries no winner - it is resolved on demand from the fixtures - so
  // "still in it" is read from the bracket: the next round is built from the
  // winners, so a club in the newest round is through. The one gap is the days
  // between losing a tie and the next round being drawn, when the bracket alone
  // would still say you were in it, so a settled tie is scored from its legs.
  const newest = rounds[rounds.length - 1];
  let stillIn = !!newest && inRound(newest);
  if (stillIn && newest) {
    const tie = (newest.ties || []).find((t) => t.home === club.id || t.away === club.id);
    if (tie) {
      const legs = Object.values(game.fixtures).filter((f) => f.tieId === tie.id);
      if (legs.length && legs.every((f) => f.played)) {
        let mine = 0;
        let theirs = 0;
        for (const f of legs) {
          const home = f.homeId === club.id;
          mine += home ? f.result.homeGoals : f.result.awayGoals;
          theirs += home ? f.result.awayGoals : f.result.homeGoals;
        }
        if (mine !== theirs) stillIn = mine > theirs;
        else {
          const last = legs[legs.length - 1];
          const so = last.result.shootoutWinner;
          if (so) stillIn = (so === 'home' ? last.homeId : last.awayId) === club.id;
        }
      }
    }
  }
  if (comp.winner === club.id) {
    return { label: 'Winners', note: null, detail: 'Won the competition', out: false };
  }
  if (!lastRound) {
    return {
      label: (comp.entrants || []).includes(club.id) ? 'Entered, not yet drawn' : 'Not entered',
      note: null, detail: 'The draw is still to be made', out: false,
    };
  }
  const left = (lastRound.ties || []).length * 2 + (lastRound.byes || []).length;
  return {
    label: lastRound.name,
    note: stillIn ? 'still in it' : null,
    detail: stillIn ? `${left} clubs left` : `Went out in the ${lastRound.name.toLowerCase()}`,
    out: !stillIn,
  };
}

function leagueView(app, league) {
  const world = app.game.world;
  const club = userClub(app.game);
  const table = sortTable(league.table);
  const zones = leagueZones(league);
  const players = league.clubIds.flatMap((id) => world.clubs[id].squad.map((p) => world.players[p])).filter(Boolean);
  const scorers = sortBy(players.filter((p) => p.season.goals > 0), { key: (p) => p.season.goals, desc: true }).slice(0, 10);
  const assisters = sortBy(players.filter((p) => p.season.assists > 0), { key: (p) => p.season.assists, desc: true }).slice(0, 10);
  const rated = sortBy(players.filter((p) => p.season.ratingCount >= 6),
    { key: (p) => p.season.ratingSum / p.season.ratingCount, desc: true }).slice(0, 10);

  return `
    <div class="grid c2-1">
      ${panelTight(league.name, `<div class="table-wrap"><table>
        <thead><tr><th>#</th><th></th><th>Club</th><th class="num">P</th><th class="num">W</th>
          <th class="num">D</th><th class="num">L</th><th class="num">GF</th><th class="num">GA</th>
          <th class="num">GD</th><th class="num">Pts</th><th>Form</th></tr></thead>
        <tbody>${table.map((r, i) => {
    const c = world.clubs[r.clubId];
    const pos = i + 1;
    let marker = '';
    if (league.tier === 1 && pos <= zones.continentalPrimary) marker = 'border-left:3px solid var(--accent)';
    else if (league.tier === 1 && pos <= zones.continentalPrimary + zones.continentalSecondary) marker = 'border-left:3px solid var(--info)';
    else if (league.tier > 1 && pos <= zones.promotion) marker = 'border-left:3px solid var(--accent)';
    else if (pos > league.teams - zones.relegation) marker = 'border-left:3px solid var(--bad)';
    return `<tr class="${club && r.clubId === club.id ? 'highlight' : ''} clickable" data-club="${esc(c.id)}" style="${marker}">
            <td class="num faint">${pos}</td><td>${badge(c, 18)}</td>
            <td class="nowrap">${esc(c.name)}</td>
            <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
            <td class="num">${r.gf}</td><td class="num">${r.ga}</td>
            <td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="num"><b>${r.pts}</b></td>
            <td>${formRun(r.form)}</td></tr>`;
  }).join('')}</tbody></table></div>`)}

      <div class="stack">
        ${statTable('Top Scorers', scorers, (p) => p.season.goals, world)}
        ${statTable('Assists', assisters, (p) => p.season.assists, world)}
        ${panelTight('Best Average Rating', rated.length === 0
    ? emptyState('Nobody has played six matches yet.')
    : `<table><tbody>${rated.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
          <td class="nowrap small">${esc(p.name)}</td><td class="small faint">${esc(world.clubs[p.clubId]?.code || '')}</td>
          <td class="num">${ratingCell(p.season.ratingSum / p.season.ratingCount)}</td></tr>`).join('')}</tbody></table>`)}
      </div>
    </div>
    ${league.history.length ? panelTight('Past Champions', `<table><tbody>${[...league.history].reverse().slice(0, 10).map((h) => `<tr>
      <td class="mono small">${h.year}/${String(h.year + 1).slice(2)}</td>
      <td>${esc(world.clubs[h.champion]?.name || '—')}</td></tr>`).join('')}</tbody></table>`) : ''}`;
}

function statTable(title, players, valueFn, world) {
  return panelTight(title, players.length === 0 ? emptyState('No data yet.')
    : `<table><tbody>${players.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
      <td class="nowrap small">${esc(p.name)}</td>
      <td class="small faint">${esc(world.clubs[p.clubId]?.code || '')}</td>
      <td class="num"><b>${valueFn(p)}</b></td></tr>`).join('')}</tbody></table>`);
}

function cupView(app, comp) {
  const world = app.game.world;
  const club = userClub(app.game);
  const groups = comp.groups?.length ? `<div class="grid c2">${comp.groups.map((g) => panelTight(g.name,
    `<table><thead><tr><th>#</th><th>Club</th><th class="num">P</th><th class="num">GD</th><th class="num">Pts</th></tr></thead>
     <tbody>${sortTable(g.table).map((r, i) => {
    const c = world.clubs[r.clubId];
    return `<tr class="${club && r.clubId === club.id ? 'highlight' : ''}">
        <td class="num faint">${i + 1}</td><td class="nowrap small">${esc(c?.short || '')}</td>
        <td class="num">${r.p}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="num"><b>${r.pts}</b></td></tr>`;
  }).join('')}</tbody></table>`)).join('')}</div>` : '';

  const rounds = (comp.rounds || []).map((round) => panelTight(round.name, `<table><tbody>
    ${round.ties.map((t) => {
    const legs = Object.values(app.game.fixtures).filter((f) => f.tieId === t.id);
    const score = legs.filter((f) => f.played).map((f) => `${f.result.homeGoals}-${f.result.awayGoals}`).join(', ');
    const h = world.clubs[t.home];
    const a = world.clubs[t.away];
    return `<tr class="${club && (t.home === club.id || t.away === club.id) ? 'highlight' : ''}">
        <td class="right nowrap">${esc(h?.short || '')}</td>
        <td class="center mono" style="width:90px">${score || 'v'}</td>
        <td class="nowrap">${esc(a?.short || '')}</td></tr>`;
  }).join('')}
    ${round.byes?.length ? `<tr><td colspan="3" class="small faint">Byes: ${round.byes.map((b) => esc(world.clubs[b]?.short || '')).join(', ')}</td></tr>` : ''}
  </tbody></table>`)).reverse();

  return `${comp.winner ? panel('Winner', `<div class="row" style="gap:12px">${badge(world.clubs[comp.winner], 34)}
    <div style="font-size:17px;font-weight:600">${esc(world.clubs[comp.winner]?.name || '')}</div></div>`) : ''}
    ${groups}
    ${rounds.join('') || emptyState('This competition has not started yet.')}
    ${comp.history?.length ? panelTight('Past Winners', `<table><tbody>${[...comp.history].reverse().slice(0, 10).map((h) => `<tr>
      <td class="mono small">${h.year}/${String(h.year + 1).slice(2)}</td><td>${esc(h.name)}</td></tr>`).join('')}</tbody></table>`) : ''}`;
}
