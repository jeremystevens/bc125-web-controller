/* BC125AT Web Controller — shortcuts.js
   Keyboard shortcuts for the dashboard.

   Shortcuts only fire when:
     - The active tab is "Dashboard"
     - Focus is NOT inside an input, textarea, or select
     - No modifier key (Ctrl/Alt/Meta) is held

   Press ? to open/close the shortcut reference overlay.

   IMPORTANT: e.key is case-sensitive. Letter keys are matched
   case-insensitively (e.key.toLowerCase()) so shortcuts work
   regardless of Caps Lock state.
*/

const Shortcuts = (() => {

  let overlayOpen = false;
  let overlayEl   = null;

  // ── Shortcut definitions ─────────────────────────────────────────
  // key: what to match against e.key.toLowerCase() (or exact for specials)
  // code: optional e.code for disambiguation if needed
  // BC125AT valid KEY codes: < ^ > H S R L E 0-9 . P F
  // Weather (W) and Down (v) are NOT valid KEY commands on the BC125AT —
  // the scanner returns NG. They are excluded from shortcuts.
  const SHORTCUTS = [
    // Scanner control
    { key: 's',         label: 'S',   group: 'Scanner',  description: 'Scan',        action: () => pressKey('scan')    },
    { key: 'h',         label: 'H',   group: 'Scanner',  description: 'Hold',        action: () => pressKey('hold')    },
    { key: 'r',         label: 'R',   group: 'Scanner',  description: 'Search',      action: () => pressKey('search')  },
    { key: 'l',         label: 'L',   group: 'Scanner',  description: 'Lockout',     action: () => pressKey('lockout') },
    { key: 'f',         label: 'F',   group: 'Scanner',  description: 'Func',        action: () => pressKey('func')    },
    { key: 'e',         label: 'E',   group: 'Scanner',  description: 'Enter',       action: () => pressKey('enter')   },
    // Keypad
    { key: '0',         label: '0–9', group: 'Keypad',   description: 'Number keys', action: () => pressKey('0')       },
    { key: '1',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('1')       },
    { key: '2',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('2')       },
    { key: '3',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('3')       },
    { key: '4',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('4')       },
    { key: '5',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('5')       },
    { key: '6',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('6')       },
    { key: '7',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('7')       },
    { key: '8',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('8')       },
    { key: '9',         label: '',    group: 'Keypad',   description: '',            action: () => pressKey('9')       },
    { key: '.',         label: '.',   group: 'Keypad',   description: 'Dot',         action: () => pressKey('dot')     },
    // Navigation — Up/Left/Right valid; Down not supported by scanner KEY command
    { key: 'arrowup',    label: '↑',  group: 'Navigate', description: 'Up',          action: () => pressKey('up')      },
    { key: 'arrowleft',  label: '←',  group: 'Navigate', description: 'Left',        action: () => pressKey('left')    },
    { key: 'arrowright', label: '→',  group: 'Navigate', description: 'Right',       action: () => pressKey('right')   },
    // UI
    { key: 'escape', label: 'Esc', group: 'UI', description: 'Close overlay / clear channel input', action: handleEscape  },
    { key: '?',      label: '?',   group: 'UI', description: 'Show / hide shortcut help',           action: toggleOverlay },
  ];

  // Build a fast lookup map: lowercased key → shortcut
  const LOOKUP = {};
  SHORTCUTS.forEach(s => { LOOKUP[s.key] = s; });

  // ── API helper ───────────────────────────────────────────────────

  async function pressKey(key) {
    if (window.logEntry) logEntry(`Key: ${key}`, 'info');

    // Flash the matching keypad button if visible
    const btn = document.querySelector(`.key[data-key="${key}"]`);
    if (btn) {
      btn.classList.add('key-flash');
      btn.addEventListener('animationend', () => btn.classList.remove('key-flash'), { once: true });
    }

    try {
      const res  = await fetch(`/api/key/${key}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success && window.logEntry) {
        logEntry(`Key ${key} failed — ${data.message}`, 'err');
      }
    } catch (err) {
      if (window.logEntry) logEntry(`Key error — ${err.message}`, 'err');
    }
  }

  // ── Escape handler ───────────────────────────────────────────────

  function handleEscape() {
    if (overlayOpen) { closeOverlay(); return; }
    const chInput = document.getElementById('channel-input');
    if (chInput && chInput.value) {
      chInput.value = '';
      chInput.blur();
    }
  }

  // ── Guards ───────────────────────────────────────────────────────

  function isInputFocused() {
    const tag = document.activeElement?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function isDashboardActive() {
    const pane = document.getElementById('tab-dashboard');
    return pane && pane.classList.contains('active');
  }

  // ── Key handler ──────────────────────────────────────────────────

  function onKeyDown(e) {
    const keyLower = e.key.toLowerCase();

    // ? and Esc always handled regardless of tab or focus
    if (keyLower === '?' && !isInputFocused()) {
      e.preventDefault();
      toggleOverlay();
      return;
    }
    if (keyLower === 'escape') {
      e.preventDefault();
      handleEscape();
      return;
    }

    // All other shortcuts: dashboard only, not when input focused, no modifiers
    if (!isDashboardActive() || isInputFocused()) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const shortcut = LOOKUP[keyLower];
    if (shortcut && shortcut.key !== '?' && shortcut.key !== 'escape') {
      // Prevent arrow keys from scrolling the page
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(keyLower)) {
        e.preventDefault();
      }
      shortcut.action();
    }
  }

  // ── Overlay ──────────────────────────────────────────────────────

  function buildOverlay() {
    const el = document.createElement('div');
    el.id        = 'shortcuts-overlay';
    el.className = 'shortcuts-overlay';
    el.innerHTML = `
      <div class="shortcuts-modal">
        <div class="shortcuts-header">
          <span class="shortcuts-title">Keyboard Shortcuts</span>
          <button class="shortcuts-close" id="shortcuts-close">✕</button>
        </div>
        <div class="shortcuts-body">
          ${buildGroups()}
        </div>
        <div class="shortcuts-footer">
          Press <kbd>?</kbd> or <kbd>Esc</kbd> to close &nbsp;·&nbsp;
          Shortcuts active on Dashboard tab only
        </div>
      </div>
    `;
    el.addEventListener('click', ev => { if (ev.target === el) closeOverlay(); });
    document.body.appendChild(el);
    el.querySelector('#shortcuts-close').addEventListener('click', closeOverlay);
    return el;
  }

  function buildGroups() {
    const groups = {};
    SHORTCUTS.forEach(s => {
      if (!s.label) return;
      if (!groups[s.group]) groups[s.group] = [];
      groups[s.group].push(s);
    });

    return Object.entries(groups).map(([group, items]) => `
      <div class="shortcuts-group">
        <div class="shortcuts-group-label">${group}</div>
        ${items.map(s => `
          <div class="shortcuts-row">
            <kbd class="shortcuts-kbd">${s.label}</kbd>
            <span class="shortcuts-desc">${s.description}</span>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  function toggleOverlay() { overlayOpen ? closeOverlay() : openOverlay(); }

  function openOverlay() {
    if (!overlayEl) overlayEl = buildOverlay();
    overlayEl.style.display = 'flex';
    overlayOpen = true;
  }

  function closeOverlay() {
    if (overlayEl) overlayEl.style.display = 'none';
    overlayOpen = false;
  }

  // ── Init ─────────────────────────────────────────────────────────

  function init() {
    document.addEventListener('keydown', onKeyDown);

    // Add ? help button to header (before notif button)
    const helpBtn = document.createElement('button');
    helpBtn.className   = 'shortcuts-help-btn';
    helpBtn.textContent = '?';
    helpBtn.title       = 'Keyboard shortcuts (press ?)';
    helpBtn.addEventListener('click', toggleOverlay);

    const notifBtn = document.getElementById('notif-toggle');
    if (notifBtn) notifBtn.before(helpBtn);
  }

  return { init };

})();

window.Shortcuts = Shortcuts;
