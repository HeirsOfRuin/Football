// Club screen: board, facilities, training and history.

import { esc, panel, panelTight, emptyState, kv, raw, tabs, badge, bar, toast } from '../components.js';
import { userClub, BOARD_REQUESTS, evaluateRequest, makeRequest, availableJobs, takeOverClub } from '../../state/game.js';
import { showPlayer } from '../playerProfile.js';
import { squadStrength } from '../../gen/worldgen.js';
import { money } from '../../core/util.js';

const VIEWS = [
  { id: 'overview', label: 'Overview' },
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
  if (state.view === 'staff') body = staffView(club);
  else if (state.view === 'history') body = historyView(club);
  else if (state.view === 'manager') body = managerView(app, game);
  else body = overviewView(app, club, league);

  return {
    html: `${tabs(VIEWS, state.view)}${body}`,
    mount(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => { state.view = t.dataset.tab; app.refresh(); };
      });
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
      root.querySelectorAll('[data-job]').forEach((b) => {
        b.onclick = async (e) => {
          e.stopPropagation();
          const job = availableJobs(app.game).find((j) => j.club.id === b.dataset.job);
          if (!job) return;
          const { showInterview } = await import('./seasonreview.js');
          showInterview(app, job, (clubId, answers) => {
            takeOverClub(app.game, clubId, app.game.manager.name, app.game.manager.nat, answers);
            app.go('dashboard');
            toast(`You are the new manager of ${app.game.world.clubs[clubId].name}.`);
          });
        };
      });
      root.querySelectorAll('[data-request]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const err = makeRequest(app.game, b.dataset.request);
          toast(err || 'The board agreed.');
          app.refresh();
        };
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
    ['Confidence', raw(`${bar(club.board.confidence)} <span class="small">${Math.round(club.board.confidence)}%</span>`)],
    ['Patience', String(Math.round(club.board.patience))],
    ['Your contract', app.game.manager.contract
    ? `${money(app.game.manager.contract.wage)}/wk to ${app.game.manager.contract.expiresYear}`
    : 'None'],
  ])}
    <div class="small" style="margin:10px 0 4px"><b>This season's objectives</b></div>
    ${objectiveList(app, club)}
    <p class="small faint" style="margin-bottom:0">All three are judged at the end of the season.
      A patient board will give you another year; an impatient one will not.</p>`)}

    ${panel('Ask the board', `${requestList(app, club)}
      <p class="small faint" style="margin-bottom:0">One request a season. The board have to rate your work
        and the club has to be able to afford it.</p>`)}

    ${panel('Elsewhere', `${vacancyList(app)}`)}
  </div>`;
}

/** The three objectives, with how each is going right now. */
function objectiveList(app, club) {
  const objectives = club.board.objectives || [club.board.expectation];
  return `<div class="table-wrap"><table><tbody>${objectives.map((o) => {
    if (!o) return '';
    const mark = o.met === true ? '<span class="good">met</span>'
      : o.met === false ? '<span class="bad">missed</span>' : '<span class="faint">in progress</span>';
    return `<tr><td class="small">${esc(o.label)}</td>
      <td class="small right nowrap">${o.detail ? `<span class="faint">${esc(o.detail)}</span> ` : ''}${mark}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

/**
 * Jobs going at other clubs.
 *
 * A post that opens in November is worth nothing to a manager with no way to
 * see it, and leaving for a bigger club mid-season is a real part of the job.
 */
function vacancyList(app) {
  const jobs = availableJobs(app.game);
  if (!jobs.length) {
    return `<p class="small faint" style="margin-bottom:0">No club is looking for a manager at the moment.
      Posts come open through the season as boards lose patience, and a fresh batch every summer.</p>`;
  }
  return `<div class="table-wrap"><table><tbody>${jobs.slice(0, 8).map((j) => `<tr>
      <td class="small nowrap">${esc(j.club.name)}<div class="small faint">${esc(j.league.name)}</div></td>
      <td class="small faint">${esc(j.vacancy?.reason || '')}</td>
      <td class="small num">rep ${j.club.rep}</td>
      <td class="right"><button class="ghost small" data-job="${esc(j.club.id)}">Interview</button></td>
    </tr>`).join('')}</tbody></table></div>
    <p class="small faint" style="margin:8px 0 0">Walking out on a club mid-season is your business, not the board's,
      but the one you leave will not forget it.</p>`;
}

function requestList(app, club) {
  const rows = Object.values(BOARD_REQUESTS).map((r) => {
    const v = evaluateRequest(app.game, r.id);
    // A greyed-out button with no explanation is the thing this screen is
    // supposed to replace, so a refusal says what would have to change.
    const why = v.ok ? esc(r.help) : esc(v.reason || r.help);
    return `<tr>
      <td class="small">${esc(r.label)}<div class="small faint">${why}</div></td>
      <td class="small right nowrap">${v.cost ? money(v.cost) : '—'}</td>
      <td class="right"><button class="ghost small" data-request="${esc(r.id)}" ${v.ok ? '' : 'disabled'}>Ask</button></td>
    </tr>`;
  });
  return `<div class="table-wrap"><table><tbody>${rows.join('')}</tbody></table></div>`;
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
