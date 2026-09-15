// End-of-season summary shown between campaigns.

import { esc, openModal, money, badge, panelTight, emptyState, kv } from '../components.js';
import { INTERVIEW_QUESTIONS, interviewOutcome, ambitionShift, defaultAnswers } from '../../data/interview.js';
import { userClub, sortTable, availableJobs } from '../../state/game.js';
import { squadStrength } from '../../gen/worldgen.js';
import { sortBy } from '../../core/util.js';

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

      ${club ? objectiveVerdicts(club) : ''}

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


/**
 * How the three objectives were judged.
 *
 * This is the moment the board's asks are settled, so it is the one screen that
 * has to show them. Without it the season review reports a single sentence of
 * verdict and the manager never learns which of the three he missed.
 */
function objectiveVerdicts(club) {
  const objectives = (club.board.objectives || []).filter((o) => o && o.met !== null);
  if (!objectives.length) return '';
  const met = objectives.filter((o) => o.met).length;
  return `${panelTight(`Board objectives — ${met} of ${objectives.length} met`,
    `<table><tbody>${objectives.map((o) => `<tr>
      <td class="small">${esc(o.label)}</td>
      <td class="small faint right">${esc(o.detail || '')}</td>
      <td class="right nowrap"><span class="${o.met ? 'good' : 'bad'}">${o.met ? 'met' : 'missed'}</span></td>
    </tr>`).join('')}</tbody></table>`)}`;
}

/** Told the board has let you go. */
export function showSackNotice(app, clubName, onContinue, payoff = 0) {
  openModal({
    title: 'Dismissed',
    narrow: true,
    body: `<p style="font-size:15px">${esc(clubName)} have relieved you of your duties.</p>
      <p class="muted">The board set three objectives at the start of the season and concluded you were not going to meet enough of them.
      Your record follows you: your reputation determines which clubs will consider you next.</p>
      ${payoff > 0 ? `<p class="small">Your contract had time left to run. The club settled it at <b>${money(payoff)}</b>.</p>` : ''}
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
      ? `<p>No club is looking for a manager at the moment, at least not one of your standing.</p>
         <p class="small faint">Posts come open through the season as boards lose patience, and a fresh batch
           every summer. Keep going and something will turn up.</p>`
      : `<p class="small faint" style="margin-top:0">Posts that are actually going, within reach of a manager of your
         standing. Taking a lower job and succeeding is the way back up.</p>
      <div class="scroll-y" style="max-height:440px"><table><thead><tr>
        <th></th><th>Club</th><th>Division</th><th class="num">Reputation</th><th class="num">Squad</th>
        <th class="num">Transfer budget</th><th>Why it is open</th><th></th></tr></thead><tbody>
      ${jobs.map((j) => `<tr>
        <td>${badge(j.club, 20)}</td>
        <td class="nowrap">${esc(j.club.name)}</td>
        <td class="small faint">${esc(j.league.name)}</td>
        <td class="num">${j.club.rep}</td>
        <td class="num">${Math.round(squadStrength(world, j.club))}</td>
        <td class="num">${money(j.club.finances.transferBudget)}</td>
        <td class="small faint">${esc(j.vacancy?.reason || 'The post is open.')}</td>
        <td><button class="sm primary" data-take="${esc(j.club.id)}">Interview</button></td>
      </tr>`).join('')}</tbody></table></div>`,
    footer: '<button data-act="menu">Retire to the main menu</button>',
    onMount(modal, close) {
      modal.querySelectorAll('[data-take]').forEach((b) => {
        const job = jobs.find((j) => j.club.id === b.dataset.take);
        b.onclick = () => { close(); showInterview(app, job, onTake); };
      });
      modal.querySelector('[data-act="menu"]').onclick = () => { close(); app.go('menu'); };
    },
  });
}

/**
 * The interview.
 *
 * Accepting a job used to be one click, after which the board handed you a
 * remit and a budget you had no say in — `wantsAttacking` and `wantsYouth` were
 * set at world generation and never written again, so what you would be judged
 * on was decided before you walked in. Each answer here moves something real,
 * and the panel underneath shows what, from the same function that applies it.
 */
export function showInterview(app, job, onTake) {
  const club = job.club;
  const answers = defaultAnswers();

  const consequences = () => {
    const out = interviewOutcome(answers);
    const budget = Math.round(club.finances.transferBudget * out.budgetMultiplier);
    const shift = ambitionShift(out.ambition);
    const rows = [
      ['Transfer budget', `${money(club.finances.transferBudget)} → ${money(budget)}`],
      ['Style objective', out.wantsAttacking ? 'They will want goals' : 'None'],
      ['Youth objective', out.wantsYouth ? 'Three young players given regular football' : 'None'],
      ['Board patience', out.patienceDelta === 0 ? 'As it stands'
        : `${out.patienceDelta > 0 ? 'More' : 'Less'} than usual (${out.patienceDelta > 0 ? '+' : ''}${out.patienceDelta})`],
      ['League finish they will want', shift === 0 ? 'As it stands'
        : shift < 0 ? `${Math.abs(shift)} place${Math.abs(shift) === 1 ? '' : 's'} higher than last season`
          : `${shift} place${shift === 1 ? '' : 's'} lower than last season`],
    ];
    return kv(rows);
  };

  const render = () => {
    openModal({
      title: `Interview — ${club.name}`,
      wide: true,
      body: `
        <div class="row" style="gap:14px;margin-bottom:12px">${badge(club, 44)}
          <div><div style="font-size:18px;font-weight:600">${esc(club.name)}</div>
          <div class="muted">${esc(job.league.name)} — ${esc(job.vacancy?.reason || 'the post is open')}</div></div>
        </div>
        ${INTERVIEW_QUESTIONS.map((q) => `
          ${panelTight(q.question, `<div class="stack">${q.answers.map((a) => `
            <label class="row" style="gap:8px;align-items:flex-start;padding:6px 0;cursor:pointer">
              <input type="radio" name="q-${esc(q.id)}" value="${esc(a.id)}" ${answers[q.id] === a.id ? 'checked' : ''}>
              <span><span>${esc(a.label)}</span><div class="small faint">${esc(a.detail)}</div></span>
            </label>`).join('')}</div>`)}`).join('')}
        ${panelTight('What that commits you to', `<div id="iv-out">${consequences()}</div>`)}`,
      footer: `<button data-act="back">Look at other jobs</button>
        <button class="primary" data-act="accept">Take the job</button>`,
      onMount(modal, close) {
        modal.querySelectorAll('input[type=radio]').forEach((el) => {
          el.onchange = () => {
            answers[el.name.slice(2)] = el.value;
            modal.querySelector('#iv-out').innerHTML = consequences();
          };
        });
        modal.querySelector('[data-act="back"]').onclick = () => {
          close();
          showJobMarket(app, availableJobs(app.game), onTake);
        };
        modal.querySelector('[data-act="accept"]').onclick = () => {
          close();
          onTake(club.id, answers);
        };
      },
    });
  };
  render();
}
