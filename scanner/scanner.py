"""
scanner/scanner.py - High-level scanner controller.

Wraps SerialManager + commands into a single object that:
  - Connects and verifies scanner identity
  - Maintains a live state dict updated by a background polling thread
  - Uses a command lock to prevent polling colliding with API commands
  - Fires a state callback on every poll cycle (SocketIO push in app.py)
  - Fires an error callback on connection loss
  - Exposes clean methods for the API layer to call

Protocol notes:
  - VOL and SQL have both GET and SET commands
  - KEY requires single-char codes — see commands.KEY_MAP
  - Program mode (PRG/EPG) is handled internally by commands that need it
  - Frequencies on the wire are in units of 100 Hz
"""

import logging
import threading
import time
from collections.abc import Callable

from config import config

from . import commands as cmd
from .serial_manager import SerialManager

logger = logging.getLogger(__name__)


class Scanner:
    """High-level controller for the BC125AT scanner."""

    def __init__(self, port: str | None = None) -> None:
        self._mgr = SerialManager(port=port)
        self._state: dict = self._empty_state()
        self._state_lock = threading.Lock()
        self._cmd_lock = threading.Lock()
        self._poll_thread: threading.Thread | None = None
        self._polling = False
        self._on_state_change: Callable[[dict], None] | None = None
        self._on_error: Callable[[str], None] | None = None

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """Open serial port, verify scanner identity, start polling thread."""
        if not self._mgr.connect():
            return False

        time.sleep(0.5)

        with self._cmd_lock:
            model_info = cmd.get_model(self._mgr)
            if model_info is None:
                logger.error("Scanner did not respond to MDL — check port and cable.")
                self._mgr.disconnect()
                return False

            fw_info = cmd.get_firmware(self._mgr)
            vol_info = cmd.get_volume(self._mgr)
            sql_info = cmd.get_squelch(self._mgr)
            bat_info = cmd.get_battery_voltage(self._mgr)

        with self._state_lock:
            self._state["connected"] = True
            self._state["model"] = model_info.get("model", "Unknown")
            self._state["firmware"] = (
                fw_info.get("firmware", "Unknown") if fw_info else "Unknown"
            )
            self._state["volume"] = vol_info.get("volume", 0) if vol_info else 0
            self._state["squelch"] = sql_info.get("squelch", 0) if sql_info else 0
            self._state["battery_volts"] = (
                bat_info.get("battery_volts", 0.0) if bat_info else 0.0
            )

        logger.info(
            "Scanner ready: %s  Firmware: %s  Battery: %.2fV",
            self._state["model"],
            self._state["firmware"],
            self._state["battery_volts"],
        )

        self._start_polling()
        return True

    def disconnect(self) -> None:
        self._stop_polling()
        self._mgr.disconnect()
        with self._state_lock:
            self._state["connected"] = False
        logger.info("Scanner disconnected.")

    def reconnect(self) -> bool:
        self._stop_polling()
        if self._mgr.reconnect():
            self._start_polling()
            return True
        return False

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    @property
    def state(self) -> dict:
        with self._state_lock:
            return dict(self._state)

    @property
    def is_connected(self) -> bool:
        return self._mgr.is_connected

    def register_state_callback(self, callback: Callable[[dict], None]) -> None:
        """
        Register a function called on every poll cycle with the full state dict.
        Used by app.py to push updates via SocketIO.
        """
        self._on_state_change = callback

    def register_error_callback(self, callback: Callable[[str], None]) -> None:
        """
        Register a function called when the scanner connection is lost.
        Used by app.py to push a scanner_error event via SocketIO.
        """
        self._on_error = callback

    # ------------------------------------------------------------------
    # Controls
    # ------------------------------------------------------------------

    def press_key(self, key: str) -> bool:
        with self._cmd_lock:
            return cmd.press_key(self._mgr, key)

    def set_volume(self, level: int) -> bool:
        with self._cmd_lock:
            ok = cmd.set_volume(self._mgr, level)
        if ok:
            with self._state_lock:
                self._state["volume"] = max(0, min(15, int(level)))
        return ok

    def set_squelch(self, level: int) -> bool:
        with self._cmd_lock:
            ok = cmd.set_squelch(self._mgr, level)
        if ok:
            with self._state_lock:
                self._state["squelch"] = max(0, min(15, int(level)))
        return ok

    def set_backlight(self, mode: str) -> bool:
        with self._cmd_lock:
            return cmd.set_backlight(self._mgr, mode)

    def get_backlight(self) -> dict | None:
        with self._cmd_lock:
            return cmd.get_backlight(self._mgr)

    def jump_to_channel(self, channel: int) -> bool:
        with self._cmd_lock:
            return cmd.jump_to_channel(self._mgr, channel)

    def get_channel_info(self, channel: int) -> dict | None:
        with self._cmd_lock:
            return cmd.get_channel(self._mgr, channel)

    def get_scan_groups(self) -> dict | None:
        with self._cmd_lock:
            return cmd.get_scan_groups(self._mgr)

    def set_scan_groups(self, groups: list[bool]) -> bool:
        with self._cmd_lock:
            return cmd.set_scan_groups(self._mgr, groups)

    def get_priority_mode(self) -> dict | None:
        with self._cmd_lock:
            return cmd.get_priority_mode(self._mgr)

    def set_priority_mode(self, mode: str) -> bool:
        with self._cmd_lock:
            return cmd.set_priority_mode(self._mgr, mode)

    def power_off(self) -> bool:
        with self._cmd_lock:
            return cmd.power_off(self._mgr)

    # ------------------------------------------------------------------
    # Background polling
    # ------------------------------------------------------------------

    def _start_polling(self) -> None:
        if self._polling:
            return
        self._polling = True
        self._poll_thread = threading.Thread(
            target=self._poll_loop, name="scanner-poll", daemon=True
        )
        self._poll_thread.start()
        logger.info("Polling started (interval=%.1fs).", config.SCANNER_POLL_INTERVAL)

    def _stop_polling(self) -> None:
        self._polling = False
        if self._poll_thread and self._poll_thread.is_alive():
            self._poll_thread.join(timeout=3.0)
        self._poll_thread = None
        logger.info("Polling stopped.")

    def _poll_loop(self) -> None:
        consecutive_errors = 0

        while self._polling:
            if not self._mgr.is_connected:
                logger.warning("Connection lost — attempting reconnect...")
                if self._on_error:
                    try:
                        self._on_error(
                            "Scanner connection lost — attempting to reconnect."
                        )
                    except Exception:
                        pass
                if not self._mgr.reconnect():
                    logger.error("Reconnect failed. Retrying in 5s.")
                    time.sleep(5.0)
                    continue
                consecutive_errors = 0

            try:
                self._do_poll()
                consecutive_errors = 0
            except Exception as exc:
                consecutive_errors += 1
                logger.error("Poll error #%d: %s", consecutive_errors, exc)
                if consecutive_errors >= 5:
                    logger.error("Too many consecutive errors — marking disconnected.")
                    self._mgr._connected = False

            time.sleep(config.SCANNER_POLL_INTERVAL)

    def _do_poll(self) -> None:
        """Fetch status, update cached state, fire state callback."""
        with self._cmd_lock:
            status = cmd.get_status(self._mgr)
            glg = cmd.get_reception_status(self._mgr)

        updated: dict = {}

        if status:
            updated.update(
                {
                    "display_line1": status["display_line1"],
                    "display_line2": status["display_line2"],
                    "signal_strength": status["signal_strength"],
                    "squelch_open": status["squelch_open"],
                    "muted": status["muted"],
                }
            )

        if glg:
            updated.update(
                {
                    "frequency_mhz": glg["frequency_mhz"],
                    "modulation": glg["modulation"],
                    "channel_id": glg["channel_id"],
                    "channel_name": glg["channel_name"],
                }
            )

        if updated:
            with self._state_lock:
                self._state.update(updated)
                snapshot = dict(self._state)

            if self._on_state_change:
                try:
                    self._on_state_change(snapshot)
                except Exception as exc:
                    logger.warning("State callback error: %s", exc)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _empty_state() -> dict:
        return {
            "connected": False,
            "model": "",
            "firmware": "",
            "display_line1": "",
            "display_line2": "",
            "frequency_mhz": 0.0,
            "modulation": "",
            "channel_id": 0,
            "channel_name": "",
            "signal_strength": 0,
            "squelch_open": False,
            "muted": False,
            "volume": 0,
            "squelch": 0,
            "battery_volts": 0.0,
        }
