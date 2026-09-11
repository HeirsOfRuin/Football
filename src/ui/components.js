// Shared rendering helpers. Everything returns HTML strings; screens hand them
// to the shell, which sets innerHTML once and then wires events by delegation.

import { money as fmtMoney, clamp, remap } from '../core/util.js';
import { currentAbility, POSITION_GROUP, familiarity, familiarityLabel } from '../data/attributes.js';
import { shortDate, formatDay } from '../core/calendar.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Tagged template that escapes interpolations; use ${raw(x)} to opt out. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += (v && v.__raw) ? v.value : Array.isArray(v) ? v.join('') : esc(v);
    out += strings[i + 1];
  }
  return out;
}

export const raw = (value) => ({ __raw: true, value });

export const money = fmtMoney;

export function badge(club, size = 26) {
  if (!club) return '';
  const c = club.colours || { primary: '#333', secondary: '#fff' };
  return `<span class="badge" style="width:${size}px;height:${size}px;background:${esc(c.primary)};color:${esc(c.secondary)};font-size:${Math.round(size * 0.38)}px">${esc(club.code || '')}</span>`;
}

export function formRun(form = []) {
  if (!form.length) return '<span class="faint small">—</span>';
  return `<span class="form-run">${form.slice(-6).map((f) => `<i class="${f}">${f}</i>`).join('')}</span>`;
}

export function attrClass(v) {
  if (v >= 17) return 'a20';
  if (v >= 14) return 'a16';
  if (v >= 12) return 'a13';
  if (v >= 9) return 'a10';
  if (v >= 6) return 'a7';
  return 'a1';
}

export function attrRow(label, value) {
  return `<div class="attr-row"><span class="label">${esc(label)}</span><span class="val ${attrClass(value)}">${value}</span></div>`;
}

export function stars(ca, ceiling = 165) {
  const n = clamp(Math.round((ca / ceiling) * 10) / 2, 0, 5);
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return `<span class="stars" title="${ca} ability">${'★'.repeat(full)}${half ? '½' : ''}${'☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)))}</span>`;
}

export function bar(pct, kind = '') {
  const p = clamp(pct, 0, 100);
  const cls = kind || (p >= 66 ? '' : p >= 34 ? 'warn' : 'bad');
  return `<span class="bar ${cls}"><span style="width:${p}%"></span></span>`;
}

export function posPill(player) {
  return `<span class="pill pos">${esc(player.positions.join('/'))}</span>`;
}

export const MORALE_LABELS = [
  [88, 'Delighted', 'good'], [72, 'Very Good', 'good'], [58, 'Good', 'good'],
  [44, 'Okay', ''], [30, 'Poor', 'warn'], [16, 'Very Poor', 'bad'], [0, 'Abysmal', 'bad'],
];

export function moraleLabel(v) {
  for (const [min, label, cls] of MORALE_LABELS) if (v >= min) return { label, cls };
  return { label: 'Abysmal', cls: 'bad' };
}

export function conditionCell(p) {
  if (p.injury) {
    return `<span class="pill bad" title="${esc(p.injury.type)}">INJ ${p.injury.daysLeft}d</span>`;
  }
  if (p.suspension > 0) return `<span class="pill bad">BAN ${p.suspension}</span>`;
  return bar(p.condition);
}

export function availability(p) {
  if (p.injury) return { ok: false, label: `Injured — ${p.injury.type} (${p.injury.daysLeft} days)`, cls: 'bad' };
  if (p.suspension > 0) return { ok: false, label: `Suspended (${p.suspension})`, cls: 'bad' };
  if (p.condition < 70) return { ok: true, label: 'Tired', cls: 'warn' };
  return { ok: true, label: 'Available', cls: 'good' };
}

export function ratingCell(avg) {
  if (!avg) return '<span class="faint">—</span>';
  const cls = avg >= 7.4 ? 'good' : avg >= 6.8 ? '' : avg >= 6.3 ? 'muted' : 'bad';
  return `<span class="${cls} mono">${avg.toFixed(2)}</span>`;
}

export function ageOf(p) { return p.age; }

/** One row of a squad table. */
export function playerRow(world, p, opts = {}) {
  const ca = currentAbility(p);
  const avg = p.season.ratingCount ? p.season.ratingSum / p.season.ratingCount : 0;
  const club = p.clubId ? world.clubs[p.clubId] : null;
  return `<tr class="clickable" data-player="${esc(p.id)}">
    <td class="num faint">${p.squadNumber ?? ''}</td>
    <td class="nowrap">${esc(p.name)}${p.custom ? ' <span class="pill info" title="Created in your player library">C</span>' : ''}</td>
    <td>${posPill(p)}</td>
    <td class="num">${p.age}</td>
    <td class="nowrap faint small">${esc(nationName(world, p.nat))}</td>
    ${opts.showClub ? `<td class="nowrap small">${club ? esc(club.short) : '<span class="faint">Free agent</span>'}</td>` : ''}
    <td>${conditionCell(p)}</td>
    <td class="nowrap small ${moraleLabel(p.morale).cls}">${moraleLabel(p.morale).label}</td>
    <td class="num">${p.season.apps + p.season.subApps}</td>
    <td class="num">${p.season.goals}</td>
    <td class="num">${p.season.assists}</td>
    <td class="num">${ratingCell(avg)}</td>
    <td class="num">${money(p.value)}</td>
    <td class="num">${p.contract ? money(p.contract.wage) : '—'}</td>
    <td>${stars(ca)}</td>
  </tr>`;
}

export const SQUAD_COLUMNS = [
  { key: 'squadNumber', label: '#', num: true },
  { key: 'name', label: 'Name' },
  { key: 'pos', label: 'Pos' },
  { key: 'age', label: 'Age', num: true },
  { key: 'nat', label: 'Nat' },
  { key: 'condition', label: 'Cond' },
  { key: 'morale', label: 'Morale' },
  { key: 'apps', label: 'Apps', num: true },
  { key: 'goals', label: 'Gls', num: true },
  { key: 'assists', label: 'Ast', num: true },
  { key: 'rating', label: 'Avg', num: true },
  { key: 'value', label: 'Value', num: true },
  { key: 'wage', label: 'Wage', num: true },
  { key: 'ability', label: 'Ability' },
];

export function sortValue(p, key, world) {
  switch (key) {
    case 'squadNumber': return p.squadNumber ?? 999;
    case 'name': return p.last || p.name;
    case 'pos': return p.positions[0];
    case 'age': return p.age;
    case 'nat': return p.nat;
    case 'condition': return p.injury ? -1 : p.condition;
    case 'morale': return p.morale;
    case 'apps': return p.season.apps + p.season.subApps;
    case 'goals': return p.season.goals;
    case 'assists': return p.season.assists;
    case 'rating': return p.season.ratingCount ? p.season.ratingSum / p.season.ratingCount : 0;
    case 'value': return p.value;
    case 'wage': return p.contract?.wage ?? 0;
    case 'ability': return currentAbility(p);
    case 'club': return p.clubId ? (world.clubs[p.clubId]?.name ?? '') : 'zzz';
    default: return 0;
  }
}

export function tableHead(columns, sortKey, sortDesc, extra = '') {
  return `<thead><tr>${columns.map((c) => `
    <th class="sortable ${c.num ? 'num' : ''} ${c.key === sortKey ? 'sorted' : ''}" data-sort="${c.key}">
      ${esc(c.label)}${c.key === sortKey ? (sortDesc ? ' ▼' : ' ▲') : ''}
    </th>`).join('')}${extra}</tr></thead>`;
}

export function nationName(world, id) {
  const n = world.nations.find((x) => x.id === id);
  return n ? n.name : id;
}

export function clubLink(club) {
  if (!club) return '<span class="faint">—</span>';
  return `<span class="clickable-club" data-club="${esc(club.id)}" style="cursor:pointer">${esc(club.name)}</span>`;
}

// --- Modal ------------------------------------------------------------------

let modalStack = [];

export function openModal({ title, body, footer = '', wide = false, narrow = false, onMount }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}">
    <div class="modal-head"><h2>${esc(title)}</h2><div class="spacer"></div><button class="ghost" data-close>✕</button></div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  root.appendChild(wrap);
  modalStack.push(wrap);
  const close = () => closeModal(wrap);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap._onKey = onKey;
  if (onMount) onMount(wrap.querySelector('.modal'), close);
  return { el: wrap, close };
}

export function closeModal(wrap) {
  const target = wrap || modalStack[modalStack.length - 1];
  if (!target) return;
  document.removeEventListener('keydown', target._onKey);
  target.remove();
  modalStack = modalStack.filter((m) => m !== target);
}

export function closeAllModals() {
  while (modalStack.length) closeModal(modalStack[modalStack.length - 1]);
}

export function confirmDialog(title, message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    openModal({
      title,
      narrow: true,
      body: `<p>${esc(message)}</p>`,
      footer: '<button data-cancel>Cancel</button><button class="primary" data-ok>' + esc(confirmLabel) + '</button>',
      onMount(modal, close) {
        modal.querySelector('[data-ok]').onclick = () => { close(); resolve(true); };
        modal.querySelector('[data-cancel]').onclick = () => { close(); resolve(false); };
      },
    });
  });
}

// --- Toast ------------------------------------------------------------------

export function toast(message, kind = '', ms = 3200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

// --- Small layout helpers ---------------------------------------------------

export function panel(title, body, actions = '') {
  return `<section class="panel">
    <div class="panel-head"><h2>${esc(title)}</h2><div class="spacer"></div>${actions}</div>
    <div class="panel-body">${body}</div>
  </section>`;
}

export function panelTight(title, body, actions = '') {
  return `<section class="panel">
    <div class="panel-head"><h2>${esc(title)}</h2><div class="spacer"></div>${actions}</div>
    <div class="panel-body tight">${body}</div>
  </section>`;
}

export function kv(pairs) {
  return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v && v.__raw ? v.value : esc(v)}</dd>`).join('')}</dl>`;
}

export function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

export function tabs(items, active) {
  return `<div class="tabs">${items.map((t) => `<button class="tab ${t.id === active ? 'active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('')}</div>`;
}

export { shortDate, formatDay, clamp, remap, POSITION_GROUP, familiarity, familiarityLabel, currentAbility };
