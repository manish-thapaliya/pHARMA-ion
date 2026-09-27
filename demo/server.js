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
call({ action:'upload_rx', userId:customer.data.userId, fileName:'sample-rx.png',
  fileType:'image/png', fileBase64:sampleRx });
const followUp = call({ action:'upload_rx', userId:customer.data.userId, fileName:'follow-up-rx.png',
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
  '<meta name="pharmago-demo" content="true"><style>.demo-hint{background:#fffdfb;border:1px solid #d7e8dc;padding:14px 18px;border-radius:16px;margin:0 0 16px;font-size:13.5px;color:#174e3b;box-shadow:0 10px 24px #2347380c}</style></head>')
  .replace('<div id="configBanner"', `<div class="demo-hint"><b>Interactive demo — fictional data only.</b> Customer: demo@pharmago.test / demo123 · Pharmacy: vendor@pharmago.test / demo123 · Admin key: changeme-admin-key. Sign in and open My prescriptions, or unlock Admin, to view the sample prescription. New verification codes appear on this page or in the <a href="/__mailbox" target="_blank" rel="noopener">demo mailbox</a>; data resets when the server restarts.</div>\n<div id="configBanner"`);

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
      '<article style="border:1px solid #ddd;padding:16px;margin:12px 0;border-radius:8px"><b>' +
      escapeHtml(mail.subject) + '</b> · ' + escapeHtml(mail.to) +
      '<pre style="white-space:pre-wrap">' + escapeHtml(mail.body) + '</pre></article>').join('');
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
    return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Demo mailbox</title>' +
      '<main style="max-width:800px;margin:40px auto;font-family:system-ui"><h1>PharmaGo demo mailbox</h1>' +
      '<p>Fictional in-memory messages only. <a href="/">Back to app</a></p>' + rows + '</main></html>');
  }
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok:true });
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
