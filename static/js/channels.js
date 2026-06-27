/* BC125AT — channels.js  Phase 6 channel manager */

const chState = {
  currentBank:    1,
  channels:       [],
  editingChannel: null,
};

const chEls = {
  tbody:      document.getElementById('ch-tbody'),
  rangeLabel: document.getElementById('ch-range-label'),
  loadBtn:    document.getElementById('ch-load-btn'),
  modal:      document.getElementById('ch-modal'),
  modalTitle: document.getElementById('modal-title'),
  modalClose: document.getElementById('modal-close'),
  modalSave:  document.getElementById('modal-save'),
  modalCancel:document.getElementById('modal-cancel'),
  editName:   document.getElementById('edit-name'),
  editFreq:   document.getElementById('edit-freq'),
  editMod:    document.getElementById('edit-mod'),
  editCtcss:  document.getElementById('edit-ctcss'),
  editDelay:  document.getElementById('edit-delay'),
  editLockout:document.getElementById('edit-lockout'),
  editPriority:document.getElementById('edit-priority'),
};

/* ── Bank selection ── */
document.querySelectorAll('.bank-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bank-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chState.currentBank = parseInt(btn.dataset.bank);
    const start = (chState.currentBank - 1) * 50 + 1;
    const end   = chState.currentBank * 50;
    if (chEls.rangeLabel) chEls.rangeLabel.textContent = `CH ${start}–${end}`;
  });
});

/* ── Load bank ── */
async function loadBank(bank) {
  bank = bank || chState.currentBank;
  chState.currentBank = bank;

  // Highlight active bank button
  document.querySelectorAll('.bank-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.bank) === bank);
  });

  const start = (bank - 1) * 50 + 1;
  const end   = bank * 50;
  if (chEls.rangeLabel) chEls.rangeLabel.textContent = `CH ${start}–${end}`;

  if (chEls.tbody) {
    chEls.tbody.innerHTML = `
      <tr><td colspan="9" class="ch-loading">
        <div class="ch-progress-wrap">
          <div class="ch-progress-bar" id="ch-progress-bar"></div>
        </div>
        Loading channels ${(bank-1)*50+1}–${bank*50}…
        <span class="ch-progress-pct" id="ch-progress-pct">0%</span>
      </td></tr>`;
  }

  // Animate progress bar while waiting (we can't stream so simulate progress)
  let pct = 0;
  const progressInterval = setInterval(() => {
    pct = Math.min(pct + 2, 90);   // advance to 90%, hold until real response
    const bar = document.getElementById('ch-progress-bar');
    const lbl = document.getElementById('ch-progress-pct');
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = pct + '%';
  }, 100);

  const res = await apiFetch(`/api/channels?bank=${bank}`);
  clearInterval(progressInterval);

  // Complete the bar
  const bar = document.getElementById('ch-progress-bar');
  const lbl = document.getElementById('ch-progress-pct');
  if (bar) bar.style.width = '100%';
  if (lbl) lbl.textContent = '100%';

  if (!res.success) {
    if (chEls.tbody) {
      chEls.tbody.innerHTML = `<tr><td colspan="9" class="ch-empty">Failed to load — ${res.message}</td></tr>`;
    }
    return;
  }

  chState.channels = res.data.channels;
  renderChannels(chState.channels);
}

/* ── Render table ── */
function renderChannels(channels) {
  if (!chEls.tbody) return;

  if (!channels.length) {
    chEls.tbody.innerHTML = '<tr><td colspan="9" class="ch-empty">No channels found</td></tr>';
    return;
  }

  chEls.tbody.innerHTML = channels.map(ch => `
    <tr data-ch="${ch.channel}">
      <td class="ch-num">${ch.channel}</td>
      <td class="ch-name">${ch.name || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="ch-freq">${ch.frequency_mhz > 0 ? ch.frequency_mhz.toFixed(4) + ' MHz' : '—'}</td>
      <td>${ch.modulation || '—'}</td>
      <td>${ch.ctcss_dcs && ch.ctcss_dcs !== '0' ? ch.ctcss_dcs : '—'}</td>
      <td>${ch.delay ?? '2'}s</td>
      <td><span class="ch-badge ${ch.locked_out ? 'on' : ''}">${ch.locked_out ? 'YES' : 'no'}</span></td>
      <td><span class="ch-badge ${ch.priority ? 'on' : ''}">${ch.priority ? 'YES' : 'no'}</span></td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="ch-action-btn jump" data-ch="${ch.channel}">Jump</button>
          <button class="ch-action-btn edit" data-ch="${ch.channel}">Edit</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Wire jump buttons
  chEls.tbody.querySelectorAll('.jump').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ch  = parseInt(btn.dataset.ch);
      const res = await apiFetch(`/api/channel/${ch}`, 'POST');
      if (window.logEntry) {
        logEntry(
          res.success ? `Jumped to CH ${ch}` : `Jump failed — ${res.message}`,
          res.success ? 'ok' : 'err'
        );
      }
    });
  });

  // Wire edit buttons
  chEls.tbody.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const ch = chState.channels.find(c => c.channel === parseInt(btn.dataset.ch));
      if (ch) openEditModal(ch);
    });
  });
}

/* ── Edit modal ── */
function openEditModal(ch) {
  chState.editingChannel = ch;
  if (chEls.modalTitle) chEls.modalTitle.textContent = `Edit Channel ${ch.channel}`;
  if (chEls.editName)    chEls.editName.value    = ch.name || '';
  if (chEls.editFreq)    chEls.editFreq.value    = ch.frequency_mhz > 0 ? ch.frequency_mhz : '';
  if (chEls.editMod)     chEls.editMod.value     = ch.modulation || 'FM';
  if (chEls.editCtcss)   chEls.editCtcss.value   = ch.ctcss_dcs || '0';
  if (chEls.editDelay)   chEls.editDelay.value   = ch.delay || '2';
  if (chEls.editLockout) chEls.editLockout.checked = ch.locked_out;
  if (chEls.editPriority)chEls.editPriority.checked = ch.priority;
  if (chEls.modal)       chEls.modal.style.display = 'flex';
}

function closeModal() {
  if (chEls.modal) chEls.modal.style.display = 'none';
  chState.editingChannel = null;
}

if (chEls.modalClose)  chEls.modalClose.addEventListener('click',  closeModal);
if (chEls.modalCancel) chEls.modalCancel.addEventListener('click', closeModal);
if (chEls.modal) {
  chEls.modal.addEventListener('click', e => {
    if (e.target === chEls.modal) closeModal();
  });
}

if (chEls.modalSave) {
  chEls.modalSave.addEventListener('click', async () => {
    const ch = chState.editingChannel;
    if (!ch) return;

    const freqMhz = parseFloat(chEls.editFreq.value);
    const freqHz  = freqMhz > 0 ? Math.round(freqMhz * 1_000_000) : 0;

    chEls.modalSave.disabled   = true;
    chEls.modalSave.textContent = 'Saving…';

    const res = await apiFetch(`/api/channel/${ch.channel}`, 'PUT', {
      name:        chEls.editName.value.trim(),
      frequency_hz:freqHz,
      modulation:  chEls.editMod.value,
      ctcss_dcs:   chEls.editCtcss.value || '0',
      delay:       chEls.editDelay.value,
      locked_out:  chEls.editLockout.checked,
      priority:    chEls.editPriority.checked,
    });

    chEls.modalSave.disabled    = false;
    chEls.modalSave.textContent = 'Save Channel';

    if (res.success) {
      closeModal();
      if (window.logEntry) logEntry(`Channel ${ch.channel} saved`, 'ok');
      loadBank(chState.currentBank);  // reload to show updated data
    } else {
      if (window.logEntry) logEntry(`Save failed — ${res.message}`, 'err');
    }
  });
}

/* ── Load bank button ── */
if (chEls.loadBtn) {
  chEls.loadBtn.addEventListener('click', () => loadBank(chState.currentBank));
}

/* Expose for tabs.js */
window.loadBank = loadBank;
