// Transfer bids and contract talks.

import { esc, openModal, money, toast, kv, raw } from './components.js';
import { currentAbility } from '../data/attributes.js';
import {
  marketValue, askingPrice, evaluateOffer, evaluateContract, contractDemand,
  completeTransfer, renewContract,
} from '../engine/transfers.js';
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

export function showBidDialog(app, player) {
  const game = app.game;
  const world = game.world;
  const club = world.clubs[game.userClubId];
  if (!club) return;
  if (!transferWindowOpen(game.day)) {
    toast('The transfer window is closed.', 'warn');
    return;
  }
  const seller = player.clubId ? world.clubs[player.clubId] : null;
  const ask = seller ? askingPrice(world, player) : 0;
  const demand = contractDemand(world, player, club);
  const wageRoom = club.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, club);

  openModal({
    title: seller ? `Bid for ${player.name}` : `Sign ${player.name}`,
    body: `
      <div class="grid c2">
        <section class="panel"><div class="panel-head"><h2>The Deal</h2></div><div class="panel-body">
          ${kv([
    ['Player', `${player.name} (${player.positions.join('/')}, ${player.age})`],
    ['Current club', seller ? seller.name : 'Free agent'],
    ['Market value', money(marketValue(world, player))],
    ['Asking price', seller ? money(ask) : 'Free transfer'],
    ['Release clause', player.contract?.releaseClause ? money(player.contract.releaseClause) : 'None'],
  ])}
        </div></section>
        <section class="panel"><div class="panel-head"><h2>Your Position</h2></div><div class="panel-body">
          ${kv([
    ['Transfer budget', money(club.finances.transferBudget)],
    ['Wage room', raw(`<span class="${wageRoom > demand.wage ? 'good' : 'bad'}">${money(wageRoom)}/week</span>`)],
    ['He wants', `${money(demand.wage)}/week`],
    ['Squad size', String(club.squad.length)],
  ])}
        </div></section>
      </div>

      ${seller ? `<div class="field"><label>Transfer fee</label>
        <input type="number" id="bid-fee" value="${ask}" step="50000" min="0">
        <input type="range" id="bid-fee-range" min="0" max="${Math.max(ask * 2, 1000000)}" step="50000" value="${ask}" style="width:100%;margin-top:6px">
      </div>` : ''}

      <div class="field-row">
        <div class="field"><label>Weekly wage</label><input type="number" id="bid-wage" value="${demand.wage}" step="100" min="0"></div>
        <div class="field"><label>Contract length</label><select id="bid-years">
          ${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === demand.years ? 'selected' : ''}>${y} year${y > 1 ? 's' : ''}</option>`).join('')}
        </select></div>
        <div class="field"><label>Promised role</label><select id="bid-role">
          ${ROLE_OPTIONS.map((r) => `<option value="${r.id}" ${r.id === 'rotation' ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select></div>
      </div>

      <div id="bid-feedback" class="small faint">Set your terms, then make the offer.</div>`,
    footer: '<button data-close>Cancel</button><button class="primary" data-act="submit">Make offer</button>',
    onMount(modal, close) {
      const feeInput = modal.querySelector('#bid-fee');
      const feeRange = modal.querySelector('#bid-fee-range');
      if (feeInput && feeRange) {
        feeInput.oninput = () => { feeRange.value = feeInput.value; };
        feeRange.oninput = () => { feeInput.value = feeRange.value; };
      }
      modal.querySelector('[data-act="submit"]').onclick = () => {
        const fee = feeInput ? Math.max(0, Number(feeInput.value) || 0) : 0;
        const wage = Math.max(0, Number(modal.querySelector('#bid-wage').value) || 0);
        const years = Number(modal.querySelector('#bid-years').value);
        const role = modal.querySelector('#bid-role').value;
        const feedback = modal.querySelector('#bid-feedback');

        if (fee > club.finances.transferBudget) {
          feedback.innerHTML = `<span class="bad">That is beyond your transfer budget of ${money(club.finances.transferBudget)}.</span>`;
          return;
        }
        if (wage > wageRoom) {
          feedback.innerHTML = `<span class="bad">Those wages break your budget. You have ${money(wageRoom)}/week to play with.</span>`;
          return;
        }
        if (club.squad.length >= 34) {
          feedback.innerHTML = '<span class="bad">Your squad is full. Move someone on first.</span>';
          return;
        }

        if (seller) {
          const verdict = evaluateOffer(world, player, fee, club);
          if (!verdict.accepted) {
            feedback.innerHTML = verdict.reason === 'close'
              ? `<span class="warn">${esc(seller.name)} have rejected it, but would listen to around ${money(verdict.counter)}.</span>`
              : `<span class="bad">${esc(seller.name)} have turned it down. They value him nearer ${money(verdict.counter)}.</span>`;
            return;
          }
        }

        const offer = { wage, years, promisedRole: role };
        const agree = evaluateContract(world, player, club, offer);
        if (!agree.accepted) {
          feedback.innerHTML = `<span class="bad">${esc(player.name)} has rejected personal terms — he ${esc(agree.reason)}.</span>`;
          return;
        }

        completeTransfer(game, player, player.clubId, club.id, fee, offer);
        news(game, 'transfer', `Signed: ${player.name}`,
          `${player.name} joins ${club.name}${seller ? ` from ${seller.name}` : ' on a free transfer'}`
          + `${fee > 0 ? ` for ${money(fee)}` : ''} on ${money(wage)} a week for ${years} year${years > 1 ? 's' : ''}.`);
        close();
        app.refresh();
        toast(`${player.name} signs for ${club.name}.`);
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
    ['Wage room', raw(`<span class="${wageRoom > demand.wage ? 'good' : 'bad'}">${money(wageRoom)}/week</span>`)],
  ])}
      <div class="field-row" style="margin-top:14px">
        <div class="field"><label>Weekly wage</label><input type="number" id="c-wage" value="${demand.wage}" step="100" min="0"></div>
        <div class="field"><label>Length</label><select id="c-years">
          ${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === demand.years ? 'selected' : ''}>${y} year${y > 1 ? 's' : ''}</option>`).join('')}
        </select></div>
      </div>
      <div class="field"><label>Release clause (0 for none)</label>
        <input type="number" id="c-clause" value="${player.contract?.releaseClause || 0}" step="500000" min="0"></div>
      <div id="c-feedback" class="small faint">Offer terms he will accept and he stays.</div>`,
    footer: '<button data-close>Cancel</button><button class="primary" data-act="offer">Offer contract</button>',
    onMount(modal, close) {
      modal.querySelector('[data-act="offer"]').onclick = () => {
        const wage = Math.max(0, Number(modal.querySelector('#c-wage').value) || 0);
        const years = Number(modal.querySelector('#c-years').value);
        const clause = Math.max(0, Number(modal.querySelector('#c-clause').value) || 0);
        const feedback = modal.querySelector('#c-feedback');
        if (wage > wageRoom) {
          feedback.innerHTML = `<span class="bad">That breaks the wage budget. You have ${money(wageRoom)}/week available for him.</span>`;
          return;
        }
        const agree = evaluateContract(world, player, club, { wage, years, promisedRole: expectedRole(world, club, player) });
        if (!agree.accepted) {
          feedback.innerHTML = `<span class="bad">Rejected — he ${esc(agree.reason)}.</span>`;
          return;
        }
        renewContract(world, player, { wage, years, releaseClause: clause });
        news(game, 'squad', `${player.name} signs a new deal`,
          `${player.name} has committed to ${club.name} until ${world.year + years} on ${money(wage)} a week.`);
        close();
        app.refresh();
        toast(`${player.name} has signed a new contract.`);
      };
    },
  });
}

/** Review an incoming offer for one of your players. */
export function showOfferDialog(app, offer) {
  const game = app.game;
  const world = game.world;
  const player = world.players[offer.playerId];
  const buyer = world.clubs[offer.clubId];
  const club = world.clubs[game.userClubId];
  if (!player || !buyer) return;
  const ask = askingPrice(world, player);

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
    <p class="small faint" style="margin-bottom:0">${offer.fee >= ask
    ? 'This meets your valuation.'
    : `This is ${money(ask - offer.fee)} below what you would want.`}</p>`,
    footer: '<button data-act="reject" class="danger">Reject</button><button data-close>Decide later</button><button class="primary" data-act="accept">Accept</button>',
    onMount(modal, close) {
      modal.querySelector('[data-act="accept"]').onclick = () => {
        const demand = contractDemand(world, player, buyer);
        completeTransfer(game, player, club.id, buyer.id, offer.fee, { wage: demand.wage, years: demand.years, promisedRole: 'rotation' });
        game.offers = (game.offers || []).filter((o) => o.id !== offer.id);
        news(game, 'transfer', `Sold: ${player.name}`,
          `${player.name} has joined ${buyer.name} for ${money(offer.fee)}.`);
        close();
        app.refresh();
        toast(`${player.name} sold for ${money(offer.fee)}.`);
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
