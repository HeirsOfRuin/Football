// The transfer market: search the world, manage a shortlist, handle offers.

import { esc, panel, panelTight, money, emptyState, tabs, shortDate, tableHead } from '../components.js';
import { userClub } from '../../state/game.js';
import { currentAbility, POSITIONS, POSITION_LABELS, positionEffectiveness } from '../../data/attributes.js';
import { marketValue, askingPrice, identifyNeed, contractDemand } from '../../engine/transfers.js';
import { weeklyWageBill } from '../../engine/finance.js';
import { transferWindowOpen } from '../../core/calendar.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';
import { showBidDialog, showOfferDialog, showLoanDialog } from '../negotiate.js';

const VIEWS = [
  { id: 'search', label: 'Search' },
  { id: 'shortlist', label: 'Shortlist' },
  { id: 'offers', label: 'Offers' },
  { id: 'activity', label: 'Market Activity' },
];

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('No club.') };

  const state = app.screenState.transfers || (app.screenState.transfers = {
    view: 'search', pos: 'any', maxAge: 40, maxFee: 0, minAbility: 0, league: 'any',
    listedOnly: false, sortKey: 'ability', sortDesc: true, query: '',
  });
  if (state.maxFee === 0) state.maxFee = Math.max(1e6, Math.round(club.finances.transferBudget));

  const windowOpen = transferWindowOpen(game.day);
  const wageRoom = club.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, club);
  const offers = (game.offers || []).filter((o) => world.players[o.playerId]?.clubId === club.id);
  const needs = identifyNeed(world, club).slice(0, 3);

  let body;
  if (state.view === 'shortlist') body = shortlistView(app, club, state);
  else if (state.view === 'offers') body = offersView(app, offers);
  else if (state.view === 'activity') body = activityView(app);
  else body = searchView(app, club, state);

  return {
    html: `
      ${tabs(VIEWS.map((v) => (v.id === 'offers' && offers.length ? { ...v, label: `Offers (${offers.length})` } : v)), state.view)}
      <div class="row wrap small" style="margin-bottom:12px;gap:14px">
        <span>${windowOpen ? '<span class="pill good">Window open</span>' : '<span class="pill bad">Window closed</span>'}</span>
        <span class="faint">Transfer budget <b class="mono">${money(club.finances.transferBudget)}</b></span>
        <span class="faint">Wage room <b class="mono ${wageRoom > 0 ? '' : 'bad'}">${money(wageRoom)}/w</b></span>
        <span class="faint">Squad ${club.squad.length}</span>
        <div class="spacer"></div>
        <span class="faint">Scouts suggest: ${needs.map((n) => esc(n.pos)).join(', ')}</span>
      </div>
      ${body}`,

    mount(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => { state.view = t.dataset.tab; app.refresh(); };
      });
      const bindFilters = () => {
        root.querySelectorAll('[data-f]').forEach((el) => {
          el.onchange = () => {
            const key = el.dataset.f;
            state[key] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
            app.refresh();
          };
        });
        const q = root.querySelector('#t-query');
        if (q) {
          q.oninput = () => { state.query = q.value; };
          q.onkeydown = (e) => { if (e.key === 'Enter') app.refresh(); };
        }
        const go = root.querySelector('[data-act="search"]');
        if (go) go.onclick = () => app.refresh();
      };
      bindFilters();
      root.querySelectorAll('th[data-sort]').forEach((th) => {
        th.onclick = () => {
          if (state.sortKey === th.dataset.sort) state.sortDesc = !state.sortDesc;
          else { state.sortKey = th.dataset.sort; state.sortDesc = true; }
          app.refresh();
        };
      });
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
      root.querySelectorAll('[data-bid]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          showBidDialog(app, world.players[b.dataset.bid]);
        };
      });
      root.querySelectorAll('[data-loan]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          showLoanDialog(app, world.players[b.dataset.loan]);
        };
      });
      root.querySelectorAll('[data-offer]').forEach((b) => {
        b.onclick = () => showOfferDialog(app, offers.find((o) => o.id === b.dataset.offer));
      });
      root.querySelectorAll('[data-unshort]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          game.shortlist = game.shortlist.filter((x) => x !== b.dataset.unshort);
          app.refresh();
        };
      });
    },
  };
}

function searchResults(app, club, state) {
  const world = app.game.world;
  const query = state.query.trim().toLowerCase();
  const out = [];
  for (const id in world.players) {
    const p = world.players[id];
    if (p.clubId === club.id) continue;
    if (state.pos !== 'any' && positionEffectiveness(p, state.pos) < 0.9) continue;
    if (p.age > state.maxAge) continue;
    if (currentAbility(p) < state.minAbility) continue;
    if (state.listedOnly && p.transferStatus !== 'listed' && p.clubId) continue;
    const fee = p.clubId ? askingPrice(world, p) : 0;
    if (state.maxFee > 0 && fee > state.maxFee) continue;
    if (state.league !== 'any') {
      const c = p.clubId ? world.clubs[p.clubId] : null;
      if (state.league === 'free') { if (c) continue; } else if (!c || c.leagueId !== state.league) continue;
    }
    if (query && !p.name.toLowerCase().includes(query)) continue;
    out.push({ p, fee });
    if (out.length > 900) break;
  }
  const key = state.sortKey;
  return sortBy(out, {
    key: (x) => (key === 'fee' ? x.fee
      : key === 'age' ? x.p.age
        : key === 'name' ? x.p.last
          : key === 'potential' ? x.p.pa
            : key === 'wage' ? (x.p.contract?.wage ?? 0)
              : currentAbility(x.p)),
    desc: state.sortDesc,
  }).slice(0, 200);
}

function searchView(app, club, state) {
  const world = app.game.world;
  const results = searchResults(app, club, state);
  const columns = [
    { key: 'name', label: 'Name' }, { key: 'pos', label: 'Pos' }, { key: 'age', label: 'Age', num: true },
    { key: 'club', label: 'Club' }, { key: 'ability', label: 'Ability', num: true },
    { key: 'potential', label: 'Pot.', num: true }, { key: 'wage', label: 'Wage', num: true },
    { key: 'fee', label: 'Asking', num: true },
  ];

  return `
  ${panel('Search', `
    <div class="row wrap" style="gap:10px">
      <input id="t-query" placeholder="Name" value="${esc(state.query)}" style="width:160px">
      <select data-f="pos"><option value="any">Any position</option>
        ${POSITIONS.map((p) => `<option value="${p}" ${state.pos === p ? 'selected' : ''}>${esc(POSITION_LABELS[p])}</option>`).join('')}</select>
      <select data-f="league"><option value="any">Any league</option><option value="free" ${state.league === 'free' ? 'selected' : ''}>Free agents</option>
        ${world.leagues.map((l) => `<option value="${l.id}" ${state.league === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <label class="small faint">Max age <input type="number" data-f="maxAge" value="${state.maxAge}" min="15" max="45" style="width:64px"></label>
      <label class="small faint">Min ability <input type="number" data-f="minAbility" value="${state.minAbility}" min="0" max="200" style="width:70px"></label>
      <label class="small faint">Max fee <input type="number" data-f="maxFee" value="${state.maxFee}" step="500000" min="0" style="width:120px"></label>
      <label class="small faint"><input type="checkbox" data-f="listedOnly" ${state.listedOnly ? 'checked' : ''}> Listed only</label>
      <button class="primary sm" data-act="search">Search</button>
    </div>`)}
  ${panelTight(`Results (${results.length}${results.length >= 200 ? '+' : ''})`, results.length === 0 ? emptyState('No players match those filters.')
    : `<div class="table-wrap"><table>${tableHead(columns, state.sortKey, state.sortDesc, '<th></th>')}
      <tbody>${results.map(({ p, fee }) => {
      const c = p.clubId ? world.clubs[p.clubId] : null;
      return `<tr class="clickable" data-player="${esc(p.id)}">
          <td class="nowrap">${esc(p.name)}${p.transferStatus === 'listed' ? ' <span class="pill warn">Listed</span>' : ''}${p.custom ? ' <span class="pill info">C</span>' : ''}</td>
          <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
          <td class="num">${p.age}</td>
          <td class="small nowrap">${c ? esc(c.short) : '<span class="faint">Free agent</span>'}</td>
          <td class="num">${currentAbility(p)}</td>
          <td class="num faint">${p.pa}</td>
          <td class="num">${p.contract ? money(p.contract.wage) : '—'}</td>
          <td class="num">${c ? money(fee) : 'Free'}</td>
          <td class="nowrap"><button class="sm primary" data-bid="${esc(p.id)}">Bid</button>${c
      ? `<button class="sm" data-loan="${esc(p.id)}">Loan</button>` : ''}</td>
        </tr>`;
    }).join('')}</tbody></table></div>`)}`;
}

function shortlistView(app, club, state) {
  const world = app.game.world;
  const players = app.game.shortlist.map((id) => world.players[id]).filter(Boolean);
  if (!players.length) return panelTight('Shortlist', emptyState('Nobody shortlisted. Add players from their profile.'));
  return panelTight('Shortlist', `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th>Club</th>
      <th class="num">Ability</th><th class="num">Asking</th><th class="num">Wage demand</th><th></th></tr></thead>
    <tbody>${players.map((p) => {
    const c = p.clubId ? world.clubs[p.clubId] : null;
    return `<tr class="clickable" data-player="${esc(p.id)}">
        <td class="nowrap">${esc(p.name)}</td>
        <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
        <td class="num">${p.age}</td>
        <td class="small">${c ? esc(c.short) : '<span class="faint">Free agent</span>'}</td>
        <td class="num">${currentAbility(p)}</td>
        <td class="num">${c ? money(askingPrice(world, p)) : 'Free'}</td>
        <td class="num">${money(contractDemand(world, p, club).wage)}</td>
        <td class="nowrap"><button class="sm primary" data-bid="${esc(p.id)}">Bid</button>${c
    ? `<button class="sm" data-loan="${esc(p.id)}">Loan</button>` : ''}
          <button class="sm" data-unshort="${esc(p.id)}">Remove</button></td>
      </tr>`;
  }).join('')}</tbody></table></div>`);
}

function offersView(app, offers) {
  const world = app.game.world;
  if (!offers.length) return panelTight('Incoming Offers', emptyState('No clubs have bid for your players.'));
  return panelTight('Incoming Offers', `<table>
    <thead><tr><th>Player</th><th>From</th><th class="num">Offer</th><th class="num">Your valuation</th><th></th></tr></thead>
    <tbody>${offers.map((o) => {
    const p = world.players[o.playerId];
    const buyer = world.clubs[o.clubId];
    const ask = askingPrice(world, p);
    return `<tr>
        <td class="nowrap clickable" data-player="${esc(p.id)}">${esc(p.name)}</td>
        <td>${esc(buyer.name)}</td>
        <td class="num ${o.fee >= ask ? 'good' : 'warn'}">${money(o.fee)}</td>
        <td class="num faint">${money(ask)}</td>
        <td><button class="sm primary" data-offer="${esc(o.id)}">Review</button></td>
      </tr>`;
  }).join('')}</tbody></table>`);
}

function activityView(app) {
  const world = app.game.world;
  const log = [...app.game.transferLog].reverse().slice(0, 120);
  if (!log.length) return panelTight('Market Activity', emptyState('No transfers completed yet.'));
  return panelTight('Market Activity', `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Player</th><th>From</th><th>To</th><th class="num">Fee</th></tr></thead>
    <tbody>${log.map((t) => `<tr>
      <td class="small faint nowrap">${esc(shortDate(t.day, world.year))}</td>
      <td class="nowrap">${esc(t.name)}</td>
      <td class="small">${esc(t.from)}</td>
      <td class="small">${esc(t.to)}</td>
      <td class="num">${t.fee > 0 ? money(t.fee) : '<span class="faint">Free</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`);
}
