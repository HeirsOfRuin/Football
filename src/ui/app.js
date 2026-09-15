// Application shell: navigation, the Continue loop, saving and screen routing.

import { newGame, advanceDay, endSeason, rolloverSeason, userClub, nextFixtureFor, sackManager, availableJobs, takeOverClub } from '../state/game.js';
import { SEASON_DAYS, formatDay, transferWindowOpen } from '../core/calendar.js';
import { saveGame, loadGame, loadSettings, saveSettings, exportGameFile } from '../state/store.js';
import { unreadCount } from '../engine/news.js';
import { money } from '../core/util.js';
import { badge, toast, closeAllModals, esc, openModal } from './components.js';

import * as menuScreen from './screens/menu.js';
import * as libraryScreen from './screens/library.js';
import * as dashboardScreen from './screens/dashboard.js';
import * as squadScreen from './screens/squad.js';
import * as tacticsScreen from './screens/tactics.js';
import * as trainingScreen from './screens/training.js';
import * as squadsScreen from './screens/squads.js';
import * as fixturesScreen from './screens/fixtures.js';
import * as leagueScreen from './screens/league.js';
import * as transfersScreen from './screens/transfers.js';
import * as financesScreen from './screens/finances.js';
import * as clubScreen from './screens/club.js';
import * as worldScreen from './screens/world.js';
import * as inboxScreen from './screens/inbox.js';
import * as matchScreen from './screens/match.js';

const SCREENS = {
  menu: menuScreen,
  library: libraryScreen,
  dashboard: dashboardScreen,
  squad: squadScreen,
  tactics: tacticsScreen,
  training: trainingScreen,
  squads: squadsScreen,
  fixtures: fixturesScreen,
  league: leagueScreen,
  transfers: transfersScreen,
  finances: financesScreen,
  club: clubScreen,
  world: worldScreen,
  inbox: inboxScreen,
  match: matchScreen,
};

const NAV = [
  { id: 'dashboard', label: 'Home' },
  { id: 'inbox', label: 'Inbox', badge: (app) => unreadCount(app.game) },
  { sep: true },
  // "Players" is the list of people and their contracts; "Squads" is which of
  // the three squads each of them is in. Both were called Squad, which read as a
  // duplicate nav entry rather than two different jobs.
  { id: 'squad', label: 'Players' },
  { id: 'tactics', label: 'Tactics' },
  { id: 'squads', label: 'Squads' },
  { id: 'training', label: 'Training' },
  { id: 'club', label: 'Club' },
  { sep: true },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'league', label: 'Competitions' },
  { id: 'world', label: 'World' },
  { sep: true },
  { id: 'transfers', label: 'Transfers' },
  { id: 'finances', label: 'Finances' },
];

export const app = {
  game: null,
  screen: 'menu',
  params: {},
  settings: loadSettings(),
  matchState: null,
  busy: false,
  screenState: {},

  go(screen, params = {}) {
    closeAllModals();
    this.screen = screen;
    this.params = params;
    this.render();
    const content = document.querySelector('.content');
    if (content) content.scrollTop = 0;
  },

  /** Re-render the current screen without resetting scroll. */
  refresh() {
    const content = document.querySelector('.content');
    const scroll = content ? content.scrollTop : 0;
    this.render();
    const after = document.querySelector('.content');
    if (after) after.scrollTop = scroll;
  },

  render() {
    const root = document.getElementById('app');
    const mod = SCREENS[this.screen] || SCREENS.menu;

    if (!this.game || this.screen === 'menu' || this.screen === 'library' || this.screen === 'match') {
      const view = mod.render(this);
      root.innerHTML = view.html;
      if (view.mount) view.mount(root, this);
      return;
    }

    const view = mod.render(this);
    root.innerHTML = this.shellHtml(view);
    this.bindShell(root);
    const content = root.querySelector('.content');
    if (view.mount) view.mount(content, this);
  },

  shellHtml(view) {
    const game = this.game;
    const club = userClub(game);
    const next = club ? nextFixtureFor(game, club.id) : null;
    const opponent = next ? game.world.clubs[next.homeId === club.id ? next.awayId : next.homeId] : null;
    const windowOpen = transferWindowOpen(game.day);

    return `<div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>Touchline</h1>
          <div class="club-strip">${badge(club, 30)}
            <div class="club-name">${esc(club ? club.name : 'Unemployed')}<br><span class="faint small">${esc(game.manager.name)}</span></div>
          </div>
        </div>
        <nav class="nav">
          ${NAV.map((n) => {
    if (n.sep) return '<div class="nav-sep"></div>';
    const count = n.badge ? n.badge(this) : 0;
    const countLabel = count > 99 ? '99+' : count;
    return `<div class="nav-item ${this.screen === n.id ? 'active' : ''}" data-nav="${n.id}">
              <span class="lbl">${esc(n.label)}</span>${count ? `<span class="count">${countLabel}</span>` : ''}
            </div>`;
  }).join('')}
          <div class="nav-sep"></div>
          <div class="nav-item" data-action="save"><span class="lbl">Save</span></div>
          <div class="nav-item" data-action="settings"><span class="lbl">Settings</span></div>
          <div class="nav-item" data-nav="menu"><span class="lbl">Main Menu</span></div>
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="date">${esc(formatDay(game.day, game.world.year))}</div>
          ${windowOpen ? '<span class="pill info">Transfer window open</span>' : ''}
          <div class="spacer"></div>
          ${club ? `<div class="stat">Balance<b>${money(club.finances.balance)}</b></div>
          <div class="stat">Transfer budget<b>${money(club.finances.transferBudget)}</b></div>` : ''}
          ${next && opponent ? `<div class="stat">Next<b>${next.homeId === club.id ? 'v' : 'at'} ${esc(opponent.short)}</b></div>` : ''}
          <button class="primary" data-action="continue" title="Space" ${this.busy ? 'disabled' : ''}>${next && next.day === game.day ? 'Play Match' : 'Continue'}</button>
        </header>
        <div class="content ${view.noPad ? 'no-pad' : ''}">${view.html}</div>
      </main>
    </div>`;
  },

  bindShell(root) {
    root.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', () => this.go(el.dataset.nav));
    });
    const cont = root.querySelector('[data-action="continue"]');
    if (cont) cont.addEventListener('click', () => this.advance());
    const save = root.querySelector('[data-action="save"]');
    if (save) save.addEventListener('click', () => this.save());
    const settings = root.querySelector('[data-action="settings"]');
    if (settings) settings.addEventListener('click', () => this.showSettings());
  },

  /** Space advances the calendar — the action this game asks for most often. */
  bindKeys() {
    if (this._keysBound) return;
    this._keysBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Spacebar') return;
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (document.querySelector('.modal-backdrop')) return;
      if (!this.game || this.screen === 'menu' || this.screen === 'library') return;
      e.preventDefault();
      if (this.screen === 'match') {
        const play = document.getElementById('m-play');
        if (play) play.click();
        return;
      }
      const cont = document.querySelector('[data-action="continue"]');
      if (cont && !cont.disabled) cont.click();
    });
  },

  showSettings() {
    const s = this.settings;
    openModal({
      title: 'Settings',
      narrow: true,
      body: `
        <div class="field"><label>Continue button</label><select id="set-pace">
          <option value="skip" ${s.dayAtATime ? '' : 'selected'}>Advance to the next thing that needs you</option>
          <option value="day" ${s.dayAtATime ? 'selected' : ''}>Advance one day at a time</option>
        </select></div>
        <div class="field"><label>Default match speed</label><select id="set-speed">
          ${['slow', 'normal', 'fast', 'instant'].map((k) => `<option value="${k}" ${(s.matchSpeed || 'normal') === k ? 'selected' : ''}>${k === 'instant' ? 'Skip to result' : k[0].toUpperCase() + k.slice(1)}</option>`).join('')}
        </select></div>
        <div class="field"><label><input type="checkbox" id="set-autosave" ${s.autosave === false ? '' : 'checked'}> Autosave after each match and each day</label></div>
        <p class="small faint">Press <b>Space</b> to continue, or to start and pause a match.</p>`,
      footer: '<button data-act="export">Export save file</button><button class="primary" data-close>Done</button>',
      onMount: (modal) => {
        modal.querySelector('#set-pace').onchange = (e) => this.setSetting('dayAtATime', e.target.value === 'day');
        modal.querySelector('#set-speed').onchange = (e) => this.setSetting('matchSpeed', e.target.value);
        modal.querySelector('#set-autosave').onchange = (e) => this.setSetting('autosave', e.target.checked);
        modal.querySelector('[data-act="export"]').onclick = () => {
          exportGameFile(this.game);
          toast('Save file downloaded.');
        };
      },
    });
  },

  /** Advance the calendar until something needs the manager's attention. */
  async advance() {
    if (!this.game || this.busy) return;
    const game = this.game;

    if (game.day >= SEASON_DAYS - 1) {
      await this.runSeasonEnd();
      return;
    }

    // Continue runs the calendar forward until something wants the manager's
    // attention rather than making them click through empty days one at a time.
    this.busy = true;
    const t0 = Date.now();
    const inboxBefore = game.inbox.length;
    let steps = 0;
    let outcome = null;
    const maxSkip = this.settings.dayAtATime ? 1 : 21;
    while (steps < 400) {
      const result = advanceDay(game);
      steps++;
      if (result.stopped) { outcome = result; break; }
      if (game.day >= SEASON_DAYS - 1) { outcome = { stopped: true, reason: 'seasonRollover' }; break; }
      if (steps >= maxSkip) break;
      // Stop for anything the manager would want to act on.
      const fresh = game.inbox.slice(0, game.inbox.length - inboxBefore);
      if (fresh.some((n) => ['board', 'competition', 'youth'].includes(n.category) || n.offerClub)) break;
      if ((game.offers || []).length) break;
      const club = userClub(game);
      const next = club ? nextFixtureFor(game, club.id) : null;
      if (next && next.day <= game.day + 1) break;
      if (Date.now() - t0 > 6000) break;
    }
    this.busy = false;

    if (outcome?.reason === 'userMatch') {
      this.startMatch(game.fixtures[game.pendingMatchId]);
      return;
    }
    if (outcome?.reason === 'seasonReview' || outcome?.reason === 'seasonRollover') {
      await this.runSeasonEnd();
      return;
    }
    this.refresh();
    this.autosave();
  },

  async openJobMarket() {
    const { showJobMarket } = await import('./screens/seasonreview.js');
    showJobMarket(this, availableJobs(this.game), (clubId) => {
      takeOverClub(this.game, clubId, this.game.manager.name, this.game.manager.nat);
      this.go('dashboard');
      this.autosave();
      toast(`You are the new manager of ${this.game.world.clubs[clubId].name}.`);
    });
  },

  startMatch(fixture) {
    this.matchState = null;
    this.go('match', { fixtureId: fixture.id });
  },

  async runSeasonEnd() {
    const game = this.game;
    this.busy = true;
    // Play out any fixtures still outstanding.
    let guard = 0;
    while (game.day < SEASON_DAYS - 1 && guard++ < 400) {
      const r = advanceDay(game);
      if (r.stopped && r.reason === 'userMatch') {
        this.busy = false;
        this.startMatch(game.fixtures[game.pendingMatchId]);
        return;
      }
      if (r.stopped && r.reason === 'seasonRollover') break;
    }
    const summary = endSeason(game);
    this.busy = false;
    const { showSeasonReview, showSackNotice, showJobMarket } = await import('./screens/seasonreview.js');
    showSeasonReview(this, summary, () => {
      if (summary.sacked) {
        const from = summary.sackedFrom;
        const payoff = sackManager(game);
        rolloverSeason(game);
        showSackNotice(this, from, () => this.openJobMarket(), payoff);
        return;
      }
      rolloverSeason(game);
      this.go('dashboard');
      this.autosave();
      toast(`Welcome to the ${game.world.year}/${String(game.world.year + 1).slice(2)} season.`);
    });
  },

  async save(slot) {
    if (!this.game) return;
    const key = slot || this.currentSlot || 'slot1';
    this.currentSlot = key;
    try {
      const meta = await saveGame(key, this.game);
      toast(`Saved — ${meta.club}, ${meta.year}/${String(meta.year + 1).slice(2)}`);
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'bad', 6000);
    }
  },

  autosave() {
    if (this.settings.autosave === false) return;
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      saveGame(this.currentSlot || 'autosave', this.game).catch(() => {});
    }, 900);
  },

  async load(slot) {
    const game = await loadGame(slot);
    if (!game) { toast('Save not found.', 'bad'); return; }
    this.game = game;
    this.currentSlot = slot;
    this.go('dashboard');
    toast('Game loaded.');
  },

  startNewGame(opts) {
    this.showLoading('Building the football world…');
    // Yield so the loading frame paints before the heavy generation runs.
    setTimeout(() => {
      try {
        this.game = newGame(opts);
        this.currentSlot = `slot_${Date.now().toString(36)}`;
        this.go('dashboard');
        this.autosave();
      } catch (err) {
        console.error(err);
        document.getElementById('app').innerHTML = `<div class="menu-screen"><div class="menu-card">
          <p class="bad">Could not create the world: ${esc(err.message)}</p>
          <button class="menu-btn" onclick="location.reload()">Back to menu</button></div></div>`;
      }
    }, 40);
  },

  showLoading(text) {
    document.getElementById('app').innerHTML =
      `<div class="loading"><div><div class="spin"></div><div>${esc(text)}</div></div></div>`;
  },

  setSetting(key, value) {
    this.settings[key] = value;
    saveSettings(this.settings);
  },
};

window.__touchline = app;
app.bindKeys();
app.render();
