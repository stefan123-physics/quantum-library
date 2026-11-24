import { t, getLang, setLang, onLangChange, applyI18n } from './i18n.js';
import { store } from './store.js';
import { buildIndex, search, highlight, escapeHTML as esc } from './search.js';
import { startBackground } from './bg.js';
import { Pane, renderThumb } from './pdf.js';
import { FORMULAS, CONSTANTS, UNITS, solve, fmt, parseNum, convert } from './lab.js';
import { speakFallback, stopFallback } from './tts-fallback.js';

/* ------------------------------------------------------------------ data */

const DOMAIN_META = {
  mechanics: { sym: 'F', hue: 200 },
  rotation: { sym: 'τ', hue: 220 },
  gravity: { sym: 'G', hue: 245 },
  fluids: { sym: 'ρ', hue: 190 },
  thermo: { sym: 'ΔT', hue: 18 },
  waves: { sym: 'λ', hue: 170 },
  electricity: { sym: 'q', hue: 48 },
  magnetism: { sym: 'B', hue: 330 },
  optics: { sym: 'n', hue: 140 },
  relativity: { sym: 'γ', hue: 280 },
  quantum: { sym: 'ħ', hue: 300 },
  nuclear: { sym: 'α', hue: 0 },
};
const DOMAINS = Object.keys(DOMAIN_META);

let lib, index, docsById;
const view = document.getElementById('view');

const partnerOf = (doc) => lib.docs.find((d) => d.group === doc.group && d.id !== doc.id) || null;
const docForLang = (lang, group) =>
  lib.docs.find((d) => d.lang === lang && (!group || d.group === group)) || lib.docs.find((d) => !group || d.group === group);

// Topic containing a reading position (page + fraction of that page, 0 = top, 1 = bottom).
function topicIndexAt(doc, page, frac = 1) {
  let idx = -1;
  for (let i = 0; i < doc.topics.length; i++) {
    const x = doc.topics[i];
    if (x.page < page || (x.page === page && (x.at ?? 0) <= frac + 0.02)) idx = i;
    else break;
  }
  return idx;
}

// Map a page of one edition onto the matching page of its translation, via aligned topics.
function mapPage(from, page, to) {
  if (!to) return page;
  let i = topicIndexAt(from, page);
  while (i >= 0 && !to.topics.some((x) => x.key === from.topics[i].key)) i--;
  if (i < 0) return Math.min(page, to.numPages);
  const src = from.topics[i];
  const j = to.topics.findIndex((x) => x.key === src.key);
  const dst = to.topics[j];
  const nextStart = to.topics.slice(j + 1).find((x) => x.page > dst.page)?.page ?? to.numPages + 1;
  return Math.max(1, Math.min(dst.page + (page - src.page), Math.max(dst.page, nextStart - 1), to.numPages));
}

const domainChip = (d, extra = '') =>
  `<span class="chip domain" style="--h:${DOMAIN_META[d]?.hue ?? 200}" ${extra}><i>${DOMAIN_META[d]?.sym ?? '•'}</i>${esc(t('domain.' + d))}</span>`;
const langBadge = (lang) => `<span class="lang-badge" data-lang="${lang}">${lang.toUpperCase()}</span>`;

/* --------------------------------------------------------------- toasts */

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  // long messages stay up longer so they can actually be read
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, Math.max(2400, msg.length * 55));
}

/* ---------------------------------------------------------------- theme */

const themeMQ = matchMedia('(prefers-color-scheme: dark)');
let bg;
function currentTheme() {
  return store.settings.theme || (themeMQ.matches ? 'dark' : 'light');
}
function applyTheme() {
  const th = currentTheme();
  document.documentElement.dataset.theme = th;
  // An explicit choice beats the system preference, so both media-specific tags get the active colour.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => (m.content = th === 'dark' ? '#060a17' : '#f4f6fb'));
  bg?.refresh();
  document.dispatchEvent(new CustomEvent('themechange'));
}
function toggleTheme() {
  store.setSetting('theme', currentTheme() === 'dark' ? 'light' : 'dark');
  applyTheme();
}
themeMQ.addEventListener('change', () => !store.settings.theme && applyTheme());

/* ---------------------------------------------------------------- router */

let currentReader = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs || '') };
}

function route() {
  const { parts, params } = parseHash();
  const [name, ...rest] = parts;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (name || 'home')));
  // home-screen shortcuts (manifest.webmanifest)
  if (name === 'continue') {
    const id = store.recent[0];
    const doc = (id && docsById[id]) || docForLang(getLang());
    return go(readHash(doc, store.progress(doc.id).last || 1));
  }
  if (name === 'search') {
    history.replaceState(null, '', '#/');
    renderHome();
    return openPalette();
  }
  if (name === 'read') {
    const doc = docsById[rest[0]];
    if (!doc) return renderNotFound();
    const page = +rest[1] || store.progress(doc.id).last || 1;
    if (currentReader && currentReader.doc === doc && currentReader.split === (params.get('split') === '1')) {
      if (params.get('at')) currentReader.goToHeading(page, +params.get('at'));
      else currentReader.goTo(page);
      if (params.get('q')) currentReader.find(params.get('q'), false);
      return;
    }
    return renderReader(doc, page, params);
  }
  closeReader();
  document.body.classList.remove('in-reader');
  document.title = t('app.name');
  if (!name || name === 'home') renderHome();
  else if (name === 'topics') renderTopics(params);
  else if (name === 'lab') renderLab(params);
  else if (name === 'notes') renderNotes();
  else renderNotFound();
  view.focus({ preventScroll: true });
  scrollTo(0, 0);
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
const readHash = (doc, page, q, split, at) => {
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(split ? { split: '1' } : {}), ...(at ? { at } : {}) }).toString();
  return `#/read/${doc.id}/${page}` + (qs ? '?' + qs : '');
};

function closeReader() {
  if (currentReader) {
    currentReader.destroy();
    currentReader = null;
  }
}

/* ------------------------------------------------------------------ home */

function renderHome() {
  const lang = getLang();
  const totalPages = lib.docs.reduce((s, d) => s + d.numPages, 0);
  const totalRead = lib.docs.reduce((s, d) => s + store.progress(d.id).visited.length, 0);
  const main = docForLang(lang);
  const prog = store.progress(main.id);
  const domainsUsed = new Set(main.topics.map((x) => x.domain));
  const docs = [...lib.docs].sort((a, b) => (a.lang === lang ? -1 : 0) - (b.lang === lang ? -1 : 0));

  // topic of the day: deterministic per date
  const day = Math.floor(Date.now() / 864e5);
  const daily = main.topics[(day * 7919) % main.topics.length];

  view.innerHTML = `
  <section class="hero">
    <div class="hero-text">
      <p class="kicker mono">${esc(t('home.hero.kicker'))}</p>
      <h1>${esc(t('home.hero.title'))}</h1>
      <p class="lead">${esc(t('home.hero.sub', { topics: main.topics.length, domains: domainsUsed.size }))}</p>
      <div class="cta">
        <a class="btn primary" href="${readHash(main, prog.last || 1)}">${esc(prog.visited.length ? t('home.cta.continue', { page: prog.last }) : t('home.cta.read'))} →</a>
        <button class="btn" data-act="random">⚛ ${esc(t('home.cta.random'))}</button>
        <button class="btn ghost" data-act="search">⌕ ${esc(t('home.cta.search'))} <kbd>Ctrl K</kbd></button>
      </div>
      <dl class="stats">
        <div><dt class="mono" data-count="${totalPages}">0</dt><dd>${esc(t('home.stats.pages'))}</dd></div>
        <div><dt class="mono" data-count="${main.topics.length}">0</dt><dd>${esc(t('home.stats.topics'))}</dd></div>
        <div><dt class="mono" data-count="${domainsUsed.size}">0</dt><dd>${esc(t('home.stats.domains'))}</dd></div>
        <div><dt class="mono" data-count="${totalRead}">0</dt><dd>${esc(t('home.stats.read'))}</dd></div>
      </dl>
    </div>
    <div class="hero-art" aria-hidden="true">${atomSVG()}</div>
  </section>

  <section class="block">
    <div class="block-head"><h2>${esc(t('home.docs'))}</h2><p>${esc(t('home.docs.sub'))}</p></div>
    <div class="doc-grid">
      ${docs
        .map((d) => {
          const p = store.progress(d.id);
          const pct = Math.round((p.visited.length / d.numPages) * 100);
          return `<article class="doc-card">
            <a class="cover" href="${readHash(d, p.last || 1)}" aria-label="${esc(d.title)} (${d.lang.toUpperCase()})">
              <canvas data-cover="${d.id}"></canvas>${langBadge(d.lang)}
            </a>
            <div class="doc-meta">
              <h3>${esc(d.title)} <small>${esc(t('lang.' + d.lang))}</small></h3>
              <p class="mono muted">${esc(t('doc.pages', { n: d.numPages }))} · ${esc(t('doc.topics', { n: d.topics.length }))} · ${(d.bytes / 1048576).toFixed(1)} MB</p>
              <div class="meter" title="${esc(t('doc.progress', { pct }))}"><i style="width:${pct}%"></i></div>
              <p class="muted small">${esc(t('doc.progress', { pct }))}</p>
              <div class="row">
                <a class="btn small primary" href="${readHash(d, p.last || 1)}">${esc(t('doc.open'))}</a>
                <a class="btn small" href="${esc(d.file)}" download>${esc(t('doc.download'))} ↓</a>
              </div>
            </div>
          </article>`;
        })
        .join('')}
      <article class="daily-card">
        <p class="kicker">${esc(t('home.daily'))}</p>
        ${domainChip(daily.domain)}
        <h3>${esc(daily.title)}</h3>
        <p class="mono muted">p. ${daily.page}</p>
        <a class="btn small primary" href="${readHash(main, daily.page, undefined, false, daily.at)}">${esc(t('doc.open'))} →</a>
        <svg class="wave-deco" viewBox="0 0 200 40" aria-hidden="true"><path d="M0 20 Q 12.5 0 25 20 T 50 20 T 75 20 T 100 20 T 125 20 T 150 20 T 175 20 T 200 20"/></svg>
      </article>
    </div>
  </section>

  <section class="block">
    <div class="block-head"><h2>${esc(t('home.explore'))}</h2><p>${esc(t('home.explore.sub'))}</p></div>
    <div class="domain-grid">
      ${DOMAINS.filter((d) => domainsUsed.has(d))
        .map((d) => {
          const ts = main.topics.filter((x) => x.domain === d);
          const visited = store.progress(main.id).visited;
          const seen = ts.filter((x) => visited.includes(x.page)).length;
          const pct = Math.round((seen / ts.length) * 100);
          return `<a class="domain-tile" style="--h:${DOMAIN_META[d].hue}" href="#/topics?d=${d}">
            <span class="orb"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" pathLength="100" class="ring-bg"/><circle cx="18" cy="18" r="16" pathLength="100" class="ring" style="stroke-dasharray:${pct} 100"/></svg><b>${DOMAIN_META[d].sym}</b></span>
            <span class="dt-name">${esc(t('domain.' + d))}</span>
            <span class="dt-count mono">${ts.length} · p.${ts[0].page}–${ts[ts.length - 1].page}</span>
          </a>`;
        })
        .join('')}
    </div>
  </section>`;

  view.querySelector('[data-act="random"]').onclick = randomTopic;
  view.querySelector('[data-act="search"]').onclick = () => openPalette();
  // count-up animation for stats
  view.querySelectorAll('[data-count]').forEach((el) => {
    const target = +el.dataset.count;
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / 900);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  view.querySelectorAll('canvas[data-cover]').forEach((c) => renderThumb(docsById[c.dataset.cover].file, 1, c, 260).catch(() => {}));
}

function randomTopic() {
  const doc = docForLang(getLang());
  const pool = doc.topics.filter((x) => /exerc|oefen|exampl|voorbeeld/i.test(x.title));
  const pick = (pool.length ? pool : doc.topics)[Math.floor(Math.random() * (pool.length || doc.topics.length))];
  go(readHash(doc, pick.page));
}

function atomSVG() {
  return `<svg viewBox="0 0 300 300" class="atom">
    <defs><radialGradient id="nuc" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></radialGradient></defs>
    <g class="orbits" fill="none">
      <ellipse cx="150" cy="150" rx="130" ry="46"/>
      <ellipse cx="150" cy="150" rx="130" ry="46" transform="rotate(60 150 150)"/>
      <ellipse cx="150" cy="150" rx="130" ry="46" transform="rotate(120 150 150)"/>
    </g>
    <g class="electrons">
      <circle r="6"><animateMotion dur="5s" repeatCount="indefinite" path="M20,150 a130,46 0 1,0 260,0 a130,46 0 1,0 -260,0"/></circle>
      <g transform="rotate(60 150 150)"><circle r="6"><animateMotion dur="6.5s" repeatCount="indefinite" path="M280,150 a130,46 0 1,0 -260,0 a130,46 0 1,0 260,0"/></circle></g>
      <g transform="rotate(120 150 150)"><circle r="6"><animateMotion dur="4.2s" repeatCount="indefinite" path="M20,150 a130,46 0 1,0 260,0 a130,46 0 1,0 -260,0"/></circle></g>
    </g>
    <circle cx="150" cy="150" r="22" fill="url(#nuc)" class="nucleus"/>
    <text x="150" y="157" text-anchor="middle" class="nucleus-label">ψ</text>
  </svg>`;
}

/* ---------------------------------------------------------------- topics */

function renderTopics(params) {
  const doc = docForLang(getLang());
  let domain = params.get('d') || '';
  const visited = new Set(store.progress(doc.id).visited);
  view.innerHTML = `
  <section class="block page-head">
    <h1>${esc(t('topics.title'))}</h1>
    <p class="lead">${esc(t('topics.sub', { n: doc.topics.length, lang: t('lang.' + doc.lang) }))}</p>
    <div class="filter-bar">
      <input type="search" class="input" id="topic-filter" placeholder="${esc(t('topics.filter'))}" autocomplete="off">
      <div class="chips" role="group">
        <button class="chip ${domain ? '' : 'on'}" data-d="">${esc(t('topics.all'))}</button>
        ${DOMAINS.filter((d) => doc.topics.some((x) => x.domain === d))
          .map((d) => `<button class="chip domain ${domain === d ? 'on' : ''}" style="--h:${DOMAIN_META[d].hue}" data-d="${d}"><i>${DOMAIN_META[d].sym}</i>${esc(t('domain.' + d))}</button>`)
          .join('')}
      </div>
    </div>
  </section>
  <section class="block"><ol class="topic-list" id="topic-list"></ol></section>`;

  const list = view.querySelector('#topic-list');
  const input = view.querySelector('#topic-filter');
  const draw = () => {
    const q = input.value.trim();
    let items = doc.topics.map((x, i) => ({ x, i }));
    if (domain) items = items.filter(({ x }) => x.domain === domain);
    let terms = null;
    if (q) {
      const res = search(index, q, { lang: doc.lang, limit: 500 });
      terms = res.terms;
      const hit = new Set(res.topics.filter((h) => h.doc === doc).map((h) => h.index));
      // also include topics whose pages contain the words
      for (const p of res.pages.filter((h) => h.doc === doc)) hit.add(topicIndexAt(doc, p.page));
      items = items.filter(({ i }) => hit.has(i));
    }
    list.innerHTML = items.length
      ? items
          .map(
            ({ x }) => `<li style="--h:${DOMAIN_META[x.domain].hue}">
          <a href="${readHash(doc, x.page, q || undefined, false, x.at)}">
            <span class="tl-sym">${DOMAIN_META[x.domain].sym}</span>
            <span class="tl-body"><span class="tl-title">${highlight(x.title, terms)}</span>
            ${x.children.length ? `<span class="tl-sub">${x.children.map((c) => esc(c.title)).join(' · ')}</span>` : ''}</span>
            <span class="tl-page mono">${visited.has(x.page) ? `<span class="seen" title="${esc(t('topics.visited'))}">✓</span>` : ''}p.${x.page}</span>
          </a></li>`,
          )
          .join('')
      : `<li class="empty">${esc(t('palette.empty'))}</li>`;
  };
  input.addEventListener('input', draw);
  view.querySelectorAll('.chips .chip').forEach((b) =>
    b.addEventListener('click', () => {
      domain = b.dataset.d;
      view.querySelectorAll('.chips .chip').forEach((c) => c.classList.toggle('on', c === b));
      history.replaceState(null, '', domain ? `#/topics?d=${domain}` : '#/topics');
      draw();
    }),
  );
  draw();
}

/* ------------------------------------------------------------------- lab */

function renderLab(params) {
  const lang = getLang();
  let current = FORMULAS.find((f) => f.id === params.get('f')) || FORMULAS[0];
  let filterDomain = '';
  view.innerHTML = `
  <section class="block page-head">
    <h1>${esc(t('lab.title'))}</h1>
    <p class="lead">${esc(t('lab.sub'))}</p>
  </section>
  <section class="block lab">
    <div class="lab-list">
      <input type="search" class="input" id="f-filter" placeholder="${esc(t('lab.search'))}" autocomplete="off">
      <div class="chips small" id="f-domains"><button class="chip on" data-d="">${esc(t('topics.all'))}</button>${[...new Set(FORMULAS.map((f) => f.domain))]
        .map((d) => `<button class="chip domain" style="--h:${DOMAIN_META[d].hue}" data-d="${d}" title="${esc(t('domain.' + d))}"><i>${DOMAIN_META[d].sym}</i></button>`)
        .join('')}</div>
      <ul id="f-list"></ul>
    </div>
    <div class="lab-card" id="f-card"></div>
  </section>
  <section class="block lab-extra">
    <div class="panel">
      <h2>${esc(t('lab.converter'))}</h2>
      <div class="converter">
        <select id="cv-cat" class="input">${Object.entries(UNITS).map(([k, u]) => `<option value="${k}">${esc(u[lang])}</option>`).join('')}</select>
        <label><span>${esc(t('lab.value'))}</span><input id="cv-val" class="input mono" value="1" inputmode="decimal"></label>
        <label><span>${esc(t('lab.from'))}</span><select id="cv-from" class="input"></select></label>
        <button class="btn icon" id="cv-swap" title="⇄">⇄</button>
        <label><span>${esc(t('lab.to'))}</span><select id="cv-to" class="input"></select></label>
        <output id="cv-out" class="mono big"></output>
      </div>
    </div>
    <div class="panel">
      <h2>${esc(t('lab.constants'))}</h2>
      <p class="muted small">${esc(t('lab.constantsSub'))}</p>
      <table class="const-table">
        ${CONSTANTS.map(([sym, name, val, unit]) => `<tr><th class="mono">${sym}</th><td>${esc(name[lang])}</td><td><button class="copy mono" data-v="${val}" data-n="${esc(name[lang])}">${fmt(val, 6)}</button></td><td class="mono muted">${unit}</td></tr>`).join('')}
      </table>
    </div>
  </section>`;

  const listEl = view.querySelector('#f-list');
  const filterEl = view.querySelector('#f-filter');
  const drawList = () => {
    const q = filterEl.value.trim().toLowerCase();
    listEl.innerHTML = FORMULAS.filter(
      (f) => (!filterDomain || f.domain === filterDomain) && (!q || (f.name.en + f.name.nl + f.tex + f.q).toLowerCase().includes(q)),
    )
      .map(
        (f) => `<li><button class="f-item ${f === current ? 'on' : ''}" data-id="${f.id}" style="--h:${DOMAIN_META[f.domain].hue}">
          <span>${esc(f.name[lang])}</span><code>${esc(f.tex)}</code></button></li>`,
      )
      .join('');
  };
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('.f-item');
    if (!b) return;
    current = FORMULAS.find((f) => f.id === b.dataset.id);
    history.replaceState(null, '', `#/lab?f=${current.id}`);
    drawList();
    drawCard();
  });
  filterEl.addEventListener('input', drawList);
  view.querySelectorAll('#f-domains .chip').forEach((b) =>
    b.addEventListener('click', () => {
      filterDomain = b.dataset.d;
      view.querySelectorAll('#f-domains .chip').forEach((c) => c.classList.toggle('on', c === b));
      drawList();
    }),
  );

  const card = view.querySelector('#f-card');
  function drawCard() {
    const f = current;
    card.style.setProperty('--h', DOMAIN_META[f.domain].hue);
    card.innerHTML = `
      ${domainChip(f.domain)}
      <h2>${esc(f.name[lang])}</h2>
      <div class="formula mono">${esc(f.tex)}</div>
      <form id="f-form" autocomplete="off">
        ${f.vars
          .map(
            (v) => `<label class="var"><span class="sym mono">${esc(v.sym)}</span><span class="vl">${esc(v.label[lang])}</span>
              <input class="input mono" name="${esc(v.sym)}" inputmode="decimal" placeholder="?" value="${v.def ?? ''}">
              <span class="unit mono">${esc(v.unit)}</span></label>`,
          )
          .join('')}
        <div class="row">
          <button class="btn primary" type="submit">= ${esc(t('lab.solve'))}</button>
          <button class="btn" type="reset">${esc(t('lab.clear'))}</button>
          <button class="btn ghost" type="button" id="f-read">📖 ${esc(t('lab.related'))}</button>
        </div>
        <output id="f-out" class="result" aria-live="polite"></output>
      </form>`;
    const form = card.querySelector('#f-form');
    const out = card.querySelector('#f-out');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const known = {};
      const empty = [];
      for (const v of f.vars) {
        const raw = form.elements[v.sym].value;
        const n = parseNum(raw);
        form.elements[v.sym].classList.remove('solved', 'bad');
        if (raw.trim() === '') empty.push(v);
        else if (Number.isNaN(n)) form.elements[v.sym].classList.add('bad');
        else known[v.sym] = n;
      }
      if (empty.length !== 1) {
        out.innerHTML = `<span class="warn">${esc(t('lab.needOne'))}</span>`;
        return;
      }
      const target = empty[0];
      const x = solve(f, known, target.sym);
      if (x === null) {
        out.innerHTML = `<span class="warn">∅ — no real solution</span>`;
        return;
      }
      const inp = form.elements[target.sym];
      inp.value = Math.abs(x) < 1e-3 || Math.abs(x) >= 1e6 ? x.toExponential(5) : +x.toPrecision(6);
      inp.classList.add('solved');
      out.innerHTML = `<span class="muted">${esc(t('lab.result'))}</span> <b class="mono">${esc(target.sym)} = ${fmt(x)} ${esc(target.unit === '–' ? '' : target.unit)}</b>`;
      // a solved input is "known" next time; clear it so the user can solve for another variable
      inp.addEventListener('input', () => inp.classList.remove('solved'), { once: true });
    });
    form.addEventListener('reset', (e) => {
      e.preventDefault();
      f.vars.forEach((v) => (form.elements[v.sym].value = ''));
      out.innerHTML = '';
    });
    card.querySelector('#f-read').onclick = () => {
      const doc = docForLang(lang);
      const res = search(index, f.q, { lang });
      const hit = res.topics.find((h) => h.doc === doc) || res.pages.find((h) => h.doc === doc);
      const page = hit ? hit.topic?.page ?? hit.page : 1;
      go(readHash(doc, page, f.q.split(' ')[0], false, hit?.topic?.at));
    };
  }
  drawList();
  drawCard();

  // unit converter
  const cat = view.querySelector('#cv-cat');
  const from = view.querySelector('#cv-from');
  const to = view.querySelector('#cv-to');
  const val = view.querySelector('#cv-val');
  const outCv = view.querySelector('#cv-out');
  const fillUnits = () => {
    const us = Object.keys(UNITS[cat.value].units);
    from.innerHTML = to.innerHTML = us.map((u) => `<option>${esc(u)}</option>`).join('');
    to.selectedIndex = Math.min(1, us.length - 1);
    calc();
  };
  const calc = () => {
    const x = parseNum(val.value);
    outCv.textContent = Number.isNaN(x) ? '—' : `= ${fmt(convert(cat.value, x, from.value, to.value), 6)} ${to.value}`;
  };
  cat.addEventListener('change', fillUnits);
  [val, from, to].forEach((el) => el.addEventListener('input', calc));
  view.querySelector('#cv-swap').onclick = () => {
    const a = from.selectedIndex;
    from.selectedIndex = to.selectedIndex;
    to.selectedIndex = a;
    calc();
  };
  fillUnits();

  view.querySelectorAll('.const-table .copy').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.v);
      } catch {
        /* clipboard blocked */
      }
      toast(t('toast.constCopied', { name: b.dataset.n }));
    }),
  );
}

/* ----------------------------------------------------------------- notes */

function renderNotes() {
  const marks = store.marks;
  const byDoc = lib.docs.map((d) => ({ d, items: store.marksFor(d.id) })).filter((g) => g.items.length);
  view.innerHTML = `
  <section class="block page-head">
    <h1>${esc(t('notes.title'))}</h1>
    <p class="lead">${esc(t('notes.sub'))}</p>
    <div class="row">
      <button class="btn small" id="n-export" ${marks.length ? '' : 'disabled'}>⇩ ${esc(t('notes.export'))}</button>
      <label class="btn small">⇧ ${esc(t('notes.import'))}<input type="file" accept="application/json" id="n-import" hidden></label>
    </div>
  </section>
  <section class="block">
    ${
      byDoc.length
        ? byDoc
            .map(
              ({ d, items }) => `<div class="notes-group"><h2>${esc(d.title)} ${langBadge(d.lang)}</h2><ul class="notes-list">
          ${items
            .map((m) => {
              const ti = topicIndexAt(d, m.page);
              const topic = ti >= 0 ? d.topics[ti] : null;
              return `<li class="${m.note ? 'note' : 'bm'}">
                <a href="${readHash(d, m.page)}"><span class="mono pg">${esc(t('notes.page', { page: m.page }))}</span>
                <span class="n-body">${topic ? `<span class="n-topic">${esc(topic.title)}</span>` : ''}${m.note ? `<span class="n-text">${esc(m.note)}</span>` : '<span class="n-text muted">🔖</span>'}</span></a>
                <button class="btn icon small" data-del="${m.id}" title="${esc(t('notes.delete'))}">✕</button></li>`;
            })
            .join('')}</ul></div>`,
            )
            .join('')
        : `<div class="empty-state"><div class="atom-mini">${atomSVG()}</div><p>${esc(t('notes.empty'))}</p></div>`
    }
  </section>`;
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      store.removeMark(b.dataset.del);
      renderNotes();
    }),
  );
  view.querySelector('#n-export').onclick = () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'quantum-library-notes.json' });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  view.querySelector('#n-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      renderNotes();
    } catch {
      toast('Invalid file');
    }
  };
}

function renderNotFound() {
  closeReader();
  view.innerHTML = `<section class="block empty-state"><div class="atom-mini">${atomSVG()}</div><h1>404</h1><p>${esc(t('notfound'))}</p><a class="btn primary" href="#/">${esc(t('cmd.home'))}</a></section>`;
}

/* ---------------------------------------------------------------- reader */

const ICON = {
  menu: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  width: '<svg viewBox="0 0 24 24"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  page: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="1.5"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>',
  lang: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
  split: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>',
  speak: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/></svg>',
  focus: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0114-5.3L20 9M20 12a8 8 0 01-14 5.3L4 15"/><path d="M20 4v5h-5M4 20v-5h5"/></svg>',
};

class Reader {
  constructor(doc, page, params) {
    this.doc = doc;
    this.partner = partnerOf(doc);
    this.split = params.get('split') === '1' && !!this.partner;
    this.sync = true;
    this.query = params.get('q') || '';
    this.speaking = false;
    document.body.classList.add('in-reader');
    view.innerHTML = this.#template();
    this.root = view.querySelector('.reader');
    applyI18n(this.root);
    this.#wire();
    this.#buildContents();
    this.#buildThumbs();
    this.#buildMarks();
    this.#openPanes(page, +params.get('at') || 0);
    if (this.query) this.find(this.query);
    this.#applyNight();
    this.onTheme = () => this.#applyNight();
    document.addEventListener('themechange', this.onTheme);
  }

  #template() {
    const d = this.doc;
    const sb = store.settings.sidebar !== false && innerWidth > 900;
    return `
    <div class="reader ${this.split ? 'split' : ''} ${sb ? 'sidebar-open' : ''}">
      <div class="r-toolbar">
        <div class="tb-group">
          <a class="tb-btn" href="#/" data-i18n-title="reader.back">${ICON.back}</a>
          <button class="tb-btn" data-act="sidebar" data-i18n-title="reader.sidebar">${ICON.menu}</button>
          <div class="tb-title"><strong>${esc(d.title)}</strong> ${langBadge(d.lang)}</div>
        </div>
        <div class="tb-group center">
          <button class="tb-btn" data-act="prev" data-i18n-title="reader.prev">${ICON.prev}</button>
          <label class="page-box"><span class="sr" data-i18n="reader.page"></span><input class="mono" id="r-page" inputmode="numeric" value="1" size="3"><span class="mono muted" id="r-total"></span></label>
          <button class="tb-btn" data-act="next" data-i18n-title="reader.next">${ICON.next}</button>
          <span class="tb-sep"></span>
          <button class="tb-btn hide-xs" data-act="zoom-out" data-i18n-title="reader.zoomOut">${ICON.minus}</button>
          <button class="tb-btn zoom-label mono" data-act="fit-width" id="r-zoom" data-i18n-title="reader.fitWidth">100%</button>
          <button class="tb-btn hide-xs" data-act="zoom-in" data-i18n-title="reader.zoomIn">${ICON.plus}</button>
          <button class="tb-btn hide-sm" data-act="fit-page" data-i18n-title="reader.fitPage">${ICON.page}</button>
        </div>
        <div class="tb-group right">
          <button class="tb-btn" data-act="bookmark" id="r-bm" data-i18n-title="reader.bookmark">${ICON.bookmark}</button>
          <button class="tb-btn hide-xs" data-act="note" data-i18n-title="reader.note">${ICON.note}</button>
          ${this.partner ? `<button class="tb-btn" data-act="other" data-i18n-title="reader.otherLang">${ICON.lang}<small class="mono">${this.partner.lang.toUpperCase()}</small></button>
          <button class="tb-btn hide-sm ${this.split ? 'on' : ''}" data-act="split" data-i18n-title="reader.split">${ICON.split}</button>` : ''}
          <button class="tb-btn hide-sm" data-act="speak" id="r-speak" data-i18n-title="reader.speak">${ICON.speak}</button>
          <button class="tb-btn hide-sm" data-act="night" id="r-night" data-i18n-title="reader.night">${ICON.moon}</button>
          <button class="tb-btn hide-xs" data-act="focus" data-i18n-title="reader.focus">${ICON.focus}</button>
          <details class="tb-more">
            <summary class="tb-btn" aria-label="More">⋯</summary>
            <div class="menu">
              <div class="m-only zoom-row">
                <button data-act="zoom-out" data-i18n-title="reader.zoomOut">${ICON.minus}</button>
                <button data-act="fit-width" data-i18n-title="reader.fitWidth">${ICON.width}</button>
                <button data-act="fit-page" data-i18n-title="reader.fitPage">${ICON.page}</button>
                <button data-act="zoom-in" data-i18n-title="reader.zoomIn">${ICON.plus}</button>
              </div>
              <button data-act="note" class="m-only">${ICON.note}<span data-i18n="reader.note"></span></button>
              ${this.partner ? `<button data-act="split" class="m-only-wide">${ICON.split}<span data-i18n="reader.split"></span></button>` : ''}
              <button data-act="focus" class="m-only">${ICON.focus}<span data-i18n="reader.focus"></span></button>
              <button data-act="share">${ICON.link}<span data-i18n="reader.share"></span></button>
              <a href="${esc(d.file)}" download>${ICON.download}<span data-i18n="reader.download"></span></a>
              <button data-act="print">${ICON.print}<span data-i18n="reader.print"></span></button>
              <button data-act="speak">${ICON.speak}<span data-i18n="reader.speak"></span></button>
              <button data-act="night">${ICON.moon}<span data-i18n="reader.night"></span></button>
            </div>
          </details>
        </div>
      </div>
      <div class="r-topicbar">
        <button class="tb-btn small" data-act="prev-topic" data-i18n-title="reader.prevTopic">‹</button>
        <div class="topic-now"><span class="muted small" data-i18n="reader.topicNow"></span> <span id="r-domain"></span> <strong id="r-topic"></strong></div>
        <button class="tb-btn small" data-act="next-topic" data-i18n-title="reader.nextTopic">›</button>
      </div>
      <div class="r-body">
        <aside class="r-sidebar">
          <div class="tabs" role="tablist">
            <button role="tab" class="on" data-tab="toc" data-i18n="reader.contents"></button>
            <button role="tab" data-tab="thumbs" data-i18n="reader.thumbs"></button>
            <button role="tab" data-tab="marks" data-i18n="reader.marks"></button>
            <button role="tab" data-tab="find" data-i18n="reader.find"></button>
          </div>
          <div class="tab-panel on" data-panel="toc"><ol class="toc" id="r-toc"></ol></div>
          <div class="tab-panel" data-panel="thumbs"><div class="thumbs" id="r-thumbs"></div></div>
          <div class="tab-panel" data-panel="marks"><div id="r-marks"></div></div>
          <div class="tab-panel" data-panel="find">
            <input type="search" class="input" id="r-find" data-i18n-placeholder="reader.findPlaceholder" autocomplete="off">
            <p class="muted small" id="r-find-count"></p>
            <ol class="find-results" id="r-find-results"></ol>
          </div>
        </aside>
        <div class="r-backdrop" data-act="sidebar"></div>
        <div class="r-panes">
          <div class="pane-host" id="pane-a"></div>
          ${this.split ? `<div class="pane-divider"><button class="tb-btn small on" data-act="sync" data-i18n-title="reader.sync">${ICON.sync}</button></div><div class="pane-host" id="pane-b"></div>` : ''}
        </div>
      </div>
      <div class="r-progress"><i id="r-progress"></i></div>
    </div>`;
  }

  #wire() {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      b.closest('details')?.removeAttribute('open');
      this.action(act);
    });
    const pageInput = r.querySelector('#r-page');
    pageInput.addEventListener('change', () => this.goTo(+pageInput.value));
    pageInput.addEventListener('focus', () => pageInput.select());
    r.querySelectorAll('.tabs [data-tab]').forEach((tab) =>
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab)),
    );
    const find = r.querySelector('#r-find');
    let timer;
    find.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.find(find.value, false), 180);
    });
  }

  showTab(name) {
    this.root.querySelectorAll('.tabs [data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    this.root.querySelectorAll('.tab-panel').forEach((x) => x.classList.toggle('on', x.dataset.panel === name));
    if (!this.root.classList.contains('sidebar-open')) this.toggleSidebar(true);
    if (name === 'find') this.root.querySelector('#r-find').focus();
  }

  toggleSidebar(force) {
    const open = this.root.classList.toggle('sidebar-open', force);
    store.setSetting('sidebar', open);
  }

  #openPanes(page, at = 0) {
    this.a = new Pane(this.root.querySelector('#pane-a'), this.doc, {
      onPage: (n) => this.#onPage(n),
    });
    this.a.el.addEventListener('zoom', (e) => {
      this.root.querySelector('#r-zoom').textContent = Math.round(e.detail.scale * 100) + '%';
      if (this.b && this.b.zoom !== this.a.zoom) this.b.setZoom(this.a.zoom);
    });
    this.a.el.addEventListener('panescroll', () => this.#updateTopic());
    this.a
      .open(page)
      .then(() => at && this.a.goToFraction(page, Math.max(0, at - 0.025)))
      .catch((err) => this.#fail(err));
    this.root.querySelector('#r-total').textContent = t('reader.of', { n: this.doc.numPages });
    if (this.split) {
      this.b = new Pane(this.root.querySelector('#pane-b'), this.partner, {});
      this.b.open(mapPage(this.doc, page, this.partner)).catch((err) => this.#fail(err));
      this.a.el.addEventListener('panescroll', () => {
        if (!this.sync || !this.b.pdf) return;
        const target = mapPage(this.doc, this.a.current, this.partner);
        this.b.goToFraction(target, this.a.positionFraction());
      });
    }
  }

  #fail(err) {
    console.error(err);
    this.root.querySelector('.r-panes').insertAdjacentHTML(
      'afterbegin',
      `<div class="error-box">⚠ ${esc(err?.message || err)}<br><small>Serve this folder over HTTP (npm run serve) — browsers block PDFs opened from file://.</small></div>`,
    );
  }

  #onPage(n) {
    const r = this.root;
    r.querySelector('#r-page').value = n;
    r.querySelector('#r-progress').style.width = (n / this.doc.numPages) * 100 + '%';
    setProgressFavicon(n / this.doc.numPages);
    store.visit(this.doc.id, n);
    const bm = store.isBookmarked(this.doc.id, n);
    const bmBtn = r.querySelector('#r-bm');
    bmBtn.classList.toggle('on', bm);
    bmBtn.title = t(bm ? 'reader.unbookmark' : 'reader.bookmark');
    r.querySelectorAll('#r-thumbs .thumb').forEach((th) => th.classList.toggle('on', +th.dataset.page === n));
    // keep the URL shareable without triggering the router
    const hash = readHash(this.doc, n, this.query || undefined, this.split);
    if (location.hash !== hash) history.replaceState(null, '', hash);
    this.#updateTopic(true);
  }

  // Which topic is under the reading line (30% from the top of the pane)?
  #updateTopic(force = false) {
    const r = this.root;
    if (!this.a?.pages.length) return;
    const { page, frac } = this.a.readingPoint();
    const ti = topicIndexAt(this.doc, page, frac);
    if (ti === this.topicIdx && !force) return;
    this.topicIdx = ti;
    const topic = this.doc.topics[ti];
    r.querySelector('#r-topic').textContent = topic ? topic.title : this.doc.title;
    r.querySelector('#r-domain').innerHTML = topic ? domainChip(topic.domain) : '';
    r.querySelectorAll('#r-toc .toc-item').forEach((li) => {
      const on = +li.dataset.i === ti;
      if (on && !li.classList.contains('on')) li.scrollIntoView({ block: 'nearest' });
      li.classList.toggle('on', on);
    });
    document.title = `${topic ? topic.title + ' · ' : ''}${this.doc.title} (${this.doc.lang.toUpperCase()}) — ${t('app.name')}`;
  }

  // Jump straight to a heading inside a page.
  goToHeading(page, at = 0) {
    this.a.goToFraction(page, Math.max(0, at - 0.025), true);
  }

  #buildContents() {
    const el = this.root.querySelector('#r-toc');
    let html = '';
    let lastDomain = null;
    this.doc.topics.forEach((x, i) => {
      if (x.domain !== lastDomain) {
        html += `<li class="toc-domain" style="--h:${DOMAIN_META[x.domain].hue}"><i>${DOMAIN_META[x.domain].sym}</i>${esc(t('domain.' + x.domain))}</li>`;
        lastDomain = x.domain;
      }
      html += `<li class="toc-item" data-i="${i}" style="--h:${DOMAIN_META[x.domain].hue}">
        <button data-page="${x.page}" data-at="${x.at ?? 0}"><span>${esc(x.title)}</span><span class="mono muted">${x.page}</span></button>
        ${x.children.length ? `<ul>${x.children.map((c) => `<li><button data-page="${c.page}" data-at="${c.at ?? 0}" class="${c.figure ? 'fig' : ''}">${c.figure ? '◇ ' : ''}${esc(c.title)}</button></li>`).join('')}</ul>` : ''}
      </li>`;
    });
    el.innerHTML = html;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-page]');
      if (b) {
        this.goToHeading(+b.dataset.page, +b.dataset.at);
        if (innerWidth < 900) this.toggleSidebar(false);
      }
    });
  }

  #buildThumbs() {
    const el = this.root.querySelector('#r-thumbs');
    el.innerHTML = Array.from({ length: this.doc.numPages }, (_, i) => `<button class="thumb" data-page="${i + 1}"><canvas></canvas><span class="mono">${i + 1}</span></button>`).join('');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          renderThumb(this.doc.file, +e.target.dataset.page, e.target.querySelector('canvas'), 110).catch(() => {});
        }
      },
      { root: el.parentElement, rootMargin: '300px' },
    );
    el.querySelectorAll('.thumb').forEach((th) => io.observe(th));
    this.thumbIO = io;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.thumb');
      if (b) this.goTo(+b.dataset.page);
    });
  }

  #buildMarks() {
    const el = this.root.querySelector('#r-marks');
    const marks = store.marksFor(this.doc.id);
    el.innerHTML = marks.length
      ? `<ul class="notes-list compact">${marks
          .map(
            (m) => `<li class="${m.note ? 'note' : 'bm'}"><button data-page="${m.page}"><span class="mono pg">p.${m.page}</span><span class="n-text">${m.note ? esc(m.note) : '🔖'}</span></button>
            <button class="btn icon small" data-del="${m.id}" title="${esc(t('notes.delete'))}">✕</button></li>`,
          )
          .join('')}</ul>`
      : `<p class="muted small pad">${esc(t('reader.noMarks'))}</p>`;
    el.onclick = (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        store.removeMark(del.dataset.del);
        this.#buildMarks();
        this.#onPage(this.a.current);
        return;
      }
      const b = e.target.closest('[data-page]');
      if (b) this.goTo(+b.dataset.page);
    };
  }

  find(q, jump = true) {
    this.query = q.trim();
    const input = this.root.querySelector('#r-find');
    if (input.value !== q) input.value = q;
    const list = this.root.querySelector('#r-find-results');
    const count = this.root.querySelector('#r-find-count');
    if (!this.query) {
      list.innerHTML = '';
      count.textContent = '';
      this.a.setHighlight(null);
      this.b?.setHighlight(null);
      return;
    }
    const res = search(index, this.query, { limit: 400 });
    const pages = res.pages.filter((h) => h.doc === this.doc).sort((x, y) => x.page - y.page);
    count.textContent = pages.length ? t('reader.findCount', { n: pages.length }) : t('reader.findNone');
    list.innerHTML = pages
      .map((h) => `<li><button data-page="${h.page}"><span class="mono pg">p.${h.page}</span><span>${esc(h.snippet.pre)}<mark>${esc(h.snippet.hit)}</mark>${esc(h.snippet.post)}</span></button></li>`)
      .join('');
    list.onclick = (e) => {
      const b = e.target.closest('[data-page]');
      if (b) this.goTo(+b.dataset.page);
    };
    this.a.setHighlight(res.terms);
    this.b?.setHighlight(res.terms);
    if (jump && pages.length) {
      this.showTab('find');
      if (!pages.some((p) => p.page === this.a.current)) this.goTo(pages[0].page);
    }
  }

  goTo(n) {
    this.a.goTo(n);
  }

  action(act) {
    const a = this.a;
    switch (act) {
      case 'prev': return a.prev();
      case 'next': return a.next();
      case 'zoom-in': return a.setZoom('in');
      case 'zoom-out': return a.setZoom('out');
      case 'fit-width': return a.setZoom('width');
      case 'fit-page': return a.setZoom('page');
      case 'sidebar': return this.toggleSidebar();
      case 'prev-topic': {
        const cur = this.doc.topics[this.topicIdx];
        const { page, frac } = a.readingPoint();
        // first go to the start of the current topic, then to the previous one
        const atStart = cur && cur.page === page && frac - (cur.at ?? 0) < 0.12;
        const target = cur && !atStart ? cur : this.doc.topics[Math.max(0, this.topicIdx - 1)];
        return target && this.goToHeading(target.page, target.at);
      }
      case 'next-topic': {
        const nxt = this.doc.topics[this.topicIdx + 1];
        return nxt && this.goToHeading(nxt.page, nxt.at);
      }
      case 'bookmark': {
        const added = store.toggleBookmark(this.doc.id, a.current);
        toast(added ? t('toast.bookmarked', { page: a.current }) : t('toast.unbookmarked'));
        this.#buildMarks();
        return this.#onPage(a.current);
      }
      case 'note': {
        const text = prompt(t('reader.notePrompt', { page: a.current }));
        if (text && text.trim()) {
          store.addNote(this.doc.id, a.current, text.trim());
          toast(t('toast.noteSaved'));
          this.#buildMarks();
          this.showTab('marks');
        }
        return;
      }
      case 'other': {
        // The interface follows the edition the user picks; onLang() then performs the jump.
        if (getLang() !== this.partner.lang) return setLang(this.partner.lang);
        toast(t('toast.switched', { lang: t('lang.' + this.partner.lang) }));
        return go(readHash(this.partner, mapPage(this.doc, a.current, this.partner), this.query || undefined));
      }
      case 'split':
        return go(readHash(this.doc, a.current, this.query || undefined, !this.split));
      case 'sync': {
        this.sync = !this.sync;
        this.root.querySelector('[data-act="sync"]').classList.toggle('on', this.sync);
        return;
      }
      case 'speak': return this.speaking ? this.stopSpeaking() : this.speak();
      case 'night': {
        store.setSetting('nightPages', !this.root.classList.contains('night'));
        return this.#applyNight();
      }
      case 'focus': return this.root.classList.toggle('focus');
      case 'share': {
        navigator.clipboard?.writeText(location.href).then(() => toast(t('toast.copied')), () => toast(location.href));
        return;
      }
      case 'print': {
        const f = document.createElement('iframe');
        f.className = 'print-frame';
        f.src = this.doc.file;
        f.onload = () => {
          try {
            f.contentWindow.print();
          } catch {
            open(this.doc.file);
          }
          setTimeout(() => f.remove(), 60000);
        };
        document.body.appendChild(f);
        return;
      }
    }
  }

  #applyNight() {
    const night = currentTheme() === 'dark' && store.settings.nightPages !== false;
    this.root.classList.toggle('night', night);
    this.root.querySelectorAll('[data-act="night"]').forEach((b) => b.classList.toggle('on', night));
  }

  // Read aloud, sentence by sentence (Chrome silently stops utterances longer than ~15 s),
  // continuing onto the next pages until the user stops it with R or the button.
  // Read aloud sentence by sentence (Chrome stops long utterances after ~15 s), continuing onto the
  // next pages until stopped. Uses the browser's own voice when it has a working one for this
  // language, otherwise the built-in meSpeak voice (vendor/mespeak), downloaded on first use.
  async speak(page = this.a.current) {
    const session = (this.speakSession = (this.speakSession || 0) + 1);
    this.speaking = true;
    this.#speakUI(true);
    const lang = this.doc.lang;

    let voice = null;
    if (ttsEngine !== 'builtin' && 'speechSynthesis' in window) {
      const voices = await loadVoices();
      if (session !== this.speakSession) return;
      const match = (v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang);
      voice = voices.find((v) => match(v) && v.localService) || voices.find(match) || null;
    }
    // no browser voice for this language → the built-in voice speaks both English and Dutch
    let engine = ttsEngine === 'builtin' || !voice ? 'builtin' : 'native';
    if (engine === 'builtin') toast(t('toast.fallbackVoice'));

    if (engine === 'native' && (speechSynthesis.speaking || speechSynthesis.pending)) {
      // Chrome can swallow a speak() issued right after cancel(): only cancel when needed, then wait a tick.
      speechSynthesis.cancel();
      await new Promise((r) => setTimeout(r, 120));
    }

    for (let p = page; p <= this.doc.numPages; p++) {
      if (session !== this.speakSession) return;
      if (p !== page) this.goTo(p);
      toast(t('toast.reading', { page: p }));
      for (const sentence of speakableSentences(this.doc.pages[p - 1] || '')) {
        if (session !== this.speakSession) return;
        let ok = engine === 'builtin' ? await this.#sayBuiltin(sentence, lang) : await this.#sayNative(sentence, lang, voice, session);
        if (session !== this.speakSession) return;
        if (ok !== true && engine === 'native') {
          // the browser's engine is broken (accepts text, never speaks): switch for good and retry
          engine = ttsEngine = 'builtin';
          toast(t('toast.fallbackVoice'));
          ok = await this.#sayBuiltin(sentence, lang);
          if (session !== this.speakSession) return;
        }
        if (ok !== true) {
          this.stopSpeaking();
          return toast(t('toast.speechError', { error: ok }) + ' ' + t(speechHelpKey()));
        }
      }
    }
    if (session === this.speakSession) this.stopSpeaking();
  }

  #sayNative(sentence, lang, voice, session) {
    return new Promise((resolve) => {
      let started = false;
      const u = new SpeechSynthesisUtterance(sentence);
      u.lang = lang === 'nl' ? 'nl-NL' : 'en-GB';
      try {
        u.voice = voice;
      } catch {
        /* not a real SpeechSynthesisVoice */
      }
      u.onstart = () => {
        started = true;
        ttsEngine = 'native';
      };
      u.onend = () => resolve(true);
      u.onerror = (e) => resolve(e.error === 'interrupted' || e.error === 'canceled' ? true : e.error);
      // Some engines accept the text but never start (e.g. a broken speech-dispatcher): detect it.
      if (ttsEngine !== 'native') {
        setTimeout(() => {
          if (!started && session === this.speakSession && !speechSynthesis.speaking) {
            speechSynthesis.cancel();
            resolve('no-start');
          }
        }, 3500);
      }
      speechSynthesis.speak(u);
    });
  }

  async #sayBuiltin(sentence, lang) {
    try {
      return await speakFallback(sentence, lang);
    } catch (err) {
      return err?.message || 'built-in voice unavailable';
    }
  }

  #speakUI(on) {
    this.root?.querySelectorAll('[data-act="speak"]').forEach((b) => b.classList.toggle('on', on));
    const s = this.root?.querySelector('#r-speak');
    if (s) s.title = t(on ? 'reader.stopSpeak' : 'reader.speak');
  }

  stopSpeaking() {
    this.speakSession = (this.speakSession || 0) + 1; // invalidates the running reading loop
    if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    stopFallback();
    this.speaking = false;
    this.#speakUI(false);
  }

  // Interface language changed while reading: hop to the matching edition at the same place.
  onLang(lang) {
    if (this.split) {
      // in split view keep both panes, just make the chosen language the main one
      if (this.partner && this.partner.lang === lang) go(readHash(this.partner, mapPage(this.doc, this.a.current, this.partner), this.query || undefined, true));
      else applyI18n(this.root);
      return;
    }
    const target = this.doc.lang === lang ? null : lib.docs.find((d) => d.group === this.doc.group && d.lang === lang);
    if (!target) {
      applyI18n(this.root);
      this.#buildContents();
      return this.#onPage(this.a.current);
    }
    const page = mapPage(this.doc, this.a.current, target);
    toast(t('toast.switched', { lang: t('lang.' + lang) }));
    go(readHash(target, page, this.query || undefined));
  }

  destroy() {
    setProgressFavicon(null);
    this.stopSpeaking();
    this.a?.destroy();
    this.b?.destroy();
    this.thumbIO?.disconnect();
    document.removeEventListener('themechange', this.onTheme);
    document.body.classList.remove('in-reader');
  }
}

function renderReader(doc, page, params) {
  closeReader();
  currentReader = new Reader(doc, page, params);
}

/* ------------------------------------------------------------ read aloud */

// 'native' once the browser's own voice is proven to work, 'builtin' once we fell back to meSpeak.
let ttsEngine = null;

// Which help text fits this browser when speech does not work.
function speechHelpKey() {
  const ua = navigator.userAgent;
  const linux = /Linux/.test(ua) && !/Android/.test(ua);
  if (linux && /Chrome|Chromium|Edg|OPR|Brave/.test(ua)) return 'toast.noVoicesChromeLinux';
  if (linux) return 'toast.noVoicesLinux';
  return 'toast.noVoices';
}

// Voices load asynchronously in Chrome; wait briefly for them.
function loadVoices() {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

// Prose sentences of a page; formula fragments (mostly symbols/digits) are skipped.
function speakableSentences(raw) {
  const text = raw
    .split('\n')
    .filter((l) => (l.match(/[A-Za-zÀ-ÿ]/g) || []).length > 6)
    .join(' ')
    .replace(/\(\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // split only where punctuation is followed by a space, so decimals like 1.98 stay intact
  const parts = text.split(/(?<=[.!?])\s+/);
  const out = [];
  for (let p of parts.map((x) => x.trim()).filter(Boolean)) {
    // keep each utterance short enough for Chrome
    while (p.length > 220) {
      const cut = p.lastIndexOf(' ', 200) > 80 ? p.lastIndexOf(' ', 200) : 200;
      out.push(p.slice(0, cut));
      p = p.slice(cut).trim();
    }
    if (p) out.push(p);
  }
  return out;
}

/* -------------------------------------------------------- smart favicon */

// While reading, the tab icon becomes a progress ring around the atom, so you can see how far
// you are in the book even with many tabs open. Outside the reader it is the normal icon.
const favicon = document.getElementById('favicon');
let lastFavPct = -1;
function setProgressFavicon(frac) {
  if (frac === null) {
    lastFavPct = -1;
    favicon.href = 'favicon.svg';
    return;
  }
  const pct = Math.round(frac * 100);
  if (pct === lastFavPct) return;
  lastFavPct = pct;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="15" fill="#0b1330"/>
    <circle cx="32" cy="32" r="26" fill="none" stroke="#38bdf8" stroke-opacity=".22" stroke-width="7"/>
    <circle cx="32" cy="32" r="26" fill="none" stroke="#38bdf8" stroke-width="7" stroke-linecap="round"
      pathLength="100" stroke-dasharray="${Math.max(pct, 2)} 100" transform="rotate(-90 32 32)"/>
    <g transform="translate(32 32)" fill="none" stroke-width="3">
      <ellipse rx="15" ry="5.6" stroke="#a78bfa"/><ellipse rx="15" ry="5.6" stroke="#f472b6" transform="rotate(60)"/><ellipse rx="15" ry="5.6" stroke="#38bdf8" transform="rotate(120)"/>
    </g><circle cx="32" cy="32" r="4.5" fill="#fbbf24"/></svg>`;
  favicon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/* ---------------------------------------------------------- install app */

let installPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function setupInstall() {
  const btn = document.getElementById('install-btn');
  const show = (on) => (btn.hidden = !on || isStandalone());
  addEventListener('beforeinstallprompt', (e) => {
    // no preventDefault(): the browser may still offer its own install UI; our button reuses the event
    installPrompt = e;
    show(true);
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    show(false);
    toast(t('install.done'));
  });
  // iOS has no install prompt: explain the Share → Add to Home Screen route instead.
  if (isIOS) show(true);
  btn.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      show(false);
    } else toast(t('install.ios'));
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* --------------------------------------------------------------- palette */

const palette = document.getElementById('palette');
const pInput = palette.querySelector('input');
const pList = palette.querySelector('.p-results');
let pItems = [];
let pSel = 0;

const COMMANDS = [
  { id: 'home', icon: '⌂', run: () => go('#/') },
  { id: 'random', icon: '⚛', run: randomTopic },
  { id: 'lab', icon: '∑', run: () => go('#/lab') },
  { id: 'notes', icon: '🔖', run: () => go('#/notes') },
  { id: 'theme', icon: '◐', run: toggleTheme },
  { id: 'lang', icon: '⇄', run: () => setLang(getLang() === 'en' ? 'nl' : 'en') },
  { id: 'help', icon: '?', run: () => openHelp() },
];

function openPalette(initial = '') {
  if (!palette.open) palette.showModal();
  pInput.value = initial;
  pInput.placeholder = t('palette.placeholder');
  palette.querySelector('.p-hint').textContent = t('palette.hint');
  drawPalette();
  pInput.focus();
}

function drawPalette() {
  const q = pInput.value.trim();
  const lang = getLang();
  pItems = [];
  let html = '';
  const cmds = COMMANDS.filter((c) => !q || t('cmd.' + c.id).toLowerCase().includes(q.toLowerCase()));
  if (q) {
    const res = search(index, q, { lang, limit: 8 });
    // only show the user's language for topics unless nothing matched there
    const topics = res.topics.filter((h) => h.doc.lang === lang);
    const shownTopics = (topics.length ? topics : res.topics).slice(0, 7);
    if (shownTopics.length) {
      html += `<li class="p-head">${esc(t('palette.topics'))}</li>`;
      for (const h of shownTopics) {
        pItems.push({ run: () => go(readHash(h.doc, h.topic.page, q, false, h.topic.at)) });
        html += `<li class="p-item" data-i="${pItems.length - 1}" style="--h:${DOMAIN_META[h.topic.domain].hue}">
          <span class="p-ico">${DOMAIN_META[h.topic.domain].sym}</span>
          <span class="p-main"><span>${highlight(h.topic.title, res.terms)}</span><small>${esc(t('domain.' + h.topic.domain))} · p.${h.topic.page}</small></span>${langBadge(h.doc.lang)}</li>`;
      }
    }
    const pages = res.pages.slice(0, 7);
    if (pages.length) {
      html += `<li class="p-head">${esc(t('palette.pages'))}</li>`;
      for (const h of pages) {
        pItems.push({ run: () => go(readHash(h.doc, h.page, q)) });
        html += `<li class="p-item" data-i="${pItems.length - 1}"><span class="p-ico mono">${h.page}</span>
          <span class="p-main snippet">${esc(h.snippet.pre)}<mark>${esc(h.snippet.hit)}</mark>${esc(h.snippet.post)}</span>${langBadge(h.doc.lang)}</li>`;
      }
    }
  }
  if (cmds.length) {
    html += `<li class="p-head">${esc(t('palette.commands'))}</li>`;
    for (const c of cmds) {
      pItems.push({ run: c.run });
      html += `<li class="p-item" data-i="${pItems.length - 1}"><span class="p-ico">${c.icon}</span><span class="p-main">${esc(t('cmd.' + c.id))}</span></li>`;
    }
  }
  if (!pItems.length) html = `<li class="p-empty">${esc(t('palette.empty'))}</li>`;
  pList.innerHTML = html;
  pSel = 0;
  markSel();
}

function markSel() {
  pList.querySelectorAll('.p-item').forEach((el) => el.classList.toggle('sel', +el.dataset.i === pSel));
  pList.querySelector('.p-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function runSel(i = pSel) {
  const item = pItems[i];
  if (!item) return;
  palette.close();
  item.run();
}

pInput.addEventListener('input', drawPalette);
pInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') ((pSel = Math.min(pItems.length - 1, pSel + 1)), markSel(), e.preventDefault());
  else if (e.key === 'ArrowUp') ((pSel = Math.max(0, pSel - 1)), markSel(), e.preventDefault());
  else if (e.key === 'Enter') (runSel(), e.preventDefault());
});
pList.addEventListener('click', (e) => {
  const li = e.target.closest('.p-item');
  if (li) runSel(+li.dataset.i);
});
pList.addEventListener('mousemove', (e) => {
  const li = e.target.closest('.p-item');
  if (li && +li.dataset.i !== pSel) ((pSel = +li.dataset.i), markSel());
});
palette.addEventListener('click', (e) => e.target === palette && palette.close());

/* ------------------------------------------------------------------ help */

const help = document.getElementById('help');
function openHelp() {
  help.querySelector('h2').textContent = t('help.title');
  help.querySelector('.help-close').textContent = t('help.close');
  help.querySelector('dl').innerHTML = t('help.keys')
    .map(([k, d]) => `<div><dt>${k.split('  ').map((x) => `<kbd>${esc(x.trim())}</kbd>`).join(' ')}</dt><dd>${esc(d)}</dd></div>`)
    .join('');
  help.showModal();
}
help.addEventListener('click', (e) => (e.target === help || e.target.closest('.help-close')) && help.close());

// Close an open ⋯ menu when tapping anywhere else (or pressing Escape).
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.tb-more[open]').forEach((d) => !d.contains(e.target) && d.removeAttribute('open'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('details.tb-more[open]').forEach((d) => d.removeAttribute('open'));
});

/* -------------------------------------------------------------- keyboard */

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return palette.open ? palette.close() : openPalette();
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || palette.open || help.open) return;
  const r = currentReader;
  const k = e.key;
  if (k === '/') return (e.preventDefault(), openPalette());
  if (k === '?') return openHelp();
  if (k === 't' || k === 'T') return toggleTheme();
  if (k === 'l' || k === 'L') return setLang(getLang() === 'en' ? 'nl' : 'en');
  if (!r) return;
  const map = {
    ArrowRight: 'next', ArrowLeft: 'prev', j: 'next', k: 'prev', PageDown: null, PageUp: null,
    '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', 0: 'fit-width', b: 'bookmark', n: 'note',
    s: 'split', f: 'focus', r: 'speak', '[': 'prev-topic', ']': 'next-topic',
  };
  if (k === 'Escape' && r.root.classList.contains('focus')) return r.action('focus');
  const act = map[k] ?? map[k.toLowerCase()];
  if (act) {
    e.preventDefault();
    r.action(act);
  }
});

/* ---------------------------------------------------------------- chrome */

function refreshChrome() {
  applyI18n(document);
  document.getElementById('lang-toggle').querySelectorAll('span').forEach((s) => s.classList.toggle('on', s.dataset.l === getLang()));
  document.getElementById('foot-made').textContent = t('footer.made');
  document.title = t('app.name');
}

async function init() {
  bg = startBackground(document.getElementById('bg'));
  applyTheme();
  const initialLang = store.settings.lang || (navigator.language?.toLowerCase().startsWith('nl') ? 'nl' : 'en');
  setLang(initialLang);
  document.documentElement.lang = getLang();
  refreshChrome();

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('lang-toggle').addEventListener('click', () => setLang(getLang() === 'en' ? 'nl' : 'en'));
  document.getElementById('search-open').addEventListener('click', () => openPalette());
  document.getElementById('help-open').addEventListener('click', openHelp);
  setupInstall();

  onLangChange((lang) => {
    store.setSetting('lang', lang);
    refreshChrome();
    if (currentReader) currentReader.onLang(lang);
    else route();
  });

  try {
    lib = await (await fetch('data/library.json')).json();
  } catch (err) {
    view.innerHTML = `<div class="error-box">⚠ Could not load data/library.json — run <code>npm run build:index</code> and serve the folder over HTTP.</div>`;
    return;
  }
  docsById = Object.fromEntries(lib.docs.map((d) => [d.id, d]));
  index = buildIndex(lib);
  addEventListener('hashchange', route);
  route();
}

init();
