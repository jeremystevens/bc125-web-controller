# Changelog

All notable changes to the BC125AT Web Controller are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions.
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
