// ============================================================
// PHARMA DELIVERY MVP — GOOGLE APPS SCRIPT BACKEND
// Deploys as: Web App (Execute as: Me / Who has access: Anyone)
// Data lives in Google Sheets; files live in Google Drive folders.
// Frontend hosted on GitHub Pages calls this API via fetch().
// ============================================================

// --- CONFIGURATION (paste your own IDs here) ---
const SHEET_ID = '1KH4PvzLiSewlYU4_mKw_PjHNGViSLRCYGvptvs-RO1k';

// Prescription folders (upload flow)
const PENDING_FOLDER_ID  = '16p5tyaPsSFrh5NckqXtlZouGkVI84xkY'; // uploads land here
const APPROVED_FOLDER_ID = '1OYytV1yUiNEkk0lHqswijQUudtbuPx31'; // approved Rx moved here
const DECLINED_FOLDER_ID = '1A028GXtnT_nH0dXDwJS4NWmQNnQcoQ3X'; // declined Rx moved here

// Merchant document folder (GST, Drug License, etc.)
const MERCHANT_DOCS_FOLDER_ID = 'REPLACE_WITH_MERCHANT_DOCS_FOLDER_ID';

// Simple shared secret for admin/merchant actions (change it!)
const ADMIN_KEY = 'changeme-admin-key';

// Your GitHub Pages URL — emailed "set password" links redirect here
const FRONTEND_URL = 'https://USERNAME.github.io/REPO/';

// OTP / password-email settings
const OTP_TTL_MINUTES   = 10;   // one-time code validity
const RESET_LINK_HOURS  = 24;   // emailed "set password" link validity

// Sheet names
const SHEETS = {
  USERS: 'Users',            // UserID | Email | Phone | Password | Role | Name | Status | CreatedAt
  RX: 'Prescriptions',       // RxID | UserID | FileName | FileId | Status | Timestamp | ReviewedAt | ReviewNote
  MERCHANTS: 'Merchants',    // MerchantID | OwnerEmail | Phone | ShopName | Address | GSTNumber | DrugLicenseNumber | DocFileIds | Status | Password | CreatedAt | ReviewedAt
  MEDICINES: 'Medicines',    // MedicineID | Name | Category | Price | Stock | Description | MerchantID | Active | CreatedAt
  OTPS: 'Otps'               // Key | CodeHash | Purpose | ExpiresAt | Consumed | Attempts | CreatedAt
};

// ============================================================
// MAIN ROUTER
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // Auth & registration — one-time email verification + set-password-by-email
    if (action === 'register')          return registerUser(data);        // sends OTP to email
    if (action === 'verify_email')      return verifyEmail(data);         // OTP -> account ACTIVE
    if (action === 'verify_merchant')   return verifyMerchantEmail(data); // vendor OTP step
    if (action === 'resend_otp')        return resendOtp(data);           // new OTP to email
    if (action === 'login')             return loginUser(data);
    if (action === 'forgot_password')   return sendPasswordResetEmail(data); // emailed token link
    if (action === 'reset_password')    return resetPasswordWithToken(data); // set new password via token

    // Prescriptions
    if (action === 'upload_rx')         return uploadPrescription(data);
    if (action === 'update_status')     return updateRxStatus(data);   // admin approve/decline

    // Merchants
    if (action === 'register_merchant') return registerMerchant(data); // sends OTP to owner email
    if (action === 'review_merchant')   return reviewMerchant(data);   // admin approve/decline

    // Medicines
    if (action === 'add_medicine')      return addMedicine(data);      // admin or approved merchant
    if (action === 'update_medicine')   return updateMedicine(data);
    if (action === 'get_medicines')     return getMedicines(data);

    // Generic reads (dashboards)
    if (action === 'get_data')          return getData(data);
    if (action === 'setup')             return setupSheets();

    return createResponse(false, 'Invalid action: ' + action);
  } catch (err) {
    return createResponse(false, err.toString());
  }
}

function doGet(e) {
  // Optional simple reads via GET (e.g. ?action=get_medicines)
  try {
    const p = e.parameter || {};
    if (p.action === 'get_medicines') return getMedicines({});
    if (p.action === 'ping') return createResponse(true, 'API is running');
    // Emailed "set password" links land here: ?action=pwreset&token=...
    // Redirect the browser to the GitHub Pages frontend with the token prefilled.
    if (p.action === 'pwreset' && p.token) {
      return HtmlService.createHtmlOutput(
        '<meta http-equiv="refresh" content="0;url=' + FRONTEND_URL +
        '?page=reset&token=' + String(p.token).replace(/[^\w-]/g, '') + '">' +
        '<p>Taking you to the set-password page…</p>'
      );
    }
  } catch (err) { /* fall through */ }
  return createResponse(true, 'API is running. Use POST requests.');
}

// ============================================================
// ONE-TIME SETUP: creates all sheets with headers if missing
// Run once from the Apps Script editor: setupSheets()
// ============================================================
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const headers = {
    [SHEETS.USERS]:     ['UserID', 'Email', 'Phone', 'Password', 'Role', 'Name', 'Status', 'CreatedAt'],
    [SHEETS.RX]:        ['RxID', 'UserID', 'FileName', 'FileId', 'Status', 'Timestamp', 'ReviewedAt', 'ReviewNote'],
    [SHEETS.MERCHANTS]: ['MerchantID', 'OwnerEmail', 'Phone', 'ShopName', 'Address', 'GSTNumber', 'DrugLicenseNumber', 'DocFileIds', 'Status', 'Password', 'CreatedAt', 'ReviewedAt'],
    [SHEETS.MEDICINES]: ['MedicineID', 'Name', 'Category', 'Price', 'Stock', 'Description', 'MerchantID', 'Active', 'CreatedAt'],
    [SHEETS.OTPS]:      ['Key', 'CodeHash', 'Purpose', 'ExpiresAt', 'Consumed', 'Attempts', 'CreatedAt']
  };
  Object.keys(headers).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers[name]);
      sh.setFrozenRows(1);
    }
  });
  return createResponse(true, 'Sheets initialized: ' + Object.keys(headers).join(', '));
}

// ============================================================
// 1. REGISTRATION + ONE-TIME EMAIL VERIFICATION (OTP)
//    - No duplicate email OR phone
//    - Account is UNVERIFIED until the emailed OTP is entered
//    - Password can also be (re)set later through an emailed link
// ============================================================
function registerUser(data) {
  if (!data.email || !data.phone) {
    return createResponse(false, 'Email and phone are required.');
  }
  const sheet = getSheet_(SHEETS.USERS);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() === String(data.email).toLowerCase())
      return createResponse(false, 'Email already registered!');
    if (normalizePhone_(rows[i][2]) === normalizePhone_(data.phone))
      return createResponse(false, 'Phone number already registered!');
  }

  const userId = 'U' + new Date().getTime();
  // Password left empty here — it gets set via the OTP flow or an emailed link.
  sheet.appendRow([userId, data.email, data.phone, '', 'USER', data.name || '', 'UNVERIFIED', new Date().toISOString()]);

  const otpResult = issueOtpAndEmail_(data.email, userId, 'VERIFY');
  if (!otpResult.ok) return createResponse(false, otpResult.message);

  return createResponse(true,
    'Account created. We emailed a 6-digit verification code to ' + data.email + '. Enter it below (valid ' + OTP_TTL_MINUTES + ' minutes).',
    { userId, otpSentTo: data.email });
}

function verifyEmail(data) {
  const key = 'VERIFY:' + String(data.userId || '');
  const check = consumeOtp_(key, data.otp);
  if (!check.ok) return createResponse(false, check.message);

  const user = findUserById_(data.userId);
  if (!user) return createResponse(false, 'Unknown user ID.');

  const sheet = getSheet_(SHEETS.USERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.userId)) {
      sheet.getRange(i + 1, 7).setValue('ACTIVE');
      break;
    }
  }

  // If the user supplied a password at verification time, save it too.
  let passwordSet = false;
  if (data.password) {
    if (String(data.password).length < 6) return createResponse(false, 'Email verified, but password must be at least 6 characters.');
    sheet.getRange(indexOfUser_(sheet, data.userId) + 1, 4).setValue(hashPassword_(data.password));
    passwordSet = true;
  }

  return createResponse(true,
    passwordSet ? 'Email verified and password set — you can log in now.'
                : 'Email verified! Set your password using “Forgot password?” (we’ll email you a secure link).',
    { userId: data.userId, passwordSet });
}

function resendOtp(data) {
  const email = String(data.email || '').toLowerCase();
  const rows = getSheet_(SHEETS.USERS).getDataRange().getValues();
  let target = null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() === email) { target = rows[i]; break; }
  }
  if (!target) return createResponse(false, 'No account with that email.');
  if (String(target[6]) === 'ACTIVE') return createResponse(false, 'This account is already verified.');

  const purpose = String(target[4]) === 'MERCHANT' ? 'MVERIFY' : 'VERIFY';
  const r = issueOtpAndEmail_(target[1], target[0], purpose);
  return r.ok
    ? createResponse(true, 'A new code was emailed to ' + target[1] + '.')
    : createResponse(false, r.message);
}

function loginUser(data) {
  const sheet = getSheet_(SHEETS.USERS);
  const rows = sheet.getDataRange().getValues();
  const passHash = hashPassword_(data.password || '');

  for (let i = 1; i < rows.length; i++) {
    const idMatch = String(rows[i][0]) === String(data.loginId);
    const emailMatch = String(rows[i][1]).toLowerCase() === String(data.loginId).toLowerCase();
    if (idMatch || emailMatch) {
      if (rows[i][6] === 'UNVERIFIED') return createResponse(false, 'Please verify your email first (enter the OTP we sent you).');
      if (!rows[i][3])                  return createResponse(false, 'No password set yet. Use “Forgot password?” to set one via email.');
      if (rows[i][3] === passHash) {
        if (rows[i][6] === 'PENDING')  return createResponse(false, 'Account awaiting admin approval.');
        if (rows[i][6] === 'DECLINED') return createResponse(false, 'Account was declined by admin.');
        return createResponse(true, 'Login successful', {
          userId: rows[i][0], role: rows[i][4], name: rows[i][5]
        });
      }
      return createResponse(false, 'Invalid ID/email or password.');
    }
  }
  return createResponse(false, 'Invalid ID/email or password.');
}

// ------------------------------------------------------------
// PASSWORD SET THROUGH MAIL (forgot-password / first-time setup)
// ------------------------------------------------------------
function sendPasswordResetEmail(data) {
  const loginId = String(data.loginId || '').trim();
  if (!loginId) return createResponse(false, 'Enter your email or user ID.');
  const user = findUserByLoginId_(loginId);
  if (!user) return createResponse(false, 'If the account exists, a reset link has been emailed.');

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
    MailApp.sendEmail({ to: user[1], subject: 'PharmaGo — set your password', body: body });
  } catch (err) {
    return createResponse(false, 'Could not send email: ' + err.message + ' (check Apps Script quota/authorization).');
  }
  return createResponse(true, 'A password-setup link was emailed to ' + maskEmail_(user[1]) + '. It works once and expires in ' + RESET_LINK_HOURS + ' hours.');
}

function resetPasswordWithToken(data) {
  if (!data.token) return createResponse(false, 'Missing reset token.');
  if (!data.password || String(data.password).length < 6) {
    return createResponse(false, 'Password must be at least 6 characters.');
  }
  const check = consumeOtp_('PWDRESET:' + String(data.token), data.token); // validates existence/expiry/one-time
  if (!check.ok) return createResponse(false, check.message);

  const userId = check.key.split(':')[1];
  const sheet = getSheet_(SHEETS.USERS);
  const idx = indexOfUser_(sheet, userId);
  if (idx < 0) return createResponse(false, 'Account not found.');
  sheet.getRange(idx + 1, 4).setValue(hashPassword_(data.password));
  if (String(sheet.getRange(idx + 1, 7).getValue()) === 'UNVERIFIED') {
    sheet.getRange(idx + 1, 7).setValue('ACTIVE'); // email access proven -> treat as verified
  }
  return createResponse(true, 'Password set successfully. You can log in now.');
}

// ============================================================
// 2. PRESCRIPTION UPLOAD -> PENDING FOLDER, LOGGED IN SHEET
// ============================================================
function uploadPrescription(data) {
  if (!data.userId)    return createResponse(false, 'Missing userId.');
  if (!data.fileBase64) return createResponse(false, 'No file received.');

  if (!findUserById_(data.userId)) return createResponse(false, 'Unknown user ID.');

  const sheet = getSheet_(SHEETS.RX);
  const folder = DriveApp.getFolderById(PENDING_FOLDER_ID);

  const decoded = Utilities.base64Decode(data.fileBase64);
  const fileName = safeFileName_(data.userId, data.fileName);
  const blob = Utilities.newBlob(decoded, data.fileType || 'application/octet-stream', fileName);
  const file = folder.createFile(blob);

  // Anyone-with-link VIEW so the file can be opened from history / admin panel
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const rxId = 'RX' + new Date().getTime();
  const timestamp = new Date().toISOString(); // "uploaded time" used in naming + history
  sheet.appendRow([rxId, data.userId, fileName, file.getId(), 'PENDING', timestamp, '', '']);

  return createResponse(true, 'Prescription uploaded. Status: Pending', {
    rxId, timestamp, driveUrl: file.getUrl()
  });
}

// ============================================================
// 3. ADMIN APPROVE / DECLINE -> MOVE FILE BETWEEN DRIVE FOLDERS
//    Approved files renamed to UserID__UploadTime for designated-drive history
// ============================================================
function updateRxStatus(data) {
  if (!checkAdminKey_(data.adminKey)) return createResponse(false, 'Unauthorized: bad admin key.');

  const sheet = getSheet_(SHEETS.RX);
  const rows = sheet.getDataRange().getValues();
  const newStatus = String(data.status).toUpperCase(); // 'APPROVED' or 'DECLINED'

  if (newStatus !== 'APPROVED' && newStatus !== 'DECLINED') {
    return createResponse(false, 'Status must be APPROVED or DECLINED.');
  }

  const targetFolderId = newStatus === 'APPROVED' ? APPROVED_FOLDER_ID : DECLINED_FOLDER_ID;
  const targetFolder = DriveApp.getFolderById(targetFolderId);

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.rxId)) {
      if (rows[i][4] !== 'PENDING') return createResponse(false, 'Already reviewed: ' + rows[i][4]);

      const fileId = rows[i][3];
      const file = DriveApp.getFileById(fileId);

      // Approved? Rename to UserID__UploadedTime in the designated drive folder
      if (newStatus === 'APPROVED') {
        const uploadTime = String(rows[i][5]).replace(/[:.]/g, '-');
        file.setName(String(rows[i][1]) + '__' + uploadTime);
      }

      // Move correctly: add to target, remove from all other parents
      targetFolder.addFile(file);
      const parents = file.getParents();
      while (parents.hasNext()) {
        const parent = parents.next();
        if (parent.getId() !== targetFolderId) parent.removeFile(file);
      }

      sheet.getRange(i + 1, 5).setValue(newStatus);                // Status
      sheet.getRange(i + 1, 7).setValue(new Date().toISOString()); // ReviewedAt
      sheet.getRange(i + 1, 8).setValue(data.note || '');          // ReviewNote
      return createResponse(true, 'Status updated to ' + newStatus);
    }
  }
  return createResponse(false, 'Prescription not found.');
}

// ============================================================
// 4. MERCHANT REGISTRATION (multi-document upload) + REVIEW
//    Required docs: GST, Drug License, Shop ID proof, PAN
// ============================================================
const REQUIRED_MERCHANT_DOCS = ['GST', 'DRUG_LICENSE', 'SHOP_ID', 'PAN'];

function registerMerchant(data) {
  if (!data.email || !data.phone || !data.shopName)
    return createResponse(false, 'Email, phone and shop name are required.');

  // Duplicate check on email AND phone across Users sheet (merchants also log in there)
  const usersSheet = getSheet_(SHEETS.USERS);
  const uRows = usersSheet.getDataRange().getValues();
  for (let i = 1; i < uRows.length; i++) {
    if (String(uRows[i][1]).toLowerCase() === String(data.email).toLowerCase())
      return createResponse(false, 'Email already registered.');
    if (normalizePhone_(uRows[i][2]) === normalizePhone_(data.phone))
      return createResponse(false, 'Phone already registered.');
  }

  const docs = data.documents || []; // [{docType, fileName, fileType, fileBase64}, ...]
  const gotTypes = docs.map(d => String(d.docType).toUpperCase());
  const missing = REQUIRED_MERCHANT_DOCS.filter(t => gotTypes.indexOf(t) === -1);
  if (missing.length) return createResponse(false, 'Missing documents: ' + missing.join(', '));

  const merchantId = 'M' + new Date().getTime();
  const folder = DriveApp.getFolderById(MERCHANT_DOCS_FOLDER_ID);
  const fileIds = [];

  docs.forEach(d => {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(d.fileBase64),
      d.fileType || 'application/octet-stream',
      merchantId + '_' + String(d.docType).toUpperCase() + '_' + safeFileName_('', d.fileName)
    );
    const f = folder.createFile(blob);
    f.setSharing(DriveApp.Access.DOMAIN_RESTRICTED, DriveApp.Permission.VIEW); // keep KYC private
    fileIds.push(String(d.docType).toUpperCase() + ':' + f.getId());
  });

  const sheet = getSheet_(SHEETS.MERCHANTS);
  sheet.appendRow([
    merchantId, data.email, data.phone, data.shopName, data.address || '',
    data.gstNumber || '', data.drugLicenseNumber || '', fileIds.join(';'),
    'PENDING', '', new Date().toISOString(), ''
  ]);

  // Login entry with role MERCHANT (UNVERIFIED until OTP entered, then PENDING admin approval)
  usersSheet.appendRow([merchantId, data.email, data.phone, '',
                        'MERCHANT', data.shopName, 'UNVERIFIED', new Date().toISOString()]);

  // One-time email verification for the vendor owner too
  const otpResult = issueOtpAndEmail_(data.email, merchantId, 'MVERIFY');
  if (!otpResult.ok) return createResponse(false, 'Vendor created but verification email failed: ' + otpResult.message);

  return createResponse(true,
    'Vendor registered. A 6-digit verification code was emailed to ' + data.email + '. After verifying, an admin will review your documents.',
    { merchantId });
}

// Vendor email-verification step (purpose MVERIFY). On success the account
// stays PENDING for admin document review; password is set via emailed link.
function verifyMerchantEmail(data) {
  const check = consumeOtp_('MVERIFY:' + String(data.merchantId || ''), data.otp);
  if (!check.ok) return createResponse(false, check.message);

  const usersSheet = getSheet_(SHEETS.USERS);
  const idx = indexOfUser_(usersSheet, data.merchantId);
  if (idx < 0) return createResponse(false, 'Vendor not found.');
  usersSheet.getRange(idx + 1, 7).setValue('PENDING'); // email verified -> await admin doc approval

  if (data.password) {
    if (String(data.password).length < 6) return createResponse(false, 'Email verified, but password must be at least 6 characters.');
    usersSheet.getRange(idx + 1, 4).setValue(hashPassword_(data.password));
    setMerchantPassword_(data.merchantId, hashPassword_(data.password));
  }
  return createResponse(true, 'Vendor email verified! Your documents are now awaiting admin approval.');
}

function reviewMerchant(data) {
  if (!checkAdminKey_(data.adminKey)) return createResponse(false, 'Unauthorized: bad admin key.');

  const newStatus = String(data.status).toUpperCase();
  if (newStatus !== 'APPROVED' && newStatus !== 'DECLINED')
    return createResponse(false, 'Status must be APPROVED or DECLINED.');

  const sheet = getSheet_(SHEETS.MERCHANTS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.merchantId)) {
      sheet.getRange(i + 1, 9).setValue(newStatus);                  // Status
      sheet.getRange(i + 1, 12).setValue(new Date().toISOString());  // ReviewedAt
      mirrorUserStatus_(data.merchantId, newStatus);                 // gate login
      return createResponse(true, 'Merchant ' + newStatus);
    }
  }
  return createResponse(false, 'Merchant not found.');
}

// ============================================================
// 5. MEDICINES (admin anytime; merchants only after approval)
// ============================================================
function addMedicine(data) {
  const auth = resolveStaffAuth_(data); // adminKey OR merchant credentials
  if (!auth.ok) return createResponse(false, auth.message);

  if (!data.name || !data.price) return createResponse(false, 'Medicine name and price are required.');

  const sheet = getSheet_(SHEETS.MEDICINES);
  const medId = 'MED' + new Date().getTime();
  sheet.appendRow([
    medId, data.name, data.category || 'General', Number(data.price),
    Number(data.stock || 0), data.description || '',
    auth.merchantId || 'ADMIN', 'YES', new Date().toISOString()
  ]);
  return createResponse(true, 'Medicine added', { medId });
}

function updateMedicine(data) {
  const auth = resolveStaffAuth_(data);
  if (!auth.ok) return createResponse(false, auth.message);

  const sheet = getSheet_(SHEETS.MEDICINES);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.medId)) {
      if (!auth.isAdmin && String(rows[i][6]) !== auth.merchantId)
        return createResponse(false, 'You can only edit your own medicines.');
      if (data.price  != null) sheet.getRange(i + 1, 4).setValue(Number(data.price));
      if (data.stock  != null) sheet.getRange(i + 1, 5).setValue(Number(data.stock));
      if (data.active != null) sheet.getRange(i + 1, 8).setValue(data.active ? 'YES' : 'NO');
      return createResponse(true, 'Medicine updated');
    }
  }
  return createResponse(false, 'Medicine not found.');
}

function getMedicines(data) {
  const sheet = getSheet_(SHEETS.MEDICINES);
  const rows = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][7] !== 'YES') continue; // only active/listed items
    out.push({
      MedicineID: rows[i][0], Name: rows[i][1], Category: rows[i][2],
      Price: rows[i][3], Stock: rows[i][4], Description: rows[i][5],
      MerchantID: rows[i][6]
    });
  }
  return createResponse(true, 'Medicines fetched', out);
}

// ============================================================
// 6. GENERIC DATA READ (user history, admin lists, merchant lists)
// ============================================================
function getData(data) {
  const allowed = [SHEETS.USERS, SHEETS.RX, SHEETS.MERCHANTS, SHEETS.MEDICINES];
  if (allowed.indexOf(data.sheetName) === -1) return createResponse(false, 'Unknown sheet.');

  const sheet = getSheet_(data.sheetName);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    // Personal history filter: only own prescriptions
    if (data.userId && data.sheetName === SHEETS.RX && String(rows[i][1]) !== String(data.userId)) continue;
    // Merchant filter: only own medicines
    if (data.merchantId && data.sheetName === SHEETS.MEDICINES && String(rows[i][6]) !== String(data.merchantId)) continue;

    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j] === 'Password') continue; // never expose hashes
      obj[headers[j]] = rows[i][j];
    }
    result.push(obj);
  }
  return createResponse(true, 'Data fetched', result);
}

// ============================================================
// HELPERS
// ============================================================
function getSheet_(name) {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name + '. Run setupSheets() first.');
  return sh;
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

function safeFileName_(userId, original) {
  const clean = String(original || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return (userId ? userId + '_' : '') + stamp + '_' + clean;
}

// Lightweight hash (NOT production-grade security; adequate for MVP testing)
function hashPassword_(pw) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pw))
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function checkAdminKey_(key) {
  return String(key || '') === ADMIN_KEY;
}

// Admin (via key) OR approved merchant (via merchantId + password)
function resolveStaffAuth_(data) {
  if (checkAdminKey_(data.adminKey)) return { ok: true, isAdmin: true };
  if (data.merchantId && data.password) {
    const rows = getSheet_(SHEETS.MERCHANTS).getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.merchantId)) {
        if (rows[i][9] !== hashPassword_(data.password)) return { ok: false, message: 'Wrong merchant password.' };
        if (rows[i][8] !== 'APPROVED') return { ok: false, message: 'Merchant not yet approved by admin.' };
        return { ok: true, isAdmin: false, merchantId: data.merchantId };
      }
    }
    return { ok: false, message: 'Merchant not found.' };
  }
  return { ok: false, message: 'Provide adminKey or merchant credentials.' };
}

// ------------------------------------------------------------
// OTP / TOKEN ENGINE (stored in the Otps sheet)
//   Key format: "PURPOSE:identifier"  e.g. VERIFY:U123, MVERIFY:M456, PWDRESET:<uuid>
//   Only a SHA-256 hash of the code/token is stored; codes are single-use.
// ------------------------------------------------------------
function issueOtpRawCode_(identifier, purpose, rawCode, ttlMinutes) {
  const sheet = getSheet_(SHEETS.OTPS);
  const key = purpose + ':' + identifier;
  const rows = sheet.getDataRange().getValues();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === key) { // replace existing pending code
      sheet.getRange(i + 1, 2).setValue(hashPassword_(rawCode));
      sheet.getRange(i + 1, 3).setValue(purpose);
      sheet.getRange(i + 1, 4).setValue(expiresAt);
      sheet.getRange(i + 1, 5).setValue('');
      sheet.getRange(i + 1, 6).setValue(0);
      sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
      return;
    }
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
    MailApp.sendEmail({ to: email, subject: otp + ' is your PharmaGo verification code', body: body });
  } catch (err) {
    return { ok: false, message: 'Could not send verification email: ' + err.message + ' (authorize MailApp & check quota).' };
  }
  return { ok: true };
}

function consumeOtp_(key, code) {
  if (!code) return { ok: false, message: 'Enter the code from your email.' };
  const sheet = getSheet_(SHEETS.OTPS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== key) continue;
    if (rows[i][4] === 'YES')  return { ok: false, message: 'This code was already used. Request a new one.' };
    if (new Date(rows[i][3]).getTime() < Date.now()) return { ok: false, message: 'Code expired. Use “Resend code”.' };
    if ((Number(rows[i][5]) || 0) >= 5) return { ok: false, message: 'Too many wrong attempts. Request a new code.' };
    if (rows[i][1] !== hashPassword_(String(code).trim())) {
      sheet.getRange(i + 1, 6).setValue((Number(rows[i][5]) || 0) + 1);
      return { ok: false, message: 'Incorrect code (' + ((Number(rows[i][5]) || 0) + 1) + '/5 attempts).' };
    }
    sheet.getRange(i + 1, 5).setValue('YES'); // single use
    return { ok: true, key: key };
  }
  return { ok: false, message: 'No active code found — request a new one.' };
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

function maskEmail_(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 1) return s;
  return s[0] + '***' + s.slice(at);
}

function API_BASE_URL() {
  // The /exec URL of the deployed web app — used to build emailed links.
  return ScriptApp.getService().getUrl();
}

function createResponse(success, message, data = null) {
  return ContentService.createTextOutput(JSON.stringify({ success, message, data }))
    .setMimeType(ContentService.MimeType.JSON);
}
