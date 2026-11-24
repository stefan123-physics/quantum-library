// pdf.js loading, caching and a lazily-rendered, zoomable, searchable page pane.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { norm } from './search.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const docCache = new Map();
export function loadPdf(file) {
  if (!docCache.has(file)) docCache.set(file, pdfjsLib.getDocument({ url: file }).promise);
  return docCache.get(file);
}

// Render one page into a small canvas (covers and thumbnails).
export async function renderThumb(file, pageNo, canvas, width = 160) {
  const pdf = await loadPdf(file);
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(2, devicePixelRatio || 1);
  const vp = page.getViewport({ scale: (width / base.width) * dpr });
  canvas.width = vp.width;
  canvas.height = vp.height;
  canvas.style.aspectRatio = `${base.width} / ${base.height}`;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
}

export class Pane {
  constructor(el, doc, { onPage, onReady } = {}) {
    this.el = el;
    this.doc = doc;
    this.onPage = onPage || (() => {});
    this.onReady = onReady || (() => {});
    this.zoom = 'width'; // 'width' | 'page' | number (scale)
    this.scale = 1;
    this.current = 1;
    this.terms = null;
    this.pages = [];
    this.rendered = new Map(); // pageNo -> { task, scale }
    this.el.classList.add('pane');
    this.el.innerHTML = `<div class="pane-scroll" tabindex="0"><div class="pane-pages"></div></div><div class="pane-loading"><div class="atom-spinner"><i></i><i></i><i></i><b></b></div></div>`;
    this.scroller = this.el.querySelector('.pane-scroll');
    this.wrap = this.el.querySelector('.pane-pages');
    this.scroller.addEventListener('scroll', () => this.#onScroll(), { passive: true });
    this.scroller.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
    this.#setupPinch();
    this.ro = new ResizeObserver(() => {
      if (typeof this.zoom === 'string' && this.base) this.#applyScale(true);
    });
  }

  async open(page = 1) {
    this.pdf = await loadPdf(this.doc.file);
    const first = await this.pdf.getPage(1);
    this.base = first.getViewport({ scale: 1 });
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= this.pdf.numPages; i++) {
      const div = document.createElement('div');
      div.className = 'pdf-page';
      div.dataset.page = i;
      div.innerHTML = `<canvas></canvas><div class="textLayer"></div><span class="page-no">${i}</span>`;
      frag.appendChild(div);
      this.pages.push(div);
    }
    this.wrap.appendChild(frag);
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = +e.target.dataset.page;
        if (e.isIntersecting) this.#render(n);
      }
    }, { root: this.scroller, rootMargin: '1200px 0px' });
    this.pages.forEach((p) => this.io.observe(p));
    this.#applyScale(false);
    this.ro.observe(this.scroller);
    this.el.querySelector('.pane-loading').remove();
    this.goTo(page, false);
    this.onReady(this);
  }

  get numPages() {
    return this.pdf?.numPages || this.doc.numPages;
  }

  #fitScale() {
    const w = this.scroller.clientWidth - 40;
    const h = this.scroller.clientHeight - 24;
    if (this.zoom === 'width') return Math.max(0.3, Math.min(4, w / this.base.width));
    if (this.zoom === 'page') return Math.max(0.2, Math.min(w / this.base.width, h / this.base.height));
    return this.zoom;
  }

  setZoom(z) {
    if (z === 'in' || z === 'out') {
      const steps = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
      const cur = this.scale;
      z = z === 'in' ? steps.find((s) => s > cur + 0.01) ?? 4 : [...steps].reverse().find((s) => s < cur - 0.01) ?? 0.5;
    }
    this.zoom = z;
    this.#applyScale(true);
  }

  #applyScale(keepPosition) {
    const next = this.#fitScale();
    if (Math.abs(next - this.scale) < 0.001 && this.pages[0].style.width) return;
    // remember the relative position inside the current page so zooming doesn't jump
    let anchor = null;
    if (keepPosition && this.pages.length) {
      const p = this.pages[this.current - 1];
      anchor = { page: this.current, frac: (this.scroller.scrollTop - p.offsetTop) / Math.max(1, p.offsetHeight) };
    }
    this.scale = next;
    const w = Math.floor(this.base.width * next);
    const h = Math.floor(this.base.height * next);
    for (const p of this.pages) {
      p.style.width = w + 'px';
      p.style.height = h + 'px';
      p.style.setProperty('--scale-factor', next);
    }
    for (const [n, r] of this.rendered) {
      r.task?.cancel();
      this.rendered.delete(n);
    }
    if (anchor) {
      const p = this.pages[anchor.page - 1];
      this.scroller.scrollTop = p.offsetTop + anchor.frac * p.offsetHeight;
    }
    // re-render what is currently near the viewport
    this.pages.forEach((p) => { this.io.unobserve(p); this.io.observe(p); });
    this.el.dispatchEvent(new CustomEvent('zoom', { detail: { scale: next, mode: this.zoom } }));
  }

  async #render(n) {
    if (this.rendered.has(n)) return;
    const entry = { task: null, scale: this.scale };
    this.rendered.set(n, entry);
    const div = this.pages[n - 1];
    try {
      const page = await this.pdf.getPage(n);
      if (this.rendered.get(n) !== entry) return;
      const vp = page.getViewport({ scale: this.scale });
      const dpr = Math.min(2.5, devicePixelRatio || 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      entry.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      await entry.task.promise;
      if (this.rendered.get(n) !== entry) return;
      div.querySelector('canvas').replaceWith(canvas);
      div.classList.add('ready');
      // selectable/searchable text layer
      const tl = div.querySelector('.textLayer');
      const fresh = document.createElement('div');
      fresh.className = 'textLayer';
      tl.replaceWith(fresh);
      const textContent = await page.getTextContent();
      if (this.rendered.get(n) !== entry) return;
      await new pdfjsLib.TextLayer({ textContentSource: textContent, container: fresh, viewport: vp }).render();
      this.#highlightPage(n);
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') console.warn('render failed', n, err);
      if (this.rendered.get(n) === entry) this.rendered.delete(n);
    }
  }

  // Highlight search terms (array of alternative arrays) in the text layers.
  setHighlight(terms) {
    this.terms = terms && terms.length ? terms : null;
    this.pages.forEach((_, i) => this.#highlightPage(i + 1));
  }

  #highlightPage(n) {
    const tl = this.pages[n - 1]?.querySelector('.textLayer');
    if (!tl) return;
    tl.querySelectorAll('mark.hl').forEach((m) => m.replaceWith(...m.childNodes));
    tl.normalize();
    if (!this.terms) return;
    const alts = this.terms.flat().filter((a) => a.length > 1);
    for (const span of tl.querySelectorAll('span:not(.markedContent)')) {
      const text = span.textContent;
      const n2 = norm(text);
      if (n2.length !== text.length) continue;
      const ranges = [];
      for (const a of alts) {
        let i = n2.indexOf(a);
        while (i >= 0) ((ranges.push([i, i + a.length])), (i = n2.indexOf(a, i + a.length)));
      }
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0]);
      let html = '';
      let pos = 0;
      for (const [s, e] of ranges) {
        if (s < pos) continue;
        html += esc(text.slice(pos, s)) + '<mark class="hl">' + esc(text.slice(s, e)) + '</mark>';
        pos = e;
      }
      span.innerHTML = html + esc(text.slice(pos));
    }
  }

  goTo(n, smooth = true) {
    n = Math.max(1, Math.min(this.numPages, n | 0));
    const p = this.pages[n - 1];
    if (!p) return;
    this.scroller.scrollTo({ top: p.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
    this.#setCurrent(n);
  }

  // Scroll to a fractional position within a page (headings, synchronised split view).
  goToFraction(n, frac, smooth = false) {
    const p = this.pages[n - 1];
    if (!p) return;
    this.scroller.scrollTo({ top: p.offsetTop + frac * p.offsetHeight - 12, behavior: smooth ? 'smooth' : 'auto' });
  }

  // Page and fraction of that page under the reading line (35% down the pane).
  readingPoint() {
    const p = this.pages[this.current - 1];
    const y = this.scroller.scrollTop + this.scroller.clientHeight * 0.35;
    return { page: this.current, frac: p ? (y - p.offsetTop) / p.offsetHeight : 0 };
  }

  positionFraction() {
    const p = this.pages[this.current - 1];
    return p ? (this.scroller.scrollTop + 12 - p.offsetTop) / p.offsetHeight : 0;
  }

  next() { this.goTo(this.current + 1); }
  prev() { this.goTo(this.current - 1); }

  #onScroll() {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      const mid = this.scroller.scrollTop + this.scroller.clientHeight * 0.35;
      // binary search on offsetTop
      let lo = 0, hi = this.pages.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (this.pages[m].offsetTop <= mid) lo = m;
        else hi = m - 1;
      }
      this.#setCurrent(lo + 1);
      this.el.dispatchEvent(new CustomEvent('panescroll'));
    });
  }

  #setCurrent(n) {
    if (n === this.current && this.announced) return;
    this.announced = true;
    this.current = n;
    this.onPage(n, this);
  }

  // Two-finger pinch on touch screens: live CSS preview while pinching, real re-render on release.
  #setupPinch() {
    let start = 0, ratio = 1, origin = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    this.scroller.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      start = dist(e.touches);
      ratio = 1;
      const r = this.scroller.getBoundingClientRect();
      origin = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left + this.scroller.scrollLeft,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top + this.scroller.scrollTop,
      };
      this.wrap.style.transformOrigin = `${origin.x}px ${origin.y}px`;
    }, { passive: true });
    this.scroller.addEventListener('touchmove', (e) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      ratio = Math.max(0.4, Math.min(4, dist(e.touches) / start));
      this.wrap.style.transform = `scale(${ratio})`;
    }, { passive: false });
    const end = () => {
      if (!start) return;
      start = 0;
      this.wrap.style.transform = '';
      if (Math.abs(ratio - 1) > 0.05) this.setZoom(Math.max(0.3, Math.min(4, this.scale * ratio)));
    };
    this.scroller.addEventListener('touchend', end);
    this.scroller.addEventListener('touchcancel', end);
  }

  #onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    this.wheelAcc = (this.wheelAcc || 0) + e.deltaY;
    if (Math.abs(this.wheelAcc) > 40) {
      this.setZoom(this.wheelAcc < 0 ? 'in' : 'out');
      this.wheelAcc = 0;
    }
  }

  destroy() {
    this.io?.disconnect();
    this.ro?.disconnect();
    for (const r of this.rendered.values()) r.task?.cancel();
    this.el.innerHTML = '';
  }
}

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
