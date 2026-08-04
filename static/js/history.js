/* BC125AT Web Controller — history.js
   Persistent activity history.

   TRACKING STRATEGY: frequency stability, not squelch_open.

   The BC125AT only sets squelch_open=true when audio actually breaks
   through the squelch threshold. During scanning, the scanner stops on
   a channel briefly to check it — squelch_open may never be true even
   though the scanner DID stop there.

   Instead we track: when the scanner stops on a frequency for >= 0.8s,
   that counts as a transmission event. When frequency changes, we log
   the previous stop with its duration.

   This works at any squelch level.
*/

const History = (() => {

  const STORAGE_KEY    = 'bc125at_history';
  const MAX_ENTRIES    = 500;
  const PAGE_SIZE      = 50;
  const MIN_DWELL_MS   = 800;    // ignore stops shorter than 800ms (scanning blip)

  let entries     = [];
  let filterText  = '';
  let currentPage = 1;

  // Frequency tracking state
  let dwellFreq   = null;   // frequency currently dwelling on
  let dwellStart  = null;   // when we started dwelling
  let dwellState  = null;   // full state snapshot when dwell started

  /* ── Persistence ─────────────────────────────────────────────── */

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      entries = raw ? JSON.parse(raw) : [];
      console.log('[History] Loaded', entries.length, 'entries from localStorage');
    } catch (_) { entries = []; }
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (_) {
      entries = entries.slice(0, 100);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch (_) {}
    }
  }

  function addEntry(entry) {
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(0, MAX_ENTRIES);
    save();
    console.log('[History] Entry added:', entry.frequency, 'MHz', entry.duration + 's');
    renderIfVisible();
    updateBadge();
    // Update mini heatmap on dashboard
    if (window.MiniHeatmap) MiniHeatmap.render();
  }

  /* ── State tracking ──────────────────────────────────────────── */

  function onState(state) {
    const freq = state.frequency_mhz || 0;
    if (freq <= 0) return;   // scanner between channels

    const now = Date.now();

    // First reading
    if (dwellFreq === null) {
      dwellFreq  = freq;
      dwellStart = now;
      dwellState = state;
      return;
    }

    // Same frequency — update state snapshot but keep original start time
    if (Math.abs(freq - dwellFreq) < 0.001) {
      dwellState = state;
      return;
    }

    // Frequency changed — log the previous dwell if long enough
    const duration = (now - dwellStart) / 1000;
    if (duration >= MIN_DWELL_MS / 1000) {
      const entry = {
        timestamp:   new Date(dwellStart).toISOString(),
        frequency:   parseFloat(dwellFreq.toFixed(4)),
        channel:     dwellState.channel_id    || 0,
        name:        dwellState.channel_name  || '',
        modulation:  dwellState.modulation    || '',
        squelch_open: !!dwellState.squelch_open,
        duration:    parseFloat(duration.toFixed(1)),
        skipped:     false,
      };
      addEntry(entry);
    }

    // Start tracking new frequency
    dwellFreq  = freq;
    dwellStart = now;
    dwellState = state;
  }

  /* Smart Resume marks the last entry as skipped */
  function markLastSkipped() {
    if (entries.length > 0) {
      entries[0].skipped = true;
      save();
      renderIfVisible();
    }
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
    load();
    updateBadge();

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
        entries = [];
        save();
        render();
        updateBadge();
        if (window.logEntry) logEntry('Activity history cleared', 'info');
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

    console.log('[History] Initialised — tracking frequency stability (min dwell:', MIN_DWELL_MS, 'ms)');
    // Match any existing recordings to loaded history entries
    matchRecordings();
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

  const History = { init, onState, markLastSkipped, render, matchRecordings,
                   get entries() { return entries; } };
  return History;

})();

window.History = History;
