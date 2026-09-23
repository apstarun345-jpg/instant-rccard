/**
 * InstantRCcard — Google Apps Script backend
 *
 * Required Script Properties:
 *   RC_API_TOKEN   = provider token
 *   ADMIN_MOBILE   = owner's 10-digit mobile number
 *
 * This project should be bound to a private Google Sheet.
 * The sheet is used as the database for users, wallet and transactions.
 */

var RC_API_URL = 'https://api.apnirc.xyz/api/b2b/get-rc';
var RC_PRICE = 15;
var SESSION_TTL_SECONDS = 21600; // 6 hours
var USERS_SHEET = 'Users';
var TX_SHEET = 'Transactions';
var TOPUP_REQUESTS_SHEET = 'Web_TopupRequests';

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === 'snapshot') {
    if (!params.secret || params.secret !== getProperty_('SHEET_SYNC_SECRET')) {
      return jsonOutput_({ success: false, message: 'Unauthorized' });
    }
    ensureWebMirrorSheets_();
    return jsonOutput_(webSnapshot_());
  }
  ensureDatabase_();
  ensureWebMirrorSheets_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('InstantRCcard — RC Download')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setupInstantRCcard() {
  ensureDatabase_();
  ensureWebMirrorSheets_();
  return 'InstantRCcard database ready hai.';
}

/**
 * Server-to-server mirror endpoint for the direct Node website.
 * The Node server sends user and transaction events here; normal website
 * visitors never call this endpoint directly.
 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body.secret || body.secret !== getProperty_('SHEET_SYNC_SECRET')) {
      return jsonOutput_({ success: false, message: 'Unauthorized' });
    }
    // POST syncs must stay fast. Legacy recovery runs during setup/snapshot,
    // never inside a payment/user mutation that must return to the website.
    // Topup uses an even smaller sheet setup so the WhatsApp redirect cannot
    // wait for account/history migration work.
    if (body.action === 'topupRequest') {
      ensureTopupRequestSheet_();
      upsertWebTopupRequest_(body.payload || {});
    } else {
      ensureWebMirrorSheets_(false);
      if (body.action === 'user') {
        upsertWebUser_(body.payload || {});
        upsertWebAccount_(body.payload || {});
      } else if (body.action === 'transaction') appendWebTransaction_(body.payload || {});
      else if (body.action === 'ad') upsertWebAd_(body.payload || {});
      else if (body.action === 'adDelete') deleteWebAd_(body.payload || {});
      else if (body.action === 'settings') upsertWebSettings_(body.payload || {});
      else if (body.action === 'rateLog') upsertWebRateLog_(body.payload || {});
      else if (body.action === 'notification') upsertWebNotification_(body.payload || {});
      else if (body.action === 'pushSubscription') upsertWebPushSubscription_(body.payload || {});
      else if (body.action === 'pushSubscriptionDelete') deleteWebPushSubscription_(body.payload || {});
      else return jsonOutput_({ success: false, message: 'Unknown action' });
    }
    return jsonOutput_({ success: true });
  } catch (error) {
    return jsonOutput_({ success: false, message: error.message || 'Sync failed' });
  }
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureTopupRequestSheet_() {
  var sheet = getDatabase_().getSheetByName(TOPUP_REQUESTS_SHEET);
  if (!sheet) sheet = getDatabase_().insertSheet(TOPUP_REQUESTS_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id', 'clientReference', 'userId', 'shortUserId', 'internalUserId', 'name', 'email', 'mobile', 'amountRequested', 'amountApproved', 'status', 'createdAt', 'updatedAt', 'whatsappSentAt', 'decidedAt', 'decidedBy', 'rejectReason', 'syncedAt']);
    sheet.setFrozenRows(1);
  } else {
    ensureHeaderColumns_(sheet, ['shortUserId', 'internalUserId']);
  }
  return sheet;
}

function ensureWebMirrorSheets_(runLegacyMigration) {
  var spreadsheet = getDatabase_();
  var users = spreadsheet.getSheetByName('Web_Users');
  if (!users) users = spreadsheet.insertSheet('Web_Users');
  if (users.getLastRow() === 0) {
    users.appendRow(['userId', 'shortUserId', 'internalUserId', 'username', 'name', 'mobile', 'role', 'adminPermissions', 'wallet', 'rcCardPrice', 'rcRateUpdatedAt', 'rcRateUpdatedBy', 'createdAt', 'lastLogin', 'active', 'syncedAt']);
    users.setFrozenRows(1);
  } else {
    ensureHeaderColumns_(users, ['adminPermissions', 'rcCardPrice', 'rcRateUpdatedAt', 'rcRateUpdatedBy', 'shortUserId', 'internalUserId', 'username']);
  }

  var transactions = spreadsheet.getSheetByName('Web_Transactions');
  if (!transactions) transactions = spreadsheet.insertSheet('Web_Transactions');
  if (transactions.getLastRow() === 0) {
    transactions.appendRow(['id', 'time', 'mobile', 'type', 'amount', 'balanceAfter', 'vrn', 'status', 'note', 'adminMobile', 'sourceMobile', 'sourceName', 'targetMobile', 'targetName', 'adminName', 'direction', 'sourceTransactionId', 'downloadType', 'idempotencyKey', 'sheetSyncPending', 'syncedAt', 'internalTransactionId', 'transactionId']);
    transactions.setFrozenRows(1);
  } else {
    ensureHeaderColumns_(transactions, ['internalTransactionId', 'transactionId', 'sourceMobile', 'sourceName', 'targetMobile', 'targetName', 'adminName', 'direction', 'sourceTransactionId', 'downloadType', 'idempotencyKey', 'sheetSyncPending']);
  }

  var topupRequests = spreadsheet.getSheetByName(TOPUP_REQUESTS_SHEET);
  if (!topupRequests) topupRequests = spreadsheet.insertSheet(TOPUP_REQUESTS_SHEET);
  if (topupRequests.getLastRow() === 0) {
    topupRequests.appendRow(['id', 'clientReference', 'userId', 'shortUserId', 'internalUserId', 'name', 'email', 'mobile', 'amountRequested', 'amountApproved', 'status', 'createdAt', 'updatedAt', 'whatsappSentAt', 'decidedAt', 'decidedBy', 'rejectReason', 'syncedAt']);
    topupRequests.setFrozenRows(1);
  } else {
    ensureHeaderColumns_(topupRequests, ['clientReference', 'shortUserId', 'internalUserId']);
  }

  var accounts = spreadsheet.getSheetByName('Web_Accounts');
  if (!accounts) accounts = spreadsheet.insertSheet('Web_Accounts');
  if (accounts.getLastRow() === 0) {
    accounts.appendRow(['userId', 'shortUserId', 'internalUserId', 'username', 'name', 'email', 'mobile', 'passwordHash', 'salt', 'role', 'adminPermissions', 'wallet', 'rcCardPrice', 'rcRateUpdatedAt', 'rcRateUpdatedBy', 'createdAt', 'lastLogin', 'active', 'syncedAt']);
    accounts.setFrozenRows(1);
  } else {
    ensureHeaderColumns_(accounts, ['adminPermissions', 'rcCardPrice', 'rcRateUpdatedAt', 'rcRateUpdatedBy', 'shortUserId', 'internalUserId', 'username']);
  }

  var ads = spreadsheet.getSheetByName('Web_Ads');
  if (!ads) ads = spreadsheet.insertSheet('Web_Ads');
  if (ads.getLastRow() === 0) {
    ads.appendRow(['id', 'title', 'imageData', 'active', 'createdAt', 'updatedAt', 'syncedAt']);
    ads.setFrozenRows(1);
  }

  var settings = spreadsheet.getSheetByName('Web_Settings');
  if (!settings) settings = spreadsheet.insertSheet('Web_Settings');
  if (settings.getLastRow() === 0) {
    settings.appendRow(['key', 'value', 'updatedAt']);
    settings.setFrozenRows(1);
  }

  var rateLog = spreadsheet.getSheetByName('Web_RateLog');
  if (!rateLog) rateLog = spreadsheet.insertSheet('Web_RateLog');
  if (rateLog.getLastRow() === 0) {
    rateLog.appendRow(['id', 'time', 'adminMobile', 'mobile', 'name', 'from', 'to', 'syncedAt']);
    rateLog.setFrozenRows(1);
  }

  var notifications = spreadsheet.getSheetByName('Web_Notifications');
  if (!notifications) notifications = spreadsheet.insertSheet('Web_Notifications');
  if (notifications.getLastRow() === 0) {
    notifications.appendRow(['id', 'recipientUserId', 'type', 'title', 'body', 'data', 'createdAt', 'read', 'syncedAt']);
    notifications.setFrozenRows(1);
  } else {
    ensureHeaderColumns_(notifications, ['recipientUserId', 'type', 'title', 'body', 'data', 'createdAt', 'read', 'syncedAt']);
  }

  var pushSubscriptions = spreadsheet.getSheetByName('Web_PushSubscriptions');
  if (!pushSubscriptions) pushSubscriptions = spreadsheet.insertSheet('Web_PushSubscriptions');
  if (pushSubscriptions.getLastRow() === 0) {
    pushSubscriptions.appendRow(['endpoint', 'userId', 'mobile', 'subscription', 'updatedAt', 'syncedAt']);
    pushSubscriptions.setFrozenRows(1);
  } else {
    ensureHeaderColumns_(pushSubscriptions, ['endpoint', 'userId', 'mobile', 'subscription', 'updatedAt', 'syncedAt']);
  }
  // The legacy import is intentionally one-time per migration version.
  // Running it inside every topup/user POST makes Apps Script slow enough to
  // abort the WhatsApp redirect request. It is safe to retry if an exception
  // occurs because the marker is written only after all migration work passes.
  var migrationVersion = 'web-mirror-v3';
  var scriptProperties = PropertiesService.getScriptProperties();
  if (runLegacyMigration !== false && scriptProperties.getProperty('WEB_MIRROR_MIGRATION_VERSION') !== migrationVersion) {
    migrateLegacyWebMirror_(users, accounts, transactions);
    migrateShortMirrorIds_(accounts, 'userId', 'internalUserId', 'u');
    alignWebUserIdsToAccounts_(users, accounts);
    migrateShortMirrorIds_(users, 'userId', 'internalUserId', 'u');
    migrateShortMirrorIds_(transactions, 'id', 'internalTransactionId', 'T');
    migrateTopupUserIds_(topupRequests, accounts, users);
    scriptProperties.setProperty('WEB_MIRROR_MIGRATION_VERSION', migrationVersion);
  }
}

function mirrorTransactionAlreadyPresent_(sheet, payload) {
  if (!sheet || sheet.getLastRow() < 2) return false;
  var direct = findMirrorRow_(sheet, [payload.id, payload.internalTransactionId]);
  if (direct) return true;
  var data = readMirrorRows_(sheet);
  var mobile = String(payload.mobile || '').replace(/\D/g, '');
  var type = String(payload.type || '').toUpperCase();
  var amount = Number(payload.amount || 0);
  var vrn = String(payload.vrn || '');
  var time = String(payload.time || '');
  return data.rows.some(function (row) {
    var rowMobile = String(mirrorValue_(row, data.columns, 'mobile') || '').replace(/\D/g, '');
    var rowTime = String(mirrorValue_(row, data.columns, 'time') || '');
    return rowMobile === mobile
      && String(mirrorValue_(row, data.columns, 'type') || '').toUpperCase() === type
      && Number(mirrorValue_(row, data.columns, 'amount') || 0) === amount
      && String(mirrorValue_(row, data.columns, 'vrn') || '') === vrn
      && (!time || !rowTime || rowTime === time);
  });
}

function migrateLegacyWebMirror_(webUsersSheet, webAccountsSheet, webTransactionsSheet) {
  var spreadsheet = getDatabase_();
  var legacyUsersSheet = spreadsheet.getSheetByName(USERS_SHEET);
  var legacyTransactionsSheet = spreadsheet.getSheetByName(TX_SHEET);
  var legacyUsers = readMirrorRows_(legacyUsersSheet);
  legacyUsers.rows.forEach(function (row) {
    var legacyId = String(mirrorValue_(row, legacyUsers.columns, 'userId') || '').trim();
    var mobile = String(mirrorValue_(row, legacyUsers.columns, 'mobile') || '').replace(/\D/g, '');
    if (!mobile) return;
    var internalId = legacyId || Utilities.getUuid();
    var name = String(mirrorValue_(row, legacyUsers.columns, 'name') || 'User');
    var payload = {
      userId: legacyId || internalId,
      shortUserId: '',
      internalUserId: internalId,
      username: name,
      name: name,
      email: String(mirrorValue_(row, legacyUsers.columns, 'email') || ''),
      mobile: mobile,
      passwordHash: String(mirrorValue_(row, legacyUsers.columns, 'passwordHash') || ''),
      salt: String(mirrorValue_(row, legacyUsers.columns, 'salt') || ''),
      role: String(mirrorValue_(row, legacyUsers.columns, 'role') || 'user'),
      adminPermissions: {},
      wallet: Number(mirrorValue_(row, legacyUsers.columns, 'wallet') || 0),
      rcCardPrice: '',
      createdAt: mirrorValue_(row, legacyUsers.columns, 'createdAt') || '',
      lastLogin: mirrorValue_(row, legacyUsers.columns, 'lastLogin') || '',
      active: String(mirrorValue_(row, legacyUsers.columns, 'active')).toLowerCase() !== 'false'
    };
    var accountRow = findMirrorRow_(webAccountsSheet, [legacyId, internalId, mobile]);
    if (!accountRow) {
      upsertWebAccount_(payload);
    } else {
      var accountColumns = headerColumns_(webAccountsSheet);
      var accountValues = webAccountsSheet.getRange(accountRow, 1, 1, Math.max(webAccountsSheet.getLastColumn(), 1)).getValues()[0];
      var accountUpdates = {};
      if (!mirrorValue_(accountValues, accountColumns, 'passwordHash') && payload.passwordHash) accountUpdates.passwordHash = payload.passwordHash;
      if (!mirrorValue_(accountValues, accountColumns, 'salt') && payload.salt) accountUpdates.salt = payload.salt;
      if (!mirrorValue_(accountValues, accountColumns, 'username')) accountUpdates.username = name;
      if (!mirrorValue_(accountValues, accountColumns, 'internalUserId')) accountUpdates.internalUserId = internalId;
      if (Object.keys(accountUpdates).length) writeMirrorRow_(webAccountsSheet, accountRow, accountUpdates);
    }
    var userRow = findMirrorRow_(webUsersSheet, [legacyId, internalId, mobile]);
    if (!userRow) {
      upsertWebUser_(payload);
    } else {
      var userColumns = headerColumns_(webUsersSheet);
      var userValues = webUsersSheet.getRange(userRow, 1, 1, Math.max(webUsersSheet.getLastColumn(), 1)).getValues()[0];
      var userUpdates = {};
      if (!mirrorValue_(userValues, userColumns, 'username')) userUpdates.username = name;
      if (!mirrorValue_(userValues, userColumns, 'internalUserId')) userUpdates.internalUserId = internalId;
      if (Object.keys(userUpdates).length) writeMirrorRow_(webUsersSheet, userRow, userUpdates);
    }
  });

  var legacyTransactions = readMirrorRows_(legacyTransactionsSheet);
  legacyTransactions.rows.forEach(function (row) {
    var transactionId = String(mirrorValue_(row, legacyTransactions.columns, 'transactionId') || mirrorValue_(row, legacyTransactions.columns, 'id') || '').trim();
    if (!transactionId) return;
    var legacyTransactionPayload = {
      id: transactionId,
      internalTransactionId: transactionId,
      time: mirrorValue_(row, legacyTransactions.columns, 'time') || '',
      mobile: String(mirrorValue_(row, legacyTransactions.columns, 'mobile') || '').replace(/\D/g, ''),
      type: String(mirrorValue_(row, legacyTransactions.columns, 'type') || ''),
      amount: Number(mirrorValue_(row, legacyTransactions.columns, 'amount') || 0),
      balanceAfter: Number(mirrorValue_(row, legacyTransactions.columns, 'balanceAfter') || 0),
      vrn: String(mirrorValue_(row, legacyTransactions.columns, 'vrn') || ''),
      status: String(mirrorValue_(row, legacyTransactions.columns, 'status') || 'SUCCESS'),
      note: String(mirrorValue_(row, legacyTransactions.columns, 'note') || ''),
      adminMobile: String(mirrorValue_(row, legacyTransactions.columns, 'adminMobile') || '')
    };
    if (!mirrorTransactionAlreadyPresent_(webTransactionsSheet, legacyTransactionPayload)) {
      appendWebTransaction_(legacyTransactionPayload);
    }
  });
}

function alignWebUserIdsToAccounts_(usersSheet, accountsSheet) {
  if (!usersSheet || !accountsSheet || usersSheet.getLastRow() < 2 || accountsSheet.getLastRow() < 2) return;
  var accountData = readMirrorRows_(accountsSheet);
  var byKey = {};
  accountData.rows.forEach(function (row) {
    var shortId = String(mirrorValue_(row, accountData.columns, 'shortUserId') || mirrorValue_(row, accountData.columns, 'userId') || '').trim();
    var internalId = String(mirrorValue_(row, accountData.columns, 'internalUserId') || mirrorValue_(row, accountData.columns, 'userId') || '').trim();
    var mobile = String(mirrorValue_(row, accountData.columns, 'mobile') || '').replace(/\D/g, '');
    var identity = { shortId: shortId, internalId: internalId };
    if (shortId) byKey[shortId] = identity;
    if (internalId) byKey[internalId] = identity;
    if (mobile) byKey[mobile] = identity;
  });
  var userData = readMirrorRows_(usersSheet);
  userData.rows.forEach(function (row, index) {
    var mobile = String(mirrorValue_(row, userData.columns, 'mobile') || '').replace(/\D/g, '');
    var currentId = String(mirrorValue_(row, userData.columns, 'internalUserId') || mirrorValue_(row, userData.columns, 'userId') || '').trim();
    var identity = byKey[currentId] || byKey[mobile];
    if (!identity || !identity.shortId) return;
    writeMirrorRow_(usersSheet, index + 2, {
      userId: identity.shortId,
      shortUserId: identity.shortId,
      internalUserId: identity.internalId
    });
  });
}

function migrateShortMirrorIds_(sheet, idHeader, internalHeader, prefix) {
  if (!sheet || sheet.getLastRow() < 2) return;
  var columns = headerColumns_(sheet);
  var idColumn = columns[idHeader];
  var internalColumn = columns[internalHeader];
  if (!idColumn || !internalColumn) return;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 1)).getValues();
  var used = {};
  var assigned = {};
  var next = 1;
  var shortPattern = new RegExp('^' + prefix + '\\d+$', 'i');
  rows.forEach(function (row) {
    var value = String(row[idColumn - 1] || '').trim();
    if (shortPattern.test(value)) used[value.toUpperCase()] = true;
  });
  rows.forEach(function (row, index) {
    var rowNumber = index + 2;
    var value = String(row[idColumn - 1] || '').trim();
    var internal = String(row[internalColumn - 1] || '').trim();
    if (!internal) internal = value;
    var shortValue = value;
    if (!shortPattern.test(shortValue) || assigned[shortValue.toUpperCase()]) {
      while (used[(prefix + next).toUpperCase()] || assigned[(prefix + next).toUpperCase()]) next += 1;
      shortValue = prefix + next;
      used[shortValue.toUpperCase()] = true;
      next += 1;
    }
    assigned[shortValue.toUpperCase()] = true;
    var updates = {};
    updates[idHeader] = shortValue;
    updates[internalHeader] = internal;
    if (columns.shortUserId) updates.shortUserId = shortValue;
    if (columns.transactionId) updates.transactionId = shortValue;
    writeMirrorRow_(sheet, rowNumber, updates);
  });
}

function migrateTopupUserIds_(topupSheet, accountsSheet, usersSheet) {
  if (!topupSheet || topupSheet.getLastRow() < 2) return;
  var topupColumns = headerColumns_(topupSheet);
  if (!topupColumns.userId || !topupColumns.mobile) return;
  var identityByMobile = {};
  [accountsSheet, usersSheet].forEach(function (sheet) {
    var data = readMirrorRows_(sheet);
    data.rows.forEach(function (row) {
      var mobile = String(mirrorValue_(row, data.columns, 'mobile') || '').replace(/\D/g, '');
      if (!mobile) return;
      var shortId = String(mirrorValue_(row, data.columns, 'shortUserId') || mirrorValue_(row, data.columns, 'userId') || '');
      var internalId = String(mirrorValue_(row, data.columns, 'internalUserId') || mirrorValue_(row, data.columns, 'userId') || '');
      if (shortId) identityByMobile[mobile] = { shortId: shortId, internalId: internalId };
    });
  });
  var data = readMirrorRows_(topupSheet);
  data.rows.forEach(function (row, index) {
    var mobile = String(mirrorValue_(row, data.columns, 'mobile') || '').replace(/\D/g, '');
    var identity = identityByMobile[mobile];
    if (!identity) return;
    var updates = {
      userId: identity.shortId,
      shortUserId: identity.shortId,
      internalUserId: identity.internalId
    };
    writeMirrorRow_(topupSheet, index + 2, updates);
  });
}

function ensureHeaderColumns_(sheet, headers) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) { return String(value || ''); });
  headers.forEach(function (header) {
    if (existing.indexOf(header) !== -1) return;
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    existing.push(header);
  });
}

function headerColumns_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var columns = {};
  headers.forEach(function (value, index) {
    var name = String(value || '');
    if (name && !columns[name]) columns[name] = index + 1;
  });
  return columns;
}

function writeMirrorRow_(sheet, row, values) {
  var columns = headerColumns_(sheet);
  Object.keys(values).forEach(function (key) {
    if (!columns[key]) {
      columns[key] = sheet.getLastColumn() + 1;
      sheet.getRange(1, columns[key]).setValue(key);
    }
    sheet.getRange(row, columns[key]).setValue(values[key]);
  });
}

function readMirrorRows_(sheet) {
  if (!sheet) return { columns: {}, rows: [] };
  if (sheet.getLastRow() < 2) return { columns: headerColumns_(sheet), rows: [] };
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  return {
    columns: headerColumns_(sheet),
    rows: sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn).getValues()
  };
}

function findMirrorRow_(sheet, keys) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var columns = headerColumns_(sheet);
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn).getValues();
  var wanted = (keys || []).map(function (value) { return String(value || '').trim(); }).filter(Boolean);
  if (!wanted.length) return 0;
  for (var i = 0; i < rows.length; i++) {
    var matches = ['userId', 'internalUserId', 'id', 'internalTransactionId', 'mobile', 'endpoint'].some(function (column) {
      var value = columns[column] ? String(rows[i][columns[column] - 1] || '').trim() : '';
      return value && wanted.indexOf(value) !== -1;
    });
    if (matches) return i + 2;
  }
  return 0;
}

function mirrorValue_(row, columns, key) {
  return columns[key] ? row[columns[key] - 1] : '';
}

function mirrorPayloadValue_(sheet, row, payload, key) {
  if (Object.prototype.hasOwnProperty.call(payload || {}, key)) return payload[key];
  if (!row) return '';
  return mirrorValue_(sheet.getRange(row, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0], headerColumns_(sheet), key);
}

// Unrelated account updates must never erase an already stored custom rate.
// A blank rate without a rate-update timestamp is treated as an old/partial
// payload and preserves the existing value. A blank rate with a timestamp is
// the explicit clear-rate action and is respected.
function mirrorRcCardPrice_(sheet, row, payload) {
  var hasRate = Object.prototype.hasOwnProperty.call(payload || {}, 'rcCardPrice');
  var value = mirrorPayloadValue_(sheet, row, payload, 'rcCardPrice');
  if (value == null || value === '') {
    var hasUpdateAt = Object.prototype.hasOwnProperty.call(payload || {}, 'rcRateUpdatedAt');
    var updateAt = hasUpdateAt ? payload.rcRateUpdatedAt : '';
    if (!updateAt && row && hasRate) {
      var existing = mirrorValue_(sheet.getRange(row, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0], headerColumns_(sheet), 'rcCardPrice');
      if (existing != null && existing !== '') value = existing;
    }
  }
  if (value == null || value === '') return '';
  var number = Number(value);
  return isFinite(number) && number >= 1 ? Math.round(number) : '';
}

function upsertWebUser_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_Users');
  var userId = String(payload.userId || '');
  var row = findMirrorRow_(sheet, [userId, payload.internalUserId, payload.mobile]);
  if (!row) row = sheet.getLastRow() + 1;
  writeMirrorRow_(sheet, row, {
    userId: userId,
    shortUserId: String(payload.shortUserId || userId),
    internalUserId: String(payload.internalUserId || ''),
    username: String(payload.username || payload.name || ''),
    name: String(payload.name || ''),
    mobile: String(payload.mobile || ''),
    role: String(payload.role || 'user'),
    adminPermissions: JSON.stringify(payload.adminPermissions || {}),
    wallet: Number(payload.wallet || 0),
    rcCardPrice: mirrorRcCardPrice_(sheet, row, payload),
    rcRateUpdatedAt: String(mirrorPayloadValue_(sheet, row, payload, 'rcRateUpdatedAt') || ''),
    rcRateUpdatedBy: String(mirrorPayloadValue_(sheet, row, payload, 'rcRateUpdatedBy') || ''),
    createdAt: payload.createdAt || '',
    lastLogin: payload.lastLogin || '',
    active: payload.active !== false,
    syncedAt: new Date()
  });
}

function appendWebTransaction_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_Transactions');
  var transactionId = String(payload.id || payload.transactionId || Utilities.getUuid());
  var internalId = String(payload.internalTransactionId || transactionId);
  var row = findMirrorRow_(sheet, [transactionId, internalId]);
  if (!row) row = sheet.getLastRow() + 1;
  writeMirrorRow_(sheet, row, {
    id: transactionId,
    transactionId: transactionId,
    internalTransactionId: internalId,
    time: payload.time || new Date(),
    mobile: String(payload.mobile || ''),
    type: String(payload.type || ''),
    amount: Number(payload.amount || 0),
    balanceAfter: Number(payload.balanceAfter || 0),
    vrn: String(payload.vrn || ''),
    status: String(payload.status || 'SUCCESS'),
    note: String(payload.note || ''),
    adminMobile: String(payload.adminMobile || ''),
    sourceMobile: String(payload.sourceMobile || payload.sourceUserMobile || ''),
    sourceName: String(payload.sourceName || ''),
    targetMobile: String(payload.targetMobile || ''),
    targetName: String(payload.targetName || ''),
    adminName: String(payload.adminName || ''),
    direction: String(payload.direction || ''),
    sourceTransactionId: String(payload.sourceTransactionId || ''),
    downloadType: String(payload.downloadType || ''),
    idempotencyKey: String(payload.idempotencyKey || ''),
    sheetSyncPending: payload.sheetSyncPending === true,
    syncedAt: new Date()
  });
}

function upsertWebTopupRequest_(payload) {
  var sheet = getDatabase_().getSheetByName(TOPUP_REQUESTS_SHEET);
  var requestId = String(payload.id || '');
  if (!requestId) throw new Error('Topup request id missing');
  var row = 0;
  if (sheet.getLastRow() >= 2) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === requestId) { row = i + 2; break; }
    }
  }
  if (!row) row = sheet.getLastRow() + 1;
  writeMirrorRow_(sheet, row, {
    id: requestId,
    clientReference: String(payload.clientReference || ''),
    userId: String(payload.userId || ''),
    shortUserId: String(payload.shortUserId || payload.userId || ''),
    internalUserId: String(payload.internalUserId || ''),
    name: String(payload.name || ''),
    email: String(payload.email || ''),
    mobile: String(payload.mobile || ''),
    amountRequested: Number(payload.amountRequested || 0),
    amountApproved: payload.amountApproved == null || payload.amountApproved === '' ? '' : Number(payload.amountApproved),
    status: String(payload.status || 'PENDING'),
    createdAt: payload.createdAt || '',
    updatedAt: payload.updatedAt || payload.createdAt || '',
    whatsappSentAt: payload.whatsappSentAt || '',
    decidedAt: payload.decidedAt || '',
    decidedBy: String(payload.decidedBy || ''),
    rejectReason: String(payload.rejectReason || ''),
    syncedAt: new Date()
  });
}

function upsertWebNotification_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_Notifications');
  var id = String(payload.id || '');
  if (!id) throw new Error('Notification id missing');
  var row = findMirrorRow_(sheet, [id]);
  if (!row) row = sheet.getLastRow() + 1;
  var data = payload.data && typeof payload.data === 'object' ? JSON.stringify(payload.data) : String(payload.data || '{}');
  writeMirrorRow_(sheet, row, {
    id: id,
    recipientUserId: String(payload.recipientUserId || ''),
    type: String(payload.type || 'activity'),
    title: String(payload.title || ''),
    body: String(payload.body || ''),
    data: data,
    createdAt: payload.createdAt || new Date(),
    read: payload.read === true,
    syncedAt: new Date()
  });
}

function upsertWebPushSubscription_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_PushSubscriptions');
  var endpoint = String(payload.endpoint || (payload.subscription && payload.subscription.endpoint) || '');
  if (!endpoint) throw new Error('Push subscription endpoint missing');
  var row = findMirrorRow_(sheet, [endpoint]);
  if (!row) row = sheet.getLastRow() + 1;
  var subscription = payload.subscription && typeof payload.subscription === 'object' ? payload.subscription : payload;
  writeMirrorRow_(sheet, row, {
    endpoint: endpoint,
    userId: String(payload.userId || ''),
    mobile: String(payload.mobile || ''),
    subscription: JSON.stringify(subscription),
    updatedAt: payload.updatedAt || new Date(),
    syncedAt: new Date()
  });
}

function deleteWebPushSubscription_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_PushSubscriptions');
  var endpoint = String(payload.endpoint || '');
  if (!endpoint || sheet.getLastRow() < 2) return;
  var columns = headerColumns_(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 1)).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (columns.endpoint && String(values[i][columns.endpoint - 1] || '') === endpoint) sheet.deleteRow(i + 2);
  }
}

function upsertWebAccount_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_Accounts');
  var userId = String(payload.userId || '');
  var row = findMirrorRow_(sheet, [userId, payload.internalUserId, payload.mobile]);
  if (!row) row = sheet.getLastRow() + 1;
  writeMirrorRow_(sheet, row, {
    userId: userId,
    shortUserId: String(payload.shortUserId || userId),
    internalUserId: String(payload.internalUserId || ''),
    username: String(payload.username || payload.name || ''),
    name: String(payload.name || ''),
    email: String(payload.email || ''),
    mobile: String(payload.mobile || ''),
    passwordHash: String(payload.passwordHash || ''),
    salt: String(payload.salt || ''),
    role: String(payload.role || 'user'),
    adminPermissions: JSON.stringify(payload.adminPermissions || {}),
    wallet: Number(payload.wallet || 0),
    rcCardPrice: mirrorRcCardPrice_(sheet, row, payload),
    rcRateUpdatedAt: String(mirrorPayloadValue_(sheet, row, payload, 'rcRateUpdatedAt') || ''),
    rcRateUpdatedBy: String(mirrorPayloadValue_(sheet, row, payload, 'rcRateUpdatedBy') || ''),
    createdAt: payload.createdAt || '',
    lastLogin: payload.lastLogin || '',
    active: payload.active !== false,
    syncedAt: new Date()
  });
}

function upsertWebAd_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_Ads');
  var lastRow = sheet.getLastRow();
  var adId = String(payload.id || '');
  var row = 0;
  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === adId) { row = i + 2; break; }
    }
  }
  var values = [[
    adId,
    String(payload.title || ''),
    String(payload.imageData || ''),
    payload.active !== false,
    payload.createdAt || '',
    payload.updatedAt || payload.createdAt || '',
    new Date()
  ]];
  if (row) sheet.getRange(row, 1, 1, values[0].length).setValues(values);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, values[0].length).setValues(values);
}

function deleteWebAd_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_Ads');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(payload.id || '')) sheet.deleteRow(i + 2);
  }
}

function upsertWebSettings_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_Settings');
  var paymentQr = payload && payload.paymentQr != null ? String(payload.paymentQr) : '';
  // Keep the value below Google Sheets' per-cell character limit. The direct
  // website compresses QR images to this range before sending them here.
  if (paymentQr.length > 46000) throw new Error('Payment QR image compress nahi ho paayi. Chhoti QR image upload karo.');
  var allowed = ['rating', 'usersBaseline', 'downloadsBaseline', 'rcCardPrice', 'supportWhatsapp', 'paymentQr'];
  allowed.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return;
    var values = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
    var row = 0;
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]) === key) { row = i + 2; break; }
    }
    var value = payload[key] == null ? '' : String(payload[key]);
    var record = [[key, value, new Date()]];
    if (row) sheet.getRange(row, 1, 1, 3).setValues(record);
    else sheet.getRange(sheet.getLastRow() + 1, 1, 1, 3).setValues(record);
  });
}

function upsertWebRateLog_(payload) {
  var sheet = getDatabase_().getSheetByName('Web_RateLog');
  var id = String(payload.id || Utilities.getUuid());
  var row = 0;
  if (sheet.getLastRow() >= 2) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) { row = i + 2; break; }
    }
  }
  var record = [[
    id,
    payload.time || new Date(),
    String(payload.adminMobile || ''),
    String(payload.mobile || ''),
    String(payload.name || ''),
    payload.from == null ? '' : Number(payload.from),
    payload.to == null ? '' : Number(payload.to),
    new Date()
  ]];
  if (row) sheet.getRange(row, 1, 1, record[0].length).setValues(record);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, record[0].length).setValues(record);
}

function webSnapshot_() {
  var spreadsheet = getDatabase_();
  var accountsSheet = spreadsheet.getSheetByName('Web_Accounts');
  var txSheet = spreadsheet.getSheetByName('Web_Transactions');
  var adsSheet = spreadsheet.getSheetByName('Web_Ads');
  var settingsSheet = spreadsheet.getSheetByName('Web_Settings');
  var rateLogSheet = spreadsheet.getSheetByName('Web_RateLog');
  var notificationsSheet = spreadsheet.getSheetByName('Web_Notifications');
  var pushSubscriptionsSheet = spreadsheet.getSheetByName('Web_PushSubscriptions');
  var topupRequestsSheet = spreadsheet.getSheetByName(TOPUP_REQUESTS_SHEET);
  var accountsData = readMirrorRows_(accountsSheet);
  var accounts = accountsData.rows.map(function (row) {
    var customRate = mirrorValue_(row, accountsData.columns, 'rcCardPrice');
    customRate = customRate === '' || customRate == null ? null : Number(customRate);
    return {
      userId: String(mirrorValue_(row, accountsData.columns, 'userId') || ''),
      shortUserId: String(mirrorValue_(row, accountsData.columns, 'shortUserId') || mirrorValue_(row, accountsData.columns, 'userId') || ''),
      internalUserId: String(mirrorValue_(row, accountsData.columns, 'internalUserId') || mirrorValue_(row, accountsData.columns, 'userId') || ''),
      username: String(mirrorValue_(row, accountsData.columns, 'username') || mirrorValue_(row, accountsData.columns, 'name') || ''),
      name: String(mirrorValue_(row, accountsData.columns, 'name') || ''),
      email: String(mirrorValue_(row, accountsData.columns, 'email') || ''),
      mobile: String(mirrorValue_(row, accountsData.columns, 'mobile') || ''),
      passwordHash: String(mirrorValue_(row, accountsData.columns, 'passwordHash') || ''),
      salt: String(mirrorValue_(row, accountsData.columns, 'salt') || ''),
      role: String(mirrorValue_(row, accountsData.columns, 'role') || 'user'),
      adminPermissions: mirrorValue_(row, accountsData.columns, 'adminPermissions') ? String(mirrorValue_(row, accountsData.columns, 'adminPermissions')) : null,
      wallet: Number(mirrorValue_(row, accountsData.columns, 'wallet') || 0),
      rcCardPrice: Number.isFinite(customRate) && customRate >= 1 ? Math.round(customRate) : '',
      rcRateUpdatedAt: String(mirrorValue_(row, accountsData.columns, 'rcRateUpdatedAt') || ''),
      rcRateUpdatedBy: String(mirrorValue_(row, accountsData.columns, 'rcRateUpdatedBy') || ''),
      createdAt: mirrorValue_(row, accountsData.columns, 'createdAt') || '',
      lastLogin: mirrorValue_(row, accountsData.columns, 'lastLogin') || '',
      active: String(mirrorValue_(row, accountsData.columns, 'active')).toLowerCase() !== 'false'
    };
  });

  // Web_Users is a second recovery mirror. If an older deployment wrote a
  // user there but never created its Web_Accounts row, do not let restore
  // hide that account from the Node service. Password fields remain blank in
  // this fallback; a matching legacy Users row is migrated above when present.
  var webUsersData = readMirrorRows_(spreadsheet.getSheetByName('Web_Users'));
  var accountMobiles = {};
  var accountKeys = {};
  accounts.forEach(function (account) {
    var mobile = String(account.mobile || '').replace(/\D/g, '');
    var key = String(account.internalUserId || account.userId || '').trim();
    if (mobile) accountMobiles[mobile] = true;
    if (key) accountKeys[key] = true;
  });
  webUsersData.rows.forEach(function (row) {
    var mobile = String(mirrorValue_(row, webUsersData.columns, 'mobile') || '').replace(/\D/g, '');
    var internalId = String(mirrorValue_(row, webUsersData.columns, 'internalUserId') || mirrorValue_(row, webUsersData.columns, 'userId') || '').trim();
    if (!mobile || accountMobiles[mobile] || (internalId && accountKeys[internalId])) return;
    var customRate = mirrorValue_(row, webUsersData.columns, 'rcCardPrice');
    customRate = customRate === '' || customRate == null ? null : Number(customRate);
    accounts.push({
      userId: String(mirrorValue_(row, webUsersData.columns, 'userId') || ''),
      shortUserId: String(mirrorValue_(row, webUsersData.columns, 'shortUserId') || mirrorValue_(row, webUsersData.columns, 'userId') || ''),
      internalUserId: internalId,
      username: String(mirrorValue_(row, webUsersData.columns, 'username') || mirrorValue_(row, webUsersData.columns, 'name') || ''),
      name: String(mirrorValue_(row, webUsersData.columns, 'name') || ''),
      email: '',
      mobile: mobile,
      passwordHash: '',
      salt: '',
      role: String(mirrorValue_(row, webUsersData.columns, 'role') || 'user'),
      adminPermissions: mirrorValue_(row, webUsersData.columns, 'adminPermissions') ? String(mirrorValue_(row, webUsersData.columns, 'adminPermissions')) : null,
      wallet: Number(mirrorValue_(row, webUsersData.columns, 'wallet') || 0),
      rcCardPrice: Number.isFinite(customRate) && customRate >= 1 ? Math.round(customRate) : '',
      rcRateUpdatedAt: String(mirrorValue_(row, webUsersData.columns, 'rcRateUpdatedAt') || ''),
      rcRateUpdatedBy: String(mirrorValue_(row, webUsersData.columns, 'rcRateUpdatedBy') || ''),
      createdAt: mirrorValue_(row, webUsersData.columns, 'createdAt') || '',
      lastLogin: mirrorValue_(row, webUsersData.columns, 'lastLogin') || '',
      active: String(mirrorValue_(row, webUsersData.columns, 'active')).toLowerCase() !== 'false'
    });
    accountMobiles[mobile] = true;
    if (internalId) accountKeys[internalId] = true;
  });

  var txData = readMirrorRows_(txSheet);
  var transactions = txData.rows.map(function (row) {
    return {
      id: String(mirrorValue_(row, txData.columns, 'id') || ''),
      transactionId: String(mirrorValue_(row, txData.columns, 'transactionId') || mirrorValue_(row, txData.columns, 'id') || ''),
      internalTransactionId: String(mirrorValue_(row, txData.columns, 'internalTransactionId') || mirrorValue_(row, txData.columns, 'id') || ''),
      time: mirrorValue_(row, txData.columns, 'time') || '',
      mobile: String(mirrorValue_(row, txData.columns, 'mobile') || ''),
      type: String(mirrorValue_(row, txData.columns, 'type') || ''),
      amount: Number(mirrorValue_(row, txData.columns, 'amount') || 0),
      balanceAfter: Number(mirrorValue_(row, txData.columns, 'balanceAfter') || 0),
      vrn: String(mirrorValue_(row, txData.columns, 'vrn') || ''),
      status: String(mirrorValue_(row, txData.columns, 'status') || 'SUCCESS'),
      note: String(mirrorValue_(row, txData.columns, 'note') || ''),
      adminMobile: String(mirrorValue_(row, txData.columns, 'adminMobile') || ''),
      sourceMobile: String(mirrorValue_(row, txData.columns, 'sourceMobile') || ''),
      sourceName: String(mirrorValue_(row, txData.columns, 'sourceName') || ''),
      targetMobile: String(mirrorValue_(row, txData.columns, 'targetMobile') || ''),
      targetName: String(mirrorValue_(row, txData.columns, 'targetName') || ''),
      adminName: String(mirrorValue_(row, txData.columns, 'adminName') || ''),
      direction: String(mirrorValue_(row, txData.columns, 'direction') || ''),
      sourceTransactionId: String(mirrorValue_(row, txData.columns, 'sourceTransactionId') || ''),
      downloadType: String(mirrorValue_(row, txData.columns, 'downloadType') || ''),
      idempotencyKey: String(mirrorValue_(row, txData.columns, 'idempotencyKey') || ''),
      sheetSyncPending: String(mirrorValue_(row, txData.columns, 'sheetSyncPending')).toLowerCase() === 'true'
    };
  });

  var topupRequestsData = readMirrorRows_(topupRequestsSheet);
  var topupRequests = topupRequestsData.rows.map(function (row) {
    var approved = mirrorValue_(row, topupRequestsData.columns, 'amountApproved');
    return {
      id: String(mirrorValue_(row, topupRequestsData.columns, 'id') || ''),
      clientReference: String(mirrorValue_(row, topupRequestsData.columns, 'clientReference') || ''),
      userId: String(mirrorValue_(row, topupRequestsData.columns, 'userId') || ''),
      shortUserId: String(mirrorValue_(row, topupRequestsData.columns, 'shortUserId') || mirrorValue_(row, topupRequestsData.columns, 'userId') || ''),
      internalUserId: String(mirrorValue_(row, topupRequestsData.columns, 'internalUserId') || ''),
      name: String(mirrorValue_(row, topupRequestsData.columns, 'name') || ''),
      email: String(mirrorValue_(row, topupRequestsData.columns, 'email') || ''),
      mobile: String(mirrorValue_(row, topupRequestsData.columns, 'mobile') || ''),
      amountRequested: Number(mirrorValue_(row, topupRequestsData.columns, 'amountRequested') || 0),
      amountApproved: approved === '' || approved == null ? null : Number(approved),
      status: String(mirrorValue_(row, topupRequestsData.columns, 'status') || 'PENDING'),
      createdAt: mirrorValue_(row, topupRequestsData.columns, 'createdAt') || '',
      updatedAt: mirrorValue_(row, topupRequestsData.columns, 'updatedAt') || '',
      whatsappSentAt: mirrorValue_(row, topupRequestsData.columns, 'whatsappSentAt') || '',
      decidedAt: mirrorValue_(row, topupRequestsData.columns, 'decidedAt') || '',
      decidedBy: String(mirrorValue_(row, topupRequestsData.columns, 'decidedBy') || ''),
      rejectReason: String(mirrorValue_(row, topupRequestsData.columns, 'rejectReason') || '')
    };
  });

  var adsData = readMirrorRows_(adsSheet);
  var ads = adsData.rows.map(function (row) {
    return {
      id: String(mirrorValue_(row, adsData.columns, 'id') || ''),
      title: String(mirrorValue_(row, adsData.columns, 'title') || ''),
      imageData: String(mirrorValue_(row, adsData.columns, 'imageData') || ''),
      active: String(mirrorValue_(row, adsData.columns, 'active')).toLowerCase() !== 'false',
      createdAt: mirrorValue_(row, adsData.columns, 'createdAt') || '',
      updatedAt: mirrorValue_(row, adsData.columns, 'updatedAt') || ''
    };
  });

  var settings = {};
  var settingsData = readMirrorRows_(settingsSheet);
  settingsData.rows.forEach(function (row) {
    var key = String(mirrorValue_(row, settingsData.columns, 'key') || '');
    if (!key) return;
    var value = mirrorValue_(row, settingsData.columns, 'value');
    if (key === 'usersBaseline' || key === 'downloadsBaseline' || key === 'rcCardPrice') value = Number(value || 0);
    settings[key] = value;
  });

  var rateLogData = readMirrorRows_(rateLogSheet);
  var rateLog = rateLogData.rows.slice(-300).map(function (row) {
    var from = mirrorValue_(row, rateLogData.columns, 'from');
    var to = mirrorValue_(row, rateLogData.columns, 'to');
    return {
      id: String(mirrorValue_(row, rateLogData.columns, 'id') || ''),
      time: mirrorValue_(row, rateLogData.columns, 'time') || '',
      adminMobile: String(mirrorValue_(row, rateLogData.columns, 'adminMobile') || ''),
      mobile: String(mirrorValue_(row, rateLogData.columns, 'mobile') || ''),
      name: String(mirrorValue_(row, rateLogData.columns, 'name') || ''),
      from: from === '' || from == null ? null : Number(from),
      to: to === '' || to == null ? null : Number(to)
    };
  });

  var notificationsData = readMirrorRows_(notificationsSheet);
  var notifications = notificationsData.rows.slice(-3000).map(function (row) {
    var rawData = mirrorValue_(row, notificationsData.columns, 'data');
    var data = {};
    try { data = rawData && typeof rawData === 'string' ? JSON.parse(rawData) : (rawData || {}); } catch (error) { data = {}; }
    return {
      id: String(mirrorValue_(row, notificationsData.columns, 'id') || ''),
      recipientUserId: String(mirrorValue_(row, notificationsData.columns, 'recipientUserId') || ''),
      type: String(mirrorValue_(row, notificationsData.columns, 'type') || 'activity'),
      title: String(mirrorValue_(row, notificationsData.columns, 'title') || ''),
      body: String(mirrorValue_(row, notificationsData.columns, 'body') || ''),
      data: data,
      createdAt: mirrorValue_(row, notificationsData.columns, 'createdAt') || '',
      read: String(mirrorValue_(row, notificationsData.columns, 'read')).toLowerCase() === 'true'
    };
  });

  var pushSubscriptionsData = readMirrorRows_(pushSubscriptionsSheet);
  var pushSubscriptions = pushSubscriptionsData.rows.map(function (row) {
    var rawSubscription = mirrorValue_(row, pushSubscriptionsData.columns, 'subscription');
    var subscription = {};
    try { subscription = rawSubscription && typeof rawSubscription === 'string' ? JSON.parse(rawSubscription) : (rawSubscription || {}); } catch (error) { subscription = {}; }
    return {
      endpoint: String(mirrorValue_(row, pushSubscriptionsData.columns, 'endpoint') || ''),
      userId: String(mirrorValue_(row, pushSubscriptionsData.columns, 'userId') || ''),
      mobile: String(mirrorValue_(row, pushSubscriptionsData.columns, 'mobile') || ''),
      subscription: subscription,
      updatedAt: mirrorValue_(row, pushSubscriptionsData.columns, 'updatedAt') || ''
    };
  }).filter(function (item) { return item.endpoint && item.subscription && item.subscription.keys; });

  return { success: true, accounts: accounts, transactions: transactions, topupRequests: topupRequests, ads: ads, settings: settings, rateLog: rateLog, notifications: notifications, pushSubscriptions: pushSubscriptions };
}

function normalizeMobile_(value) {
  var digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.indexOf('91') === 0) digits = digits.slice(2);
  return digits;
}

function isValidMobile_(mobile) {
  return /^[6-9]\d{9}$/.test(mobile);
}

function normalizeVrn_(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidVrn_(vrn) {
  return /^[A-Z0-9]{4,15}$/.test(vrn);
}

function getProperty_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function getDatabase_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  var spreadsheetId = getProperty_('SPREADSHEET_ID');
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

  throw new Error('Google Sheet se Apps Script bind karo ya SPREADSHEET_ID property set karo.');
}

function ensureDatabase_() {
  var spreadsheet = getDatabase_();
  var users = spreadsheet.getSheetByName(USERS_SHEET);
  if (!users) users = spreadsheet.insertSheet(USERS_SHEET);
  if (users.getLastRow() === 0) {
    users.appendRow([
      'userId', 'name', 'mobile', 'passwordHash', 'salt', 'wallet',
      'role', 'createdAt', 'lastLogin', 'active'
    ]);
    users.setFrozenRows(1);
  }

  var transactions = spreadsheet.getSheetByName(TX_SHEET);
  if (!transactions) transactions = spreadsheet.insertSheet(TX_SHEET);
  if (transactions.getLastRow() === 0) {
    transactions.appendRow([
      'transactionId', 'time', 'mobile', 'type', 'amount',
      'balanceAfter', 'vrn', 'status', 'note', 'adminMobile'
    ]);
    transactions.setFrozenRows(1);
  }
}

function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + '|' + String(password),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(bytes);
}

function createSession_(user) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(
    'instant-session-' + token,
    JSON.stringify({ mobile: user.mobile }),
    SESSION_TTL_SECONDS
  );
  return token;
}

function getSessionUser_(sessionToken) {
  if (!sessionToken) return null;
  var cached = CacheService.getScriptCache().get('instant-session-' + sessionToken);
  if (!cached) return null;

  var session;
  try {
    session = JSON.parse(cached);
  } catch (error) {
    return null;
  }

  var rowInfo = findUser_(session.mobile);
  if (!rowInfo || String(rowInfo.values[9]).toLowerCase() === 'false') return null;
  syncAdminRole_(rowInfo);
  return userFromRow_(rowInfo.row, rowInfo.values);
}

function userFromRow_(row, values) {
  return {
    row: row,
    userId: String(values[0] || ''),
    name: String(values[1] || ''),
    mobile: String(values[2] || ''),
    wallet: Number(values[5] || 0),
    role: String(values[6] || 'user'),
    createdAt: values[7] || '',
    lastLogin: values[8] || '',
    active: String(values[9]).toLowerCase() !== 'false'
  };
}

function syncAdminRole_(rowInfo) {
  var configuredAdmin = normalizeMobile_(getProperty_('ADMIN_MOBILE'));
  if (!configuredAdmin || String(rowInfo.values[2]) !== configuredAdmin) return;
  if (String(rowInfo.values[6]) === 'admin') return;
  rowInfo.values[6] = 'admin';
  getDatabase_().getSheetByName(USERS_SHEET).getRange(rowInfo.row, 7).setValue('admin');
}

function findUser_(mobile) {
  var sheet = getDatabase_().getSheetByName(USERS_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][2]) === String(mobile)) {
      return { row: i + 2, values: values[i] };
    }
  }
  return null;
}

function publicUser_(user) {
  return {
    name: user.name,
    mobile: user.mobile,
    wallet: Number(user.wallet || 0),
    role: user.role,
    pricePerRc: RC_PRICE
  };
}

function signup(name, mobile, password) {
  ensureDatabase_();
  name = String(name || '').trim();
  mobile = normalizeMobile_(mobile);
  password = String(password || '');

  if (name.length < 2) return { success: false, message: 'Apna naam enter karo.' };
  if (!isValidMobile_(mobile)) return { success: false, message: 'Valid 10-digit mobile number daalo.' };
  if (password.length < 6) return { success: false, message: 'Password minimum 6 characters ka hona chahiye.' };
  if (findUser_(mobile)) return { success: false, message: 'Is mobile number ka account pehle se bana hua hai.' };

  var adminMobile = normalizeMobile_(getProperty_('ADMIN_MOBILE'));
  var role = adminMobile && mobile === adminMobile ? 'admin' : 'user';
  var salt = Utilities.getUuid();
  var now = new Date();
  var user = {
    userId: Utilities.getUuid(),
    name: name,
    mobile: mobile,
    wallet: 0,
    role: role
  };

  getDatabase_().getSheetByName(USERS_SHEET).appendRow([
    user.userId,
    user.name,
    user.mobile,
    hashPassword_(password, salt),
    salt,
    0,
    role,
    now,
    now,
    true
  ]);

  var token = createSession_(user);
  return { success: true, token: token, user: publicUser_(user) };
}

function login(mobile, password) {
  ensureDatabase_();
  mobile = normalizeMobile_(mobile);
  password = String(password || '');
  if (!isValidMobile_(mobile) || !password) {
    return { success: false, message: 'Mobile number aur password dono enter karo.' };
  }

  var rowInfo = findUser_(mobile);
  if (!rowInfo) return { success: false, message: 'Account nahi mila. Pehle signup karo.' };
  if (String(rowInfo.values[9]).toLowerCase() === 'false') {
    return { success: false, message: 'Ye account disabled hai.' };
  }

  var expected = hashPassword_(password, rowInfo.values[4]);
  if (expected !== String(rowInfo.values[3])) {
    return { success: false, message: 'Mobile number ya password galat hai.' };
  }

  syncAdminRole_(rowInfo);
  var now = new Date();
  getDatabase_().getSheetByName(USERS_SHEET).getRange(rowInfo.row, 9).setValue(now);
  var user = userFromRow_(rowInfo.row, rowInfo.values);
  user.lastLogin = now;
  return { success: true, token: createSession_(user), user: publicUser_(user) };
}

function getMe(sessionToken) {
  var user = getSessionUser_(sessionToken);
  if (!user) return { success: false, message: 'Session expire ho gaya. Dobara login karo.' };
  return { success: true, user: publicUser_(user) };
}

function logout(sessionToken) {
  if (sessionToken) CacheService.getScriptCache().remove('instant-session-' + sessionToken);
  return { success: true };
}

function getMyTransactions(sessionToken) {
  var user = getSessionUser_(sessionToken);
  if (!user) return { success: false, message: 'Session expire ho gaya.' };
  return { success: true, transactions: readTransactionsForMobile_(user.mobile, 30) };
}

function readTransactionsForMobile_(mobile, limit) {
  var sheet = getDatabase_().getSheetByName(TX_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var result = [];
  for (var i = values.length - 1; i >= 0 && result.length < limit; i--) {
    if (String(values[i][2]) !== String(mobile)) continue;
    result.push({
      id: String(values[i][0]),
      time: values[i][1],
      mobile: String(values[i][2]),
      type: String(values[i][3]),
      amount: Number(values[i][4] || 0),
      balanceAfter: Number(values[i][5] || 0),
      vrn: String(values[i][6] || ''),
      status: String(values[i][7] || ''),
      note: String(values[i][8] || '')
    });
  }
  return result;
}

function appendTransaction_(mobile, type, amount, balanceAfter, vrn, status, note, adminMobile) {
  getDatabase_().getSheetByName(TX_SHEET).appendRow([
    Utilities.getUuid(),
    new Date(),
    mobile,
    type,
    amount,
    balanceAfter,
    vrn || '',
    status || 'SUCCESS',
    note || '',
    adminMobile || ''
  ]);
}

function fetchRcFromProvider_(vrn) {
  var apiToken = getProperty_('RC_API_TOKEN');
  if (!apiToken) return { success: false, message: 'RC_API_TOKEN Script Property me set nahi hai.' };

  try {
    var response = UrlFetchApp.fetch(RC_API_URL, {
      method: 'post',
      headers: {
        'Authorization': apiToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      payload: JSON.stringify({ vrn: vrn }),
      muteHttpExceptions: true
    });
    return parseProviderResponse_(response);
  } catch (error) {
    return { success: false, message: 'RC provider se connection nahi ho paaya.' };
  }
}

function parseProviderResponse_(response) {
  var status = response.getResponseCode();
  var payload;
  try {
    payload = JSON.parse(response.getContentText());
  } catch (error) {
    return { success: false, message: 'RC provider ne invalid response diya.' };
  }

  if (status < 200 || status >= 300 || payload.success === false) {
    return {
      success: false,
      message: payload.message || payload.error || 'RC image nahi mili. Vehicle number check karo.'
    };
  }

  var data = payload.data || payload.result || payload;
  var base64 = data && data.base64;
  if (!base64 || typeof base64 !== 'object' || !base64.front || !base64.back) {
    return { success: false, message: 'Front aur back RC image available nahi hai.' };
  }

  return {
    success: true,
    base64: {
      front: String(base64.front),
      back: String(base64.back)
    }
  };
}

function buyRc(sessionToken, vehicleNumber) {
  var user = getSessionUser_(sessionToken);
  if (!user) return { success: false, message: 'Session expire ho gaya. Dobara login karo.' };

  var vrn = normalizeVrn_(vehicleNumber);
  if (!isValidVrn_(vrn)) return { success: false, message: 'Valid vehicle number daalo, jaise RJ14AB1234.' };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var currentInfo = findUser_(user.mobile);
    if (!currentInfo) return { success: false, message: 'User account nahi mila.' };
    var currentUser = userFromRow_(currentInfo.row, currentInfo.values);
    if (currentUser.wallet < RC_PRICE) {
      return {
        success: false,
        code: 'LOW_BALANCE',
        message: 'Wallet balance kam hai. Admin se recharge karwao.',
        wallet: currentUser.wallet,
        required: RC_PRICE
      };
    }

    // Provider success ke baad hi ₹15 deduct hota hai.
    var provider = fetchRcFromProvider_(vrn);
    if (!provider.success) return provider;

    var newBalance = currentUser.wallet - RC_PRICE;
    getDatabase_().getSheetByName(USERS_SHEET).getRange(currentInfo.row, 6).setValue(newBalance);
    appendTransaction_(currentUser.mobile, 'RC_PURCHASE', -RC_PRICE, newBalance, vrn, 'SUCCESS', 'Front + back RC PNG download', '');

    return {
      success: true,
      data: {
        vrn: vrn,
        front: provider.base64.front,
        back: provider.base64.back
      },
      wallet: newBalance,
      charged: RC_PRICE
    };
  } catch (error) {
    return { success: false, message: error.message || 'RC purchase fail ho gayi.' };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function requireAdmin_(sessionToken) {
  var user = getSessionUser_(sessionToken);
  if (!user || user.role !== 'admin') throw new Error('Admin access required.');
  return user;
}

function adminFindUser(sessionToken, mobile) {
  var admin = requireAdmin_(sessionToken);
  mobile = normalizeMobile_(mobile);
  if (!isValidMobile_(mobile)) return { success: false, message: 'Valid 10-digit mobile number daalo.' };

  var rowInfo = findUser_(mobile);
  if (!rowInfo) return { success: false, message: 'Is mobile number ka account nahi mila.' };
  var user = userFromRow_(rowInfo.row, rowInfo.values);
  return {
    success: true,
    user: publicUser_(user),
    transactions: readTransactionsForMobile_(mobile, 10),
    adminMobile: admin.mobile
  };
}

function adminRecharge(sessionToken, targetMobile, amount, note) {
  var admin = requireAdmin_(sessionToken);
  targetMobile = normalizeMobile_(targetMobile);
  amount = Number(amount);
  note = String(note || 'Admin wallet recharge').trim().slice(0, 120);

  if (!isValidMobile_(targetMobile)) return { success: false, message: 'Valid user mobile number daalo.' };
  if (!isFinite(amount) || amount <= 0 || amount > 100000) {
    return { success: false, message: 'Recharge amount ₹1 se ₹100000 ke beech hona chahiye.' };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var rowInfo = findUser_(targetMobile);
    if (!rowInfo) return { success: false, message: 'User account nahi mila.' };
    var user = userFromRow_(rowInfo.row, rowInfo.values);
    var newBalance = user.wallet + amount;
    getDatabase_().getSheetByName(USERS_SHEET).getRange(rowInfo.row, 6).setValue(newBalance);
    appendTransaction_(targetMobile, 'RECHARGE', amount, newBalance, '', 'SUCCESS', note || 'Admin wallet recharge', admin.mobile);
    user.wallet = newBalance;
    return { success: true, user: publicUser_(user), message: 'Wallet recharge successful.' };
  } catch (error) {
    return { success: false, message: error.message || 'Recharge fail ho gaya.' };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function adminGetTransactions(sessionToken) {
  requireAdmin_(sessionToken);
  var sheet = getDatabase_().getSheetByName(TX_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, transactions: [] };

  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var result = [];
  for (var i = values.length - 1; i >= 0 && result.length < 50; i--) {
    result.push({
      id: String(values[i][0]),
      time: values[i][1],
      mobile: String(values[i][2]),
      type: String(values[i][3]),
      amount: Number(values[i][4] || 0),
      balanceAfter: Number(values[i][5] || 0),
      vrn: String(values[i][6] || ''),
      status: String(values[i][7] || ''),
      note: String(values[i][8] || ''),
      adminMobile: String(values[i][9] || '')
    });
  }
  return { success: true, transactions: result };
}
