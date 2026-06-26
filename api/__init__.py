"""
api/__init__.py

Registers the scanner Blueprint with the Flask app.
Import and call register_routes(app) from app.py.
"""

from .routes import scanner_bp


def register_routes(app):
    """Register all API blueprints with the Flask app."""
    app.register_blueprint(scanner_bp)
