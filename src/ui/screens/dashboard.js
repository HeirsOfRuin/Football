// Home: what is next, what needs you, and the button that moves the season on.
//
// This screen used to be a report. Measured at 390x844 mid-season it opened with
// seven panels, sixteen table rows and 109 separate numbers, and the Continue
// button sat above nearly three screens of scroll - all of it true, none of it
// telling you what to do about any of it. The first screen of a management game
// is the one place that has to answer "what needs me", so that is now what it
// is: the fixture, a list of decisions each with the screen that settles it, and
// where you stand. Everything that was here before is still here, folded.

import {
  esc, panel, panelTight, badge, money, formRun, emptyState, kv, raw, shortDate,
  ratingCell, fold, hint,
} from '../components.js';
import { userClub, nextFixtureFor, clubFixtures, sortTable } from '../../state/game.js';
import { squadStrength } from '../../gen/worldgen.js';
import { sortBy, ordinal } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';
import { wageBudgetUsage, financialHealth } from '../../engine/finance.js';
import { attentionItems } from '../attention.js';
import { rivalryBetween } from '../../engine/rivalry.js';

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
  const wage = wageBudgetUsage(world, club);
  const health = financialHealth(club);
  const todo = attentionItems(app);
  const rivalry = next ? rivalryBetween(world, next.homeId, next.awayId) : null;

  const topPerformers = sortBy(squad.filter((p) => p.season.ratingCount >= 3),
    { key: (p) => p.season.ratingSum / p.season.ratingCount, desc: true }).slice(0, 5);

  /** Where both sides stand, under the last-six form. */
  const seasonLine = (a, b, tbl) => {
    const side = (c) => {
      const i = tbl.findIndex((r) => r.clubId === c.id);
      const rec = c.seasonRecord || { w: 0, d: 0, l: 0 };
      const games = rec.w + rec.d + rec.l;
      // The opponent may be in another division - a cup tie - and then a position
      // in this table would be someone else's number.
      const place = i >= 0 ? `${ordinal(i + 1)} of ${tbl.length}` : 'another division';
      return `<b>${esc(c.short)}</b> ${place}${games
        ? ` · ${rec.w}W ${rec.d}D ${rec.l}L${i >= 0 ? ` · ${tbl[i].pts} pts` : ''}` : ' · no games yet'}`;
    };
    return `<div class="row small next-match-meta" style="margin-top:6px;justify-content:space-between;gap:12px">
      <span>${side(a)}</span><span class="right">${side(b)}</span>
    </div>`;
  };

  // A slice of the table centred on the user's club.
  const from = Math.max(0, Math.min(pos - 3, table.length - 6));
  const slice = table.slice(from, from + 6);

  return {
    html: `
    ${hint(app, 'dashboard', 'Everything that needs a decision is listed under the fixture, '
      + 'with the screen that settles it. Continue moves the calendar to the next thing that wants you.')}
    <div class="grid c2-1">
      <div class="stack">
        ${next && opponent ? panel('Next Match', `
          <div class="next-match">
            <div class="nm-side">${badge(club, 40)}
              <div style="min-width:0"><div class="nm-name">${esc(club.short)}</div>
                <div class="faint small">${formRun(club.form)}</div></div></div>
            <div class="nm-mid">
              <div class="mono muted">${esc(next.homeId === club.id ? 'HOME' : 'AWAY')}</div>
              <div class="small faint">${esc(shortDate(next.day, world.year))}</div>
            </div>
            <div class="nm-side nm-away">
              <div style="min-width:0"><div class="nm-name">${esc(opponent.short)}</div>
                <div class="faint small">${formRun(opponent.form)}</div></div>
              ${badge(opponent, 40)}</div>
          </div>
          <div class="small faint center" style="margin-top:8px">${esc(next.compName)} · ${esc(String(next.round))}</div>
          ${rivalry ? `<div class="derby-line">${esc(derbyBlurb(rivalry, opponent))}</div>` : ''}
          ${seasonLine(club, opponent, table)}
          ${fold('home-matchmeta', 'Before the match', `${kv([
    ['Squad strength', `${Math.round(squadStrength(world, club))} v ${Math.round(squadStrength(world, opponent))}`],
    ['Ground', `${opponent.stadium.name} · ${opponent.stadium.capacity.toLocaleString()}`],
    ['Competition', `${next.compName} — ${next.round}`],
  ])}`)}`) : panel('Next Match', emptyState('No fixtures scheduled. The season has no more games for you.'))}

        ${panelTight('Needs You', todo.length === 0
    ? '<div class="empty good">Nothing is waiting on you. Press Continue.</div>'
    : `<div class="todo">${todo.map((t) => `<div class="todo-row">
            <span class="pill ${t.cls}">${esc(t.pill)}</span>
            <span class="what">${esc(t.what)}</span>
            <button class="sm" data-go="${esc(t.go)}">${esc(t.label)}</button>
          </div>`).join('')}</div>`)}

        ${panelTight(league.name, `<table><thead><tr><th>#</th><th>Club</th><th class="num">P</th><th class="num">GD</th><th class="num">Pts</th></tr></thead>
          <tbody>${slice.map((r, i) => {
    const c = world.clubs[r.clubId];
    return `<tr class="${r.clubId === club.id ? 'highlight' : ''} clickable" data-club="${esc(c.id)}">
              <td class="num faint">${from + i + 1}</td><td class="nowrap small">${esc(c.short)}</td>
              <td class="num">${r.p}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td>
              <td class="num"><b>${r.pts}</b></td></tr>`;
  }).join('')}</tbody></table>`, '<button class="sm" data-go="league">Full table</button>')}
      </div>

      <div class="stack">
        ${panel('Where You Stand', kv([
    ['Board', raw(confidencePill(club.board.confidence))],
    ['Expectation', club.board.expectation.label],
    ['League', pos ? `${ordinal(pos)} of ${league.teams}` : '—'],
    ['Record', row ? `${row.w}W ${row.d}D ${row.l}L` : '—'],
  ]) + fold('home-standing', 'Money and wages', kv([
    ['Finances', raw(`<span class="${health.level >= 3 ? 'good' : health.level >= 2 ? '' : 'bad'}">${health.label}</span>`)],
    ['Balance', money(club.finances.balance)],
    ['Transfer budget', money(club.finances.transferBudget)],
    ['Wage bill', raw(`${money(wage.weekly)}/w <span class="${wage.pct > 1 ? 'bad' : wage.pct > 0.9 ? 'warn' : 'faint'}">(${Math.round(wage.pct * 100)}% of budget)</span>`)],
  ])))}

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
          <td class="right nowrap small">${esc(home.short)}</td>
          <td class="center mono ${cls}" style="width:52px">${f.result.homeGoals}-${f.result.awayGoals}</td>
          <td class="nowrap small">${esc(away.short)}</td>
        </tr>`;
    }).join('')}</tbody></table>`)}

        ${fold('home-inform', 'In form', topPerformers.length === 0 ? emptyState('No matches played.')
    : `<table><tbody>${topPerformers.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
            <td class="nowrap small">${esc(p.name)}</td>
            <td class="small faint">${esc(p.positions[0])}</td>
            <td class="num small">${p.season.goals}g ${p.season.assists}a</td>
            <td class="num">${ratingCell(p.season.ratingSum / p.season.ratingCount)}</td></tr>`).join('')}</tbody></table>`,
    { note: 'your best five this season' })}
      </div>
    </div>`,

    mount(root) {
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
      root.querySelectorAll('[data-fixture]').forEach((el) => {
        el.onclick = () => app.go('fixtures', { fixtureId: el.dataset.fixture });
      });
      root.querySelectorAll('[data-club]').forEach((el) => {
        el.onclick = () => app.go('world', { clubId: el.dataset.club });
      });
      // One handler for every "take me to the screen that fixes this" button,
      // rather than a map of action names that has to be kept in step with them.
      root.querySelectorAll('[data-go]').forEach((el) => {
        el.onclick = (e) => { e.stopPropagation(); app.go(el.dataset.go); };
      });
    },
  };
}

/**
 * Why this one is different, in a sentence.
 *
 * "Derby" as a bare label would be the thing this project keeps catching
 * itself doing: a word on a screen with nothing behind it. This says what it
 * costs - the ground will be full, and the match will be a nastier one.
 */
function derbyBlurb(r, opponent) {
  const temperature = r.heat >= 80 ? 'There will not be a seat left, and it will not be a friendly afternoon.'
    : r.heat >= 55 ? 'A bigger crowd than usual, and a shorter fuse.'
      : 'Not the biggest day in the calendar, but neither side wants to lose it.';
  const why = r.kind === 'city' ? `${opponent.short} share this city.`
    : r.kind === 'historic' ? `${opponent.short} are the other big club in the country.`
      : `${opponent.short} finish near you every year.`;
  return `${why} ${temperature}`;
}

function confidencePill(v) {
  const cls = v >= 70 ? 'good' : v >= 45 ? '' : v >= 25 ? 'warn' : 'bad';
  const label = v >= 85 ? 'Delighted' : v >= 70 ? 'Very happy' : v >= 55 ? 'Happy'
    : v >= 40 ? 'Satisfied' : v >= 25 ? 'Concerned' : v >= 12 ? 'Unhappy' : 'On the brink';
  return `<span class="pill ${cls}">${label}</span>`;
}
