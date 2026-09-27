## PharmaGo UI and local demo

Reconstructs the missing, uncommitted UI work on top of the merged PR #1 baseline. The saved directory and PR draft mentioned in the request were not available in this checkout, so this body describes the work actually present rather than quoting that draft.

- Refreshes the responsive PharmaGo interface: clearer account, prescription, catalogue, pharmacy and admin workspaces; role-based hints and tools; accessible navigation and status messages.
- Validates the admin key against the API before revealing admin controls; keeps it in session storage rather than persistent local storage.
- Adds a same-origin interactive demo at `PORT=8000 node demo/server.js`, running the actual Apps Script backend in an in-memory mock. Includes fictional sample accounts and catalogue data, and displays demo-only OTPs/reset flow without touching Google services.
- Creates customer IDs sequentially per script-local year starting at `U-2026-0010`, under a registration lock, while preserving legacy and other ID formats.
- Adds 61 browser-like UI-state checks alongside the existing frontend wiring checks and backend scenarios. Documents usage in README.

### Verification

`npm install && npm test` — 18/18 backend scenarios (163 checks, including the new ID tests), index.html wiring, and 61 UI-state checks pass.

### Deployment note

The live static page still points at the configured Apps Script `/exec` URL; after deploying backend changes, publish a **new Apps Script deployment version**. The demo uses only mocked data. Do not use its sample credentials in production.
