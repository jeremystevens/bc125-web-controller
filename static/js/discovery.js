/* BC125AT Web Controller — discovery.js
   Discovery Inbox — unknown frequencies found in Search mode.

   The server groups search hits (no channel number or name) by frequency and
   compares them with its cached channel list (GET /api/discoveries).
   Each frequency gets one of:
     new      — not decided yet
     watch    — pinned to the top; notifies when heard again
     ignored  — hidden from the inbox
     blocked  — added to the Smart Resume blocklist
     added    — programmed into a channel

   "Program" writes the frequency into an empty channel slot. The server
   re-reads the slot first and refuses to overwrite a programmed channel
   unless the user confirms.

   Mutating actions need admin — buttons carry .disc-action-btn so
   auth.js locks them for guests.
*/

const Discovery = (() => {

  const MATCH_MHZ        = 0.005;     // ±5 kHz
  const REFRESH_MS       = 30_000;    // background refresh while the app is open
  const WATCH_COOLDOWN_MS = 60_000;   // one alert per watched frequency per minute
  const MODULATIONS      = ['AM', 'FM', 'NFM', 'WFM', 'FMB'];
  const DELAYS           = ['-10', '-5', '0', '1', '2', '3', '4', '5'];

  const FILTERS = {
    inbox: { label: 'Inbox',      match: s => s === 'new' || s === 'watch' },
    watch: { label: 'Watching',   match: s => s === 'watch' },
    added: { label: 'Programmed', match: s => s === 'added' },
    blocked: { label: 'Blocked',  match: s => s === 'blocked' },
    ignored: { label: 'Ignored',  match: s => s === 'ignored' },
    all:   { label: 'All',        match: () => true },
  };

  let data        = { items: [], counts: {}, channel_cache: {}, empty_slots: [] };
  let filter      = 'inbox';
  let filterText  = '';
  let lastRefresh = 0;
  let loading     = null;
  let lastFreq    = 0;
  const lastAlert = {};               // frequency → epoch ms of last watch alert
  let programming = null;             // item being programmed in the modal

  const $ = id => document.getElementById(id);

  /* ── Data ──────────────────────────────────────────────────────── */

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const res = await apiFetch('/api/discoveries');
        if (res.success) data = res.data;
      } catch (_) {}
      lastRefresh = Date.now();
      loading = null;
      updateBadge();
      renderIfVisible();
    })();
    return loading;
  }

  /* After a change: a load already in flight may predate it, so wait
     for that one to finish and then fetch again. */
  async function reload() {
    if (loading) await loading;
    return load();
  }

  async function setStatus(item, status) {
    const res = await apiFetch('/api/discoveries/status', 'POST',
      { frequency_mhz: item.frequency, status });
    if (!res.success) {
      if (window.logEntry && !res.auth_required) logEntry(`Discovery update failed — ${res.message}`, 'err');
      return false;
    }
    await reload();
    return true;
  }

  /* ── Helpers ───────────────────────────────────────────────────── */

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDuration(s) {
    s = Number(s) || 0;
    if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function fmtAgo(ts) {
    if (!ts) return '—';
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return `${Math.floor(diff / 86400)} d ago`;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function findItem(freq) {
    return data.items.find(i => Math.abs(i.frequency - freq) <= MATCH_MHZ);
  }

  function visibleItems() {
    const f = FILTERS[filter] || FILTERS.inbox;
    let rows = data.items.filter(i => f.match(i.status));
    if (filterText) {
      const q = filterText.toLowerCase();
      rows = rows.filter(i =>
        i.frequency.toFixed(4).includes(q) ||
        (i.modulation || '').toLowerCase().includes(q) ||
        (i.programmed_name || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }

  /* ── Badge + filter chips ──────────────────────────────────────── */

  function updateBadge() {
    const badge = $('disc-badge');
    if (badge) badge.textContent = data.counts?.new || '';
  }

  function renderFilters() {
    const wrap = $('disc-filters');
    if (!wrap) return;
    const counts = data.counts || {};
    const countFor = key => key === 'inbox' ? (counts.new || 0) + (counts.watch || 0)
                          : key === 'all'   ? data.items.length
                          : counts[key] || 0;
    wrap.innerHTML = Object.entries(FILTERS).map(([key, f]) => `
      <button class="disc-chip ${key === filter ? 'active' : ''}" data-filter="${key}">
        ${f.label} <span class="disc-chip-count">${countFor(key)}</span>
      </button>`).join('');
  }

  function renderCacheNote() {
    const note = $('disc-cache-note');
    if (!note) return;
    const cache = data.channel_cache || {};
    if (cache.complete) {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    $('disc-cache-text').textContent = cache.cached
      ? `Only ${cache.cached} of 500 channels are known. Some of these may already be programmed, and empty-slot suggestions are incomplete.`
      : 'The channel list hasn\'t been loaded yet, so these can\'t be checked against your programmed channels and no empty slots can be suggested.';
  }

  /* ── Table ─────────────────────────────────────────────────────── */

  function statusBadge(item) {
    switch (item.status) {
      case 'watch':   return '<span class="disc-status disc-status--watch">★ Watching</span>';
      case 'ignored': return '<span class="disc-status disc-status--muted">Ignored</span>';
      case 'blocked': return '<span class="disc-status disc-status--blocked">⊘ Blocked</span>';
      case 'added':   return `<span class="disc-status disc-status--added">CH ${item.programmed_channel ?? '?'}</span>`;
      default:        return '<span class="disc-status disc-status--new">● New</span>';
    }
  }

  function actionButtons(item) {
    const f = item.frequency;
    const btn = (action, label, title, extra = '') =>
      `<button class="ch-action-btn disc-action-btn ${extra}" data-action="${action}" data-freq="${f}" title="${title}">${label}</button>`;

    switch (item.status) {
      case 'added':
        return item.programmed_channel
          ? `<button class="ch-action-btn disc-jump-btn" data-ch="${item.programmed_channel}" title="Jump to this channel">Jump</button>`
          : '';
      case 'ignored':
        return btn('new', 'Restore', 'Move back to the inbox');
      case 'blocked':
        return btn('program', 'Program', 'Program into a channel', 'disc-primary') +
               btn('unblock', 'Unblock', 'Remove from the Smart Resume blocklist');
      default:
        return btn('program', 'Program', 'Program into a channel', 'disc-primary') +
               (item.status === 'watch'
                 ? btn('new', 'Unwatch', 'Stop watching')
                 : btn('watch', 'Watch', 'Pin to the top and notify when heard again')) +
               btn('block', 'Block', 'Add to the Smart Resume blocklist') +
               btn('ignored', 'Ignore', 'Hide from the inbox');
    }
  }

  function render() {
    renderFilters();
    renderCacheNote();

    const tbody = $('disc-tbody');
    if (!tbody) return;
    const rows = visibleItems();

    const countEl = $('disc-count');
    if (countEl) countEl.textContent = `${rows.length} frequenc${rows.length === 1 ? 'y' : 'ies'}`;

    if (!rows.length) {
      const msg = data.items.length === 0
        ? 'No search hits yet — press Search on the scanner (or <kbd>R</kbd>) to sweep your custom search ranges'
        : filterText ? 'No frequencies match your filter'
        : filter === 'inbox' ? 'Inbox clear — nothing new to review'
        : `Nothing in ${FILTERS[filter].label}`;
      tbody.innerHTML = `<tr><td colspan="8" class="ch-empty">${msg}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(i => {
      const since = i.status === 'watch' && i.hits_since_status > 0
        ? `<span class="disc-since" title="Hits since you started watching">+${i.hits_since_status}</span>` : '';
      const rec = i.recording_url
        ? `<a class="hist-play-btn" href="${escHtml(i.recording_url)}" target="_blank" title="Play latest recording">🔊</a>` : '';
      return `<tr class="disc-row disc-row--${i.status}">
        <td class="hist-freq disc-freq">${i.frequency.toFixed(4)} MHz</td>
        <td class="disc-hits">${i.hits}${since}</td>
        <td><span class="hist-timestr">${fmtDate(i.first_heard)}</span></td>
        <td><div class="hist-time">
          <span class="hist-timestr">${fmtAgo(i.last_heard)}</span>
          <span class="hist-date">${fmtDate(i.last_heard)}</span>
        </div></td>
        <td>${escHtml(i.modulation || '—')}</td>
        <td class="hist-dur" title="Longest: ${fmtDuration(i.longest_s)}">${fmtDuration(i.total_duration_s)}</td>
        <td>${statusBadge(i)}</td>
        <td><div class="disc-actions">${rec}${actionButtons(i)}</div></td>
      </tr>`;
    }).join('');
  }

  function renderIfVisible() {
    const pane = $('tab-discoveries');
    if (pane && pane.classList.contains('active')) render();
  }

  /* ── Row actions ───────────────────────────────────────────────── */

  async function onAction(action, item) {
    const label = `${item.frequency.toFixed(4)} MHz`;
    switch (action) {
      case 'program':
        openProgramModal(item);
        return;
      case 'watch':
        if (await setStatus(item, 'watch') && window.logEntry) logEntry(`Watching ${label}`, 'ok');
        return;
      case 'ignored':
        if (await setStatus(item, 'ignored') && window.logEntry) logEntry(`Ignored ${label}`, 'info');
        return;
      case 'new':
        await setStatus(item, 'new');
        return;
      case 'block':
        if (await setStatus(item, 'blocked') && window.SmartResume && !SmartResume.isBlocked(item.frequency)) {
          SmartResume.blockFreq(item.frequency, 'Discovery');
        }
        return;
      case 'unblock':
        if (await setStatus(item, 'new') && window.SmartResume && SmartResume.isBlocked(item.frequency)) {
          SmartResume.unblockFreq(item.frequency);
        }
        return;
    }
  }

  /* ── Program modal ─────────────────────────────────────────────── */

  function emptySlotsInBank(bank) {
    const slots = data.empty_slots || [];
    if (!bank) return slots;
    const lo = (bank - 1) * 50 + 1, hi = bank * 50;
    return slots.filter(n => n >= lo && n <= hi);
  }

  function fillSlotSelect() {
    const bank    = parseInt($('disc-bank').value) || 0;
    const slots   = emptySlotsInBank(bank);
    const select  = $('disc-slot');
    const manual  = $('disc-slot-manual');
    if (slots.length) {
      select.innerHTML = slots.map((n, idx) =>
        `<option value="${n}">CH ${n}${idx === 0 ? ' — suggested' : ''}</option>`).join('');
      select.hidden = false;
      manual.hidden = true;
    } else {
      select.hidden = true;
      manual.hidden = false;
    }
    const hint = $('disc-slot-hint');
    if (hint) {
      const cache = data.channel_cache || {};
      hint.textContent = !cache.cached
        ? 'No channel list loaded — enter a channel number. An occupied channel is never overwritten without asking.'
        : !slots.length
        ? `No known empty slots${bank ? ` in bank ${bank}` : ''} — enter a channel number.`
        : `${slots.length} known empty slot${slots.length === 1 ? '' : 's'}${bank ? ` in bank ${bank}` : ''}.`;
    }
  }

  function openProgramModal(item) {
    programming = item;
    $('disc-modal-title').textContent = `Program ${item.frequency.toFixed(4)} MHz`;

    const counts = Array.from({ length: 10 }, (_, b) => emptySlotsInBank(b + 1).length);
    $('disc-bank').innerHTML =
      `<option value="0">Any bank (${(data.empty_slots || []).length} free)</option>` +
      counts.map((n, b) => `<option value="${b + 1}">Bank ${b + 1} (${n} free)</option>`).join('');
    $('disc-bank').value = '0';
    fillSlotSelect();

    $('disc-slot-manual').value = '';
    $('disc-name').value = '';
    $('disc-mod').innerHTML = MODULATIONS.map(m => `<option>${m}</option>`).join('');
    $('disc-mod').value = MODULATIONS.includes(item.modulation) ? item.modulation : 'FM';
    $('disc-delay').innerHTML = DELAYS.map(d => `<option value="${d}">${d}s</option>`).join('');
    $('disc-delay').value = '2';

    $('disc-modal').style.display = 'flex';
    $('disc-name').focus();
  }

  function closeProgramModal() {
    $('disc-modal').style.display = 'none';
    programming = null;
  }

  async function submitProgram(overwrite = false) {
    const item = programming;
    if (!item) return;
    const slotSel = $('disc-slot');
    const channel = parseInt(slotSel.hidden ? $('disc-slot-manual').value : slotSel.value);
    if (!(channel >= 1 && channel <= 500)) {
      $('disc-slot-hint').textContent = 'Enter a channel number from 1 to 500.';
      return;
    }

    const saveBtn = $('disc-modal-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Programming…';
    const res = await apiFetch('/api/discoveries/program', 'POST', {
      frequency_mhz: item.frequency,
      channel,
      name:       $('disc-name').value.trim(),
      modulation: $('disc-mod').value,
      delay:      $('disc-delay').value,
      overwrite,
    });
    saveBtn.disabled = false;
    saveBtn.textContent = 'Program to scanner';

    if (res.conflict) {
      if (confirm(`${res.message}\n\nOverwrite it with ${item.frequency.toFixed(4)} MHz?`)) {
        return submitProgram(true);
      }
      await reload();   // the slot list was stale — refresh suggestions
      fillSlotSelect();
      return;
    }
    if (!res.success) {
      if (window.logEntry && !res.auth_required) logEntry(`Program failed — ${res.message}`, 'err');
      return;
    }
    closeProgramModal();
    if (window.logEntry) logEntry(res.message, 'ok');
    window._chLoaded = false;   // Channels tab reloads its bank on next open
    await reload();
  }

  async function refreshChannelCache() {
    const btn = $('disc-load-channels');
    btn.disabled = true;
    btn.textContent = 'Loading 500 channels…';
    const res = await apiFetch('/api/channels/cache/refresh', 'POST');
    btn.disabled = false;
    btn.textContent = 'Load channel list';
    if (window.logEntry && !res.auth_required) {
      logEntry(res.success ? res.message : `Channel list load failed — ${res.message}`,
               res.success ? 'ok' : 'err');
    }
    await reload();
  }

  /* ── Watch alerts (driven by scanner_state pushes) ─────────────── */

  function onState(state) {
    const freq = state.frequency_mhz || 0;

    // Alert when the scanner arrives on a watched frequency
    if (freq > 0 && Math.abs(freq - lastFreq) > MATCH_MHZ) {
      const item = findItem(freq);
      const now  = Date.now();
      if (item && item.status === 'watch' && now - (lastAlert[item.frequency] || 0) > WATCH_COOLDOWN_MS) {
        lastAlert[item.frequency] = now;
        const label = `${item.frequency.toFixed(4)} MHz`;
        if (window.logEntry) logEntry(`★ Watched frequency heard — ${label}`, 'ok');
        if (window.Notifs?.notify) {
          Notifs.notify(`★ Watched — ${label}`,
            [state.modulation || item.modulation, `${item.hits} hits so far`].filter(Boolean).join('  ·  '),
            'bc125at-watch');
        }
      }
    }
    if (freq > 0) lastFreq = freq;

    if (Date.now() - lastRefresh > REFRESH_MS) load();
  }

  /* ── Init ──────────────────────────────────────────────────────── */

  function init() {
    $('disc-filters')?.addEventListener('click', e => {
      const chip = e.target.closest('.disc-chip');
      if (!chip) return;
      filter = chip.dataset.filter;
      render();
    });

    $('disc-filter-input')?.addEventListener('input', e => {
      filterText = e.target.value.trim();
      render();
    });

    $('disc-tbody')?.addEventListener('click', async e => {
      const jump = e.target.closest('.disc-jump-btn');
      if (jump) {
        const ch  = parseInt(jump.dataset.ch);
        const res = await apiFetch(`/api/channel/${ch}`, 'POST');
        if (window.logEntry) logEntry(res.success ? `Jumped to CH ${ch}` : `Jump failed — ${res.message}`,
                                      res.success ? 'ok' : 'err');
        return;
      }
      const btn = e.target.closest('.disc-action-btn');
      if (!btn) return;
      const item = findItem(parseFloat(btn.dataset.freq));
      if (item) onAction(btn.dataset.action, item);
    });

    $('disc-load-channels')?.addEventListener('click', refreshChannelCache);
    $('disc-bank')?.addEventListener('change', fillSlotSelect);
    $('disc-modal-close')?.addEventListener('click', closeProgramModal);
    $('disc-modal-cancel')?.addEventListener('click', closeProgramModal);
    $('disc-modal-save')?.addEventListener('click', () => submitProgram(false));
    $('disc-modal')?.addEventListener('click', e => {
      if (e.target.id === 'disc-modal') closeProgramModal();
    });

    load();
  }

  return {
    init,
    load,
    render,
    onState,
    refresh: reload,
  };

})();

window.Discovery = Discovery;
