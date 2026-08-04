/* Prod_test — auth.js
   Client-side auth state management.

   On page load, fetches /auth/status to know if the user is admin.
   If not admin, protected controls are visually disabled with a
   lock indicator. Clicking a protected control redirects to /auth/login.

   Protected elements are marked with data-protected="true" in the HTML,
   OR matched by selector (import buttons, settings saves, etc.)
*/

const Auth = (() => {

  let _isAdmin     = false;
  let _authEnabled = true;

  /* ── Fetch auth state from server ──────────────────────────────── */
  async function init() {
    try {
      const res  = await fetch('/auth/status');
      const data = await res.json();
      _isAdmin     = data.authenticated;
      _authEnabled = data.auth_enabled;
    } catch (_) {
      _isAdmin     = false;
      _authEnabled = false;
    }

    if (!_authEnabled || _isAdmin) {
      // No auth needed or already admin — nothing to lock
      return;
    }

    applyLocks();
    wireLogout();
  }

  /* ── Apply lock state to all protected elements ─────────────────── */
  function applyLocks() {
    // Selectors for all protected interactive elements
    const PROTECTED_SELECTORS = [
      // Channel manager actions
      '#ch-export-btn', '#ch-import-input', '#ch-export-ss-btn', '#ch-import-ss-input',
      '#ch-unlock-all',
      // Settings tab — all save buttons
      '#save-serial', '#save-groups', '#save-priority',
      '#search-ranges-refresh', '#search-settings-save',
      // Recording controls
      '#rec-start', '#rec-stop',
      '#session-rec-toggle',
      // Smart Resume blocklist
      '#sr-toggle', '#sr-block-btn', '#sr-clear-all', '#sr-manage-btn',
      // History
      '#hist-export', '#hist-clear',
      '#hist-discovery-toggle',
      // Auto-record
      '.session-rec-toggle',
    ].join(', ');

    document.querySelectorAll(PROTECTED_SELECTORS).forEach(el => lockElement(el));

    // Also lock dynamically rendered buttons via MutationObserver
    const observer = new MutationObserver(() => {
      document.querySelectorAll(PROTECTED_SELECTORS).forEach(el => {
        if (!el.dataset.locked) lockElement(el);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function lockElement(el) {
    if (el.dataset.locked) return;
    el.dataset.locked = 'true';

    // Visual lock indicator
    el.style.opacity     = '0.45';
    el.style.cursor      = 'not-allowed';
    el.style.position    = 'relative';

    // Add lock icon if it's a button
    if (el.tagName === 'BUTTON' || el.tagName === 'A') {
      el.title = (el.title ? el.title + ' — ' : '') + 'Sign in required';
    }

    // Intercept clicks — redirect to login
    el.addEventListener('click', lockClick, true);

    // For file inputs (import), wrap the label
    if (el.tagName === 'INPUT' && el.type === 'file') {
      el.addEventListener('change', e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        redirectLogin();
      }, true);
    }
  }

  function lockClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    redirectLogin();
  }

  function redirectLogin() {
    // Show a brief toast then redirect
    showToast('🔒 Sign in required to use this feature');
    setTimeout(() => {
      window.location.href = '/auth/login?next=' + encodeURIComponent(window.location.pathname);
    }, 800);
  }

  /* ── Toast notification ─────────────────────────────────────────── */
  function showToast(msg) {
    let toast = document.getElementById('auth-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'auth-toast';
      toast.className = 'auth-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('visible'), 2500);
  }

  /* ── Logout ─────────────────────────────────────────────────────── */
  function wireLogout() {
    // Nothing to wire if admin — button is already shown in template
  }

  /* ── Also intercept API calls that need auth ────────────────────── */
  // Patch apiFetch to show toast when server returns 401
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.apiFetch === 'function') {
      const _orig = window.apiFetch;
      window.apiFetch = async function(path, method, body) {
        const result = await _orig(path, method, body);
        if (result && result.auth_required) {
          showToast('🔒 Sign in required');
          setTimeout(() => {
            window.location.href = '/auth/login?next=' + encodeURIComponent(window.location.pathname);
          }, 800);
        }
        return result;
      };
    }
  });

  return { init, get isAdmin() { return _isAdmin; } };

})();

window.Auth = Auth;

// Auto-init
document.addEventListener('DOMContentLoaded', () => Auth.init());
