## PharmaGo — “Aurora” front-end redesign

Replaces the clinical-blue workspace with a soft modern product UI: airy white surfaces on a
`#f7f7fd` page, a pastel gradient wash, an indigo accent (`#4f46e5`), pill controls and generously
rounded, softly layered cards. `index.html` is still a single dependency-free file — no framework,
no build step, no CDN — and the state machine (`data-show`, `#tab*`, `#view*`, the 6-box OTP
widgets, the `text/plain` API calls) is untouched, so the backend contract and every test hook
survive the restyle.

### Design system

- **One `:root` palette** — indigo `#4f46e5` accent, mint/amber/rose/sky semantics, near-black
  indigo ink, and a full set of pastel tints (`--brand-tint`, `--ok-tint`, …). Shape, elevation and
  easing are tokens too (`--radius*`, `--shadow*`, `--ease`), so re-theming stays a token edit.
- **Soft, layered elevation** — every surface uses diffuse, low-opacity shadows with a tinted
  ambient glow instead of the previous hard 1 px borders; cards lift on hover, panels ease in.
- **Type** — Inter carries prose *and* headings (tighter tracking, 800 weight for display sizes),
  IBM Plex Mono is now reserved for identifiers, prices, counters, OTP digits and keyboard hints;
  admin stat numbers use tabular figures instead of mono.

### Shell and navigation

- **Glass rail** — `.sidebar` is now a floating, blurred, fully rounded panel with a gradient brand
  mark; the active tab is a gradient pill with `aria-current="page"`.
- **Glass workspace header** — the sticky topbar matches the rail and keeps its crumb/summary
  contract (`Guest / Customer / Pharmacy workspace`, `Admin unlocked`).
- **Ambient aurora** — one `aria-hidden` fixed layer with three slowly drifting blurred orbs over
  soft page gradients. It sits behind `.app-shell`, is dropped under 640 px and honours
  `prefers-reduced-motion`.
- **Floating mobile dock** — below 1040 px the rail becomes a blurred bottom dock; below 640 px it
  is icon-only, which is why **every tab now carries an `aria-label`**.

### Components

Hero (gradient card, pill CTAs, proof pills), journey strip (tinted step badges), panels (32 px
radius), forms (soft inputs with an indigo focus ring), pill buttons with glow, status chips,
`rx-card` tiles with a soft document tile and a rounded review track, tables (rounded container,
sticky headers, airy rows), pill command-bar search, admin stat tiles with tinted icon badges,
upload zone, delivery fieldsets, modal viewer (34 px dialog, blurred backdrop, glass header),
toasts, skeletons, empty states, skip link and print styles.

### Two behaviour fixes the redesign surfaced

- Signing in as a pharmacy used to replace `#tabMerchant`'s `textContent`, silently deleting the
  tab's icon. The label now updates the `.tab-label` span (and the `aria-label`) and the icon stays.
- The icon-only small-screen dock would have left tabs unnamed, so all five tabs got explicit
  accessible names.

### Accessibility

- All text pairs clear WCAG AA on the surfaces they are actually painted on. `tests/check-frontend.js`
  now **derives** those pairs from the `:root` palette (ink/ink-2/muted/faint on `--surface` and
  `--page`, brand/brand-dark on `--brand-tint`, `ok`/`warn`/`danger`/`info` on their tints, white on
  the brand gradient stops) instead of hard-coding hex values, so the guard checks the real theme.
- New assertions: the aurora layer must stay `aria-hidden`, and the rail keeps accessible names.

### Also updated

- `meta[name=theme-color]`, `<title>`, the description and the app name now match the new identity.
- **Icons** — `icon.svg` and the 192/512 PNGs were regenerated with the indigo gradient mark
  (rasterised from the same geometry, no external tooling), and `manifest.webmanifest` carries the
  matching `theme_color` / `background_color`.

### Verification

`npm test` — 26/26 backend scenarios (311 checks), `index.html` wiring (139 ids, 45 handlers, 100
functions, AA contrast guard) and **115** UI-state checks (up from 113) all pass. The demo server was
booted against the new page (`GET /`, `POST /api` login, `/__mailbox` all 200) so the redesign can be
inspected end to end in a browser.

### Not in scope

`code.gs`'s `pageShell_()`/`clinicalCss_()` pages, the branded emails and `demo/server.js`'s hint bar
and mailbox still use the previous clinical-blue tokens. Only the app itself moved to Aurora;
re-theming those surfaces is a follow-up.
