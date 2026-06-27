"""
app.py - Application entry point.

async_mode is 'threading' (see api/socket.py) — more stable than
eventlet on Windows and with recent eventlet versions.

use_reloader=False is required to prevent Flask starting two processes
which would cause the scanner to connect twice and the SocketIO
emitter to run in the wrong process.

    python app.py
"""

import logging
from pathlib import Path

from flask import Flask, render_template, send_from_directory

from api import register_api
from api.socket import socketio
from config import config
from recorder import Recorder
from scanner import Scanner

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Flask app ──────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config["SECRET_KEY"] = config.SECRET_KEY

# ── SocketIO ───────────────────────────────────────────────────────────────
socketio.init_app(app)

# ── Scanner ────────────────────────────────────────────────────────────────
scanner = Scanner()
app.scanner = scanner

# ── Recorder ──────────────────────────────────────────────────────────────
recorder = Recorder()
app.recorder = recorder

# ── Register API blueprints + SocketIO events ─────────────────────────────
register_api(app)


# ── Routes ────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/recordings/<path:filename>")
def serve_recording(filename):
    return send_from_directory(
        Path(config.RECORDINGS_DIR).resolve(),
        filename,
        as_attachment=False,
    )


# ── Wire scanner callbacks → SocketIO push ────────────────────────────────
def on_scanner_state(state: dict) -> None:
    state["recorder"] = recorder.status()
    socketio.emit("scanner_state", state)


def on_scanner_error(message: str) -> None:
    socketio.emit("scanner_error", {"message": message})


scanner.register_state_callback(on_scanner_state)
scanner.register_error_callback(on_scanner_error)

# ── Entry point ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logger.info(
        "Starting BC125AT Web Controller on http://%s:%d",
        config.FLASK_HOST,
        config.FLASK_PORT,
    )

    if not scanner.connect():
        logger.warning(
            "Could not connect to scanner on startup — "
            "server will start anyway. Check cable and port."
        )

    try:
        socketio.run(
            app,
            host=config.FLASK_HOST,
            port=config.FLASK_PORT,
            debug=config.FLASK_DEBUG,
            use_reloader=False,  # required — prevents double scanner connect
            allow_unsafe_werkzeug=True,  # allow Werkzeug in threading mode
        )
    finally:
        scanner.disconnect()
