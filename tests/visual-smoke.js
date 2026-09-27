#!/usr/bin/env node
/**
 * Optional visual smoke test — real pixels, no Google services.
 *
 * Boots demo/server.js (the actual code.gs on an in-memory stub), drives a real
 * Chromium through the guest → customer → admin flows, screenshots each workspace
 * into tests/screenshots/ and fails on console/page errors or missing chrome.
 *
 *   npm i                 # installs the @playwright/test dev dependency
 *   npx playwright install chromium --with-deps   # one-time, ~150 MB, kept out of git
 *   npm run test:visual
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8123);
const OUT = path.join(__dirname, 'screenshots');

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    console.error('✗ playwright is not installed — run: npm i && npx playwright install chromium');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'demo', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${PORT}`;
  const ready = await (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(base + '/health');
        if (res.ok) return true;
      } catch (err) { /* not up yet */ }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  })();
  if (!ready) { server.kill(); throw new Error('demo server did not come up on ' + base); }

  const errors = [];
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.error('✗ no Chromium binary for playwright — run once: npx playwright install chromium --with-deps');
    console.error('  (' + String(err.message).split('\n')[0] + ')');
    server.kill();
    process.exit(2);
  }
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));
  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.includes('/favicon')) errors.push('requestfailed: ' + url);
  });

  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(OUT, '01-guest.png'), fullPage: false });
    if (!(await page.isVisible('#tabLogin'))) throw new Error('icon rail missing on guest view');
    if (!(await page.isVisible('.hero'))) throw new Error('workspace hero missing');

    // Customer flow
    await page.fill('#lId', 'demo@pharmago.test');
    await page.fill('#lPass', 'demo123');
    await page.click('#viewLogin .btn');
    await page.waitForSelector('#user.active', { timeout: 8000 });
    await page.waitForSelector('#rxHistory .rx-card', { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, '02-customer.png') });

    // Prescription viewer modal + focus trap
    await page.click('#rxHistory .rx-card button');
    await page.waitForSelector('#rxViewer:not([hidden])', { timeout: 8000 });
    await page.waitForSelector('.rx-preview-img, .rx-preview-frame, .rx-paper', { timeout: 8000 });
    await page.keyboard.press('Tab');
    const trapped = await page.evaluate(() =>
      document.getElementById('rxViewer').contains(document.activeElement));
    if (!trapped) throw new Error('focus escaped the prescription dialog');
    await page.screenshot({ path: path.join(OUT, '03-viewer.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#rxViewer[hidden]', { timeout: 4000 });

    // Catalogue + "/" shortcut
    await page.keyboard.press('/');
    await page.waitForSelector('#shop.active', { timeout: 4000 });
    if (await page.evaluate(() => document.activeElement !== document.getElementById('medSearch'))) {
      throw new Error('"/" did not focus the catalogue search');
    }
    await page.screenshot({ path: path.join(OUT, '04-catalogue.png') });

    // Admin console
    await page.fill('#adminKey', 'changeme-admin-key');
    await page.click('#tabAdmin');
    await page.waitForSelector('#admin.active', { timeout: 4000 });
    await page.fill('#adminKey', 'changeme-admin-key');
    await page.click('#adminLockCard .btn');
    await page.waitForSelector('#adminDashboard:not([hidden])', { timeout: 8000 });
    await page.waitForSelector('#merchantList table', { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, '05-admin.png'), fullPage: true });

    // Mobile rail
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '06-mobile.png') });
  } finally {
    await browser.close();
    server.kill();
  }

  const shot = f => fs.existsSync(path.join(OUT, f)) ? path.join(OUT, f) : 'MISSING';
  ['01-guest.png','02-customer.png','03-viewer.png','04-catalogue.png','05-admin.png','06-mobile.png']
    .forEach(f => console.log('  • ' + shot(f)));
  if (errors.length) {
    console.error('✗ visual smoke: ' + errors.length + ' runtime error(s)');
    errors.slice(0, 12).forEach(e => console.error('    ✗ ' + e));
    process.exit(1);
  }
  console.log('✓ visual smoke passed — screenshots in tests/screenshots/');
}
main().catch(err => { console.error('✗ ' + (err && err.stack ? err.stack : err)); process.exit(1); });
