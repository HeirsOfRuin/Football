// The manager's inbox.

import { esc, panelTight, emptyState, shortDate, tabs } from '../components.js';
import { NEWS_CATEGORIES, markAllRead } from '../../engine/news.js';
import { showMatchReport } from './fixtures.js';
import { showPlayer } from '../playerProfile.js';

export function render(app) {
  const game = app.game;
  const world = game.world;
  const state = app.screenState.inbox || (app.screenState.inbox = { category: 'all', selected: null });
  if (app.params.newsId) { state.selected = app.params.newsId; app.params = {}; }

  const categories = [{ id: 'all', label: 'All' }, ...Object.entries(NEWS_CATEGORIES).map(([id, label]) => ({ id, label }))];
  const items = state.category === 'all' ? game.inbox : game.inbox.filter((n) => n.category === state.category);
  const selected = game.inbox.find((n) => n.id === state.selected) || items[0];
  if (selected) selected.read = true;

  return {
    html: `
      ${tabs(categories, state.category)}
      <div class="grid c1-2">
        ${panelTight('Messages', items.length === 0 ? emptyState('Nothing here.')
    : `<div class="scroll-y" style="max-height:600px">${items.map((n) => `
          <div class="inbox-item ${n.read ? '' : 'unread'} ${selected && n.id === selected.id ? 'highlight' : ''}" data-news="${esc(n.id)}">
            <span class="dot ${n.read ? 'hidden' : ''}"></span>
            <div style="min-width:0;flex:1"><div class="subject">${esc(n.title)}</div>
              <div class="preview">${esc(n.body)}</div></div>
            <span class="when">${esc(shortDate(n.day, world.year))}</span>
          </div>`).join('')}</div>`,
    '<button class="sm" data-act="readall">Mark all read</button>')}

        ${selected ? panelTight(selected.title, `<div class="panel-body">
          <div class="small faint" style="margin-bottom:10px">
            ${esc(NEWS_CATEGORIES[selected.category] || selected.category)} · ${esc(shortDate(selected.day, world.year))}
          </div>
          <p style="white-space:pre-wrap">${esc(selected.body)}</p>
          <div class="row" style="gap:8px;margin-top:14px">
            ${selected.fixtureId && game.fixtures[selected.fixtureId]?.played ? '<button class="sm" data-act="report">View match report</button>' : ''}
            ${selected.playerId && world.players[selected.playerId] ? '<button class="sm" data-act="player">View player</button>' : ''}
          </div>
        </div>`) : panelTight('Message', emptyState('Select a message.'))}
      </div>`,

    mount(root) {
      root.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => { state.category = t.dataset.tab; state.selected = null; app.refresh(); };
      });
      root.querySelectorAll('[data-news]').forEach((el) => {
        el.onclick = () => { state.selected = el.dataset.news; app.refresh(); };
      });
      const readall = root.querySelector('[data-act="readall"]');
      if (readall) readall.onclick = (e) => { e.stopPropagation(); markAllRead(game); app.refresh(); };
      const report = root.querySelector('[data-act="report"]');
      if (report) report.onclick = () => showMatchReport(app, game.fixtures[selected.fixtureId]);
      const player = root.querySelector('[data-act="player"]');
      if (player) player.onclick = () => showPlayer(app, selected.playerId);
    },
  };
}
