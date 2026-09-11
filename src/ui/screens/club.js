// Club screen: board, facilities, training and history.

import { esc, panel, panelTight, emptyState, kv, raw, tabs, toast, badge, bar } from '../components.js';
import { userClub } from '../../state/game.js';
import { TRAINING_FOCUSES, TRAINING_INTENSITY, expectedRole, ROLE_LABELS, developmentRate } from '../../engine/training.js';
import { currentAbility } from '../../data/attributes.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';
import { squadStrength } from '../../gen/worldgen.js';

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'training', label: 'Training' },
  { id: 'staff', label: 'Staff & Facilities' },
  { id: 'history', label: 'History' },
  { id: 'manager', label: 'Manager' },
];

const FACILITY_LABELS = [
  [18, 'State of the art'], [15, 'Excellent'], [12, 'Good'], [9, 'Average'],
  [6, 'Basic'], [3, 'Poor'], [0, 'Dilapidated'],
];

function facilityLabel(v) {
  for (const [min, label] of FACILITY_LABELS) if (v >= min) return label;
  return 'Dilapidated';
}

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('No club.') };
  const state = app.screenState.club || (app.screenState.club = { view: 'overview' });
  const league = world.leagues.find((l) => l.id === club.leagueId);

  let body;
  if (state.view === 'training') body = trainingView(app, club);
  else if (state.view === 'staff') body = staffView(club);
  else if (state.view === 'history') body = historyView(club);
  else if (state.view === 'manager') body = managerView(app, game);
  else body = overviewView(app, club, league);

  return {
    html: `${tabs(VIEWS, state.view)}${body}`,
    mount(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => { state.view = t.dataset.tab; app.refresh(); };
      });
      const focus = root.querySelector('#training-focus');
      if (focus) {
        focus.onchange = () => { club.trainingFocus = focus.value; toast('Training focus updated.'); app.refresh(); };
      }
      const intensity = root.querySelector('#training-intensity');
      if (intensity) {
        intensity.onchange = () => { club.trainingIntensity = intensity.value; toast('Training intensity updated.'); app.refresh(); };
      }
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
    },
  };
}

function overviewView(app, club, league) {
  const world = app.game.world;
  const nation = world.nations.find((n) => n.id === club.nation);
  return `<div class="grid c2">
    ${panel('Club', `<div class="row" style="gap:12px;margin-bottom:12px">${badge(club, 44)}
      <div><div style="font-size:18px;font-weight:600">${esc(club.name)}</div>
      <div class="faint small">${esc(club.city)}, ${esc(nation?.name || '')} · founded ${club.founded}</div></div></div>
      ${kv([
    ['Division', league?.name || '—'],
    ['Stadium', `${club.stadium.name} (${club.stadium.capacity.toLocaleString()})`],
    ['Reputation', String(club.rep)],
    ['Squad strength', String(Math.round(squadStrength(world, club)))],
    ['Squad size', String(club.squad.length)],
    ['Average age', (club.squad.reduce((a, id) => a + world.players[id].age, 0) / Math.max(1, club.squad.length)).toFixed(1)],
  ])}`)}
    ${panel('Board', `${kv([
    ['Expectation', club.board.expectation.label],
    ['Confidence', raw(`${bar(club.board.confidence)} <span class="small">${Math.round(club.board.confidence)}%</span>`)],
    ['Patience', String(Math.round(club.board.patience))],
    ['Priority', club.board.wantsYouth ? 'Develop young players' : 'Win now'],
    ['Style wanted', club.board.wantsAttacking ? 'Attacking football' : 'Results above all'],
  ])}
    <p class="small faint" style="margin-bottom:0">The board review your position at the end of each season.
      Sustained failure against their expectation costs you the job.</p>`)}
  </div>`;
}

function trainingView(app, club) {
  const world = app.game.world;
  const focus = TRAINING_FOCUSES.find((f) => f.id === (club.trainingFocus || 'Balanced'));
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const developing = sortBy(squad, { key: (p) => developmentRate(world, club, p), desc: true }).slice(0, 12);

  return `<div class="grid c1-2">
    ${panel('Programme', `
      <div class="field"><label>Focus</label><select id="training-focus">
        ${TRAINING_FOCUSES.map((f) => `<option value="${f.id}" ${f.id === (club.trainingFocus || 'Balanced') ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Intensity</label><select id="training-intensity">
        ${TRAINING_INTENSITY.map((i) => `<option ${i === (club.trainingIntensity || 'Normal') ? 'selected' : ''}>${esc(i)}</option>`).join('')}
      </select></div>
      <p class="small faint">Focus steers which attributes players work on. Intensity trades faster progress
        against tiredness and injury risk.</p>
      ${focus && Object.keys(focus.emphasis).length ? `<p class="small">Emphasis: ${Object.keys(focus.emphasis).join(', ')}</p>` : ''}
      ${kv([
    ['Training facilities', `${club.facilities.training}/20 — ${facilityLabel(club.facilities.training)}`],
    ['Youth facilities', `${club.facilities.youth}/20 — ${facilityLabel(club.facilities.youth)}`],
  ])}`)}
    ${panelTight('Progress Report', `<div class="table-wrap"><table>
      <thead><tr><th>Player</th><th class="num">Age</th><th class="num">Ability</th><th class="num">Potential</th>
        <th>Trajectory</th><th>Squad role</th><th class="num">Minutes</th></tr></thead>
      <tbody>${developing.map((p) => {
    const rate = developmentRate(world, club, p);
    const traj = rate > 0.09 ? '<span class="good">Rapid</span>' : rate > 0.045 ? '<span class="good">Improving</span>'
      : rate > 0.005 ? '<span class="muted">Slow</span>' : rate > -0.02 ? '<span class="faint">Static</span>' : '<span class="bad">Declining</span>';
    return `<tr class="clickable" data-player="${esc(p.id)}">
        <td class="nowrap">${esc(p.name)}</td><td class="num">${p.age}</td>
        <td class="num">${currentAbility(p)}</td><td class="num faint">${p.pa}</td>
        <td class="small">${traj}</td><td class="small faint">${esc(ROLE_LABELS[expectedRole(world, club, p)])}</td>
        <td class="num">${p.season.minutes}</td></tr>`;
  }).join('')}</tbody></table></div>`)}
  </div>`;
}

function staffView(club) {
  const m = club.manager || {};
  return `<div class="grid c2">
    ${panel('Facilities', Object.entries({
    training: 'Training ground', youth: 'Youth academy', scouting: 'Scouting network', medical: 'Medical department',
  }).map(([key, label]) => `<div class="attr-row"><span class="label">${esc(label)}</span>
      <span class="bar" style="flex:0 0 110px"><span style="width:${(club.facilities[key] / 20) * 100}%"></span></span>
      <span class="val mono">${club.facilities[key]}</span></div>
      <div class="faint small" style="margin:-2px 0 6px">${esc(facilityLabel(club.facilities[key]))}</div>`).join(''))}
    ${panel('Coaching', Object.entries({
    attacking: 'Attacking coach', defending: 'Defensive coach', fitness: 'Fitness coach', gk: 'Goalkeeping coach',
  }).map(([key, label]) => `<div class="attr-row"><span class="label">${esc(label)}</span>
      <span class="bar" style="flex:0 0 110px"><span style="width:${(club.coaching[key] / 20) * 100}%"></span></span>
      <span class="val mono">${club.coaching[key]}</span></div>`).join('')
    + `<p class="small faint" style="margin-bottom:0">Coaching quality multiplies the development rate of the players it covers.</p>`)}
  </div>`;
}

function historyView(club) {
  const history = [...(club.history || [])].reverse();
  return panelTight('Club History', history.length === 0 ? emptyState('No history recorded yet.')
    : `<table><thead><tr><th>Season</th><th>Achievement</th></tr></thead><tbody>
      ${history.map((h) => `<tr><td class="mono small">${h.year}/${String(h.year + 1).slice(2)}</td>
        <td>${esc(h.achievement)}</td></tr>`).join('')}</tbody></table>`);
}

function managerView(app, game) {
  const m = game.manager;
  const played = m.matches || 0;
  const winPct = played ? ((m.wins / played) * 100).toFixed(1) : '0.0';
  return `<div class="grid c2">
    ${panel('Record', kv([
    ['Name', m.name],
    ['Reputation', String(Math.round(m.reputation))],
    ['Matches', String(played)],
    ['Won / Drawn / Lost', `${m.wins} / ${m.draws} / ${m.losses}`],
    ['Win rate', `${winPct}%`],
    ['Trophies', String(m.trophies.length)],
  ]))}
    ${panelTight('Trophy Cabinet', m.trophies.length === 0 ? emptyState('Nothing won yet.')
    : `<table><tbody>${[...m.trophies].reverse().map((t) => `<tr>
      <td class="mono small">${t.year}/${String(t.year + 1).slice(2)}</td>
      <td>${esc(t.name)}</td><td class="small faint">${esc(t.club)}</td></tr>`).join('')}</tbody></table>`)}
    ${panelTight('Seasons', m.history.length === 0 ? emptyState('No completed seasons.')
    : `<table><thead><tr><th>Season</th><th>Club</th><th>Division</th><th class="num">Pos</th>
      <th class="num">W</th><th class="num">D</th><th class="num">L</th></tr></thead><tbody>
      ${[...m.history].reverse().map((h) => `<tr>
        <td class="mono small">${h.year}/${String(h.year + 1).slice(2)}</td>
        <td class="small">${esc(h.club)}</td><td class="small faint">${esc(h.league || '')}</td>
        <td class="num">${h.position ?? '—'}</td><td class="num">${h.w}</td><td class="num">${h.d}</td><td class="num">${h.l}</td>
      </tr>`).join('')}</tbody></table>`)}
  </div>`;
}
