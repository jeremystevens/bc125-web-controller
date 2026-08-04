/* BC125AT Web Controller — status.js
   Scanner Status Page.

   Combines:
     - Server-side facts (connection, uptime, recordings) via /api/status/full
     - Client-side stats computed from Activity History (localStorage)

   Session stats: transmissions logged since this page was loaded
   All-time stats: every entry ever recorded in History (same data source)
*/

const Status = (() => {

  let sessionStart = Date.now();
  let uptimeTimer   = null;

  /* ── Formatting helpers ──────────────────────────────────────── */

  function formatDuration(seconds) {
    if (!seconds || seconds < 1) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatBytes(mb) {
    if (mb < 1) return `${Math.round(mb * 1024)} KB`;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  /* ── Fetch server-side status ────────────────────────────────── */

  async function loadServerStatus() {
    const res = await apiFetch('/api/status/full');
    if (!res.success) return;

    const { scanner, recordings } = res.data;

    setText('stat-connection', scanner.connected ? 'Connected' : 'Disconnected');
    document.getElementById('stat-connection')?.classList.toggle('status-ok', scanner.connected);
    document.getElementById('stat-connection')?.classList.toggle('status-err', !scanner.connected);

    setText('stat-model',    scanner.model    || '—');
    setText('stat-firmware', scanner.firmware || '—');
    setText('stat-port',     `${scanner.port} @ ${scanner.baud}`);
    setText('stat-battery',  scanner.battery_volts ? scanner.battery_volts.toFixed(2) + ' V' : '—');

    if (scanner.connected && scanner.uptime_seconds != null) {
      sessionStart = Date.now() - (scanner.uptime_seconds * 1000);
      setText('stat-uptime', formatDuration(scanner.uptime_seconds));
      startUptimeTicker();
    } else {
      setText('stat-uptime', '—');
    }

    // Recordings
    setText('stat-rec-count',    recordings.count);
    setText('stat-rec-duration', formatDuration(recordings.total_seconds));
    setText('stat-rec-size',     formatBytes(recordings.total_mb));
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /* ── Live uptime ticker ──────────────────────────────────────── */

  function startUptimeTicker() {
    clearInterval(uptimeTimer);
    uptimeTimer = setInterval(() => {
      const elapsed = (Date.now() - sessionStart) / 1000;
      setText('stat-uptime', formatDuration(elapsed));
    }, 1000);
  }

  /* ── Compute stats from Activity History ────────────────────── */

  function getHistoryEntries() {
    try {
      const raw = localStorage.getItem('bc125at_history');
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function computeStats() {
    const entries = getHistoryEntries();

    // Session entries — logged since this page's session start
    const sessionEntries = entries.filter(e =>
      new Date(e.timestamp).getTime() >= sessionStart
    );

    renderSessionStats(sessionEntries);
    renderAllTimeStats(entries);
    renderBusiestChannels(entries);
  }

  function renderSessionStats(entries) {
    const heard   = entries.filter(e => !e.skipped);
    const skipped = entries.filter(e => e.skipped);

    setText('stat-session-heard',   heard.length);
    setText('stat-session-skipped', skipped.length);

    if (entries.length > 0) {
      const avgDur = entries.reduce((sum, e) => sum + (e.duration || 0), 0) / entries.length;
      setText('stat-session-avg', avgDur.toFixed(1) + 's');

      const elapsedHours = Math.max((Date.now() - sessionStart) / 3600000, 0.01);
      const rate = entries.length / elapsedHours;
      setText('stat-session-rate', rate.toFixed(1) + '/hr');
    } else {
      setText('stat-session-avg', '—');
      setText('stat-session-rate', '—');
    }
  }

  function renderAllTimeStats(entries) {
    const heard   = entries.filter(e => !e.skipped);
    const skipped = entries.filter(e => e.skipped);

    setText('stat-all-heard',   heard.length);
    setText('stat-all-skipped', skipped.length);
    setText('stat-all-total',   entries.length);

    if (entries.length > 0) {
      // Oldest entry = tracking start
      const oldest = entries.reduce((min, e) =>
        new Date(e.timestamp) < new Date(min.timestamp) ? e : min
      );
      const date = new Date(oldest.timestamp);
      setText('stat-all-since', date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }));
    } else {
      setText('stat-all-since', '—');
    }
  }

  function renderBusiestChannels(entries) {
    const container = document.getElementById('stat-busiest');
    if (!container) return;

    if (entries.length === 0) {
      container.innerHTML = '<span class="log-empty">No data yet — start scanning to populate</span>';
      return;
    }

    // Group by frequency, count occurrences and total duration
    const grouped = {};
    entries.forEach(e => {
      const key = e.frequency ? e.frequency.toFixed(4) : 'unknown';
      if (!grouped[key]) {
        grouped[key] = {
          frequency: e.frequency,
          name:      e.name,
          channel:   e.channel,
          count:     0,
          totalDur:  0,
        };
      }
      grouped[key].count++;
      grouped[key].totalDur += (e.duration || 0);
      // Keep most recent name seen for this frequency
      if (e.name) grouped[key].name = e.name;
    });

    const sorted = Object.values(grouped)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const maxCount = sorted[0]?.count || 1;

    container.innerHTML = sorted.map(item => {
      const pct = (item.count / maxCount) * 100;
      const freqStr = item.frequency ? item.frequency.toFixed(4) + ' MHz' : '—';
      return `
        <div class="busiest-row">
          <div class="busiest-info">
            <span class="busiest-freq">${freqStr}</span>
            <span class="busiest-name">${escHtml(item.name || '')}</span>
          </div>
          <div class="busiest-bar-wrap">
            <div class="busiest-bar" style="width:${pct}%"></div>
          </div>
          <span class="busiest-count">${item.count}×</span>
        </div>`;
    }).join('');
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ── Init ────────────────────────────────────────────────────── */

  function init() {
    sessionStart = Date.now();
    loadServerStatus();
    computeStats();
    // Uptime ticker starts only after loadServerStatus sets the real
    // sessionStart from connected_at — see startUptimeTicker() call inside it
  }

  function render() {
    // Called when tab becomes active — refresh everything
    loadServerStatus();
    computeStats();
    if (window.Heatmap) Heatmap.render();
  }

  return { init, render };

})();

window.Status = Status;


/* ════════════════════════════════════════════════════════
   Signal Heatmap
   ════════════════════════════════════════════════════════

   X axis: last 24 hours in 30-minute buckets (48 columns)
   Y axis: frequency bands grouped by radio service
   Color:  0 transmissions = dark background
           1+ transmissions = green gradient, brighter = more activity

   Data source: localStorage 'bc125at_history' (same as History tab)
*/

const Heatmap = (() => {

  // Frequency bands — label, low MHz, high MHz
  const BANDS = [
    { label: '25–50',    lo: 25,  hi: 50  },
    { label: '50–108',   lo: 50,  hi: 108 },
    { label: '108–137',  lo: 108, hi: 137 },
    { label: '137–174',  lo: 137, hi: 174 },
    { label: '174–225',  lo: 174, hi: 225 },
    { label: '225–400',  lo: 225, hi: 400 },
    { label: '400–450',  lo: 400, hi: 450 },
    { label: '450–512',  lo: 450, hi: 512 },
  ];

  const TIME_BUCKETS  = 48;    // 48 × 30 min = 24 hours
  const BUCKET_MIN    = 30;    // minutes per bucket

  function getEntries() {
    try {
      const raw = localStorage.getItem('bc125at_history');
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function buildGrid() {
    const entries = getEntries();
    const now     = Date.now();
    const windowMs = TIME_BUCKETS * BUCKET_MIN * 60 * 1000;

    // grid[band][time_bucket] = count
    const grid = BANDS.map(() => new Array(TIME_BUCKETS).fill(0));

    entries.forEach(e => {
      if (!e.frequency || e.frequency <= 0) return;
      const ts = new Date(e.timestamp).getTime();
      if (ts < now - windowMs) return;  // outside 24h window

      // Time bucket — 0 = oldest, TIME_BUCKETS-1 = most recent
      const elapsed_ms = now - ts;
      const bucket = TIME_BUCKETS - 1 - Math.floor(elapsed_ms / (BUCKET_MIN * 60 * 1000));
      if (bucket < 0 || bucket >= TIME_BUCKETS) return;

      // Frequency band
      const bandIdx = BANDS.findIndex(b => e.frequency >= b.lo && e.frequency < b.hi);
      if (bandIdx === -1) return;

      grid[bandIdx][bucket]++;
    });

    return grid;
  }

  function cellColor(count, maxCount) {
    if (count === 0) return 'var(--bg-control)';
    // Green gradient: low activity = dim green, high = bright green
    const intensity = Math.min(count / Math.max(maxCount, 1), 1);
    // Map 0-1 to opacity 0.15 - 1.0 of green
    const alpha = 0.15 + (intensity * 0.85);
    return `rgba(74, 222, 128, ${alpha.toFixed(2)})`;
  }

  function formatBucket(bucketIdx) {
    const now      = new Date();
    const ms       = now.getTime() - (TIME_BUCKETS - 1 - bucketIdx) * BUCKET_MIN * 60 * 1000;
    const d        = new Date(ms);
    const h        = d.getHours().toString().padStart(2, '0');
    const m        = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  function render() {
    const wrap    = document.getElementById('heatmap-grid');
    const yAxis   = document.getElementById('heatmap-y-axis');
    const xAxis   = document.getElementById('heatmap-x-axis');
    const legend  = document.getElementById('heatmap-legend-bar');
    const tooltip = document.getElementById('heatmap-tooltip');
    if (!wrap) return;

    const grid = buildGrid();

    // Find max count for color scaling
    const maxCount = Math.max(1, ...grid.flat());

    // Build legend gradient
    if (legend) {
      legend.style.background =
        'linear-gradient(to right, var(--bg-control), rgba(74,222,128,0.15), rgba(74,222,128,1))';
    }

    // Y axis labels (bands, bottom to top = high to low freq visually)
    if (yAxis) {
      yAxis.innerHTML = [...BANDS].reverse().map(b =>
        `<div class="heatmap-y-label">${b.label}</div>`
      ).join('');
    }

    // X axis labels — every 4 buckets = every 2 hours
    if (xAxis) {
      xAxis.innerHTML = Array.from({ length: TIME_BUCKETS }, (_, i) =>
        i % 4 === 0
          ? `<div class="heatmap-x-label" style="grid-column:${i+1}">${formatBucket(i)}</div>`
          : ''
      ).join('');
    }

    // Grid cells — rendered band by band, top = high freq, bottom = low
    wrap.innerHTML = '';
    wrap.style.gridTemplateColumns = `repeat(${TIME_BUCKETS}, 1fr)`;
    wrap.style.gridTemplateRows    = `repeat(${BANDS.length}, 1fr)`;

    [...BANDS].reverse().forEach((band, revBandIdx) => {
      const bandIdx = BANDS.length - 1 - revBandIdx;
      for (let t = 0; t < TIME_BUCKETS; t++) {
        const count = grid[bandIdx][t];
        const cell  = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.style.backgroundColor = cellColor(count, maxCount);
        cell.style.gridColumn = t + 1;
        cell.style.gridRow    = revBandIdx + 1;

        // Tooltip on hover
        cell.addEventListener('mouseenter', ev => {
          const timeStr = formatBucket(t);
          const nextStr = formatBucket(Math.min(t + 1, TIME_BUCKETS - 1));
          if (tooltip) {
            tooltip.textContent = count > 0
              ? `${band.label} MHz · ${timeStr}–${nextStr} · ${count} transmission${count !== 1 ? 's' : ''}`
              : `${band.label} MHz · ${timeStr}–${nextStr} · No activity`;
            tooltip.style.display = 'block';
            tooltip.style.opacity = '1';
          }
        });

        cell.addEventListener('mouseleave', () => {
          if (tooltip) tooltip.style.opacity = '0';
        });

        wrap.appendChild(cell);
      }
    });
  }

  return { render };

})();

window.Heatmap = Heatmap;


/* ════════════════════════════════════════════════════════
   Mini Heatmap — Dashboard
   ════════════════════════════════════════════════════════
   Compact version of the Signal Heatmap for the dashboard.
   Fewer time buckets (24 × 1h) and smaller cells to fit
   the available space. Same data source, same color scheme.
*/

const MiniHeatmap = (() => {

  const BANDS = [
    { label: '25–50',   lo: 25,  hi: 50  },
    { label: '50–108',  lo: 50,  hi: 108 },
    { label: '108–174', lo: 108, hi: 174 },
    { label: '174–225', lo: 174, hi: 225 },
    { label: '225–400', lo: 225, hi: 400 },
    { label: '400–512', lo: 400, hi: 512 },
  ];

  const TIME_BUCKETS = 24;    // 24 × 1-hour buckets = 24 hours
  const BUCKET_MIN   = 60;

  function getEntries() {
    try {
      const raw = localStorage.getItem('bc125at_history');
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function buildGrid() {
    const entries  = getEntries();
    const now      = Date.now();
    const windowMs = TIME_BUCKETS * BUCKET_MIN * 60 * 1000;
    const grid     = BANDS.map(() => new Array(TIME_BUCKETS).fill(0));

    entries.forEach(e => {
      if (!e.frequency || e.frequency <= 0) return;
      const ts = new Date(e.timestamp).getTime();
      if (ts < now - windowMs) return;

      const elapsed_ms = now - ts;
      const bucket = TIME_BUCKETS - 1 -
        Math.floor(elapsed_ms / (BUCKET_MIN * 60 * 1000));
      if (bucket < 0 || bucket >= TIME_BUCKETS) return;

      const bandIdx = BANDS.findIndex(b =>
        e.frequency >= b.lo && e.frequency < b.hi
      );
      if (bandIdx === -1) return;
      grid[bandIdx][bucket]++;
    });

    return grid;
  }

  function cellColor(count, maxCount) {
    if (count === 0) return 'var(--bg-key)';
    const intensity = Math.min(count / Math.max(maxCount, 1), 1);
    const alpha = 0.2 + (intensity * 0.8);
    return `rgba(74, 222, 128, ${alpha.toFixed(2)})`;
  }

  function render() {
    const grid    = document.getElementById('mini-heatmap-grid');
    const yAxis   = document.getElementById('mini-heatmap-y');
    const tooltip = document.getElementById('mini-heatmap-tooltip');
    if (!grid) return;

    const data     = buildGrid();
    const maxCount = Math.max(1, ...data.flat());

    // Y axis labels
    if (yAxis) {
      yAxis.innerHTML = [...BANDS].reverse().map(b =>
        `<div class="mini-heatmap-y-label">${b.label}</div>`
      ).join('');
    }

    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${TIME_BUCKETS}, 1fr)`;
    grid.style.gridTemplateRows    = `repeat(${BANDS.length}, 1fr)`;

    [...BANDS].reverse().forEach((band, revIdx) => {
      const bandIdx = BANDS.length - 1 - revIdx;
      for (let t = 0; t < TIME_BUCKETS; t++) {
        const count = data[bandIdx][t];
        const cell  = document.createElement('div');
        cell.className = 'mini-heatmap-cell';
        cell.style.backgroundColor = cellColor(count, maxCount);
        cell.style.gridColumn = t + 1;
        cell.style.gridRow    = revIdx + 1;

        cell.addEventListener('mouseenter', () => {
          if (!tooltip) return;
          const now = new Date();
          const h   = new Date(now - (TIME_BUCKETS - 1 - t) * 3600000);
          const hr  = h.getHours().toString().padStart(2, '0');
          tooltip.textContent = count > 0
            ? `${band.label} MHz · ${hr}:00 · ${count} tx`
            : `${band.label} MHz · ${hr}:00 · none`;
          tooltip.style.opacity = '1';
        });
        cell.addEventListener('mouseleave', () => {
          if (tooltip) tooltip.style.opacity = '0';
        });

        grid.appendChild(cell);
      }
    });
  }

  // Auto-refresh every 5 minutes while page is open
  setInterval(() => {
    const pane = document.getElementById('tab-dashboard');
    if (pane && pane.classList.contains('active')) render();
  }, 5 * 60 * 1000);

  return { render };

})();

window.MiniHeatmap = MiniHeatmap;
