// ============================================================
// PHARMA DELIVERY MVP — GOOGLE APPS SCRIPT BACKEND
// Deploys as: Web App (Execute as: Me / Who has access: Anyone)
// Data lives in Google Sheets; files live in Google Drive folders.
// Frontend hosted on GitHub Pages calls this API via fetch().
// ============================================================

// --- CONFIGURATION -------------------------------------------------------
// Any value below can be overridden without editing code: set a matching
// Script Property (Project Settings → Script Properties), e.g. ADMIN_KEY.
const SHEET_ID = '1KH4PvzLiSewlYU4_mKw_PjHNGViSLRCYGvptvs-RO1k';

// Prescription folders (upload flow)
const PENDING_FOLDER_ID  = '16p5tyaPsSFrh5NckqXtlZouGkVI84xkY'; // uploads land here
const APPROVED_FOLDER_ID = '1OYytV1yUiNEkk0lHqswijQUudtbuPx31'; // approved Rx moved here
const DECLINED_FOLDER_ID = '1A028GXtnT_nH0dXDwJS4NWmQNnQcoQ3X'; // declined Rx moved here

// Merchant document folder (GST, Drug License, Shop ID, PAN).
// Leave blank (or the REPLACE_... placeholder) to have the script create and
// reuse a folder automatically — see merchantDocsFolder_().
const MERCHANT_DOCS_FOLDER_ID = '';
const MERCHANT_DOCS_FOLDER_NAME = 'PharmaGo — Merchant KYC Docs';

// Simple shared secret for admin actions (change it! Script Property wins)
const ADMIN_KEY = 'changeme-admin-key';

// Your GitHub Pages URL — emailed "set password" links redirect here.
// Leave blank to serve the set-password form straight from Apps Script
// (handy before the frontend is deployed / while testing).
const FRONTEND_URL = '';

// OTP / password-email settings
const OTP_TTL_MINUTES   = 10;   // one-time code validity
const RESET_LINK_HOURS  = 24;   // emailed "set password" link validity
const SESSION_TTL_HOURS = 24 * 7; // login token lifetime
const MAX_UPLOAD_BYTES  = 10 * 1024 * 1024; // ~10 MB of binary (base64 is ~1.37x)

// Sheet names
const SHEETS = {
  USERS: 'Users',            // UserID | Email | Phone | Password | Role | Name | Status | CreatedAt
  RX: 'Prescriptions',       // RxID | UserID | FileName | FileId | Status | Timestamp | ReviewedAt | ReviewNote
  MERCHANTS: 'Merchants',    // MerchantID | OwnerEmail | Phone | ShopName | Address | GSTNumber | DrugLicenseNumber | DocFileIds | Status | Password | CreatedAt | ReviewedAt
  MEDICINES: 'Medicines',    // MedicineID | Name | Category | Price | Stock | Description | MerchantID | Active | CreatedAt
  OTPS: 'Otps',              // Key | CodeHash | Purpose | ExpiresAt | Consumed | Attempts | CreatedAt
  ORDERS: 'Orders'           // OrderID | UserID | RxID | MerchantID | MedicineID | MedicineName | Qty | Price | Status | Note | CreatedAt | ReviewedAt
};

// Column headers — also used to create missing sheets on the fly.
const HEADERS = {
  Users:         ['UserID', 'Email', 'Phone', 'Password', 'Role', 'Name', 'Status', 'CreatedAt'],
  Prescriptions: ['RxID', 'UserID', 'FileName', 'FileId', 'Status', 'Timestamp', 'ReviewedAt', 'ReviewNote'],
  Merchants:     ['MerchantID', 'OwnerEmail', 'Phone', 'ShopName', 'Address', 'GSTNumber', 'DrugLicenseNumber', 'DocFileIds', 'Status', 'Password', 'CreatedAt', 'ReviewedAt'],
  Medicines:     ['MedicineID', 'Name', 'Category', 'Price', 'Stock', 'Description', 'MerchantID', 'Active', 'CreatedAt'],
  Otps:          ['Key', 'CodeHash', 'Purpose', 'ExpiresAt', 'Consumed', 'Attempts', 'CreatedAt'],
  Orders:        ['OrderID', 'UserID', 'RxID', 'MerchantID', 'MedicineID', 'MedicineName', 'Qty', 'Price', 'Status', 'Note', 'CreatedAt', 'ReviewedAt']
};

// ============================================================
// MAIN ROUTER
// ============================================================
function doPost(e) {
  let data = {};
  let asForm = false; // true when the request came from an HTML form (browser page)

  try {
    const raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    if (raw && raw.charAt(0) === '{') {
      data = JSON.parse(raw);
    } else if (e && e.parameter && Object.keys(e.parameter).length) {
      data = Object.assign({}, e.parameter);
      asForm = true;
    } else if (raw) {
      const parsed = parseFormEncoded_(raw);
      if (!parsed.action) return jsonResult_(fail_('Bad request: expected a JSON body.'));
      data = parsed;
      asForm = true;
    }
  } catch (err) {
    return asForm ? htmlResult_(fail_('Bad request: ' + err.message))
                  : jsonResult_(fail_('Bad request: ' + err.message));
  }

  const result = handleRequest_(data);
  return asForm ? htmlResult_(result) : jsonResult_(result);
}

function handleRequest_(data) {
  try {
    const action = String(data.action || '');

    // Auth & registration — one-time email verification + set-password-by-email
    if (action === 'register')          return registerUser(data);        // sends OTP to email
    if (action === 'verify_email')      return verifyEmail(data);         // OTP -> account ACTIVE
    if (action === 'verify_merchant')   return verifyMerchantEmail(data); // vendor OTP step
    if (action === 'resend_otp')        return resendOtp(data);           // new OTP to email
    if (action === 'login')             return loginUser(data);
    if (action === 'logout')            return logoutSession(data);
    if (action === 'forgot_password')   return sendPasswordResetEmail(data); // emailed token link
    if (action === 'reset_password')    return resetPasswordWithToken(data); // set new password via token

    // Prescriptions
    if (action === 'upload_rx')         return uploadPrescription(data);
    if (action === 'view_rx')           return viewPrescription(data); // owner or admin inline preview
    if (action === 'update_status')     return updateRxStatus(data);   // admin approve/decline

    // Merchants
    if (action === 'register_merchant') return registerMerchant(data); // sends OTP to owner email
    if (action === 'review_merchant')   return reviewMerchant(data);   // admin approve/decline

    // Medicines
    if (action === 'add_medicine')      return addMedicine(data);      // admin or approved merchant
    if (action === 'update_medicine')   return updateMedicine(data);
    if (action === 'get_medicines')     return getMedicines(data);

    // Orders — an approved prescription can be sent to the pharmacy that listed the medicine
    if (action === 'place_order')       return placeOrder(data);
    if (action === 'list_orders')       return listOrders(data);
    if (action === 'review_order')      return reviewOrder(data);

    // Generic reads (dashboards)
    if (action === 'get_data')          return getData(data);
    if (action === 'setup')             return setupSheets();

    return fail_('Invalid action: ' + action);
  } catch (err) {
    return fail_('Server error: ' + (err && err.message ? err.message : err));
  }
}

function doGet(e) {
  // Optional simple reads via GET (e.g. ?action=get_medicines)
  try {
    const p = e.parameter || {};
    if (p.action === 'get_medicines') return jsonResult_(getMedicines({}));
    if (p.action === 'ping') return jsonResult_(ok_('API is running'));

    // Emailed "set password" links land here: ?action=pwreset&token=...
    if (p.action === 'pwreset' && p.token) {
      const token = String(p.token).replace(/[^\w-]/g, '');
      const frontend = frontendUrl_();
      if (frontend) {
        // Hand off to the GitHub Pages frontend, which reads ?page=reset&token=
        const target = frontend + '?page=reset&token=' + token;
        return HtmlService.createHtmlOutput(pageShell_(
          'Taking you to PharmaGo',
          '<div class="msg info">Taking you to the set-password page… ' +
          '<a href="' + target + '">continue</a></div>',
          '<meta http-equiv="refresh" content="0;url=' + target + '">'
        ));
      }
      // No frontend configured yet — serve the form from Apps Script so the
      // emailed link always works (form POSTs need no CORS).
      return HtmlService.createHtmlOutput(passwordPageHtml_(token));
    }
  } catch (err) { /* fall through */ }
  return jsonResult_(ok_('API is running. Use POST requests.'));
}

// ============================================================
// ONE-TIME SETUP: creates all sheets with headers if missing
// Run once from the Apps Script editor: setupSheets()
// (getSheet_() also creates a missing sheet on demand.)
// ============================================================
function setupSheets() {
  Object.keys(HEADERS).forEach(name => ensureSheet_(name));
  return ok_('Sheets initialized: ' + Object.keys(HEADERS).join(', '));
}

// ============================================================
// 1. REGISTRATION + ONE-TIME EMAIL VERIFICATION (OTP)
//    - No duplicate email OR phone
//    - Account is UNVERIFIED until the emailed OTP is entered
//    - Password may be set at registration/verification, or later
//      through an emailed link
// ============================================================
function registerUser(data) {
  const email = String(data.email || '').trim();
  const phone = String(data.phone || '').trim();
  if (!email || !phone) return fail_('Email and phone are required.');
  if (!isValidEmail_(email)) return fail_('That email address does not look valid.');
  if (normalizePhone_(phone).length < 7) return fail_('That phone number does not look valid.');

  // Hold the script lock through the duplicate check, allocation and append.
  // Two simultaneous sign-ups must never receive the same sequential ID.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return fail_('Registration is busy. Please try again.');
  try {
    const sheet = getSheet_(SHEETS.USERS);
    const rows = sheet.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]).toLowerCase() === email.toLowerCase())
        return fail_('Email already registered!');
      if (normalizePhone_(rows[i][2]) === normalizePhone_(phone))
        return fail_('Phone number already registered!');
    }

    // A password is optional here: it can also be set during verification or
    // later through an emailed "set password" link.
    let passwordHash = '';
    if (data.password) {
      const pw = String(data.password);
      if (pw.length < 6) return fail_('Password must be at least 6 characters.');
      if (data.password2 != null && String(data.password2) !== pw)
        return fail_('Passwords do not match.');
      passwordHash = makePasswordHash_(pw);
    }

    const userId = nextCustomerId_(rows);

    // Email first: if mail cannot be sent we create no orphan account, so the
    // visitor can simply try registering again.
    const otpResult = issueOtpAndEmail_(email, userId, 'VERIFY');
    if (!otpResult.ok) return fail_(otpResult.message);

    sheet.appendRow([userId, email, phone, passwordHash, 'USER',
                     String(data.name || '').trim(), 'UNVERIFIED', nowIso_()]);

    return ok_('Account created. We emailed a 6-digit verification code to ' + email +
               '. Enter it below (valid ' + OTP_TTL_MINUTES + ' minutes).',
               { userId, otpSentTo: email, passwordSet: !!passwordHash });
  } finally {
    lock.releaseLock();
  }
}

function verifyEmail(data) {
  const userId = String(data.userId || '');
  const check = consumeOtp_('VERIFY:' + userId, data.otp);
  if (!check.ok) return fail_(check.message);

  // Validate the optional password BEFORE flipping the account to ACTIVE.
  let passwordHash = null;
  if (data.password) {
    const pw = String(data.password);
    if (pw.length < 6) return fail_('Password must be at least 6 characters.');
    if (data.password2 != null && String(data.password2) !== pw)
      return fail_('Passwords do not match.');
    passwordHash = makePasswordHash_(pw);
  }

  const sheet = getSheet_(SHEETS.USERS);
  const idx = indexOfUser_(sheet, userId);
  if (idx < 0) return fail_('Unknown user ID.');

  sheet.getRange(idx + 1, 7).setValue('ACTIVE');           // Status
  if (passwordHash) sheet.getRange(idx + 1, 4).setValue(passwordHash); // Password

  return ok_(passwordHash
      ? 'Email verified and password set — you can log in now.'
      : 'Email verified! Set your password using “Forgot password?” (we’ll email you a secure link).',
    { userId, passwordSet: !!passwordHash });
}

function resendOtp(data) {
  const email = String(data.email || '').trim().toLowerCase();
  const rows = getSheet_(SHEETS.USERS).getDataRange().getValues();
  let target = null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() === email) { target = rows[i]; break; }
  }
  if (!target) return fail_('If the account exists, a new code has been emailed.');
  if (String(target[6]) === 'ACTIVE') return fail_('This account is already verified.');

  const purpose = String(target[4]) === 'MERCHANT' ? 'MVERIFY' : 'VERIFY';
  const r = issueOtpAndEmail_(target[1], target[0], purpose);
  return r.ok ? ok_('A new code was emailed to ' + maskEmail_(target[1]) + '.')
              : fail_(r.message);
}

function loginUser(data) {
  const loginId = String(data.loginId || '').trim();
  if (!loginId) return fail_('Enter your user ID or email.');
  if (!data.password) return fail_('Enter your password.');

  const sheet = getSheet_(SHEETS.USERS);
  const rows = sheet.getDataRange().getValues();
  const password = String(data.password);

  for (let i = 1; i < rows.length; i++) {
    const idMatch = String(rows[i][0]) === loginId;
    const emailMatch = String(rows[i][1]).toLowerCase() === loginId.toLowerCase();
    if (idMatch || emailMatch) {
      // Account state first (so a vendor waiting for approval learns why),
      // then credentials — never the other way round.
      if (rows[i][6] === 'UNVERIFIED') return fail_('Please verify your email first (enter the OTP we sent you).');
      if (rows[i][6] === 'PENDING')    return fail_('Account awaiting admin approval.');
      if (rows[i][6] === 'DECLINED')   return fail_('Account was declined by admin.');
      if (!rows[i][3])                 return fail_('No password set yet. Use “Forgot password?” to set one via email.');
      if (!passwordMatches_(rows[i][3], password)) return fail_('Invalid ID/email or password.');
      // Old rows stored an unsalted SHA-256. Upgrade them on a successful login.
      if (String(rows[i][3]).indexOf('s1$') !== 0) {
        const upgraded = makePasswordHash_(password);
        sheet.getRange(i + 1, 4).setValue(upgraded);
        setMerchantPassword_(rows[i][0], upgraded);
      }
      return ok_('Login successful', {
        userId: rows[i][0], role: rows[i][4], name: rows[i][5],
        sessionToken: issueSession_(rows[i][0])
      });
    }
  }
  return fail_('Invalid ID/email or password.');
}

// ------------------------------------------------------------
// PASSWORD SET THROUGH MAIL (forgot-password / first-time setup)
// ------------------------------------------------------------
function sendPasswordResetEmail(data) {
  const loginId = String(data.loginId || '').trim();
  if (!loginId) return fail_('Enter your email or user ID.');
  const user = findUserByLoginId_(loginId);

  // Same answer whether or not the account exists — never confirm existence.
  const neutral = 'If that account exists, a password-setup link has been emailed to it. ' +
                  'The link works once and expires in ' + RESET_LINK_HOURS + ' hours.';
  if (!user) return ok_(neutral);

  const token = Utilities.getUuid();
  issueOtpRawCode_(user[0], 'PWDRESET', token, RESET_LINK_HOURS * 60);

  const link = API_BASE_URL() + '?action=pwreset&token=' + token;
  const body =
    'Hi ' + (user[5] || 'there') + ',\n\n' +
    'Use the link below to set a new password for your PharmaGo account.\n' +
    'The link works once and expires in ' + RESET_LINK_HOURS + ' hours.\n\n' +
    link + '\n\n' +
    "Didn't request this? Ignore this email.";
  try {
    MailApp.sendEmail({
      to: user[1],
      subject: 'PharmaGo — set your password',
      body: body,
      htmlBody: emailHtml_({
        heading: 'Set your PharmaGo password',
        text: 'Hi ' + (user[5] || 'there') + ',\n' +
          'Use the button below to choose a new password. The link works once and expires in ' +
          RESET_LINK_HOURS + ' hours.\n' +
          "Didn't request this? Ignore this email — nothing changes until the link is opened.",
        buttonUrl: link,
        buttonLabel: 'Set my password',
        linkFallback: link
      })
    });
  } catch (err) {
    return fail_('Could not send email: ' + err.message + ' (check Apps Script quota/authorization).');
  }
  return ok_(neutral);
}

function resetPasswordWithToken(data) {
  const token = String(data.token || '').trim();
  if (!token) return fail_('Missing reset token.');

  const pw = String(data.password || '');
  if (pw.length < 6) return fail_('Password must be at least 6 characters.');
  if (data.password2 != null && String(data.password2) !== pw)
    return fail_('Passwords do not match.');

  // Reset tokens are stored under PWDRESET:<userId> and matched by the hash of
  // the emailed token, so the user id can be recovered from the row key.
  const check = consumeToken_('PWDRESET', token);
  if (!check.ok) return fail_(check.message);

  const userId = check.identifier;
  const sheet = getSheet_(SHEETS.USERS);
  const idx = indexOfUser_(sheet, userId);
  if (idx < 0) return fail_('Account not found.');

  sheet.getRange(idx + 1, 4).setValue(makePasswordHash_(pw));       // Password
  if (String(sheet.getRange(idx + 1, 7).getValue()) === 'UNVERIFIED') {
    sheet.getRange(idx + 1, 7).setValue('ACTIVE'); // email access proven -> treat as verified
  }
  setMerchantPassword_(userId, String(sheet.getRange(idx + 1, 4).getValue())); // keep the vendor copy in sync
  invalidateOtps_('PWDRESET:' + userId);           // one link, one use

  return ok_('Password set successfully. You can log in now.');
}

// ============================================================
// 2. PRESCRIPTION UPLOAD -> PENDING FOLDER, LOGGED IN SHEET
// ============================================================
function uploadPrescription(data) {
  const actor = requireActor_(data);
  if (!actor.ok) return fail_(actor.message);
  if (actor.role !== 'USER') return fail_('Sign in as a customer to upload a prescription.');
  const userId = actor.userId;
  if (!data.fileBase64) return fail_('No file received.');

  const user = findUserById_(userId);
  if (!user) return fail_('Unknown user ID.');
  if (String(user[6]) !== 'ACTIVE') {
    return fail_('Your account is ' + String(user[6]).toLowerCase() +
                 '. Only verified, active accounts can upload prescriptions.');
  }

  const raw = String(data.fileBase64);
  if (raw.length > Math.round(MAX_UPLOAD_BYTES * 1.4)) {
    return fail_('File is too large (max ' + Math.round(MAX_UPLOAD_BYTES / 1048576) + ' MB).');
  }

  const sheet = getSheet_(SHEETS.RX);
  const folder = requireFolder_(PENDING_FOLDER_ID, 'PENDING_FOLDER_ID');

  const fileName = safeFileName_(userId, data.fileName);
  const blob = Utilities.newBlob(Utilities.base64Decode(raw),
                                 data.fileType || 'application/octet-stream', fileName);
  const file = folder.createFile(blob);

  // Private. The owner and admin open it through view_rx, which reads Drive as
  // the script owner. A link must not be enough.
  keepPrivate_(file);

  const rxId = newId_('RX', SHEETS.RX, 0);
  const timestamp = nowIso_(); // "uploaded time" used in naming + history
  sheet.appendRow([rxId, userId, fileName, file.getId(), 'PENDING', timestamp, '', '']);

  return ok_('Prescription uploaded. Status: Pending', {
    rxId, timestamp, driveUrl: file.getUrl()
  });
}

// ============================================================
// 3. ADMIN APPROVE / DECLINE -> MOVE FILE BETWEEN DRIVE FOLDERS
//    Approved files renamed to UserID__UploadTime for designated-drive history
// ============================================================
function updateRxStatus(data) {
  if (!checkAdminKey_(data.adminKey)) return fail_('Unauthorized: bad admin key.');

  const rxId = String(data.rxId || '');
  const newStatus = String(data.status || '').toUpperCase(); // 'APPROVED' or 'DECLINED'
  if (newStatus !== 'APPROVED' && newStatus !== 'DECLINED')
    return fail_('Status must be APPROVED or DECLINED.');

  const sheet = getSheet_(SHEETS.RX);
  const rows = sheet.getDataRange().getValues();
  const targetFolderId = newStatus === 'APPROVED' ? APPROVED_FOLDER_ID : DECLINED_FOLDER_ID;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== rxId) continue;
    if (rows[i][4] !== 'PENDING') return fail_('Already reviewed: ' + rows[i][4]);

    let file;
    try {
      file = DriveApp.getFileById(rows[i][3]);
    } catch (err) {
      return fail_('The uploaded file is no longer available in Drive (file id ' +
                   rows[i][3] + '). Status was left unchanged.');
    }

    const targetFolder = requireFolder_(targetFolderId,
      newStatus === 'APPROVED' ? 'APPROVED_FOLDER_ID' : 'DECLINED_FOLDER_ID');

    // Approved? Rename to UserID__UploadedTime in the designated drive folder
    if (newStatus === 'APPROVED') {
      file.setName(String(rows[i][1]) + '__' + String(rows[i][5]).replace(/[:.]/g, '-'));
    }

    // Older uploads may still be link-shared. Lock them down on review.
    keepPrivate_(file);

    // Move correctly: add to target, remove from all other parents
    targetFolder.addFile(file);
    const parents = file.getParents();
    while (parents.hasNext()) {
      const parent = parents.next();
      if (parent.getId() !== targetFolderId) parent.removeFile(file);
    }

    sheet.getRange(i + 1, 5).setValue(newStatus);                // Status
    sheet.getRange(i + 1, 7).setValue(nowIso_());                // ReviewedAt
    sheet.getRange(i + 1, 8).setValue(String(data.note || ''));  // ReviewNote
    notifyUser_(rows[i][1],
      'PharmaGo — prescription ' + newStatus.toLowerCase(),
      'Your prescription ' + rxId + ' was ' + newStatus.toLowerCase() + '.' +
      (data.note ? '\nNote: ' + data.note : '') +
      '\n\nSign in to PharmaGo to view it.',
      { heading: 'Prescription ' + newStatus.toLowerCase(),
        buttonLabel: 'View my prescriptions' });
    return ok_('Status updated to ' + newStatus);
  }
  return fail_('Prescription not found.');
}

// Owner (userId) or admin can open the stored file. The script reads Drive as
// itself, so the preview works even when a browser cannot embed Drive.
function viewPrescription(data) {
  const rxId = String(data.rxId || '');
  if (!rxId) return fail_('Missing prescription id.');
  const isAdmin = checkAdminKey_(data.adminKey);
  const actor = isAdmin ? null : requireActor_(data);
  if (!isAdmin && !actor.ok) return fail_(actor.message);

  const rows = getSheet_(SHEETS.RX).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== rxId) continue;
    const owner = String(rows[i][1]);
    if (!isAdmin && actor.userId !== owner) {
      return fail_('You can only view your own prescriptions.');
    }
    let file;
    try {
      file = DriveApp.getFileById(rows[i][3]);
    } catch (err) {
      return fail_('The uploaded file is no longer available in Drive.');
    }
    const blob = file.getBlob();
    const bytes = blob.getBytes() || [];
    if (bytes.length > MAX_UPLOAD_BYTES) {
      return fail_('File is too large to preview here.');
    }
    const storedName = String(rows[i][2] || file.getName() || 'prescription');
    return ok_('Prescription ready to view', {
      rxId: rxId,
      userId: owner,
      fileName: storedName,
      fileId: String(rows[i][3] || ''),
      fileType: blobType_(blob, storedName),
      fileBase64: Utilities.base64Encode(bytes),
      status: String(rows[i][4] || ''),
      timestamp: String(rows[i][5] || ''),
      reviewedAt: String(rows[i][6] || ''),
      reviewNote: String(rows[i][7] || ''),
      driveUrl: file.getUrl()
    });
  }
  return fail_('Prescription not found.');
}

function blobType_(blob, fallbackName) {
  try {
    if (blob && typeof blob.getContentType === 'function') {
      const type = String(blob.getContentType() || '');
      if (type && type !== 'application/octet-stream') return type;
    }
  } catch (err) { /* fall back to the file name */ }
  return mimeFromName_(fallbackName);
}

function mimeFromName_(name) {
  const n = String(name || '').toLowerCase();
  if (/\.png$/.test(n)) return 'image/png';
  if (/\.jpe?g$/.test(n)) return 'image/jpeg';
  if (/\.gif$/.test(n)) return 'image/gif';
  if (/\.webp$/.test(n)) return 'image/webp';
  if (/\.pdf$/.test(n)) return 'application/pdf';
  return 'application/octet-stream';
}

// ============================================================
// 4. MERCHANT REGISTRATION (multi-document upload) + REVIEW
//    Required docs: GST, Drug License, Shop ID proof, PAN
// ============================================================
const REQUIRED_MERCHANT_DOCS = ['GST', 'DRUG_LICENSE', 'SHOP_ID', 'PAN'];

function registerMerchant(data) {
  const email = String(data.email || '').trim();
  const phone = String(data.phone || '').trim();
  const shopName = String(data.shopName || '').trim();
  if (!email || !phone || !shopName)
    return fail_('Email, phone and shop name are required.');
  if (!isValidEmail_(email)) return fail_('That email address does not look valid.');

  // Duplicate check on email AND phone across Users sheet (merchants also log in there)
  const usersSheet = getSheet_(SHEETS.USERS);
  const uRows = usersSheet.getDataRange().getValues();
  for (let i = 1; i < uRows.length; i++) {
    if (String(uRows[i][1]).toLowerCase() === email.toLowerCase())
      return fail_('Email already registered.');
    if (normalizePhone_(uRows[i][2]) === normalizePhone_(phone))
      return fail_('Phone already registered.');
  }

  const docs = data.documents || []; // [{docType, fileName, fileType, fileBase64}, ...]
  const gotTypes = docs.map(d => String(d.docType).toUpperCase());
  const missing = REQUIRED_MERCHANT_DOCS.filter(t => gotTypes.indexOf(t) === -1);
  if (missing.length) return fail_('Missing documents: ' + missing.join(', '));

  let passwordHash = '';
  if (data.password) {
    const pw = String(data.password);
    if (pw.length < 6) return fail_('Password must be at least 6 characters.');
    if (data.password2 != null && String(data.password2) !== pw)
      return fail_('Passwords do not match.');
    passwordHash = hashPassword_(pw);
  }

  const merchantId = newId_('M', SHEETS.USERS, 0);

  // Verify the owner's email before writing anything: a mail failure should
  // leave no half-registered vendor (and no stray KYC files in Drive).
  const otpResult = issueOtpAndEmail_(email, merchantId, 'MVERIFY');
  if (!otpResult.ok) return fail_(otpResult.message);

  const folder = merchantDocsFolder_();
  const fileIds = [];
  docs.forEach(d => {
    const type = String(d.docType).toUpperCase();
    const blob = Utilities.newBlob(
      Utilities.base64Decode(String(d.fileBase64)),
      d.fileType || 'application/octet-stream',
      merchantId + '_' + type + '_' + safeFileName_('', d.fileName)
    );
    const f = folder.createFile(blob);
    keepPrivate_(f); // KYC documents must never be publicly readable
    fileIds.push(type + ':' + f.getId());
  });

  const sheet = getSheet_(SHEETS.MERCHANTS);
  sheet.appendRow([
    merchantId, email, phone, shopName, String(data.address || '').trim(),
    String(data.gstNumber || '').trim(), String(data.drugLicenseNumber || '').trim(),
    fileIds.join(';'), 'PENDING', passwordHash, nowIso_(), ''
  ]);

  // Login entry with role MERCHANT (UNVERIFIED until OTP entered, then PENDING admin approval)
  usersSheet.appendRow([merchantId, email, phone, passwordHash,
                        'MERCHANT', shopName, 'UNVERIFIED', nowIso_()]);

  return ok_('Vendor registered. A 6-digit verification code was emailed to ' + email +
             '. After verifying, an admin will review your documents.',
             { merchantId });
}

// Vendor email-verification step (purpose MVERIFY). On success the account
// stays PENDING for admin document review.
function verifyMerchantEmail(data) {
  const merchantId = String(data.merchantId || '');
  const check = consumeOtp_('MVERIFY:' + merchantId, data.otp);
  if (!check.ok) return fail_(check.message);

  // Validate the optional password before touching the sheet.
  let passwordHash = null;
  if (data.password) {
    const pw = String(data.password);
    if (pw.length < 6) return fail_('Password must be at least 6 characters.');
    if (data.password2 != null && String(data.password2) !== pw)
      return fail_('Passwords do not match.');
    passwordHash = makePasswordHash_(pw);
  }

  const usersSheet = getSheet_(SHEETS.USERS);
  const idx = indexOfUser_(usersSheet, merchantId);
  if (idx < 0) return fail_('Vendor not found.');

  usersSheet.getRange(idx + 1, 7).setValue('PENDING'); // email verified -> await admin doc approval
  if (passwordHash) {
    usersSheet.getRange(idx + 1, 4).setValue(passwordHash);
    setMerchantPassword_(merchantId, passwordHash);
  }
  return ok_('Vendor email verified! Your documents are now awaiting admin approval.',
             { merchantId: merchantId, passwordSet: !!passwordHash });
}

function reviewMerchant(data) {
  if (!checkAdminKey_(data.adminKey)) return fail_('Unauthorized: bad admin key.');

  const newStatus = String(data.status || '').toUpperCase();
  if (newStatus !== 'APPROVED' && newStatus !== 'DECLINED')
    return fail_('Status must be APPROVED or DECLINED.');

  const sheet = getSheet_(SHEETS.MERCHANTS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(data.merchantId)) continue;
    sheet.getRange(i + 1, 9).setValue(newStatus);                  // Status
    sheet.getRange(i + 1, 12).setValue(nowIso_());                 // ReviewedAt
    mirrorUserStatus_(data.merchantId, newStatus);                 // gate login
    return ok_('Merchant ' + newStatus);
  }
  return fail_('Merchant not found.');
}

// ============================================================
// 5. MEDICINES (admin anytime; merchants only after approval)
// ============================================================
function addMedicine(data) {
  const auth = resolveStaffAuth_(data); // adminKey OR merchant credentials
  if (!auth.ok) return fail_(auth.message);

  const name = String(data.name || '').trim();
  const price = Number(data.price);
  if (!name || !isFinite(price) || price < 0) return fail_('Medicine name and a valid price are required.');

  const sheet = getSheet_(SHEETS.MEDICINES);
  const medId = newId_('MED', SHEETS.MEDICINES, 0);
  sheet.appendRow([
    medId, name, String(data.category || 'General').trim(), price,
    Number(data.stock || 0), String(data.description || '').trim(),
    auth.merchantId || 'ADMIN', 'YES', nowIso_()
  ]);
  return ok_('Medicine added', { medId });
}

function updateMedicine(data) {
  const auth = resolveStaffAuth_(data);
  if (!auth.ok) return fail_(auth.message);

  const sheet = getSheet_(SHEETS.MEDICINES);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(data.medId)) continue;
    if (!auth.isAdmin && String(rows[i][6]) !== auth.merchantId)
      return fail_('You can only edit your own medicines.');

    if (data.name != null && String(data.name).trim())
      sheet.getRange(i + 1, 2).setValue(String(data.name).trim());
    if (data.category != null)
      sheet.getRange(i + 1, 3).setValue(String(data.category).trim() || 'General');
    if (data.description != null)
      sheet.getRange(i + 1, 6).setValue(String(data.description));
    if (data.price != null) sheet.getRange(i + 1, 4).setValue(Number(data.price));
    if (data.stock != null) sheet.getRange(i + 1, 5).setValue(Number(data.stock));
    if (data.active != null) sheet.getRange(i + 1, 8).setValue(data.active ? 'YES' : 'NO');
    return ok_('Medicine updated');
  }
  return fail_('Medicine not found.');
}

function getMedicines(data) {
  const sheet = getSheet_(SHEETS.MEDICINES);
  const rows = sheet.getDataRange().getValues();
  const shopNames = merchantShopNames_();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][7] !== 'YES') continue; // only active/listed items
    out.push({
      MedicineID: rows[i][0], Name: rows[i][1], Category: rows[i][2],
      Price: rows[i][3], Stock: rows[i][4], Description: rows[i][5],
      MerchantID: rows[i][6], ShopName: shopNames[String(rows[i][6])] || ''
    });
  }
  return ok_('Medicines fetched', out);
}

// ============================================================
// 6. GENERIC DATA READ (user history, admin lists, merchant lists)
//    Private sheets require the admin key; personal reads are scoped
//    to the signed-in user / vendor.
// ============================================================
function getData(data) {
  const allowed = [SHEETS.USERS, SHEETS.RX, SHEETS.MERCHANTS, SHEETS.MEDICINES];
  const sheetName = String(data.sheetName || '');
  if (allowed.indexOf(sheetName) === -1) return fail_('Unknown sheet.');

  const isAdmin = checkAdminKey_(data.adminKey);
  if (!isAdmin) {
    if (sheetName === SHEETS.USERS || sheetName === SHEETS.MERCHANTS)
      return fail_('Admin key required to list ' + sheetName + '.');
    const actor = requireActor_(data);
    if (!actor.ok) return fail_(actor.message);
    if (sheetName === SHEETS.RX) {
      data.userId = actor.userId; // ignore a caller-supplied id
    } else if (sheetName === SHEETS.MEDICINES) {
      if (actor.role !== 'MERCHANT') return fail_('Sign in as a vendor to list your medicines.');
      data.merchantId = actor.userId;
    } else {
      return fail_('Admin key required to list ' + sheetName + '.');
    }
  }

  const sheet = getSheet_(sheetName);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    // Personal history filter: only own prescriptions
    if (data.userId && sheetName === SHEETS.RX && String(rows[i][1]) !== String(data.userId)) continue;
    // Merchant filter: only own medicines
    if (data.merchantId && sheetName === SHEETS.MEDICINES && String(rows[i][6]) !== String(data.merchantId)) continue;

    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j] === 'Password') continue; // never expose hashes
      obj[headers[j]] = rows[i][j];
    }
    result.push(obj);
  }
  return ok_('Data fetched', result);
}

// ============================================================
// HELPERS
// ============================================================
function ensureSheet_(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 && HEADERS[name]) {
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getSheet_(name) {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  // Auto-create a missing sheet (with headers) instead of failing the request.
  return sh || ensureSheet_(name);
}

function findUserById_(userId) {
  const rows = getSheet_(SHEETS.USERS).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(userId)) return rows[i];
  }
  return null;
}

function mirrorUserStatus_(id, status) {
  const sheet = getSheet_(SHEETS.USERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i + 1, 7).setValue(status === 'APPROVED' ? 'ACTIVE' : 'DECLINED');
      return;
    }
  }
}

function normalizePhone_(p) {
  return String(p || '').replace(/\D/g, '');
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''));
}

function safeFileName_(userId, original) {
  const clean = String(original || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  return (userId ? userId + '_' : '') + fileStamp_() + '_' + clean;
}

// Customer IDs are sequential per calendar year, starting at 0010. Scan the
// sheet rather than trusting a row count: older/random IDs and deleted rows
// must not cause a duplicate or reset the sequence.
function nextCustomerId_(rows) {
  const year = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
  const prefix = 'U-' + year + '-';
  let highest = 9;
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '');
    if (id.indexOf(prefix) === 0 && /^\d+$/.test(id.slice(prefix.length))) {
      highest = Math.max(highest, Number(id.slice(prefix.length)));
    }
  }
  return prefix + String(highest + 1).padStart(4, '0');
}

// Unique ids — Date.now() alone collides when two writes land in the same
// millisecond, which silently merged users / prescriptions / medicines.
function newId_(prefix, sheetName, col) {
  const sheet = sheetName ? getSheet_(sheetName) : null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = prefix + new Date().getTime().toString(36).toUpperCase() +
               Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
    if (!sheet) return id;
    const rows = sheet.getDataRange().getValues();
    let clash = false;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][col]) === id) { clash = true; break; }
    }
    if (!clash) return id;
  }
  return prefix + Utilities.getUuid(); // last resort
}

// Deterministic digest for OTP codes, reset tokens and session tokens.
// Passwords use makePasswordHash_ so a leaked sheet does not reveal them.
function hashPassword_(pw) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pw))
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function makePasswordHash_(pw) {
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return 's1$' + salt + '$' + hashPassword_(salt + ':' + pw);
}

function passwordMatches_(stored, pw) {
  const value = String(stored || '');
  if (value.indexOf('s1$') === 0) {
    const parts = value.split('$');
    return parts.length === 3 && parts[2] === hashPassword_(parts[1] + ':' + pw);
  }
  return value === hashPassword_(pw); // legacy unsalted rows
}

// A user id is sequential and guessable. Privileged reads require this token.
function issueSession_(userId) {
  pruneOtps_();
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  getSheet_(SHEETS.OTPS).appendRow([
    'SESSION:' + userId, hashPassword_(token), 'SESSION', expiresAt, '', 0, new Date().toISOString()
  ]);
  return token;
}

function sessionUser_(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const submitted = hashPassword_(raw);
  const rows = getSheet_(SHEETS.OTPS).getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][2]) !== 'SESSION' || String(rows[i][1]) !== submitted) continue;
    if (String(rows[i][4]) === 'YES') return null;
    if (new Date(rows[i][3]).getTime() < Date.now()) return null;
    const key = String(rows[i][0]);
    return key.indexOf('SESSION:') === 0 ? key.slice(8) : null;
  }
  return null;
}

function requireActor_(data) {
  const userId = sessionUser_(data.sessionToken);
  if (!userId) return { ok: false, message: 'Please sign in again.' };
  const user = findUserById_(userId);
  if (!user || String(user[6]) !== 'ACTIVE') return { ok: false, message: 'Please sign in again.' };
  return {
    ok: true, userId: String(user[0]), role: String(user[4]),
    email: String(user[1] || ''), name: String(user[5] || '')
  };
}

function logoutSession(data) {
  const raw = String(data.sessionToken || '').trim();
  if (!raw) return ok_('Signed out.');
  const submitted = hashPassword_(raw);
  const sheet = getSheet_(SHEETS.OTPS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === 'SESSION' && String(rows[i][1]) === submitted)
      sheet.getRange(i + 1, 5).setValue('YES');
  }
  return ok_('Signed out.');
}

function pruneOtps_() {
  const sheet = getSheet_(SHEETS.OTPS);
  const rows = sheet.getDataRange().getValues();
  const now = Date.now();
  for (let i = rows.length - 1; i >= 1; i--) {
    const consumed = String(rows[i][4]) === 'YES';
    const exp = new Date(rows[i][3]).getTime();
    if (consumed || (exp && exp < now)) sheet.deleteRow(i + 1);
  }
}

function notifyUser_(userId, subject, body, options) {
  const user = findUserById_(userId);
  if (!user || !user[1]) return;
  const opts = options || {};
  const greeting = 'Hi ' + (user[5] || 'there') + ',\n\n';
  const frontend = frontendUrl_();
  try {
    MailApp.sendEmail({
      to: String(user[1]),
      subject: subject,
      body: greeting + body,
      htmlBody: emailHtml_({
        heading: opts.heading || subject,
        text: greeting + body,
        buttonUrl: opts.buttonUrl || frontend || '',
        buttonLabel: opts.buttonLabel || 'Open PharmaGo',
        linkFallback: ''
      })
    });
  } catch (err) { /* review/order must succeed even if mail quota is exhausted */ }
}

function placeOrder(data) {
  const actor = requireActor_(data);
  if (!actor.ok) return fail_(actor.message);
  if (actor.role !== 'USER') return fail_('Sign in as a customer to place an order.');

  const qty = Number(data.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99)
    return fail_('Quantity must be a whole number from 1 to 99.');
  const rxId = String(data.rxId || '');
  if (!rxId) return fail_('Choose an approved prescription for this order.');

  const rxRows = getSheet_(SHEETS.RX).getDataRange().getValues();
  let rx = null;
  for (let i = 1; i < rxRows.length; i++) {
    if (String(rxRows[i][0]) === rxId) { rx = rxRows[i]; break; }
  }
  if (!rx || String(rx[1]) !== actor.userId) return fail_('That prescription is not yours.');
  if (String(rx[4]) !== 'APPROVED') return fail_('Only an approved prescription can be used for an order.');

  const medRows = getSheet_(SHEETS.MEDICINES).getDataRange().getValues();
  let med = null;
  for (let i = 1; i < medRows.length; i++) {
    if (String(medRows[i][0]) === String(data.medicineId)) { med = medRows[i]; break; }
  }
  if (!med || med[7] !== 'YES') return fail_('That medicine is not available.');
  if (Number(med[4]) < qty) return fail_('Not enough stock.');

  const orderId = newId_('ORD', SHEETS.ORDERS, 0);
  getSheet_(SHEETS.ORDERS).appendRow([
    orderId, actor.userId, rxId, String(med[6]), String(med[0]), String(med[1]),
    qty, Number(med[3]), 'PLACED', '', nowIso_(), ''
  ]);
  notifyUser_(med[6], 'PharmaGo — new order ' + orderId,
    actor.name + ' ordered ' + qty + ' × ' + med[1] + ' (NPR ' + med[3] + ' each) against prescription ' +
    rxId + '.\n\nSign in to accept or decline it.',
    { heading: 'New order ' + orderId, buttonLabel: 'Open my shop' });
  return ok_('Order placed. The pharmacy will confirm it.', { orderId: orderId });
}

function listOrders(data) {
  const rows = getSheet_(SHEETS.ORDERS).getDataRange().getValues();
  const out = [];
  if (checkAdminKey_(data.adminKey)) {
    for (let i = 1; i < rows.length; i++) out.push(orderObject_(rows[i]));
    return ok_('Orders', out);
  }
  const actor = requireActor_(data);
  if (!actor.ok) return fail_(actor.message);
  for (let i = 1; i < rows.length; i++) {
    const mine = actor.role === 'MERCHANT'
      ? String(rows[i][3]) === actor.userId
      : String(rows[i][1]) === actor.userId;
    if (mine) out.push(orderObject_(rows[i]));
  }
  return ok_('Orders', out);
}

function reviewOrder(data) {
  const status = String(data.status || '').toUpperCase();
  if (status !== 'ACCEPTED' && status !== 'DECLINED')
    return fail_('Status must be ACCEPTED or DECLINED.');
  const reviewer = orderReviewer_(data);
  if (!reviewer.ok) return fail_(reviewer.message);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail_('Please try again.');
  try {
    const sheet = getSheet_(SHEETS.ORDERS);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(data.orderId)) continue;
      if (!reviewer.isAdmin && String(rows[i][3]) !== reviewer.merchantId)
        return fail_('You can only review orders for your pharmacy.');
      if (String(rows[i][8]) !== 'PLACED') return fail_('Already reviewed: ' + rows[i][8]);

      if (status === 'ACCEPTED') {
        const meds = getSheet_(SHEETS.MEDICINES);
        const medRows = meds.getDataRange().getValues();
        let found = false;
        for (let m = 1; m < medRows.length; m++) {
          if (String(medRows[m][0]) !== String(rows[i][4])) continue;
          const left = Number(medRows[m][4]) - Number(rows[i][6]);
          if (left < 0) return fail_('Not enough stock to accept this order.');
          meds.getRange(m + 1, 5).setValue(left);
          found = true;
          break;
        }
        if (!found) return fail_('That medicine is no longer listed.');
      }

      sheet.getRange(i + 1, 9).setValue(status);
      sheet.getRange(i + 1, 10).setValue(String(data.note || ''));
      sheet.getRange(i + 1, 12).setValue(nowIso_());
      notifyUser_(rows[i][1], 'PharmaGo — order ' + status.toLowerCase(),
        'Your order ' + rows[i][0] + ' (' + rows[i][6] + ' × ' + rows[i][5] + ') was ' +
        status.toLowerCase() + '.' + (data.note ? '\nNote: ' + data.note : ''),
        { heading: 'Order ' + status.toLowerCase(), buttonLabel: 'View my orders' });
      return ok_('Order ' + status.toLowerCase());
    }
    return fail_('Order not found.');
  } finally {
    lock.releaseLock();
  }
}

function orderReviewer_(data) {
  if (checkAdminKey_(data.adminKey)) return { ok: true, isAdmin: true, merchantId: '' };
  const staff = resolveStaffAuth_(data);
  if (staff.ok && staff.merchantId) return { ok: true, isAdmin: false, merchantId: staff.merchantId };
  const actor = requireActor_(data);
  if (actor.ok && actor.role === 'MERCHANT') return { ok: true, isAdmin: false, merchantId: actor.userId };
  return { ok: false, message: staff.message || actor.message || 'Sign in as the pharmacy, or use the admin key.' };
}

function orderObject_(row) {
  return {
    OrderID: row[0], UserID: row[1], RxID: row[2], MerchantID: row[3],
    MedicineID: row[4], MedicineName: row[5], Qty: row[6], Price: row[7],
    Status: row[8], Note: row[9], CreatedAt: row[10], ReviewedAt: row[11]
  };
}

function cfg_(key, fallback) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    if (v != null && String(v).trim() !== '' && !isPlaceholder_(v)) return String(v).trim();
  } catch (err) { /* PropertiesService unavailable — use the constant */ }
  return fallback;
}

function isPlaceholder_(v) {
  return /^REPLACE_WITH/i.test(String(v || '').trim());
}

function adminKey_() { return cfg_('ADMIN_KEY', ADMIN_KEY); }

/**
 * Optional hardening: set the ADMIN_GOOGLE_DOMAIN Script Property and a privileged
 * request must also come from a Google account in that domain. Blank (the default)
 * keeps the key-only behaviour. Note that a web app deployed as "Execute as: me"
 * reports the *owner's* account, so this only distinguishes deployments once the app
 * is deployed as "Execute as: user accessing the web app".
 */
function adminDomain_() { return cfg_('ADMIN_GOOGLE_DOMAIN', ''); }
function activeCallerEmail_() {
  try {
    const email = Session.getActiveUser().getEmail();
    return email ? String(email).toLowerCase() : '';
  } catch (err) { return ''; }
}
function checkAdminKey_(key) {
  if (String(key || '') !== adminKey_()) return false;
  const domain = adminDomain_();
  if (!domain) return true;
  const email = activeCallerEmail_();
  if (email && email.slice(-domain.length - 1) === '@' + domain.toLowerCase()) return true;
  Logger.log('PharmaGo: admin key rejected for caller "' + (email || 'unknown') +
             '" — ADMIN_GOOGLE_DOMAIN is set to ' + domain);
  return false;
}

function frontendUrl_() {
  const url = cfg_('FRONTEND_URL', FRONTEND_URL);
  if (!url || isPlaceholder_(url)) return '';
  return String(url).replace(/\/?$/, '/'); // always end with a single slash
}

function requireFolder_(id, label) {
  if (!id || isPlaceholder_(id)) {
    throw new Error('Drive folder not configured: ' + label +
                    ' (set it in code.gs or as a Script Property).');
  }
  return DriveApp.getFolderById(id);
}

function merchantDocsFolder_() {
  const configured = cfg_('MERCHANT_DOCS_FOLDER_ID', MERCHANT_DOCS_FOLDER_ID);
  if (configured) {
    try { return DriveApp.getFolderById(configured); } catch (err) { /* fall through */ }
  }
  // Not configured (placeholder/blank) — find or create the folder once and
  // remember it in Script Properties so KYC uploads still land somewhere safe.
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('MERCHANT_DOCS_FOLDER_ID_CACHE');
  if (cached) {
    try { return DriveApp.getFolderById(cached); } catch (err) { /* fall through */ }
  }
  const existing = DriveApp.getRootFolder().getFoldersByName(MERCHANT_DOCS_FOLDER_NAME);
  if (existing.hasNext()) {
    const folder = existing.next();
    props.setProperty('MERCHANT_DOCS_FOLDER_ID_CACHE', folder.getId());
    return folder;
  }
  const folder = DriveApp.createFolder(MERCHANT_DOCS_FOLDER_NAME);
  props.setProperty('MERCHANT_DOCS_FOLDER_ID_CACHE', folder.getId());
  return folder;
}

function shareForViewing_(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e2) {}
  }
}

function keepPrivate_(file) {
  // DOMAIN_RESTRICTED throws on personal (non-Workspace) Google accounts, so
  // fall back to PRIVATE. KYC documents should never be link-shareable.
  try {
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (err) {
    try { file.setSharing(DriveApp.Access.DOMAIN_RESTRICTED, DriveApp.Permission.VIEW); } catch (e2) {}
  }
}

// Admin (via key) OR approved merchant (via merchantId + password).
// The Users sheet is the single source of truth for passwords; the Merchants
// sheet copy is only kept for backwards compatibility.
function resolveStaffAuth_(data) {
  if (checkAdminKey_(data.adminKey)) return { ok: true, isAdmin: true };
  if (data.merchantId && data.password) {
    const rows = getSheet_(SHEETS.MERCHANTS).getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(data.merchantId)) continue;
      if (rows[i][8] !== 'APPROVED') return { ok: false, message: 'Merchant not yet approved by admin.' };

      const user = findUserById_(data.merchantId);
      const stored = (user && user[3]) ? user[3] : rows[i][9]; // Users.Password, then legacy copy
      if (!stored) return { ok: false, message: 'No password set for this vendor yet. Use “Forgot password?” to set one.' };
      if (!passwordMatches_(stored, String(data.password)))
        return { ok: false, message: 'Wrong merchant password.' };
      return { ok: true, isAdmin: false, merchantId: String(data.merchantId) };
    }
    return { ok: false, message: 'Merchant not found.' };
  }
  return { ok: false, message: 'Provide adminKey or merchant credentials.' };
}

// ------------------------------------------------------------
// OTP / TOKEN ENGINE (stored in the Otps sheet)
//   Key format: "PURPOSE:identifier"  e.g. VERIFY:U123, MVERIFY:M456, PWDRESET:<userId>
//   Only a SHA-256 hash of the code/token is stored; codes are single-use.
// ------------------------------------------------------------
function issueOtpRawCode_(identifier, purpose, rawCode, ttlMinutes) {
  pruneOtps_();
  const sheet = getSheet_(SHEETS.OTPS);
  const key = purpose + ':' + identifier;
  const rows = sheet.getDataRange().getValues();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== key) continue;
    sheet.getRange(i + 1, 2).setValue(hashPassword_(rawCode));
    sheet.getRange(i + 1, 3).setValue(purpose);
    sheet.getRange(i + 1, 4).setValue(expiresAt);
    sheet.getRange(i + 1, 5).setValue('');
    sheet.getRange(i + 1, 6).setValue(0);
    sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
    return;
  }
  sheet.appendRow([key, hashPassword_(rawCode), purpose, expiresAt, '', 0, new Date().toISOString()]);
}

function issueOtpAndEmail_(email, identifier, purpose) {
  const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  issueOtpRawCode_(identifier, purpose, otp, OTP_TTL_MINUTES);
  const what = purpose === 'MVERIFY' ? 'PharmaGo vendor verification' : 'PharmaGo account verification';
  const body =
    'Your one-time ' + what + ' code is:\n\n        ' + otp + '\n\n' +
    'It expires in ' + OTP_TTL_MINUTES + ' minutes and works once.\n' +
    "Didn't request this? Ignore this email.";
  try {
    MailApp.sendEmail({
      to: email,
      subject: otp + ' is your PharmaGo verification code',
      body: body,
      htmlBody: emailHtml_({
        heading: what,
        highlight: otp,
        highlightLabel: 'Verification code',
        text: 'Enter this code in the app to continue. It expires in ' + OTP_TTL_MINUTES +
          ' minutes and works once.\n' + "Didn't request this? Ignore this email."
      })
    });
  } catch (err) {
    return { ok: false, message: 'Could not send verification email: ' + err.message +
             ' (authorize MailApp & check quota).' };
  }
  return { ok: true };
}

/**
 * Validate + consume a stored one-time code.
 * @param {(key:string, purpose:string, hash:string) => boolean} predicate
 *        picks the row to validate (by key, or by hash for emailed tokens).
 * @param {string} code the raw code/token supplied by the user.
 */
function consumeStoredCode_(predicate, code) {
  const raw = String(code == null ? '' : code).trim();
  if (!raw) return { ok: false, message: 'Enter the code from your email.' };

  const sheet = getSheet_(SHEETS.OTPS);
  const rows = sheet.getDataRange().getValues();
  const submitted = hashPassword_(raw);

  for (let i = 1; i < rows.length; i++) {
    if (!predicate(String(rows[i][0]), String(rows[i][2]), String(rows[i][1]))) continue;

    if (rows[i][4] === 'YES')
      return { ok: false, message: 'This code was already used. Request a new one.' };
    if (new Date(rows[i][3]).getTime() < Date.now())
      return { ok: false, message: 'Code expired. Use “Resend code”.' };
    if ((Number(rows[i][5]) || 0) >= 5)
      return { ok: false, message: 'Too many wrong attempts. Request a new code.' };

    if (String(rows[i][1]) !== submitted) {
      const attempts = (Number(rows[i][5]) || 0) + 1;
      sheet.getRange(i + 1, 6).setValue(attempts);
      return { ok: false, message: 'Incorrect code (' + attempts + '/5 attempts).' };
    }

    sheet.getRange(i + 1, 5).setValue('YES'); // single use
    return { ok: true, key: String(rows[i][0]), identifier: String(rows[i][0]).split(':').slice(1).join(':') };
  }
  return { ok: false, message: 'No active code found — request a new one.' };
}

function consumeOtp_(key, code) {
  return consumeStoredCode_((rowKey) => rowKey === String(key), code);
}

/** Emailed tokens: the user never sees the key, only the token, so match by hash. */
function consumeToken_(purpose, token) {
  const submitted = hashPassword_(String(token == null ? '' : token).trim());
  return consumeStoredCode_((rowKey, rowPurpose, hash) => rowPurpose === purpose && hash === submitted, token);
}

/** Mark every pending code stored under `key` as consumed (e.g. after a reset). */
function invalidateOtps_(key) {
  const sheet = getSheet_(SHEETS.OTPS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === key && rows[i][4] !== 'YES') sheet.getRange(i + 1, 5).setValue('YES');
  }
}

// ------------------------------------------------------------
// ACCOUNT LOOKUPS
// ------------------------------------------------------------
function findUserByLoginId_(loginId) {
  const rows = getSheet_(SHEETS.USERS).getDataRange().getValues();
  const id = String(loginId).toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === id || String(rows[i][1]).toLowerCase() === id) return rows[i];
  }
  return null;
}

function indexOfUser_(sheet, userId) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(userId)) return i;
  }
  return -1;
}

function setMerchantPassword_(merchantId, passHash) {
  const sheet = getSheet_(SHEETS.MERCHANTS);
  const idx = indexOfUser_(sheet, merchantId); // same ID column layout
  if (idx >= 0) sheet.getRange(idx + 1, 10).setValue(passHash);
}

function merchantShopNames_() {
  const rows = getSheet_(SHEETS.MERCHANTS).getDataRange().getValues();
  const map = {};
  for (let i = 1; i < rows.length; i++) map[String(rows[i][0])] = String(rows[i][3] || '');
  return map;
}

function maskEmail_(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 1) return s;
  return s[0] + '***' + s.slice(at);
}

function nowIso_() {
  try {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
  } catch (err) {
    return new Date().toISOString();
  }
}

function fileStamp_() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function API_BASE_URL() {
  // The /exec URL of the deployed web app — used to build emailed links.
  return ScriptApp.getService().getUrl();
}

function parseFormEncoded_(raw) {
  const out = {};
  String(raw).split('&').forEach(pair => {
    if (!pair) return;
    const i = pair.indexOf('=');
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? '' : pair.slice(i + 1);
    try {
      out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch (err) {
      out[k] = v;
    }
  });
  return out;
}

// ------------------------------------------------------------
// RESPONSE BUILDERS
// ------------------------------------------------------------
function ok_(message, data) { return { success: true, message: message || 'OK', data: data || null }; }
function fail_(message, data) { return { success: false, message: message || 'Failed', data: data || null }; }

function jsonResult_(result) {
  return createResponse(result.success, result.message, result.data);
}

function createResponse(success, message, data) {
  return ContentService.createTextOutput(JSON.stringify({
    success: success, message: message, data: data === undefined ? null : data
  })).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// SELF-HOSTED "SET PASSWORD" PAGE
// Used when FRONTEND_URL is not configured (or while testing), so the emailed
// link always leads somewhere usable. A plain form POST needs no CORS.
// ------------------------------------------------------------
function passwordPageHtml_(token) {
  const action = API_BASE_URL();
  const body = [
    '<h1>Set your PharmaGo password</h1>',
    '<p><small>Choose a password of at least 6 characters. This link works once.</small></p>',
    '<form method="post" action="' + action + '">',
    '<input type="hidden" name="action" value="reset_password">',
    '<input type="hidden" name="token" value="' + token + '">',
    '<label for="password">New password</label>',
    '<input id="password" name="password" type="password" minlength="6" required autocomplete="new-password">',
    '<label for="password2">Confirm password</label>',
    '<input id="password2" name="password2" type="password" minlength="6" required autocomplete="new-password">',
    '<button type="submit">Set password</button></form>'
  ].join('');
  return pageShell_('PharmaGo — set your password', body);
}

// ------------------------------------------------------------
// Shared "Clinical" chrome for every page Apps Script serves itself
// (set-password form, form-post result, frontend hand-off). Keep in step with
// the tokens in index.html: clinical blue #1668d3 on cool white #f5f7fb.
// ------------------------------------------------------------
function clinicalCss_() {
  return [
    ':root{--brand:#1668d3;--brand-dark:#0d4ea6;--tint:#eef5ff;--line:#e4e9f1;--ink:#0f1b2d;--muted:#64748b}',
    '*{box-sizing:border-box}',
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;',
    'font-family:Inter,"Segoe UI",system-ui,-apple-system,Arial,sans-serif;font-size:15px;line-height:1.55;color:var(--ink);',
    'background-color:#f5f7fb;',
    'background-image:radial-gradient(760px 380px at 100% -10%,rgba(22,104,211,.12),transparent 62%),',
    'radial-gradient(620px 340px at -8% 6%,rgba(15,123,82,.08),transparent 58%),',
    'linear-gradient(rgba(15,27,45,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(15,27,45,.03) 1px,transparent 1px);',
    'background-size:auto,auto,100% 26px,26px 100%;background-attachment:fixed}',
    '.card{width:min(440px,94vw);padding:26px;background:#fff;border:1px solid var(--line);border-radius:20px;',
    'box-shadow:0 20px 50px rgba(11,32,64,.12)}',
    '.brand{display:flex;align-items:center;gap:11px;margin-bottom:16px}',
    '.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;color:#fff;',
    'background:linear-gradient(155deg,#2b83ea,#0d4ea6);box-shadow:0 6px 16px rgba(13,78,166,.3)}',
    '.name{font-size:17px;font-weight:800;letter-spacing:-.03em}',
    '.name span{color:var(--brand)}.sub{display:block;font-size:10.5px;font-weight:600;letter-spacing:.1em;',
    'text-transform:uppercase;color:#94a3b8}',
    'h1{margin:0 0 6px;font-size:21px;font-weight:700;letter-spacing:-.02em}',
    'p{margin:6px 0;color:#33465e}small{color:var(--muted);font-size:13px}',
    'label{display:block;margin-top:14px;font-size:12px;font-weight:700;color:#33465e}',
    'input{width:100%;padding:11px 12px;margin-top:5px;font:inherit;font-size:14px;color:var(--ink);',
    'background:#fff;border:1px solid #d5dcea;border-radius:10px;box-shadow:0 1px 2px rgba(15,27,45,.05)}',
    'input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(22,104,211,.16)}',
    'button{width:100%;margin-top:18px;padding:11px 16px;border:0;border-radius:10px;background:var(--brand);',
    'color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 1px 2px rgba(13,78,166,.3)}',
    'button:hover{background:var(--brand-dark)}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--brand);outline-offset:2px}',
    '.msg{margin-top:14px;padding:12px 14px;border-radius:10px;font-size:14px;border:1px solid transparent}',
    '.msg.ok{background:#e8f7ef;color:#0b5f40;border-color:#b6e3cb}',
    '.msg.err{background:#fdeeed;color:#96271f;border-color:#f4c9c5}',
    '.msg.info{background:var(--tint);color:#2b5c96;border-color:#bcd6f7}',
    'a{color:var(--brand);font-weight:600}'
  ].join('');
}

/** Wrap body markup in the shared clinical chrome; returns an HTML string. */
function pageShell_(title, bodyHtml, headExtra) {
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="theme-color" content="#1668d3">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">',
    '<title>' + title + '</title>',
    '<style>' + clinicalCss_() + '</style>',
    headExtra || '',
    '</head><body><main class="card">',
    '<div class="brand"><span class="mark" aria-hidden="true">',
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    '</span><span><span class="name">pharma<span>go</span></span><span class="sub">Clinical workspace</span></span></div>',
    bodyHtml,
    '</main></body></html>'
  ].join('');
}

/** HTML answer for form posts (so a browser never sees raw JSON). */
function htmlResult_(result) {
  const frontend = frontendUrl_();
  const link = frontend
    ? '<p><a href="' + frontend + '">Continue to PharmaGo →</a></p>'
    : '<p><small>You can close this tab and sign in from the PharmaGo app.</small></p>';
  const body = [
    '<h1>PharmaGo</h1>',
    '<div class="msg ' + (result.success ? 'ok' : 'err') + '">' + escapeHtml_(result.message) + '</div>',
    result.success ? link : '<p><small>Request a new link from the app’s “Forgot password?” screen.</small></p>'
  ].join('');
  return HtmlService.createHtmlOutput(pageShell_('PharmaGo — set your password', body));
}

// ------------------------------------------------------------
// BRANDED EMAIL TEMPLATE
// Mail clients strip <style> blocks and ignore external CSS, so everything is
// inline and table-based. Every message keeps its plain-text body as a fallback.
// ------------------------------------------------------------
function emailHtml_(opts) {
  const o = opts || {};
  const esc = escapeHtml_;
  const paragraphs = String(o.text == null ? '' : o.text).split('\n').map(function (line) {
    return line.trim() === ''
      ? '<div style="height:8px;line-height:8px">&nbsp;</div>'
      : '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#33465e">' + esc(line) + '</p>';
  }).join('');
  const cta = o.buttonUrl
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px">' +
      '<tr><td style="background:#1668d3;border-radius:10px">' +
      '<a href="' + esc(o.buttonUrl) + '" style="display:inline-block;padding:11px 18px;' +
      'font-family:Inter,Segoe UI,system-ui,Arial,sans-serif;font-size:14px;font-weight:700;' +
      'color:#ffffff;text-decoration:none">' + esc(o.buttonLabel || 'Open PharmaGo') + '</a></td></tr></table>'
    : '';
  const highlight = o.highlight
    ? '<div style="margin:16px 0;padding:14px 16px;border-radius:12px;background:#eef5ff;' +
      'border:1px solid #bcd6f7;text-align:center">' +
      '<div style="font-family:IBM Plex Mono,Consolas,monospace;font-size:28px;font-weight:600;' +
      'letter-spacing:.22em;color:#0d4ea6">' + esc(o.highlight) + '</div>' +
      '<div style="margin-top:6px;font-size:11.5px;font-weight:600;letter-spacing:.06em;' +
      'text-transform:uppercase;color:#5c6b7f">' + esc(o.highlightLabel || 'One-time code') + '</div></div>'
    : '';
  return [
    '<div style="background:#f5f7fb;padding:26px 14px">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:540px;margin:0 auto">',
    '<tr><td style="padding-bottom:14px;font-family:Inter,Segoe UI,system-ui,Arial,sans-serif">',
    '<span style="display:inline-block;width:30px;height:30px;border-radius:9px;background:#1668d3;' +
    'color:#ffffff;font-size:18px;font-weight:700;line-height:30px;text-align:center">+</span>',
    '<span style="margin-left:9px;font-size:16px;font-weight:800;letter-spacing:-.03em;color:#0f1b2d">pharma',
    '<span style="color:#1668d3">go</span></span>',
    '<span style="margin-left:8px;font-size:10.5px;font-weight:600;letter-spacing:.1em;' +
    'text-transform:uppercase;color:#94a3b8">clinical workspace</span>',
    '</td></tr>',
    '<tr><td style="background:#ffffff;border:1px solid #e4e9f1;border-radius:16px;padding:22px;' +
    'font-family:Inter,Segoe UI,system-ui,Arial,sans-serif">',
    o.heading ? '<h1 style="margin:0 0 12px;font-size:18px;font-weight:700;letter-spacing:-.02em;color:#0f1b2d">' +
      esc(o.heading) + '</h1>' : '',
    highlight, paragraphs, cta,
    o.linkFallback ? '<p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#64748b">' +
      'Button not working? Open this link:<br>' +
      '<a href="' + esc(o.linkFallback) + '" style="color:#1668d3;word-break:break-all">' + esc(o.linkFallback) + '</a></p>' : '',
    '</td></tr>',
    '<tr><td style="padding:14px 4px 0;font-family:Inter,Segoe UI,system-ui,Arial,sans-serif;' +
    'font-size:11.5px;line-height:1.6;color:#64748b">',
    esc(o.footer || 'PharmaGo — prescriptions and medicine delivery. Never share your password or admin key.'),
    '</td></tr></table></div>'
  ].join('');
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
