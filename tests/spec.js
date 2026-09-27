/**
 * End-to-end spec for code.gs, executed inside the mocked Apps Script runtime
 * (see tests/apps-script-stub.js). This file is evaluated in the same VM
 * context as code.gs, so every function/const from code.gs is in scope.
 *
 * Add scenarios here and run:  npm test      (or: node tests/run-tests.js)
 */
globalThis.runTests = function runTests() {
  const H = MOCK.helpers;
  const results = [];

  // ---------------- assertions ----------------
  let current = null;
  function scenario(name, fn) {
    current = { name, failures: [], checks: 0 };
    results.push(current);
    H.reset();
    try {
      fn();
    } catch (err) {
      current.failures.push('threw: ' + (err && err.message ? err.message : err));
    }
    current = null;
  }
  function ok(cond, label, detail) {
    if (!current) throw new Error('ok() outside scenario');
    current.checks++;
    if (!cond) current.failures.push(label + (detail ? ' (got: ' + detail + ')' : ''));
    return !!cond;
  }
  function eq(actual, expected, label) {
    return ok(actual === expected, label, JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
  function truthy(v, label) { return ok(!!v, label, String(v)); }

  // ---------------- helpers ----------------
  const call = (payload) => H.json(doPost(H.postEvent(payload)));
  const form = (fields) => doPost(H.formEvent(fields));
  const get = (params) => doGet(H.getEvent(params));

  function boot() { return call({ action: 'setup' }); }

  /** Register a customer and return {userId, email, phone}. */
  function registerCustomer(email, phone, name) {
    const res = call({ action: 'register', email, phone, name: name || 'Test User' });
    ok(res.success, 'register ' + email + ' succeeds', res.message);
    return { userId: res.data && res.data.userId, email, phone, otp: H.lastOtp(email) };
  }

  /** Register + verify a customer (password set at verification time). */
  function verifiedCustomer(email, phone, password) {
    const u = registerCustomer(email, phone);
    const v = call({ action: 'verify_email', userId: u.userId, otp: u.otp, password });
    ok(v.success, 'verify_email succeeds for ' + email, v.message);
    ok(H.findRow('Users', 0, u.userId)[6] === 'ACTIVE', 'user status is ACTIVE after OTP');
    return u;
  }

  // =====================================================================
  scenario('setup creates every sheet with headers', () => {
    const res = boot();
    ok(res.success, 'setup succeeds', res.message);
    ['Users', 'Prescriptions', 'Merchants', 'Medicines', 'Otps'].forEach((n) => {
      ok(!!H.sheet(n), 'sheet "' + n + '" exists');
    });
    eq(H.sheetRows('Users')[0].join('|'),
      'UserID|Email|Phone|Password|Role|Name|Status|CreatedAt', 'Users header row');
  });

  // =====================================================================
  // =====================================================================
  scenario('customer IDs increment from U-YYYY-0010 without reusing deleted rows', () => {
    boot();
    const year = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
    const first = registerCustomer('seq1@example.com', '9800000091');
    eq(first.userId, 'U-' + year + '-0010', 'first customer gets 0010');
    const second = registerCustomer('seq2@example.com', '9800000092');
    eq(second.userId, 'U-' + year + '-0011', 'second customer gets 0011');
    H.sheetRows('Users').push(['ULEGACY', 'legacy@example.com']);
    H.sheetRows('Users').push(['U-' + year + '-0040', 'high@example.com']);
    const next = registerCustomer('seq3@example.com', '9800000093');
    eq(next.userId, 'U-' + year + '-0041', 'sequence resumes above existing IDs');
  });

  scenario('customer registration: unique email + phone, OTP verify, login', () => {
    boot();
    const u = verifiedCustomer('a@example.com', '9800000001', 'secret123');

    const dupEmail = call({ action: 'register', email: 'A@example.com', phone: '9800000009' });
    ok(!dupEmail.success, 'duplicate email rejected (case-insensitive)');
    const dupPhone = call({ action: 'register', email: 'b@example.com', phone: '98-0000-0001' });
    ok(!dupPhone.success, 'duplicate phone rejected (digits normalised)');

    const bad = call({ action: 'login', loginId: u.email, password: 'wrong' });
    ok(!bad.success, 'wrong password rejected');
    const good = call({ action: 'login', loginId: u.email, password: 'secret123' });
    ok(good.success, 'login with correct password', good.message);
    eq(good.data.role, 'USER', 'login returns role USER');
    const byId = call({ action: 'login', loginId: u.userId, password: 'secret123' });
    ok(byId.success, 'login by userId also works');

    // OTP is single use
    const again = call({ action: 'verify_email', userId: u.userId, otp: u.otp });
    ok(!again.success, 'OTP cannot be reused');
  });

  // =====================================================================
  scenario('OTP wrong code, attempts limit and expiry', () => {
    boot();
    const u = registerCustomer('c@example.com', '9800000002');
    const wrong = call({ action: 'verify_email', userId: u.userId, otp: '000000' });
    ok(!wrong.success, 'wrong OTP rejected');
    ok(/1\/5/.test(wrong.message), 'attempts counter is reported', wrong.message);

    for (let i = 0; i < 4; i++) call({ action: 'verify_email', userId: u.userId, otp: '000000' });
    const locked = call({ action: 'verify_email', userId: u.userId, otp: u.otp });
    ok(!locked.success && /attempts/i.test(locked.message), 'account locks after 5 wrong attempts',
      locked.message);

    // expiry
    const v = registerCustomer('exp@example.com', '9800000003');
    const rows = H.sheetRows('Otps');
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === 'VERIFY:' + v.userId) {
        rows[i][3] = new Date(Date.now() - 60000).toISOString();
      }
    }
    const expired = call({ action: 'verify_email', userId: v.userId, otp: v.otp });
    ok(!expired.success && /expired/i.test(expired.message), 'expired OTP rejected', expired.message);

    // resend issues a fresh code
    const re = call({ action: 'resend_otp', email: 'exp@example.com' });
    ok(re.success, 'resend_otp works', re.message);
    const fresh = H.lastOtp('exp@example.com');
    ok(fresh && fresh !== v.otp, 'resend issues a new code');
    ok(call({ action: 'verify_email', userId: v.userId, otp: fresh }).success, 'new code verifies');
  });

  // =====================================================================
  scenario('password set through mail (forgot password -> emailed link -> login)', () => {
    boot();
    const u = registerCustomer('pw@example.com', '9800000004');
    call({ action: 'verify_email', userId: u.userId, otp: u.otp }); // no password given

    const noPass = call({ action: 'login', loginId: u.email, password: 'anything' });
    ok(!noPass.success, 'login blocked until a password exists');

    const forgot = call({ action: 'forgot_password', loginId: u.email });
    ok(forgot.success, 'forgot_password sends mail', forgot.message);
    ok(!/pw@example\.com/.test(forgot.message),
      'reply never echoes back the account email', forgot.message);
    ok(H.lastMail('pw@example.com') !== null, 'mail was actually sent to the account');

    const token = H.lastResetToken('pw@example.com');
    truthy(token, 'reset token was emailed');

    const reset = call({ action: 'reset_password', token, password: 'newpass123' });
    ok(reset.success, 'reset_password with emailed token works', reset.message);

    const login = call({ action: 'login', loginId: u.email, password: 'newpass123' });
    ok(login.success, 'login works after setting password by mail', login.message);

    const reuse = call({ action: 'reset_password', token, password: 'otherpass1' });
    ok(!reuse.success, 'reset token is single use');

    const short = call({ action: 'forgot_password', loginId: u.email });
    ok(short.success, 'second reset mail sent');
    const t2 = H.lastResetToken('pw@example.com');
    ok(!call({ action: 'reset_password', token: t2, password: '123' }).success,
      'password shorter than 6 chars rejected');

    const unknown = call({ action: 'forgot_password', loginId: 'nobody@example.com' });
    ok(unknown.success, 'unknown account is not confirmed nor denied', unknown.message);
    ok(!/not found|no account|unknown/i.test(unknown.message),
      'unknown account message does not leak existence', unknown.message);
    ok(H.lastMail('nobody@example.com') === null, 'no mail is sent to unknown addresses');
  });

  // =====================================================================
  scenario('emailed reset link opens a usable set-password page', () => {
    boot();
    const html = get({ action: 'pwreset', token: 'tok-abc-123' }).getContent();
    ok(/tok-abc-123/.test(html), 'page carries the token', html.slice(0, 120));
    const pointsToPlaceholder = /USERNAME\.github\.io|REPLACE_WITH/.test(html);
    ok(!pointsToPlaceholder || /type="password"/.test(html),
      'page either redirects to a real frontend URL or renders its own password form');
  });

  // =====================================================================
  scenario('prescription upload -> pending folder -> admin approve moves file', () => {
    boot();
    const u = verifiedCustomer('rx@example.com', '9800000005', 'secret123');
    const content = H.b64('%PDF-1.4 fake prescription');

    const up = call({
      action: 'upload_rx', userId: u.userId, fileName: 'my Rx scan.pdf',
      fileType: 'application/pdf', fileBase64: content,
    });
    ok(up.success, 'upload_rx succeeds', up.message);
    truthy(up.data && up.data.rxId, 'rxId returned');

    const rx = H.findRow('Prescriptions', 0, up.data.rxId);
    eq(rx[4], 'PENDING', 'new prescription is PENDING');
    ok(/my Rx scan\.pdf$/.test(rx[2]), 'original file name is preserved', rx[2]);
    ok(/^[\w.\- ]+\.pdf$/.test(rx[2]), 'stored file name contains no unsafe characters', rx[2]);
    ok(rx[2].indexOf(u.userId + '_') === 0, 'stored file name is prefixed with the user id', rx[2]);
    const pending = H.folder('Pending Rx');
    ok(pending.fileNames().indexOf(rx[2]) !== -1, 'file lands in the Pending folder',
      pending.fileNames().join(','));
    const file = pending.fileIds.map((id) => H.fileById(id)).find((f) => f.name === rx[2]);
    ok(file.sharing && file.sharing.access === 'ANYONE_WITH_LINK',
      'prescription is viewable by link (admin/user can open it)');

    // unauthorised review
    const denied = call({ action: 'update_status', adminKey: 'nope', rxId: up.data.rxId, status: 'APPROVED' });
    ok(!denied.success, 'admin action needs the admin key');

    const approved = call({
      action: 'update_status', adminKey: 'changeme-admin-key', rxId: up.data.rxId,
      status: 'APPROVED', note: 'looks valid',
    });
    ok(approved.success, 'admin can approve', approved.message);

    const row = H.findRow('Prescriptions', 0, up.data.rxId);
    eq(row[4], 'APPROVED', 'status becomes APPROVED');
    truthy(row[6], 'reviewedAt recorded');
    eq(row[7], 'looks valid', 'review note recorded');

    ok(H.folder('Approved Rx').fileNames().length === 1, 'file moved to the Approved folder',
      H.folder('Approved Rx').fileNames().join(','));
    ok(H.folder('Pending Rx').fileNames().length === 0, 'file removed from the Pending folder');
    ok(H.folder('Approved Rx').fileNames()[0].indexOf(u.userId + '__') === 0,
      'approved file renamed to UserID__UploadTime', H.folder('Approved Rx').fileNames()[0]);

    const rereview = call({
      action: 'update_status', adminKey: 'changeme-admin-key', rxId: up.data.rxId, status: 'DECLINED',
    });
    ok(!rereview.success, 'already reviewed prescription cannot be re-reviewed');

    // decline path
    const up2 = call({
      action: 'upload_rx', userId: u.userId, fileName: 'second.pdf',
      fileType: 'application/pdf', fileBase64: content,
    });
    ok(call({
      action: 'update_status', adminKey: 'changeme-admin-key', rxId: up2.data.rxId,
      status: 'DECLINED', note: 'unreadable',
    }).success, 'admin can decline');
    ok(H.folder('Declined Rx').fileNames().length === 1, 'declined file moved to Declined folder',
      H.folder('Declined Rx').fileNames().join(','));
  });

  // =====================================================================
  scenario('user history only shows that user\'s prescriptions', () => {
    boot();
    const a = verifiedCustomer('h1@example.com', '9800000006', 'secret123');
    const b = verifiedCustomer('h2@example.com', '9800000007', 'secret123');
    const content = H.b64('rx');
    [[a, 'a1.pdf'], [a, 'a2.pdf'], [b, 'b1.pdf']].forEach(([u, f]) => {
      call({ action: 'upload_rx', userId: u.userId, fileName: f, fileType: 'application/pdf', fileBase64: content });
    });

    const ra = call({ action: 'get_data', sheetName: 'Prescriptions', userId: a.userId });
    ok(ra.success, 'get_data for own history works', ra.message);
    eq(ra.data.length, 2, 'user A sees only their 2 prescriptions');
    ok(ra.data.every((r) => r.UserID === a.userId), 'no other user rows leak');

    const rb = call({ action: 'get_data', sheetName: 'Prescriptions', userId: b.userId });
    eq(rb.data.length, 1, 'user B sees only their 1 prescription');

    const adminAll = call({ action: 'get_data', sheetName: 'Prescriptions', adminKey: 'changeme-admin-key' });
    ok(adminAll.success && adminAll.data.length === 3, 'admin key can list all prescriptions',
      adminAll.message);
  });

  // =====================================================================
  scenario('private data (users / merchants / all Rx) requires the admin key', () => {
    boot();
    verifiedCustomer('s1@example.com', '9800000008', 'secret123');

    const users = call({ action: 'get_data', sheetName: 'Users' });
    ok(!users.success, 'Users list blocked without admin key');
    const merchants = call({ action: 'get_data', sheetName: 'Merchants' });
    ok(!merchants.success, 'Merchants list blocked without admin key');
    const rx = call({ action: 'get_data', sheetName: 'Prescriptions' });
    ok(!rx.success, 'all-prescriptions list blocked without admin key or userId');

    ok(call({ action: 'get_data', sheetName: 'Users', adminKey: 'changeme-admin-key' }).success,
      'Users list allowed with admin key');
    const exposed = call({ action: 'get_data', sheetName: 'Users', adminKey: 'changeme-admin-key' });
    ok(exposed.data.every((u) => u.Password === undefined), 'password hashes are never returned');
    ok(/s1@example\.com/.test(JSON.stringify(exposed.data)), 'admin list contains the user');
  });

  // =====================================================================
  scenario('vendor registration: 4 documents, email OTP, admin approval, login', () => {
    boot();
    const docs = ['GST', 'DRUG_LICENSE', 'SHOP_ID', 'PAN'].map((t) => ({
      docType: t, fileName: t + '.pdf', fileType: 'application/pdf',
      fileBase64: H.b64('doc ' + t),
    }));

    const missing = call({
      action: 'register_merchant', email: 'v@example.com', phone: '9800000010',
      shopName: 'City Pharma', address: 'Kathmandu', gstNumber: 'GST1', drugLicenseNumber: 'DL1',
      documents: docs.slice(0, 2),
    });
    ok(!missing.success && /Missing documents/.test(missing.message),
      'registration requires all 4 documents', missing.message);

    const reg = call({
      action: 'register_merchant', email: 'v@example.com', phone: '9800000010',
      shopName: 'City Pharma', address: 'Kathmandu', gstNumber: 'GST1', drugLicenseNumber: 'DL1',
      documents: docs,
    });
    ok(reg.success, 'vendor registration succeeds', reg.message);
    const mid = reg.data && reg.data.merchantId;
    truthy(mid, 'merchantId returned');

    const mRow = H.findRow('Merchants', 0, mid);
    eq(mRow[8], 'PENDING', 'vendor starts PENDING');
    eq(H.findRow('Users', 0, mid)[6], 'UNVERIFIED', 'vendor login starts UNVERIFIED');
    ok(mRow[7].indexOf('GST:') !== -1 && mRow[7].indexOf('PAN:') !== -1,
      'uploaded document ids recorded', mRow[7]);
    const docFile = H.fileById(mRow[7].split(';')[0].split(':')[1]);
    ok(!!docFile, 'document actually written to Drive');
    ok(docFile.sharing && docFile.sharing.access === 'PRIVATE',
      'KYC documents stay private', JSON.stringify(docFile.sharing));

    // duplicate email/phone against customers too
    const dup = call({
      action: 'register_merchant', email: 'V@example.com', phone: '9800000099',
      shopName: 'Other', documents: docs,
    });
    ok(!dup.success, 'vendor duplicate email rejected');

    // email verification
    const otp = H.lastOtp('v@example.com');
    truthy(otp, 'vendor verification code emailed');
    const ver = call({ action: 'verify_merchant', merchantId: mid, otp });
    ok(ver.success, 'vendor email verification succeeds', ver.message);
    eq(H.findRow('Users', 0, mid)[6], 'PENDING', 'after OTP the vendor awaits admin approval');

    const tooEarly = call({ action: 'login', loginId: mid, password: 'secret123' });
    ok(!tooEarly.success && /approval/i.test(tooEarly.message),
      'vendor cannot log in before admin approval', tooEarly.message);

    // admin approval
    const noKey = call({ action: 'review_merchant', adminKey: 'nope', merchantId: mid, status: 'APPROVED' });
    ok(!noKey.success, 'review_merchant needs the admin key');
    ok(call({ action: 'review_merchant', adminKey: 'changeme-admin-key', merchantId: mid, status: 'APPROVED' }).success,
      'admin can approve the vendor');
    eq(H.findRow('Merchants', 0, mid)[8], 'APPROVED', 'Merchants status APPROVED');
    eq(H.findRow('Users', 0, mid)[6], 'ACTIVE', 'vendor login status ACTIVE after approval');
    truthy(H.findRow('Merchants', 0, mid)[11], 'reviewedAt recorded');

    // password by mail, then login
    ok(call({ action: 'forgot_password', loginId: mid }).success, 'vendor can request a password link');
    const token = H.lastResetToken('v@example.com');
    ok(call({ action: 'reset_password', token, password: 'vendorpw1' }).success,
      'vendor sets password from the emailed link');
    eq(H.findRow('Users', 0, mid)[6], 'ACTIVE', 'vendor stays ACTIVE after setting password');
    const login = call({ action: 'login', loginId: mid, password: 'vendorpw1' });
    ok(login.success, 'approved vendor can log in', login.message);
    eq(login.data.role, 'MERCHANT', 'login returns role MERCHANT');
  });

  // =====================================================================
  scenario('approved vendor can add and list medicines; admin anytime', () => {
    boot();
    const docs = ['GST', 'DRUG_LICENSE', 'SHOP_ID', 'PAN'].map((t) => ({
      docType: t, fileName: t + '.pdf', fileType: 'application/pdf',
      fileBase64: H.b64('doc ' + t),
    }));
    const mid = call({
      action: 'register_merchant', email: 'm@example.com', phone: '9800000011',
      shopName: 'Med Store', documents: docs,
    }).data.merchantId;
    call({ action: 'verify_merchant', merchantId: mid, otp: H.lastOtp('m@example.com') });

    // cannot add before approval
    const early = call({ action: 'add_medicine', merchantId: mid, password: 'vendorpw1', name: 'Crocin', price: 30 });
    ok(!early.success && /approved/i.test(early.message),
      'unapproved vendor cannot list medicines', early.message);

    call({ action: 'review_merchant', adminKey: 'changeme-admin-key', merchantId: mid, status: 'APPROVED' });
    call({ action: 'forgot_password', loginId: mid });
    call({ action: 'reset_password', token: H.lastResetToken('m@example.com'), password: 'vendorpw1' });

    const add = call({
      action: 'add_medicine', merchantId: mid, password: 'vendorpw1',
      name: 'Crocin', category: 'Tablet', price: 30, stock: 100, description: 'fever',
    });
    ok(add.success, 'approved vendor can add a medicine', add.message);
    const wrongPw = call({ action: 'add_medicine', merchantId: mid, password: 'nope', name: 'X', price: 1 });
    ok(!wrongPw.success, 'wrong vendor password rejected');

    const adminAdd = call({
      action: 'add_medicine', adminKey: 'changeme-admin-key', name: 'Aspirin', price: 20, stock: 5,
    });
    ok(adminAdd.success, 'admin can add a medicine', adminAdd.message);

    const cat = call({ action: 'get_medicines' });
    ok(cat.success, 'get_medicines works');
    eq(cat.data.length, 2, 'catalogue lists both active medicines');
    eq(cat.data[0].Name, 'Crocin', 'medicine fields returned');

    // deactivate -> hidden from catalogue
    call({ action: 'update_medicine', adminKey: 'changeme-admin-key', medId: adminAdd.data.medId, active: false });
    eq(call({ action: 'get_medicines' }).data.length, 1, 'inactive medicine hidden from catalogue');

    // vendor only sees/edits their own
    const mine = call({ action: 'get_data', sheetName: 'Medicines', merchantId: mid });
    ok(mine.success, 'vendor can list own medicines', mine.message);
    eq(mine.data.length, 1, 'vendor sees only their own listing');
    const other = call({
      action: 'update_medicine', merchantId: mid, password: 'vendorpw1',
      medId: adminAdd.data.medId, price: 99,
    });
    ok(!other.success, 'vendor cannot edit another seller\'s medicine', other.message);
    ok(call({
      action: 'update_medicine', merchantId: mid, password: 'vendorpw1',
      medId: add.data.medId, price: 35, stock: 80,
    }).success, 'vendor can edit their own medicine');
    eq(H.findRow('Medicines', 0, add.data.medId)[3], 35, 'price updated');
  });

  // =====================================================================
  scenario('declined vendor cannot log in', () => {
    boot();
    const docs = ['GST', 'DRUG_LICENSE', 'SHOP_ID', 'PAN'].map((t) => ({
      docType: t, fileName: t + '.pdf', fileType: 'application/pdf',
      fileBase64: H.b64('doc ' + t),
    }));
    const mid = call({
      action: 'register_merchant', email: 'd@example.com', phone: '9800000012',
      shopName: 'Bad Store', documents: docs,
    }).data.merchantId;
    call({ action: 'verify_merchant', merchantId: mid, otp: H.lastOtp('d@example.com') });
    call({ action: 'review_merchant', adminKey: 'changeme-admin-key', merchantId: mid, status: 'DECLINED' });
    eq(H.findRow('Users', 0, mid)[6], 'DECLINED', 'declined vendor status mirrored to Users');
    const l = call({ action: 'login', loginId: mid, password: 'x' });
    ok(!l.success && /declined/i.test(l.message), 'declined vendor blocked at login', l.message);
  });

  // =====================================================================
  scenario('malformed requests never crash the web app', () => {
    boot();
    const empty = doPost({ postData: { contents: '' }, parameter: {} });
    ok(!!empty, 'empty body returns a response');
    ok(!H.json(empty).success, 'empty body returns success:false');
    const garbage = doPost({ postData: { contents: 'not json' }, parameter: {} });
    ok(!H.json(garbage).success, 'invalid JSON returns success:false');
    const noAction = call({ hello: 'world' });
    ok(!noAction.success, 'missing action rejected');
    const unknown = call({ action: 'does_not_exist' });
    ok(!unknown.success, 'unknown action rejected');
    const doGetPing = H.json(get({ action: 'ping' }));
    ok(doGetPing && doGetPing.success, 'doGet ping works');
  });

  // =====================================================================
  scenario('generated ids stay unique when writes land in the same millisecond', () => {
    boot();
    const ids = [];
    for (let i = 0; i < 25; i++) {
      ids.push(call({ action: 'add_medicine', adminKey: 'changeme-admin-key', name: 'M' + i, price: i }).data.medId);
    }
    eq(new Set(ids).size, 25, '25 medicine ids are all distinct');

    const emails = [];
    for (let i = 0; i < 10; i++) {
      const u = registerCustomer('u' + i + '@example.com', '98001000' + String(i).padStart(2, '0'));
      emails.push(u.userId);
    }
    eq(new Set(emails).size, 10, '10 user ids are all distinct');

    // and users with the same id no longer share prescription history
    const uid = emails[0];
    call({ action: 'verify_email', userId: uid, otp: H.lastOtp('u0@example.com'), password: 'secret123' });
    [[1, 'p1.pdf'], [2, 'p2.pdf']].forEach(([n, f]) => {
      call({ action: 'upload_rx', userId: emails[n], fileName: f, fileType: 'application/pdf', fileBase64: H.b64('x') });
    });
    eq(call({ action: 'get_data', sheetName: 'Prescriptions', userId: uid }).data.length, 0,
      'user 0 does not see another user\'s upload');
  });

  // =====================================================================
  scenario('password can be set during registration', () => {
    boot();
    const short = call({ action: 'register', email: 'p@example.com', phone: '9800000020', password: '123' });
    ok(!short.success, 'too-short registration password rejected');
    const mismatch = call({
      action: 'register', email: 'p@example.com', phone: '9800000020',
      password: 'secret123', password2: 'secret124',
    });
    ok(!mismatch.success, 'mismatched confirmation rejected');

    const res = call({
      action: 'register', email: 'p@example.com', phone: '9800000020',
      password: 'secret123', password2: 'secret123',
    });
    ok(res.success, 'registration with a password succeeds', res.message);
    ok(res.data.passwordSet === true, 'server confirms the password was stored');

    const tooEarly = call({ action: 'login', loginId: 'p@example.com', password: 'secret123' });
    ok(!tooEarly.success && /verify your email/i.test(tooEarly.message),
      'still must verify email before login', tooEarly.message);
    call({ action: 'verify_email', userId: res.data.userId, otp: H.lastOtp('p@example.com') });
    ok(call({ action: 'login', loginId: 'p@example.com', password: 'secret123' }).success,
      'login works right after verification');
  });

  // =====================================================================
  scenario('a failed verification email leaves no orphan account', () => {
    boot();
    MailApp._fail = true;
    try {
      const res = call({ action: 'register', email: 'o@example.com', phone: '9800000021' });
      ok(!res.success, 'registration reports the mail failure', res.message);
      eq(H.sheetRows('Users').length, 1, 'no user row was created (headers only)');
    } finally {
      MailApp._fail = false;
    }
    const retry = call({ action: 'register', email: 'o@example.com', phone: '9800000021' });
    ok(retry.success, 'the same email can register again once mail works', retry.message);
  });

  // =====================================================================
  scenario('only verified, active accounts can upload prescriptions', () => {
    boot();
    const r = call({ action: 'register', email: 'u@example.com', phone: '9800000022' });
    const upload = call({
      action: 'upload_rx', userId: r.data.userId, fileName: 'x.pdf',
      fileType: 'application/pdf', fileBase64: H.b64('x'),
    });
    ok(!upload.success && /unverified/i.test(upload.message), 'unverified user blocked', upload.message);

    call({ action: 'verify_email', userId: r.data.userId, otp: H.lastOtp('u@example.com'), password: 'secret123' });
    ok(call({
      action: 'upload_rx', userId: r.data.userId, fileName: 'x.pdf',
      fileType: 'application/pdf', fileBase64: H.b64('x'),
    }).success, 'verified user can upload');

    const huge = call({
      action: 'upload_rx', userId: r.data.userId, fileName: 'big.pdf',
      fileType: 'application/pdf', fileBase64: H.b64('x'.repeat(15 * 1024 * 1024)),
    });
    ok(!huge.success && /too large/i.test(huge.message), 'oversized upload rejected', huge.message);
  });

  // =====================================================================
  scenario('set-password page posted from a browser form works (no JSON, no CORS)', () => {
    boot();
    const u = registerCustomer('form@example.com', '9800000013');
    call({ action: 'verify_email', userId: u.userId, otp: u.otp });
    call({ action: 'forgot_password', loginId: u.email });
    const token = H.lastResetToken('form@example.com');

    const out = form({ action: 'reset_password', token, password: 'formpass1' });
    ok(!!out, 'form POST returns a response');
    const content = out && typeof out.getContent === 'function' ? out.getContent() : '';
    const parsed = H.json(out) || {};
    const worked = parsed.success === true || /success|password set/i.test(String(content));
    ok(worked, 'urlencoded form POST sets the password', String(content).slice(0, 160));
    ok(call({ action: 'login', loginId: u.email, password: 'formpass1' }).success,
      'login works after the form POST');
  });

  return results;
};
