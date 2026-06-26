"""
api/events.py - Flask-SocketIO event handlers.

The server emits a 'scanner_state' event to all connected clients
every time the scanner poll fires and state changes. Clients can also
send control commands over the socket as an alternative to REST.

Events emitted by server:
    scanner_state   — full state dict, pushed on every poll cycle
    scanner_error   — emitted when scanner disconnects or errors

Events received from client:
    connect         — client connected, send current state immediately
    disconnect      — client disconnected (handled automatically)
    ping            — client health check, server replies with pong
"""

import logging

from flask import request
from flask_socketio import emit

from .socket import socketio

logger = logging.getLogger(__name__)


def register_events(app):
    """Register all SocketIO event handlers with the app context."""

    @socketio.on("connect")
    def on_connect():
        logger.info("Client connected: %s", request.sid)
        # Send current state immediately so the UI doesn't wait for next poll
        scanner = app.scanner
        if scanner.is_connected:
            emit("scanner_state", scanner.state)
        else:
            emit("scanner_error", {"message": "Scanner not connected"})

    @socketio.on("disconnect")
    def on_disconnect():
        logger.info("Client disconnected: %s", request.sid)

    @socketio.on("ping")
    def on_ping():
        emit("pong", {"status": "ok"})
