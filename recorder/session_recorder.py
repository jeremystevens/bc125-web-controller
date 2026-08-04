"""
recorder/session_recorder.py — Automatic session recorder for BC125AT.

Wraps the manual Recorder to auto-start/stop based on squelch state.
Every transmission that opens squelch gets its own WAV file with a
rich filename and a JSON sidecar containing full metadata.

Filename format:
    YYYY-MM-DD_HH-MM-SS_<freq>MHz_<name>.wav
    YYYY-MM-DD_HH-MM-SS_<freq>MHz_<name>.json  ← sidecar metadata

Sidecar JSON:
    {
        "timestamp":     "2026-06-29T14:32:05.123",
        "frequency_mhz": 483.4125,
        "channel_id":    1,
        "channel_name":  "RCPD Disp",
        "modulation":    "FM",
        "duration_s":    4.2,
        "filename":      "2026-06-29_14-32-05_483.4125MHz_RCPD-Disp.wav"
    }
"""

import json
import logging
import re
import threading
import time
from datetime import datetime
from pathlib import Path

from config import config
from recorder.recorder import Recorder, TAIL_SECONDS

logger = logging.getLogger(__name__)

# Minimum dwell time before starting a recording (frequency must be
# stable for this long — same approach as Activity History)
MIN_DWELL_S = 0.8

# Minimum transmission duration to keep a recording
MIN_DURATION_S = 0.5

# Frequency match tolerance (MHz) — same as BC125AT minimum step
FREQ_TOLERANCE = 0.005  # ±5 kHz


def _safe_filename(text: str, max_len: int = 20) -> str:
    """Strip characters that are unsafe in filenames."""
    safe = re.sub(r"[^\w\s\-]", "", text).strip()
    safe = re.sub(r"\s+", "-", safe)
    return safe[:max_len] if safe else ""


class SessionRecorder:
    """
    Automatic session recorder driven by scanner state pushes.

    Call onState(state) every time a scanner state dict arrives.
    The session recorder watches frequency stability and starts/stops the
    underlying Recorder automatically.
    """

    def __init__(self, recorder: Recorder) -> None:
        self._rec = recorder
        self._enabled = False
        self._lock = threading.Lock()

        # Frequency stability tracking (same approach as Activity History)
        # Does NOT rely on squelch_open which is unreliable on BC125AT
        self._dwell_freq: float | None = None  # freq currently dwelling on
        self._dwell_start: float | None = None  # when dwell started
        self._last_state: dict | None = None
        self._dwell_timer: threading.Timer | None = None

        self._recordings_dir = Path(config.RECORDINGS_DIR)

    # ------------------------------------------------------------------
    # Public control
    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return self._enabled

    def enable(self) -> None:
        with self._lock:
            self._enabled = True
            self._dwell_freq = None
            self._dwell_start = None
        logger.info("Session recording enabled.")

    def disable(self) -> None:
        with self._lock:
            self._enabled = False
            if self._dwell_timer is not None:
                self._dwell_timer.cancel()
                self._dwell_timer = None
            if self._rec.is_recording:
                self._rec.stop()
            self._dwell_freq = None
            self._dwell_start = None
        logger.info("Session recording disabled.")

    def status(self) -> dict:
        return {
            "enabled": self._enabled,
            "recording": self._rec.is_recording,
            "current_file": self._rec.current_file,
            "elapsed_seconds": self._rec.elapsed_seconds,
        }

    # ------------------------------------------------------------------
    # State hook — call this from socket.py on every scanner_state push
    # ------------------------------------------------------------------

    def on_state(self, state: dict) -> None:
        if not self._enabled:
            return

        freq = float(state.get("frequency_mhz", 0) or 0)
        self._last_state = state

        if freq <= 0:
            return

        start_timer = False  # set outside lock, acted on after lock released

        with self._lock:
            freq_changed = (
                self._dwell_freq is not None
                and abs(freq - self._dwell_freq) > FREQ_TOLERANCE
            )

            if freq_changed:
                # Cancel any pending dwell timer
                if self._dwell_timer is not None:
                    self._dwell_timer.cancel()
                    self._dwell_timer = None

                # Stop any in-progress recording
                if self._rec.is_recording and self._dwell_start is not None:
                    duration = time.monotonic() - self._dwell_start
                    self._stop_recording(state, duration)

                # Reset to new frequency — timer will be started below
                self._dwell_freq = freq
                self._dwell_start = time.monotonic()
                start_timer = True

            elif self._dwell_freq is None:
                # First reading ever
                self._dwell_freq = freq
                self._dwell_start = time.monotonic()
                start_timer = True
            # else: same frequency, dwell timer already running

        # Start the dwell timer OUTSIDE the lock to avoid deadlock
        # (_start_if_still_dwelling also acquires the lock)
        if start_timer:
            self._schedule_start(state)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _schedule_start(self, state: dict) -> None:
        """Start recording after MIN_DWELL_S of frequency stability."""
        # Cancel any existing timer first
        if self._dwell_timer is not None:
            self._dwell_timer.cancel()
        # Take a snapshot of state for the timer callback
        state_snap = dict(state)
        self._dwell_timer = threading.Timer(
            MIN_DWELL_S, self._start_if_still_dwelling, args=(state_snap,)
        )
        self._dwell_timer.daemon = True
        self._dwell_timer.start()

    def _start_if_still_dwelling(self, state: dict) -> None:
        """Called by timer — only start if still on same frequency."""
        if not self._enabled:
            return
        with self._lock:
            self._dwell_timer = None
            if not self._rec.is_recording:
                self._start_recording(state)

    def _start_recording(self, state: dict) -> None:
        if self._rec.is_recording:
            return  # already recording (tail still running from last tx)

        ch_id = state.get("channel_id", 0)
        freq = state.get("frequency_mhz", 0.0)
        name = state.get("channel_name", "") or ""
        mod = state.get("modulation", "")

        # Build rich filename
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        freq_str = f"{freq:.4f}MHz" if freq else "0MHz"
        name_str = _safe_filename(name)
        parts = [ts, freq_str]
        if name_str:
            parts.append(name_str)
        base_name = "_".join(parts)

        # Override the recorder's default filename by injecting metadata
        result = self._rec.start(
            channel_id=ch_id,
            frequency_mhz=freq,
            name=base_name,  # used for filename if recorder supports it
        )

        # Rename the file to our rich format if recorder used its own scheme
        if result.get("success") and result.get("file"):
            old_path = self._recordings_dir / result["file"]
            new_name = base_name + ".wav"
            new_path = self._recordings_dir / new_name
            try:
                if old_path.exists() and not new_path.exists():
                    old_path.rename(new_path)
                    self._rec._current_file = new_name
                    logger.info("Session recording → %s", new_name)
            except OSError as e:
                logger.warning("Could not rename recording: %s", e)
                new_name = result["file"]

    def _stop_recording(self, state: dict, duration: float) -> None:
        if not self._rec.is_recording:
            return

        filename = self._rec.current_file
        self._rec.stop()

        if duration < MIN_DURATION_S:
            # Too short — schedule deletion after tail completes
            threading.Timer(
                TAIL_SECONDS + 0.5, self._delete_short_recording, args=(filename,)
            ).start()
            logger.debug(
                "Transmission too short (%.2fs) — will delete %s", duration, filename
            )
            return

        # Write sidecar JSON
        if filename:
            threading.Timer(
                TAIL_SECONDS + 0.2,
                self._write_sidecar,
                args=(filename, state, duration),
            ).start()

    def _write_sidecar(self, filename: str, state: dict, duration: float) -> None:
        base = Path(filename).stem
        sidecar = self._recordings_dir / (base + ".json")
        meta = {
            "timestamp": datetime.now().isoformat(),
            "frequency_mhz": state.get("frequency_mhz", 0.0),
            "channel_id": state.get("channel_id", 0),
            "channel_name": state.get("channel_name", ""),
            "modulation": state.get("modulation", ""),
            "duration_s": round(duration, 2),
            "filename": filename,
        }
        try:
            sidecar.write_text(json.dumps(meta, indent=2))
            logger.debug("Sidecar written: %s", sidecar.name)
        except OSError as e:
            logger.warning("Could not write sidecar: %s", e)

    def _delete_short_recording(self, filename: str) -> None:
        if not filename:
            return
        path = self._recordings_dir / filename
        if path.exists():
            try:
                path.unlink()
                logger.debug("Deleted short recording: %s", filename)
            except OSError:
                pass
