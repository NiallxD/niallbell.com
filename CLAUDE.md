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

## Content Security Policy

Set as `<meta http-equiv="Content-Security-Policy">` in `templates/base.njk`. Applies in production and locally.

**When adding new external image sources**, add the domain to `img-src` — missing domains silently block images in production.

Current `img-src` domains: `https://i.imgur.com`, `https://*.basemaps.cartocdn.com`, `https://m.media-amazon.com`, `https://images-na.ssl-images-amazon.com`, `https://i.gr-assets.com`, `https://images.gr-assets.com`, `https://tiles.openfreemap.org`, `https://cdn.jsdelivr.net`, `https://server.arcgisonline.com`

Same applies to `connect-src` for any XHR/fetch calls (map tile providers, form endpoints) — currently includes web3forms, val.run endpoints, openfreemap, jsdelivr, arcgisonline, cartocdn.

**Note:** `/photo-map`'s Cesium globe uses Esri World Imagery (no account needed) — Bing Maps Aerial via Cesium Ion was tried and reverted: Bing's tile metadata resolves to `http://` URLs, which real HTTPS pages block as mixed content regardless of CSP, so it only ever worked on plain-http localhost. Also note CSP wildcards only cover one subdomain level (`*.virtualearth.net` does NOT match `ecn.t0.tiles.virtualearth.net`, two levels deep) — worth remembering if a similar multi-level-subdomain host comes up again. Don't reintroduce Ion/Bing without solving the mixed-content issue first.
