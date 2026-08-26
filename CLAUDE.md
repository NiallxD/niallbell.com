# Claude Code — Project Context

## The Site

**niallbell.com** — a personal site built with **Eleventy v3** (static site generator), no bundler, deployed to GitHub Pages. Source is this Obsidian vault; `.md` files are the content, Nunjucks templates handle layout.

- `templates/` — Nunjucks layouts (base.njk, gallery.njk, blog.njk, etc.)
- `static/` — CSS, JS, images served as-is
- `1.0 - Main Pages/` — top-level page content
- `2.0 - Writing/` — blog posts
- `3.1.x - Photography/` — gallery collections
- `_site/` — build output (gitignored)

**No bundler.** All JS either lives inline in templates or in `static/js/` as plain files. CDN scripts (React, Babel, Swiper, Leaflet) are loaded via `<script>` tags. Do not introduce a build step.

**Dev server:** `npx @11ty/eleventy --serve` — live at `localhost:8080`.

---

## Active Project: ADHD Mind Simulator (`/adhd/`)

### What It Is
A physics-driven, empathy-through-mechanics web game at `/adhd/`. The player works a
simulated ADHD morning against a **fixed 07:00–09:00 clock** (~4 real minutes), then gets a
**debrief** that explains what happened to them and why. The goal is understanding, not
gamification — and the debrief is the payload, not the session.

### Files
| File | Purpose |
|---|---|
| `templates/adhd.njk` | Standalone full-screen page (no nav, no base.njk). Loads VT323, React 18, ReactDOM 18, Babel Standalone via CDN. Inline terminal CSS. |
| `static/js/adhd-game.js` | The entire game (~3000 lines JSX). Loaded via `<script type="text/babel" data-presets="react">`. |
| `1.0 - Main Pages/9.8 - ADHD Game.md` | Eleventy content file — `permalink: /adhd/`, `layout: adhd.njk`, `noindex: true` |

### ⚠️ CDN versions are pinned — do not un-pin
`@babel/standalone` is pinned to **7.29.8**. Babel 8 changed `preset-react` to default to the
*automatic* JSX runtime, which emits `import { jsx } from "react/jsx-runtime"` — an ES module
import that cannot resolve in a plain `text/babel` script tag with no bundler. Un-pinning
(`@babel/standalone` with no version) silently serves 8.x and the page dies on the loading
screen with no visible error. React/ReactDOM are pinned to 18.3.1 for the same class of reason.

*Longer-term option:* pre-compile the JSX with Babel and commit the output, dropping the
~1.5MB Babel payload and the in-browser compile entirely.

### Phases
`intro` → (`config`) → `playing` → `debrief`

- **intro** — cold open, typed terminal text, no stat block. `[ PARAMETERS ]` is an opt-in side door.
- **config** — the six sliders, each captioned with the mechanic it drives. Reached from the intro or the debrief, never forced up front.
- **playing** — the session, ending at 09:00 or via `[ LEAVE NOW ]`.
- **debrief** — the ledger, the event log, and `DEBRIEF_NOTES` (see below).

### Technical Stack
- **React 18 UMD + ReactDOM 18 UMD** via unpkg (global `window.React` / `window.ReactDOM`)
- **Babel Standalone 7** — enables JSX in an external file without a bundler
- **HTML5 Canvas 2D** for the physics activity map
- **Web Audio API** for oscillator-based sound effects (no audio files)
- **VT323** Google Font; phosphor green `#39ff14`; CRT scanline aesthetic
- Pointer Events throughout (mouse + touch on one path); `REDUCED_MOTION` honours `prefers-reduced-motion`

### Architecture (`adhd-game.js`)
```
§1  CONSTANTS & GAME DATA    — palette, PHYSICS, SESSION, morningTasks[], HYPERFOCUS_NAGGING[], BODY_TASKS{}
§2  PHYSICS UTILITIES        — uiScaleFor(), computeBoxSize(), applyUiScale(), holdRequiredMs(),
                               snapTaskIntoBox(), physicsUpdate()
§3  CANVAS RENDER            — renderCanvas() — bg → connection lines → intrusive → tasks → focus box → nagging text
§4  WEB AUDIO ENGINE         — initAudio(), playSnap(), playError(), playDriveSpike(), playEject()
§5  REACT COMPONENTS         — IntroScreen, ConfigScreen, GameLayout, LeftPanel, ActivityMap,
                               RightPanel, overlays, buildLedger()/DEBRIEF_NOTES/Debrief
§6  APP ROOT                 — App component + ReactDOM.createRoot mount
```

**State separation:** physics state lives in `physicsRef` (mutated in the rAF loop, no re-renders);
React `useState` syncs every 200ms from that loop. `driveRef`, `metersRef`, `profileRef` mirror
React state for rAF reads.

**Canvas init (`pendingInitRef`):** `handleBegin` sets `pendingInitRef.current = profile` and
`physicsRef.current = null`. The `ResizeObserver` in `ActivityMap` calls `initPhysics(...)` on its
first fire once the canvas has real dimensions, avoiding the 0×0 canvas problem.

**Responsive:** `uiScaleFor(w,h)` (1.0 desktop → 0.42 phone) scales the focus box, every node and
every canvas font; the box is additionally clamped to 82%/78% of the canvas. `useIsNarrow(860)`
swaps the 3-column terminal for a stacked phone layout (meters strip → canvas → list drawer).

### Core Mechanics
- **Hold-to-snap (initiation cost):** drag a task to the focus box and hold. `holdRequiredMs()` maps
  `initiationCost` through a `^2.2` curve to 420–2600ms — the exponent matters, because most chores
  sit at 0.85–0.98 and a linear map made them all feel like the same flat wait. Waiting mode ×1.7.
- **The hold is unstable, not a wait.** It runs in `physicsUpdate` (not the pointer handler) so it
  advances every frame and the node *squirms* while held. Slip is measured against a **smoothed,
  box-relative anchor** (~130ms time constant): box-relative so tracking the drifting box is free,
  smoothed because a fixed anchor planted at the boundary leaves anyone still moving inward
  permanently slipping and unable to start anything at all.
- **In-box drift:** tasks inside the box drift outward; you must keep re-dragging them back.
- **Intrusive thoughts:** spawn from edges, attract toward the box. Drag-and-flick to eject.
  Suppressed during hyperfocus.
- **Body meters:** BLADDER/HUNGER/THIRST/FATIGUE drain at per-session randomised rates whose ranges
  straddle the rate that would just reach critical by 09:00 — so which systems bite varies each run.
  35% → intrusive thought; 12% → body task node that locks the box.
- **Drive bar:** rises on completion, falls when idle. Affects box size, drift, spawn rate.
- **`persistent: true`** on the scripted chain (`meet_volunteer`, `email_volunteer`, `hang_keys`,
  `tell_partner_keys`, `take_meds`) — these bounce off the forget zone instead of being forgotten.
  Without it the authored content drifts off-screen and the whole point of the piece is deleted.

### Hyperfocus
Triggered probabilistically when a `canHyperfocus` task snaps in. Box turns purple, panels fade to
12%, other tasks ejected, intrusive thoughts drift away, 4 nagging thoughts appear as ghostly amber
text; on completion they spawn as urgent task nodes.

**Guard:** nothing else can snap in while hyperfocus holds, exclusive-task ejection spares the
hyperfocus node, and a safety valve in `physicsUpdate` releases hyperfocus if its node ever stops
being a live in-box task. Without these, an exclusive task snapping in ejects the hyperfocus node
and strands `hyperfocus === true` forever — no `hyperfocus_end`, distraction spawning suppressed
for the rest of the session.

### Waiting Mode (anticipation paralysis)
From **08:00** there is an appointment at **08:30**. `phys.waitingMode` multiplies every non-body
task's initiation hold by 1.7 and shows a banner. An hour with a thing in it is not a usable hour.

### The Debrief
- `buildLedger(phys, extra)` harvests per-task rows plus session totals from physics state.
- **`abandonedReaches`** — released mid-hold with >5% progress. The most honest number the piece has:
  reached for it, didn't start it, and from the outside nothing happened.
- `DEBRIEF_NOTES[]` — each note has a `test(L)` and only renders if that thing actually happened to
  *this* player, in *this* session. Nothing is generic. Add new notes here rather than writing prose
  into the component.

### Scripted Failure Events
**Event 1 — Volunteer conversation (`meet_volunteer`):** word-by-word NPC dialogue, key details
amber. If the task leaves the box the words become `[...]`. On complete the email subtask unlocks;
snapping it shows `NameSelectOverlay` with 5 names, **all wrong by design** — the name was never
encoded, so there is no right option to offer.

**Event 2 — Keys (`hang_keys`):** at 85% progress a forced intrusive thought spawns and
`keysActualLocation` is set to `null`. The task still reads `✓ COMPLETE`. `tell_partner_keys` then
shows `LocationSelectOverlay` (4 options, all wrong) → `LocationSearchGrid` (12 cells, timed wrong
guesses, partner mood drain).

---

## Markdown Footnotes

Obsidian-style footnotes (`text[^1]` … `[^1]: note`) render via **markdown-it-footnote**, wired up
in `eleventy.config.js` alongside the wikilink plugin. Both are safe together — the wikilink core
ruler walks inline tokens, and footnote bodies are inline tokens too, so `[[links]]` work inside
notes.

Two renderer overrides in the config:
- **`footnote_block_open/close`** — emits `<h2 class="footnotes-title">Notes</h2>` inside an
  `aria-labelledby` section instead of the default bare `<hr>` + list, so the block is labelled.
- **`footnote_caption`** — a footnote cited twice defaults to `[4:1]` for the second use, which
  reads as a typo. Overridden to show the plain number; anchor ids stay unique (`fnref4`,
  `fnref4:1`) so both citations still link back correctly.

Styles live in `static/css/style.css` under `/* ── Footnotes ── */`, themed off the existing
CSS vars. `scroll-margin-top` accounts for the fixed `.site-header` (`--nav-height`), and
`.footnote-item:target` highlights whichever note you jumped to.

`markdown-it` is now an explicit dependency (it was only present transitively via Eleventy, even
though the config imports it directly). It dedupes to Eleventy's copy, so there's still one instance.

---

## Ongoing: Gallery Captions

Adding titles and captions to photography gallery `.md` files. Format:
```markdown
## Title Here
~45-word factual caption about the subject. No first-person. No personal anecdotes.
/static/images/filename.webp
```

**Viewing images:** `i.imgur.com` URLs can't be fetched directly. Download with `curl -s <url> -o /tmp/img.jpg` then use the Read tool to view.

**Status:**
- ✅ British Birds, Bengal Tiger, Astrophotography, Brown Bear, The Zoo, Canadian Wildlife, Fungi, UK Deer, Red Squirrel, Grey Seal
- ⏳ Photomicrography (13), Film Photography (17), Street Photography (8), Drone Photography (5), Environments (17), Macro Photography (14), Canadian Landscapes (13)
- Skip: Architecture (HTML/iframe), 360 Panoramas (HTML/iframe)

---

## Ongoing: Inline Script Externalisation

Moving inline `<script>` blocks from Nunjucks templates into `static/js/` files to allow removal of `'unsafe-inline'` from the CSP `script-src` directive.

**Pattern:** scripts that reference Nunjucks template variables (e.g. `{{ slides | dump | safe }}`) must bridge data via `data-*` attributes or a minimal inline data-only `<script>` tag first.

**Remaining work (largest first):**
- `gallery-room.js` — from `gallery.njk` (~1,492 lines, audio/animations/scroll nav)
- `constellation.js` — from `constellation.njk` (~416 lines)
- `writing-graph.js` — from `blog.njk` (~369 lines)
- `modals.js`, `analytics.js`, `interactive-elements.js`, `gallery-filter.js`, `gallery-swiper.js`, `map.js`, `stats.js`

The theme detection script (6 lines, runs before DOM load) may need to stay inline to avoid flash of wrong theme.

---

## 360 Panoramas — self-hosted viewer

The panoramas at `/360-panorama/` embed **`/pano/?img=/static/images/X.webp`**, a viewer page on
this site (`templates/pano.njk` + `static/js/panorama.js`) that loads pannellum from jsDelivr.

They previously embedded `cdn.pannellum.org/2.5/pannellum.htm#panorama=/static/images/X.webp`,
which was broken two ways: CSP had no `frame-src` entry for pannellum.org, and — more
fundamentally — that viewer runs on pannellum's origin, so a *relative* panorama path resolved to
`cdn.pannellum.org/static/images/…` and 404'd. Serving the viewer ourselves keeps the paths
relative and correct, works in local dev, and keeps a third-party host out of `frame-src`
(same-origin `'self'` covers it).

**Why an iframe and not a div:** the gallery pipeline extracts `<iframe src="…">` out of markdown
(`eleventy.config.js`, the `iframeRegex` around line 510) and turns each into a swiper slide of
`type: "iframe"`. Plain elements are never picked up as slides — they'd land in the hidden content
fallback and render nothing. Keep panoramas as iframes.

**Previews are generated at build time.** The `pano-preview` hook in `eleventy.config.js` scans the
built HTML for `/pano/?img=…`, downscales each panorama to 1024px WebP via sharp, and writes it to
`_site/static/images/pano-preview/` (build output only — nothing generated lands in the vault).
`panorama.js` passes that as pannellum's `preview`, so an unloaded slide shows the actual scene
rather than a blank placeholder, and the mobile grid uses the same file for its thumbnail. Total
~189KB for all five, against 1.8MB if the full images were used as previews the way the old
cdn.pannellum.org embeds did (`&preview=` pointed at the full-size panorama).

**autoLoad is deliberately `false`.** The page renders each panorama twice (once as a swiper slide,
once in the `{% if not images %}` hidden fallback), so ten viewers exist on one page. Auto-loading
five ~1.8MB equirectangular images meant ~7MB of transfer and ten live WebGL contexts; click-to-load
costs ~5KB until the reader asks for one. Don't flip this to `true` without first de-duplicating
those two render sites.

The mobile grid distinguishes panorama iframes from video iframes by testing for `/pano/?img=` in
`img.src` — otherwise every panorama rendered as a video-camera placeholder captioned
"Video Content".

**`static/js/panorama.js` validates the `img` parameter** — `/static/…` paths only, rejecting
absolute URLs, protocol-relative `//`, backslashes and `..`. The page is embeddable, so without that
check the parameter would render an arbitrary remote image under this site's name.

---

## eBird Checklists (`/ebird/`)

A hidden page (`noindex`, not in nav) that renders my eBird history from a CSV export.

| File | Purpose |
|---|---|
| `templates/ebird.njk` | Layout + scoped CSS, extends `base.njk` |
| `static/js/ebird.js` | CSV parser, checklist grouping, filters, rendering |
| `static/data/ebird.csv` | The data — an eBird "Download My Data" export |
| `1.0 - Main Pages/9.9 - eBird Checklists.md` | `permalink: /ebird/`, `layout: ebird.njk`, `hide: true` |

**To update the data, replace `static/data/ebird.csv` with a fresh export.** Nothing else
changes — column order is read from the header row, not assumed.

**Date and time formats vary between exports.** The same account has produced both
`2025-10-07` / `09:54 AM` and `21/08/2026` / `7:00 am` (eBird follows the account locale, and
opening the file in Excel rewrites dates too), so `parseDate` accepts ISO and slash forms and
`parseTime` accepts either casing. Slash order is ambiguous row by row, so `detectDayFirst`
decides it once per file: the first component above 12 anywhere settles it, day-first is the
fallback. `dateStr` is then normalised to ISO, because the from/to date inputs compare it as a
string. Times are stored as minutes since midnight — a string sort puts "7:00 am" after
"10:04 am".

The page fetches that CSV at runtime and parses it in the browser (hand-rolled quote-aware
parser; eBird comments contain both commas and embedded newlines, so a naive split fails).
Rows are grouped by `Submission ID` into checklists, sorted newest-first, then bucketed into
Mon–Sun weeks. The list renders a **moving window** of those weeks (`startWeek` + `weeksShown`),
12 at a time — the full export is ~1,150 checklists / 13,000 rows across ~190 weeks, and
rendering every species table at once is needlessly slow.

Two `IntersectionObserver` sentinels sit either side of the list and extend the window before
the reader reaches an edge (`rootMargin: 900px`). Extending appends/prepends HTML rather than
re-rendering, so open checklists stay open; a prepend corrects `scrollBy` for the height it
just inserted, or the page jumps under the reader. A scrubber jump outside the window
*re-seats* it on the target instead of rendering everything in between — that is the whole
point of being able to reach 2016 — while a jump just past the end simply appends, so short
scrubs stay continuous.

**Callout (`.eb-note`):** the lightbulb card under the header, styled after `.analytics-note`
on `/site-activity/`. Its text is the page's `callout:` front matter (folded YAML, HTML
allowed, rendered with `| safe`), so it is edited in the `.md` and the card disappears if the
field is removed.

**Activity bars (`.eb-bars`):** one bar per calendar week for the last 52 weeks, height =
checklists that week, sitting under the filters in a `.chart-card`-style panel. Hovering names
the week and its count; clicking travels to it in the list. Plain HTML bars, not SVG — rounded
ends and hit targets stay exact at any width, and it matches the bar chart on `/site-activity/`.
Non-zero weeks get a 6% floor so a one-checklist week is still visible beside a busy one.
A pill toggle in the card header switches the measure to **distinct species that week** (both
measures are bucketed in one pass; flipping the toggle only calls `paintBars`, never re-walks
the data). Species counts are per-week distinct, so they do not sum across checklists.

This started as a *daily* sparkline and did not work: raw daily counts are only ever 0–3, so
the line had to be a rolling per-day mean, and a fractional "checklists per day" rate is not a
quantity anyone reads intuitively — widening the smoothing window did not save it. Weeks are
the unit the rest of the page is already grouped by, and a count is a count. Don't reintroduce
the rate.

**Date scrubber (`.eb-rail`):** a sticky rail left of the list, ticks distributed evenly over
the full filtered range — one per week up to 50 weeks, one per month beyond that (a decade of
data is ~70 month ticks; per-week ticks would be a pixel high). Click a tick or drag the rail
to travel; a bubble follows the pointer with the week under it, and the tick for the week being
read stays lit. That reading line **travels** — level with the header at the top of the
document, level with the bottom of the viewport at the end of it — because a fixed line near
the top lags badly at the end of a list: the final weeks never reach it, so the rail still
pointed at 2018 while the oldest checklist of 2016 was on screen. Reaching the end of a fully
rendered list pins the rail to its last tick outright, so the fill completes with the last
checklist rather than somewhere inside the footer. The bubble and lit tick track the pointer immediately
while the travel itself is throttled to one re-seat per animation frame — pointermove fires far
faster than the list can re-render. It is `position: fixed` against the right edge, below the
footer in the stack (`.site-footer` gets `position: relative; z-index: 10` in the page's scoped
CSS, since a fixed element otherwise paints over in-flow content). Only year boundaries, the hovered tick and the active
tick show labels — turning them all on at once smears them together at that density. Because
the list pages in 12 weeks at a time, `goToWeek` calls `ensureRendered` first, expanding
`weeksShown` far enough that the target section exists before scrolling to it. It stays on
touch screens too (narrower, 44px, standing labels dropped — the bubble names the week under
your thumb): the page hides the native scrollbar, so the rail is the only scroll affordance
there.

**The picker accepts the `.zip` eBird actually hands you**, not just the CSV inside it. The
zip container is parsed in `ebird.js` (EOCD → central directory → local headers) and the
DEFLATE stream goes to the browser's own `DecompressionStream('deflate-raw')` — no library,
nothing added to the CSP. Stored (uncompressed) entries are handled too, `__MACOSX`/`._`
resource forks are skipped, `MyEBirdData.csv` wins over any other CSV in the archive, and
encrypted archives get a "unzip it first" message rather than a silent failure.

The `<input type="file">` deliberately carries **no `accept` filter**: macOS reports zips as
`application/zip` or `application/x-zip-compressed` depending on how they were made, and
browsers greyed valid exports out in the Finder dialog. The type is decided by sniffing the
header instead (`PK\x03\x04`), so a misnamed file still works either way.

**Links inside `<summary>` need care.** The browser follows the link *and* toggles the row;
`stopPropagation` does not help (listeners on the same element still run) and `preventDefault`
cancels the navigation as well. The row's click handler therefore cancels the click and calls
`window.open` itself — a direct user gesture, so no popup blocker. Anything clickable added
inside a summary has to account for this.

The file picker is a fallback path, not the primary one: it renders someone else's export in
their own browser and covers the bundled file failing to load.

**CSP:** `connect-src` had no `'self'` entry — it lists external hosts only, and an explicit
`connect-src` overrides `default-src 'self'`, so the fetch of a same-origin file was blocked
until `'self'` was added. Any future same-origin `fetch`/XHR needs it too.

**Free-text columns are obfuscated.** `Checklist Comments` and `Observation Details` are prose
from a personal journal that names other people, and the CSV is fetchable by anything — the site
serves it at `/static/data/ebird.csv`, and **this repo is public**, so GitHub served the committed
copy too. `scripts/ebird-obfuscate.mjs` base64s those two columns with a `~b64~` marker;
`deobfuscate()` in `ebird.js` decodes them inside `toObjects`, so rendering and search see ordinary
text. Same bargain as the click-to-reveal email addresses in `base.njk`: obfuscation, not
encryption — it defeats bulk scraping, not a person who opens the file and notices the marker.

The pass is **idempotent**, and runs in two places:
- `eleventy.config.js` (`eleventy.after`) over the build output — covers a plain export dropped in
  locally.
- `.github/workflows/deploy.yml`, as a CLI over the committed file, committing the result back.
  **This is what makes the mobile update path safe:** upload a fresh export through the GitHub app
  and the Action encodes it in place within a minute, so the branch head never carries readable
  field notes. The plaintext blob does exist in that one upload commit; history was deliberately
  left alone.

Unmarked values pass through untouched, which is what keeps the file picker working on a reader's
own plain export straight from eBird. `robots.txt` also disallows `/ebird/` and `/static/data/`.

**Size:** the full export is ~4MB (~950KB gzipped over the wire). If shipping it whole becomes
a problem, the fix is a build hook that transforms the CSV into compact JSON in `_site` (the
`pano-preview` hook is the precedent) — keeping "update the CSV" as the only maintenance step.
Note the real export's comments name other people; the file is publicly fetchable at
`/static/data/ebird.csv` regardless of the page's `noindex`.

---

## Content Security Policy

Set as `<meta http-equiv="Content-Security-Policy">` in `templates/base.njk`. Applies in production and locally.

**When adding new external image sources**, add the domain to `img-src` — missing domains silently block images in production.

Current `img-src` domains: `https://i.imgur.com`, `https://*.basemaps.cartocdn.com`, `https://m.media-amazon.com`, `https://images-na.ssl-images-amazon.com`, `https://i.gr-assets.com`, `https://images.gr-assets.com`, `https://tiles.openfreemap.org`, `https://cdn.jsdelivr.net`, `https://server.arcgisonline.com`

Same applies to `connect-src` for any XHR/fetch calls (map tile providers, form endpoints) — currently includes web3forms, val.run endpoints, openfreemap, jsdelivr, arcgisonline, cartocdn.

**Note:** `/photo-map`'s Cesium globe uses Esri World Imagery (no account needed) — Bing Maps Aerial via Cesium Ion was tried and reverted: Bing's tile metadata resolves to `http://` URLs, which real HTTPS pages block as mixed content regardless of CSP, so it only ever worked on plain-http localhost. Also note CSP wildcards only cover one subdomain level (`*.virtualearth.net` does NOT match `ecn.t0.tiles.virtualearth.net`, two levels deep) — worth remembering if a similar multi-level-subdomain host comes up again. Don't reintroduce Ion/Bing without solving the mixed-content issue first.
