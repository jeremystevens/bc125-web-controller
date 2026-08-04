"""
config.py - Central configuration loaded from environment / .env file.

All other modules import from here — never read os.environ directly elsewhere.
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # ── Serial ────────────────────────────────────────────────────────
    SCANNER_PORT: str         = os.getenv("SCANNER_PORT", "COM3")
    SCANNER_BAUD: int         = int(os.getenv("SCANNER_BAUD", "115200"))
    SCANNER_POLL_INTERVAL: float = float(os.getenv("SCANNER_POLL_INTERVAL", "0.5"))

    # ── Flask / SocketIO ──────────────────────────────────────────────
    FLASK_HOST: str  = os.getenv("FLASK_HOST", "0.0.0.0")
    FLASK_PORT: int  = int(os.getenv("FLASK_PORT", "5000"))
    FLASK_DEBUG: bool = os.getenv("FLASK_DEBUG", "False").lower() == "true"
    SECRET_KEY: str    = os.getenv("SECRET_KEY", "change-me-in-production")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "")   # empty = auth disabled

    # ── Recordings ────────────────────────────────────────────────────
    RECORDINGS_DIR: str = os.getenv("RECORDINGS_DIR", "recordings")


config = Config()
