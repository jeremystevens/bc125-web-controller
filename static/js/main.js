/* BC125AT Web Controller — main.js
   Polls /api/status and updates the UI.
   Phase 4 will replace polling with SocketIO push. */

const API = '';   // same origin

/* ── DOM refs ── */
const $ = id => document.getElementById(id);

const els = {
  freq:       $('display-freq'),
  channel:    $('display-channel'),
  mod:        $('display-mod'),
  name:       $('display-name'),
  squelchIcon:$('icon-squelch'),
  muteIcon:   $('icon-mute'),
  volValue:   $('vol-value'),
  sqlValue:   $('sql-value'),
  bltValue:   $('blt-value'),
  volSlider:  $('vol-slider'),
  sqlSlider:  $('sql-slider'),
  batFill:    $('battery-fill'),
  batVolts:   $('battery-volts'),
  status:     $('connection-status'),
  dot:        $('connection-dot'),
  log:        $('activity-log'),
  chInput:    $('channel-input'),
  chGo:       $('channel-go'),
  logClear:   $('log-clear'),
};

/* ── Logging ── */
function logEntry(msg, type = 'info') {
  const empty = els.log.querySelector('.log-empty');
  if (empty) empty.remove();

  const now  = new Date();
  const time = now.toTimeString().slice(0, 8);
  const row  = document.createElement('div');
  row.className = `log-entry log-${type}`;
  row.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${msg}</span>`;
  els.log.appendChild(row);
  els.log.scrollTop = els.log.scrollHeight;

  /* keep log bounded */
  while (els.log.children.length > 80) {
    els.log.removeChild(els.log.firstChild);
  }
}

els.logClear.addEventListener('click', () => {
  els.log.innerHTML = '<span class="log-empty">No activity yet</span>';
});

/* ── Connection state ── */
function setConnected(ok) {
  els.dot.className    = 'logo-dot ' + (ok ? 'connected' : 'error');
  els.status.className = 'header-status ' + (ok ? 'connected' : 'error');
  els.status.textContent = ok ? 'connected' : 'disconnected';
}

/* ── API helpers ── */
async function apiFetch(path, method = 'GET', body = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(API + path, opts);
    const data = await res.json();
    return data;
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/* ── Signal bars ── */
function updateSignal(strength) {
  for (let i = 1; i <= 5; i++) {
    const bar = $(`sig-${i}`);
    if (bar) bar.classList.toggle('lit', strength >= i);
  }
}

/* ── Battery ── */
function updateBattery(volts) {
  /* BC125AT runs on 2×AA: ~3.0V low, ~3.2V nominal, ~3.4V full */
  const pct = Math.min(100, Math.max(0, Math.round((volts - 2.8) / 0.6 * 100)));
  els.batFill.style.width  = pct + '%';
  els.batFill.style.background = pct < 25 ? '#ef4444' : pct < 50 ? '#f59e0b' : '#22c55e';
  els.batVolts.textContent = volts.toFixed(2) + 'V';
}

/* ── Status update ── */
let lastFreq = null;
let lastChannel = null;

function applyStatus(d) {
  /* Frequency */
  const freqStr = d.frequency_mhz > 0
    ? d.frequency_mhz.toFixed(4) + ' MHz'
    : '--- --- MHz';
  els.freq.textContent = freqStr;

  /* Channel & modulation */
  els.channel.textContent = d.channel_id > 0 ? `CH ${d.channel_id}` : '--';
  els.mod.textContent     = d.modulation || '--';
  els.name.textContent    = d.channel_name || '\u00a0';

  /* Icons */
  els.squelchIcon.classList.toggle('active', d.squelch_open);
  els.muteIcon.classList.toggle('active', d.muted);

  /* Signal */
  updateSignal(d.signal_strength || 0);

  /* Battery */
  if (d.battery_volts) updateBattery(d.battery_volts);

  /* Sliders — only update if user isn't dragging */
  if (!sliderDragging.vol) {
    els.volSlider.value = d.volume;
    els.volValue.textContent = d.volume;
  }
  if (!sliderDragging.sql) {
    els.sqlSlider.value = d.squelch;
    els.sqlValue.textContent = d.squelch;
  }

  /* Log frequency changes */
  if (d.frequency_mhz > 0 && d.frequency_mhz !== lastFreq) {
    lastFreq = d.frequency_mhz;
    const name = d.channel_name ? ` · ${d.channel_name}` : '';
    logEntry(`${d.frequency_mhz.toFixed(4)} MHz ${d.modulation}${name}`, 'info');
  }
}

/* ── Poll loop ── */
let pollActive = true;

async function poll() {
  if (!pollActive) return;
  const data = await apiFetch('/api/status');
  if (data.success) {
    setConnected(true);
    applyStatus(data.data);
  } else {
    setConnected(false);
  }
  setTimeout(poll, 600);
}

/* ── Keypad ── */
document.querySelectorAll('.key[data-key]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const key = btn.dataset.key;
    btn.classList.add('key-flash');
    btn.addEventListener('animationend', () => btn.classList.remove('key-flash'), { once: true });
    const res = await apiFetch(`/api/key/${key}`, 'POST');
    logEntry(res.success ? `Key: ${key}` : `Key ${key} failed — ${res.message}`,
             res.success ? 'ok' : 'err');
  });
});

/* ── Channel jump ── */
els.chGo.addEventListener('click', jumpToChannel);
els.chInput.addEventListener('keydown', e => { if (e.key === 'Enter') jumpToChannel(); });

async function jumpToChannel() {
  const ch = parseInt(els.chInput.value, 10);
  if (!ch || ch < 1 || ch > 500) {
    logEntry('Channel must be 1–500', 'err');
    return;
  }
  const res = await apiFetch(`/api/channel/${ch}`, 'POST');
  logEntry(res.success ? `Jumped to CH ${ch}` : `Channel jump failed — ${res.message}`,
           res.success ? 'ok' : 'err');
}

/* ── Volume & squelch sliders ── */
const sliderDragging = { vol: false, sql: false };

function setupSlider(slider, valueEl, key, apiPath, trackingKey) {
  slider.addEventListener('input', () => {
    sliderDragging[trackingKey] = true;
    valueEl.textContent = slider.value;
  });
  slider.addEventListener('change', async () => {
    const level = parseInt(slider.value, 10);
    const res = await apiFetch(`${apiPath}/${level}`, 'POST');
    logEntry(res.success
      ? `${key} set to ${level}`
      : `${key} failed — ${res.message}`,
      res.success ? 'ok' : 'err');
    /* Brief delay so next poll doesn't override while we release */
    setTimeout(() => { sliderDragging[trackingKey] = false; }, 800);
  });
}

setupSlider(els.volSlider, els.volValue, 'Volume', '/api/volume', 'vol');
setupSlider(els.sqlSlider, els.sqlValue, 'Squelch', '/api/squelch', 'sql');

/* ── Backlight ── */
document.querySelectorAll('.blt-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    const res  = await apiFetch(`/api/backlight/${mode}`, 'POST');
    if (res.success) {
      document.querySelectorAll('.blt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      els.bltValue.textContent = mode;
      logEntry(`Backlight: ${mode}`, 'ok');
    } else {
      logEntry(`Backlight failed — ${res.message}`, 'err');
    }
  });
});

/* Load initial backlight state */
async function loadBacklight() {
  const res = await apiFetch('/api/backlight');
  if (res.success) {
    const mode = res.data.backlight;
    els.bltValue.textContent = mode;
    document.querySelectorAll('.blt-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  }
}

/* ── Boot ── */
logEntry('Controller started', 'info');
loadBacklight();
poll();
