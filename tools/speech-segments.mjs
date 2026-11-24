// Rebuilds readable lines, with formula structure, from pdf.js glyph runs (build time).
//
// pdf.js flattens maths: "Δv = Δp/m" arrives as three lines and "v²" as "v" + a "2" on the next line.
// Positions and fonts tell the structure back:
//   - LaTeX fonts: *MathItalic* = a symbol letter, *Roman7*/*Roman5* = a sub/superscript,
//     *MathSymbols* = an operator, *Bold* = a heading
//   - a small glyph raised above the baseline is a power, lowered below it a subscript
//   - normal-size text ~7pt above and below an equation's baseline, stacked, is a fraction
//
// Each line becomes a segment { k, t, b }:
//   k: 'h' heading | 'm' display formula | 'p' prose (may hold inline maths)
//   t: text with markup:  ^{…} power, _{…} subscript, \frac{…}{…}, math-italic letters as Unicode
//      mathematical italic (𝑚 𝑣 …) so read-aloud knows "m" is a symbol and not "metres"
//   b: [left, top, right, bottom] as fractions of the page, for highlighting what is being read

const ITALIC_LOWER = 0x1d44e; // 𝑎
const ITALIC_UPPER = 0x1d434; // 𝐴
const toItalic = (s) =>
  [...s]
    .map((c) => {
      if (c === 'h') return 'ℎ';
      if (c >= 'a' && c <= 'z') return String.fromCodePoint(ITALIC_LOWER + c.charCodeAt(0) - 97);
      if (c >= 'A' && c <= 'Z') return String.fromCodePoint(ITALIC_UPPER + c.charCodeAt(0) - 65);
      return c;
    })
    .join('');

const FIGURE_RE = /^(\d+\.\s*)?(diagram|illustrati|afbeelding|visuali[sz]|ray diagram|stralendiagram|graphical representation|grafische voorstelling|circuit diagram|circuitschema|schakelschema|schema)\b/i;

function fontKind(name = '') {
  if (/Bold/i.test(name)) return 'bold';
  if (/MathItalic|CMMI|Italic.*Math/i.test(name)) return 'it';
  if (/MathSymbols|CMSY|MathExtension|CMEX/i.test(name)) return 'sym';
  return 'rm';
}

export async function pageSegments(page) {
  await page.getOperatorList(); // loads fonts so their real names are known
  const tc = await page.getTextContent();
  const [, , W, H] = page.view;
  const fontName = {};
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    if (!(it.fontName in fontName)) {
      try {
        fontName[it.fontName] = page.commonObjs.get(it.fontName)?.name || '';
      } catch {
        fontName[it.fontName] = '';
      }
    }
    const size = Math.hypot(it.transform[0], it.transform[1]);
    items.push({
      s: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      size,
      kind: fontKind(fontName[it.fontName]),
      small: size < 8.6,
    });
  }

  // Equation numbers "(12)" at the right margin are not read.
  const body = items.filter((i) => !(i.x > W * 0.8 && /^\(\d+\)$/.test(i.s.trim())));

  // 1. Baselines of normal-size text.
  const normal = body.filter((i) => !i.small).sort((a, b) => b.y - a.y);
  const lines = [];
  for (const it of normal) {
    let L = lines.find((l) => Math.abs(l.y - it.y) < 1.2);
    if (!L) lines.push((L = { y: it.y, items: [] }));
    L.items.push(it);
  }
  // A line is bold when (nearly) all of its text is: bold words inside a sentence stay prose.
  for (const L of lines) {
    const chars = (f) => L.items.filter(f).reduce((n, i) => n + (i.s ?? '').trim().length, 0);
    L.bold = chars((i) => i.kind === 'bold') > 0.6 * chars(() => true);
    L.size = Math.max(...L.items.map((i) => i.size));
  }
  lines.sort((a, b) => b.y - a.y);

  // 2. Fractions: chunks ~5–9pt above and below a baseline, stacked on the same x.
  const chunksOf = (L) => {
    const its = [...L.items].sort((a, b) => a.x - b.x);
    const out = [];
    for (const it of its) {
      const last = out[out.length - 1];
      if (last && it.x - last.x1 < 4) {
        last.items.push(it);
        last.x1 = Math.max(last.x1, it.x + it.w);
      } else out.push({ items: [it], x0: it.x, x1: it.x + it.w });
    }
    return out;
  };
  for (const L of lines) {
    if (L.dead) continue;
    const lo = 0.45 * L.size, hi = 1.0 * L.size;
    const above = lines.filter((A) => !A.dead && A !== L && A.y - L.y > lo && A.y - L.y < hi);
    const below = lines.filter((B) => !B.dead && B !== L && L.y - B.y > lo && L.y - B.y < hi);
    if (!above.length || !below.length) continue;
    for (const A of above) {
      for (const B of below) {
        const ca = chunksOf(A);
        const cb = chunksOf(B);
        for (const a of ca) {
          const b = cb.find((c) => Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > -2 && Math.abs((a.x0 + a.x1) / 2 - (c.x0 + c.x1) / 2) < 14);
          if (!b) continue;
          // A square-root sign also sits above the baseline: never treat it as a numerator.
          if (a.items.every((i) => (i.s ?? '').trim() === '√') || [...a.items, ...b.items].some((i) => i.frac)) continue;
          L.items.push({ frac: [a.items, b.items], x: Math.min(a.x0, b.x0), w: Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0), y: L.y, size: 10, kind: 'frac', top: A.y + 8, bottom: B.y - 3 });
          A.items = A.items.filter((i) => !a.items.includes(i));
          B.items = B.items.filter((i) => !b.items.includes(i));
          cb.splice(cb.indexOf(b), 1);
        }
        if (!A.items.length) A.dead = true;
        if (!B.items.length) B.dead = true;
      }
    }
  }
  // A lone √ just above a baseline belongs to that line.
  for (const R of lines) {
    if (R.dead || R.bold || !R.items.every((i) => (i.s ?? '').trim() === '√')) continue;
    const L = lines.find((l) => !l.dead && !l.bold && l !== R && R.y - l.y > 3 && R.y - l.y < 12);
    if (L) {
      L.items.push(...R.items.map((i) => ({ ...i, y: L.y })));
      R.dead = true;
    }
  }

  // 3a. Fractions inside a sentence are set small: a small glyph above and one below a baseline, centred
  //     on each other, not hanging off a symbol (that would be a sub- and superscript on the same letter).
  const smalls = body.filter((i) => i.small);
  const used = new Set();
  for (const L of lines.filter((l) => !l.dead)) {
    const ups = smalls.filter((i) => !used.has(i) && i.y - L.y > 1.5 && i.y - L.y < 8);
    const downs = smalls.filter((i) => !used.has(i) && L.y - i.y > 0.5 && L.y - i.y < 6);
    for (const a of ups) {
      const b = downs.find((d) => !used.has(d) && Math.abs(a.x + a.w / 2 - (d.x + d.w / 2)) < 5);
      if (!b) continue;
      const x0 = Math.min(a.x, b.x);
      const before = L.items.filter((i) => i.x + i.w <= x0 + 1).sort((p, q) => q.x + q.w - (p.x + p.w))[0];
      const gap = before ? x0 - (before.x + before.w) : 99;
      const onSymbol = before && gap < 1.2 && (before.kind === 'it' || /[)\]α-ωΑ-Ω]$/.test((before.s ?? '').trim()));
      if (onSymbol) continue;
      // numerator and denominator can be several glyphs ("2π")
      const run = (seed) => {
        const out = [seed];
        let grew = true;
        while (grew) {
          grew = false;
          for (const i of smalls) {
            if (used.has(i) || out.includes(i) || Math.abs(i.y - seed.y) > 0.8) continue;
            if (out.some((o) => i.x - (o.x + o.w) < 1.5 && o.x - (i.x + i.w) < 1.5)) {
              out.push(i);
              grew = true;
            }
          }
        }
        return out;
      };
      const num = run(a);
      const den = run(b);
      [...num, ...den].forEach((i) => used.add(i));
      const xs = [...num, ...den];
      const fx0 = Math.min(...xs.map((i) => i.x));
      L.items.push({ frac: [num, den], x: fx0, w: Math.max(...xs.map((i) => i.x + i.w)) - fx0, y: L.y, size: 10, kind: 'frac', top: a.y + 6, bottom: b.y - 2 });
    }
  }

  // 3b. Sub- and superscripts: attach each small glyph to the glyph it follows.
  const all = () => lines.filter((l) => !l.dead).flatMap((l) => l.items.map((i) => ({ i, l })));
  const scripts = smalls.filter((i) => !used.has(i)).sort((a, b) => a.x - b.x);
  for (const sc of scripts) {
    let best = null;
    for (const { i, l } of all()) {
      const holders = i.frac ? [...i.frac[0], ...i.frac[1]] : [i];
      for (const h of holders) {
        const dy = sc.y - h.y;
        // measured from the end of the glyph, or of the scripts it already carries ("v₁,init")
        const dx = sc.x - Math.max(h.x + h.w, h.scriptEnd ?? -Infinity);
        if (dy > -5 && dy < 7.5 && dx > -2 && dx < 4) {
          const score = Math.abs(dx) + Math.abs(dy) * 0.3;
          if (!best || score < best.score) best = { score, h, l };
        }
      }
    }
    if (best) {
      const h = best.h;
      const up = sc.y > h.y + 1;
      const t = sc.kind === 'it' ? toItalic(sc.s) : sc.s;
      const last = h.scripts?.[h.scripts.length - 1];
      if (last && last.up === up && sc.x - h.scriptEnd < 2) last.t += (sc.x - h.scriptEnd > 1.2 ? ' ' : '') + t;
      else (h.scripts ||= []).push({ t, up });
      h.scriptEnd = Math.max(h.scriptEnd ?? -Infinity, sc.x + sc.w);
    } else {
      // a small label on its own (figure text): a line of its own
      lines.push({ y: sc.y, bold: false, items: [{ ...sc, small: false }] });
    }
  }

  // 4. Text of each line, left to right.
  const itemText = (it) => {
    if (it.frac) return `\\frac{${runText(it.frac[0])}}{${runText(it.frac[1])}}`;
    let s = it.kind === 'it' ? toItalic(it.s) : it.s;
    for (const sc of it.scripts || []) s = s.replace(/\s+$/, '') + (sc.up ? `^{${sc.t.trim()}}` : `_{${sc.t.trim()}}`);
    return s;
  };
  function runText(its) {
    let out = '';
    let prevEnd = null;
    for (const it of [...its].sort((a, b) => a.x - b.x)) {
      const t = itemText(it);
      if (prevEnd !== null && it.x - prevEnd > 1.6 && !/\s$/.test(out) && !/^\s/.test(t)) out += ' ';
      out += t;
      prevEnd = Math.max(it.x + it.w, it.scriptEnd ?? -Infinity);
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  const segs = [];
  let inFigure = false;
  for (const L of lines.filter((l) => !l.dead && l.items.length).sort((a, b) => b.y - a.y)) {
    const text = runText(L.items);
    if (!text) continue;
    const x0 = Math.min(...L.items.map((i) => i.x));
    const x1 = Math.max(...L.items.map((i) => i.x + i.w));
    const top = Math.max(...L.items.map((i) => (i.frac ? i.top : i.y + i.size * 0.8)));
    const bottom = Math.min(...L.items.map((i) => (i.frac ? i.bottom : i.y - i.size * 0.28)));
    const words = text.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]{2,}/.test(w)).length;
    let k;
    // Large bold text with a formula inside a drawing ("Pascal's Law: ΔP = F/A") is a label, not a title.
    const drawingTitle = inFigure && L.size >= 20 && /=/.test(text);
    const isHeading = L.bold && !drawingTitle && (x0 < W * 0.2 || L.size >= 20) && /[A-Za-zÀ-ÿ]{2,}/.test(text);
    if (isHeading) {
      k = 'h';
      inFigure = FIGURE_RE.test(text);
    } else if (drawingTitle || (L.bold && (inFigure || words < 3))) {
      continue; // bold labels in a drawing
    } else if (/^\d{1,3}$/.test(text) && bottom * 1 < 80) {
      continue; // page number
    } else {
      const indentedFormula = x0 > W * 0.18 && words < 6;
      const mathy = /[=≈⇒→∝≤≥]|\\frac|\^\{|[\u{1D434}-\u{1D467}ℎ]/u.test(text);
      k = indentedFormula && mathy ? 'm' : 'p';
      // Inside a figure only real sentences (captions) are read, not the scattered labels.
      if (inFigure && !(x0 < W * 0.2 && words >= 6)) continue;
      if (!inFigure && x0 > W * 0.18 && !mathy && words < 3) continue; // stray labels outside figures
    }
    segs.push({
      k,
      t: text,
      b: [x0 / W, 1 - top / H, x1 / W, 1 - bottom / H].map((v) => +Math.min(1, Math.max(0, v)).toFixed(4)),
    });
  }
  return segs;
}
