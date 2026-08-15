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
A physics-driven, empathy-through-mechanics web game at `/adhd/`. The player experiences a simulated ADHD morning — dragging tasks into a wandering "focus box", fighting intrusive thoughts, managing body system meters, and experiencing scripted failure events that demonstrate how ADHD actually affects cognition. The goal is understanding, not gamification.

### Files
| File | Purpose |
|---|---|
| `templates/adhd.njk` | Standalone full-screen page (no nav, no base.njk). Loads VT323, React 18, ReactDOM 18, Babel Standalone 7 via CDN. Inline terminal CSS. |
| `static/js/adhd-game.js` | The entire game (~2300 lines JSX). Loaded via `<script type="text/babel" data-presets="react">`. |
| `1.0 - Main Pages/ADHD Game.md` | Eleventy content file — `permalink: /adhd/`, `layout: adhd.njk`, `noindex: true` |

### Technical Stack
- **React 18 UMD + ReactDOM 18 UMD** via unpkg (global `window.React` / `window.ReactDOM`)
- **Babel Standalone 7** — enables JSX in an external file without a bundler
- **HTML5 Canvas 2D** for the physics activity map
- **Web Audio API** for oscillator-based sound effects (no audio files)
- **VT323** Google Font; phosphor green `#39ff14`; CRT scanline aesthetic

### Architecture (`adhd-game.js`)
The file is divided into 6 sections:

```
§1  CONSTANTS & GAME DATA    — palette, PHYSICS constants, morningTasks[], HYPERFOCUS_NAGGING[], BODY_TASKS{}
§2  PHYSICS UTILITIES        — physicsUpdate(), renderCanvas(), pure helper fns
§3  CANVAS RENDER            — renderCanvas() — draw order: bg → connection lines → intrusive nodes → task nodes → focus box → nagging text
§4  WEB AUDIO ENGINE         — initAudio(), playSnap(), playError(), playDriveSpike(), playEject()
§5  REACT COMPONENTS         — ConfigScreen, GameLayout, LeftPanel, ActivityMap, RightPanel, overlays
§6  APP ROOT                 — App component + ReactDOM.createRoot mount
```

**State separation pattern:**
- Physics state lives in `physicsRef` (mutated in rAF loop, no re-renders)
- React `useState` synced every 200ms from the rAF loop
- `driveRef`, `metersRef`, `profileRef` mirror React state for rAF reads

**Canvas init pattern (`pendingInitRef`):**
`startGame` sets `pendingInitRef.current = profile` and `physicsRef.current = null`. The `ResizeObserver` in `ActivityMap` calls `initPhysics(pendingInitRef.current, w, h)` on its first fire once the canvas has real dimensions. This avoids the 0×0 canvas problem.

### Core Mechanics
- **Hold-to-snap:** drag a task toward the focus box — cursor must stay inside for `initiationCost × 3200ms` before the node pops in. Per-task `initiationCost` controls how hard each task is to start.
- **In-box drift:** tasks inside the box slowly drift outward; player must keep re-dragging them back. Rate: `TASK_DRIFT_IN_BOX: 0.18` × focus level.
- **Intrusive thoughts:** spawn from canvas edges, attract toward the box. Drag-and-flick to eject. Suppressed (drift away) during hyperfocus.
- **Body meters:** BLADDER, HUNGER, THIRST, FATIGUE drain continuously. At 35% → intrusive thought spawns. At 12% → body task node spawns; dragging it in ejects all other tasks and locks the box until complete.
- **Drive bar:** rises on task complete, falls when idle. Affects box size, task drift, spawn rate.

### Hyperfocus
Triggered when a `canHyperfocus: true` task snaps into the box (probabilistic, once per task per session):
- Box turns purple, panels fade to 12% opacity
- All other in-box tasks ejected; hyperfocus task locked in (cannot be dragged out)
- Intrusive thoughts actively drift away
- 4 random nagging thoughts from `HYPERFOCUS_NAGGING[]` appear as ghostly amber text on canvas
- On complete: nagging thoughts spawn as urgent flashing task nodes; everything fades back in

### Scripted Failure Events
**Event 1 — Volunteer conversation (`meet_volunteer`):**
Word-by-word NPC dialogue; key details highlighted amber. If task leaves box mid-conversation, words replaced with `[...]`. On complete → email subtask unlocks. When email task snaps, `NameSelectOverlay` shows 5 wrong name options (all wrong by design). Response always triggers awkward relationship outcome.

**Event 2 — Keys location (`hang_keys`):**
At 85% progress, a forced intrusive thought spawns and `keysActualLocation` is set to `null` (location never committed to memory). Task shows as `✓ COMPLETE`. When `tell_partner_keys` subtask snaps, `LocationSelectOverlay` shows 4 options (all wrong). Leads to `LocationSearchGrid` — 12-cell grid, timed wrong guesses, partner mood drain.

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
