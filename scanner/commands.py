"""
scanner/commands.py - BC125AT serial command definitions and response parsers.

Key protocol facts (BC125AT PC Protocol V1.01 official document):
  - FREQUENCY_SCALE = 100: wire frequencies in units of 100 Hz
    e.g. CIN example: 290000 on wire = 29000000 Hz = 29.0 MHz
    Channel 1 returning 4834125 → 483412500 Hz = 483.4 MHz (valid UHF)
  - VOL and SQL have both GET and SET (0-15)
  - KEY requires exactly ONE character code; action: P/L/H/R
  - SCG encoding: 0=valid(scanning on), 1=invalid(off) — inverted logic
  - BLT GET response has trailing comma: BLT,AO,
  - QSH does NOT exist on BC125AT (unofficial, BC75XLT only)
  - PRG/EPG responses: PRG,OK and EPG,OK
  - All program-mode commands return CMD,OK on success or CMD,NG on error
"""

import logging
import time

from .serial_manager import SerialManager

logger = logging.getLogger(__name__)

RESPONSE_TIMEOUT = 2.0

# Frequency scale: wire values are in units of 100 Hz
FREQUENCY_SCALE = 100
MIN_FREQUENCY_HZ = 25_000_000    # 25 MHz  (wire: 250000)
MAX_FREQUENCY_HZ = 512_000_000   # 512 MHz (wire: 5120000)

# BC125AT special LCD character map (byte value → UTF-8 replacement)
BYTE_MAP = {
    0x80: '█', 0x81: '↑', 0x82: '↓', 0x83: 'Lo', 0x84: 'Bat', 0x85: 'Lo',
    0x86: 'ck', 0x87: 'C', 0x88: 'C', 0x89: 'C', 0x8A: 'C', 0x8B: '🄵',
    0x8C: '🄿', 0x8D: 'H', 0x8E: 'O', 0x8F: 'L', 0x90: 'D', 0x91: '+',
    0x92: '🄲', 0x93: 'T', 0x94: 'L', 0x95: 'L', 0x96: '/', 0x97: 'O',
    0x98: ' ', 0x99: 'A', 0x9A: 'M', 0x9B: ' ', 0x9C: 'F', 0x9D: 'N',
    0x9E: 'F', 0x9F: ' ', 0xA0: ' ', 0xA1: 'P', 0xA2: 'RI', 0xA3: ' ',
    0xA4: ' ', 0xA5: ' ', 0xA6: '1', 0xA7: '2', 0xA8: '3', 0xA9: '📶',
    0xAA: '4', 0xAB: '📶', 0xAC: '5', 0xAD: '📶', 0xAE: ' ', 0xAF: ' ',
    0xB0: ' ', 0xB1: '[', 0xB2: '█', 0xB3: ']', 0xB4: ' ', 0xB5: 'C',
    0xB6: 'C', 0xB7: 'C', 0xB8: 'C', 0xB9: ' ', 0xBA: ' ', 0xBB: ' ',
    0xBC: ' ', 0xBD: ' ', 0xBE: ' ', 0xBF: ' ', 0xC0: ' ', 0xC1: ' ',
    0xC2: ' ', 0xC3: ' ', 0xC4: ' ', 0xC5: 'S', 0xC6: 'R', 0xC7: 'C:',
    0xC8: ' ', 0xC9: ' ', 0xCA: ' ', 0xCB: ' ', 0xCC: ' ', 0xCD: 'B',
    0xCE: 'N', 0xCF: 'K:', 0xD0: ' ', 0xD1: ' ', 0xD2: ' ', 0xD3: ' ',
    0xD4: 'S', 0xD5: 'V', 0xD6: 'C:', 0xD7: 'D:', 0xD8: 'P', 0xD9: 'R',
    0xDA: 'I', 0xDB: ' ', 0xDC: ' ', 0xDD: ' ', 0xDE: ' ', 0xDF: ' ',
}

# Friendly name → single-character KEY code (KEY requires exactly 1 char)
KEY_MAP: dict[str, str] = {
    "menu":    "M",
    "func":    "F",
    "scan":    "S",
    "hold":    "H",
    "search":  "R",
    "weather": "W",
    "lockout": "L",
    "power":   "P",
    "enter":   "E",
    "up":      "^",
    "down":    "v",
    "left":    "<",
    "right":   ">",
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
    "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    "dot": ".",
    "no":  "N",
    "yes": "Y",
}

KEY_PRESS      = "P"
KEY_LONG_PRESS = "L"
KEY_HOLD       = "H"
KEY_RELEASE    = "R"

BACKLIGHT_ALIASES: dict[str, str] = {
    "on":  "AO",
    "off": "AF",
    "ao":  "AO",
    "af":  "AF",
    "ky":  "KY",
    "sq":  "SQ",
    "ks":  "KS",
}
BACKLIGHT_MODES = ("AO", "AF", "KY", "SQ", "KS")

PRIORITY_MODES = {"0": "Off", "1": "On", "2": "Plus", "3": "DND"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _decode_display(raw: str) -> str:
    """Replace special BC125AT LCD bytes (0x80-0xDF) with readable UTF-8."""
    result = []
    for ch in raw:
        code = ord(ch)
        if code in BYTE_MAP:
            result.append(BYTE_MAP[code])
        elif code < 0x20 or code == 0x7F:
            result.append('')
        else:
            result.append(ch)
    return ''.join(result).strip()


def _wire_to_hz(wire_value: int) -> int:
    """Convert wire frequency (units of 100 Hz) to Hz."""
    return wire_value * FREQUENCY_SCALE


def _hz_to_wire(freq_hz: int) -> int:
    """Convert Hz to wire frequency (units of 100 Hz)."""
    return freq_hz // FREQUENCY_SCALE


def _send_and_receive(mgr: SerialManager, cmd: str) -> str | None:
    """Send *cmd*, return the first non-empty response line or None on timeout."""
    mgr.flush_input()
    if not mgr.send_raw(cmd):
        return None

    deadline = time.monotonic() + RESPONSE_TIMEOUT
    while time.monotonic() < deadline:
        line = mgr.read_line()
        if line:
            return line
        time.sleep(0.05)

    logger.warning("No response to command: %s", cmd)
    return None


def _parse(response: str | None) -> list[str] | None:
    """
    Parse a raw response string into comma-separated parts, stripping the
    command echo at index 0 and any trailing empty fields.

    Examples:
      "VOL,10"        → ["10"]
      "KEY,OK"        → ["OK"]
      "BLT,AO,"       → ["AO"]   (trailing comma stripped)
      "PRG,OK"        → ["OK"]
      "ERR"           → None
      "CIN,NG"        → None
    """
    if not response:
        return None
    parts = [p for p in response.strip().split(",")]
    if not parts or parts[0] == "ERR":
        logger.warning("Scanner returned ERR: %s", response)
        return None
    if len(parts) < 2:
        return None
    # Strip trailing empty fields (e.g. BLT,AO, → ['BLT','AO',''] → ['AO'])
    result = [p for p in parts[1:] if p != '']
    if not result:
        return None
    if result[0] == "NG":
        logger.warning("Scanner returned NG (wrong mode or invalid params): %s", response)
        return None
    return result


def _ok(response: str | None) -> bool:
    """True when the parsed response is ['OK']."""
    parts = _parse(response)
    return parts is not None and parts[0].strip().upper() == "OK"


def _safe_int(value: str, default: int = 0) -> int:
    try:
        return int(value.strip())
    except (ValueError, AttributeError):
        return default


def _enter_program_mode(mgr: SerialManager) -> bool:
    """Send PRG, return True if scanner acknowledged with OK."""
    resp = _send_and_receive(mgr, "PRG")
    if not _ok(resp):
        logger.error("Could not enter program mode (response: %s).", resp)
        return False
    return True


def _exit_program_mode(mgr: SerialManager) -> None:
    """Send EPG — always called even after errors."""
    _send_and_receive(mgr, "EPG")


# ---------------------------------------------------------------------------
# Identification
# ---------------------------------------------------------------------------

def get_model(mgr: SerialManager) -> dict | None:
    """MDL — Request scanner model. Response: MDL,BC125AT"""
    resp = _send_and_receive(mgr, "MDL")
    parts = _parse(resp)
    if parts:
        return {"model": parts[0].strip()}
    return None


def get_firmware(mgr: SerialManager) -> dict | None:
    """VER — Request firmware version. Response: VER,Version 1.06.09"""
    resp = _send_and_receive(mgr, "VER")
    parts = _parse(resp)
    if parts:
        return {"firmware": parts[0].strip()}
    return None


# ---------------------------------------------------------------------------
# Status polling
# ---------------------------------------------------------------------------

def get_status(mgr: SerialManager) -> dict | None:
    """
    STS — Get scanner status (unofficial).
    Response: STS,<line1>,<line2>,<icons>,<signal>,<sql>,<mute>,<battery>
    """
    resp = _send_and_receive(mgr, "STS")
    parts = _parse(resp)
    if not parts:
        return None
    while len(parts) < 7:
        parts.append("")
    return {
        "raw":             resp,
        "display_line1":   _decode_display(parts[0]),
        "display_line2":   _decode_display(parts[1]),
        "icon_flags":      parts[2].strip(),
        "signal_strength": _safe_int(parts[3], 0),
        "squelch_open":    parts[4].strip() == "1",
        "muted":           parts[5].strip() == "1",
        "battery":         parts[6].strip() if len(parts) > 6 else "",
    }


def get_reception_status(mgr: SerialManager) -> dict | None:
    """
    GLG — Get reception status (unofficial).
    Response: GLG,<freq_wire>,<mod>,<att>,<tone>,<grp_id>,<ch_id>,<name>,<sql>,<mute>
    Wire frequency is in units of 100 Hz.
    """
    resp = _send_and_receive(mgr, "GLG")
    parts = _parse(resp)
    if not parts:
        return None
    while len(parts) < 9:
        parts.append("")
    wire_freq = _safe_int(parts[0], 0)
    freq_hz   = _wire_to_hz(wire_freq)
    return {
        "raw":            resp,
        "frequency_hz":   freq_hz,
        "frequency_mhz":  round(freq_hz / 1_000_000, 4) if freq_hz else 0.0,
        "modulation":     parts[1].strip(),
        "attenuation":    parts[2].strip(),
        "ctcss_dcs_tone": parts[3].strip(),
        "group_id":       parts[4].strip(),
        "channel_id":     _safe_int(parts[5], 0),
        "channel_name":   parts[6].strip(),
        "squelch_open":   parts[7].strip() == "1",
        "muted":          parts[8].strip() == "1",
    }


def get_battery_voltage(mgr: SerialManager) -> dict | None:
    """BAV — Get battery voltage (unofficial). raw * 6.4 / 1023 = volts."""
    resp = _send_and_receive(mgr, "BAV")
    parts = _parse(resp)
    if parts:
        raw   = _safe_int(parts[0], 0)
        volts = round(raw * 6.4 / 1023, 2)
        return {"battery_raw": raw, "battery_volts": volts}
    return None


# ---------------------------------------------------------------------------
# Volume & squelch — GET and SET both exist on BC125AT
# ---------------------------------------------------------------------------

def get_volume(mgr: SerialManager) -> dict | None:
    """VOL — Get current volume level (0-15). Response: VOL,<level>"""
    resp = _send_and_receive(mgr, "VOL")
    parts = _parse(resp)
    if parts:
        return {"volume": _safe_int(parts[0], 0)}
    return None


def set_volume(mgr: SerialManager, level: int) -> bool:
    """VOL,<level> — Set volume (0-15). Response: VOL,OK"""
    level = max(0, min(15, int(level)))
    resp = _send_and_receive(mgr, f"VOL,{level}")
    return _ok(resp)


def get_squelch(mgr: SerialManager) -> dict | None:
    """SQL — Get current squelch level (0-15). Response: SQL,<level>"""
    resp = _send_and_receive(mgr, "SQL")
    parts = _parse(resp)
    if parts:
        return {"squelch": _safe_int(parts[0], 0)}
    return None


def set_squelch(mgr: SerialManager, level: int) -> bool:
    """SQL,<level> — Set squelch (0-15). Response: SQL,OK"""
    level = max(0, min(15, int(level)))
    resp = _send_and_receive(mgr, f"SQL,{level}")
    return _ok(resp)


# ---------------------------------------------------------------------------
# Key press
# ---------------------------------------------------------------------------

def press_key(mgr: SerialManager, key: str, action: str = KEY_PRESS) -> bool:
    """
    KEY,<code>,<action> — Simulate a key action.
    key: friendly name from KEY_MAP (case-insensitive).
    action: P=Press (default), L=Long, H=Hold, R=Release
    KEY requires exactly one character code.
    """
    code = KEY_MAP.get(key.lower())
    if code is None:
        logger.warning("Unknown key: '%s'  Valid: %s", key, ", ".join(KEY_MAP.keys()))
        return False
    resp = _send_and_receive(mgr, f"KEY,{code},{action}")
    return _ok(resp)


# ---------------------------------------------------------------------------
# Backlight (requires program mode)
# NOTE: GET response has trailing comma: BLT,AO,  — handled by _parse
# ---------------------------------------------------------------------------

def get_backlight(mgr: SerialManager) -> dict | None:
    """BLT — Get backlight mode. Requires program mode. Response: BLT,<mode>,"""
    if not _enter_program_mode(mgr):
        return None
    resp = _send_and_receive(mgr, "BLT")
    _exit_program_mode(mgr)
    parts = _parse(resp)
    if parts:
        return {"backlight": parts[0].strip()}
    return None


def set_backlight(mgr: SerialManager, mode: str) -> bool:
    """
    BLT,<mode> — Set backlight. Requires program mode.
    Valid: AO (always on), AF (always off), KY, SQ, KS.
    Aliases 'on' and 'off' accepted.
    """
    code = BACKLIGHT_ALIASES.get(mode.lower())
    if code is None:
        logger.warning("Invalid backlight mode: '%s'  Valid: %s", mode, ", ".join(BACKLIGHT_MODES))
        return False
    if not _enter_program_mode(mgr):
        return False
    resp = _send_and_receive(mgr, f"BLT,{code}")
    _exit_program_mode(mgr)
    return _ok(resp)


# ---------------------------------------------------------------------------
# Channel (requires program mode)
# CIN frequency field is in wire units (100 Hz)
# ---------------------------------------------------------------------------

def get_channel(mgr: SerialManager, channel: int) -> dict | None:
    """
    CIN,<ch> — Get channel info. Requires program mode.
    Response: CIN,<idx>,<name>,<freq_wire>,<mod>,<ctcss>,<dly>,<lockout>,<pri>
    Official example: FRQ=290000 (wire) = 29000000 Hz = 29.0 MHz
    """
    if not _enter_program_mode(mgr):
        return None
    resp = _send_and_receive(mgr, f"CIN,{channel}")
    _exit_program_mode(mgr)
    parts = _parse(resp)
    if not parts:
        return None
    while len(parts) < 8:
        parts.append("")
    wire_freq = _safe_int(parts[2], 0)
    freq_hz   = _wire_to_hz(wire_freq)
    return {
        "channel":       _safe_int(parts[0], channel),
        "name":          parts[1].strip(),
        "frequency_hz":  freq_hz,
        "frequency_mhz": round(freq_hz / 1_000_000, 4) if freq_hz else 0.0,
        "modulation":    parts[3].strip(),
        "ctcss_dcs":     parts[4].strip(),
        "delay":         parts[5].strip(),
        "locked_out":    parts[6].strip() == "1",
        "priority":      parts[7].strip() == "1",
    }


def jump_to_channel(mgr: SerialManager, channel: int) -> bool:
    """JNT,,<channel-1> — Jump to channel (zero-indexed, unofficial)."""
    resp = _send_and_receive(mgr, f"JNT,,{channel - 1}")
    return _ok(resp)


# ---------------------------------------------------------------------------
# Scan channel groups (requires program mode)
# SCG encoding: 0=valid(scanning enabled), 1=invalid(disabled) — INVERTED
# Official doc: "########## (each # is 0 or 1) : 0 : valid / 1 : invalid"
# ---------------------------------------------------------------------------

def get_scan_groups(mgr: SerialManager) -> dict | None:
    """SCG — Get scan channel group states. Requires program mode."""
    if not _enter_program_mode(mgr):
        return None
    resp = _send_and_receive(mgr, "SCG")
    _exit_program_mode(mgr)
    parts = _parse(resp)
    if parts:
        raw    = parts[0].strip()
        groups = [c == "0" for c in raw]   # '0'=enabled, '1'=disabled
        return {"groups": groups, "raw": raw}
    return None


def set_scan_groups(mgr: SerialManager, groups: list[bool]) -> bool:
    """
    SCG,<string> — Set scan channel group states. Requires program mode.
    groups: list of 10 bools — True=scanning enabled.
    Wire: True→'0', False→'1' (inverted per official protocol).
    """
    if len(groups) != 10:
        logger.warning("set_scan_groups expects 10 bools, got %d.", len(groups))
        return False
    wire_str = "".join("0" if g else "1" for g in groups)
    if not _enter_program_mode(mgr):
        return False
    resp = _send_and_receive(mgr, f"SCG,{wire_str}")
    _exit_program_mode(mgr)
    return _ok(resp)


# ---------------------------------------------------------------------------
# Priority mode (requires program mode)
# ---------------------------------------------------------------------------

def get_priority_mode(mgr: SerialManager) -> dict | None:
    """PRI — Get priority mode. Requires program mode."""
    if not _enter_program_mode(mgr):
        return None
    resp = _send_and_receive(mgr, "PRI")
    _exit_program_mode(mgr)
    parts = _parse(resp)
    if parts:
        code = parts[0].strip()
        return {"priority_mode": code, "description": PRIORITY_MODES.get(code, "Unknown")}
    return None


def set_priority_mode(mgr: SerialManager, mode: str) -> bool:
    """PRI,<mode> — Set priority mode. Requires program mode. 0=Off 1=On 2=Plus 3=DND"""
    if mode not in PRIORITY_MODES:
        logger.warning("Invalid priority mode: '%s'", mode)
        return False
    if not _enter_program_mode(mgr):
        return False
    resp = _send_and_receive(mgr, f"PRI,{mode}")
    _exit_program_mode(mgr)
    return _ok(resp)


# ---------------------------------------------------------------------------
# Power
# ---------------------------------------------------------------------------

def power_off(mgr: SerialManager) -> bool:
    """POF — Power off the scanner (unofficial)."""
    resp = _send_and_receive(mgr, "POF")
    return _ok(resp)


# ---------------------------------------------------------------------------
# Program mode (public wrappers)
# ---------------------------------------------------------------------------

def enter_program_mode(mgr: SerialManager) -> bool:
    return _enter_program_mode(mgr)


def exit_program_mode(mgr: SerialManager) -> None:
    _exit_program_mode(mgr)


# ---------------------------------------------------------------------------
# Convenience wrappers
# ---------------------------------------------------------------------------

def start_scan(mgr: SerialManager) -> bool:
    return press_key(mgr, "scan")


def hold_scan(mgr: SerialManager) -> bool:
    return press_key(mgr, "hold")
