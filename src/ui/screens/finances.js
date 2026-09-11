// Finances: budgets, the season's ledger and wage commitments.

import { esc, panel, panelTight, money, emptyState, kv, raw, shortDate, toast, bar } from '../components.js';
import { userClub } from '../../state/game.js';
import { weeklyWageBill, wageBudgetUsage, financialHealth, adjustBudgets } from '../../engine/finance.js';
import { sortBy, clamp } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('No club.') };
  const f = club.finances;
  const usage = wageBudgetUsage(world, club);
  const health = financialHealth(club);

  const byCategory = new Map();
  for (const entry of f.ledger) {
    byCategory.set(entry.category, (byCategory.get(entry.category) || 0) + entry.amount);
  }
  const categories = sortBy([...byCategory.entries()], { key: (e) => Math.abs(e[1]), desc: true });

  const earners = sortBy(club.squad.map((id) => world.players[id]).filter((p) => p?.contract),
    { key: (p) => p.contract.wage, desc: true }).slice(0, 12);

  return {
    html: `
    <div class="grid c3">
      ${panel('Position', kv([
    ['Balance', raw(`<span class="${f.balance >= 0 ? 'good' : 'bad'}">${money(f.balance)}</span>`)],
    ['Health', raw(`<span class="${health.level >= 3 ? 'good' : health.level >= 2 ? '' : 'bad'}">${health.label}</span>`)],
    ['Projected income', money(f.incomeEstimate)],
    ['Income this season', money(f.seasonIncome)],
    ['Spend this season', money(f.seasonSpend)],
  ]))}
      ${panel('Budgets', `${kv([
    ['Transfer budget', money(f.transferBudget)],
    ['Wage budget', `${money(f.wageBudgetAnnual / 52)}/week`],
    ['Committed', `${money(usage.weekly)}/week`],
    ['Remaining', raw(`<span class="${usage.budgetWeekly - usage.weekly > 0 ? 'good' : 'bad'}">${money(usage.budgetWeekly - usage.weekly)}/week</span>`)],
  ])}
        <div style="margin-top:10px">${bar(usage.pct * 100, usage.pct > 1 ? 'bad' : usage.pct > 0.9 ? 'warn' : '')}
        <div class="faint small">${Math.round(usage.pct * 100)}% of the wage budget used</div></div>`)}
      ${panel('Move Money', `
        <p class="small faint" style="margin-top:0">The board will let you shift funds between budgets, within reason.</p>
        <div class="field"><label>Amount</label><input type="number" id="fin-amount" value="1000000" step="250000" min="0"></div>
        <div class="row" style="gap:8px">
          <button class="sm" data-act="to-wages">Transfers → wages</button>
          <button class="sm" data-act="to-transfers">Wages → transfers</button>
        </div>`)}
    </div>

    <div class="grid c2">
      ${panelTight('Season Summary', categories.length === 0 ? emptyState('No transactions yet.')
    : `<table><thead><tr><th>Category</th><th class="num">Total</th></tr></thead><tbody>
        ${categories.map(([cat, total]) => `<tr><td>${esc(labelFor(cat))}</td>
          <td class="num ${total >= 0 ? 'good' : 'bad'}">${money(total)}</td></tr>`).join('')}
      </tbody></table>`)}
      ${panelTight('Top Earners', `<table><thead><tr><th>Player</th><th class="num">Wage</th><th class="num">Expires</th><th class="num">% of bill</th></tr></thead>
      <tbody>${earners.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
        <td class="nowrap">${esc(p.name)}</td>
        <td class="num">${money(p.contract.wage)}</td>
        <td class="num faint">${p.contract.expiresYear}</td>
        <td class="num faint">${((p.contract.wage / Math.max(1, usage.weekly)) * 100).toFixed(1)}%</td>
      </tr>`).join('')}</tbody></table>`)}
    </div>

    ${panelTight('Ledger', f.ledger.length === 0 ? emptyState('Nothing recorded yet.')
    : `<div class="table-wrap" style="max-height:420px"><table><thead><tr>
        <th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
      <tbody>${[...f.ledger].reverse().map((e) => `<tr>
        <td class="small faint nowrap">${esc(shortDate(e.day, world.year))}</td>
        <td class="small">${esc(e.label)}</td>
        <td class="num ${e.amount >= 0 ? 'good' : 'bad'}">${money(e.amount)}</td></tr>`).join('')}
      </tbody></table></div>`)}`,

    mount(root) {
      const amountEl = root.querySelector('#fin-amount');
      root.querySelector('[data-act="to-wages"]').onclick = () => {
        const moved = adjustBudgets(world, club, Math.max(0, Number(amountEl.value) || 0));
        toast(moved > 0 ? `${money(moved)} moved to the wage budget.` : 'Not enough in the transfer budget.', moved > 0 ? '' : 'warn');
        app.refresh();
      };
      root.querySelector('[data-act="to-transfers"]').onclick = () => {
        const moved = adjustBudgets(world, club, -Math.max(0, Number(amountEl.value) || 0));
        toast(moved < 0 ? `${money(-moved)} moved to the transfer budget.` : 'The wage budget is fully committed.', moved < 0 ? '' : 'warn');
        app.refresh();
      };
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
    },
  };
}

function labelFor(cat) {
  return {
    matchday: 'Matchday income', commercial: 'Sponsorship & commercial', wages: 'Wages',
    transfer: 'Transfers', prize: 'Prize money', upkeep: 'Upkeep',
  }[cat] || cat;
}
