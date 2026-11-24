# meSpeak (built-in fallback voice)

Used by `js/tts-fallback.js` when the browser has no working text-to-speech voice
(for example Chrome on Linux without `--enable-speech-dispatcher`). Loaded only on demand.

- `mespeak.js` — meSpeak 2.0.2 from npm (`mespeak`), bundled for the browser with esbuild
  (`esbuild src/index.js --bundle --format=iife --global-name=meSpeak --minify`).
- `mespeak_config.json`, `en.json`, `nl.json` — config and the English and Dutch voices from the same package.

meSpeak is © 2011–2017 Norbert Landsteiner (masswerk.at), based on speak.js by Alon Zakai and on
eSpeak by Jonathan Duddington. It is licensed under the **GNU General Public License v3**:
https://www.gnu.org/licenses/gpl-3.0.html — source: https://github.com/mikolalysenko/mespeak
