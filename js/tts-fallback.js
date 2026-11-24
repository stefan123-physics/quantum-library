// Built-in speech for browsers without a working text-to-speech voice (e.g. Chrome on Linux).
// meSpeak (eSpeak compiled to JavaScript, GPL) lives in vendor/mespeak and is only downloaded the
// first time it is needed (~320 KB compressed + one voice).
const BASE = new URL('../vendor/mespeak/', import.meta.url);
const VOICE_FILE = { en: 'en.json', nl: 'nl.json' };
const VOICE_ID = { en: 'en/en', nl: 'nl' };

let engine = null;
const voices = {};

function loadEngine() {
  engine ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('mespeak.js', BASE).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load the built-in voice'));
    document.head.appendChild(s);
  }).then(async () => {
    const cfg = await (await fetch(new URL('mespeak_config.json', BASE))).json();
    window.meSpeak.loadConfig(cfg);
  });
  return engine;
}

export async function prepareFallback(lang) {
  const l = VOICE_FILE[lang] ? lang : 'en';
  await loadEngine();
  voices[l] ||= fetch(new URL(VOICE_FILE[l], BASE))
    .then((r) => r.json())
    .then((v) => new Promise((resolve) => window.meSpeak.loadVoice(v, () => resolve())));
  await voices[l];
  return l;
}

// Speak one piece of text; resolves true when finished (or stopped), or an error string.
export async function speakFallback(text, lang, rate = 1) {
  const l = await prepareFallback(lang);
  return new Promise((resolve) => {
    const id = window.meSpeak.speak(text, { voice: VOICE_ID[l], speed: Math.round(160 * rate), pitch: 45, wordgap: 1 }, (ok) =>
      resolve(ok ? true : 'built-in voice failed'),
    );
    if (!id) resolve('built-in voice failed');
  });
}

export function stopFallback() {
  try {
    window.meSpeak?.stop();
  } catch {
    /* nothing playing */
  }
}
