// Three squads, one screen: the first team, the reserve side and the academy.
//
// The reason this exists is the problem you named — in most football games the
// players outside your XI are dead weight on a list you scroll past. Here they
// are somewhere: registered or not, playing every week for the reserves, or
// still in the academy with their potential fogged.

import { esc, panel, panelTight, kv, tabs, toast, emptyState, badge, openModal } from '../components.js';
import {
  userClub, sendToReserves, recallFromReserves, setRegistration, reserveSideOf,
  promoteFromAcademy, releaseFromAcademy, acceptsReserveTerms, applyReserveRemit,
} from '../../state/game.js';
import { registrationLimit } from '../../engine/lineup.js';
import { currentAbility, starRating } from '../../data/attributes.js';
import { expectedRole, ROLE_LABELS } from '../../engine/training.js';
import { sortBy, money } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';

const VIEWS = [
  { id: 'first', label: 'First Team' },
  { id: 'reserves', label: 'Reserves' },
  { id: 'academy', label: 'Academy' },
];

const REMITS = [
  { id: 'youth', label: 'Develop youth', help: 'The coach picks the youngest players who can cope, whatever the result.' },
  { id: 'balanced', label: 'Balanced', help: 'Youth where they are ready, experience where they are needed.' },
  { id: 'compete', label: 'Compete', help: 'The strongest available side. Results first, minutes for prospects second.' },
];

/**
 * A scholar's potential is a range, not a number.
 *
 * Your own players used to show an exact potential while everyone else's was a
 * scouting estimate — which made the academy a spreadsheet rather than a
 * judgement. The width of the range narrows with your youth facilities.
 */
function fogged(club, p) {
  const spread = Math.max(6, Math.round(34 - (club.facilities?.youth ?? 10) * 1.3));
  const lo = Math.max(currentAbility(p), p.pa - spread);
  const hi = Math.min(198, p.pa + Math.round(spread * 0.4));
  return `${starRating(lo).toFixed(1)}–${starRating(hi).toFixed(1)}★`;
}

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('You are not currently managing a club.'), mount() {} };

  const state = app.screenState.squads || (app.screenState.squads = { view: 'first' });
  const reserve = reserveSideOf(world, club);
  let body;
  if (state.view === 'reserves') body = reservesView(app, world, club, reserve);
  else if (state.view === 'academy') body = academyView(app, world, club);
  else body = firstTeamView(app, world, club, reserve);

  return {
    html: `${tabs(VIEWS, state.view)}${body}`,
    mount(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => { state.view = t.dataset.tab; app.refresh(); };
      });
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = (e) => { if (!e.target.closest('button')) showPlayer(app, el.dataset.player); };
      });
      root.querySelectorAll('[data-send]').forEach((b) => {
        b.onclick = (e) => { e.stopPropagation(); confirmSend(app, club, b.dataset.send); };
      });
      root.querySelectorAll('[data-recall]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const err = recallFromReserves(game, b.dataset.recall);
          toast(err || 'Recalled to the first team.');
          app.refresh();
        };
      });
      root.querySelectorAll('[data-promote]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const err = promoteFromAcademy(game, b.dataset.promote);
          toast(err || 'Promoted to the first team.');
          app.refresh();
        };
      });
      root.querySelectorAll('[data-release]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const err = releaseFromAcademy(game, b.dataset.release);
          toast(err || 'Released.');
          app.refresh();
        };
      });
      root.querySelectorAll('[data-reg]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const id = b.dataset.reg;
          const list = [...(club.registration || [])];
          const i = list.indexOf(id);
          if (i >= 0) list.splice(i, 1);
          else {
            if (list.length >= registrationLimit(club)) { toast('Your registered squad is already full.'); return; }
            list.push(id);
          }
          setRegistration(game, list);
          app.refresh();
        };
      });
      const remit = root.querySelector('#reserve-remit');
      if (remit && reserve) {
        remit.onchange = () => {
          reserve.reserveRemit = remit.value;
          applyReserveRemit(world, reserve);
          toast('Reserve-team remit updated.');
          app.refresh();
        };
      }
    },
  };
}

function confirmSend(app, club, playerId) {
  const world = app.game.world;
  const p = world.players[playerId];
  if (!p) return;
  const willing = acceptsReserveTerms(world, club, p);
  const send = () => {
    const err = sendToReserves(app.game, playerId);
    toast(err || `${p.name} has dropped to the reserves.`);
    app.refresh();
  };
  // A senior professional refusing reserve terms is the balance guard, so say so
  // plainly rather than letting the manager find out from his morale later.
  if (!willing) {
    openModal({
      title: 'He will not accept reserve terms',
      narrow: true,
      body: `<p>${esc(p.name)} is an established member of this squad. He has not signed a two-way contract, `
        + `so he keeps his full <b>${money(p.contract?.wage || 0)}/week</b> wherever he plays — sending him down `
        + 'saves the club nothing, and he will take it badly.</p>',
      footer: '<button class="primary" data-go>Send him anyway</button><button class="ghost" data-close>Cancel</button>',
      onMount(modal, close) {
        modal.querySelector('[data-go]').onclick = () => { send(); close(); };
      },
    });
    return;
  }
  send();
}

function firstTeamView(app, world, club, reserve) {
  const limit = registrationLimit(club);
  const squad = sortBy(club.squad.map((id) => world.players[id]).filter(Boolean),
    { key: (p) => currentAbility(p), desc: true });
  const registered = new Set(club.registration || []);

  return `${panel('Registration', `
    <p class="small faint">You may hold as many players as you like, but only ${limit} can be registered
      for matches. Anyone left out cannot be selected, and anyone good enough to expect a game will
      not be happy about it.</p>
    ${kv([
    ['Squad', `${club.squad.length} players`],
    ['Registered', `${registered.size} of ${limit}`],
    ['Reserve side', reserve ? reserve.name : 'None — propose one to the board on the Club screen'],
  ])}`)}

  ${panelTight('First-team squad', `<div class="table-wrap"><table>
    <thead><tr><th></th><th>Player</th><th class="num">Age</th><th>Pos</th><th class="num">Ability</th>
      <th>Squad role</th><th>Status</th><th class="right">Actions</th></tr></thead>
    <tbody>${squad.map((p) => {
    const isReg = registered.has(p.id);
    return `<tr class="clickable" data-player="${esc(p.id)}">
      <td class="num faint">${p.squadNumber ?? '—'}</td>
      <td class="nowrap">${esc(p.name)}</td>
      <td class="num">${p.age}</td>
      <td class="small faint">${esc(p.positions.join('/'))}</td>
      <td class="num">${currentAbility(p)}</td>
      <td class="small faint">${esc(ROLE_LABELS[expectedRole(world, club, p)])}</td>
      <td class="small ${isReg ? 'good' : 'bad'}">${isReg ? 'Registered' : 'Not registered'}</td>
      <td class="right nowrap">
        <button class="ghost small" data-reg="${esc(p.id)}">${isReg ? 'Deregister' : 'Register'}</button>
        ${reserve ? `<button class="ghost small" data-send="${esc(p.id)}">To reserves</button>` : ''}
      </td></tr>`;
  }).join('')}</tbody></table></div>`)}`;
}

function reservesView(app, world, club, reserve) {
  if (!reserve) {
    return emptyState('Your club has no reserve side. A reserve team gives your fringe and younger '
      + 'players real league football instead of a place on a list — propose one to the board from the Club screen.');
  }
  const league = world.leagues.find((l) => l.id === reserve.leagueId);
  const table = league?.table ? [...league.table].sort((a, b) => b.pts - a.pts || b.gd - a.gd) : [];
  const pos = table.findIndex((r) => r.clubId === reserve.id) + 1;
  const row = table[pos - 1];
  const squad = sortBy(reserve.squad.map((id) => world.players[id]).filter(Boolean),
    { key: (p) => currentAbility(p), desc: true });
  const remit = reserve.reserveRemit || 'balanced';

  return `<div class="grid c1-2">
    ${panel('Reserve side', `<div class="row" style="gap:12px;margin-bottom:10px">${badge(reserve, 40)}
      <div><div><b>${esc(reserve.name)}</b></div><div class="small faint">${esc(league?.name || '')}</div></div></div>
      ${kv([
    ['Position', pos ? `${pos} of ${table.length}` : '—'],
    ['Record', row ? `${row.w}W ${row.d}D ${row.l}L` : '—'],
    ['Squad', `${reserve.squad.length} players`],
  ])}
      <div class="field"><label>Remit</label><select id="reserve-remit">
        ${REMITS.map((r) => `<option value="${esc(r.id)}" ${r.id === remit ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
      </select></div>
      <p class="small faint">${esc(REMITS.find((r) => r.id === remit)?.help || '')}</p>
      <p class="small faint">The reserve coach picks the side. You decide who is available to him.</p>`)}

    ${panelTight('Recent form', league?.table
    ? `<div class="table-wrap"><table><thead><tr><th class="num">#</th><th>Club</th><th class="num">P</th><th class="num">Pts</th></tr></thead>
      <tbody>${table.slice(0, 8).map((r, i) => {
      const c = world.clubs[r.clubId];
      return `<tr${r.clubId === reserve.id ? ' style="font-weight:600"' : ''}>
        <td class="num faint">${i + 1}</td><td class="nowrap">${esc(c?.short || '')}</td>
        <td class="num">${r.p}</td><td class="num">${r.pts}</td></tr>`;
    }).join('')}</tbody></table></div>`
    : '<p class="small faint">The season has not started.</p>')}
  </div>

  ${panelTight('Reserve squad', `<div class="table-wrap"><table>
    <thead><tr><th>Player</th><th class="num">Age</th><th>Pos</th><th class="num">Ability</th>
      <th class="num">Apps</th><th class="num">Goals</th><th class="num">Wage</th><th class="right"></th></tr></thead>
    <tbody>${squad.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
      <td class="nowrap">${esc(p.name)}</td>
      <td class="num">${p.age}</td>
      <td class="small faint">${esc(p.positions.join('/'))}</td>
      <td class="num">${currentAbility(p)}</td>
      <td class="num">${p.season?.apps ?? 0}</td>
      <td class="num">${p.season?.goals ?? 0}</td>
      <td class="num small">${money(p.contract?.wageReserve || p.contract?.wage || 0)}</td>
      <td class="right"><button class="ghost small" data-recall="${esc(p.id)}">Recall</button></td>
    </tr>`).join('')}</tbody></table></div>`)}`;
}

function academyView(app, world, club) {
  const scholars = sortBy((club.youthSquad || []).map((id) => world.players[id]).filter(Boolean),
    { key: (p) => p.pa, desc: true });
  if (!scholars.length) {
    return emptyState('No scholars at the moment. The academy produces a new intake each March — '
      + 'better youth facilities and a manager who knows how to coach youngsters mean a better crop.');
  }
  return `${panel('Academy', `<p class="small faint">Scholars do not count against your registration limit.
    Their potential is an estimate from your coaches, not a certainty — better youth facilities narrow the range.
    Anyone still here at twenty leaves on a free.</p>
    ${kv([
    ['Scholars', `${scholars.length}`],
    ['Youth facilities', `${club.facilities.youth}/20`],
  ])}`)}

  ${panelTight('Scholars', `<div class="table-wrap"><table>
    <thead><tr><th>Player</th><th class="num">Age</th><th>Pos</th><th class="num">Ability</th>
      <th>Potential</th><th class="right">Actions</th></tr></thead>
    <tbody>${scholars.map((p) => `<tr class="clickable" data-player="${esc(p.id)}">
      <td class="nowrap">${esc(p.name)}</td>
      <td class="num">${p.age}</td>
      <td class="small faint">${esc(p.positions.join('/'))}</td>
      <td class="num">${currentAbility(p)}</td>
      <td class="small">${esc(fogged(club, p))}</td>
      <td class="right nowrap">
        <button class="ghost small" data-promote="${esc(p.id)}">Promote</button>
        <button class="ghost small" data-release="${esc(p.id)}">Release</button>
      </td></tr>`).join('')}</tbody></table></div>`)}`;
}
