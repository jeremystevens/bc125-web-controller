"""
api/socket.py - Shared SocketIO instance.

Defined here to avoid circular imports between app.py, api/events.py
and scanner/scanner.py. Everyone imports socketio from this module.
"""

from flask_socketio import SocketIO

socketio = SocketIO(cors_allowed_origins="*", async_mode="eventlet")
