"""
app.py - Application entry point.

Creates the Flask app, binds SocketIO, attaches the shared Scanner
instance, registers API blueprints and SocketIO events, and serves
the dashboard.

    python app.py
"""

import logging

from flask import Flask, render_template

from api import register_api
from api.socket import socketio
from config import config
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

# ── SocketIO — init_app pattern avoids circular imports ───────────────────
socketio.init_app(app)

# ── Scanner — single shared instance attached to app ──────────────────────
scanner = Scanner()
app.scanner = scanner

# ── Register API blueprints + SocketIO events ─────────────────────────────
register_api(app)


# ── Dashboard route ────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# ── Wire scanner state callback → SocketIO push ───────────────────────────
def on_scanner_state(state: dict) -> None:
    """Called by the scanner poll thread on every state update."""
    socketio.emit("scanner_state", state)


def on_scanner_error(message: str) -> None:
    """Called when the scanner loses connection."""
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
        )
    finally:
        scanner.disconnect()
