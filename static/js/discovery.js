/* BC125AT Web Controller — discovery.js
   Discovery Mode — surfaces unknown frequencies found during search.

   A "discovery" is a History entry where:
     - channel_id === 0  (scanner found it during Search, not a programmed channel)
     - The frequency doesn't match any programmed channel within ±5 kHz

   Discovered frequencies are flagged with is_discovery=true on their
   History entry, shown with a 🔍 badge, and counted in a badge on the
   History tab toggle button.

   The Discoveries filter button in the History toolbar shows ONLY
   discovered frequencies. Each discovery row has a "+ Add" button to
   open the channel editor pre-filled with the frequency.
*/

const Discovery = (() => {

  const FREQ_TOLERANCE = 0.005;   // ±5 kHz in MHz
  let   active         = false;   // filter is on/off

  /* ── Is this frequency a discovery? ─────────────────────────────── */
  function isUnknown(freq_mhz) {
    if (!freq_mhz || freq_mhz <= 0) return false;
    // Check against the ChSearch allChannels cache
    if (window.ChSearch && typeof ChSearch.getAllChannels === 'function') {
      const all = ChSearch.getAllChannels();
      if (all.length > 0) {
        return !all.some(ch =>
          ch.frequency_mhz > 0 &&
          Math.abs(ch.frequency_mhz - freq_mhz) <= FREQ_TOLERANCE
        );
      }
    }
    // If channels haven't loaded yet, can't confirm — don't flag as discovery
    return false;
  }

  /* ── Tag history entries as discoveries ──────────────────────────── */
  function tagEntries(entries) {
    let count = 0;
    entries.forEach(e => {
      // Only entries from search mode (channel === 0)
      if (e.channel === 0 && e.frequency > 0 && isUnknown(e.frequency)) {
        e.is_discovery = true;
        count++;
      } else {
        e.is_discovery = false;
      }
    });
    return count;
  }

  /* ── Count discoveries ──────────────────────────────────────────── */
  function countDiscoveries(entries) {
    return entries.filter(e => e.is_discovery).length;
  }

  /* ── Update badge count ─────────────────────────────────────────── */
  function updateBadge(entries) {
    const badge = document.getElementById('hist-discovery-count');
    if (!badge) return;
    const count = countDiscoveries(entries);
    badge.textContent = count > 0 ? count : '';
  }

  /* ── Filter toggle ──────────────────────────────────────────────── */
  function toggle() {
    active = !active;
    const btn = document.getElementById('hist-discovery-toggle');
    if (btn) btn.classList.toggle('active', active);

    // Clear text filter when switching to discovery view
    if (active) {
      const filterInput = document.getElementById('hist-filter');
      if (filterInput && filterInput.value) filterInput.value = '';
    }

    // Re-render History with new filter state
    if (window.History) History.render();
  }

  /* ── Filter function — called by History.filtered() ─────────────── */
  function filterEntries(entries) {
    return active ? entries.filter(e => e.is_discovery) : entries;
  }

  /* ── Open channel editor pre-filled with a discovered frequency ──── */
  function openAddChannel(freq_mhz, modulation) {
    // Find the next free channel slot or use the channel editor
    // We'll open the Channels tab and trigger a new channel dialog
    // Pre-fill the frequency in the channel edit modal

    // Switch to Channels tab
    const channelsBtn = document.querySelector('.tab-btn[data-tab="channels"]');
    if (channelsBtn) channelsBtn.click();

    // Wait briefly for tab to render, then open edit modal for a new channel
    setTimeout(() => {
      if (window.openEditModal) {
        openEditModal({
          channel:       0,        // 0 = new channel (user picks number)
          name:          '',
          frequency_mhz: freq_mhz,
          frequency_hz:  Math.round(freq_mhz * 1_000_000),
          modulation:    modulation || 'FM',
          ctcss_dcs:     '0',
          delay:         '2',
          locked_out:    false,
          priority:      false,
        });
      } else if (window.logEntry) {
        // Fallback: log the frequency so user can add it manually
        logEntry(
          `Discovery: ${freq_mhz.toFixed(4)} MHz ${modulation} — open Channels to add`,
          'ok'
        );
      }
    }, 300);
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  function init() {
    const btn = document.getElementById('hist-discovery-toggle');
    if (btn) btn.addEventListener('click', toggle);
  }

  return {
    init,
    toggle,
    tagEntries,
    filterEntries,
    updateBadge,
    isUnknown,
    openAddChannel,
    get isActive() { return active; },
  };

})();

window.Discovery = Discovery;
