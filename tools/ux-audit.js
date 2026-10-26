// How much is on each screen, at the size people actually play on?
//
//   node tools/ux-audit.js [port]
//
// "Too much information at once" is a real complaint and an unmeasurable one
// until someone counts. This visits every screen on a mid-season save at
// 390x844 and reports the things that make a screen heavy: how far it scrolls,
// how many panels and table rows it puts up at once, how many separate numbers
// it shows, and whether anything overflows sideways.
//
// It is a density meter, not a verdict. A league table is supposed to have
// twenty rows. The numbers are here so a change can be shown to have reduced
// the load rather than asserted to have done.
//
// Needs a server running (`npm run serve`) and Playwright, which this project
// deliberately does not depend on - it says so and exits clean without it.

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('\nThis audit drives a real browser and needs Playwright, which this project\n'
    + 'deliberately does not depend on. To run it:\n\n'
    + '  npm i -D playwright && npx playwright install chromium\n'
    + '  npm run serve      # in another terminal\n'
    + '  npm run ux\n');
  process.exit(0);
}

const PORT = process.argv[2] || 8080;
const BASE = `http://localhost:${PORT}`;
const EXEC = process.env.CHROMIUM || undefined;
const VIEW = { width: 390, height: 844 };

const SCREENS = [
  'dashboard', 'inbox', 'squad', 'tactics', 'squads', 'training', 'club',
  'career', 'fixtures', 'league', 'world', 'transfers', 'finances',
];

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await browser.newContext({ viewport: VIEW });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}`));

await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__touchline, null, { timeout: 30000 });

// A mid-season save: the state most screens are read in, and the one where a
// dashboard has something to say.
await page.evaluate(async () => {
  const app = window.__touchline;
  app.startNewGame({ seed: 20260218, size: 'small', managerName: 'Audit', managerNat: 'ALB' });
  for (let i = 0; i < 160 && !app.game; i++) await new Promise((r) => setTimeout(r, 250));
  const { takeOverClub, advanceDay, playFixture } = await import('/src/state/game.js');
  const lg = app.game.world.leagues.find((l) => l.nation === 'ALB' && l.tier === 1);
  takeOverClub(app.game, lg.clubIds[3], 'Audit', 'ALB');
  for (let d = 0; d < 150; d++) {
    const r = advanceDay(app.game);
    if (r.stopped && r.reason === 'userMatch') {
      playFixture(app.game, app.game.fixtures[app.game.pendingMatchId]);
      app.game.status = 'idle';
      app.game.pendingMatchId = null;
    }
    if (r.stopped && r.reason === 'seasonRollover') break;
  }
});
await page.waitForTimeout(400);

const rows = [];
for (const id of SCREENS) {
  await page.evaluate((s) => window.__touchline.go(s), id);
  await page.waitForTimeout(260);
  const m = await page.evaluate(() => {
    const main = document.querySelector('.content') || document.querySelector('#app');
    const text = main.innerText || '';
    // A "number" is any run of digits that is not part of a word - the things a
    // reader has to decide whether to care about.
    const numbers = text.match(/(?<![\w.])\d[\d,.]*/g) || [];
    return {
      height: Math.round(main.scrollHeight),
      viewport: Math.round(main.clientHeight),
      panels: main.querySelectorAll('.panel').length,
      tables: main.querySelectorAll('table').length,
      rows: main.querySelectorAll('tbody tr').length,
      numbers: numbers.length,
      words: text.trim().split(/\s+/).filter(Boolean).length,
      tabs: main.querySelectorAll('[data-tab]').length,
      buttons: main.querySelectorAll('button').length,
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
  rows.push({ id, ...m, screens: +(m.height / Math.max(1, m.viewport)).toFixed(1) });
}

console.log(`\n${BASE} at ${VIEW.width}x${VIEW.height}, mid-season\n`);
console.log('  screen        scrolls  panels  tables  rows  numbers  words  tabs  btns  ovf');
for (const r of rows) {
  console.log(`  ${r.id.padEnd(12)} ${String(r.screens).padStart(6)}x`
    + `${String(r.panels).padStart(8)}${String(r.tables).padStart(8)}`
    + `${String(r.rows).padStart(6)}${String(r.numbers).padStart(9)}`
    + `${String(r.words).padStart(7)}${String(r.tabs).padStart(6)}`
    + `${String(r.buttons).padStart(6)}${String(r.overflow).padStart(5)}`);
}

const worst = [...rows].sort((a, b) => b.numbers - a.numbers).slice(0, 3);
const tall = [...rows].sort((a, b) => b.height - a.height).slice(0, 3);
console.log(`\n  most numbers at once: ${worst.map((r) => `${r.id} ${r.numbers}`).join(', ')}`);
console.log(`  longest scroll:       ${tall.map((r) => `${r.id} ${r.screens}x`).join(', ')}`);
console.log(`  horizontal overflow:  ${rows.filter((r) => r.overflow > 0).map((r) => r.id).join(', ') || 'none'}`);
console.log(`  page errors:          ${errors.length ? errors.join('; ') : 'none'}`);

await browser.close();
process.exitCode = errors.length || rows.some((r) => r.overflow > 0) ? 1 : 0;
