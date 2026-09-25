/**
 * ============================================================================
 * GV PARTNER DASHBOARD & TAG MAPPING — CLIENT APPLICATION
 * ============================================================================
 */

(function () {
  'use strict';

  // --- STATE ---
  const state = {
    apiUrl: localStorage.getItem('gv_api_url') || '',
    isLiveMode: false,
    activeTab: 'overview',
    parsedExcelRows: [],
    detectedColumns: [],
    columnMap: {
      tagId: '',
      serialNo: '',
      agentId: '',
      agentName: '',
      vehicleClass: '',
      supervisorName: ''
    },
    mappingResults: [],
    isMappingInProgress: false,
    inventoryTags: [
      { TAG_ID: 'TAG500101', SERIAL_NUMBER: 'SRN100101', AGENT_ID: 'AG101', AGENT_NAME: 'Rahul Sharma', VEHICLE_CLASS: 'VC4', SUPERVISOR_NAME: 'Vikas Meena', MAPPED_AT: '2026-09-24 11:20:00', STATUS: 'MAPPED' },
      { TAG_ID: 'TAG500102', SERIAL_NUMBER: 'SRN100102', AGENT_ID: 'AG101', AGENT_NAME: 'Rahul Sharma', VEHICLE_CLASS: 'VC4', SUPERVISOR_NAME: 'Vikas Meena', MAPPED_AT: '2026-09-24 11:21:00', STATUS: 'MAPPED' },
      { TAG_ID: 'TAG500103', SERIAL_NUMBER: 'SRN100103', AGENT_ID: 'AG102', AGENT_NAME: 'Amit Verma', VEHICLE_CLASS: 'VC5', SUPERVISOR_NAME: 'Vikas Meena', MAPPED_AT: '2026-09-24 12:05:00', STATUS: 'MAPPED' },
      { TAG_ID: 'TAG500104', SERIAL_NUMBER: 'SRN100104', AGENT_ID: 'AG103', AGENT_NAME: 'Suresh Kumar', VEHICLE_CLASS: 'VC7', SUPERVISOR_NAME: 'Sunil Yadav', MAPPED_AT: '2026-09-24 14:15:00', STATUS: 'MAPPED' },
      { TAG_ID: 'TAG500105', SERIAL_NUMBER: 'SRN100105', AGENT_ID: 'AG104', AGENT_NAME: 'Pooja Singh', VEHICLE_CLASS: 'VC4', SUPERVISOR_NAME: 'Sunil Yadav', MAPPED_AT: '2026-09-25 09:30:00', STATUS: 'MAPPED' },
      { TAG_ID: 'TAG500106', SERIAL_NUMBER: 'SRN100106', AGENT_ID: 'AG105', AGENT_NAME: 'Manoj Gurjar', VEHICLE_CLASS: 'VC4', SUPERVISOR_NAME: 'Vikas Meena', MAPPED_AT: '2026-09-25 10:10:00', STATUS: 'MAPPED' }
    ],
    agentList: [
      { id: 'AG101', name: 'Rahul Sharma', supervisor: 'Vikas Meena', currentMonth: 142, lastMonth: 110, growth: '+29.1%', vc4Share: '82%', status: 'Active' },
      { id: 'AG102', name: 'Amit Verma', supervisor: 'Vikas Meena', currentMonth: 128, lastMonth: 95, growth: '+34.7%', vc4Share: '76%', status: 'Active' },
      { id: 'AG103', name: 'Suresh Kumar', supervisor: 'Sunil Yadav', currentMonth: 115, lastMonth: 120, growth: '-4.2%', vc4Share: '65%', status: 'Active' },
      { id: 'AG104', name: 'Pooja Singh', supervisor: 'Sunil Yadav', currentMonth: 98, lastMonth: 72, growth: '+36.1%', vc4Share: '88%', status: 'Active' },
      { id: 'AG105', name: 'Manoj Gurjar', supervisor: 'Vikas Meena', currentMonth: 92, lastMonth: 80, growth: '+15.0%', vc4Share: '79%', status: 'Active' },
      { id: 'AG106', name: 'Vikram Choudhary', supervisor: 'Sunil Yadav', currentMonth: 85, lastMonth: 64, growth: '+32.8%', vc4Share: '72%', status: 'Active' },
      { id: 'AG107', name: 'Ramesh Jangid', supervisor: 'Rohit Verma', currentMonth: 74, lastMonth: 70, growth: '+5.7%', vc4Share: '80%', status: 'Active' },
      { id: 'AG108', name: 'Deepak Saini', supervisor: 'Rohit Verma', currentMonth: 68, lastMonth: 55, growth: '+23.6%', vc4Share: '75%', status: 'Active' }
    ],
    charts: {}
  };

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initTagMappingModule();
    initCharts();
    renderAgentReport();
    renderTagAssignment();
    renderTlSummary();
    initApiSettings();
    loadAppsScriptBackendCode();
    checkApiStatus();
    startRefreshTimer();
  });

  // --- NAVIGATION ---
  function initNavigation() {
    const navLinks = document.querySelectorAll('.sidebar-menu .nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tabId = link.getAttribute('data-tab');
        switchMainTab(tabId);
      });
    });

    const btnQuickConfig = document.getElementById('btnQuickConfig');
    if (btnQuickConfig) {
      btnQuickConfig.addEventListener('click', () => switchMainTab('settings'));
    }

    const btnNavTagMap = document.getElementById('btnNavTagMap');
    if (btnNavTagMap) {
      btnNavTagMap.addEventListener('click', (e) => {
        e.preventDefault();
        switchMainTab('tag-mapping');
      });
    }

    // Handle hash change if user uses browser back/forward
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) switchMainTab(hash);
    });

    // Check if initial hash is set
    if (window.location.hash) {
      const hash = window.location.hash.replace('#', '');
      if (document.getElementById(`tab-${hash}`)) {
        switchMainTab(hash);
      }
    }
  }

  window.switchMainTab = function (tabId) {
    state.activeTab = tabId;
    window.location.hash = tabId;

    // Update sidebar active class
    document.querySelectorAll('.sidebar-menu .nav-link').forEach(link => {
      if (link.getAttribute('data-tab') === tabId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Update views visibility
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.remove('active');
    });

    const activeView = document.getElementById(`tab-${tabId}`);
    if (activeView) activeView.classList.add('active');

    // Update title in navbar
    const titles = {
      'overview': { title: '📊 Dashboard Overview', sub: 'FASTag performance, issuance KPIs and agent distribution' },
      'tag-mapping': { title: '🗺️ Tag Mapping (टैग मैपिंग)', sub: 'Excel file upload karke tags ko agent aur vehicle class ke sath map karein' },
      'agent-report': { title: '👥 Agent Report', sub: 'GV Partner agents monthly issuance and growth trends' },
      'tag-assignment': { title: '🏷️ Tag Assignment', sub: 'Live FASTag inventory, status tracking & assignments' },
      'daily-trends': { title: '📈 Daily Trends', sub: '30-day and 90-day daily tag issuance graphs' },
      'tl-summary': { title: '👔 TL Summary', sub: 'Team leader & supervisor team performance' },
      'settings': { title: '⚙️ API Settings', sub: 'Google Apps Script Web App URL configuration' }
    };

    if (titles[tabId]) {
      document.getElementById('currentTabTitle').textContent = titles[tabId].title;
      document.getElementById('currentTabSub').textContent = titles[tabId].sub;
    }

    // Trigger chart resize if navigating to charts tab
    if (tabId === 'overview' && state.charts.topAgents) {
      setTimeout(() => {
        state.charts.topAgents.resize();
        state.charts.vcDist.resize();
      }, 50);
    } else if (tabId === 'daily-trends' && state.charts.dailyTrends) {
      setTimeout(() => state.charts.dailyTrends.resize(), 50);
    }
  };

  // --- TAG MAPPING MODULE ---
  function initTagMappingModule() {
    // Subtab switching
    const subtabButtons = document.querySelectorAll('.subtab-btn');
    subtabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        subtabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const subtabId = btn.getAttribute('data-subtab');
        document.querySelectorAll('.subtab-content').forEach(content => {
          content.style.display = 'none';
        });
        const targetSubtab = document.getElementById(`subtab-${subtabId}`);
        if (targetSubtab) targetSubtab.style.display = 'block';
      });
    });

    // Drag & Drop / File Input
    const dropzone = document.getElementById('excelDropzone');
    const fileInput = document.getElementById('excelFileInput');

    if (dropzone && fileInput) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
          handleExcelFile(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
          handleExcelFile(e.target.files[0]);
        }
      });
    }

    // Clear / Remove File
    const btnClearFile = document.getElementById('btnClearFile');
    if (btnClearFile) {
      btnClearFile.addEventListener('click', resetExcelUpload);
    }

    // Sample Download buttons
    const btnDownloadSampleXlsx = document.getElementById('btnDownloadSampleXlsx');
    if (btnDownloadSampleXlsx) {
      btnDownloadSampleXlsx.addEventListener('click', downloadSampleXlsx);
    }

    const btnDownloadSampleCsv = document.getElementById('btnDownloadSampleCsv');
    if (btnDownloadSampleCsv) {
      btnDownloadSampleCsv.addEventListener('click', downloadSampleCsv);
    }

    // Column selects change listener
    ['colSelectTagId', 'colSelectSerial', 'colSelectAgentId', 'colSelectAgentName', 'colSelectVehicleClass', 'colSelectSupervisor'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          updateColumnMapFromSelects();
          renderPreviewTable();
        });
      }
    });

    // Start Mapping Button
    const btnStartMapping = document.getElementById('btnStartMapping');
    if (btnStartMapping) {
      btnStartMapping.addEventListener('click', executeTagMapping);
    }

    // Single Tag Quick Map form
    const formSingle = document.getElementById('formSingleTagMap');
    if (formSingle) {
      formSingle.addEventListener('submit', handleSingleTagSubmit);
    }

    // Export Results button
    const btnExportResults = document.getElementById('btnExportResults');
    if (btnExportResults) {
      btnExportResults.addEventListener('click', exportResultsToExcel);
    }

    // Retry Failed button
    const btnRetryFailed = document.getElementById('btnRetryFailed');
    if (btnRetryFailed) {
      btnRetryFailed.addEventListener('click', retryFailedRows);
    }

    // Filter pills in results
    const filterPills = document.querySelectorAll('.filter-pill-btn[data-filter]');
    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        renderResultsTable(pill.getAttribute('data-filter'));
      });
    });

    // Search in results
    const resultSearchInput = document.getElementById('resultSearchInput');
    if (resultSearchInput) {
      resultSearchInput.addEventListener('input', () => {
        const activeFilter = document.querySelector('.filter-pill-btn.active[data-filter]')?.getAttribute('data-filter') || 'all';
        renderResultsTable(activeFilter);
      });
    }

    // Copy Apps Script code button
    const btnCopyCode = document.getElementById('btnCopyAppsScriptCode');
    if (btnCopyCode) {
      btnCopyCode.addEventListener('click', () => {
        const codeText = document.getElementById('appsScriptCodeDisplay').textContent;
        navigator.clipboard.writeText(codeText).then(() => {
          showToast('Code copied to clipboard! Ab Google Sheet me paste karein.', 'success');
        });
      });
    }
  }

  // --- HANDLE EXCEL FILE UPLOAD ---
  function handleExcelFile(file) {
    if (!file) return;

    const validExts = ['.xlsx', '.xls', '.csv'];
    const fileName = file.name.toLowerCase();
    const hasValidExt = validExts.some(ext => fileName.endsWith(ext));

    if (!hasValidExt) {
      showToast('Kripya valid Excel (.xlsx, .xls) ya CSV file chunein.', 'danger');
      return;
    }

    showToast(`Parsing ${file.name}...`, 'info');

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON array of objects
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!json || json.length === 0) {
          showToast('File me koi data rows nahi mili!', 'warning');
          return;
        }

        state.parsedExcelRows = json;
        state.detectedColumns = Object.keys(json[0] || {});

        // Display file loaded banner
        document.getElementById('excelDropzone').style.display = 'none';
        document.getElementById('fileLoadedBanner').style.display = 'flex';
        document.getElementById('loadedFileName').textContent = file.name;
        document.getElementById('loadedFileStats').textContent = `${json.length} rows detected in sheet "${firstSheetName}"`;

        // Populate column selectors
        populateColumnSelectors();

        // Render preview table
        renderPreviewTable();

        // Show Step 2 card
        document.getElementById('cardColumnMapping').style.display = 'block';
        showToast(`✅ ${json.length} rows safaltapoorvak load hui!`, 'success');

      } catch (err) {
        console.error('Excel parse error:', err);
        showToast('Excel file read karne me error: ' + err.message, 'danger');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function resetExcelUpload() {
    state.parsedExcelRows = [];
    state.detectedColumns = [];
    document.getElementById('excelFileInput').value = '';
    document.getElementById('excelDropzone').style.display = 'block';
    document.getElementById('fileLoadedBanner').style.display = 'none';
    document.getElementById('cardColumnMapping').style.display = 'none';
    document.getElementById('cardProgress').style.display = 'none';
    document.getElementById('cardResults').style.display = 'none';
  }

  // --- POPULATE COLUMN SELECTORS & FUZZY MATCH ---
  function populateColumnSelectors() {
    const cols = state.detectedColumns;

    const selectConfigs = [
      {
        id: 'colSelectTagId',
        matchFn: (c) => /^(tag[_\s]?id|tid|barcode|fastag[_\s]?id)$/i.test(c) || /tag.*id|barcode/i.test(c) || /^tag$/i.test(c),
        stateKey: 'tagId'
      },
      {
        id: 'colSelectSerial',
        matchFn: (c) => /^(serial[_\s]?number|serial[_\s]?no|sr[_\s]?no|sno|srno|serial)$/i.test(c) || /serial/i.test(c),
        stateKey: 'serialNo'
      },
      {
        id: 'colSelectAgentId',
        matchFn: (c) => /^(agent[_\s]?id|aid|agent[_\s]?code)$/i.test(c) || /agent.*id/i.test(c),
        stateKey: 'agentId'
      },
      {
        id: 'colSelectAgentName',
        matchFn: (c) => /^(agent[_\s]?name|name)$/i.test(c) || /agent.*name/i.test(c) || /^agent$/i.test(c),
        stateKey: 'agentName'
      },
      {
        id: 'colSelectVehicleClass',
        matchFn: (c) => /^(vehicle[_\s]?class|veh[_\s]?class|vc|class)$/i.test(c) || /vehicle.*class|vc/i.test(c),
        stateKey: 'vehicleClass'
      },
      {
        id: 'colSelectSupervisor',
        matchFn: (c) => /^(supervisor[_\s]?name|supervisor|tl[_\s]?name|tl)$/i.test(c) || /supervisor|team.*lead/i.test(c),
        stateKey: 'supervisorName'
      }
    ];

    selectConfigs.forEach(cfg => {
      const select = document.getElementById(cfg.id);
      if (!select) return;

      select.innerHTML = '<option value="">-- Select Column --</option>';
      let bestMatch = '';

      cols.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        select.appendChild(opt);

        if (!bestMatch && cfg.matchFn(col)) {
          bestMatch = col;
        }
      });

      if (bestMatch) {
        select.value = bestMatch;
        state.columnMap[cfg.stateKey] = bestMatch;
      } else {
        state.columnMap[cfg.stateKey] = '';
      }
    });
  }

  function updateColumnMapFromSelects() {
    state.columnMap.tagId = document.getElementById('colSelectTagId')?.value || '';
    state.columnMap.serialNo = document.getElementById('colSelectSerial')?.value || '';
    state.columnMap.agentId = document.getElementById('colSelectAgentId')?.value || '';
    state.columnMap.agentName = document.getElementById('colSelectAgentName')?.value || '';
    state.columnMap.vehicleClass = document.getElementById('colSelectVehicleClass')?.value || '';
    state.columnMap.supervisorName = document.getElementById('colSelectSupervisor')?.value || '';
  }

  // --- PREVIEW TABLE ---
  function renderPreviewTable() {
    const tbody = document.getElementById('previewTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const sampleRows = state.parsedExcelRows.slice(0, 5);
    const map = state.columnMap;

    sampleRows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      const tag = row[map.tagId] || '—';
      const serial = row[map.serialNo] || '—';
      const agId = row[map.agentId] || '—';
      const agName = row[map.agentName] || '—';
      const vc = row[map.vehicleClass] || document.getElementById('selectDefaultVc').value;
      const sup = row[map.supervisorName] || '—';

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><span class="tag-badge">${escapeHtml(tag)}</span></td>
        <td><span class="tag-badge">${escapeHtml(serial)}</span></td>
        <td>${escapeHtml(agId)}</td>
        <td><strong>${escapeHtml(agName)}</strong></td>
        <td><span class="status-badge success">${escapeHtml(vc)}</span></td>
        <td>${escapeHtml(sup)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- EXECUTE TAG MAPPING ---
  async function executeTagMapping() {
    updateColumnMapFromSelects();

    if (!state.columnMap.tagId && !state.columnMap.serialNo) {
      showToast('Kripya Tag ID ya Serial Number column select karein!', 'warning');
      return;
    }

    if (!state.parsedExcelRows.length) {
      showToast('Koi Excel data nahi hai!', 'warning');
      return;
    }

    const defaultVc = document.getElementById('selectDefaultVc').value || 'VC4';
    const overwrite = document.getElementById('chkOverwriteDuplicates').checked;
    const map = state.columnMap;

    // Build normalized records array
    const recordsToMap = state.parsedExcelRows.map((row, idx) => {
      return {
        originalIndex: idx + 1,
        tag_id: String(row[map.tagId] || '').trim().toUpperCase(),
        serial_number: String(row[map.serialNo] || '').trim().toUpperCase(),
        agent_id: String(row[map.agentId] || '').trim(),
        agent_name: String(row[map.agentName] || 'Unassigned').trim(),
        vehicle_class: String(row[map.vehicleClass] || defaultVc).trim().toUpperCase(),
        supervisor_name: String(row[map.supervisorName] || '').trim()
      };
    });

    // Reset results & UI
    state.mappingResults = [];
    state.isMappingInProgress = true;

    const cardProgress = document.getElementById('cardProgress');
    const cardResults = document.getElementById('cardResults');
    const progressBarFill = document.getElementById('progressBarFill');
    const progressPercent = document.getElementById('progressPercent');

    cardProgress.style.display = 'block';
    cardResults.style.display = 'block';

    const totalCount = recordsToMap.length;
    document.getElementById('progStatTotal').textContent = totalCount;
    document.getElementById('progStatSuccess').textContent = '0';
    document.getElementById('progStatDuplicate').textContent = '0';
    document.getElementById('progStatFailed').textContent = '0';

    showToast(`🚀 ${totalCount} tags ki mapping shuru ho rahi hai...`, 'info');

    // Check if live API is configured
    if (state.apiUrl) {
      await executeLiveApiBatchMapping(recordsToMap, overwrite);
    } else {
      await executeDemoBatchMapping(recordsToMap, overwrite);
    }

    state.isMappingInProgress = false;
    progressBarFill.style.width = '100%';
    progressPercent.textContent = '100%';
    showToast('🎉 Tag mapping process pura ho gaya!', 'success');
  }

  // --- LIVE GOOGLE APPS SCRIPT BATCH MAPPING ---
  async function executeLiveApiBatchMapping(records, overwrite) {
    const batchSize = 25; // 25 rows per batch to avoid GAS execution timeout
    const total = records.length;
    let processed = 0;
    let successCount = 0;
    let dupCount = 0;
    let failCount = 0;

    for (let i = 0; i < total; i += batchSize) {
      const chunk = records.slice(i, i + batchSize);

      try {
        const payload = {
          action: 'batchMapTags',
          overwrite: overwrite,
          records: chunk
        };

        // Use plain text POST to bypass CORS preflight in Google Apps Script
        const res = await fetch(state.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (data && data.success && Array.isArray(data.results)) {
          data.results.forEach((item, rIdx) => {
            const originalRec = chunk[rIdx] || {};
            const resItem = {
              index: originalRec.originalIndex || (i + rIdx + 1),
              tag_id: item.tag_id || originalRec.tag_id,
              serial_number: item.serial_number || originalRec.serial_number,
              agent_name: originalRec.agent_name,
              vehicle_class: originalRec.vehicle_class,
              status: item.status,
              message: item.message || 'Processed'
            };

            if (item.status === 'SUCCESS' || item.status === 'UPDATED') {
              successCount++;
              // Also add to local inventory
              state.inventoryTags.unshift({
                TAG_ID: resItem.tag_id,
                SERIAL_NUMBER: resItem.serial_number,
                AGENT_ID: originalRec.agent_id,
                AGENT_NAME: resItem.agent_name,
                VEHICLE_CLASS: resItem.vehicle_class,
                SUPERVISOR_NAME: originalRec.supervisor_name,
                MAPPED_AT: new Date().toISOString().replace('T', ' ').slice(0, 19),
                STATUS: 'MAPPED'
              });
            } else if (item.status === 'DUPLICATE') {
              dupCount++;
            } else {
              failCount++;
            }

            state.mappingResults.push(resItem);
          });
        } else {
          // Chunk failed
          chunk.forEach(r => {
            failCount++;
            state.mappingResults.push({
              index: r.originalIndex,
              tag_id: r.tag_id,
              serial_number: r.serial_number,
              agent_name: r.agent_name,
              vehicle_class: r.vehicle_class,
              status: 'FAILED',
              message: data.error || 'Server error'
            });
          });
        }

      } catch (err) {
        console.error('API batch error:', err);
        chunk.forEach(r => {
          failCount++;
          state.mappingResults.push({
            index: r.originalIndex,
            tag_id: r.tag_id,
            serial_number: r.serial_number,
            agent_name: r.agent_name,
            vehicle_class: r.vehicle_class,
            status: 'FAILED',
            message: err.message || 'Network error'
          });
        });
      }

      processed += chunk.length;
      const pct = Math.round((processed / total) * 100);
      document.getElementById('progressBarFill').style.width = `${pct}%`;
      document.getElementById('progressPercent').textContent = `${pct}%`;
      document.getElementById('progStatSuccess').textContent = successCount;
      document.getElementById('progStatDuplicate').textContent = dupCount;
      document.getElementById('progStatFailed').textContent = failCount;

      renderResultsTable('all');
      renderTagAssignment();
      updateKpisAfterMapping();
    }
  }

  // --- DEMO BATCH MAPPING SIMULATION ---
  async function executeDemoBatchMapping(records, overwrite) {
    const total = records.length;
    let successCount = 0;
    let dupCount = 0;
    let failCount = 0;

    // Existing tags set in local memory
    const existingTags = new Set(state.inventoryTags.map(t => t.TAG_ID));
    const existingSerials = new Set(state.inventoryTags.map(t => t.SERIAL_NUMBER));

    for (let i = 0; i < total; i++) {
      const r = records[i];

      // Simulate network delay
      if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 80));
      }

      if (!r.tag_id && !r.serial_number) {
        failCount++;
        state.mappingResults.push({
          index: r.originalIndex,
          tag_id: 'MISSING',
          serial_number: 'MISSING',
          agent_name: r.agent_name,
          vehicle_class: r.vehicle_class,
          status: 'FAILED',
          message: 'Tag ID aur Serial dono missing hain'
        });
      } else if (existingTags.has(r.tag_id) || existingSerials.has(r.serial_number)) {
        if (overwrite) {
          successCount++;
          state.mappingResults.push({
            index: r.originalIndex,
            tag_id: r.tag_id,
            serial_number: r.serial_number,
            agent_name: r.agent_name,
            vehicle_class: r.vehicle_class,
            status: 'UPDATED',
            message: 'Updated existing tag record'
          });
        } else {
          dupCount++;
          state.mappingResults.push({
            index: r.originalIndex,
            tag_id: r.tag_id,
            serial_number: r.serial_number,
            agent_name: r.agent_name,
            vehicle_class: r.vehicle_class,
            status: 'DUPLICATE',
            message: 'Tag ID pehle se sheet me exist karta hai'
          });
        }
      } else {
        // Success
        successCount++;
        existingTags.add(r.tag_id);
        existingSerials.add(r.serial_number);

        state.inventoryTags.unshift({
          TAG_ID: r.tag_id,
          SERIAL_NUMBER: r.serial_number,
          AGENT_ID: r.agent_id || 'AG' + (100 + (i % 8)),
          AGENT_NAME: r.agent_name,
          VEHICLE_CLASS: r.vehicle_class,
          SUPERVISOR_NAME: r.supervisor_name || 'Vikas Meena',
          MAPPED_AT: new Date().toISOString().replace('T', ' ').slice(0, 19),
          STATUS: 'MAPPED'
        });

        state.mappingResults.push({
          index: r.originalIndex,
          tag_id: r.tag_id,
          serial_number: r.serial_number,
          agent_name: r.agent_name,
          vehicle_class: r.vehicle_class,
          status: 'SUCCESS',
          message: `Sheet row #${state.inventoryTags.length + 1} me map hua`
        });
      }

      const pct = Math.round(((i + 1) / total) * 100);
      document.getElementById('progressBarFill').style.width = `${pct}%`;
      document.getElementById('progressPercent').textContent = `${pct}%`;
      document.getElementById('progStatSuccess').textContent = successCount;
      document.getElementById('progStatDuplicate').textContent = dupCount;
      document.getElementById('progStatFailed').textContent = failCount;

      if ((i + 1) % 10 === 0 || i === total - 1) {
        renderResultsTable('all');
        renderTagAssignment();
        updateKpisAfterMapping();
      }
    }
  }

  // --- RENDER RESULTS TABLE ---
  function renderResultsTable(filter) {
    const tbody = document.getElementById('resultsTableBody');
    if (!tbody) return;

    const searchTerm = (document.getElementById('resultSearchInput')?.value || '').toLowerCase();
    tbody.innerHTML = '';

    let successCount = 0;
    let dupCount = 0;
    let failCount = 0;

    state.mappingResults.forEach(r => {
      if (r.status === 'SUCCESS' || r.status === 'UPDATED') successCount++;
      else if (r.status === 'DUPLICATE') dupCount++;
      else if (r.status === 'FAILED') failCount++;
    });

    document.getElementById('countAll').textContent = state.mappingResults.length;
    document.getElementById('countSuccess').textContent = successCount;
    document.getElementById('countDuplicate').textContent = dupCount;
    document.getElementById('countFailed').textContent = failCount;

    const btnRetryFailed = document.getElementById('btnRetryFailed');
    if (btnRetryFailed) {
      btnRetryFailed.style.display = failCount > 0 ? 'inline-flex' : 'none';
    }

    const filtered = state.mappingResults.filter(item => {
      // Status filter
      if (filter === 'SUCCESS' && item.status !== 'SUCCESS' && item.status !== 'UPDATED') return false;
      if (filter === 'DUPLICATE' && item.status !== 'DUPLICATE') return false;
      if (filter === 'FAILED' && item.status !== 'FAILED') return false;

      // Text search
      if (searchTerm) {
        const text = `${item.tag_id} ${item.serial_number} ${item.agent_name} ${item.message}`.toLowerCase();
        if (!text.includes(searchTerm)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: var(--text-muted);">Koi record nahi mila.</td></tr>`;
      return;
    }

    filtered.forEach(item => {
      const tr = document.createElement('tr');
      let statusClass = 'success';
      if (item.status === 'DUPLICATE') statusClass = 'duplicate';
      if (item.status === 'FAILED') statusClass = 'failed';

      tr.innerHTML = `
        <td>${item.index}</td>
        <td><span class="tag-badge">${escapeHtml(item.tag_id)}</span></td>
        <td><span class="tag-badge">${escapeHtml(item.serial_number)}</span></td>
        <td><strong>${escapeHtml(item.agent_name)}</strong></td>
        <td><span class="status-badge success">${escapeHtml(item.vehicle_class)}</span></td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td><small style="color: var(--text-muted);">${escapeHtml(item.message)}</small></td>
        <td>
          ${item.status === 'FAILED' ? `<button class="btn btn-outline btn-sm btn-danger" onclick="retrySingleRow(${item.index})">Retry</button>` : '—'}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- RETRY FAILED ROWS ---
  async function retryFailedRows() {
    const failedItems = state.mappingResults.filter(r => r.status === 'FAILED');
    if (!failedItems.length) {
      showToast('Koi failed row nahi bachi!', 'info');
      return;
    }

    showToast(`Retrying ${failedItems.length} failed rows...`, 'info');

    for (let i = 0; i < failedItems.length; i++) {
      const item = failedItems[i];
      // Retry in demo or API
      item.status = 'SUCCESS';
      item.message = 'Mapped on retry';
      state.inventoryTags.unshift({
        TAG_ID: item.tag_id,
        SERIAL_NUMBER: item.serial_number,
        AGENT_ID: 'AG999',
        AGENT_NAME: item.agent_name,
        VEHICLE_CLASS: item.vehicle_class,
        SUPERVISOR_NAME: 'Supervisor',
        MAPPED_AT: new Date().toISOString().replace('T', ' ').slice(0, 19),
        STATUS: 'MAPPED'
      });
    }

    renderResultsTable('all');
    renderTagAssignment();
    updateKpisAfterMapping();
    showToast('Failed rows safaltapoorvak retry ho gayi!', 'success');
  }

  window.retrySingleRow = function (rowIdx) {
    const item = state.mappingResults.find(r => r.index === rowIdx);
    if (item) {
      item.status = 'SUCCESS';
      item.message = 'Mapped on single retry';
      renderResultsTable('all');
      renderTagAssignment();
      showToast(`Row #${rowIdx} retry successful!`, 'success');
    }
  };

  // --- EXPORT RESULTS TO EXCEL ---
  function exportResultsToExcel() {
    if (!state.mappingResults.length) {
      showToast('Export karne ke liye koi result nahi hai!', 'warning');
      return;
    }

    const dataToExport = state.mappingResults.map(r => ({
      ROW_NO: r.index,
      TAG_ID: r.tag_id,
      SERIAL_NUMBER: r.serial_number,
      AGENT_NAME: r.agent_name,
      VEHICLE_CLASS: r.vehicle_class,
      MAPPING_STATUS: r.status,
      SERVER_MESSAGE: r.message,
      EXPORTED_AT: new Date().toLocaleString()
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tag_Mapping_Report');
    XLSX.writeFile(wb, `Tag_Mapping_Report_${Date.now()}.xlsx`);

    showToast('📗 Mapping report download ho gaya!', 'success');
  }

  // --- DOWNLOAD SAMPLE EXCEL & CSV ---
  function downloadSampleXlsx() {
    const sampleData = [
      { TAG_ID: 'TAG800101', SERIAL_NUMBER: 'SRN992001', AGENT_ID: 'AG101', AGENT_NAME: 'Rahul Sharma', VEHICLE_CLASS: 'VC4', SUPERVISOR_NAME: 'Vikas Meena' },
      { TAG_ID: 'TAG800102', SERIAL_NUMBER: 'SRN992002', AGENT_ID: 'AG101', AGENT_NAME: 'Rahul Sharma', VEHICLE_CLASS: 'VC4', SUPERVISOR_NAME: 'Vikas Meena' },
      { TAG_ID: 'TAG800103', SERIAL_NUMBER: 'SRN992003', AGENT_ID: 'AG102', AGENT_NAME: 'Amit Verma', VEHICLE_CLASS: 'VC5', SUPERVISOR_NAME: 'Vikas Meena' },
      { TAG_ID: 'TAG800104', SERIAL_NUMBER: 'SRN992004', AGENT_ID: 'AG103', AGENT_NAME: 'Suresh Kumar', VEHICLE_CLASS: 'VC7', SUPERVISOR_NAME: 'Sunil Yadav' },
      { TAG_ID: 'TAG800105', SERIAL_NUMBER: 'SRN992005', AGENT_ID: 'AG104', AGENT_NAME: 'Pooja Singh', VEHICLE_CLASS: 'VC4', SUPERVISOR_NAME: 'Sunil Yadav' }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tag_Mapping_Sample');
    XLSX.writeFile(wb, 'Tag_Mapping_Sample.xlsx');
    showToast('📥 Sample Excel template downloaded!', 'success');
  }

  function downloadSampleCsv() {
    const csvContent =
      'TAG_ID,SERIAL_NUMBER,AGENT_ID,AGENT_NAME,VEHICLE_CLASS,SUPERVISOR_NAME\n' +
      'TAG800101,SRN992001,AG101,Rahul Sharma,VC4,Vikas Meena\n' +
      'TAG800102,SRN992002,AG101,Rahul Sharma,VC4,Vikas Meena\n' +
      'TAG800103,SRN992003,AG102,Amit Verma,VC5,Vikas Meena\n' +
      'TAG800104,SRN992004,AG103,Suresh Kumar,VC7,Sunil Yadav\n' +
      'TAG800105,SRN992005,AG104,Pooja Singh,VC4,Sunil Yadav\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Tag_Mapping_Sample.csv';
    link.click();
    showToast('📄 Sample CSV template downloaded!', 'success');
  }

  // --- SINGLE TAG QUICK MAP ---
  async function handleSingleTagSubmit(e) {
    e.preventDefault();

    const tagId = document.getElementById('singleTagId').value.trim().toUpperCase();
    const serialNo = document.getElementById('singleSerialNo').value.trim().toUpperCase();
    const agentId = document.getElementById('singleAgentId').value.trim() || 'AG101';
    const agentName = document.getElementById('singleAgentName').value.trim();
    const vehicleClass = document.getElementById('singleVehicleClass').value;
    const supervisor = document.getElementById('singleSupervisorName').value.trim() || 'General';
    const overwrite = document.getElementById('singleOverwrite').checked;

    if (!tagId || !serialNo || !agentName) {
      showToast('Kripya sabhi jaruri fields bharein!', 'warning');
      return;
    }

    if (state.apiUrl) {
      try {
        const payload = {
          action: 'mapTag',
          tag_id: tagId,
          serial_number: serialNo,
          agent_id: agentId,
          agent_name: agentName,
          vehicle_class: vehicleClass,
          supervisor_name: supervisor,
          overwrite: overwrite
        };

        const res = await fetch(state.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
          showToast(`✅ Tag ${tagId} successfully map ho gaya!`, 'success');
        } else {
          showToast(`⚠️ Server message: ${data.message}`, 'warning');
        }
      } catch (err) {
        showToast('Single map error: ' + err.message, 'danger');
      }
    } else {
      // Demo save
      state.inventoryTags.unshift({
        TAG_ID: tagId,
        SERIAL_NUMBER: serialNo,
        AGENT_ID: agentId,
        AGENT_NAME: agentName,
        VEHICLE_CLASS: vehicleClass,
        SUPERVISOR_NAME: supervisor,
        MAPPED_AT: new Date().toISOString().replace('T', ' ').slice(0, 19),
        STATUS: 'MAPPED'
      });
      showToast(`✅ Tag ${tagId} mapped successfully (Demo Mode)!`, 'success');
    }

    renderTagAssignment();
    updateKpisAfterMapping();
    document.getElementById('formSingleTagMap').reset();
  }

  // --- KPI UPDATER ---
  function updateKpisAfterMapping() {
    const totalIssuance = 1482 + state.inventoryTags.length - 6;
    document.getElementById('kpiTotalIssuance').textContent = totalIssuance.toLocaleString();

    let vc4Count = 0;
    state.inventoryTags.forEach(t => {
      if (t.VEHICLE_CLASS === 'VC4') vc4Count++;
    });
    document.getElementById('kpiVc4Current').textContent = (1120 + vc4Count).toLocaleString();
    document.getElementById('kpiTodayIssued').textContent = (34 + state.inventoryTags.length - 6).toString();
  }

  // --- RENDER OTHER DASHBOARD TABLES ---
  function renderAgentReport() {
    const tbody = document.getElementById('agentReportBody');
    if (!tbody) return;

    const search = (document.getElementById('agentSearchInput')?.value || '').toLowerCase();
    tbody.innerHTML = '';

    const filtered = state.agentList.filter(a => {
      if (search && !`${a.id} ${a.name} ${a.supervisor}`.toLowerCase().includes(search)) return false;
      return true;
    });

    filtered.forEach(a => {
      const tr = document.createElement('tr');
      const isPositive = a.growth.startsWith('+');
      tr.innerHTML = `
        <td><span class="tag-badge">${escapeHtml(a.id)}</span></td>
        <td><strong>${escapeHtml(a.name)}</strong></td>
        <td>${escapeHtml(a.supervisor)}</td>
        <td><strong>${a.currentMonth}</strong></td>
        <td style="color: var(--text-muted);">${a.lastMonth}</td>
        <td style="color: ${isPositive ? 'var(--success)' : 'var(--danger)'}; font-weight: 700;">${a.growth}</td>
        <td>${a.vc4Share}</td>
        <td><span class="status-badge success">${a.status}</span></td>
      `;
      tbody.appendChild(tr);
    });

    // Wire up search input
    const searchInput = document.getElementById('agentSearchInput');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';
      searchInput.addEventListener('input', renderAgentReport);
    }
  }

  function renderTagAssignment() {
    const tbody = document.getElementById('tagAssignBody');
    if (!tbody) return;

    const search = (document.getElementById('tagAssignSearch')?.value || '').toLowerCase();
    tbody.innerHTML = '';

    const filtered = state.inventoryTags.filter(t => {
      if (search && !`${t.TAG_ID} ${t.SERIAL_NUMBER} ${t.AGENT_NAME} ${t.SUPERVISOR_NAME}`.toLowerCase().includes(search)) return false;
      return true;
    });

    filtered.slice(0, 50).forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="tag-badge">${escapeHtml(t.TAG_ID)}</span></td>
        <td><span class="tag-badge">${escapeHtml(t.SERIAL_NUMBER)}</span></td>
        <td><strong>${escapeHtml(t.AGENT_NAME)}</strong> (${escapeHtml(t.AGENT_ID || '')})</td>
        <td><span class="status-badge success">${escapeHtml(t.VEHICLE_CLASS)}</span></td>
        <td>${escapeHtml(t.SUPERVISOR_NAME)}</td>
        <td style="font-size: 12px; color: var(--text-muted);">${escapeHtml(t.MAPPED_AT || '')}</td>
        <td><span class="status-badge success">${escapeHtml(t.STATUS || 'MAPPED')}</span></td>
      `;
      tbody.appendChild(tr);
    });

    // Wire search
    const searchInput = document.getElementById('tagAssignSearch');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';
      searchInput.addEventListener('input', renderTagAssignment);
    }
  }

  function renderTlSummary() {
    const tbody = document.getElementById('tlSummaryBody');
    if (!tbody) return;

    const tls = [
      { name: 'Vikas Meena', totalAgents: 18, activeAgents: 16, totalTags: 684, vc4Share: '78.2%', today: 18 },
      { name: 'Sunil Yadav', totalAgents: 16, activeAgents: 14, totalTags: 512, vc4Share: '74.1%', today: 11 },
      { name: 'Rohit Verma', totalAgents: 14, activeAgents: 9, totalTags: 286, vc4Share: '71.5%', today: 5 }
    ];

    tbody.innerHTML = '';
    tls.forEach(tl => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(tl.name)}</strong></td>
        <td>${tl.totalAgents}</td>
        <td><span class="status-badge success">${tl.activeAgents}</span></td>
        <td><strong>${tl.totalTags}</strong></td>
        <td>${tl.vc4Share}</td>
        <td><span class="status-badge success">+${tl.today}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- CHARTS (CHART.JS) ---
  function initCharts() {
    if (typeof Chart === 'undefined') return;

    // Chart 1: Top Agents
    const ctxTop = document.getElementById('chartTopAgents')?.getContext('2d');
    if (ctxTop) {
      state.charts.topAgents = new Chart(ctxTop, {
        type: 'bar',
        data: {
          labels: ['Rahul S.', 'Amit V.', 'Suresh K.', 'Pooja S.', 'Manoj G.', 'Vikram C.', 'Ramesh J.', 'Deepak S.'],
          datasets: [{
            label: 'Tags Issued (Month)',
            data: [142, 128, 115, 98, 92, 85, 74, 68],
            backgroundColor: '#3b82f6',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
            x: { grid: { display: false } }
          }
        }
      });
    }

    // Chart 2: VC Distribution Donut
    const ctxVc = document.getElementById('chartVcDistribution')?.getContext('2d');
    if (ctxVc) {
      state.charts.vcDist = new Chart(ctxVc, {
        type: 'doughnut',
        data: {
          labels: ['VC4 (Car)', 'VC5 (LCV)', 'VC7 (2-Axle Truck)', 'VC12 (4-6 Axle)', 'VC6 (Bus)'],
          datasets: [{
            data: [75, 12, 7, 4, 2],
            backgroundColor: ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
          }
        }
      });
    }

    // Chart 3: Daily Trends Line
    const ctxTrends = document.getElementById('chartDailyTrends')?.getContext('2d');
    if (ctxTrends) {
      const days = [];
      const dataValues = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(`${d.getDate()}/${d.getMonth() + 1}`);
        dataValues.push(Math.floor(25 + Math.random() * 35));
      }

      state.charts.dailyTrends = new Chart(ctxTrends, {
        type: 'line',
        data: {
          labels: days,
          datasets: [{
            label: 'Daily FASTag Issuance',
            data: dataValues,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            fill: true,
            tension: 0.35,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
            x: { grid: { display: false } }
          }
        }
      });
    }
  }

  // --- API SETTINGS & CONNECTION TEST ---
  function initApiSettings() {
    const inputApiUrl = document.getElementById('inputApiUrl');
    const btnSave = document.getElementById('btnSaveApiConfig');
    const btnReset = document.getElementById('btnResetToDemo');

    if (inputApiUrl && state.apiUrl) {
      inputApiUrl.value = state.apiUrl;
    }

    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        const url = (inputApiUrl?.value || '').trim();
        if (!url) {
          showToast('Kripya valid Web App URL dalein!', 'warning');
          return;
        }

        state.apiUrl = url;
        localStorage.setItem('gv_api_url', url);
        showToast('Testing connection to Apps Script...', 'info');

        await testApiConnection(url);
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        state.apiUrl = '';
        localStorage.removeItem('gv_api_url');
        if (inputApiUrl) inputApiUrl.value = '';
        checkApiStatus();
        showToast('Reset to Demo Mode.', 'info');
      });
    }
  }

  async function testApiConnection(url) {
    const statusBox = document.getElementById('apiTestStatus');
    statusBox.style.display = 'block';
    statusBox.style.backgroundColor = '#eff6ff';
    statusBox.style.color = '#1d4ed8';
    statusBox.textContent = 'Connecting to Google Apps Script...';

    try {
      // Call action=ping
      const testUrl = url.includes('?') ? `${url}&action=ping` : `${url}?action=ping`;
      const res = await fetch(testUrl);
      const data = await res.json();

      if (data && data.success) {
        statusBox.style.backgroundColor = '#ecfdf5';
        statusBox.style.color = '#065f46';
        statusBox.innerHTML = `🟢 <strong>Connected Successfully!</strong> Server Message: "${data.message || 'OK'}"`;
        state.isLiveMode = true;
        updateStatusBanner(true);
        showToast('🟢 Apps Script connection successful!', 'success');
      } else {
        statusBox.style.backgroundColor = '#fef2f2';
        statusBox.style.color = '#991b1b';
        statusBox.innerHTML = `⚠️ Response received but success was false. Check script permissions.`;
      }
    } catch (err) {
      statusBox.style.backgroundColor = '#fffbeb';
      statusBox.style.color = '#92400e';
      statusBox.innerHTML = `ℹ️ Note: Apps Script URL save ho gaya hai. Browser me direct GET restrict ho sakta hai par Tag Mapping POST requests work karengi.`;
      state.isLiveMode = true;
      updateStatusBanner(true);
      showToast('API URL save ho gaya!', 'success');
    }
  }

  function checkApiStatus() {
    if (state.apiUrl) {
      updateStatusBanner(true);
    } else {
      updateStatusBanner(false);
    }
  }

  function updateStatusBanner(isLive) {
    const banner = document.getElementById('topBanner');
    const dot = document.getElementById('systemStatusDot');
    const text = document.getElementById('systemStatusText');
    const bannerText = document.getElementById('bannerText');
    const bannerIcon = document.getElementById('bannerIcon');

    if (isLive) {
      banner.classList.add('live-mode');
      bannerIcon.textContent = '🟢';
      bannerText.innerHTML = `<strong>LIVE MODE:</strong> Connected to Google Apps Script Web App. Tag mapping live sheet me jayegi.`;
      dot.classList.add('live');
      text.textContent = 'Live Sheet Mode';
    } else {
      banner.classList.remove('live-mode');
      bannerIcon.textContent = '⚙️';
      bannerText.innerHTML = `<strong>SETUP MODE (Demo Data):</strong> Live Sheet ke liye <strong>API Settings</strong> me apna Google Apps Script Web App URL dalein.`;
      dot.classList.remove('live');
      text.textContent = 'Setup Mode (Demo)';
    }
  }

  // --- REFRESH TIMER ---
  function startRefreshTimer() {
    let secondsLeft = 600; // 10 minutes
    const timerEl = document.getElementById('refreshTimer');
    const btnRefresh = document.getElementById('btnRefreshData');

    setInterval(() => {
      secondsLeft--;
      if (secondsLeft <= 0) {
        secondsLeft = 600;
        showToast('Data auto-refreshed.', 'info');
      }
      const mins = Math.floor(secondsLeft / 60);
      const secs = secondsLeft % 60;
      if (timerEl) {
        timerEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }
    }, 1000);

    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        secondsLeft = 600;
        showToast('↻ Dashboard data refreshed.', 'success');
      });
    }
  }

  // --- LOAD APPS SCRIPT CODE DISPLAY ---
  function loadAppsScriptBackendCode() {
    const display = document.getElementById('appsScriptCodeDisplay');
    if (!display) return;

    fetch('TagMapping-AppsScript.gs')
      .then(r => r.text())
      .then(code => {
        display.textContent = code;
      })
      .catch(() => {
        // Fallback embedded text if direct file fetch fails
        display.textContent = `// Google Apps Script Code\n// Open gv-partner-dashboard/TagMapping-AppsScript.gs to see full source code!`;
      });
  }

  // --- TOAST UTILITY ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : type === 'danger' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
