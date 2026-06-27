"""
scanner/serial_manager.py - Low-level serial port management.

Responsibilities:
  - Open / close the serial port
  - Send raw command strings to the scanner
  - Read raw response lines from the scanner
  - Auto-reconnect if the connection is lost
  - Thread-safe access via a lock

Nothing in this module knows about BC125AT commands — it only moves bytes.
"""

import logging
import threading
import time

import serial

from config import config

logger = logging.getLogger(__name__)


class SerialManager:
    """
    Manages the serial connection to the BC125AT scanner.

    Usage:
        mgr = SerialManager()
        mgr.connect()
        response = mgr.send_command("MDL")
        mgr.disconnect()
    """

    def __init__(self, port: str | None = None, baud: int | None = None) -> None:
        self.port = port or config.SCANNER_PORT
        self.baud = baud or config.SCANNER_BAUD
        self._serial: serial.Serial | None = None
        self._lock = threading.Lock()
        self._connected = False

    # ------------------------------------------------------------------
    # Public properties
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        """True when the serial port is open and ready."""
        return self._connected and self._serial is not None and self._serial.is_open

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """
        Open the serial port.
        Returns True on success, False on failure (logs error, does not raise).
        """
        with self._lock:
            if self.is_connected:
                logger.debug("connect() called but already connected — skipping.")
                return True

            try:
                self._serial = serial.Serial(
                    port=self.port,
                    baudrate=self.baud,
                    bytesize=serial.EIGHTBITS,
                    parity=serial.PARITY_NONE,
                    stopbits=serial.STOPBITS_ONE,
                    timeout=0.2,        # 200ms — fast enough for BC125AT responses
                    write_timeout=1.0,
                    xonxoff=False,
                    rtscts=False,
                    dsrdtr=False,
                )
                self._connected = True
                logger.info("Connected to scanner on %s at %d baud.", self.port, self.baud)
                return True

            except serial.SerialException as exc:
                self._connected = False
                self._serial = None
                logger.error("Failed to open %s: %s", self.port, exc)
                return False

    def disconnect(self) -> None:
        """Close the serial port cleanly."""
        with self._lock:
            if self._serial and self._serial.is_open:
                try:
                    self._serial.close()
                    logger.info("Disconnected from scanner on %s.", self.port)
                except serial.SerialException as exc:
                    logger.warning("Error while closing port: %s", exc)
            self._connected = False
            self._serial = None

    def reconnect(self, attempts: int = 5, delay: float = 2.0) -> bool:
        """
        Attempt to reconnect after a connection loss.

        Args:
            attempts: Maximum number of tries before giving up.
            delay:    Seconds to wait between attempts.

        Returns True if reconnection succeeded, False otherwise.
        """
        logger.info("Attempting to reconnect to %s...", self.port)
        self.disconnect()
        for attempt in range(1, attempts + 1):
            logger.info("Reconnect attempt %d/%d...", attempt, attempts)
            if self.connect():
                logger.info("Reconnected successfully on attempt %d.", attempt)
                return True
            time.sleep(delay)
        logger.error("Could not reconnect after %d attempts.", attempts)
        return False

    # ------------------------------------------------------------------
    # Raw I/O
    # ------------------------------------------------------------------

    def send_raw(self, data: str) -> bool:
        """
        Write a raw string to the serial port (appends \\r\\n automatically).
        Returns True on success, False on failure.
        """
        if not self.is_connected:
            logger.warning("send_raw() called while disconnected.")
            return False

        with self._lock:
            try:
                line = (data.strip() + "\r\n").encode("ascii")
                self._serial.write(line)
                logger.debug("TX: %s", data.strip())
                return True
            except serial.SerialException as exc:
                logger.error("Write error: %s", exc)
                self._connected = False
                return False

    def read_line(self) -> str | None:
        """
        Read one line from the scanner (blocks up to the read timeout).
        Returns the decoded string (stripped) or None if nothing arrived.
        """
        if not self.is_connected:
            return None

        with self._lock:
            try:
                raw = self._serial.readline()
                if not raw:
                    return None
                line = raw.decode("ascii", errors="replace").strip()
                if line:
                    logger.debug("RX: %s", line)
                return line or None
            except serial.SerialException as exc:
                logger.error("Read error: %s", exc)
                self._connected = False
                return None

    def flush_input(self) -> None:
        """Discard any unread bytes waiting in the input buffer."""
        if self.is_connected:
            with self._lock:
                try:
                    self._serial.reset_input_buffer()
                except serial.SerialException:
                    pass
