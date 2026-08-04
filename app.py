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

from config import config
from scanner import Scanner
from recorder import Recorder
from recorder.session_recorder import SessionRecorder
from auth import auth_bp, is_admin, admin_required
from api import register_api
from api.socket import socketio

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Flask app ──────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config["SECRET_KEY"] = config.SECRET_KEY


@app.context_processor
def inject_auth():
    """Make is_admin() available in all templates as {{ admin }}."""
    return {"admin": is_admin()}


# ── SocketIO ───────────────────────────────────────────────────────────────
socketio.init_app(app)

# ── Scanner ────────────────────────────────────────────────────────────────
scanner = Scanner()
app.scanner = scanner

# ── Recorder ──────────────────────────────────────────────────────────────
recorder = Recorder()
session_recorder = SessionRecorder(recorder)
app.recorder = recorder
app.session_recorder = session_recorder

# ── Register API blueprints + SocketIO events ─────────────────────────────
register_api(app)
app.register_blueprint(auth_bp)


# ── Routes ────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/stream/audio")
def stream_audio():
    """
    GET /stream/audio
    Streams raw PCM audio from the system default input as a
    continuous chunked WAV response. The browser plays it via
    <audio src="/stream/audio">.

    Only one sounddevice capture is opened regardless of client count.
    All clients share the same broadcast queue.
    """
    from flask import Response, stream_with_context
    from api.stream import audio_stream_generator

    return Response(
        stream_with_context(audio_stream_generator()),
        mimetype="audio/wav",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",  # disable nginx buffering if proxied
            "Transfer-Encoding": "chunked",
        },
    )


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
    state["session_recorder"] = session_recorder.status()
    socketio.emit("scanner_state", state)
    # Feed every state push to the session recorder
    session_recorder.on_state(state)


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
