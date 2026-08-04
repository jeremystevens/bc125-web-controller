"""
test_connection.py - Phase 1 verification script.

Confirms the scanner package can communicate with the BC125AT before
you start the Flask server.

Usage:
    python test_connection.py
    python test_connection.py --port COM4
"""

import argparse
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

from scanner.serial_manager import SerialManager
from scanner import commands as cmd

SEPARATOR = "-" * 52


def run_tests(port: str) -> bool:
    print(SEPARATOR)
    print("  BC125AT Connection Test")
    print(f"  Port: {port}")
    print(SEPARATOR)

    mgr = SerialManager(port=port)

    # 1. Open port
    print("\n[1/6] Opening serial port...")
    if not mgr.connect():
        print("  FAIL — could not open port.")
        print("         Is the scanner on? Is the USB cable connected?")
        print(f"         Override port: python test_connection.py --port COM4")
        return False
    print("  OK")

    # 2. Model
    print("\n[2/6] Requesting model (MDL)...")
    model = cmd.get_model(mgr)
    if model:
        print(f"  OK — {model['model']}")
    else:
        print("  WARN — no response (try from the main scanning screen, not a menu)")

    # 3. Firmware
    print("\n[3/6] Requesting firmware (VER)...")
    fw = cmd.get_firmware(mgr)
    if fw:
        print(f"  OK — {fw['firmware']}")
    else:
        print("  WARN — no response")

    # 4. Status
    print("\n[4/6] Requesting status (STS)...")
    status = cmd.get_status(mgr)
    if status:
        print(f"  OK")
        print(f"       Display line 1 : {status['display_line1']!r}")
        print(f"       Display line 2 : {status['display_line2']!r}")
        print(f"       Signal strength: {status['signal_strength']}")
        print(f"       Squelch open   : {status['squelch_open']}")
        print(f"       Muted          : {status['muted']}")
    else:
        print("  WARN — no response")

    # 5. Reception status
    print("\n[5/6] Requesting reception status (GLG)...")
    glg = cmd.get_reception_status(mgr)
    if glg:
        print(f"  OK")
        print(f"       Frequency : {glg['frequency_mhz']} MHz")
        print(f"       Modulation: {glg['modulation']}")
        print(f"       Channel   : {glg['channel_id']}  {glg['channel_name']!r}")
    else:
        print("  WARN — no response")

    # 6. Volume
    print("\n[6/6] Requesting volume (VOL)...")
    vol = cmd.get_volume(mgr)
    if vol:
        print(f"  OK — level {vol['volume']}")
    else:
        print("  WARN — no response")

    mgr.disconnect()

    print()
    print(SEPARATOR)
    if model and status:
        print("  Result: PASS — scanner is communicating correctly.")
        print("  Ready to move on to Phase 2.")
    else:
        print("  Result: PARTIAL — port opened but some commands got no response.")
        print("  Ensure the scanner is on its main scanning screen (not in a menu).")
    print(SEPARATOR)
    print()

    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test BC125AT serial connection.")
    parser.add_argument("--port", default=None, help="Serial port (e.g. COM3, COM4)")
    args = parser.parse_args()

    from config import config

    port = args.port or config.SCANNER_PORT

    success = run_tests(port)
    sys.exit(0 if success else 1)
