// Turns a line from data/speech (prose with inline maths, or a display formula) into words a speech
// engine says correctly, in English or Dutch. Input markup (made by tools/speech-segments.mjs):
//   ^{…} power, _{…} subscript, \frac{…}{…}, and math-italic letters (𝑚 𝑣 𝐹) for symbols.
// Ideas ported from open-cosmology's lib/speech.ts (TeX → speech):
//   - grouping is spoken ("the quantity a plus b, all over c"), since spoken maths has no brackets
//   - capital Greek is always "capital omega", so Ω and ω never sound alike; a capital Latin letter is
//     "capital M" only when the same page also uses m
//   - units are written out ("9.81 m/s²" → "9.81 metres per second squared")
//   - a symbol letter after a number is spelled as it sounds ("2 em", not "2 metres")
//   - "squared", "cubed", "to the power …, end of power"; "f of x" after functions

const W = {
  en: {
    eq: 'equals', approx: 'is approximately', so: 'so', to: 'to', plus: 'plus', minus: 'minus', times: 'times',
    over: 'over', div: 'divided by', pm: 'plus or minus', mp: 'minus or plus', ge: 'is greater than or equal to',
    le: 'is less than or equal to', gt: 'is greater than', lt: 'is less than', ne: 'is not equal to',
    prop: 'is proportional to', inf: 'infinity', int: 'the integral of', sum: 'the sum of', partial: 'partial',
    nabla: 'nabla', sqrt: 'the square root of', parallel: 'parallel to', perp: 'perpendicular to',
    abs: 'the absolute value of', deg: 'degrees', percent: 'percent', hbar: 'h-bar', star: 'star', prime: 'prime',
    squared: 'squared', cubed: 'cubed', power: 'to the power', endPower: 'end of power', half: 'one half',
    quantity: 'the quantity', allOver: 'all over', of: 'of', capital: 'capital', vector: 'vector', delta: 'delta',
    per: 'per', nought: 'nought', and: 'and', dot: 'dot', bar: 'bar',
    fn: { sin: 'sine', cos: 'cosine', tan: 'tangent', ln: 'the natural log', log: 'the log', exp: 'the exponential' },
    sub: { init: 'initial', i: 'i', f: 'f', final: 'final', net: 'net', tot: 'total', avg: 'average', max: 'max', min: 'min', cm: 'c m' },
  },
  nl: {
    eq: 'is gelijk aan', approx: 'is ongeveer', so: 'dus', to: 'naar', plus: 'plus', minus: 'min', times: 'maal',
    over: 'gedeeld door', div: 'gedeeld door', pm: 'plus of min', mp: 'min of plus', ge: 'is groter dan of gelijk aan',
    le: 'is kleiner dan of gelijk aan', gt: 'is groter dan', lt: 'is kleiner dan', ne: 'is niet gelijk aan',
    prop: 'is evenredig met', inf: 'oneindig', int: 'de integraal van', sum: 'de som van', partial: 'partieel',
    nabla: 'nabla', sqrt: 'de wortel uit', parallel: 'evenwijdig aan', perp: 'loodrecht op',
    abs: 'de absolute waarde van', deg: 'graden', percent: 'procent', hbar: 'h-streep', star: 'ster', prime: 'accent',
    squared: 'kwadraat', cubed: 'tot de derde', power: 'tot de macht', endPower: 'einde macht', half: 'een half',
    quantity: 'de hoeveelheid', allOver: 'alles gedeeld door', of: 'van', capital: 'hoofdletter', vector: 'vector',
    delta: 'delta', per: 'per', nought: 'nul', and: 'en', dot: 'punt', bar: 'streep',
    fn: { sin: 'sinus', cos: 'cosinus', tan: 'tangens', ln: 'de natuurlijke logaritme', log: 'de logaritme', exp: 'de e-macht' },
    sub: { init: 'begin', i: 'i', f: 'f', final: 'eind', net: 'netto', tot: 'totaal', avg: 'gemiddeld', max: 'max', min: 'min', cm: 'c m' },
  },
};

const GREEK = {
  α: ['alpha', 'alfa'], β: ['beta', 'bèta'], γ: ['gamma', 'gamma'], δ: ['delta', 'delta'], ε: ['epsilon', 'epsilon'],
  ϵ: ['epsilon', 'epsilon'], ζ: ['zeta', 'zèta'], η: ['eta', 'èta'], θ: ['theta', 'thèta'], ϑ: ['theta', 'thèta'],
  ι: ['iota', 'jota'], κ: ['kappa', 'kappa'], λ: ['lambda', 'lambda'], μ: ['mu', 'mu'], ν: ['nu', 'nu'],
  ξ: ['xi', 'ksi'], π: ['pi', 'pi'], ρ: ['rho', 'rho'], σ: ['sigma', 'sigma'], ς: ['sigma', 'sigma'], τ: ['tau', 'tau'],
  υ: ['upsilon', 'upsilon'], φ: ['phi', 'fi'], ϕ: ['phi', 'fi'], χ: ['chi', 'chi'], ψ: ['psi', 'psi'], ω: ['omega', 'omega'],
  Γ: ['gamma', 'gamma'], Θ: ['theta', 'thèta'], Λ: ['lambda', 'lambda'], Ξ: ['xi', 'ksi'], Π: ['pi', 'pi'],
  Σ: ['sigma', 'sigma'], Φ: ['phi', 'fi'], Ψ: ['psi', 'psi'], Ω: ['omega', 'omega'],
};

// Unit abbreviations → [English plural, English singular, Dutch]
const UNITS = {
  m: ['metres', 'metre', 'meter'], km: ['kilometres', 'kilometre', 'kilometer'], cm: ['centimetres', 'centimetre', 'centimeter'],
  mm: ['millimetres', 'millimetre', 'millimeter'], μm: ['micrometres', 'micrometre', 'micrometer'], nm: ['nanometres', 'nanometre', 'nanometer'],
  s: ['seconds', 'second', 'seconde'], ms: ['milliseconds', 'millisecond', 'milliseconde'], min: ['minutes', 'minute', 'minuten'],
  h: ['hours', 'hour', 'uur'], kg: ['kilograms', 'kilogram', 'kilogram'], g: ['grams', 'gram', 'gram'],
  N: ['newtons', 'newton', 'newton'], kN: ['kilonewtons', 'kilonewton', 'kilonewton'], mN: ['millinewtons', 'millinewton', 'millinewton'],
  J: ['joules', 'joule', 'joule'], kJ: ['kilojoules', 'kilojoule', 'kilojoule'], MJ: ['megajoules', 'megajoule', 'megajoule'],
  W: ['watts', 'watt', 'watt'], kW: ['kilowatts', 'kilowatt', 'kilowatt'], Pa: ['pascals', 'pascal', 'pascal'],
  kPa: ['kilopascals', 'kilopascal', 'kilopascal'], atm: ['atmospheres', 'atmosphere', 'atmosfeer'], Hz: ['hertz', 'hertz', 'hertz'],
  K: ['kelvin', 'kelvin', 'kelvin'], '°C': ['degrees Celsius', 'degree Celsius', 'graden Celsius'], C: ['coulombs', 'coulomb', 'coulomb'],
  μC: ['microcoulombs', 'microcoulomb', 'microcoulomb'], nC: ['nanocoulombs', 'nanocoulomb', 'nanocoulomb'],
  V: ['volts', 'volt', 'volt'], kV: ['kilovolts', 'kilovolt', 'kilovolt'], A: ['amperes', 'ampere', 'ampère'],
  mA: ['milliamperes', 'milliampere', 'milliampère'], Ω: ['ohms', 'ohm', 'ohm'], T: ['teslas', 'tesla', 'tesla'],
  mT: ['milliteslas', 'millitesla', 'millitesla'], F: ['farads', 'farad', 'farad'], μF: ['microfarads', 'microfarad', 'microfarad'],
  mol: ['moles', 'mole', 'mol'], L: ['litres', 'litre', 'liter'], rad: ['radians', 'radian', 'radialen'],
  eV: ['electronvolts', 'electronvolt', 'elektronvolt'], keV: ['kilo-electronvolts', 'kilo-electronvolt', 'kilo-elektronvolt'],
  MeV: ['mega-electronvolts', 'mega-electronvolt', 'mega-elektronvolt'], GeV: ['giga-electronvolts', 'giga-electronvolt', 'giga-elektronvolt'],
  u: ['atomic mass units', 'atomic mass unit', 'atomaire massa-eenheden'], Bq: ['becquerels', 'becquerel', 'becquerel'],
  dB: ['decibels', 'decibel', 'decibel'], ly: ['light-years', 'light-year', 'lichtjaar'], AU: ['astronomical units', 'astronomical unit', 'astronomische eenheden'],
};
const UNIT_RE_SRC = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
// atom with an optional power: m^{2}, m2, s^{−1}
const UNIT_ATOM = `(?:${UNIT_RE_SRC})(?:\\^\\{[^{}]*\\}|[23](?![0-9]))?`;
const UNIT_EXPR = `${UNIT_ATOM}(?:\\s*(?:/|·|\\s)\\s*${UNIT_ATOM})*`;

// Letters a speech engine reads as a unit right after a number, and how to say them as letters.
const LETTER_SOUNDS = {
  en: { m: 'em', s: 'ess', g: 'gee', K: 'kay', N: 'en', J: 'jay', W: 'double-u', A: 'ay', V: 'vee', C: 'see', T: 'tee', H: 'aitch', F: 'eff', L: 'el', l: 'el', h: 'aitch', d: 'dee', a: 'ay' },
  nl: { m: 'em', s: 'es', g: 'gee', K: 'kaa', N: 'en', J: 'jee', W: 'wee', A: 'aa', V: 'vee', C: 'see', T: 'tee', H: 'haa', F: 'ef', L: 'el', l: 'el', h: 'haa', d: 'dee', a: 'aa' },
};

const ITALIC_RE = /[\u{1D434}-\u{1D467}ℎ]/u;
function plainLetter(ch) {
  if (ch === 'ℎ') return 'h';
  const cp = ch.codePointAt(0);
  if (cp >= 0x1d44e && cp <= 0x1d467) return String.fromCharCode(97 + cp - 0x1d44e);
  if (cp >= 0x1d434 && cp <= 0x1d44d) return String.fromCharCode(65 + cp - 0x1d434);
  return ch;
}

/** Lower-case symbol letters used on a page (to know when a capital needs "capital"). */
export function pageSymbols(lines) {
  const set = new Set();
  for (const t of lines) for (const ch of t) if (ITALIC_RE.test(ch)) set.add(plainLetter(ch));
  return set;
}

// Reads a {…} group starting at s[i] === '{'; returns [content, indexAfter].
function group(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

// A sum or difference at the top level (outside braces/brackets): its grouping must be spoken.
function compound(raw) {
  let depth = 0;
  const s = raw.trim().replace(/^[−\-+±]\s*/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) depth--;
    else if (depth === 0 && /[+−±∓]/.test(c)) return true;
    else if (depth === 0 && c === '-' && /[\w)\u{1D400}-\u{1D7FF}]/u.test(s[i - 1] ?? '') && /\s/.test(s[i + 1] ?? '')) return true;
  }
  return false;
}

export function mathToSpeech(text, lang = 'en', ctx = {}) {
  const w = W[lang] || W.en;
  const L = lang === 'nl' ? 2 : 0;
  const chunks = [];
  const keep = (spoken) => `\u0001${chunks.push(spoken) - 1}\u0002`;
  const restore = (s) => {
    for (let k = 0; k < 4 && /\u0001/.test(s); k++) s = s.replace(/\u0001(\d+)\u0002/g, (_, n) => ` ${chunks[+n]} `);
    return s;
  };
  const conv = (s) => restore(convert(s)).replace(/\s+/g, ' ').trim();

  function convert(s) {
    // 1. Structures, innermost first: fractions, powers, subscripts.
    for (let guard = 0; guard < 50; guard++) {
      const f = s.search(/\\frac\{/);
      const p = s.search(/[\^_]\{/);
      if (f < 0 && p < 0) break;
      if (f >= 0 && (p < 0 || f < p || !/[\^_]\{/.test(s.slice(f)))) {
        // only take a fraction whose parts hold no further structure, else handle inner ones first
        const [num, a] = group(s, f + 5);
        const [den, b] = group(s, a);
        if (/\\frac\{|[\^_]\{/.test(num + den)) {
          const inner = /\\frac\{|[\^_]\{/.exec(num) ? num : den;
          const start = s.indexOf(inner, f);
          s = s.slice(0, start) + convert(inner) + s.slice(start + inner.length);
          continue;
        }
        s = s.slice(0, f) + keep(fraction(num, den)) + s.slice(b);
      } else {
        const [arg, b] = group(s, p + 1);
        if (/\\frac\{|[\^_]\{/.test(arg)) {
          s = s.slice(0, p + 2) + convert(arg) + '}' + s.slice(b);
          continue;
        }
        s = s.slice(0, p) + keep(s[p] === '^' ? power(arg) : subscript(arg)) + s.slice(b);
      }
    }
    return words(s);
  }

  function fraction(num, den) {
    const n = num.trim();
    const d = den.trim();
    if (n === '1' && d === '2') return w.half;
    const cn = compound(n);
    const cd = compound(d);
    return (cn ? `${w.quantity} ${conv(n)}, ${w.allOver}` : `${conv(n)} ${w.over}`) + ' ' + (cd ? `${w.quantity} ${conv(d)},` : conv(d));
  }

  function power(e) {
    const t = e.trim();
    if (t === '2') return w.squared;
    if (t === '3') return w.cubed;
    if (/^[◦°]$/.test(t)) return w.deg;
    if (/^[′']$/.test(t)) return w.prime;
    if (/^[∗*]$/.test(t)) return w.star;
    return `${w.power} ${conv(t)}${compound(t) ? `, ${w.endPower},` : ''}`;
  }

  function subscript(sub) {
    const t = sub.trim();
    if (t === '0') return w.nought;
    return t
      .split(/\s*,\s*/)
      .map((part) => (w.sub[part] ?? conv(part)))
      .join(' ');
  }

  function words(s) {
    // Units after a number (also after "× 10^…"), and units alone in brackets: "(m/s)".
    s = s.replace(new RegExp(`(\\d(?:[.,]\\d+)?|\\u0002)(\\s*)(${UNIT_EXPR})(?![\\w\\u{1D400}-\\u{1D7FF}])`, 'gu'), (m, n, sp, unit, off, all) => {
      const one = /(^|[^\d.,])1$/.test(all.slice(0, off + n.length));
      return `${n}${sp || ' '}${keep(unitWords(unit, one))}`;
    });
    s = s.replace(new RegExp(`\\((${UNIT_EXPR})\\)`, 'gu'), (m, unit) => keep(`(${lang === 'nl' ? 'in' : 'in'} ${unitWords(unit, false)})`));

    // Vectors: a combining arrow after the letter.
    s = s.replace(/(\S)⃗/gu, (_, c) => `${w.vector} ${c}`);

    // Functions and their arguments: sin(θ) → "sine of theta"
    s = s.replace(/\b(sin|cos|tan|ln|log|exp)\s*\(([^()]*)\)/g, (_, fn, arg) => keep(`${w.fn[fn]} ${w.of} ${conv(arg)},`));
    s = s.replace(/\b(sin|cos|tan|ln|log)\s+(?=\S)/g, (_, fn) => `${w.fn[fn]} `);

    // A symbol letter directly followed by a simple bracket is a function of it: y(x, t) → "y of x, t"
    s = s.replace(/([\u{1D434}-\u{1D467}ℎ])\(([^()+−\-=]*)\)/gu, (_, f, arg) => `${f} ${keep(`${w.of} ${conv(arg)}`)}`);

    // Brackets around a sum or difference: "the quantity …,"; other maths brackets are dropped.
    for (let k = 0; k < 4; k++)
      s = s.replace(/\(([^()]*)\)/g, (m, inner) => {
        if (!/[\u{1D434}-\u{1D467}ℎ\d=+−×·α-ωΑ-Ω∆\u0001]/u.test(inner)) return m; // prose bracket
        return compound(inner) ? ` ${keep(`${w.quantity} ${conv(inner)},`)} ` : ` ${conv(inner)} `;
      });

    // Absolute values |x|
    s = s.replace(/\|([^|]+)\|/g, (_, x) => ` ${w.abs} ${x} `);

    // Square roots: the next operand
    s = s.replace(/√\s*(\(?[^\s=+−·×]+)/g, (_, x) => ` ${w.sqrt} ${x} `);

    // Symbols: Greek and math-italic letters.
    let out = '';
    const chars = [...s];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const prev = out.trimEnd();
      if (c === '∆' || c === 'Δ') {
        out += ` ${w.delta} `;
      } else if (GREEK[c]) {
        const name = GREEK[c][L ? 1 : 0];
        out += c !== c.toLowerCase() ? ` ${w.capital} ${name} ` : ` ${name} `;
      } else if (ITALIC_RE.test(c)) {
        const letter = plainLetter(c);
        let said = letter;
        const afterNumber = /\d$/.test(prev);
        if (letter !== letter.toLowerCase() && ctx.symbols?.has(letter.toLowerCase())) said = `${w.capital} ${letter}`;
        else if ((afterNumber || letter === 'a') && LETTER_SOUNDS[lang]?.[letter]) said = LETTER_SOUNDS[lang][letter];
        out += ` ${said} `;
      } else if (c === 'ℏ') out += ` ${w.hbar} `;
      else out += c;
    }
    s = out;

    // Operators
    s = s
      .replace(/⇒|=⇒|⟹/g, ` ${w.so} `)
      .replace(/≈/g, ` ${w.approx} `)
      .replace(/≠/g, ` ${w.ne} `)
      .replace(/≥/g, ` ${w.ge} `)
      .replace(/≤/g, ` ${w.le} `)
      .replace(/∝/g, ` ${w.prop} `)
      .replace(/→/g, ` ${w.to} `)
      .replace(/=/g, ` ${ctx.prose && lang === 'nl' ? 'is' : w.eq} `)
      .replace(/±/g, ` ${w.pm} `)
      .replace(/∓/g, ` ${w.mp} `)
      .replace(/[·×∗]/g, ` ${w.times} `)
      .replace(/÷/g, ` ${w.div} `)
      .replace(/(^|[\s(])[−-](?=\s*[\d\u0001a-zA-Z])/g, `$1 ${w.minus} `) // signs
      .replace(/−/g, ` ${w.minus} `)
      .replace(/(\S)\s*\/\s*(\S)/g, `$1 ${w.over} $2`)
      .replace(/\+/g, ` ${w.plus} `)
      .replace(/<(?!\/)/g, ` ${w.lt} `)
      .replace(/>/g, ` ${w.gt} `)
      .replace(/∞/g, ` ${w.inf} `)
      .replace(/∫/g, ` ${w.int} `)
      .replace(/[∑Σ](?=\s)/g, ` ${w.sum} `)
      .replace(/∂/g, ` ${w.partial} `)
      .replace(/∇/g, ` ${w.nabla} `)
      .replace(/∥/g, ` ${w.parallel} `)
      .replace(/⊥/g, ` ${w.perp} `)
      .replace(/[◦°](?!C)/g, ` ${w.deg} `)
      .replace(/%/g, ` ${w.percent} `)
      .replace(/[•]/g, ' ')
      .replace(/\\frac/g, ' ');
    return s;
  }

  function unitWords(expr, one) {
    // split into atoms and separators
    const parts = expr.match(new RegExp(`${UNIT_ATOM}|/|·`, 'gu')) || [];
    const out = [];
    let afterPer = false;
    parts.forEach((p, k) => {
      if (p === '/') {
        out.push(w.per);
        afterPer = true;
        return;
      }
      if (p === '·') return;
      const m = new RegExp(`^(${UNIT_RE_SRC})(?:\\^\\{([^{}]*)\\}|([23]))?$`, 'u').exec(p);
      if (!m) return;
      const forms = UNITS[m[1]];
      const nextIsUnit = parts.slice(k + 1).some((x) => x !== '/' && x !== '·') && parts[k + 1] !== '/';
      // English: singular after exactly 1, after "per", and for all but the last unit of a product
      let word = L ? forms[2] : one || afterPer || nextIsUnit ? forms[1] : forms[0];
      const e = (m[2] ?? m[3] ?? '').trim();
      if (e === '2') word += ` ${w.squared}`;
      else if (e === '3') word += ` ${w.cubed}`;
      else if (e) word += ` ${w.power} ${conv(e)}`;
      out.push(word);
      afterPer = false;
    });
    return out.join(' ');
  }

  return conv(text)
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
