"""Server-side transmission detector for scanner state snapshots."""

import logging
import threading
import time

from .db import add_transmission, mark_transmission_skipped, utc_now_iso

logger = logging.getLogger(__name__)

MIN_DWELL_S = 0.8
FREQ_TOLERANCE = 0.001  # MHz — same frequency while dwelling
SKIP_MATCH_MHZ = 0.005  # ±5 kHz — Smart Resume blocklist tolerance
SKIP_GRACE_S = 5.0      # a just-finished dwell can still be marked skipped


class TransmissionTracker:
    """Track stable frequencies from scanner state and persist history to SQLite."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._dwell_freq: float | None = None
        self._dwell_start: float | None = None
        self._dwell_timestamp: str | None = None
        self._dwell_state: dict | None = None
        self._pending_skipped = False
        # Last dwell written to SQLite — lets a late skip request find its row
        self._last_saved_id: int | None = None
        self._last_saved_freq: float | None = None
        self._last_saved_at: float | None = None

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

    def flush(self) -> None:
        """Save the in-progress dwell (call on shutdown so it isn't lost)."""
        with self._lock:
            self._finish_dwell(time.monotonic())
            self._dwell_freq = None
            self._dwell_start = None
            self._dwell_timestamp = None
            self._dwell_state = None
            self._pending_skipped = False

    def mark_current_skipped(self, frequency_mhz: float | None = None) -> bool:
        """
        Mark the transmission Smart Resume just skipped.

        Prefers the in-progress dwell. If the scanner already moved on before
        the request arrived, marks the dwell that was saved a moment ago —
        never an older transmission on the same frequency.
        """
        now = time.monotonic()
        with self._lock:
            target = frequency_mhz or self._dwell_freq

            if self._dwell_freq is not None and (
                not target or abs(target - self._dwell_freq) <= SKIP_MATCH_MHZ
            ):
                self._pending_skipped = True
                return True

            recent = (
                self._last_saved_id is not None
                and self._last_saved_at is not None
                and now - self._last_saved_at <= SKIP_GRACE_S
                and (not target or abs(target - self._last_saved_freq) <= SKIP_MATCH_MHZ)
            )
            if not recent:
                return False
            row_id = self._last_saved_id

        return mark_transmission_skipped(row_id)

    def _start_dwell(self, freq: float, state: dict, now: float) -> None:
        self._dwell_freq = freq
        self._dwell_start = now
        self._dwell_timestamp = utc_now_iso()
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
            "timestamp": self._dwell_timestamp or utc_now_iso(),
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
            row_id = add_transmission(entry)
        except Exception as exc:
            logger.warning("Could not store transmission history: %s", exc)
            return
        if row_id is not None:
            self._last_saved_id = row_id
            self._last_saved_freq = self._dwell_freq
            self._last_saved_at = now
