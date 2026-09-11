// The custom player library: create, edit and manage players that can be
// dropped into any future campaign.

import { html, esc, toast, money, openModal, confirmDialog, attrClass } from '../components.js';
import { listLibrary, saveToLibrary, deleteFromLibrary, duplicateInLibrary, blankCustomPlayer, randomCustomPlayer, validateCustomPlayer, describeCustomPlayer, exportLibraryFile, importLibraryFile, NATION_OPTIONS } from '../../state/library.js';
import { ATTR_GROUPS, ATTR_LABELS, HIDDEN_ATTRS, POSITIONS, POSITION_LABELS } from '../../data/attributes.js';
import { TRAITS } from '../../gen/playergen.js';
import { sortBy } from '../../core/util.js';

const HIDDEN_LABELS = {
  consistency: 'Consistency', importantMatches: 'Big Matches', injuryProneness: 'Injury Proneness',
  professionalism: 'Professionalism', ambition: 'Ambition', loyalty: 'Loyalty',
  adaptability: 'Adaptability', versatility: 'Versatility', dirtiness: 'Dirtiness',
  pressureHandling: 'Pressure Handling',
};

let editing = null;

export function render(app) {
  if (editing) return renderEditor(app);
  return renderList(app);
}

function renderList(app) {
  const players = sortBy(listLibrary(), { key: (p) => p.createdAt, desc: true });
  return {
    html: `<div class="menu-screen"><div class="menu-card setup-wide">
      <div class="logo"><h1>Player Library</h1><p>${players.length} created player${players.length === 1 ? '' : 's'}</p></div>

      <div class="row wrap" style="margin-bottom:14px">
        <button class="primary" data-act="new">Create from scratch</button>
        <button data-act="generate">Generate a player</button>
        <div class="spacer"></div>
        <button data-act="export" ${players.length ? '' : 'disabled'}>Export</button>
        <button data-act="import">Import</button>
        <button data-act="back">${app.game ? 'Back to game' : 'Main menu'}</button>
      </div>

      <section class="panel"><div class="panel-body tight">
      ${players.length === 0
    ? `<div class="empty">Nothing here yet.<br><br>
         Build a wonderkid, recreate a favourite, or generate a player and tweak them.<br>
         Anything you save appears as an option every time you start a new career.</div>`
    : `<div class="scroll-y h-420"><table><thead><tr>
        <th>Name</th><th>Pos</th><th class="num">Age</th><th>Nat</th>
        <th class="num">Ability</th><th class="num">Potential</th><th>Level</th>
        <th class="num">Value</th><th>Traits</th><th></th></tr></thead><tbody>
        ${players.map((p) => {
      const d = describeCustomPlayer({ ...p });
      return `<tr>
          <td class="nowrap">${esc(p.name)}</td>
          <td><span class="pill pos">${esc(p.positions.join('/'))}</span></td>
          <td class="num">${p.age}</td>
          <td class="small faint">${esc(NATION_OPTIONS.find((n) => n.id === p.nat)?.name || p.nat)}</td>
          <td class="num">${d.ability}</td>
          <td class="num">${p.pa}</td>
          <td class="small">${esc(d.tier)}</td>
          <td class="num">${money(d.value)}</td>
          <td class="small faint">${esc((p.traits || []).map((t) => TRAITS.find((x) => x.id === t)?.name).filter(Boolean).join(', ') || '—')}</td>
          <td class="nowrap">
            <button class="sm" data-edit="${esc(p.id)}">Edit</button>
            <button class="sm" data-dup="${esc(p.id)}">Copy</button>
            <button class="sm danger" data-del="${esc(p.id)}">Delete</button>
          </td></tr>`;
    }).join('')}
      </tbody></table></div>`}
      </div></section>
      <input type="file" id="lib-file" accept="application/json" hidden>
    </div></div>`,

    mount(root) {
      root.querySelector('[data-act="new"]').onclick = () => { editing = blankCustomPlayer(); app.render(); };
      root.querySelector('[data-act="generate"]').onclick = () => showGenerator(app);
      root.querySelector('[data-act="back"]').onclick = () => app.go(app.game ? 'dashboard' : 'menu');
      root.querySelector('[data-act="export"]').onclick = () => { exportLibraryFile(); toast('Library exported.'); };
      const file = root.querySelector('#lib-file');
      root.querySelector('[data-act="import"]').onclick = () => file.click();
      file.onchange = async () => {
        if (!file.files[0]) return;
        try {
          const n = await importLibraryFile(file.files[0]);
          toast(`Imported ${n} player${n === 1 ? '' : 's'}.`);
          app.render();
        } catch (err) { toast(err.message, 'bad', 6000); }
      };
      root.querySelectorAll('[data-edit]').forEach((b) => {
        b.onclick = () => {
          editing = validateCustomPlayer(listLibrary().find((p) => p.id === b.dataset.edit));
          app.render();
        };
      });
      root.querySelectorAll('[data-dup]').forEach((b) => {
        b.onclick = () => { duplicateInLibrary(b.dataset.dup); app.render(); toast('Copied.'); };
      });
      root.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const p = listLibrary().find((x) => x.id === b.dataset.del);
          if (await confirmDialog('Delete player', `Delete ${p.name} from your library? This cannot be undone.`, 'Delete')) {
            deleteFromLibrary(b.dataset.del);
            app.render();
            toast('Deleted.');
          }
        };
      });
    },
  };
}

function showGenerator(app) {
  openModal({
    title: 'Generate a player',
    narrow: true,
    body: `<p class="faint small" style="margin-top:0">A starting point you can then edit attribute by attribute.</p>
      <div class="field-row">
        <div class="field"><label>Position</label><select id="g-pos">
          ${POSITIONS.map((p) => `<option value="${p}" ${p === 'MC' ? 'selected' : ''}>${esc(POSITION_LABELS[p])}</option>`).join('')}
        </select></div>
        <div class="field"><label>Nationality</label><select id="g-nat">
          ${NATION_OPTIONS.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}
        </select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Age</label><input type="number" id="g-age" value="21" min="15" max="40"></div>
        <div class="field"><label>Ability (1-200)</label><input type="number" id="g-ca" value="130" min="20" max="200"></div>
        <div class="field"><label>Potential</label><input type="number" id="g-pa" value="165" min="20" max="200"></div>
      </div>`,
    footer: '<button data-cancel>Cancel</button><button class="primary" data-ok>Generate</button>',
    onMount(modal, close) {
      modal.querySelector('[data-cancel]').onclick = close;
      modal.querySelector('[data-ok]').onclick = () => {
        editing = randomCustomPlayer({
          pos: modal.querySelector('#g-pos').value,
          nat: modal.querySelector('#g-nat').value,
          age: Number(modal.querySelector('#g-age').value),
          ability: Number(modal.querySelector('#g-ca').value),
          potential: Number(modal.querySelector('#g-pa').value),
          seed: Math.floor(Math.random() * 2 ** 31),
        });
        close();
        app.render();
      };
    },
  });
}

function attrEditor(group, attrs) {
  return ATTR_GROUPS[group].map((a) => `
    <div class="attr-row">
      <span class="label">${esc(ATTR_LABELS[a])}</span>
      <input type="range" min="1" max="20" value="${attrs[a]}" data-attr="${a}" style="width:92px">
      <span class="val ${attrClass(attrs[a])}" data-attrval="${a}">${attrs[a]}</span>
    </div>`).join('');
}

function renderEditor(app) {
  const p = editing;
  const d = describeCustomPlayer(p);
  const bestPositions = sortBy(Object.entries(d.byPosition), { key: (e) => e[1], desc: true }).slice(0, 5);
  const isGk = p.positions.includes('GK');

  return {
    html: `<div class="menu-screen"><div class="menu-card setup-wide">
      <div class="logo"><h1 id="sum-name">${esc(p.name || 'New Player')}</h1>
        <p><span id="sum-tier">${esc(d.tier)}</span> · ability <span id="sum-ca">${d.ability}</span> ·
           potential ${p.pa} · worth <span id="sum-val">${money(d.value)}</span></p></div>

      <div class="grid c1-2">
        <div class="stack">
          <section class="panel"><div class="panel-head"><h2>Identity</h2></div><div class="panel-body">
            <div class="field-row">
              <div class="field"><label>First name</label><input id="f-first" value="${esc(p.first)}" maxlength="30"></div>
              <div class="field"><label>Surname</label><input id="f-last" value="${esc(p.last)}" maxlength="30"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Nationality</label><select id="f-nat">
                ${NATION_OPTIONS.map((n) => `<option value="${n.id}" ${n.id === p.nat ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}
              </select></div>
              <div class="field"><label>Age</label><input type="number" id="f-age" value="${p.age}" min="15" max="42"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Height (cm)</label><input type="number" id="f-height" value="${p.height}" min="150" max="215"></div>
              <div class="field"><label>Weight (kg)</label><input type="number" id="f-weight" value="${p.weight}" min="45" max="120"></div>
              <div class="field"><label>Foot</label><select id="f-foot">
                ${['Right', 'Left', 'Both'].map((f) => `<option ${f === p.foot ? 'selected' : ''}>${f}</option>`).join('')}
              </select></div>
            </div>
            <div class="field"><label>Positions (up to 3)</label>
              <div class="chip-select" id="f-pos">
                ${POSITIONS.map((pos) => `<button type="button" class="${p.positions.includes(pos) ? 'on' : ''}" data-pos="${pos}">${pos}</button>`).join('')}
              </div>
            </div>
            <div class="field"><label>Potential ability (${p.pa})</label>
              <input type="range" id="f-pa" min="20" max="200" value="${p.pa}" style="width:100%">
              <p class="faint small" style="margin:4px 0 0">Cannot fall below current ability. Sets the ceiling this player can train toward.</p>
            </div>
            <div class="field"><label>Notes</label><textarea id="f-notes" rows="2" placeholder="Anything you want to remember">${esc(p.notes || '')}</textarea></div>
          </div></section>

          <section class="panel"><div class="panel-head"><h2>Best Positions</h2></div><div class="panel-body">
            <div id="best-pos">${bestPositions.map(([pos, v]) => `
              <div class="attr-row"><span class="label">${esc(POSITION_LABELS[pos])}</span><span class="val ${attrClass(v / 10)}">${v}</span></div>`).join('')}</div>
            <p class="faint small" style="margin-bottom:0">Ability is derived from attributes, so a defender with 20 finishing still will not be a striker.</p>
          </div></section>

          <section class="panel"><div class="panel-head"><h2>Traits</h2></div><div class="panel-body">
            <div class="chip-select" id="f-traits">
              ${TRAITS.map((t) => `<button type="button" class="${(p.traits || []).includes(t.id) ? 'on' : ''}" data-trait="${t.id}" title="${esc(t.pos.join(', '))}">${esc(t.name)}</button>`).join('')}
            </div>
            <p class="faint small" style="margin-bottom:0">Traits nudge how a player behaves in matches. Pick up to four.</p>
          </div></section>
        </div>

        <div class="stack">
          <div class="grid c3">
            <section class="panel"><div class="panel-head"><h2>${isGk ? 'Goalkeeping' : 'Technical'}</h2></div>
              <div class="panel-body">${attrEditor(isGk ? 'goalkeeping' : 'technical', p.attrs)}</div></section>
            <section class="panel"><div class="panel-head"><h2>Mental</h2></div>
              <div class="panel-body">${attrEditor('mental', p.attrs)}</div></section>
            <section class="panel"><div class="panel-head"><h2>Physical</h2></div>
              <div class="panel-body">${attrEditor('physical', p.attrs)}</div></section>
          </div>
          <section class="panel"><div class="panel-head"><h2>${isGk ? 'Outfield (rarely used)' : 'Goalkeeping (rarely used)'}</h2></div>
            <div class="panel-body"><div class="grid c2">${attrEditor(isGk ? 'technical' : 'goalkeeping', p.attrs)}</div></div></section>
          <section class="panel"><div class="panel-head"><h2>Personality &amp; Hidden</h2><div class="spacer"></div>
            <span class="pill" id="sum-pers">${esc(d.personality)}</span></div>
            <div class="panel-body"><div class="grid c2">
            ${HIDDEN_ATTRS.map((h) => `<div class="attr-row">
              <span class="label">${esc(HIDDEN_LABELS[h])}</span>
              <input type="range" min="1" max="20" value="${p.hidden[h]}" data-hidden="${h}" style="width:92px">
              <span class="val ${attrClass(p.hidden[h])}" data-hiddenval="${h}">${p.hidden[h]}</span></div>`).join('')}
            </div></div></section>
        </div>
      </div>

      <div class="row" style="justify-content:flex-end;gap:10px;margin:14px 0 30px">
        <button data-act="cancel">Cancel</button>
        <button data-act="randomise">Re-roll attributes</button>
        <button class="primary" data-act="save">Save to library</button>
      </div>
    </div></div>`,

    mount(root) {
      const refreshSummary = () => {
        const d2 = describeCustomPlayer(p);
        root.querySelector('#sum-ca').textContent = d2.ability;
        root.querySelector('#sum-tier').textContent = d2.tier;
        root.querySelector('#sum-val').textContent = money(d2.value);
        root.querySelector('#sum-pers').textContent = d2.personality;
        const best = sortBy(Object.entries(d2.byPosition), { key: (e) => e[1], desc: true }).slice(0, 5);
        root.querySelector('#best-pos').innerHTML = best.map(([pos, v]) => `
          <div class="attr-row"><span class="label">${esc(POSITION_LABELS[pos])}</span><span class="val ${attrClass(v / 10)}">${v}</span></div>`).join('');
        if (p.pa < d2.ability) {
          p.pa = d2.ability;
          const paInput = root.querySelector('#f-pa');
          paInput.value = p.pa;
          paInput.previousElementSibling.textContent = `Potential ability (${p.pa})`;
        }
      };

      root.querySelectorAll('[data-attr]').forEach((input) => {
        input.oninput = () => {
          const key = input.dataset.attr;
          p.attrs[key] = Number(input.value);
          const out = root.querySelector(`[data-attrval="${key}"]`);
          out.textContent = input.value;
          out.className = `val ${attrClass(p.attrs[key])}`;
          p._ca = null;
          refreshSummary();
        };
      });
      root.querySelectorAll('[data-hidden]').forEach((input) => {
        input.oninput = () => {
          const key = input.dataset.hidden;
          p.hidden[key] = Number(input.value);
          const out = root.querySelector(`[data-hiddenval="${key}"]`);
          out.textContent = input.value;
          out.className = `val ${attrClass(p.hidden[key])}`;
          refreshSummary();
        };
      });
      root.querySelector('#f-pa').oninput = (e) => {
        const d2 = describeCustomPlayer(p);
        p.pa = Math.max(Number(e.target.value), d2.ability);
        e.target.value = p.pa;
        e.target.previousElementSibling.textContent = `Potential ability (${p.pa})`;
      };
      root.querySelectorAll('#f-pos button').forEach((b) => {
        b.onclick = () => {
          const pos = b.dataset.pos;
          if (p.positions.includes(pos)) {
            if (p.positions.length > 1) p.positions = p.positions.filter((x) => x !== pos);
          } else if (p.positions.length < 3) {
            p.positions.push(pos);
          } else {
            toast('Three positions is the limit.', 'warn');
            return;
          }
          p._ca = null;
          app.render();
        };
      });
      root.querySelectorAll('#f-traits button').forEach((b) => {
        b.onclick = () => {
          const t = b.dataset.trait;
          p.traits = p.traits || [];
          if (p.traits.includes(t)) p.traits = p.traits.filter((x) => x !== t);
          else if (p.traits.length < 4) p.traits.push(t);
          else { toast('Four traits is the limit.', 'warn'); return; }
          b.classList.toggle('on');
        };
      });

      const readIdentity = () => {
        p.first = root.querySelector('#f-first').value.trim();
        p.last = root.querySelector('#f-last').value.trim() || 'Player';
        p.nat = root.querySelector('#f-nat').value;
        p.age = Number(root.querySelector('#f-age').value);
        p.height = Number(root.querySelector('#f-height').value);
        p.weight = Number(root.querySelector('#f-weight').value);
        p.foot = root.querySelector('#f-foot').value;
        p.notes = root.querySelector('#f-notes').value;
        p.name = `${p.first} ${p.last}`.trim();
      };

      const nameEl = root.querySelector('#sum-name');
      const syncName = () => {
        const first = root.querySelector('#f-first').value.trim();
        const last = root.querySelector('#f-last').value.trim();
        nameEl.textContent = `${first} ${last}`.trim() || 'New Player';
      };
      root.querySelector('#f-first').oninput = syncName;
      root.querySelector('#f-last').oninput = syncName;

      root.querySelector('[data-act="cancel"]').onclick = async () => {
        if (await confirmDialog('Discard changes', 'Leave the editor without saving?', 'Discard')) {
          editing = null;
          app.render();
        }
      };
      root.querySelector('[data-act="randomise"]').onclick = () => {
        readIdentity();
        const d2 = describeCustomPlayer(p);
        const fresh = randomCustomPlayer({
          nat: p.nat, pos: p.positions[0], age: p.age,
          ability: d2.ability, potential: p.pa, seed: Math.floor(Math.random() * 2 ** 31),
        });
        p.attrs = fresh.attrs;
        p.hidden = fresh.hidden;
        p._ca = null;
        app.render();
      };
      root.querySelector('[data-act="save"]').onclick = () => {
        readIdentity();
        const saved = saveToLibrary(p);
        editing = null;
        app.render();
        toast(`${saved.name} saved to your library.`);
      };
    },
  };
}
