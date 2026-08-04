/* BC125AT Web Controller — smartresume.js
   Smart Resume — Frequency Blocklist Engine.

   When Smart Resume is ON and squelch opens on a blocked frequency,
   the resume key is sent instantly. No audio analysis. No VAD.

   Blocklist matching uses ±5 kHz tolerance — the BC125AT minimum
   frequency step — so slight drift is handled automatically.

   Storage: localStorage 'bc125at_sr_blocked'   (blocked frequencies)
             localStorage 'bc125at_sr_enabled'   (on/off state)
   Max blocked: 50 frequencies
*/

const SmartResume = (() => {

  /* ── Constants ─────────────────────────────────────────────────── */
  const STORAGE_ENABLED = 'bc125at_sr_enabled';
  const STORAGE_BLOCKED = 'bc125at_sr_blocked';
  const MAX_BLOCKED     = 50;
  const MATCH_KHZ       = 5;      // ±5 kHz tolerance

  /* ── State ─────────────────────────────────────────────────────── */
  let enabled      = false;
  let blocklist    = [];     // [{ freq_mhz, label }]
  let lastState    = null;
  let lastSqlOpen  = false;

  /* ── DOM refs ───────────────────────────────────────────────────── */
  const getToggle   = () => document.getElementById('sr-toggle');
  const getStatusEl = () => document.getElementById('sr-status');
  const getCountEl  = () => document.getElementById('sr-block-count');
  const getBlockBtn = () => document.getElementById('sr-block-btn');

  /* ── Persistence ────────────────────────────────────────────────── */
  function loadPrefs() {
    try {
      enabled   = localStorage.getItem(STORAGE_ENABLED) === '1';
      const raw = localStorage.getItem(STORAGE_BLOCKED);
      blocklist = raw ? JSON.parse(raw) : [];
    } catch (_) {
      enabled   = false;
      blocklist = [];
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_ENABLED, enabled ? '1' : '0');
      localStorage.setItem(STORAGE_BLOCKED, JSON.stringify(blocklist));
    } catch (_) {}
  }

  /* ── Blocklist logic ────────────────────────────────────────────── */
  function isBlocked(freq_mhz) {
    if (!freq_mhz || freq_mhz <= 0) return false;
    return blocklist.some(b =>
      Math.abs(b.freq_mhz - freq_mhz) <= MATCH_KHZ / 1000
    );
  }

  function blockFreq(freq_mhz, label) {
    if (!freq_mhz || freq_mhz <= 0) return false;
    if (isBlocked(freq_mhz)) {
      if (window.logEntry) logEntry(`${freq_mhz.toFixed(4)} MHz already blocked`, 'info');
      return false;
    }
    if (blocklist.length >= MAX_BLOCKED) {
      if (window.logEntry) logEntry(`Blocklist full (max ${MAX_BLOCKED})`, 'err');
      return false;
    }
    blocklist.push({ freq_mhz, label: label || '' });
    savePrefs();
    updateCount();
    renderBlocklist();
    if (window.logEntry) logEntry(`Blocked ${freq_mhz.toFixed(4)} MHz${label ? ' — ' + label : ''}`, 'ok');

    // If we are currently on this frequency, skip immediately
    // (the rising-edge trigger already fired before the block was added)
    const currentFreq = lastState?.frequency_mhz || 0;
    if (currentFreq > 0 && Math.abs(currentFreq - freq_mhz) <= MATCH_KHZ / 1000) {
      setStatus(`Blocked — skipping ${freq_mhz.toFixed(4)} MHz`, 'skip');
      sendResume();
      setTimeout(() => setStatus('', ''), 2000);
    }

    return true;
  }

  function unblockFreq(freq_mhz) {
    blocklist = blocklist.filter(b => Math.abs(b.freq_mhz - freq_mhz) > MATCH_KHZ / 1000);
    savePrefs();
    updateCount();
    renderBlocklist();
    if (window.logEntry) logEntry(`Unblocked ${freq_mhz.toFixed(4)} MHz`, 'info');
  }

  function clearAll() {
    if (!confirm(`Remove all ${blocklist.length} blocked frequencies?`)) return;
    blocklist = [];
    savePrefs();
    updateCount();
    renderBlocklist();
    if (window.logEntry) logEntry('Blocklist cleared', 'info');
  }

  /* ── Resume key ─────────────────────────────────────────────────── */
  async function sendResume() {
    const inSearch = lastState && lastState.channel_id === 0;
    const key      = inSearch ? 'search' : 'scan';
    try {
      await fetch(`/api/key/${key}`, { method: 'POST' });
      if (window.History) History.markLastSkipped();
    } catch (e) {
      console.warn('[SmartResume] Resume key failed:', e.message);
    }
  }

  /* ── State handler ──────────────────────────────────────────────── */
  function onState(state) {
    if (!enabled) return;

    lastState = state;
    const freq    = state.frequency_mhz || 0;
    const sqlOpen = !!state.squelch_open;

    // Rising edge — squelch just opened
    if (sqlOpen && !lastSqlOpen) {
      if (freq > 0 && isBlocked(freq)) {
        // Instant skip — no delay, no analysis
        const entry = blocklist.find(b => Math.abs(b.freq_mhz - freq) <= MATCH_KHZ / 1000);
        const label = entry?.label ? ` (${entry.label})` : '';
        setStatus(`Blocked — skipping ${freq.toFixed(4)} MHz`, 'skip');
        if (window.logEntry) logEntry(`Smart Resume: skipped blocked freq ${freq.toFixed(4)} MHz${label}`, 'info');
        sendResume();
        setTimeout(() => setStatus('', ''), 2000);
      }
    }

    lastSqlOpen = sqlOpen;

    // Update the Block button state whenever state changes
    updateBlockBtn(freq);
  }

  /* ── UI helpers ─────────────────────────────────────────────────── */
  function setStatus(msg, cls) {
    const el = getStatusEl();
    if (!el) return;
    el.textContent = msg;
    el.className   = `sr-status-text ${cls || ''}`;
  }

  function updateCount() {
    const el = getCountEl();
    if (el) el.textContent = blocklist.length > 0 ? blocklist.length : '';
  }

  function updateBlockBtn(freq_mhz) {
    const btn = getBlockBtn();
    if (!btn) return;

    // Show block button whenever Smart Resume is enabled and there is a freq
    // The user should always be able to block the current frequency manually
    if (!enabled || !freq_mhz || freq_mhz <= 0) {
      btn.style.display = 'none';
      return;
    }

    const blocked = isBlocked(freq_mhz);
    btn.style.display  = 'inline-flex';
    btn.textContent    = blocked
      ? `✓ ${freq_mhz.toFixed(4)} Blocked`
      : `⊘ Block ${freq_mhz.toFixed(4)}`;
    btn.dataset.freq   = freq_mhz;
    btn.dataset.label  = lastState?.channel_name || '';
    btn.classList.toggle('sr-btn--blocked', blocked);
  }

  /* ── Blocklist manage panel ─────────────────────────────────────── */
  function renderBlocklist() {
    const panel = document.getElementById('sr-blocklist-panel');
    if (!panel) return;

    if (blocklist.length === 0) {
      panel.innerHTML = '<span class="sr-blocklist-empty">No blocked frequencies — block a freq using the button that appears when squelch opens</span>';
      return;
    }

    panel.innerHTML = blocklist.map((b, i) => `
      <div class="sr-blocklist-row">
        <span class="sr-blocklist-freq">${b.freq_mhz.toFixed(4)} MHz</span>
        <span class="sr-blocklist-label">${escHtml(b.label || '')}</span>
        <button class="ch-action-btn sr-unblock" data-freq="${b.freq_mhz}" title="Remove from blocklist">✕</button>
      </div>
    `).join('');

    panel.querySelectorAll('.sr-unblock').forEach(btn => {
      btn.addEventListener('click', () => unblockFreq(parseFloat(btn.dataset.freq)));
    });
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── Toggle enable/disable ──────────────────────────────────────── */
  function setEnabled(val) {
    enabled = val;
    savePrefs();
    const btn = getToggle();
    if (btn) {
      btn.textContent = enabled ? 'ON' : 'OFF';
      btn.classList.toggle('active', enabled);
    }
    if (!enabled) setStatus('', '');
    if (window.logEntry) logEntry(`Smart Resume ${enabled ? 'enabled' : 'disabled'}`, 'info');
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  function init() {
    loadPrefs();

    // Toggle button
    const toggle = getToggle();
    if (toggle) {
      toggle.textContent = enabled ? 'ON' : 'OFF';
      toggle.classList.toggle('active', enabled);
      toggle.addEventListener('click', () => setEnabled(!enabled));
    }

    // Block button (shown when squelch opens)
    const blockBtn = getBlockBtn();
    if (blockBtn) {
      blockBtn.addEventListener('click', () => {
        const freq  = parseFloat(blockBtn.dataset.freq);
        const label = blockBtn.dataset.label || '';
        if (isBlocked(freq)) {
          unblockFreq(freq);
        } else {
          blockFreq(freq, label);
        }
      });
    }

    // Clear all button
    document.getElementById('sr-clear-all')?.addEventListener('click', clearAll);

    // Manage panel toggle
    document.getElementById('sr-manage-btn')?.addEventListener('click', () => {
      const panel = document.getElementById('sr-blocklist-panel');
      if (!panel) return;
      const visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'block';
      document.getElementById('sr-manage-btn').textContent = visible ? 'Manage' : 'Close';
      if (!visible) renderBlocklist();
    });

    updateCount();
  }

  return { init, onState, blockFreq, unblockFreq, isBlocked,
           get blocklist() { return blocklist; } };

})();

window.SmartResume = SmartResume;
