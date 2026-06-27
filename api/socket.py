"""
api/socket.py - Shared SocketIO instance.

async_mode='threading' is used instead of 'eventlet' for stability
on Windows and with recent versions of eventlet (0.37+) which have
known compatibility issues with Flask-SocketIO.

Threading mode uses the Werkzeug development server with threading
enabled — reliable for local network use and does not require
eventlet or gevent to be installed.

ping_timeout:  how long server waits for client ping response
ping_interval: how often server sends ping to client
"""

from flask_socketio import SocketIO

socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode="threading",
    ping_timeout=60,
    ping_interval=25,
)
