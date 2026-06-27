<div align="center">

# `VERSIONS`

*BC125AT Web Controller — Release History*

</div>

---

```
v0.1.0  ████████████████████████████████  Serial Communication Foundation
v0.2.0  ████████████████████████████████  REST API
v0.3.0  ████████████████████████████████  Web Dashboard
v0.4.0  ████████████████████████████████  Real-Time WebSockets
v0.5.0  ████████████████████████████████  Manual Audio Recording
v0.5.3  ████████████████████████████████  Stability & Reliability Improvements
v0.6.0  ████████████████████████████████  Channel Manager & Settings
v0.6.1  ████████████████████████████████  Performance Optimizations
```

---

## `v0.1.0` — Serial Communication Foundation

> *The hardware layer. Everything starts here.*

Established the core serial communication package with full BC125AT protocol support. Thread-safe connection management, auto-reconnect, correct frequency scaling (`×100 Hz`), LCD character decoding, and a complete command set covering identification, status polling, key emulation, backlight, channel access, scan groups, and priority mode.

---

## `v0.2.0` — REST API

> *Every scanner function, accessible as clean JSON.*

Built the Flask REST API layer on top of the serial package — 18 endpoints covering health, status, key presses, volume, squelch, backlight, channel info, channel jumping, scan groups, priority mode, scan, hold, and power. Consistent `{ success, message, data }` envelope on every response. Hardware layer and web layer fully decoupled via Flask Blueprints.

---

## `v0.3.0` — Web Dashboard

> *The radio panel comes to life.*

Dark green-on-black UI built to feel like a piece of radio equipment — not a generic web app. Live frequency display, full keypad with flash feedback, volume and squelch sliders, backlight mode switcher, direct channel jump, signal bars, battery voltage indicator, and a timestamped activity log. 600ms polling loop (replaced in v0.4.0).

---

## `v0.4.0` — Real-Time WebSockets

> *Zero-latency push. The display reacts instantly.*

Replaced the poll loop with Flask-SocketIO in threading mode. The scanner poll thread now pushes every state update directly to all connected browsers via `scanner_state` events. Added `scanner_error` push on connection loss, ping/pong health checks, and auto-reconnect with exponential backoff. Switched from eventlet to threading mode for stability on Windows.

---

## `v0.5.0` — Manual Audio Recording

> *Capture what you hear.*

Added a self-contained `recorder/` package with manual start/stop recording from the system default audio input. 3-second tail prevents clipping the end of transmissions. Timestamped WAV files saved to `recordings/`. Full recordings list in the UI with download and delete. Recorder status piggybacked on the existing SocketIO push — no extra events needed.

---

## `v0.5.3` — Stability & Reliability Improvements

> *Four bugs fixed. Everything tightened up.*

**WebSocket disconnects** — `transport close` errors caused by eventlet 0.41 incompatibility on Windows. Fixed by switching to `async_mode="threading"`. **Frequency display frozen** — `_parse()` was stripping middle empty fields in GLG responses, shifting all field indexes by one during active scanning. **Ping timeout** — server timeout was shorter than client ping interval. **Recording UI** — oversized buttons and disconnected layout redesigned into a clean two-column panel.

---

## `v0.6.0` — Channel Manager & Settings

> *Full control over all 500 channels.*

Three-tab single-page layout: Dashboard · Channels · Settings. Channel manager with bank pagination (10 banks × 50 channels), full table view, inline edit modal covering name, frequency, modulation, CTCSS/DCS, delay, lockout, and priority. Settings page with serial config (saved to `.env`), live scan group toggles, live priority mode switching, recording info, and server status panel. Six new API endpoints.

---

## `v0.6.1` — Performance Optimizations

> *Channel loading cut from 25 seconds to under 6.*

Four targeted optimisations to bulk channel reads: serial read timeout reduced from `1.0s` to `0.2s`, command timeout reduced from `2.0s` to `0.5s` for bulk reads, read poll interval reduced from `50ms` to `10ms`, and background poll thread paused during bulk reads to eliminate serial port contention. Animated progress bar added to the channel table during loading.

---

<div align="center">

`v0.1.0 → v0.6.1` · 8 releases · MIT License

*Built for radio enthusiasts who think the scanner deserved better software.*

</div>
