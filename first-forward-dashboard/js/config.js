/* First Forward Dashboard — configuration.
   Sab kuch yahin se control hota hai: Google Sheet ID, tab (sheet) names, aur EIR/StockDataa ke column letters.
   Sheet public ("Anyone with the link can view") honi chahiye. */
window.FF = window.FF || {};

FF.config = {
  appName: 'First Forward Dashboard',
  brand: 'First Forward',
  sheetId: '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc',

  // Server proxy (server.js) — caches Google responses. Static hosting par browser seedha Google se fetch karta hai.
  proxyPath: '/api/gviz',
  autoRefreshMs: 5 * 60 * 1000,

  // Sheet ke tabs, usi order mein jaise Google Sheet mein hain (left sidebar isi list se banta hai).
  // gid pata ho to daal do (URL mein #gid=...). gid na ho to naam se query hoti hai — naam exact hona chahiye.
  sheets: [
    { name: 'EIR', icon: '🧾', title: 'EIR · Issuance Log', desc: 'Har issued FASTag ka full log (last + current month)', big: true, search: ['B', 'L', 'J', 'AX', 'AW', 'BA', 'AZ', 'BH'], expect: 'TAG_ID' },
    { name: 'Payout Pivot Table 7', icon: '💸', title: 'Payout Pivot', desc: 'Payout pivot table' },
    { name: 'Performer Report', icon: '📋', title: 'Performer Report', desc: 'Sheet ka apna performance dashboard' },
    { name: 'Agent iD', icon: '🪪', title: 'Agent iD', desc: 'Agent ID mapping / GV partner agents' },
    { name: 'ARM Master', icon: '🧑‍💼', title: 'ARM Master', desc: 'ARM-wise daily issuance' },
    { name: 'StockDataa', icon: '📦', title: 'StockDataa · Inventory', desc: 'Field me pada hua stock (tag-wise)', big: true, search: ['I', 'H', 'K', 'B', 'D', 'F'], expect: 'ID' },
    { name: 'Biomatric Devices', icon: '🔏', title: 'Biomatric Devices', desc: 'Biometric device issuances', big: true },
    { name: 'REPORT', icon: '📑', title: 'REPORT', desc: 'Agent-wise summary: stock + issuance + status', gid: '242489821' },
    { name: 'High De-Growth/Inactive', icon: '📉', title: 'High De-Growth / Inactive', desc: 'De-growth, inactive & wrong-VRN agents' },
    { name: 'Top Performer', icon: '🏆', title: 'Top Performer', desc: 'Top agents & TLs' },
    { name: 'Search Dashboard', icon: '🔎', title: 'Search Dashboard', desc: 'TL-wise search view' },
    { name: 'ARM', icon: '🗂️', title: 'ARM', desc: 'Agent → ARM mapping' }
  ],

  // EIR (issuance log) ke column letters. Sheet ka layout badle to sirf yahan update karo.
  eir: {
    sheet: 'EIR',
    tagId: 'A', vrn: 'B', cls: 'D', type: 'P', status: 'Z', date: 'AA',
    agentId: 'J', agentName: 'L', masterId: 'AU', tlId: 'AV', gvId: 'AW', gvName: 'AX',
    gvTl: 'AZ', tlName: 'BA', vrnType: 'BC', monthName: 'BD', regNumber: 'BH',
    // GV Partner channel ki pehchaan (master account) — is TL/master ke tags "GV Partner" gine jaate hain
    gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.'
  },

  // StockDataa (inventory) ke column letters.
  stock: {
    sheet: 'StockDataa',
    id: 'A', name: 'B', tagId: 'C', barcode: 'D', cls: 'E', tagType: 'F', bcAllocatedAt: 'G',
    agentId: 'H', agentName: 'I', agentAllocatedAt: 'J', tlName: 'K'
  },

  report: { sheet: 'REPORT', gid: '242489821' },

  sheetByName(name) {
    return this.sheets.find((s) => s.name === name) || null;
  },
  sheetUrl(name) {
    const s = name ? this.sheetByName(name) : null;
    const gid = s && s.gid ? s.gid : '';
    return `https://docs.google.com/spreadsheets/d/${this.sheetId}/edit${gid ? `?gid=${gid}#gid=${gid}` : ''}`;
  }
};
