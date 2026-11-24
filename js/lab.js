// Formula Lab: a generic solver (leave one variable empty, it finds the root numerically),
// physical constants and a unit converter.

export const C = {
  c: 299792458, G: 6.6743e-11, h: 6.62607015e-34, hbar: 1.054571817e-34, e: 1.602176634e-19,
  me: 9.1093837015e-31, mp: 1.67262192369e-27, kB: 1.380649e-23, NA: 6.02214076e23, R: 8.314462618,
  eps0: 8.8541878128e-12, mu0: 1.25663706212e-6, ke: 8.9875517923e9, g: 9.81, sigma: 5.670374419e-8,
  u: 1.66053906660e-27, eV: 1.602176634e-19,
};

export const CONSTANTS = [
  ['c', { en: 'Speed of light', nl: 'Lichtsnelheid' }, C.c, 'm/s'],
  ['G', { en: 'Gravitational constant', nl: 'Gravitatieconstante' }, C.G, 'N·m²/kg²'],
  ['g', { en: 'Gravitational acceleration (Earth)', nl: 'Valversnelling (aarde)' }, C.g, 'm/s²'],
  ['h', { en: 'Planck constant', nl: 'Constante van Planck' }, C.h, 'J·s'],
  ['ħ', { en: 'Reduced Planck constant', nl: 'Gereduceerde constante van Planck' }, C.hbar, 'J·s'],
  ['e', { en: 'Elementary charge', nl: 'Elementaire lading' }, C.e, 'C'],
  ['mₑ', { en: 'Electron mass', nl: 'Massa elektron' }, C.me, 'kg'],
  ['mₚ', { en: 'Proton mass', nl: 'Massa proton' }, C.mp, 'kg'],
  ['u', { en: 'Atomic mass unit', nl: 'Atomaire massa-eenheid' }, C.u, 'kg'],
  ['k_B', { en: 'Boltzmann constant', nl: 'Constante van Boltzmann' }, C.kB, 'J/K'],
  ['N_A', { en: 'Avogadro constant', nl: 'Getal van Avogadro' }, C.NA, '1/mol'],
  ['R', { en: 'Gas constant', nl: 'Gasconstante' }, C.R, 'J/(mol·K)'],
  ['ε₀', { en: 'Vacuum permittivity', nl: 'Elektrische veldconstante' }, C.eps0, 'F/m'],
  ['μ₀', { en: 'Vacuum permeability', nl: 'Magnetische veldconstante' }, C.mu0, 'N/A²'],
  ['k', { en: 'Coulomb constant', nl: 'Constante van Coulomb' }, C.ke, 'N·m²/C²'],
  ['σ', { en: 'Stefan–Boltzmann constant', nl: 'Constante van Stefan-Boltzmann' }, C.sigma, 'W/(m²·K⁴)'],
  ['eV', { en: 'Electronvolt', nl: 'Elektronvolt' }, C.eV, 'J'],
];

const rad = (d) => (d * Math.PI) / 180;
const v = (sym, en, nl, unit, extra = {}) => ({ sym, label: { en, nl }, unit, ...extra });

// residual(vals) must be 0 when the equation holds. "q" is the search query for related PDF topics.
export const FORMULAS = [
  { id: 'momentum', domain: 'mechanics', name: { en: 'Momentum', nl: 'Impuls' }, tex: 'p = m · v', q: 'momentum',
    vars: [v('p', 'Momentum', 'Impuls', 'kg·m/s'), v('m', 'Mass', 'Massa', 'kg', { pos: true }), v('v', 'Velocity', 'Snelheid', 'm/s')],
    f: ({ p, m, v }) => p - m * v },
  { id: 'newton2', domain: 'mechanics', name: { en: "Newton's second law", nl: 'Tweede wet van Newton' }, tex: 'F = m · a', q: "newton's second law",
    vars: [v('F', 'Force', 'Kracht', 'N'), v('m', 'Mass', 'Massa', 'kg', { pos: true }), v('a', 'Acceleration', 'Versnelling', 'm/s²')],
    f: ({ F, m, a }) => F - m * a },
  { id: 'kinetic', domain: 'mechanics', name: { en: 'Kinetic energy', nl: 'Kinetische energie' }, tex: 'Eₖ = ½ · m · v²', q: 'kinetic energy',
    vars: [v('Ek', 'Kinetic energy', 'Kinetische energie', 'J', { pos: true }), v('m', 'Mass', 'Massa', 'kg', { pos: true }), v('v', 'Speed', 'Snelheid', 'm/s', { pos: true })],
    f: ({ Ek, m, v }) => Ek - 0.5 * m * v * v },
  { id: 'potential', domain: 'mechanics', name: { en: 'Gravitational potential energy', nl: 'Zwaarte-energie' }, tex: 'Eₚ = m · g · h', q: 'potential energy',
    vars: [v('Ep', 'Potential energy', 'Potentiële energie', 'J'), v('m', 'Mass', 'Massa', 'kg', { pos: true }), v('g', 'Gravity', 'Valversnelling', 'm/s²', { def: 9.81 }), v('h', 'Height', 'Hoogte', 'm')],
    f: ({ Ep, m, g, h }) => Ep - m * g * h },
  { id: 'work', domain: 'mechanics', name: { en: 'Work', nl: 'Arbeid' }, tex: 'W = F · d · cos θ', q: 'work',
    vars: [v('W', 'Work', 'Arbeid', 'J'), v('F', 'Force', 'Kracht', 'N'), v('d', 'Distance', 'Afstand', 'm'), v('θ', 'Angle', 'Hoek', '°', { def: 0, angle: true })],
    f: ({ W, F, d, θ }) => W - F * d * Math.cos(rad(θ)) },
  { id: 'power', domain: 'mechanics', name: { en: 'Power', nl: 'Vermogen' }, tex: 'P = W / t', q: 'power',
    vars: [v('P', 'Power', 'Vermogen', 'W'), v('W', 'Work', 'Arbeid', 'J'), v('t', 'Time', 'Tijd', 's', { pos: true })],
    f: ({ P, W, t }) => P * t - W },
  { id: 'hooke', domain: 'mechanics', name: { en: "Hooke's law", nl: 'Wet van Hooke' }, tex: 'F = k · x', q: "hooke's law",
    vars: [v('F', 'Spring force', 'Veerkracht', 'N'), v('k', 'Spring constant', 'Veerconstante', 'N/m', { pos: true }), v('x', 'Extension', 'Uitrekking', 'm')],
    f: ({ F, k, x }) => F - k * x },
  { id: 'freefall', domain: 'mechanics', name: { en: 'Free fall', nl: 'Vrije val' }, tex: 'h = ½ · g · t²', q: 'free fall',
    vars: [v('h', 'Height', 'Hoogte', 'm', { pos: true }), v('g', 'Gravity', 'Valversnelling', 'm/s²', { def: 9.81 }), v('t', 'Time', 'Tijd', 's', { pos: true })],
    f: ({ h, g, t }) => h - 0.5 * g * t * t },
  { id: 'centripetal', domain: 'mechanics', name: { en: 'Centripetal acceleration', nl: 'Middelpuntzoekende versnelling' }, tex: 'a = v² / r', q: 'centripetal',
    vars: [v('a', 'Acceleration', 'Versnelling', 'm/s²', { pos: true }), v('v', 'Speed', 'Snelheid', 'm/s', { pos: true }), v('r', 'Radius', 'Straal', 'm', { pos: true })],
    f: ({ a, v, r }) => a * r - v * v },
  { id: 'torque', domain: 'rotation', name: { en: 'Torque', nl: 'Krachtmoment' }, tex: 'τ = r · F · sin θ', q: 'torque',
    vars: [v('τ', 'Torque', 'Moment', 'N·m'), v('r', 'Lever arm', 'Arm', 'm'), v('F', 'Force', 'Kracht', 'N'), v('θ', 'Angle', 'Hoek', '°', { def: 90, angle: true })],
    f: ({ τ, r, F, θ }) => τ - r * F * Math.sin(rad(θ)) },
  { id: 'gravitation', domain: 'gravity', name: { en: 'Universal gravitation', nl: 'Gravitatiewet' }, tex: 'F = G · m₁ · m₂ / r²', q: 'universal gravitation',
    vars: [v('F', 'Force', 'Kracht', 'N', { pos: true }), v('m1', 'Mass 1', 'Massa 1', 'kg', { pos: true }), v('m2', 'Mass 2', 'Massa 2', 'kg', { pos: true }), v('r', 'Distance', 'Afstand', 'm', { pos: true })],
    f: ({ F, m1, m2, r }) => F * r * r - C.G * m1 * m2 },
  { id: 'escape', domain: 'gravity', name: { en: 'Escape velocity', nl: 'Ontsnappingssnelheid' }, tex: 'v = √(2GM / r)', q: 'escape velocity',
    vars: [v('v', 'Escape velocity', 'Ontsnappingssnelheid', 'm/s', { pos: true }), v('M', 'Planet mass', 'Massa planeet', 'kg', { pos: true }), v('r', 'Radius', 'Straal', 'm', { pos: true })],
    f: ({ v, M, r }) => v * v * r - 2 * C.G * M },
  { id: 'pressure', domain: 'fluids', name: { en: 'Pressure', nl: 'Druk' }, tex: 'p = F / A', q: 'pascal',
    vars: [v('p', 'Pressure', 'Druk', 'Pa'), v('F', 'Force', 'Kracht', 'N'), v('A', 'Area', 'Oppervlakte', 'm²', { pos: true })],
    f: ({ p, F, A }) => p * A - F },
  { id: 'hydro', domain: 'fluids', name: { en: 'Hydrostatic pressure', nl: 'Hydrostatische druk' }, tex: 'p = ρ · g · h', q: 'fluid statics',
    vars: [v('p', 'Pressure', 'Druk', 'Pa'), v('ρ', 'Density', 'Dichtheid', 'kg/m³', { pos: true, def: 1000 }), v('g', 'Gravity', 'Valversnelling', 'm/s²', { def: 9.81 }), v('h', 'Depth', 'Diepte', 'm')],
    f: ({ p, ρ, g, h }) => p - ρ * g * h },
  { id: 'flow', domain: 'fluids', name: { en: 'Flow rate', nl: 'Debiet' }, tex: 'Q = A · v', q: 'flow rate',
    vars: [v('Q', 'Flow rate', 'Debiet', 'm³/s'), v('A', 'Area', 'Oppervlakte', 'm²', { pos: true }), v('v', 'Speed', 'Snelheid', 'm/s')],
    f: ({ Q, A, v }) => Q - A * v },
  { id: 'gas', domain: 'thermo', name: { en: 'Ideal gas law', nl: 'Algemene gaswet' }, tex: 'p · V = n · R · T', q: 'ideal gas law',
    vars: [v('p', 'Pressure', 'Druk', 'Pa', { pos: true }), v('V', 'Volume', 'Volume', 'm³', { pos: true }), v('n', 'Amount', 'Stofhoeveelheid', 'mol', { pos: true }), v('T', 'Temperature', 'Temperatuur', 'K', { pos: true })],
    f: ({ p, V, n, T }) => p * V - n * C.R * T },
  { id: 'heat', domain: 'thermo', name: { en: 'Heat', nl: 'Warmte' }, tex: 'Q = m · c · ΔT', q: 'heat transfer',
    vars: [v('Q', 'Heat', 'Warmte', 'J'), v('m', 'Mass', 'Massa', 'kg', { pos: true }), v('c', 'Specific heat', 'Soortelijke warmte', 'J/(kg·K)', { pos: true, def: 4186 }), v('ΔT', 'Temperature change', 'Temperatuurverandering', 'K')],
    f: ({ Q, m, c, ΔT }) => Q - m * c * ΔT },
  { id: 'carnot', domain: 'thermo', name: { en: 'Carnot efficiency', nl: 'Carnot-rendement' }, tex: 'η = 1 − T꜀ / Tₕ', q: 'carnot efficiency',
    vars: [v('η', 'Efficiency', 'Rendement', '–'), v('Tc', 'Cold reservoir', 'Koud reservoir', 'K', { pos: true }), v('Th', 'Hot reservoir', 'Warm reservoir', 'K', { pos: true })],
    f: ({ η, Tc, Th }) => (η - 1) * Th + Tc },
  { id: 'wave', domain: 'waves', name: { en: 'Wave speed', nl: 'Golfsnelheid' }, tex: 'v = f · λ', q: 'sinusoidal wave',
    vars: [v('v', 'Wave speed', 'Golfsnelheid', 'm/s', { pos: true }), v('f', 'Frequency', 'Frequentie', 'Hz', { pos: true }), v('λ', 'Wavelength', 'Golflengte', 'm', { pos: true })],
    f: ({ v, f, λ }) => v - f * λ },
  { id: 'coulomb', domain: 'electricity', name: { en: "Coulomb's law", nl: 'Wet van Coulomb' }, tex: 'F = k · q₁ · q₂ / r²', q: "coulomb's law",
    vars: [v('F', 'Force', 'Kracht', 'N'), v('q1', 'Charge 1', 'Lading 1', 'C'), v('q2', 'Charge 2', 'Lading 2', 'C'), v('r', 'Distance', 'Afstand', 'm', { pos: true })],
    f: ({ F, q1, q2, r }) => F * r * r - C.ke * q1 * q2 },
  { id: 'ohm', domain: 'electricity', name: { en: "Ohm's law", nl: 'Wet van Ohm' }, tex: 'U = I · R', q: "ohm's law",
    vars: [v('U', 'Voltage', 'Spanning', 'V'), v('I', 'Current', 'Stroom', 'A'), v('R', 'Resistance', 'Weerstand', 'Ω', { pos: true })],
    f: ({ U, I, R }) => U - I * R },
  { id: 'epower', domain: 'electricity', name: { en: 'Electric power', nl: 'Elektrisch vermogen' }, tex: 'P = U · I', q: 'electric power',
    vars: [v('P', 'Power', 'Vermogen', 'W'), v('U', 'Voltage', 'Spanning', 'V'), v('I', 'Current', 'Stroom', 'A')],
    f: ({ P, U, I }) => P - U * I },
  { id: 'capacitor', domain: 'electricity', name: { en: 'Capacitor charge', nl: 'Lading condensator' }, tex: 'Q = C · U', q: 'capacitors',
    vars: [v('Q', 'Charge', 'Lading', 'C'), v('Cap', 'Capacitance', 'Capaciteit', 'F', { pos: true }), v('U', 'Voltage', 'Spanning', 'V')],
    f: ({ Q, Cap, U }) => Q - Cap * U },
  { id: 'lorentz', domain: 'magnetism', name: { en: 'Magnetic force on a charge', nl: 'Lorentzkracht' }, tex: 'F = q · v · B · sin θ', q: 'magnetic force on a moving charge',
    vars: [v('F', 'Force', 'Kracht', 'N'), v('q', 'Charge', 'Lading', 'C'), v('v', 'Speed', 'Snelheid', 'm/s'), v('B', 'Magnetic field', 'Magnetisch veld', 'T'), v('θ', 'Angle', 'Hoek', '°', { def: 90, angle: true })],
    f: ({ F, q, v, B, θ }) => F - q * v * B * Math.sin(rad(θ)) },
  { id: 'emf', domain: 'magnetism', name: { en: 'Motional EMF', nl: 'Bewegingsinductie' }, tex: 'ε = B · L · v', q: 'motional emf',
    vars: [v('ε', 'EMF', 'EMK', 'V'), v('B', 'Magnetic field', 'Magnetisch veld', 'T'), v('L', 'Rod length', 'Staaflengte', 'm'), v('v', 'Speed', 'Snelheid', 'm/s')],
    f: ({ ε, B, L, v }) => ε - B * L * v },
  { id: 'snell', domain: 'optics', name: { en: "Snell's law", nl: 'Wet van Snellius' }, tex: 'n₁ · sin θ₁ = n₂ · sin θ₂', q: 'refraction snell',
    vars: [v('n1', 'Index 1', 'Brekingsindex 1', '–', { pos: true, def: 1 }), v('θ1', 'Angle 1', 'Hoek 1', '°', { angle: true }), v('n2', 'Index 2', 'Brekingsindex 2', '–', { pos: true, def: 1.5 }), v('θ2', 'Angle 2', 'Hoek 2', '°', { angle: true })],
    f: ({ n1, θ1, n2, θ2 }) => n1 * Math.sin(rad(θ1)) - n2 * Math.sin(rad(θ2)) },
  { id: 'lens', domain: 'optics', name: { en: 'Thin lens equation', nl: 'Lenzenformule' }, tex: '1/f = 1/do + 1/di', q: 'lens equation',
    vars: [v('f', 'Focal length', 'Brandpuntsafstand', 'm'), v('do', 'Object distance', 'Voorwerpsafstand', 'm', { pos: true }), v('di', 'Image distance', 'Beeldafstand', 'm')],
    f: ({ f, do: o, di }) => 1 / f - 1 / o - 1 / di },
  { id: 'dilation', domain: 'relativity', name: { en: 'Time dilation', nl: 'Tijdsdilatatie' }, tex: 'Δt = Δt₀ / √(1 − v²/c²)', q: 'time dilation',
    vars: [v('Δt', 'Dilated time', 'Verstreken tijd', 's', { pos: true }), v('Δt0', 'Proper time', 'Eigentijd', 's', { pos: true }), v('v', 'Speed', 'Snelheid', 'm/s', { pos: true, max: C.c })],
    f: ({ Δt, Δt0, v }) => Δt * Math.sqrt(1 - (v * v) / (C.c * C.c)) - Δt0 },
  { id: 'emc2', domain: 'relativity', name: { en: 'Mass–energy equivalence', nl: 'Massa-energie-equivalentie' }, tex: 'E = m · c²', q: 'equivalence of mass and energy',
    vars: [v('E', 'Energy', 'Energie', 'J'), v('m', 'Mass', 'Massa', 'kg')],
    f: ({ E, m }) => E - m * C.c * C.c },
  { id: 'photon', domain: 'quantum', name: { en: 'Photon energy', nl: 'Fotonenergie' }, tex: 'E = h · f = h · c / λ', q: 'photoelectric effect',
    vars: [v('E', 'Energy', 'Energie', 'J', { pos: true }), v('f', 'Frequency', 'Frequentie', 'Hz', { pos: true })],
    f: ({ E, f }) => E - C.h * f },
  { id: 'debroglie', domain: 'quantum', name: { en: 'De Broglie wavelength', nl: 'De Broglie-golflengte' }, tex: 'λ = h / (m · v)', q: 'particle-wave duality',
    vars: [v('λ', 'Wavelength', 'Golflengte', 'm', { pos: true }), v('m', 'Mass', 'Massa', 'kg', { pos: true }), v('v', 'Speed', 'Snelheid', 'm/s', { pos: true })],
    f: ({ λ, m, v }) => λ * m * v - C.h },
  { id: 'bohr', domain: 'quantum', name: { en: 'Hydrogen energy levels', nl: 'Energieniveaus waterstof' }, tex: 'Eₙ = −13.6 eV / n²', q: 'bohr model',
    vars: [v('E', 'Energy', 'Energie', 'eV'), v('n', 'Level', 'Niveau', '–', { pos: true })],
    f: ({ E, n }) => E * n * n + 13.6 },
  { id: 'decay', domain: 'nuclear', name: { en: 'Radioactive decay', nl: 'Radioactief verval' }, tex: 'N = N₀ · (½)^(t / T½)', q: 'radioactive decay rates',
    vars: [v('N', 'Remaining', 'Over', '–', { pos: true }), v('N0', 'Initial', 'Begin', '–', { pos: true }), v('t', 'Time', 'Tijd', 's', { pos: true }), v('T', 'Half-life', 'Halveringstijd', 's', { pos: true })],
    f: ({ N, N0, t, T }) => Math.log(N) - Math.log(N0) - (t / T) * Math.log(0.5) },
];

// Find x with residual(x) = 0. Scans a log grid for a sign change, then bisects.
export function solve(formula, known, target) {
  const meta = formula.vars.find((x) => x.sym === target);
  const r = (x) => formula.f({ ...known, [target]: x });
  const grid = [];
  if (meta.angle) for (let d = 0; d <= 180; d += 0.5) grid.push(d);
  else {
    const pos = [];
    for (let k = -45; k <= 45; k += 0.25) pos.push(10 ** k);
    // Upper-bounded variables (e.g. v < c) get extra samples approaching the bound.
    if (meta.max) {
      for (let k = 1; k <= 15; k += 0.5) pos.push(meta.max * (1 - 10 ** -k));
      pos.sort((a, b) => a - b);
    }
    grid.push(...pos);
    if (!meta.pos) grid.push(0, ...pos.map((x) => -x));
  }
  const max = meta.max ?? Infinity;
  const candidates = [];
  // positive branch and negative branch are scanned separately (grid is ordered within each)
  const zero = grid.indexOf(0);
  const branches = meta.angle || meta.pos ? [grid] : [grid.slice(0, zero), grid.slice(zero + 1)];
  for (const br of branches) {
    let prevX = null, prevY = null;
    for (const x of br) {
      if (x >= max) break;
      const y = r(x);
      if (!Number.isFinite(y)) ((prevX = null), (prevY = null));
      else {
        if (y === 0) candidates.push(x);
        else if (prevY !== null && Math.sign(y) !== Math.sign(prevY)) candidates.push(bisect(r, prevX, x));
        prevX = x;
        prevY = y;
      }
    }
  }
  const good = candidates.filter((x) => x !== null && Number.isFinite(x));
  if (!good.length) return null;
  // Prefer a positive root (physical magnitude) and, for angles, the acute one.
  good.sort((a, b) => (a < 0) - (b < 0) || (meta.angle ? a - b : 0));
  return good[0];
}

function bisect(r, a, b) {
  let fa = r(a);
  for (let i = 0; i < 200; i++) {
    const m = a > 0 && b > 0 ? Math.sqrt(a * b) : a < 0 && b < 0 ? -Math.sqrt(a * b) : (a + b) / 2;
    const fm = r(m);
    if (!Number.isFinite(fm)) return null;
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(fa)) ((a = m), (fa = fm));
    else b = m;
    if (Math.abs(b - a) <= Math.abs(m) * 1e-14) break;
  }
  return (a + b) / 2;
}

// Pretty number: scientific for very small / large magnitudes.
export function fmt(x, digits = 5) {
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e6) return String(+x.toPrecision(digits));
  const [m, e] = x.toExponential(digits - 1).split('e');
  return `${+m} × 10${toSup(e)}`;
}
const SUP = { '-': '⁻', '+': '', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const toSup = (s) => [...s].map((c) => SUP[c] ?? c).join('');

// Parse "6.67e-11", "6,67·10^-11", "3 × 10^8", "1/2"…
export function parseNum(s) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/\s+/g, '').replace(/,/g, '.');
  if (!t) return NaN;
  t = t.replace(/[×x·*]10\^?([−-]?\d+)/i, 'e$1').replace(/−/g, '-');
  if (/^[-+]?[\d.]+\/[\d.]+$/.test(t)) {
    const [a, b] = t.split('/');
    return +a / +b;
  }
  return Number(t);
}

export const UNITS = {
  length: { en: 'Length', nl: 'Lengte', units: { m: 1, km: 1e3, cm: 1e-2, mm: 1e-3, 'μm': 1e-6, nm: 1e-9, 'Å': 1e-10, in: 0.0254, ft: 0.3048, mi: 1609.344, AU: 1.495978707e11, ly: 9.4607e15, pc: 3.0857e16 } },
  mass: { en: 'Mass', nl: 'Massa', units: { kg: 1, g: 1e-3, mg: 1e-6, t: 1e3, lb: 0.45359237, u: C.u, 'MeV/c²': 1.78266192e-30 } },
  time: { en: 'Time', nl: 'Tijd', units: { s: 1, ms: 1e-3, 'μs': 1e-6, ns: 1e-9, min: 60, h: 3600, d: 86400, yr: 3.15576e7 } },
  speed: { en: 'Speed', nl: 'Snelheid', units: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 0.514444, c: C.c } },
  energy: { en: 'Energy', nl: 'Energie', units: { J: 1, kJ: 1e3, eV: C.eV, keV: C.eV * 1e3, MeV: C.eV * 1e6, cal: 4.184, kcal: 4184, kWh: 3.6e6 } },
  pressure: { en: 'Pressure', nl: 'Druk', units: { Pa: 1, kPa: 1e3, bar: 1e5, atm: 101325, mmHg: 133.322, psi: 6894.76 } },
  angle: { en: 'Angle', nl: 'Hoek', units: { '°': Math.PI / 180, rad: 1, rev: 2 * Math.PI } },
  temperature: { en: 'Temperature', nl: 'Temperatuur', units: { K: 'K', '°C': 'C', '°F': 'F' } },
};

export function convert(cat, value, from, to) {
  const u = UNITS[cat].units;
  if (cat === 'temperature') {
    const toK = { K: (x) => x, C: (x) => x + 273.15, F: (x) => ((x - 32) * 5) / 9 + 273.15 };
    const fromK = { K: (x) => x, C: (x) => x - 273.15, F: (x) => ((x - 273.15) * 9) / 5 + 32 };
    return fromK[u[to]](toK[u[from]](value));
  }
  return (value * u[from]) / u[to];
}
