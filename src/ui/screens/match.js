// The live match view. The engine is steppable, so the manager can stop at any
// minute to make a change, and must stop at half time for a team talk.

import {
  esc, badge, money, emptyState, openModal, toast, conditionCell, moraleLabel, ratingCell, panelTight,
} from '../components.js';
import { createMatchState, finishFixture, userClub } from '../../state/game.js';
import { stepMatch, makeSubstitution, changeMentality, applyTeamTalk, TICKS_PER_HALF } from '../../engine/match.js';
import { MENTALITIES, ROLES } from '../../data/tactics.js';
import { currentAbility, POSITION_LABELS, familiarity, familiarityLabel } from '../../data/attributes.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';

const SPEEDS = { slow: 260, normal: 110, fast: 35, instant: 0 };

export function render(app) {
  const game = app.game;
  const world = game.world;
  const fixture = game.fixtures[app.params.fixtureId || game.pendingMatchId];
  if (!fixture) return { html: emptyState('No match to play.') };

  if (!app.matchState || app.matchState.fixtureId !== fixture.id) {
    app.matchState = createMatchState(game, fixture);
    app.matchTimer = null;
    app.matchPlaying = false;
    app.halfTimeShown = false;
  }
  const state = app.matchState;
  const home = state.home;
  const away = state.away;
  const userSide = home.clubId === game.userClubId ? home : away.clubId === game.userClubId ? away : null;
  const speed = app.settings.matchSpeed || 'normal';

  return {
    noPad: true,
    html: `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="match-scoreboard">
        <div class="team">${badge(home.club, 40)}<div>
          <div class="tname">${esc(home.club.name)}</div>
          <div class="faint small">${esc(home.tactic.formation)} · ${esc(home.tactic.mentality)}</div></div></div>
        <div>
          <div class="score" id="m-score">${home.goals} - ${away.goals}</div>
          <div class="clock" id="m-clock">${state.finished ? 'Full time' : `${state.minute}'`}</div>
        </div>
        <div class="team away">${badge(away.club, 40)}<div>
          <div class="tname">${esc(away.club.name)}</div>
          <div class="faint small">${esc(away.tactic.formation)} · ${esc(away.tactic.mentality)}</div></div></div>
      </div>
      <div class="timeline" id="m-timeline"></div>

      <div class="row" style="padding:9px 18px;border-bottom:1px solid var(--line);background:var(--bg-raised);gap:10px;flex-wrap:wrap">
        <button class="primary" id="m-play">${state.finished ? 'Continue' : 'Kick off'}</button>
        <select id="m-speed">
          ${Object.keys(SPEEDS).map((s) => `<option value="${s}" ${s === speed ? 'selected' : ''}>${s === 'instant' ? 'Skip to result' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
        ${userSide ? `
          <div class="spacer"></div>
          <select id="m-mentality" ${state.finished ? 'disabled' : ''}>
            ${MENTALITIES.map((m) => `<option ${m === userSide.tactic.mentality ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
          <button id="m-sub" ${state.finished ? 'disabled' : ''}>Substitution (${userSide.subsUsed}/${userSide.subsAllowed})</button>
          <button id="m-talk" ${state.finished ? 'disabled' : ''}>Team talk</button>` : '<div class="spacer"></div>'}
      </div>

      <div style="flex:1;display:grid;grid-template-columns:1fr 320px;overflow:hidden">
        <div class="commentary" id="m-commentary"></div>
        <div style="border-left:1px solid var(--line);overflow-y:auto" id="m-side"></div>
      </div>
    </div>`,

    mount(root) {
      const commentary = root.querySelector('#m-commentary');
      const sidePanel = root.querySelector('#m-side');
      const scoreEl = root.querySelector('#m-score');
      const clockEl = root.querySelector('#m-clock');
      const timelineEl = root.querySelector('#m-timeline');
      const playBtn = root.querySelector('#m-play');
      let renderedEvents = 0;

      const paint = () => {
        scoreEl.textContent = `${home.goals} - ${away.goals}`;
        clockEl.textContent = state.finished ? 'Full time' : state.half === 3 ? `${state.minute}' (ET)` : `${state.minute}'`;
        for (; renderedEvents < state.events.length; renderedEvents++) {
          const e = state.events[renderedEvents];
          if (['kickoff', 'corner', 'offside'].includes(e.type) && e.type !== 'kickoff') continue;
          const div = document.createElement('div');
          div.className = `comm-line ${e.type}`;
          div.innerHTML = `<span class="min">${e.type === 'kickoff' ? '' : `${e.minute}'`}</span><span>${esc(e.text)}</span>`;
          commentary.appendChild(div);
        }
        commentary.scrollTop = commentary.scrollHeight;
        timelineEl.innerHTML = state.events.filter((e) => e.type === 'goal')
          .map((e) => `<i class="${e.side}" style="left:${Math.min(99, (e.minute / 95) * 100)}%" title="${esc(e.text)}"></i>`).join('');
        sidePanel.innerHTML = sideHtml(state, userSide);
        sidePanel.querySelectorAll('[data-player]').forEach((el) => {
          el.onclick = () => { stop(); showPlayer(app, el.dataset.player); };
        });
      };

      const stop = () => {
        clearInterval(app.matchTimer);
        app.matchTimer = null;
        app.matchPlaying = false;
        playBtn.textContent = state.finished ? 'Continue' : 'Resume';
      };

      const finish = () => {
        stop();
        finishFixture(game, fixture, state);
        game.status = 'idle';
        game.pendingMatchId = null;
        app.matchState = null;
        app.autosave();
        app.go('fixtures', { fixtureId: fixture.id });
      };

      const tick = () => {
        if (state.finished) { stop(); paint(); playBtn.textContent = 'Continue'; return; }
        stepMatch(state);
        // Half time stops play for a team talk.
        if (userSide && state.tick === TICKS_PER_HALF && !app.halfTimeShown) {
          app.halfTimeShown = true;
          stop();
          paint();
          showTeamTalk(app, state, userSide, true);
          return;
        }
        paint();
        if (state.finished) { stop(); playBtn.textContent = 'Continue'; }
      };

      const play = () => {
        if (state.finished) { finish(); return; }
        const ms = SPEEDS[root.querySelector('#m-speed').value];
        if (ms === 0) {
          let guard = 0;
          while (!state.finished && guard++ < 800) stepMatch(state);
          paint();
          playBtn.textContent = 'Continue';
          return;
        }
        app.matchPlaying = true;
        playBtn.textContent = 'Pause';
        app.matchTimer = setInterval(tick, ms);
      };

      playBtn.onclick = () => {
        if (app.matchPlaying) { stop(); return; }
        play();
      };
      root.querySelector('#m-speed').onchange = (e) => {
        app.setSetting('matchSpeed', e.target.value);
        if (app.matchPlaying) { stop(); play(); }
      };

      if (userSide) {
        root.querySelector('#m-mentality').onchange = (e) => {
          changeMentality(state, userSide, e.target.value);
          paint();
        };
        root.querySelector('#m-sub').onclick = () => { stop(); showSubDialog(app, state, userSide, paint); };
        root.querySelector('#m-talk').onclick = () => { stop(); showTeamTalk(app, state, userSide, false); };
      }

      paint();
    },
  };
}

function sideHtml(state, userSide) {
  const home = state.home;
  const away = state.away;
  const stat = (label, h, a) => `<tr><td class="num" style="width:52px">${h}</td>
    <td class="center small faint">${esc(label)}</td><td class="num" style="width:52px;text-align:left">${a}</td></tr>`;

  const ratings = (side) => sortBy(side.onPitch.map((e) => ({ e, r: side.records[e.player.id] })), { key: (x) => x.e.slot.y })
    .map(({ e, r }) => {
      const p = e.player;
      const cond = Math.round(p.matchCondition ?? p.condition);
      const condCls = cond < 55 ? 'bad' : cond < 72 ? 'warn' : 'faint';
      return `<tr class="clickable" data-player="${esc(p.id)}">
        <td class="small faint">${esc(e.slot.pos)}</td>
        <td class="nowrap small">${esc(p.short)}${r?.goals ? ` <span class="good">${'⚽'.repeat(Math.min(3, r.goals))}</span>` : ''}${r?.yellow ? ' <span class="warn">▮</span>' : ''}${r?.red ? ' <span class="bad">▮</span>' : ''}</td>
        <td class="num small ${condCls}">${cond}%</td>
      </tr>`;
    }).join('');

  return `
    ${panelTight('Match Stats', `<table><tbody>
      ${stat('Possession', `${Math.round((home.stats.possessionTicks / Math.max(1, home.stats.possessionTicks + away.stats.possessionTicks)) * 100)}%`,
    `${Math.round((away.stats.possessionTicks / Math.max(1, home.stats.possessionTicks + away.stats.possessionTicks)) * 100)}%`)}
      ${stat('Shots', home.stats.shots, away.stats.shots)}
      ${stat('On target', home.stats.onTarget, away.stats.onTarget)}
      ${stat('xG', home.stats.xg.toFixed(2), away.stats.xg.toFixed(2))}
      ${stat('Corners', home.stats.corners, away.stats.corners)}
      ${stat('Fouls', home.stats.fouls, away.stats.fouls)}
      ${stat('Cards', `${home.stats.yellow}/${home.stats.red}`, `${away.stats.yellow}/${away.stats.red}`)}
    </tbody></table>`)}
    ${panelTight(`${home.club.short} — on the pitch`, `<table><tbody>${ratings(home)}</tbody></table>`)}
    ${panelTight(`${away.club.short} — on the pitch`, `<table><tbody>${ratings(away)}</tbody></table>`)}`;
}

function showSubDialog(app, state, side, paint) {
  if (side.subsUsed >= side.subsAllowed) { toast('No substitutions left.', 'warn'); return; }
  if (!side.bench.length) { toast('No substitutes available.', 'warn'); return; }
  let offId = null;

  openModal({
    title: 'Make a substitution',
    body: `<div class="grid c2">
      <div><h3>Coming off</h3><div class="scroll-y" style="max-height:320px"><table><tbody>
        ${side.onPitch.map((e) => {
    const p = e.player;
    const cond = Math.round(p.matchCondition ?? p.condition);
    return `<tr class="clickable" data-off="${esc(p.id)}">
            <td class="small faint">${esc(e.slot.pos)}</td>
            <td class="nowrap small">${esc(p.name)}</td>
            <td class="num small ${cond < 60 ? 'bad' : cond < 75 ? 'warn' : 'faint'}">${cond}%</td></tr>`;
  }).join('')}
      </tbody></table></div></div>
      <div><h3>Coming on</h3><div class="scroll-y" style="max-height:320px"><table><tbody>
        ${side.bench.map((p) => `<tr class="clickable" data-on="${esc(p.id)}">
          <td class="small faint">${esc(p.positions.join('/'))}</td>
          <td class="nowrap small">${esc(p.name)}</td>
          <td class="num small">${currentAbility(p)}</td></tr>`).join('')}
      </tbody></table></div></div>
    </div>
    <p class="small faint" id="sub-note">Pick a player to come off, then a replacement.</p>`,
    onMount(modal, close) {
      modal.querySelectorAll('[data-off]').forEach((tr) => {
        tr.onclick = () => {
          offId = tr.dataset.off;
          modal.querySelectorAll('[data-off]').forEach((x) => x.classList.remove('highlight'));
          tr.classList.add('highlight');
          modal.querySelector('#sub-note').textContent = 'Now choose who comes on.';
        };
      });
      modal.querySelectorAll('[data-on]').forEach((tr) => {
        tr.onclick = () => {
          if (!offId) { modal.querySelector('#sub-note').innerHTML = '<span class="warn">Choose who comes off first.</span>'; return; }
          if (makeSubstitution(state, side, offId, tr.dataset.on)) {
            close();
            paint();
            toast('Substitution made.');
          } else {
            modal.querySelector('#sub-note').innerHTML = '<span class="bad">That change is not possible.</span>';
          }
        };
      });
    },
  });
}

const TALKS = [
  { id: 'praise', label: 'Praise them', boost: 1, text: 'The manager is full of praise.' },
  { id: 'encourage', label: 'Encourage', boost: 0.6, text: 'The manager urges them on.' },
  { id: 'calm', label: 'Stay calm', boost: 0.2, text: 'The manager keeps things measured.' },
  { id: 'demand', label: 'Demand more', boost: -0.2, text: 'The manager demands more.' },
  { id: 'furious', label: 'Tear into them', boost: -1, text: 'The manager lets them have it.' },
];

function showTeamTalk(app, state, side, isHalfTime) {
  const opp = side === state.home ? state.away : state.home;
  const diff = side.goals - opp.goals;
  const situation = diff > 0 ? 'ahead' : diff === 0 ? 'level' : 'behind';

  openModal({
    title: isHalfTime ? 'Half time team talk' : 'Team talk',
    narrow: true,
    body: `<p>${esc(side.club.name)} are ${situation} at ${state.home.goals}-${state.away.goals} after ${state.minute} minutes.</p>
      <p class="small faint">A talk that fits the situation lifts the players. One that misreads the room does the opposite —
      an angry response to a good performance will not land well.</p>
      <div class="stack">${TALKS.map((t) => `<button data-talk="${t.id}">${esc(t.label)}</button>`).join('')}</div>`,
    onMount(modal, close) {
      modal.querySelectorAll('[data-talk]').forEach((b) => {
        b.onclick = () => {
          const talk = TALKS.find((t) => t.id === b.dataset.talk);
          // Reading the game right is what matters. A side in front wants to hear
          // praise; a side behind wants to be roused, not congratulated; a level
          // game calls for a steady hand either way.
          const preferred = diff > 0 ? 0.65 : diff === 0 ? 0.25 : -0.35;
          const fit = 1 - Math.abs(talk.boost - preferred) / 1.7;
          const morale = (fit - 0.45) * 1.7 + state.rng.range(-0.2, 0.2);
          const manMgmt = (side.club.manager?.manManagement ?? 12) / 14;
          applyTeamTalk(state, side, morale * manMgmt, `${talk.text} ${side.club.short} respond ${morale > 0.3 ? 'well' : morale < -0.2 ? 'badly' : 'quietly'}.`);
          close();
          toast(morale > 0.3 ? 'The players respond well.' : morale < -0.2 ? 'That did not land.' : 'A muted response.');
        };
      });
    },
  });
}
