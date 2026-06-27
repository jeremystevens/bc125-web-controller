/* BC125AT — settings.js  Phase 6 settings page */

/* ── Load all settings from server ── */
async function loadSettings() {
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
