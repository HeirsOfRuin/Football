// End-of-season summary shown between campaigns.

import { esc, openModal, money, badge, panelTight, emptyState } from '../components.js';
import { userClub, sortTable } from '../../state/game.js';
import { squadStrength } from '../../gen/worldgen.js';
import { sortBy } from '../../core/util.js';
import { currentAbility } from '../../data/attributes.js';

export function showSeasonReview(app, summary, onContinue) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  const league = club ? world.leagues.find((l) => l.id === club.leagueId) : null;
  const table = league ? sortTable(league.table) : [];
  const pos = club ? table.findIndex((r) => r.clubId === club.id) + 1 : 0;
  const row = table[pos - 1];

  const squad = club ? club.squad.map((id) => world.players[id]).filter(Boolean) : [];
  const topScorer = sortBy(squad, { key: (p) => p.season.goals, desc: true })[0];
  const bestRated = sortBy(squad.filter((p) => p.season.ratingCount >= 10),
    { key: (p) => p.season.ratingSum / p.season.ratingCount, desc: true })[0];

  const trophies = game.manager.trophies.filter((t) => t.season === game.season);

  openModal({
    title: `End of season — ${world.year}/${String(world.year + 1).slice(2)}`,
    body: `
      ${club ? `<div class="row" style="gap:14px;margin-bottom:14px">${badge(club, 44)}
        <div><div style="font-size:19px;font-weight:600">${esc(club.name)}</div>
        <div class="muted">${esc(league?.name || '')} — finished ${pos}${row ? ` with ${row.pts} points (${row.w}W ${row.d}D ${row.l}L)` : ''}</div></div>
      </div>` : ''}

      <p style="font-size:15px">${esc(summary.userVerdict?.text || '')}</p>

      ${trophies.length ? `<p class="good"><b>Silverware:</b> ${trophies.map((t) => esc(t.name)).join(', ')}</p>` : ''}

      <div class="grid c2">
        ${panelTight('Your Season', `<table><tbody>
          ${topScorer ? `<tr><td class="small faint">Top scorer</td><td>${esc(topScorer.name)} (${topScorer.season.goals})</td></tr>` : ''}
          ${bestRated ? `<tr><td class="small faint">Best average rating</td><td>${esc(bestRated.name)} (${(bestRated.season.ratingSum / bestRated.season.ratingCount).toFixed(2)})</td></tr>` : ''}
          ${club ? `<tr><td class="small faint">Balance</td><td>${money(club.finances.balance)}</td></tr>
          <tr><td class="small faint">Income</td><td>${money(club.finances.seasonIncome)}</td></tr>
          <tr><td class="small faint">Spend</td><td>${money(club.finances.seasonSpend)}</td></tr>
          <tr><td class="small faint">Board confidence</td><td>${Math.round(club.board.confidence)}%</td></tr>` : ''}
        </tbody></table>`)}
        ${panelTight('Champions', summary.champions.length === 0 ? emptyState('None')
    : `<div class="scroll-y" style="max-height:220px"><table><tbody>${summary.champions.map((c) => `<tr>
        <td class="small faint">${esc(c.league)}</td><td class="small">${esc(world.clubs[c.clubId]?.name || '')}</td></tr>`).join('')}
      </tbody></table></div>`)}
      </div>

      <div class="grid c2">
        ${panelTight('Promoted', summary.promoted.length === 0 ? emptyState('None')
    : `<div class="scroll-y" style="max-height:180px"><table><tbody>${summary.promoted.map((p) => `<tr>
        <td class="small">${esc(world.clubs[p.clubId]?.name || '')}</td><td class="small faint">→ ${esc(p.to)}</td></tr>`).join('')}
      </tbody></table></div>`)}
        ${panelTight('Relegated', summary.relegated.length === 0 ? emptyState('None')
    : `<div class="scroll-y" style="max-height:180px"><table><tbody>${summary.relegated.map((p) => `<tr>
        <td class="small">${esc(world.clubs[p.clubId]?.name || '')}</td><td class="small faint">→ ${esc(p.to)}</td></tr>`).join('')}
      </tbody></table></div>`)}
      </div>`,
    wide: true,
    footer: '<button class="primary" data-act="next">Start next season</button>',
    onMount(modal, close) {
      modal.querySelector('[data-act="next"]').onclick = () => { close(); onContinue(); };
    },
  });
}


/** Told the board has let you go. */
export function showSackNotice(app, clubName, onContinue) {
  openModal({
    title: 'Dismissed',
    narrow: true,
    body: `<p style="font-size:15px">${esc(clubName)} have relieved you of your duties.</p>
      <p class="muted">The board set an expectation at the start of the season and concluded you were not going to meet it.
      Your record follows you: your reputation determines which clubs will consider you next.</p>
      <p class="small faint">Manager reputation: ${Math.round(app.game.manager.reputation)}</p>`,
    footer: '<button class="primary" data-act="jobs">Look for work</button>',
    onMount(modal, close) {
      modal.querySelector('[data-act="jobs"]').onclick = () => { close(); onContinue(); };
    },
  });
}

/** Pick a new club from those willing to consider you. */
export function showJobMarket(app, jobs, onTake) {
  const world = app.game.world;
  openModal({
    title: 'Vacancies',
    wide: true,
    body: jobs.length === 0
      ? '<p>No club will consider you at present. Your career is over — for this save at least.</p>'
      : `<p class="small faint" style="margin-top:0">Clubs within reach of a manager of your standing. Taking a lower job and
         succeeding is the way back up.</p>
      <div class="scroll-y" style="max-height:440px"><table><thead><tr>
        <th></th><th>Club</th><th>Division</th><th class="num">Reputation</th><th class="num">Squad</th>
        <th class="num">Transfer budget</th><th>Expectation</th><th></th></tr></thead><tbody>
      ${jobs.map((j) => `<tr>
        <td>${badge(j.club, 20)}</td>
        <td class="nowrap">${esc(j.club.name)}</td>
        <td class="small faint">${esc(j.league.name)}</td>
        <td class="num">${j.club.rep}</td>
        <td class="num">${Math.round(squadStrength(world, j.club))}</td>
        <td class="num">${money(j.club.finances.transferBudget)}</td>
        <td class="small">${esc(j.club.board.expectation.label)}</td>
        <td><button class="sm primary" data-take="${esc(j.club.id)}">Accept</button></td>
      </tr>`).join('')}</tbody></table></div>`,
    footer: '<button data-act="menu">Retire to the main menu</button>',
    onMount(modal, close) {
      modal.querySelectorAll('[data-take]').forEach((b) => {
        b.onclick = () => { close(); onTake(b.dataset.take); };
      });
      modal.querySelector('[data-act="menu"]').onclick = () => { close(); app.go('menu'); };
    },
  });
}
