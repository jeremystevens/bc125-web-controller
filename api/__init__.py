"""
api/__init__.py

Registers the scanner Blueprint and SocketIO event handlers with the app.
Call register_api(app) from app.py.
"""

from .routes import scanner_bp
from .events import register_events
from .socket import socketio


def register_api(app):
    """Register all API blueprints and SocketIO events with the Flask app."""
    app.register_blueprint(scanner_bp)
    register_events(app)
