## PharmaGo — "Clinical" UI + every surface that shares its theme

Replaces the warm cream/green editorial interface with a clinical-light workspace and drags every
other branded surface (Apps Script pages, emails, demo mailbox) onto the same design system. Same
`data-show` state machine, same Sheets/Drive backend, same API contract.

### Frontend (`index.html`)

- **Icon rail navigation** — fixed left sidebar with SVG-icon tabs, session chip, sign-out and
  connection pill; bottom tab bar under 900 px. Sticky workspace header names the space
  (`Guest / Customer / Pharmacy workspace`, `Admin unlocked`) and the active tab; active items
  carry `aria-current="page"`.
- **Clinical design system** — cool white on `#f5f7fb` with a faint blueprint grid, clinical blue
  `#1668d3`, Inter + IBM Plex Mono, mono for IDs/prices/counts, one `:root` token block.
- **Self-hosted type** — Inter (400/600/700/800) and IBM Plex Mono (500/600) vendored as latin
  woff2 subsets in `/fonts` (132 KB). No request to `fonts.googleapis.com`, so the page renders
  identically where that CDN is blocked or slow; non-latin glyphs fall back to system fonts.
- **Installable** — `manifest.webmanifest`, `icon.svg`, generated `icon-192.png`/`icon-512.png`.
- **Nepal-first money** — prices render `NPR 149` (deployment targets `Asia/Katmandu`), not `₹`.
- **Denser data surfaces** — command-bar catalogue search (`/` focuses it from anywhere) above a
  table with sticky headers and right-aligned mono numerics; prescription/order cards with status
  chips and a three-step review track; admin stat tiles; the pharmacy KYC queue is now a real
  table with document chips instead of `<div>`/`<br>` soup; modal Rx viewer with sticky header.
- **Accessibility** — every text/background token pair is ≥ 4.5:1 (first pass shipped a 2.56:1
  faint grey); the Rx viewer is a real dialog (focus trap, Escape, focus restore); loading
  skeletons and explicit empty states for every queue; skip link; `prefers-reduced-motion`;
  print stylesheet.

### Backend (`code.gs`)

- `clinicalCss_()` + `pageShell_()` render the emailed **set-password form**, the **form-post
  result** and the `FRONTEND_URL` **hand-off** in the same chrome (brand mark, blue accent).
- **Branded emails**: `emailHtml_()` builds an inline-styled table template — OTP as a large mono
  block, reset link as a CTA button with link fallback, review/order notifications with CTAs.
  Plain-text bodies remain as the fallback for every message.
- **`ADMIN_GOOGLE_DOMAIN`** (optional Script Property): with it set, a valid admin key also
  requires the caller's Google account to be in that domain; blank keeps key-only behaviour.
  Documented caveat: only meaningful once deployed as *Execute as: user accessing the web app*.

### Demo (`demo/server.js`)

- Hint bar and `/__mailbox` rethemed with the same tokens; the server now also serves
  `/fonts/*`, `/manifest.webmanifest` and the icons so the local preview is self-contained.

### Tests

- `tests/check-frontend.js`: parses `:root` and asserts WCAG AA contrast for ten text/background
  pairs, plus `prefers-reduced-motion` and the skip link — a future re-theme cannot regress silently.
- `tests/check-ui-state.js`: 64 → **77** checks (rail contents, workspace header, `aria-current`,
  loading/empty states, focus trap, Escape, focus restore).
- `tests/spec.js`: **23 scenarios / 228 checks**, including the new `ADMIN_GOOGLE_DOMAIN`
  scenario (allowed domain, denied domain, cleared property).
- Loaders that await the API now bail out if the document disappeared mid-flight (tab switched
  or jsdom teardown) — a real `getElementById of undefined` crash this navigation exposed.
- `tests/visual-smoke.js` (new, opt-in): boots the demo, drives guest → customer → viewer →
  catalogue → admin in Chromium, screenshots six workspaces into `tests/screenshots/`
  (git-ignored) and fails on console/page errors, a broken focus trap or the `/` shortcut.
  Needs `npx playwright install chromium`; the browser binary stays out of git.

### Verification

`npm test` — 23/23 backend scenarios (228 checks), `index.html` wiring (115 ids, 39 handlers,
85 functions, contrast guard) and 77 UI-state checks pass. Demo server smoke-tested on `/`,
`/__mailbox`, `/manifest.webmanifest`, `/icon*.png`, `/fonts/*` and `POST /api`. Rendered
set-password page asserted to carry the token, a password field and the new theme with zero
old-theme leftovers.

### Deployment note

`code.gs` changed → publish a **new Apps Script deployment version** or the live set-password
pages and emails keep the old look. The static `index.html` still points at the configured
`/exec` URL; commit the `/fonts`, manifest and icon files alongside it (GitHub Pages serves
them from the repo root). Demo data is fictional; never use its credentials in production.
