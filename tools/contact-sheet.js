// Renders every club's crest and kit in a division to one HTML page.
//
//   node tools/contact-sheet.js [size] [seed] > sheet.html
//
// Generated art has to be looked at, not reasoned about. A crest can pass every
// assertion in the suite and still be unreadable at 18 pixels, or turn out to be
// the fourth near-identical green shield in a division. Both problems are
// obvious in a grid and invisible one club at a time.

import { generateWorld } from '../src/gen/worldgen.js';
import { crestSvg, kitSvg, paletteFor } from '../src/gen/identity.js';
import { sortBy } from '../src/core/util.js';

const size = process.argv[2] || 'small';
const seed = Number(process.argv[3] || 4242);
const world = generateWorld({ seed, size });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

let html = `<!doctype html><meta charset="utf-8"><title>Touchline crests — ${esc(size)} / ${seed}</title>
<style>
  body { background:#12151a; color:#e6e9ef; font:13px/1.4 system-ui,sans-serif; margin:0; padding:24px; }
  h1 { font-size:18px; margin:0 0 4px; } h2 { font-size:14px; margin:28px 0 10px; color:#9aa4b2;
       border-bottom:1px solid #262b34; padding-bottom:6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:14px; }
  .club { text-align:center; }
  .art { display:flex; gap:6px; justify-content:center; align-items:flex-end; }
  svg { image-rendering:pixelated; }
  .big { width:56px; height:56px; } .small { width:18px; height:18px; } .kit { width:38px; height:38px; }
  .nm { font-size:11px; margin-top:5px; color:#c8cedb; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .hue { font:10px var(--mono,monospace); color:#6b7583; }
  .sw { display:inline-block; width:9px; height:9px; border-radius:2px; vertical-align:-1px; }
  .note { color:#9aa4b2; max-width:60ch; }
</style>
<h1>Touchline crests — ${esc(size)} world, seed ${seed}</h1>
<p class="note">Each club shows its crest at 56px and at 18px (the size a league table
actually draws), plus its kit. Read each division as a block: if two clubs read
as the same side at 18px, the hue spread is not doing its job.</p>`;

for (const league of sortBy(world.leagues, (l) => l.nation, (l) => l.tier)) {
  const clubs = league.clubIds.map((id) => world.clubs[id]);
  html += `\n<h2>${esc(league.name)} — tier ${league.tier}, ${clubs.length} clubs</h2>\n<div class="grid">`;
  for (const c of clubs) {
    const pal = paletteFor(c.identity);
    html += `<div class="club">
      <div class="art">
        <span class="big">${crestSvg(c)}</span>
        <span class="small">${crestSvg(c)}</span>
        <span class="kit">${kitSvg(c)}</span>
      </div>
      <div class="nm">${esc(c.name)}</div>
      <div class="hue">h${Math.round(c.identity.hue)} ${esc(c.identity.kit)}
        <span class="sw" style="background:${pal.primary}"></span><span class="sw" style="background:${pal.secondary}"></span></div>
    </div>`;
  }
  html += '</div>';
}

// Size the inline SVGs by wrapping spans.
html = html.replace(/<span class="(big|small|kit)">(<svg)/g,
  (_, cls, svg) => `<span class="${cls}">${svg.replace('<svg', `<svg class="${cls}"`)}`);

process.stdout.write(html);
