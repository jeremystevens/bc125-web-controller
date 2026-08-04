/* BC125AT Web Controller — favorites.js
   Favorites Manager / Quick-access bar.

   Star any channel in the Channels tab to pin it. Pinned channels
   appear as quick-jump buttons in the Favorites bar on the Dashboard,
   directly below the frequency readout.

   Storage: localStorage key 'bc125at_favorites'
   Max: 10 favorites (oldest removed if at cap and a new one is added... 
        actually we block adding past 10 rather than silently evicting)
*/

const Favorites = (() => {

  const STORAGE_KEY = 'bc125at_favorites';
  const MAX_FAVORITES = 10;

  let favorites = [];   // [{ channel, name, frequency_mhz }, ...]

  /* ── Persistence ─────────────────────────────────────────────── */

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      favorites = raw ? JSON.parse(raw) : [];
    } catch (_) {
      favorites = [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch (_) {}
  }

  function isFavorited(channel) {
    return favorites.some(f => f.channel === channel);
  }

  /* ── Add / Remove ─────────────────────────────────────────────── */

  function toggle(ch) {
    if (isFavorited(ch.channel)) {
      remove(ch.channel);
    } else {
      add(ch);
    }
  }

  function add(ch) {
    if (isFavorited(ch.channel)) return;

    if (favorites.length >= MAX_FAVORITES) {
      if (window.logEntry) {
        logEntry(`Favorites full (max ${MAX_FAVORITES}) — remove one first`, 'err');
      }
      return false;
    }

    favorites.push({
      channel:       ch.channel,
      name:          ch.name || '',
      frequency_mhz: ch.frequency_mhz || 0,
    });
    save();
    renderBar();
    renderStars();
    if (window.logEntry) logEntry(`Channel ${ch.channel} added to favorites`, 'ok');
    return true;
  }

  function remove(channel) {
    favorites = favorites.filter(f => f.channel !== channel);
    save();
    renderBar();
    renderStars();
    if (window.logEntry) logEntry(`Channel ${channel} removed from favorites`, 'info');
  }

  /* ── Dashboard bar render ────────────────────────────────────── */

  function renderBar() {
    const bar   = document.getElementById('fav-bar');
    const empty = document.getElementById('fav-bar-empty');
    if (!bar) return;

    if (favorites.length === 0) {
      bar.innerHTML = `<span class="fav-bar-empty" id="fav-bar-empty">
        No favorites yet — star a channel in Channels tab to pin it here
      </span>`;
      return;
    }

    bar.innerHTML = favorites.map(f => {
      const freqStr = f.frequency_mhz > 0 ? f.frequency_mhz.toFixed(4) : '';
      return `
        <button class="fav-chip" data-ch="${f.channel}" title="Jump to CH ${f.channel}${f.name ? ' — ' + escHtml(f.name) : ''}">
          <span class="fav-chip-ch">CH ${f.channel}</span>
          ${f.name ? `<span class="fav-chip-name">${escHtml(f.name)}</span>` : ''}
          ${freqStr ? `<span class="fav-chip-freq">${freqStr}</span>` : ''}
          <span class="fav-chip-remove" data-ch="${f.channel}" title="Remove favorite">✕</span>
        </button>`;
    }).join('');

    // Wire jump (click chip body) and remove (click ✕) separately
    bar.querySelectorAll('.fav-chip').forEach(chip => {
      chip.addEventListener('click', async (e) => {
        // If the remove ✕ was clicked, handle removal instead of jumping
        if (e.target.classList.contains('fav-chip-remove')) {
          e.stopPropagation();
          remove(parseInt(e.target.dataset.ch));
          return;
        }
        const ch = parseInt(chip.dataset.ch);
        const res = await apiFetch(`/api/channel/${ch}`, 'POST');
        if (window.logEntry) {
          logEntry(
            res.success ? `Jumped to favorite CH ${ch}` : `Jump failed — ${res.message}`,
            res.success ? 'ok' : 'err'
          );
        }
      });
    });
  }

  /* ── Channel table star buttons ──────────────────────────────── */

  function renderStars() {
    // Re-render star state on any visible star buttons in the channel table
    document.querySelectorAll('.ch-star-btn').forEach(btn => {
      const ch = parseInt(btn.dataset.ch);
      btn.classList.toggle('starred', isFavorited(ch));
      btn.textContent = isFavorited(ch) ? '★' : '☆';
    });
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ── Init ────────────────────────────────────────────────────── */

  function init() {
    load();
    renderBar();
  }

  return {
    init,
    toggle,
    add,
    remove,
    isFavorited,
    renderBar,
    renderStars,
    get count() { return favorites.length; },
    get max()   { return MAX_FAVORITES; },
  };

})();

window.Favorites = Favorites;
