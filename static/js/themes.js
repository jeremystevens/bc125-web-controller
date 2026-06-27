/* BC125AT Web Controller — themes.js
   Radio-inspired theme switcher.

   Themes:
     nightwatch — dark green on near-black (default)
     amber      — orange-amber on dark walnut (Motorola-style)
     navy       — steel blue on deep navy (military radio)
     phosphor   — bright green-white on black (classic CRT)
     daylight   — clean light with green accents (bright environments)

   Preference saved to localStorage. Applied to document.body via
   data-theme attribute which CSS selectors target.
*/

const Themes = (() => {

  const STORAGE_KEY = 'bc125at_theme';
  const DEFAULT     = 'nightwatch';
  const VALID       = ['nightwatch', 'amber', 'navy', 'phosphor', 'daylight'];

  // ── Apply ──────────────────────────────────────────────────────────

  function apply(theme) {
    if (!VALID.includes(theme)) theme = DEFAULT;
    document.documentElement.setAttribute('data-theme', theme);

    // Update active state on swatch buttons
    document.querySelectorAll('.theme-card').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    // Persist
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
  }

  // ── Load saved preference ──────────────────────────────────────────

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return VALID.includes(saved) ? saved : DEFAULT;
    } catch (_) {
      return DEFAULT;
    }
  }

  // ── Init ───────────────────────────────────────────────────────────

  function init() {
    // Apply saved theme immediately
    apply(load());

    // Wire swatch buttons
    document.querySelectorAll('.theme-card').forEach(btn => {
      btn.addEventListener('click', () => {
        apply(btn.dataset.theme);
        if (window.logEntry) {
          const names = {
            nightwatch: 'Nightwatch',
            amber:      'Amber Alert',
            navy:       'Navy Ops',
            phosphor:   'Phosphor',
            daylight:   'Daylight',
          };
          logEntry(`Theme: ${names[btn.dataset.theme] || btn.dataset.theme}`, 'info');
        }
      });
    });
  }

  return { init, apply };
})();

window.Themes = Themes;
