# Changelog

All notable changes to the BC125AT Web Controller are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions.
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.7.29] — Scanner Audio Streaming

### Added
- `api/stream.py` — audio streaming backend module
- `GET /stream/audio` — infinite chunked HTTP response streaming raw PCM
  audio from the system default input (same line-in used for recording)
  with a WAV header prepended so browsers can decode it natively
- **Live Audio** toggle in the Dashboard Recording panel — ON/OFF button
  identical in style to Auto-Record and Smart Resume toggles
- Small native `<audio>` element appears when streaming is ON — the
  browser's built-in player handles buffering, volume, and controls
- Status text shows: Connecting… → ● Live → Buffering… / error messages
- CSS `filter: invert(1) hue-rotate(180deg)` applied to the `<audio>`
  element to make the browser's native player match the dark UI theme

#### Architecture — HTTP chunked streaming
Used HTTP chunked transfer rather than WebSocket for maximum simplicity
and browser compatibility. The browser treats `/stream/audio` exactly
like an internet radio stream. No encoding library required — raw 16-bit
PCM at 44100 Hz mono is sent directly after a 44-byte WAV header.

Key design decisions:
- **Single shared sounddevice stream** — only one `InputStream` is opened
  regardless of how many browser tabs connect. All clients subscribe to
  a broadcast queue; the stream stops automatically when the last client
  disconnects
- **Cache-busting param** on `audio.src` prevents the browser from
  serving a stale cached stream on reconnect
- **Autoplay catch** — if the browser blocks autoplay (common security
  policy), the player shows "Click play to start" rather than silently
  failing
- **`X-Accel-Buffering: no`** header disables nginx proxy buffering
  if the app is ever deployed behind a reverse proxy
- WAV chunk_size set to `0xFFFFFFFF` (max uint32) rather than
  `data_size + 36` to avoid integer overflow in `struct.pack`

#### Requirements
- Same line-in connection already used for recording
- `sounddevice` already installed (same dependency as manual recording)
- No additional Python packages needed

### Changed
- `app.py` — `stream_audio()` route added; imports `audio_stream_generator`
  from `api.stream`; returns `Response(stream_with_context(...), mimetype="audio/wav")`
- `templates/index.html` — Live Audio row and audio player div added to
  Recording panel below Auto-Record
- `static/js/main.js` — `AudioStream` module appended with `start()`,
  `stop()`, `toggle()`, `init()`; wired to toggle button click
- `static/css/style.css` — `.audio-stream-row`, `.audio-stream-player`,
  `.audio-stream-status` styles added; `audio { filter: invert }` for
  dark theme compatibility

---

## [0.7.28] — Mini Heatmap on Dashboard

### Added
- **Mini Signal Heatmap** on the Dashboard — compact version of the Status
  tab heatmap, placed in the empty space below the Backlight controls in
  the levels panel
- 6 condensed frequency bands × 24 hourly buckets (24 hours of activity)
- Same green gradient color scheme as the full heatmap
- Hover tooltip shows band, hour, and transmission count inline below
  the grid (not a floating overlay, to keep the dashboard clean)
- Auto-refreshes every 5 minutes while the Dashboard tab is open
- Re-renders immediately whenever a new History entry is added, so it
  stays live as transmissions are logged

#### Differences from the full Status tab heatmap
| | Full Heatmap | Mini Heatmap |
|---|---|---|
| Time buckets | 48 × 30 min | 24 × 60 min |
| Frequency bands | 8 | 6 (merged some ranges) |
| Cell height | 22px | 14px |
| Tooltip | Fixed bottom overlay | Inline text below grid |
| Location | Status tab | Dashboard levels panel |

### Changed
- `templates/index.html` — mini heatmap panel added to dashboard levels
  column between Backlight and the right column divider
- `static/js/status.js` — `MiniHeatmap` module appended with 6-band
  config, 24-bucket grid builder, color function, render, and 5-min
  auto-refresh interval
- `static/js/main.js` — `MiniHeatmap.render()` called on
  `DOMContentLoaded`
- `static/js/history.js` — `MiniHeatmap.render()` called inside
  `addEntry()` so the mini heatmap updates the moment a new
  transmission is logged
- `static/css/style.css` — `.mini-heatmap-group`, `.mini-heatmap-wrap`,
  `.mini-heatmap-y`, `.mini-heatmap-grid`, `.mini-heatmap-cell`,
  `.mini-heatmap-tooltip` styles added

---

## [0.7.27] — Signal Heatmap

### Added
- **Signal Heatmap** in the Status tab — 2D grid showing transmission
  activity across frequency bands and time for the last 24 hours
- Zero new backend code — reads directly from the existing
  `bc125at_history` localStorage data

#### Layout
- **X axis:** last 24 hours divided into 48 × 30-minute buckets
- **Y axis:** 8 frequency bands covering the BC125AT's full range:

| Band | Range | Services |
|---|---|---|
| 25–50 MHz | VHF Low | CB, business |
| 50–108 MHz | VHF | 6m amateur, FM broadcast |
| 108–137 MHz | Air band | Aviation voice |
| 137–174 MHz | VHF High | Public safety, amateur, NOAA |
| 174–225 MHz | VHF UHF | TV, 1.25m amateur |
| 225–400 MHz | Military | Military aviation |
| 400–450 MHz | UHF Low | Public safety, business |
| 450–512 MHz | UHF High | Public safety, amateur, business |

- **Cell color:** dark background = no activity; green gradient scales
  from dim (1 transmission) to bright (most active cell in the window)
- **Hover tooltip:** shows exact frequency band, time range, and
  transmission count for any cell
- **Legend bar** in the header: None → Active gradient

#### Technical details
- `buildGrid()` bins each History entry into `[band][time_bucket]` using
  the entry's `frequency` and `timestamp` fields
- Color scaling is relative to the maximum count in the current window —
  if the busiest cell has 5 transmissions, each step is 20% brightness
- Cells outside the 24-hour window are ignored
- Heatmap re-renders every time the Status tab is opened

### Changed
- `templates/index.html` — heatmap section added above the Recordings
  section in the Status tab; contains y-axis, grid, x-axis, legend,
  and tooltip elements
- `static/js/status.js` — `Heatmap` module appended with `buildGrid()`,
  `cellColor()`, `formatBucket()`, and `render()` functions; `render()`
  called from `Status.render()`
- `static/css/style.css` — `.heatmap-wrap`, `.heatmap-grid`,
  `.heatmap-cell`, `.heatmap-y-axis`, `.heatmap-x-axis`,
  `.heatmap-tooltip`, `.heatmap-legend` styles added

---

## [0.7.26] — Discovery Mode

### Added
- `static/js/discovery.js` — Discovery Mode module
- **🔍 Discoveries** filter button in the History tab toolbar — same
  style as the Lockouts toggle in the Channels tab
- Discovery count badge on the toggle button — updates live as channels
  load and as new transmissions are logged
- **🔍 badge** in the first column of History rows for discovered
  frequencies — subtle blue row highlight distinguishes them from normal entries
- **+ Add** button on each discovery row — switches to the Channels tab
  and opens the channel editor pre-filled with the discovered frequency
  and modulation so you can program it with one action

#### What counts as a discovery
An entry is flagged as a discovery when **both** conditions are true:
1. `channel_id === 0` — the scanner found it during Search mode, not
   while scanning programmed channels
2. The frequency doesn't match any programmed channel within ±5 kHz
   (checked against the `ChSearch.getAllChannels()` cache — the same
   500-channel cache loaded in the background by the Channels tab)

If channels haven't loaded yet, nothing is flagged (avoids false
positives). The tagging runs on every `History.render()` call so the
badge and row highlights update as soon as more channel data arrives.

#### How to use
1. Open the Channels tab — channel data loads in the background
2. Press Search (or `R`) to sweep your custom search ranges
3. Frequencies found during search appear in History
4. Unknown frequencies (not in your 500 programmed channels) are
   flagged with a 🔍 badge and counted in the toolbar button
5. Click **🔍 Discoveries** to filter the History table to unknowns only
6. Click **+ Add** on any row to program it into a channel

### Changed
- `templates/base.html` — `discovery.js` added to script load order
  (position 6, before `favorites.js` and `main.js`)
- `templates/index.html` — Discoveries toggle button added to History
  toolbar; blank `<th>` column added to History table header;
  `colspan` updated from `7` to `8` on placeholder rows
- `static/js/history.js` — `filtered()` now calls
  `Discovery.tagEntries()`, `Discovery.updateBadge()`, and
  `Discovery.filterEntries()` before applying text filter;
  🔍 badge column and `+ Add` button rendered in each row;
  `+ Add` button wiring calls `Discovery.openAddChannel()`;
  `Discovery.init()` called from `History.init()`;
  `entries` getter added to public API
- `static/js/channels.js` — `Discovery.updateBadge()` called after
  each bank loads so the badge stays current as channel data arrives
- `static/css/style.css` — `.hist-discovery-row`, `.hist-disc-badge`,
  `#hist-discovery-toggle.active` styles added

---

## [0.7.25] — Session Recording Bug Fix: Deadlock

### Fixed
Session recorder never started recording despite being enabled and the
scanner dwelling on a frequency.

**Root cause:** `on_state()` held `self._lock` while calling
`_schedule_start()`, which created a `threading.Timer`. When the timer
fired 0.8s later, `_start_if_still_dwelling()` tried to acquire
`self._lock` — which was still held by the original thread. Classic
deadlock: timer thread waited forever, recording never started, no error.

**Fix:** Introduced a `start_timer` boolean flag set inside the lock,
then called `_schedule_start()` after the lock is released. Timer fires
cleanly, acquires lock, starts recording.

Verified with a simulation: 5 state pushes → dwell timer fires after 0.8s
→ frequency change detected → new timer started. No deadlock.

### Changed
- `recorder/session_recorder.py` — `on_state()` restructured: `start_timer`
  flag set inside lock, `_schedule_start()` called after lock releases

---

## [0.7.24] — Session Recording Bug Fix: squelch_open Dependency

### Fixed
Session recorder never triggered because it watched `squelch_open` for
the rising edge, same unreliable flag that broke History and Smart Resume.

**Fix:** Replaced squelch_open trigger with frequency-stability tracking
— identical approach to Activity History. Scanner must dwell on a
frequency for `MIN_DWELL_S` (0.8s) before recording starts. When
frequency changes, recording stops and duration is calculated.

### Changed
- `recorder/session_recorder.py` — `on_state()` rewritten with
  `_dwell_freq`/`_dwell_start`/`_dwell_timer` state; `_schedule_start()`
  and `_start_if_still_dwelling()` added; `enable()`/`disable()` reset
  frequency tracking state; `MIN_DWELL_S`, `FREQ_TOLERANCE` constants added;
  `squelch_open` removed from all functional code paths

---

## [0.7.23] — Session Recording

### Added
- `recorder/session_recorder.py` — `SessionRecorder` class that wraps the
  existing manual `Recorder` and drives it automatically from squelch state
- Every transmission that opens squelch gets its own WAV file, named with
  a rich human-readable format: `2026-06-29_14-32-05_483.4125MHz_RCPD-Disp.wav`
- JSON sidecar file written alongside each WAV after the tail completes:
  `2026-06-29_14-32-05_483.4125MHz_RCPD-Disp.json` — contains timestamp,
  frequency, channel ID, channel name, modulation, and duration in seconds
- Transmissions shorter than 0.5 seconds (`MIN_DURATION_S`) are
  automatically deleted after the tail — avoids saving noise bursts that
  barely opened squelch
- **Auto-Record toggle** in the Dashboard Recording panel — same green
  ON/OFF button style as Smart Resume; state reflected live from the
  scanner state push
- **🔊 play button** in History tab rows — appears when a session recording
  has been matched to that history entry (by timestamp + frequency proximity)
- `matchRecordings()` in `history.js` — fetches the recordings index and
  matches each recording to a history entry within ±10 seconds and ±5 kHz;
  called on History tab init and every time the History tab is opened

#### New API endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/api/session-recording/status` | Current session recording state |
| POST | `/api/session-recording/enable` | Enable auto-recording |
| POST | `/api/session-recording/disable` | Disable auto-recording |
| GET | `/api/recordings/index` | All recordings with sidecar metadata |

### Changed
- `recorder/recorder.py` — `start()` now accepts optional `name` parameter;
  if provided, it is used as the WAV filename directly (enables rich filenames
  from `SessionRecorder`) instead of the default `YYYYMMDD_HHMMSS_ch_freq.wav`
  scheme
- `app.py` — `SessionRecorder` imported and instantiated; wired into
  `on_scanner_state()` callback so every state push calls
  `session_recorder.on_state(state)`; session recorder status included in
  every `scanner_state` SocketIO push
- `api/routes.py` — four new endpoints added; `config` import fixed in
  `recordings_index()` (same issue as v0.7.13 status page fix)
- `templates/index.html` — Auto-Record row added below manual record buttons
- `static/js/main.js` — `toggleSessionRecording()`, `applySessionRecState()`
  added; toggle click handler wired
- `static/js/socket.js` — `applySessionRecState(state)` called in
  `scanner_state` handler
- `static/js/history.js` — `matchRecordings()` added and exported; 🔊 play
  button rendered in status column when `recording_url` is set on entry;
  called from `init()` and History public API
- `static/js/tabs.js` — `History.matchRecordings()` called when History
  tab opens
- `static/css/style.css` — `.session-rec-row`, `.session-rec-status`,
  `.hist-play-btn` styles added

---

## [0.7.22] — Smart Resume: Immediate Skip on Block

### Fixed
When a frequency was blocked while the scanner was already sitting on it,
the scanner did not move. The auto-skip fires on squelch rising edge — but
that edge had already fired before the block was added, so nothing happened
until the next time the scanner returned to that frequency.

**Fix:** `blockFreq()` now checks immediately after adding a frequency
whether `lastState.frequency_mhz` matches the newly blocked frequency
(within ±5 kHz). If it does, `sendResume()` is called right away without
waiting for the next rising edge.

### Changed
- `static/js/smartresume.js` — `blockFreq()` calls `sendResume()` and
  shows status message if current frequency matches the one just blocked

---

## [0.7.21] — Smart Resume: Block Button Always Visible

### Fixed
The block button (⊘ Block X.XXXX MHz) never appeared because it was gated
behind `squelch_open === true`. With squelch at higher settings the scanner
rarely registers squelch as open in the state push, so the button was
almost never visible.

**Fix:** The block button now shows whenever Smart Resume is ON and there
is a valid frequency on screen. The `squelch_open` check is retained only
for the auto-skip rising-edge logic where it belongs. Manual blocking does
not require squelch to be open.

### Changed
- `static/js/smartresume.js` — `updateBlockBtn()` signature changed from
  `(freq_mhz, sqlOpen)` to `(freq_mhz)`; `sqlOpen` guard removed from
  button visibility; call site updated to `updateBlockBtn(freq)`
- `templates/index.html` — block button moved above status text in panel
  for better visibility

---

## [0.7.20] — Smart Resume Rewrite: Frequency Blocklist Engine

### Changed — Complete architectural rethink

After multiple iterations of audio-based Voice Activity Detection (VAD)
producing unreliable results (misclassifying noise as voice and vice versa
~97% of the time), Smart Resume has been fundamentally redesigned.

**Why VAD failed for this use case:**
Radio noise — intermod, CB interference, band noise, carrier hum — is a
modulated signal with spectral structure. Every audio property we measured
(ZCR, silence ratio, spectral variance, amplitude variance) produced values
that overlapped significantly between real voice and the types of noise
found on a scanner. Browser-based audio analysis on a consumer line-in
cannot reliably distinguish radio noise from voice without hardware-level
carrier deviation and tone detection that the BC125AT does not expose over
serial.

**New approach — Frequency Blocklist:**
Smart Resume is now a blocklist engine. When it is ON and squelch opens on
a frequency that is in the blocklist, the resume key is sent **instantly**
— no audio analysis, no waiting, no false positives. Every other frequency
is left completely alone.

This mirrors how experienced scanner users actually handle persistent noise:
identify the offending frequencies and lockout or skip them rather than
trying to detect them automatically in real time.

#### How to use
1. Enable Smart Resume (toggle ON)
2. Scan normally — when squelch opens on a noisy frequency, a red
   **⊘ Block X.XXXX MHz** button appears in the Smart Resume panel
3. Click it — that frequency is immediately added to the blocklist
4. Next time squelch opens on that frequency, Smart Resume skips it instantly
5. Click **Manage** to see all blocked frequencies and remove any individually
6. **⊘** buttons also appear on every row in the History tab — block any
   previously logged frequency directly from the transmission history

#### Technical details
- Match tolerance: ±5 kHz (BC125AT minimum step size) — handles slight
  frequency drift without false matches
- Skip behaviour: instant on squelch rising edge, no delay
- Resume key: `KEY,R` (search) if scanner is in search mode,
  `KEY,S` (scan) if in channel scan mode — preserves the current mode
- Storage: `localStorage` keys `bc125at_sr_enabled` and `bc125at_sr_blocked`
- Maximum 50 blocked frequencies
- Toggle/unblock also available from the button (shows ✓ if already blocked)

### Removed
- All Web Audio API code (AudioContext, AnalyserNode, FFT, time-domain data)
- ZCR (Zero Crossing Rate) algorithm
- Silence ratio tracking
- Spectral variance analysis
- Amplitude variance over time
- Sensitivity slider and sensitivity readout label
- All associated CSS for VAD indicator states

### Files changed
- `static/js/smartresume.js` — complete rewrite (~300 lines → ~200 lines)
- `templates/index.html` — Smart Resume panel simplified: removed slider,
  indicator, and feedback row; added block button, count badge, manage
  button, blocklist panel, and clear-all button
- `static/js/history.js` — ⊘ block button added to each History row;
  wired to `SmartResume.blockFreq()` / `SmartResume.unblockFreq()`
- `static/css/style.css` — VAD CSS removed; blocklist panel, block button,
  and row styles added

---

## [0.7.19] — Smart Resume: Restore Output on Squelch Close

### Fixed

#### "Noise — resuming" / "Voice — staying" messages and activity log entries
stopped appearing after v0.7.18 squelch guard was added.

**Root cause:** When squelch closed mid-analysis (transmission shorter than
the full 800ms dwell + 2.5s window = ~3.3s), the new squelch guard called
`stopListening()` and returned — silently discarding all the votes collected
so far without ever calling `decide()`. No activity log entry, no status
display text, no indicator — the user had no visibility into what Smart
Resume was doing.

**Fix:** When squelch closes while analysis is already running, call
`stopListening()` to stop sampling frames, then immediately call `decide()`
with whatever votes have been collected so far rather than discarding them.
This produces the correct output in all cases:
- Transmission > 3.3s — full 2.5s window completes naturally → `decide()`
- Transmission 0.8s–3.3s — squelch closes mid-window → early `decide()`
  with partial votes → still logs "Voice — staying" or "Noise — resuming"
- Transmission < 0.8s — squelch closes before dwell timer fires →
  timer cleared, `decide()` not called (no votes = no decision, correct)
- No signal — squelch never opens → guard returns immediately, silent

### Changed
- `static/js/smartresume.js` — squelch-close branch in `onState()`:
  if `isListening`, calls `stopListening()` then `decide()` (early
  decision); if not yet listening, just clears the pending dwell timer

---

## [0.7.18] — Smart Resume Root Cause Fix: Squelch Guard

### Fixed

#### Smart Resume auto-scanning even without a signal

The v0.7.17 grace period was a workaround, not the actual fix. The real
root cause was a fundamental design flaw in the VAD trigger logic.

**Root cause:** `onState()` started the dwell timer on every frequency the
scanner paused on, regardless of whether squelch was open or not. When the
scanner is actively scanning and briefly stops on each channel (squelch
**closed**, no signal), Smart Resume would still fire after 800ms and run
the 2.5 second audio analysis. With squelch closed, the audio is
near-silent, producing low ZCR and low amplitude variance — which the
decision logic classified as neither voice nor noise, but defaulted the
`else` branch to `noiseVotes++`. After 2.5 seconds of silence,
`noiseVotes` won the majority vote and `KEY,scan` was sent — even though
there was never a signal at all.

**Fix:** `onState()` now checks `squelch_open` before doing anything.

```
if (!squelch_open) {
  // Cancel any analysis in progress
  // Clear dwell timer
  return;
}
// Only reach here when a signal is actually breaking squelch
```

Three scenarios now work correctly:

| Scenario | Result |
|---|---|
| Scanner scanning, squelch closed (no signal) | Immediate return — no timer, no VAD |
| Scanner stops on signal (squelch opens) | Dwell timer starts → VAD analysis |
| Squelch opens then closes before 2.5s window | Analysis cancelled, timer cleared |

The v0.7.17 grace period (`SR_GRACE_MS = 5000`) and mode-aware resume key
(`KEY,R` for search mode vs `KEY,S` for scan mode) are both retained as
they remain useful for their intended purposes.

### Changed
- `static/js/smartresume.js` — `onState()` completely reworked:
  - Reads `sqlOpen = !!state.squelch_open` on every call
  - If squelch is closed: cancels any active listening, clears dwell timer,
    resets `srDwellFreq`, returns immediately
  - Only starts dwell timer when squelch is open
  - Timer callback double-checks `srLastState?.squelch_open` before calling
    `startListening()` to guard against the rare case where squelch closes
    between when the timer was set and when it fires
  - Console log updated: `[SmartResume] Signal on X MHz for 800 ms — starting VAD`
  - `[SmartResume] Squelch closed — analysis cancelled` logged when falling
    edge cancels an in-progress analysis

---

## [0.7.17] — Smart Resume Bug Fixes: Grace Period + Mode-Aware Resume

### Fixed

#### Bug 1 — Smart Resume auto-scans immediately on page load
**Root cause:** `srDwellFreq` starts as `null`. When the very first scanner
state push arrives after page load, `onState()` sets the dwell timer
immediately. 800ms later `startListening()` fires, analyses whatever audio
is present (often ambient noise since the line-in is always open), decides
NOISE, and sends `KEY,scan` — making it appear the page automatically
started scanning on its own.

**Fix:** A 5-second startup grace period (`SR_GRACE_MS = 5000`). The
module records `srStartedAt = Date.now()` when it loads. `onState()` now
returns immediately if `Date.now() - srStartedAt < SR_GRACE_MS`. After
5 seconds the scanner has settled and the user has had time to interact
before Smart Resume begins listening.

#### Bug 2 — Custom search range reverts to channel scan mid-search
**Root cause:** When Smart Resume decided a search-mode frequency was noise,
it always sent `KEY,S` (scan). On the BC125AT, pressing `S` puts the scanner
into **channel scan mode** regardless of what mode it was previously in. So
every time Smart Resume skipped a noisy frequency during a custom search, it
accidentally kicked the scanner back to scanning programmed channels.

**Fix:** Mode detection before sending the resume key. Smart Resume now
tracks the full last state in `srLastState`. When deciding to skip:
- If `channel_id === 0` → scanner is in search/service mode → sends `KEY,R`
  (search) to continue searching the custom range
- If `channel_id > 0` → scanner is in channel scan mode → sends `KEY,S`
  (scan) as before

The console now logs `[SmartResume] Resuming via KEY search (channel_id: 0)`
or `[SmartResume] Resuming via KEY scan (channel_id: 42)` for visibility.

### Changed
- `static/js/smartresume.js`:
  - `SR_GRACE_MS = 5000` constant and `srStartedAt = Date.now()` added at
    module scope
  - `srLastState = null` added to track latest full scanner state
  - `onState()` — early return if within grace period; sets `srLastState`
    on every call
  - `decide()` — `inSearchMode` check on `srLastState.channel_id`;
    `resumeKey` variable replaces hardcoded `'scan'`; fetch now uses
    template literal `` `/api/key/${resumeKey}` ``

---

## [0.7.16] — Search Range Programming

### Added
- **Custom Search Ranges panel** in the Settings tab — define and manage
  all 10 of the BC125AT's custom search frequency ranges directly from the
  browser, without touching the scanner's physical menu system

#### New scanner commands (`scanner/commands.py`)
Three genuine BC125AT serial commands confirmed against the official
protocol PDF (`BC125AT_Protocol.pdf`, Appendix C):
- **`CSG`** — Get/Set Custom Search Group: a 10-digit string controlling
  which of the 10 custom search ranges are enabled (wire encoding is
  inverted — `0`=enabled, `1`=disabled — normalised to friendly booleans)
- **`CSP`** — Get/Set Custom Search Settings: lower/upper frequency limits
  for a given search range index (1–10), in the same `×100 Hz` wire format
  used throughout the rest of the app
- **`SCO`** — Get/Set Search/Close Call Settings: search delay time and
  CTCSS/DCS search toggle

New functions: `get_custom_search_groups()`, `set_custom_search_groups()`,
`get_custom_search_range()`, `set_custom_search_range()`,
`get_all_custom_search_ranges()` (fetches all 10 ranges + enabled state in
one program mode session), `get_search_settings()`, `set_search_settings()`

#### New API endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/api/search/ranges` | Fetch all 10 custom search ranges |
| PUT | `/api/search/ranges/<index>` | Set lower/upper limits for one range |
| POST | `/api/search/groups` | Enable/disable ranges (10 booleans) |
| GET | `/api/search/settings` | Get search delay + CTCSS/DCS search toggle |
| POST | `/api/search/settings` | Set search delay + CTCSS/DCS search toggle |

#### UI
- 10-row list, each with an enable checkbox, lower MHz input, upper MHz
  input, and individual Save button
- Disabled ranges visually dim using `:has()` CSS selector targeting the
  unchecked toggle
- Validation client-side and server-side: lower must be less than upper,
  both must fall within 25.0000–512.0000 MHz, and at least one range must
  remain enabled at all times (matches the scanner's own restriction —
  it rejects disabling all 10 with `NG`)
- Search delay selector (-10 to 5 seconds) and CTCSS/DCS Search checkbox,
  saved together via the `SCO` command
- Refresh button reloads all 10 ranges from the scanner on demand
- Search ranges load automatically whenever the Settings tab is opened,
  alongside the existing serial/scan-group/priority settings

### Changed
- `scanner/scanner.py` — six new methods added mirroring the command
  functions; `get_all_custom_search_ranges()` pauses the background poll
  thread for the duration, same pattern as bulk channel reads
- `api/routes.py` — five new endpoints appended
- `templates/index.html` — Custom Search Ranges panel added to Settings
  tab, positioned after Priority Mode
- `static/js/settings.js` — `loadSearchRanges()`, `renderSearchRanges()`,
  `saveSearchRange()`, `applySearchRangeToggles()` added; hooked into the
  existing `loadSettings()` function
- `static/css/style.css` — `.search-ranges-header`, `.search-range-row`,
  `.sr-range-toggle`, `.sr-range-num`, `.search-settings-row` styles added
  with mobile responsive grid-area layout

### Research note
This feature was previously uncertain — the official protocol PDF was
re-checked specifically to confirm `CSG`/`CSP`/`SCO` exist as real,
documented commands before any code was written, following the lesson
learned from the Weather/Down key issue in v0.7.5 where assuming
functionality without scanner confirmation led to a broken feature.

---

## [0.7.15] — Favorites Manager / Quick-Access Bar

### Added
- `static/js/favorites.js` — self-contained favorites module, persisted to
  `localStorage` (key `bc125at_favorites`), capped at 10 favorites
- **★ Star button** added as the first column in every channel table view:
  normal bank browsing, search results, and the Lockout Manager — click to
  pin or unpin a channel from anywhere in the Channels tab
- **Favorites bar** on the Dashboard — built directly into the display
  panel below the frequency readout and status icons. Shows a chip for
  each pinned channel with channel number, name, and frequency
- Clicking a favorite chip instantly jumps the scanner to that channel via
  the existing `POST /api/channel/<ch>` endpoint
- Small ✕ remove button on each chip — unpins without needing to go back
  to the Channels tab
- Empty state message shown in the bar when no favorites are set yet,
  pointing the user to the Channels tab
- Cap enforcement — attempting to add an 11th favorite logs a message to
  the activity log instead of silently failing or evicting an existing one

#### Design notes
- Star state stays in sync across all three table views (bank, search,
  lockouts) — toggling a favorite from any one of them immediately
  updates the star icon if the same channel happens to be visible
  elsewhere, and always updates the Dashboard bar live
- `Favorites.renderStars()` is called whenever the Channels tab is opened
  so star icons always reflect current state even after navigating away
  and back
- Yellow/gold colour (`#fbbf24`) used consistently for the star icon and
  chip hover state — distinct from every other accent colour already in
  use (green, blue, amber, red) so favorites are visually unambiguous

### Changed
- `templates/base.html` — `favorites.js` added to script load order
  (position 6, before `status.js` and `main.js`)
- `templates/index.html` — favorites bar markup added inside the display
  panel; star column header (`<th></th>`) added to the channel table
- `static/js/channels.js` — star button added to all three row-rendering
  functions (`renderChannels`, search results render, Lockouts render);
  all `colspan="9"` placeholder rows updated to `colspan="10"` to account
  for the new column
- `static/js/main.js` — `Favorites.init()` added to `DOMContentLoaded`
- `static/js/tabs.js` — `Favorites.renderStars()` called when the
  Channels tab opens
- `static/css/style.css` — `.ch-star-btn`, `.fav-bar`, `.fav-chip`,
  `.fav-chip-ch`, `.fav-chip-name`, `.fav-chip-freq`, `.fav-chip-remove`
  styles added with mobile responsive sizing

---

## [0.7.14] — Smart Resume Sensitivity Live Readout

### Added
- Live readout label next to the Smart Resume Sensitivity slider —
  confirms the slider was already updating the underlying threshold on
  every move (it was), but added visual feedback since there was
  previously no indication of the current setting
- Five descriptive tiers based on slider position: **Very Aggressive**,
  **Aggressive**, **Balanced**, **Conservative**, **Very Conservative**
- Readout shows the *actual* threshold values being used, not just a
  label — e.g. `Balanced · ZCR 0.33 · Silence 6%+` — so it's transparent
  exactly what the slider controls under the hood
- Colour-coded readout pill: red tint for aggressive settings, amber for
  balanced, green for conservative — matches the colour language used
  elsewhere in the app (red=skip more, green=stay more)
- Readout updates immediately on every slider drag (the `input` event,
  not just on release) and also initialises correctly from the saved
  `localStorage` preference when the page first loads

### Changed
- `templates/index.html` — `sr-sens-readout` span added above the
  sensitivity slider; slider row restructured to a two-row layout
  (label + readout on top, slider with end labels below)
- `static/js/smartresume.js` — `getSensReadout()` element getter added;
  `updateSensReadout()` function added, computing the same ZCR and
  silence-ratio formulas used by `analyseFrame()` so the displayed
  numbers always match actual behaviour; called on both slider `init()`
  and every `input` event
- `static/css/style.css` — `.sr-sens-readout` pill style with three
  colour-coded state classes added; `.sr-row` flex layout added

### Note
The sensitivity slider was already functioning correctly — every drag
updated the `sensitivity` variable and persisted it to `localStorage`
immediately. This update adds the missing visual confirmation so it's
clear at a glance where the slider sits and what it's actually doing.

---

## [0.7.13] — Status Page Bug Fix: Missing config Import

### Fixed

#### Scanner info fields blank on Status page (Connection, Model, Firmware, Port, Battery)

**Root cause:** `get_full_status()` in `api/routes.py` referenced `config.RECORDINGS_DIR`,
`config.SCANNER_PORT`, `config.SCANNER_BAUD`, and `config.SCANNER_POLL_INTERVAL`
but the `config` module was never imported anywhere in `routes.py` — only
`current_app`, `request`, `jsonify`, and `Blueprint` were imported at the top
of the file. Every call to `/api/status/full` raised a `NameError` and
returned a `success: false` error envelope.

**Why Uptime still displayed a value:** `static/js/status.js` started an
independent `setInterval` ticker using `Date.now()` at page load time,
completely decoupled from whether the server request succeeded. It looked
like live data but was actually just counting time since the browser tab
opened, not the scanner's real connection time.

**Fix:**
- `api/routes.py` — added `from config import config as cfg` inside
  `get_full_status()`; all four `config.X` references updated to `cfg.X`
- `static/js/status.js` — `startUptimeTicker()` is no longer called
  unconditionally in `init()`. It now starts only inside
  `loadServerStatus()`, and only when `scanner.connected` is true and
  `uptime_seconds` was successfully returned from the server — using the
  real `connected_at` timestamp rather than browser page-load time
- When the scanner is disconnected, uptime now correctly shows `—` instead
  of a misleading running clock

### Changed
- `api/routes.py` — `get_full_status()` config import fixed
- `static/js/status.js` — `init()` simplified; uptime ticker logic moved
  inside `loadServerStatus()`'s success path

---

## [0.7.12] — Scanner Status Page

### Added
- **Status tab** — sixth tab in the nav bar, dedicated dashboard for
  scanner health and listening statistics
- `GET /api/status/full` — combined server-side status endpoint:
  connection state, model, firmware, port/baud, uptime (calculated from
  `connected_at` timestamp), battery voltage, and recordings folder stats
  (file count, total size, estimated total duration from WAV byte size)
- `scanner/scanner.py` — `connected_at` ISO timestamp now stored in state
  on every successful `connect()`, used to calculate live uptime

#### Status page sections
- **Scanner card grid** — connection status, uptime (live ticking), model,
  firmware, port/baud, battery voltage
- **This Session** — transmissions heard, transmissions skipped by Smart
  Resume, average transmission duration, transmissions per hour — computed
  client-side from Activity History entries logged since the page loaded
- **All Time** — same metrics computed across every entry ever logged in
  History (persists via the same `localStorage` data History already uses),
  plus a "Tracking Since" date showing the oldest logged entry
- **Busiest Channels** — top 8 most-active frequencies as a horizontal bar
  chart, sorted by transmission count, with channel name and occurrence
  count per row
- **Recordings** — total files, total estimated duration, disk space used

#### Design notes
- Session vs all-time stats both shown side by side rather than choosing
  one — session stats answer "what's happening right now", all-time stats
  answer "what's the bigger picture"
- All transmission statistics are computed from the same `bc125at_history`
  localStorage data already populated by the History tab — no duplicate
  tracking, no backend stats database needed
- Recording duration is estimated from WAV file size using the known
  encoding format (44100Hz, 16-bit, mono = 88200 bytes/sec) rather than
  parsing each file's header, keeping the endpoint fast even with many
  recordings
- Uptime ticks live client-side once the initial server uptime is fetched,
  rather than re-polling the server every second

### Changed
- `templates/base.html` — Status tab button and pane added; `status.js`
  added to script load order (position 6, before `main.js` — same pattern
  established by the History/SmartResume load-order fixes in earlier
  versions)
- `templates/index.html` — Status tab content block added with scanner
  info grid, session/all-time stat cards, busiest channels chart, and
  recordings summary
- `static/js/main.js` — `Status.init()` added to `DOMContentLoaded`
- `static/js/tabs.js` — `Status.render()` called when Status tab opens
- `api/routes.py` — `get_full_status()` endpoint added
- `static/css/style.css` — `.status-page`, `.status-grid`, `.status-card`,
  `.busiest-row`, `.busiest-bar` styles added with responsive breakpoints

---

## [0.7.11] — Lockout Manager

### Added
- **🔒 Lockouts toggle** in the Channels tab search bar — filters the
  channel table to show only locked-out channels across all 500, regardless
  of which bank is currently loaded
- Live count badge on the toggle button showing how many channels are
  currently locked out, updating as background bank loading completes
- Each locked-out row shows a bank badge (B1–B10) so you know exactly
  where the channel lives
- **Unlock** button per row — clears the lockout for that single channel
  instantly via the existing `PUT /api/channel/<ch>` endpoint
- **Unlock All** button — appears when Lockouts view is active; unlocks
  every locked-out channel in one operation with a confirmation dialog
- New `POST /api/channels/bulk-unlock` endpoint — reads each channel's
  current data first (preserving name, frequency, modulation, etc.), then
  writes all of them back with `locked_out=false` in a single program mode
  session via `set_channels_bulk()`

#### How it works
- `Lockouts` module reuses the `ChSearch` background-loaded channel cache
  (`allChannels[]`) introduced for channel search — no separate data fetch
  required
- `ChSearch` public API extended with `getAllChannels()`,
  `updateChannelInCache()`, and a `fullyLoaded` getter so other modules can
  read and update the shared cache safely
- Activating Lockouts view clears any active search and deselects the bank
  buttons; deactivating restores the previously loaded bank view
- Edit button on each locked row opens the same edit modal used everywhere
  else in the channel manager

### Changed
- `templates/index.html` — `🔒 Lockouts` toggle button with count badge
  added next to the search input
- `static/js/channels.js` — `Lockouts` module added (toggle, render,
  unlock, unlock all); `ChSearch` return object extended with three new
  accessors; `Lockouts.updateCount()` hooked into `loadBank()`
- `api/routes.py` — `bulk_unlock_channels()` endpoint added
- `static/css/style.css` — `.ch-lockout-toggle`, `.ch-lockout-count`,
  `.ch-action-btn.unlock` styles added; mobile wrap behaviour added for
  the search bar row

---

## [0.7.10] — Smart Resume VAD Rewrite: Frequency-Triggered + Zero Crossing Rate

### Fixed

#### Smart Resume never triggered — same root cause as History
Smart Resume's `onState()` waited for `squelch_open` to flip true before
starting audio analysis, exactly like the History bug in v0.7.9.
`squelch_open` rarely becomes true during normal scanning, so
`startListening()` was almost never called and no VAD analysis ran at all.

**Fix:** Smart Resume now triggers the same way as History — when the
scanner's frequency stays stable for `SR_DWELL_MS` (800ms), VAD analysis
begins automatically. Works regardless of `squelch_open` state, squelch
level, or whether in scan or search mode.

#### VAD misclassified CB static/noise as voice
The original algorithm measured spectral variance (standard deviation of
energy across the voice frequency band). CB radio static turned out to have
an uneven spectral profile too — `stdDev` values of 20–25 were common for
both real voice AND modulated static, so the test could not tell them apart.

**Fix — switched to time-domain analysis:**
- **Zero Crossing Rate (ZCR)** — counts how often the raw audio waveform
  crosses zero. Random static crosses very frequently (ZCR > 0.35); voice
  crosses at a moderate, structured rate (ZCR 0.05–0.25); a dead carrier
  barely crosses at all (ZCR < 0.05)
- **Silence ratio** — tracks what fraction of analysed frames are
  near-silent. Voice naturally has pauses between words and breaths
  (silence ratio typically 10–60%); continuous static almost never goes
  quiet (silence ratio near 0%)
- **Decision rule:** classified as noise only when BOTH high ZCR AND no
  silence pauses are present — requiring two independent signals to agree
  before skipping, reducing false positives on real transmissions

### Changed
- `static/js/smartresume.js`:
  - `onState()` rewritten — frequency-stability dwell timer (`SR_DWELL_MS`,
    800ms) replaces the `squelch_open` rising-edge trigger; cancels and
    resets cleanly when the scanner moves to a new frequency
  - `analyseFrame()` rewritten — now reads `getByteTimeDomainData()`
    alongside `getByteFrequencyData()`; computes ZCR and silence ratio per
    frame; old spectral-variance-only test removed
  - `analyser.smoothingTimeConstant` reduced from 0.3 to 0.1 for sharper
    time-domain resolution
  - `srDwellFreq` reset to `null` immediately after a skip decision so the
    next frequency starts tracking right away
  - Per-frame console logging added: `[VAD] zcr=… silence=…% ampVar=… → DECISION`
  - Dwell-trigger console logging added: `[SmartResume] Dwell detected on X MHz`

### Notes
- Both fixes mirror the History tab fix in v0.7.9 — frequency stability is
  now the standard trigger pattern used across the app instead of relying
  on `squelch_open`, which the BC125AT only sets when audio physically
  breaks the squelch threshold (not simply when the scanner stops scanning)
- Threshold tuning is ongoing — console logging is left in place
  intentionally so real-world ZCR/silence values can be collected and used
  to refine `zcrNoiseThreshold` and `silenceVoiceMin` in a future update

---

## [0.7.9] — Activity History Bug Fix: Script Load Order & State Tracking

### Fixed

#### History tab not recording any transmissions

**Root cause 1 — Script load order:** `history.js` was loading at position 9,
after `main.js` at position 5. When `main.js` executed `History.init()` inside
`DOMContentLoaded`, `window.History` was `undefined` — the module had not
loaded yet. The same root cause affected the notification button in v0.6.2.

**Fix:** `history.js` moved to load at position 5, before `main.js`.

**Root cause 2 — Fragile `applyStatus` chain:** Both `history.js` and
`smartresume.js` were patching `window.applyStatus` inside their `init()`
functions to intercept scanner state. This created a fragile chain of nested
function wrappers that could silently break if any module patched before
another. If `applyStatus` wasn't defined when the patch ran, the condition
`typeof window.applyStatus === 'function'` would fail silently.

**Fix:** Both modules now receive scanner state via a **direct hook in
`socket.js`** on the `scanner_state` SocketIO event — the most reliable
point in the data flow. The fragile `applyStatus` patches removed from
both `history.js` and `smartresume.js`.

```js
// socket.js — single authoritative hook point
socket.on('scanner_state', (state) => {
  applyStatus(state);
  if (window.History)     History.onState(state);
  if (window.SmartResume) SmartResume.onState(state);
});
```

### Changed
- `templates/base.html` — `history.js` moved from position 9 to position 5
  (before `main.js`); removed from after `channels.js`
- `static/js/socket.js` — `History.onState(state)` and
  `SmartResume.onState(state)` called directly in `scanner_state` handler
- `static/js/history.js` — fragile `applyStatus` patch removed from
  `init()`; replaced with comment referencing `socket.js` hook
- `static/js/smartresume.js` — same fragile patch removed

---

## [0.7.8] — Activity History

### Added
- `static/js/history.js` — persistent transmission history module
- **History tab** — new fourth tab alongside Dashboard · Channels · Settings
- Tab badge showing total logged transmission count (updates live)

#### What gets logged
Every time squelch opens and closes, an entry is recorded:
- Timestamp (date + time)
- Frequency (MHz)
- Channel number
- Channel name
- Modulation
- Duration (seconds squelch was open)
- Status: **Heard** (green) or **Skipped** (grey, set by Smart Resume)

Transmissions shorter than 0.3 seconds are not logged (filters out
scanner blips during rapid scan between channels).

#### History tab features
- **Filter box** — real-time filter across all entries by name, frequency,
  channel number, or modulation
- **Pagination** — 50 entries per page with Prev / Next buttons
- **Entry count** — shows total matching entries and current page
- **↓ Export** — downloads all visible entries as a dated CSV file
  (`bc125at_history_YYYY-MM-DD.csv`)
- **Clear** — confirmation dialog before wiping all entries
- Skipped rows are visually dimmed with a grey "Skipped" badge
- Heard rows show a green "Heard" badge

#### Smart Resume integration
When Smart Resume decides a transmission is noise and resumes scanning,
it calls `History.markLastSkipped()` to update the most recent entry's
status from "Heard" to "Skipped" — so you can see exactly which
transmissions were auto-skipped.

#### Storage
- `localStorage` key `bc125at_history`
- Maximum 500 entries — oldest pruned automatically
- Persists across page reloads and browser sessions
- If localStorage is full, pruned to 100 entries and retried

### Changed
- `templates/base.html` — History tab button added to nav (with badge
  span); History tab pane added; `history.js` added to script load order
  (position 10, after `channels.js`)
- `templates/index.html` — History tab block added with toolbar
  (filter, pagination, export, clear) and transmission table
- `static/js/main.js` — `History.init()` added to `DOMContentLoaded`
- `static/js/tabs.js` — `History.render()` called when History tab opens
- `static/js/smartresume.js` — calls `History.markLastSkipped()` before
  sending the scan key when noise is detected
- `static/css/style.css` — `.hist-tab-badge`, `.hist-manager`,
  `.hist-toolbar`, `.hist-table`, `.hist-badge`, `.hist-badge--heard`,
  `.hist-badge--skip`, `.hist-skipped`, `.hist-timestr` styles added;
  mobile responsive override added

---

## [0.7.7] — Smart Resume (Voice Activity Detection)

### Added
- `static/js/smartresume.js` — Voice Activity Detection engine using the
  Web Audio API. Analyses incoming audio from the line-in port when squelch
  opens and automatically resumes scanning if no voice is detected.

#### How it works
1. Scanner state push fires `squelch_open: true` (rising edge)
2. Smart Resume starts capturing audio from the system default audio input
   (the same line-in connection used for recording)
3. Web Audio API FFT analyser samples audio every 100ms for 2.5 seconds
4. Each frame is scored on two criteria:
   - **Energy level**: RMS energy below noise floor → dead carrier/silence
   - **Voice ratio**: energy in 300–3400 Hz voice band vs total broadband
     energy. Voice concentrates energy in this range; noise/static is flat
5. After 2.5 seconds a majority vote is taken across all frames:
   - Voice detected → stay on channel, log "voice detected"
   - Noise/static/carrier detected → send `KEY,S,P` to resume scanning
6. Squelch closes before decision → analysis cancelled, no action

#### VAD algorithm details
- FFT size: 2048 bins at 44100 Hz = ~21.5 Hz per bin
- Voice band: bins 14–158 (approx 300–3400 Hz)
- Voice ratio threshold: 0.45–0.70 (adjusted by sensitivity slider)
- Noise floor: avg energy < 8/255 → classified as silent carrier
- Decision: majority vote across all 100ms analysis frames in the window

#### UI — Dashboard (Recording column)
- **Smart Resume** panel with ON/OFF toggle button
- **Sensitivity slider**: Aggressive (left) ↔ Conservative (right)
  - Aggressive: quicker to skip, may skip marginal voice
  - Conservative: gives more benefit of the doubt, may stay on some noise
- **Status line**: Ready → Listening… → Voice / Noise — resuming
- **Live indicator**: 🎙 Voice / 〰 Noise / — Silent during analysis
- Preference (enabled state + sensitivity) saved to `localStorage`

#### Requirements
- Browser microphone/line-in permission (prompt shown on first enable)
- Scanner audio output physically connected to computer line-in/mic port

### Changed
- `templates/base.html` — `smartresume.js` added to script load order
  (position 4, after `notifications.js`, before `main.js`)
- `templates/index.html` — Smart Resume panel added to the Recording column
  in the levels panel (above Activity log)
- `static/js/main.js` — `SmartResume.init()` added to `DOMContentLoaded`
- `static/css/style.css` — `.sr-toggle`, `.sr-body`, `.sr-sens-wrap`,
  `.sr-feedback`, `.sr-status-text`, `.sr-indicator` styles added with
  state variants (listening/amber, voice/green, skip/blue, err/red)

### Design decisions
- 2.5 second window chosen as conservative default — gives enough time to
  distinguish voice from momentary noise bursts
- Majority vote (>50% of frames) rather than requiring all frames to agree —
  handles the real-world case where voice starts mid-window
- Falling edge cancellation — if squelch closes before the 2.5s window,
  analysis stops immediately and no scan key is sent
- Sensitivity slider maps linearly to voice ratio threshold (0.45–0.70)
  letting users tune for their specific noise environment

---

## [0.7.6] — Channel Search & Filter

### Added
- Live search bar in the Channels tab — filters all 500 channels by name,
  frequency, or modulation as you type
- Background loader: when the Channels tab first opens, bank 1 loads
  immediately (normal flow), then banks 2–10 load silently in the background
  so search covers all 500 channels without a blocking wait
- Search results show a **B1–B10 bank badge** on each row so you know
  exactly where each channel lives without having to know the bank
- **Highlighted matches** — the matching portion of each channel name,
  frequency, and modulation is highlighted in green in the results table
- Debounced input (200ms) — search only fires when you pause typing,
  keeping the UI smooth even on slow hardware
- Partial results indicator — if you search before background loading
  completes, a status message shows how many channels have been searched
  so far and updates as more banks finish loading
- Clear button (✕) appears in the search box when there is text; clears
  and returns to normal bank view instantly
- `Escape` key clears the search input and returns to bank view
- Status line shows loading progress (`amber`), ready state (`green`),
  and result count — fades out after 3 seconds when idle

### Changed
- `templates/index.html` — search bar added between toolbar and table;
  contains search input, clear button, and status label
- `static/js/channels.js` — `ChSearch` module prepended (260 lines):
  `loadAllBanks()`, `mergeBank()`, `runSearch()`, `highlight()`, `init()`;
  `loadBank()` now calls `ChSearch.mergeBank()` and triggers
  `ChSearch.loadAllBanks()` after each successful bank fetch; bank button
  click clears search input; `DOMContentLoaded` initialises ChSearch
- `static/js/tabs.js` — `ChSearch.init()` called when Channels tab
  first opens
- `static/css/style.css` — `.ch-search-bar`, `.ch-search-input-wrap`,
  `.ch-search-input`, `.ch-search-clear`, `.ch-search-status`, `.ch-match`,
  `.ch-bank-badge`, `.ch-search-empty` styles added; mobile responsive
  override added

### How it works
1. Open the Channels tab → bank 1 loads and renders immediately
2. Background loader silently fetches banks 2–10 one at a time, merging
   each into the shared `allChannels[]` cache
3. Type anything in the search box → results filter instantly from whatever
   is cached, with a note if loading is still in progress
4. Results show channel number + bank badge, with matching text highlighted
5. Click a bank button or press Esc → search clears, bank view restored
6. Jump and Edit buttons work the same as in normal bank view

---

## [0.7.5] — KEY Command Protocol Fix

### Fixed

#### "Key 'down' failed" and "Key 'weather' failed" errors

**Root cause:** The BC125AT serial protocol only supports a specific set of
KEY command codes, documented in the `AVAILABLE_KEYS` list from the bearcat
library and the official BC125AT PC Protocol V1.01:

```
< ^ > H 1 2 3 S 4 5 6 R 7 8 9 L E 0 . P F
```

The following key codes we had in `KEY_MAP` are **not valid** on the BC125AT
— the scanner returns `NG` (not acknowledged) for all of them:

| Friendly name | Code | Status |
|---|---|---|
| `weather` | `W` | ❌ Not a valid BC125AT KEY code |
| `down` | `v` | ❌ Not a valid BC125AT KEY code |
| `menu` | `M` | ❌ Not a valid BC125AT KEY code |
| `no` | `N` | ❌ Not a valid BC125AT KEY code |
| `yes` | `Y` | ❌ Not a valid BC125AT KEY code |

Weather (WX) and Down (▼) can only be operated physically on the scanner —
there is no serial command to trigger them remotely.

### Changed
- `scanner/commands.py` — `KEY_MAP` cleaned up: `menu`, `weather`, `down`,
  `no`, `yes` removed. All remaining codes verified against `AVAILABLE_KEYS`.
  Comment added documenting valid vs invalid codes.
- `static/js/shortcuts.js` — `weather` (`W`) and `down` (`↓`) shortcuts
  removed. Navigate group now shows Up / Left / Right only.
- `templates/index.html` — WX and ▼ keypad buttons marked with
  `.key--unsupported` class and tooltip explaining they are not supported
  via serial
- `static/css/style.css` — `.key--unsupported` style: reduced opacity,
  `cursor: not-allowed`, hover/active effects disabled
- `api/routes.py` — error message for unknown key updated to list only
  valid BC125AT KEY codes

---

## [0.7.4] — Keyboard Shortcuts Bug Fix

### Fixed

#### Most shortcuts did not fire

**Root cause 1 — Case sensitivity:** `e.key` in browser `keydown` events is
case-sensitive. When a user presses `S` without Caps Lock, `e.key` is `'s'`
(lowercase). The shortcuts were registered with `'S'` (uppercase), so they
only fired when Shift was held. Numbers (`'0'`–`'9'`), dot (`'.'`), and arrow
keys (`'ArrowUp'` etc.) happened to work because those are always the same
case — which is why only those worked.

**Fix:** All letter keys are now stored lowercase in the definition table and
matched via `e.key.toLowerCase()`. A `LOOKUP` map (keyed by lowercased string)
replaces the `Array.find()` for O(1) dispatch. Arrow keys are also lowercased
(`'arrowup'` etc.) for consistency.

**Root cause 2 — Search key missing:** The `R` / `search` shortcut was
omitted from the shortcuts table entirely.

**Fix:** `{ key: 'r', label: 'R', description: 'Search', action: pressKey('search') }`
added to the Scanner group.

### Changed
- `static/js/shortcuts.js` — complete rewrite of shortcut definitions and key
  handler; all letter keys lowercased; `LOOKUP` map replaces `Array.find()`;
  `search` shortcut added; overlay footer note updated

---

## [0.7.3] — Keyboard Shortcuts

### Added
- `static/js/shortcuts.js` — self-contained keyboard shortcut module
- `?` help button in the page header (monospace, green on hover) — opens the shortcut reference overlay
- Keyboard shortcut reference overlay — press `?` anywhere to open, `?` or `Esc` to close

#### Shortcuts

| Key | Action | Group |
|---|---|---|
| `S` | Scan | Scanner |
| `H` | Hold | Scanner |
| `W` | Weather (WX) | Scanner |
| `L` | Lockout | Scanner |
| `F` | Func | Scanner |
| `E` | Enter | Scanner |
| `0`–`9` | Number keys | Keypad |
| `.` | Dot | Keypad |
| `↑ ↓ ← →` | Navigation | Navigate |
| `Esc` | Close overlay / clear channel input | UI |
| `?` | Show / hide shortcut help | UI |

#### Safety guards — shortcuts only fire when:
- The Dashboard tab is active (shortcuts don't accidentally fire on Channels or Settings)
- Focus is not inside an input, textarea, or select element
- No modifier key is held (Ctrl, Alt, Meta) — browser shortcuts preserved

#### Overlay design
- Shortcuts grouped into four sections: Scanner · Keypad · Navigate · UI
- Two-column grid layout on desktop, single column on mobile
- Bottom-sheet style on mobile (slides up from screen edge)
- `kbd` elements styled with green text, dark background, raised border — matches the radio panel aesthetic
- Backdrop blur keeps context visible behind the overlay
- Clicking outside the modal closes it

#### Visual feedback
- Pressing a shortcut flashes the corresponding keypad button on screen
- Activity log entry written for every shortcut key press

### Changed
- `templates/base.html` — `shortcuts.js` added to script load order (position 2, before `notifications.js`); `?` help button injected into header by `shortcuts.js` at init
- `static/js/main.js` — `Shortcuts.init()` added to `DOMContentLoaded` handler
- `static/css/style.css` — `.shortcuts-help-btn`, `.shortcuts-overlay`, `.shortcuts-modal`, `.shortcuts-body`, `.shortcuts-group`, `.shortcuts-row`, `.shortcuts-desc`, `kbd`, `.shortcuts-kbd`, `.shortcuts-footer` styles added; mobile bottom-sheet override added

---

## [0.7.2] — Import/Export Performance & Progress Indicators

### Added

#### Progress bar for all four import/export operations
- Animated green progress bar appears below the channel toolbar during any
  export or import operation — same visual style as the bank load progress bar
- Label shows what operation is running (e.g. "Exporting 500 channels…")
- Simulated progress advances to 90% while the server works, then snaps to
  100% with a status label when complete ("Download ready" / "N written")
- Progress bar auto-hides 1.5 seconds after completion
- `showCsvProgress()`, `setCsvProgress()`, `hideCsvProgress()`,
  `startFakeProgress()` helper functions added to `channels.js`
- `.csv-progress-container` CSS block added to `style.css`

### Changed

#### Single program mode session for all 500-channel operations
All four export/import endpoints now use new bulk commands that open program
mode once and keep it open for the entire operation, rather than entering and
exiting for each bank or each channel.

**`scanner/commands.py`** — two new functions:
- `get_all_channels_bulk(mgr)` — reads all 500 channels in a single PRG/EPG
  session. Replaces 10 separate `get_channels_bulk()` calls (10 PRG/EPG pairs)
  with one. Each CIN uses `BULK_CIN_TIMEOUT` (0.5s) and 10ms poll interval.
- `set_channels_bulk(mgr, channels, on_progress)` — writes a list of channels
  in a single PRG/EPG session. Replaces N individual `set_channel()` calls.
  Accepts optional `on_progress(written, total)` callback.

**`scanner/scanner.py`** — two new methods mirroring the above, both pause the
background poll thread for the duration to avoid serial contention.

**`api/routes.py`** — all four endpoints updated:
- `GET /api/channels/export` — now calls `get_all_channels_bulk()`
- `POST /api/channels/import` — validates all rows first, then calls
  `set_channels_bulk()` in one session
- `GET /api/channels/export/ss` — now calls `get_all_channels_bulk()`
- `POST /api/channels/import/ss` — validates all rows first, then calls
  `set_channels_bulk()` in one session

### Performance improvement estimate
| Operation | Before | After |
|---|---|---|
| Export (500 channels) | ~30s (10 PRG/EPG) | ~25s (1 PRG/EPG) |
| Import (500 channels) | ~100s (500 PRG/EPG) | ~52s (1 PRG/EPG) |
| Import (partial file) | proportional | proportional |

The import improvement is the most significant — removing 499 unnecessary
PRG/EPG round-trips cuts import time roughly in half.

---

## [0.7.1] — Native Uniden .bc125at_ss Format Support

### Added

#### Export (GET /api/channels/export/ss)
- Exports all 500 channels as a `.bc125at_ss` file — the native format used
  by the official Uniden BC125AT programming software
- Output is tab-delimited with `Conventional` bank headers and `C-Freq` channel
  lines matching the exact format the Uniden software reads and writes
- CTCSS values preserved as-is (e.g. `C114.8`); `"0"` converted back to `"Off"`
- Boolean fields written as `On`/`Off` per the Uniden spec
- File opens directly in the official Uniden BC125AT software

#### Import (POST /api/channels/import/ss)
- Accepts a `.bc125at_ss` file upload and writes channels to the scanner
- Parses only `C-Freq` lines — all other record types (Misc, Priority, WxPri,
  Service, Custom, CloseCall, etc.) are silently ignored
- `Auto` modulation mapped to `FM` (Uniden uses `Auto` for auto-detect)
- CTCSS `Off` mapped to `0` for internal representation
- Same validation and error reporting as CSV import

#### UI — Channels tab toolbar
- Two format groups now visible in the toolbar: **CSV** and **.bc125at_ss**
- Each group has its own Export and Import buttons with a format label above
- Import shows a confirmation dialog before writing to the scanner
- Activity log reports written/skipped counts and any per-channel errors

### Changed
- `api/routes.py` — `_parse_bc125at_ss()` and `_build_bc125at_ss()` helper
  functions added; two new endpoints appended
- `templates/index.html` — toolbar redesigned with two `ch-format-group`
  divs each containing a label, export button, and import file picker
- `static/js/channels.js` — SS export fetch handler and SS import FormData
  handler appended
- `static/css/style.css` — `.ch-format-group` and `.ch-format-label` styles
  added; mobile stacking updated

### .bc125at_ss format reference
```
Conventional\t1\tBank 1\tOff
C-Freq\t1\tRCPD Disp\t483412500\tFM\tOff\tOff\t2\tOff
C-Freq\t2\tAtherton PD\t489087500\tFM\tOff\tOff\t2\tOff
C-Freq\t3\tBelmont PD 1\t488487500\tFM\tC162.2\tOff\t2\tOff
```
Columns: `C-Freq  channel  name  freq_hz  modulation  ctcss  locked_out  delay  priority`

---

## [0.7.0] — CSV Channel Export & Import

### Added

#### Export (GET /api/channels/export)
- Downloads all 500 channels as `bc125at_channels.csv` directly to the browser
- Fetches all 10 banks sequentially in one operation using the optimised
  `get_channels_bulk()` — single PRG/EPG session per bank
- CSV columns: `channel, name, frequency_mhz, modulation, ctcss_dcs, delay,
  locked_out, priority`
- Empty frequency field for unused channels (rather than `0`)
- UTF-8 encoded; compatible with Excel, Google Sheets, and any text editor

#### Import (POST /api/channels/import)
- Accepts a `.csv` file upload via multipart form data
- Column matching by header name — order in the file does not matter
- Full validation before any writes:
  - Required columns check: `channel`, `name`, `frequency_mhz`, `modulation`
  - Channel number range: 1–500
  - Frequency range: 25–512 MHz (empty = clear channel)
  - Modulation: invalid values silently coerced to `FM`
  - Name truncated to 16 characters
- Handles UTF-8 BOM (files exported from Excel)
- Returns a summary: channels written, channels skipped, up to 20 error messages
- Reloads the current bank in the channel manager after import completes

#### UI — Channels tab toolbar
- `↓ Export CSV` button — triggers export, disables during download, logs progress
- `↑ Import CSV` label/button — opens native file picker, styled to match toolbar keys
- Confirmation dialog before import warns user to have a backup
- Activity log shows per-row errors if any rows were skipped
- Both buttons disabled/relabelled with progress text during operation
- Mobile: CSV buttons stack vertically at < 600px

### Changed
- `api/routes.py` — two new endpoints appended
- `templates/index.html` — export/import buttons added to channel toolbar
- `static/js/channels.js` — export fetch + blob download handler; import
  FormData upload + confirmation dialog + error reporting appended
- `static/css/style.css` — `.ch-csv-btns` and `.ch-import-label` styles added;
  mobile stacking media query added

### CSV format reference
```csv
channel,name,frequency_mhz,modulation,ctcss_dcs,delay,locked_out,priority
1,RCPD Disp,483.4125,FM,0,2,false,false
2,SamTrans,153.785,NFM,0,2,false,false
3,,,,0,2,false,false
```

---

## [0.6.4] — Mobile Responsive Layout

### Added
- Full responsive layout across three breakpoints — no backend changes, CSS only

#### Breakpoints
| Range | Layout |
|---|---|
| ≥ 1024px | Desktop — existing layout unchanged |
| 600–1023px | Tablet — controls row stacks vertically, panels full width |
| < 600px | Mobile — single column, compact everything |
| < 380px | Very small — further font/padding reductions |

#### Tablet (600–1023px)
- Controls row (`controls-row`) switches from two-column to single-column grid
- Keypad panel expands to full width
- Levels panel retains its two-column internal layout (levels left + right)
- Channel table scrolls horizontally inside a fixed container
- Theme grid reduces to 3 columns
- Scan groups grid reduces to 3 columns

#### Mobile (< 600px)
- Header sub-label ("web controller") hidden to save space
- Tab nav buttons compact to 11px with tighter padding
- Display frequency font reduced from 36px to 26px
- Display icons wrap and compact
- Keypad keys get larger vertical padding for easier tapping
- Levels panel top section stacks to single column (left + right stacked)
- Activity log height reduced to 90px
- Recordings list hides size and date columns — shows filename and actions only
- Channel toolbar stacks vertically; bank buttons wrap
- Theme grid reduces to 2 columns; description text hidden
- Scan groups grid reduces to 2 columns
- Priority buttons wrap
- Edit modal becomes a bottom sheet (slides up from bottom, full width,
  rounded top corners only) — more natural on mobile
- Backlight buttons switch to 2-column grid

#### Very small (< 380px)
- Frequency font further reduced to 22px
- Tab buttons and keys further compacted

#### Touch device improvements (`hover: none and pointer: coarse`)
- All interactive elements enforce 44px minimum tap target height
  (Apple HIG / Material Design guideline)
- Sliders enlarged: track 6px tall, thumb 22×22px for easier dragging
- Hover transforms removed (scale effects feel wrong on touch)

### Changed
- `static/css/style.css` — three `@media` blocks + one touch media query appended
- `templates/base.html` — viewport meta updated to `maximum-scale=1.0`;
  added `mobile-web-app-capable`, `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`, and `theme-color` meta tags

---

## [0.6.3] — Theme Support: Five Radio-Inspired Themes

### Added
- `static/js/themes.js` — self-contained theme switcher module. Applies theme via
  `data-theme` attribute on `<html>`, persists preference to `localStorage`,
  defaults to Nightwatch on first load.
- Five radio-inspired themes, each with a full set of CSS custom properties:
  - **Nightwatch** — dark green on near-black (original, default)
  - **Amber Alert** — orange-amber on dark walnut, inspired by vintage Motorola portables
  - **Navy Ops** — steel blue on deep navy, inspired by military radio equipment
  - **Phosphor** — bright green-white on pure black, classic CRT phosphor screen look
  - **Daylight** — clean light grey with green accents for bright environments;
    display screen intentionally kept dark green to preserve the radio panel feel
- Five colour swatch buttons in the page header — radial gradient preview of each
  theme; active theme shown with a white ring border; tooltip on hover shows name
- `themes.js` loads first in script order to prevent flash of unstyled/wrong-theme
  content before `DOMContentLoaded` fires

### Changed
- `static/css/style.css` — `:root` block split into five `[data-theme]` selectors;
  `[data-theme="daylight"]` includes overrides for `.display-screen`, `.display-freq`,
  `.display-name` to keep the green CRT display regardless of theme
- `templates/base.html` — five `.theme-btn` swatch buttons added to header right
  section; `themes.js` added as first script in load order
- `static/js/main.js` — `Themes.init()` added to `DOMContentLoaded` handler
- `static/css/style.css` — `.theme-switcher`, `.theme-btn`, `.theme-btn.active`,
  swatch gradient styles added

### Theme design decisions
- All themes use the same green CRT display area — the frequency readout always
  looks like radio hardware regardless of which UI theme is selected
- Daylight theme uses light backgrounds for all panels but keeps the dark screen
  to maintain visual identity and contrast for the frequency display
- Swatch buttons use radial gradients showing the theme's accent colour fading
  into its background colour — gives an accurate preview at small size

---

## [0.6.2] — Browser Notifications (Bug Fix: Script Load Order)

### Added
- `static/js/notifications.js` — self-contained browser notifications module using
  the Web Notifications API. Fires a desktop notification on the rising edge of
  `squelch_open` (closed → open), showing frequency, channel name, and modulation.
  Auto-closes after 4 seconds. Preference persisted to `localStorage`.
- `🔕 / 🔔` toggle button in the page header — requests browser permission on first
  click, saves enabled state across sessions
- Notification fires only on rising edge — not repeatedly while squelch stays open
- Graceful degradation — button hidden if browser does not support notifications;
  logs a message to activity log if permission is denied

### Fixed

#### Notification button did nothing when clicked

**Root cause:** Script load order bug. `main.js` was loading first and calling
`Notifs.init()` immediately at boot — but `notifications.js` hadn't loaded yet,
so `window.Notifs` was `undefined` and the call did nothing silently.

**Fix — three changes:**

1. `templates/base.html` — `notifications.js` moved to load **before** `main.js`
   so `window.Notifs` is defined by the time any other script references it.

2. `static/js/main.js` — `Notifs.init()` moved from inline boot into the
   `DOMContentLoaded` event handler (alongside `initSocket()`), guaranteeing all
   scripts have parsed before initialisation runs.

3. `static/js/notifications.js` — `applyStatus` patch moved into `init()` itself.
   Patching `window.applyStatus` from `notifications.js` at parse time was also
   unsafe; doing it inside `init()` (called from `DOMContentLoaded`) ensures
   `applyStatus` exists in `window` before it is wrapped.

### Changed
- `templates/base.html` — `notifications.js` moved to position 1 in script load
  order; `🔕` toggle button added to header right section
- `static/js/main.js` — `Notifs.init()` moved into `DOMContentLoaded`; stale
  `applyStatus` patch removed
- `static/js/notifications.js` — `applyStatus` hook moved inside `init()`;
  `Notifs.onState()` called from within the hook
- `static/css/style.css` — `.notif-btn` and `.notif-btn--active` styles added

---

## [0.6.1] — Performance: Channel Loading Speed

### Fixed

#### Channel bank loading was extremely slow (~12–25 seconds per bank)

Four targeted optimisations reduced load time to ~4–6 seconds for 50 channels:

**`scanner/serial_manager.py`** — serial read timeout reduced from `1.0s` to `0.2s`.
The BC125AT responds in ~50ms so 800ms of dead wait was burned on every read.

**`scanner/commands.py`**
- `_send_and_receive()` now accepts a `timeout` parameter (default still `2.0s`
  for normal commands)
- Read poll interval reduced from `50ms` to `10ms` — 5× faster response detection
- `BULK_CIN_TIMEOUT = 0.5s` constant added — used only during bulk channel reads,
  giving 5× headroom over real response time while being 4× faster than the default
- `get_channels_bulk()` uses `BULK_CIN_TIMEOUT` for each `CIN` command

**`scanner/scanner.py`** — `get_channels_bulk()` now stops the background poll
thread before fetching channels and restarts it when done. Previously the poll
thread was competing for `_cmd_lock` between every CIN command, adding
unpredictable per-channel delays.

**`static/js/channels.js`** — animated green progress bar shown while the bank
loads, advancing to 90% during the request and completing to 100% on response.
Replaces the blank/frozen table that gave no feedback during the wait.

**`static/css/style.css`** — progress bar and percentage label styles added.

### Performance comparison
| Metric | Before | After |
|---|---|---|
| Serial read timeout | 1.0s | 0.2s |
| Command timeout (bulk) | 2.0s | 0.5s |
| Read poll interval | 50ms | 10ms |
| Background poll during load | competing | paused |
| 50 channels load time | ~12–25s | ~4–6s |

---

## [0.6.0] — Phase 6: UI Polish, Settings Page & Channel Manager

### Added

#### Tab navigation
- Three-tab single-page layout: **Dashboard**, **Channels**, **Settings**
- `templates/base.html` — tab nav bar in header with active state highlighting
- `static/js/tabs.js` — tab switching with lazy loading (Channels and Settings
  load data only when their tab is first opened, not on page load)
- Dashboard tab is the default active tab on page load

#### Channel Manager (Channels tab)
- Bank pagination — 10 banks of 50 channels each, navigated via bank buttons 1–10
- Full channel table: channel number, name, frequency (MHz), modulation,
  CTCSS/DCS tone, delay, locked out status, priority status, and action buttons
- **Jump** button — sends scanner directly to that channel from the table
- **Edit** button — opens modal with full channel editing:
  - Channel name (max 16 chars)
  - Frequency in MHz (step 0.0025)
  - Modulation selector: FM, NFM, AM, WFM, FMB
  - CTCSS/DCS tone
  - Delay selector: -10, -5, 0, 1, 2, 3, 4, 5 seconds
  - Locked out checkbox
  - Priority checkbox
- Save writes channel back to scanner via `PUT /api/channel/<ch>`
- Animated progress bar while bank is loading
- `static/js/channels.js` — all channel manager UI logic

#### Settings page (Settings tab)
- **Serial section** — port and poll interval editable, saved to `.env` file;
  note shown advising server restart for changes to take effect
- **Scan groups section** — 10 toggle cards (Bank 1–10 with channel range shown);
  Apply button sends to scanner live via `POST /api/settings/groups`
- **Priority mode section** — Off / On / Plus / DND buttons; applies live via
  `POST /api/settings/priority`
- **Recording section** — read-only display of output directory and tail duration
  with instructions for editing each
- **Server info section** — live display of model, firmware, port, poll interval,
  battery voltage pulled from `/api/status` and `/api/settings`
- `static/js/settings.js` — all settings page UI logic

#### New API endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/api/channels?bank=<1-10>` | Fetch 50 channels for a bank |
| PUT | `/api/channel/<ch>` | Write channel data to scanner |
| GET | `/api/settings` | Return all current runtime settings |
| POST | `/api/settings/serial` | Save port/poll to `.env` file |
| POST | `/api/settings/groups` | Apply scan group states live |
| POST | `/api/settings/priority` | Apply priority mode live |

#### New scanner commands
- `set_channel()` in `scanner/commands.py` — writes a full channel record via `CIN`
  with name, frequency, modulation, CTCSS/DCS, delay, lockout, priority
- `get_channels_bulk()` in `scanner/commands.py` — fetches a range of channels in
  a single program mode session (one PRG/EPG pair for the whole bank)
- Both exposed on `Scanner` class in `scanner/scanner.py`

### Changed
- `templates/base.html` — added tab nav, three `tab-pane` divs, loads `tabs.js`,
  `channels.js`, `settings.js` after existing scripts
- `templates/index.html` — restructured into three Jinja2 blocks:
  `dashboard`, `channels`, `settings`
- `static/css/style.css` — added tab nav styles, channel table, bank buttons,
  edit modal, settings panels, scan group toggle grid, priority buttons,
  server info grid, progress bar
- `api/routes.py` — six new endpoints appended

---

## [0.5.3] — Bug Fixes: WebSocket Stability & Frequency Display

### Fixed

#### WebSocket stability — `transport close` disconnects on Windows
- **Root cause:** `async_mode="eventlet"` with eventlet 0.37+ has a known broken
  interaction with Flask-SocketIO's background thread emission on Windows, causing
  the server to drop connections with `transport close` errors
- **Fix:** Switched `api/socket.py` to `async_mode="threading"` — uses Werkzeug's
  built-in threaded server which is stable for local network use and requires no
  additional async packages
- `app.py` — added `use_reloader=False` (prevents Flask spawning a second process
  that would connect the scanner twice and emit from the wrong process) and
  `allow_unsafe_werkzeug=True` (required when Werkzeug runs in threading mode)
- `static/js/socket.js` — changed transport order to `['polling', 'websocket']`;
  threading mode works better starting with polling and upgrading to WebSocket
  rather than attempting WebSocket first
- `requirements.txt` — eventlet removed as a required dependency; added note
  explaining why threading mode is preferred on Windows

#### Frequency display not updating during scan/search
- **Root cause 1:** `_parse()` in `scanner/commands.py` was stripping ALL empty
  fields from responses, including ones in the middle. The GLG response during
  active scanning contains an empty channel name field (`GLG,2640000,AM,0,0,0,0,,0,0`)
  — stripping it shifted every subsequent field left by one position, so
  `channel_id` was reading `group_id`, `channel_name` was reading `channel_id`,
  and `squelch_open` was reading `channel_name` — all wrong
- **Fix:** `_parse()` now strips only trailing empty fields; middle empty fields
  are preserved so field positions stay correct. `BLT,AO,` (trailing comma) still
  handled correctly
- **Root cause 2:** `_do_poll()` in `scanner/scanner.py` only fired the state
  callback `if updated:` — if both `STS` and `GLG` returned `None` (possible
  during rapid scanning), no callback fired and the browser display froze
- **Fix:** State callback now fires on every poll cycle unconditionally — the
  browser always receives a fresh state push regardless of whether individual
  commands returned data
- **Root cause 3:** When `GLG` returns `None` between channels, the frequency
  was being zeroed out in state, causing the display to flicker to `--- MHz`
  during scanning gaps
- **Fix:** Frequency fields are only updated when `GLG` returns a non-zero value;
  last known frequency is preserved in state when scanner is between channels

#### WebSocket ping timeout disconnects
- **Root cause:** Server default ping timeout (~20s) was shorter than the client
  ping interval (30s), so the server dropped connections before the client pinged
- **Fix:** `api/socket.py` — `ping_timeout=60`, `ping_interval=25`;
  `static/js/socket.js` — client ping reduced from 30s to 20s (within server window)

#### Recording UI layout
- **Root cause:** Recording controls were added as a separate panel below the main
  layout, making the UI feel disconnected and unbalanced
- **Fix:** Levels panel redesigned into a two-column layout — left column retains
  Volume, Squelch, and Backlight controls; right column holds Recording and Activity
  log. Recordings list sits full-width at the bottom of the panel with a divider
- Record/Stop buttons restyled to match the compact backlight button design
- REC indicator pill changed from `style="display:none"` inline to `.active` CSS
  class — hidden cleanly by default, shown only during recording or tail period
- Current recording filename shown in small monospace text beneath the buttons

### Changed
- `api/socket.py` — `async_mode` changed from `"eventlet"` to `"threading"`;
  added `ping_timeout=60` and `ping_interval=25`
- `app.py` — added `use_reloader=False` and `allow_unsafe_werkzeug=True`
- `scanner/commands.py` — `_parse()` rewritten to strip only trailing empty
  fields; middle empty fields now preserved; added detailed docstring with examples
- `scanner/scanner.py` — `_do_poll()` now always fires state callback; frequency
  preserved when `GLG` returns `None`; `register_error_callback()` added
- `static/js/socket.js` — transport order changed to `['polling', 'websocket']`;
  client ping interval reduced from 30s to 20s
- `static/js/main.js` — recording UI updated to use `.active` class on REC pill;
  `rec-file` element shows current filename; `setRecordingUI()` accepts filename arg;
  `applyRecorderState()` passes filename through
- `templates/index.html` — recording section moved inside levels panel as
  two-column layout; separate recordings panel removed from bottom of page;
  recordings list integrated as full-width section inside levels panel
- `static/css/style.css` — Phase 5 recording CSS redesigned; `.rec-pill` uses
  `.active` class; compact rec buttons; recordings list inside panel
- `requirements.txt` — eventlet removed as dependency

---

## [0.5.0] — Phase 5: Manual Audio Recording

### Added
- `recorder/` — new self-contained recording package
- `recorder/__init__.py` — clean public export: `from recorder import Recorder`
- `recorder/recorder.py` — `Recorder` class with:
  - Manual `start()` / `stop()` with thread-safe locking
  - 3-second tail — keeps recording after `stop()` so end of transmission is never clipped
  - Records from system default audio input (microphone / line-in)
  - 44100 Hz mono 16-bit PCM WAV output
  - Timestamped filenames: `YYYYMMDD_HHMMSS_ch<n>_<freq>.wav`
  - `list_recordings()` — returns all WAVs sorted newest first with size, date, and URL
  - `delete_recording()` — path traversal protection enforced
  - `status()` — live state dict (recording, tail_active, elapsed_seconds, current_file)
  - `sounddevice` audio callback → queue → `soundfile` WAV writer pattern
  - Graceful error handling if `sounddevice`/`soundfile` not installed
- `app.py` — `Recorder` instance created and attached as `app.recorder`; recorder status injected into every `scanner_state` SocketIO push so UI stays in sync without polling
- `/recordings/<filename>` route — serves WAV files for browser playback and download
- New API endpoints:
  - `GET  /api/recording/status` — live recorder state
  - `POST /api/recording/start`  — begin recording (captures current channel + frequency from scanner state)
  - `POST /api/recording/stop`   — stop recording (tail runs before file is saved)
  - `GET  /api/recordings`       — list all saved recordings
  - `DELETE /api/recordings/<filename>` — delete a recording

### Changed
- `requirements.txt` — added `sounddevice>=0.4.6` and `soundfile>=0.12.1`
- `templates/index.html` — added REC indicator pill in display header; added Record/Stop buttons in levels panel; added recordings list panel below the controls row
- `static/css/style.css` — recording UI styles: blinking REC dot, record/stop buttons, recordings list rows with filename/size/date/actions
- `static/js/main.js` — recording controls wired up; live elapsed timer; `applyStatus()` patched to also call `applyRecorderState()` from SocketIO push; recordings list loaded on boot and refreshed after stop+tail completes; delete buttons with confirmation dialog
- `app.py` — recorder status injected into `scanner_state` SocketIO push payload

### Design decisions
- Manual trigger only (no auto-record on squelch) — simpler and gives full user control
- Tail of 3 seconds prevents clipping the end of transmissions
- Recorder status piggybacked on existing `scanner_state` SocketIO push — no extra WebSocket events needed
- WAV format chosen over MP3 for zero-dependency encoding and lossless quality


---

## [0.4.0] — Phase 4: Live WebSocket Push Updates

### Added
- `api/socket.py` — shared SocketIO instance using `init_app()` pattern to prevent circular imports
- `api/events.py` — SocketIO event handlers: `connect`, `disconnect`, `ping/pong`
- `static/js/socket.js` — browser SocketIO client; listens for `scanner_state` and `scanner_error` events
- `scanner_error` SocketIO event emitted when scanner loses connection — connection dot turns red in UI
- `register_error_callback()` on `Scanner` class — fires on serial connection loss
- 30-second ping/pong health check between browser and server
- Auto-reconnect logic in browser SocketIO client with exponential backoff
- Socket.IO 4.7.5 loaded from CDN in `base.html`

### Changed
- `api/__init__.py` — `register_routes()` renamed to `register_api()`, now also calls `register_events()`
- `app.py` — SocketIO now initialised via `socketio.init_app(app)` pattern; both state and error callbacks wired to `socketio.emit()`
- `scanner/scanner.py` — added `register_error_callback()` method; error callback fired from `_poll_loop()` on connection loss
- `static/js/main.js` — 600ms `setTimeout` poll loop removed entirely; `applyStatus()` and `logEntry()` exposed on `window` for `socket.js` to call; `setConnected()` also exposed globally
- `templates/base.html` — added Socket.IO CDN script and `socket.js` load after `main.js`

### How it works
The scanner poll thread fires every 0.5 seconds. On each cycle it calls the registered state callback in `app.py`, which calls `socketio.emit("scanner_state", state)` to push the full state dict to all connected browsers instantly. The browser SocketIO client receives the event and calls `applyStatus()` to update the UI — no polling, no delay.

---

## [0.3.0] — Phase 3: Web Dashboard

### Added
- `templates/base.html` — Jinja2 site shell with header, connection status dot, and script loading
- `templates/index.html` — full dashboard layout: display panel, keypad, levels panel
- `static/css/style.css` — dark radio panel theme (Option A) with green-on-near-black colour scheme
- `static/js/main.js` — UI logic: state rendering, key press handlers, slider controls, backlight switcher, channel jump, activity log
- `static/js/socket.js` — placeholder for Phase 4
- `docs/img/screenshot.png` — UI screenshot for README
- `docs/img/` directory created for future assets
- Flask `GET /` route in `app.py` serving the dashboard via `render_template("index.html")`

### Dashboard features
- Live frequency display in monospace green (e.g. `483.4125 MHz`)
- Channel number, modulation, and channel name display
- SQ / MUTE status pills with active highlight
- 5-bar signal strength indicator
- Battery voltage display with colour-coded fill bar (green / amber / red)
- Full keypad emulation — Scan, Hold, Search, WX, 0–9, ▲▼, L/O, E, Func — with green flash animation on press
- Direct channel jump input (1–500) with Enter key support
- Volume slider (0–15) with live value display
- Squelch slider (0–15) with live value display
- Backlight mode buttons: Always on / Squelch / Keypress / Off — active state highlighted
- Timestamped activity log with colour-coded entries (green=ok, red=error, grey=info)
- Log clear button
- Header connection dot: grey=connecting, green=connected, red=disconnected
- 600ms poll loop (replaced by SocketIO in Phase 4)

### Design decisions
- Dark theme chosen (Option A) over light modern (Option B) for radio equipment feel
- Desktop-only layout — no mobile breakpoints required
- Slider drag detection prevents server state overwriting user input mid-drag
- LCD display lines (`STS` response) hidden — contained garbled special characters not useful in the UI

---

## [0.2.0] — Phase 2: Flask REST API

### Added
- `api/routes.py` — 18 REST endpoints registered on `scanner_bp` Blueprint with `/api` prefix
- `api/__init__.py` — `register_routes()` function for clean Blueprint registration
- `@scanner_required` decorator — returns HTTP 503 if scanner is not connected, eliminating repeated connection checks in every route
- Consistent JSON response envelope: `{ "success": bool, "message": str, "data": {...} }`
- Blueprint-level error handlers for 404, 405, and 500

### Endpoints added
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server + scanner connection status |
| GET | `/api/status` | Full scanner state snapshot |
| POST | `/api/key/<key>` | Simulate a key press |
| GET | `/api/volume` | Get current volume (0–15) |
| POST | `/api/volume/<level>` | Set volume (0–15) |
| GET | `/api/squelch` | Get current squelch (0–15) |
| POST | `/api/squelch/<level>` | Set squelch (0–15) |
| GET | `/api/backlight` | Get current backlight mode |
| POST | `/api/backlight/<mode>` | Set backlight mode |
| GET | `/api/channel/<ch>` | Get channel info (1–500) |
| POST | `/api/channel/<ch>` | Jump to channel (1–500) |
| GET | `/api/groups` | Get scan group states (10 groups) |
| POST | `/api/groups` | Set scan group states |
| GET | `/api/priority` | Get priority mode |
| POST | `/api/priority/<mode>` | Set priority mode |
| POST | `/api/scan` | Resume scanning |
| POST | `/api/hold` | Hold on current channel |
| POST | `/api/power/off` | Power off scanner |

### Changed
- `app.py` — scanner instance attached to `app.scanner`; blueprint registration moved to `register_routes()`; scanner connects on startup with graceful warning if unavailable

---

## [0.1.0] — Phase 1: Serial Communication Layer

### Added

#### Project structure
- Modular package layout established from the start to support future expansion
- `scanner/` — self-contained hardware package
- `api/` — web layer package (decoupled from hardware)
- `templates/`, `static/css/`, `static/js/`, `recordings/` — placeholder directories
- `config.py` — central configuration loaded from `.env` via `python-dotenv`
- `.env.example` — documented environment variable template
- `.gitignore` — Python, venv, recordings, IDE files excluded
- `requirements.txt` — all dependencies pinned

#### `scanner/serial_manager.py`
- `SerialManager` class — thread-safe serial port management
- `connect()` — opens port with 8N1 at 115200 baud; logs error and returns False rather than raising on failure
- `disconnect()` — closes port cleanly
- `reconnect()` — retries up to 5 times with configurable delay
- `send_raw()` — writes ASCII string with `\r\n` terminator
- `read_line()` — reads one line with 1-second timeout
- `flush_input()` — clears input buffer before sending commands
- `threading.Lock()` on all I/O operations

#### `scanner/commands.py`
- `FREQUENCY_SCALE = 100` — all wire frequencies are in units of 100 Hz
- `_wire_to_hz()` / `_hz_to_wire()` — frequency conversion helpers
- `_parse()` — strips command echo, removes trailing empty fields (e.g. `BLT,AO,`), returns `None` on `ERR` or `NG`
- `_ok()` — checks parsed response for `OK`
- `BYTE_MAP` — 96-entry LCD character map for decoding special BC125AT display bytes (0x80–0xDF)
- `_decode_display()` — applies BYTE_MAP to display strings
- `KEY_MAP` — 25 friendly key names mapped to single-character BC125AT codes
- `BACKLIGHT_ALIASES` — human-friendly aliases (`on`/`off`) mapped to protocol codes (`AO`/`AF`)
- Full command implementations: `get_model`, `get_firmware`, `get_status`, `get_reception_status`, `get_battery_voltage`, `get_volume`, `set_volume`, `get_squelch`, `set_squelch`, `press_key`, `get_backlight`, `set_backlight`, `get_channel`, `jump_to_channel`, `get_scan_groups`, `set_scan_groups`, `get_priority_mode`, `set_priority_mode`, `power_off`, `enter_program_mode`, `exit_program_mode`
- Program mode automatically entered and exited around commands that require it (`BLT`, `CIN`, `SCG`, `PRI`)

#### `scanner/scanner.py`
- `Scanner` class — high-level controller
- `_cmd_lock` — prevents poll thread and API commands colliding on the serial port
- `_state_lock` — protects the cached state dict from concurrent reads/writes
- Background polling thread (`scanner-poll`) fires every 0.5 seconds
- `register_state_callback()` — callback hook for SocketIO push (wired in Phase 4)
- `_empty_state()` — canonical default state dict

#### `scanner/__init__.py`
- Clean public export: `from scanner import Scanner`

#### `app.py`
- Flask app + Flask-SocketIO initialisation skeleton
- `SECRET_KEY` loaded from config

#### `test_connection.py`
- 6-step connection verification script
- Tests: port open, MDL, VER, STS, GLG, VOL
- `--port` CLI argument to override default COM port
- Clear PASS / PARTIAL result summary

### Protocol discoveries documented
- `VOL` and `SQL` have both GET and SET commands (contrary to initial assumption)
- `KEY` command requires exactly one character — `"Srch"` for search is wrong, correct code is `"R"`
- `SCG` group encoding is inverted: `"0"` on wire = scanning enabled, `"1"` = disabled
- `BLT` GET response has trailing comma: `BLT,AO,` — handled by `_parse()`
- `QSH` (frequency tuning) does not exist on BC125AT — BC75XLT only — removed
- `JNT,,<n-1>` is the correct jump-to-channel command (zero-indexed), not `DCH`
- `DCH` deletes a channel (requires program mode), not jump
- Backlight modes are `AO`, `AF`, `KY`, `SQ`, `KS` — not `ON`/`OFF`
- `PRG`/`EPG` responses are `PRG,OK` / `EPG,OK` — not bare `OK`
- `_cmd_lock` required to prevent polling thread colliding with API commands

### Fixed (during Phase 1 development)
- Response parsing was checking raw string for `"OK"` — fixed to parse comma-separated fields first
- `_parse()` now correctly strips command echo (`VOL,10` → `["10"]`)
- Frequency scale applied consistently: `GLG` and `CIN` wire values × 100 = Hz

---

## [Unreleased]

### Planned — Phase 5: Automatic Audio Recording
- Record audio when squelch opens using system audio / PortAudio
- Save timestamped `.wav` files to `recordings/`
- API endpoints to list, play, and delete recordings
- Recording toggle in the UI

### Planned — Phase 6: UI Polish, Settings Page, Channel Manager
- Settings page: port config, poll interval, backlight default, recording toggle
- Channel manager: view, edit, and programme all 500 channels
- Scan group visual toggle grid
- Priority mode control in UI
- Mobile-responsive layout option

---

*BC125AT Web Controller — built for radio enthusiasts who think the scanner deserved better software.*
