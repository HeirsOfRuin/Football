// Squad list with sortable columns, plus views for contracts and development.

import {
  esc, panelTight, money, stars, emptyState, tableHead, SQUAD_COLUMNS, sortValue,
  playerRow, conditionCell, moraleLabel, ratingCell, tabs, toast, bar,
} from '../components.js';
import { userClub } from '../../state/game.js';
import { currentAbility, POSITION_GROUP } from '../../data/attributes.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';
import { expectedRole, ROLE_LABELS, developmentRate, TRAINING_FOCUSES } from '../../engine/training.js';
import { squadDepth } from '../../engine/lineup.js';
import { marketValue } from '../../engine/transfers.js';
import { weeklyWageBill } from '../../engine/finance.js';

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'development', label: 'Development' },
  { id: 'depth', label: 'Depth' },
];

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('No club.') };

  const state = app.screenState.squad || (app.screenState.squad = {
    sortKey: 'ability', sortDesc: true, view: 'overview', filter: 'all',
  });
  let squad = club.squad.map((id) => world.players[id]).filter(Boolean);

  if (state.filter !== 'all') {
    squad = squad.filter((p) => (state.filter === 'injured' ? p.injury
      : state.filter === 'available' ? !p.injury && p.suspension <= 0
        : POSITION_GROUP[p.positions[0]] === state.filter));
  }
  squad = sortBy(squad, { key: (p) => sortValue(p, state.sortKey, world), desc: state.sortDesc });

  const body = state.view === 'contracts' ? contractsView(world, club, squad)
    : state.view === 'development' ? developmentView(world, club, squad)
      : state.view === 'depth' ? depthView(world, club)
        : overviewView(world, squad, state);

  const wageBill = weeklyWageBill(world, club);
  const totalValue = squad.reduce((a, p) => a + marketValue(world, p), 0);

  return {
    html: `
    ${tabs(VIEWS, state.view)}
    <div class="row wrap" style="margin-bottom:12px">
      <div class="chip-select">
        ${[['all', 'All'], ['available', 'Available'], ['injured', 'Injured'], ['GK', 'Keepers'], ['DEF', 'Defenders'], ['MID', 'Midfield'], ['ATT', 'Attack']]
    .map(([id, label]) => `<button class="${state.filter === id ? 'on' : ''}" data-filter="${id}">${esc(label)}</button>`).join('')}
      </div>
      <div class="spacer"></div>
      <span class="small faint">${club.squad.length} players · wage bill ${money(wageBill)}/week · squad value ${money(totalValue)}</span>
    </div>
    ${panelTight('Squad', body)}`,

    mount(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => { state.view = t.dataset.tab; app.refresh(); };
      });
      root.querySelectorAll('[data-filter]').forEach((t) => {
        t.onclick = () => { state.filter = t.dataset.filter; app.refresh(); };
      });
      root.querySelectorAll('th[data-sort]').forEach((th) => {
        th.onclick = () => {
          const key = th.dataset.sort;
          if (state.sortKey === key) state.sortDesc = !state.sortDesc;
          else { state.sortKey = key; state.sortDesc = true; }
          app.refresh();
        };
      });
      root.querySelectorAll('[data-player]').forEach((tr) => {
        tr.onclick = () => showPlayer(app, tr.dataset.player);
      });
    },
  };
}

function overviewView(world, squad, state) {
  if (!squad.length) return emptyState('No players match that filter.');
  return `<div class="table-wrap"><table>
    ${tableHead(SQUAD_COLUMNS, state.sortKey, state.sortDesc)}
    <tbody>${squad.map((p) => playerRow(world, p)).join('')}</tbody>
  </table></div>`;
}

function contractsView(world, club, squad) {
  const rows = sortBy(squad, (p) => p.contract?.expiresYear ?? 9999);
  return `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th>Squad role</th>
      <th class="num">Wage</th><th class="num">Expires</th><th class="num">Value</th>
      <th>Status</th><th>Happiness</th></tr></thead>
    <tbody>${rows.map((p) => {
    const left = p.contract ? p.contract.expiresYear - world.year : 0;
    const cls = left <= 0 ? 'bad' : left === 1 ? 'warn' : '';
    const m = moraleLabel(p.morale);
    return `<tr class="clickable" data-player="${esc(p.id)}">
        <td class="nowrap">${esc(p.name)}</td>
        <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
        <td class="num">${p.age}</td>
        <td class="small">${esc(ROLE_LABELS[expectedRole(world, club, p)])}</td>
        <td class="num">${p.contract ? money(p.contract.wage) : '—'}</td>
        <td class="num ${cls}">${p.contract ? p.contract.expiresYear : '—'}${left <= 0 ? ' ⚠' : ''}</td>
        <td class="num">${money(marketValue(world, p))}</td>
        <td class="small">${p.transferStatus === 'listed' ? '<span class="pill warn">Listed</span>' : '<span class="faint">—</span>'}</td>
        <td class="small ${m.cls}">${m.label}</td>
      </tr>`;
  }).join('')}</tbody></table></div>`;
}

function developmentView(world, club, squad) {
  const rows = sortBy(squad, { key: (p) => developmentRate(world, club, p), desc: true });
  return `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">Ability</th>
      <th class="num">Potential</th><th>Room to grow</th><th>Trajectory</th>
      <th class="num">Minutes</th><th class="num">Avg rating</th></tr></thead>
    <tbody>${rows.map((p) => {
    const ca = currentAbility(p);
    const gap = p.pa - ca;
    const rate = developmentRate(world, club, p);
    const traj = rate > 0.09 ? '<span class="good">Rapid</span>' : rate > 0.045 ? '<span class="good">Improving</span>'
      : rate > 0.005 ? '<span class="muted">Slow</span>' : rate > -0.02 ? '<span class="faint">Static</span>' : '<span class="bad">Declining</span>';
    const avg = p.season.ratingCount ? p.season.ratingSum / p.season.ratingCount : 0;
    return `<tr class="clickable" data-player="${esc(p.id)}">
        <td class="nowrap">${esc(p.name)}</td>
        <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
        <td class="num">${p.age}</td>
        <td class="num">${ca}</td>
        <td class="num">${p.pa}</td>
        <td>${bar((gap / 60) * 100, gap > 25 ? '' : 'warn')}</td>
        <td class="small">${traj}</td>
        <td class="num">${p.season.minutes}</td>
        <td class="num">${ratingCell(avg)}</td>
      </tr>`;
  }).join('')}</tbody></table></div>`;
}

function depthView(world, club) {
  const depth = squadDepth(world, club);
  const target = Math.round(50 + (club.rep - 20) * (106 / 79));
  return `<div class="panel-body"><p class="small faint" style="margin-top:0">
    Ability expected of a starter at a club of your reputation: about ${target}.
    Anything well below that is a position worth strengthening.</p></div>
  <div class="table-wrap"><table>
    <thead><tr><th>Position</th><th class="num">Players</th><th class="num">Best</th><th class="num">Average</th><th>Assessment</th></tr></thead>
    <tbody>${Object.entries(depth).map(([pos, d]) => {
    const gap = target - d.best;
    const verdict = d.count === 0 ? '<span class="bad">No cover at all</span>'
      : d.count === 1 ? '<span class="warn">Only one option</span>'
        : gap > 22 ? '<span class="bad">Well short of the standard</span>'
          : gap > 10 ? '<span class="warn">Could be stronger</span>'
            : '<span class="good">Well covered</span>';
    return `<tr><td>${esc(pos)}</td><td class="num">${d.count}</td><td class="num">${d.best || '—'}</td>
      <td class="num">${d.avg ? Math.round(d.avg) : '—'}</td><td class="small">${verdict}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
