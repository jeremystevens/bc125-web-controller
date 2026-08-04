"""
auth.py — Simple password authentication for Prod_test.

Guests can view everything and use the keypad/favorites/Live Audio.
Protected features (channel editing, settings, etc.) require a password.

Session: 7-day persistent cookie via Flask-Login / signed cookie.
Password: single ADMIN_PASSWORD set in .env.
"""

import hashlib
import hmac
import time
from functools import wraps

from flask import (
    Blueprint,
    jsonify,
    make_response,
    request,
    render_template_string,
    current_app,
)
from config import config

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

COOKIE_NAME = "bc125at_admin"
COOKIE_DAYS = 7
COOKIE_MAX_AGE = COOKIE_DAYS * 24 * 3600


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------


def _make_token(secret: str) -> str:
    """Generate a signed token: HMAC-SHA256(secret + timestamp)."""
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), ts.encode(), hashlib.sha256).hexdigest()
    return f"{ts}:{sig}"


def _verify_token(token: str, secret: str, max_age: int = COOKIE_MAX_AGE) -> bool:
    """Verify a signed token is valid and not expired."""
    try:
        ts_str, sig = token.split(":", 1)
        ts = int(ts_str)
    except ValueError, AttributeError:
        return False

    # Check expiry
    if time.time() - ts > max_age:
        return False

    # Verify HMAC
    expected = hmac.new(secret.encode(), ts_str.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


# ---------------------------------------------------------------------------
# Public helper — call from request handlers
# ---------------------------------------------------------------------------


def is_admin() -> bool:
    """Return True if the current request has a valid admin cookie."""
    password = config.ADMIN_PASSWORD
    if not password:
        return True  # auth disabled (no password set)

    token = request.cookies.get(COOKIE_NAME, "")
    secret = config.SECRET_KEY + password
    return _verify_token(token, secret)


def admin_required(f):
    """Decorator for API routes that require admin login."""

    @wraps(f)
    def decorated(*args, **kwargs):
        if not is_admin():
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Authentication required.",
                        "auth_required": True,
                    }
                ),
                401,
            )
        return f(*args, **kwargs)

    return decorated


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

LOGIN_HTML = """
<!DOCTYPE html>
<html>
<head>
  <title>BC125AT — Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 36px 32px;
      width: 100%;
      max-width: 360px;
    }
    .title {
      font-size: 22px;
      font-weight: 600;
      color: #4ade80;
      margin-bottom: 4px;
      letter-spacing: -0.02em;
    }
    .subtitle {
      font-size: 13px;
      color: #8b949e;
      margin-bottom: 28px;
    }
    label {
      display: block;
      font-size: 12px;
      color: #8b949e;
      margin-bottom: 6px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    input[type=password] {
      width: 100%;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e2e8f0;
      font-size: 14px;
      padding: 10px 12px;
      outline: none;
      margin-bottom: 20px;
      transition: border-color 0.15s;
    }
    input[type=password]:focus { border-color: #4ade80; }
    button {
      width: 100%;
      background: #238636;
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      padding: 10px;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #2ea043; }
    .error {
      color: #f87171;
      font-size: 13px;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: rgba(248,113,113,0.1);
      border-radius: 6px;
      border: 1px solid rgba(248,113,113,0.2);
    }
    .back {
      display: block;
      text-align: center;
      margin-top: 16px;
      font-size: 12px;
      color: #8b949e;
      text-decoration: none;
    }
    .back:hover { color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">BC125AT</div>
    <div class="subtitle">Enter password to access admin features</div>
    {% if error %}
    <div class="error">{{ error }}</div>
    {% endif %}
    <form method="POST" action="/auth/login">
      <label>Password</label>
      <input type="password" name="password" autofocus placeholder="••••••••">
      <input type="hidden" name="next" value="{{ next }}">
      <button type="submit">Sign in</button>
    </form>
    <a class="back" href="/">← Back to scanner</a>
  </div>
</body>
</html>
"""


@auth_bp.get("/login")
def login_page():
    next_url = request.args.get("next", "/")
    return render_template_string(LOGIN_HTML, error=None, next=next_url)


@auth_bp.post("/login")
def login_submit():
    password = request.form.get("password", "")
    next_url = request.form.get("next", "/")
    expected = config.ADMIN_PASSWORD

    if not expected:
        # No password configured — auto-login
        resp = make_response(jsonify({"success": True}))
        return resp

    if password != expected:
        return render_template_string(
            LOGIN_HTML, error="Incorrect password.", next=next_url
        )

    # Set 7-day signed cookie
    secret = config.SECRET_KEY + expected
    token = _make_token(secret)

    resp = make_response(
        render_template_string(
            """
        <script>window.location = {{ next|tojson }};</script>
        """,
            next=next_url,
        )
    )
    resp.set_cookie(
        COOKIE_NAME,
        token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="Lax",
        secure=False,  # set True if serving over HTTPS
    )
    return resp


@auth_bp.post("/logout")
def logout():
    resp = make_response(jsonify({"success": True, "message": "Logged out."}))
    resp.delete_cookie(COOKIE_NAME)
    return resp


@auth_bp.get("/status")
def auth_status():
    """GET /auth/status — returns whether the current request is authenticated."""
    return jsonify(
        {"authenticated": is_admin(), "auth_enabled": bool(config.ADMIN_PASSWORD)}
    )
