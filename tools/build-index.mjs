// Builds data/library.json: per-PDF page text, an auto-detected outline and physics topics.
// Run: npm run build:index   (re-run whenever PDFs are added or changed)
import { readdir, writeFile, stat, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const files = (await readdir(ROOT)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();

// Language is guessed from the file name; documents with the same "base" form a bilingual pair.
const LANG_RE = /(^|[-_ ])(english|eng|en|nederlands|dutch|nl)(?=[-_ .]|$)/i;
const langOf = (f) => (/(^|[-_ ])(nederlands|dutch|nl)(?=[-_ .]|$)/i.test(f) ? 'nl' : 'en');
const baseOf = (f) => f.replace(/\.pdf$/i, '').replace(LANG_RE, '').replace(/^[-_ ]+|[-_ ]+$/g, '');
const prettyTitle = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// LaTeX umlauts come out of pdf.js as "o¨" – fold them back into proper characters.
// The accent always precedes the letter it belongs to (e.g. "Potenti¨ele" -> "Potentiële").
const fixAccents = (s) =>
  s
    .replace(/\s*¨\s*([aeiouyAEIOUYı])/g, (_, v) => (v === 'ı' ? 'i' : v) + '̈')
    .replace(/\s*`\s*([aeiouAEIOU])/g, (_, v) => v + '̀')
    .replace(/\s*´\s*([aeiouAEIOU])/g, (_, v) => v + '́')
    .normalize('NFC');

const SUB_RE = /^(\d+\.\s|solution|oplossing|answers? to|antwoorden|key concepts|belangrijke concepten|diagram|illustrati|afbeelding|visuali[sz]ation)/i;
const FIGURE_RE = /^(\d+\.\s*)?(diagram|illustrati|afbeelding|visuali[sz]ation|ray diagram|stralendiagram)/i;

// Physics domains, matched against the title of each top-level entry (EN + NL keywords).
const DOMAINS = [
  ['nuclear', /nucle|kern|radioact|decay|verval|binding|fission|fusion|atomic number|atoomnummer/i],
  ['quantum', /quantum|kwantum|photoelectr|foto-elektr|blackbody|zwartestral|heisenberg|schr|bohr|spectr|particle-wave|deeltje-golf|rutherford/i],
  ['relativity', /relativ|einstein|michelson|time dilation|tijdsdilatie/i],
  ['fluids', /fluid|fluïdum|pascal|bernoulli|flow rate|stroomsnelheid|buoyan|archimed/i],
  ['magnetism', /magnet|faraday|lenz['’]|wet van lenz|induct|emf\b|emk\b|moving charge|bewegende lading/i],
  ['electricity', /electr|elektr|charge|lading|coulomb|current|stroom|circuit|schakel|resist|weerstand|ohm|kirchhoff|capacit|conductor|geleider/i],
  ['optics', /optic|optica|light|licht|\blens|lenzen|mirror|spiegel|snell|diffract|huygens|young|slit|spleet|polari|dispers|ray diagram|stralendiagram/i],
  ['waves', /wave|golf|golven|oscillat|doppler|resonan|interfer|sound|geluid|superpos/i],
  ['thermo', /heat|warmte|thermo|\bgas|temperat|phase|fase|carnot|kelvin|expansion|uitzetting/i],
  ['gravity', /gravit|zwaartekracht|kepler|satellit|orbit|escape|ontsnap|planet/i],
  ['rotation', /torque|koppel|angular|hoekimpuls|hoekpositie|rotat|moment of inertia|traagheidsmoment|ballerina/i],
  ['mechanics', /momentum|impuls|collision|botsing|mass|massa|work|arbeid|energy|energie|hooke|newton|force|kracht|friction|wrijving|projectile|projectiel|speed|snelheid|velocity|accelerat|versnell|free fall|vrije val|vector|cosin|inclined|hellend|circular|cirkel/i],
];
const domainOf = (title) => (DOMAINS.find(([, re]) => re.test(title)) || [null])[0];


const docs = [];
for (const file of files) {
  const pdf = await getDocument({ url: ROOT + file, verbosity: 0 }).promise;
  const pages = [];
  const raw = []; // heading lines in reading order
  const fontCount = {};
  const pageItems = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    pageItems.push(tc.items);
    for (const it of tc.items) {
      const s = Math.hypot(it.transform[0], it.transform[1]);
      if (s > 14 && s < 15 && it.str.trim().length > 2) fontCount[it.fontName] = (fontCount[it.fontName] || 0) + 1;
    }
  }
  const boldFont = Object.entries(fontCount).sort((a, b) => b[1] - a[1])[0][0];

  const pageHeights = [];
  for (let p = 1; p <= pdf.numPages; p++) pageHeights.push((await pdf.getPage(p)).view[3]);

  pageItems.forEach((items, idx) => {
    const p = idx + 1;
    let text = '';
    let lastY = null;
    const lines = new Map();
    for (const it of items) {
      const size = Math.hypot(it.transform[0], it.transform[1]);
      const x = it.transform[4];
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
      text += it.str + (it.hasEOL ? '\n' : '');
      lastY = y;
      if (it.fontName !== boldFont || !it.str.trim()) continue;
      const big = size > 24;
      const sec = size > 14 && size < 15;
      if (!big && !sec) continue;
      const key = (big ? 'B' : 'S') + y;
      if (!lines.has(key)) lines.set(key, { y, big, x, parts: [] });
      const l = lines.get(key);
      l.x = Math.min(l.x, x);
      l.parts.push(it.str);
    }
    const sorted = [...lines.values()].filter((l) => l.big || l.x < 80).sort((a, b) => b.y - a.y);
    for (const l of sorted) {
      const title = fixAccents(l.parts.join(' ').replace(/\s+/g, ' ').trim());
      if (title.length < 3 || /^[\W\d]+$/.test(title)) continue;
      const prev = raw[raw.length - 1];
      // Titles wrapped onto a second line: same style, same page, close below the previous line.
      if (prev && prev.page === p && prev.big === l.big && prev.y - l.y < (l.big ? 32 : 22)) {
        prev.title = (prev.title.endsWith('-') ? prev.title.slice(0, -1) : prev.title + ' ') + title;
        prev.y = l.y;
        continue;
      }
      // "at": vertical position of the heading as a fraction of the page height (0 = top)
      raw.push({ title, page: p, y: l.y, big: l.big, at: +(1 - (l.y + (l.big ? 24 : 14)) / pageHeights[idx]).toFixed(3) });
    }
    pages.push(fixAccents(text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()));
  });

  // Build a two-level outline: topics, each with sub-sections and figures.
  const topics = [];
  for (const h of raw) {
    const title = h.title.replace(/\s+([,.:)])/g, '$1').replace(/\(\s+/g, '(');
    const isSub = SUB_RE.test(title) || (/^(solution|oplossing)/i.test(title));
    if (isSub && topics.length) {
      topics[topics.length - 1].children.push({ title, page: h.page, at: h.at, figure: FIGURE_RE.test(title) });
      continue;
    }
    // Equation fragments such as "P, V, T P’, V’, T’" are figure labels, not topics.
    if (!/[A-Za-zÀ-ÿ]{4,}/.test(title)) continue;
    topics.push({ title, page: h.page, at: h.at, children: [] });
  }

  const { size } = await stat(ROOT + file);
  docs.push({
    id: file.replace(/\.pdf$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    file,
    lang: langOf(file),
    group: baseOf(file).toLowerCase(),
    title: prettyTitle(baseOf(file)),
    numPages: pdf.numPages,
    bytes: size,
    topics,
    pages,
  });
  console.log(`${file}: ${pdf.numPages} pages, ${topics.length} topics`);
}

// Align topics between language versions of the same document (sequence alignment on page
// position) so the reader can jump to the same exercise in the other language.
// Each aligned pair shares a "key"; the domain is decided from both titles together.
const groups = Object.groupBy(docs, (d) => d.group);
let keySeq = 0;
for (const members of Object.values(groups)) {
  const [a, b] = [...members].sort((x, y) => (x.lang === 'en' ? -1 : 1) - (y.lang === 'en' ? -1 : 1));
  if (!b) {
    a.topics.forEach((t) => (t.key = 'k' + keySeq++));
  } else {
    const A = a.topics, B = b.topics, GAP = 6;
    // Cognates and proper names (Bernoulli, Carnot, GPE, Kepler…) survive translation: reward shared stems.
    const stems = (t) => new Set(t.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).map((w) => w.slice(0, 5)));
    const sim = (x, y) => {
      const p = stems(x.title), q = stems(y.title);
      let n = 0;
      for (const w of p) if (q.has(w)) n++;
      return n / Math.max(1, Math.min(p.size, q.size));
    };
    const cost = (x, y) =>
      Math.abs(x.page / a.numPages - y.page / b.numPages) * 200 + Math.abs(x.children.length - y.children.length) * 2 + (1 - sim(x, y)) * 6;
    const D = Array.from({ length: A.length + 1 }, () => new Float64Array(B.length + 1));
    for (let i = 1; i <= A.length; i++) D[i][0] = i * GAP;
    for (let j = 1; j <= B.length; j++) D[0][j] = j * GAP;
    for (let i = 1; i <= A.length; i++)
      for (let j = 1; j <= B.length; j++)
        D[i][j] = Math.min(D[i - 1][j - 1] + cost(A[i - 1], B[j - 1]), D[i - 1][j] + GAP, D[i][j - 1] + GAP);
    const pairs = [];
    for (let i = A.length, j = B.length; i > 0 || j > 0; ) {
      if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + cost(A[i - 1], B[j - 1])) pairs.push([A[--i], B[--j]]);
      else if (i > 0 && D[i][j] === D[i - 1][j] + GAP) pairs.push([A[--i], null]);
      else pairs.push([null, B[--j]]);
    }
    pairs.reverse().forEach(([x, y]) => {
      const key = 'k' + keySeq++;
      if (x) x.key = key;
      if (y) y.key = key;
    });
  }
  // Domain: from the (paired) titles; untagged topics inherit the previous one (chapters are contiguous).
  for (const d of members) {
    let domain = 'mechanics';
    for (const t of d.topics) {
      const partner = members.flatMap((m) => m.topics).filter((o) => o.key === t.key && o !== t);
      const enTitle = d.lang === 'en' ? t.title : partner[0]?.title || '';
      domain = domainOf(enTitle) || domainOf(t.title) || domain;
      t.domain = domain;
    }
  }
}

await writeFile(ROOT + 'data/library.json', JSON.stringify({ generated: new Date().toISOString(), docs }));
console.log('wrote data/library.json');

// Self-host pdf.js so the site works without a CDN (and offline).
const PDFJS = ROOT + 'node_modules/pdfjs-dist/build/';
await mkdir(ROOT + 'vendor/pdfjs', { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) await copyFile(PDFJS + f, ROOT + 'vendor/pdfjs/' + f);
console.log('copied pdf.js into vendor/pdfjs');
