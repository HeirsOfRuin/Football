// Competitions: league tables, cup brackets and continental groups.

import { esc, panelTight, panel, badge, emptyState, formRun, ratingCell } from '../components.js';
import { userClub, sortTable } from '../../state/game.js';
import { leagueZones } from '../../engine/season.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  const state = app.screenState.league || (app.screenState.league = {
    compId: club ? club.leagueId : world.leagues[0].id,
  });

  const options = [
    ...world.leagues.map((l) => ({ id: l.id, label: l.name, kind: 'league' })),
    ...Object.values(world.competitions).map((c) => ({ id: c.id, label: c.name, kind: c.type })),
  ];
  const selected = options.find((o) => o.id === state.compId) || options[0];
  const league = world.leagues.find((l) => l.id === selected.id);
  const comp = world.competitions[selected.id];

  return {
    html: `
      <div class="row" style="margin-bottom:12px">
        <select id="comp-select" style="min-width:280px">
          <optgroup label="Leagues">${world.leagues.map((l) => `<option value="${l.id}" ${l.id === selected.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>
          <optgroup label="Cups">${Object.values(world.competitions).map((c) => `<option value="${c.id}" ${c.id === selected.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
        </select>
      </div>
      ${league ? leagueView(app, league) : comp ? cupView(app, comp) : emptyState('Nothing to show.')}`,

    mount(root) {
      root.querySelector('#comp-select').onchange = (e) => {
        state.compId = e.target.value;
        app.refresh();
      };
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
      root.querySelectorAll('[data-club]').forEach((el) => {
        el.onclick = () => app.go('world', { clubId: el.dataset.club });
      });
    },
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
        ${panelTight('Best Average Rating', `<table><tbody>${rated.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
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
