// Voice choice for the Web Speech API (after open-cosmology lib/voices.ts).
// Every platform ships different voices; iPhone/iPad/Mac also ship novelty voices (Bells, Bubbles,
// Zarvox, Grandma, Eddy, Flo…) in every language. Those are never offered or picked.

const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|kathy|organ|pipe organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

export const isNovelty = (v) => NOVELTY.test(v.name);

/** Higher is better: natural/neural/premium first, the exact region, then offline voices. */
function quality(v, lang) {
  const n = v.name.toLowerCase();
  const l = v.lang.toLowerCase().replace('_', '-');
  let q = 0;
  if (/natural|neural|premium|enhanced|siri|online/.test(n)) q += 40;
  if (/google/.test(n)) q += 15;
  if (/microsoft/.test(n)) q += 8;
  if (lang === 'en' && (l === 'en-gb' || l === 'en-us')) q += 12;
  if (lang === 'nl' && l === 'nl-nl') q += 12;
  if (v.default) q += 5;
  if (v.localService) q += 3;
  if (/compact|espeak|mbrola/.test(n)) q -= 15;
  return q;
}

/** Good voices for a language, best first, without novelty voices or duplicates (iOS lists some twice). */
export function languageVoices(voices, lang) {
  const seen = new Set();
  return voices
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang) && !isNovelty(v))
    .sort((a, b) => quality(b, lang) - quality(a, lang))
    .filter((v) => {
      const key = v.name.replace(/\s*\(.*\)\s*$/, '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Wait until the browser has loaded its voices (Chrome and Android load them later; Safari may not fire voiceschanged). */
export function loadVoices(timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve([]);
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', finish, { once: true });
    const poll = setInterval(() => synth.getVoices().length && finish(), 150);
    setTimeout(finish, timeoutMs);
  });
}

/** A short label: "Samantha · English (US)" without the engine's clutter. */
export function voiceLabel(v) {
  const name = v.name.replace(/^(Microsoft|Google)\s+/i, '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+-\s+.*$/, '');
  return `${name} · ${v.lang.replace('_', '-')}`;
}

// iOS only speaks when the first speak() happens inside the tap itself: call this synchronously in the handler.
export function unlockSpeech() {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}
