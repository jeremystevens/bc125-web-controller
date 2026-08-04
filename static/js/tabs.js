/* BC125AT — tabs.js  Phase 6 tab navigation */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;

    document.querySelectorAll('.tab-btn').forEach(b  => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');

    // Load data when tabs first open
    if (tab === 'channels' && !window._chLoaded) {
      window._chLoaded = true;
      if (window.loadBank) loadBank(1);
      // Search init (also called from DOMContentLoaded but safe to call again)
      if (window.ChSearch) ChSearch.init();
    }
    if (tab === 'channels' && window.Favorites) {
      Favorites.renderStars();
    }
    if (tab === 'settings') {
      if (window.loadSettings) loadSettings();
    }
    if (tab === 'history') {
      if (window.History) {
        History.render();
        History.matchRecordings();
      }
    }
    if (tab === 'status') {
      if (window.Status) Status.render();
    }
  });
});
