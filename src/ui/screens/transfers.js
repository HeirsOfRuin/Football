// The transfer market: search the world, manage a shortlist, handle offers.

import { esc, panel, panelTight, money, emptyState, tabs, shortDate, tableHead, hint, bar, toast } from '../components.js';
import { userClub } from '../../state/game.js';
import { currentAbility, POSITIONS, POSITION_LABELS, positionEffectiveness } from '../../data/attributes.js';
import { marketValue, askingPrice, identifyNeed, contractDemand } from '../../engine/transfers.js';
import {
  fogBand, scoutCount, knowledgeLabel, effectiveKnowledge, ASSIGNMENT_TYPES,
  assignScout, clearAssignment, knowledgeOf,
} from '../../engine/scouting.js';
import { weeklyWageBill } from '../../engine/finance.js';
import { transferWindowOpen, KEY_DAYS } from '../../core/calendar.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';
import { showBidDialog, showOfferDialog, showLoanDialog } from '../negotiate.js';

/**
 * How many results a search shows before asking.
 *
 * It used to show two hundred, each with two buttons: measured at 390x844 that
 * was eleven screens of scroll, 1,006 numbers and 405 buttons on one page.
 * Nobody reads the hundred and eightieth best right-back in the world, and the
 * filters above the table are the thing that should narrow a search - a list
 * long enough to hide its own filters has stopped being a search at all.
 */
const PAGE = 25;

/**
 * An ability you are not certain of.
 *
 * The exact figure, or a range, and the range is around what your scouts
 * believe rather than around the truth. This cell is the reason the scouting
 * network is worth money: before it, the list printed the real ability and the
 * real potential of all five thousand players in the world.
 */
function estimateCell(band) {
  if (band.exact) return String(band.estimate);
  if (band.low === band.high) return `${band.low}`;
  return `<span title="Your scouts are not certain. Watch him to narrow it.">${band.low}–${band.high}</span>`;
}

/**
 * Fee filters as bands rather than a number box.
 *
 * The box defaulted to the transfer budget and so read "64111109", which is a
 * number nobody can parse at a glance and nobody wants to type on a phone. The
 * budget is still the default - it is the only figure that actually constrains a
 * search - it just says so in words now.
 */
const FEE_BANDS = (club) => {
  const budget = Math.max(0, Math.round(club.finances.transferBudget));
  return [
    [0, 'Any fee'],
    [1, 'Free transfers only'],
    [1e6, 'Up to £1M'],
    [5e6, 'Up to £5M'],
    [15e6, 'Up to £15M'],
    [40e6, 'Up to £40M'],
    [budget, `Within budget (${money(budget)})`],
  ];
};

const VIEWS = [
  { id: 'search', label: 'Search' },
  { id: 'scouting', label: 'Scouting' },
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
    listedOnly: false, sortKey: 'ability', sortDesc: true, query: '', shown: PAGE,
  });
  if (state.maxFee === 0) state.maxFee = Math.max(1e6, Math.round(club.finances.transferBudget));

  const windowOpen = transferWindowOpen(game.day);
  // Naming the date it reopens is the difference between a rule and a wall.
  const shutUntil = game.day < KEY_DAYS.winterWindowStart
    ? 'Reopens 1 January' : 'Reopens in the summer';
  const wageRoom = club.finances.wageBudgetAnnual / 52 - weeklyWageBill(world, club);
  const offers = (game.offers || []).filter((o) => world.players[o.playerId]?.clubId === club.id);
  const needs = identifyNeed(world, club).slice(0, 3);

  let body;
  if (state.view === 'scouting') body = scoutingView(app, club);
  else if (state.view === 'shortlist') body = shortlistView(app, club, state);
  else if (state.view === 'offers') body = offersView(app, offers);
  else if (state.view === 'activity') body = activityView(app);
  else body = searchView(app, club, state);

  return {
    html: `
      ${tabs(VIEWS.map((v) => (v.id === 'offers' && offers.length ? { ...v, label: `Offers (${offers.length})` } : v)), state.view)}
      ${state.view === 'scouting'
    ? hint(app, 'scouting', 'Abilities outside your own division are what your scouts believe, '
      + 'not what is true. Point a scout at a division or a position and the range narrows.')
    : hint(app, 'transfers', 'Narrow with the filters rather than scrolling: the search shows '
      + `${PAGE} at a time. Tap a row for the player, Bid to open talks.`)}
      <div class="row wrap small" style="margin-bottom:12px;gap:14px">
        <span>${windowOpen ? '<span class="pill good">Window open</span>'
    : `<span class="pill bad">Window closed</span> <span class="faint">${esc(shutUntil)}</span>`}</span>
        <span class="faint">Transfer budget <b class="mono">${money(club.finances.transferBudget)}</b></span>
        <span class="faint">Wage room <b class="mono ${wageRoom > 0 ? '' : 'bad'}">${money(wageRoom)}/w</b></span>
        <span class="faint">Squad ${club.squad.length}</span>
        <div class="spacer"></div>
        <span class="faint">Your squad is thinnest at ${needs.map((n) => esc(POSITION_LABELS[n.pos] || n.pos)).join(', ')}</span>
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
            state.shown = PAGE;
            app.refresh();
          };
        });
        const q = root.querySelector('#t-query');
        if (q) {
          q.oninput = () => { state.query = q.value; };
          q.onkeydown = (e) => { if (e.key === 'Enter') app.refresh(); };
        }
        const go = root.querySelector('[data-act="search"]');
        if (go) go.onclick = () => { state.shown = PAGE; app.refresh(); };
        const more = root.querySelector('[data-act="more"]');
        if (more) more.onclick = () => { state.shown += PAGE; app.refresh(); };
      };
      bindFilters();
      root.querySelectorAll('th[data-sort]').forEach((th) => {
        th.onclick = () => {
          if (state.sortKey === th.dataset.sort) state.sortDesc = !state.sortDesc;
          else { state.sortKey = th.dataset.sort; state.sortDesc = true; }
          state.shown = PAGE;
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
      // Scouting. The target list depends on the kind of assignment, so it is
      // rebuilt rather than rendered once and left to disagree with the select
      // above it.
      const typeSel = root.querySelector('#sc-type');
      const targetSel = root.querySelector('#sc-target');
      const helpEl = root.querySelector('#sc-help');
      if (typeSel && targetSel) {
        const fillTargets = () => {
          const t = typeSel.value;
          let options = [];
          if (t === 'league') {
            options = world.leagues.map((l) => [l.id, l.name]);
          } else if (t === 'position') {
            options = POSITIONS.map((x) => [x, POSITION_LABELS[x]]);
          } else {
            // One man: the shortlist, because sending a scout to watch somebody
            // you have never heard of is not a decision anyone would make.
            options = (game.shortlist || []).map((id) => world.players[id])
              .filter(Boolean).map((p) => [p.id, `${p.name} (${p.positions.join('/')})`]);
          }
          targetSel.innerHTML = options.length
            ? options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')
            : '<option value="">— nobody shortlisted —</option>';
          if (helpEl) helpEl.textContent = ASSIGNMENT_TYPES[t]?.help || '';
        };
        typeSel.onchange = fillTargets;
        fillTargets();
        const send = root.querySelector('[data-act="send"]');
        if (send) {
          send.onclick = () => {
            if (!targetSel.value) { toast('Shortlist somebody first.', 'warn'); return; }
            const made = assignScout(game, club, { type: typeSel.value, target: targetSel.value });
            toast(made ? 'Scout sent.' : 'Every scout is already out.', made ? '' : 'warn');
            app.refresh();
          };
        }
      }
      root.querySelectorAll('[data-recall]').forEach((b) => {
        b.onclick = () => { clearAssignment(game, b.dataset.recall); app.refresh(); };
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
  const game = app.game;
  const world = game.world;
  const query = state.query.trim().toLowerCase();
  const out = [];
  for (const id in world.players) {
    const p = world.players[id];
    if (p.clubId === club.id) continue;
    if (state.pos !== 'any' && positionEffectiveness(p, state.pos) < 0.9) continue;
    if (p.age > state.maxAge) continue;
    // Filtered on the estimate, like everything else on this screen. Filtering
    // on the truth would let a minimum-ability filter sort the world correctly
    // for you however little your scouts knew.
    const belief = fogBand(game, world, club, p, currentAbility(p));
    if (belief.estimate < state.minAbility) continue;
    if (state.listedOnly && p.transferStatus !== 'listed' && p.clubId) continue;
    const fee = p.clubId ? askingPrice(world, p) : 0;
    if (state.maxFee > 0 && fee > state.maxFee) continue;
    if (state.league !== 'any') {
      const c = p.clubId ? world.clubs[p.clubId] : null;
      if (state.league === 'free') { if (c) continue; } else if (!c || c.leagueId !== state.league) continue;
    }
    if (query && !p.name.toLowerCase().includes(query)) continue;
    out.push({ p, fee, belief, potential: fogBand(game, world, club, p, p.pa, { potential: true }) });
    if (out.length > 900) break;
  }
  const key = state.sortKey;
  return sortBy(out, {
    key: (x) => (key === 'fee' ? x.fee
      : key === 'age' ? x.p.age
        : key === 'name' ? x.p.last
          : key === 'potential' ? x.potential.estimate
            : key === 'wage' ? (x.p.contract?.wage ?? 0)
              : x.belief.estimate),
    desc: state.sortDesc,
  }).slice(0, 200);
}

function searchView(app, club, state) {
  const world = app.game.world;
  const results = searchResults(app, club, state);
  const page = results.slice(0, state.shown || PAGE);
  const windowOpen = transferWindowOpen(app.game.day);
  const shutUntil = app.game.day < KEY_DAYS.winterWindowStart
    ? 'The window is shut — it reopens on 1 January'
    : 'The window is shut — it reopens in the summer';
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
      <select data-f="maxFee">${FEE_BANDS(club).map(([v, label]) => `<option value="${v}" ${
  Number(state.maxFee) === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      <label class="small faint"><input type="checkbox" data-f="listedOnly" ${state.listedOnly ? 'checked' : ''}> Listed only</label>
      <button class="primary sm" data-act="search">Search</button>
    </div>`)}
  ${panelTight(`Results (${results.length}${results.length >= 200 ? '+' : ''})`, results.length === 0
    ? emptyState('No players match those filters. Widen the age, the fee or the league above.')
    : `<div class="table-wrap"><table>${tableHead(columns, state.sortKey, state.sortDesc, '<th></th>')}
      <tbody>${page.map(({ p, fee, belief, potential }) => {
      const c = p.clubId ? world.clubs[p.clubId] : null;
      return `<tr class="clickable" data-player="${esc(p.id)}">
          <td class="nowrap">${esc(p.name)}${p.transferStatus === 'listed' ? ' <span class="pill warn">Listed</span>' : ''}${p.custom ? ' <span class="pill info">C</span>' : ''}</td>
          <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
          <td class="num">${p.age}</td>
          <td class="small nowrap">${c ? esc(c.short) : '<span class="faint">Free agent</span>'}</td>
          <td class="num">${estimateCell(belief)}</td>
          <td class="num faint">${estimateCell(potential)}</td>
          <td class="num">${p.contract ? money(p.contract.wage) : '—'}</td>
          <td class="num">${c ? money(fee) : 'Free'}</td>
          <td class="nowrap"><button class="sm primary" data-bid="${esc(p.id)}"${
  windowOpen ? '' : ` disabled title="${esc(shutUntil)}"`}>Bid</button>${c
      ? `<button class="sm" data-loan="${esc(p.id)}"${windowOpen ? '' : ' disabled'}>Loan</button>` : ''}</td>
        </tr>`;
    }).join('')}</tbody></table></div>
    <div class="row small faint" style="margin-top:10px;gap:10px">
      <span>Showing ${page.length} of ${results.length}${results.length >= 200 ? '+' : ''}${
  results.length >= 200 ? ' — narrow the filters to see past the first two hundred' : ''}</span>
      <div class="spacer"></div>
      ${page.length < results.length ? `<button class="sm" data-act="more">Show ${Math.min(PAGE, results.length - page.length)} more</button>` : ''}
    </div>`)}`;
}

/**
 * Where the scouts are, and where they could be.
 *
 * The scarcity is the whole design: two to five of them, and the world has
 * sixteen divisions in it. Pointing them somewhere is a decision with a cost,
 * which is what makes knowing something worth anything.
 */
function scoutingView(app, club) {
  const game = app.game;
  const world = game.world;
  const assignments = game.scoutAssignments || [];
  const max = scoutCount(club);
  const scouted = Object.entries(game.scouted || {})
    .map(([id, row]) => ({ p: world.players[id], k: row.k }))
    .filter((x) => x.p && x.p.clubId !== club.id)
    .sort((a, b) => b.k - a.k)
    .slice(0, 20);

  const describe = (a) => {
    if (a.type === 'league') return world.leagues.find((l) => l.id === a.target)?.name || 'a division';
    if (a.type === 'position') return `${POSITION_LABELS[a.target] || a.target}s, anywhere`;
    return world.players[a.target]?.name || 'a player';
  };
  const weeks = (a) => Math.max(0, Math.floor((game.day - a.started) / 7));

  return `
  ${panel(`Scouts (${assignments.length} of ${max} out)`, `
    <p class="small faint" style="margin-top:0">Your scouting network is
      ${club.facilities.scouting}/20, which pays for ${max} scouts. A better network is
      something the board can be asked for on the Club screen.</p>
    ${assignments.length === 0 ? emptyState('Every scout is idle. Nobody is watching anything.')
    : `<div class="todo">${assignments.map((a) => `<div class="todo-row">
        <span class="pill">${esc(ASSIGNMENT_TYPES[a.type]?.label || a.type)}</span>
        <span class="what">${esc(describe(a))}<span class="faint small">
          — ${weeks(a)} week${weeks(a) === 1 ? '' : 's'} in</span></span>
        <button class="sm" data-recall="${esc(a.id)}">Recall</button>
      </div>`).join('')}</div>`}
    ${assignments.length < max ? `
      <div class="row wrap" style="gap:8px;margin-top:12px;align-items:flex-end">
        <div class="field" style="margin:0"><label>Send a scout to</label>
          <select id="sc-type">${Object.entries(ASSIGNMENT_TYPES).map(([id, t]) => `<option value="${id}">${esc(t.label)}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label>Target</label><select id="sc-target"></select></div>
        <button class="primary sm" data-act="send">Send</button>
      </div>
      <p class="small faint" id="sc-help" style="margin-bottom:0"></p>`
    : '<p class="small faint" style="margin-bottom:0">Every scout is out. Recall one to send him elsewhere.</p>'}`)}

  ${panelTight('What you know', scouted.length === 0
    ? emptyState('Nothing yet. Players at your own club and in your own division are known to you '
      + 'without a scout; everyone else is a name until somebody watches him.')
    : `<div class="table-wrap"><table>
      <thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th><th>Club</th>
        <th>How well you know him</th><th class="num">Ability</th></tr></thead>
      <tbody>${scouted.map(({ p, k }) => {
    const c = p.clubId ? world.clubs[p.clubId] : null;
    const band = fogBand(game, world, club, p, currentAbility(p));
    return `<tr class="clickable" data-player="${esc(p.id)}">
          <td class="nowrap">${esc(p.name)}</td>
          <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
          <td class="num">${p.age}</td>
          <td class="small nowrap">${c ? esc(c.short) : '<span class="faint">Free agent</span>'}</td>
          <td class="small">${bar(k, k >= 75 ? '' : k >= 40 ? 'warn' : 'bad')}
            <span class="faint small">${esc(knowledgeLabel(k))}</span></td>
          <td class="num">${estimateCell(band)}</td>
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
