// Fixtures and results for the user's club, plus a match report viewer.

import { esc, panelTight, emptyState, shortDate, openModal, badge, tabs, ratingCell } from '../components.js';
import { userClub, clubFixtures } from '../../state/game.js';
import { showPlayer } from '../playerProfile.js';
import { sortBy } from '../../core/util.js';

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('No club.') };

  const state = app.screenState.fixtures || (app.screenState.fixtures = { view: 'all' });
  let fixtures = clubFixtures(game, club.id);
  if (state.view === 'results') fixtures = fixtures.filter((f) => f.played);
  if (state.view === 'upcoming') fixtures = fixtures.filter((f) => !f.played);

  if (app.params.fixtureId) {
    const f = game.fixtures[app.params.fixtureId];
    if (f?.played) setTimeout(() => showMatchReport(app, f), 0);
    app.params = {};
  }

  const played = clubFixtures(game, club.id).filter((f) => f.played);
  const w = played.filter((f) => won(f, club.id)).length;
  const d = played.filter((f) => f.result.homeGoals === f.result.awayGoals).length;

  return {
    html: `
      ${tabs([{ id: 'all', label: 'All' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'results', label: 'Results' }], state.view)}
      <div class="row small faint" style="margin-bottom:10px">
        Played ${played.length} · ${w}W ${d}D ${played.length - w - d}L ·
        ${played.reduce((a, f) => a + (f.homeId === club.id ? f.result.homeGoals : f.result.awayGoals), 0)} scored,
        ${played.reduce((a, f) => a + (f.homeId === club.id ? f.result.awayGoals : f.result.homeGoals), 0)} conceded
      </div>
      ${panelTight('Fixtures', fixtures.length === 0 ? emptyState('Nothing to show.') : `
        <div class="table-wrap"><table><thead><tr>
          <th>Date</th><th>Competition</th><th>Round</th><th></th><th>Opponent</th>
          <th class="center">Result</th><th>Scorers</th><th class="num">Att.</th></tr></thead>
        <tbody>${fixtures.map((f) => {
    const isHome = f.homeId === club.id;
    const opp = world.clubs[isHome ? f.awayId : f.homeId];
    const res = f.played ? resultCell(f, club.id) : '<span class="faint">—</span>';
    const scorers = f.played ? f.result.scorers
      .filter((s) => (s.side === 'home') === isHome)
      .map((s) => `${esc(world.players[s.playerId]?.short || '')} ${s.minute}'`).join(', ') : '';
    return `<tr class="${f.played ? 'clickable' : ''}" data-fx="${esc(f.id)}">
            <td class="small nowrap faint">${esc(shortDate(f.day, world.year))}</td>
            <td class="small">${esc(f.compName)}</td>
            <td class="small faint">${esc(String(f.round))}</td>
            <td class="small faint">${isHome ? 'H' : 'A'}</td>
            <td class="nowrap">${badge(opp, 18)} ${esc(opp.short)}</td>
            <td class="center">${res}</td>
            <td class="small faint">${scorers}</td>
            <td class="num small faint">${f.played ? f.result.attendance.toLocaleString() : ''}</td>
          </tr>`;
  }).join('')}</tbody></table></div>`)}`,

    mount(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => { state.view = t.dataset.tab; app.refresh(); };
      });
      root.querySelectorAll('[data-fx]').forEach((tr) => {
        tr.onclick = () => {
          const f = game.fixtures[tr.dataset.fx];
          if (f?.played) showMatchReport(app, f);
        };
      });
    },
  };
}

function won(f, clubId) {
  const isHome = f.homeId === clubId;
  return isHome ? f.result.homeGoals > f.result.awayGoals : f.result.awayGoals > f.result.homeGoals;
}

function resultCell(f, clubId) {
  const isHome = f.homeId === clubId;
  const gf = isHome ? f.result.homeGoals : f.result.awayGoals;
  const ga = isHome ? f.result.awayGoals : f.result.homeGoals;
  const cls = gf > ga ? 'good' : gf === ga ? 'muted' : 'bad';
  return `<span class="mono ${cls}"><b>${gf}-${ga}</b></span>`;
}

export function showMatchReport(app, fixture) {
  const world = app.game.world;
  const home = world.clubs[fixture.homeId];
  const away = world.clubs[fixture.awayId];
  const r = fixture.result;
  const hs = r.homeStats;
  const as = r.awayStats;

  const statRows = [
    ['Possession', `${hs.possession}%`, `${as.possession}%`],
    ['Shots', hs.shots, as.shots],
    ['On target', hs.onTarget, as.onTarget],
    ['Expected goals', hs.xg.toFixed(2), as.xg.toFixed(2)],
    ['Corners', hs.corners, as.corners],
    ['Fouls', hs.fouls, as.fouls],
    ['Offsides', hs.offsides, as.offsides],
    ['Yellow cards', hs.yellow, as.yellow],
    ['Red cards', hs.red, as.red],
    ['Saves', hs.saves, as.saves],
  ];

  const hasDetail = !!r.records;
  const ratingsTable = (records, club) => {
    if (!records) return '';
    const rows = sortBy(Object.values(records).filter((x) => x.minutes > 0), { key: (x) => x.rating || 0, desc: true });
    return `<table><thead><tr><th>${esc(club.short)}</th><th class="num">Min</th><th class="num">G</th>
      <th class="num">A</th><th class="num">Rating</th></tr></thead><tbody>
      ${rows.map((x) => `<tr class="clickable" data-player="${esc(x.playerId)}">
        <td class="nowrap small">${esc(x.name)}${x.motm ? ' <span class="pill good">MotM</span>' : ''}</td>
        <td class="num small">${x.minutes}</td><td class="num">${x.goals || ''}</td>
        <td class="num">${x.assists || ''}</td><td class="num">${ratingCell(x.rating)}</td></tr>`).join('')}
    </tbody></table>`;
  };

  openModal({
    title: `${home.name} ${r.homeGoals}-${r.awayGoals} ${away.name}`,
    wide: true,
    body: `
      <div class="match-scoreboard" style="border-radius:6px;border:1px solid var(--line);margin-bottom:14px">
        <div class="team">${badge(home, 34)}<div class="tname">${esc(home.name)}</div></div>
        <div><div class="score">${r.homeGoals} - ${r.awayGoals}</div>
          <div class="clock">${esc(fixture.compName)} · ${esc(String(fixture.round))}</div></div>
        <div class="team away">${badge(away, 34)}<div class="tname">${esc(away.name)}</div></div>
      </div>
      <p class="small faint center">${esc(home.stadium.name)} · ${r.attendance.toLocaleString()} attendance · ${esc(r.weather)}
        ${r.shootout ? ` · shoot-out ${r.shootout.score.home}-${r.shootout.score.away}` : ''}</p>

      <div class="grid ${hasDetail ? 'c2' : ''}">
        <section class="panel"><div class="panel-head"><h2>Match Stats</h2></div><div class="panel-body tight">
          <table><tbody>${statRows.map(([label, h, a]) => `<tr>
            <td class="num" style="width:70px">${h}</td>
            <td class="center small faint">${esc(label)}</td>
            <td class="num" style="width:70px;text-align:left">${a}</td></tr>`).join('')}</tbody></table>
        </div></section>
        ${hasDetail ? `<section class="panel"><div class="panel-head"><h2>Key Moments</h2></div>
          <div class="panel-body tight"><div class="scroll-y" style="max-height:280px">
          ${r.events.filter((e) => ['goal', 'red', 'yellow', 'penalty', 'injury', 'sub', 'halftime', 'fulltime', 'woodwork'].includes(e.type))
    .map((e) => `<div class="comm-line ${esc(e.type)}"><span class="min">${e.minute}'</span><span>${esc(e.text)}</span></div>`).join('')}
          </div></div></section>` : ''}
      </div>

      ${hasDetail ? `<div class="grid c2" style="margin-top:14px">
        <section class="panel"><div class="panel-body tight">${ratingsTable(r.records.home, home)}</div></section>
        <section class="panel"><div class="panel-body tight">${ratingsTable(r.records.away, away)}</div></section>
      </div>` : '<p class="faint small center" style="margin-top:14px">Detailed reports are kept for your most recent matches.</p>'}`,
    onMount(modal, close) {
      modal.querySelectorAll('[data-player]').forEach((tr) => {
        tr.onclick = () => { close(); showPlayer(app, tr.dataset.player); };
      });
    },
  });
}
