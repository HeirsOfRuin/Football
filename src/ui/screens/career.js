// The career page: everything you have done, in one place.
//
// The record was scattered across three screens and partly contradictory. The
// manager panel showed a lifetime W/D/L counted across every competition with a
// season table underneath whose W/D/L was league-only; promotions were free text
// on the club rather than honours; and the players you managed left no trace at
// all once they retired, because retirement deleted them.

import { esc, panel, panelTight, kv, tabs, emptyState, nationName } from '../components.js';
import { userClub } from '../../state/game.js';
import { careerTotals } from '../../state/career.js';
import { sortBy } from '../../core/util.js';

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'honours', label: 'Honours' },
  { id: 'players', label: 'Players' },
  { id: 'hall', label: 'Hall of Fame' },
];

const HONOUR_RANK = { league: 0, cup: 1, playoff: 2, promotion: 3 };
const HONOUR_LABEL = {
  league: 'League title', cup: 'Cup', playoff: 'Play-offs', promotion: 'Promotion',
};

export function render(app) {
  const game = app.game;
  const m = game.manager;
  const state = app.screenState.career || (app.screenState.career = { view: 'overview' });
  const totals = careerTotals(m);

  let body;
  if (state.view === 'seasons') body = seasonsView(m);
  else if (state.view === 'honours') body = honoursView(m, totals);
  else if (state.view === 'players') body = playersView(app, m);
  else if (state.view === 'hall') body = hallView(app);
  else body = overviewView(app, m, totals);

  return {
    html: `${tabs(VIEWS, state.view)}${body}`,
    mount(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => { state.view = t.dataset.tab; app.refresh(); };
      });
    },
  };
}

function season(year) {
  return `${year}/${String(year + 1).slice(2)}`;
}

function overviewView(app, m, totals) {
  const game = app.game;
  const club = userClub(game);
  const spells = [...(m.spells || [])].reverse();
  const best = sortBy(m.history || [], { key: (h) => -(h.position ?? 99) })[0];

  return `<div class="grid c2">
    ${panel('Manager', kv([
    ['Name', m.name],
    ['From', nationName(game.world, m.nat)],
    ['Reputation', String(Math.round(m.reputation))],
    ['Currently', club ? `${club.name}` : 'Out of work'],
    ['Seasons managed', String(totals.seasons)],
    ['Clubs managed', String(totals.clubs)],
  ]))}
    ${panel('Record', `${kv([
    // Both records, labelled. The panel this replaces showed one of these above
    // a table of the other, with nothing saying they were different questions.
    ['All competitions', `${totals.all.matches} played — ${totals.all.w}W ${totals.all.d}D ${totals.all.l}L`],
    ['...win rate', `${totals.allWinPct.toFixed(1)}%`],
    ['League only', `${totals.league.matches} played — ${totals.league.w}W ${totals.league.d}D ${totals.league.l}L`],
    ['...win rate', `${totals.leagueWinPct.toFixed(1)}%`],
    ['Honours', `${totals.honours}${totals.promotions ? ` (including ${totals.promotions} promotion${totals.promotions === 1 ? '' : 's'})` : ''}`],
    ['Best finish', best?.position ? `${best.position} in the ${best.league} (${season(best.year)})` : '—'],
  ])}
    <p class="small faint" style="margin-bottom:0">A league table counts league games. "Matches managed" counts
      every competition. They are different numbers and always have been.</p>`)}
  </div>

  ${panelTight('Spells', spells.length === 0 ? emptyState('No clubs managed yet.')
    : `<div class="table-wrap"><table>
      <thead><tr><th>Club</th><th>From</th><th>To</th><th class="num">Seasons</th>
        <th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th>
        <th class="num">Win %</th><th class="num">Honours</th><th>Ended</th></tr></thead>
      <tbody>${spells.map((s) => `<tr>
        <td class="nowrap">${esc(s.club)}</td>
        <td class="mono small">${season(s.startYear)}</td>
        <td class="mono small">${s.endYear ? season(s.endYear) : '<span class="good">present</span>'}</td>
        <td class="num">${s.seasons}</td>
        <td class="num">${s.matches}</td><td class="num">${s.wins}</td><td class="num">${s.draws}</td><td class="num">${s.losses}</td>
        <td class="num">${s.matches ? ((s.wins / s.matches) * 100).toFixed(0) : 0}%</td>
        <td class="num">${s.trophies || 0}</td>
        <td class="small faint">${esc(s.reason === 'sacked' ? 'Dismissed' : s.reason === 'left' ? 'Moved on' : '')}</td>
      </tr>`).join('')}</tbody></table></div>`)}`;
}

function seasonsView(m) {
  const rows = [...(m.history || [])].reverse();
  if (!rows.length) return panelTight('Seasons', emptyState('No completed seasons yet.'));
  return panelTight('Season by season', `<div class="table-wrap"><table>
    <thead><tr><th>Season</th><th>Club</th><th>Division</th><th class="num">Pos</th>
      <th class="num">League W-D-L</th><th class="num">All comps W-D-L</th><th>Board objectives</th></tr></thead>
    <tbody>${rows.map((h) => {
    const met = (h.objectives || []).filter((o) => o.met === true).length;
    const judged = (h.objectives || []).filter((o) => o.met !== null).length;
    return `<tr>
      <td class="mono small">${season(h.year)}</td>
      <td class="small nowrap">${esc(h.club)}</td>
      <td class="small faint">${esc(h.league || '')}</td>
      <td class="num">${h.position ?? '—'}${h.teams ? `<span class="faint small">/${h.teams}</span>` : ''}</td>
      <td class="num mono">${h.w}-${h.d}-${h.l}</td>
      <td class="num mono faint">${h.allW ?? '—'}-${h.allD ?? '—'}-${h.allL ?? '—'}</td>
      <td class="small ${judged && met === judged ? 'good' : met ? '' : 'faint'}">${judged
      ? `${met} of ${judged} met` : '—'}</td>
    </tr>`;
  }).join('')}</tbody></table>
  <p class="small faint" style="margin:8px 0 0">The two W-D-L columns are different questions, not a discrepancy:
    the first is the league, the second is every competition you played.</p></div>`);
}

function honoursView(m, totals) {
  const trophies = [...(m.trophies || [])];
  if (!trophies.length) {
    return panelTight('Honours', emptyState('Nothing won yet. Promotions count too — they are the '
      + 'achievement a career in the lower divisions is built on.'));
  }
  const grouped = new Map();
  for (const t of trophies) {
    const k = `${t.kind}:${t.name}`;
    if (!grouped.has(k)) grouped.set(k, { ...t, years: [] });
    grouped.get(k).years.push(t.year);
  }
  const list = sortBy([...grouped.values()], { key: (t) => HONOUR_RANK[t.kind] ?? 9 },
    { key: (t) => -t.years.length });

  return `${panel('Trophy cabinet', kv([
    ['Total', String(totals.honours)],
    ['League titles', String(trophies.filter((t) => t.kind === 'league').length)],
    ['Cups', String(trophies.filter((t) => t.kind === 'cup').length)],
    ['Promotions', String(trophies.filter((t) => t.kind === 'promotion').length)],
    ['Play-off wins', String(trophies.filter((t) => t.kind === 'playoff').length)],
  ]))}
  ${panelTight('Every honour', `<div class="table-wrap"><table>
    <thead><tr><th>What</th><th>Type</th><th>Club</th><th class="num">Times</th><th>Seasons</th></tr></thead>
    <tbody>${list.map((t) => `<tr>
      <td class="nowrap">${esc(t.name)}</td>
      <td class="small faint">${esc(HONOUR_LABEL[t.kind] || t.kind)}</td>
      <td class="small">${esc(t.club)}</td>
      <td class="num">${t.years.length}</td>
      <td class="small mono faint">${t.years.map(season).join(', ')}</td>
    </tr>`).join('')}</tbody></table></div>`)}`;
}

function playersView(app, m) {
  const notable = [...(m.notable || [])];
  if (!notable.length) {
    return panelTight('Players you have managed', emptyState('Nobody yet. Players appear here once they '
      + 'have played five games for you in a season.'));
  }
  const list = sortBy(notable, { key: (n) => n.apps + n.peak * 2, desc: true }).slice(0, 80);
  return panelTight(`Players you have managed (${notable.length})`, `<div class="table-wrap"><table>
    <thead><tr><th>Player</th><th>Pos</th><th>Years</th><th class="num">Seasons</th>
      <th class="num">Apps</th><th class="num">Goals</th><th class="num">Assists</th>
      <th class="num">Peak</th><th>Where he went</th></tr></thead>
    <tbody>${list.map((n) => `<tr>
      <td class="nowrap">${esc(n.name)}</td>
      <td class="small faint">${esc(n.pos)}</td>
      <td class="small mono faint">${n.firstYear}${n.lastYear !== n.firstYear ? `–${String(n.lastYear).slice(2)}` : ''}</td>
      <td class="num">${n.seasons}</td>
      <td class="num">${n.apps}</td>
      <td class="num">${n.goals}</td>
      <td class="num">${n.assists}</td>
      <td class="num">${n.peak}</td>
      <td class="small ${n.wentTo === 'Retired' ? 'faint' : ''}">${n.wentTo ? esc(n.wentTo) : '<span class="good">still here</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`);
}

function hallView(app) {
  const hall = [...(app.game.world.hallOfFame || [])];
  if (!hall.length) {
    return panelTight('Hall of Fame', emptyState('Nobody has retired yet. Players who finish a long or '
      + 'distinguished career are remembered here instead of simply disappearing.'));
  }
  const list = sortBy(hall, { key: (h) => Number(!!h.managedByYou), desc: true },
    { key: (h) => h.peak + h.apps / 8, desc: true }).slice(0, 100);
  return panelTight(`Hall of Fame (${hall.length})`, `<div class="table-wrap"><table>
    <thead><tr><th>Player</th><th>Pos</th><th class="num">Retired</th><th class="num">Age</th>
      <th>Last club</th><th class="num" title="Appearances since this save began">Apps</th>
      <th class="num">Goals</th><th class="num">Peak</th><th></th></tr></thead>
    <tbody>${list.map((h) => `<tr>
      <td class="nowrap">${esc(h.name)}</td>
      <td class="small faint">${esc(h.pos)}</td>
      <td class="num mono small">${h.retiredYear}</td>
      <td class="num">${h.age}</td>
      <td class="small">${esc(h.lastClub || '—')}</td>
      <td class="num">${h.apps}</td>
      <td class="num">${h.goals}</td>
      <td class="num">${h.peak}</td>
      <td class="nowrap small">${h.managedByYou ? '<span class="pill good">Yours</span>' : ''}${
  h.youthProduct ? ' <span class="pill info" title="Came through an academy">Academy</span>' : ''}</td>
    </tr>`).join('')}</tbody></table>
  <p class="small faint" style="margin:8px 0 0">Appearances and goals count what a player did since this save
    began, not a career that started before the world existed.</p></div>`);
}
