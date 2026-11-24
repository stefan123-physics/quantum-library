# Quantum Library

A bilingual (English / Nederlands) reader for the physics-formula PDFs in this folder, with a
physics-styled look, dark/light mode and a set of study tools. Pure static site: no framework,
no backend. pdf.js is self-hosted in `vendor/`.

## Run it

```bash
npm install          # once: installs pdf.js for the index builder
npm start            # builds data/library.json and serves on http://localhost:8080
npm run build        # rebuild the index and all icons / share image
```

Any static web server works (`python3 -m http.server`, `npx serve`, GitHub Pages, Netlify…).
Opening `index.html` straight from disk (`file://`) does not work: browsers block loading PDFs that way.

## Icons, home screen and link previews

`npm run build:icons` renders everything with headless Chrome from three sources:

| Source | Produces |
| --- | --- |
| `brand/icon.svg` | `icons/icon-192/512.png` (rounded), `icons/maskable-*.png` (Android adaptive), `icons/apple-touch-icon.png` (iPhone/iPad) |
| `favicon.svg` | `icons/favicon-32/48.png`, `favicon.ico` — the SVG itself is the tab icon and follows the browser's light/dark UI |
| `brand/og.html` | `og-image.png` (1200×630 link preview with the real PDF pages and live stats) |

While you read, the tab icon turns into a progress ring showing how far you are in the book.

Most sites that show link previews (Facebook, LinkedIn, X) need absolute image URLs. Once you know
the address the site will live at, run:

```bash
SITE_URL=https://your-domain.example npm run build:icons
```

The site is an installable app (`manifest.webmanifest` + `sw.js`): "Install app" button on
desktop/Android, "Add to Home Screen" on iPhone. Home-screen shortcuts: Continue reading, Search,
Formula Lab, Topics. Once opened, the app and the PDFs keep working offline.

## Adding or replacing PDFs

Drop PDFs in this folder and run `npm run build:index`. The builder:

- extracts the text of every page (for search and read-aloud),
- detects headings from font size/position to build the table of contents,
- rebuilds formula structure from glyph positions and fonts (fractions, powers, subscripts, symbols)
  into `data/speech/<doc>.json`, used by read-aloud and the reading view (`tools/speech-segments.mjs`),
- guesses the language from the file name (`english-…`, `nederlands-…`, `-en`, `-nl`) and pairs
  editions with the same base name, aligning their topics so you can jump between languages,
- tags each topic with a physics field (mechanics, optics, quantum…).

## Features

- **EN / NL interface** — toggle in the header or press `L`. While reading, the toggle also
  jumps to the same place in the other edition.
- **Dark / light mode** — follows the system until you pick one (`T`). Pages are shown inverted
  in dark mode (toggle "Dark pages").
- **Reader** — lazy-rendered pages with selectable text, zoom (buttons, `+`/`-`, Ctrl+wheel),
  fit width/page, thumbnails, auto-generated contents grouped by field, current-topic bar with
  previous/next topic (`[` `]`), reading-progress bar, focus mode (`F`), read aloud (`R`),
  print, download, copy link to the exact page.
- **Read aloud** — the big *Read aloud* button (or `R`) reads from where you are, sentence by
  sentence, page after page, highlighting each sentence on the PDF and showing it as a caption.
  Formulas are spoken properly in English and Dutch ("delta v equals delta p over m",
  "g is gelijk aan 9,81 meter per seconde kwadraat"). Pause/resume, previous/next sentence,
  speed, and a clean voice list (novelty voices such as Bubbles or Zarvox are never offered).
  Uses the device's voice; without one, a built-in English/Dutch voice (meSpeak, GPL-3.0,
  `vendor/mespeak/`, downloaded only when needed).
- **Reading view** (*Aa*) — the PDF's text reflowed in large type with fractions and powers laid
  out, ideal on phones; tap any sentence or formula to hear it from there.
- **Side-by-side EN | NL** (`S`) with synchronised scrolling.
- **Search everything** (Ctrl/⌘ K or `/`) — topics and full page text of both editions,
  with Dutch↔English synonyms (searching "wrijving" finds "friction"), fuzzy matching, snippets
  and highlighted matches inside the PDF.
- **Topics** page — filter by field or text; shows which topics you have already visited.
- **Bookmarks & notes** (`B`, `N`) — stored in the browser, exportable/importable as JSON.
- **Formula Lab** — 33 formulas: fill in the known values, leave one empty and it is solved
  numerically; links to the matching section of the PDF. Plus physical constants (click to copy)
  and a unit converter.
- Remembers where you stopped in each document, topic of the day, random exercise.
- **Responsive** from 320 px phones to 4K: bottom nav and bottom-sheet menus on phones, full-screen
  reader with pinch-to-zoom, stacked EN/NL split on portrait tablets, landscape mode without
  chrome, notch/home-indicator safe areas, larger touch targets, reduced-motion support.

## Layout

```
index.html           page shell
css/app.css          theme (dark "deep space" / light "lab paper")
js/app.js            router, views, reader, search palette, shortcuts
js/pdf.js            pdf.js pane: lazy rendering, zoom, text layer, highlights
js/search.js         search with EN/NL synonym expansion
js/lab.js            formula solver, constants, unit conversion
js/i18n.js           all interface strings in English and Dutch
js/store.js          localStorage persistence
js/bg.js             animated particle-field background
js/read-aloud.js     read-aloud engine: units, playback, voices, reading-view markup
js/math-speech.js    formulas → spoken English/Dutch (ideas from open-cosmology's lib/speech.ts)
js/voices.js         voice ranking/filtering, iOS speech unlock
js/tts-fallback.js   built-in meSpeak voice for devices without one
tools/build-index.mjs  builds data/library.json and copies pdf.js into vendor/
```
