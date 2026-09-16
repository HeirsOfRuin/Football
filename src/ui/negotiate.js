// Transfer talks, personal terms and contract renewals.
//
// The old version of this file was a form with a Make Offer button that re-ran
// a pure acceptance function on every click. Since nothing remembered what you
// had already said, the honest way to play it was to nudge the number and click
// again until it passed. This is the same screen rebuilt around a negotiation
// that has a position, a temper and a limit.

import { esc, openModal, money, toast, kv, raw, bar } from './components.js';
import { currentAbility } from '../data/attributes.js';
import {
  marketValue, askingPrice, evaluateContract, contractDemand,
  completeTransfer, renewContract, completeLoan,
} from '../engine/transfers.js';
import {
  openTransferTalks, transferOffer, termsOffer, abandonTalks,
  cashEquivalent, termsEquivalent, canOpenTalks, willTakeInSwap, swapValue,
  SWAP_DISCOUNT, openLoanTalks, loanOffer, loanEquivalent, LOAN_WAGE_SHARES,
} from '../engine/negotiation.js';
import { weeklyWageBill } from '../engine/finance.js';
import { transferWindowOpen } from '../core/calendar.js';
import { expectedRole, ROLE_LABELS } from '../engine/training.js';
import { news } from '../engine/news.js';

const ROLE_OPTIONS = [
  { id: 'key', label: 'Key player' },
  { id: 'rotation', label: 'Regular starter' },
  { id: 'squad', label: 'Squad rotation' },
  { id: 'fringe', label: 'Back-up' },
];

const TONE_CLASS = { good: 'good', bad: 'bad', warn: 'warn', neutral: 'faint' };

/** How willing they still are, as something you can see before it runs out. */
function patienceBar(neg) {
  const isFee = neg.phase === 'fee';
  const left = isFee ? neg.patience : neg.termsPatience;
  const max = isFee ? neg.maxPatience : (neg.maxTermsPatience || 3);
  const pct = Math.max(0, Math.min(100, (left / Math.max(1, max)) * 100));
  const label = left <= 1 ? 'about to walk away' : left <= 2 ? 'losing patience' : 'willing to talk';
  return `<div class="row" style="gap:8px;align-items:center">
    <span class="small faint" style="min-width:74px">Their mood</span>
    ${bar(pct, pct <= 34 ? 'bad' : pct <= 67 ? 'warn' : '')}
    <span class="small ${pct <= 34 ? 'bad' : 'faint'}">${esc(label)}</span>
  </div>`;
}

function logHtml(neg) {
  if (!neg.log.length) return '';
  return `<div class="scroll-y" style="max-height:132px;margin-top:10px"><table><tbody>${
    [...neg.log].reverse().map((e) => `<tr>
      <td class="small faint nowrap" style="width:58px">Round ${e.round}</td>
      <td class="small ${TONE_CLASS[e.tone] || ''}">${esc(e.text)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/**
 * Open talks for a player, and keep the window open across rounds.
 *
 * The dialog re-renders itself after every offer rather than closing, because
 * the negotiation is the thing being played - closing after each round would
 * hide the one piece of information that makes it a negotiation, which is what
 * they said last time.
 */
export function showBidDialog(app, player) {
  const game = app.game;
  const world = game.world;
  const club = world.clubs[game.userClubId];
  if (!club) return;
  if (!transferWindowOpen(game.day)) {
    toast('The transfer window is closed.', 'warn');
    return;
  }
  const gate = canOpenTalks(game, player, club.id);
  if (!gate.ok) {
    toast(gate.reason, 'warn');
    return;
  }
  const opened = openTransferTalks(game, player, club);
  if (opened.error) {
    toast(opened.error, 'warn');
    return;
  }
  renderNegotiation(app, opened.negotiation);
}

function renderNegotiation(app, neg) {
  const game = app.game;
  const world = game.world;
  const club = world.clubs[neg.buyerId];
  const player = world.players[neg.playerId];
  const seller = neg.sellerId ? world.clubs[neg.sellerId] : null;
  const wageRoom = club.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, club);

  if (neg.status === 'agreed' && neg.terms) {
    showCompletion(app, neg);
    return;
  }

  const feePhase = neg.phase === 'fee';
  // Seed the controls from the last thing you said, so a round is an
  // adjustment rather than starting over.
  const last = neg.draft || {};
  const startFee = last.fee ?? neg.openingAsk ?? 0;

  openModal({
    title: `${feePhase ? 'Talks with' : 'Personal terms —'} ${feePhase ? esc(seller?.name || '') : esc(player.name)}`,
    body: `
      <div class="grid c2">
        <section class="panel"><div class="panel-head"><h2>${esc(player.name)}</h2></div><div class="panel-body">
          ${kv([
    ['Position', `${player.positions.join('/')}, ${player.age}`],
    ['Ability', String(currentAbility(player))],
    ['Current club', seller ? seller.name : 'Free agent'],
    ['Market value', money(marketValue(world, player))],
    ['Their opening ask', seller ? money(neg.openingAsk) : 'Free transfer'],
  ])}
        </div></section>
        <section class="panel"><div class="panel-head"><h2>Your Position</h2></div><div class="panel-body">
          ${kv([
    ['Transfer budget', money(club.finances.transferBudget)],
    ['Wage room', raw(`<span class="${wageRoom > 0 ? 'good' : 'bad'}">${money(wageRoom)}/week</span>`)],
    ['Squad size', String(club.squad.length)],
    ['Round', String(neg.round)],
  ])}
          ${patienceBar(neg)}
        </div></section>
      </div>

      ${logHtml(neg)}

      ${feePhase ? feeControls(world, neg, startFee, club) : termsControls(neg, player, last)}

      <div id="neg-read" class="small faint" style="margin-top:8px"></div>
      <div id="neg-feedback" class="small" style="margin-top:6px"></div>`,
    footer: `<button data-act="walk" class="danger">Break off talks</button>
      <button data-close>Leave it for now</button>
      <button class="primary" data-act="offer">${feePhase ? 'Make the offer' : 'Offer these terms'}</button>`,
    onMount(modal, close) {
      const read = modal.querySelector('#neg-read');
      const feedback = modal.querySelector('#neg-feedback');

      const collect = () => {
        const num = (id, fallback = 0) => {
          const el = modal.querySelector(id);
          return el ? Math.max(0, Number(el.value) || 0) : fallback;
        };
        if (feePhase) {
          return {
            fee: num('#neg-fee'),
            sellOn: num('#neg-sellon'),
            instalments: Number(modal.querySelector('#neg-instalments')?.value || 1),
            swap: [...modal.querySelectorAll('.neg-swap:checked')].map((el) => el.value),
          };
        }
        return {
          wage: num('#neg-wage'),
          years: Number(modal.querySelector('#neg-years').value),
          promisedRole: modal.querySelector('#neg-role').value,
          signingBonus: num('#neg-bonus'),
          releaseClause: num('#neg-clause'),
          appearanceFee: num('#neg-appear'),
          goalBonus: num('#neg-goal'),
        };
      };

      // The number shown here is the number the engine will judge, from the same
      // function — not a second estimate that can drift away from it.
      const refresh = () => {
        const offer = collect();
        neg.draft = offer;
        if (feePhase) {
          const eq = cashEquivalent(world, player, offer);
          const swap = swapValue(world, offer.swap);
          read.innerHTML = `They will read that as <b class="mono">${money(eq)}</b>`
            + `${swap ? `, of which ${money(swap)} is the ${offer.swap.length} player${offer.swap.length === 1 ? '' : 's'} you are offering` : ' in hand'}.`;
        } else {
          const eq = termsEquivalent(player, offer);
          // Broken out, because a bonus worth two thousand a week against a
          // hundred-and-thirty-thousand wage disappears into the rounding and
          // reads as though it did nothing.
          const extras = eq - termsEquivalent(player, { wage: offer.wage, years: offer.years });
          read.innerHTML = `He will read the package as <b class="mono">${money(eq)}</b> a week`
            + (extras > 0 ? `, of which <b class="mono">${money(extras)}</b> is the bonuses and clauses` : '')
            + '.';
        }
      };
      modal.querySelectorAll('input, select').forEach((el) => { el.oninput = refresh; el.onchange = refresh; });
      const feeInput = modal.querySelector('#neg-fee');
      const feeRange = modal.querySelector('#neg-fee-range');
      if (feeInput && feeRange) {
        feeInput.oninput = () => { feeRange.value = feeInput.value; refresh(); };
        feeRange.oninput = () => { feeInput.value = feeRange.value; refresh(); };
      }
      refresh();

      modal.querySelector('[data-act="walk"]').onclick = () => {
        abandonTalks(game, neg);
        close();
        app.refresh();
        toast('You have walked away from the table.');
      };

      modal.querySelector('[data-act="offer"]').onclick = () => {
        const offer = collect();
        if (feePhase) {
          if (offer.fee > club.finances.transferBudget) {
            feedback.innerHTML = `<span class="bad">That is beyond your transfer budget of ${money(club.finances.transferBudget)}.</span>`;
            return;
          }
        } else if (offer.wage > wageRoom) {
          feedback.innerHTML = `<span class="bad">Those wages break your budget. You have ${money(wageRoom)}/week to play with.</span>`;
          return;
        }
        const result = feePhase ? transferOffer(game, neg, offer) : termsOffer(game, neg, offer);
        close();
        if (result.outcome === 'collapsed') {
          app.refresh();
          toast(result.text, 'warn');
          return;
        }
        // Straight back in, on the new state, so the round just played is
        // visible in the log above the controls.
        renderNegotiation(app, neg);
      };
    },
  });
}

function feeControls(world, neg, startFee, club) {
  const max = Math.max(neg.openingAsk * 2, 1000000);
  const seller = world.clubs[neg.sellerId];
  const chosen = new Set(neg.draft?.swap || []);
  // Only players they would actually take. Listing the whole squad and then
  // refusing most of it at the point of offer is the kind of screen that reads
  // as broken; the reasons are shown instead.
  const offerable = club.squad.map((id) => world.players[id]).filter(Boolean)
    .map((p) => ({ p, verdict: willTakeInSwap(world, seller, p) }))
    .sort((a, b) => Number(b.verdict.ok) - Number(a.verdict.ok) || marketValue(world, b.p) - marketValue(world, a.p))
    .slice(0, 14);

  return `
    <div class="field" style="margin-top:12px"><label>Transfer fee</label>
      <input type="number" id="neg-fee" value="${Math.round(startFee)}" step="50000" min="0">
      <input type="range" id="neg-fee-range" min="0" max="${Math.round(max)}" step="50000" value="${Math.round(startFee)}" style="width:100%;margin-top:6px">
    </div>
    <div class="field-row">
      <div class="field"><label>Sell-on clause</label>
        <select id="neg-sellon">${[0, 5, 10, 15, 20, 25, 30].map((v) => `<option value="${v}" ${v === (neg.draft?.sellOn ?? 0) ? 'selected' : ''}>${v}%</option>`).join('')}</select></div>
      <div class="field"><label>Paid over</label>
        <select id="neg-instalments">${[1, 2, 3, 4].map((v) => `<option value="${v}" ${v === (neg.draft?.instalments ?? 1) ? 'selected' : ''}>${v} year${v > 1 ? 's' : ''}</option>`).join('')}</select></div>
    </div>
    <details class="field" ${chosen.size ? 'open' : ''}><summary class="small">Offer players in part-exchange${chosen.size ? ` (${chosen.size})` : ''}</summary>
      <div class="scroll-y" style="max-height:170px;margin-top:8px"><table><tbody>${offerable.map(({ p, verdict }) => `<tr>
        <td style="width:24px"><input type="checkbox" class="neg-swap" value="${esc(p.id)}"
          ${chosen.has(p.id) ? 'checked' : ''} ${verdict.ok ? '' : 'disabled'}></td>
        <td class="small">${esc(p.name)} <span class="faint">${esc(p.positions.join('/'))}, ${p.age}</span>
          ${verdict.ok ? '' : `<div class="small faint">${esc(verdict.reason)}</div>`}</td>
        <td class="small num">${money(marketValue(world, p))}</td>
        <td class="small num ${verdict.ok ? 'good' : 'faint'}">${verdict.ok ? money(Math.round(marketValue(world, p) * SWAP_DISCOUNT)) : '—'}</td>
      </tr>`).join('')}</tbody></table></div>
      <p class="small faint" style="margin:6px 0 0">They take a player in part-exchange at
        ${Math.round(SWAP_DISCOUNT * 100)}% of his value — they did not ask for him, and they pick up his wages.</p>
    </details>
    <p class="small faint" style="margin-bottom:0">A sell-on clause buys a lower fee because they share in the next sale.
      Instalments keep cash in your pocket, but they want the money now, so the total goes up.</p>`;
}

function termsControls(neg, player, last) {
  return `
    <div class="field-row" style="margin-top:12px">
      <div class="field"><label>Weekly wage</label>
        <input type="number" id="neg-wage" value="${Math.round(last.wage ?? neg.demandWage)}" step="100" min="0"></div>
      <div class="field"><label>Contract length</label><select id="neg-years">
        ${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === (last.years ?? neg.demandYears) ? 'selected' : ''}>${y} year${y > 1 ? 's' : ''}</option>`).join('')}
      </select></div>
      <div class="field"><label>Promised role</label><select id="neg-role">
        ${ROLE_OPTIONS.map((r) => `<option value="${r.id}" ${r.id === (last.promisedRole || 'rotation') ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
      </select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Signing-on fee</label>
        <input type="number" id="neg-bonus" value="${Math.round(last.signingBonus ?? 0)}" step="50000" min="0"></div>
      <div class="field"><label>Release clause (0 for none)</label>
        <input type="number" id="neg-clause" value="${Math.round(last.releaseClause ?? 0)}" step="500000" min="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Appearance fee</label>
        <input type="number" id="neg-appear" value="${Math.round(last.appearanceFee ?? 0)}" step="500" min="0"></div>
      <div class="field"><label>Goal bonus</label>
        <input type="number" id="neg-goal" value="${Math.round(last.goalBonus ?? 0)}" step="500" min="0"></div>
    </div>
    <p class="small faint" style="margin-bottom:0">He wants ${money(neg.demandWage)} a week${neg.wantsClause
    ? ', and a release clause matters to him' : ''}. A signing-on fee, an appearance fee and a goal bonus
      all count toward the package, so each can buy a lower weekly wage — and the last two only cost you
      when he plays and scores.</p>`;
}

/** The deal is done on both sides — show it, then sign it. */
function showCompletion(app, neg) {
  const game = app.game;
  const world = game.world;
  const club = world.clubs[neg.buyerId];
  const player = world.players[neg.playerId];
  const seller = neg.sellerId ? world.clubs[neg.sellerId] : null;
  const fee = neg.agreed?.fee ?? 0;
  const t = neg.terms;

  openModal({
    title: `Sign ${player.name}`,
    narrow: true,
    body: `${kv([
    ['From', seller ? seller.name : 'Free agent'],
    ['Fee', fee > 0 ? money(fee) : 'Free transfer'],
    ['Sell-on', neg.agreed?.sellOn ? `${neg.agreed.sellOn}%` : 'None'],
    ['Paid over', neg.agreed?.instalments > 1 ? `${neg.agreed.instalments} years` : 'In full'],
    ['In part-exchange', (neg.agreed?.swap || []).length
      ? neg.agreed.swap.map((id) => world.players[id]?.name).filter(Boolean).join(', ') : 'Nobody'],
    ['Wage', `${money(t.wage)}/week for ${t.years} year${t.years > 1 ? 's' : ''}`],
    ['Signing-on fee', t.signingBonus ? money(t.signingBonus) : 'None'],
    ['Release clause', t.releaseClause ? money(t.releaseClause) : 'None'],
    ['Appearance fee', t.appearanceFee ? `${money(t.appearanceFee)} a game` : 'None'],
    ['Goal bonus', t.goalBonus ? `${money(t.goalBonus)} a goal` : 'None'],
    ['Promised role', ROLE_OPTIONS.find((r) => r.id === t.promisedRole)?.label || t.promisedRole],
  ])}
    <p class="small faint" style="margin-bottom:0">Both sides have agreed. Sign it and he is your player.</p>`,
    footer: '<button data-close>Not yet</button><button class="primary" data-act="sign">Sign him</button>',
    onMount(modal, close) {
      modal.querySelector('[data-act="sign"]').onclick = () => {
        // The part-exchange leg goes first. If it went second, the squad-size
        // and registration refresh would run against a squad that had already
        // taken the new man in, and one of the two clubs would be counted wrong.
        for (const id of neg.agreed?.swap || []) {
          const out = world.players[id];
          if (!out || !seller) continue;
          const d = contractDemand(world, out, seller);
          completeTransfer(game, out, club.id, seller.id, 0, {
            wage: Math.max(out.contract?.wage || 0, d.wage), years: d.years, promisedRole: 'rotation',
          });
        }
        completeTransfer(game, player, player.clubId, club.id, fee, {
          wage: t.wage, years: t.years, promisedRole: t.promisedRole,
          releaseClause: t.releaseClause, goalBonus: t.goalBonus, appearanceFee: t.appearanceFee,
        }, { sellOn: neg.agreed?.sellOn || 0 });
        // The signing-on fee is money out of the door now, not a label.
        if (t.signingBonus > 0) {
          club.finances.balance -= t.signingBonus;
          club.finances.seasonSpend += t.signingBonus;
          club.finances.ledger.push({
            day: game.day, label: `Signing-on fee: ${player.name}`, amount: -t.signingBonus, category: 'transfer',
          });
        }
        delete game.negotiations[neg.id];
        news(game, 'transfer', `Signed: ${player.name}`,
          `${player.name} joins ${club.name}${seller ? ` from ${seller.name}` : ' on a free transfer'}`
          + `${fee > 0 ? ` for ${money(fee)}` : ''} on ${money(t.wage)} a week for ${t.years} year${t.years > 1 ? 's' : ''}`
          + `${neg.agreed?.sellOn ? `, with a ${neg.agreed.sellOn}% sell-on clause` : ''}.`);
        close();
        app.refresh();
        toast(`${player.name} signs for ${club.name}.`);
      };
    },
  });
}

/**
 * Loan talks.
 *
 * Kept apart from the transfer window on purpose: the currency is different -
 * you are arguing about how much of a wage you will cover, not a fee - and
 * folding it into the same form would mean a screen where half the controls are
 * always irrelevant.
 */
export function showLoanDialog(app, player) {
  const game = app.game;
  const world = game.world;
  const club = world.clubs[game.userClubId];
  if (!club) return;
  if (!transferWindowOpen(game.day)) {
    toast('The transfer window is closed.', 'warn');
    return;
  }
  const opened = openLoanTalks(game, player, club);
  if (opened.error) {
    toast(opened.error, 'warn');
    return;
  }
  renderLoan(app, opened.negotiation);
}

function renderLoan(app, neg) {
  const game = app.game;
  const world = game.world;
  const club = world.clubs[neg.buyerId];
  const player = world.players[neg.playerId];
  const seller = world.clubs[neg.sellerId];
  const wageRoom = club.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, club);

  if (neg.status === 'agreed' && neg.agreed) {
    const t = neg.agreed;
    openModal({
      title: `Loan ${player.name}`,
      narrow: true,
      body: `${kv([
    ['From', seller.name],
    ['Length', 'Until the end of the season'],
    ['Wage you cover', `${Math.round(t.wageShare * 100)}% — ${money(Math.round(player.contract.wage * t.wageShare))}/week`],
    ['They keep paying', money(Math.round(player.contract.wage * (1 - t.wageShare)))],
    ['Loan fee', t.fee > 0 ? money(t.fee) : 'None'],
  ])}
      <p class="small faint" style="margin-bottom:0">He goes back to ${esc(seller.short)} at the end of the season.
        He counts against your registration while he is here, and you cannot sell him.</p>`,
      footer: '<button data-close>Not yet</button><button class="primary" data-act="sign">Take him on loan</button>',
      onMount(modal, close) {
        modal.querySelector('[data-act="sign"]').onclick = () => {
          completeLoan(game, player, seller.id, club.id, t);
          delete game.negotiations[neg.id];
          news(game, 'transfer', `Loan signing: ${player.name}`,
            `${player.name} joins on loan from ${seller.name} until the end of the season, `
            + `with ${club.name} covering ${Math.round(t.wageShare * 100)}% of his wage.`);
          close();
          app.refresh();
          toast(`${player.name} joins on loan.`);
        };
      },
    });
    return;
  }

  const wage = player.contract?.wage || 0;
  const last = neg.draft || {};
  openModal({
    title: `Loan talks — ${esc(seller.name)}`,
    body: `
      <div class="grid c2">
        <section class="panel"><div class="panel-head"><h2>${esc(player.name)}</h2></div><div class="panel-body">
          ${kv([
    ['Position', `${player.positions.join('/')}, ${player.age}`],
    ['Ability', String(currentAbility(player))],
    ['His wage', `${money(wage)}/week`],
    ['Role at ' + seller.short, ROLE_LABELS[expectedRole(world, seller, player)]],
  ])}
        </div></section>
        <section class="panel"><div class="panel-head"><h2>Your Position</h2></div><div class="panel-body">
          ${kv([
    ['Wage room', raw(`<span class="${wageRoom > 0 ? 'good' : 'bad'}">${money(wageRoom)}/week</span>`)],
    ['Squad size', String(club.squad.length)],
    ['Round', String(neg.round)],
  ])}
          ${patienceBar({ ...neg, phase: 'fee' })}
        </div></section>
      </div>
      ${logHtml(neg)}
      <div class="field-row" style="margin-top:12px">
        <div class="field"><label>Wage you will cover</label><select id="loan-share">
          ${LOAN_WAGE_SHARES.map((v) => `<option value="${v}" ${v === (last.wageShare ?? 0.5) ? 'selected' : ''}>${Math.round(v * 100)}% — ${money(Math.round(wage * v))}/wk</option>`).join('')}
        </select></div>
        <div class="field"><label>Loan fee</label><input type="number" id="loan-fee" value="${Math.round(last.fee ?? 0)}" step="25000" min="0"></div>
      </div>
      <div id="loan-read" class="small faint"></div>
      <div id="loan-feedback" class="small" style="margin-top:6px"></div>`,
    footer: `<button data-act="walk" class="danger">Break off talks</button>
      <button data-close>Leave it for now</button>
      <button class="primary" data-act="offer">Make the offer</button>`,
    onMount(modal, close) {
      const read = modal.querySelector('#loan-read');
      const collect = () => ({
        wageShare: Number(modal.querySelector('#loan-share').value),
        fee: Math.max(0, Number(modal.querySelector('#loan-fee').value) || 0),
        weeks: 38,
      });
      const refresh = () => {
        const o = collect();
        neg.draft = o;
        read.innerHTML = `They will read that as <b class="mono">${money(loanEquivalent(world, player, o))}</b> a week off their bill.`;
      };
      modal.querySelectorAll('input, select').forEach((el) => { el.oninput = refresh; el.onchange = refresh; });
      refresh();

      modal.querySelector('[data-act="walk"]').onclick = () => {
        abandonTalks(game, neg);
        close();
        app.refresh();
        toast('You have walked away from the table.');
      };
      modal.querySelector('[data-act="offer"]').onclick = () => {
        const o = collect();
        const feedback = modal.querySelector('#loan-feedback');
        if (player.contract.wage * o.wageShare > wageRoom) {
          feedback.innerHTML = `<span class="bad">That share breaks your wage budget. You have ${money(wageRoom)}/week.</span>`;
          return;
        }
        const r = loanOffer(game, neg, o);
        close();
        if (r.outcome === 'collapsed') {
          app.refresh();
          toast(r.text, 'warn');
          return;
        }
        renderLoan(app, neg);
      };
    },
  });
}

export function showContractDialog(app, player) {
  const game = app.game;
  const world = game.world;
  const club = world.clubs[player.clubId];
  const demand = contractDemand(world, player, club);
  const wageRoom = club.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, club) + (player.contract?.wage || 0);

  openModal({
    title: `Contract talks — ${player.name}`,
    narrow: true,
    body: `
      ${kv([
    ['Current wage', player.contract ? `${money(player.contract.wage)}/week` : 'None'],
    ['Expires', player.contract ? String(player.contract.expiresYear) : '—'],
    ['Squad role', ROLE_LABELS[expectedRole(world, club, player)]],
    ['He is asking', `${money(demand.wage)}/week over ${demand.years} years`],
    ['Signing-on fee he expects', money(demand.signingBonus)],
    ['Wage room', raw(`<span class="${wageRoom > demand.wage ? 'good' : 'bad'}">${money(wageRoom)}/week</span>`)],
  ])}
      <div class="field-row" style="margin-top:14px">
        <div class="field"><label>Weekly wage</label><input type="number" id="c-wage" value="${demand.wage}" step="100" min="0"></div>
        <div class="field"><label>Length</label><select id="c-years">
          ${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === demand.years ? 'selected' : ''}>${y} year${y > 1 ? 's' : ''}</option>`).join('')}
        </select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Signing-on fee</label><input type="number" id="c-bonus" value="0" step="50000" min="0"></div>
        <div class="field"><label>Release clause (0 for none)</label>
          <input type="number" id="c-clause" value="${player.contract?.releaseClause || 0}" step="500000" min="0"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Appearance fee</label>
          <input type="number" id="c-appear" value="${player.contract?.appearanceFee || 0}" step="500" min="0"></div>
        <div class="field"><label>Goal bonus</label>
          <input type="number" id="c-goal" value="${player.contract?.goalBonus || 0}" step="500" min="0"></div>
        <div class="field"><label>Role you promise him</label><select id="c-role">
          ${ROLE_OPTIONS.map((r) => `<option value="${r.id}" ${r.id === expectedRole(world, club, player) ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select></div>
      </div>
      <div id="c-read" class="small faint"></div>
      <div id="c-feedback" class="small" style="margin-top:6px">Offer terms he will accept and he stays.</div>`,
    footer: '<button data-close>Cancel</button><button class="primary" data-act="offer">Offer contract</button>',
    onMount(modal, close) {
      const read = modal.querySelector('#c-read');
      const collect = () => ({
        wage: Math.max(0, Number(modal.querySelector('#c-wage').value) || 0),
        years: Number(modal.querySelector('#c-years').value),
        signingBonus: Math.max(0, Number(modal.querySelector('#c-bonus').value) || 0),
        releaseClause: Math.max(0, Number(modal.querySelector('#c-clause').value) || 0),
        appearanceFee: Math.max(0, Number(modal.querySelector('#c-appear').value) || 0),
        goalBonus: Math.max(0, Number(modal.querySelector('#c-goal').value) || 0),
        promisedRole: modal.querySelector('#c-role').value,
      });
      const refresh = () => {
        const o = collect();
        read.innerHTML = `He will read the package as <b class="mono">${money(termsEquivalent(player, o))}</b> a week`
          + ` against the ${money(demand.wage)} he asked for.`
          + (player.unhappy === 'promise' ? ' <span class="warn">He has not had the football he was promised, '
            + 'and will want that put right.</span>' : '');
      };
      modal.querySelectorAll('input, select').forEach((el) => { el.oninput = refresh; el.onchange = refresh; });
      refresh();

      modal.querySelector('[data-act="offer"]').onclick = () => {
        const o = collect();
        const feedback = modal.querySelector('#c-feedback');
        if (o.wage > wageRoom) {
          feedback.innerHTML = `<span class="bad">That breaks the wage budget. You have ${money(wageRoom)}/week available for him.</span>`;
          return;
        }
        const weekly = termsEquivalent(player, o);
        const agree = evaluateContract(world, player, club, {
          wage: weekly, years: o.years, promisedRole: o.promisedRole,
        });
        if (!agree.accepted) {
          feedback.innerHTML = `<span class="bad">Rejected — he ${esc(agree.reason)}.</span>`;
          return;
        }
        renewContract(world, player, o);
        if (o.signingBonus > 0) {
          club.finances.balance -= o.signingBonus;
          club.finances.seasonSpend += o.signingBonus;
          club.finances.ledger.push({
            day: game.day, label: `Signing-on fee: ${player.name}`, amount: -o.signingBonus, category: 'wages',
          });
        }
        news(game, 'squad', `${player.name} signs a new deal`,
          `${player.name} has committed to ${club.name} until ${world.year + o.years} on ${money(o.wage)} a week.`);
        close();
        app.refresh();
        toast(`${player.name} has signed a new contract.`);
      };
    },
  });
}

/**
 * Review an incoming offer for one of your players.
 *
 * The old version had three buttons - accept, reject, decide later - and no way
 * to haggle, so an offer below your valuation was simply a loss. A counter puts
 * the same round structure on the selling side.
 */
export function showOfferDialog(app, offer) {
  const game = app.game;
  const world = game.world;
  const player = world.players[offer.playerId];
  const buyer = world.clubs[offer.clubId];
  const club = world.clubs[game.userClubId];
  if (!player || !buyer) return;
  const ask = askingPrice(world, player);
  const countered = offer.counters || 0;

  openModal({
    title: `Offer for ${player.name}`,
    narrow: true,
    body: `${kv([
    ['From', buyer.name],
    ['Offer', money(offer.fee)],
    ['Your valuation', money(ask)],
    ['Player', `${player.name} (${player.positions.join('/')}, ${player.age}, ${currentAbility(player)} ability)`],
    ['Squad role', ROLE_LABELS[expectedRole(world, club, player)]],
    ['Wage saved', `${money(player.contract?.wage || 0)}/week`],
  ])}
    <p class="small ${offer.fee >= ask ? 'good' : 'faint'}">${offer.fee >= ask
    ? 'This meets your valuation.'
    : `This is ${money(ask - offer.fee)} below what you would want.`}</p>
    <div class="field"><label>Counter with</label>
      <input type="number" id="o-counter" value="${Math.round(Math.max(offer.fee, ask) / 50000) * 50000}" step="50000" min="0">
    </div>
    <p class="small faint" style="margin-bottom:0">${countered
    ? `You have already been back to them ${countered} time${countered === 1 ? '' : 's'}. Push much harder and they will look elsewhere.`
    : 'Ask for more and they may improve it, walk away, or hold firm.'}</p>`,
    footer: `<button data-act="reject" class="danger">Reject</button>
      <button data-act="counter">Counter</button>
      <button data-close>Decide later</button>
      <button class="primary" data-act="accept">Accept</button>`,
    onMount(modal, close) {
      const finish = (fee) => {
        const demand = contractDemand(world, player, buyer);
        completeTransfer(game, player, club.id, buyer.id, fee,
          { wage: demand.wage, years: demand.years, promisedRole: 'rotation' });
        game.offers = (game.offers || []).filter((o) => o.id !== offer.id);
        news(game, 'transfer', `Sold: ${player.name}`,
          `${player.name} has joined ${buyer.name} for ${money(fee)}.`);
        close();
        app.refresh();
        toast(`${player.name} sold for ${money(fee)}.`);
      };

      modal.querySelector('[data-act="accept"]').onclick = () => finish(offer.fee);

      modal.querySelector('[data-act="counter"]').onclick = () => {
        const want = Math.max(0, Number(modal.querySelector('#o-counter').value) || 0);
        // Their ceiling is drawn once per offer and kept, so asking the same
        // thing twice is not a second roll of the dice.
        if (offer.ceiling === undefined) {
          offer.ceiling = Math.round(offer.fee * (1.06 + (buyer.finances.transferBudget > offer.fee * 3 ? 0.14 : 0.04)));
        }
        offer.counters = countered + 1;
        if (want <= offer.fee) {
          toast('That is not more than they already offered.', 'warn');
          return;
        }
        if (want <= offer.ceiling && want <= buyer.finances.transferBudget) {
          offer.fee = want;
          close();
          app.refresh();
          toast(`${buyer.name} have agreed to ${money(want)}.`);
          return;
        }
        // Pushing past their ceiling ends it, and the further past, the sooner.
        if (offer.counters >= 2 || want > offer.ceiling * 1.3) {
          game.offers = (game.offers || []).filter((o) => o.id !== offer.id);
          close();
          app.refresh();
          toast(`${buyer.name} have withdrawn their interest.`, 'warn');
          return;
        }
        close();
        app.refresh();
        toast(`${buyer.name} say that is beyond them, but their offer stands.`, 'warn');
      };

      modal.querySelector('[data-act="reject"]').onclick = () => {
        game.offers = (game.offers || []).filter((o) => o.id !== offer.id);
        close();
        app.refresh();
        toast('Offer rejected.');
      };
    },
  });
}
