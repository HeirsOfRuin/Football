// Generate the install icons from an SVG, so the generator is committed rather
// than a set of binaries with no source. Chromium is already here for the
// browser passes; it is the only renderer this project has.
// Like tools/pwa-check.js this needs Playwright, which the project does not
// depend on. The icons it produces are committed; this is here so they can be
// changed by editing the artwork below rather than replaced wholesale.
//
//   npm i -D playwright && npx playwright install chromium && node tools/make-icons.js

import { writeFileSync } from 'fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('Needs Playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

// The favicon already in index.html, scaled up: a pitch centre circle and the
// halfway line, in the interface's own green on its own dark background.
const art = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#0d1b14"/>
  <g transform="translate(256 256) scale(${pad ? 0.78 : 1}) translate(-256 -256)">
    <rect x="76" y="76" width="360" height="360" rx="20" fill="none" stroke="#38d07a" stroke-width="10" opacity=".35"/>
    <circle cx="256" cy="256" r="104" fill="none" stroke="#38d07a" stroke-width="20"/>
    <path d="M256 76v360M76 256h360" stroke="#38d07a" stroke-width="12" opacity=".55"/>
    <circle cx="256" cy="256" r="18" fill="#38d07a"/>
  </g>
</svg>`;

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const [file, size, pad] of [
  ['icons/icon-192.png', 192, false],
  ['icons/icon-512.png', 512, false],
  // A maskable icon is cropped to whatever shape the launcher uses, so the
  // artwork is inset and the background runs to the edge.
  ['icons/icon-maskable-512.png', 512, true],
]) {
  const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:#0d1b14}svg{width:${size}px;height:${size}px;display:block}</style>${art(pad)}`);
  const buf = await page.screenshot({ omitBackground: false });
  writeFileSync(new URL(`../${file}`, import.meta.url), buf);
  console.log(`${file}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
  await page.close();
}
await b.close();
