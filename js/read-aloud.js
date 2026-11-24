// Read-aloud engine: turns a page's lines (data/speech/<doc>.json) into units — headings, formulas and
// prose sentences — and speaks them one after another, page after page, with the browser's voice or
// the built-in meSpeak voice. Each unit keeps the boxes of its lines on the page, for highlighting.
import { mathToSpeech, pageSymbols } from './math-speech.js';
import { languageVoices, loadVoices } from './voices.js';
import { speakFallback, stopFallback, prepareFallback } from './tts-fallback.js';

const dataCache = new Map();
export function loadSpeechData(doc) {
  if (!dataCache.has(doc.id)) dataCache.set(doc.id, fetch(`data/speech/${doc.id}.json`).then((r) => (r.ok ? r.json() : [])));
  return dataCache.get(doc.id);
}

const OPERATOR = /[=≈⇒→∝≤≥<>]/;
const wordCount = (t) => (t.match(/[A-Za-zÀ-ÿ]{2,}/g) || []).length;

/** Units of one page: [{ kind: 'h'|'m'|'p', show, say, boxes, para }] */
export function pageUnits(segs, lang) {
  const symbols = pageSymbols(segs.map((s) => s.t));
  const units = [];
  let para = 0;
  let buf = []; // prose lines of the current paragraph
  const flush = () => {
    if (!buf.length) return;
    // join lines, undoing end-of-line hyphenation ("propaga-" + "tion")
    let text = '';
    const spans = [];
    for (const line of buf) {
      const t = line.t.trim();
      let start;
      if (text.endsWith('-') && /^[a-zà-ÿ]/.test(t)) {
        text = text.slice(0, -1);
        start = text.length;
        text += t;
      } else {
        if (text) text += ' ';
        start = text.length;
        text += t;
      }
      spans.push({ start, end: text.length, b: line.b });
    }
    // sentences: split after . ! ? or : followed by a space and a new sentence (never inside 1.98)
    const cuts = [0];
    const re = /[.!?](?=\s+[A-ZÀ-Ý•("“\d\u{1D400}-\u{1D7FF}∆Δ])/gu;
    let m;
    while ((m = re.exec(text))) cuts.push(m.index + 1);
    cuts.push(text.length);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      const show = text.slice(a, b).trim();
      if (!show) continue;
      const boxes = spans.filter((s) => s.start < b && s.end > a).map((s) => s.b);
      units.push({ kind: 'p', show, say: mathToSpeech(show, lang, { symbols, prose: true }), boxes, para });
    }
    buf = [];
    para++;
  };
  let prev = null;
  for (const s of segs) {
    if (s.k === 'p') {
      const bullet = /^\s*[•–-]\s/.test(s.t);
      const indented = prev && prev.k === 'p' && s.b[0] - prev.b[0] > 0.015 && /[.:?!]\s*$/.test(prev.t);
      if (bullet || indented) flush();
      buf.push(s);
    } else {
      flush();
      // lone symbols and labels from drawings ("𝑟", "(𝑠) (𝑙)") are not read
      if (s.k === 'm' && !OPERATOR.test(s.t) && wordCount(s.t) < 2) {
        prev = s;
        continue;
      }
      units.push({ kind: s.k, show: s.t, say: mathToSpeech(s.t, lang, { symbols }), boxes: [s.b], para: para++ });
    }
    prev = s;
  }
  flush();
  return units.filter((u) => u.say && /[A-Za-zÀ-ÿ0-9]/.test(u.say));
}

// Display text with structure, for the reading view: fractions stacked, powers raised, symbols italic.
export function markupToHTML(t) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const group = (s, i) => {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [s.slice(i + 1), s.length];
  };
  const italic = (s) =>
    s.replace(/([\u{1D434}-\u{1D467}ℎ]+)/gu, (run) =>
      `<i>${[...run]
        .map((c) => {
          if (c === 'ℎ') return 'h';
          const cp = c.codePointAt(0);
          return String.fromCharCode(cp >= 0x1d44e ? 97 + cp - 0x1d44e : 65 + cp - 0x1d434);
        })
        .join('')}</i>`,
    );
  const render = (s) => {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s.startsWith('\\frac{', i)) {
        const [num, a] = group(s, i + 5);
        const [den, b] = group(s, a);
        out += `<span class="fr"><span>${render(num)}</span><span>${render(den)}</span></span>`;
        i = b;
      } else if ((s[i] === '^' || s[i] === '_') && s[i + 1] === '{') {
        const [arg, b] = group(s, i + 1);
        out += s[i] === '^' ? `<sup>${render(arg)}</sup>` : `<sub>${render(arg)}</sub>`;
        i = b;
      } else {
        let j = i;
        while (j < s.length && !s.startsWith('\\frac{', j) && !((s[j] === '^' || s[j] === '_') && s[j + 1] === '{')) j++;
        out += italic(esc(s.slice(i, j)));
        i = j;
      }
    }
    return out;
  };
  return render(t);
}

/**
 * Plays units. Callbacks: onUnit(page, index, unit) when a unit starts, onState(state), onMessage(key, vars).
 * State: 'idle' | 'loading' | 'playing' | 'paused'.
 */
export class ReadAloud {
  constructor(doc, { onUnit, onState, onMessage, onPage, settings, saveSetting }) {
    this.doc = doc;
    this.lang = doc.lang;
    this.onUnit = onUnit;
    this.onState = onState;
    this.onMessage = onMessage;
    this.onPage = onPage;
    this.settings = settings;
    this.saveSetting = saveSetting;
    this.state = 'idle';
    this.session = 0;
    this.pos = null; // { page, index }
    this.unitCache = new Map();
  }

  get rate() {
    return this.settings.rate || 1;
  }

  async units(page) {
    if (!this.unitCache.has(page)) {
      const data = await loadSpeechData(this.doc);
      this.unitCache.set(page, pageUnits(data[page - 1] || [], this.lang));
    }
    return this.unitCache.get(page);
  }

  #set(state) {
    this.state = state;
    this.onState?.(state);
  }

  /** The voice to use: the saved choice, else the best voice for the language, else null (built-in). */
  async chooseVoice() {
    const pick = this.settings[`voice_${this.lang}`];
    if (pick === 'builtin' || this.nativeBroken) return null;
    const voices = await loadVoices();
    const list = languageVoices(voices, this.lang);
    return (pick && list.find((v) => v.voiceURI === pick)) || list[0] || null;
  }

  async start(page, index = 0) {
    const session = ++this.session;
    this.#cancelAudio();
    this.pos = { page, index };
    this.#set('loading');
    let voice;
    try {
      [voice] = await Promise.all([this.chooseVoice(), loadSpeechData(this.doc)]);
    } catch {
      voice = null;
    }
    if (session !== this.session) return;
    if (!voice) {
      this.onMessage?.('toast.fallbackVoice');
      try {
        await prepareFallback(this.lang);
      } catch {
        this.#set('idle');
        return this.onMessage?.('toast.noSpeech');
      }
    }
    if (session !== this.session) return;
    this.voice = voice;
    this.#set('playing');
    this.#loop(session);
  }

  async #loop(session) {
    while (session === this.session && this.pos && this.pos.page <= this.doc.numPages) {
      const list = await this.units(this.pos.page);
      if (session !== this.session) return;
      if (this.pos.index >= list.length) {
        this.pos = { page: this.pos.page + 1, index: 0 };
        if (this.pos.page <= this.doc.numPages) this.onPage?.(this.pos.page);
        continue;
      }
      const unit = list[this.pos.index];
      this.onUnit?.(this.pos.page, this.pos.index, unit);
      const ok = await this.#say(unit.say, session);
      if (session !== this.session) return;
      if (ok !== true) {
        if (this.voice) {
          // the browser accepted the text but never spoke: use the built-in voice from now on
          this.nativeBroken = true;
          this.voice = null;
          this.onMessage?.('toast.fallbackVoice');
          continue;
        }
        this.stop();
        return this.onMessage?.('toast.speechError', { error: ok });
      }
      this.pos = { page: this.pos.page, index: this.pos.index + 1 };
    }
    if (session === this.session) this.stop();
  }

  // Speak one unit; long ones in pieces (Chrome stops utterances after ~15 s).
  async #say(text, session) {
    const pieces = [];
    let rest = text;
    while (rest.length > 230) {
      let cut = rest.lastIndexOf(', ', 220);
      if (cut < 80) cut = rest.lastIndexOf(' ', 220);
      if (cut < 80) cut = 220;
      pieces.push(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) pieces.push(rest);
    for (const p of pieces) {
      if (session !== this.session) return true;
      const ok = this.voice ? await this.#native(p, session) : await this.#builtin(p);
      if (ok !== true) return ok;
    }
    return true;
  }

  #native(text, session) {
    return new Promise((resolve) => {
      let started = false;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.voice.lang;
      u.voice = this.voice;
      u.rate = this.rate;
      u.onstart = () => {
        started = true;
        this.nativeWorks = true;
      };
      u.onend = () => resolve(true);
      u.onerror = (e) => resolve(e.error === 'interrupted' || e.error === 'canceled' ? true : e.error || 'error');
      if (!this.nativeWorks) {
        setTimeout(() => {
          if (!started && session === this.session && !speechSynthesis.speaking) {
            speechSynthesis.cancel();
            resolve('no-start');
          }
        }, 3500);
      }
      speechSynthesis.speak(u);
    });
  }

  async #builtin(text) {
    try {
      return await speakFallback(text, this.lang, this.rate);
    } catch (err) {
      return err?.message || 'built-in voice unavailable';
    }
  }

  #cancelAudio() {
    if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    stopFallback();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.session++;
    this.#cancelAudio();
    this.#set('paused');
  }

  resume() {
    if (this.state !== 'paused' || !this.pos) return;
    this.start(this.pos.page, this.pos.index);
  }

  async skip(delta) {
    if (!this.pos) return;
    let { page, index } = this.pos;
    index += delta;
    if (index < 0 && page > 1) {
      page--;
      index = Math.max(0, (await this.units(page)).length - 1);
    }
    this.start(page, Math.max(0, index));
  }

  setRate(r) {
    this.saveSetting('rate', r);
    if (this.state === 'playing') this.start(this.pos.page, this.pos.index);
  }

  setVoice(choice) {
    this.saveSetting(`voice_${this.lang}`, choice);
    this.nativeBroken = false;
    if (this.state === 'playing') this.start(this.pos.page, this.pos.index);
  }

  stop() {
    this.session++;
    this.#cancelAudio();
    this.#set('idle');
  }
}
