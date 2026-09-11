// The player profile modal — reachable from every screen that lists players.

import { esc, openModal, money, stars, moraleLabel, attrClass, toast, confirmDialog, kv, raw } from './components.js';
import { ATTR_GROUPS, ATTR_LABELS, POSITIONS, POSITION_LABELS, currentAbility, abilityForPosition, familiarity, familiarityLabel } from '../data/attributes.js';
import { TRAITS } from '../gen/playergen.js';
import { expectedRole, ROLE_LABELS, developmentRate } from '../engine/training.js';
import { marketValue, askingPrice, scoutReport } from '../engine/transfers.js';
import { sortBy } from '../core/util.js';
import { subRng } from '../core/rng.js';
import { abilityTier } from '../state/library.js';

const HIDDEN_LABELS = {
  consistency: 'Consistency', importantMatches: 'Big Matches', injuryProneness: 'Injury Proneness',
  professionalism: 'Professionalism', ambition: 'Ambition', loyalty: 'Loyalty',
  adaptability: 'Adaptability', versatility: 'Versatility', dirtiness: 'Dirtiness',
  pressureHandling: 'Pressure Handling',
};

function attrList(attrs, keys) {
  return keys.map((a) => `<div class="attr-row">
    <span class="label">${esc(ATTR_LABELS[a])}</span>
    <span class="val ${attrClass(attrs[a])}">${attrs[a]}</span></div>`).join('');
}

export function showPlayer(app, playerId, opts = {}) {
  const game = app.game;
  const world = game.world;
  const p = world.players[playerId];
  if (!p) return;
  const club = p.clubId ? world.clubs[p.clubId] : null;
  const user = game.userClubId ? world.clubs[game.userClubId] : null;
  const isOurs = club && user && club.id === user.id;
  const ca = currentAbility(p);
  const isGk = p.positions.includes('GK');
  const nation = world.nations.find((n) => n.id === p.nat);
  const avg = p.season.ratingCount ? p.season.ratingSum / p.season.ratingCount : 0;

  // Players outside the club are seen through the scouting network.
  const report = !isOurs && user
    ? scoutReport(world, user, p, subRng(game.rng, `scout:${p.id}:${game.season}`))
    : null;

  const contract = p.contract;
  const yearsLeft = contract ? contract.expiresYear - world.year : 0;

  const positionRows = sortBy(POSITIONS.map((pos) => ({ pos, v: abilityForPosition(p.attrs, pos), f: familiarity(p, pos) })),
    { key: (x) => x.v, desc: true }).slice(0, 6);

  const body = `
  <div class="grid c1-2" style="gap:16px">
    <div class="stack">
      <div>
        <div class="row" style="gap:12px;align-items:flex-start">
          <div>
            <div style="font-size:20px;font-weight:700">${esc(p.name)}</div>
            <div class="muted small">${esc(p.positions.map((x) => POSITION_LABELS[x]).join(', '))}</div>
            <div class="faint small">${esc(nation?.name || p.nat)} · ${p.age} years · ${p.height}cm · ${esc(p.foot)} footed
              ${p.custom ? ' · <span class="pill info">Your creation</span>' : ''}</div>
          </div>
          <div class="spacer"></div>
          <div class="right">
            ${stars(ca)}
            <div class="faint small">${esc(report ? `${report.abilityLow}-${report.abilityHigh} est.` : `${ca} ability`)}</div>
          </div>
        </div>
      </div>

      <section class="panel"><div class="panel-head"><h2>Status</h2></div><div class="panel-body">
        ${kv([
    ['Club', club ? club.name : 'Free agent'],
    ['Squad role', club ? ROLE_LABELS[expectedRole(world, club, p)] : '—'],
    ['Condition', raw(p.injury ? `<span class="bad">${esc(p.injury.type)} — ${p.injury.daysLeft} days</span>` : `${Math.round(p.condition)}%`)],
    ['Match sharpness', `${Math.round(p.sharpness)}%`],
    ['Morale', raw(`<span class="${moraleLabel(p.morale).cls}">${moraleLabel(p.morale).label}</span>`)],
    ['Form', raw(p.form > 0.4 ? '<span class="good">In form</span>' : p.form < -0.4 ? '<span class="bad">Out of form</span>' : 'Steady')],
    ['Suspension', p.suspension > 0 ? `${p.suspension} match${p.suspension > 1 ? 'es' : ''}` : 'None'],
    ['Yellow cards', String(p.yellowCards || 0)],
    ['Personality', report ? report.knownPersonality : p.personality],
    ['Potential', report ? `${report.potentialLow}-${report.potentialHigh} est.` : `${p.pa} (${abilityTier(p.pa)})`],
  ])}
      </div></section>

      <section class="panel"><div class="panel-head"><h2>Contract &amp; Value</h2></div><div class="panel-body">
        ${kv([
    ['Market value', money(marketValue(world, p))],
    ['Asking price', club ? money(askingPrice(world, p)) : 'Free'],
    ['Wage', contract ? `${money(contract.wage)}/week` : 'None'],
    ['Expires', contract ? `${contract.expiresYear} (${yearsLeft <= 0 ? 'this summer' : `${yearsLeft} yr`})` : '—'],
    ['Release clause', contract?.releaseClause ? money(contract.releaseClause) : 'None'],
    ['Transfer status', p.transferStatus === 'listed' ? 'Transfer listed' : p.transferStatus === 'loanListed' ? 'Loan listed' : 'Not available'],
  ])}
      </div></section>

      <section class="panel"><div class="panel-head"><h2>Best Positions</h2></div><div class="panel-body">
        ${positionRows.map((r) => `<div class="attr-row">
          <span class="label">${esc(POSITION_LABELS[r.pos])}</span>
          <span class="faint small" style="width:92px;text-align:right">${esc(familiarityLabel(r.f))}</span>
          <span class="val ${attrClass(r.v / 10)}">${r.v}</span></div>`).join('')}
      </div></section>

      ${(p.traits || []).length ? `<section class="panel"><div class="panel-head"><h2>Traits</h2></div><div class="panel-body">
        ${p.traits.map((t) => `<div class="small">${esc(TRAITS.find((x) => x.id === t)?.name || t)}</div>`).join('')}
      </div></section>` : ''}
    </div>

    <div class="stack">
      <div class="grid c3">
        <section class="panel"><div class="panel-head"><h2>${isGk ? 'Goalkeeping' : 'Technical'}</h2></div>
          <div class="panel-body">${attrList(p.attrs, isGk ? ATTR_GROUPS.goalkeeping : ATTR_GROUPS.technical)}</div></section>
        <section class="panel"><div class="panel-head"><h2>Mental</h2></div>
          <div class="panel-body">${attrList(p.attrs, ATTR_GROUPS.mental)}</div></section>
        <section class="panel"><div class="panel-head"><h2>Physical</h2></div>
          <div class="panel-body">${attrList(p.attrs, ATTR_GROUPS.physical)}</div></section>
      </div>

      <section class="panel"><div class="panel-head"><h2>This Season</h2></div><div class="panel-body tight">
        <table><thead><tr><th class="num">Apps</th><th class="num">Sub</th><th class="num">Mins</th>
          <th class="num">Gls</th><th class="num">Ast</th><th class="num">${isGk ? 'Saves' : 'Shots'}</th>
          <th class="num">${isGk ? 'Clean' : 'Key P'}</th><th class="num">Yel</th><th class="num">Red</th><th class="num">MotM</th><th class="num">Avg</th></tr></thead>
        <tbody><tr>
          <td class="num">${p.season.apps}</td><td class="num">${p.season.subApps}</td><td class="num">${p.season.minutes}</td>
          <td class="num">${p.season.goals}</td><td class="num">${p.season.assists}</td>
          <td class="num">${isGk ? p.season.saves : p.season.shots}</td>
          <td class="num">${isGk ? p.season.cleanSheets : p.season.keyPasses}</td>
          <td class="num">${p.season.yellow}</td><td class="num">${p.season.red}</td><td class="num">${p.season.motm}</td>
          <td class="num">${avg ? avg.toFixed(2) : '—'}</td>
        </tr></tbody></table>
      </div></section>

      ${p.career.seasons.length ? `<section class="panel"><div class="panel-head"><h2>Career</h2></div><div class="panel-body tight">
        <div class="scroll-y" style="max-height:170px"><table><thead><tr><th>Season</th><th>Club</th>
          <th class="num">Apps</th><th class="num">Gls</th><th class="num">Ast</th><th class="num">Avg</th></tr></thead><tbody>
          ${[...p.career.seasons].reverse().map((s) => `<tr>
            <td class="mono small">${s.year}/${String(s.year + 1).slice(2)}</td>
            <td class="small">${esc(world.clubs[s.clubId]?.short || '—')}</td>
            <td class="num">${s.apps}</td><td class="num">${s.goals}</td><td class="num">${s.assists}</td>
            <td class="num">${s.rating ? s.rating.toFixed(2) : '—'}</td></tr>`).join('')}
        </tbody></table></div>
      </div></section>` : ''}

      ${isOurs ? `<section class="panel"><div class="panel-head"><h2>Coach Report</h2></div><div class="panel-body">
        <p class="small" style="margin-top:0">${esc(coachReport(world, club, p))}</p>
        <div class="grid c2">${Object.entries(HIDDEN_LABELS).map(([k, label]) => `
          <div class="attr-row"><span class="label">${esc(label)}</span>
          <span class="val ${attrClass(p.hidden[k])}">${p.hidden[k]}</span></div>`).join('')}</div>
      </div></section>` : ''}
    </div>
  </div>`;

  const footer = buildFooter(app, p, isOurs, opts);

  openModal({
    title: p.name,
    wide: true,
    body,
    footer,
    onMount(modal, close) {
      wireFooter(app, modal, close, p, isOurs, opts);
    },
  });
}

function coachReport(world, club, p) {
  const rate = developmentRate(world, club, p);
  const gap = p.pa - currentAbility(p);
  const parts = [];
  if (rate > 0.09) parts.push('Developing quickly under the current programme.');
  else if (rate > 0.04) parts.push('Making steady progress.');
  else if (rate > 0.005) parts.push('Close to the ceiling — small gains only from here.');
  else if (rate < -0.02) parts.push('Past his peak; the physical attributes are slipping.');
  else parts.push('Settled at his level.');
  if (gap > 40) parts.push('There is a lot still to come if he keeps working.');
  else if (gap > 15) parts.push('Some room left to grow.');
  if ((p.hidden.professionalism ?? 10) >= 16) parts.push('An excellent professional.');
  else if ((p.hidden.professionalism ?? 10) <= 7) parts.push('His attitude to training is a concern.');
  if ((p.hidden.injuryProneness ?? 10) >= 15) parts.push('Picks up more than his share of knocks.');
  if ((p.hidden.consistency ?? 10) <= 8) parts.push('Performances swing from week to week.');
  return parts.join(' ');
}

function buildFooter(app, p, isOurs, opts) {
  const game = app.game;
  const buttons = [];
  if (opts.extraButtons) buttons.push(opts.extraButtons);
  if (isOurs) {
    buttons.push(`<button data-act="list">${p.transferStatus === 'listed' ? 'Remove from transfer list' : 'Add to transfer list'}</button>`);
    buttons.push('<button data-act="renew">Offer new contract</button>');
    if (p.contract) buttons.push('<button class="danger" data-act="release">Release</button>');
  } else if (game.userClubId) {
    const onList = game.shortlist.includes(p.id);
    buttons.push(`<button data-act="shortlist">${onList ? 'Remove from shortlist' : 'Add to shortlist'}</button>`);
    buttons.push('<button class="primary" data-act="bid">Make an offer</button>');
  }
  buttons.push('<button data-close>Close</button>');
  return buttons.join('');
}

function wireFooter(app, modal, close, p, isOurs, opts) {
  const game = app.game;
  const q = (sel) => modal.querySelector(sel);

  const list = q('[data-act="list"]');
  if (list) {
    list.onclick = () => {
      p.transferStatus = p.transferStatus === 'listed' ? 'none' : 'listed';
      toast(p.transferStatus === 'listed' ? `${p.name} is transfer listed.` : `${p.name} is no longer listed.`);
      close();
      app.refresh();
    };
  }
  const shortlist = q('[data-act="shortlist"]');
  if (shortlist) {
    shortlist.onclick = () => {
      const i = game.shortlist.indexOf(p.id);
      if (i >= 0) game.shortlist.splice(i, 1); else game.shortlist.push(p.id);
      toast(i >= 0 ? 'Removed from shortlist.' : 'Added to shortlist.');
      close();
      app.refresh();
    };
  }
  const release = q('[data-act="release"]');
  if (release) {
    release.onclick = async () => {
      const payoff = Math.round((p.contract?.wage || 0) * 52 * Math.max(0.4, (p.contract.expiresYear - game.world.year)) * 0.35);
      if (await confirmDialog('Release player',
        `Terminate ${p.name}'s contract? A pay-off of ${money(payoff)} is due, and he joins the free agent pool.`, 'Release')) {
        const { releasePlayer } = await import('../engine/transfers.js');
        const club = game.world.clubs[p.clubId];
        club.finances.balance -= payoff;
        club.finances.seasonSpend += payoff;
        releasePlayer(game, p);
        close();
        app.refresh();
        toast(`${p.name} released.`);
      }
    };
  }
  const renew = q('[data-act="renew"]');
  if (renew) renew.onclick = async () => { close(); (await import('./negotiate.js')).showContractDialog(app, p, 'renew'); };
  const bid = q('[data-act="bid"]');
  if (bid) bid.onclick = async () => { close(); (await import('./negotiate.js')).showBidDialog(app, p); };

  if (opts.onMount) opts.onMount(modal, close);
}
