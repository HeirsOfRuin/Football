// Name the service worker's cache after the files it serves, so a change to any
// of them reaches players who already have the app.
//
//   node tools/stamp-cache.mjs           rewrite CACHE in sw.js if the files changed
//   node tools/stamp-cache.mjs --check   fail if sw.js names an out-of-date cache
//
// The worker serves cache-first and deletes every cache but its own on activate,
// so its CACHE name is what decides whether a returning player gets new files.
// It was 'touchline-v1' from the first PWA commit on: never bumped. A name derived
// from the content cannot be forgotten, and `npm run check` fails while it is stale.
// (The game-building skills' build-id design does this at build time; Touchline has
// no build step, so the name is committed instead.)
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const SERVED = /^(index\.html|manifest\.webmanifest|src\/|styles\/|icons\/)/;
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((f) => SERVED.test(f)).sort();
const h = createHash('sha256');
for (const f of files) { h.update(f); h.update(await readFile(f)); }
const name = `touchline-${h.digest('hex').slice(0, 10)}`;

const sw = await readFile('sw.js', 'utf8');
const m = /const CACHE = '([^']+)';/.exec(sw);
if (!m) { console.error('!! sw.js: no `const CACHE = \'...\';` line to stamp'); process.exit(1); }
if (m[1] === name) { console.log(`ok  cache ${name} matches the ${files.length} served files`); process.exit(0); }
if (process.argv.includes('--check')) {
  console.error(`!! sw.js names cache ${m[1]}, but the served files hash to ${name}: run npm run stamp and commit sw.js`);
  process.exit(1);
}
await writeFile('sw.js', sw.replace(m[0], `const CACHE = '${name}';`));
console.log(`stamped sw.js: ${m[1]} -> ${name} (${files.length} files)`);
