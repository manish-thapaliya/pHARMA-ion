#!/usr/bin/env node
/** Exercise the real frontend state machine in a browser-like DOM. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
let checks = 0;
function check(value, label) {
  checks++;
  if (!value) throw Error('UI check ' + checks + ': ' + label);
}
function setup(url = 'https://pharmago.example/') {
  const calls = [];
  const rx = [
    { RxID:'RX1', UserID:'U-2026-0010', FileName:'pending.pdf', Status:'PENDING', Timestamp:'today' },
    { RxID:'RX2', UserID:'U-2026-0010', FileName:'reviewed.pdf', Status:'APPROVED', Timestamp:'yesterday' },
  ];
  const meds = [
    { MedicineID:'MED1', Name:'Vitamin C', Category:'Supplement', Price:149, Stock:4, Active:'YES', ShopName:'Green Cross' },
    { MedicineID:'MED2', Name:'Other', Category:'Tablet', Price:30, Stock:1, Active:'NO' },
  ];
  const users = [
    { UserID:'U-2026-0010', Email:'alex@example.test', Role:'USER', Status:'ACTIVE' },
    { UserID:'M123', Email:'vendor@example.test', Role:'MERCHANT', Status:'ACTIVE' },
  ];
  const merchants = [
    { MerchantID:'M123', ShopName:'Green Cross', Status:'APPROVED', DocFileIds:'GST:file123' },
    { MerchantID:'M456', ShopName:'New Pharmacy', Status:'PENDING', DocFileIds:'PAN:file456' },
  ];
  const replies = {
    login: { success:true, data:{userId:'U-2026-0010',role:'USER',name:'Alex'} },
    register: { success:true, message:'Registered', data:{userId:'U-2026-0011',demoOtp:'123456'} },
    verify_email: { success:true, message:'Verified', data:{passwordSet:true} },
    get_medicines: { success:true, data:[meds[0]] },
    forgot_password: { success:true, message:'Link sent', data:{demoToken:'token-123'} },
    reset_password: { success:true, message:'Password set' },
  };
  const dom = new JSDOM(html, {
    url, runScripts:'dangerously',
    beforeParse(w) {
      w.fetch = async (_url, opts) => {
        const p = JSON.parse(opts.body);
        calls.push(p);
        let reply = replies[p.action];
        if (p.action === 'get_data') {
          reply = p.adminKey === 'bad' ? {success:false, message:'Admin key required'} :
            {success:true, data:({ Users:users, Prescriptions:rx, Merchants:merchants, Medicines:meds })[p.sheetName] || []};
        }
        return { text:async () => JSON.stringify(reply || {success:true,message:'OK',data:[]}) };
      };
      w.prompt = () => 'demo123';
      w.confirm = () => false;
    },
  });
  return { dom, w:dom.window, d:dom.window.document, id:n => dom.window.document.getElementById(n), calls, replies };
}
async function run() {
  const { dom, w, d, id, calls, replies } = setup();
  const last = () => calls[calls.length - 1];
  try {
    // Guest (12).
    check(/guest/.test(id('sessionBar').textContent), 'guest badge');
    check(!id('tabLogin').hidden, 'guest account tab');
    check(id('tabUser').hidden, 'guest cannot open customer portal');
    check(!id('tabShop').hidden, 'guest catalogue tab');
    check(!id('tabMerchant').hidden, 'guest pharmacy tab');
    check(!id('tabAdmin').hidden, 'guest admin tab');
    check(!id('vendorRegister').hidden, 'guest registration form');
    check(id('vendorTools').hidden, 'guest listing tools hidden');
    check(!id('adminLockCard').hidden, 'admin lock card shown');
    check(id('adminDashboard').hidden, 'admin dashboard hidden');
    check(id('logoutBtn').hidden, 'guest sign-out hidden');
    check(id('login').classList.contains('active'), 'account is landing panel');

    // Navigation and catalogue (6).
    id('tabShop').click();
    check(id('shop').classList.contains('active'), 'shop panel opens');
    check(last().action === 'get_medicines', 'catalogue requested');
    await w.loadMedicines();
    check(/Vitamin C/.test(id('medTbl').textContent), 'catalogue rendered');
    check(/149/.test(id('medTbl').textContent), 'price rendered');
    id('medSearch').value = 'no match'; w.renderMedicines();
    check(!/Vitamin C/.test(id('medTbl').textContent), 'search filters rows');
    check(/0 medicine/.test(id('shopMsg').textContent), 'filtered count shown');

    // Registration and verification (8).
    await w.doRegister();
    check(!calls.some(c => c.action === 'register'), 'empty registration blocked');
    id('rEmail').value = 'new@example.test'; id('rPhone').value = '9800000011';
    id('rPass').value = 'secret123'; id('rPass2').value = 'mismatch';
    await w.doRegister();
    check(!calls.some(c => c.action === 'register'), 'mismatched password blocked');
    id('rPass2').value = 'secret123'; await w.doRegister();
    check(last().action === 'register', 'registration sent');
    check(id('viewVerify').style.display !== 'none', 'OTP screen shown');
    check(id('vIdShow').textContent === 'U-2026-0011', 'new user ID shown');
    check(/123456/.test(id('verifyMsg').textContent), 'demo OTP shown');
    await w.doVerify();
    check(last().action === 'register', 'incomplete OTP blocked');
    d.querySelectorAll('.otp').forEach((box, i) => { box.value = String(i + 1); });
    await w.doVerify();
    check(last().action === 'verify_email', 'OTP submitted');

    // Customer session (8).
    replies.login = { success:false, message:'Wrong password' }; await w.doLogin();
    check(id('loginMsg').classList.contains('err'), 'failed login message');
    check(!w.localStorage.getItem('pharmago_session'), 'failed login not stored');
    replies.login = { success:true, data:{userId:'U-2026-0010',role:'USER',name:'Alex'} }; await w.doLogin();
    check(id('tabLogin').hidden, 'account tab hidden for customer');
    check(!id('tabUser').hidden, 'customer portal tab visible');
    check(id('user').classList.contains('active'), 'customer lands in portal');
    check(/Customer/.test(id('sessionBar').textContent), 'customer badge');
    check(id('vendorRegister').hidden, 'registration hidden for customer');
    check(!id('logoutBtn').hidden, 'customer can sign out');

    // Merchant session (8).
    w.logout();
    check(id('login').classList.contains('active'), 'logout returns to guest account');
    replies.login = { success:true, data:{userId:'M123',role:'MERCHANT',name:'Green Cross'} }; await w.doLogin();
    check(id('tabUser').hidden, 'vendor cannot open customer portal');
    check(id('merchant').classList.contains('active'), 'vendor lands in shop');
    check(!id('vendorTools').hidden, 'vendor listing tools shown');
    check(id('vendorRegister').hidden, 'vendor registration hidden');
    check(/My shop/.test(id('tabMerchant').textContent), 'vendor navigation relabelled');
    await w.loadMyListings();
    check(/MED1/.test(id('myMedTbl').textContent), 'own listings displayed');
    check(!!id('myMedTbl').querySelector('[onclick^="editMyMedicine"]'), 'edit action available');

    // Admin independently unlockable on top of a vendor session (13).
    id('adminKey').value = 'bad'; await w.adminAuth();
    check(id('adminDashboard').hidden, 'invalid key leaves admin hidden');
    check(id('adminMsg').classList.contains('err'), 'invalid key error shown');
    id('adminKey').value = 'test-key'; await w.adminAuth();
    check(!id('adminDashboard').hidden, 'dashboard appears');
    check(id('adminLockCard').hidden, 'lock card hides');
    check(/Admin/.test(id('sessionBar').textContent), 'admin badge stacks with vendor');
    check(id('statUsers').textContent === '1', 'customer count');
    check(id('statRx').textContent === '1', 'pending prescription count');
    check(id('statVendors').textContent === '1', 'pending pharmacy count');
    check(id('statMedicines').textContent === '1', 'active medicine count');
    check(/RX1/.test(id('pendingRx').textContent), 'pending prescription identified');
    id('rxFilter').value = 'ALL'; w.renderAdminRx();
    check(/RX2/.test(id('pendingRx').textContent), 'reviewed prescription ID identified');
    check(!!id('merchantList').querySelector('a[href="https://drive.google.com/file/d/file456/view"]'), 'KYC document link');
    check(!!id('adminMedicineList').querySelector('[onclick^="setMedicineActive"]'), 'admin catalogue actions');

    // Lock, sign out, and reset deep-link (6).
    w.lockAdmin();
    check(id('adminDashboard').hidden, 'lock hides dashboard');
    check(id('adminLockCard').hidden === false, 'lock shows key form');
    check(!id('logoutBtn').hidden, 'locking admin preserves vendor login');
    w.logout();
    check(id('login').classList.contains('active'), 'sign out returns to account');
    check(!w.localStorage.getItem('pharmago_session'), 'session removed');
    check(id('vendorRegister').hidden === false, 'guest registration restored');
  } finally { dom.window.close(); }
  if (checks !== 61) throw Error('Expected 61 UI-state checks, got ' + checks);
  console.log('✓ 61 UI-state checks passed');
}
run().catch(err => { console.error('✗ ' + err.stack); process.exitCode = 1; });
