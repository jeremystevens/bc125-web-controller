/* BC125AT — settings.js  Phase 6 settings page */

/* ── Load all settings from server ── */
async function loadSettings() {
  // Load custom search ranges alongside main settings
  if (window.loadSearchRanges) loadSearchRanges();

  const res = await apiFetch('/api/settings');
  if (!res.success) return;

  const d = res.data;

  // Serial
  const portEl = document.getElementById('set-port');
  const pollEl = document.getElementById('set-poll');
  if (portEl) portEl.value = d.serial?.port || '';
  if (pollEl) pollEl.value = d.serial?.poll_interval || 0.5;

  // Recording info (read-only)
  const dirEl  = document.getElementById('set-rec-dir');
  const tailEl = document.getElementById('set-tail');
  if (dirEl)  dirEl.value  = d.recording?.directory || 'recordings';
  if (tailEl) tailEl.value = `${d.recording?.tail_seconds || 3} seconds`;

  // Scan groups
  if (d.scan_groups) {
    d.scan_groups.forEach((enabled, i) => {
      const cb = document.querySelector(`.group-check[data-group="${i + 1}"]`);
      if (cb) cb.checked = enabled;
    });
  }

  // Priority mode
  if (d.priority_mode !== undefined) {
    document.querySelectorAll('.pri-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === String(d.priority_mode));
    });
  }

  // Server info panel
  const state = await apiFetch('/api/status');
  if (state.success) {
    const s = state.data;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('inf-model',    s.model    || '--');
    set('inf-firmware', s.firmware || '--');
    set('inf-battery',  s.battery_volts ? s.battery_volts.toFixed(2) + ' V' : '--');
    set('inf-port',     d.serial?.port || '--');
    set('inf-poll',     d.serial?.poll_interval ? d.serial.poll_interval + ' s' : '--');
  }
}

/* ── Save serial settings ── */
const serialSaveBtn  = document.getElementById('serial-save');
const serialSaveNote = document.getElementById('serial-save-note');

if (serialSaveBtn) {
  serialSaveBtn.addEventListener('click', async () => {
    const port = document.getElementById('set-port')?.value.trim();
    const poll = parseFloat(document.getElementById('set-poll')?.value);

    if (!port) { showNote('Port cannot be empty.', true); return; }
    if (isNaN(poll) || poll < 0.2 || poll > 5) {
      showNote('Poll interval must be 0.2–5.0 seconds.', true);
      return;
    }

    serialSaveBtn.disabled    = true;
    serialSaveBtn.textContent = 'Saving…';

    const res = await apiFetch('/api/settings/serial', 'POST', { port, poll_interval: poll });

    serialSaveBtn.disabled    = false;
    serialSaveBtn.textContent = 'Save Serial Settings';

    if (res.success) {
      showNote('Saved — restart the server for changes to take effect.', false);
      if (window.logEntry) logEntry('Serial settings saved', 'ok');
    } else {
      showNote(res.message, true);
    }
  });
}

function showNote(msg, isError) {
  if (!serialSaveNote) return;
  serialSaveNote.textContent = msg;
  serialSaveNote.style.color = isError ? 'var(--red)' : 'var(--green-text)';
}

/* ── Scan groups save ── */
const groupsSaveBtn = document.getElementById('groups-save');
if (groupsSaveBtn) {
  groupsSaveBtn.addEventListener('click', async () => {
    const groups = [];
    for (let i = 1; i <= 10; i++) {
      const cb = document.querySelector(`.group-check[data-group="${i}"]`);
      groups.push(cb ? cb.checked : true);
    }

    groupsSaveBtn.disabled    = true;
    groupsSaveBtn.textContent = 'Saving…';

    const res = await apiFetch('/api/settings/groups', 'POST', { groups });

    groupsSaveBtn.disabled    = false;
    groupsSaveBtn.textContent = 'Apply Scan Groups';

    if (window.logEntry) {
      logEntry(
        res.success ? 'Scan groups updated' : `Scan groups failed — ${res.message}`,
        res.success ? 'ok' : 'err'
      );
    }
  });
}

/* ── Priority mode buttons ── */
document.querySelectorAll('.pri-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    const res  = await apiFetch('/api/settings/priority', 'POST', { mode });

    if (res.success) {
      document.querySelectorAll('.pri-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (window.logEntry) logEntry(`Priority mode set to ${['Off','On','Plus','DND'][mode]}`, 'ok');
    } else {
      if (window.logEntry) logEntry(`Priority failed — ${res.message}`, 'err');
    }
  });
});

/* Expose for tabs.js */
window.loadSettings = loadSettings;


/* ════════════════════════════════════════════════════
   Custom Search Ranges
   ════════════════════════════════════════════════════ */

let searchRangesCache = [];

async function loadSearchRanges() {
  const list = document.getElementById('search-ranges-list');
  if (!list) return;

  list.innerHTML = '<span class="log-empty">Loading search ranges…</span>';

  const res = await apiFetch('/api/search/ranges');
  if (!res.success) {
    list.innerHTML = `<span class="log-empty">Failed to load — ${res.message}</span>`;
    return;
  }

  searchRangesCache = res.data.ranges;
  renderSearchRanges();

  // Also load search settings (delay + CTCSS/DCS search)
  const settingsRes = await apiFetch('/api/search/settings');
  if (settingsRes.success) {
    const delayEl = document.getElementById('search-delay');
    const codeEl  = document.getElementById('search-code-search');
    if (delayEl) delayEl.value = settingsRes.data.delay || '2';
    if (codeEl)  codeEl.checked = !!settingsRes.data.code_search;
  }
}

function renderSearchRanges() {
  const list = document.getElementById('search-ranges-list');
  if (!list) return;

  list.innerHTML = searchRangesCache.map(r => `
    <div class="search-range-row" data-index="${r.index}">
      <label class="sr-range-toggle">
        <input type="checkbox" class="sr-range-enabled" data-index="${r.index}" ${r.enabled ? 'checked' : ''}>
        <span class="sr-range-num">${r.index}</span>
      </label>
      <input type="number" class="modal-input sr-range-lower" data-index="${r.index}"
             value="${r.lower_mhz || ''}" step="0.0025" min="25" max="512" placeholder="Lower MHz">
      <span class="sr-range-dash">–</span>
      <input type="number" class="modal-input sr-range-upper" data-index="${r.index}"
             value="${r.upper_mhz || ''}" step="0.0025" min="25" max="512" placeholder="Upper MHz">
      <button class="key key--nav sr-range-save" data-index="${r.index}">Save</button>
    </div>
  `).join('');

  // Wire individual range save buttons
  list.querySelectorAll('.sr-range-save').forEach(btn => {
    btn.addEventListener('click', () => saveSearchRange(parseInt(btn.dataset.index)));
  });

  // Wire enabled toggles — collected and applied together via Apply button below,
  // but we also support instant single toggle for simplicity
  list.querySelectorAll('.sr-range-enabled').forEach(cb => {
    cb.addEventListener('change', () => applySearchRangeToggles());
  });
}

async function saveSearchRange(index) {
  const row = document.querySelector(`.search-range-row[data-index="${index}"]`);
  if (!row) return;

  const lowerEl = row.querySelector('.sr-range-lower');
  const upperEl = row.querySelector('.sr-range-upper');
  const btn     = row.querySelector('.sr-range-save');

  const lower_mhz = parseFloat(lowerEl.value);
  const upper_mhz = parseFloat(upperEl.value);

  if (isNaN(lower_mhz) || isNaN(upper_mhz)) {
    if (window.logEntry) logEntry('Both lower and upper frequencies are required', 'err');
    return;
  }
  if (lower_mhz >= upper_mhz) {
    if (window.logEntry) logEntry('Lower frequency must be less than upper', 'err');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  const res = await apiFetch(`/api/search/ranges/${index}`, 'PUT', { lower_mhz, upper_mhz });

  btn.disabled = false;
  btn.textContent = 'Save';

  if (window.logEntry) {
    logEntry(
      res.success ? `Search range ${index} saved: ${lower_mhz}–${upper_mhz} MHz` : `Save failed — ${res.message}`,
      res.success ? 'ok' : 'err'
    );
  }

  if (res.success) {
    const cached = searchRangesCache.find(r => r.index === index);
    if (cached) { cached.lower_mhz = lower_mhz; cached.upper_mhz = upper_mhz; }
  }
}

async function applySearchRangeToggles() {
  const checkboxes = document.querySelectorAll('.sr-range-enabled');
  const groups = Array.from({ length: 10 }, (_, i) => {
    const cb = document.querySelector(`.sr-range-enabled[data-index="${i + 1}"]`);
    return cb ? cb.checked : true;
  });

  if (!groups.some(g => g)) {
    if (window.logEntry) logEntry('At least one search range must stay enabled', 'err');
    // Revert the checkbox that was just unchecked
    loadSearchRanges();
    return;
  }

  const res = await apiFetch('/api/search/groups', 'POST', { groups });
  if (window.logEntry) {
    logEntry(
      res.success ? 'Search ranges updated' : `Failed — ${res.message}`,
      res.success ? 'ok' : 'err'
    );
  }
}

/* Search settings (delay + CTCSS/DCS search) */
const searchSettingsSaveBtn = document.getElementById('search-settings-save');
if (searchSettingsSaveBtn) {
  searchSettingsSaveBtn.addEventListener('click', async () => {
    const delay = document.getElementById('search-delay')?.value || '2';
    const codeSearch = document.getElementById('search-code-search')?.checked || false;

    searchSettingsSaveBtn.disabled = true;
    searchSettingsSaveBtn.textContent = 'Saving…';

    const res = await apiFetch('/api/search/settings', 'POST', { delay, code_search: codeSearch });

    searchSettingsSaveBtn.disabled = false;
    searchSettingsSaveBtn.textContent = 'Save';

    if (window.logEntry) {
      logEntry(
        res.success ? 'Search settings saved' : `Failed — ${res.message}`,
        res.success ? 'ok' : 'err'
      );
    }
  });
}

/* Refresh button */
document.getElementById('search-ranges-refresh')?.addEventListener('click', loadSearchRanges);

/* Expose for settings tab init */
window.loadSearchRanges = loadSearchRanges;
