"""
api/routes.py - Flask REST API endpoints for the BC125AT scanner.

All routes registered on 'scanner_bp' Blueprint with /api prefix.
Scanner instance injected via current_app — never imported directly.

Endpoints:
    GET  /api/health                    — server + scanner health check
    GET  /api/status                    — full scanner state snapshot
    POST /api/key/<key>                 — simulate a key press
    GET  /api/volume                    — get current volume
    POST /api/volume/<int:level>        — set volume (0-15)
    GET  /api/squelch                   — get current squelch
    POST /api/squelch/<int:level>       — set squelch (0-15)
    GET  /api/backlight                 — get backlight mode
    POST /api/backlight/<mode>          — set backlight mode
    GET  /api/channel/<int:ch>          — get channel info (1-500)
    POST /api/channel/<int:ch>          — jump to channel (1-500)
    POST /api/frequency/<int:freq_hz>   — tune to frequency in Hz
    GET  /api/groups                    — get scan group states
    POST /api/groups                    — set scan group states
    GET  /api/priority                  — get priority mode
    POST /api/priority/<mode>           — set priority mode
    POST /api/scan                      — start scanning
    POST /api/hold                      — hold on current channel
    POST /api/power/off                 — power off scanner
"""

import logging
from functools import wraps

from flask import Blueprint, current_app, jsonify, request

logger = logging.getLogger(__name__)

scanner_bp = Blueprint("scanner", __name__, url_prefix="/api")

BACKLIGHT_MODES = {
    "AO": "Always on",
    "AF": "Always off",
    "KY": "On when key pressed",
    "SQ": "On when squelch opens",
    "KS": "On when key pressed or squelch opens",
}

PRIORITY_MODES = {
    "0": "Off",
    "1": "On",
    "2": "Plus",
    "3": "DND (Do Not Disturb)",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_scanner():
    return current_app.scanner


def success(data: dict | None = None, message: str = "OK", status: int = 200):
    payload = {"success": True, "message": message}
    if data is not None:
        payload["data"] = data
    return jsonify(payload), status


def error(message: str, status: int = 400, details: str | None = None):
    payload = {"success": False, "message": message}
    if details is not None:
        payload["details"] = details
    return jsonify(payload), status


def scanner_required(f):
    """Decorator: return 503 if scanner is not connected."""

    @wraps(f)
    def wrapper(*args, **kwargs):
        if not get_scanner().is_connected:
            return error("Scanner is not connected.", status=503)
        return f(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@scanner_bp.get("/health")
def health():
    """GET /api/health — server and scanner connection status."""
    return success(
        {
            "server": "online",
            "scanner_connected": get_scanner().is_connected,
        }
    )


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@scanner_bp.get("/status")
@scanner_required
def status():
    """GET /api/status — full scanner state snapshot."""
    return success(get_scanner().state)


# ---------------------------------------------------------------------------
# Key press
# ---------------------------------------------------------------------------


@scanner_bp.post("/key/<key>")
@scanner_required
def press_key(key: str):
    """
    POST /api/key/<key> — Simulate a key press.
    Valid: menu, func, scan, hold, search, weather, lockout, power,
           enter, up, down, left, right, 0-9, dot, yes, no
    """
    ok = get_scanner().press_key(key)
    if not ok:
        return error(
            f"Key '{key}' failed or is not recognised.",
            details="Valid keys: menu, func, scan, hold, search, weather, lockout, "
            "power, enter, up, down, left, right, 0-9, dot, yes, no",
        )
    return success(message=f"Key '{key}' sent.")


# ---------------------------------------------------------------------------
# Volume
# ---------------------------------------------------------------------------


@scanner_bp.get("/volume")
@scanner_required
def get_volume():
    """GET /api/volume — Current volume level (0-15)."""
    return success({"volume": get_scanner().state.get("volume", 0)})


@scanner_bp.post("/volume/<int:level>")
@scanner_required
def set_volume(level: int):
    """POST /api/volume/<level> — Set volume (0-15)."""
    if not 0 <= level <= 15:
        return error("Volume out of range.", details="Level must be 0–15.")
    ok = get_scanner().set_volume(level)
    if not ok:
        return error("Failed to set volume.", details="Scanner did not acknowledge.")
    return success({"volume": level}, message=f"Volume set to {level}.")


# ---------------------------------------------------------------------------
# Squelch
# ---------------------------------------------------------------------------


@scanner_bp.get("/squelch")
@scanner_required
def get_squelch():
    """GET /api/squelch — Current squelch level (0-15)."""
    return success({"squelch": get_scanner().state.get("squelch", 0)})


@scanner_bp.post("/squelch/<int:level>")
@scanner_required
def set_squelch(level: int):
    """POST /api/squelch/<level> — Set squelch (0-15)."""
    if not 0 <= level <= 15:
        return error("Squelch out of range.", details="Level must be 0–15.")
    ok = get_scanner().set_squelch(level)
    if not ok:
        return error("Failed to set squelch.", details="Scanner did not acknowledge.")
    return success({"squelch": level}, message=f"Squelch set to {level}.")


# ---------------------------------------------------------------------------
# Backlight
# ---------------------------------------------------------------------------


@scanner_bp.get("/backlight")
@scanner_required
def get_backlight():
    """GET /api/backlight — Current backlight mode."""
    info = get_scanner().get_backlight()
    if info is None:
        return error("Could not read backlight mode.", status=502)
    mode = info.get("backlight", "")
    return success(
        {"backlight": mode, "description": BACKLIGHT_MODES.get(mode, "Unknown")}
    )


@scanner_bp.post("/backlight/<mode>")
@scanner_required
def set_backlight(mode: str):
    """
    POST /api/backlight/<mode> — Set backlight mode.
    Valid: AO (always on), AF (always off), KY, SQ, KS.
    Aliases 'on' and 'off' also accepted.
    """
    ok = get_scanner().set_backlight(mode)
    if not ok:
        return error(
            f"Invalid or failed backlight mode '{mode}'.",
            details="Valid: AO (always on), AF (always off), KY, SQ, KS. "
            "Aliases 'on' and 'off' accepted.",
        )
    return success(message=f"Backlight set to {mode.upper()}.")


# ---------------------------------------------------------------------------
# Channel
# ---------------------------------------------------------------------------


@scanner_bp.get("/channel/<int:ch>")
@scanner_required
def get_channel(ch: int):
    """GET /api/channel/<ch> — Fetch info for channel 1-500."""
    if not 1 <= ch <= 500:
        return error(
            "Channel out of range.", details="BC125AT supports channels 1–500."
        )
    info = get_scanner().get_channel_info(ch)
    if info is None:
        return error(f"Could not retrieve info for channel {ch}.", status=502)
    return success(info)


@scanner_bp.post("/channel/<int:ch>")
@scanner_required
def jump_to_channel(ch: int):
    """POST /api/channel/<ch> — Jump to channel 1-500."""
    if not 1 <= ch <= 500:
        return error(
            "Channel out of range.", details="BC125AT supports channels 1–500."
        )
    ok = get_scanner().jump_to_channel(ch)
    if not ok:
        return error(f"Failed to jump to channel {ch}.")
    return success({"channel": ch}, message=f"Jumped to channel {ch}.")


# ---------------------------------------------------------------------------
# Scan groups
# ---------------------------------------------------------------------------


@scanner_bp.get("/groups")
@scanner_required
def get_groups():
    """GET /api/groups — Scan channel group states (10 groups)."""
    info = get_scanner().get_scan_groups()
    if info is None:
        return error("Could not read scan groups.", status=502)
    groups = info.get("groups", [])
    return success(
        {
            "groups": [
                {"group": i + 1, "scanning": enabled}
                for i, enabled in enumerate(groups)
            ]
        }
    )


@scanner_bp.post("/groups")
@scanner_required
def set_groups():
    """
    POST /api/groups — Set scan channel group states.
    Body: {"groups": [true, false, true, ...]}  (exactly 10 booleans)
    """
    body = request.get_json(silent=True)
    if not body or "groups" not in body:
        return error("Request body must be JSON with a 'groups' key.")
    groups = body["groups"]
    if not isinstance(groups, list) or len(groups) != 10:
        return error("'groups' must be a list of exactly 10 booleans.")
    ok = get_scanner().set_scan_groups([bool(g) for g in groups])
    if not ok:
        return error("Failed to set scan groups.")
    return success(message="Scan groups updated.")


# ---------------------------------------------------------------------------
# Priority mode
# ---------------------------------------------------------------------------


@scanner_bp.get("/priority")
@scanner_required
def get_priority():
    """GET /api/priority — Current priority mode."""
    info = get_scanner().get_priority_mode()
    if info is None:
        return error("Could not read priority mode.", status=502)
    return success(info)


@scanner_bp.post("/priority/<mode>")
@scanner_required
def set_priority(mode: str):
    """POST /api/priority/<mode> — Set priority. Valid: 0=Off, 1=On, 2=Plus, 3=DND."""
    ok = get_scanner().set_priority_mode(mode)
    if not ok:
        return error(
            f"Invalid priority mode '{mode}'.",
            details="Valid: 0=Off, 1=On, 2=Plus, 3=DND.",
        )
    return success(
        {"priority_mode": mode, "description": PRIORITY_MODES.get(mode, "")},
        message=f"Priority set to {PRIORITY_MODES.get(mode, mode)}.",
    )


# ---------------------------------------------------------------------------
# Scan / Hold
# ---------------------------------------------------------------------------


@scanner_bp.post("/scan")
@scanner_required
def start_scan():
    """POST /api/scan — Resume scanning."""
    ok = get_scanner().press_key("scan")
    if not ok:
        return error("Failed to start scan.")
    return success(message="Scanning resumed.")


@scanner_bp.post("/hold")
@scanner_required
def hold():
    """POST /api/hold — Hold on current channel or frequency."""
    ok = get_scanner().press_key("hold")
    if not ok:
        return error("Failed to hold.")
    return success(message="Holding on current channel.")


# ---------------------------------------------------------------------------
# Power
# ---------------------------------------------------------------------------


@scanner_bp.post("/power/off")
@scanner_required
def power_off():
    """POST /api/power/off — Power off the scanner."""
    ok = get_scanner().power_off()
    if not ok:
        return error("Failed to power off scanner.")
    return success(message="Scanner powered off.")


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------


@scanner_bp.errorhandler(404)
def not_found(e):
    return error("Endpoint not found.", status=404, details=str(e))


@scanner_bp.errorhandler(405)
def method_not_allowed(e):
    return error("Method not allowed.", status=405, details=str(e))


@scanner_bp.errorhandler(500)
def internal_error(e):
    logger.exception("Unhandled error in API route.")
    return error("Internal server error.", status=500, details=str(e))
