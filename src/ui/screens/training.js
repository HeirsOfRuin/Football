// The training screen: a team programme, a handful of individual slots, and an
// honest report on who is actually improving.
//
// Training used to be two dropdowns on a tab of the Club screen, applied
// identically to everyone and forgotten about. The individual slots are the
// reason it needs a screen: they are a weekly decision with real scarcity.

import { esc, panel, panelTight, kv, openModal, toast, emptyState } from '../components.js';
import { userClub } from '../../state/game.js';
import {
  TRAINING_FOCUSES, TRAINING_INTENSITY, PROGRAMME_TYPES, PROGRAMME_GROUPS,
  trainingSlots, developmentRate, expectedRole, ROLE_LABELS, retrainingStep,
} from '../../engine/training.js';
import {
  currentAbility, ATTR_GROUPS, POSITION_LABELS, familiarity, familiarityLabel,
  familiarityFromAffinity,
} from '../../data/attributes.js';
import { ROLES } from '../../data/tactics.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';

const INTENSITY_NOTE = {
  Light: 'Slower progress, but they recover faster and nobody breaks down. The setting for a congested month.',
  Normal: 'The balanced programme. No injury risk from training itself.',
  Intense: 'Faster progress, paid for in tiredness and a real risk of training-ground injuries.',
};

const POSITIONS = ['GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'ML', 'MR', 'AMC', 'AML', 'AMR', 'ST'];

/** A one-line description of what a slot is currently doing. */
function describeSlot(world, slot) {
  if (!slot?.playerId || !slot.type) return null;
  const p = world.players[slot.playerId];
  if (!p) return null;
  if (slot.type === 'group') return `${p.name} — ${slot.target} work`;
  if (slot.type === 'role') return `${p.name} — as ${ROLES[slot.target]?.name || slot.target}`;
  if (slot.type === 'position') return `${p.name} — retraining at ${POSITION_LABELS[slot.target] || slot.target}`;
  if (slot.type === 'mentor') {
    const m = world.players[slot.target];
    return `${p.name} — mentored by ${m ? m.name : 'a senior pro'}`;
  }
  return p.name;
}

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('You are not currently managing a club.'), mount() {} };

  club.training = club.training || { slots: [] };
  const slots = club.training.slots;
  const allowed = trainingSlots(club);
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const focus = TRAINING_FOCUSES.find((f) => f.id === (club.trainingFocus || 'Balanced'));
  const intensity = club.trainingIntensity || 'Normal';

  const developing = sortBy(squad, { key: (p) => developmentRate(world, club, p), desc: true }).slice(0, 14);

  const slotRows = [];
  for (let i = 0; i < allowed; i++) {
    const slot = slots[i];
    const label = describeSlot(world, slot);
    slotRows.push(`<tr>
      <td class="num faint">${i + 1}</td>
      <td>${label ? esc(label) : '<span class="faint">Empty</span>'}</td>
      <td class="small faint">${slot?.type ? esc(PROGRAMME_TYPES[slot.type]?.label || slot.type) : '—'}</td>
      <td class="right">
        <button class="ghost small" data-slot="${i}">${label ? 'Change' : 'Assign'}</button>
        ${label ? `<button class="ghost small" data-clear="${i}">Clear</button>` : ''}
      </td></tr>`);
  }

  const html = `<div class="grid c1-2">
    ${panel('Team programme', `
      <div class="field"><label>Focus</label><select id="training-focus">
        ${TRAINING_FOCUSES.map((f) => `<option value="${esc(f.id)}" ${f.id === (club.trainingFocus || 'Balanced') ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
      </select></div>
      ${focus && Object.keys(focus.emphasis).length
    ? `<p class="small faint">Emphasis: ${esc(Object.keys(focus.emphasis).join(', '))}</p>`
    : '<p class="small faint">No particular emphasis — development follows each player\'s position.</p>'}
      <div class="field"><label>Intensity</label><select id="training-intensity">
        ${TRAINING_INTENSITY.map((i) => `<option ${i === intensity ? 'selected' : ''}>${esc(i)}</option>`).join('')}
      </select></div>
      <p class="small ${intensity === 'Intense' ? 'bad' : 'faint'}">${esc(INTENSITY_NOTE[intensity])}</p>
      <p class="small faint">Slots are set by your coaching staff and training ground.</p>
      ${kv([
    ['Training ground', `${club.facilities.training}/20`],
    ['Individual slots', `${allowed}`],
  ])}`)}

    ${panelTight(`Individual training — ${slots.filter((s) => s?.playerId).length}/${allowed} used`,
    `<div class="table-wrap"><table>
      <thead><tr><th class="num">#</th><th>Player &amp; programme</th><th>Type</th><th></th></tr></thead>
      <tbody>${slotRows.join('')}</tbody></table></div>
      <p class="small faint">Better coaches and a better training ground earn you more slots.
        Attribute and role work steers where a player's progress lands; retraining and mentoring
        move things nothing else can reach.</p>`)}
  </div>

  ${panelTight('Progress report', `<div class="table-wrap"><table>
    <thead><tr><th>Player</th><th class="num">Age</th><th class="num">Ability</th><th class="num">Potential</th>
      <th>Trajectory</th><th>Individual work</th><th>Squad role</th><th class="num">Minutes</th></tr></thead>
    <tbody>${developing.map((p) => {
    const rate = developmentRate(world, club, p);
    const traj = rate > 0.09 ? '<span class="good">Rapid</span>' : rate > 0.045 ? '<span class="good">Improving</span>'
      : rate > 0.005 ? '<span class="muted">Slow</span>' : rate > -0.02 ? '<span class="faint">Static</span>' : '<span class="bad">Declining</span>';
    const slot = slots.find((sl) => sl?.playerId === p.id);
    return `<tr class="clickable" data-player="${esc(p.id)}">
      <td class="nowrap">${esc(p.name)}</td><td class="num">${p.age}</td>
      <td class="num">${currentAbility(p)}</td><td class="num faint">${p.pa}</td>
      <td class="small">${traj}</td>
      <td class="small ${slot ? 'good' : 'faint'}">${slot ? esc(PROGRAMME_TYPES[slot.type]?.label || slot.type) : '—'}</td>
      <td class="small faint">${esc(ROLE_LABELS[expectedRole(world, club, p)])}</td>
      <td class="num">${p.season.minutes}</td></tr>`;
  }).join('')}</tbody></table></div>`)}`;

  return {
    html,
    mount(root) {
      const focusSel = root.querySelector('#training-focus');
      if (focusSel) {
        focusSel.onchange = () => { club.trainingFocus = focusSel.value; toast('Training focus updated.'); app.refresh(); };
      }
      const intSel = root.querySelector('#training-intensity');
      if (intSel) {
        intSel.onchange = () => { club.trainingIntensity = intSel.value; toast('Training intensity updated.'); app.refresh(); };
      }
      root.querySelectorAll('[data-clear]').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          slots[Number(b.dataset.clear)] = null;
          toast('Slot cleared.');
          app.refresh();
        };
      });
      root.querySelectorAll('[data-slot]').forEach((b) => {
        b.onclick = (e) => { e.stopPropagation(); openSlotDialog(app, club, Number(b.dataset.slot)); };
      });
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = () => showPlayer(app, el.dataset.player);
      });
    },
  };
}

function openSlotDialog(app, club, index) {
  const world = app.game.world;
  const squad = club.squad.map((id) => world.players[id]).filter(Boolean);
  const ranked = sortBy(squad, { key: (p) => currentAbility(p), desc: true });
  // Who can mentor depends on who is being mentored, so this has to be computed
  // per selected player rather than once. applyMentoring() requires a four-year
  // gap; offering anyone else would let the manager fill a slot with a programme
  // the engine quietly refuses to run.
  const mentorsFor = (player) => (player
    ? sortBy(squad.filter((m) => m.id !== player.id && m.age - player.age >= 4),
      { key: (m) => (m.hidden?.professionalism ?? 10), desc: true })
    : []);

  const body = `
    <div class="field"><label>Player</label><select id="slot-player">
      ${ranked.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.age}, ${esc(p.positions.join('/'))}, ${currentAbility(p)})</option>`).join('')}
    </select></div>
    <div class="field"><label>Programme</label><select id="slot-type">
      ${Object.values(PROGRAMME_TYPES).map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}
    </select></div>
    <p class="small faint" id="slot-help">${esc(PROGRAMME_TYPES.group.help)}</p>
    <div class="field"><label id="slot-target-label">Group</label><select id="slot-target"></select></div>
    <p class="small" id="slot-detail"></p>`;

  openModal({
    title: `Individual training — slot ${index + 1}`,
    body,
    narrow: true,
    footer: '<button class="primary" data-assign>Assign</button><button class="ghost" data-close>Cancel</button>',
    onMount(modal, close) {
      const playerSel = modal.querySelector('#slot-player');
      const typeSel = modal.querySelector('#slot-type');
      const targetSel = modal.querySelector('#slot-target');
      const targetLabel = modal.querySelector('#slot-target-label');
      const help = modal.querySelector('#slot-help');
      const detail = modal.querySelector('#slot-detail');

      const refreshTargets = () => {
        const player = world.players[playerSel.value];
        const type = typeSel.value;
        help.textContent = PROGRAMME_TYPES[type]?.help || '';
        detail.textContent = '';
        let opts = [];
        if (type === 'group') {
          targetLabel.textContent = 'Group';
          opts = PROGRAMME_GROUPS.map((g) => [g, `${g} (${ATTR_GROUPS[g].length} attributes)`]);
        } else if (type === 'role') {
          targetLabel.textContent = 'Role';
          // Only roles the player could plausibly be asked to fill.
          const pos = new Set(player?.positions || []);
          const usable = Object.values(ROLES).filter((r) => r.pos.some((x) => pos.has(x)));
          opts = (usable.length ? usable : Object.values(ROLES)).map((r) => [r.id, `${r.name} (${r.attrs.slice(0, 3).join(', ')}…)`]);
        } else if (type === 'position') {
          targetLabel.textContent = 'Position';
          // Nobody retrains across the goalkeeping line. A winger does not become
          // a keeper, and the attribute sets have nothing in common.
          const isKeeper = player?.positions.includes('GK');
          opts = POSITIONS
            .filter((x) => (x === 'GK') === isKeeper)
            .filter((x) => !player?.positions.includes(x))
            .map((x) => [x, `${POSITION_LABELS[x] || x} — currently ${familiarityLabel(familiarity(player, x))}`]);
          if (!opts.length) detail.innerHTML = '<span class="bad">There is no position left for him to learn.</span>';
        } else {
          targetLabel.textContent = 'Mentor';
          opts = mentorsFor(player)
            .map((m) => [m.id, `${m.name} (${m.age}, professionalism ${Math.round(m.hidden?.professionalism ?? 10)})`]);
          if (!opts.length) {
            detail.innerHTML = '<span class="bad">Nobody in the squad is senior enough to mentor him'
              + ' — a mentor has to be at least four years older.</span>';
          }
        }
        targetSel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
        showDetail();
      };

      // Say what the assignment will actually do, in seasons, rather than
      // leaving the player to guess whether it is worth a slot.
      const showDetail = () => {
        const player = world.players[playerSel.value];
        if (!player || typeSel.value !== 'position' || !targetSel.value) return;
        const pos = targetSel.value;
        const step = retrainingStep(player, pos);
        const now = player.learned?.[pos] ?? familiarityFromAffinity(player, pos);
        const seasonsToNatural = step > 0 ? (19 - now) / (step * 38) : 99;
        detail.innerHTML = `At his age and versatility, roughly <b>${(step * 38).toFixed(1)}</b> familiarity points a season`
          + ` — about <b>${seasonsToNatural < 20 ? seasonsToNatural.toFixed(1) : '20+'}</b> seasons to master it fully.`;
      };

      playerSel.onchange = refreshTargets;
      typeSel.onchange = refreshTargets;
      targetSel.onchange = showDetail;
      refreshTargets();

      modal.querySelector('[data-assign]').onclick = () => {
        const playerId = playerSel.value;
        const type = typeSel.value;
        const target = targetSel.value;
        if (!playerId || !target) {
          toast(type === 'mentor' ? 'No eligible mentor for that player.' : 'Nothing to assign.');
          return;
        }
        // A player can only be in one slot; moving him clears the old one.
        club.training.slots = club.training.slots.map((s) => (s?.playerId === playerId ? null : s));
        club.training.slots[index] = { playerId, type, target };
        toast('Individual training assigned.');
        close();
        app.refresh();
      };
    },
  });
}
