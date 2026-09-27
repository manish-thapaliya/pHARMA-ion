// --- CONFIGURATION ---
const SHEET_ID = '1KH4PvzLiSewlYU4_mKw_PjHNGViSLRCYGvptvs-RO1k';
const PENDING_FOLDER_ID = '16p5tyaPsSFrh5NckqXtlZouGkVI84xkY';
const APPROVED_FOLDER_ID = '1OYytV1yUiNEkk0lHqswijQUudtbuPx31';
const DECLINED_FOLDER_ID = '1A028GXtnT_nH0dXDwJS4NWmQNnQcoQ3X';

// --- MAIN ROUTER ---
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    if (action === 'register') return registerUser(data);
    if (action === 'upload_rx') return uploadPrescription(data);
    if (action === 'update_status') return updateRxStatus(data);
    if (action === 'get_data') return getData(data);
    
    return createResponse(false, "Invalid action");
  } catch (err) {
    return createResponse(false, err.toString());
  }
}

function doGet(e) {
  return createResponse(true, "API is running. Use POST requests.");
}

// --- CORE FUNCTIONS ---

// 1. Register User (Checks for duplicate email/phone)
function registerUser(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Users');
  const rows = sheet.getDataRange().getValues();
  
  // Check duplicates
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === data.email || rows[i][2] === data.phone) {
      return createResponse(false, "Email or Phone already exists!");
    }
  }
  
  const userId = 'U' + new Date().getTime();
  sheet.appendRow([userId, data.email, data.phone, data.password, data.role || 'USER']);
  return createResponse(true, "Registered successfully", { userId });
}

// 2. Upload Prescription (Saves file to Drive, logs to Sheet)
function uploadPrescription(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Prescriptions');
  const folder = DriveApp.getFolderById(PENDING_FOLDER_ID);
  
  // Decode Base64 file from frontend
  const decoded = Utilities.base64Decode(data.fileBase64);
  const blob = Utilities.newBlob(decoded, data.fileType, data.fileName);
  
  // Save to Drive
  const file = folder.createFile(blob);
  const fileId = file.getId();
  
  // Log to Sheet
  const rxId = 'RX' + new Date().getTime();
  const timestamp = new Date().toISOString();
  sheet.appendRow([rxId, data.userId, data.fileName, fileId, 'PENDING', timestamp]);
  
  return createResponse(true, "Prescription uploaded", { rxId });
}

// 3. Admin Approve/Decline (Moves file in Drive, updates Sheet)
function updateRxStatus(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Prescriptions');
  const rows = sheet.getDataRange().getValues();
  
  const newStatus = data.status; // 'APPROVED' or 'DECLINED'
  const targetFolderId = newStatus === 'APPROVED' ? APPROVED_FOLDER_ID : DECLINED_FOLDER_ID;
  const targetFolder = DriveApp.getFolderById(targetFolderId);
  
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.rxId) {
      const fileId = rows[i][3];
      const file = DriveApp.getFileById(fileId);
      
      // ✅ CORRECT WAY: Add to new folder
      targetFolder.addFile(file);
      
      // ✅ CORRECT WAY: Remove from ALL old parent folders
      const parents = file.getParents();
      while (parents.hasNext()) {
        const parent = parents.next();
        // Don't remove from the target folder we just added it to
        if (parent.getId() !== targetFolderId) {
          parent.removeFile(file);
        }
      }
      
      // Update Sheet
      sheet.getRange(i + 1, 5).setValue(newStatus); // Column E is Status
      return createResponse(true, `Status updated to ${newStatus}`);
    }
  }
  return createResponse(false, "Prescription not found");
}

// 4. Get Data (For Admin/User Dashboards)
function getData(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(data.sheetName);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const result = [];
  
  for (let i = 1; i < rows.length; i++) {
    let obj = {};
    // Filter by userId if provided (for User history)
    if (data.userId && data.sheetName === 'Prescriptions' && rows[i][1] !== data.userId) continue;
    
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = rows[i][j];
    }
    result.push(obj);
  }
  return createResponse(true, "Data fetched", result);
}

// --- HELPER ---
function createResponse(success, message, data = null) {
  return ContentService.createTextOutput(JSON.stringify({ success, message, data }))
    .setMimeType(ContentService.MimeType.JSON);
}
