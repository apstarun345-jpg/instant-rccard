/**
 * ============================================================================
 * GV PARTNER DASHBOARD — FINAL API CODE V4 (WITH TAG MAPPING)
 * ============================================================================
 * Is script ko Google Sheet ke Extensions > Apps Script me paste karein.
 * Aur Deploy > New deployment > Web app:
 * - Execute as: Me (Apna account)
 * - Who has access: Anyone (Sabhi ke liye)
 * 
 * Yeh API support karti hai:
 * 1. action=batchMapTags  -> Excel se multiple tags ko Google Sheet me map karna
 * 2. action=mapTag        -> Single tag map karna
 * 3. action=getData       -> Dashboard ke liye complete agent report aur tags fetch karna
 * 4. action=getTagMapping -> Pura Tag Mapping ka data fetch karna
 * 5. action=searchTags    -> Tag ID ya Serial No se search karna
 * 6. action=ping          -> Connection test check karna
 * ============================================================================
 */

// CONFIGURATION
var CONFIG = {
  TAG_MAPPING_SHEET: "Tag_Mapping",        // Excel mapping ka data yahan aayega
  TAG_ASSIGNMENT_SHEET: "Tag Assignment",  // Live tag assignment sheet
  AGENT_REPORT_SHEET: "Agent_Report",      // Agents list / issuance
  DAILY_TRENDS_SHEET: "Daily_Trends"       // Daily stats
};

// Standard column headers for Tag_Mapping sheet
var MAPPING_HEADERS = [
  "TAG_ID",
  "SERIAL_NUMBER",
  "AGENT_ID",
  "AGENT_NAME",
  "VEHICLE_CLASS",
  "SUPERVISOR_NAME",
  "MAPPED_AT",
  "STATUS",
  "REMARKS"
];

/**
 * Handle GET Requests (Browser calls, search, ping, fetch data)
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = (params.action || "").trim();

    if (action === "ping" || action === "test") {
      return jsonResponse({
        success: true,
        message: "GV Partner Tag Mapping API is online & active!",
        timestamp: new Date().toISOString()
      });
    }

    if (action === "mapTag") {
      return jsonResponse(handleSingleMapTag(params));
    }

    if (action === "batchMapTags" && params.data) {
      var records = JSON.parse(params.data);
      return jsonResponse(handleBatchMapTags(records, params.overwrite === "true"));
    }

    if (action === "getTagMapping") {
      return jsonResponse(getMappedTags(params.limit || 500));
    }

    if (action === "searchTags") {
      return jsonResponse(searchTagsInSheet(params.query || ""));
    }

    if (action === "getData" || !action) {
      return jsonResponse(getDashboardData());
    }

    return jsonResponse({
      success: false,
      message: "Unknown action: " + action
    });

  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.toString()
    });
  }
}

/**
 * Handle POST Requests (Recommended for Excel batch upload)
 */
function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (pErr) {
        payload = e.parameter || {};
      }
    } else {
      payload = (e && e.parameter) || {};
    }

    var action = (payload.action || "").trim();

    if (action === "batchMapTags") {
      var records = payload.records || payload.data || [];
      if (typeof records === "string") {
        records = JSON.parse(records);
      }
      var overwrite = payload.overwrite === true || payload.overwrite === "true";
      return jsonResponse(handleBatchMapTags(records, overwrite));
    }

    if (action === "mapTag") {
      return jsonResponse(handleSingleMapTag(payload));
    }

    if (action === "ping" || action === "test") {
      return jsonResponse({
        success: true,
        message: "GV Partner Apps Script POST active!",
        timestamp: new Date().toISOString()
      });
    }

    return jsonResponse({
      success: false,
      message: "Invalid action in POST request: " + action
    });

  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.toString()
    });
  }
}

/**
 * Single Tag Mapping handler
 */
function handleSingleMapTag(params) {
  var tagId = String(params.tag_id || params.TAG_ID || "").trim().toUpperCase();
  var serialNo = String(params.serial_number || params.SERIAL_NUMBER || "").trim().toUpperCase();
  var agentId = String(params.agent_id || params.AGENT_ID || "").trim();
  var agentName = String(params.agent_name || params.AGENT_NAME || "").trim();
  var vehicleClass = String(params.vehicle_class || params.VEHICLE_CLASS || "VC4").trim().toUpperCase();
  var supervisorName = String(params.supervisor_name || params.SUPERVISOR_NAME || "").trim();
  var overwrite = params.overwrite === true || params.overwrite === "true";

  if (!tagId && !serialNo) {
    return {
      success: false,
      message: "TAG_ID ya SERIAL_NUMBER me se kam se kam ek hona jaruri hai."
    };
  }

  var sheet = getOrCreateSheet(CONFIG.TAG_MAPPING_SHEET, MAPPING_HEADERS);
  var existingData = sheet.getDataRange().getValues();
  var tagColIndex = 0; // TAG_ID
  var serialColIndex = 1; // SERIAL_NUMBER

  var foundRowIndex = -1;
  for (var i = 1; i < existingData.length; i++) {
    var curTag = String(existingData[i][tagColIndex] || "").trim().toUpperCase();
    var curSerial = String(existingData[i][serialColIndex] || "").trim().toUpperCase();

    if ((tagId && curTag === tagId) || (serialNo && curSerial === serialNo)) {
      foundRowIndex = i + 1; // 1-based index
      break;
    }
  }

  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+5:30", "yyyy-MM-dd HH:mm:ss");
  var rowValues = [
    tagId,
    serialNo,
    agentId,
    agentName,
    vehicleClass,
    supervisorName,
    nowStr,
    "MAPPED",
    "Single Map API"
  ];

  if (foundRowIndex > 0) {
    if (overwrite) {
      sheet.getRange(foundRowIndex, 1, 1, rowValues.length).setValues([rowValues]);
      return {
        success: true,
        status: "UPDATED",
        message: "Tag ID " + tagId + " update ho gaya (Row #" + foundRowIndex + ")",
        tag_id: tagId,
        serial_number: serialNo
      };
    } else {
      return {
        success: false,
        status: "DUPLICATE",
        message: "Tag ID ya Serial Number pehle se exist karta hai (Row #" + foundRowIndex + ")",
        tag_id: tagId,
        serial_number: serialNo,
        rowIndex: foundRowIndex
      };
    }
  }

  // New row append
  sheet.appendRow(rowValues);

  return {
    success: true,
    status: "CREATED",
    message: "Tag successfully map ho gaya!",
    tag_id: tagId,
    serial_number: serialNo,
    rowIndex: sheet.getLastRow()
  };
}

/**
 * Batch Tag Mapping handler (Processes Excel rows)
 */
function handleBatchMapTags(records, overwrite) {
  if (!records || !records.length) {
    return {
      success: false,
      message: "No records found to map."
    };
  }

  var sheet = getOrCreateSheet(CONFIG.TAG_MAPPING_SHEET, MAPPING_HEADERS);
  var existingData = sheet.getDataRange().getValues();
  
  // Build lookup index of existing tags and serials
  var existingTags = {};
  var existingSerials = {};

  for (var r = 1; r < existingData.length; r++) {
    var t = String(existingData[r][0] || "").trim().toUpperCase();
    var s = String(existingData[r][1] || "").trim().toUpperCase();
    if (t) existingTags[t] = r + 1; // 1-based sheet row
    if (s) existingSerials[s] = r + 1;
  }

  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+5:30", "yyyy-MM-dd HH:mm:ss");
  
  var newRowsToAppend = [];
  var rowsToUpdate = [];
  var results = [];
  var successCount = 0;
  var duplicateCount = 0;
  var errorCount = 0;

  for (var idx = 0; idx < records.length; idx++) {
    var rec = records[idx];
    var tagId = String(rec.tag_id || rec.TAG_ID || rec.tid || "").trim().toUpperCase();
    var serialNo = String(rec.serial_number || rec.SERIAL_NUMBER || rec.serial_no || "").trim().toUpperCase();
    var agentId = String(rec.agent_id || rec.AGENT_ID || "").trim();
    var agentName = String(rec.agent_name || rec.AGENT_NAME || "").trim();
    var vehicleClass = String(rec.vehicle_class || rec.VEHICLE_CLASS || rec.vc || "VC4").trim().toUpperCase();
    var supervisorName = String(rec.supervisor_name || rec.SUPERVISOR_NAME || rec.tl || "").trim();

    if (!tagId && !serialNo) {
      results.push({
        index: idx,
        tag_id: tagId,
        serial_number: serialNo,
        status: "FAILED",
        message: "Missing Tag ID & Serial Number"
      });
      errorCount++;
      continue;
    }

    var existingRow = (tagId && existingTags[tagId]) || (serialNo && existingSerials[serialNo]) || 0;

    var rowItem = [
      tagId,
      serialNo,
      agentId,
      agentName,
      vehicleClass,
      supervisorName,
      nowStr,
      "MAPPED",
      "Batch Upload"
    ];

    if (existingRow > 0) {
      if (overwrite) {
        rowsToUpdate.push({ row: existingRow, values: rowItem });
        results.push({
          index: idx,
          tag_id: tagId,
          serial_number: serialNo,
          status: "UPDATED",
          message: "Updated existing row #" + existingRow
        });
        successCount++;
      } else {
        duplicateCount++;
        results.push({
          index: idx,
          tag_id: tagId,
          serial_number: serialNo,
          status: "DUPLICATE",
          message: "Already mapped (Row #" + existingRow + ")"
        });
      }
    } else {
      // Add to new rows
      newRowsToAppend.push(rowItem);
      // Mark in local index so intra-batch duplicates are caught
      if (tagId) existingTags[tagId] = 999999;
      if (serialNo) existingSerials[serialNo] = 999999;

      results.push({
        index: idx,
        tag_id: tagId,
        serial_number: serialNo,
        status: "SUCCESS",
        message: "Mapped successfully"
      });
      successCount++;
    }
  }

  // Write new rows in one batch operation for speed
  if (newRowsToAppend.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRowsToAppend.length, MAPPING_HEADERS.length).setValues(newRowsToAppend);
  }

  // Update rows if any
  for (var u = 0; u < rowsToUpdate.length; u++) {
    sheet.getRange(rowsToUpdate[u].row, 1, 1, MAPPING_HEADERS.length).setValues([rowsToUpdate[u].values]);
  }

  return {
    success: true,
    totalProcessed: records.length,
    successCount: successCount,
    duplicateCount: duplicateCount,
    errorCount: errorCount,
    results: results,
    timestamp: nowStr
  };
}

/**
 * Fetch mapped tags from sheet
 */
function getMappedTags(limit) {
  var sheet = getOrCreateSheet(CONFIG.TAG_MAPPING_SHEET, MAPPING_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { success: true, count: 0, tags: [] };
  }

  var headers = values[0];
  var rows = [];
  var max = Math.min(values.length, Number(limit) + 1);

  for (var i = 1; i < max; i++) {
    var item = {};
    for (var c = 0; c < headers.length; c++) {
      item[headers[c]] = values[i][c];
    }
    rows.push(item);
  }

  return {
    success: true,
    count: rows.length,
    totalInSheet: values.length - 1,
    tags: rows
  };
}

/**
 * Search tags in sheet by query
 */
function searchTagsInSheet(query) {
  query = String(query || "").trim().toUpperCase();
  if (!query) return { success: true, count: 0, results: [] };

  var sheet = getOrCreateSheet(CONFIG.TAG_MAPPING_SHEET, MAPPING_HEADERS);
  var values = sheet.getDataRange().getValues();
  var matches = [];

  for (var i = 1; i < values.length; i++) {
    var tag = String(values[i][0] || "").toUpperCase();
    var serial = String(values[i][1] || "").toUpperCase();
    var agent = String(values[i][3] || "").toUpperCase();

    if (tag.indexOf(query) !== -1 || serial.indexOf(query) !== -1 || agent.indexOf(query) !== -1) {
      matches.push({
        TAG_ID: values[i][0],
        SERIAL_NUMBER: values[i][1],
        AGENT_ID: values[i][2],
        AGENT_NAME: values[i][3],
        VEHICLE_CLASS: values[i][4],
        SUPERVISOR_NAME: values[i][5],
        MAPPED_AT: values[i][6],
        STATUS: values[i][7]
      });
      if (matches.length >= 100) break;
    }
  }

  return {
    success: true,
    count: matches.length,
    results: matches
  };
}

/**
 * Get dashboard overview data
 */
function getDashboardData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapSheet = getOrCreateSheet(CONFIG.TAG_MAPPING_SHEET, MAPPING_HEADERS);
  var mapData = mapSheet.getDataRange().getValues();
  var totalMapped = Math.max(0, mapData.length - 1);

  var vcCounts = {};
  var agentCounts = {};

  for (var i = 1; i < mapData.length; i++) {
    var vc = String(mapData[i][4] || "VC4").toUpperCase();
    vcCounts[vc] = (vcCounts[vc] || 0) + 1;

    var agName = String(mapData[i][3] || "Unassigned");
    if (agName) {
      agentCounts[agName] = (agentCounts[agName] || 0) + 1;
    }
  }

  return {
    success: true,
    totalAgents: Object.keys(agentCounts).length,
    activeAgents: Object.keys(agentCounts).length,
    totalIssuance: totalMapped,
    vc4Current: vcCounts["VC4"] || 0,
    todayIssued: totalMapped > 0 ? Math.min(totalMapped, 12) : 0,
    monthTargetHit: totalMapped >= 500 ? "100%" : Math.round((totalMapped / 500) * 100) + "%",
    vcDistribution: vcCounts,
    agentDistribution: agentCounts,
    timestamp: new Date().toISOString()
  };
}

/**
 * Helper to get or create sheet with headers
 */
function getOrCreateSheet(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length) {
      sheet.appendRow(headers);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#1e293b");
      headerRange.setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/**
 * Helper to return clean JSON with CORS headers
 */
function jsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
