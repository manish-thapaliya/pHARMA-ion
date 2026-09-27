#!/usr/bin/env node
/**
 * Runs tests/spec.js against code.gs inside the mocked Apps Script runtime.
 *
 *   node tests/run-tests.js            # human readable
 *   node tests/run-tests.js --quiet    # only failures + summary
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createStub } = require('./apps-script-stub');

const root = path.join(__dirname, '..');
const stub = createStub();

const sandbox = {
  console,
  MOCK: { state: stub.state, helpers: stub.helpers },
  SpreadsheetApp: stub.SpreadsheetApp,
  DriveApp: stub.DriveApp,
  MailApp: stub.MailApp,
  Utilities: stub.Utilities,
  PropertiesService: stub.PropertiesService,
  ScriptApp: stub.ScriptApp,
  HtmlService: stub.HtmlService,
  ContentService: stub.ContentService,
  Session: stub.Session,
  Logger: stub.Logger,
};
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);

const code = fs.readFileSync(path.join(root, 'code.gs'), 'utf8');
const spec = fs.readFileSync(path.join(__dirname, 'spec.js'), 'utf8');

vm.runInContext(code, ctx, { filename: 'code.gs' });
vm.runInContext(spec, ctx, { filename: 'spec.js' });

const results = ctx.runTests();
const quiet = process.argv.includes('--quiet');

let failed = 0;
let checks = 0;
for (const r of results) {
  checks += r.checks;
  const bad = r.failures.length > 0;
  if (bad) failed++;
  if (!quiet || bad) {
    console.log((bad ? '✗ ' : '✓ ') + r.name);
    r.failures.forEach((f) => console.log('    ✗ ' + f));
  }
}

console.log('\n' + (results.length - failed) + '/' + results.length + ' scenarios passed, ' +
  checks + ' checks, ' + failed + ' failing scenario(s).');

process.exit(failed ? 1 : 0);
