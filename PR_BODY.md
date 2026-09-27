## PharmaGo UI and local demo

Reconstructs the missing, uncommitted UI work on top of the merged PR #1 baseline. The saved directory and PR draft mentioned in the request were not available in this checkout, so this body describes the work actually present rather than quoting that draft.

- Refreshes the responsive PharmaGo interface with a `data-show` state machine: guest registration, customer prescription portal, pharmacy listings, and an independently unlockable admin console. Hidden tabs reroute to an available workspace on role changes.
- Adds admin overview counts, pending/all prescription reviews (including reviewed Rx IDs), pharmacy KYC links, and medicine editing/delisting; pharmacies can edit and toggle their own listings.
- Validates the admin key against the API before revealing admin controls; keeps it in session storage rather than persistent local storage.
- Adds a same-origin interactive demo at `PORT=8000 node demo/server.js`, running the actual Apps Script backend in an in-memory mock. Includes fictional accounts, a pending prescription and pharmacy, sample catalogue data, and a demo mailbox/inline OTPs without touching Google services.
- Creates customer IDs sequentially per script-local year starting at `U-2026-0010`, under a registration lock, while preserving legacy and other ID formats.
- Extends the frontend checker to validate `data-show` vocabulary and tab wiring; 61 browser-like UI-state checks drive guest → customer → pharmacy → admin → lock/logout flows. Documents usage in README.

### Verification

`npm install && npm test` — 18/18 backend scenarios (163 checks, including the new ID tests), index.html wiring, and 61 UI-state checks pass.

### Deployment note

The live static page still points at the configured Apps Script `/exec` URL; after deploying backend changes, publish a **new Apps Script deployment version**. The demo uses only mocked data. Do not use its sample credentials in production.
