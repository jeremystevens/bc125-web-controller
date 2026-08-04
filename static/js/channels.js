/* ════════════════════════════════════════════════════════
   Channel Search — background loader + live filter
   ════════════════════════════════════════════════════════

   Strategy:
     1. When the Channels tab first opens, load bank 1 immediately
        (normal flow) then silently fetch banks 2–10 in background.
     2. All 500 channels are cached in `allChannels[]`.
     3. Search input filters allChannels[] in real time (debounced 200ms).
     4. Status indicator shows background load progress, then result count.
     5. If user searches before all banks finish, results include
        whatever has loaded so far — message indicates partial results.
*/

const Search = (() => {

  let allChannels   = [];          // cache — grows as banks load
  let loadedBanks   = new Set();   // which banks are in allChannels
  let isLoadingAll  = false;
  let totalBanks    = 10;
  let searchActive  = false;
  let debounceTimer = null;

  // ── DOM refs ──────────────────────────────────────────────────────
  const inputEl   = () => document.getElementById('ch-search-input');
  const clearBtn  = () => document.getElementById('ch-search-clear');
  const statusEl  = () => document.getElementById('ch-search-status');

  // ── Merge a loaded bank into allChannels ──────────────────────────
  function mergeBank(bank, channels) {
    // Remove any existing entries for this bank
    allChannels = allChannels.filter(
      ch => ch.channel < (bank - 1) * 50 + 1 || ch.channel > bank * 50
    );
    allChannels.push(...channels);
    allChannels.sort((a, b) => a.channel - b.channel);
    loadedBanks.add(bank);
  }

  // ── Background load all remaining banks ──────────────────────────
  async function loadAllBanks(alreadyLoadedBank) {
    if (isLoadingAll) return;
    isLoadingAll = true;

    for (let bank = 1; bank <= totalBanks; bank++) {
      if (loadedBanks.has(bank)) continue;

      updateStatus(
        `Loading ${loadedBanks.size * 50}/${totalBanks * 50} for search…`,
        'loading'
      );

      try {
        const res  = await apiFetch(`/api/channels?bank=${bank}`);
        if (res.success && res.data.channels) {
          mergeBank(bank, res.data.channels);
        }
      } catch (_) {}

      // Small yield between banks to keep UI responsive
      await new Promise(r => setTimeout(r, 50));
    }

    isLoadingAll = false;

    if (!searchActive) {
      updateStatus(`${allChannels.length} channels ready`, 'ready');
      // Fade out status after 3 seconds when idle
      setTimeout(() => {
        if (!searchActive && statusEl()) statusEl().textContent = '';
      }, 3000);
    } else {
      // Re-run search now that all data is loaded
      runSearch(inputEl()?.value || '');
    }
  }

  // ── Status display ────────────────────────────────────────────────
  function updateStatus(msg, cls = '') {
    const el = statusEl();
    if (!el) return;
    el.textContent  = msg;
    el.className    = 'ch-search-status ' + cls;
  }

  // ── Highlight matching text ───────────────────────────────────────
  function highlight(text, query) {
    if (!query || !text) return escHtml(text || '');
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re      = new RegExp(`(${escaped})`, 'gi');
    return escHtml(text).replace(re, '<span class="ch-match">$1</span>');
  }

  function escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Run the search / filter ───────────────────────────────────────
  function runSearch(query) {
    const tbody = document.getElementById('ch-tbody');
    if (!tbody) return;

    const q = query.trim().toLowerCase();

    if (!q) {
      // Empty query — restore normal bank view
      searchActive = false;
      updateStatus(
        loadedBanks.size < totalBanks
          ? `Loading ${loadedBanks.size * 50}/${totalBanks * 50}…`
          : '',
        loadedBanks.size < totalBanks ? 'loading' : ''
      );
      // Re-render the current bank
      if (chState.channels.length) {
        renderChannels(chState.channels);
      } else {
        tbody.innerHTML = '<tr><td colspan="10" class="ch-empty">Select a bank and click Load Bank</td></tr>';
      }
      return;
    }

    searchActive = true;

    // Filter across all loaded channels
    const results = allChannels.filter(ch => {
      const name = (ch.name || '').toLowerCase();
      const freq = ch.frequency_mhz > 0 ? ch.frequency_mhz.toFixed(4) : '';
      const mod  = (ch.modulation || '').toLowerCase();
      return name.includes(q) || freq.includes(q) || mod.includes(q);
    });

    // Partial results warning
    const partial = loadedBanks.size < totalBanks;
    if (partial) {
      updateStatus(
        `${results.length} found (${loadedBanks.size * 50}/500 searched)`,
        'loading'
      );
    } else {
      updateStatus(
        results.length === 0
          ? 'No results'
          : `${results.length} of 500 match`,
        'results'
      );
    }

    if (results.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="ch-search-empty">
        No channels match "${escHtml(query)}"
        ${partial ? '<br><small>Still loading — more results may appear</small>' : ''}
      </td></tr>`;
      return;
    }

    // Render results with bank badges and highlighted matches
    tbody.innerHTML = results.map(ch => {
      const bank     = Math.ceil(ch.channel / 50);
      const freqStr  = ch.frequency_mhz > 0 ? ch.frequency_mhz.toFixed(4) + ' MHz' : '—';
      const nameHl   = highlight(ch.name || '', query);
      const freqHl   = ch.frequency_mhz > 0
        ? highlight(ch.frequency_mhz.toFixed(4) + ' MHz', query)
        : '—';
      const modHl    = highlight(ch.modulation || '', query);

      const starred = window.Favorites && window.Favorites.isFavorited(ch.channel);
      return `
        <tr data-ch="${ch.channel}">
          <td><button class="ch-star-btn ${starred ? 'starred' : ''}" data-ch="${ch.channel}" title="${starred ? 'Remove from' : 'Add to'} favorites">${starred ? '★' : '☆'}</button></td>
          <td class="ch-num">
            ${ch.channel}
            <span class="ch-bank-badge">B${bank}</span>
          </td>
          <td class="ch-name">${nameHl || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td class="ch-freq">${freqHl}</td>
          <td>${modHl || '—'}</td>
          <td>${ch.ctcss_dcs && ch.ctcss_dcs !== '0' ? escHtml(ch.ctcss_dcs) : '—'}</td>
          <td>${ch.delay ?? '2'}s</td>
          <td><span class="ch-badge ${ch.locked_out ? 'on' : ''}">${ch.locked_out ? 'YES' : 'no'}</span></td>
          <td><span class="ch-badge ${ch.priority ? 'on' : ''}">${ch.priority ? 'YES' : 'no'}</span></td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="ch-action-btn jump" data-ch="${ch.channel}">Jump</button>
              <button class="ch-action-btn edit" data-ch="${ch.channel}">Edit</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    // Wire star buttons
    tbody.querySelectorAll('.ch-star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ch = results.find(c => c.channel === parseInt(btn.dataset.ch));
        if (ch && window.Favorites) window.Favorites.toggle(ch);
      });
    });

    // Wire jump and edit buttons on search results
    tbody.querySelectorAll('.jump').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ch  = parseInt(btn.dataset.ch);
        const res = await apiFetch(`/api/channel/${ch}`, 'POST');
        if (window.logEntry) {
          logEntry(
            res.success ? `Jumped to CH ${ch}` : `Jump failed — ${res.message}`,
            res.success ? 'ok' : 'err'
          );
        }
      });
    });

    tbody.querySelectorAll('.edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const ch = allChannels.find(c => c.channel === parseInt(btn.dataset.ch));
        if (ch) openEditModal(ch);
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    const input = inputEl();
    const clear = clearBtn();
    if (!input) return;

    // Debounced input handler
    input.addEventListener('input', () => {
      const val = input.value;
      clear?.classList.toggle('visible', val.length > 0);

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runSearch(val), 200);
    });

    // Clear button
    clear?.addEventListener('click', () => {
      input.value = '';
      clear.classList.remove('visible');
      runSearch('');
      input.focus();
    });

    // Escape key clears search
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        input.value = '';
        clear?.classList.remove('visible');
        runSearch('');
        input.blur();
      }
    });
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    init,
    mergeBank,
    loadAllBanks,
    updateStatus,
    get isSearching() { return searchActive && (inputEl()?.value || '').trim().length > 0; },
    get fullyLoaded()  { return loadedBanks.size >= totalBanks; },
    getAllChannels()   { return allChannels; },
    updateChannelInCache(updated) {
      const idx = allChannels.findIndex(c => c.channel === updated.channel);
      if (idx !== -1) allChannels[idx] = { ...allChannels[idx], ...updated };
    },
  };

})();

window.ChSearch = Search;

/* BC125AT — channels.js  Phase 6 channel manager */

const chState = {
  currentBank:    1,
  channels:       [],
  editingChannel: null,
};

const chEls = {
  tbody:      document.getElementById('ch-tbody'),
  rangeLabel: document.getElementById('ch-range-label'),
  loadBtn:    document.getElementById('ch-load-btn'),
  modal:      document.getElementById('ch-modal'),
  modalTitle: document.getElementById('modal-title'),
  modalClose: document.getElementById('modal-close'),
  modalSave:  document.getElementById('modal-save'),
  modalCancel:document.getElementById('modal-cancel'),
  editName:   document.getElementById('edit-name'),
  editFreq:   document.getElementById('edit-freq'),
  editMod:    document.getElementById('edit-mod'),
  editCtcss:  document.getElementById('edit-ctcss'),
  editDelay:  document.getElementById('edit-delay'),
  editLockout:document.getElementById('edit-lockout'),
  editPriority:document.getElementById('edit-priority'),
};

/* ── Bank selection ── */
document.querySelectorAll('.bank-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bank-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chState.currentBank = parseInt(btn.dataset.bank);
    const start = (chState.currentBank - 1) * 50 + 1;
    const end   = chState.currentBank * 50;
    if (chEls.rangeLabel) chEls.rangeLabel.textContent = `CH ${start}–${end}`;

    // Clear search when switching banks
    const searchInput = document.getElementById('ch-search-input');
    const searchClear = document.getElementById('ch-search-clear');
    if (searchInput && searchInput.value) {
      searchInput.value = '';
      searchClear?.classList.remove('visible');
      if (window.ChSearch) ChSearch.updateStatus('');
    }
  });
});

/* ── Load bank ── */
async function loadBank(bank) {
  bank = bank || chState.currentBank;
  chState.currentBank = bank;

  // Highlight active bank button
  document.querySelectorAll('.bank-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.bank) === bank);
  });

  const start = (bank - 1) * 50 + 1;
  const end   = bank * 50;
  if (chEls.rangeLabel) chEls.rangeLabel.textContent = `CH ${start}–${end}`;

  if (chEls.tbody) {
    chEls.tbody.innerHTML = `
      <tr><td colspan="10" class="ch-loading">
        <div class="ch-progress-wrap">
          <div class="ch-progress-bar" id="ch-progress-bar"></div>
        </div>
        Loading channels ${(bank-1)*50+1}–${bank*50}…
        <span class="ch-progress-pct" id="ch-progress-pct">0%</span>
      </td></tr>`;
  }

  // Animate progress bar while waiting (we can't stream so simulate progress)
  let pct = 0;
  const progressInterval = setInterval(() => {
    pct = Math.min(pct + 2, 90);   // advance to 90%, hold until real response
    const bar = document.getElementById('ch-progress-bar');
    const lbl = document.getElementById('ch-progress-pct');
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = pct + '%';
  }, 100);

  const res = await apiFetch(`/api/channels?bank=${bank}`);
  clearInterval(progressInterval);

  // Complete the bar
  const bar = document.getElementById('ch-progress-bar');
  const lbl = document.getElementById('ch-progress-pct');
  if (bar) bar.style.width = '100%';
  if (lbl) lbl.textContent = '100%';

  if (!res.success) {
    if (chEls.tbody) {
      chEls.tbody.innerHTML = `<tr><td colspan="10" class="ch-empty">Failed to load — ${res.message}</td></tr>`;
    }
    return;
  }

  chState.channels = res.data.channels;
  renderChannels(chState.channels);

  // Merge loaded bank into search cache
  if (window.ChSearch) {
    ChSearch.mergeBank(bank, chState.channels);
    // Start background loading of all other banks (no-op if already running)
    ChSearch.loadAllBanks(bank);
  }

  // Update lockout count badge as more banks load
  if (window.Lockouts) Lockouts.updateCount();

  // Re-run discovery tagging now that more channel data is available
  if (window.Discovery && window.History) {
    const pane = document.getElementById('tab-history');
    if (pane && pane.classList.contains('active')) History.render();
    else Discovery.updateBadge(History.entries || []);
  }
}

/* ── Render table ── */
function renderChannels(channels) {
  if (!chEls.tbody) return;

  if (!channels.length) {
    chEls.tbody.innerHTML = '<tr><td colspan="10" class="ch-empty">No channels found</td></tr>';
    return;
  }

  chEls.tbody.innerHTML = channels.map(ch => {
    const starred = window.Favorites && window.Favorites.isFavorited(ch.channel);
    return `
    <tr data-ch="${ch.channel}">
      <td><button class="ch-star-btn ${starred ? 'starred' : ''}" data-ch="${ch.channel}" title="${starred ? 'Remove from' : 'Add to'} favorites">${starred ? '★' : '☆'}</button></td>
      <td class="ch-num">${ch.channel}</td>
      <td class="ch-name">${ch.name || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="ch-freq">${ch.frequency_mhz > 0 ? ch.frequency_mhz.toFixed(4) + ' MHz' : '—'}</td>
      <td>${ch.modulation || '—'}</td>
      <td>${ch.ctcss_dcs && ch.ctcss_dcs !== '0' ? ch.ctcss_dcs : '—'}</td>
      <td>${ch.delay ?? '2'}s</td>
      <td><span class="ch-badge ${ch.locked_out ? 'on' : ''}">${ch.locked_out ? 'YES' : 'no'}</span></td>
      <td><span class="ch-badge ${ch.priority ? 'on' : ''}">${ch.priority ? 'YES' : 'no'}</span></td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="ch-action-btn jump" data-ch="${ch.channel}">Jump</button>
          <button class="ch-action-btn edit" data-ch="${ch.channel}">Edit</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');

  // Wire star buttons
  chEls.tbody.querySelectorAll('.ch-star-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ch = channels.find(c => c.channel === parseInt(btn.dataset.ch));
      if (ch && window.Favorites) window.Favorites.toggle(ch);
    });
  });

  // Wire jump buttons
  chEls.tbody.querySelectorAll('.jump').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ch  = parseInt(btn.dataset.ch);
      const res = await apiFetch(`/api/channel/${ch}`, 'POST');
      if (window.logEntry) {
        logEntry(
          res.success ? `Jumped to CH ${ch}` : `Jump failed — ${res.message}`,
          res.success ? 'ok' : 'err'
        );
      }
    });
  });

  // Wire edit buttons
  chEls.tbody.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const ch = chState.channels.find(c => c.channel === parseInt(btn.dataset.ch));
      if (ch) openEditModal(ch);
    });
  });
}

/* ── Edit modal ── */
function openEditModal(ch) {
  chState.editingChannel = ch;
  if (chEls.modalTitle) chEls.modalTitle.textContent = `Edit Channel ${ch.channel}`;
  if (chEls.editName)    chEls.editName.value    = ch.name || '';
  if (chEls.editFreq)    chEls.editFreq.value    = ch.frequency_mhz > 0 ? ch.frequency_mhz : '';
  if (chEls.editMod)     chEls.editMod.value     = ch.modulation || 'FM';
  if (chEls.editCtcss)   chEls.editCtcss.value   = ch.ctcss_dcs || '0';
  if (chEls.editDelay)   chEls.editDelay.value   = ch.delay || '2';
  if (chEls.editLockout) chEls.editLockout.checked = ch.locked_out;
  if (chEls.editPriority)chEls.editPriority.checked = ch.priority;
  if (chEls.modal)       chEls.modal.style.display = 'flex';
}

function closeModal() {
  if (chEls.modal) chEls.modal.style.display = 'none';
  chState.editingChannel = null;
}

if (chEls.modalClose)  chEls.modalClose.addEventListener('click',  closeModal);
if (chEls.modalCancel) chEls.modalCancel.addEventListener('click', closeModal);
if (chEls.modal) {
  chEls.modal.addEventListener('click', e => {
    if (e.target === chEls.modal) closeModal();
  });
}

if (chEls.modalSave) {
  chEls.modalSave.addEventListener('click', async () => {
    const ch = chState.editingChannel;
    if (!ch) return;

    const freqMhz = parseFloat(chEls.editFreq.value);
    const freqHz  = freqMhz > 0 ? Math.round(freqMhz * 1_000_000) : 0;

    chEls.modalSave.disabled   = true;
    chEls.modalSave.textContent = 'Saving…';

    const res = await apiFetch(`/api/channel/${ch.channel}`, 'PUT', {
      name:        chEls.editName.value.trim(),
      frequency_hz:freqHz,
      modulation:  chEls.editMod.value,
      ctcss_dcs:   chEls.editCtcss.value || '0',
      delay:       chEls.editDelay.value,
      locked_out:  chEls.editLockout.checked,
      priority:    chEls.editPriority.checked,
    });

    chEls.modalSave.disabled    = false;
    chEls.modalSave.textContent = 'Save Channel';

    if (res.success) {
      closeModal();
      if (window.logEntry) logEntry(`Channel ${ch.channel} saved`, 'ok');
      loadBank(chState.currentBank);  // reload to show updated data
    } else {
      if (window.logEntry) logEntry(`Save failed — ${res.message}`, 'err');
    }
  });
}

/* ── Load bank button ── */
if (chEls.loadBtn) {
  chEls.loadBtn.addEventListener('click', () => loadBank(chState.currentBank));
}

/* Expose for tabs.js */
window.loadBank = loadBank;

/* Initialise search on first call */
document.addEventListener('DOMContentLoaded', () => {
  if (window.ChSearch) ChSearch.init();
});


/* ════════════════════════════════════════
   CSV / SS Progress Bar
   ════════════════════════════════════════ */

function showCsvProgress(label, pct) {
  let bar = document.getElementById('csv-progress-container');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'csv-progress-container';
    bar.className = 'csv-progress-container';
    bar.innerHTML = `
      <div class="csv-progress-label" id="csv-progress-label"></div>
      <div class="csv-progress-wrap">
        <div class="ch-progress-bar" id="csv-progress-bar"></div>
      </div>
      <div class="ch-progress-pct" id="csv-progress-pct"></div>
    `;
    // Insert below the toolbar
    const toolbar = document.querySelector('.ch-toolbar');
    if (toolbar) toolbar.after(bar);
  }
  bar.style.display = 'flex';
  setCsvProgress(pct, label);
}

function setCsvProgress(pct, label) {
  const bar  = document.getElementById('csv-progress-bar');
  const pctEl = document.getElementById('csv-progress-pct');
  const lblEl = document.getElementById('csv-progress-label');
  if (bar)   bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  if (lblEl && label) lblEl.textContent = label;
}

function hideCsvProgress() {
  const bar = document.getElementById('csv-progress-container');
  if (bar) bar.style.display = 'none';
}

function startFakeProgress(targetPct, intervalMs) {
  let pct = 0;
  return setInterval(() => {
    pct = Math.min(pct + 1.5, targetPct);
    setCsvProgress(pct);
  }, intervalMs);
}

/* ════════════════════════════════════════
   CSV Export / Import
   ════════════════════════════════════════ */

const exportBtn  = document.getElementById('ch-export-btn');
const importInput = document.getElementById('ch-import-input');

/* ── Export ── */
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled    = true;
    exportBtn.textContent = '↓ Exporting…';
    showCsvProgress('Exporting 500 channels…', 0);
    if (window.logEntry) logEntry('Exporting all 500 channels — please wait…', 'info');

    // Animate progress while waiting (export is one blocking call)
    const progInterval = startFakeProgress(90, 600);

    try {
      const res = await fetch('/api/channels/export');
      clearInterval(progInterval);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (window.logEntry) logEntry(`Export failed — ${data.message || res.statusText}`, 'err');
        hideCsvProgress();
        return;
      }

      setCsvProgress(100, 'Download ready');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'bc125at_channels.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (window.logEntry) logEntry('Export complete — bc125at_channels.csv downloaded', 'ok');

    } catch (e) {
      clearInterval(progInterval);
      if (window.logEntry) logEntry(`Export error — ${e.message}`, 'err');
    } finally {
      setTimeout(hideCsvProgress, 1500);
      exportBtn.disabled    = false;
      exportBtn.textContent = '↓ Export';
    }
  });
}

/* ── Import ── */
if (importInput) {
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    importInput.value = '';

    if (!file.name.toLowerCase().endsWith('.csv')) {
      if (window.logEntry) logEntry('Import failed — file must be a .csv', 'err');
      return;
    }

    const confirmed = confirm(
      `Import "${file.name}"?\n\n` +
      `This will overwrite channels on the scanner with the data from the CSV.\n` +
      `Make sure you have a backup export before proceeding.`
    );
    if (!confirmed) return;

    const label = document.querySelector('.ch-import-label');
    if (label) label.textContent = '↑ Importing…';
    showCsvProgress('Importing channels…', 0);
    if (window.logEntry) logEntry(`Importing ${file.name}…`, 'info');

    const progInterval = startFakeProgress(90, 500);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res  = await fetch('/api/channels/import', { method: 'POST', body: formData });
      const data = await res.json();
      clearInterval(progInterval);

      if (data.success) {
        const { written, skipped, errors } = data.data;
        setCsvProgress(100, `${written} written`);
        if (window.logEntry) {
          logEntry(`Import complete — ${written} written, ${skipped} skipped`, 'ok');
          if (errors && errors.length) {
            errors.slice(0, 5).forEach(e => logEntry(`  ${e}`, 'err'));
            if (errors.length > 5) logEntry(`  …and ${errors.length - 5} more errors`, 'err');
          }
        }
        loadBank(chState.currentBank);
      } else {
        if (window.logEntry) logEntry(`Import failed — ${data.message}`, 'err');
        if (data.details && window.logEntry) logEntry(`  ${data.details}`, 'err');
      }
    } catch (e) {
      clearInterval(progInterval);
      if (window.logEntry) logEntry(`Import error — ${e.message}`, 'err');
    } finally {
      setTimeout(hideCsvProgress, 1500);
      if (label) label.textContent = '↑ Import';
    }
  });
}


/* ── .bc125at_ss Export ── */
const exportSsBtn = document.getElementById('ch-export-ss-btn');
if (exportSsBtn) {
  exportSsBtn.addEventListener('click', async () => {
    exportSsBtn.disabled    = true;
    exportSsBtn.textContent = '↓ Exporting…';
    showCsvProgress('Exporting 500 channels as .bc125at_ss…', 0);
    if (window.logEntry) logEntry('Exporting as .bc125at_ss — please wait…', 'info');

    const progInterval = startFakeProgress(90, 600);

    try {
      const res = await fetch('/api/channels/export/ss');
      clearInterval(progInterval);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (window.logEntry) logEntry(`Export failed — ${data.message || res.statusText}`, 'err');
        hideCsvProgress();
        return;
      }
      setCsvProgress(100, 'Download ready');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'bc125at_channels.bc125at_ss';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (window.logEntry) logEntry('Export complete — bc125at_channels.bc125at_ss downloaded', 'ok');
    } catch (e) {
      clearInterval(progInterval);
      if (window.logEntry) logEntry(`Export error — ${e.message}`, 'err');
    } finally {
      setTimeout(hideCsvProgress, 1500);
      exportSsBtn.disabled    = false;
      exportSsBtn.textContent = '↓ Export';
    }
  });
}

/* ── .bc125at_ss Import ── */
const importSsInput = document.getElementById('ch-import-ss-input');
if (importSsInput) {
  importSsInput.addEventListener('change', async () => {
    const file = importSsInput.files[0];
    if (!file) return;
    importSsInput.value = '';

    const confirmed = confirm(
      `Import "${file.name}"?\n\n` +
      `This will overwrite channels on the scanner with data from the .bc125at_ss file.\n` +
      `Make sure you have a backup before proceeding.`
    );
    if (!confirmed) return;

    const ssLabel = document.querySelectorAll('.ch-format-group')[1]?.querySelector('.ch-import-label');
    if (ssLabel) ssLabel.textContent = '↑ Importing…';
    showCsvProgress('Importing .bc125at_ss channels…', 0);
    if (window.logEntry) logEntry(`Importing ${file.name}…`, 'info');

    const progInterval = startFakeProgress(90, 500);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res  = await fetch('/api/channels/import/ss', { method: 'POST', body: formData });
      const data = await res.json();
      clearInterval(progInterval);

      if (data.success) {
        const { written, skipped, errors } = data.data;
        setCsvProgress(100, `${written} written`);
        if (window.logEntry) {
          logEntry(`Import complete — ${written} written, ${skipped} skipped`, 'ok');
          if (errors && errors.length) {
            errors.slice(0, 5).forEach(e => logEntry(`  ${e}`, 'err'));
            if (errors.length > 5) logEntry(`  …and ${errors.length - 5} more errors`, 'err');
          }
        }
        loadBank(chState.currentBank);
      } else {
        if (window.logEntry) logEntry(`Import failed — ${data.message}`, 'err');
      }
    } catch (e) {
      clearInterval(progInterval);
      if (window.logEntry) logEntry(`Import error — ${e.message}`, 'err');
    } finally {
      setTimeout(hideCsvProgress, 1500);
      if (ssLabel) ssLabel.textContent = '↑ Import';
    }
  });
}


/* ════════════════════════════════════════════════════════
   Lockout Manager
   ════════════════════════════════════════════════════════

   Reuses the ChSearch background loader's allChannels cache.
   Toggling "Lockouts" filters the table to show only channels
   with locked_out=true across all 500, regardless of which
   bank is currently loaded.
*/

const Lockouts = (() => {

  let active = false;

  function getLockedChannels() {
    // Access the shared cache from ChSearch via its internal state
    // We re-read it through a small accessor since allChannels is
    // private inside the ChSearch IIFE
    return (window.ChSearch && window.ChSearch.getAllChannels)
      ? window.ChSearch.getAllChannels().filter(c => c.locked_out)
      : [];
  }

  function updateCount() {
    const countEl = document.getElementById('ch-lockout-count');
    if (!countEl) return;
    const locked = getLockedChannels();
    countEl.textContent = locked.length > 0 ? locked.length : '';
  }

  function render() {
    const tbody = document.getElementById('ch-tbody');
    if (!tbody) return;

    const locked = getLockedChannels();
    updateCount();

    if (locked.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="ch-search-empty">
        No locked-out channels${
          window.ChSearch && !window.ChSearch.fullyLoaded
            ? '<br><small>Still loading all banks — more may appear</small>'
            : ''
        }
      </td></tr>`;
      return;
    }

    tbody.innerHTML = locked.map(ch => {
      const bank    = Math.ceil(ch.channel / 50);
      const freqStr = ch.frequency_mhz > 0 ? ch.frequency_mhz.toFixed(4) + ' MHz' : '—';
      const starred = window.Favorites && window.Favorites.isFavorited(ch.channel);

      return `
        <tr data-ch="${ch.channel}">
          <td><button class="ch-star-btn ${starred ? 'starred' : ''}" data-ch="${ch.channel}" title="${starred ? 'Remove from' : 'Add to'} favorites">${starred ? '★' : '☆'}</button></td>
          <td class="ch-num">
            ${ch.channel}
            <span class="ch-bank-badge">B${bank}</span>
          </td>
          <td class="ch-name">${ch.name || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td class="ch-freq">${freqStr}</td>
          <td>${ch.modulation || '—'}</td>
          <td>${ch.ctcss_dcs && ch.ctcss_dcs !== '0' ? ch.ctcss_dcs : '—'}</td>
          <td>${ch.delay ?? '2'}s</td>
          <td><span class="ch-badge on">YES</span></td>
          <td><span class="ch-badge ${ch.priority ? 'on' : ''}">${ch.priority ? 'YES' : 'no'}</span></td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="ch-action-btn unlock" data-ch="${ch.channel}">Unlock</button>
              <button class="ch-action-btn edit" data-ch="${ch.channel}">Edit</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    // Wire star buttons
    tbody.querySelectorAll('.ch-star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ch = getLockedChannels().find(c => c.channel === parseInt(btn.dataset.ch));
        if (ch && window.Favorites) window.Favorites.toggle(ch);
      });
    });

    // Wire unlock buttons
    tbody.querySelectorAll('.unlock').forEach(btn => {
      btn.addEventListener('click', () => unlockChannel(parseInt(btn.dataset.ch)));
    });

    // Wire edit buttons
    tbody.querySelectorAll('.edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const ch = getLockedChannels().find(c => c.channel === parseInt(btn.dataset.ch));
        if (ch) openEditModal(ch);
      });
    });
  }

  async function unlockChannel(chNum) {
    const ch = getLockedChannels().find(c => c.channel === chNum);
    if (!ch) return;

    const res = await apiFetch(`/api/channel/${chNum}`, 'PUT', {
      name:         ch.name,
      frequency_hz: ch.frequency_hz,
      modulation:   ch.modulation,
      ctcss_dcs:    ch.ctcss_dcs,
      delay:        ch.delay,
      locked_out:   false,
      priority:     ch.priority,
    });

    if (res.success) {
      if (window.logEntry) logEntry(`Channel ${chNum} unlocked`, 'ok');
      // Update cache
      ch.locked_out = false;
      if (window.ChSearch) window.ChSearch.updateChannelInCache(ch);
      render();
    } else {
      if (window.logEntry) logEntry(`Unlock failed — ${res.message}`, 'err');
    }
  }

  async function unlockAll() {
    const locked = getLockedChannels();
    if (locked.length === 0) return;

    const confirmed = confirm(
      `Unlock all ${locked.length} locked-out channels?\n\n` +
      `This will write to the scanner and may take a moment.`
    );
    if (!confirmed) return;

    const btn = document.getElementById('ch-unlock-all');
    if (btn) { btn.disabled = true; btn.textContent = 'Unlocking…'; }
    if (window.logEntry) logEntry(`Unlocking ${locked.length} channels…`, 'info');

    const payload = locked.map(ch => ({
      channel:    ch.channel,
      name:       ch.name,
      freq_hz:    ch.frequency_hz,
      modulation: ch.modulation,
      ctcss_dcs:  ch.ctcss_dcs,
      delay:      ch.delay,
      locked_out: false,
      priority:   ch.priority,
    }));

    // Use channel import endpoint's bulk write via CSV-style payload
    // Reuse set_channels_bulk through a lightweight bulk-unlock endpoint
    try {
      const res = await fetch('/api/channels/bulk-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: locked.map(c => c.channel) }),
      });
      const data = await res.json();

      if (data.success) {
        locked.forEach(ch => {
          ch.locked_out = false;
          if (window.ChSearch) window.ChSearch.updateChannelInCache(ch);
        });
        if (window.logEntry) logEntry(`Unlocked ${data.data.written} channels`, 'ok');
        render();
      } else {
        if (window.logEntry) logEntry(`Bulk unlock failed — ${data.message}`, 'err');
      }
    } catch (e) {
      if (window.logEntry) logEntry(`Bulk unlock error — ${e.message}`, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock All'; }
    }
  }

  function toggle() {
    active = !active;
    const btn = document.getElementById('ch-lockout-toggle');
    if (btn) btn.classList.toggle('active', active);

    if (active) {
      // Clear search if active
      const searchInput = document.getElementById('ch-search-input');
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        document.getElementById('ch-search-clear')?.classList.remove('visible');
      }
      // Deselect bank buttons
      document.querySelectorAll('.bank-btn').forEach(b => b.classList.remove('active'));
      render();
      showUnlockAllButton();
    } else {
      hideUnlockAllButton();
      // Restore normal bank view
      if (chState.channels.length) {
        renderChannels(chState.channels);
        document.querySelector(`.bank-btn[data-bank="${chState.currentBank}"]`)?.classList.add('active');
      }
    }
  }

  function showUnlockAllButton() {
    if (document.getElementById('ch-unlock-all')) return;
    const toolbar = document.querySelector('.ch-toolbar-right');
    if (!toolbar) return;
    const btn = document.createElement('button');
    btn.id        = 'ch-unlock-all';
    btn.className = 'key key--nav';
    btn.textContent = 'Unlock All';
    btn.addEventListener('click', unlockAll);
    toolbar.appendChild(btn);
  }

  function hideUnlockAllButton() {
    document.getElementById('ch-unlock-all')?.remove();
  }

  function init() {
    const btn = document.getElementById('ch-lockout-toggle');
    if (btn) btn.addEventListener('click', toggle);
  }

  return { init, render, updateCount, get isActive() { return active; } };

})();

window.Lockouts = Lockouts;

document.addEventListener('DOMContentLoaded', () => {
  if (window.Lockouts) Lockouts.init();
});
