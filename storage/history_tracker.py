"""Server-side transmission detector for scanner state snapshots."""

import logging
import threading
import time
from datetime import datetime

from .db import add_transmission, mark_last_transmission_skipped

logger = logging.getLogger(__name__)

MIN_DWELL_S = 0.8
FREQ_TOLERANCE = 0.001  # MHz


class TransmissionTracker:
    """Track stable frequencies from scanner state and persist history to SQLite."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._dwell_freq: float | None = None
        self._dwell_start: float | None = None
        self._dwell_timestamp: str | None = None
        self._dwell_state: dict | None = None
        self._pending_skipped = False

    def on_state(self, state: dict) -> None:
        freq = float(state.get("frequency_mhz", 0) or 0)
        if freq <= 0:
            return

        now = time.monotonic()
        with self._lock:
            if self._dwell_freq is None:
                self._start_dwell(freq, state, now)
                return

            if abs(freq - self._dwell_freq) <= FREQ_TOLERANCE:
                self._dwell_state = dict(state)
                return

            self._finish_dwell(now)
            self._start_dwell(freq, state, now)

    def mark_current_skipped(self, frequency_mhz: float | None = None) -> bool:
        """Mark current/pending dwell as skipped, with DB fallback for recent rows."""
        with self._lock:
            self._pending_skipped = True
            freq = frequency_mhz or self._dwell_freq
        return mark_last_transmission_skipped(freq)

    def _start_dwell(self, freq: float, state: dict, now: float) -> None:
        self._dwell_freq = freq
        self._dwell_start = now
        self._dwell_timestamp = datetime.now().isoformat()
        self._dwell_state = dict(state)
        self._pending_skipped = False

    def _finish_dwell(self, now: float) -> None:
        if self._dwell_freq is None or self._dwell_start is None or self._dwell_state is None:
            return

        duration = now - self._dwell_start
        if duration < MIN_DWELL_S:
            return

        state = self._dwell_state
        entry = {
            "timestamp": self._dwell_timestamp or datetime.now().isoformat(),
            "frequency_mhz": round(self._dwell_freq, 4),
            "channel_id": state.get("channel_id", 0) or 0,
            "channel_name": state.get("channel_name", "") or "",
            "modulation": state.get("modulation", "") or "",
            "duration_s": round(duration, 1),
            "squelch_open": bool(state.get("squelch_open")),
            "skipped": self._pending_skipped,
            "is_discovery": False,
        }
        try:
            add_transmission(entry)
        except Exception as exc:
            logger.warning("Could not store transmission history: %s", exc)
