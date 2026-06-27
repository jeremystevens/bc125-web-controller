/* BC125AT Web Controller — notifications.js
   Browser Notifications for active transmissions.

   Uses the Web Notifications API (built into all modern browsers).
   Fires when squelch_open flips true — i.e. an active transmission
   is detected on the current frequency.

   No backend changes required — piggybacks on the existing
   scanner_state SocketIO push (squelch_open field).
*/

const Notifs = (() => {
  let enabled       = false;
  let lastSqlOpen   = false;
  let activeNotif   = null;
  let toggleBtn     = null;

  // Auto-close notification after this many ms
  const NOTIF_DURATION = 4000;

  // ── Permission ──────────────────────────────────────────────────────

  async function requestPermission() {
    if (!('Notification' in window)) {
      console.warn('Browser notifications not supported.');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;

    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  function hasPermission() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  // ── Toggle ───────────────────────────────────────────────────────────

  function setEnabled(val) {
    enabled = val;
    updateBtn();
    // Persist preference
    try { localStorage.setItem('bc125at_notifs', val ? '1' : '0'); } catch (_) {}
  }

  function loadPreference() {
    try {
      const saved = localStorage.getItem('bc125at_notifs');
      return saved === '1';
    } catch (_) { return false; }
  }

  function updateBtn() {
    if (!toggleBtn) return;
    toggleBtn.textContent    = enabled ? '🔔' : '🔕';
    toggleBtn.title          = enabled ? 'Notifications on — click to disable' : 'Notifications off — click to enable';
    toggleBtn.classList.toggle('notif-btn--active', enabled);
  }

  // ── Fire notification ────────────────────────────────────────────────

  function fire(state) {
    console.log('[Notifs] fire() called | permission:', Notification.permission, '| enabled:', enabled);
    if (!hasPermission() || !enabled) {
      console.log('[Notifs] fire() blocked — permission:', Notification.permission, 'enabled:', enabled);
      return;
    }

    // Close any existing notification first
    if (activeNotif) {
      try { activeNotif.close(); } catch (_) {}
      activeNotif = null;
    }

    const freq  = state.frequency_mhz > 0 ? state.frequency_mhz.toFixed(4) + ' MHz' : 'Unknown';
    const name  = state.channel_name  || '';
    const mod   = state.modulation    || '';
    const ch    = state.channel_id > 0 ? `CH ${state.channel_id}` : '';

    const title = `📡 Active — ${freq}`;
    const body  = [ch, name, mod].filter(Boolean).join('  ·  ') || 'Transmission detected';

    try {
      activeNotif = new Notification(title, {
        body,
        icon:   '/static/img/icon.png',   // optional — silently ignored if missing
        badge:  '/static/img/badge.png',   // optional
        tag:    'bc125at-active',          // replaces previous notif with same tag
        silent: false,
      });

      // Auto-close
      setTimeout(() => {
        if (activeNotif) {
          try { activeNotif.close(); } catch (_) {}
          activeNotif = null;
        }
      }, NOTIF_DURATION);

      // Click focuses the window
      activeNotif.onclick = () => {
        window.focus();
        if (activeNotif) activeNotif.close();
      };

    } catch (e) {
      console.warn('Notification failed:', e);
    }
  }

  // ── State hook — called from applyStatus ────────────────────────────

  function onState(state) {
    const sqlOpen = !!state.squelch_open;

    // Debug — log to console so we can verify state is arriving
    if (sqlOpen !== lastSqlOpen) {
      console.log('[Notifs] squelch_open changed:', lastSqlOpen, '→', sqlOpen,
                  '| enabled:', enabled, '| permission:', Notification.permission);
    }

    // Only fire on the rising edge (closed → open), not while it stays open
    if (sqlOpen && !lastSqlOpen) {
      console.log('[Notifs] Rising edge detected — firing notification');
      fire(state);
    }

    lastSqlOpen = sqlOpen;
  }

  // ── Init ─────────────────────────────────────────────────────────────

  async function init() {
    toggleBtn = document.getElementById('notif-toggle');
    if (!toggleBtn) return;

    // Load saved preference
    const savedEnabled = loadPreference();
    console.log('[Notifs] init() | permission:', Notification.permission, '| savedEnabled:', savedEnabled);

    // If browser doesn't support notifications, hide the button
    if (!('Notification' in window)) {
      toggleBtn.style.display = 'none';
      return;
    }

    toggleBtn.addEventListener('click', async () => {
      if (!hasPermission()) {
        const granted = await requestPermission();
        if (!granted) {
          // Show a brief message in the activity log if available
          if (window.logEntry) {
            logEntry('Notifications blocked — enable in browser settings', 'err');
          }
          return;
        }
      }
      setEnabled(!enabled);
      if (window.logEntry) {
        logEntry(`Notifications ${enabled ? 'enabled' : 'disabled'}`, 'info');
      }
    });

    // Auto-enable if previously enabled and permission still granted
    if (savedEnabled && hasPermission()) {
      setEnabled(true);
    } else {
      setEnabled(false);
    }

    // Hook into applyStatus — patch here inside init() so applyStatus
    // is guaranteed to exist (main.js has already run by this point)
    if (typeof window.applyStatus === 'function') {
      const _orig = window.applyStatus;
      window.applyStatus = function(d) {
        _orig(d);
        Notifs.onState(d);
      };
    }
  }

  return { init, onState };
})();

/* Expose so main.js can call Notifs.onState(state) from applyStatus */
window.Notifs = Notifs;
