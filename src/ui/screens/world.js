// Browse any club in the world: squad, fixtures and standing.

import { esc, panel, panelTight, badge, money, emptyState, formRun, kv, stars, shortDate } from '../components.js';
import { userClub, sortTable, clubFixtures } from '../../state/game.js';
import { currentAbility } from '../../data/attributes.js';
import { squadStrength } from '../../gen/worldgen.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';

export function render(app) {
  const game = app.game;
  const world = game.world;
  const state = app.screenState.world || (app.screenState.world = { clubId: null, leagueId: world.leagues[0].id });
  if (app.params.clubId) { state.clubId = app.params.clubId; app.params = {}; }

  const club = state.clubId ? world.clubs[state.clubId] : null;
  if (club) return clubView(app, club, state);

  const league = world.leagues.find((l) => l.id === state.leagueId) || world.leagues[0];
  const table = sortTable(league.table);

  return {
    html: `
      <div class="row" style="margin-bottom:12px">
        <select id="w-league" style="min-width:280px">
          ${world.leagues.map((l) => `<option value="${l.id}" ${l.id === league.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
      </div>
      ${panelTight(league.name, `<div class="table-wrap"><table>
        <thead><tr><th>#</th><th></th><th>Club</th><th>City</th><th class="num">Rep</th>
          <th class="num">Squad</th><th class="num">Capacity</th><th class="num">Pts</th><th>Form</th></tr></thead>
        <tbody>${table.map((r, i) => {
    const c = world.clubs[r.clubId];
    return `<tr class="clickable" data-club="${esc(c.id)}">
            <td class="num faint">${i + 1}</td><td>${badge(c, 18)}</td>
            <td class="nowrap">${esc(c.name)}</td><td class="small faint">${esc(c.city)}</td>
            <td class="num">${c.rep}</td><td class="num">${Math.round(squadStrength(world, c))}</td>
            <td class="num faint">${c.stadium.capacity.toLocaleString()}</td>
            <td class="num"><b>${r.pts}</b></td><td>${formRun(r.form)}</td></tr>`;
  }).join('')}</tbody></table></div>`)}`,

    mount(root) {
      root.querySelector('#w-league').onchange = (e) => { state.leagueId = e.target.value; app.refresh(); };
      root.querySelectorAll('[data-club]').forEach((tr) => {
        tr.onclick = () => { state.clubId = tr.dataset.club; app.refresh(); };
      });
    },
  };
}

function clubView(app, club, state) {
  const world = app.game.world;
  const league = world.leagues.find((l) => l.id === club.leagueId);
  const table = league ? sortTable(league.table) : [];
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  const squad = sortBy(club.squad.map((id) => world.players[id]).filter(Boolean),
    { key: (p) => currentAbility(p), desc: true });
  const fixtures = clubFixtures(app.game, club.id).filter((f) => !f.played).slice(0, 6);
  const results = clubFixtures(app.game, club.id).filter((f) => f.played).slice(-6).reverse();

  return {
    html: `
      <div class="row" style="margin-bottom:12px">
        <button class="sm" data-act="back">← All clubs</button>
      </div>
      <div class="grid c2-1">
        <div class="stack">
          ${panel(club.name, `<div class="row" style="gap:12px;margin-bottom:10px">${badge(club, 44)}
            <div><div style="font-size:18px;font-weight:600">${esc(club.name)}</div>
            <div class="faint small">${esc(club.city)} · ${esc(league?.name || '')}${pos ? ` · ${pos} place` : ''}</div>
            <div class="small">${formRun(club.form)}</div></div></div>
            ${kv([
    ['Stadium', `${club.stadium.name} (${club.stadium.capacity.toLocaleString()})`],
    ['Manager', club.manager?.name || '—'],
    ['Reputation', String(club.rep)],
    ['Squad strength', String(Math.round(squadStrength(world, club)))],
    ['Wage bill', `${money(club.squad.reduce((a, id) => a + (world.players[id]?.contract?.wage || 0), 0))}/week`],
  ])}`)}
          ${panelTight('Squad', `<div class="table-wrap" style="max-height:520px"><table>
            <thead><tr><th>#</th><th>Name</th><th>Pos</th><th class="num">Age</th>
              <th class="num">Ability</th><th class="num">Apps</th><th class="num">Gls</th><th class="num">Value</th><th>Status</th></tr></thead>
            <tbody>${squad.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
              <td class="num faint">${p.squadNumber ?? ''}</td>
              <td class="nowrap">${esc(p.name)}</td>
              <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
              <td class="num">${p.age}</td>
              <td class="num">${currentAbility(p)}</td>
              <td class="num">${p.season.apps + p.season.subApps}</td>
              <td class="num">${p.season.goals}</td>
              <td class="num">${money(p.value)}</td>
              <td class="small">${p.transferStatus === 'listed' ? '<span class="pill warn">Listed</span>' : p.injury ? '<span class="pill bad">Injured</span>' : ''}</td>
            </tr>`).join('')}</tbody></table></div>`)}
        </div>
        <div class="stack">
          ${panelTight('Recent Results', results.length === 0 ? emptyState('None yet.') : `<table><tbody>
            ${results.map((f) => resultRow(world, f, club.id)).join('')}</tbody></table>`)}
          ${panelTight('Next Fixtures', fixtures.length === 0 ? emptyState('None scheduled.') : `<table><tbody>
            ${fixtures.map((f) => {
    const opp = world.clubs[f.homeId === club.id ? f.awayId : f.homeId];
    return `<tr><td class="small faint nowrap">${esc(shortDate(f.day, world.year))}</td>
              <td class="small faint">${f.homeId === club.id ? 'H' : 'A'}</td>
              <td class="nowrap small">${esc(opp.short)}</td>
              <td class="small faint">${esc(f.compName)}</td></tr>`;
  }).join('')}</tbody></table>`)}
          ${panelTight('History', (club.history || []).length === 0 ? emptyState('Nothing recorded.')
    : `<table><tbody>${[...club.history].reverse().slice(0, 12).map((h) => `<tr>
      <td class="mono small">${h.year}</td><td class="small">${esc(h.achievement)}</td></tr>`).join('')}</tbody></table>`)}
        </div>
      </div>`,

    mount(root) {
      root.querySelector('[data-act="back"]').onclick = () => { state.clubId = null; app.refresh(); };
      root.querySelectorAll('[data-player]').forEach((tr) => {
        tr.onclick = () => showPlayer(app, tr.dataset.player);
      });
    },
  };
}

function resultRow(world, f, clubId) {
  const isHome = f.homeId === clubId;
  const opp = world.clubs[isHome ? f.awayId : f.homeId];
  const gf = isHome ? f.result.homeGoals : f.result.awayGoals;
  const ga = isHome ? f.result.awayGoals : f.result.homeGoals;
  const cls = gf > ga ? 'good' : gf === ga ? 'muted' : 'bad';
  return `<tr><td class="small faint nowrap">${esc(shortDate(f.day, world.year))}</td>
    <td class="small faint">${isHome ? 'H' : 'A'}</td>
    <td class="nowrap small">${esc(opp.short)}</td>
    <td class="num mono ${cls}">${gf}-${ga}</td></tr>`;
}
