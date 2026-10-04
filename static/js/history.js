/* BC125AT Web Controller — history.js
   Activity history view, backed by the server's SQLite history.

   Transmission detection runs server-side (storage/history_tracker.py):
   a stop of >= 0.8s on one frequency is logged when the frequency
   changes. This module only loads, filters, renders and exports that
   shared history, so every browser sees the same entries.

   Timestamps from the API are UTC ISO-8601 strings ending in "Z".

   localStorage 'bc125at_history' is just a cache for the heatmaps.
   Pre-0.8.0 browser history is imported once (admin only) — see
   migrateLocalStorage().
*/

const History = (() => {

  const STORAGE_KEY    = 'bc125at_history';
  const MIGRATION_KEY  = 'bc125at_history_migrated_sqlite';
  const PENDING_KEY    = 'bc125at_history_pending_import';
  const MAX_ENTRIES    = 1000;   // newest entries loaded from the backend
  const PAGE_SIZE      = 50;

  let entries     = [];
  let filterText  = '';
  let currentPage = 1;
  let lastRefresh = 0;

  /* ── Persistence ─────────────────────────────────────────────── */

  /* One-time import of pre-0.8.0 browser history. The original entries
     are copied to PENDING_KEY first, because STORAGE_KEY is overwritten
     with the backend cache on every load. Import needs admin, so a guest
     keeps the pending copy until an admin opens the app in this browser.
     Uses plain fetch so a guest's 401 doesn't redirect to the login page. */
  async function migrateLocalStorage() {
    try {
      if (localStorage.getItem(MIGRATION_KEY) === '1') return;
      let raw = localStorage.getItem(PENDING_KEY);
      if (raw === null) {
        raw = localStorage.getItem(STORAGE_KEY) || '[]';
        localStorage.setItem(PENDING_KEY, raw);
      }
      const oldEntries = JSON.parse(raw);
      if (Array.isArray(oldEntries) && oldEntries.length > 0) {
        const res = await fetch('/api/history/import', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ entries: oldEntries }),
        });
        if (!res.ok) return;   // retry on a later page load
      }
      localStorage.setItem(MIGRATION_KEY, '1');
      localStorage.removeItem(PENDING_KEY);
    } catch (_) {}
  }

  async function load() {
    try {
      const res = await apiFetch(`/api/history?limit=${MAX_ENTRIES}`);
      entries = res.success ? (res.data.entries || []) : [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      console.log('[History] Loaded', entries.length, 'entries from SQLite backend');
    } catch (_) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        entries = raw ? JSON.parse(raw) : [];
      } catch (_) { entries = []; }
    }
  }

  /* Match recording files to history entries by timestamp proximity */
  async function matchRecordings() {
    try {
      const res = await apiFetch('/api/recordings/index');
      if (!res.success || !res.data.recordings.length) return;
      const recs = res.data.recordings;

      // For each recording with metadata, find the closest history entry
      let matched = 0;
      entries.forEach(e => {
        if (e.recording_url) return;
        const ets = new Date(e.timestamp).getTime();
        const match = recs.find(r => {
          if (!r.frequency_mhz || Math.abs(r.frequency_mhz - e.frequency) > 0.005) return false;
          const rts = new Date(r.created).getTime();
          return Math.abs(rts - ets) < 10000;  // within 10 seconds
        });
        if (match) {
          e.recording_url = match.url;
          matched++;
        }
      });
      if (matched > 0) {
        render();
        console.log('[History] Matched', matched, 'recordings to history entries');
      }
    } catch (_) {}
  }

  function save() {
    // Cache backend history locally for heatmaps/status fallback only.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch (_) {}
  }

  /* ── State tracking ──────────────────────────────────────────── */

  function onState(state) {
    // Detection runs server-side; just refresh periodically so the
    // badge, history table and mini heatmap catch up while the app is open.
    const now = Date.now();
    if (now - lastRefresh < 15000) return;
    lastRefresh = now;
    load().then(() => {
      updateBadge();
      renderIfVisible();
      if (window.MiniHeatmap) MiniHeatmap.render();
    });
  }

  /* Smart Resume skipped the transmission on freq_mhz. The server marks
     the in-progress dwell (or one saved a moment ago) — never an older
     row. Plain fetch: a guest's 401 is ignored instead of redirecting. */
  async function markSkipped(freq_mhz) {
    try {
      const res = await fetch('/api/history/mark-current-skipped', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ frequency_mhz: freq_mhz || 0 }),
      });
      const data = await res.json();
      if (data.success && data.data?.marked) refresh();
    } catch (_) {}
  }

  /* ── Render helpers ──────────────────────────────────────────── */

  function renderIfVisible() {
    const pane = document.getElementById('tab-history');
    if (pane && pane.classList.contains('active')) render();
  }

  function updateBadge() {
    const badge = document.getElementById('history-badge');
    if (badge) badge.textContent = entries.length || '';
  }

  function filtered() {
    // Tag entries as discoveries before filtering (needs allChannels loaded)
    if (window.Discovery) {
      Discovery.tagEntries(entries);
      Discovery.updateBadge(entries);
    }

    // Apply discovery filter first if active
    let result = (window.Discovery && Discovery.isActive)
      ? Discovery.filterEntries(entries)
      : entries;

    // Then apply text filter
    if (!filterText) return result;
    const q = filterText.toLowerCase();
    return result.filter(e =>
      (e.name       || '').toLowerCase().includes(q) ||
      (e.frequency  ? e.frequency.toFixed(4) : '').includes(q) ||
      (e.modulation || '').toLowerCase().includes(q) ||
      (e.channel    ? String(e.channel) : '').includes(q)
    );
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ── Render ──────────────────────────────────────────────────── */

  function render() {
    const tbody   = document.getElementById('hist-tbody');
    const countEl = document.getElementById('hist-count');
    const pgEl    = document.getElementById('hist-page');
    if (!tbody) return;

    const rows  = filtered();
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    currentPage = Math.min(currentPage, pages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = rows.slice(start, start + PAGE_SIZE);

    if (countEl) {
      countEl.textContent =
        `${total} transmission${total !== 1 ? 's' : ''}` +
        (filterText ? ` matching "${filterText}"` : '') +
        (entries.length >= MAX_ENTRIES ? ` (max ${MAX_ENTRIES})` : '');
    }

    if (pgEl) {
      pgEl.textContent = pages > 1 ? `Page ${currentPage} of ${pages}` : '';
    }

    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="ch-empty">
        ${filterText ? 'No transmissions match your filter' : 'No transmissions logged yet — start scanning'}
      </td></tr>`;
      updatePagination(pages);
      return;
    }

    tbody.innerHTML = slice.map(e => {
      const ts    = new Date(e.timestamp);
      const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = ts.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const freq  = e.frequency > 0 ? e.frequency.toFixed(4) + ' MHz' : '—';
      const ch    = e.channel > 0 ? `CH ${e.channel}` : '—';
      const dur   = e.duration >= 60
        ? `${Math.floor(e.duration / 60)}m ${(e.duration % 60).toFixed(0)}s`
        : `${e.duration}s`;
      const isDisc = !!e.is_discovery;

      return `<tr class="${e.skipped ? 'hist-skipped' : ''} ${isDisc ? 'hist-discovery-row' : ''}">
        <td>${isDisc ? '<span class="hist-disc-badge" title="Discovered in search mode — not in programmed channels">🔍</span>' : ''}</td>
        <td class="hist-time">
          <span class="hist-timestr">${timeStr}</span>
          <span class="hist-date">${dateStr}</span>
        </td>
        <td class="hist-freq">${escHtml(freq)}</td>
        <td>${escHtml(ch)}</td>
        <td class="hist-name">${escHtml(e.name || '—')}</td>
        <td>${escHtml(e.modulation || '—')}</td>
        <td class="hist-dur">${dur}</td>
        <td>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
            ${e.skipped
              ? '<span class="hist-badge hist-badge--skip">Skipped</span>'
              : '<span class="hist-badge hist-badge--heard">Heard</span>'
            }
            ${e.recording_url
              ? `<a class="hist-play-btn" href="${e.recording_url}" target="_blank" title="Play recording">🔊</a>`
              : ''
            }
            ${isDisc
              ? `<button class="ch-action-btn hist-add-ch" data-freq="${e.frequency}" data-mod="${escHtml(e.modulation || 'FM')}" title="Add to programmed channels" style="font-size:10px;padding:2px 6px;color:var(--green-text)">+ Add</button>`
              : ''
            }
            ${e.frequency > 0
              ? `<button class="ch-action-btn sr-hist-block" data-freq="${e.frequency}" data-label="${escHtml(e.name || '')}" title="Block/unblock in Smart Resume" style="font-size:11px;padding:2px 6px">⊘</button>`
              : ''
            }
          </div>
        </td>
      </tr>`;
    }).join('');

    updatePagination(pages);

    // Wire "Add to channel" buttons on discovery rows
    tbody.querySelectorAll('.hist-add-ch').forEach(btn => {
      btn.addEventListener('click', () => {
        const freq_mhz = parseFloat(btn.dataset.freq);
        const mod      = btn.dataset.mod || 'FM';
        Discovery.openAddChannel(freq_mhz, mod);
      });
    });

    // Wire Smart Resume block buttons
    tbody.querySelectorAll('.sr-hist-block').forEach(btn => {
      const freq  = parseFloat(btn.dataset.freq);
      const label = btn.dataset.label || '';
      const blocked = window.SmartResume && SmartResume.isBlocked(freq);
      if (blocked) {
        btn.textContent = '✓';
        btn.title = 'Already blocked';
        btn.style.color = 'var(--green-text)';
      }
      btn.addEventListener('click', () => {
        if (window.SmartResume) {
          if (SmartResume.isBlocked(freq)) {
            SmartResume.unblockFreq(freq);
            btn.textContent = '⊘';
            btn.style.color = '';
          } else {
            SmartResume.blockFreq(freq, label);
            btn.textContent = '✓';
            btn.style.color = 'var(--green-text)';
          }
        }
      });
    });
  }

  function updatePagination(pages) {
    const prev = document.getElementById('hist-prev');
    const next = document.getElementById('hist-next');
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= pages;
  }

  /* ── Init ────────────────────────────────────────────────────── */

  function init() {
    migrateLocalStorage().then(load).then(() => {
      updateBadge();
      renderIfVisible();
      matchRecordings();
    });

    const filterInput = document.getElementById('hist-filter');
    if (filterInput) {
      filterInput.addEventListener('input', () => {
        filterText  = filterInput.value.trim();
        currentPage = 1;
        render();
      });
    }

    const clearBtn = document.getElementById('hist-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm(`Clear all ${entries.length} history entries?`)) return;
        apiFetch('/api/history', 'DELETE').then(res => {
          if (res.success) {
            entries = [];
            save();
            render();
            updateBadge();
            if (window.logEntry) logEntry('Activity history cleared', 'info');
          } else if (window.logEntry) {
            logEntry(`History clear failed — ${res.message}`, 'err');
          }
        });
      });
    }

    const exportBtn = document.getElementById('hist-export');
    if (exportBtn) exportBtn.addEventListener('click', exportCsv);

    document.getElementById('hist-prev')?.addEventListener('click', () => {
      currentPage--;
      render();
    });
    document.getElementById('hist-next')?.addEventListener('click', () => {
      currentPage++;
      render();
    });

    console.log('[History] Initialised — using SQLite backend history');
    // Init discovery toggle
    if (window.Discovery) Discovery.init();
  }

  /* ── CSV Export ──────────────────────────────────────────────── */

  function exportCsv() {
    const rows  = filtered();
    const csvLines = [
      'timestamp,frequency_mhz,channel,name,modulation,duration_s,squelch_open,skipped'
    ];
    rows.forEach(e => {
      csvLines.push([
        e.timestamp,
        e.frequency   || '',
        e.channel     || '',
        '"' + (e.name || '').replace(/"/g, '""') + '"',
        e.modulation  || '',
        e.duration    || '',
        e.squelch_open ? 'true' : 'false',
        e.skipped     ? 'true' : 'false',
      ].join(','));
    });

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `bc125at_history_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (window.logEntry) logEntry(`History exported — ${rows.length} entries`, 'ok');
  }

  async function refresh() {
    lastRefresh = Date.now();
    await load();
    updateBadge();
    render();
  }

  const History = { init, onState, markSkipped, render, refresh, matchRecordings,
                   get entries() { return entries; } };
  return History;

})();

window.History = History;
