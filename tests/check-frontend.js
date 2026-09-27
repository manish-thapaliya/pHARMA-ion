#!/usr/bin/env node
/**
 * Static sanity check for index.html — no browser required.
 *
 * Catches the wiring mistakes that silently break the page:
 *   • getElementById() / show() referring to ids that do not exist
 *   • onclick="fn()" handlers that are not defined
 *   • missing tab buttons / document upload inputs
 *   • duplicate element ids
 */
'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('✗ index.html: no <script> block found');
  process.exit(1);
}
const script = scriptMatch[1];
const source = html; // handlers also appear inside template strings in the script

const problems = [];
const check = (cond, message) => { if (!cond) problems.push(message); };

// ---- element ids -------------------------------------------------------
const ids = new Set();
const idRe = /\sid="([^"]+)"/g;
let m;
const duplicateIds = new Set();
while ((m = idRe.exec(html)) !== null) {
  if (ids.has(m[1])) duplicateIds.add(m[1]);
  ids.add(m[1]);
}
duplicateIds.forEach((id) => problems.push('duplicate element id: ' + id));

// getElementById('literal')
const wanted = new Set();
const getRe = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
while ((m = getRe.exec(script)) !== null) wanted.add(m[1]);

// show('literal', ...) -> message elements
const showRe = /\bshow\(\s*['"]([^'"]+)['"]/g;
while ((m = showRe.exec(script)) !== null) wanted.add(m[1]);

wanted.forEach((id) => check(ids.has(id), 'script refers to missing element id: #' + id));

// dynamic ids: activateTab('Login') -> #tabLogin ; document.getElementById('doc'+t)
const tabRe = /activateTab\(\s*'([^']+)'\s*\)/g;
while ((m = tabRe.exec(script)) !== null) {
  check(ids.has('tab' + m[1]), 'activateTab("' + m[1] + '") needs a #tab' + m[1] + ' button');
}
['GST', 'DRUG_LICENSE', 'SHOP_ID', 'PAN'].forEach((t) => {
  check(ids.has('doc' + t), 'missing file input #doc' + t);
});
check(ids.has('configBanner'), 'missing #configBanner');

// ---- click handlers ----------------------------------------------------
const defined = new Set();
const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
while ((m = fnRe.exec(script)) !== null) defined.add(m[1]);
const arrowRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/g;
while ((m = arrowRe.exec(script)) !== null) defined.add(m[1]);
const assignRe = /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/g;
while ((m = assignRe.exec(script)) !== null) defined.add(m[1]);
['openTab', 'activateTab', 'show', 'requireAdmin', 'logout'].forEach((n) => defined.add(n));

const handlerRe = /on(?:click|change|input|submit)\s*=\s*"([A-Za-z_$][\w$]*)\s*\(/g;
const handlers = new Set();
while ((m = handlerRe.exec(source)) !== null) handlers.add(m[1]);
handlers.forEach((name) =>
  check(defined.has(name), 'onclick handler "' + name + '" is not defined in the script'));

// ---- OTP widgets -------------------------------------------------------
[['.otp', 6], ['.motp', 6]].forEach(([sel, expected]) => {
  const count = (script.match(new RegExp('class="' + sel.slice(1) + '"', 'g')) || []).length;
  const inHtml = (html.match(new RegExp('class="' + sel.slice(1) + '"', 'g')) || []).length;
  check(count === expected || inHtml === expected,
    'expected ' + expected + ' OTP boxes for ' + sel + ' (found ' + Math.max(count, inHtml) + ')');
});

// ---- API + upload guardrails ------------------------------------------
check(/const API_URL\s*=\s*"https:\/\/script\.google\.com\/macros\/s\/[^"]+\/exec"/.test(script),
  'API_URL should be the deployed /exec URL');
check(/MAX_UPLOAD_BYTES/.test(script), 'client should enforce MAX_UPLOAD_BYTES before uploading');
check(/text\/plain/.test(script),
  'POSTs must use a CORS-safelisted content type (text/plain) so no preflight is sent');

// ---- report ------------------------------------------------------------
if (problems.length) {
  console.log('✗ index.html wiring');
  problems.forEach((p) => console.log('    ✗ ' + p));
  process.exit(1);
}
console.log('✓ index.html wiring (' + ids.size + ' ids, ' + handlers.size + ' handlers, ' +
  defined.size + ' functions)');
