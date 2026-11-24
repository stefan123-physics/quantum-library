// Renders the app icons, favicons and the link-preview image with headless Chrome.
//   npm run build:icons                       (relative URLs in the share tags)
//   SITE_URL=https://example.org npm run build:icons   (absolute URLs, required by Facebook/LinkedIn/X)
// Sources: brand/icon.svg (app icon), favicon.svg (tab icon), brand/og.html (share image).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'icons');
const TMP = join(ROOT, 'brand', '.tmp');
const CHROME = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser'][0];
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

// Hosting builders (Vercel, Netlify…) have no Chrome. The rendered files are committed, so skip
// instead of failing the deploy.
try {
  await run(CHROME, ['--version']);
} catch {
  console.warn(`build:icons skipped: "${CHROME}" not found. Using the committed icons and og-image.png.`);
  process.exit(0);
}

// --- tiny static server so the share image can fetch data/library.json and the PDFs
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// pdf.js draws in a web worker, which Chrome's virtual time does not wait for, so the share image
// uses a real-time delay instead.
async function shot(url, file, w, h, { transparent = false, wait = 3000, realtime = false } = {}) {
  const profile = join(tmpdir(), 'ql-chrome-' + process.pid);
  await run(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`, realtime ? `--timeout=${wait}` : `--virtual-time-budget=${wait}`, '--force-device-scale-factor=1',
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--screenshot=${file}`, url,
  ]);
  console.log('  ✓', file.replace(ROOT, ''), `${w}×${h}`);
}

await mkdir(OUT, { recursive: true });
await mkdir(TMP, { recursive: true });

// App icon variants from one template: "any" (rounded, transparent corners), "maskable"
// (full bleed, artwork inside the 80% safe zone) and Apple (full bleed — iOS rounds it itself).
const master = await readFile(join(ROOT, 'brand/icon.svg'), 'utf8');
const variants = {
  any: master.replace('__RX__', '112').replace('__SCALE__', '1'),
  maskable: master.replace('__RX__', '0').replace('__SCALE__', '0.8'),
  apple: master.replace('__RX__', '0').replace('__SCALE__', '0.92'),
};
for (const [k, svg] of Object.entries(variants)) await writeFile(join(TMP, `${k}.svg`), svg);
await writeFile(join(OUT, 'icon.svg'), variants.any);
await writeFile(join(OUT, 'maskable.svg'), variants.maskable);

// Each render is a tiny served page holding the SVG at the exact pixel size.
let pageNo = 0;
async function page(src, size) {
  const name = `wrap-${pageNo++}.html`;
  await writeFile(join(TMP, name), `<!doctype html><body style="margin:0;background:transparent"><img src="/${src}" width="${size}" height="${size}" style="display:block">`);
  return `${BASE}/brand/.tmp/${name}`;
}

console.log('Rendering icons…');
const jobs = [
  ['brand/.tmp/any.svg', 'icon-192.png', 192, true],
  ['brand/.tmp/any.svg', 'icon-512.png', 512, true],
  ['brand/.tmp/maskable.svg', 'maskable-192.png', 192, false],
  ['brand/.tmp/maskable.svg', 'maskable-512.png', 512, false],
  ['brand/.tmp/apple.svg', 'apple-touch-icon.png', 180, false],
  ['favicon.svg', 'favicon-32.png', 32, true],
  ['favicon.svg', 'favicon-48.png', 48, true],
];
for (const [src, out, size, transparent] of jobs) await shot(await page(src, size), join(OUT, out), size, size, { transparent, wait: 800 });

// favicon.ico for old browsers / crawlers that ask for /favicon.ico: an ICO wrapping the PNGs.
const pngs = [await readFile(join(OUT, 'favicon-32.png')), await readFile(join(OUT, 'favicon-48.png'))];
const sizes = [32, 48];
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const o = 6 + i * 16;
  header.writeUInt8(sizes[i], o);
  header.writeUInt8(sizes[i], o + 1);
  header.writeUInt16LE(1, o + 4);
  header.writeUInt16LE(32, o + 6);
  header.writeUInt32LE(png.length, o + 8);
  header.writeUInt32LE(offset, o + 12);
  offset += png.length;
});
await writeFile(join(ROOT, 'favicon.ico'), Buffer.concat([header, ...pngs]));
console.log('  ✓ /favicon.ico');

console.log('Rendering share image…');
await shot(`${BASE}/brand/og.html`, join(ROOT, 'og-image.png'), 1200, 630, { wait: 20000 });

// Point the share tags at absolute URLs when SITE_URL is known.
const indexPath = join(ROOT, 'index.html');
let html = await readFile(indexPath, 'utf8');
const abs = (p) => (SITE_URL ? `${SITE_URL}/${p}` : p);
html = html
  .replace(/(<meta property="og:image" content=")[^"]*/, `$1${abs('og-image.png')}`)
  .replace(/(<meta name="twitter:image" content=")[^"]*/, `$1${abs('og-image.png')}`)
  .replace(/(<meta property="og:url" content=")[^"]*/, `$1${SITE_URL ? SITE_URL + '/' : './'}`);
await writeFile(indexPath, html);
console.log(SITE_URL ? `Share tags now point at ${SITE_URL}` : 'Tip: set SITE_URL=https://your-domain to write absolute share URLs.');

await rm(TMP, { recursive: true, force: true });
server.close();
