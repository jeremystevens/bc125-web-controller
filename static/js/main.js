/* BC125AT Web Controller — main.js
   UI logic, controls, and activity log.
   State updates arrive via SocketIO push (socket.js) — no poll loop. */

const API = '';

/* ── DOM refs ── */
const $ = id => document.getElementById(id);

const els = {
  freq:        $('display-freq'),
  channel:     $('display-channel'),
  mod:         $('display-mod'),
  name:        $('display-name'),
  squelchIcon: $('icon-squelch'),
  muteIcon:    $('icon-mute'),
  volValue:    $('vol-value'),
  sqlValue:    $('sql-value'),
  bltValue:    $('blt-value'),
  volSlider:   $('vol-slider'),
  sqlSlider:   $('sql-slider'),
  batFill:     $('battery-fill'),
  batVolts:    $('battery-volts'),
  status:      $('connection-status'),
  dot:         $('connection-dot'),
  log:         $('activity-log'),
  chInput:     $('channel-input'),
  chGo:        $('channel-go'),
  logClear:    $('log-clear'),
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

/* Expose globally so socket.js can call it */
window.setConnected = setConnected;

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
  const pct = Math.min(100, Math.max(0, Math.round((volts - 2.8) / 0.6 * 100)));
  els.batFill.style.width      = pct + '%';
  els.batFill.style.background = pct < 25 ? '#ef4444' : pct < 50 ? '#f59e0b' : '#22c55e';
  els.batVolts.textContent     = volts.toFixed(2) + 'V';
}

/* ── Apply state pushed from server ── */
let lastFreq = null;

function applyStatus(d) {
  /* Frequency — always update display regardless of whether value changed */
  els.freq.textContent = d.frequency_mhz > 0
    ? d.frequency_mhz.toFixed(4) + ' MHz'
    : '--- --- MHz';

  /* Channel & modulation — always update */
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
    els.volSlider.value      = d.volume;
    els.volValue.textContent = d.volume;
  }
  if (!sliderDragging.sql) {
    els.sqlSlider.value      = d.squelch;
    els.sqlValue.textContent = d.squelch;
  }

  /* Log frequency changes — always update display, log only on change */
  if (d.frequency_mhz > 0 && d.frequency_mhz !== lastFreq) {
    lastFreq = d.frequency_mhz;
    const name = d.channel_name ? ` · ${d.channel_name}` : '';
    logEntry(`${d.frequency_mhz.toFixed(4)} MHz ${d.modulation}${name}`, 'info');
  } else if (d.frequency_mhz === 0 && lastFreq !== null) {
    /* Scanner between channels — keep last frequency displayed, do not zero out */
  }
}

/* Expose globally so socket.js can call it */
window.applyStatus = applyStatus;


window.logEntry    = logEntry;

/* ── Keypad ── */
document.querySelectorAll('.key[data-key]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const key = btn.dataset.key;
    btn.classList.add('key-flash');
    btn.addEventListener('animationend', () => btn.classList.remove('key-flash'), { once: true });
    const res = await apiFetch(`/api/key/${key}`, 'POST');
    logEntry(
      res.success ? `Key: ${key}` : `Key ${key} failed — ${res.message}`,
      res.success ? 'ok' : 'err'
    );
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
  logEntry(
    res.success ? `Jumped to CH ${ch}` : `Channel jump failed — ${res.message}`,
    res.success ? 'ok' : 'err'
  );
}

/* ── Volume & squelch sliders ── */
const sliderDragging = { vol: false, sql: false };

function setupSlider(slider, valueEl, label, apiPath, trackingKey) {
  slider.addEventListener('input', () => {
    sliderDragging[trackingKey] = true;
    valueEl.textContent = slider.value;
  });
  slider.addEventListener('change', async () => {
    const level = parseInt(slider.value, 10);
    const res = await apiFetch(`${apiPath}/${level}`, 'POST');
    logEntry(
      res.success ? `${label} set to ${level}` : `${label} failed — ${res.message}`,
      res.success ? 'ok' : 'err'
    );
    setTimeout(() => { sliderDragging[trackingKey] = false; }, 800);
  });
}

setupSlider(els.volSlider, els.volValue, 'Volume',  '/api/volume',  'vol');
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

/* Initialise SocketIO — defined in socket.js loaded after this file */
document.addEventListener('DOMContentLoaded', () => {
  // Initialise themes
  if (window.Themes) window.Themes.init();

  // Initialise keyboard shortcuts
  if (window.Shortcuts) window.Shortcuts.init();

  // Initialise notifications
  if (window.Notifs) window.Notifs.init();

  // Initialise Smart Resume VAD
  if (window.SmartResume) window.SmartResume.init();

  // Initialise Activity History
  if (window.History) window.History.init();

  // Initialise Status page
  if (window.Status) window.Status.init();

  // Render mini heatmap on dashboard
  if (window.MiniHeatmap) MiniHeatmap.render();

  // Initialise Favorites
  if (window.Favorites) window.Favorites.init();

  // Initialise SocketIO
  if (window.initSocket) {
    window.initSocket();
    window.startPing();
  }
});


/* ════════════════════════════════════════
   Phase 5 — Recording controls
   ════════════════════════════════════════ */

const recEls = {
  start:      $('rec-start'),
  stop:       $('rec-stop'),
  statusText: $('rec-status-text'),
  indicator:  $('rec-indicator'),
  timer:      $('rec-timer'),
  file:       $('rec-file'),
};

let recTimerInterval = null;
let recStartEpoch    = null;

/* ── Timer display ── */
function startRecTimer() {
  recStartEpoch = Date.now();
  recTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recStartEpoch) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = String(elapsed % 60).padStart(2, '0');
    if (recEls.timer)    recEls.timer.textContent    = `${m}:${s}`;
  }, 1000);
}

function stopRecTimer() {
  clearInterval(recTimerInterval);
  recTimerInterval = null;
  recStartEpoch    = null;
  if (recEls.timer) recEls.timer.textContent = '0:00';
}

/* ── UI state sync ── */
function setRecordingUI(recording, tail, filename) {
  const active = recording || tail;

  recEls.start.disabled = active;
  recEls.stop.disabled  = !recording;
  recEls.start.classList.toggle('active', recording);

  // REC pill in display header — uses .active class
  if (recEls.indicator) {
    recEls.indicator.classList.toggle('active', active);
  }

  if (recording) {
    recEls.statusText.textContent = 'recording';
    recEls.statusText.className   = 'level-value rec-status-text recording';
  } else if (tail) {
    recEls.statusText.textContent = 'tail...';
    recEls.statusText.className   = 'level-value rec-status-text tail';
    recEls.stop.disabled          = true;
  } else {
    recEls.statusText.textContent = 'idle';
    recEls.statusText.className   = 'level-value rec-status-text';
    stopRecTimer();
  }

  // Show current filename under the buttons
  if (recEls.file) {
    recEls.file.textContent = (active && filename) ? filename : ' ';
  }
}

/* ── Apply recorder state from server push ── */
function applyRecorderState(rec) {
  if (!rec) return;
  if (rec.recording && !recTimerInterval) startRecTimer();
  if (!rec.recording && !rec.tail_active) stopRecTimer();
  setRecordingUI(rec.recording, rec.tail_active, rec.current_file);
}

/* Hook into applyStatus so socket pushes update the recorder UI too */
const _origApplyStatus = window.applyStatus;
window.applyStatus = function(d) {
  _origApplyStatus(d);
  if (d.recorder) applyRecorderState(d.recorder);
};

/* ── Start recording ── */
recEls.start.addEventListener('click', async () => {
  const res = await apiFetch('/api/recording/start', 'POST');
  if (res.success) {
    startRecTimer();
    setRecordingUI(true, false, res.data?.file);
    logEntry(`Recording started → ${res.data?.file || ''}`, 'ok');
  } else {
    logEntry(`Record failed — ${res.message}`, 'err');
  }
});

/* ── Stop recording ── */
recEls.stop.addEventListener('click', async () => {
  const res = await apiFetch('/api/recording/stop', 'POST');
  if (res.success) {
    setRecordingUI(false, true, res.data?.file);
    logEntry(`Recording stopping (tail 3s) → ${res.data?.file || ''}`, 'ok');
    /* Refresh list after tail completes */
    setTimeout(loadRecordings, 4000);
  } else {
    logEntry(`Stop failed — ${res.message}`, 'err');
  }
});

/* ── Recordings list ── */
async function loadRecordings() {
  const res = await apiFetch('/api/recordings');
  const list = $('recordings-list');
  if (!list) return;

  if (!res.success || !res.data.recordings.length) {
    list.innerHTML = '<span class="log-empty">No recordings yet</span>';
    return;
  }

  list.innerHTML = res.data.recordings.map(r => `
    <div class="recording-row">
      <span class="rec-filename" title="${r.filename}">${r.filename}</span>
      <span class="rec-size">${r.size_kb} KB</span>
      <span class="rec-date">${r.created}</span>
      <div class="rec-actions">
        <a href="${r.url}" target="_blank" download>
          <button class="rec-action-btn">Download</button>
        </a>
        <button class="rec-action-btn delete" data-file="${r.filename}">Delete</button>
      </div>
    </div>
  `).join('');

  /* Wire delete buttons */
  list.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const file = btn.dataset.file;
      if (!confirm(`Delete ${file}?`)) return;
      const res = await apiFetch(`/api/recordings/${encodeURIComponent(file)}`, 'DELETE');
      logEntry(
        res.success ? `Deleted: ${file}` : `Delete failed — ${res.message}`,
        res.success ? 'ok' : 'err'
      );
      if (res.success) loadRecordings();
    });
  });
}

$('recordings-refresh').addEventListener('click', loadRecordings);

/* Load recordings on boot */
loadRecordings();


/* ════════════════════════════════════════
   Session Recording
   ════════════════════════════════════════ */

let sessionRecEnabled = false;

const sessionRecToggle = document.getElementById('session-rec-toggle');
const sessionRecStatus = document.getElementById('session-rec-status');

function setSessionRecStatus(text, cls) {
  if (!sessionRecStatus) return;
  sessionRecStatus.textContent = text;
  sessionRecStatus.className   = `session-rec-status ${cls || ''}`;
}

async function toggleSessionRecording() {
  const enabling = !sessionRecEnabled;
  const endpoint = enabling ? '/api/session-recording/enable' : '/api/session-recording/disable';

  const res = await apiFetch(endpoint, 'POST');
  if (res.success) {
    sessionRecEnabled = enabling;
    if (sessionRecToggle) {
      sessionRecToggle.textContent = enabling ? 'ON' : 'OFF';
      sessionRecToggle.classList.toggle('active', enabling);
    }
    setSessionRecStatus(
      enabling ? 'Auto-recording transmissions…' : '',
      enabling ? 'listening' : ''
    );
    if (window.logEntry) logEntry(`Auto-Record ${enabling ? 'enabled' : 'disabled'}`, 'info');
  }
}

sessionRecToggle?.addEventListener('click', toggleSessionRecording);

// Update session rec indicator from state push
function applySessionRecState(state) {
  const srState = state?.session_recorder;
  if (!srState) return;

  sessionRecEnabled = srState.enabled;
  if (sessionRecToggle) {
    sessionRecToggle.textContent = srState.enabled ? 'ON' : 'OFF';
    sessionRecToggle.classList.toggle('active', srState.enabled);
  }

  if (srState.recording && srState.current_file) {
    setSessionRecStatus(`● REC ${srState.elapsed_seconds}s`, 'recording');
  } else if (srState.enabled) {
    setSessionRecStatus('Listening…', 'listening');
  } else {
    setSessionRecStatus('', '');
  }
}


/* ════════════════════════════════════════
   Audio Streaming Player
   ════════════════════════════════════════ */

const AudioStream = (() => {

  let enabled  = false;
  let audioEl  = null;

  const getToggle  = () => document.getElementById('audio-stream-toggle');
  const getPlayer  = () => document.getElementById('audio-stream-player');
  const getStatus  = () => document.getElementById('audio-stream-status');
  const getAudio   = () => document.getElementById('audio-stream-el');

  function setStatus(msg, cls) {
    const el = getStatus();
    if (el) {
      el.textContent = msg;
      el.className   = `audio-stream-status ${cls || ''}`;
    }
  }

  function start() {
    const audio  = getAudio();
    const player = getPlayer();
    if (!audio || !player) return;

    player.style.display = 'block';
    setStatus('Connecting…', 'connecting');

    // Set src to the streaming endpoint with a cache-busting param
    audio.src = `/stream/audio?t=${Date.now()}`;
    audio.load();

    audio.oncanplay = () => setStatus('● Live', 'live');
    audio.onerror   = (e) => {
      setStatus('Stream error — is line-in connected?', 'error');
      console.warn('[AudioStream] Error:', e);
    };
    audio.onwaiting = () => setStatus('Buffering…', 'connecting');
    audio.onplaying = () => setStatus('● Live', 'live');
    audio.onstalled = () => setStatus('Stalled…', 'connecting');

    audio.play().catch(e => {
      // Autoplay blocked — show message but keep player visible
      setStatus('Click play to start', '');
      console.log('[AudioStream] Autoplay blocked:', e.message);
    });

    enabled = true;
    if (window.logEntry) logEntry('Live audio streaming started', 'ok');
  }

  function stop() {
    const audio  = getAudio();
    const player = getPlayer();

    if (audio) {
      audio.pause();
      audio.src = '';
      audio.load();
    }

    if (player) player.style.display = 'none';
    setStatus('', '');
    enabled = false;
    if (window.logEntry) logEntry('Live audio streaming stopped', 'info');
  }

  function toggle() {
    const btn = getToggle();
    if (enabled) {
      stop();
      if (btn) { btn.textContent = 'OFF'; btn.classList.remove('active'); }
    } else {
      start();
      if (btn) { btn.textContent = 'ON'; btn.classList.add('active'); }
    }
  }

  function init() {
    getToggle()?.addEventListener('click', toggle);
  }

  return { init, start, stop, toggle, get enabled() { return enabled; } };

})();

window.AudioStream = AudioStream;

// Init on DOM ready — already inside DOMContentLoaded block
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => AudioStream.init());
} else {
  AudioStream.init();
}
