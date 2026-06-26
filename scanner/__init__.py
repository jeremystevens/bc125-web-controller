"""
scanner/__init__.py

Public interface for the scanner package.
Other parts of the app import from here, not from submodules directly.

    from scanner import Scanner
"""

from .scanner import Scanner

__all__ = ["Scanner"]
