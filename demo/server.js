#!/usr/bin/env node
'use strict';
// Local interactive demo: the real code.gs runs in the in-memory Apps Script stub.
// No Google account, spreadsheet, mail or Drive files are touched.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createStub } = require('../tests/apps-script-stub');

const stub = createStub();
const ctx = vm.createContext({
  console, ...Object.fromEntries(['SpreadsheetApp', 'DriveApp', 'MailApp', 'Utilities',
    'PropertiesService', 'ScriptApp', 'HtmlService', 'ContentService', 'Session',
    'LockService', 'Logger'].map(key => [key, stub[key]])),
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../code.gs'), 'utf8'), ctx, { filename: 'code.gs' });
const call = data => ctx.handleRequest_(data);
call({ action:'setup' });

// Seed safe fictional demo accounts and a medicine so the catalogue is useful on arrival.
const customer = call({ action:'register', email:'demo@pharmago.test', phone:'9800000001',
  name:'Demo Customer', password:'demo123', password2:'demo123' });
call({ action:'verify_email', userId:customer.data.userId, otp:stub.helpers.lastOtp('demo@pharmago.test') });
const documents = ['GST','DRUG_LICENSE','SHOP_ID','PAN'].map(docType => ({
  docType, fileName:docType + '.pdf', fileType:'application/pdf', fileBase64:stub.helpers.b64('fictional demo document')
}));
const vendor = call({ action:'register_merchant', email:'vendor@pharmago.test',
  phone:'9800000002', shopName:'Green Cross Pharmacy', address:'Demo Street',
  gstNumber:'DEMO-GST', drugLicenseNumber:'DEMO-DL', documents,
  password:'demo123', password2:'demo123' });
if (vendor.success) {
  call({ action:'verify_merchant', merchantId:vendor.data.merchantId, otp:stub.helpers.lastOtp('vendor@pharmago.test') });
  call({ action:'review_merchant', merchantId:vendor.data.merchantId,
    status:'APPROVED', adminKey:'changeme-admin-key' });
  call({ action:'add_medicine', merchantId:vendor.data.merchantId, password:'demo123',
    name:'Vitamin C', category:'Supplement', price:149, stock:48 });
}

// A pending prescription and pharmacy make the admin review queue interactive.
// The PNG is a fictional document so both the customer and admin viewers have something to open.
const sampleRx = fs.readFileSync(path.join(__dirname, 'sample-rx.png')).toString('base64');
const sampleApproved = fs.readFileSync(path.join(__dirname, 'sample-rx-approved.png')).toString('base64');
const customerLogin = call({ action:'login', loginId:'demo@pharmago.test', password:'demo123' });
const customerToken = customerLogin.success ? customerLogin.data.sessionToken : '';
call({ action:'upload_rx', patientName:'Test Patient', receiverName:'Test Receiver', confirmationPhone:'9800000001', receiverPhone:'9800000002', deliveryAddress:'12 Demo Street, Ward 4', deliveryCity:'Kathmandu', userId:customer.data.userId, sessionToken:customerToken, fileName:'sample-rx.png',
  fileType:'image/png', fileBase64:sampleRx });
const followUp = call({ action:'upload_rx', patientName:'Test Patient', receiverName:'Test Receiver', confirmationPhone:'9800000001', receiverPhone:'9800000002', deliveryAddress:'12 Demo Street, Ward 4', deliveryCity:'Kathmandu', userId:customer.data.userId, sessionToken:customerToken, fileName:'follow-up-rx.png',
  fileType:'image/png', fileBase64:sampleApproved });
if (followUp.success) {
  call({ action:'update_status', adminKey:'changeme-admin-key', rxId:followUp.data.rxId,
    status:'APPROVED', note:'Looks complete. Ready for dispensing.' });
}
const pendingVendor = call({ action:'register_merchant', email:'pending@pharmago.test',
  phone:'9800000003', shopName:'Valley Medicos', address:'Demo Street',
  gstNumber:'DEMO-GST-2', drugLicenseNumber:'DEMO-DL-2', documents });
if (pendingVendor.success) call({ action:'verify_merchant', merchantId:pendingVendor.data.merchantId,
  otp:stub.helpers.lastOtp('pending@pharmago.test') });

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace('</head>',
  '<meta name="pharmago-demo" content="true"><style>.demo-hint{background:#eef5ff;border:1px solid #bcd6f7;border-left:3px solid #1668d3;padding:13px 16px;border-radius:14px;margin:0 0 16px;font-size:13px;line-height:1.6;color:#1d4f8c;box-shadow:0 1px 2px rgba(15,27,45,.05)}.demo-hint b{color:#0d4ea6}.demo-hint a{color:#1668d3;font-weight:600}@media (max-width:900px){.demo-hint{margin-bottom:12px}}</style></head>')
  .replace('<div id="configBanner"', `<div class="demo-hint"><b>Interactive demo — fictional data only.</b> Customer: demo@pharmago.test / demo123 · Pharmacy: vendor@pharmago.test / demo123 · Admin key: changeme-admin-key. Sign in and open My prescriptions to view the sample file, or order Vitamin C against the approved one. New verification codes appear on this page or in the <a href="/__mailbox" target="_blank" rel="noopener">demo mailbox</a>; data resets when the server restarts.</div>\n<div id="configBanner"`);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(body));
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
    return res.end(html);
  }
  if (req.method === 'GET' && url.pathname === '/__mailbox') {
    const rows = stub.state.mailbox.slice().reverse().map(mail =>
      '<article class="mail"><header><b>' + escapeHtml(mail.subject) + '</b>' +
      '<span class="to">to ' + escapeHtml(mail.to) + '</span></header>' +
      '<pre>' + escapeHtml(mail.body) + '</pre></article>').join('') ||
      '<p class="empty">No demo mail yet — register an account and a code will land here.</p>';
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
    return res.end(['<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="theme-color" content="#1668d3"><title>PharmaGo demo mailbox</title>',
      '<link rel="stylesheet" href="/fonts/fonts.css">',
      '<style>',
      ':root{--brand:#1668d3;--brand-dark:#0d4ea6;--line:#e4e9f1;--ink:#0f1b2d;--muted:#64748b}',
      '*{box-sizing:border-box}body{margin:0;padding:32px 20px 56px;color:var(--ink);background:#f5f7fb;',
      'font:15px/1.55 Inter,"Segoe UI",system-ui,sans-serif;',
      'background-image:linear-gradient(rgba(15,27,45,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(15,27,45,.03) 1px,transparent 1px);',
      'background-size:100% 26px,26px 100%;background-attachment:fixed}',
      'main{max-width:820px;margin:0 auto}',
      'h1{margin:0;font-size:22px;letter-spacing:-.02em}',
      '.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}',
      '.mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;color:#fff;',
      'background:linear-gradient(155deg,#2b83ea,#0d4ea6)}',
      '.tag{margin-left:auto;padding:3px 10px;border-radius:999px;background:#fff5e2;border:1px solid #f2dcaa;',
      'color:#9a6410;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}',
      'p.lead{margin:0 0 22px;color:var(--muted);font-size:13.5px}a{color:var(--brand);font-weight:600}',
      '.mail{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:12px 0;',
      'box-shadow:0 1px 2px rgba(15,27,45,.05)}',
      '.mail header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;',
      'padding-bottom:10px;border-bottom:1px solid #eef1f6}',
      '.mail b{font-size:14px}.to{font:500 11.5px/1.4 "IBM Plex Mono",monospace;color:var(--muted)}',
      '.mail pre{margin:12px 0 0;white-space:pre-wrap;font:500 12.5px/1.6 "IBM Plex Mono",monospace;color:#33465e}',
      '.empty{padding:28px;text-align:center;color:var(--muted);background:#fff;',
      'border:1px dashed var(--line);border-radius:14px}',
      '</style></head><body><main>',
      '<div class="bar"><span class="mark" aria-hidden="true">',
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
      '</span><h1>PharmaGo demo mailbox</h1><span class="tag">Fictional data</span></div>',
      '<p class="lead">In-memory messages only — nothing is emailed. <a href="/">Back to app</a></p>',
      rows, '</main></body></html>'].join(''));
  }
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok:true });
  const staticFile = {
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
    '/icon.svg': ['icon.svg', 'image/svg+xml'],
    '/icon-192.png': ['icon-192.png', 'image/png'],
    '/icon-512.png': ['icon-512.png', 'image/png'],
  }[url.pathname] || (/^\/fonts\/[\w.-]+\.woff2$/.test(url.pathname)
    ? [url.pathname.slice(1), 'font/woff2']
    : /^\/fonts\/[\w.-]+\.css$/.test(url.pathname)
      ? [url.pathname.slice(1), 'text/css; charset=utf-8'] : null);
  if (req.method === 'GET' && staticFile) {
    const file = path.join(__dirname, '..', staticFile[0]);
    if (!fs.existsSync(file)) return json(res, 404, { success:false, message:'Not found' });
    res.writeHead(200, {
      'Content-Type': staticFile[1],
      'Cache-Control': staticFile[1] === 'font/woff2' ? 'public, max-age=31536000, immutable' : 'no-store'
    });
    return res.end(fs.readFileSync(file));
  }
  if (req.method !== 'POST' || url.pathname !== '/api') return json(res, 404, { success:false, message:'Not found' });
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 20 * 1024 * 1024) req.destroy();
  });
  req.on('end', () => {
    try {
      const payload = JSON.parse(raw);
      const result = call(payload);
      if (result.success) {
        if (!result.data || typeof result.data !== 'object') result.data = {};
        const email = payload.email;
        if (['register','register_merchant','resend_otp'].includes(payload.action) && email) {
          result.data.demoOtp = stub.helpers.lastOtp(email);
        }
      }
      if (result.success && payload.action === 'forgot_password') {
        const id = String(payload.loginId || '');
        const user = stub.helpers.sheetRows('Users').find(row => String(row[0]) === id || String(row[1]).toLowerCase() === id.toLowerCase());
        result.data = Object.assign({}, result.data, { demoToken:user ? stub.helpers.lastResetToken(user[1]) : null });
      }
      json(res, 200, result);
    } catch (err) { json(res, 400, { success:false, message:'Invalid demo request: ' + err.message }); }
  });
}).listen(Number(process.env.PORT || 8000), '0.0.0.0', () => {
  console.log('PharmaGo demo listening on 0.0.0.0:' + (process.env.PORT || 8000));
});
