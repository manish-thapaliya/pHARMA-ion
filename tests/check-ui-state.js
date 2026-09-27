#!/usr/bin/env node
/** Browser-like UI state checks against the actual index.html script. */
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
function setup() {
  const calls = [];
  const replies = {
    register: { success:true, message:'Registered', data:{userId:'U-2026-0010',demoOtp:'123456'} },
    verify_email: { success:true, message:'Verified', data:{passwordSet:true} },
    login: { success:true, message:'Welcome', data:{userId:'U-2026-0010',role:'USER',name:'Alex'} },
    get_medicines: { success:true, data:[{MedicineID:'MED1',Name:'<script>bad</script>',Price:149,Stock:4,ShopName:'Green Cross'}] },
    get_data: { success:true, data:[] },
    forgot_password: { success:true, message:'Link sent', data:{demoToken:'token-123'} },
    reset_password: { success:true, message:'Password set' },
  };
  const dom = new JSDOM(html, {
    url:'https://pharmago.example/', runScripts:'dangerously',
    beforeParse(w) {
      w.fetch = async (_url, opts) => {
        const payload = JSON.parse(opts.body);
        calls.push(payload);
        const reply = replies[payload.action] || { success:true, message:'OK', data:[] };
        return { text:async () => JSON.stringify(reply) };
      };
      w.confirm = () => false;
      w.prompt = () => 'demo123';
    },
  });
  const w = dom.window, d = w.document;
  const id = name => d.getElementById(name);
  const last = () => calls[calls.length - 1];
  return { dom, w, d, id, calls, last, replies };
}
async function run() {
  const { dom, w, d, id, calls, last, replies } = setup();
  try {
    // Guest state (8).
    check(/Not logged in/.test(id('sessionBar').textContent), 'guest session');
    check(d.querySelector('[data-show="admin"]').hidden, 'admin tools hidden');
    check(!d.querySelector('#user [data-show="guest,merchant"]').hidden, 'guest prescription hint');
    check(d.querySelector('#user [data-show="user"]').hidden, 'guest upload hidden');
    check(!d.querySelector('#merchant [data-show="guest,user"]').hidden, 'guest vendor hint');
    check(d.querySelector('#merchant [data-show="merchant"]').hidden, 'guest vendor tools hidden');
    check(!!d.querySelector('.brand'), 'brand displayed');
    check(d.querySelectorAll('[data-show]').length === 5, 'stateful sections present');

    // Navigation (5).
    id('tabShop').click();
    check(id('tabShop').classList.contains('active'), 'shop tab active');
    check(!id('tabLogin').classList.contains('active'), 'login tab inactive');
    check(id('shop').classList.contains('active'), 'shop panel active');
    id('tabMerchant').click();
    check(id('tabMerchant').classList.contains('active'), 'merchant tab active');
    check(!id('login').classList.contains('active'), 'login panel inactive');

    // Registration (7).
    await w.doRegister();
    check(!calls.some(c => c.action === 'register'), 'incomplete registration not sent');
    check(id('loginMsg').classList.contains('err'), 'registration error shown');
    id('rEmail').value = 'alex@example.test'; id('rPhone').value = '9800000011';
    id('rPass').value = 'secret123'; id('rPass2').value = 'not-same';
    await w.doRegister();
    check(!calls.some(c => c.action === 'register'), 'mismatched password blocked');
    id('rPass2').value = 'secret123';
    await w.doRegister();
    check(last().action === 'register', 'registration submitted');
    check(id('vIdShow').textContent === 'U-2026-0010', 'new sequential ID displayed');
    check(id('viewVerify').style.display !== 'none', 'verify view shown');
    check(/123456/.test(id('verifyMsg').textContent), 'demo code shown');

    // Verification (6).
    await w.doVerify();
    check(id('verifyMsg').classList.contains('err'), 'incomplete OTP error');
    check(last().action === 'register', 'incomplete OTP not sent');
    d.querySelectorAll('.otp').forEach((el, i) => { el.value = String(i + 1); });
    check(w.readOtp('.otp') === '123456', 'OTP boxes collect six digits');
    await w.doVerify();
    check(last().action === 'verify_email', 'verification submitted');
    check(id('viewLogin').style.display !== 'none', 'login shown after verify');
    check(id('lId').value === 'alex@example.test', 'email carried to login');

    // Customer login (6).
    replies.login = { success:false, message:'Invalid password' };
    await w.doLogin();
    check(id('loginMsg').classList.contains('err'), 'failed login shown');
    check(!w.localStorage.getItem('pharmago_session'), 'failure not persisted');
    replies.login = { success:true, data:{userId:'U-2026-0010',role:'USER',name:'Alex'} };
    await w.doLogin();
    check(/Alex/.test(id('sessionBar').textContent), 'name shown after login');
    check(id('user').classList.contains('active'), 'customer portal opens');
    check(!d.querySelector('#user [data-show="user"]').hidden, 'customer upload shown');
    check(d.querySelector('#user [data-show="guest,merchant"]').hidden, 'guest hint hidden');

    // Catalogue (5).
    id('tabShop').click();
    check(last().action === 'get_medicines', 'catalogue requested');
    await w.loadMedicines();
    check(/MED1/.test(id('medTbl').textContent), 'medicine displayed');
    check(/149/.test(id('medTbl').textContent), 'price displayed');
    check(/1 medicine/.test(id('shopMsg').textContent), 'count displayed');
    check(!id('medTbl').querySelector('script'), 'medicine text escaped');

    // Vendor state (5).
    replies.login = { success:true, data:{userId:'M123',role:'MERCHANT',name:'Green Cross'} };
    await w.doLogin();
    check(id('merchant').classList.contains('active'), 'vendor portal opens');
    check(!d.querySelector('#merchant [data-show="merchant"]').hidden, 'vendor tools shown');
    check(d.querySelector('#merchant [data-show="guest,user"]').hidden, 'vendor hint hidden');
    check(d.querySelector('#user [data-show="user"]').hidden, 'customer tools hidden for vendor');
    check(calls.some(c => c.action === 'get_data' && c.merchantId === 'M123'), 'own listings requested');

    // Admin unlock (7).
    replies.get_data = { success:false, message:'Admin key required' };
    id('adminKey').value = 'bad'; await w.adminAuth();
    check(d.querySelector('[data-show="admin"]').hidden, 'invalid key keeps tools hidden');
    check(id('adminMsg').classList.contains('err'), 'invalid key explained');
    replies.get_data = { success:true, data:[] };
    id('adminKey').value = 'test-key'; await w.adminAuth();
    check(!d.querySelector('[data-show="admin"]').hidden, 'valid key reveals tools');
    check(w.sessionStorage.getItem('pharmago_adminkey') === 'test-key', 'key in session only');
    check(last().adminKey === 'test-key', 'key verified against backend');
    check(/Unlocked/.test(id('adminState').textContent), 'admin indicator updated');
    check(!w.localStorage.getItem('pharmago_adminkey'), 'admin key not saved persistently');

    // Forgot/reset (5).
    id('fId').value = ''; await w.doForgot();
    check(id('forgotMsg').classList.contains('err'), 'forgot requires ID');
    id('fId').value = 'alex@example.test'; await w.doForgot();
    check(id('viewReset').style.display !== 'none', 'demo reset view opens');
    check(w.sessionStorage.getItem('pharmago_token') === 'token-123', 'demo reset token retained');
    id('np1').value = 'secret123'; id('np2').value = 'different'; await w.doReset();
    check(last().action === 'forgot_password', 'mismatched reset not submitted');
    id('np2').value = 'secret123'; await w.doReset();
    check(last().action === 'reset_password', 'reset submitted');

    // Logout (7).
    w.logout();
    check(!w.localStorage.getItem('pharmago_session'), 'logout clears stored session');
    check(/Not logged in/.test(id('sessionBar').textContent), 'guest status restored');
    check(id('login').classList.contains('active'), 'logout returns to account');
    check(d.querySelector('#user [data-show="user"]').hidden, 'upload hidden on logout');
    check(!d.querySelector('#user [data-show="guest,merchant"]').hidden, 'guest hint restored');
    check(d.querySelector('#merchant [data-show="merchant"]').hidden, 'vendor tools hidden');
    check(d.querySelector('[data-show="admin"]').hidden, 'admin tools locked on logout');
  } finally { dom.window.close(); }
  if (checks !== 61) throw Error('Expected 61 UI-state checks, got ' + checks);
  console.log('✓ 61 UI-state checks passed');
}
run().catch(err => { console.error('✗ ' + err.stack); process.exitCode = 1; });
