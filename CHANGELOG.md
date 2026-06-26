# Changelog

All notable changes to the BC125AT Web Controller are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions.
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
