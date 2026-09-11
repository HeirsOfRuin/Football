// The home screen: what happened, what is next, what needs attention.

import { esc, panel, panelTight, badge, money, formRun, emptyState, kv, raw, shortDate, ratingCell } from '../components.js';
import { userClub, nextFixtureFor, clubFixtures, sortTable } from '../../state/game.js';
import { squadStrength } from '../../gen/worldgen.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';
import { wageBudgetUsage, financialHealth } from '../../engine/finance.js';

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('You are not currently managing a club.') };

  const league = world.leagues.find((l) => l.id === club.leagueId);
  const table = sortTable(league.table);
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  const row = table[pos - 1];
  const next = nextFixtureFor(game, club.id);
  const opponent = next ? world.clubs[next.homeId === club.id ? next.awayId : next.homeId] : null;
  const recent = clubFixtures(game, club.id).filter((f) => f.played).slice(-5).reverse();
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const unread = game.inbox.filter((n) => !n.read).slice(0, 6);
  const injured = squad.filter((p) => p.injury);
  const suspended = squad.filter((p) => p.suspension > 0);
  const wage = wageBudgetUsage(world, club);
  const health = financialHealth(club);
  const offers = (game.offers || []).filter((o) => world.players[o.playerId]?.clubId === club.id);

  const topPerformers = sortBy(squad.filter((p) => p.season.ratingCount >= 3),
    { key: (p) => p.season.ratingSum / p.season.ratingCount, desc: true }).slice(0, 5);

  // A slice of the table centred on the user's club.
  const from = Math.max(0, Math.min(pos - 3, table.length - 6));
  const slice = table.slice(from, from + 6);

  return {
    html: `
    <div class="grid c2-1">
      <div class="stack">
        ${next && opponent ? panel('Next Match', `
          <div class="row next-match" style="gap:16px">
            ${badge(club, 40)}
            <div><div style="font-size:15px;font-weight:600">${esc(club.short)}</div>
              <div class="faint small">${formRun(club.form)}</div></div>
            <div class="center" style="flex:1">
              <div class="mono muted">${esc(next.homeId === club.id ? 'HOME' : 'AWAY')}</div>
              <div class="small faint">${esc(shortDate(next.day, world.year))} · ${esc(next.compName)}</div>
              <div class="small faint">${esc(String(next.round))}</div>
            </div>
            <div class="right"><div style="font-size:15px;font-weight:600">${esc(opponent.short)}</div>
              <div class="faint small">${formRun(opponent.form)}</div></div>
            ${badge(opponent, 40)}
          </div>
          <div class="row small faint next-match-meta" style="margin-top:12px;justify-content:space-between">
            <span>Squad strength ${Math.round(squadStrength(world, club))} v ${Math.round(squadStrength(world, opponent))}</span>
            <span>${esc(opponent.stadium.name)} · ${opponent.stadium.capacity.toLocaleString()}</span>
          </div>`) : panel('Next Match', emptyState('No fixtures scheduled.'))}

        ${panelTight('Inbox', unread.length === 0
    ? emptyState('Nothing new.')
    : unread.map((n) => `<div class="inbox-item unread" data-news="${esc(n.id)}">
            <span class="dot"></span>
            <div style="min-width:0;flex:1"><div class="subject">${esc(n.title)}</div>
            <div class="preview">${esc(n.body)}</div></div>
            <span class="when">${esc(shortDate(n.day, world.year))}</span></div>`).join(''),
    '<button class="sm" data-act="inbox">Open inbox</button>')}

        ${panelTight('Recent Results', recent.length === 0
    ? emptyState('No matches played yet.')
    : `<table><tbody>${recent.map((f) => {
      const home = world.clubs[f.homeId];
      const away = world.clubs[f.awayId];
      const isHome = f.homeId === club.id;
      const gf = isHome ? f.result.homeGoals : f.result.awayGoals;
      const ga = isHome ? f.result.awayGoals : f.result.homeGoals;
      const cls = gf > ga ? 'good' : gf === ga ? 'muted' : 'bad';
      return `<tr class="clickable" data-fixture="${esc(f.id)}">
          <td class="small faint nowrap">${esc(shortDate(f.day, world.year))}</td>
          <td class="small faint">${esc(f.compName)}</td>
          <td class="right nowrap">${esc(home.short)}</td>
          <td class="center mono ${cls}" style="width:56px">${f.result.homeGoals}-${f.result.awayGoals}</td>
          <td class="nowrap">${esc(away.short)}</td>
          <td class="small faint right">${f.result.motm ? esc(f.result.motm.name) : ''}</td>
        </tr>`;
    }).join('')}</tbody></table>`)}
      </div>

      <div class="stack">
        ${panel('Board', `
          ${kv([
    ['Expectation', club.board.expectation.label],
    ['Confidence', raw(confidencePill(club.board.confidence))],
    ['League position', pos ? `${pos} of ${league.teams}` : '—'],
    ['Record', row ? `${row.w}W ${row.d}D ${row.l}L` : '—'],
    ['Finances', raw(`<span class="${health.level >= 3 ? 'good' : health.level >= 2 ? '' : 'bad'}">${health.label}</span>`)],
    ['Wage bill', raw(`${money(wage.weekly)}/w <span class="${wage.pct > 1 ? 'bad' : wage.pct > 0.9 ? 'warn' : 'faint'}">(${Math.round(wage.pct * 100)}%)</span>`)],
  ])}`)}

        ${panelTight(league.name, `<table><thead><tr><th>#</th><th>Club</th><th class="num">P</th><th class="num">GD</th><th class="num">Pts</th></tr></thead>
          <tbody>${slice.map((r, i) => {
    const c = world.clubs[r.clubId];
    return `<tr class="${r.clubId === club.id ? 'highlight' : ''} clickable" data-club="${esc(c.id)}">
              <td class="num faint">${from + i + 1}</td><td class="nowrap small">${esc(c.short)}</td>
              <td class="num">${r.p}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td>
              <td class="num"><b>${r.pts}</b></td></tr>`;
  }).join('')}</tbody></table>`, '<button class="sm" data-act="league">Full table</button>')}

        ${(injured.length || suspended.length || offers.length || (club.squad.length > 32)) ? panel('Needs Attention', `
          ${offers.length ? `<div class="row small" style="margin-bottom:6px"><span class="pill warn">Offers</span>
            <span>${offers.length} incoming bid${offers.length > 1 ? 's' : ''} for your players</span>
            <div class="spacer"></div><button class="sm" data-act="transfers">Review</button></div>` : ''}
          ${injured.length ? `<div class="small" style="margin-bottom:4px"><span class="pill bad">Injured</span>
            ${injured.slice(0, 5).map((p) => esc(p.name)).join(', ')}${injured.length > 5 ? ` +${injured.length - 5}` : ''}</div>` : ''}
          ${suspended.length ? `<div class="small" style="margin-bottom:4px"><span class="pill bad">Suspended</span>
            ${suspended.map((p) => esc(p.name)).join(', ')}</div>` : ''}
          ${club.squad.length > 32 ? `<div class="small"><span class="pill warn">Squad</span>
            ${club.squad.length} players — consider moving some on</div>` : ''}
        `) : ''}

        ${panelTight('In Form', topPerformers.length === 0 ? emptyState('No matches played.')
    : `<table><tbody>${topPerformers.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
            <td class="nowrap small">${esc(p.name)}</td>
            <td class="small faint">${esc(p.positions[0])}</td>
            <td class="num small">${p.season.goals}g ${p.season.assists}a</td>
            <td class="num">${ratingCell(p.season.ratingSum / p.season.ratingCount)}</td></tr>`).join('')}</tbody></table>`)}
      </div>
    </div>`,

    mount(root) {
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
      root.querySelectorAll('[data-news]').forEach((el) => {
        el.onclick = () => app.go('inbox', { newsId: el.dataset.news });
      });
      root.querySelectorAll('[data-fixture]').forEach((el) => {
        el.onclick = () => app.go('fixtures', { fixtureId: el.dataset.fixture });
      });
      root.querySelectorAll('[data-club]').forEach((el) => {
        el.onclick = () => app.go('world', { clubId: el.dataset.club });
      });
      const map = { inbox: 'inbox', league: 'league', transfers: 'transfers' };
      root.querySelectorAll('[data-act]').forEach((el) => {
        const target = map[el.dataset.act];
        if (target) el.onclick = (e) => { e.stopPropagation(); app.go(target); };
      });
    },
  };
}

function confidencePill(v) {
  const cls = v >= 70 ? 'good' : v >= 45 ? '' : v >= 25 ? 'warn' : 'bad';
  const label = v >= 85 ? 'Delighted' : v >= 70 ? 'Very happy' : v >= 55 ? 'Happy'
    : v >= 40 ? 'Satisfied' : v >= 25 ? 'Concerned' : v >= 12 ? 'Unhappy' : 'On the brink';
  return `<span class="pill ${cls}">${label}</span>`;
}
