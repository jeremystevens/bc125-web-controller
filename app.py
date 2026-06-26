"""
app.py - Application entry point.

Creates the Flask app, initialises SocketIO, attaches the shared
Scanner instance, registers API blueprints, and serves the dashboard.

    python app.py
"""

import logging

from flask import Flask, render_template
from flask_socketio import SocketIO

from config import config
from scanner import Scanner
from api import register_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

app     = Flask(__name__)
app.config["SECRET_KEY"] = config.SECRET_KEY
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

scanner      = Scanner()
app.scanner  = scanner

register_routes(app)


@app.route("/")
def index():
    return render_template("index.html")


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
