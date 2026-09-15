// Tactics: formation, personnel, roles, duties and team instructions.

import { esc, panel, panelTight, toast, emptyState, openModal, conditionCell, moraleLabel } from '../components.js';
import { userClub } from '../../state/game.js';
import {
  FORMATIONS, FORMATION_NAMES, MENTALITIES, INSTRUCTION_DEFS, ROLES,
  rolesForPosition, defaultRoleFor, defaultDutyFor, defaultTactic,
} from '../../data/tactics.js';
import { buildLineup, autoPick, autoAssignSpecialists, slotScore, isAvailable } from '../../engine/lineup.js';
import { familiarity, familiarityLabel, currentAbility, POSITION_LABELS } from '../../data/attributes.js';
import { teamStrength } from '../../engine/ratings.js';
import { sortBy } from '../../core/util.js';
import { showPlayer } from '../playerProfile.js';
import { kitUri } from '../../gen/identity.js';

export function render(app) {
  const game = app.game;
  const world = game.world;
  const club = userClub(game);
  if (!club) return { html: emptyState('No club.') };

  const state = app.screenState.tactics || (app.screenState.tactics = { selectedSlot: null });
  const tactic = club.tactic;
  const formation = FORMATIONS[tactic.formation] || FORMATIONS['4-4-2'];
  const lineup = buildLineup(world, club, tactic, { benchSize: 7 });
  const strength = teamStrength(lineup.starters.filter((s) => s.player), tactic);

  const startersIds = new Set(lineup.starters.map((s) => s.player?.id).filter(Boolean));
  const benchIds = new Set(lineup.bench.map((p) => p.id));
  const others = sortBy(club.squad.map((id) => world.players[id]).filter((p) => p && !startersIds.has(p.id)),
    { key: (p) => currentAbility(p), desc: true });

  const phaseRows = [
    ['Defending', strength.totals.defend],
    ['Pressing', strength.totals.press],
    ['Build-up', strength.totals.build],
    ['Creativity', strength.totals.create],
    ['Finishing', strength.totals.finish],
    ['Aerial', strength.totals.aerial],
    ['Directness', strength.totals.drive],
  ];
  const maxPhase = Math.max(...phaseRows.map((r) => r[1]), 1);

  return {
    html: `
    <div class="grid c2-1">
      <div class="stack">
        ${panel('Shape', `
          <div class="row wrap" style="margin-bottom:12px">
            <select id="formation-select">
              ${FORMATION_NAMES.map((f) => `<option ${f === tactic.formation ? 'selected' : ''}>${esc(f)}</option>`).join('')}
            </select>
            <select id="mentality-select">
              ${MENTALITIES.map((m) => `<option ${m === tactic.mentality ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select>
            <div class="spacer"></div>
            <button class="sm" data-act="autopick">Pick strongest XI</button>
          </div>
          <div class="pitch">
            <svg class="markings" viewBox="0 0 68 100" preserveAspectRatio="none">
              <rect x="1" y="1" width="66" height="98" fill="none" stroke="#4a7a5e" stroke-width=".4"/>
              <line x1="1" y1="50" x2="67" y2="50" stroke="#4a7a5e" stroke-width=".4"/>
              <circle cx="34" cy="50" r="9" fill="none" stroke="#4a7a5e" stroke-width=".4"/>
              <rect x="20" y="1" width="28" height="14" fill="none" stroke="#4a7a5e" stroke-width=".4"/>
              <rect x="20" y="85" width="28" height="14" fill="none" stroke="#4a7a5e" stroke-width=".4"/>
              <rect x="28" y="1" width="12" height="5" fill="none" stroke="#4a7a5e" stroke-width=".4"/>
              <rect x="28" y="94" width="12" height="5" fill="none" stroke="#4a7a5e" stroke-width=".4"/>
            </svg>
            ${lineup.starters.map((s, i) => {
    const p = s.player;
    const role = ROLES[s.role];
    const fam = p ? familiarity(p, s.slot.pos) : 0;
    const famCls = fam >= 16 ? '' : fam >= 12 ? 'border-color:var(--warn)' : 'border-color:var(--bad)';
    return `<div class="pitch-slot ${state.selectedSlot === i ? 'selected' : ''} ${p ? '' : 'empty'}"
              data-slot="${i}" style="left:${8 + s.slot.x * 0.84}%;bottom:${7 + s.slot.y * 0.85}%">
              <div class="shirt" style="background-image:url('${kitUri(club)}');${p ? famCls : ''}">
                ${p ? (p.squadNumber ?? '') : s.slot.pos}</div>
              <div class="pname">${esc(p ? p.short : '—')}</div>
              <div class="prole">${esc(role ? shortRole(role.name) : s.slot.pos)}</div>
            </div>`;
  }).join('')}
          </div>
          ${lineup.missing ? `<p class="bad small center">${lineup.missing} position${lineup.missing > 1 ? 's' : ''} cannot be filled — not enough fit players.</p>` : ''}
          <p class="faint small center" style="margin-bottom:0">Click a position to change the player, role or duty.</p>
        `)}

        ${panelTight('Bench', lineup.bench.length === 0 ? emptyState('No substitutes available.')
    : `<table><thead><tr><th>#</th><th>Name</th><th>Pos</th><th>Condition</th><th>Morale</th><th class="num">Ability</th><th></th></tr></thead>
      <tbody>${lineup.bench.map((p) => `<tr>
        <td class="num faint">${p.squadNumber ?? ''}</td>
        <td class="nowrap clickable" data-player="${esc(p.id)}">${esc(p.name)}</td>
        <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
        <td>${conditionCell(p)}</td>
        <td class="small ${moraleLabel(p.morale).cls}">${moraleLabel(p.morale).label}</td>
        <td class="num">${currentAbility(p)}</td>
        <td><button class="sm" data-drop-bench="${esc(p.id)}">Remove</button></td>
      </tr>`).join('')}</tbody></table>`,
    '<button class="sm" data-act="autobench">Auto-fill bench</button>')}
      </div>

      <div class="stack">
        ${panel('Team Instructions', Object.entries(INSTRUCTION_DEFS).map(([key, def]) => `
          <div class="field" style="margin-bottom:9px">
            <label>${esc(def.label)}</label>
            <select data-instr="${key}">
              ${def.options.map((o) => `<option ${o === (tactic.instructions[key] ?? def.default) ? 'selected' : ''}>${esc(o)}</option>`).join('')}
            </select>
          </div>`).join(''))}

        ${panel('Team Profile', phaseRows.map(([label, v]) => `
          <div class="attr-row"><span class="label">${esc(label)}</span>
          <span class="bar" style="flex:0 0 110px"><span style="width:${Math.round((v / maxPhase) * 100)}%"></span></span>
          <span class="val mono">${Math.round(v / 10)}</span></div>`).join('')
    + `<p class="faint small" style="margin:10px 0 0">Relative weighting of this XI's contributions, not an absolute rating.</p>`)}

        ${panel('Set Pieces &amp; Captain', ['captain', 'penaltyTaker', 'freeKickTaker', 'cornerTaker'].map((key) => {
    const label = { captain: 'Captain', penaltyTaker: 'Penalties', freeKickTaker: 'Free kicks', cornerTaker: 'Corners' }[key];
    const options = club.squad.map((id) => world.players[id]).filter(Boolean);
    return `<div class="field" style="margin-bottom:9px"><label>${esc(label)}</label>
        <select data-special="${key}">
          <option value="">— none —</option>
          ${sortBy(options, (p) => p.name).map((p) => `<option value="${esc(p.id)}" ${tactic[key] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></div>`;
  }).join('') + '<button class="sm" data-act="autospecial">Pick automatically</button>')}
      </div>
    </div>`,

    mount(root) {
      root.querySelector('#formation-select').onchange = (e) => {
        const name = e.target.value;
        const kept = { mentality: tactic.mentality, instructions: tactic.instructions, bench: tactic.bench, captain: tactic.captain, penaltyTaker: tactic.penaltyTaker, freeKickTaker: tactic.freeKickTaker, cornerTaker: tactic.cornerTaker };
        club.tactic = autoPick(world, club, { ...defaultTactic(name), ...kept, formation: name });
        state.selectedSlot = null;
        app.refresh();
      };
      root.querySelector('#mentality-select').onchange = (e) => {
        tactic.mentality = e.target.value;
        app.refresh();
      };
      root.querySelectorAll('[data-instr]').forEach((sel) => {
        sel.onchange = () => {
          tactic.instructions = { ...tactic.instructions, [sel.dataset.instr]: sel.value };
          app.refresh();
        };
      });
      root.querySelectorAll('[data-special]').forEach((sel) => {
        sel.onchange = () => { tactic[sel.dataset.special] = sel.value || null; };
      });
      root.querySelector('[data-act="autopick"]').onclick = () => {
        club.tactic = autoAssignSpecialists(world, club, autoPick(world, club, tactic));
        toast('Strongest available XI selected.');
        app.refresh();
      };
      root.querySelector('[data-act="autobench"]').onclick = () => {
        club.tactic = { ...tactic, bench: [] };
        toast('Bench filled automatically.');
        app.refresh();
      };
      root.querySelector('[data-act="autospecial"]').onclick = () => {
        club.tactic = autoAssignSpecialists(world, club, tactic);
        toast('Set piece duties assigned.');
        app.refresh();
      };
      root.querySelectorAll('[data-drop-bench]').forEach((b) => {
        b.onclick = () => {
          const id = b.dataset.dropBench;
          tactic.bench = (lineup.bench.map((p) => p.id)).filter((x) => x !== id);
          app.refresh();
        };
      });
      root.querySelectorAll('[data-player]').forEach((el) => {
        el.onclick = (e) => { e.stopPropagation(); showPlayer(app, el.dataset.player); };
      });
      root.querySelectorAll('[data-slot]').forEach((el) => {
        el.onclick = () => openSlotEditor(app, club, Number(el.dataset.slot), lineup);
      });
    },
  };
}

function shortRole(name) {
  return name
    .replace('Midfielder', 'Mid').replace('Defender', 'Def').replace('Forward', 'Fwd')
    .replace('Goalkeeper', 'GK').replace('Playmaker', 'PM').replace('Ball Winning', 'BW')
    .replace('Ball Playing', 'BP').replace('Box to Box', 'B2B').replace('Centre Back', 'CB')
    .replace('Full Back', 'FB').replace('Wing Back', 'WB').replace('Inside', 'Ins.')
    .replace('Complete', 'Compl.').replace('Advanced', 'Adv.').replace('Attacking', 'Att.')
    .replace('Defensive', 'Def.').replace('Inverted', 'Inv.').replace('Deep Lying', 'DL');
}

function openSlotEditor(app, club, slotIndex, lineup) {
  const world = app.game.world;
  const tactic = club.tactic;
  const slot = lineup.starters[slotIndex];
  const pos = slot.slot.pos;
  const roles = rolesForPosition(pos);
  const assignment = tactic.assignments[slotIndex] || {};
  const currentRole = assignment.role || defaultRoleFor(pos);
  const currentDuty = assignment.duty || defaultDutyFor(pos);
  const role = ROLES[currentRole] || ROLES[defaultRoleFor(pos)];

  const usedElsewhere = new Set(lineup.starters.filter((s, i) => i !== slotIndex && s.player).map((s) => s.player.id));
  const candidates = sortBy(club.squad.map((id) => world.players[id]).filter(Boolean),
    { key: (p) => slotScore(p, pos, currentRole), desc: true });

  openModal({
    title: `${POSITION_LABELS[pos]} — slot ${slotIndex + 1}`,
    body: `
      <div class="grid c2">
        <div class="field"><label>Role</label><select id="slot-role">
          ${roles.map((r) => `<option value="${r.id}" ${r.id === currentRole ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Duty</label><select id="slot-duty">
          ${(role.duties || ['Support']).map((d) => `<option ${d === currentDuty ? 'selected' : ''}>${esc(d)}</option>`).join('')}
        </select></div>
      </div>
      <div class="table-wrap" style="max-height:340px">
      <table><thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th>Familiarity</th>
        <th>Condition</th><th>Morale</th><th class="num">Rating here</th><th></th></tr></thead>
      <tbody>${candidates.map((p) => {
    const fam = familiarity(p, pos);
    const score = Math.round(slotScore(p, pos, currentRole));
    const unavailable = !isAvailable(p);
    return `<tr class="${slot.player?.id === p.id ? 'highlight' : ''}">
        <td class="nowrap ${unavailable ? 'faint' : ''}">${esc(p.name)}${usedElsewhere.has(p.id) ? ' <span class="pill">in XI</span>' : ''}</td>
        <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
        <td class="num">${p.age}</td>
        <td class="small ${fam >= 16 ? 'good' : fam >= 12 ? 'warn' : 'bad'}">${esc(familiarityLabel(fam))}</td>
        <td>${conditionCell(p)}</td>
        <td class="small ${moraleLabel(p.morale).cls}">${moraleLabel(p.morale).label}</td>
        <td class="num">${unavailable ? '—' : score}</td>
        <td><button class="sm ${slot.player?.id === p.id ? '' : 'primary'}" data-pick="${esc(p.id)}" ${unavailable ? 'disabled' : ''}>
          ${slot.player?.id === p.id ? 'Selected' : 'Select'}</button></td>
      </tr>`;
  }).join('')}</tbody></table></div>`,
    wide: true,
    footer: '<button data-act="clear">Leave empty</button><button data-close>Done</button>',
    onMount(modal, close) {
      const ensure = () => {
        while (tactic.assignments.length <= slotIndex) tactic.assignments.push({ playerId: null, role: defaultRoleFor(pos), duty: defaultDutyFor(pos) });
        return tactic.assignments[slotIndex];
      };
      modal.querySelector('#slot-role').onchange = (e) => {
        const a = ensure();
        a.role = e.target.value;
        const r = ROLES[a.role];
        if (r && !r.duties.includes(a.duty)) a.duty = r.duties[0];
        close();
        app.refresh();
        openSlotEditor(app, club, slotIndex, buildLineup(world, club, club.tactic, { benchSize: 7 }));
      };
      modal.querySelector('#slot-duty').onchange = (e) => {
        ensure().duty = e.target.value;
        app.refresh();
      };
      modal.querySelectorAll('[data-pick]').forEach((b) => {
        b.onclick = () => {
          const id = b.dataset.pick;
          // Swap if the player is already in the XI elsewhere.
          const existing = tactic.assignments.findIndex((a) => a && a.playerId === id);
          const a = ensure();
          if (existing >= 0 && existing !== slotIndex) tactic.assignments[existing].playerId = a.playerId;
          a.playerId = id;
          close();
          app.refresh();
        };
      });
      modal.querySelector('[data-act="clear"]').onclick = () => {
        ensure().playerId = null;
        close();
        app.refresh();
      };
    },
  });
}
