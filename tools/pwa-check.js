// Is the app installable, and is the offline claim true?
//
//   node tools/pwa-check.js [port]
//
// "There is a manifest" and "it installs" are different claims, and "the files
// are cached" and "it plays with the network off" are a third and a fourth.
// Each one here is tested by doing it. The first version of this check was too
// impatient and reported a cache of seven files that was really fifty-five a
// few seconds later, so the waits are deliberate.
//
// Needs a server running (`npm run serve` in another terminal) and Playwright.
//
// Playwright is the one thing in this repository that is not zero-dependency,
// and it is deliberately not in package.json: the game, its tests and every
// other tool run with nothing installed, and that stays true. This check is
// optional, says so when it cannot run, and exits clean rather than failing a
// machine that simply does not have a browser.
//
//   npm i -D playwright && npx playwright install chromium
//   npm run pwa

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('\nThis check drives a real browser and needs Playwright, which this project\n'
    + 'deliberately does not depend on. To run it:\n\n'
    + '  npm i -D playwright && npx playwright install chromium\n'
    + '  npm run serve      # in another terminal\n'
    + '  npm run pwa\n');
  process.exit(0);
}

import { readFile, writeFile } from 'node:fs/promises';

const PORT = process.argv[2] || 8080;
const BASE = `http://localhost:${PORT}`;
const EXEC = process.env.CHROMIUM || undefined;

const rows = [];
const line = (label, ok, detail = '') => {
  rows.push({ label, ok });
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label.padEnd(50)} ${detail}`);
};

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

console.log(`\nChecking ${BASE}\n`);
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel=manifest]');
  if (!link) return { error: 'no manifest link in the page' };
  const res = await fetch(link.href);
  if (!res.ok) return { error: `manifest returned ${res.status}` };
  const m = await res.json();
  const icons = [];
  for (const i of m.icons || []) {
    const r = await fetch(new URL(i.src, link.href));
    icons.push({ src: i.src, ok: r.ok, purpose: i.purpose, sizes: i.sizes });
  }
  return { name: m.name, display: m.display, start: m.start_url, icons };
});
line('the manifest parses', !manifest.error, manifest.error || manifest.name);
line('it asks to run as an app', manifest.display === 'standalone', manifest.display || '');
line('every icon it names exists', (manifest.icons || []).every((i) => i.ok),
  `${(manifest.icons || []).length} icons`);
line('one of them is maskable', (manifest.icons || []).some((i) => /maskable/.test(i.purpose || '')),
  'Android crops the icon to the launcher shape');

const sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { error: 'no service worker support' };
  const reg = await navigator.serviceWorker.ready.catch((e) => ({ error: String(e) }));
  return reg.error ? reg : { scope: reg.scope, active: !!reg.active };
});
line('the service worker takes control', !!sw.active, sw.error || sw.scope);

// The module graph is one import tree, so a single visit loads all of it - but
// the worker is not controlling the page while that happens, which is why the
// page reports what it fetched rather than relying on the fetch handler.
await page.waitForTimeout(7000);
const cache = await page.evaluate(async () => {
  const names = await caches.keys();
  if (!names.length) return { files: 0, fetched: performance.getEntriesByType('resource').length };
  const c = await caches.open(names[0]);
  return {
    files: (await c.keys()).length,
    fetched: performance.getEntriesByType('resource').length,
  };
});
line('one visit caches the whole app', cache.files >= cache.fetched,
  `${cache.files} cached against ${cache.fetched} fetched`);

await ctx.setOffline(true);
const offlinePage = await ctx.newPage();
const offlineErrors = [];
offlinePage.on('pageerror', (e) => offlineErrors.push(e.message));
await offlinePage.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await offlinePage.waitForTimeout(3000);
const booted = await offlinePage.evaluate(() => !!window.__touchline);
line('it loads with the network off', booted, booted ? '' : 'the app did not boot');

const played = await offlinePage.evaluate(async () => {
  const app = window.__touchline;
  if (!app) return { error: 'no app' };
  app.startNewGame({ seed: 7, size: 'small', managerName: 'Offline', managerNat: 'ALB' });
  for (let i = 0; i < 80 && !app.game; i++) await new Promise((r) => setTimeout(r, 250));
  if (!app.game) return { error: 'the world never built' };
  return { clubs: Object.keys(app.game.world.clubs).length, players: Object.keys(app.game.world.players).length };
});
line('it plays with the network off', !played.error,
  played.error || `built ${played.clubs} clubs and ${played.players.toLocaleString()} players offline`);
// Does a pushed fix actually reach someone who already has the app?
//
// Serving is cache-first, so the answer is not automatic: the new build lands
// in the cache during one visit and only runs on the next. Two things here have
// already been wrong and neither failed loudly - the background refresh fetched
// with the page's own conditional headers and got a 304, so it refreshed
// nothing at all; and the worker announced the new build before the page was
// listening. Both were intermittent. So this drives the real sequence: change a
// file the app has cached, load the page, and expect to be told.
await ctx.setOffline(false);
const cssPath = new URL('../styles/main.css', import.meta.url);
const cssBefore = await readFile(cssPath, 'utf8');
let updateOffered = false;
try {
  await writeFile(cssPath, `${cssBefore}\n/* pwa-check build marker */\n`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.update-bar', { timeout: 20000 }).catch(() => {});
  updateOffered = (await page.locator('.update-bar').count()) === 1;
} finally {
  await writeFile(cssPath, cssBefore);
}
line('a new build offers itself to an existing player', updateOffered,
  updateOffered ? 'cache-first, so the fix is downloaded one load before it runs'
    : 'the update bar never appeared after a cached file changed');

line('nothing threw', pageErrors.length === 0 && offlineErrors.length === 0,
  [...pageErrors, ...offlineErrors].join('; '));

await browser.close();
const failed = rows.filter((r) => !r.ok);
console.log('\n--- Summary ---');
if (failed.length) {
  for (const f of failed) console.log(`  ${f.label}`);
  process.exitCode = 1;
} else {
  console.log('Installable on phone and desktop, and it plays with no network at all.');
}
