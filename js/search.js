// Client-side search over topics and full page text, with EN<->NL synonym expansion and fuzzy matching.
import { SYNONYMS } from './i18n.js';

// Lower-case, accent-free, one output char per input UTF-16 unit — so offsets found in the
// normalised text point at the same place in the original text (needed for snippets/highlights).
const normCache = new Map();
export const norm = (s) => {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 128) {
      out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : code === 10 || code === 9 || code === 13 ? ' ' : s[i];
      continue;
    }
    const c = s[i];
    let n = normCache.get(c);
    if (n === undefined) {
      n = /\s/.test(c) ? ' ' : c === '’' || c === '‘' ? "'" : c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      n = n.length === 1 ? n : n[0] || ' ';
      normCache.set(c, n);
    }
    out += n;
  }
  return out;
};

const SYN = new Map();
for (const group of SYNONYMS) {
  const g = group.map(norm);
  for (const w of g) SYN.set(w, [...new Set([...(SYN.get(w) || []), ...g])]);
}

// Each query term becomes a set of alternatives (itself + translations).
function expand(query) {
  const q = norm(query).trim().replace(/ +/g, ' ');
  if (!q) return [];
  const terms = [];
  // multi-word synonyms first ("free fall", "time dilation")
  let rest = q;
  for (const [k, alts] of SYN) {
    if (k.includes(' ') && rest.includes(k)) {
      terms.push(alts);
      rest = rest.replace(k, ' ');
    }
  }
  for (const w of rest.split(' ').filter(Boolean)) terms.push(SYN.get(w) || [w]);
  return terms;
}

// Fuzzy: all chars of needle appear in order in hay; tighter clusters score higher.
function fuzzy(needle, hay) {
  let hi = 0, score = 0, streak = 0;
  for (const c of needle) {
    const i = hay.indexOf(c, hi);
    if (i < 0) return 0;
    streak = i === hi ? streak + 1 : 0;
    score += 1 + streak * 2 + (i === 0 || hay[i - 1] === ' ' ? 3 : 0);
    hi = i + 1;
  }
  return score / (hay.length * 0.15 + needle.length);
}

export function buildIndex(library) {
  const topics = [];
  const pages = [];
  for (const doc of library.docs) {
    doc.topics.forEach((t, i) => {
      const children = t.children.map((c) => c.title).join(' · ');
      topics.push({ doc, topic: t, index: i, n: norm(t.title), nc: norm(children) });
    });
    doc.pages.forEach((text, i) => pages.push({ doc, page: i + 1, text, n: norm(text) }));
  }
  return { topics, pages };
}

export function search(index, query, { lang, limit = 30 } = {}) {
  const terms = expand(query);
  if (!terms.length) return { topics: [], pages: [] };
  const flat = norm(query).trim();

  const topicHits = [];
  for (const e of index.topics) {
    let s = 0;
    let all = true;
    for (const alts of terms) {
      let best = 0;
      for (const a of alts) {
        const i = e.n.indexOf(a);
        if (i >= 0) best = Math.max(best, 10 + (i === 0 || e.n[i - 1] === ' ' ? 6 : 0));
        else if (e.nc.includes(a)) best = Math.max(best, 4);
      }
      if (!best) all = false;
      s += best;
    }
    if (!all) {
      const f = fuzzy(flat.replace(/ /g, ''), e.n.replace(/ /g, ''));
      s = f > 0.9 ? f * 6 : 0;
    }
    if (s > 0) {
      if (lang && e.doc.lang === lang) s += 3;
      topicHits.push({ ...e, score: s });
    }
  }
  topicHits.sort((a, b) => b.score - a.score);

  const pageHits = [];
  for (const e of index.pages) {
    let s = 0;
    let firstAt = -1;
    let firstLen = 0;
    let ok = true;
    for (const alts of terms) {
      let c = 0;
      for (const a of alts) {
        let i = e.n.indexOf(a);
        if (i >= 0 && (firstAt < 0 || i < firstAt)) ((firstAt = i), (firstLen = a.length));
        while (i >= 0 && c < 50) ((c++), (i = e.n.indexOf(a, i + a.length)));
      }
      if (!c) ok = false;
      s += Math.log2(1 + c);
    }
    if (!ok) continue;
    if (lang && e.doc.lang === lang) s += 0.5;
    pageHits.push({ ...e, score: s, snippet: snippet(e.text, e.n, firstAt, firstLen) });
  }
  pageHits.sort((a, b) => b.score - a.score);

  return { topics: topicHits.slice(0, limit), pages: pageHits.slice(0, limit), terms };
}

// The whole sentence around a match (no "…" cut-offs). Falls back to word boundaries only for
// very long run-on text such as formula blocks.
function snippet(text, normText, at, len) {
  const center = at;
  const isEnd = (i) => /[.?!:]/.test(text[i]) && /\s/.test(text[i + 1] || ' ') && !/\d/.test(text[i - 1] || '');
  let start = center;
  while (start > 0 && center - start < 260 && !isEnd(start - 1)) start--;
  if (center - start >= 260) start = text.lastIndexOf(' ', center - 120) + 1;
  let end = center + len;
  while (end < text.length && end - center < 320 && !isEnd(end)) end++;
  if (end < text.length && isEnd(end)) end++;
  else if (end - center >= 320) end = Math.max(center + len, text.indexOf(' ', center + len + 160));
  if (end < 0) end = text.length;
  const clean = (x) => x.replace(/\s+/g, ' ');
  return {
    pre: clean(text.slice(start, center)).trimStart(),
    hit: clean(text.slice(center, center + len)),
    post: clean(text.slice(center + len, end)).trimEnd(),
  };
}

// Highlight every alternative of every term inside a plain string; returns HTML.
export function highlight(str, terms) {
  const esc = escapeHTML(str);
  if (!terms?.length) return esc;
  const alts = terms.flat().filter((a) => a.length > 1).sort((a, b) => b.length - a.length);
  if (!alts.length) return esc;
  const n = norm(str);
  const marks = new Array(str.length).fill(false);
  for (const a of alts) {
    let i = n.indexOf(a);
    while (i >= 0) {
      for (let k = i; k < i + a.length && k < marks.length; k++) marks[k] = true;
      i = n.indexOf(a, i + a.length);
    }
  }
  if (n.length !== str.length) return esc;
  let out = '';
  let open = false;
  for (let i = 0; i < str.length; i++) {
    if (marks[i] && !open) ((out += '<mark>'), (open = true));
    if (!marks[i] && open) ((out += '</mark>'), (open = false));
    out += escapeHTML(str[i]);
  }
  return out + (open ? '</mark>' : '');
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
