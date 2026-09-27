# 🚀 PharmaGo Public-Beta Deployment Guide

How to put the new interface live for public testing. Two parts: the **frontend**
(static `index.html` → GitHub Pages) and the **backend** (already-deployed Apps Script).

## 1. Publish the frontend (GitHub Pages, ~3 minutes)

This repo ships a workflow (`.github/workflows/deploy-pages.yml`) that runs
`npm test` and publishes the site on every push to `main`.

1. Merge this branch to `main` (open a PR, or push directly).
2. In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push/merge — the workflow deploys automatically. Your public test URL will be
   `https://<username>.github.io/<repo>/` (shown in the workflow run + Pages settings).

No build step needed: the site is a single static `index.html` (`.nojekyll` included).

## 2. Point the backend at the live site (one setting)

The app already talks to the deployed Apps Script `/exec` URL baked into `API_URL`.
For emailed “set password” links to land on your public site instead of the
Apps Script fallback page:

1. Open the Apps Script project → **Project Settings → Script Properties**.
2. Add `FRONTEND_URL` = your Pages URL (e.g. `https://<username>.github.io/<repo>/`).
3. No code change, no redeploy needed for Script Properties.

> ⚠️ If you ever edit `code.gs`: **Deploy → Manage deployments → ✏️ Edit →
> Version: _New version_ → Deploy**, or the live site keeps hitting the old backend.

## 3. Before inviting testers — safety checklist

- [ ] `ADMIN_KEY` Script Property is changed from `changeme-admin-key` (and kept private).
- [ ] Testers know this is a **beta**: use test data, not real prescriptions / personal info.
- [ ] Do a smoke pass on the live URL: register → email code → login → upload Rx →
      admin approve → catalogue order → pharmacy accept.
- [ ] Confirm the emailed password-link flow works (needs `FRONTEND_URL` above).
- [ ] Check the site on a phone (layout is responsive; nav tabs scroll horizontally).

## 4. Try it locally first (optional)

```bash
npm install
npm test                       # 22 backend scenarios + wiring + 64 UI-state checks
PORT=8000 node demo/server.js  # fictional in-memory data, nothing real touched
```

Demo logins: customer `demo@pharmago.test` / `demo123`,
pharmacy `vendor@pharmago.test` / `demo123`, admin key `changeme-admin-key`.
Codes appear inline or at `/__mailbox`.

## 5. Rolling back

GitHub Pages keeps every deployment: **Settings → Pages → Deployments** (via the
`github-pages` environment) lets you re-activate any previous build instantly.

## What changed in this release (v1.0.0-beta)

- Complete interface redesign: sticky glass header, segmented navigation, new hero,
  4-step onboarding strip, modern cards/tables, dark footer, public-beta banner.
- SEO + share tags, favicon, mobile-first responsive layout, accessibility pass
  (skip link, focus rings, reduced-motion support).
- Zero logic changes: all 112+ element hooks and API flows are untouched, so the
  full suite (221 backend + wiring + 64 UI-state checks) passes unchanged.
