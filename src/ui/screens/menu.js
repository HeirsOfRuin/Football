// Main menu, new-game setup and the load screen.

import { html, esc, panel, toast, money, badge, openModal, confirmDialog } from '../components.js';
import { WORLD_SIZES, NATIONS } from '../../data/nations.js';
import { newGame, takeOverClub } from '../../state/game.js';
import { squadStrength } from '../../gen/worldgen.js';
import { listSaves, loadGame, deleteSave, importGameFile } from '../../state/store.js';
import { listLibrary } from '../../state/library.js';
import { sortBy } from '../../core/util.js';
import { currentAbility } from '../../data/attributes.js';

let mode = 'main';
let setup = null;
let previewGame = null;

export function render(app) {
  if (mode === 'setup') return renderSetup(app);
  if (mode === 'pickClub') return renderPickClub(app);
  if (mode === 'load') return renderLoad(app);
  return renderMain(app);
}

function renderMain(app) {
  const hasGame = !!app.game;
  return {
    html: `<div class="menu-screen"><div class="menu-card">
      <div class="logo"><h1>Touchline</h1><p>Football management, simulated</p></div>
      ${hasGame ? '<button class="menu-btn primary" data-act="resume">Resume<small>Return to your current save</small></button>' : ''}
      <button class="menu-btn" data-act="new">New Career<small>Build a world and take a job</small></button>
      <button class="menu-btn" data-act="load">Load Game<small>Continue a saved career</small></button>
      <button class="menu-btn" data-act="library">Player Library<small>Create and manage your own players</small></button>
      <p class="faint small center" style="margin-top:22px">
        A management simulation: you pick the squad, the shape and the transfers.
        Matches play themselves — you watch, and you intervene.
      </p>
    </div></div>`,
    mount(root) {
      root.querySelector('[data-act="new"]').onclick = () => {
        setup = {
          managerName: app.settings.lastManagerName || '',
          managerNat: app.settings.lastManagerNat || 'ALB',
          size: 'medium',
          seed: '',
          customIds: [],
          placement: 'free',
        };
        mode = 'setup';
        app.render();
      };
      root.querySelector('[data-act="load"]').onclick = () => { mode = 'load'; app.render(); };
      root.querySelector('[data-act="library"]').onclick = () => { mode = 'main'; app.go('library'); };
      const resume = root.querySelector('[data-act="resume"]');
      if (resume) resume.onclick = () => { mode = 'main'; app.go('dashboard'); };
    },
  };
}

function renderSetup(app) {
  const library = listLibrary();
  return {
    html: `<div class="menu-screen"><div class="menu-card setup-wide">
      <div class="logo"><h1>New Career</h1></div>
      <div class="grid c2">
        <section class="panel"><div class="panel-head"><h2>Manager</h2></div><div class="panel-body">
          <div class="field"><label>Name</label><input id="mgr-name" value="${esc(setup.managerName)}" placeholder="Your name" maxlength="32"></div>
          <div class="field"><label>Nationality</label><select id="mgr-nat">
            ${NATIONS.map((n) => `<option value="${n.id}" ${n.id === setup.managerNat ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}
          </select></div>
        </div></section>
        <section class="panel"><div class="panel-head"><h2>World</h2></div><div class="panel-body">
          <div class="field"><label>Size</label><select id="world-size">
            ${Object.entries(WORLD_SIZES).map(([k, v]) => `<option value="${k}" ${k === setup.size ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
          </select><p class="faint small" style="margin:5px 0 0">Bigger worlds mean more clubs, deeper transfer markets and slower simulation.</p></div>
          <div class="field"><label>Seed (optional)</label><input id="world-seed" value="${esc(setup.seed)}" placeholder="Leave blank for random"></div>
        </div></section>
      </div>

      <section class="panel"><div class="panel-head"><h2>Your Created Players</h2><div class="spacer"></div>
        <button class="sm" data-act="library">Open library</button></div>
        <div class="panel-body">
        ${library.length === 0
    ? '<p class="faint small">Your player library is empty. Anything you create there can be dropped into a new world here.</p>'
    : `<p class="faint small" style="margin-top:0">Tick the players you want to exist in this world.</p>
          <div class="scroll-y h-260" style="border:1px solid var(--line);border-radius:6px">
          <table><thead><tr><th style="width:34px"></th><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">Ability</th><th class="num">Potential</th></tr></thead><tbody>
          ${library.map((p) => {
      const ca = currentAbility({ ...p, _ca: null });
      return `<tr><td><input type="checkbox" class="cust-pick" value="${esc(p.id)}" ${setup.customIds.includes(p.id) ? 'checked' : ''}></td>
              <td>${esc(p.name)}</td><td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
              <td class="num">${p.age}</td><td class="num">${ca}</td><td class="num">${p.pa}</td></tr>`;
    }).join('')}
          </tbody></table></div>
          <div class="field" style="margin-top:12px"><label>Where should they start?</label><select id="placement">
            <option value="free" ${setup.placement === 'free' ? 'selected' : ''}>As free agents — sign them yourself</option>
            <option value="auto" ${setup.placement === 'auto' ? 'selected' : ''}>At a club that matches their ability</option>
          </select></div>`}
        </div></section>

      <div class="row" style="justify-content:flex-end;gap:10px;margin-top:6px">
        <button data-act="back">Back</button>
        <button class="primary" data-act="create">Create World</button>
      </div>
    </div></div>`,
    mount(root) {
      const readForm = () => {
        setup.managerName = root.querySelector('#mgr-name').value.trim();
        setup.managerNat = root.querySelector('#mgr-nat').value;
        setup.size = root.querySelector('#world-size').value;
        setup.seed = root.querySelector('#world-seed').value.trim();
        const placement = root.querySelector('#placement');
        if (placement) setup.placement = placement.value;
        setup.customIds = [...root.querySelectorAll('.cust-pick:checked')].map((c) => c.value);
      };
      root.querySelector('[data-act="back"]').onclick = () => { mode = 'main'; app.render(); };
      const lib = root.querySelector('[data-act="library"]');
      if (lib) lib.onclick = () => { readForm(); mode = 'main'; app.go('library'); };
      root.querySelector('[data-act="create"]').onclick = () => {
        readForm();
        if (!setup.managerName) { toast('Enter a manager name.', 'warn'); return; }
        app.setSetting('lastManagerName', setup.managerName);
        app.setSetting('lastManagerNat', setup.managerNat);
        const all = listLibrary();
        const chosen = all.filter((p) => setup.customIds.includes(p.id));
        app.showLoading('Building the football world…');
        setTimeout(() => {
          const seed = setup.seed
            ? [...setup.seed].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)
            : Math.floor(Math.random() * 2 ** 31);
          previewGame = newGame({
            seed,
            size: setup.size,
            managerName: setup.managerName,
            managerNat: setup.managerNat,
            clubId: null,
            customPlayers: chosen,
            customPlacement: setup.placement,
          });
          mode = 'pickClub';
          app.render();
        }, 40);
      };
    },
  };
}

function renderPickClub(app) {
  const world = previewGame.world;
  const leagues = sortBy(world.leagues, (l) => l.nation, (l) => l.tier);
  const state = app.screenState.pickClub || (app.screenState.pickClub = { leagueId: leagues[0].id });
  const league = world.leagues.find((l) => l.id === state.leagueId) || leagues[0];
  const clubs = sortBy(league.clubIds.map((id) => world.clubs[id]), { key: (c) => squadStrength(world, c), desc: true });

  return {
    html: `<div class="menu-screen"><div class="menu-card setup-wide">
      <div class="logo"><h1>Choose a Club</h1><p>${esc(previewGame.manager.name)} — ${world.year}/${String(world.year + 1).slice(2)}</p></div>
      <div class="field"><label>Division</label><select id="league-pick">
        ${leagues.map((l) => `<option value="${l.id}" ${l.id === league.id ? 'selected' : ''}>${esc(l.name)} (tier ${l.tier})</option>`).join('')}
      </select></div>
      <section class="panel"><div class="panel-body tight"><div class="scroll-y h-420">
        <table><thead><tr><th></th><th>Club</th><th>City</th><th class="num">Reputation</th><th class="num">Squad</th>
          <th class="num">Wage budget</th><th class="num">Transfers</th><th>Expectation</th><th></th></tr></thead><tbody>
        ${clubs.map((c) => `<tr>
          <td>${badge(c, 22)}</td>
          <td class="nowrap">${esc(c.name)}</td>
          <td class="small faint">${esc(c.city)}</td>
          <td class="num">${c.rep}</td>
          <td class="num">${Math.round(squadStrength(world, c))}</td>
          <td class="num">${money(c.finances.wageBudgetAnnual / 52)}/w</td>
          <td class="num">${money(c.finances.transferBudget)}</td>
          <td class="small">${esc(c.board.expectation.label)}</td>
          <td><button class="sm primary" data-take="${esc(c.id)}">Take job</button></td>
        </tr>`).join('')}
        </tbody></table>
      </div></div></section>
      <div class="row" style="justify-content:space-between;margin-top:6px">
        <button data-act="back">Back</button>
        <span class="faint small">${world.leagues.length} divisions, ${Object.keys(world.clubs).length} clubs, ${Object.keys(world.players).length.toLocaleString()} players</span>
      </div>
    </div></div>`,
    mount(root) {
      root.querySelector('#league-pick').onchange = (e) => {
        state.leagueId = e.target.value;
        app.render();
      };
      root.querySelector('[data-act="back"]').onclick = () => { mode = 'setup'; previewGame = null; app.render(); };
      root.querySelectorAll('[data-take]').forEach((btn) => {
        btn.onclick = async () => {
          const club = world.clubs[btn.dataset.take];
          const ok = await confirmDialog('Take the job?',
            `Manage ${club.name}? The board expect you to ${club.board.expectation.label.toLowerCase()}.`, 'Accept');
          if (!ok) return;
          takeOverClub(previewGame, club.id, previewGame.manager.name, previewGame.manager.nat);
          app.game = previewGame;
          app.currentSlot = `slot_${Date.now().toString(36)}`;
          previewGame = null;
          mode = 'main';
          app.go('dashboard');
          app.autosave();
        };
      });
    },
  };
}

function renderLoad(app) {
  const state = app.screenState.load || (app.screenState.load = { saves: null });
  if (state.saves === null) {
    listSaves().then((s) => { state.saves = s; app.render(); });
    return { html: '<div class="loading"><div><div class="spin"></div><div>Reading saves…</div></div></div>' };
  }
  return {
    html: `<div class="menu-screen"><div class="menu-card">
      <div class="logo"><h1>Load Game</h1></div>
      ${state.saves.length === 0 ? '<p class="faint center">No saved careers yet.</p>' : state.saves.map((s) => `
        <button class="menu-btn" data-slot="${esc(s.slot)}">
          ${esc(s.club)} — ${esc(s.league || '')}
          <small>${esc(s.manager)} · Season ${s.season} (${s.year}/${String(s.year + 1).slice(2)}) · saved ${new Date(s.savedAt).toLocaleString()}</small>
        </button>`).join('')}
      <div class="row" style="gap:10px;margin-top:16px">
        <button data-act="back">Back</button>
        <div class="spacer"></div>
        <button data-act="import">Import save file</button>
        ${state.saves.length ? '<button class="danger" data-act="delete">Delete a save</button>' : ''}
      </div>
      <input type="file" id="save-file" accept="application/json" hidden>
    </div></div>`,
    mount(root) {
      root.querySelector('[data-act="back"]').onclick = () => { mode = 'main'; state.saves = null; app.render(); };
      root.querySelectorAll('[data-slot]').forEach((b) => {
        b.onclick = async () => {
          app.showLoading('Loading save…');
          const game = await loadGame(b.dataset.slot);
          if (!game) { toast('Could not read that save.', 'bad'); mode = 'load'; state.saves = null; app.render(); return; }
          app.game = game;
          app.currentSlot = b.dataset.slot;
          mode = 'main';
          app.go('dashboard');
        };
      });
      const fileInput = root.querySelector('#save-file');
      root.querySelector('[data-act="import"]').onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const f = fileInput.files[0];
        if (!f) return;
        try {
          app.showLoading('Importing save…');
          app.game = await importGameFile(f);
          app.currentSlot = `slot_${Date.now().toString(36)}`;
          mode = 'main';
          app.go('dashboard');
          toast('Save imported.');
        } catch (err) {
          toast(err.message, 'bad', 6000);
          mode = 'load'; state.saves = null; app.render();
        }
      };
      const del = root.querySelector('[data-act="delete"]');
      if (del) {
        del.onclick = () => {
          openModal({
            title: 'Delete a save',
            narrow: true,
            body: state.saves.map((s) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line-soft)">
              <span>${esc(s.club)} — season ${s.season}</span><div class="spacer"></div>
              <button class="sm danger" data-del="${esc(s.slot)}">Delete</button></div>`).join(''),
            onMount(modal, close) {
              modal.querySelectorAll('[data-del]').forEach((b) => {
                b.onclick = async () => {
                  await deleteSave(b.dataset.del);
                  close();
                  state.saves = null;
                  app.render();
                  toast('Save deleted.');
                };
              });
            },
          });
        };
      }
    },
  };
}

export function resetMenu() { mode = 'main'; previewGame = null; }
